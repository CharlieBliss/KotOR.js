/**
 * Neverwinter Nights-Style GM Multiplayer WebSocket Relay Server
 *
 * Listens on 0.0.0.0:7878 (configurable via GM_PORT env var or CLI arg) so a GM
 * can host a session on a LAN or port-forwarded machine for remote players to join.
 * Also supports attaching to the webpack-dev-server HTTP server at `/gm-ws`.
 */
const { WebSocketServer, WebSocket } = require('ws');
const os = require('os');

let activeStandaloneWss = null;

// Packets that change the shared world; only the registered host may send them
const HOST_ONLY_TYPES = new Set([
  'world.snapshot',
  'world.tick',
  'scene.load',
  'actor.spawn',
  'actor.update',
  'actor.remove',
  'actor.assign',
  'door.state',
]);

// Player packets that only the host needs to see
const HOST_BOUND_TYPES = new Set(['peer.join', 'client.input', 'client.intent']);

function createRelayState() {
  return {
    clients: new Map(), // ws -> { peerId, role, name }
    hostWs: null,
  };
}

function sendRelayError(ws, code, message) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'relay.error', senderId: 'relay', timestamp: Date.now(), payload: { code, message } }));
}

function isPeerIdInUse(state, ws, peerId) {
  for (const [otherWs, meta] of state.clients.entries()) {
    if (otherWs !== ws && meta.peerId === peerId && otherWs.readyState === WebSocket.OPEN) return true;
  }
  return false;
}

function attachSocketHandlers(wss, state) {
  wss.on('connection', (ws) => {
    state.clients.set(ws, { peerId: null, role: 'client', name: 'Player' });

    ws.on('message', (raw) => {
      let msgStr = typeof raw === 'string' ? raw : raw.toString('utf8');
      let pkt = null;
      try {
        pkt = JSON.parse(msgStr);
      } catch (e) {
        return;
      }
      if (!pkt || !pkt.type) return;

      const meta = state.clients.get(ws);
      if (!meta) return;

      // A socket's identity is fixed by its first packet; later packets can't speak for anyone else
      if (!meta.peerId) {
        if (!pkt.senderId) return;
        if (isPeerIdInUse(state, ws, pkt.senderId)) {
          sendRelayError(ws, 'peer-id-in-use', 'Another connection is already using this player id.');
          return;
        }
        meta.peerId = pkt.senderId;
      }
      pkt.senderId = meta.peerId;

      if (pkt.type === 'host.register') {
        if (state.hostWs && state.hostWs !== ws && state.hostWs.readyState === WebSocket.OPEN) {
          sendRelayError(ws, 'host-exists', 'A GM is already hosting on this server.');
          return;
        }
        state.hostWs = ws;
        meta.role = 'host';
        meta.name = pkt.payload?.sessionName || 'GM Host';
        // Registration is between the host and the relay; players have no use for it
        return;
      } else if (pkt.type === 'peer.join') {
        meta.name = pkt.payload?.name || 'Player';
      }

      const fromHost = state.hostWs === ws;
      if (HOST_ONLY_TYPES.has(pkt.type) && !fromHost) return;

      msgStr = JSON.stringify(pkt);
      for (const [clientWs, clientMeta] of state.clients.entries()) {
        if (clientWs === ws || clientWs.readyState !== WebSocket.OPEN) continue;
        if (!fromHost && HOST_BOUND_TYPES.has(pkt.type) && clientWs !== state.hostWs) continue;
        if (pkt.targetPeerId && clientMeta.peerId !== pkt.targetPeerId) continue;
        clientWs.send(msgStr);
      }
    });

    ws.on('close', () => {
      const meta = state.clients.get(ws);
      state.clients.delete(ws);
      if (state.hostWs === ws) state.hostWs = null;
      if (meta && meta.peerId) {
        const leavePkt = JSON.stringify({
          type: 'peer.leave',
          senderId: meta.peerId,
          timestamp: Date.now(),
          payload: { peerId: meta.peerId, name: meta.name }
        });
        for (const [clientWs] of state.clients.entries()) {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(leavePkt);
          }
        }
      }
    });

    ws.on('error', () => {});
  });
}

function getLocalIPv4Addresses() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push(net.address);
      }
    }
  }
  return results;
}

function startGMRelayServer(options = {}) {
  const port = Number(options.port || process.env.GM_PORT || 7878);
  const host = options.host || '0.0.0.0';
  const state = createRelayState();

  if (!activeStandaloneWss) {
    try {
      const wss = new WebSocketServer({ host, port });
      activeStandaloneWss = wss;
      attachSocketHandlers(wss, state);

      wss.on('listening', () => {
        const lanIps = getLocalIPv4Addresses();
        console.log(`\n=============================================================`);
        console.log(`[KotOR.js GM Server] Listening on ws://${host}:${port}`);
        if (lanIps.length) {
          console.log(`[KotOR.js GM Server] LAN Address: ws://${lanIps[0]}:${port}`);
        }
        console.log(`[KotOR.js GM Server] Ready for GM Host & Player connections!`);
        console.log(`=============================================================\n`);
      });

      wss.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
          console.log(`[KotOR.js GM Server] Port ${port} already in use (another GM server instance is active).`);
        } else {
          console.warn('[KotOR.js GM Server] Error:', err.message);
        }
      });
    } catch (e) {
      // Ignore bind failure if already running
    }
  }

  if (options.httpServer) {
    try {
      const pathWss = new WebSocketServer({ noServer: true });
      attachSocketHandlers(pathWss, state);
      options.httpServer.on('upgrade', (request, socket, head) => {
        if (request.url && request.url.startsWith('/gm-ws')) {
          pathWss.handleUpgrade(request, socket, head, (ws) => {
            pathWss.emit('connection', ws, request);
          });
        }
      });
    } catch (e) {}
  }

  return activeStandaloneWss;
}

if (require.main === module) {
  const cliPort = process.argv[2] ? Number(process.argv[2]) : 7878;
  startGMRelayServer({ port: cliPort });
}

module.exports = { startGMRelayServer, createRelayState, attachSocketHandlers };

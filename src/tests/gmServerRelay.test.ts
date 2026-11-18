import { EventEmitter } from "events";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("ws", () => ({
  WebSocket: { OPEN: 1 },
  WebSocketServer: class {},
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createRelayState, attachSocketHandlers } = require("../../scripts/gm-server") as {
  createRelayState: () => { clients: Map<any, any>; hostWs: any };
  attachSocketHandlers: (wss: any, state: any) => void;
};

class MockSocket extends EventEmitter {
  readyState = 1;
  sent: any[] = [];

  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }

  receive(pkt: Record<string, any>) {
    this.emit("message", JSON.stringify(pkt));
  }

  disconnect() {
    this.readyState = 3;
    this.emit("close");
  }
}

function createHarness() {
  const wss = new EventEmitter();
  const state = createRelayState();
  attachSocketHandlers(wss, state);

  const connect = () => {
    const ws = new MockSocket();
    wss.emit("connection", ws);
    return ws;
  };

  return { wss, state, connect };
}

describe("GM WebSocket relay server", () => {
  test("notifies waiting clients when a host registers and rejects a second host", () => {
    const { connect } = createHarness();
    const waiting = connect();
    waiting.receive({ type: "peer.join", senderId: "p1", payload: { name: "Hero" } });
    expect(waiting.sent.some((p) => p.type === "relay.error" && p.payload.code === "no-host")).toBe(true);
    waiting.sent.length = 0;

    const host = connect();
    host.receive({ type: "host.register", senderId: "gm", payload: { sessionName: "Test" } });
    expect(waiting.sent.some((p) => p.type === "relay.host-ready")).toBe(true);

    const secondHost = connect();
    secondHost.receive({ type: "host.register", senderId: "gm2", payload: {} });
    expect(secondHost.sent.some((p) => p.type === "relay.error" && p.payload.code === "host-exists")).toBe(true);
  });

  test("rejects duplicate active peerIds and pins senderId to the first packet's identity", () => {
    const { connect } = createHarness();
    const host = connect();
    host.receive({ type: "host.register", senderId: "gm", payload: {} });

    const p1 = connect();
    p1.receive({ type: "peer.join", senderId: "p1", payload: { name: "Alice" } });

    const p1Clone = connect();
    p1Clone.receive({ type: "peer.join", senderId: "p1", payload: { name: "Impostor" } });
    expect(p1Clone.sent.some((p) => p.type === "relay.error" && p.payload.code === "peer-id-in-use")).toBe(true);

    host.sent.length = 0;
    p1.receive({ type: "client.intent", senderId: "gm", payload: { kind: "attack" } });
    expect(host.sent).toHaveLength(1);
    expect(host.sent[0].senderId).toBe("p1");
  });

  test("blocks clients from forging host-only packets and keeps host-bound packets private to the host", () => {
    const { connect } = createHarness();
    const host = connect();
    host.receive({ type: "host.register", senderId: "gm", payload: {} });

    const p1 = connect();
    const p2 = connect();
    p1.receive({ type: "peer.join", senderId: "p1", payload: { name: "P1" } });
    p2.receive({ type: "peer.join", senderId: "p2", payload: { name: "P2" } });

    host.sent.length = 0;
    p1.sent.length = 0;
    p2.sent.length = 0;

    // Client tries to send host-only packets: dropped
    p1.receive({ type: "world.tick", senderId: "p1", payload: { actors: [] } });
    p1.receive({ type: "session.rules", senderId: "p1", payload: {} });
    expect(host.sent).toHaveLength(0);
    expect(p2.sent).toHaveLength(0);

    // Client sends host-bound intent: delivered to host, never leaked to p2
    p1.receive({ type: "client.intent", senderId: "p1", payload: { kind: "loot" } });
    expect(host.sent).toHaveLength(1);
    expect(host.sent[0].type).toBe("client.intent");
    expect(p2.sent).toHaveLength(0);

    // Host targets p2 specifically
    host.receive({ type: "player.sheet", senderId: "gm", targetPeerId: "p2", payload: { hp: 50 } });
    expect(p2.sent.some((p) => p.type === "player.sheet")).toBe(true);
    expect(p1.sent.some((p) => p.type === "player.sheet")).toBe(false);
  });

  test("broadcasts peer.leave with wasHost=true and frees host slot on host disconnect", () => {
    const { state, connect } = createHarness();
    const host = connect();
    host.receive({ type: "host.register", senderId: "gm", payload: {} });

    const p1 = connect();
    p1.receive({ type: "peer.join", senderId: "p1", payload: { name: "P1" } });
    p1.sent.length = 0;

    host.disconnect();
    expect(state.hostWs).toBeNull();
    expect(p1.sent.some((p) => p.type === "peer.leave" && p.payload.wasHost === true)).toBe(true);
  });
});

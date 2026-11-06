/**
 * GM mode end-to-end check.
 *
 * Runs a real GM session in three game windows (a GM host and two players) against the dev server and
 * the dev game folder, and verifies after every step that the host and both players agree:
 *
 *   1. GM enters GM mode            6. GM places friendly NPCs (one carrying loot)
 *   2. GM starts a session          7. GM turns them hostile
 *   3. GM switches scene            8. both players fight that NPC until it dies
 *   4. GM places items              9. Player 1 loots its body; only Player 1 gets the items
 *   5. two players join            10. GM moves everyone to a new scene, then everyone leaves
 *
 * Each step uses the same calls the GM panel and main-menu buttons make. Exits non-zero on any failure.
 *
 * Usage:  npm run test:gm-e2e [-- --show] [-- --keep-open]
 *   --show       show the three game windows instead of rendering offscreen
 *   --keep-open  leave the windows open after the run (with --show)
 *
 * Environment: GM_E2E_URL (default http://localhost:8080), GM_E2E_WS (default ws://localhost:7878).
 * If nothing is serving GM_E2E_URL, `npm run dev` is started for the run and stopped afterwards.
 */
const { app, BrowserWindow } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');

const BASE_URL = (process.env.GM_E2E_URL || 'http://localhost:8080').replace(/\/$/, '');
const WS_URL = process.env.GM_E2E_WS || 'ws://localhost:7878';
const SHOW = process.argv.includes('--show');
const KEEP_OPEN = process.argv.includes('--keep-open');

const START_SCENE = 'danm14aa';
const SECOND_SCENE = 'danm14ab';
const FINAL_SCENE = 'danm13';

const FACTION_HOSTILE = 1;
const FACTION_FRIENDLY = 2;

// Carried by the first NPC, taken from its body by Player 1. Neither player starts with these.
const NPC_LOOT = ['g_w_vbroswrd01', 'g_w_blstrrfl001'];

const BOOT_TIMEOUT = 180000;
const SCENE_TIMEOUT = 120000;
const SYNC_TIMEOUT = 20000;
// Fights have taken 30-100s: players can be held up getting around each other to reach the target
const COMBAT_TIMEOUT = 180000;

// Keep game windows simulating at full speed even when hidden or unfocused
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const results = [];
const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's';

function log(msg) {
  console.log(`${elapsed()}  ${msg}`);
}

class CheckFailed extends Error {}

async function step(name, fn) {
  const start = Date.now();
  log(`▶ ${name}`);
  try {
    const details = await fn();
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    results.push({ name, ok: true, secs });
    log(`  ✔ ${name} (${secs}s)${details ? ' — ' + details : ''}`);
    return true;
  } catch (e) {
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    results.push({ name, ok: false, secs, error: e.message });
    log(`  ✘ ${name} (${secs}s) — ${e.message}`);
    return false;
  }
}

function expect(cond, message) {
  if (!cond) throw new CheckFailed(message);
}

// ---------------------------------------------------------------------------
// Dev server
// ---------------------------------------------------------------------------

let devServer = null;

async function isServing() {
  try {
    const res = await fetch(`${BASE_URL}/__dev-game/kotor/ls?path=`);
    if (!res.ok) return false;
    const entries = await res.json();
    return Array.isArray(entries) && entries.some((e) => e.name.toLowerCase() === 'chitin.key');
  } catch (e) {
    return false;
  }
}

async function ensureDevServer() {
  if (await isServing()) {
    log(`Using the dev server already running at ${BASE_URL}`);
    return;
  }
  log(`Nothing serving ${BASE_URL} with game files; starting \`npm run dev\` for this run...`);
  devServer = spawn('npm run dev', {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
  const deadline = Date.now() + BOOT_TIMEOUT;
  while (Date.now() < deadline) {
    if (await isServing()) {
      // The game bundle is built alongside the engine library; wait until it is served too
      try {
        const res = await fetch(`${BASE_URL}/game/game.js`);
        if (res.ok) return;
      } catch (e) {}
    }
    await sleep(2000);
  }
  throw new Error(`Dev server did not start serving ${BASE_URL} with game files. Check KOTOR_GAME_DIR (see scripts/dev-game-files.js).`);
}

function stopDevServer() {
  if (!devServer) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${devServer.pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-devServer.pid, 'SIGTERM');
    }
  } catch (e) {}
  devServer = null;
}

// ---------------------------------------------------------------------------
// Game windows
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class GameWindow {
  constructor(label) {
    this.label = label;
    this.uncaughtErrors = [];
    this.win = new BrowserWindow({
      width: 1280,
      height: 800,
      show: SHOW,
      title: `GM e2e — ${label}`,
      webPreferences: {
        backgroundThrottling: false,
        // Hidden windows still need to render frames for the game loop to run
        offscreen: !SHOW,
      },
    });
    if (!SHOW) this.win.webContents.setFrameRate(30);
    this.win.webContents.on('console-message', (event) => {
      const message = String(event.message || '');
      const isError = event.level === 'error' || event.level === 3;
      if (isError && /Uncaught|Unhandled/i.test(message)) {
        this.uncaughtErrors.push(message.split('\n')[0].slice(0, 200));
      }
    });
  }

  /** Run a function inside the page. It receives KotOR and the given args. */
  async eval(fn, ...args) {
    const src = `(async () => { const KotOR = window.KotOR; return await (${fn.toString()})(KotOR, ...${JSON.stringify(args)}); })()`;
    return this.win.webContents.executeJavaScript(src, true);
  }

  /** Poll until fn(KotOR, ...args) returns something truthy */
  async waitFor(description, fn, timeout, ...args) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.eval(fn, ...args);
        if (last) return last;
      } catch (e) {
        last = e.message;
      }
      await sleep(250);
    }
    throw new CheckFailed(`${this.label}: timed out after ${timeout / 1000}s waiting for ${description}${last ? ` (last: ${JSON.stringify(last)})` : ''}`);
  }

  async boot() {
    await this.win.loadURL(`${BASE_URL}/game/`);
    // Accept the EULA once for this browser profile, then reload so the game starts straight away
    const accepted = await this.waitFor('the EULA state', () => {
      const raw = localStorage.getItem('acceptEULA');
      if (!raw) return false;
      const state = JSON.parse(raw);
      const keys = Object.keys(state);
      if (!keys.length) return false;
      if (keys.every((k) => state[k].accepted)) return 'already';
      for (const k of keys) state[k].accepted = true;
      localStorage.setItem('acceptEULA', JSON.stringify(state));
      return 'set';
    }, BOOT_TIMEOUT);
    if (accepted === 'set') await this.win.loadURL(`${BASE_URL}/game/`);

    await this.waitFor('the main menu', (KotOR) => {
      const GS = KotOR && KotOR.GameState;
      return !!(GS && GS.Ready && GS.MenuManager && GS.MenuManager.MainMenu);
    }, BOOT_TIMEOUT);
  }

  close() {
    if (!this.win.isDestroyed()) this.win.destroy();
  }
}

// In-page helpers, shared by the steps below (each runs inside a game window)

/** The scene is fully loaded in GM mode */
const sceneReady = (KotOR, resRef) => {
  const GS = KotOR.GameState;
  return !!(GS.gmMode && GS.module && GS.module.readyToProcessEvents && !GS.loadingTextures &&
    String(GS.module.filename).toLowerCase() === resRef && KotOR.GMManager.active);
};

/** A spot near the scene's entry point, on the walkmesh when it can find it */
const spotNearEntry = (KotOR, dx, dy) => {
  const THREE = window.THREE;
  const m = KotOR.GameState.module;
  const x = m.entryX + dx;
  const y = m.entryY + dy;
  let z = m.entryZ;
  const ray = new THREE.Raycaster(new THREE.Vector3(x, y, m.entryZ + 3), new THREE.Vector3(0, 0, -1));
  const hits = ray.intersectObjects(KotOR.GameState.walkmeshList || [], true);
  if (hits.length) z = hits[0].point.z;
  return { x, y, z };
};

/** After a failed step: what each window's game thinks the state is */
async function diagnose(windows) {
  for (const w of windows) {
    try {
      const state = await w.eval(async (KotOR) => {
        const frames = await new Promise((resolve) => {
          let n = 0;
          const tick = () => { n++; requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
          setTimeout(() => resolve(n), 1000);
        });
        const GS = KotOR.GameState;
        const G = KotOR.GMManager;
        const N = KotOR.GMNetworkManager;
        const me = GS.getCurrentPlayer && GS.getCurrentPlayer();
        return {
          scene: GS.module && GS.module.filename,
          ready: !!(GS.module && GS.module.readyToProcessEvents),
          sceneLoading: G.sceneLoading,
          role: N.role,
          assigned: N.assignedActorNetId,
          playing: me ? me.gmNetId || '(no net id)' : null,
          playerChars: [...G.netIdMap.keys()].filter((k) => k.startsWith('pc_')),
          pendingSpawns: [...G.pendingNetSpawns],
          framesPerSecond: frames,
          engineMode: GS.Mode,
          engineState: GS.State,
          ticksReceived: window.__gmE2eTicks,
          packetsSent: window.__gmE2eSent,
          peers: N.role === 'host' ? [...N.peers.values()].map((p) => p.controlledNetId) : undefined,
          actorsInNextTick: N.role === 'host' ? (() => { try { return G.serializeActorsForTick().length; } catch (e) { return 'threw: ' + e.message; } })() : undefined,
        };
      });
      log(`  ${w.label}: ${JSON.stringify(state)}`);
    } catch (e) {
      log(`  ${w.label}: could not read state (${e.message})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

async function run() {
  await ensureDevServer();

  const gm = new GameWindow('GM');
  const players = [new GameWindow('Player 1'), new GameWindow('Player 2')];
  const everyone = [gm, ...players];
  const placed = { items: [], npcs: [] };
  let playerNetIds = [];
  let ok = true;

  const must = async (name, fn) => {
    const passed = await step(name, fn);
    if (!passed) {
      ok = false;
      await diagnose(everyone);
    }
    return passed;
  };

  try {
    if (!await must('GM boots to the main menu', async () => {
      await gm.boot();
    })) return false;

    if (!await must(`GM enters GM mode (${START_SCENE})`, async () => {
      await gm.eval((KotOR, scene) => KotOR.GameState.EnterGMMode(scene), START_SCENE);
      await gm.waitFor(`${START_SCENE} to load`, sceneReady, SCENE_TIMEOUT, START_SCENE);
    })) return false;

    if (!await must('GM starts a session', async () => {
      await gm.eval((KotOR, url) => KotOR.GMNetworkManager.hostSession(url, 'GM e2e session'), WS_URL);
      const status = await gm.waitFor('the session to be hosted', (KotOR) => {
        const N = KotOR.GMNetworkManager;
        return N.role === 'host' && N.connected && N.ws && N.ws.readyState === 1 ? N.statusMessage : false;
      }, SYNC_TIMEOUT);
      return status;
    })) return false;

    if (!await must(`GM switches scene to ${SECOND_SCENE}`, async () => {
      await gm.eval((KotOR, scene) => KotOR.GMManager.loadScene(scene, { keepCreatures: false, keepPlaceables: true }), SECOND_SCENE);
      await gm.waitFor(`${SECOND_SCENE} to load`, sceneReady, SCENE_TIMEOUT, SECOND_SCENE);
    })) return false;

    await must('GM places items', async () => {
      placed.items = await gm.eval(async (KotOR, spotSrc) => {
        const spot = eval(spotSrc);
        const G = KotOR.GMManager;
        const out = [];
        const configs = [
          { ...G.pendingPlaceableConfig, name: 'E2E Loot Crate', hasInventory: true, lootResRefs: ['g_i_medeqpmnt01', 'g_i_secspike01'], barkText: '' },
          { ...G.pendingPlaceableConfig, name: 'E2E Supply Crate', hasInventory: true, lootResRefs: ['g_i_credits001'], barkText: '' },
        ];
        for (let i = 0; i < configs.length; i++) {
          const p = spot(KotOR, 3, -2 + i * 2);
          const plc = await G.spawnPlaceable(configs[i], new window.THREE.Vector3(p.x, p.y, p.z), 0);
          if (plc) out.push(plc.gmNetId);
        }
        return out;
      }, spotNearEntry.toString());
      expect(placed.items.length === 2, `expected 2 items placed, got ${placed.items.length}`);
      const onHost = await gm.eval((KotOR, ids) => ids.map((id) => {
        const obj = KotOR.GMManager.netIdMap.get(id);
        return !!obj && KotOR.GameState.module.area.placeables.includes(obj) && obj.inventory.length > 0;
      }), placed.items);
      expect(onHost.every(Boolean), `items missing from the scene or empty on the host: ${JSON.stringify(onHost)}`);
      return placed.items.join(', ');
    });

    if (!await must('Two players boot and join', async () => {
      await Promise.all(players.map((p) => p.boot()));
      for (let i = 0; i < players.length; i++) {
        await players[i].eval((KotOR, url, name) => {
          const G = KotOR.GMManager;
          const preset = G.PLAYER_PRESETS[0];
          // Same as the main menu's "Connect & Enter World" button
          KotOR.GameState.gmMode = true;
          G.active = true;
          KotOR.GMNetworkManager.joinSession(url, name, {
            name,
            appearanceId: preset.appearanceId,
            classId: preset.classId,
            rightHandResRef: preset.rightHandResRef,
            armorResRef: preset.armorResRef,
          });
        }, WS_URL, `E2E Player ${i + 1}`);
      }
      playerNetIds = await Promise.all(players.map((p) => p.waitFor('our character to be assigned and possessed', (KotOR, scene) => {
        const N = KotOR.GMNetworkManager;
        const me = KotOR.GameState.getCurrentPlayer();
        const inScene = String(KotOR.GameState.module && KotOR.GameState.module.filename).toLowerCase() === scene;
        return inScene && N.assignedActorNetId && me && me.gmNetId === N.assignedActorNetId ? N.assignedActorNetId : false;
      }, SCENE_TIMEOUT, SECOND_SCENE)));
      expect(new Set(playerNetIds).size === 2, `players were given the same character: ${playerNetIds}`);

      const hostPeers = await gm.eval((KotOR) => [...KotOR.GMNetworkManager.peers.values()].map((p) => p.controlledNetId).sort());
      expect(JSON.stringify(hostPeers) === JSON.stringify([...playerNetIds].sort()), `host's players ${JSON.stringify(hostPeers)} don't match ${JSON.stringify(playerNetIds)}`);

      // Each player's sheet comes from the host, and each sees the other player
      for (let i = 0; i < players.length; i++) {
        const other = playerNetIds[1 - i];
        await players[i].waitFor('the host character sheet and the other player', (KotOR, otherId) => {
          const me = KotOR.GameState.getCurrentPlayer();
          const level = me && me.classes[0] && me.classes[0].level;
          return level && KotOR.GameState.InventoryManager.inventory.length > 0 && KotOR.GMManager.netIdMap.has(otherId) ? level : false;
        }, SYNC_TIMEOUT, other);
      }
      return playerNetIds.join(', ');
    })) return false;

    await must('Players see the placed items', async () => {
      for (const p of players) {
        await p.waitFor('the placed items', (KotOR, ids) => ids.every((id) => KotOR.GMManager.netIdMap.has(id)), SYNC_TIMEOUT, placed.items);
      }
    });

    await must('GM places friendly NPCs', async () => {
      placed.npcs = await gm.eval(async (KotOR, spotSrc, faction, loot) => {
        const spot = eval(spotSrc);
        const G = KotOR.GMManager;
        const out = [];
        for (let i = 0; i < 2; i++) {
          // The second NPC stands well away, so both players can reach the first one
          const p = i === 0 ? spot(KotOR, -3, -2) : spot(KotOR, 6, 6);
          // The looted NPC is tough enough that both players reach it and fight before it falls
          const config = { ...G.CREATURE_PRESETS[0], name: `E2E Guard ${i + 1}`, factionId: faction, barkText: '', hp: i === 0 ? 200 : G.CREATURE_PRESETS[0].hp, lootResRefs: i === 0 ? loot : [] };
          const cre = await G.spawnCreature(config, new window.THREE.Vector3(p.x, p.y, p.z), 0);
          if (cre) out.push(cre.gmNetId);
        }
        return out;
      }, spotNearEntry.toString(), FACTION_FRIENDLY, NPC_LOOT);
      expect(placed.npcs.length === 2, `expected 2 NPCs placed, got ${placed.npcs.length}`);
      const carried = await gm.eval((KotOR, id) => KotOR.GMManager.netIdMap.get(id).inventory.map((i) => i.getEquippedRes() || i.getInventoryRes()), placed.npcs[0]);
      expect(NPC_LOOT.every((r) => carried.includes(r)), `the first NPC should carry ${NPC_LOOT}, carries ${JSON.stringify(carried)}`);

      for (const p of players) {
        await p.waitFor('the NPCs as friendly', (KotOR, ids, faction) => {
          const me = KotOR.GameState.getCurrentPlayer();
          return ids.every((id) => {
            const cre = KotOR.GMManager.netIdMap.get(id);
            return cre && cre.factionId === faction && !cre.isHostile(me);
          });
        }, SYNC_TIMEOUT, placed.npcs, FACTION_FRIENDLY);
      }
      return placed.npcs.join(', ');
    });

    await must('GM turns the NPCs hostile', async () => {
      await gm.eval((KotOR, ids, faction) => {
        for (const id of ids) KotOR.GMManager.setObjectFaction(KotOR.GMManager.netIdMap.get(id), faction);
      }, placed.npcs, FACTION_HOSTILE);
      const hostSees = await gm.eval((KotOR, ids) => ids.map((id) => KotOR.GMManager.netIdMap.get(id).factionId), placed.npcs);
      expect(hostSees.every((f) => f === FACTION_HOSTILE), `host factions are ${JSON.stringify(hostSees)}`);
      for (const p of players) {
        await p.waitFor('the NPCs as hostile', (KotOR, ids, faction) => {
          const me = KotOR.GameState.getCurrentPlayer();
          return ids.every((id) => {
            const cre = KotOR.GMManager.netIdMap.get(id);
            return cre && cre.factionId === faction && cre.isHostile(me);
          });
        }, SYNC_TIMEOUT, placed.npcs, FACTION_HOSTILE);
      }
    });

    await must('Players fight the hostile NPC until it dies', async () => {
      const target = placed.npcs[0];
      // Record the combat visuals each player is shown from here on
      for (const p of players) {
        await p.eval((KotOR) => {
          const G = KotOR.GMManager;
          window.__gmE2eFx = [];
          const original = G.applyFxEventOnClient.bind(G);
          G.applyFxEventOnClient = (event) => { window.__gmE2eFx.push(event); return original(event); };
        });
      }

      // Both players attack (the same request a click on a hostile creature sends), and attack
      // again whenever a combat round ends with the target still standing
      const deadline = Date.now() + COMBAT_TIMEOUT;
      const hostSamples = [];
      let dead = false;
      while (!dead && Date.now() < deadline) {
        hostSamples.push(await gm.eval((KotOR, ids, targetId) => {
          const G = KotOR.GMManager;
          const t = G.netIdMap.get(targetId);
          return ids.map((id) => {
            const pc = G.netIdMap.get(id);
            return pc ? `${pc.actionQueue.map((a) => a.type).join(',') || '-'}@${t ? pc.position.distanceTo(t.position).toFixed(1) : '?'}m${pc.combatData.combatState ? ' combat' : ''} a${pc.animationState.index}` : 'missing';
          }).join(' | ') + ` | target hp ${t ? t.getHP() : '?'}`;
        }, playerNetIds, target));
        for (const p of players) {
          await p.eval((KotOR, id) => {
            const G = KotOR.GMManager;
            const cre = G.netIdMap.get(id);
            if (cre && !cre.isDead() && !KotOR.GMNetworkManager.awaitingHost) {
              G.interceptInteraction(KotOR.GameState.getCurrentPlayer(), cre);
            }
          }, target);
        }
        await sleep(1000);
        dead = await gm.eval((KotOR, id) => {
          const cre = KotOR.GMManager.netIdMap.get(id);
          return !!cre && cre.isDead();
        }, target);
      }
      expect(dead, `the NPC was still alive after ${COMBAT_TIMEOUT / 1000}s of combat`);

      // Everyone sees it die, and both players saw the fight
      for (const p of players) {
        await p.waitFor('the NPC to be dead', (KotOR, id) => {
          const cre = KotOR.GMManager.netIdMap.get(id);
          return !!cre && cre.isDead();
        }, SYNC_TIMEOUT, target);
      }
      const seen = await Promise.all(players.map((p) => p.eval((KotOR, id) => ({
        damageNumbers: window.__gmE2eFx.filter((e) => e.kind === 'text' && e.netId === id).length,
        attackers: [...new Set(window.__gmE2eFx.filter((e) => e.kind === 'anim').map((e) => e.netId))],
      }), target)));
      for (let i = 0; i < players.length; i++) {
        expect(seen[i].damageNumbers > 0, `Player ${i + 1} was shown no combat text on the NPC`);
        expect(playerNetIds.every((id) => seen[i].attackers.includes(id)), `Player ${i + 1} didn't see both players attack (animations seen for ${JSON.stringify(seen[i].attackers)}). Host each second, P1 | P2 (actions@distance): ${hostSamples.slice(-8).join(' ;; ')}`);
      }
      return `combat text shown: ${seen.map((s) => s.damageNumbers).join(' / ')}`;
    });

    await must('Player 1 loots the body', async () => {
      const corpse = placed.npcs[0];
      const inventories = async () => ({
        hostRecords: await gm.eval((KotOR, ids) => ids.map((id) => KotOR.GMManager.getPlayerInventory(KotOR.GMManager.netIdMap.get(id)).map((e) => e.resRef)), playerNetIds),
        gmOwn: await gm.eval((KotOR) => KotOR.GameState.InventoryManager.inventory.map((i) => i.getEquippedRes() || i.getInventoryRes())),
        players: await Promise.all(players.map((p) => p.eval((KotOR) => KotOR.GameState.InventoryManager.inventory.map((i) => i.getEquippedRes() || i.getInventoryRes())))),
      });
      const before = await inventories();
      for (const list of [...before.hostRecords, before.gmOwn, ...before.players]) {
        expect(!NPC_LOOT.some((r) => list.includes(r)), `loot was already in an inventory before looting: ${JSON.stringify(list)}`);
      }

      // Player 1 uses the body, as a click on a dead creature does; the host shows them its contents
      const sent = await players[0].eval((KotOR, id) => KotOR.GMManager.interceptInteraction(KotOR.GameState.getCurrentPlayer(), KotOR.GMManager.netIdMap.get(id)), corpse);
      expect(sent, 'clicking the body did not send a request to the host');
      let shown;
      try {
        shown = await players[0].waitFor('the loot window for the body', (KotOR, id) => {
          const menu = KotOR.GameState.MenuManager.MenuContainer;
          return menu.bVisible && menu.container && menu.container.gmNetId === id
            ? menu.container.inventory.map((i) => i.getEquippedRes() || i.getInventoryRes())
            : false;
        }, SYNC_TIMEOUT * 2, corpse);
      } catch (e) {
        const hostSide = await gm.eval((KotOR, corpseId, pcId) => {
          const G = KotOR.GMManager;
          const body = G.netIdMap.get(corpseId);
          const pc = G.netIdMap.get(pcId);
          return {
            bodyItems: body ? body.inventory.length : 'missing',
            bodyDead: body && body.isDead(),
            bodyUseable: body && body.isUseable(),
            pcActions: pc && pc.actionQueue.map((a) => a.type),
            pcHostDriven: pc && !!pc.gmHostDriven,
            pcIntentSeq: pc && pc.gmIntentSeq,
            pcDistance: pc && body ? +pc.position.distanceTo(body.position).toFixed(2) : null,
          };
        }, corpse, playerNetIds[0]);
        hostSide.samples = await gm.eval(async (KotOR, pcId, corpseId) => {
          const G = KotOR.GMManager;
          const pc = G.netIdMap.get(pcId);
          const body = G.netIdMap.get(corpseId);
          const out = [];
          for (let i = 0; i < 10; i++) {
            out.push({
              queue: pc.actionQueue.map((a) => a.type).join(','),
              canMove: pc.canMove(),
              combat: !!pc.combatData.combatState,
              round: !!(pc.combatRound && pc.combatRound.roundStarted),
              debilitated: pc.isDebilitated(),
              anim: pc.animationState.index,
              dist: +pc.position.distanceTo(body.position).toFixed(2),
            });
            await new Promise((r) => setTimeout(r, 200));
          }
          return out;
        }, playerNetIds[0], corpse);
        const clientSide = await players[0].eval((KotOR) => ({ awaitingHost: KotOR.GMNetworkManager.awaitingHost, intentSeq: KotOR.GMNetworkManager.localIntentSeq }));
        throw new CheckFailed(`${e.message}; host: ${JSON.stringify(hostSide)}; Player 1: ${JSON.stringify(clientSide)}`);
      }
      expect(NPC_LOOT.every((r) => shown.includes(r)), `the loot window showed ${JSON.stringify(shown)}`);
      const otherPlayerWindow = await players[1].eval((KotOR) => !!KotOR.GameState.MenuManager.MenuContainer.bVisible);
      const gmWindow = await gm.eval((KotOR) => !!KotOR.GameState.MenuManager.MenuContainer.bVisible);
      expect(!otherPlayerWindow && !gmWindow, `a loot window also opened for ${!gmWindow ? 'Player 2' : 'the GM'}`);

      // "Get Items" in the loot window
      await players[0].eval((KotOR) => {
        const menu = KotOR.GameState.MenuManager.MenuContainer;
        menu.selectedItem = menu.container.inventory[0];
        menu.BTN_OK.processEventListener('click', [{ stopPropagation() {} }]);
      });
      await players[0].waitFor('the loot in our inventory', (KotOR, loot) => {
        const inv = KotOR.GameState.InventoryManager.inventory.map((i) => i.getEquippedRes() || i.getInventoryRes());
        return loot.every((r) => inv.includes(r));
      }, SYNC_TIMEOUT, NPC_LOOT);

      const after = await inventories();
      expect(NPC_LOOT.every((r) => after.hostRecords[0].includes(r)), `the host's record of Player 1's inventory lacks the loot: ${JSON.stringify(after.hostRecords[0])}`);
      expect(!NPC_LOOT.some((r) => after.hostRecords[1].includes(r)), `the host's record of Player 2's inventory has the loot: ${JSON.stringify(after.hostRecords[1])}`);
      expect(!NPC_LOOT.some((r) => after.players[1].includes(r)), `Player 2's inventory has the loot: ${JSON.stringify(after.players[1])}`);
      expect(!NPC_LOOT.some((r) => after.gmOwn.includes(r)), `the GM's inventory has the loot: ${JSON.stringify(after.gmOwn)}`);
      const corpseLeft = await gm.eval((KotOR, id) => KotOR.GMManager.netIdMap.get(id).inventory.length, corpse);
      expect(corpseLeft === 0, `the body still holds ${corpseLeft} item(s) on the host`);
      return `Player 1 received ${NPC_LOOT.join(', ')}`;
    });

    await must(`GM moves everyone to ${FINAL_SCENE}`, async () => {
      // Count world ticks reaching each player from here on (shown in diagnostics if this step fails)
      for (const p of players) {
        await p.eval((KotOR) => {
          const G = KotOR.GMManager;
          window.__gmE2eTicks = { total: 0, withActors: 0, lastActorIds: [] };
          const original = G.applyWorldTickOnClient.bind(G);
          G.applyWorldTickOnClient = (actors) => {
            window.__gmE2eTicks.total++;
            if (actors && actors.length) {
              window.__gmE2eTicks.withActors++;
              window.__gmE2eTicks.lastActorIds = actors.map((a) => a.netId).slice(0, 8);
            }
            return original(actors);
          };
        });
      }
      // And count what the host sends from here on, by message type
      await gm.eval((KotOR) => {
        const N = KotOR.GMNetworkManager;
        window.__gmE2eSent = {};
        const original = N.sendPacket.bind(N);
        N.sendPacket = (packet) => {
          window.__gmE2eSent[packet.type] = (window.__gmE2eSent[packet.type] || 0) + 1;
          return original(packet);
        };
      });
      const inventoriesBefore = await gm.eval((KotOR, ids) => ids.map((id) => KotOR.GMManager.getPlayerInventory(KotOR.GMManager.netIdMap.get(id)).length), playerNetIds);
      await gm.eval((KotOR, scene) => KotOR.GMManager.loadScene(scene, { keepCreatures: false, keepPlaceables: true }), FINAL_SCENE);
      await gm.waitFor(`${FINAL_SCENE} to load`, sceneReady, SCENE_TIMEOUT, FINAL_SCENE);

      // Both players follow, and still control their own characters there
      await Promise.all(players.map((p, i) => p.waitFor(`${FINAL_SCENE} with our character`, (KotOR, scene, myId) => {
        const N = KotOR.GMNetworkManager;
        const me = KotOR.GameState.getCurrentPlayer();
        const inScene = String(KotOR.GameState.module && KotOR.GameState.module.filename).toLowerCase() === scene &&
          KotOR.GameState.module.readyToProcessEvents;
        return inScene && N.assignedActorNetId === myId && me && me.gmNetId === myId;
      }, SCENE_TIMEOUT, FINAL_SCENE, playerNetIds[i])));

      const hostState = await gm.eval((KotOR, ids, oldIds) => {
        const G = KotOR.GMManager;
        const area = KotOR.GameState.module.area;
        return {
          playersInArea: ids.map((id) => !!G.netIdMap.get(id) && area.creatures.includes(G.netIdMap.get(id))),
          peers: [...KotOR.GMNetworkManager.peers.values()].map((p) => p.controlledNetId),
          inventories: ids.map((id) => G.netIdMap.get(id) ? G.getPlayerInventory(G.netIdMap.get(id)).length : -1),
          oldObjectsLeft: oldIds.filter((id) => G.netIdMap.has(id)),
        };
      }, playerNetIds, [...placed.items, ...placed.npcs]);
      expect(hostState.playersInArea.every(Boolean), `players' characters missing from the new scene on the host: ${JSON.stringify(hostState.playersInArea)}`);
      expect(JSON.stringify(hostState.inventories) === JSON.stringify(inventoriesBefore), `player inventories changed across the scene change: ${JSON.stringify(inventoriesBefore)} -> ${JSON.stringify(hostState.inventories)}`);
      expect(hostState.oldObjectsLeft.length === 0, `objects from the previous scene are still registered: ${hostState.oldObjectsLeft}`);

      // Each player sees the other player in the new scene, and none of the old scene's objects
      for (let i = 0; i < players.length; i++) {
        await players[i].waitFor('the other player and no old objects', (KotOR, otherId, oldIds) =>
          KotOR.GMManager.netIdMap.has(otherId) && oldIds.every((id) => !KotOR.GMManager.netIdMap.has(id)),
        SYNC_TIMEOUT, playerNetIds[1 - i], [...placed.items, ...placed.npcs]);
      }
    });

    await must('Everyone leaves the session', async () => {
      for (const p of players) await p.eval((KotOR) => KotOR.GMNetworkManager.disconnect());
      await gm.waitFor('both players to leave', (KotOR) => KotOR.GMNetworkManager.peers.size === 0, SYNC_TIMEOUT);
      await gm.eval((KotOR) => KotOR.GMNetworkManager.disconnect());
      const roles = await Promise.all(everyone.map((w) => w.eval((KotOR) => KotOR.GMNetworkManager.role)));
      expect(roles.every((r) => r === 'offline'), `roles after leaving: ${roles}`);
    });

    return ok;
  } finally {
    const uncaught = everyone.flatMap((w) => w.uncaughtErrors.map((e) => `${w.label}: ${e}`));
    if (uncaught.length) {
      log(`Uncaught errors in the game windows (${uncaught.length}):`);
      for (const line of [...new Set(uncaught)].slice(0, 20)) log(`  ${line}`);
    }
    if (!(SHOW && KEEP_OPEN)) everyone.forEach((w) => w.close());
  }
}

app.whenReady().then(async () => {
  let passed = false;
  try {
    passed = await run();
  } catch (e) {
    log(`Run aborted: ${e.stack || e.message}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log('');
  console.log(`GM e2e: ${results.length - failed.length}/${results.length} steps passed${failed.length ? `, ${failed.length} failed` : ''}`);
  for (const r of failed) console.log(`  ✘ ${r.name}: ${r.error}`);
  stopDevServer();
  if (SHOW && KEEP_OPEN) return;
  app.exit(passed && !failed.length ? 0 : 1);
});

app.on('window-all-closed', () => {});

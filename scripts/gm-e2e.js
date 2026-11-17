/**
 * GM mode end-to-end check.
 *
 * Runs a real GM session in three game windows (a GM host and two players) against the dev server and
 * the dev game folder, and verifies after every step that the host and both players agree:
 *
 *   1. GM enters GM mode             9. Player 1 loots its body; only Player 1 gets the items
 *   2. GM starts a session          10. GM gives Player 2 XP and an item
 *   3. GM switches scene            11. GM asks Player 1 a question as an NPC; Player 1 answers
 *   4. GM places items              12. GM hides an NPC from players, then reveals it
 *   5. two players join; they can't 13. GM spawns an encounter
 *      switch character            14. GM saves the session
 *   6. GM places friendly NPCs
 *      (one carrying loot)          15. GM moves everyone to a new scene
 *   7. GM turns them hostile; one   16. GM loads the saved session; players get their saved characters
 *      attacks a player by itself   17. everyone leaves
 *   8. both players fight one NPC
 *      until it dies
 *
 * Each step uses the same calls the GM panel and main-menu buttons make. Exits non-zero on any failure.
 *
 * Usage:  npm run test:gm-e2e [-- --show] [-- --keep-open] [-- --speed 2]
 *   --show       show the three game windows (otherwise they sit off the edge of the desktop)
 *   --speed      how much faster than real time the game runs (default 2, at most 4)
 *   --keep-open  leave the windows open after the run (with --show)
 *
 * Environment: GM_E2E_URL (default http://localhost:8080), GM_E2E_WS (default ws://localhost:7878).
 * If nothing is serving GM_E2E_URL, `npm run dev` is started for the run and stopped afterwards.
 */
const { app } = require('electron');
const { configureApp, createGameWindow, evalIn, bootToMenu, setGameSpeed, sleep } = require('./lib/game-window');
const { createDevServer } = require('./lib/dev-server');

const BASE_URL = (process.env.GM_E2E_URL || 'http://localhost:8080').replace(/\/$/, '');
const WS_URL = process.env.GM_E2E_WS || 'ws://localhost:7878';
const SHOW = process.argv.includes('--show');
const KEEP_OPEN = process.argv.includes('--keep-open');
const speedArg = process.argv.indexOf('--speed');
const SPEED = Math.max(1, Math.min(4, Number(speedArg >= 0 ? process.argv[speedArg + 1] : 2) || 2));

const START_SCENE = 'danm14aa';
const SECOND_SCENE = 'danm14ab';
const FINAL_SCENE = 'danm13';

const FACTION_HOSTILE = 1;
const FACTION_FRIENDLY = 2;

// Carried by the first NPC, taken from its body by Player 1. Neither player starts with these.
const NPC_LOOT = ['g_w_vbroswrd01', 'g_w_blstrrfl001'];

// Player 2 joins with a character they made: level 6, 30 points of abilities
const MADE_CHARACTER = { level: 6, attributes: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 8 } };

// What the GM gives Player 2
const REWARD_XP = 500;
const REWARD_ITEM = 'g_i_medeqpmnt03';

// The game boots in about 5 s and loads a scene in about 5 s; starting the dev server takes longer
const DEV_SERVER_TIMEOUT = 180000;
const BOOT_TIMEOUT = 60000;
const SCENE_TIMEOUT = 60000;
const SYNC_TIMEOUT = 20000;
// Fights have taken 30-100 s of game time: players can be held up getting around each other to reach the target
const COMBAT_TIMEOUT = 180000 / SPEED;

// Its own browser profile, so a run is not blocked by other game windows holding the default one
configureApp(app, 'kotor-gm-e2e');

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

const devServer = createDevServer({ baseUrl: BASE_URL, timeout: DEV_SERVER_TIMEOUT, log });
const ensureDevServer = () => devServer.ensure();
const stopDevServer = () => devServer.stop();

// ---------------------------------------------------------------------------
// Game windows
// ---------------------------------------------------------------------------

class GameWindow {
  constructor(label) {
    this.label = label;
    this.win = createGameWindow({ show: SHOW, title: `GM e2e — ${label}` });
    // Collected by the window; reported at the end of the run
    this.uncaughtErrors = this.win.pageErrors;
  }

  /** Run a function inside the page. It receives KotOR and the given args. */
  async eval(fn, ...args) {
    return evalIn(this.win, fn, ...args);
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
      await sleep(200);
    }
    throw new CheckFailed(`${this.label}: timed out after ${timeout / 1000}s waiting for ${description}${last ? ` (last: ${JSON.stringify(last)})` : ''}`);
  }

  async boot() {
    try {
      await bootToMenu(this.win, `${BASE_URL}/game/`, { timeout: BOOT_TIMEOUT });
    } catch (e) {
      throw new CheckFailed(`${this.label}: ${e.message}`);
    }
    await setGameSpeed(this.win, SPEED);
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
          pendingSpawns: [...KotOR.GMReplication.pendingNetSpawns],
          framesPerSecond: frames,
          engineMode: GS.Mode,
          engineState: GS.State,
          ticksReceived: window.__gmE2eTicks,
          packetsSent: window.__gmE2eSent,
          peers: N.role === 'host' ? [...N.peers.values()].map((p) => p.controlledNetId) : undefined,
          actorsInNextTick: N.role === 'host' ? (() => { try { return KotOR.GMReplication.serializeActorsForTick().length; } catch (e) { return 'threw: ' + e.message; } })() : undefined,
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
          const plc = await KotOR.GMSpawner.spawnPlaceable(configs[i], new window.THREE.Vector3(p.x, p.y, p.z), 0);
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
        await players[i].eval((KotOR, url, name, made) => {
          const G = KotOR.GMManager;
          const preset = G.PLAYER_PRESETS[0];
          // Same as the main menu's "Connect & Enter World" button
          KotOR.GameState.gmMode = true;
          G.active = true;
          // Player 2 brings a character they made (GMCharacters), as the join card's character list sends it
          const character = made ? { ...KotOR.GMCharacters.blank(preset), name, ...made } : undefined;
          KotOR.GMNetworkManager.joinSession(url, name, {
            name,
            appearanceId: preset.appearanceId,
            classId: preset.classId,
            rightHandResRef: preset.rightHandResRef,
            armorResRef: preset.armorResRef,
            character,
          });
        }, WS_URL, `E2E Player ${i + 1}`, i === 1 ? MADE_CHARACTER : null);
      }
      playerNetIds = await Promise.all(players.map((p) => p.waitFor('our character to be assigned and possessed', (KotOR, scene) => {
        const N = KotOR.GMNetworkManager;
        const me = KotOR.GameState.getCurrentPlayer();
        const inScene = String(KotOR.GameState.module && KotOR.GameState.module.filename).toLowerCase() === scene;
        return inScene && N.assignedActorNetId && me && me.gmNetId === N.assignedActorNetId ? N.assignedActorNetId : false;
      }, SCENE_TIMEOUT, SECOND_SCENE)));
      expect(new Set(playerNetIds).size === 2, `players were given the same character: ${playerNetIds}`);
      // Player 2's made character arrives on the host as they made it
      const made = await gm.eval((KotOR, netId) => {
        const pc = KotOR.GMManager.netIdMap.get(netId);
        return pc && { name: pc.getName(), level: pc.getTotalClassLevel(), str: pc.getSTR(false), dex: pc.getDEX(false), con: pc.getCON(false) };
      }, playerNetIds[1]);
      expect(made && made.level === MADE_CHARACTER.level && made.str === MADE_CHARACTER.attributes.str && made.dex === MADE_CHARACTER.attributes.dex && made.con === MADE_CHARACTER.attributes.con,
        `Player 2's made character arrived as ${JSON.stringify(made)}, not level ${MADE_CHARACTER.level} with ${JSON.stringify(MADE_CHARACTER.attributes)}`);

      // The join screen has gone, and players can't switch to another character or fly the GM camera
      for (let i = 0; i < players.length; i++) {
        const state = await players[i].eval((KotOR) => {
          const before = KotOR.GameState.getCurrentPlayer();
          KotOR.GameState.PartyManager.ShiftLeader();
          return {
            joinState: KotOR.GMNetworkManager.joinState,
            sameCharacter: KotOR.GameState.getCurrentPlayer() === before,
            ingame: KotOR.GameState.Mode === KotOR.EngineMode.INGAME,
          };
        });
        expect(state.joinState === 'playing', `Player ${i + 1}'s join state is ${state.joinState}`);
        expect(state.sameCharacter, `Player ${i + 1} switched character with Tab`);
        expect(state.ingame, `Player ${i + 1} isn't playing their character (engine mode isn't INGAME)`);
      }

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

    await must('GM opens every panel tab', async () => {
      // Each drawer tab renders, and what the GM typed in one survives switching to another
      const result = await gm.eval(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const tabButton = (label) => [...document.querySelectorAll('.gm-topbar .gm-btn')].find((b) => b.textContent.trim().startsWith(label));
        const shown = () => [...document.querySelectorAll('.gm-drawer-body > div')].find((d) => d.style.display !== 'none');
        const setInput = (input, value) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const seen = {};
        for (const label of ['Scene', 'Place', 'Players', 'Inspect', 'Session']) {
          const button = tabButton(label);
          if (!button) return { error: `no ${label} tab button` };
          button.click();
          await wait(400);
          seen[label] = (shown()?.textContent || '').length;
          if (label === 'Scene') {
            const search = shown()?.querySelector('input.gm-input');
            if (!search) return { error: 'no scene search field' };
            setInput(search, 'e2e-kept');
            await wait(100);
          }
        }
        tabButton('Scene').click();
        await wait(400);
        const kept = shown()?.querySelector('input.gm-input')?.value;
        tabButton('Scene').click(); // close the drawer again
        await wait(100);
        const search = [...document.querySelectorAll('.gm-drawer-body input.gm-input')].find((i) => i.value === 'e2e-kept');
        if (search) setInput(search, '');
        return { seen, kept, drawerClosed: document.querySelector('.gm-drawer')?.style.display === 'none' };
      });
      expect(!result.error, result.error);
      for (const [label, length] of Object.entries(result.seen)) expect(length > 20, `the ${label} tab rendered nothing (${length} characters)`);
      expect(result.kept === 'e2e-kept', `the Scene tab's search was lost when switching tabs (${JSON.stringify(result.kept)})`);
      expect(result.drawerClosed, 'the drawer did not close');
      return `tabs: ${Object.keys(result.seen).join(', ')}`;
    });

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
          const config = { ...G.CREATURE_PRESETS[0], name: `E2E Guard ${i + 1}`, factionId: faction, barkText: '', customized: i === 0, hp: i === 0 ? 200 : G.CREATURE_PRESETS[0].hp, lootResRefs: i === 0 ? loot : [] };
          const cre = await KotOR.GMSpawner.spawnCreature(config, new window.THREE.Vector3(p.x, p.y, p.z), 0);
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

    await must('A hostile NPC attacks a player by itself', async () => {
      // The players start out of the NPCs' sight. The GM teleports the looted NPC up to Player 1 (as the
      // Teleport tool does); nobody has attacked yet, so it has to pick a player to fight on its own.
      await gm.eval((KotOR, npcId, pcId) => {
        const G = KotOR.GMManager;
        const npc = G.netIdMap.get(npcId);
        const pc = G.netIdMap.get(pcId);
        const toward = npc.position.clone().sub(pc.position).setZ(0).normalize().multiplyScalar(2);
        const spot = pc.position.clone().add(toward);
        spot.z = KotOR.GMViewport.getGroundZAt(spot.x, spot.y, pc.position.z);
        G.teleportObject(npc, spot);
      }, placed.npcs[0], playerNetIds[0]);
      try {
        return await gm.waitFor('an NPC to attack a player', (KotOR, npcIds, pcIds) => {
          const G = KotOR.GMManager;
          for (const id of npcIds) {
            const cre = G.netIdMap.get(id);
            const target = cre && (cre.combatData.lastAttackTarget || (cre.combatRound.action && cre.combatRound.action.target));
            if (target && pcIds.includes(target.gmNetId)) return `${cre.getName()} → ${target.getName()}`;
          }
          return false;
        }, SYNC_TIMEOUT, placed.npcs, playerNetIds);
      } catch (e) {
        // Why each NPC didn't pick a player
        const why = await gm.eval((KotOR, npcIds, pcIds) => {
          const G = KotOR.GMManager;
          const area = KotOR.GameState.module.area;
          return npcIds.map((id) => {
            const cre = G.netIdMap.get(id);
            return {
              id,
              inArea: area.creatures.includes(cre),
              autonomous: G.isAutonomousNpc(cre),
              busy: !!cre.combatRound.action || cre.combatRound.scheduledActionList.length,
              sight: cre.perceptionRange ? cre.getPerceptionRangePrimary() : 'none',
              aiTimer: G.npcAiTimer,
              players: pcIds.map((pid) => {
                const pc = G.netIdMap.get(pid);
                return { pid, d: +cre.position.distanceTo(pc.position).toFixed(1), hostile: cre.isHostile(pc), los: cre.hasLineOfSight(pc), inArea: area.creatures.includes(pc) };
              }),
            };
          });
        }, placed.npcs, playerNetIds);
        throw new CheckFailed(`${e.message}: ${JSON.stringify(why)}`);
      }
    });

    await must('Players fight the hostile NPC until it dies', async () => {
      const target = placed.npcs[0];
      // Record the combat visuals each player is shown from here on
      for (const p of players) {
        await p.eval((KotOR) => {
          const G = KotOR.GMManager;
          window.__gmE2eFx = [];
          const original = KotOR.GMReplication.applyFxEventOnClient.bind(KotOR.GMReplication);
          KotOR.GMReplication.applyFxEventOnClient = (event) => { window.__gmE2eFx.push(event); return original(event); };
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
              KotOR.GMPlayers.interceptInteraction(KotOR.GameState.getCurrentPlayer(), cre);
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
        hostRecords: await gm.eval((KotOR, ids) => ids.map((id) => KotOR.GMPlayers.getPlayerInventory(KotOR.GMManager.netIdMap.get(id)).map((e) => e.resRef)), playerNetIds),
        gmOwn: await gm.eval((KotOR) => KotOR.GameState.InventoryManager.inventory.map((i) => i.getEquippedRes() || i.getInventoryRes())),
        players: await Promise.all(players.map((p) => p.eval((KotOR) => KotOR.GameState.InventoryManager.inventory.map((i) => i.getEquippedRes() || i.getInventoryRes())))),
      });
      const before = await inventories();
      for (const list of [...before.hostRecords, before.gmOwn, ...before.players]) {
        expect(!NPC_LOOT.some((r) => list.includes(r)), `loot was already in an inventory before looting: ${JSON.stringify(list)}`);
      }

      // Player 1 uses the body, as a click on a dead creature does; the host shows them its contents
      const sent = await players[0].eval((KotOR, id) => KotOR.GMPlayers.interceptInteraction(KotOR.GameState.getCurrentPlayer(), KotOR.GMManager.netIdMap.get(id)), corpse);
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

    const peerOf = (netId) => gm.eval((KotOR, id) => {
      const peer = [...KotOR.GMNetworkManager.peers.values()].find((p) => p.controlledNetId === id);
      return peer ? peer.peerId : null;
    }, netId);
    const sheetOf = (p) => p.eval((KotOR) => {
      const me = KotOR.GameState.getCurrentPlayer();
      return { xp: me ? me.experience || 0 : -1, inventory: KotOR.GameState.InventoryManager.inventory.map((i) => i.getEquippedRes() || i.getInventoryRes()) };
    });

    await must('GM gives Player 2 XP and an item', async () => {
      const p2Peer = await peerOf(playerNetIds[1]);
      const before = await Promise.all(players.map(sheetOf));
      const given = await gm.eval((KotOR, peerId, xp, item) => [KotOR.GMPlayers.giveXP(peerId, xp), KotOR.GMPlayers.giveItem(peerId, item)], p2Peer, REWARD_XP, REWARD_ITEM);
      expect(given.every(Boolean), `giveXP / giveItem returned ${JSON.stringify(given)}`);
      await players[1].waitFor('the reward on our sheet', (KotOR, xp, item) => {
        const me = KotOR.GameState.getCurrentPlayer();
        const inv = KotOR.GameState.InventoryManager.inventory.map((i) => i.getEquippedRes() || i.getInventoryRes());
        return me && me.experience >= xp && inv.includes(item);
      }, SYNC_TIMEOUT, before[1].xp + REWARD_XP, REWARD_ITEM);
      await sleep(2000); // a sheet sync interval, in case anything leaked to Player 1
      const p1 = await sheetOf(players[0]);
      expect(p1.xp === before[0].xp && !p1.inventory.includes(REWARD_ITEM), `Player 1 also got the reward: ${JSON.stringify(p1)}`);
    });

    await must('GM asks Player 1 a question as an NPC', async () => {
      const p1Peer = await peerOf(playerNetIds[0]);
      const promptId = await gm.eval((KotOR, npcId, peerId) => KotOR.GMPlayers.askPlayers(KotOR.GMManager.netIdMap.get(npcId), 'Surrender, rebel?', ['Never!', 'Fine...'], peerId), placed.npcs[1], p1Peer);
      expect(promptId, 'askPlayers returned nothing');
      const shown = await players[0].waitFor('the question', (KotOR, id) => {
        const prompt = KotOR.GMNetworkManager.pendingPrompts.find((p) => p.promptId === id);
        return prompt ? `${prompt.speaker}: ${prompt.text}` : false;
      }, SYNC_TIMEOUT, promptId);
      expect(shown === 'E2E Guard 2: Surrender, rebel?', `Player 1 was shown "${shown}"`);
      const p2Saw = await players[1].eval((KotOR) => KotOR.GMNetworkManager.pendingPrompts.length);
      expect(p2Saw === 0, 'Player 2 was also asked');
      await players[0].eval((KotOR, id) => KotOR.GMNetworkManager.answerPrompt(id, 0), promptId);
      const replies = await gm.waitFor('Player 1\'s reply', (KotOR, id) => {
        const record = KotOR.GMPlayers.dmPrompts.get(id);
        return record && record.replies.length ? record.replies.map((r) => `${r.name}: ${record.prompt.options[r.choice]}`) : false;
      }, SYNC_TIMEOUT, promptId);
      return replies.join(', ');
    });

    await must('GM hides an NPC from players, then reveals it', async () => {
      const npc = placed.npcs[1];
      await gm.eval((KotOR, id) => KotOR.GMManager.setObjectHidden(KotOR.GMManager.netIdMap.get(id), true), npc);
      for (const p of players) {
        await p.waitFor('the NPC to disappear', (KotOR, id) => !KotOR.GMManager.netIdMap.has(id), SYNC_TIMEOUT, npc);
      }
      const hostStillHasIt = await gm.eval((KotOR, id) => KotOR.GMManager.netIdMap.has(id), npc);
      expect(hostStillHasIt, 'the GM lost the hidden NPC');
      await sleep(1500); // world ticks keep running; the NPC must stay gone
      for (const p of players) {
        const back = await p.eval((KotOR, id) => KotOR.GMManager.netIdMap.has(id), npc);
        expect(!back, `${p.label} got the hidden NPC back from a world update`);
      }
      await gm.eval((KotOR, id) => KotOR.GMManager.setObjectHidden(KotOR.GMManager.netIdMap.get(id), false), npc);
      for (const p of players) {
        await p.waitFor('the NPC to reappear', (KotOR, id) => KotOR.GMManager.netIdMap.has(id), SYNC_TIMEOUT, npc);
      }
    });

    await must('GM spawns an encounter', async () => {
      placed.encounter = await gm.eval(async (KotOR, spotSrc) => {
        const spot = eval(spotSrc);
        const p = spot(KotOR, 6, -6);
        return KotOR.GMSpawner.spawnEncounter({ presetIndex: 0, count: 3, spread: 2, factionId: 2, center: new window.THREE.Vector3(p.x, p.y, p.z) });
      }, spotNearEntry.toString());
      expect(placed.encounter.length === 3, `expected 3 creatures, got ${placed.encounter.length}`);
      for (const p of players) {
        await p.waitFor('the encounter', (KotOR, ids) => ids.every((id) => KotOR.GMManager.netIdMap.has(id)), SYNC_TIMEOUT, placed.encounter);
      }
      return placed.encounter.join(', ');
    });

    let savedSession = null;
    await must('GM saves the session', async () => {
      savedSession = await gm.eval((KotOR) => KotOR.GMSessions.saveSession('GM e2e save'));
      expect(savedSession, 'saveSession returned nothing');
      const creatures = savedSession.objects.filter((o) => o.kind === 'creature').length;
      const placeables = savedSession.objects.filter((o) => o.kind === 'placeable').length;
      expect(creatures === 5 && placeables === 2, `saved ${creatures} creatures and ${placeables} placeables, expected 5 and 2`);
      const byName = Object.fromEntries(savedSession.players.map((p) => [p.name, p]));
      expect(NPC_LOOT.every((r) => byName['E2E Player 1'].sheet.inventory.some((e) => e.resRef === r)), 'Player 1\'s saved inventory lacks the loot');
      expect(byName['E2E Player 2'].sheet.inventory.some((e) => e.resRef === REWARD_ITEM), 'Player 2\'s saved inventory lacks the reward item');
      return `${savedSession.objects.length} objects, ${savedSession.players.length} characters`;
    });

    await must(`GM moves everyone to ${FINAL_SCENE}`, async () => {
      // Count world ticks reaching each player from here on (shown in diagnostics if this step fails)
      for (const p of players) {
        await p.eval((KotOR) => {
          const G = KotOR.GMManager;
          window.__gmE2eTicks = { total: 0, withActors: 0, lastActorIds: [] };
          const original = KotOR.GMReplication.applyWorldTickOnClient.bind(KotOR.GMReplication);
          KotOR.GMReplication.applyWorldTickOnClient = (actors) => {
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
      const inventoriesBefore = await gm.eval((KotOR, ids) => ids.map((id) => KotOR.GMPlayers.getPlayerInventory(KotOR.GMManager.netIdMap.get(id)).length), playerNetIds);
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
          inventories: ids.map((id) => G.netIdMap.get(id) ? KotOR.GMPlayers.getPlayerInventory(G.netIdMap.get(id)).length : -1),
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

    await must('GM loads the saved session with players connected', async () => {
      expect(savedSession, 'no saved session to load');
      const expected = Object.fromEntries(savedSession.players.map((p) => [p.name, p.sheet]));
      const loaded = await gm.eval((KotOR, save) => KotOR.GMSessions.loadSession(save), savedSession);
      expect(loaded, 'loadSession returned false');
      await gm.waitFor(`${SECOND_SCENE} to load`, sceneReady, SCENE_TIMEOUT, SECOND_SCENE);

      // Players follow, keep control of their characters, and get their saved sheets back
      await Promise.all(players.map((p, i) => p.waitFor(`${SECOND_SCENE} with our saved character`, (KotOR, scene, myId, sheet) => {
        const GS = KotOR.GameState;
        const me = GS.getCurrentPlayer();
        const inv = GS.InventoryManager.inventory.map((it) => it.getEquippedRes() || it.getInventoryRes());
        return String(GS.module && GS.module.filename).toLowerCase() === scene && GS.module.readyToProcessEvents &&
          me && me.gmNetId === myId && me.experience === sheet.xp && sheet.inventory.every((e) => inv.includes(e.resRef));
      }, SCENE_TIMEOUT, SECOND_SCENE, playerNetIds[i], expected[`E2E Player ${i + 1}`])));

      // The placed objects are back, with their loot and factions, on the host and for both players
      const hostObjects = await gm.eval((KotOR) => {
        const G = KotOR.GMManager;
        const area = KotOR.GameState.module.area;
        const placedCreatures = area.creatures.filter((c) => c.gmSpawnConfig && !c.gmPlayerConfig);
        const placedProps = area.placeables.filter((p) => p.gmSpawnConfig);
        return {
          creatures: placedCreatures.map((c) => ({ id: c.gmNetId, name: c.getName(), faction: c.factionId, dead: c.isDead() })),
          props: placedProps.map((p) => ({ id: p.gmNetId, items: p.inventory.length })),
        };
      });
      expect(hostObjects.creatures.length === 5 && hostObjects.props.length === 2, `restored ${hostObjects.creatures.length} creatures and ${hostObjects.props.length} props, expected 5 and 2`);
      const guard1 = hostObjects.creatures.find((c) => c.name === 'E2E Guard 1');
      const guard2 = hostObjects.creatures.find((c) => c.name === 'E2E Guard 2');
      expect(guard1 && guard1.dead, `the killed guard should be restored dead: ${JSON.stringify(guard1)}`);
      expect(guard2 && guard2.faction === FACTION_HOSTILE, `the other guard should still be hostile: ${JSON.stringify(guard2)}`);
      expect(hostObjects.props.every((p) => p.items > 0), `restored props lost their loot: ${JSON.stringify(hostObjects.props)}`);
      const ids = [...hostObjects.creatures, ...hostObjects.props].map((o) => o.id);
      for (const p of players) {
        await p.waitFor('the restored objects', (KotOR, objIds) => objIds.every((id) => KotOR.GMManager.netIdMap.has(id)), SYNC_TIMEOUT, ids);
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

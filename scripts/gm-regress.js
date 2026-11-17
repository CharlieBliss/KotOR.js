/**
 * GM mode regression checks: the bugs found in play, each staged on purpose and checked on the GM's screen and a
 * player's, so a fix stays fixed. One boot of a GM and a player in Onderon's throne room (scripts/fixtures/
 * gm-throne-battle.json), the game running faster than real time, then short checks:
 *
 *   held pose              a creature the GM stuns looks held on the player's screen, and is let go with it
 *   held and killed        a creature killed while stunned or held falls (it kept the stun pose on the GM's side)
 *   shared effects         one beam and one impact a script applies to three creatures: each gets its own, and
 *                          none is left behind on either screen once it's over (stretched beams, frozen particles)
 *   passing                two walking head-on, one past someone standing, two together past someone: they step
 *                          round by their body size and arrive (they went metres out of their way, or stuck)
 *   crowded posts          guards sent back to the same post settle a step apart and stand still (they jostled
 *                          and turned on the spot after every fight)
 *   behaviour              the GM's AI runs its NPCs' behaviour (their own AI scripts stay quiet), and their
 *                          scripts run it again when the GM leaves an NPC to them
 *   rules                  a GM-run NPC's power still works: those scripts are rules, not behaviour
 *   loot window            a player's loot window doesn't pause the shared world
 *   player HUD             the player's own HUD is up and KotOR's combat panels are hidden
 *   target actions         the HUD offers what the target allows (Attack an enemy, Search a body, which stays
 *                          picked), shows where each power lands, and has the quick actions
 *   sets                   rooms of another area (KotOR II's Ebon Hawk) built into the scene: a creature walks
 *                          through them on their floor, and the player's screen gets the set, turned and removed
 *   helping powers         a player's helping power goes off out of combat; one the GM's machine refuses says why
 *   combat powers          a power queued while attacking goes off, Disable Droid is refused on a person, the
 *                          cast is raised, held and lowered, Burst of Speed doubles speed, only top feat ranks show
 *   rolls                  a player rolling from their sheet sees the result, on it and above it
 *   screens agree          GM and player agree on who is dead, and the dead lie down on both
 *   page errors            no uncaught errors on either screen
 *
 * Usage:  npm run test:gm-regress [-- --show] [-- --speed 3] [-- --only passing,loot]
 * Environment: GM_E2E_URL (default http://localhost:8080); GM_REGRESS_PROFILE, the browser profile (default
 * kotor-gm-regress), for running two at once. Starts `npm run dev` when nothing is serving it.
 * Exits non-zero when a check fails.
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { configureApp, createGameWindow, evalIn, waitFor, bootToMenu, setGameSpeed, sleep } = require('./lib/game-window');
const { createDevServer } = require('./lib/dev-server');
const { startGMRelayServer } = require('./gm-server.js');

const BASE_URL = (process.env.GM_E2E_URL || 'http://localhost:8080').replace(/\/$/, '');
const SHOW = process.argv.includes('--show');
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const SPEED = Math.max(1, Math.min(4, Number(arg('speed')) || 3));
const ONLY = (arg('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const PORT = 7900 + Math.floor(Math.random() * 50);
const WS_URL = `ws://localhost:${PORT}`;
const PLAN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'gm-throne-battle.json'), 'utf8'));

// Its own browser profile; two runs at once (say, two sessions in one checkout) each need their own
configureApp(app, process.env.GM_REGRESS_PROFILE || 'kotor-gm-regress');

const t0 = Date.now();
const log = (msg) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${msg}`);
const results = [];
class CheckFailed extends Error {}
const expect = (cond, message) => { if (!cond) throw new CheckFailed(message); };

async function check(id, name, fn) {
  if (ONLY.length && !ONLY.includes(id)) return;
  const start = Date.now();
  try {
    const details = await fn();
    results.push({ id, name, ok: true });
    log(`✔ ${name} (${((Date.now() - start) / 1000).toFixed(1)}s)${details ? ' — ' + details : ''}`);
  } catch (e) {
    results.push({ id, name, ok: false, error: e.message });
    log(`✘ ${name} (${((Date.now() - start) / 1000).toFixed(1)}s) — ${e.message}`);
  }
}

/** Helpers put in each page once: finding the cast, staging them, reading what the screen shows */
function installHelpers(K) {
  const THREE = window.THREE;
  const R = window.__R = {};
  R.creatures = () => [...K.GMManager.netIdMap.values()].filter((o) => o && K.GMObjectKind.isCreature(o));
  R.named = (re) => R.creatures().filter((o) => new RegExp(re).test(o.getName()));
  R.byNetId = (id) => K.GMManager.netIdMap.get(id);
  R.anim = (o) => String(o?.model?.animationManager?.currentAnimation?.name || '').toLowerCase();
  R.lyingDown = (o) => /^c?(die|dead)\d?$/.test(R.anim(o));
  // Models of visual effects still hung on a creature (with something left in them to draw)
  R.effectModels = (o) => {
    const out = [];
    o?.model?.traverse?.((n) => {
      if (n === o.model || !/^v_|^fx_/i.test(n.name || '')) return;
      if (n.parent && /^v_|^fx_/i.test(n.parent.name || '')) return;
      let drawn = false;
      n.traverse((c) => { if ((c.isMesh || c.type === 'Points') && c.visible) drawn = true; });
      if (drawn) out.push(n.name);
    });
    return out;
  };
  R.visualEffects = (o) => (o?.effects || []).filter((e) => e && (e.type === K.GameEffectType.EffectBeam || e.type === K.GameEffectType.EffectVisualEffect));
  if (K.GMManager.isGMUser()) {
    // The stage: where Jedi Guardian 1 started, an open stretch of floor down the hall from it
    const g = R.named('^Jedi Guardian 1$')[0];
    R.anchor = g ? g.position.clone() : new THREE.Vector3();
    R.at = (dx, dy) => new THREE.Vector3(R.anchor.x + dx, R.anchor.y + dy, R.anchor.z);
    R.onlyThese = (keep) => { for (const o of R.creatures()) K.GMManager.setObjectHidden(o, !keep.includes(o)); };
    R.put = (o, dx, dy, facing = 0) => { o.clearAllActions(); o.position.copy(R.at(dx, dy)); o.setFacing(facing, true); };
    R.walk = (o, dx, dy, run = false) => {
      const p = R.at(dx, dy);
      const act = new K.GameState.ActionFactory.ActionMoveToPoint();
      act.setParameter(0, 2, p.x); act.setParameter(1, 2, p.y); act.setParameter(2, 2, p.z);
      act.setParameter(3, 3, K.GameState.module.area.id); act.setParameter(4, 3, 0xFFFFFFFF); act.setParameter(5, 1, run ? 1 : 0);
      act.setParameter(6, 2, 0.5); act.setParameter(7, 1, 0); act.setParameter(8, 2, 30);
      o.actionQueue.add(act);
    };
    R.track = (list, ms) => new Promise((resolve) => {
      const tracks = list.map(() => []);
      const id = setInterval(() => list.forEach((o, i) => tracks[i].push([o.position.x - R.anchor.x, o.position.y - R.anchor.y, o.rotation.z])), 100);
      setTimeout(() => { clearInterval(id); resolve(tracks); }, ms);
    });
  }
  return true;
}

async function run() {
  const devServer = createDevServer({ baseUrl: BASE_URL, log });
  await devServer.ensure();
  startGMRelayServer({ port: PORT });
  const gm = createGameWindow({ show: SHOW, title: 'GM regress — GM' });
  const pl = createGameWindow({ show: SHOW, title: 'GM regress — player' });
  const windows = [gm, pl];
  try {
    log('Booting a GM and a player (KotOR II)...');
    const url = `${BASE_URL}/game/?key=tsl`;
    await Promise.all(windows.map((w) => bootToMenu(w, url, { timeout: 300000 })));
    await evalIn(gm, (K) => { K.GameState.EnterGMMode(); return true; });
    await waitFor(gm, 'GM mode', (K) => !!(K.GameState.module && K.GameState.module.readyToProcessEvents && K.GMManager.active && !K.GameState.loadingTextures), 120000);
    await evalIn(gm, (K, ws) => K.GMNetworkManager.hostSession(ws, 'regress'), WS_URL);
    await waitFor(gm, 'hosting', (K) => K.GMNetworkManager.role === 'host' && K.GMNetworkManager.connected, 20000);
    await evalIn(gm, async (K, plan) => { await K.GMScenePlan.import(plan); return true; }, PLAN);
    await waitFor(gm, 'the throne room scene', (K) => !!(K.GameState.module && K.GameState.module.readyToProcessEvents && !K.GameState.loadingTextures && K.GMScenePlan.active), 150000);
    await evalIn(gm, (K) => { K.GMManager.npcAiEnabled = false; return true; });
    await evalIn(pl, (K, ws) => {
      const G = K.GMManager, preset = G.PLAYER_PRESETS[0];
      K.GameState.gmMode = true; G.active = true;
      K.GMNetworkManager.joinSession(ws, 'Hero', { name: 'Hero', appearanceId: preset.appearanceId, classId: preset.classId, character: { ...K.GMCharacters.blank(preset), name: 'Hero' } });
      return true;
    }, WS_URL);
    await waitFor(pl, 'the player to join', (K) => { const N = K.GMNetworkManager, me = K.GameState.getCurrentPlayer(); return !!(N.assignedActorNetId && me && me.gmNetId === N.assignedActorNetId && K.GameState.module && K.GameState.module.readyToProcessEvents); }, 150000);
    await sleep(2000);
    for (const w of windows) { await setGameSpeed(w, SPEED); await evalIn(w, installHelpers); }
    log(`Ready (game at ${SPEED}x). Checks:`);
    const pause = (gameSeconds) => sleep((gameSeconds * 1000) / SPEED);

    await check('passing', 'Walkers step round each other by body size and arrive', async () => {
      const cases = [
        ['head-on', { headOn: true }],
        ['past one standing', { standing: true }],
        ['two together past one standing', { group: true }],
      ];
      const out = [];
      for (const [label, setup] of cases) {
        await evalIn(gm, (K, s) => {
          const R = window.__R, [a, b, c] = R.named('^Telos Security');
          R.onlyThese(s.group ? [a, b, c] : [a, b]);
          R.put(a, 0, 4);
          if (s.headOn) { R.put(b, 0.3, 18, Math.PI); R.walk(a, 0, 18); R.walk(b, 0.3, 4); }
          else if (s.standing) { R.put(b, 0.6, 11); R.walk(a, 0, 18); }
          else { R.put(b, 0.9, 4); R.put(c, 0.45, 11); R.walk(a, 0, 18); R.walk(b, 0.9, 18); }
          window.__walkers = s.standing ? [a] : [a, b];
          window.__tracking = R.track(window.__walkers, 12000 / s.speed);
          return true;
        }, { ...setup, speed: SPEED });
        const r = await evalIn(gm, async () => {
          const tracks = await window.__tracking;
          return tracks.map((t) => {
            let walked = 0, side = 0;
            for (let i = 1; i < t.length; i++) walked += Math.hypot(t[i][0] - t[i - 1][0], t[i][1] - t[i - 1][1]);
            for (const p of t) side = Math.max(side, Math.abs(p[0] - t[0][0]));
            const straight = Math.hypot(t[t.length - 1][0] - t[0][0], t[t.length - 1][1] - t[0][1]);
            return { walked: +walked.toFixed(1), straight: +straight.toFixed(1), side: +side.toFixed(2) };
          });
        });
        for (const w of r) {
          expect(w.straight >= 12.5, `${label}: didn't arrive (got ${w.straight} m of 14)`);
          expect(w.side <= 1.2, `${label}: went ${w.side} m out of its way`);
          expect(w.walked <= w.straight * 1.3, `${label}: walked ${w.walked} m to cover ${w.straight} m`);
        }
        out.push(`${label} ≤${Math.max(...r.map((w) => w.side))} m aside`);
      }
      return out.join(', ');
    });

    await check('posts', 'Guards sent back to one post settle a step apart and stand still', async () => {
      await evalIn(gm, (K) => {
        const R = window.__R, guards = R.named('^Telos Security');
        R.onlyThese(guards);
        const post = R.at(0, 10);
        guards.forEach((g, i) => {
          R.put(g, i - 1, 3);
          g.gmOrder = { kind: 'guard', point: { x: post.x, y: post.y, z: post.z }, radius: 8 };
          g.gmOrderProgress = undefined;
        });
        K.GMManager.npcAiEnabled = true;
        return true;
      });
      await sleep(9000);
      const r = await evalIn(gm, async (K) => {
        const R = window.__R, guards = R.named('^Telos Security');
        const tracks = await R.track(guards, 2000);
        K.GMManager.npcAiEnabled = false;
        const turn = tracks.map((t) => { let s = 0; for (let i = 1; i < t.length; i++) { let d = t[i][2] - t[i - 1][2]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; s += Math.abs(d); } return +s.toFixed(2); });
        const moved = tracks.map((t) => +Math.hypot(t[t.length - 1][0] - t[0][0], t[t.length - 1][1] - t[0][1]).toFixed(2));
        let closest = Infinity;
        for (let i = 0; i < guards.length; i++) for (let j = i + 1; j < guards.length; j++) closest = Math.min(closest, guards[i].position.distanceTo(guards[j].position));
        const walking = guards.filter((g) => K.GMNpcOrders.isMoving(g)).map((g) => g.getName());
        const fromPost = guards.map((g) => +Math.hypot(g.position.x - R.at(0, 10).x, g.position.y - R.at(0, 10).y).toFixed(1));
        return { turn, moved, closest: +closest.toFixed(2), walking, fromPost };
      });
      expect(!r.walking.length, `still walking after 9 s: ${r.walking.join(', ')}`);
      // Bodies are about 0.4 m across: closer than 0.7 m they're standing in each other
      expect(r.closest >= 0.7, `two of them stand on each other, ${r.closest} m apart`);
      expect(r.turn.every((t) => t < 0.5) && r.moved.every((m) => m < 0.3), `not standing still: turned ${r.turn} rad, moved ${r.moved} m in 2 s`);
      expect(r.fromPost.every((d) => d < 4), `settled too far from the post: ${r.fromPost} m`);
      return `closest ${r.closest} m apart, ${r.fromPost.join('/')} m from the post`;
    });

    await check('behaviour', "The GM's AI runs its NPCs' behaviour; their own scripts only when the GM leaves them to it", async () => {
      // Count the heartbeat script's runs (every 6 s of game time) for an NPC under the GM's AI, then left to its scripts
      const count = async (scripted) => {
        await evalIn(gm, (K, s) => {
          const R = window.__R, npc = R.named('^Telos Security 1$')[0];
          R.onlyThese([npc]);
          K.GMManager.npcAiEnabled = true;
          K.GMCombatAI.setScripted(npc, s);
          const script = npc.scripts[K.ModuleObjectScript.CreatureOnHeartbeat];
          window.__beats = 0;
          if (script && !script.__counted) {
            const run = script.run;
            script.run = function () { window.__beats++; return run.apply(this, arguments); };
            script.__counted = true;
          }
          return !!script;
        }, scripted);
        await pause(13);
        return evalIn(gm, () => window.__beats);
      };
      const hasScript = await evalIn(gm, (K) => !!window.__R.named('^Telos Security 1$')[0].scripts[K.ModuleObjectScript.CreatureOnHeartbeat]);
      expect(hasScript, 'Telos Security 1 has no heartbeat script to count');
      const underAi = await count(false);
      const ownScripts = await count(true);
      await evalIn(gm, (K) => { K.GMManager.npcAiEnabled = false; K.GMCombatAI.setScripted(window.__R.named('^Telos Security 1$')[0], false); return true; });
      expect(underAi === 0, `its heartbeat script ran ${underAi} times under the GM's AI`);
      expect(ownScripts >= 1, `left to its own scripts, its heartbeat script didn't run (${ownScripts})`);
      return `heartbeats under the GM AI: ${underAi}, on its own scripts: ${ownScripts}`;
    });

    await check('rules', "A GM-run NPC's powers still work (their scripts are the rules, not behaviour)", async () => {
      const r = await evalIn(gm, (K) => {
        const R = window.__R, caster = R.named('^Dark Jedi Master 1$')[0], target = R.named('^Telos Security 2$')[0];
        R.onlyThese([caster, target]);
        R.put(caster, 0, 6, 0); R.put(target, 0, 10, Math.PI);
        K.GMManager.npcAiEnabled = true;
        const rows = K.GameState.TwoDAManager.datatables.get('spells').rows;
        const id = Number(Object.keys(rows).find((k) => rows[k].label === 'FORCE_POWER_STUN'));
        window.__ruleTarget = target;
        window.__ruleBefore = target.effects.length;
        new K.TalentSpell(id).useTalentOnObject(target, caster);
        return { id };
      });
      expect(r.id >= 0, 'no Stun power in spells.2da');
      await pause(6);
      const after = await evalIn(gm, (K) => {
        const t = window.__ruleTarget;
        K.GMManager.npcAiEnabled = false;
        return { effects: t.effects.map((e) => e.type), stunned: !!(t.isStunned() || t.isParalyzed() || t.isDebilitated()) };
      });
      expect(after.stunned || after.effects.length > 0, `the power's script did nothing to its target (effects: ${after.effects.join(',') || 'none'})`);
      return after.stunned ? 'Stun held its target' : `target got effects ${after.effects.join(',')} (it may have resisted)`;
    });

    await check('effects', 'A shared beam and impact: each creature its own, nothing left on either screen', async () => {
      const r = await evalIn(gm, (K) => {
        const R = window.__R, caster = R.named('^Dark Jedi Master 1$')[0], targets = R.named('^Telos Security');
        R.onlyThese([caster, ...targets]);
        // Its own fight held off: the Dark Jedi healing itself left a cure visual this check took for a stuck one
        window.__aiWas = K.GMManager.npcAiEnabled; K.GMManager.npcAiEnabled = false;
        R.put(caster, 4, 8, Math.PI / 2);
        targets.forEach((t, i) => R.put(t, -1 + i, 12));
        const F = K.GameState.GameEffectFactory;
        // As a power's script does: one effect value, applied to everyone it hits
        const beam = new F.EffectBeam();
        beam.setInt(0, 2038); beam.setInt(1, 0); beam.setInt(2, 0); beam.setObject(0, caster);
        beam.setDurationType(1); beam.setDuration(1.5); beam.initialize();
        const impact = new F.EffectVisualEffect();
        impact.setInt(0, 1004); impact.setDurationType(0); impact.initialize();
        for (const t of targets) { t.addEffect(beam); t.addEffect(impact); }
        const beams = targets.map((t) => t.effects.find((e) => e.type === K.GameEffectType.EffectBeam));
        return { targets: targets.map((t) => t.gmNetId), caster: caster.gmNetId, own: new Set(beams.filter(Boolean)).size };
      });
      expect(r.own === 3, `three targets hold ${r.own} distinct beam(s): one effect shared between them`);
      await pause(10);
      const left = async (w) => evalIn(w, (K, ids) => {
        const R = window.__R;
        return ids.map(R.byNetId).filter(Boolean).flatMap((o) => [
          ...R.visualEffects(o).map((e) => `${o.getName()}: effect ${e.getInt(0)}`),
          ...R.effectModels(o).map((n) => `${o.getName()}: model ${n}`),
        ]);
      }, [...r.targets, r.caster]);
      const [g, p] = [await left(gm), await left(pl)];
      await evalIn(gm, (K) => { K.GMManager.npcAiEnabled = window.__aiWas; return true; });
      expect(!g.length, `left on the GM's screen: ${g.join('; ')}`);
      expect(!p.length, `left on the player's screen: ${p.join('; ')}`);
    });

    await check('held', 'A creature the GM stuns looks held on the player\'s screen, and is let go with it', async () => {
      const id = await evalIn(gm, (K) => {
        const R = window.__R, [o] = R.named('^Dark Jedi Master 2$');
        R.onlyThese([o]);
        R.put(o, 0, 8);
        const e = new K.GameState.GameEffectFactory.EffectSetState();
        e.setInt(0, 5); e.setDurationType(1); e.setDuration(60); e.initialize();
        o.addEffect(e);
        window.__heldEffect = e;
        return o.gmNetId;
      });
      await pause(2);
      const read = (w) => evalIn(w, (K, netId) => { const o = window.__R.byNetId(netId); return { held: !!o?.isParalyzed?.(), anim: window.__R.anim(o) }; }, id);
      const during = await read(pl);
      expect(during.held && /paraly/.test(during.anim), `while held, the player's copy is held: ${during.held}, showing ${during.anim || 'nothing'}`);
      await evalIn(gm, (K, netId) => { window.__R.byNetId(netId).removeEffect(window.__heldEffect); return true; }, id);
      await pause(2);
      const after = await read(pl);
      expect(!after.held && !/paraly/.test(after.anim), `let go, the player's copy is still held: ${after.held}, showing ${after.anim}`);
      return `held: ${during.anim}; let go: ${after.anim}`;
    });

    await check('falls', 'Creatures killed while stunned or held fall, on both screens', async () => {
      const ids = await evalIn(gm, (K) => {
        const R = window.__R, [a, b] = R.named('^Sith Assassin');
        R.onlyThese([a, b]);
        R.put(a, 3, 6); R.put(b, -3, 6);
        [[a, 4], [b, 5]].forEach(([o, state]) => {
          const e = new K.GameState.GameEffectFactory.EffectSetState();
          e.setInt(0, state); e.setDurationType(1); e.setDuration(30); e.initialize();
          o.addEffect(e);
        });
        return [a.gmNetId, b.gmNetId];
      });
      await pause(1.5);
      await evalIn(gm, (K, list) => { for (const id of list) K.GMManager.killObject(window.__R.byNetId(id)); return true; }, ids);
      await pause(4);
      const read = (w) => evalIn(w, (K, list) => list.map((id) => { const o = window.__R.byNetId(id); return o ? `${o.getName()}: ${o.isDead() ? 'dead' : 'alive'}, ${window.__R.anim(o) || 'no animation'}` : `${id}: missing`; }), ids);
      const [g, p] = [await read(gm), await read(pl)];
      const down = (lines) => lines.every((l) => /dead, c?(die|dead)/.test(l));
      expect(down(g), `GM's screen: ${g.join('; ')}`);
      expect(down(p), `player's screen: ${p.join('; ')}`);
    });

    await check('loot', "A player's loot window doesn't pause the shared world", async () => {
      const r = await evalIn(pl, async (K) => {
        const m = K.GameState.module;
        let ticks = 0, held = 0;
        const tick = m.tick, tickPaused = m.tickPaused;
        m.tick = function () { ticks++; return tick.apply(this, arguments); };
        m.tickPaused = function () { held++; return tickPaused.apply(this, arguments); };
        const menu = K.GameState.MenuManager.MenuContainer;
        menu.open();
        await new Promise((res) => setTimeout(res, 1500));
        menu.close();
        m.tick = tick; m.tickPaused = tickPaused;
        const autoPaused = K.GameState.AutoPauseManager.SignalAutoPauseEvent(0);
        return { ticks, held, autoPaused, state: K.GameState.State };
      });
      expect(r.ticks > 20 && r.held === 0, `with the loot window open the world ticked ${r.ticks} times and held ${r.held}`);
      expect(!r.autoPaused && r.state !== 2, 'auto-pause still pauses a shared world');
    });

    await check('hud', "The player's HUD is up and KotOR's combat panels are hidden", async () => {
      const r = await evalIn(pl, (K) => {
        const o = K.GameState.MenuManager.InGameOverlay;
        const shown = (n) => !!(o[n] && o[n].widget && o[n].widget.visible);
        return {
          hud: !!document.querySelector('.gm-player-hud'), slots: document.querySelectorAll('.gm-hud-bar-slots .gm-hud-slot').length,
          kotor: ['BTN_ACTION0', 'BTN_TARGET0', 'LBL_QUEUE0', 'LBL_CHAR1'].filter(shown),
        };
      });
      expect(r.hud && r.slots === 9, `HUD up: ${r.hud}, ${r.slots} slots`);
      expect(!r.kotor.length, `KotOR's panels still showing: ${r.kotor.join(', ')}`);
    });

    await check('target-actions', 'The HUD offers what the target allows, shows where powers land, and has the quick actions', async () => {
      // A living enemy and a body near the player, for the player to target
      const ids = await evalIn(gm, (K) => {
        const R = window.__R, [foe, body] = R.named('^Sith Trooper');
        const hero = K.GMManager.getPlayerCharacters()[0];
        R.onlyThese([foe, body, hero]);
        for (const [o, dx] of [[foe, 3], [body, -3]]) { o.clearAllActions(); o.position.set(hero.position.x + dx, hero.position.y + 6, hero.position.z); }
        if (!body.isDead()) K.GMManager.killObject(body);
        return [foe.gmNetId, body.gmNetId];
      });
      await pause(2);
      const read = (netId) => evalIn(pl, (K, id) => {
        const o = window.__R.byNetId(id);
        K.GMPlayerHud.select(o);
        return new Promise((res) => setTimeout(() => res({
          primary: (document.querySelector('.gm-hud-action.primary') || {}).innerText || '',
          lands: [...document.querySelectorAll('.gm-hud-slot .gm-hud-lands')].map((c) => c.innerText),
          target: K.GameState.CursorManager.selectedObject === o,
          quick: [...document.querySelectorAll('.gm-hud-quick button')].map((b) => b.innerText.replace(/\s+/g, ' ')),
        }), 600));
      }, netId);
      const foe = await read(ids[0]);
      expect(/Attack/.test(foe.primary), `an enemy's main action: ${foe.primary || 'none'}`);
      expect(!foe.lands.length || foe.lands.every((t) => /Target|You|Ally|Droids only|Jedi only/.test(t)), `with an enemy targeted, slots land on: ${foe.lands.join(', ')}`);
      expect(['Sheet', 'Skills', 'Items', 'Chat'].every((w) => foe.quick.some((q) => q.includes(w))), `quick actions: ${foe.quick.join(', ')}`);
      const body = await read(ids[1]);
      expect(body.target, 'picking a body moved the target off it (to the next enemy)');
      expect(/Search/.test(body.primary), `a body's main action: ${body.primary || 'none'}`);
      return `enemy: ${foe.primary.replace(/\s+/g, ' ')}, body: ${body.primary.replace(/\s+/g, ' ')}`;
    });

    await check('sets', "A room set from another area (the Ebon Hawk) is walked through, and players get it, moved and removed", async () => {
      // KotOR II's Ebon Hawk, put down well away from the throne room (nothing of the hall under it)
      const placed = await evalIn(gm, async (K) => {
        const R = window.__R, at = R.at(400, 0);
        const set = await K.GMSetPieces.place({ module: '003ebo' }, at, 0);
        if (!set) return { error: 'the set did not load' };
        const [walker] = R.named('^Telos Security');
        R.onlyThese([walker]);
        walker.clearAllActions();
        walker.position.copy(set.position);
        walker.collisionManager.findWalkableFace();
        // One of the ship's own path points, in another of its rooms, 10-22 m away
        let target = null, best = 0;
        for (const p of set.pathPoints) {
          const floor = set.floorOf(p.vector), d = p.vector.distanceTo(set.position);
          if (floor && floor.room !== set.floorOf(set.position)?.room && d > best && d >= 10 && d <= 22) { best = d; target = p.vector.clone(); }
        }
        window.__set = { id: set.id, walker, target };
        const p = target;
        const act = new K.GameState.ActionFactory.ActionMoveToPoint();
        act.setParameter(0, 2, p.x); act.setParameter(1, 2, p.y); act.setParameter(2, 2, p.z);
        act.setParameter(3, 3, K.GameState.module.area.id); act.setParameter(4, 3, 0xFFFFFFFF); act.setParameter(5, 1, 1);
        act.setParameter(6, 2, 0.5); act.setParameter(7, 1, 0); act.setParameter(8, 2, 30);
        walker.clearAllActions(); walker.actionQueue.add(act);
        window.__setFloors = [];
        window.__setTrack = setInterval(() => window.__setFloors.push(walker.room?.setPiece === set ? walker.room.roomName : 'off'), 100);
        return { id: set.id, rooms: set.rooms.length, points: set.pathPoints.length, startRoom: walker.room?.roomName, onSet: walker.room?.setPiece === set, distance: +best.toFixed(1) };
      });
      expect(!placed.error, placed.error);
      expect(placed.onSet, `the walker put in the set stands on ${placed.startRoom || 'nothing'}, not the set's floor`);
      // Until it arrives or gives up (its move ends)
      await waitFor(gm, 'the walk through the set', () => { const { walker, target } = window.__set; return walker.position.distanceTo(target) <= 1.5 || !walker.actionQueue?.length; }, 30000).catch(() => undefined);
      const walked = await evalIn(gm, (K) => {
        clearInterval(window.__setTrack);
        const { walker, target } = window.__set;
        const floors = window.__setFloors;
        return { left: +walker.position.distanceTo(target).toFixed(2), rooms: [...new Set(floors)], off: floors.filter((f) => f === 'off').length, saved: (K.GMSessions.buildSessionSave('regress').sets || []).length };
      });
      expect(walked.left <= 1.5, `the walker stopped ${walked.left} m short in the set (rooms: ${walked.rooms.join(', ')})`);
      expect(!walked.off, `the walker left the set's floor ${walked.off} time(s) on the way`);
      expect(walked.rooms.length >= 2, `the walker stayed in one room: ${walked.rooms.join(', ')}`);
      expect(walked.saved === 1, `a session save holds ${walked.saved} sets`);

      // The player's machine has it where the GM put it, and sees the walker on its floor
      const walkerId = await evalIn(gm, () => window.__set.walker.gmNetId);
      const readPlayer = () => evalIn(pl, (K, id, walkerId) => {
        const set = K.GMSetPieces.get(id), walker = window.__R.byNetId(walkerId);
        return set ? { rooms: set.rooms.length, x: set.position.x, y: set.position.y, yaw: set.yaw, walkerOnSet: walker?.room?.setPiece === set } : null;
      }, placed.id, walkerId);
      await waitFor(pl, "the set on the player's screen", (K, id) => !!K.GMSetPieces.get(id), 30000, placed.id);
      await pause(1);
      const seen = await readPlayer();
      const gmSet = await evalIn(gm, (K, id) => { const s = K.GMSetPieces.get(id); return { x: s.position.x, y: s.position.y }; }, placed.id);
      expect(seen.rooms === placed.rooms, `the player's set has ${seen.rooms} rooms, the GM's ${placed.rooms}`);
      expect(Math.hypot(seen.x - gmSet.x, seen.y - gmSet.y) < 0.01, "the player's set isn't where the GM's is");
      expect(seen.walkerOnSet, "on the player's screen the walker isn't on the set's floor");

      // Turned, then removed: the player's follows
      await evalIn(gm, async (K, id) => { await K.GMSetPieces.move(id, { turnBy: -Math.PI / 2 }); return true; }, placed.id);
      await waitFor(pl, "the set turned on the player's screen", (K, id) => Math.abs((K.GMSetPieces.get(id)?.yaw ?? 0) + Math.PI / 2) < 1e-3, 15000, placed.id);
      await evalIn(gm, async (K, id) => {
        const R = window.__R, { walker } = window.__set;
        await K.GMSetPieces.remove(id);
        K.GMManager.teleportObject(walker, R.at(0, 4));
        for (const o of R.creatures()) K.GMManager.setObjectHidden(o, false);
        return true;
      }, placed.id);
      await waitFor(pl, "the set removed on the player's screen", (K, id) => !K.GMSetPieces.get(id), 15000, placed.id);
      return `${placed.rooms} rooms, walked ${placed.distance} m through ${walked.rooms.length} rooms to ${walked.left} m; mirrored, turned and removed on the player's screen`;
    });

    await check('helping-powers', "A player's helping power goes off out of combat; one the GM's machine refuses says why", async () => {
      // The GM gives the player's character Burst of Speed and the Force for it; their sheet brings it over
      await evalIn(gm, (K) => {
        const h = K.GMManager.getPlayerCharacters()[0];
        // Up and alone, whatever earlier checks did to them (a trooper left beside them fights on its own scripts)
        for (const o of window.__R.creatures()) if (o !== h) K.GMManager.setObjectHidden(o, true);
        if (h.isDead()) K.GMPlayers.revivePlayer(h);
        const rows = K.GameState.TwoDAManager.datatables.get('spells').rows;
        const id = Number(Object.keys(rows).find((k) => rows[k].label === 'FORCE_POWER_SPEED_BURST'));
        if (!h.getSpells().some((s) => s.id === id)) h.classes[0].addSpell(new K.TalentSpell(id));
        h.maxForcePoints = Math.max(h.maxForcePoints || 0, 100); h.forcePoints = h.maxForcePoints; h.currentForce = h.maxForcePoints;
        h.combatData.combatState = false; h.excitedDuration = 0;
        return true;
      });
      await waitFor(pl, 'the helping power on the player\'s sheet', (K) => K.GMPlayerHud.abilities().some((x) => x.kind === 'power' && x.aim !== 'enemy' && x.usable), 15000);
      const before = await evalIn(gm, (K) => { const h = K.GMManager.getPlayerCharacters()[0]; return { fp: h.getFP(), combat: !!h.combatData.combatState }; });
      const sent = await evalIn(pl, (K) => {
        const a = K.GMPlayerHud.abilities().find((x) => x.kind === 'power' && x.aim !== 'enemy' && x.usable);
        if (!a) return null;
        const r = K.GMPlayerHud.use(a);
        return { name: a.name, ok: r.ok };
      });
      expect(sent && sent.ok, `the player has no helping power to use, or it wasn't sent: ${JSON.stringify(sent)}`);
      await pause(4);
      const after = await evalIn(gm, (K) => K.GMManager.getPlayerCharacters()[0].getFP());
      expect(!before.combat, 'the player was in combat: this checks out of combat');
      if (!(after < before.fp)) {
        // What the character was doing instead, to say why
        const state = await evalIn(gm, (K) => {
          const h = K.GMManager.getPlayerCharacters()[0], round = h.combatRound;
          return {
            queue: (h.actionQueue || []).map((a) => a.type), roundAction: round.action ? round.action.actionType : null,
            scheduled: round.scheduledActionList.length, paused: !!round.roundPaused, started: !!round.roundStarted,
            hostDriven: !!h.gmHostDriven, hidden: !!h.gmHidden, dead: h.isDead(), debilitated: h.isDebilitated(), held: K.GMManager.worldHeld(),
            log: K.GMLog.recent ? K.GMLog.recent(6) : undefined,
          };
        });
        const notice = await evalIn(pl, (K) => K.GMPlayerHud.lastNotice && K.GMPlayerHud.lastNotice.text);
        throw new CheckFailed(`${sent.name} spent no Force on the GM's machine (${before.fp} → ${after}); the character: ${JSON.stringify(state)}; told the player: ${notice || 'nothing'}`);
      }
      // Asking for a power the character doesn't know: the GM's machine says so to the player
      await evalIn(pl, (K) => { K.GMPlayerHud.lastNotice = null; K.GMNetworkManager.sendIntent('ability', undefined, { ability: 'spell', abilityId: 99999 }); return true; });
      await sleep(1500);
      const notice = await evalIn(pl, (K) => K.GMPlayerHud.lastNotice && K.GMPlayerHud.lastNotice.text);
      expect(/know that power/.test(notice || ''), `the player wasn't told why a power was refused (notice: ${notice || 'none'})`);
      return `${sent.name}: Force ${before.fp} → ${after}; refusal: "${notice}"`;
    });

    await check('combat-powers', "A player's power survives their attack, waits for a valid target, is cast in full, and does what it says", async () => {
      // One trooper beside the player; the player has Stun, Disable Droid, Burst of Speed, Flurry and Improved Flurry
      const foeId = await evalIn(gm, (K) => {
        const G = K.GMManager, h = G.getPlayerCharacters()[0], R = window.__R;
        if (h.isDead()) K.GMPlayers.revivePlayer(h);
        const foe = R.named('Sith Trooper').find((o) => !o.isDead()) || R.named('Sith Trooper')[0];
        for (const o of R.creatures()) if (o !== h) G.setObjectHidden(o, o !== foe);
        if (foe.isDead()) K.GMPlayers.revivePlayer?.(foe);
        G.teleportObject(foe, new window.THREE.Vector3(h.position.x + 1.5, h.position.y + 1.5, h.position.z));
        G.setCreatureHP(foe, 400, 400);
        const spells = K.GameState.TwoDAManager.datatables.get('spells').rows;
        for (const label of ['FORCE_POWER_STUN', 'FORCE_POWER_DROID_DISABLE', 'FORCE_POWER_SPEED_BURST']) {
          const id = Number(Object.keys(spells).find((k) => spells[k].label === label));
          if (id >= 0 && !h.getSpells().some((s) => s.id === id)) h.classes[0].addSpell(new K.TalentSpell(id));
        }
        const feats = K.GameState.TwoDAManager.datatables.get('feat').rows;
        // Flurry and Improved Flurry (CombatFeatType)
        for (const id of [11, 91].filter((i) => feats[i])) {
          if (id >= 0) { if (!h.getHasFeat(id)) h.addFeat(id); window.__flurry = (window.__flurry || 0) + 1; }
        }
        window.__flurry = window.__flurry || 0;
        h.maxForcePoints = 300; h.forcePoints = 300; h.currentForce = 300;
        G.npcAiEnabled = false;
        return foe.gmNetId;
      });
      await waitFor(pl, "the powers on the player's sheet", (K) => ['Stun', 'Disable Droid'].every((n) => K.GMPlayerHud.abilities().some((a) => a.name === n)), 15000);

      // Only the best rank of a feat chain
      expect(await evalIn(gm, () => window.__flurry) === 2, 'feat.2da has no FEAT_FLURRY / FEAT_IMPROVED_FLURRY to test with');
      const feats = await evalIn(pl, (K) => K.GMPlayerHud.abilities().filter((a) => a.kind === 'feat').map((a) => a.name));
      expect(!feats.includes('Flurry'), `the bar offers Flurry beside its better rank: ${feats.join(', ')}`);

      // Disable Droid on a person: not offered, and the GM's machine refuses it if sent anyway
      const droid = await evalIn(pl, (K, id) => {
        const foe = K.GMManager.netIdMap.get(id); K.GMPlayerHud.select(foe);
        const a = K.GMPlayerHud.abilities().find((x) => x.name === 'Disable Droid');
        const landing = K.GMPlayerHud.landsOn(a);
        const r = K.GMPlayerHud.use(a);
        return { onlyOn: a.onlyOn, wrongKind: !!landing.wrongKind, ok: r.ok, message: r.message };
      }, foeId);
      expect(droid.onlyOn === 'droids' && droid.wrongKind && !droid.ok, `Disable Droid was offered on a trooper: ${JSON.stringify(droid)}`);
      const fp0 = await evalIn(gm, (K) => K.GMManager.getPlayerCharacters()[0].getFP());
      await evalIn(pl, (K, id) => { K.GMPlayerHud.lastNotice = null; K.GMNetworkManager.sendIntent('ability', id, { ability: 'spell', abilityId: K.GMPlayerHud.abilities().find((x) => x.name === 'Disable Droid').entry.talent.id }); return true; }, foeId);
      await waitFor(pl, 'the refusal', (K) => /only works on droids/.test(K.GMPlayerHud.lastNotice?.text || ''), 10000).catch(async () => {
        const said = await evalIn(pl, (K) => K.GMPlayerHud.lastNotice);
        const fp = await evalIn(gm, (K) => K.GMManager.getPlayerCharacters()[0].getFP());
        throw new CheckFailed(`Disable Droid sent at a trooper anyway: the player was told ${JSON.stringify(said)} (Force ${fp0} → ${fp})`);
      });

      // Attacking, then a power: the power goes off (the attack used to replace it), and the cast is held
      await evalIn(gm, (K) => {
        const h = K.GMManager.getPlayerCharacters()[0]; window.__cast = [];
        clearInterval(window.__castTimer);
        window.__castTimer = setInterval(() => { const st = h.model?.animationManager?.currentAnimationState, n = (h.model?.animationManager?.currentAnimation?.name || '-') + (st?.reverse ? '<' : ''); if (window.__cast[window.__cast.length - 1] !== n) window.__cast.push(n); }, 15);
        return true;
      });
      await evalIn(pl, (K, id) => K.GMPlayers.interceptInteraction(K.GameState.getCurrentPlayer(), K.GMManager.netIdMap.get(id)), foeId);
      await pause(2);
      const stun = await evalIn(pl, (K) => { const a = K.GMPlayerHud.abilities().find((x) => x.name === 'Stun'); return K.GMPlayerHud.use(a).ok; });
      expect(stun, 'Stun was not sent');
      await evalIn(pl, (K, id) => K.GMPlayers.interceptInteraction(K.GameState.getCurrentPlayer(), K.GMManager.netIdMap.get(id)), foeId);
      await waitFor(gm, 'the Stun going off', (K) => K.GMManager.getPlayerCharacters()[0].getFP() < 300, 20000).catch(() => undefined);
      await pause(2.5);
      const after = await evalIn(gm, (K, id) => { clearInterval(window.__castTimer); const h = K.GMManager.getPlayerCharacters()[0], f = K.GMManager.netIdMap.get(id); return { fp: h.getFP(), cast: window.__cast.join(' '), fx: f.effects.filter((e) => e.spellId >= 0).map((e) => e.type) }; }, foeId);
      expect(after.fp < fp0, `the queued Stun never went off (Force ${fp0} → ${after.fp})`);
      expect(/castout1 .*castoutlp1 .*castout1</.test(after.cast), `the cast wasn't raised, held and lowered: ${after.cast}`);
      expect(after.fx.length, 'Stun left nothing on the trooper (neither the stun nor its resisted effects)');

      // Burst of Speed doubles their speed
      await evalIn(gm, (K, id) => { const h = K.GMManager.getPlayerCharacters()[0]; K.GMManager.setObjectHidden(K.GMManager.netIdMap.get(id), true); h.gmFightTarget = undefined; h.combatData.combatState = false; h.forcePoints = 300; return true; }, foeId);
      const before = await evalIn(gm, (K) => K.GMManager.getPlayerCharacters()[0].movementSpeed);
      await evalIn(pl, (K) => { const me = K.GameState.getCurrentPlayer(); K.GMPlayerHud.select(me); const a = K.GMPlayerHud.abilities().find((x) => x.name === 'Burst of Speed'); return K.GMPlayerHud.use(a).ok; });
      await waitFor(gm, 'Burst of Speed', (K) => K.GMManager.getPlayerCharacters()[0].movementSpeed > 1.5, 20000).catch(() => undefined);
      const fast = await evalIn(gm, (K) => K.GMManager.getPlayerCharacters()[0].movementSpeed);
      expect(fast >= 1.9, `Burst of Speed took their speed from ×${before} to ×${fast.toFixed(2)}`);
      return `best feat ranks only; Disable Droid refused on a trooper; Stun went off after an attack (Force ${fp0} → ${after.fp}), cast ${after.cast.split(' ').length} parts; speed ×${fast.toFixed(2)}`;
    });

    await check('rolls', 'A player rolling from their sheet sees the result, there and above it', async () => {
      await evalIn(pl, () => { const b = [...document.querySelectorAll('.gm-hud-quick button')].find((x) => /Skills/.test(x.innerText)); if (b) b.click(); return true; });
      await sleep(800);
      const label = await evalIn(pl, () => { const b = [...document.querySelectorAll('button.sheet-roll')].find((x) => /^Roll /.test(x.title || '')); if (b) b.click(); return b ? (b.querySelector('.sheet-roll-name') || {}).innerText : null; });
      expect(label, 'no roll button on the Skills sheet');
      await sleep(1500);
      const r = await evalIn(pl, () => {
        const result = (document.querySelector('.sheet-roll.rolled .sheet-roll-result') || {}).innerText || '';
        const feed = document.querySelector('.gm-roll-feed'), sheet = document.querySelector('.sheet-backdrop');
        const z = (el) => (el ? Number(getComputedStyle(el).zIndex) || 0 : -1);
        const closer = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Close');
        if (closer) closer.click();
        return { result, feedAbove: !!feed && z(feed) > z(sheet), feed: !!feed };
      });
      expect(/→\s*-?\d+/.test(r.result), `the roll's result isn't on the sheet (${r.result || 'nothing'})`);
      expect(r.feed && r.feedAbove, 'the roll feed is behind the character sheet');
      return `${label}: ${r.result}`;
    });

    await check('agree', 'GM and player agree on who is dead, and the dead lie down on both', async () => {
      await evalIn(gm, (K) => { for (const o of window.__R.creatures()) K.GMManager.setObjectHidden(o, false); return true; });
      await pause(2);
      const read = (w) => evalIn(w, () => Object.fromEntries(window.__R.creatures().filter((o) => o.gmNetId).map((o) => [o.gmNetId, [o.getName(), o.isDead(), window.__R.lyingDown(o)]])));
      const [g, p] = [await read(gm), await read(pl)];
      const problems = [];
      for (const [id, [name, dead, lying]] of Object.entries(g)) {
        const other = p[id];
        if (!other) { problems.push(`${name} missing on the player's screen`); continue; }
        if (dead !== other[1]) problems.push(`${name}: ${dead ? 'dead' : 'alive'} for the GM, ${other[1] ? 'dead' : 'alive'} for the player`);
        if (dead && !lying) problems.push(`${name} dead but standing on the GM's screen`);
        if (other[1] && !other[2]) problems.push(`${name} dead but standing on the player's screen`);
      }
      expect(!problems.length, problems.join('; '));
      return `${Object.keys(g).length} creatures`;
    });

    await check('errors', 'No uncaught errors on either screen', async () => {
      const errors = windows.flatMap((w, i) => (w.pageErrors || []).map((e) => `${i ? 'player' : 'GM'}: ${e}`));
      expect(!errors.length, [...new Set(errors)].slice(0, 5).join(' | '));
    });
  } finally {
    if (!SHOW) windows.forEach((w) => { if (!w.isDestroyed()) w.destroy(); });
    devServer.stop();
  }
}

app.whenReady().then(async () => {
  try {
    await run();
  } catch (e) {
    log(`Run aborted: ${e.stack || e.message}`);
    results.push({ id: 'setup', name: 'setup', ok: false, error: e.message });
  }
  const failed = results.filter((r) => !r.ok);
  console.log('');
  console.log(`GM regress: ${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const r of failed) console.log(`  ✘ ${r.name}: ${r.error}`);
  app.exit(failed.length ? 1 : 0);
});

app.on('window-all-closed', () => {});

/**
 * GM Mode 1v1 Duel Sync & Visual Check.
 *
 * Boots a GM Host and a remote Player Client, puts them into a 1v1 fight in GM mode,
 * and exercises EVERY Force power (spells.2da usertype === 1) and EVERY active combat feat
 * (feat.2da category 0x1104 melee & 0x1111 ranged) through the Player HUD / intent pipeline.
 *
 * Verifies on BOTH Host and Client after each ability:
 *   - Ability resolves cleanly with zero NWScript missing-function warnings or JS errors
 *   - HP, movementSpeed (Force Speed), and active mirrored visual/state/beam effects sync
 *   - Force Push / Whirlwind / Stun move & hold targets identically on both screens
 *   - Zero leaked spellInstances, projectiles, or pendingNetSpawns, and valid UI/WebGL layout
 *
 * Usage:  npm run test:gm-duel [-- --show] [-- --speed 4] [-- --only=powers,feats] [-- --match=REGEX] [-- --key=tsl]
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const {
  sleep, configureApp, createGameWindow, evalIn, waitFor, bootToMenu,
  setGameSpeed, checkLayoutInvariants, checkWorldInvariants,
} = require('./lib/game-window');
const { createDevServer } = require('./lib/dev-server');
const { startGMRelayServer } = require('./gm-server.js');

const BASE_URL = (process.env.GM_E2E_URL || 'http://localhost:8080').replace(/\/$/, '');
const SHOW = process.argv.includes('--show');
const arg = (name) => {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
};
const SPEED = Math.max(1, Math.min(4, Number(arg('speed')) || 4));
const ONLY = (arg('only') || 'powers,feats').split(',').map((s) => s.trim()).filter(Boolean);
const MATCH = arg('match') ? new RegExp(arg('match'), 'i') : null;
const GAME_KEY = arg('key') || 'kotor';
const SCENE = arg('scene') || (GAME_KEY === 'tsl' ? '001ebo' : 'danm14aa');
const PORT = 7950 + Math.floor(Math.random() * 40);
const WS_URL = `ws://localhost:${PORT}`;
const OUT_DIR = path.resolve(__dirname, '..', 'bench-results');

configureApp(app, process.env.GM_DUEL_PROFILE || 'kotor-gm-duel');

const t0 = Date.now();
const log = (msg) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${msg}`);
const pause = (gameSeconds) => sleep(Math.max(50, (gameSeconds * 1000) / SPEED));

function installHostInstrumentation(KotOR) {
  const GS = KotOR.GameState;
  const actions = (GS.GameKey === KotOR.GameEngineType.TSL ? KotOR.NWScriptDefK2 : KotOR.NWScriptDefK1).Actions;
  const bench = window.__DUEL = {
    current: null,
    missing: new Set(),
    errors: [],
  };

  for (const key of Object.keys(actions)) {
    const def = actions[key];
    if (!def || def.__duelWrapped || typeof def.action !== 'function') continue;
    def.__duelWrapped = true;
    const orig = def.action;
    def.action = function (...args) {
      try {
        return orig.apply(this, args);
      } catch (e) {
        if (bench.current) bench.current.errors.push(`${def.name}: ${String(e && e.message || e).slice(0, 160)}`);
        throw e;
      }
    };
  }

  const warn = console.warn.bind(console);
  console.warn = (...args) => {
    const msg = String(args[0] || '');
    const m = msg.match(/^NWScript Action (\S+) not found/);
    if (m && bench.current) bench.current.missing.add(m[1]);
    return warn(...args);
  };

  if (!KotOR.SpellCastInstance.prototype.__duelWrapped) {
    KotOR.SpellCastInstance.prototype.__duelWrapped = true;
    const impact = KotOR.SpellCastInstance.prototype.impact;
    KotOR.SpellCastInstance.prototype.impact = function (...args) {
      if (bench.current && this.owner === bench.current.caster && !this.impacted) {
        bench.current.impacted = true;
      }
      return impact.apply(this, args);
    };
  }

  if (!KotOR.CombatRound.prototype.__duelWrapped) {
    KotOR.CombatRound.prototype.__duelWrapped = true;
    const calc = KotOR.CombatRound.prototype.calculateAttackDamage;
    KotOR.CombatRound.prototype.calculateAttackDamage = function (creature, combatAction, ...rest) {
      const before = !!combatAction?.resultsCalculated;
      const out = calc.call(this, creature, combatAction, ...rest);
      if (bench.current && creature === bench.current.caster && combatAction?.feat && !before) {
        bench.current.featAttack = { result: combatAction.attackResult, damage: combatAction.attackDamage };
      }
      return out;
    };
  }
  return true;
}

function installErrorTrap(win) {
  return evalIn(win, () => {
    window.__duelStacks = [];
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      window.__duelStacks.push(String((r && (r.stack || r.message)) || r).slice(0, 600));
    });
    window.addEventListener('error', (e) => {
      window.__duelStacks.push(String((e.error && e.error.stack) || e.message).slice(0, 600));
    });
    return true;
  });
}

function readWindowSnapshot(KotOR, targetNetIds) {
  const G = KotOR.GMManager;
  const GS = KotOR.GameState;
  const MIRRORED = new Set([
    KotOR.GameEffectType.EffectVisualEffect,
    KotOR.GameEffectType.EffectBeam,
    KotOR.GameEffectType.EffectSetState,
    KotOR.GameEffectType.EffectMovementSpeedIncrease,
    KotOR.GameEffectType.EffectMovementSpeedDecrease,
  ]);
  const out = {};
  for (const id of targetNetIds) {
    const o = G.netIdMap.get(id);
    if (!o) {
      out[id] = null;
      continue;
    }
    const mirrored = (o.effects || [])
      .filter((e) => e && MIRRORED.has(e.type))
      .map((e) => ({ type: e.type, int0: e.getInt ? e.getInt(0) : 0, spellId: e.spellId ?? -1 }));
    out[id] = {
      hp: o.getHP?.(),
      maxHp: o.getMaxHP?.(),
      movementSpeed: o.movementSpeed ?? 1,
      x: +o.position.x.toFixed(3),
      y: +o.position.y.toFixed(3),
      z: +o.position.z.toFixed(3),
      dead: !!o.isDead?.(),
      debilitated: !!o.isDebilitated?.(),
      whirlwind: !!o.isWhirlwind?.(),
      rightHand: o.equipment?.RIGHTHAND?.getItemResRef?.() || '',
      mirrored,
    };
  }
  return {
    actors: out,
    pending: KotOR.GMReplication ? [...KotOR.GMReplication.pendingNetSpawns] : [],
    projectiles: (KotOR.ProjectileManager?.projectiles || []).length,
    spellInstances: (GS.module?.area?.spellInstances || []).length,
  };
}

function nonResourceErrors(win, sinceIdx) {
  return (win.consoleErrors || [])
    .slice(sinceIdx)
    .filter((m) => !/Resource not found|not implemented yet/i.test(m));
}

async function run() {
  const devServer = createDevServer({ baseUrl: BASE_URL, log });
  await devServer.ensure();
  startGMRelayServer({ port: PORT });

  const gm = createGameWindow({ show: SHOW, title: 'GM Duel — Host' });
  const pl = createGameWindow({ show: SHOW, title: 'GM Duel — Player' });
  const windows = [gm, pl];
  for (const w of windows) {
    w.webContents.on('console-message', (ev) => {
      if (/VALIDATE_STATUS|Shader Error/i.test(String(ev.message || ''))) {
        log(`[WebGL] ${String(ev.message).slice(0, 600)}`);
      }
    });
  }

  try {
    const query = GAME_KEY === 'tsl' ? '?key=tsl' : '';
    const url = `${BASE_URL}/game/${query}`;
    log(`Booting GM host + Player client (${GAME_KEY}, scene=${SCENE}, speed=${SPEED}x)...`);
    await Promise.all(windows.map((w) => bootToMenu(w, url, { timeout: 300000 })));

    await evalIn(gm, (K, scene) => { K.GameState.EnterGMMode(scene); return true; }, SCENE);
    await waitFor(gm, 'GM mode scene', (K) => !!(K.GameState.module && K.GameState.module.readyToProcessEvents && K.GMManager.active && !K.GMManager.sceneLoading && !K.GameState.loadingTextures), 120000);
    await evalIn(gm, (K, ws) => K.GMNetworkManager.hostSession(ws, 'duel-check'), WS_URL);
    await waitFor(gm, 'GM hosting', (K) => K.GMNetworkManager.role === 'host' && K.GMNetworkManager.connected, 20000);

    await evalIn(pl, (K, ws) => {
      const G = K.GMManager;
      const preset = G.PLAYER_PRESETS[0];
      K.GameState.gmMode = true;
      G.active = true;
      K.GMNetworkManager.joinSession(ws, 'Duelist', {
        name: 'Duelist',
        appearanceId: preset.appearanceId,
        classId: preset.classId,
        character: { ...K.GMCharacters.blank(preset), name: 'Duelist', str: 18, dex: 18, wis: 18, cha: 18 },
      });
      return true;
    }, WS_URL);
    await waitFor(pl, 'Player join', (K) => {
      const N = K.GMNetworkManager;
      const me = K.GameState.getCurrentPlayer();
      return !!(N.assignedActorNetId && me && me.gmNetId === N.assignedActorNetId && K.GameState.module?.readyToProcessEvents);
    }, 120000);

    await sleep(1500);
    for (const w of windows) {
      await setGameSpeed(w, SPEED);
      await evalIn(w, (K) => { K.GameState.setRandomSeed?.(1337); return true; });
      await installErrorTrap(w);
    }
    await evalIn(gm, installHostInstrumentation);

    // Stage the 1v1 arena: hide ambient creatures, grant Hero all powers & combat feats,
    // find weapon resrefs from presets, and spawn a humanoid + droid + Jedi opponent.
    const staged = await evalIn(gm, async (K, gameKey) => {
      const G = K.GMManager;
      const GS = K.GameState;
      const THREE = window.THREE;
      G.npcAiEnabled = false;
      G.worldPaused = false;
      G.playersFrozen = false;
      // Clear any leftover console errors during boot before the duel starts
      const inGame = (c) => !c.onlyIn || c.onlyIn === gameKey;
      const findPreset = (...names) => names.map((n) => G.CREATURE_PRESETS.find((c) => c.name === n && inGame(c))).find(Boolean) || G.CREATURE_PRESETS.find(inGame) || G.CREATURE_PRESETS[0];

      const hero = G.getPlayerCharacters()[0];
      for (const o of [...G.netIdMap.values()]) {
        if (o && o !== hero && K.GMObjectKind.isCreature(o)) G.setObjectHidden(o, true);
      }

      const valid = (v) => v !== undefined && v !== null && v !== '' && v !== '****';
      const num = (v, d = -1) => (valid(v) && Number.isFinite(Number(v)) ? Number(v) : d);
      const tlk = (s) => {
        const n = Number(s);
        if (!Number.isFinite(n) || n < 0) return '';
        try { return GS.TLKManager.GetStringById(n)?.Value || ''; } catch { return ''; }
      };

      const spellsTable = GS.TwoDAManager.datatables.get('spells').rows;
      const powers = Object.values(spellsTable)
        .filter((r) => num(r.usertype) === 1 && valid(r.impactscript))
        .map((r) => ({
          kind: 'power',
          id: r.__index,
          label: r.label,
          name: tlk(r.name) || r.label,
          personal: String(r.range || '').toUpperCase() === 'P',
          hostile: valid(r.forcehostile),
          friendly: valid(r.forcefriendly),
          droidOnly: K.GMCombatAI.powerTargetRule(r.forcehostile) === 'droids' || /DROID/i.test(r.label),
          forceUsersOnly: K.GMCombatAI.powerTargetRule(r.forcehostile) === 'forceUsers',
          forceSpeed: /SPEED/i.test(r.label),
          forcePush: /PUSH|WAVE|WHIRLWIND/i.test(r.label),
        }));

      const featsTable = GS.TwoDAManager.datatables.get('feat').rows;
      const feats = Object.values(featsTable)
        .filter((r) => r.category === '0x1104' || r.category === '0x1111')
        .map((r) => ({
          kind: 'feat',
          id: r.__index,
          label: r.label,
          name: tlk(r.name) || r.label,
          category: r.category,
          ranged: r.category === '0x1111',
        }));

      for (const p of powers) {
        if (!hero.getSpells().some((s) => s.id === p.id)) hero.classes[0].addSpell(new K.TalentSpell(p.id));
      }
      for (const f of feats) {
        if (!hero.getHasFeat(f.id)) hero.addFeat(f.id);
      }
      hero.maxHP = 1000; hero.currentHP = 1000; hero.hp = 1000;
      hero.maxForcePoints = 1000; hero.forcePoints = 1000; hero.currentForce = 1000;

      const anchor = GS.module.area.getNearestWalkablePoint(
        new THREE.Vector3(GS.module.entryX, GS.module.entryY, GS.module.entryZ), 0.5
      ).clone();
      G.teleportObject(hero, anchor);

      const darkJedi = findPreset('Dark Jedi Master', 'Dark Jedi Master (Female)', 'Sith Lord');
      const trooper = findPreset('Sith Assault Trooper', 'Telos Security Officer', 'Mandalorian Captain');
      const repOfficer = findPreset('Republic Officer', 'Telos Security Commander', 'Telos Security Officer');
      const droidPreset = findPreset('War Droid Mark II', 'Telos Military Droid', 'HK-50');

      const meleeWeapon = darkJedi.rightHandResRef || darkJedi.gear?.rightHandResRef || 'g_w_lghtsbr01';
      const rangedWeapon = repOfficer.rightHandResRef || trooper.rightHandResRef || 'g_w_blstrpstl001';

      const foePos = GS.module.area.getNearestWalkablePoint(anchor.clone().add(new THREE.Vector3(4, 0, 0)), 0.5).clone();
      const foeGear = { rightHandResRef: rangedWeapon, leftHandResRef: '', armorResRef: '' };
      const humanFoe = await K.GMSpawner.spawnCreature({ ...trooper, ...foeGear, name: 'Human Foe', factionId: 1, hp: 1000, barkText: '', customized: true }, foePos, Math.PI);
      const droidFoe = await K.GMSpawner.spawnCreature({ ...droidPreset, rightHandResRef: '', leftHandResRef: '', armorResRef: '', name: 'Droid Foe', factionId: 1, hp: 1000, barkText: '', customized: true }, foePos.clone(), Math.PI);
      const jediFoe = await K.GMSpawner.spawnCreature({ ...darkJedi, rightHandResRef: meleeWeapon, leftHandResRef: '', armorResRef: '', name: 'Jedi Foe', factionId: 1, hp: 1000, barkText: '', customized: true }, foePos.clone(), Math.PI);
      G.setObjectHidden(droidFoe, true);
      G.setObjectHidden(jediFoe, true);
      const saberItem = await K.GMSpawner.createItemFromResRefAsync(meleeWeapon);
      if (saberItem && saberItem.baseItem) await hero.equipItem(K.ModuleCreatureArmorSlot.RIGHTHAND, saberItem);
      K.GMPlayers.updatePlayerSheets();

      return {
        heroNetId: hero.gmNetId,
        humanFoeNetId: humanFoe.gmNetId,
        droidFoeNetId: droidFoe.gmNetId,
        jediFoeNetId: jediFoe.gmNetId,
        meleeWeapon,
        rangedWeapon,
        anchor: anchor.toArray(),
        foePos: foePos.toArray(),
        powers,
        feats,
      };
    }, GAME_KEY);

    await waitFor(pl, 'Player synced with Duel opponents and Force powers', (K, hId, fId) => {
      const h = K.GMManager.netIdMap.get(hId);
      const f = K.GMManager.netIdMap.get(fId);
      return !!(h && f && K.GMPlayerHud.abilities().some((a) => a.kind === 'power'));
    }, 20000, staged.heroNetId, staged.humanFoeNetId);

    const checkList = [
      ...(ONLY.includes('powers') ? staged.powers : []),
      ...(ONLY.includes('feats') ? [...staged.feats].sort((a, b) => Number(a.ranged) - Number(b.ranged)) : []),
    ].filter((a) => !MATCH || MATCH.test(`${a.label} ${a.name}`));

    log(`Testing ${checkList.length} abilities in 1v1 GM duel (${staged.powers.length} powers, ${staged.feats.length} combat feats available)...`);

    const results = [];
    let equippedMode = 'melee';

    for (const ability of checkList) {
      const needRanged = ability.kind === 'feat' && ability.ranged;
      const wantMode = needRanged ? 'ranged' : 'melee';
      if (equippedMode !== wantMode) {
        const resRef = wantMode === 'ranged' ? staged.rangedWeapon : staged.meleeWeapon;
        await evalIn(gm, async (K, hId, wRef) => {
          const hero = K.GMManager.netIdMap.get(hId);
          const item = await K.GMSpawner.createItemFromResRefAsync(wRef);
          if (item && item.baseItem) await hero.equipItem(K.ModuleCreatureArmorSlot.RIGHTHAND, item);
          K.GMPlayers.updatePlayerSheets();
          return true;
        }, staged.heroNetId, resRef);
        await pause(1.5);
        equippedMode = wantMode;
      }

      const targetId = ability.droidOnly
        ? staged.droidFoeNetId
        : ability.forceUsersOnly
          ? staged.jediFoeNetId
          : staged.humanFoeNetId;
      const otherIds = [staged.humanFoeNetId, staged.droidFoeNetId, staged.jediFoeNetId].filter((id) => id !== targetId);
      const gmPageErrBefore = gm.pageErrors.length;
      const plPageErrBefore = pl.pageErrors.length;
      const gmConErrBefore = gm.consoleErrors.length;
      const plConErrBefore = pl.consoleErrors.length;

      // Reset 1v1 arena state between abilities
      await evalIn(gm, (K, ids, aPos, fPos) => {
        const G = K.GMManager;
        const hero = G.netIdMap.get(ids.hero);
        const foe = G.netIdMap.get(ids.target);
        const THREE = window.THREE;
        for (const oid of ids.others) {
          const other = G.netIdMap.get(oid);
          if (other) G.setObjectHidden(other, true);
        }
        G.setObjectHidden(foe, false);

        for (const c of [hero, foe]) {
          c.clearAllActions?.();
          c.combatRound?.clearActions?.();
          c.combatData.combatState = false;
          c.excitedDuration = 0;
          c.gmFightTarget = undefined;
          if (c.isDead?.()) K.GMPlayers.revivePlayer?.(c);
          for (const e of [...(c.effects || [])]) c.removeEffect?.(e);
          G.setCreatureHP(c, 1000, 1000);
          c.subtractHP(60); // Leave room so Heal/Cure powers visibly restore HP
        }
        hero.maxForcePoints = 1000; hero.forcePoints = 1000; hero.currentForce = 1000;
        G.teleportObject(hero, new THREE.Vector3(...aPos));
        G.teleportObject(foe, new THREE.Vector3(...fPos));

        window.__DUEL.current = { caster: hero, impacted: false, featAttack: null, errors: [], missing: new Set() };
        return true;
      }, { hero: staged.heroNetId, target: targetId, others: otherIds }, staged.anchor, staged.foePos);

      await pause(1.2);

      // Trigger ability via real Player HUD or player client intent
      const fired = await evalIn(pl, (K, ab, tId) => {
        const target = K.GMManager.netIdMap.get(tId);
        if (target) K.GMPlayerHud.select(target);
        const key = `${ab.kind}:${ab.id}`;
        const hudEntry = K.GMPlayerHud.abilities().find((a) => a.key === key && a.usable);
        if (hudEntry) {
          const r = K.GMPlayerHud.use(hudEntry);
          if (r.ok) return { via: 'hud', ok: true };
        }
        const aimSelf = ab.kind === 'power' && (ab.personal || (!ab.hostile && ab.friendly));
        const dest = aimSelf ? K.GMNetworkManager.assignedActorNetId : tId;
        K.GMNetworkManager.sendIntent('ability', dest, {
          ability: ab.kind === 'power' ? 'spell' : 'feat',
          abilityId: ab.id,
        });
        return { via: 'intent', ok: K.GMNetworkManager.role === 'client' && !!K.GMNetworkManager.assignedActorNetId };
      }, ability, targetId);

      // Wait for resolution on host
      const resolveDeadline = Date.now() + 9000;
      let resolved = false;
      while (Date.now() < resolveDeadline && !resolved) {
        resolved = await evalIn(gm, () => {
          const d = window.__DUEL.current;
          return !!(d && (d.impacted || d.featAttack));
        });
        if (!resolved) await sleep(80);
      }

      // Let cast/projectile/tick replication reach client
      await pause(2.0);
      const midHost = await evalIn(gm, readWindowSnapshot, [staged.heroNetId, targetId]);
      const midClient = await evalIn(pl, readWindowSnapshot, [staged.heroNetId, targetId]);

      // Calm fighters & wait for final world.tick + cast instances so transient mid-round HP/FX settle
      await evalIn(gm, (K, ids) => {
        for (const id of ids) {
          const c = K.GMManager.netIdMap.get(id);
          if (!c) continue;
          c.clearAllActions?.();
          c.combatRound?.clearActions?.();
          c.combatData.combatState = false;
          c.gmFightTarget = undefined;
        }
        return true;
      }, [staged.heroNetId, targetId]);
      await pause(2.5);
      await sleep(350);

      let postHost = await evalIn(gm, readWindowSnapshot, [staged.heroNetId, targetId]);
      let postClient = await evalIn(pl, readWindowSnapshot, [staged.heroNetId, targetId]);
      const needsWait = (h, c) =>
        h.spellInstances > 0 || c.spellInstances > 0 || h.projectiles > 0 || c.projectiles > 0 ||
        [staged.heroNetId, targetId].some((id) => h.actors[id]?.hp !== c.actors[id]?.hp);
      for (let w = 0; w < 10 && needsWait(postHost, postClient); w++) {
        await sleep(200);
        postHost = await evalIn(gm, readWindowSnapshot, [staged.heroNetId, targetId]);
        postClient = await evalIn(pl, readWindowSnapshot, [staged.heroNetId, targetId]);
      }
      const duelInfo = await evalIn(gm, () => {
        const d = window.__DUEL.current;
        window.__DUEL.current = null;
        return { errors: [...d.errors], missing: [...d.missing], featAttack: d.featAttack };
      });

      const problems = [];
      if (!fired.ok) problems.push('client failed to send ability intent');
      if (!resolved) {
        const diag = await evalIn(gm, (K, id, tId) => {
          const hero = K.GMManager.netIdMap.get(id);
          const target = K.GMManager.netIdMap.get(tId);
          return {
            fp: hero?.getFP?.(),
            queue: (hero?.actionQueue || []).map((a) => a.type),
            roundAction: hero?.combatRound?.action?.actionType,
            targetFp: target?.getMaxFP?.(),
            targetRace: target?.getRace?.(),
          };
        }, staged.heroNetId, targetId);
        const notice = await evalIn(pl, (K) => K.GMPlayerHud.lastNotice?.text || '');
        problems.push(`did not resolve before timeout (diag=${JSON.stringify(diag)}, notice=${JSON.stringify(notice)})`);
      }
      if (duelInfo.missing.length) problems.push(`missing NWScript: ${duelInfo.missing.join(', ')}`);
      if (duelInfo.errors.length) problems.push(`script errors: ${duelInfo.errors.join(' | ')}`);
      if (gm.pageErrors.length > gmPageErrBefore) problems.push(`GM uncaught: ${gm.pageErrors[gmPageErrBefore]}`);
      if (pl.pageErrors.length > plPageErrBefore) problems.push(`Client uncaught: ${pl.pageErrors[plPageErrBefore]}`);
      const gmNewCon = nonResourceErrors(gm, gmConErrBefore);
      const plNewCon = nonResourceErrors(pl, plConErrBefore);
      const plStacks = await evalIn(pl, () => window.__duelStacks.splice(0));
      const gmStacks = await evalIn(gm, () => window.__duelStacks.splice(0));
      if (gmNewCon.length) problems.push(`GM console.error: ${gmNewCon[0]}`);
      if (plNewCon.length) problems.push(`Client console.error: ${plNewCon[0]}`);
      if (gmStacks.length) problems.push(`GM stack: ${gmStacks[0].replace(/\s+/g, ' ')}`);
      if (plStacks.length) problems.push(`Client stack: ${plStacks[0].replace(/\s+/g, ' ')}`);

      // Sync checks between Host and Client
      for (const id of [staged.heroNetId, targetId]) {
        const h = postHost.actors[id];
        const c = postClient.actors[id];
        if (!h || !c) {
          problems.push(`missing actor ${id} after cast`);
          continue;
        }
        if (h.hp !== c.hp) problems.push(`${id} HP mismatch: host=${h.hp}, client=${c.hp}`);
        if (Math.abs(h.movementSpeed - c.movementSpeed) > 0.02) {
          problems.push(`${id} movementSpeed mismatch: host=${h.movementSpeed}, client=${c.movementSpeed}`);
        }
        const dist = Math.hypot(h.x - c.x, h.y - c.y);
        if (dist > 1.2) {
          problems.push(`${id} position desync: ${dist.toFixed(2)}m`);
        }
        const mh = midHost.actors[id];
        const mc = midClient.actors[id];
        if (mh && mc) {
          for (const fx of mh.mirrored) {
            const has = mc.mirrored.some((m) => m.type === fx.type && (fx.spellId < 0 || m.spellId === fx.spellId));
            if (!has) problems.push(`${id} mirrored effect type=${fx.type} (spell ${fx.spellId}) missing on client`);
          }
        }
      }

      if (ability.forceSpeed) {
        const hs = midHost.actors[staged.heroNetId]?.movementSpeed || 1;
        const cs = midClient.actors[staged.heroNetId]?.movementSpeed || 1;
        if (hs <= 1.2 || cs <= 1.2) {
          problems.push(`Force Speed did not boost speed (host=${hs}, client=${cs})`);
        }
      }

      if (postHost.pending.length || postClient.pending.length) {
        problems.push(`stuck pendingNetSpawns: host=${postHost.pending.length}, client=${postClient.pending.length}`);
      }
      if (postHost.spellInstances > 0 || postClient.spellInstances > 0) {
        problems.push(`leaked spellInstances: host=${postHost.spellInstances}, client=${postClient.spellInstances}`);
      }

      const ok = problems.length === 0;
      results.push({ kind: ability.kind, id: ability.id, label: ability.label, name: ability.name, ok, via: fired.via, problems });
      log(`${ok ? '✔' : '✘'} [${ability.kind}] ${ability.name} (${ability.label})${ok ? '' : ' — ' + problems.join('; ')}`);
    }

    const layoutProblems = [
      ...(await checkLayoutInvariants(gm)).map((p) => `GM: ${p}`),
      ...(await checkLayoutInvariants(pl)).map((p) => `Client: ${p}`),
    ];
    const worldProblems = await checkWorldInvariants(gm, [pl]);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const passed = results.filter((r) => r.ok).length;
    fs.writeFileSync(path.join(OUT_DIR, 'gm-duel-check.json'), JSON.stringify({
      date: new Date().toISOString(),
      scene: SCENE,
      speed: SPEED,
      total: results.length,
      passed,
      failed: results.length - passed,
      layoutProblems,
      worldProblems,
      results,
    }, null, 2));

    log(`Finished: ${passed}/${results.length} abilities passed in 1v1 GM duel (${((Date.now() - t0) / 1000).toFixed(1)}s).`);
    if (layoutProblems.length) log(`Layout problems: ${layoutProblems.join('; ')}`);
    if (worldProblems.length) log(`World problems: ${worldProblems.join('; ')}`);

    if (passed !== results.length || layoutProblems.length || worldProblems.length) {
      return 1;
    }
    return 0;
  } finally {
    for (const w of windows) {
      try { if (!w.isDestroyed()) w.destroy(); } catch {}
    }
    try { await devServer.stop(); } catch {}
  }
}

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  let code = 0;
  try {
    code = await run();
  } catch (err) {
    console.error(err);
    code = 1;
  }
  app.exit(code || 0);
});

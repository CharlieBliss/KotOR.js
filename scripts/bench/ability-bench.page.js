/**
 * Ability test bench — the part that runs inside the game page (see scripts/gm-ability-bench.js).
 *
 * Tries every force power and creature ability (spells.2da), usable item (items whose properties cast a spell)
 * and combat feat (feat.2da) in isolation, and records what actually happened: hit points, force points,
 * effects, movement, which engine script functions ran, which are missing, and errors.
 *
 * Each ability gets a fresh caster and target, on hostile terms but with the GM's NPC combat AI switched off,
 * so nothing but the ability changes anything. Abilities run through the engine's own paths
 * (TalentSpell.useTalentOnObject, ModuleItem.useItemOnObject, TalentFeat.useTalentOnObject) and the game's
 * own impact scripts, exactly as a player's action menu would.
 *
 * Defines window.AbilityBench. Not part of the game build.
 */
(() => {
  const K = window.KotOR;
  const GS = K.GameState;
  const G = K.GMManager;
  const THREE = window.THREE;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Longest an ability may take to resolve (conjure + cast + impact), in ms */
  const RESOLVE_TIMEOUT = 9000;
  /** Wait after it resolves, for knockdowns, damage over time and durations to show, in ms */
  const SETTLE_TIME = 2000;
  /** A caster's force points for the bench: enough for any power */
  const BENCH_FP = 200;

  const tlk = (strref) => {
    const n = Number(strref);
    if (!Number.isFinite(n) || n < 0) return '';
    try { return GS.TLKManager.GetStringById(n)?.Value || ''; } catch (e) { return ''; }
  };
  const valid = (v) => v !== undefined && v !== null && v !== '' && v !== '****';
  const num = (v, d = -1) => (valid(v) && Number.isFinite(Number(v)) ? Number(v) : d);

  // ---------------------------------------------------------------------------------------------------------
  // Instrumentation: which engine script functions an ability calls, which are missing, which throw
  // ---------------------------------------------------------------------------------------------------------

  let current = null; // the ability being measured

  function instrumentScripts() {
    const actions = (GS.GameKey === K.GameEngineType.TSL ? K.NWScriptDefK2 : K.NWScriptDefK1).Actions;
    for (const key of Object.keys(actions)) {
      const def = actions[key];
      if (!def || def.__benchWrapped) continue;
      def.__benchWrapped = true;
      const original = def.action;
      if (typeof original !== 'function') continue;
      def.action = function (...args) {
        if (current) current.calls.add(def.name);
        try {
          return original.apply(this, args);
        } catch (e) {
          if (current) current.errors.push(`${def.name}: ${String(e && e.message || e).slice(0, 160)}`);
          throw e;
        }
      };
    }

    // Missing and broken script functions are reported by the script VM as warnings
    const warn = console.warn.bind(console);
    console.warn = (...args) => {
      if (current) {
        const msg = String(args[0] || '');
        let m;
        if ((m = msg.match(/^NWScript Action (\S+) not found/))) current.missing.add(m[1]);
        else if ((m = msg.match(/^(\S+) returned undefined/))) current.undefinedReturns.add(m[1]);
      }
      return warn(...args);
    };
    const error = console.error.bind(console);
    console.error = (...args) => {
      if (current) current.errors.push(args.map((a) => (a && a.message) || String(a)).join(' ').split('\n')[0].slice(0, 200));
      return error(...args);
    };
    // When an ability resolves: a spell's (or item's) impact script runs, or a feat attack is rolled
    const impact = K.SpellCastInstance.prototype.impact;
    K.SpellCastInstance.prototype.impact = function (...args) {
      if (current && this.owner === current.caster && !this.impacted) current.impacted = true;
      return impact.apply(this, args);
    };
    const rollAttack = K.CombatRound.prototype.calculateAttackDamage;
    K.CombatRound.prototype.calculateAttackDamage = function (creature, combatAction, ...rest) {
      const before = !!combatAction?.resultsCalculated;
      const out = rollAttack.call(this, creature, combatAction, ...rest);
      if (current && creature === current.caster && combatAction?.feat && !before) {
        current.featAttack = { result: combatAction.attackResult, damage: combatAction.attackDamage };
      }
      return out;
    };

    window.addEventListener('error', (e) => { if (current) current.errors.push(String(e.message).slice(0, 200)); });
    window.addEventListener('unhandledrejection', (e) => { if (current) current.errors.push(String(e.reason && e.reason.message || e.reason).slice(0, 200)); });
  }

  // ---------------------------------------------------------------------------------------------------------
  // What to test
  // ---------------------------------------------------------------------------------------------------------

  function spellRow(id) {
    return GS.TwoDAManager.datatables.get('spells').rows[id];
  }

  const USER_TYPES = { 1: 'Force power', 2: 'Creature/special ability', 3: 'Item', 4: 'Item' };

  function listSpells() {
    const rows = Object.values(GS.TwoDAManager.datatables.get('spells').rows);
    return rows
      .filter((r) => valid(r.impactscript))
      .map((r) => ({
        kind: 'spell',
        id: r.__index,
        label: r.label,
        name: tlk(r.name) || r.label,
        userType: num(r.usertype),
        group: USER_TYPES[num(r.usertype)] || `User type ${r.usertype}`,
        script: r.impactscript,
        hostile: valid(r.forcehostile),
        friendly: valid(r.forcefriendly),
        forcePoints: num(r.forcepoints, 0),
      }));
  }

  function listFeats() {
    const rows = Object.values(GS.TwoDAManager.datatables.get('feat').rows);
    return rows
      .filter((r) => r.category === '0x1104' || r.category === '0x1111' || num(r.spellid) >= 0)
      .map((r) => ({
        kind: 'feat',
        id: r.__index,
        label: r.label,
        name: tlk(r.name) || r.label,
        group: r.category === '0x1104' ? 'Melee combat feat' : r.category === '0x1111' ? 'Ranged combat feat' : valid(r.category) ? `Feat (category ${r.category})` : 'Feat that grants a power',
        category: r.category,
        spellId: num(r.spellid),
        hostile: num(r.hostilefeat, 0) === 1 || r.category === '0x1104' || r.category === '0x1111',
        friendly: num(r.targetself, 0) === 1,
      }));
  }

  /** Every item template in the game */
  function itemTemplates() {
    const utiType = K.ResourceTypes['uti'];
    return [...K.KEYManager.Key._keyByRefType.keys()].filter((k) => k.endsWith(':' + utiType)).map((k) => k.split(':')[0]);
  }

  /** Item templates whose properties cast a spell when used (medpacs, stims, grenades, shields...) */
  async function listItems(resrefs = itemTemplates()) {
    const out = [];
    for (const resref of resrefs) {
      let item;
      try { item = await K.GMSpawner.createItemFromResRefAsync(resref); } catch (e) { continue; }
      if (!item || !Array.isArray(item.properties)) continue;
      const castSpell = item.properties.find((p) => p && p.is && p.is(K.ModuleItemProperty.CastSpell));
      if (!castSpell) continue;
      const iprp = GS.TwoDAManager.datatables.get('iprp_spells')?.rows[castSpell.subType];
      const spellId = num(iprp?.spellindex);
      const row = spellId >= 0 ? spellRow(spellId) : undefined;
      out.push({
        kind: 'item',
        id: resref,
        label: resref,
        name: item.getName ? item.getName() : resref,
        group: 'Usable item',
        spellId,
        script: row?.impactscript,
        hostile: !!row && (valid(row.forcehostile) || num(row.hostilesetting, 0) === 1),
        friendly: !row || valid(row.forcefriendly) || !valid(row.forcehostile),
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Running one ability
  // ---------------------------------------------------------------------------------------------------------

  let origin = null;

  async function setup(scene) {
    if (!GS.gmMode || String(GS.module?.filename).toLowerCase() !== scene) {
      GS.EnterGMMode(scene);
    }
    for (let i = 0; i < 600 && !(GS.module && GS.module.readyToProcessEvents && !G.sceneLoading && !GS.loadingTextures); i++) await sleep(250);
    await sleep(1500);
    G.npcAiEnabled = false;
    G.worldPaused = false;
    instrumentScripts();
    origin = GS.module.area.getNearestWalkablePoint(new THREE.Vector3(GS.module.entryX, GS.module.entryY, GS.module.entryZ), 0.5).clone();
    return { scene: GS.module.filename, origin: origin.toArray() };
  }

  async function spawn(presetName, overrides, offsetX) {
    const preset = G.CREATURE_PRESETS.find((c) => c.name === presetName);
    const pos = GS.module.area.getNearestWalkablePoint(origin.clone().add(new THREE.Vector3(offsetX, 0, 0)), 0.5).clone();
    return K.GMSpawner.spawnCreature({ ...preset, ...overrides }, pos, offsetX > 0 ? Math.PI / 2 : -Math.PI / 2);
  }

  const ATTACK_RESULTS = { 0: 'invalid', 1: 'hit', 2: 'critical hit', 3: 'automatic hit', 4: 'missed', 5: 'resisted', 6: 'failed', 8: 'parried', 9: 'deflected' };

  const forcePoints = (c) => (c.maxForcePoints || 0) + (c.currentForce || 0) - (c.forcePoints || 0);

  function describeEffect(e) {
    const name = e.constructor.name.replace(/^Effect/, '');
    try {
      if (name === 'SetState') return `SetState(${e.getInt(0)})`;
      if (name === 'VisualEffect') return `Visual(${e.getInt(0)})`;
      if (name === 'Damage') return `Damage(${e.getInt(0) || ''})`;
      if (name === 'Heal') return `Heal(${e.getInt(0) || ''})`;
    } catch (err) {}
    return name;
  }

  function snapshot(c) {
    return {
      hp: c.getHP(),
      maxHp: c.getMaxHP(),
      fp: forcePoints(c),
      engineFp: c.getFP ? c.getFP() : undefined,
      effects: c.effects.filter(Boolean).map(describeEffect),
      pos: c.position.clone(),
      dead: c.isDead(),
      anim: c.animationState?.index,
    };
  }

  function diffEffects(before, after) {
    const remaining = [...before];
    const added = [];
    for (const e of after) {
      const i = remaining.indexOf(e);
      if (i >= 0) remaining.splice(i, 1);
      else added.push(e);
    }
    return { added, removed: remaining };
  }

  function describeChange(who, b, a) {
    const parts = [];
    if (a.hp !== b.hp) parts.push(`HP ${b.hp}→${a.hp}`);
    if (a.dead && !b.dead) parts.push('died');
    const moved = a.pos.distanceTo(b.pos);
    if (moved > 0.75) parts.push(`moved ${moved.toFixed(1)}m`);
    const { added, removed } = diffEffects(b.effects, a.effects);
    if (added.length) parts.push(`+${added.join(', +')}`);
    if (removed.length) parts.push(`-${removed.join(', -')}`);
    return parts.length ? `${who}: ${parts.join('; ')}` : '';
  }

  /** Run an ability; if the target resisted it, try again (up to RESIST_RETRIES times) so luck doesn't decide */
  const RESIST_RETRIES = 2;
  async function runAbility(ability) {
    let result = await runOne(ability);
    for (let i = 0; i < RESIST_RETRIES && result.status !== 'works' && result.happened.some((h) => h.startsWith('target:') && /ForceResisted/.test(h)); i++) {
      const retry = await runOne(ability);
      retry.notes.push(`retried: target resisted ${i + 1}x`);
      result = retry;
    }
    return result;
  }

  async function runOne(ability) {
    const result = {
      kind: ability.kind,
      id: ability.id,
      label: ability.label,
      name: ability.name,
      group: ability.group,
      script: ability.script || '',
      status: 'fails',
      resolved: false,
      happened: [],
      calls: [],
      missing: [],
      missingResources: [],
      undefinedReturns: [],
      errors: [],
      notes: [],
    };
    current = { calls: new Set(), missing: new Set(), undefinedReturns: new Set(), errors: [], caster: null, impacted: false, featAttack: null };

    let caster, target;
    try {
      const droidTarget = /DROID/i.test(ability.label);
      const rangedFeat = ability.kind === 'feat' && ability.category === '0x1111';
      // Customized, so the HP override applies; they keep their templates' classes, feats and powers
      caster = await spawn(rangedFeat ? 'Sith Assault Trooper' : 'Dark Jedi Master', { name: 'Bench Caster', factionId: 2, hp: 120, barkText: '', customized: true }, 0);
      target = await spawn(droidTarget ? 'War Droid Mark II' : 'Sith Trooper', { name: 'Bench Target', factionId: 1, hp: 120, barkText: '', customized: true }, 4);
      if (!caster || !target) throw new Error('could not spawn the caster and target');
      current.caster = caster;
      caster.maxForcePoints = BENCH_FP;
      caster.forcePoints = BENCH_FP;
      caster.currentForce = BENCH_FP;
      // Healing needs someone hurt
      caster.subtractHP(40);
      target.subtractHP(40);
      caster.combatData.lastForcePowerUsed = undefined;
      await sleep(400);

      const recipient = ability.friendly && !ability.hostile ? caster : target;
      const before = { caster: snapshot(caster), target: snapshot(target) };
      let item;
      const t0 = performance.now();

      if (ability.kind === 'spell') {
        new GS.TalentSpell(ability.id).useTalentOnObject(recipient, caster);
      } else if (ability.kind === 'feat') {
        new GS.TalentFeat(ability.id).useTalentOnObject(recipient, caster);
      } else if (ability.kind === 'item') {
        item = await K.GMSpawner.createItemFromResRefAsync(ability.id);
        caster.inventory.push(item);
        result.notes.push(`stack ${item.getStackSize ? item.getStackSize() : '?'}`);
        item.useItemOnObject(caster, recipient);
      }

      // Wait for it to resolve: the impact script ran (spells, items) or the feat attack was rolled (feats)
      const resolved = () => (ability.kind === 'feat' && ability.spellId < 0 ? !!current.featAttack : current.impacted);
      while (performance.now() - t0 < RESOLVE_TIMEOUT && !resolved()) await sleep(50);
      result.resolved = resolved();
      result.seconds = +((performance.now() - t0) / 1000).toFixed(1);
      if (current.featAttack) result.notes.push(`attack ${ATTACK_RESULTS[current.featAttack.result] || current.featAttack.result}${current.featAttack.damage ? `, ${current.featAttack.damage} damage` : ''}`);

      // Hostile creatures carry on fighting after an ability; stop them so only the ability is measured
      const calm = () => {
        for (const c of [caster, target]) {
          c.clearAllActions();
          c.combatRound.clearActions();
          c.combatData.combatState = false;
        }
      };
      if (result.resolved) {
        await sleep(400); // let the cast animation finish handing over to the impact
        G.assignFaction(target, 2);
        calm();
      }
      const settleUntil = performance.now() + SETTLE_TIME;
      while (performance.now() < settleUntil) {
        if (result.resolved) calm();
        await sleep(100);
      }

      const after = { caster: snapshot(caster), target: snapshot(target) };
      result.happened = [describeChange('caster', before.caster, after.caster), describeChange('target', before.target, after.target)].filter(Boolean);

      const spellRowForCost = ability.kind === 'spell' ? spellRow(ability.id) : null;
      if (spellRowForCost && num(spellRowForCost.forcepoints, 0) > 0) {
        const spent = before.caster.fp - after.caster.fp;
        result.notes.push(spent > 0 ? `spent ${spent} FP` : 'spent no FP');
        if (spent > 0 && after.caster.engineFp === before.caster.engineFp) result.notes.push('engine getFP() did not change');
      }
      if (item) {
        const stillHas = caster.inventory.includes(item);
        result.notes.push(stillHas ? `item left, stack ${item.getStackSize ? item.getStackSize() : '?'}` : 'item used up');
      }
    } catch (e) {
      current.errors.push(`bench: ${String(e && e.message || e).slice(0, 200)}`);
    } finally {
      for (const c of [caster, target]) {
        try { if (c) G.deleteObject(c); } catch (e) {}
      }
      resetArena();
    }

    result.calls = [...current.calls].sort();
    result.missing = [...current.missing].sort();
    result.undefinedReturns = [...current.undefinedReturns].sort();
    // Models and sounds the engine couldn't find are cosmetic; list them apart from real failures
    const isResource = (e) => /Resource not found/i.test(e);
    result.missingResources = [...new Set(current.errors.filter(isResource).map((e) => (e.match(/ResRef:\s*(\S+)/) || [])[1] || e))];
    result.errors = [...new Set(current.errors.filter((e) => !isResource(e)))].slice(0, 6);

    // A script that throws part-way, or calls a missing function (which leaves its stack unbalanced), leaves
    // state behind on its parsed instructions, and the next ability using the same script then fails too.
    // Drop the parsed scripts and delayed module events so every ability is measured in a clean arena.
    if (result.errors.length || result.missing.length) {
      resetArena(true);
      result.notes.push('reset arena after error');
    }
    current = null;

    // works: resolved, something visible happened, and nothing missing or failing
    // partly works: resolved but something is missing or failed, or nothing visible happened
    // fails: never resolved, or the bench itself hit an error
    if (!result.resolved || result.errors.some((e) => e.startsWith('bench:'))) {
      result.status = 'fails';
    } else if (result.missing.length || result.errors.length || !result.happened.length) {
      result.status = 'partial';
    } else {
      result.status = 'works';
    }
    return result;
  }

  function resetArena(clearScripts = false) {
    try { if (GS.module?.eventQueue) GS.module.eventQueue.length = 0; } catch (e) {}
    const area = GS.module?.area;
    if (area) {
      for (const s of area.spellInstances || []) { try { s?.dispose?.(); } catch (e) {} }
      try { if (area.spellInstances) area.spellInstances.length = 0; } catch (e) {}
      for (const aoe of [...(area.areaOfEffects || [])]) { try { aoe?.destroy?.(); } catch (e) {} }
      for (const txt of area.textSprites || []) { try { txt?.dispose?.(); } catch (e) {} }
      try { if (area.textSprites) area.textSprites.length = 0; } catch (e) {}
    }
    try { K.ProjectileManager.Clear(); } catch (e) {}
    if (clearScripts) {
      try { K.NWScript.scripts.clear(); } catch (e) {}
    }
  }

  window.AbilityBench = {
    setup,
    listSpells,
    listFeats,
    itemTemplates,
    /** Usable items among the given templates (the runner scans in batches to show progress) */
    listItems,
    runOne: runAbility,
    resetArena,
    implementedFunctionCount() {
      const actions = (GS.GameKey === K.GameEngineType.TSL ? K.NWScriptDefK2 : K.NWScriptDefK1).Actions;
      const defs = Object.values(actions);
      return { total: defs.length, implemented: defs.filter((d) => typeof d.action === 'function').length };
    },
  };
})();

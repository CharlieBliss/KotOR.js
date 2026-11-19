// The game table export: load KotOR II (npm run dev serving it), dump the tables the Careers rules lean on, and check every id and resref
// the Careers data assumes against the game's own. Writes kotor2-tables.json and kotor2-careers-check.json to OUT_DIR
// (default: here). Run: npm run gm:table-export
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const REPO = process.env.REPO || path.join(__dirname, '..'), OUT_DIR = process.env.OUT_DIR || '.';
const lib = require(path.join(REPO, 'scripts/lib/game-window'));
lib.configureApp(app, 'kotor-table-export');
process.on('unhandledRejection', (e) => { console.error('FAILED:', e && e.stack || e); app.exit(1); });

app.whenReady().then(async () => {
  const w = lib.createGameWindow({ title: 'Table export', show: true });
  await lib.bootToMenu(w, 'http://localhost:8080/game/?key=tsl', { timeout: 300000 });
  await lib.evalIn(w, (K) => { K.GameState.EnterGMMode(); return true; });
  await lib.waitFor(w, 'gm', (K) => !!(K.GameState.module && K.GameState.module.readyToProcessEvents && K.GMManager.active && !K.GameState.loadingTextures), 200000);

  const out = await lib.evalIn(w, async (K) => {
    const T = (name) => K.GameState.TwoDAManager.datatables.get(name);
    const tlk = (id) => { const n = Number(id); if (!(n >= 0)) return ''; try { return K.GameState.TLKManager.GetStringById(n)?.Value || ''; } catch (e) { return ''; } };
    const v = (x) => (x === undefined || x === null || x === '****' || x === -1 || x === '-1' ? null : x);
    const pick = (table, cols, withName) => {
      const t = T(table);
      if (!t) return null;
      const rows = {};
      for (const [i, r] of Object.entries(t.rows)) {
        const o = {};
        for (const c of cols) o[c] = v(r[c]);
        if (withName) o.text = tlk(r[withName]);
        rows[i] = o;
      }
      return rows;
    };
    const tables = {
      spells: pick('spells', ['label', 'usertype', 'forcepoints', 'prerequisites', 'range', 'forcehostile', 'forcefriendly', 'iconresref', 'impactscript', 'forbiditemmask', 'guardian', 'consular', 'sentinel'], 'name'),
      feat: pick('feat', ['label', 'icon', 'prereqfeat1', 'prereqfeat2', 'allclassescanuse', 'category', 'successor'], 'name'),
      appearance: pick('appearance', ['label', 'modeltype', 'race', 'racetex', 'modela', 'modelb', 'normalhead', 'backuphead', 'sizecategory'], null),
      portraits: pick('portraits', ['baseresref', 'appearancenumber', 'appearance_s', 'appearance_l', 'forpc', 'sex', 'lowgore'], null),
      baseitems: pick('baseitems', ['label', 'weaponwield', 'weapontype', 'rangedweapon', 'equipableslots', 'reqfeat0', 'reqfeat1', 'armortype', 'itemclass', 'droidorhuman'], 'name'),
      skills: pick('skills', ['label', 'keyability', 'droidcanuse', 'npccanuse'], 'name'),
      classes: pick('classes', ['label', 'hitdie', 'attackbonustable', 'forcedie', 'spellgaintable', 'skillstable', 'featstable', 'primaryabil'], 'name'),
      racialtypes: pick('racialtypes', ['label', 'appearance', 'playerrace'], 'name'),
    };

    const report = [];
    const issue = (area, what, detail) => report.push({ area, ok: false, what, detail });
    const ok = (area, what, detail) => report.push({ area, ok: true, what, detail });

    // Feats: every feat id the Careers data and seams use, by its CombatFeatType name against feat.2da's label
    const featIds = new Map();
    const addFeat = (id, why) => { if (typeof id === 'number') featIds.set(id, [...(featIds.get(id) || []), why]); };
    for (const id of K.BASELINE_CAREER_FEATS) addFeat(id, 'baseline proficiency');
    for (const s of K.CAREERS_SPECIALIZATIONS) for (const n of s.nodes) if (n.kind === 'feat') addFeat(n.featId, `${s.id} ${n.id} (${n.label})`);
    for (const id of Object.keys(K.COMBAT_FEAT_STRAIN_COST)) addFeat(Number(id), 'paid in Strain');
    for (const name of ['ARMOUR_PROF_LIGHT', 'ARMOUR_PROF_MEDIUM', 'ARMOUR_PROF_HEAVY']) addFeat(K.CombatFeatType[name], 'armour blocks Force powers');
    const featName = (id) => Object.keys(K.CombatFeatType).find((k) => K.CombatFeatType[k] === id);
    for (const [id, why] of featIds) {
      const row = tables.feat?.[id];
      const name = featName(id) || '?';
      if (!row) issue('feats', `${name} (${id})`, `no feat.2da row; used for ${why.join(', ')}`);
      else {
        const norm = (s) => String(s || '').toUpperCase().replace(/^FEAT_/, '').replace(/[^A-Z0-9]/g, '');
        // (its label, or the name players see: Master Flurry is labelled WHIRLWIND_ATTACK in the game's table)
        const same = norm(row.label).includes(norm(name).replace(/ARMOUR/, 'ARMOR')) || norm(name).replace(/ARMOUR/, 'ARMOR').includes(norm(row.label)) || norm(row.label) === norm(name)
          || norm(row.text).replace(/ARMOR/, 'ARMOUR') === norm(name) || norm(row.text) === norm(name);
        (same ? ok : issue)('feats', `${name} (${id})`, `feat.2da: ${row.label} "${row.text}"; used for ${why.join(', ')}`);
      }
    }

    // Force powers: the starter powers and the Push tree
    for (const p of K.CAREERS_STARTER_POWERS) {
      const row = tables.spells?.[p.spellId];
      if (!row) issue('powers', `${p.name} (${p.spellId})`, 'no spells.2da row');
      else (row.label === p.label ? ok : issue)('powers', `${p.name} (${p.spellId})`, `spells.2da: ${row.label} "${row.text}", ${row.forcepoints} FP, range ${row.range}, needs ${row.prerequisites || 'nothing'}`);
    }
    for (const tree of K.CAREERS_POWER_TREES) {
      for (const id of K.powerTreeSpellIds(tree)) {
        const row = tables.spells?.[id];
        ok('powers', `${tree.name} family: ${id}`, row ? `${row.label} "${row.text}", ${row.forcepoints} FP, range ${row.range}, needs ${row.prerequisites || 'nothing'}` : 'MISSING');
      }
    }

    // Species: default appearance (and its model type) and portrait
    for (const s of K.CAREERS_SPECIES) {
      const a = tables.appearance?.[s.defaultAppearanceId];
      if (!a) issue('species', `${s.name} appearance ${s.defaultAppearanceId}`, 'no appearance.2da row');
      else (String(a.modeltype).toUpperCase() === s.modelType ? ok : issue)('species', `${s.name} appearance ${s.defaultAppearanceId}`, `${a.label}, model type ${a.modeltype} (the data says ${s.modelType}), race ${a.race}, model ${a.modela || a.race}`);
      const p = tables.portraits?.[s.defaultPortraitId];
      (p ? ok : issue)('species', `${s.name} portrait ${s.defaultPortraitId}`, p ? `${p.baseresref} (appearance ${p.appearancenumber}, forpc ${p.forpc}, sex ${p.sex})` : 'no portraits.2da row');
    }

    // Starting kits: every item exists, and what it is
    const kitItems = [];
    for (const c of K.CAREERS_LIST) {
      const kit = c.startingKit;
      for (const [slot, resRef] of [['right hand', kit.rightHand], ['left hand', kit.leftHand], ['armour', kit.armor], ['droid armour', kit.droidArmor]]) {
        if (resRef) kitItems.push({ career: c.name, slot, resRef });
      }
      for (const it of kit.items || []) kitItems.push({ career: c.name, slot: `x${it.stack}`, resRef: it.resRef });
    }
    for (const k of kitItems) {
      let item = null;
      try { item = await K.GMSpawner.createItemFromResRefAsync(k.resRef); } catch (e) { item = null; }
      const base = item?.getBaseItemId?.() ?? item?.baseItemId;
      const b = tables.baseitems?.[base];
      (item && b ? ok : issue)('kits', `${k.career} ${k.slot}: ${k.resRef}`, item ? `"${item.getName?.()}", base item ${base} ${b?.label || '?'} (needs feat ${b?.reqfeat0 ?? 'none'})` : 'no such item template');
      // A new character of the career can use it: every feat its base item needs is one they start with
      if (item && b) {
        const career = K.CAREERS_LIST.find((c) => c.name === k.career);
        const start = K.CareersRules.derive(K.GMCareersCharacters.blank('human', career.id)).featIds;
        const needs = [b.reqfeat0, b.reqfeat1].filter((f) => f !== null && f !== undefined).map(Number);
        const missing = needs.filter((f) => !start.includes(f));
        (missing.length ? issue : ok)('kits', `a new ${k.career} can use ${k.resRef}`, missing.length ? `needs ${missing.map((f) => `${featName(f) || f} (${f})`).join(', ')}, which a new ${k.career} doesn't have` : 'yes');
      }
    }

    // Talent icons, through the game's texture loader (it searches the GUI texture packs); a power's own icon and a
    // made-up name show the check can tell found from missing
    const hasTexture = async (name) => { try { return !!(await K.TextureLoader.Load(name, true)); } catch (e) { return false; } };
    const control = { real: await hasTexture('ip_push'), madeUp: await hasTexture('zz_not_a_texture') };
    (control.real && !control.madeUp ? ok : issue)('talent icons', 'the icon check itself', `ip_push found: ${control.real}, a made-up name found: ${control.madeUp}`);
    for (const t of K.CAREERS_TALENTS) {
      const found = await hasTexture(t.icon);
      (found ? ok : issue)('talent icons', `${t.name}: ${t.icon}`, found ? 'found' : 'no texture by that name');
    }

    // Skills: the engine skill each Careers skill drives
    for (const def of K.CAREER_SKILLS) {
      if (def.engineSkill === undefined) continue;
      const row = tables.skills?.[def.engineSkill];
      const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
      (row && norm(row.label).startsWith(norm(def.id).slice(0, 5)) ? ok : issue)('skills', `${def.name} → skills.2da ${def.engineSkill}`, row ? `${row.label} "${row.text}"` : 'no row');
    }

    // Placeholder classes, and the base items the rules name
    for (const [id, why] of [[0, 'non-Force placeholder (Soldier)'], [3, 'Force-sensitive placeholder (Jedi Guardian)']]) {
      const row = tables.classes?.[id];
      (row ? ok : issue)('classes', `class ${id}: ${why}`, row ? `${row.label} "${row.text}", force die ${row.forcedie}, spell table ${row.spellgaintable}` : 'no row');
    }
    for (const id of [8, 9, 10]) {
      const row = tables.baseitems?.[id];
      (row && /saber/i.test(`${row.label} ${row.text}`) ? ok : issue)('base items', `${id}: counted as a lightsaber`, row ? `${row.label} "${row.text}", wield ${row.weaponwield}` : 'no row');
    }
    // Every weapon's wield type, for combatSkillForWeapon
    const wields = {};
    for (const [i, r] of Object.entries(tables.baseitems || {})) {
      if (r.weaponwield === null || r.weaponwield === undefined) continue;
      (wields[r.weaponwield] = wields[r.weaponwield] || []).push(`${i} ${r.label}`);
    }
    const W = K.WeaponWield;
    const wieldName = (n) => Object.keys(W).find((k) => W[k] === Number(n)) || '?';
    for (const [n, list] of Object.entries(wields)) ok('weapon wield', `wield ${n} (${wieldName(n)})`, list.join(', '));
    // Armour and the proficiency each needs (TalentSpell.isBlockedByArmor reads requiredfeat0)
    for (const [i, r] of Object.entries(tables.baseitems || {})) {
      if (!/armor|robe|underwear|plating/i.test(String(r.label))) continue;
      ok('armour', `${i} ${r.label}`, `"${r.text}", needs feat ${r.reqfeat0 ?? 'none'} (${featName(Number(r.reqfeat0)) || '-'}), droid or human ${r.droidorhuman}`);
    }
    return { tables, report };
  });

  fs.writeFileSync(path.join(OUT_DIR, 'kotor2-tables.json'), JSON.stringify(out.tables, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, 'kotor2-careers-check.json'), JSON.stringify(out.report, null, 1));
  const problems = out.report.filter((r) => !r.ok);
  for (const r of out.report) console.log(`${r.ok ? 'ok  ' : 'BAD '} [${r.area}] ${r.what} — ${r.detail}`);
  console.log(`\n${out.report.length - problems.length} fine, ${problems.length} to look at`);
  app.exit(problems.length ? 1 : 0);
});

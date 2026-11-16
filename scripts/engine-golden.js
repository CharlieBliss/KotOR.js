/**
 * Engine golden dump: a before/after check for engine refactors.
 *
 * Loads a few modules in normal play (not GM mode) in one game window and, for each, writes what the engine
 * read from the game files: the area's save data (every object's save() GFF) and values derived from it
 * (abilities, AC, saves, equipped items, loaded scripts, lock state...). The dump is taken just before the
 * area's spawn scripts run, so it doesn't depend on scripts or timing.
 *
 * Run it before a change and after, then diff the two folders; a structural refactor should produce no diff.
 *
 * Usage:  npx electron scripts/engine-golden.js <output folder> [module ...]
 * Environment: GM_E2E_URL (default http://localhost:8080). Needs the dev server (`npm run dev`) running.
 */
const { app } = require('electron');
const { configureApp, createGameWindow, evalIn, waitFor, bootToMenu } = require('./lib/game-window');
const fs = require('fs');
const path = require('path');

const BASE_URL = (process.env.GM_E2E_URL || 'http://localhost:8080').replace(/\/$/, '');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('.js') && a !== '.');
const OUT_DIR = path.resolve(args[0] || 'engine-golden');
const MODULES = args.length > 1 ? args.slice(1) : ['danm13', 'danm14aa', 'danm14ab', 'danm15'];
const LOAD_TIMEOUT = 90000;

// Its own browser profile, so it can run beside other game windows
configureApp(app, 'kotor-engine-golden');

const log = (msg) => console.log(msg);

/** Runs in the page: hook ModuleArea.initAreaObjects so the dump is taken before spawn scripts run */
const installDumpHook = (KotOR) => {
  if (window.__goldenHooked) return true;
  window.__goldenHooked = true;
  const proto = KotOR.ModuleArea.prototype;
  const original = proto.initAreaObjects;
  proto.initAreaObjects = async function (...a) {
    try {
      window.__goldenDump = window.__goldenBuild(KotOR, this);
    } catch (e) {
      window.__goldenDump = { error: String(e && e.stack || e) };
    }
    return original.apply(this, a);
  };

  window.__goldenBuild = (KotOR, area) => {
    const safe = (fn) => { try { const v = fn(); return v === undefined ? null : v; } catch (e) { return `threw: ${e.message}`; } };
    const scriptNames = (o) => Object.keys(o.scripts || {}).sort().map((k) => `${k}=${o.scripts[k] && o.scripts[k].name}`);
    const slots = Object.entries(KotOR.ModuleCreatureArmorSlot).filter(([, v]) => typeof v === 'number');
    const base = (o) => ({
      id: o.id, tag: safe(() => o.getTag()), name: safe(() => o.getName()), resref: safe(() => o.getTemplateResRef()),
      position: [o.position.x, o.position.y, o.position.z].map((n) => Math.round(n * 1000) / 1000),
      faction: o.factionId, scripts: scriptNames(o),
    });
    const creature = (c) => ({
      ...base(c),
      hp: safe(() => [c.getHP(), c.getMaxHP()]), fp: safe(() => [c.getFP(), c.getMaxFP()]),
      ac: safe(() => c.getAC()),
      abilities: safe(() => [c.getSTR(), c.getDEX(), c.getCON(), c.getINT(), c.getWIS(), c.getCHA()]),
      baseAbilities: safe(() => [c.getSTR(false), c.getDEX(false), c.getCON(false), c.getINT(false), c.getWIS(false), c.getCHA(false)]),
      saves: safe(() => [c.getFortitudeSave(), c.getReflexSave(), c.getWillSave()]),
      bab: safe(() => c.getBaseAttackBonus()), level: safe(() => c.getTotalClassLevel()),
      skills: safe(() => (c.skills || []).map((s, i) => c.getSkillLevel(i))),
      feats: safe(() => c.getFeats().map((f) => f.id).sort((a, b) => a - b)),
      slots: Object.fromEntries(slots.map(([k, v]) => [k, safe(() => { const it = c.getItemInSlot(v); return it ? it.getTemplateResRef() : null; })])),
      inventory: safe(() => (c.inventory || []).map((i) => i.getTemplateResRef())),
      appearance: c.appearance, portrait: safe(() => c.getPortraitResRef()), speed: safe(() => [c.getWalkSpeed(), c.getRunSpeed()]),
      weaponType: safe(() => c.getEquippedWeaponType()),
    });
    const lockable = (o) => ({
      ...base(o), locked: safe(() => o.isLocked()), key: safe(() => o.requiresKey()), useable: safe(() => o.isUseable()),
      open: o.openState, hp: safe(() => [o.getHP(), o.getMaxHP()]),
      saves: safe(() => [o.getFortitudeSave(), o.getReflexSave(), o.getWillSave()]),
      inventory: safe(() => (o.inventory || []).map((i) => i.getTemplateResRef())),
    });
    const party = KotOR.GameState.PartyManager.party || [];
    const saved = area.save();
    return {
      module: KotOR.GameState.module.filename,
      git: saved.git.toJSON(),
      are: saved.are.toJSON(),
      party: party.map((p) => ({ derived: creature(p), save: safe(() => p.save().toJSON()) })),
      creatures: area.creatures.map(creature),
      placeables: area.placeables.map(lockable),
      doors: area.doors.map(lockable),
      triggers: area.triggers.map(base),
      encounters: area.encounters.map(base),
      sounds: area.sounds.map(base),
      stores: area.stores.map(base),
      waypoints: area.waypoints.map(base),
    };
  };
  return true;
};

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const win = createGameWindow({ title: 'Engine golden' });
  await bootToMenu(win, `${BASE_URL}/game/`);
  await evalIn(win, installDumpHook);

  let failed = 0;
  for (const mod of MODULES) {
    try {
      await evalIn(win, (KotOR, name) => {
        const PM = KotOR.GameState.PartyManager;
        if (!PM.PlayerTemplate) {
          PM.PlayerTemplate = PM.GeneratePlayerTemplate();
          PM.ActualPlayerTemplate = PM.PlayerTemplate;
        }
        window.__goldenDump = null;
        KotOR.GameState.LoadModule(name);
        return true;
      }, mod);
      await waitFor(win, `${mod} to load`, (KotOR) => !!window.__goldenDump && !KotOR.GameState.loadingModule, LOAD_TIMEOUT);
      const json = await evalIn(win, () => JSON.stringify(window.__goldenDump, null, 1));
      fs.writeFileSync(path.join(OUT_DIR, `${mod}.json`), json + '\n');
      const counts = await evalIn(win, () => { const d = window.__goldenDump; return d.error ? d.error : `${d.creatures.length} creatures, ${d.placeables.length} placeables, ${d.doors.length} doors, ${d.triggers.length} triggers`; });
      log(`${mod}: ${counts}`);
    } catch (e) {
      failed++;
      log(`${mod}: FAILED ${e.message}`);
    }
  }
  win.destroy();
  return failed === 0;
}

app.whenReady().then(async () => {
  let ok = false;
  try { ok = await run(); } catch (e) { log(`FAILED: ${e.stack || e.message}`); }
  app.exit(ok ? 0 : 1);
});

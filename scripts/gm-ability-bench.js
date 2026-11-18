/**
 * Ability test bench.
 *
 * Boots the game in GM mode and tries every force power and creature ability (spells.2da), usable item
 * (items that cast a spell when used) and combat feat (feat.2da) in isolation, then reports what actually
 * happened to each: works, partly works (and what's missing), or fails. The report also ranks the engine
 * script functions that are missing by how many abilities each one blocks — the to-do list for making
 * abilities work, and the check that later changes don't break any.
 *
 * Writes bench-results/ability-bench.md and bench-results/ability-bench.json.
 *
 * Usage:  npm run bench:abilities [-- --only=spells,items,feats] [-- --match=REGEX] [-- --show]
 *   --only   which kinds to run (default: all three)
 *   --match  only abilities whose label or name matches (e.g. --match=HEAL|PUSH)
 *   --show   show the game window instead of rendering offscreen
 *
 * Environment: GM_E2E_URL (default http://localhost:8080). If nothing is serving it, `npm run dev` is
 * started for the run and stopped afterwards.
 */
const { app, BrowserWindow } = require('electron');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_URL = (process.env.GM_E2E_URL || 'http://localhost:8080').replace(/\/$/, '');
const SHOW = process.argv.includes('--show');
const STRICT_RESTART = process.argv.includes('--strict-restart');
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const ONLY = (arg('only') || 'spells,items,feats').split(',').map((s) => s.trim()).filter(Boolean);
const MATCH = arg('match') ? new RegExp(arg('match'), 'i') : null;
const SCENE = 'danm14aa';
const BOOT_TIMEOUT = 180000;
const OUT_DIR = path.resolve(__dirname, '..', 'bench-results');

// The bench restarts the game by replacing its window; don't let Electron quit in between
app.on('window-all-closed', () => {});
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const t0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${msg}`);

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
  devServer = spawn('npm run dev', { cwd: path.resolve(__dirname, '..'), shell: true, stdio: 'ignore', detached: process.platform !== 'win32' });
  const deadline = Date.now() + BOOT_TIMEOUT;
  while (Date.now() < deadline) {
    if (await isServing()) {
      try {
        if ((await fetch(`${BASE_URL}/game/game.js`)).ok) return;
      } catch (e) {}
    }
    await sleep(2000);
  }
  throw new Error(`Dev server did not start serving ${BASE_URL} with game files.`);
}

function stopDevServer() {
  if (!devServer) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${devServer.pid} /T /F`, { stdio: 'ignore' });
    else process.kill(-devServer.pid, 'SIGTERM');
  } catch (e) {}
  devServer = null;
}

// ---------------------------------------------------------------------------
// Game window
// ---------------------------------------------------------------------------

async function bootGame() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: SHOW,
    title: 'Ability bench',
    webPreferences: { backgroundThrottling: false, offscreen: !SHOW },
  });
  if (!SHOW) win.webContents.setFrameRate(30);
  const ev = (src) => win.webContents.executeJavaScript(src, true);
  const waitFor = async (src, timeout, what) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try { if (await ev(src)) return; } catch (e) {}
      await sleep(300);
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  // A load can fail transiently (the dev server rebuilding, a window just torn down); retry a few times
  const load = async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        await win.loadURL(`${BASE_URL}/game/`);
        return;
      } catch (e) {
        if (attempt >= 5) throw e;
        await sleep(2000 * attempt);
      }
    }
  };
  await load();
  // Accept the EULA once for this browser profile, then reload
  let accepted = null;
  const deadline = Date.now() + BOOT_TIMEOUT;
  while (!accepted && Date.now() < deadline) {
    accepted = await ev(`(() => { const raw = localStorage.getItem('acceptEULA'); if (!raw) return null; const s = JSON.parse(raw); const k = Object.keys(s); if (!k.length) return null; if (k.every((x) => s[x].accepted)) return 'already'; k.forEach((x) => s[x].accepted = true); localStorage.setItem('acceptEULA', JSON.stringify(s)); return 'set'; })()`).catch(() => null);
    if (!accepted) await sleep(300);
  }
  if (accepted === 'set') await load();
  await waitFor(`!!(window.KotOR && KotOR.GameState.Ready && KotOR.GameState.MenuManager && KotOR.GameState.MenuManager.MainMenu)`, BOOT_TIMEOUT, 'the main menu');
  await ev(fs.readFileSync(path.join(__dirname, 'bench', 'ability-bench.page.js'), 'utf8'));
  return { win, ev };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const STATUS_LABEL = { works: '✅ works', partial: '⚠️ partly', fails: '❌ fails' };
const cell = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function writeReport(results, meta) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'ability-bench.json'), JSON.stringify({ meta, results }, null, 2));

  const count = (list, status) => list.filter((r) => r.status === status).length;
  const lines = [];
  lines.push('# Ability bench');
  lines.push('');
  lines.push(`Run ${meta.date} in \`${meta.scene}\` — ${results.length} abilities, ${meta.seconds}s. Script functions implemented: ${meta.functions.implemented} of ${meta.functions.total}.`);
  lines.push('');
  lines.push('Each ability is used on a fresh caster and target with the NPC AI off, through the engine\'s own path and the game\'s own impact script. **Works**: it resolved, something visible happened, nothing missing or failing. **Partly**: it resolved, but a script function was missing, something threw, or nothing visible happened. **Fails**: it never resolved.');
  lines.push('');
  lines.push('| Kind | Works | Partly | Fails |');
  lines.push('|---|---|---|---|');
  const groups = [...new Set(results.map((r) => r.group))];
  for (const g of groups) {
    const list = results.filter((r) => r.group === g);
    lines.push(`| ${g} | ${count(list, 'works')} | ${count(list, 'partial')} | ${count(list, 'fails')} |`);
  }
  lines.push(`| **All** | **${count(results, 'works')}** | **${count(results, 'partial')}** | **${count(results, 'fails')}** |`);
  lines.push('');

  // Engine-wide problems seen across many abilities
  const engineFp = results.filter((r) => r.notes.includes('engine getFP() did not change')).length;
  const noFp = results.filter((r) => r.notes.includes('spent no FP')).length;
  if (engineFp || noFp) {
    lines.push('## Engine issues');
    lines.push('');
    if (engineFp) lines.push(`- **Force points:** ${engineFp} powers spent force points, but \`getFP()\` still reports the old amount (it ignores \`currentForce\`, unlike \`getHP()\`). Players never see their force points go down.`);
    if (noFp) lines.push(`- **Free powers:** ${noFp} powers with a force point cost spent none.`);
    lines.push('');
  }

  // The to-do list: missing script functions by how many abilities they block
  const missing = new Map();
  for (const r of results) for (const fn of r.missing) missing.set(fn, [...(missing.get(fn) || []), r.label]);
  lines.push('## Missing script functions');
  lines.push('');
  if (!missing.size) {
    lines.push('None were called.');
  } else {
    lines.push('| Function | Abilities that call it | Examples |');
    lines.push('|---|---|---|');
    for (const [fn, labels] of [...missing.entries()].sort((a, b) => b[1].length - a[1].length)) {
      lines.push(`| \`${fn}\` | ${labels.length} | ${cell(labels.slice(0, 4).join(', '))}${labels.length > 4 ? ', …' : ''} |`);
    }
  }
  lines.push('');

  // Models and sounds that didn't load (cosmetic)
  const resources = new Map();
  for (const r of results) for (const res of (r.missingResources || [])) resources.set(res, [...(resources.get(res) || []), r.label]);
  if (resources.size) {
    lines.push('## Models and sounds not found');
    lines.push('');
    lines.push("Visual or audio only; the ability's effect isn't affected.");
    lines.push('');
    lines.push('| Resource | Abilities |');
    lines.push('|---|---|');
    for (const [res, labels] of [...resources.entries()].sort((a, b) => b[1].length - a[1].length)) {
      lines.push(`| \`${cell(res)}\` | ${labels.length}: ${cell(labels.slice(0, 4).join(', '))}${labels.length > 4 ? ', …' : ''} |`);
    }
    lines.push('');
  }

  // Errors, grouped
  const errors = new Map();
  for (const r of results) for (const e of r.errors) errors.set(e, [...(errors.get(e) || []), r.label]);
  lines.push('## Errors');
  lines.push('');
  if (!errors.size) {
    lines.push('None.');
  } else {
    lines.push('| Error | Abilities |');
    lines.push('|---|---|');
    for (const [e, labels] of [...errors.entries()].sort((a, b) => b[1].length - a[1].length)) {
      lines.push(`| ${cell(e)} | ${labels.length}: ${cell(labels.slice(0, 4).join(', '))}${labels.length > 4 ? ', …' : ''} |`);
    }
  }
  lines.push('');

  for (const g of groups) {
    lines.push(`## ${g}`);
    lines.push('');
    lines.push('| Ability | Result | What happened | Notes | Missing / failing |');
    lines.push('|---|---|---|---|---|');
    for (const r of results.filter((x) => x.group === g)) {
      const problems = [
        ...r.missing.map((m) => `missing \`${m}\``),
        ...r.errors.map((e) => cell(e)),
        ...(r.missingResources || []).map((m) => `no model/sound \`${cell(m)}\``),
      ].join('; ');
      const notes = r.notes.filter((n) => n !== 'engine getFP() did not change');
      const what = r.resolved ? (r.happened.join('; ') || 'nothing visible') : `never resolved${r.seconds ? ` (${r.seconds}s)` : ''}`;
      lines.push(`| ${cell(r.name)} \`${cell(r.label)}\` | ${STATUS_LABEL[r.status]} | ${cell(what)} | ${cell(notes.join('; '))} | ${problems} |`);
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(OUT_DIR, 'ability-bench.md'), lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function run() {
  await ensureDevServer();
  log('Booting the game...');
  let { win, ev } = await bootGame();
  const setup = await ev(`AbilityBench.setup(${JSON.stringify(SCENE)})`);
  log(`In GM mode on ${setup.scene}`);

  // A script that goes wrong can keep running in the background (delayed commands, lingering effects) and
  // break whatever is tested next. After any ability that errored or called a missing function, start over
  // with a fresh game so every ability is measured on its own.
  const restart = async () => {
    if (!win.isDestroyed()) win.destroy();
    ({ win, ev } = await bootGame());
    await ev(`AbilityBench.setup(${JSON.stringify(SCENE)})`);
  };
  let restarts = 0;

  let abilities = [];
  if (ONLY.includes('spells')) abilities.push(...await ev('AbilityBench.listSpells()'));
  if (ONLY.includes('feats')) abilities.push(...await ev('AbilityBench.listFeats()'));
  if (ONLY.includes('items')) {
    // Finding usable items means loading every item template; do it in batches so progress shows
    const templates = await ev('AbilityBench.itemTemplates()');
    const BATCH = 50;
    for (let i = 0; i < templates.length; i += BATCH) {
      abilities.push(...await ev(`AbilityBench.listItems(${JSON.stringify(templates.slice(i, i + BATCH))})`));
      log(`Scanned ${Math.min(i + BATCH, templates.length)}/${templates.length} item templates for usable items`);
    }
  }
  if (MATCH) abilities = abilities.filter((a) => MATCH.test(a.label) || MATCH.test(a.name));
  const byKind = (k) => abilities.filter((a) => a.kind === k).length;
  log(`Testing ${abilities.length} abilities: ${byKind('spell')} spells, ${byKind('feat')} feats, ${byKind('item')} items. Expect about ${Math.ceil(abilities.length * 5 / 60)} minutes.`);

  const meta = () => ({
    date: new Date().toISOString(),
    scene: setup.scene,
    seconds: Math.round((Date.now() - t0) / 1000),
    functions,
  });
  const functions = await ev('AbilityBench.implementedFunctionCount()');

  const results = [];
  for (let i = 0; i < abilities.length; i++) {
    const a = abilities[i];
    let r;
    try {
      r = await ev(`AbilityBench.runOne(${JSON.stringify(a)})`);
    } catch (e) {
      r = { ...a, status: 'fails', resolved: false, happened: [], calls: [], missing: [], missingResources: [], undefinedReturns: [], errors: [`bench: ${e.message}`], notes: [] };
    }
    results.push(r);
    const mark = r.status === 'works' ? '✔' : r.status === 'partial' ? '~' : '✘';
    log(`${String(i + 1).padStart(3)}/${abilities.length} ${mark} ${a.kind} ${a.label}${r.missing.length ? ` — missing ${r.missing.join(', ')}` : ''}${r.status === 'fails' && r.errors[0] ? ` — ${r.errors[0]}` : ''}`);
    // Keep the report current, so an interrupted run still leaves results
    if ((i + 1) % 10 === 0) writeReport(results, meta());
    const fatalError = r.errors.some((e) => e.startsWith('bench:'));
    if ((fatalError || (STRICT_RESTART && (r.errors.length || r.missing.length))) && i + 1 < abilities.length) {
      restarts++;
      await restart();
    }
  }
  log(`Restarted the game ${restarts} time${restarts === 1 ? '' : 's'} to keep abilities isolated`);

  writeReport(results, meta());
  const count = (s) => results.filter((r) => r.status === s).length;
  log(`Done: ${count('works')} work, ${count('partial')} partly, ${count('fails')} fail. Report: ${path.relative(process.cwd(), path.join(OUT_DIR, 'ability-bench.md'))}`);
  if (!win.isDestroyed()) win.destroy();
}

app.whenReady().then(async () => {
  let code = 0;
  try {
    await run();
  } catch (e) {
    log(`Bench failed: ${e.stack || e.message}`);
    code = 1;
  } finally {
    stopDevServer();
    app.exit(code);
  }
});

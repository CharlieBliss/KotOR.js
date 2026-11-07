/**
 * Scene catalog export for the kotor-gm-scenes Claude skill.
 *
 * Boots the game (dev server on :8080, in Electron), reads the installed game's data and writes plain-text
 * reference files the skill searches when it writes a scene plan:
 *   areas.md         every area: its name, entry point, rooms (size, centre) and waypoints
 *   creatures.tsv    creature templates (.utc): name, faction, class and level, HP, look, weapon
 *   placeables.tsv   placeable templates (.utp): name, model, container / useable
 *   models.tsv       placeables.2da: every placeable model, by label
 *   items.tsv        item templates (.uti): name and base item (for loot and gear)
 *
 * Usage:  npm run catalog:scenes -- --game=kotor   (or --game=tsl; default: both)
 * Output: skills/kotor-gm-scenes/reference/catalog/<game>/
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const GAMES = (arg('game') || 'kotor,tsl').split(',').map((s) => s.trim()).filter(Boolean);
const BASE = 'http://localhost:8080';
const OUT = path.join(__dirname, '..', 'skills', 'kotor-gm-scenes', 'reference', 'catalog');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.setPath('userData', path.join(require('os').tmpdir(), 'kotor-catalog-profile'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});

/** Runs in the game page: everything the skill needs from this game */
async function exportCatalog() {
  const K = window.KotOR;
  const T = K.TwoDAManager.datatables;
  const tlk = (n) => { const s = K.TLKManager.GetStringById(Number(n)); return s && s.Value ? String(s.Value).replace(/\s+/g, ' ').trim() : ''; };
  const locName = (field) => { try { const v = field.getCExoLocString().getValue(); return String(v || '').replace(/\s+/g, ' ').trim(); } catch (e) { return ''; } };
  const r1 = (n) => Math.round(n * 10) / 10;
  const keys = K.KEYManager.Key.keys;
  const RT = K.ResourceTypes;
  const out = { areas: [], creatures: [], placeables: [], models: [], items: [], errors: [] };

  // --- Areas -------------------------------------------------------------------------------------
  const files = await K.GameFileSystem.readdir('modules');
  const modules = new Set();
  for (const f of files) {
    const base = String(f).split(/[\\/]/).pop().toLowerCase();
    if (/(_s\.rim|_dlg\.erf|_a\.rim|_adx\.rim|_loc\.mod)$/.test(base)) continue;
    const m = /^(.+)\.(rim|mod)$/.exec(base);
    if (m) modules.add(m[1]);
  }
  for (const name of [...modules].sort()) {
    try {
      const archives = await K.GameState.Module.GetModuleArchives(name);
      if (!archives.length) continue;
      await K.ResourceLoader.InitModuleCache(archives);
      const ifo = new K.GFFObject(await K.ResourceLoader.loadResource(RT.ifo, 'module'));
      const v = (gff, label, d) => gff.RootNode.hasField(label) ? gff.RootNode.getFieldByLabel(label).getValue() : d;
      const entryArea = String(v(ifo, 'Mod_Entry_Area', '')).toLowerCase();
      const area = { module: name, entryArea, name: '', entry: [r1(v(ifo, 'Mod_Entry_X', 0)), r1(v(ifo, 'Mod_Entry_Y', 0))], rooms: [], waypoints: [] };
      try {
        const are = new K.GFFObject(await K.ResourceLoader.loadResource(RT.are, entryArea));
        if (are.RootNode.hasField('Name')) area.name = locName(are.RootNode.getFieldByLabel('Name'));
      } catch (e) {}
      try {
        const git = new K.GFFObject(await K.ResourceLoader.loadResource(RT.git, entryArea));
        if (git.RootNode.hasField('WaypointList')) {
          for (const st of git.RootNode.getFieldByLabel('WaypointList').getChildStructs()) {
            const g = (l, d) => st.hasField(l) ? st.getFieldByLabel(l).getValue() : d;
            const wpName = st.hasField('LocalizedName') ? locName(st.getFieldByLabel('LocalizedName')) : '';
            area.waypoints.push({ tag: String(g('Tag', '')).toLowerCase(), name: wpName, at: [r1(g('XPosition', 0)), r1(g('YPosition', 0))] });
          }
        }
      } catch (e) {}
      try {
        const lyt = new K.LYTObject(await K.ResourceLoader.loadResource(RT.lyt, entryArea));
        for (const room of lyt.rooms) {
          const entry = { name: String(room.name).toLowerCase(), at: [r1(room.position.x), r1(room.position.y)], walkable: 0, size: null, centre: null };
          try {
            const wok = new K.OdysseyWalkMesh(new K.BinaryReader(await K.ResourceLoader.loadResource(RT.wok, entry.name)));
            let areaSum = 0;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, cx = 0, cy = 0;
            for (const face of wok.walkableFaces) {
              const t = face.triangle;
              areaSum += t.getArea();
              for (const p of [t.a, t.b, t.c]) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
              cx += (t.a.x + t.b.x + t.c.x) / 3; cy += (t.a.y + t.b.y + t.c.y) / 3;
            }
            if (wok.walkableFaces.length) {
              entry.walkable = Math.round(areaSum);
              entry.size = [Math.round(maxX - minX), Math.round(maxY - minY)];
              entry.centre = [r1(cx / wok.walkableFaces.length), r1(cy / wok.walkableFaces.length)];
            }
          } catch (e) {}
          area.rooms.push(entry);
        }
      } catch (e) {}
      out.areas.push(area);
    } catch (e) {
      out.errors.push(`${name}: ${e && e.message}`);
    }
  }
  await K.ResourceLoader.InitModuleCache([]);

  // --- Creature templates -----------------------------------------------------------------------
  const utcs = [...new Set(keys.filter((k) => k.resType == RT.utc).map((k) => k.resRef.toLowerCase()))].sort();
  for (const resRef of utcs) {
    const info = await K.GMManager.describeCreatureTemplate(resRef);
    if (!info) continue;
    out.creatures.push(info);
  }

  // --- Placeable templates and models ------------------------------------------------------------
  const plcRows = T.get('placeables').rows;
  for (const row of Object.values(plcRows)) {
    if (!row.label || row.label === '****') continue;
    out.models.push({ id: Number(row.__index), label: row.label, model: row.modelname || '', name: row.strref && row.strref !== '****' ? tlk(row.strref) : '' });
  }
  const utps = [...new Set(keys.filter((k) => k.resType == RT.utp).map((k) => k.resRef.toLowerCase()))].sort();
  for (const resRef of utps) {
    try {
      const R = new K.GFFObject(await K.ResourceLoader.loadResource(RT.utp, resRef)).RootNode;
      const g = (l, d) => R.hasField(l) ? R.getFieldByLabel(l).getValue() : d;
      const appearance = Number(g('Appearance', -1));
      const row = plcRows[appearance] || {};
      out.placeables.push({
        resRef,
        name: R.hasField('LocName') ? locName(R.getFieldByLabel('LocName')) : '',
        model: row.label || '',
        container: !!g('HasInventory', 0),
        useable: !!g('Useable', 0),
        locked: !!g('Locked', 0),
      });
    } catch (e) {}
  }

  // --- Items --------------------------------------------------------------------------------------
  const baseRows = T.get('baseitems').rows;
  const utis = [...new Set(keys.filter((k) => k.resType == RT.uti).map((k) => k.resRef.toLowerCase()))].sort();
  for (const resRef of utis) {
    try {
      const R = new K.GFFObject(await K.ResourceLoader.loadResource(RT.uti, resRef)).RootNode;
      const g = (l, d) => R.hasField(l) ? R.getFieldByLabel(l).getValue() : d;
      const base = baseRows[Number(g('BaseItem', -1))] || {};
      const name = R.hasField('LocalizedName') ? locName(R.getFieldByLabel('LocalizedName')) : '';
      if (!name) continue;
      out.items.push({ resRef, name, base: base.label || '' });
    } catch (e) {}
  }
  return JSON.stringify(out);
}

function writeCatalog(game, data) {
  const dir = path.join(OUT, game);
  fs.mkdirSync(dir, { recursive: true });
  const tsv = (rows) => rows.map((r) => r.map((c) => String(c ?? '').replace(/[\t\n]/g, ' ')).join('\t')).join('\n') + '\n';
  const title = game === 'tsl' ? 'KotOR II' : 'KotOR';

  // Areas
  const lines = [
    `# ${title} areas`,
    '',
    `Every area (module) in ${title}. Use with "area": { "game": "${game}", "module": "<module>" }.`,
    'Coordinates are the area\'s own metres (x east, y north). Rooms are listed biggest first: walkable floor in m²,',
    'its width x depth in metres, and the centre of its floor. Spots: "entry", "room:<room>", "waypoint:<tag>".',
    '',
  ];
  for (const a of data.areas) {
    lines.push(`## ${a.module}${a.name ? ` — ${a.name}` : ''}`);
    lines.push(`entry ${a.entry.join(', ')}`);
    const rooms = [...a.rooms].sort((x, y) => y.walkable - x.walkable);
    lines.push(`rooms (${rooms.length}): ` + rooms.map((r) => `${r.name} ${r.walkable}m²${r.size ? ` ${r.size[0]}x${r.size[1]}` : ''}${r.centre ? ` @${r.centre.join(',')}` : ''}`).join('; '));
    if (a.waypoints.length) {
      lines.push(`waypoints (${a.waypoints.length}): ` + a.waypoints.map((w) => `${w.tag}${w.name && w.name.toLowerCase() !== w.tag ? ` "${w.name}"` : ''} @${w.at.join(',')}`).join('; '));
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(dir, 'areas.md'), lines.join('\n'));

  fs.writeFileSync(path.join(dir, 'creatures.tsv'), tsv([
    ['template', 'name', 'faction', 'classes', 'hp', 'fp', 'appearance', 'weapon'],
    ...data.creatures.map((c) => [c.resRef, c.name, ({ 1: 'hostile', 2: 'friendly', 5: 'neutral' })[c.factionId] || `faction ${c.factionId}`, c.classes, c.hp, c.fp, c.appearanceLabel, [c.rightHandResRef, c.leftHandResRef].filter(Boolean).join('+')]),
  ]));
  fs.writeFileSync(path.join(dir, 'placeables.tsv'), tsv([
    ['template', 'name', 'model', 'container', 'useable', 'locked'],
    ...data.placeables.map((p) => [p.resRef, p.name, p.model, p.container ? 'yes' : '', p.useable ? 'yes' : '', p.locked ? 'yes' : '']),
  ]));
  fs.writeFileSync(path.join(dir, 'models.tsv'), tsv([
    ['appearance', 'model', 'name'],
    ...data.models.map((m) => [m.label, m.model, m.name]),
  ]));
  fs.writeFileSync(path.join(dir, 'items.tsv'), tsv([
    ['template', 'name', 'base item'],
    ...data.items.map((i) => [i.resRef, i.name, i.base]),
  ]));
  console.log(`${game}: ${data.areas.length} areas, ${data.creatures.length} creatures, ${data.placeables.length} placeables, ${data.models.length} models, ${data.items.length} items${data.errors.length ? `, ${data.errors.length} areas unreadable` : ''}`);
}

async function exportGame(game) {
  const win = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const url = `${BASE}/game/?key=${game}`;
  const ev = (s) => win.webContents.executeJavaScript(s, true);
  await win.loadURL(url);
  // The game won't start until its licence is accepted (this profile only). Wait for this game's own entry:
  // the other game's may already be there, accepted.
  const eulaKey = game === 'tsl' ? 'TSL' : 'KOTOR';
  for (let i = 0; i < 600; i++) {
    const r = await ev(`(() => { const raw = localStorage.getItem('acceptEULA'); if(!raw) return 0; const s = JSON.parse(raw); if(!s['${eulaKey}']) return 0; if(s['${eulaKey}'].accepted) return 1; s['${eulaKey}'].accepted = true; localStorage.setItem('acceptEULA', JSON.stringify(s)); return 2; })()`).catch(() => 0);
    if (r === 2) { await win.loadURL(url); break; }
    if (r === 1) break;
    await sleep(300);
  }
  for (let i = 0; i < 900; i++) {
    const ok = await ev(`!!(window.KotOR && KotOR.GameState.Ready && KotOR.GameState.MenuManager && KotOR.GameState.MenuManager.MainMenu)`).catch(() => false);
    if (ok) break;
    await sleep(300);
  }
  const json = await ev(`(${exportCatalog.toString()})()`);
  writeCatalog(game, JSON.parse(json));
  win.destroy();
}

app.whenReady().then(async () => {
  try {
    for (const game of GAMES) await exportGame(game);
  } catch (e) {
    console.error('Catalog export failed:', e);
    process.exitCode = 1;
  }
  app.quit();
});

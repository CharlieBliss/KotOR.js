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
const { app } = require('electron');
const { configureApp, createGameWindow, bootToMenu } = require('./lib/game-window');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const GAMES = (arg('game') || 'kotor,tsl').split(',').map((s) => s.trim()).filter(Boolean);
const BASE = 'http://localhost:8080';
const OUT = path.join(__dirname, '..', 'skills', 'kotor-gm-scenes', 'reference', 'catalog');

configureApp(app, 'kotor-catalog-profile');
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

  /**
   * The area's walkable floor as a grid of FLOOR_CELL-metre cells, each holding the index (1-based) of the
   * room whose floor covers its centre, or 0. Returned with its origin and size; the cells are base64.
   */
  const FLOOR_CELL = 0.5;
  const rasteriseFloor = (rooms, names) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rooms) for (const t of r.tris) for (const [x, y] of t) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    if (!isFinite(minX)) return null;
    const x0 = Math.floor(minX), y0 = Math.floor(minY);
    const w = Math.ceil((maxX - x0) / FLOOR_CELL) + 1, h = Math.ceil((maxY - y0) / FLOOR_CELL) + 1;
    const cells = new Uint8Array(w * h);
    const mark = (x, y, room) => { const i = Math.floor((x - x0) / FLOOR_CELL), j = Math.floor((y - y0) / FLOOR_CELL); if (i >= 0 && j >= 0 && i < w && j < h) cells[j * w + i] = room; };
    const side = (ax, ay, bx, by, px, py) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    for (const r of rooms) {
      for (const [[ax, ay], [bx, by], [cx, cy]] of r.tris) {
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / FLOOR_CELL)), i1 = Math.min(w - 1, Math.floor((Math.max(ax, bx, cx) - x0) / FLOOR_CELL));
        const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) / FLOOR_CELL)), j1 = Math.min(h - 1, Math.floor((Math.max(ay, by, cy) - y0) / FLOOR_CELL));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const px = x0 + (i + 0.5) * FLOOR_CELL, py = y0 + (j + 0.5) * FLOOR_CELL;
          const d1 = side(ax, ay, bx, by, px, py), d2 = side(bx, by, cx, cy, px, py), d3 = side(cx, cy, ax, ay, px, py);
          if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) cells[j * w + i] = r.room;
        }
        // Slivers narrower than a cell still mark the cells their corners and centre are in
        mark(ax, ay, r.room); mark(bx, by, r.room); mark(cx, cy, r.room); mark((ax + bx + cx) / 3, (ay + by + cy) / 3, r.room);
      }
    }
    let bin = '';
    for (let k = 0; k < cells.length; k += 0x8000) bin += String.fromCharCode.apply(null, cells.subarray(k, k + 0x8000));
    return { origin: [x0, y0], cell: FLOOR_CELL, width: w, height: h, rooms: names, cells: btoa(bin) };
  };

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
      const floorFaces = [];
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
              // The importer's room spot (GMScenePlan.roomPoint): the floor triangle centroid nearest the mean of them
              const n = wok.walkableFaces.length;
              const mx = cx / n, my = cy / n;
              let best = null, bestD = Infinity;
              for (const face of wok.walkableFaces) {
                const t = face.triangle;
                const fx = (t.a.x + t.b.x + t.c.x) / 3, fy = (t.a.y + t.b.y + t.c.y) / 3;
                const d = (fx - mx) ** 2 + (fy - my) ** 2;
                if (d < bestD) { bestD = d; best = [fx, fy]; }
              }
              entry.centre = [r1(best[0]), r1(best[1])];
              floorFaces.push({ room: area.rooms.length + 1, tris: wok.walkableFaces.map((fc) => [fc.triangle.a, fc.triangle.b, fc.triangle.c].map((p) => [p.x, p.y])) });
            }
          } catch (e) {}
          area.rooms.push(entry);
        }
      } catch (e) {}
      area.floor = rasteriseFloor(floorFaces, area.rooms.map((r) => r.name));
      out.areas.push(area);
    } catch (e) {
      out.errors.push(`${name}: ${e && e.message}`);
    }
  }
  await K.ResourceLoader.InitModuleCache([]);

  // --- Creature templates -----------------------------------------------------------------------
  const utcs = [...new Set(keys.filter((k) => k.resType == RT.utc).map((k) => k.resRef.toLowerCase()))].sort();
  for (const resRef of utcs) {
    const info = await K.GMSpawner.describeCreatureTemplate(resRef);
    if (!info) continue;
    out.creatures.push(info);
  }

  // --- Placeable templates and models ------------------------------------------------------------
  const plcRows = T.get('placeables').rows;
  /**
   * A model's footprint: the floor its collision walkmesh (.pwk) covers, as "minX,minY,maxX,maxY" in metres
   * around the model's origin, unturned. Empty for models that can be walked through.
   */
  const r2 = (n) => Math.round(n * 100) / 100;
  const footprints = new Map();
  const footprintOf = async (model) => {
    const key = String(model || '').toLowerCase();
    if (!key || key === '****') return '';
    if (footprints.has(key)) return footprints.get(key);
    let fp = '';
    try {
      const buffer = await K.ResourceLoader.loadResource(RT.pwk, key);
      const wm = new K.OdysseyWalkMesh(new K.BinaryReader(buffer));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const v of wm.vertices || []) { x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y); }
      if (isFinite(x0) && x1 - x0 > 0.05 && y1 - y0 > 0.05) fp = [x0, y0, x1, y1].map(r2).join(',');
    } catch (e) {}
    footprints.set(key, fp);
    return fp;
  };
  for (const row of Object.values(plcRows)) {
    if (!row.label || row.label === '****') continue;
    out.models.push({ id: Number(row.__index), label: row.label, model: row.modelname || '', name: row.strref && row.strref !== '****' ? tlk(row.strref) : '', footprint: await footprintOf(row.modelname) });
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
        footprint: await footprintOf(row.modelname),
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
    'its width x depth in metres, and its spot point (@x,y: where "room:<room>" puts things, always on its floor).',
    'Spots: "entry", "room:<room>", "waypoint:<tag>".',
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

  // Floors: each area's walkable-floor grid, for the plan checker (skills/kotor-gm-scenes/scripts/layout.py)
  const floors = {};
  for (const a of data.areas) {
    if (!a.floor) continue;
    const { cells, ...rest } = a.floor;
    floors[a.module] = { ...rest, cells: zlib.deflateSync(Buffer.from(cells, 'base64'), { level: 9 }).toString('base64') };
  }
  fs.writeFileSync(path.join(dir, 'floors.json'), JSON.stringify({
    note: 'Generated by scripts/gm-scene-catalog.js. Per area: origin [x, y] and cell size in metres, width x height cells, and room names. cells is zlib-deflated, then base64: one byte per cell, row by row from the origin (x first). 0 = no floor, n = rooms[n-1].',
    areas: floors,
  }) + '\n');

  fs.writeFileSync(path.join(dir, 'creatures.tsv'), tsv([
    ['template', 'name', 'faction', 'classes', 'hp', 'fp', 'appearance', 'weapon'],
    ...data.creatures.map((c) => [c.resRef, c.name, ({ 1: 'hostile', 2: 'friendly', 5: 'neutral' })[c.factionId] || `faction ${c.factionId}`, c.classes, c.hp, c.fp, c.appearanceLabel, [c.rightHandResRef, c.leftHandResRef].filter(Boolean).join('+')]),
  ]));
  fs.writeFileSync(path.join(dir, 'placeables.tsv'), tsv([
    ['template', 'name', 'model', 'container', 'useable', 'locked', 'footprint'],
    ...data.placeables.map((p) => [p.resRef, p.name, p.model, p.container ? 'yes' : '', p.useable ? 'yes' : '', p.locked ? 'yes' : '', p.footprint || '']),
  ]));
  fs.writeFileSync(path.join(dir, 'models.tsv'), tsv([
    ['appearance', 'model', 'name', 'footprint'],
    ...data.models.map((m) => [m.label, m.model, m.name, m.footprint || '']),
  ]));
  fs.writeFileSync(path.join(dir, 'items.tsv'), tsv([
    ['template', 'name', 'base item'],
    ...data.items.map((i) => [i.resRef, i.name, i.base]),
  ]));
  console.log(`${game}: ${data.areas.length} areas, ${data.creatures.length} creatures, ${data.placeables.length} placeables, ${data.models.length} models, ${data.items.length} items${data.errors.length ? `, ${data.errors.length} areas unreadable` : ''}`);
}

async function exportGame(game) {
  const win = createGameWindow({ title: `Scene catalog (${game})` });
  const ev = (src) => win.webContents.executeJavaScript(src, true);
  await bootToMenu(win, `${BASE}/game/?key=${game}`, { timeout: 120000 });
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

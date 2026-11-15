/**
 * In-game check of a GM scene plan (skills/kotor-gm-scenes), before it's handed over.
 *
 * Imports the plan in GM mode with the game's own importer (the same call as Scenes → Scene plan), then:
 * - records what the importer reported, where every copy actually stands and in which room, and how far that
 *   is from where the offline check (check_plan.py) predicted;
 * - takes screenshots: an overview from above, the players' view from their start, and each actor group up
 *   close;
 * - runs the beats one at a time, letting the world play for a few seconds after each, and records who is
 *   visible, alive and under which order, whether attackers closed in and movers arrived, plus screenshots.
 * It writes report.md and the screenshots to the output folder.
 *
 * Usage:  npm run scene:check -- <plan.json> [--out <folder>] [--beat-seconds 8] [--no-beats]
 * Needs the dev server (npm run dev) with the game files, like scripts/gm-e2e.js.
 */
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE_URL = (process.env.GM_E2E_URL || 'http://localhost:8080').replace(/\/$/, '');
const argv = process.argv.slice(2).filter((a) => !a.endsWith('gm-scene-check.js') && a !== '.');
const opt = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback; };
const PLAN_FILE = argv.find((a, i) => !a.startsWith('--') && !['--out', '--beat-seconds'].includes(argv[i - 1]));
const BEAT_SECONDS = Number(opt('--beat-seconds', 8));
const RUN_BEATS = !argv.includes('--no-beats');
const ROOT = path.resolve(__dirname, '..');
const CHECKER = path.join(ROOT, 'skills', 'kotor-gm-scenes', 'scripts', 'check_plan.py');
const BOOT_TIMEOUT = 180000;
const SCENE_TIMEOUT = 180000;
const PARITY_LIMIT = 1.0;

app.setPath('userData', path.join(os.tmpdir(), 'kotor-scene-check'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(msg);

async function evalIn(win, fn, ...args) {
  const src = `(async () => { const KotOR = window.KotOR; return await (${fn.toString()})(KotOR, ...${JSON.stringify(args)}); })()`;
  return win.webContents.executeJavaScript(src, true);
}

async function waitFor(win, description, fn, timeout, ...args) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await evalIn(win, fn, ...args);
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${description}${last ? ` (last: ${JSON.stringify(last)})` : ''}`);
}

/** Where check_plan.py says everything lands, or null when Python isn't available */
function offlinePrediction(planFile, outDir) {
  const out = path.join(outDir, 'offline-positions.json');
  for (const py of process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python']) {
    try {
      const args = py === 'py' ? ['-I', CHECKER, planFile, '--no-map', '--json', out] : ['-I', CHECKER, planFile, '--no-map', '--json', out];
      let text = '';
      try { text = execFileSync(py, args, { encoding: 'utf8' }); } catch (e) { text = String(e.stdout || ''); }
      if (fs.existsSync(out)) return { positions: JSON.parse(fs.readFileSync(out, 'utf8')), text };
    } catch (e) {}
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// In-page helpers (each runs inside the game window)
// ---------------------------------------------------------------------------------------------------

/** Install window.__sceneCheck: what the check reads and does inside the game */
const installHelpers = (KotOR) => {
  const THREE = window.THREE;
  const GS = KotOR.GameState;
  const r2 = (n) => Math.round(n * 100) / 100;
  const roomOf = (obj) => {
    if (obj.room && obj.room.roomName) return String(obj.room.roomName).toLowerCase();
    const p = obj.position;
    for (const room of GS.module.area.rooms) {
      const faces = room.collisionManager?.walkmesh?.walkableFaces || [];
      if (faces.some((f) => f.pointInFace2d && f.pointInFace2d(p))) return String(room.roomName).toLowerCase();
    }
    return null;
  };
  const alive = (o) => !o.destroyed && !(o.isDead && o.isDead());
  window.__sceneCheck = {
    /** Every placed copy, by plan id */
    objects() {
      const runner = KotOR.GMScenePlan.active;
      const out = {};
      for (const [id, objs] of runner.objects) {
        out[id] = objs.map((o) => ({
          name: o.getName ? o.getName() : id,
          x: r2(o.position.x), y: r2(o.position.y), z: r2(o.position.z),
          room: roomOf(o),
          hidden: !!o.gmHidden,
          alive: alive(o),
          model: !!(o.model && (o.model.children?.length || o.model.isObject3D)),
          order: KotOR.GMNpcOrders?.getOrder ? (KotOR.GMNpcOrders.getOrder(o)?.kind || null) : null,
          stance: KotOR.GMManager.stanceOf && o.objectType !== undefined && o.getHP ? (KotOR.GMManager.stanceOf(o) || null) : null,
        }));
      }
      return out;
    },
    /** Point the free camera: from [x, y, z] at [x, y, z], or straight down from height h over [x, y] */
    aim(shot) {
      const cam = GS.camera;
      if (!this.saved) this.saved = { near: cam.near, far: cam.far, fov: cam.fov };
      cam.near = this.saved.near; cam.far = this.saved.far; cam.fov = this.saved.fov;
      if (shot.down) {
        const [x, y, floorZ, h] = shot.down;
        cam.position.set(x, y, floorZ + h);
        // Straight down, north up (as FreeLookCamera.setAngles builds it: tilt, then heading)
        cam.up.set(0, 0, 1);
        cam.rotation.set(0.001, 0, 0, 'ZXY');
        // Clip everything more than ~3.5 m above the floor: ceilings and roofs, so the floor shows
        cam.near = Math.max(0.1, h - 3.5);
        cam.far = h + 20;
      } else {
        cam.position.set(...shot.from);
        cam.up.set(0, 0, 1);
        cam.lookAt(new THREE.Vector3(...shot.at));
      }
      cam.updateProjectionMatrix();
      // Hidden things are shown to the GM; the players' view leaves them out
      for (const objs of KotOR.GMScenePlan.active.objects.values()) {
        for (const o of objs) if (o.container) o.container.visible = !(shot.playersView && o.gmHidden) && !o.destroyed;
      }
      return true;
    },
    restore() {
      for (const objs of KotOR.GMScenePlan.active.objects.values()) for (const o of objs) if (o.container) o.container.visible = !o.destroyed;
      return true;
    },
    floorZ(x, y, z) {
      try { return KotOR.GMViewport.getGroundZAt(x, y, z); } catch (e) { return z; }
    },
    /** A plan spot's position, as the importer resolves it */
    spot(spot) {
      const p = KotOR.GMScenePlan.active.resolveSpot(spot);
      return p ? [p.x, p.y, p.z] : null;
    },
    /**
     * Labels over the picture: a coloured dot on each placed copy (and the players' start), with its plan id
     * next to the first copy of each group. Drawn in the page over the canvas, after the camera is aimed.
     */
    markers(groups, start) {
      this.clearMarkers();
      const cam = GS.camera;
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      const rect = GS.canvas.getBoundingClientRect();
      const layer = document.createElement('div');
      layer.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:99999;font:bold 12px sans-serif';
      const toScreen = (x, y, z) => {
        const v = new THREE.Vector3(x, y, z).project(cam);
        return [rect.left + (v.x + 1) / 2 * rect.width, rect.top + (1 - v.y) / 2 * rect.height];
      };
      const dot = (x, y, z, colour, size, label) => {
        const [sx, sy] = toScreen(x, y, z);
        const el = document.createElement('div');
        el.style.cssText = `position:absolute;left:${sx - size / 2}px;top:${sy - size / 2}px;width:${size}px;height:${size}px;border-radius:50%;background:${colour};border:2px solid #000;box-sizing:border-box`;
        layer.appendChild(el);
        if (label) {
          const tag = document.createElement('div');
          tag.textContent = label;
          tag.style.cssText = `position:absolute;left:${sx + size / 2 + 2}px;top:${sy - 8}px;color:#fff;background:rgba(0,0,0,.65);padding:0 3px;border-radius:3px;white-space:nowrap`;
          layer.appendChild(tag);
        }
      };
      const runner = KotOR.GMScenePlan.active;
      for (const g of groups) {
        const objs = (runner.objects.get(g.id) || []).filter((o) => !o.destroyed);
        objs.forEach((o, i) => dot(o.position.x, o.position.y, o.position.z, g.colour, g.kind === 'prop' ? 9 : 13, i === 0 ? g.id + (o.gmHidden ? ' (hidden)' : '') : null));
      }
      if (start) dot(start[0], start[1], start[2], '#ffffff', 16, 'players');
      document.body.appendChild(layer);
      this.markerLayer = layer;
      return true;
    },
    clearMarkers() {
      if (this.markerLayer) { this.markerLayer.remove(); this.markerLayer = null; }
      return true;
    },
    /**
     * A camera spot dist metres from the target that stands on floor and can see it: the angle nearest
     * prefer (radians, 0 = north) first, then the others around it
     */
    viewpoint(target, dist, prefer) {
      const area = GS.module.area;
      const rooms = [];
      GS.group.rooms.traverse((o) => { if (o.isMesh) rooms.push(o); });
      const aim = new THREE.Vector3(target[0], target[1], target[2] + 1.2);
      const ray = new THREE.Raycaster();
      const tries = [];
      for (let k = 0; k < 16; k++) tries.push(prefer + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * (Math.PI / 8));
      for (const scale of [1, 0.7, 1.4]) {
        for (const a of tries) {
          const x = target[0] - Math.sin(a) * dist * scale, y = target[1] + Math.cos(a) * dist * scale;
          const probe = new THREE.Vector3(x, y, target[2]);
          if (area.isPointWalkable && !area.isPointWalkable(probe)) continue;
          const z = this.floorZ(x, y, target[2] + 1) + 1.9;
          const eye = new THREE.Vector3(x, y, z);
          const dir = aim.clone().sub(eye);
          const len = dir.length();
          ray.set(eye, dir.normalize());
          ray.far = len - 0.5;
          if (ray.intersectObjects(rooms, false).length) continue;
          return [x, y, z];
        }
      }
      return null;
    },
  };
  try { GS.CursorManager.cursor.visible = false; } catch (e) {}
  // Leave the GM panel out of the pictures
  const style = document.createElement('style');
  style.textContent = '.gm-panel-root, .gm-toolbar, .gm-drawer { display: none !important; }';
  document.head.appendChild(style);
  return true;
};

// ---------------------------------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------------------------------

async function run() {
  if (!PLAN_FILE || !fs.existsSync(PLAN_FILE)) throw new Error('Usage: npm run scene:check -- <plan.json> [--out <folder>]');
  const plan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
  const slug = path.basename(PLAN_FILE).replace(/\.json$/i, '');
  const OUT = path.resolve(opt('--out', path.join(ROOT, 'scene-check', slug)));
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (/\.(png|md)$/.test(f)) fs.unlinkSync(path.join(OUT, f));

  const findings = [];
  const sections = [];
  const shots = [];
  const errors = [];

  log(`Offline check (check_plan.py)...`);
  const offline = offlinePrediction(path.resolve(PLAN_FILE), OUT);
  if (!offline) findings.push('Python not found: no comparison with the offline check.');

  const win = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { backgroundThrottling: false, offscreen: true } });
  win.webContents.setFrameRate(30);
  win.webContents.on('console-message', (event) => {
    const message = String(event.message || '');
    if ((event.level === 'error' || event.level === 3) && /Uncaught|Unhandled|TypeError|ReferenceError/i.test(message)) errors.push(message.split('\n')[0].slice(0, 240));
  });

  const key = plan.content === 'tsl' ? 'tsl' : 'kotor';
  const url = `${BASE_URL}/game/?key=${key}`;
  log(`Booting ${key}...`);
  await win.loadURL(url);
  const eulaKey = key === 'tsl' ? 'TSL' : 'KOTOR';
  const accepted = await waitFor(win, 'the EULA state', (K, k) => {
    const raw = localStorage.getItem('acceptEULA');
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!s[k]) return false;
    if (s[k].accepted) return 'already';
    s[k].accepted = true;
    localStorage.setItem('acceptEULA', JSON.stringify(s));
    return 'set';
  }, BOOT_TIMEOUT, eulaKey);
  if (accepted === 'set') await win.loadURL(url);
  await waitFor(win, 'the main menu', (K) => !!(K && K.GameState && K.GameState.Ready && K.GameState.MenuManager.MainMenu), BOOT_TIMEOUT);

  log(`Importing "${plan.title}"...`);
  await evalIn(win, (K) => { K.GameState.EnterGMMode(); return true; });
  await waitFor(win, 'GM mode', (K) => !!(K.GameState.gmMode && K.GameState.module && K.GameState.module.readyToProcessEvents && K.GMManager.active), SCENE_TIMEOUT);
  const imported = await evalIn(win, async (K, p) => {
    const runner = await K.GMScenePlan.import(p);
    return { log: runner ? [...runner.log] : ['import returned nothing'], start: runner?.playerStart ? [runner.playerStart.x, runner.playerStart.y, runner.playerStart.z] : null };
  }, plan);
  await waitFor(win, 'the scene to settle', (K) => !!(K.GameState.module && K.GameState.module.readyToProcessEvents && !K.GameState.loadingTextures), SCENE_TIMEOUT);
  await sleep(2000);
  await evalIn(win, installHelpers);

  // --- What the importer did --------------------------------------------------------------------
  for (const line of imported.log) findings.push(`Importer: ${line}`);
  const placed = await evalIn(win, () => window.__sceneCheck.objects());
  const lines = ['## Where everything stands', '', '| id | copy | x, y | room | hidden | model | stance | offline (x, y) | off by |', '|---|---|---|---|---|---|---|---|---|'];
  const groups = [...(plan.props || []).map((p) => ({ ...p, kind: 'prop' })), ...(plan.actors || []).map((a) => ({ ...a, kind: 'actor' }))];
  for (const g of groups) {
    const got = placed[g.id] || [];
    const want = Math.max(1, Math.min(20, g.count || 1));
    if (got.length < want) findings.push(`${g.kind} "${g.id}": ${got.length} of ${want} placed.`);
    const predicted = offline?.positions?.placed?.[g.id] || [];
    got.forEach((o, i) => {
      const pr = predicted[i];
      const off = pr ? Math.hypot(pr[0] - o.x, pr[1] - o.y) : null;
      // Only for copies the offline check put straight on the floor: ones it had to move are already flagged there
      if (off !== null && off > PARITY_LIMIT && !(pr[3] > 0)) findings.push(`${o.name} (${g.id}) stands ${off.toFixed(1)} m from where the offline check put it (${pr[0]}, ${pr[1]} → ${o.x}, ${o.y}): the offline map is wrong here; trust this one.`);
      if (!o.model) findings.push(`${o.name} (${g.id}) has no model loaded.`);
      lines.push(`| ${g.id} | ${o.name} | ${o.x}, ${o.y} | ${o.room || '—'} | ${o.hidden ? 'yes' : ''} | ${o.model ? '' : 'MISSING'} | ${o.stance || ''} | ${pr ? `${pr[0]}, ${pr[1]}` : ''} | ${off !== null ? off.toFixed(1) + ' m' : ''} |`);
    });
  }
  sections.push(lines.join('\n'));

  // --- Screenshots ------------------------------------------------------------------------------
  const all = Object.values(placed).flat();
  const pts = all.concat(imported.start ? [{ x: imported.start[0], y: imported.start[1], z: imported.start[2] }] : []);
  const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const floorZ = imported.start ? imported.start[2] : (all[0]?.z || 0);
  // Frame the scene: the view is 1.6 wide for 1 tall
  const tall = Math.max((maxY - minY) + 8, ((maxX - minX) + 8) / 1.6, 12);
  const height = (tall / 2) / Math.tan((55 * Math.PI / 180) / 2);
  const COLOURS = { hostile: '#e0402f', friendly: '#3fa0f0', neutral: '#f0c83c' };
  const markerGroups = groups.map((g) => ({ id: g.id, kind: g.kind, colour: g.kind === 'prop' ? '#c07830' : (COLOURS[g.faction] || '#cccccc') }));

  const shoot = async (name, shot, caption, decorate) => {
    await evalIn(win, (K, s) => window.__sceneCheck.aim(s), shot);
    await sleep(700);
    if (decorate) { await decorate(); await sleep(150); }
    const image = await win.webContents.capturePage();
    const file = `${String(shots.length + 1).padStart(2, '0')}-${name}.png`;
    fs.writeFileSync(path.join(OUT, file), image.toPNG());
    shots.push({ file, caption });
    await evalIn(win, () => window.__sceneCheck.restore());
  };

  const facingSpot = typeof plan.players?.facing === 'string' && plan.players.facing.startsWith('toward:')
    ? await evalIn(win, (K, sp) => window.__sceneCheck.spot(sp), plan.players.facing.slice(7)) : null;
  const playersFacing = () => {
    const f = plan.players?.facing;
    if (!imported.start) return null;
    if (typeof f === 'number') {
      const a = f * Math.PI / 180;
      return [imported.start[0] + Math.sin(a) * 10, imported.start[1] + Math.cos(a) * 10];
    }
    if (facingSpot) return [facingSpot[0], facingSpot[1]];
    // Facing left out: the importer turns them toward the scene; its middle stands in
    return [cx, cy];
  };

  const overview = async (name, caption) => {
    await shoot(name, { down: [cx, cy, floorZ, height] }, caption, async () => {
      await evalIn(win, (K, g, st) => window.__sceneCheck.markers(g, st), markerGroups, imported.start);
    });
    await evalIn(win, () => window.__sceneCheck.clearMarkers());
  };

  const takeSet = async (label) => {
    await overview(`${label}-overview`, `${label}: overview from above (north up; ceilings clipped). Dots: white = players' start, blue = friendly, red = hostile, yellow = neutral, orange = props; labelled with plan ids`);
    const look = playersFacing();
    if (imported.start && look) {
      const [x, y, z] = imported.start;
      await shoot(`${label}-players-view`, { from: [x, y, z + 1.7], at: [look[0], look[1], z + 1.4], playersView: true }, `${label}: what the players see from their start (hidden things left out)`);
    }
  };

  log('Screenshots of the set-up...');
  await takeSet('setup');
  for (const g of plan.actors || []) {
    const got = (placed[g.id] || []).filter((o) => o.alive);
    if (!got.length) continue;
    const gx = got.reduce((s, o) => s + o.x, 0) / got.length, gy = got.reduce((s, o) => s + o.y, 0) / got.length, gz = got[0].z;
    // From the players' side if that view is clear, else the nearest clear angle around the group
    const reach = 5 + Math.max(...got.map((o) => Math.hypot(o.x - gx, o.y - gy)));
    const prefer = imported.start ? Math.atan2(-(gx - imported.start[0]), gy - imported.start[1]) : 0;
    const eye = await evalIn(win, (K, t, d, p) => window.__sceneCheck.viewpoint(t, d, p), [gx, gy, gz], reach, prefer);
    if (!eye) { findings.push(`No clear view of "${g.id}" from the floor around it: it may be boxed in.`); continue; }
    await shoot(`actor-${g.id}`, { from: eye, at: [gx, gy, gz + 1] }, `"${g.id}" up close${g.hidden ? ' (hidden at the start: the GM sees it, players don\'t)' : ''}`);
  }

  // --- The beats --------------------------------------------------------------------------------
  if (RUN_BEATS) {
    const beatLines = ['## The beats, run one at a time', ''];
    for (let b = 0; b < (plan.beats || []).length; b++) {
      const beat = plan.beats[b];
      const before = await evalIn(win, () => window.__sceneCheck.objects());
      if (b === 0) {
        const early = (plan.actors || []).filter((g) => (before[g.id] || []).filter((o) => o.alive).length < (placed[g.id] || []).filter((o) => o.alive).length);
        if (early.length) findings.push(`Before any beat ran, ${early.map((g) => g.id).join(', ')} lost someone: a fight broke out during set-up (NPCs that notice each other fight, hidden actors included).`);
      }
      const errorsBefore = errors.length;
      const logBefore = await evalIn(win, (K) => K.GMScenePlan.active.log.length);
      log(`Beat ${b + 1}: ${beat.title || ''}`);
      try {
        await evalIn(win, (K, i) => { K.GMScenePlan.active.runBeat(i); return true; }, b);
      } catch (e) {
        findings.push(`Beat ${b + 1} "${beat.title || ''}" threw: ${e.message}`);
      }
      await sleep(BEAT_SECONDS * 1000);
      const after = await evalIn(win, () => window.__sceneCheck.objects());
      const newNotes = await evalIn(win, (K, n) => K.GMScenePlan.active.log.slice(n), logBefore);
      for (const n of newNotes) findings.push(`Beat ${b + 1}: importer: ${n}`);
      for (const e of errors.slice(errorsBefore)) findings.push(`Beat ${b + 1}: error in the game: ${e}`);

      beatLines.push(`### ${b + 1}. ${beat.title || '(untitled)'}`, '', `After ${BEAT_SECONDS} s:`, '');
      for (const g of plan.actors || []) {
        const now = after[g.id] || [];
        const was = before[g.id] || [];
        const shown = now.filter((o) => !o.hidden).length;
        const living = now.filter((o) => o.alive).length;
        const moved = now.length ? now.reduce((s, o, i) => s + (was[i] ? Math.hypot(o.x - was[i].x, o.y - was[i].y) : 0), 0) / now.length : 0;
        const orders = [...new Set(now.map((o) => o.order).filter(Boolean))].join(', ') || '—';
        beatLines.push(`- ${g.id}: ${shown}/${now.length} visible, ${living} alive, order ${orders}, moved ${moved.toFixed(1)} m on average`);
      }
      // Deaths in a beat that sets no fight going: someone fought on their own (often NPCs noticing hidden actors)
      const startsFight = (beat.actions || []).some((x) => (x.do === 'order' && x.order?.kind === 'attack') || (x.do === 'reveal' && (x.ids || []).some((id) => (plan.actors || []).find((a) => a.id === id)?.order?.kind === 'attack')) || x.do === 'faction');
      const fought = !startsFight ? (plan.actors || []).filter((g) => (after[g.id] || []).filter((o) => o.alive).length < (before[g.id] || []).filter((o) => o.alive).length) : [];
      if (fought.length) findings.push(`Beat ${b + 1} "${beat.title || ''}" orders no attack, yet ${fought.map((g) => g.id).join(', ')} lost someone: a fight broke out on its own (NPCs that notice each other fight, hidden actors included).`);
      // Did this beat's orders play out?
      for (const action of beat.actions || []) {
        if (action.do !== 'order' && action.do !== 'reveal') continue;
        for (const id of action.ids || []) {
          const order = action.do === 'order' ? action.order : (plan.actors || []).find((a) => a.id === id)?.order;
          if (!order) continue;
          const now = (after[id] || []).filter((o) => o.alive && !o.hidden);
          const was = before[id] || [];
          if (!now.length) continue;
          if (order.kind === 'attack') {
            const targets = order.target === 'players' ? (imported.start ? [{ x: imported.start[0], y: imported.start[1] }] : []) : (before[order.target] || []).filter((o) => o.alive);
            if (!targets.length) continue;
            const gap = (list) => Math.min(...list.map((o) => Math.min(...targets.map((t) => Math.hypot(o.x - t.x, o.y - t.y)))));
            const g0 = gap(was.length ? was : now), g1 = gap(now);
            const targetsLeft = order.target === 'players' ? 1 : (after[order.target] || []).filter((o) => o.alive).length;
            const downed = order.target === 'players' ? 0 : targets.length - targetsLeft;
            beatLines.push(`- "${id}" attacking "${order.target}": ${g0.toFixed(1)} m apart before, ${g1.toFixed(1)} m after; ${downed} of ${targets.length} down`);
            if (targetsLeft && g1 > 10 && !downed) {
              findings.push(`Beat ${b + 1}: "${id}" attacking "${order.target}" is still ${g1.toFixed(0)} m away after ${BEAT_SECONDS} s (started ${g0.toFixed(0)} m away)${g0 - g1 < 2 ? ' and hardly closed in: blocked, or no path' : ': the fight starts late; place them closer or give the beat time'}.`);
            }
          }
          if (order.kind === 'move') {
            const moved = now.reduce((s, o, i) => s + (was[i] ? Math.hypot(o.x - was[i].x, o.y - was[i].y) : 0), 0) / now.length;
            const dest = await evalIn(win, (K, to) => { const p = K.GMScenePlan.active.placementPoints(to, 1)?.[0]; return p ? [p.x, p.y] : null; }, order.to);
            const away = dest ? Math.min(...now.map((o) => Math.hypot(o.x - dest[0], o.y - dest[1]))) : Infinity;
            if (moved < 1 && away > 3) findings.push(`Beat ${b + 1}: "${id}" was told to move but hasn't moved after ${BEAT_SECONDS} s: no path, or already there.`);
          }
        }
      }
      beatLines.push('');
      const reveals = (beat.actions || []).some((a) => ['reveal', 'movePlayers', 'order'].includes(a.do));
      await overview(`beat${b + 1}-overview`, `After beat ${b + 1} "${beat.title || ''}": overview (markers as above)`);
      if (reveals && imported.start) {
        const look = playersFacing();
        const [x, y, z] = imported.start;
        await shoot(`beat${b + 1}-players-view`, { from: [x, y, z + 1.7], at: [look[0], look[1], z + 1.4], playersView: true }, `After beat ${b + 1}: the players' view`);
      }
    }
    sections.push(beatLines.join('\n'));
  }

  win.destroy();

  // --- Report -----------------------------------------------------------------------------------
  const report = [
    `# Scene check: ${plan.title || slug}`,
    '',
    `Plan: ${path.resolve(PLAN_FILE)}`,
    `Area: ${plan.area?.game}:${plan.area?.module}; content: ${plan.content}. Checked ${new Date().toISOString()}.`,
    '',
    '## Findings',
    '',
    ...(findings.length ? findings.map((f) => `- ${f}`) : ['- None.']),
    '',
    '## Screenshots',
    '',
    'Open each one and compare it with the scene as discussed: who stands where, facing, stances, what the players see first.',
    '',
    ...shots.map((s) => `- ${s.file}: ${s.caption}`),
    '',
    ...sections.flatMap((s) => [s, '']),
  ];
  if (offline?.text) report.push('## Offline check output', '', '```', offline.text.trim(), '```', '');
  fs.writeFileSync(path.join(OUT, 'report.md'), report.join('\n'));
  log(`\n${findings.length} finding(s). Report and ${shots.length} screenshot(s): ${OUT}`);
  for (const f of findings) log(`- ${f}`);
  return true;
}

app.whenReady().then(async () => {
  let ok = false;
  try { ok = await run(); } catch (e) { console.error(`FAILED: ${e.stack || e.message}`); }
  app.exit(ok ? 0 : 1);
});

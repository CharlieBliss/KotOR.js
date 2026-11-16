/**
 * Start a GM session and play in it: a GM window hosting an online session with a scene loaded, and a player
 * window (or several) joined to it as player characters. The windows stay open to play in.
 *
 *   npm run gm:play -- <scene plan .json | module> [options]
 *
 *   npm run gm:play -- C:/Users/me/Downloads/citadel-cantina-brawl.json
 *   npm run gm:play -- 207tel --game tsl
 *   npm run gm:play -- danm14aa --players 2 --level 6
 *
 * Options:
 *   --game kotor|tsl   the game to run (default: the plan's "content", else kotor)
 *   --players N        player windows to open (default 1; 0: just the GM)
 *   --level N          the players' level (default: the plan's party.level, else 6)
 *   --class NAME       their character preset, by any part of its name: guardian, consular, sentinel, marauder,
 *                      soldier, scoundrel (default: the first, a Jedi Guardian)
 *   --name NAME        the first player's name (default Player; more are numbered)
 *   --port N           the relay port (default 7878, or GM_PORT); a relay already running there is used
 *
 * Needs the game's dev server (npm run dev) on http://localhost:8080.
 */
const { app, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { configureApp, createGameWindow, evalIn, waitFor, bootToMenu, sleep } = require('./lib/game-window');
const { startGMRelayServer } = require('./gm-server');

const argv = process.argv.slice(2).filter((a) => !/electron(\.exe)?$/i.test(a) && !a.endsWith('gm-play.js') && a !== '.');
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const target = positional[0];

if (!target) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*|^ \* ?/gm, ''));
  process.exit(2);
}

// A scene plan, or just an area
let plan = null;
if (/\.json$/i.test(target)) {
  try {
    plan = JSON.parse(fs.readFileSync(path.resolve(target), 'utf8'));
  } catch (e) {
    console.error(`Can't read the scene plan ${target}: ${e.message}`);
    process.exit(1);
  }
}
const GAME = String(opt('game', plan?.content || 'kotor')).toLowerCase();
if (!['kotor', 'tsl'].includes(GAME)) { console.error('--game is kotor or tsl'); process.exit(1); }
const PLAYERS = Math.max(0, Math.min(4, Number(opt('players', 1)) || 0));
const LEVEL = Number(opt('level', plan?.party?.level || 6)) || 6;
const CLASS = String(opt('class', '')).toLowerCase();
const NAME = String(opt('name', 'Player'));
const PORT = Number(opt('port', process.env.GM_PORT || 7878));
const RELAY = `ws://localhost:${PORT}`;
const URL = `http://localhost:8080/game/?key=${GAME}`;
const MODULE = plan ? null : target;

configureApp(app, 'kotor-gm-play');
process.on('unhandledRejection', (e) => { console.error('gm:play failed:', e && e.stack || e); });

const portInUse = (port) => new Promise((resolve) => {
  const socket = net.connect(port, '127.0.0.1');
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});
const devServerUp = () => new Promise((resolve) => {
  http.get(URL, (res) => { res.resume(); resolve(res.statusCode < 500); }).on('error', () => resolve(false));
});
const step = (msg) => console.log(`[gm:play] ${msg}`);

app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  if (!(await devServerUp())) {
    console.error(`The game isn't being served at ${URL}. Start it with: npm run dev`);
    app.exit(1);
    return;
  }
  if (await portInUse(PORT)) step(`using the relay already running on port ${PORT}`);
  else { startGMRelayServer({ port: PORT }); step(`relay started on port ${PORT}`); }

  // The GM on the left of the screen, players on the right (stacked when there are several)
  const area = screen.getPrimaryDisplay().workArea;
  const half = Math.floor(area.width / 2);
  const gm = createGameWindow({ show: true, title: 'KotOR.js: GM' });
  gm.setBounds({ x: area.x, y: area.y, width: half, height: area.height });

  step(`starting the GM (${GAME === 'tsl' ? 'KotOR II' : 'KotOR'})...`);
  await bootToMenu(gm, URL, { timeout: 150000 });
  await evalIn(gm, (K, m) => { K.GameState.EnterGMMode(m || undefined); return true; }, MODULE);
  await waitFor(gm, 'GM mode', (K) => !!(K.GameState.gmMode && K.GMManager.active && K.GameState.module && K.GameState.module.readyToProcessEvents), 120000);
  await evalIn(gm, (K, url) => K.GMNetworkManager.hostSession(url, 'GM'), RELAY);
  await waitFor(gm, 'the session to open', (K) => K.GMNetworkManager.role === 'host' && K.GMNetworkManager.connected, 20000);
  step(`hosting a session on ${RELAY}`);

  if (plan) {
    step(`loading the scene "${plan.title || target}"...`);
    const log = await evalIn(gm, async (K, p) => { const r = await K.GMScenePlan.import(p); return r ? [...r.log] : ['the plan could not be imported']; }, plan);
    await waitFor(gm, 'the scene', (K) => !!(K.GameState.module && K.GameState.module.readyToProcessEvents && !K.GameState.loadingTextures && K.GMScenePlan.active), 120000);
    for (const line of log) step(`  ${line}`);
    step(`scene loaded: ${plan.beats?.length || 0} beats wait in Scenes > Scene plan`);
  }

  for (let i = 0; i < PLAYERS; i++) {
    const name = PLAYERS > 1 ? `${NAME} ${i + 1}` : NAME;
    const pl = createGameWindow({ show: true, title: `KotOR.js: ${name}` });
    const tall = Math.floor(area.height / PLAYERS);
    pl.setBounds({ x: area.x + half, y: area.y + i * tall, width: area.width - half, height: tall });
    step(`starting ${name}...`);
    await bootToMenu(pl, URL, { timeout: 150000 });
    await evalIn(pl, (K, url, who, level, cls) => {
      const G = K.GMManager;
      const presets = G.PLAYER_PRESETS || [];
      const preset = (cls && presets.find((p) => [p.name, p.label, p.className].some((s) => String(s || '').toLowerCase().includes(cls)))) || presets[0];
      K.GameState.gmMode = true;
      G.active = true;
      K.GMNetworkManager.joinSession(url, who, {
        name: who, appearanceId: preset.appearanceId, classId: preset.classId,
        character: { ...K.GMCharacters.blank(preset), name: who, level },
      });
      return true;
    }, RELAY, name, LEVEL, CLASS);
    await waitFor(pl, `${name} to join`, (K) => {
      const N = K.GMNetworkManager, me = K.GameState.getCurrentPlayer();
      return !!(N.assignedActorNetId && me && me.gmNetId === N.assignedActorNetId && K.GameState.module && K.GameState.module.readyToProcessEvents);
    }, 150000);
    step(`${name} joined (level ${LEVEL})`);
  }

  gm.focus();
  step('ready. Close the windows (or press Ctrl+C here) to end the session.');
}).catch(async (e) => {
  console.error('gm:play failed:', e && e.message || e);
  // What the windows showed, to see why
  const { BrowserWindow } = require('electron');
  for (const [i, win] of BrowserWindow.getAllWindows().entries()) {
    try {
      const file = path.join(require('os').tmpdir(), `gm-play-window-${i}.png`);
      fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
      const text = await Promise.race([win.webContents.executeJavaScript('document.body.innerText.slice(0, 300)', true), sleep(3000).then(() => '(the page didn\'t answer)')]);
      console.error(`  ${win.getTitle()}: ${String(text).replace(/\s+/g, ' ')}\n  screenshot: ${file}`);
    } catch (err) {}
  }
  app.exit(1);
});

/**
 * What the Electron check scripts (gm-e2e, gm-scene-check, engine-golden, gm-scene-catalog) share: a game
 * window that renders quickly while staying out of the way, booting it to the main menu, and noticing when the
 * page breaks so a run fails at once instead of waiting out a timeout.
 *
 * Measured on the dev build: the game reaches its main menu in about 5 s and loads a scene in about 5 s, so
 * timeouts here are a minute or two, not several.
 */
const { BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** How long one poll of waitFor may take before it's asked again */
const POLL_LIMIT_MS = 5000;

/** Keep hidden windows running at full speed. Call before app is ready. */
function configureApp(app, profileName) {
  if (profileName) app.setPath('userData', path.join(os.tmpdir(), profileName));
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}

/**
 * A game window. Unless show is set it sits off the edge of the desktop: a real on-screen window, so it renders
 * with the GPU at the display's frame rate (offscreen windows draw in software, at 30 fps), without being in the
 * way. Screenshots (capturePage) work either way.
 */
function createGameWindow({ show = false, title = 'KotOR.js check', width = 1280, height = 800 } = {}) {
  const win = new BrowserWindow({
    width, height, title,
    show: false,
    ...(show ? {} : { x: -4000, y: -4000, skipTaskbar: true, focusable: false }),
    webPreferences: { backgroundThrottling: false },
  });
  if (show) win.show(); else win.showInactive();
  win.pageErrors = [];
  win.webContents.on('console-message', (event) => {
    const message = String(event.message || '');
    const isError = event.level === 'error' || event.level === 3;
    if (isError && /Uncaught|Unhandled/i.test(message)) win.pageErrors.push(message.split('\n')[0].slice(0, 240));
  });
  return win;
}

/** Run fn(KotOR, ...args) in the page and return its result */
async function evalIn(win, fn, ...args) {
  const src = `(async () => { const KotOR = window.KotOR; return await (${fn.toString()})(KotOR, ...${JSON.stringify(args)}); })()`;
  return win.webContents.executeJavaScript(src, true);
}

/**
 * Poll until fn(KotOR, ...args) returns something truthy (return booleans or plain values: an object that
 * can't be copied out of the page counts as a failure). Fails at once if the page throws an uncaught error.
 */
async function waitFor(win, description, fn, timeout, ...args) {
  const deadline = Date.now() + timeout;
  let last;
  const errorsBefore = (win.pageErrors || []).length;
  while (Date.now() < deadline) {
    try {
      // A poll sent while the page is navigating (it reloads itself once, early on) can go unanswered: give each
      // one a few seconds, then ask again, rather than letting it hold the whole wait
      last = await Promise.race([evalIn(win, fn, ...args), sleep(POLL_LIMIT_MS).then(() => undefined)]);
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    const newErrors = (win.pageErrors || []).slice(errorsBefore);
    if (newErrors.length) throw new Error(`the page failed while waiting for ${description}: ${newErrors[0]}`);
    await sleep(200);
  }
  throw new Error(`timed out after ${Math.round(timeout / 1000)}s waiting for ${description}${last ? ` (last: ${JSON.stringify(last).slice(0, 200)})` : ''}`);
}

/**
 * Load the game page, accept its licence screen in this profile, and wait for the main menu. Waits for this
 * game's own licence entry (?key=tsl is KotOR II): the other game's may already be there, accepted.
 */
async function bootToMenu(win, url, { timeout = 60000 } = {}) {
  const licence = /[?&]key=tsl\b/i.test(url) ? 'TSL' : 'KOTOR';
  await win.loadURL(url);
  const accepted = await waitFor(win, 'the licence state', (KotOR, game) => {
    const raw = localStorage.getItem('acceptEULA');
    if (!raw) return false;
    const state = JSON.parse(raw);
    if (!state[game]) return false;
    const keys = Object.keys(state);
    if (keys.every((k) => state[k].accepted)) return 'already';
    for (const k of keys) state[k].accepted = true;
    localStorage.setItem('acceptEULA', JSON.stringify(state));
    return 'set';
  }, timeout, licence);
  if (accepted === 'set') await win.loadURL(url);
  await waitFor(win, 'the main menu', (KotOR) => !!(KotOR && KotOR.GameState && KotOR.GameState.Ready && KotOR.GameState.MenuManager && KotOR.GameState.MenuManager.MainMenu), timeout);
}

/** Run game time faster (or slower) than real time; checks spend most of their time waiting on it */
async function setGameSpeed(win, scale) {
  if (!scale || scale === 1) return;
  await evalIn(win, (KotOR, s) => { KotOR.GameState.setTimeScale(s); return true; }, scale);
}

module.exports = { sleep, configureApp, createGameWindow, evalIn, waitFor, bootToMenu, setGameSpeed };

/**
 * The dev server for the Electron checks: use the one already serving the game, or start `npm run dev` for the
 * run and stop it afterwards.
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const { sleep } = require('./game-window');

function createDevServer({ baseUrl, timeout = 180000, log = console.log }) {
  let child = null;

  async function isServing() {
    try {
      const res = await fetch(`${baseUrl}/__dev-game/kotor/ls?path=`);
      if (!res.ok) return false;
      const entries = await res.json();
      return Array.isArray(entries) && entries.some((e) => e.name.toLowerCase() === 'chitin.key');
    } catch (e) {
      return false;
    }
  }

  async function ensure() {
    if (await isServing()) {
      log(`Using the dev server already running at ${baseUrl}`);
      return;
    }
    log(`Nothing serving ${baseUrl} with game files; starting \`npm run dev\` for this run...`);
    child = spawn('npm run dev', {
      cwd: path.resolve(__dirname, '..', '..'),
      shell: true,
      stdio: 'ignore',
      detached: process.platform !== 'win32',
    });
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await isServing()) {
        // The game bundle is built alongside the engine library; wait until it is served too
        try {
          const res = await fetch(`${baseUrl}/game/game.js`);
          if (res.ok) return;
        } catch (e) {}
      }
      await sleep(2000);
    }
    throw new Error(`Dev server did not start serving ${baseUrl} with game files. Check KOTOR_GAME_DIR (see scripts/dev-game-files.js).`);
  }

  function stop() {
    if (!child) return;
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
      } else {
        process.kill(-child.pid, 'SIGTERM');
      }
    } catch (e) {}
    child = null;
  }

  return { ensure, stop, isServing };
}

module.exports = { createDevServer };

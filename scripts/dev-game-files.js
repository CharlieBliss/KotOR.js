/**
 * Dev-only game file server.
 *
 * Browsers cannot open a local path like E:\...\swkotor, so in development the webpack dev server
 * exposes the installed game folders read-only under /__dev-game/<key>/. The game app detects this
 * and uses it instead of asking for a folder through the File System Access picker.
 *
 * Override the folders with KOTOR_GAME_DIR / TSL_GAME_DIR.
 */
const fs = require('fs');
const path = require('path');

const GAME_DIRS = {
  kotor: process.env.KOTOR_GAME_DIR || 'E:\\Steam\\steamapps\\common\\swkotor',
  tsl: process.env.TSL_GAME_DIR || 'D:\\SteamLibrary\\steamapps\\common\\Knights of the Old Republic II',
};

/** Resolve a request path inside the game root, refusing anything that escapes it */
function resolveInside(root, relPath) {
  const target = path.resolve(root, String(relPath || '').replace(/^[\\/]+/, ''));
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

function sendJSON(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function listDirectory(res, target) {
  fs.readdir(target, { withFileTypes: true }, (err, dirents) => {
    if (err) return sendJSON(res, 404, { error: 'not found' });
    const entries = [];
    for (const d of dirents) {
      if (d.isDirectory()) {
        entries.push({ name: d.name, kind: 'directory' });
      } else if (d.isFile()) {
        let size = 0;
        try { size = fs.statSync(path.join(target, d.name)).size; } catch (e) {}
        entries.push({ name: d.name, kind: 'file', size });
      }
    }
    sendJSON(res, 200, entries);
  });
}

function sendFile(req, res, target) {
  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) return sendJSON(res, 404, { error: 'not found' });
    let start = 0;
    let end = stat.size - 1;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    if (range) {
      if (range[1]) start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), stat.size - 1);
      if (!range[1] && range[2]) start = Math.max(0, stat.size - Number(range[2]));
      if (start > end || start >= stat.size) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        return res.end();
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    } else {
      res.statusCode = 200;
    }
    res.setHeader('Content-Length', String(stat.size ? end - start + 1 : 0));
    if (req.method === 'HEAD' || stat.size === 0) return res.end();
    fs.createReadStream(target, { start, end }).pipe(res);
  });
}

/**
 * Express-style middleware mounted at /__dev-game
 *   GET /__dev-game/<key>/ls?path=<dir>    -> [{ name, kind, size? }]
 *   GET /__dev-game/<key>/file?path=<file> -> file bytes (supports Range)
 */
function devGameFilesMiddleware(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const url = new URL(req.url, 'http://localhost');
  const match = /^\/([a-z0-9]+)\/(ls|file)$/.exec(url.pathname);
  if (!match) return next();

  const root = GAME_DIRS[match[1]];
  if (!root || !fs.existsSync(path.join(root, 'chitin.key'))) {
    return sendJSON(res, 404, { error: `no game folder configured for "${match[1]}"` });
  }
  const target = resolveInside(root, url.searchParams.get('path'));
  if (!target) return sendJSON(res, 403, { error: 'path outside game folder' });

  if (match[2] === 'ls') return listDirectory(res, target);
  return sendFile(req, res, target);
}

module.exports = { devGameFilesMiddleware, GAME_DIRS };

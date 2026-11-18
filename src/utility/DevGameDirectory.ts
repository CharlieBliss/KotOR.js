/**
 * DevGameDirectory
 *
 * Development-only stand-in for a File System Access directory handle. The webpack dev server exposes
 * locally installed game folders read-only under /__dev-game/<key>/ (see scripts/dev-game-files.js),
 * and these handles implement the subset of the FileSystemDirectoryHandle / FileSystemFileHandle API
 * that GameFileSystem uses, reading files with HTTP Range requests so large BIF archives load lazily.
 *
 * Writes (the game in progress a module change saves, save games) go to an in-memory layer over the
 * folder, never to the installed game: they read back like its files until the page reloads. Without it
 * every write failed, so a module change in dev lost the state of the area left behind.
 *
 * @file DevGameDirectory.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */

const DEV_GAME_BASE = '/__dev-game';

interface DevGameEntry {
  name: string;
  kind: 'file' | 'directory';
  size?: number;
}

function notFound(name: string): DOMException {
  return new DOMException(`A requested file or directory could not be found: ${name}`, 'NotFoundError');
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/**
 * What's been written over one game's folder: files and folders made, and the folder's own entries
 * removed (hidden). A folder removed and made again starts empty (masked: its real entries stay hidden)
 */
export class DevOverlay {
  files = new Map<string, Uint8Array>();
  dirs = new Set<string>();
  removed = new Set<string>();
  masked = new Set<string>();

  private static ancestors(path: string): string[] {
    const parts = path.split('/');
    return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  }

  /** A real entry at path no longer shows: it, or a folder it's in, was removed or made again empty */
  hidesReal(path: string): boolean {
    const chain = DevOverlay.ancestors(path);
    return chain.some((p) => this.removed.has(p)) || chain.slice(0, -1).some((p) => this.masked.has(p));
  }

  /** The real folder's own listing shows nothing (removed, or made again empty) */
  hidesRealListing(dir: string): boolean {
    if (!dir) return false;
    return this.hidesReal(dir) || this.masked.has(dir);
  }

  makeDir(path: string) {
    for (const p of DevOverlay.ancestors(path)) {
      if (this.removed.delete(p)) this.masked.add(p);
      this.dirs.add(p);
    }
  }

  write(path: string, data: Uint8Array) {
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (parent) this.makeDir(parent);
    this.removed.delete(path);
    this.files.set(path, data);
  }

  remove(path: string) {
    const prefix = path + '/';
    for (const key of [...this.files.keys()]) if (key === path || key.startsWith(prefix)) this.files.delete(key);
    for (const key of [...this.dirs]) if (key === path || key.startsWith(prefix)) this.dirs.delete(key);
    for (const key of [...this.masked]) if (key === path || key.startsWith(prefix)) this.masked.delete(key);
    this.removed.add(path);
  }

  /** What's been made directly in a folder */
  entriesIn(dir: string): DevGameEntry[] {
    const out = new Map<string, DevGameEntry>();
    const prefix = dir ? dir + '/' : '';
    const add = (path: string, kind: 'file' | 'directory', size?: number) => {
      if (!path.startsWith(prefix)) return;
      const rest = path.slice(prefix.length);
      if (!rest) return;
      const slash = rest.indexOf('/');
      if (slash >= 0) out.set(rest.slice(0, slash), { name: rest.slice(0, slash), kind: 'directory' });
      else if (!out.has(rest) || kind === 'file') out.set(rest, { name: rest, kind, size });
    };
    for (const d of this.dirs) add(d, 'directory');
    for (const [p, data] of this.files) add(p, 'file', data.byteLength);
    return [...out.values()];
  }
}

const overlays = new Map<string, DevOverlay>();
function overlayOf(gameKey: string): DevOverlay {
  let o = overlays.get(gameKey);
  if (!o) overlays.set(gameKey, (o = new DevOverlay()));
  return o;
}

/** Bytes from what a writable stream is given (a buffer, a view, a Blob, a string, or { data }) */
async function toBytes(chunk: any): Promise<Uint8Array> {
  if (chunk && typeof chunk === 'object' && 'data' in chunk && !(typeof Blob !== 'undefined' && chunk instanceof Blob)) chunk = chunk.data;
  if (chunk instanceof Uint8Array) return new Uint8Array(chunk);
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk.slice(0));
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
  if (typeof Blob !== 'undefined' && chunk instanceof Blob) return new Uint8Array(await chunk.arrayBuffer());
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  return new Uint8Array(0);
}

/** Blob-like view of bytes written in memory, read the way a remote file is */
class DevWrittenFile {
  readonly lastModified: number = 0;
  readonly type: string = 'application/octet-stream';

  constructor(private data: Uint8Array, readonly name: string = '') {}

  get size(): number {
    return this.data.byteLength;
  }

  slice(start: number = 0, end: number = this.size): DevWrittenFile {
    return new DevWrittenFile(this.data.subarray(Math.max(0, start), Math.max(0, Math.min(this.size, end))), this.name);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.data.slice().buffer as ArrayBuffer;
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.data);
  }
}

// Game boot issues thousands of reads at once; Chrome fails fetches with ERR_INSUFFICIENT_RESOURCES
// past a few thousand outstanding requests, so cap concurrency and retry transient failures.
const MAX_CONCURRENT_FETCHES = 16;
const FETCH_RETRIES = 3;
let activeFetches = 0;
const fetchQueue: (() => void)[] = [];

async function devFetch(url: string, init?: RequestInit): Promise<Response> {
  if (activeFetches >= MAX_CONCURRENT_FETCHES) {
    await new Promise<void>((resolve) => fetchQueue.push(resolve));
  }
  activeFetches++;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, init);
        if (res.ok || res.status < 500 || attempt >= FETCH_RETRIES) return res;
      } catch (e) {
        if (attempt >= FETCH_RETRIES) throw e;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  } finally {
    activeFetches--;
    fetchQueue.shift()?.();
  }
}

/**
 * Blob-like view of a remote file; slices fetch only the requested byte range
 */
class DevGameFileSlice {
  constructor(private url: string, private start: number, private end: number) {}

  get size(): number {
    return Math.max(0, this.end - this.start);
  }

  slice(start: number = 0, end: number = this.size): DevGameFileSlice {
    const from = this.start + Math.max(0, start);
    const to = Math.min(this.end, this.start + Math.max(0, end));
    return new DevGameFileSlice(this.url, from, Math.max(from, to));
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    if (this.size <= 0) return new ArrayBuffer(0);
    const res = await devFetch(this.url, { headers: { Range: `bytes=${this.start}-${this.end - 1}` } });
    if (!res.ok) throw new Error(`DevGameDirectory: failed to read ${this.url} (${res.status})`);
    return res.arrayBuffer();
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(await this.arrayBuffer());
  }
}

class DevGameFile extends DevGameFileSlice {
  readonly lastModified: number = 0;
  readonly type: string = 'application/octet-stream';

  constructor(url: string, size: number, readonly name: string) {
    super(url, 0, size);
  }
}

export interface DevWritableStream {
  write(chunk: any): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export class DevGameFileHandle {
  readonly kind = 'file';

  constructor(private gameKey: string, private relPath: string, readonly name: string, private fileSize: number) {}

  async getFile(): Promise<DevGameFile | DevWrittenFile> {
    // Written here: what was written, not the installed file
    const written = overlayOf(this.gameKey).files.get(this.relPath);
    if (written) return new DevWrittenFile(written, this.name);
    const url = `${DEV_GAME_BASE}/${this.gameKey}/file?path=${encodeURIComponent(this.relPath)}`;
    return new DevGameFile(url, this.fileSize, this.name);
  }

  async queryPermission(): Promise<PermissionState> { return 'granted'; }
  async requestPermission(): Promise<PermissionState> { return 'granted'; }

  /** A stream into the in-memory layer: the file is replaced when it's closed, as a real one is */
  async createWritable(): Promise<DevWritableStream> {
    const chunks: Uint8Array[] = [];
    return {
      write: async (chunk: any) => { chunks.push(await toBytes(chunk)); },
      close: async () => {
        const total = chunks.reduce((n, c) => n + c.byteLength, 0);
        const data = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) { data.set(c, at); at += c.byteLength; }
        overlayOf(this.gameKey).write(this.relPath, data);
        this.fileSize = total;
      },
      abort: async () => { chunks.length = 0; },
    };
  }

  async isSameEntry(other: any): Promise<boolean> {
    return other instanceof DevGameFileHandle && other.relPath === this.relPath;
  }
}

export class DevGameDirectoryHandle {
  readonly kind = 'directory';
  private listing?: Promise<DevGameEntry[]>;

  constructor(private gameKey: string, private relPath: string, readonly name: string) {}

  /** The installed folder's entries (fetched once), then what's been written over them */
  async list(): Promise<DevGameEntry[]> {
    const overlay = overlayOf(this.gameKey);
    let real: DevGameEntry[] = [];
    if (!overlay.hidesRealListing(this.relPath)) {
      if (!this.listing) {
        this.listing = devFetch(`${DEV_GAME_BASE}/${this.gameKey}/ls?path=${encodeURIComponent(this.relPath)}`)
          .then((res): Promise<DevGameEntry[]> | DevGameEntry[] => (res.ok ? res.json() : []))
          .catch((): DevGameEntry[] => []);
      }
      real = (await this.listing).filter((e) => !overlay.hidesReal(joinPath(this.relPath, e.name)));
    }
    const made = overlay.entriesIn(this.relPath);
    const names = new Set(made.map((e) => e.name));
    return [...real.filter((e) => !names.has(e.name)), ...made];
  }

  private toHandle(entry: DevGameEntry): DevGameDirectoryHandle | DevGameFileHandle {
    const childPath = joinPath(this.relPath, entry.name);
    return entry.kind === 'directory'
      ? new DevGameDirectoryHandle(this.gameKey, childPath, entry.name)
      : new DevGameFileHandle(this.gameKey, childPath, entry.name, entry.size || 0);
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DevGameDirectoryHandle> {
    const entry = (await this.list()).find((e) => e.kind === 'directory' && e.name === name);
    if (entry) return this.toHandle(entry) as DevGameDirectoryHandle;
    if (!options?.create) throw notFound(name);
    overlayOf(this.gameKey).makeDir(joinPath(this.relPath, name));
    return this.toHandle({ name, kind: 'directory' }) as DevGameDirectoryHandle;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<DevGameFileHandle> {
    const entry = (await this.list()).find((e) => e.kind === 'file' && e.name === name);
    if (entry) return this.toHandle(entry) as DevGameFileHandle;
    if (!options?.create) throw notFound(name);
    overlayOf(this.gameKey).write(joinPath(this.relPath, name), new Uint8Array(0));
    return this.toHandle({ name, kind: 'file', size: 0 }) as DevGameFileHandle;
  }

  async *values(): AsyncGenerator<DevGameDirectoryHandle | DevGameFileHandle> {
    for (const entry of await this.list()) yield this.toHandle(entry);
  }

  async *keys(): AsyncGenerator<string> {
    for (const entry of await this.list()) yield entry.name;
  }

  async *entries(): AsyncGenerator<[string, DevGameDirectoryHandle | DevGameFileHandle]> {
    for (const entry of await this.list()) yield [entry.name, this.toHandle(entry)];
  }

  [Symbol.asyncIterator]() {
    return this.entries();
  }

  /** Off the in-memory layer, or hidden when it's the installed folder's own (that's never touched) */
  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const entry = (await this.list()).find((e) => e.name === name);
    if (!entry) throw notFound(name);
    if (entry.kind === 'directory' && !options?.recursive) {
      const child = this.toHandle(entry) as DevGameDirectoryHandle;
      if ((await child.list()).length) throw new DOMException(`The directory is not empty: ${name}`, 'InvalidModificationError');
    }
    overlayOf(this.gameKey).remove(joinPath(this.relPath, name));
  }

  async resolve(): Promise<null> { return null; }
  async queryPermission(): Promise<PermissionState> { return 'granted'; }
  async requestPermission(): Promise<PermissionState> { return 'granted'; }
  async isSameEntry(other: any): Promise<boolean> {
    return other instanceof DevGameDirectoryHandle && other.relPath === this.relPath && other.gameKey === this.gameKey;
  }
}

export class DevGameDirectory {
  /** Forget everything written over the folders (tests) */
  static resetWrites() {
    overlays.clear();
  }

  /**
   * Returns a root handle for the dev server's copy of the given game, or undefined when the
   * page is not served by the dev server or no folder is configured for that game.
   */
  static async open(gameKey: string): Promise<FileSystemDirectoryHandle | undefined> {
    if (typeof window === 'undefined' || window.location.protocol === 'file:') return undefined;
    const key = String(gameKey || 'kotor').toLowerCase();
    try {
      const res = await fetch(`${DEV_GAME_BASE}/${key}/ls?path=`);
      if (!res.ok) return undefined;
      const entries: DevGameEntry[] = await res.json();
      if (!Array.isArray(entries) || !entries.some((e) => e.kind === 'file' && e.name.toLowerCase() === 'chitin.key')) {
        return undefined;
      }
    } catch {
      return undefined;
    }
    return new DevGameDirectoryHandle(key, '', key) as unknown as FileSystemDirectoryHandle;
  }

  /** A root handle onto a game's folder, without first checking the dev server has it (tests) */
  static handleFor(gameKey: string): DevGameDirectoryHandle {
    return new DevGameDirectoryHandle(String(gameKey).toLowerCase(), '', gameKey);
  }
}

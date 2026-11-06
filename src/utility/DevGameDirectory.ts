/**
 * DevGameDirectory
 *
 * Development-only stand-in for a File System Access directory handle. The webpack dev server exposes
 * locally installed game folders read-only under /__dev-game/<key>/ (see scripts/dev-game-files.js),
 * and these handles implement the subset of the FileSystemDirectoryHandle / FileSystemFileHandle API
 * that GameFileSystem uses, reading files with HTTP Range requests so large BIF archives load lazily.
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

function readOnly(): DOMException {
  return new DOMException('The dev game directory is read-only', 'NoModificationAllowedError');
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
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

export class DevGameFileHandle {
  readonly kind = 'file';

  constructor(private gameKey: string, private relPath: string, readonly name: string, private fileSize: number) {}

  async getFile(): Promise<DevGameFile> {
    const url = `${DEV_GAME_BASE}/${this.gameKey}/file?path=${encodeURIComponent(this.relPath)}`;
    return new DevGameFile(url, this.fileSize, this.name);
  }

  async queryPermission(): Promise<PermissionState> { return 'granted'; }
  async requestPermission(): Promise<PermissionState> { return 'granted'; }
  async createWritable(): Promise<never> { throw readOnly(); }
  async isSameEntry(other: any): Promise<boolean> {
    return other instanceof DevGameFileHandle && other.relPath === this.relPath;
  }
}

export class DevGameDirectoryHandle {
  readonly kind = 'directory';
  private listing?: Promise<DevGameEntry[]>;

  constructor(private gameKey: string, private relPath: string, readonly name: string) {}

  private list(): Promise<DevGameEntry[]> {
    if (!this.listing) {
      this.listing = devFetch(`${DEV_GAME_BASE}/${this.gameKey}/ls?path=${encodeURIComponent(this.relPath)}`)
        .then((res): Promise<DevGameEntry[]> | DevGameEntry[] => (res.ok ? res.json() : []))
        .catch((): DevGameEntry[] => []);
    }
    return this.listing;
  }

  private toHandle(entry: DevGameEntry): DevGameDirectoryHandle | DevGameFileHandle {
    const childPath = joinPath(this.relPath, entry.name);
    return entry.kind === 'directory'
      ? new DevGameDirectoryHandle(this.gameKey, childPath, entry.name)
      : new DevGameFileHandle(this.gameKey, childPath, entry.name, entry.size || 0);
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DevGameDirectoryHandle> {
    if (options?.create) throw readOnly();
    const entry = (await this.list()).find((e) => e.kind === 'directory' && e.name === name);
    if (!entry) throw notFound(name);
    return this.toHandle(entry) as DevGameDirectoryHandle;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<DevGameFileHandle> {
    const entry = (await this.list()).find((e) => e.kind === 'file' && e.name === name);
    if (!entry) throw options?.create ? readOnly() : notFound(name);
    return this.toHandle(entry) as DevGameFileHandle;
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

  async removeEntry(): Promise<never> { throw readOnly(); }
  async resolve(): Promise<null> { return null; }
  async queryPermission(): Promise<PermissionState> { return 'granted'; }
  async requestPermission(): Promise<PermissionState> { return 'granted'; }
  async isSameEntry(other: any): Promise<boolean> {
    return other instanceof DevGameDirectoryHandle && other.relPath === this.relPath && other.gameKey === this.gameKey;
  }
}

export class DevGameDirectory {
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
}

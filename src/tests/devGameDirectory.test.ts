import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { DevGameDirectory } from "@/utility/DevGameDirectory";

// The installed folder, as the dev server lists it: chitin.key, and a Saves folder with one save in it
const LISTINGS: Record<string, any[]> = {
  '': [{ name: 'chitin.key', kind: 'file', size: 10 }, { name: 'Saves', kind: 'directory' }],
  'Saves': [{ name: 'old.sav', kind: 'file', size: 4 }],
};

beforeEach(() => {
  DevGameDirectory.resetWrites();
  (globalThis as any).fetch = jest.fn(async (url: string) => {
    const path = decodeURIComponent(String(url).split('path=')[1] || '');
    return { ok: true, status: 200, json: async () => LISTINGS[path] || [] } as any;
  });
});

afterEach(() => { delete (globalThis as any).fetch; });

const names = async (dir: any) => { const out: string[] = []; for await (const k of dir.keys()) out.push(k); return out.sort(); };
const read = async (file: any) => new TextDecoder().decode(new Uint8Array(await (await file.getFile()).arrayBuffer()));

describe("the dev game folder takes writes in memory (the installed game is never written)", () => {
  test("a folder and file made, written and read back, as a module change's game in progress is", async () => {
    const root = DevGameDirectory.handleFor('tsl');
    const dir = await root.getDirectoryHandle('gameinprogress', { create: true });
    const file = await dir.getFileHandle('601dan.sav', { create: true });
    const stream = await file.createWritable();
    await stream.write(new TextEncoder().encode('ab'));
    await stream.write({ data: 'cd' });
    await stream.close();
    expect(await names(root)).toEqual(['Saves', 'chitin.key', 'gameinprogress']);
    expect(await read(await (await root.getDirectoryHandle('gameinprogress')).getFileHandle('601dan.sav'))).toBe('abcd');
    // Read in pieces, as GameFileSystem does
    const part = (await file.getFile()).slice(1, 3);
    expect(new TextDecoder().decode(new Uint8Array(await part.arrayBuffer()))).toBe('bc');
    expect((globalThis as any).fetch.mock.calls.every((c: any[]) => /\/ls\?/.test(c[0]))).toBe(true);
  });

  test("removed, the folder's own entries are hidden; made again, a folder starts empty", async () => {
    const root = DevGameDirectory.handleFor('tsl');
    await root.removeEntry('Saves', { recursive: true });
    expect(await names(root)).toEqual(['chitin.key']);
    await expect(root.getDirectoryHandle('Saves')).rejects.toThrow();
    const saves = await root.getDirectoryHandle('Saves', { create: true });
    expect(await names(saves)).toEqual([]);
  });

  test("a folder with something in it isn't removed unless recursively; a file written over an installed one reads as written", async () => {
    const root = DevGameDirectory.handleFor('tsl');
    await expect(root.removeEntry('Saves')).rejects.toThrow();
    const saves = await root.getDirectoryHandle('Saves');
    const old = await saves.getFileHandle('old.sav');
    const w = await old.createWritable();
    await w.write('new');
    await w.close();
    expect(await read(await saves.getFileHandle('old.sav'))).toBe('new');
    await saves.removeEntry('old.sav');
    expect(await names(saves)).toEqual([]);
  });
});

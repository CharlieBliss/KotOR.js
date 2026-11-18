import { describe, expect, test } from "@jest/globals";
import { buildKotorTtf, glyphCells } from "@/apps/game/components/gm-panel/kotor/kotorFont";

/** A 32x32 font texture: one 8x8 cell for 'A' (a filled 4x6 block) in its top-left corner, nothing else */
function tinyFont() {
  const width = 32, height = 32;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 1; y < 7; y++) for (let x = 2; x < 6; x++) { const i = (y * width + x) * 4; data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = 255; }
  // The TXI's coordinates: texture space, bottom row first ('A' is code 65)
  const upperleftcoords = [] as { x: number; y: number }[], lowerrightcoords = [] as { x: number; y: number }[];
  for (let c = 0; c < 256; c++) { upperleftcoords.push({ x: 0.75, y: 0.25 }); lowerrightcoords.push({ x: 1, y: 0 }); }
  upperleftcoords[65] = { x: 0, y: 1 };
  lowerrightcoords[65] = { x: 0.25, y: 0.75 };
  return { width, height, data, txi: { numchars: 256, upperleftcoords, lowerrightcoords } };
}

const u32 = (v: DataView, o: number) => v.getUint32(o);
const tagAt = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

describe("KotOR's bitmap font as a TrueType font", () => {
  test("glyph cells come from the TXI, turned to rows from the top", () => {
    const f = tinyFont();
    const a = glyphCells(f.txi, f.width, f.height).find((c) => c.code === 65)!;
    expect(a).toEqual({ code: 65, left: 0, top: 0, width: 8, height: 8 });
  });

  test("it is a well-formed TrueType font: its tables, its checksum, a glyph a character", () => {
    const f = tinyFont();
    const ttf = buildKotorTtf({ width: f.width, height: f.height, data: f.data, cells: glyphCells(f.txi, f.width, f.height) }, 'KotOR Test');
    const v = new DataView(ttf);
    expect(u32(v, 0)).toBe(0x00010000);
    const n = v.getUint16(4);
    const tags: string[] = [];
    const where: Record<string, number> = {};
    for (let i = 0; i < n; i++) { const t = tagAt(v, 12 + i * 16); tags.push(t); where[t] = u32(v, 12 + i * 16 + 8); }
    expect(tags).toEqual(['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post']);
    // The whole font sums to 0xB1B0AFBA once head's adjustment is in
    let sum = 0;
    for (let o = 0; o < ttf.byteLength; o += 4) sum = (sum + u32(v, o)) >>> 0;
    expect(sum).toBe(0xb1b0afba);
    // head: the magic number, 8 font units... a pixel (64) x the cell's 8 rows
    expect(u32(v, where.head + 12)).toBe(0x5f0f3cf5);
    expect(v.getUint16(where.head + 18)).toBe(8 * 64);
    // maxp: .notdef and 224 characters (32..255); 'A' is one rectangle, 4 points
    expect(v.getUint16(where.maxp + 4)).toBe(225);
    expect(v.getUint16(where.maxp + 6)).toBe(4);
    expect(v.getUint16(where.maxp + 8)).toBe(1);
  });
});

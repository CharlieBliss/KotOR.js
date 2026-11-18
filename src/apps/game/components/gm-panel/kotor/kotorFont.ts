/**
 * KotOR's own bitmap font (a GUI font texture and its TXI glyph table) as a TrueType font the page can use in
 * CSS. Each glyph's pixels become rectangles; the result is a real font, so every piece of HUD text can be set in
 * it with font-family alone, as KotOR's menus are.
 */

/** One glyph: where it sits on the font texture, top row first, in pixels */
export interface KotorGlyphCell {
  code: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface KotorFontSource {
  width: number;
  height: number;
  /** RGBA, top row first */
  data: Uint8ClampedArray;
  cells: KotorGlyphCell[];
}

/** Font units a texture pixel */
const UNIT = 64;

/** Glyph cells from a TXI's upper-left / lower-right coordinates (texture space, bottom row first) */
export function glyphCells(txi: { numchars: number; upperleftcoords: { x: number; y: number }[]; lowerrightcoords: { x: number; y: number }[] }, width: number, height: number): KotorGlyphCell[] {
  const cells: KotorGlyphCell[] = [];
  const count = Math.min(txi.numchars || 0, txi.upperleftcoords?.length || 0, txi.lowerrightcoords?.length || 0);
  for (let code = 0; code < count; code++) {
    const ul = txi.upperleftcoords[code], lr = txi.lowerrightcoords[code];
    if (!ul || !lr) continue;
    const left = Math.round(ul.x * width);
    const right = Math.round(lr.x * width);
    const top = Math.round((1 - ul.y) * height);
    const bottom = Math.round((1 - lr.y) * height);
    if (right <= left || bottom <= top) continue;
    cells.push({ code, left, top, width: right - left, height: bottom - top });
  }
  return cells;
}

/** Whether a texture pixel is ink: its alpha, or its brightness for a font without one */
function inkReader(src: KotorFontSource): (x: number, y: number) => boolean {
  let hasAlpha = false;
  for (let i = 3; i < src.data.length; i += 4) if (src.data[i] < 250) { hasAlpha = true; break; }
  return (x, y) => {
    if (x < 0 || y < 0 || x >= src.width || y >= src.height) return false;
    const i = (y * src.width + x) * 4;
    const v = hasAlpha ? src.data[i + 3] : (src.data[i] + src.data[i + 1] + src.data[i + 2]) / 3;
    return v >= 110;
  };
}

interface Rect { x0: number; y0: number; x1: number; y1: number }

/** A glyph's ink as rectangles, in cell pixels (runs of a row, merged down while they repeat) */
function glyphRects(cell: KotorGlyphCell, ink: (x: number, y: number) => boolean): Rect[] {
  const done: Rect[] = [];
  let open = new Map<string, Rect>();
  for (let row = 0; row < cell.height; row++) {
    const runs: [number, number][] = [];
    let start = -1;
    for (let col = 0; col <= cell.width; col++) {
      const on = col < cell.width && ink(cell.left + col, cell.top + row);
      if (on && start < 0) start = col;
      if (!on && start >= 0) { runs.push([start, col]); start = -1; }
    }
    const next = new Map<string, Rect>();
    for (const [a, b] of runs) {
      const key = `${a}:${b}`;
      const r = open.get(key);
      if (r) { r.y1 = row + 1; next.set(key, r); open.delete(key); }
      else next.set(key, { x0: a, y0: row, x1: b, y1: row + 1 });
    }
    for (const r of open.values()) done.push(r);
    open = next;
  }
  for (const r of open.values()) done.push(r);
  return done;
}

class Writer {
  bytes: number[] = [];
  u8(v: number) { this.bytes.push(v & 0xff); }
  u16(v: number) { this.u8(v >> 8); this.u8(v); }
  i16(v: number) { this.u16(v < 0 ? v + 0x10000 : v); }
  u32(v: number) { this.u16((v >>> 16) & 0xffff); this.u16(v & 0xffff); }
  tag(s: string) { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i)); }
  pad4() { while (this.bytes.length % 4) this.u8(0); }
  get length() { return this.bytes.length; }
}

function checksum(bytes: number[], from = 0, length = bytes.length - from): number {
  let sum = 0;
  for (let i = 0; i < length; i += 4) {
    const v = ((bytes[from + i] || 0) << 24) | ((bytes[from + i + 1] || 0) << 16) | ((bytes[from + i + 2] || 0) << 8) | (bytes[from + i + 3] || 0);
    sum = (sum + (v >>> 0)) >>> 0;
  }
  return sum;
}

/**
 * The TrueType font: glyph 0 is .notdef, then one glyph a character code 32..255 (KotOR's fonts are 8-bit, laid
 * out as Windows-1252; the cmap maps Unicode Latin-1 to them). The baseline sits under the capitals' lowest ink
 */
export function buildKotorTtf(src: KotorFontSource, familyName: string): ArrayBuffer {
  const ink = inkReader(src);
  const byCode = new Map(src.cells.map((c) => [c.code, c]));
  const cellH = Math.max(...src.cells.map((c) => c.height));

  // Baseline: the row under the capitals' ink
  let baselineRow = cellH;
  {
    let lowest = -1;
    for (let code = 65; code <= 90; code++) {
      const c = byCode.get(code);
      if (!c) continue;
      for (let row = c.height - 1; row >= 0; row--) {
        let any = false;
        for (let col = 0; col < c.width && !any; col++) any = ink(c.left + col, c.top + row);
        if (any) { lowest = Math.max(lowest, row); break; }
      }
    }
    if (lowest >= 0) baselineRow = lowest + 1;
  }
  const ascender = baselineRow * UNIT;
  const descender = -(cellH - baselineRow) * UNIT;

  // Glyphs: 0 .notdef, then codes 32..255
  const codes: number[] = [];
  for (let code = 32; code <= 255; code++) codes.push(code);
  const glyphs = [{ rects: [] as Rect[], advance: Math.round(cellH * UNIT / 2) }].concat(codes.map((code) => {
    const c = byCode.get(code);
    if (!c) return { rects: [] as Rect[], advance: Math.round(cellH * UNIT / 3) };
    return { rects: glyphRects(c, ink), advance: c.width * UNIT };
  }));

  // glyf, loca, hmtx
  const glyf = new Writer();
  const loca: number[] = [];
  const hmtx = new Writer();
  let xMin = 0, yMin = 0, xMax = 0, yMax = 0, maxPoints = 0, maxContours = 0, advanceMax = 0, minLsb = 0x7fff, minRsb = 0x7fff, maxExtent = 0;
  for (const g of glyphs) {
    loca.push(glyf.length);
    advanceMax = Math.max(advanceMax, g.advance);
    if (!g.rects.length) {
      hmtx.u16(g.advance); hmtx.i16(0);
      continue;
    }
    // Font space: x right, y up from the baseline
    const rects = g.rects.map((r) => ({ x0: r.x0 * UNIT, x1: r.x1 * UNIT, yTop: (baselineRow - r.y0) * UNIT, yBot: (baselineRow - r.y1) * UNIT }));
    const gxMin = Math.min(...rects.map((r) => r.x0)), gxMax = Math.max(...rects.map((r) => r.x1));
    const gyMin = Math.min(...rects.map((r) => r.yBot)), gyMax = Math.max(...rects.map((r) => r.yTop));
    xMin = Math.min(xMin, gxMin); yMin = Math.min(yMin, gyMin); xMax = Math.max(xMax, gxMax); yMax = Math.max(yMax, gyMax);
    maxContours = Math.max(maxContours, rects.length);
    maxPoints = Math.max(maxPoints, rects.length * 4);
    minLsb = Math.min(minLsb, gxMin); minRsb = Math.min(minRsb, g.advance - gxMax); maxExtent = Math.max(maxExtent, gxMax);
    glyf.i16(rects.length);
    glyf.i16(gxMin); glyf.i16(gyMin); glyf.i16(gxMax); glyf.i16(gyMax);
    rects.forEach((_, i) => glyf.u16(i * 4 + 3));
    glyf.u16(0); // no instructions
    // Each rectangle clockwise: top-left, top-right, bottom-right, bottom-left; all on the curve, full-size deltas
    const points: [number, number][] = [];
    for (const r of rects) points.push([r.x0, r.yTop], [r.x1, r.yTop], [r.x1, r.yBot], [r.x0, r.yBot]);
    points.forEach(() => glyf.u8(0x01));
    let px = 0, py = 0;
    for (const [x] of points) { glyf.i16(x - px); px = x; }
    for (const [, y] of points) { glyf.i16(y - py); py = y; }
    glyf.pad4();
    hmtx.u16(g.advance); hmtx.i16(gxMin);
  }
  loca.push(glyf.length);
  if (minLsb === 0x7fff) minLsb = 0;
  if (minRsb === 0x7fff) minRsb = 0;
  const numGlyphs = glyphs.length;
  const unitsPerEm = cellH * UNIT;

  const head = new Writer();
  head.u32(0x00010000); head.u32(0x00010000); head.u32(0); head.u32(0x5f0f3cf5);
  head.u16(0x000b); head.u16(unitsPerEm);
  head.u32(0); head.u32(0); head.u32(0); head.u32(0);
  head.i16(xMin); head.i16(yMin); head.i16(xMax); head.i16(yMax);
  head.u16(0); head.u16(8); head.i16(2); head.i16(1); head.i16(0);

  const hhea = new Writer();
  hhea.u32(0x00010000); hhea.i16(ascender); hhea.i16(descender); hhea.i16(0);
  hhea.u16(advanceMax); hhea.i16(minLsb); hhea.i16(minRsb); hhea.i16(maxExtent);
  hhea.i16(1); hhea.i16(0); hhea.i16(0); hhea.i16(0); hhea.i16(0); hhea.i16(0); hhea.i16(0);
  hhea.i16(0); hhea.u16(numGlyphs);

  const maxp = new Writer();
  maxp.u32(0x00010000); maxp.u16(numGlyphs); maxp.u16(maxPoints); maxp.u16(maxContours);
  // maxCompositePoints, maxCompositeContours, maxZones, then eight zeroes (twilight points ... component depth)
  maxp.u16(0); maxp.u16(0); maxp.u16(2); for (let i = 0; i < 8; i++) maxp.u16(0);

  const locaW = new Writer();
  for (const o of loca) locaW.u32(o);

  // cmap: one segment, codes 32..255 to glyphs 1..224
  const cmap = new Writer();
  cmap.u16(0); cmap.u16(1); cmap.u16(3); cmap.u16(1); cmap.u32(12);
  const segCount = 2;
  cmap.u16(4); cmap.u16(16 + segCount * 8); cmap.u16(0);
  cmap.u16(segCount * 2); cmap.u16(4); cmap.u16(1); cmap.u16(0);
  cmap.u16(255); cmap.u16(0xffff); cmap.u16(0);
  cmap.u16(32); cmap.u16(0xffff);
  cmap.i16(1 - 32); cmap.i16(1);
  cmap.u16(0); cmap.u16(0);

  const avg = Math.round(glyphs.reduce((s, g) => s + g.advance, 0) / numGlyphs);
  const os2 = new Writer();
  os2.u16(3); os2.i16(avg); os2.u16(400); os2.u16(5); os2.u16(0);
  for (let i = 0; i < 8; i++) os2.i16(Math.round(unitsPerEm / 2));
  os2.i16(UNIT); os2.i16(Math.round(ascender / 2));
  os2.i16(0); for (let i = 0; i < 10; i++) os2.u8(0);
  os2.u32(3); os2.u32(0); os2.u32(0); os2.u32(0);
  os2.tag('KJS '); os2.u16(0x40); os2.u16(32); os2.u16(255);
  os2.i16(ascender); os2.i16(descender); os2.i16(0);
  os2.u16(Math.max(ascender, yMax)); os2.u16(Math.max(-descender, -yMin));
  os2.u32(1); os2.u32(0);
  os2.i16(Math.round(ascender * 0.7)); os2.i16(ascender); os2.u16(0); os2.u16(32); os2.u16(0);

  const name = new Writer();
  const strings: [number, string][] = [[1, familyName], [2, 'Regular'], [3, `${familyName}-Regular`], [4, familyName], [6, familyName.replace(/[^A-Za-z0-9-]/g, '')]];
  const encoded = strings.map(([, s]) => { const b: number[] = []; for (const ch of s) { const c = ch.charCodeAt(0); b.push(c >> 8, c & 0xff); } return b; });
  name.u16(0); name.u16(strings.length); name.u16(6 + strings.length * 12);
  let off = 0;
  strings.forEach(([id], i) => { name.u16(3); name.u16(1); name.u16(0x409); name.u16(id); name.u16(encoded[i].length); name.u16(off); off += encoded[i].length; });
  encoded.forEach((b) => b.forEach((x) => name.u8(x)));

  const post = new Writer();
  post.u32(0x00030000); post.u32(0); post.i16(-UNIT); post.i16(UNIT); post.u32(0); post.u32(0); post.u32(0); post.u32(0); post.u32(0);

  const tables: [string, Writer][] = [
    ['OS/2', os2], ['cmap', cmap], ['glyf', glyf], ['head', head], ['hhea', hhea],
    ['hmtx', hmtx], ['loca', locaW], ['maxp', maxp], ['name', name], ['post', post],
  ];
  const out = new Writer();
  const n = tables.length;
  const pow = Math.pow(2, Math.floor(Math.log2(n)));
  out.u32(0x00010000); out.u16(n); out.u16(pow * 16); out.u16(Math.floor(Math.log2(n))); out.u16(n * 16 - pow * 16);
  const dirStart = out.length;
  for (let i = 0; i < n; i++) { out.u32(0); out.u32(0); out.u32(0); out.u32(0); }
  let headOffset = 0;
  tables.forEach(([tag, w], i) => {
    const offset = out.length;
    const length = w.length;
    if (tag === 'head') headOffset = offset;
    w.bytes.forEach((b) => out.u8(b));
    out.pad4();
    const sum = checksum(out.bytes, offset, Math.ceil(length / 4) * 4);
    const rec = new Writer(); rec.tag(tag); rec.u32(sum); rec.u32(offset); rec.u32(length);
    rec.bytes.forEach((b, j) => (out.bytes[dirStart + i * 16 + j] = b));
  });
  // head.checkSumAdjustment: the whole font sums to 0xB1B0AFBA
  const adjust = (0xb1b0afba - checksum(out.bytes)) >>> 0;
  const a = new Writer(); a.u32(adjust);
  a.bytes.forEach((b, j) => (out.bytes[headOffset + 8 + j] = b));
  return new Uint8Array(out.bytes).buffer;
}

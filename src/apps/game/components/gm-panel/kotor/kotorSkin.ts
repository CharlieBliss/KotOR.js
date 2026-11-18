import { useEffect, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { gameTexturePixels, type GameTexturePixels } from "@/apps/game/components/gm-panel/creator/gameTexture";
import { buildKotorTtf, glyphCells } from "@/apps/game/components/gm-panel/kotor/kotorFont";

/**
 * KotOR's interface for the GM session's player screens, taken from the game itself rather than imitated: the
 * menus' GUI says which colours, border pieces and font the game uses (KotOR's teal-and-cream, or KotOR I's
 * own), and those textures become the page's frames and its font. Set on the document as CSS variables:
 *   --k-text, --k-border, --k-hl, --k-hl-text (focused text), --k-special (rgb), --k-frame / --k-frame-hl / --k-frame-special (9-slice
 *   images for border-image), --k-frame-slice (their slice), --k-font (the KotOR font family)
 */

export interface KotorStyle {
  text: [number, number, number];
  border: [number, number, number];
  highlight: [number, number, number];
  special: [number, number, number];
  edge: string;
  corner: string;
  dimension: number;
  font: string;
}

/** KotOR II's, for when the menu can't be read */
const DEFAULT_STYLE: KotorStyle = {
  text: [0.102, 0.698, 0.549],
  border: [0.051, 0.349, 0.271],
  highlight: [0.8, 0.8, 0.698],
  special: [0.4, 0.4, 0.302],
  edge: 'uibit_brdr_16we',
  corner: 'uibit_brdr_16wc',
  dimension: 16,
  font: 'dialogfont16x16',
};

export const KOTOR_FONT_FAMILY = 'KotOR Dialog';

type RGB = [number, number, number];
const rgbOf = (v: any): RGB | undefined => (v && Number.isFinite(v.r) ? [v.r, v.g, v.b] : undefined);
const keyOf = (c: RGB) => c.map((x) => x.toFixed(2)).join(',');
/** The colour most of these share */
function most(list: (RGB | undefined)[]): RGB | undefined {
  const count = new Map<string, { c: RGB; n: number }>();
  for (const c of list) if (c) { const k = keyOf(c); const e = count.get(k) || { c, n: 0 }; e.n++; count.set(k, e); }
  return [...count.values()].sort((a, b) => b.n - a.n)[0]?.c;
}
const saturated = (c: RGB) => Math.max(...c) - Math.min(...c) > 0.5;

/**
 * The style the game's menus share, read from every menu it has loaded: the framed control style most of them use
 * (KotOR II: teal uibit_brdr_16bet / 16bct; KotOR I: its blue boxline pieces), its text, border and highlight
 * colours, and its font. The main menu alone misled: KotOR I's is solid blue bars with no frames at all
 */
export function readKotorStyle(): KotorStyle & { highlightText: RGB } {
  const style = { ...DEFAULT_STYLE, highlightText: DEFAULT_STYLE.highlight };
  try {
    const menus = KotOR.GameState.MenuManager as any;
    const framed: any[] = [];
    const all: any[] = [];
    const walk = (c: any, depth = 0) => {
      if (!c || depth > 8) return;
      if (c.text) all.push(c);
      if (c.border?.edge && c.border?.corner && c.text) framed.push(c);
      for (const ch of c.children || []) walk(ch, depth + 1);
    };
    for (const key of Object.keys(menus || {})) if (menus[key]?.tGuiPanel) walk(menus[key].tGuiPanel);
    // The commonest framed look: its pieces and border colour together
    const looks = new Map<string, any[]>();
    for (const c of framed) {
      const k = `${String(c.border.edge).toLowerCase()}|${String(c.border.corner).toLowerCase()}|${c.border.dimension}|${keyOf(rgbOf(c.border.color) || [1, 1, 1])}`;
      looks.set(k, [...(looks.get(k) || []), c]);
    }
    const group = [...looks.values()].sort((a, b) => b.length - a.length)[0];
    if (group?.length) {
      const first = group[0];
      style.edge = String(first.border.edge).toLowerCase();
      style.corner = String(first.border.corner).toLowerCase();
      style.dimension = Number(first.border.dimension) || style.dimension;
      style.border = rgbOf(first.border.color) || style.border;
      style.text = most(group.map((c) => rgbOf(c.text?.color))) || style.text;
      style.highlight = most(group.map((c) => rgbOf(c.highlight?.color))) || style.highlight;
      style.font = String(group.find((c) => c.text?.font)?.text?.font || style.font).toLowerCase();
    }
    // Focused text: a coloured highlight where the game has one (KotOR I's yellow), else the highlight
    style.highlightText = most(all.map((c) => rgbOf(c.highlight?.color)).filter((c) => c && saturated(c))) || style.highlight;
    // A border of its own colour for the odd one out (KotOR II's olive GM Mode button), else the focused colour
    const other = most(framed.map((c) => rgbOf(c.border.color)).filter((c) => c && keyOf(c) !== keyOf(style.border) && Math.min(...c) < 0.85));
    style.special = other || style.highlightText;
  } catch (e) { /* the defaults */ }
  return style;
}

const css = (c: [number, number, number]) => c.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255)).join(' ');

/** A texture as a canvas, its colour multiplied by tint (as KotOR's GUI draws its borders) */
function tinted(px: GameTexturePixels, tint: [number, number, number]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = px.width; canvas.height = px.height;
  const ctx = canvas.getContext('2d')!;
  const img = new ImageData(px.width, px.height);
  for (let i = 0; i < px.data.length; i += 4) {
    img.data[i] = px.data[i] * tint[0];
    img.data[i + 1] = px.data[i + 1] * tint[1];
    img.data[i + 2] = px.data[i + 2] * tint[2];
    img.data[i + 3] = px.data[i + 3];
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * The 9-slice frame KotOR builds a control's border from: the corner piece in each corner and the edge piece
 * along each side, turned into place (GUIControl.buildBorder: the corner is the top-left one, the edge the top
 * one), the middle left empty
 */
function nineSlice(corner: HTMLCanvasElement, edge: HTMLCanvasElement, d: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = d * 3;
  const ctx = canvas.getContext('2d')!;
  // Draw a piece into the d x d cell at (cx, cy), turned clockwise by turns quarter-turns
  const put = (img: HTMLCanvasElement, cx: number, cy: number, turns: number) => {
    ctx.save();
    ctx.translate(cx * d + d / 2, cy * d + d / 2);
    ctx.rotate((turns * Math.PI) / 2);
    ctx.drawImage(img, -d / 2, -d / 2, d, d);
    ctx.restore();
  };
  put(corner, 0, 0, 0); put(corner, 2, 0, 1); put(corner, 2, 2, 2); put(corner, 0, 2, 3);
  // The edge piece as it's drawn is the top one (its line along its top): the others turned from it
  put(edge, 1, 0, 0); put(edge, 2, 1, 1); put(edge, 1, 2, 2); put(edge, 0, 1, 3);
  return canvas.toDataURL('image/png');
}

let loading: Promise<boolean> | null = null;
let ready = false;
const listeners = new Set<() => void>();

/** Build the skin once for the game that's running; resolves whether it could */
export function loadKotorSkin(): Promise<boolean> {
  if (loading) return loading;
  loading = (async () => {
    const style = readKotorStyle();
    const root = document.documentElement.style;
    root.setProperty('--k-text', css(style.text));
    root.setProperty('--k-border', css(style.border));
    root.setProperty('--k-hl', css(style.highlight));
    root.setProperty('--k-hl-text', css(style.highlightText));
    root.setProperty('--k-special', css(style.special));
    root.setProperty('--k-frame-slice', String(style.dimension));
    const [corner, edge, font] = await Promise.all([gameTexturePixels(style.corner), gameTexturePixels(style.edge), gameTexturePixels(style.font)]);
    if (corner && edge) {
      const d = style.dimension;
      root.setProperty('--k-frame', `url(${nineSlice(tinted(corner, style.border), tinted(edge, style.border), d)})`);
      root.setProperty('--k-frame-hl', `url(${nineSlice(tinted(corner, style.highlight), tinted(edge, style.highlight), d)})`);
      root.setProperty('--k-frame-special', `url(${nineSlice(tinted(corner, style.special), tinted(edge, style.special), d)})`);
    }
    if (font?.txi) {
      try {
        const txi = new KotOR.TXI(font.txi);
        const cells = glyphCells(txi, font.width, font.height);
        if (cells.length > 64) {
          const face = new FontFace(KOTOR_FONT_FAMILY, buildKotorTtf({ width: font.width, height: font.height, data: font.data, cells }, KOTOR_FONT_FAMILY));
          await face.load();
          (document as any).fonts.add(face);
          root.setProperty('--k-font', `'${KOTOR_FONT_FAMILY}'`);
        }
      } catch (e) {
        console.warn('KotOR skin: the game font could not be built', e);
      }
    }
    ready = true;
    listeners.forEach((l) => l());
    return true;
  })().catch((e) => { console.warn('KotOR skin', e); return false; });
  return loading;
}

/** Re-render once the skin is in (its frames and font arrive after the first paint) */
export function useKotorSkin(): boolean {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    listeners.add(l);
    loadKotorSkin();
    return () => { listeners.delete(l); };
  }, []);
  return ready;
}

/**
 * Controller (Xbox layout, the browser's "standard" gamepad mapping) for a GM session player's interface: reading
 * the pad with press and repeat detection, and moving a focus between the controls of whatever is open, by
 * direction, the way a console menu does. PlayerHud's usePadControls decides what each button does.
 */

/** Standard-mapping button numbers */
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
  // The left stick pushed in a direction, as if it were the d-pad
  STICK_UP: 100, STICK_DOWN: 101, STICK_LEFT: 102, STICK_RIGHT: 103,
} as const;

export type PadDir = 'up' | 'down' | 'left' | 'right';

/** A pad's state this frame: its buttons and its sticks */
export interface PadFrame {
  buttons: boolean[];
  axes: number[];
}

/** The connected pad: the first with the standard mapping, else the first at all */
export function readPad(): PadFrame | null {
  const list = (typeof navigator !== 'undefined' && navigator.getGamepads?.()) || [];
  const pads = [...list].filter((p): p is Gamepad => !!p && p.connected);
  const pad = pads.find((p) => p.mapping === 'standard') || pads[0];
  if (!pad) return null;
  return {
    buttons: pad.buttons.map((b) => !!b && (b.pressed || b.value > 0.5)),
    axes: pad.axes.map((a) => (Math.abs(a) < 0.18 ? 0 : a)),
  };
}

const STICK_PUSH = 0.6;

/** Presses (with repeat for the directions, held) and releases, frame to frame */
export class PadEdges {
  private held = new Map<number, number>();
  private repeatAt = new Map<number, number>();
  /** First repeat after (ms), then every (ms): as a held d-pad steps through a list */
  static REPEAT_DELAY = 380;
  static REPEAT_EVERY = 110;
  static REPEATS = new Set<number>([PAD.UP, PAD.DOWN, PAD.LEFT, PAD.RIGHT, PAD.STICK_UP, PAD.STICK_DOWN, PAD.STICK_LEFT, PAD.STICK_RIGHT]);

  pressed = new Set<number>();
  released = new Set<number>();
  /** Whether anything at all happened on the pad this frame */
  touched = false;

  /** Down now, by button number (the stick's directions included) */
  static down(frame: PadFrame): Set<number> {
    const out = new Set<number>();
    frame.buttons.forEach((b, i) => { if (b) out.add(i); });
    const [x = 0, y = 0] = frame.axes;
    if (y <= -STICK_PUSH) out.add(PAD.STICK_UP);
    if (y >= STICK_PUSH) out.add(PAD.STICK_DOWN);
    if (x <= -STICK_PUSH) out.add(PAD.STICK_LEFT);
    if (x >= STICK_PUSH) out.add(PAD.STICK_RIGHT);
    return out;
  }

  update(frame: PadFrame | null, now: number) {
    this.pressed = new Set();
    this.released = new Set();
    const down = frame ? PadEdges.down(frame) : new Set<number>();
    this.touched = down.size > 0 || !!frame?.axes.some((a, i) => i >= 2 && Math.abs(a) > 0);
    for (const b of down) {
      if (!this.held.has(b)) {
        this.held.set(b, now);
        this.pressed.add(b);
        this.repeatAt.set(b, now + PadEdges.REPEAT_DELAY);
      } else if (PadEdges.REPEATS.has(b) && now >= (this.repeatAt.get(b) || Infinity)) {
        this.pressed.add(b);
        this.repeatAt.set(b, now + PadEdges.REPEAT_EVERY);
      }
    }
    for (const b of [...this.held.keys()]) {
      if (!down.has(b)) { this.held.delete(b); this.repeatAt.delete(b); this.released.add(b); }
    }
  }

  isDown(b: number) { return this.held.has(b); }

  /** The direction pressed this frame, by the d-pad or the left stick */
  dir(): PadDir | null {
    if (this.pressed.has(PAD.UP) || this.pressed.has(PAD.STICK_UP)) return 'up';
    if (this.pressed.has(PAD.DOWN) || this.pressed.has(PAD.STICK_DOWN)) return 'down';
    if (this.pressed.has(PAD.LEFT) || this.pressed.has(PAD.STICK_LEFT)) return 'left';
    if (this.pressed.has(PAD.RIGHT) || this.pressed.has(PAD.STICK_RIGHT)) return 'right';
    return null;
  }
}

export interface Box { x: number; y: number; w: number; h: number }

/**
 * The control to move to from one at `from` going `dir`: the nearest whose centre lies that way, favouring those
 * in line (a step sideways costs twice a step ahead). -1 when nothing lies that way. From nothing, the first
 * one in reading order
 */
export function pickInDirection(from: Box | null, boxes: Box[], dir: PadDir): number {
  if (!boxes.length) return -1;
  if (!from) {
    let best = 0;
    boxes.forEach((b, i) => { const c = boxes[best]; if (b.y < c.y - 4 || (Math.abs(b.y - c.y) <= 4 && b.x < c.x)) best = i; });
    return best;
  }
  const fx = from.x + from.w / 2, fy = from.y + from.h / 2;
  let best = -1, bestScore = Infinity;
  boxes.forEach((b, i) => {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const dx = cx - fx, dy = cy - fy;
    const ahead = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    const side = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    // That way at all (past half the current control, so a neighbour in the same row isn't "below")
    const reach = dir === 'left' || dir === 'right' ? from.w / 2 : from.h / 2;
    if (ahead <= Math.min(reach, 4)) return;
    const score = ahead + side * 2;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

const FOCUSABLE = 'button:not([disabled]), [role="option"], [role="tab"], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The controls a pad can reach in a panel: shown, enabled, not tucked away */
export function focusablesIn(container: Element): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && !el.closest('[aria-hidden="true"]');
  });
}

const boxOf = (el: Element): Box => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };

/** The control the pad is on in this panel (marked with .gm-pad-focus), if any */
export function padFocused(container: Element): HTMLElement | null {
  return container.querySelector<HTMLElement>('.gm-pad-focus');
}

/** Put the pad's focus on el: marked for the eye, focused for the browser, scrolled into view */
export function setPadFocus(el: HTMLElement | null) {
  document.querySelectorAll('.gm-pad-focus').forEach((e) => e.classList.remove('gm-pad-focus'));
  if (!el) return;
  el.classList.add('gm-pad-focus');
  try { el.focus({ preventScroll: true }); } catch (e) { /* not focusable */ }
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

/** Move the pad's focus in a panel; from nowhere, to its first control (or the one marked selected) */
export function moveFocus(container: Element, dir: PadDir | null): HTMLElement | null {
  const items = focusablesIn(container);
  if (!items.length) return null;
  const current = padFocused(container);
  if (!current || !items.includes(current)) {
    const preferred = items.find((el) => el.matches('.on, .active, .selected, [aria-selected="true"]')) || items[pickInDirection(null, items.map(boxOf), 'down')];
    setPadFocus(preferred);
    return preferred;
  }
  if (!dir) return current;
  const others = items.filter((el) => el !== current);
  const i = pickInDirection(boxOf(current), others.map(boxOf), dir);
  if (i >= 0) setPadFocus(others[i]);
  return i >= 0 ? others[i] : current;
}

/** Press the control the pad is on */
export function activate(el: HTMLElement | null) {
  if (!el) return;
  if (el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'search' || el.type === 'number')) { el.focus(); return; }
  el.click();
}

/** The next or previous tab of a panel's tab row (KotOR's bumpers through a menu's tabs) */
export function switchTab(container: Element, step: 1 | -1): boolean {
  const tabs = Array.from(container.querySelectorAll<HTMLElement>('.gm-hud-cat-tab, .cc-tabs button, [role="tab"]')).filter((t) => t.getBoundingClientRect().width > 0);
  if (tabs.length < 2) return false;
  const at = Math.max(0, tabs.findIndex((t) => t.matches('.on, .active, [aria-selected="true"]')));
  const next = tabs[(at + step + tabs.length) % tabs.length];
  next.click();
  return true;
}

/** Scroll what's scrollable in a panel (around the focus, else the panel's first scroller) */
export function scrollPanel(container: Element, dy: number) {
  const start = padFocused(container) || container;
  let el: Element | null = start;
  while (el && el !== container.parentElement) {
    if (el.scrollHeight > el.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) { el.scrollBy({ top: dy }); return; }
    el = el.parentElement;
  }
  const scroller = Array.from(container.querySelectorAll("*")).find((e) => e.scrollHeight > e.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
  scroller?.scrollBy({ top: dy });
}

/** Press a panel's own Close (its close button, else one labelled Close); false when it has none */
export function closePanel(container: Element): boolean {
  const buttons = Array.from(container.querySelectorAll<HTMLElement>('button'));
  const close = container.querySelector<HTMLElement>('.gm-hud-mini-close') || buttons.find((b) => /^\s*close\s*$/i.test(b.textContent || '') || /^close\b/i.test(b.getAttribute('aria-label') || ''));
  if (!close) return false;
  close.click();
  return true;
}

/** The wheel item a stick points at: the same reckoning as the pointer's (0 at the top, clockwise) */
export function wheelIndex(x: number, y: number, count: number): number {
  if (!count || Math.hypot(x, y) < 0.5) return -1;
  const angle = (Math.atan2(y, x) * 180 / Math.PI + 90 + 360) % 360;
  return Math.round(angle / (360 / count)) % count;
}

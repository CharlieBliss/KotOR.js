import { describe, expect, test } from "@jest/globals";
import { PAD, PadEdges, pickInDirection, wheelIndex, type PadFrame } from "@/apps/game/components/gm-panel/controls/padNav";

const frame = (down: number[] = [], axes: number[] = [0, 0, 0, 0]): PadFrame => {
  const buttons = new Array(17).fill(false);
  for (const b of down) buttons[b] = true;
  return { buttons, axes };
};

describe("reading the pad", () => {
  test("a press is seen once, then a held direction repeats as a held d-pad steps through a list", () => {
    const e = new PadEdges();
    e.update(frame([PAD.A, PAD.RIGHT]), 0);
    expect([...e.pressed].sort()).toEqual([PAD.A, PAD.RIGHT].sort());
    e.update(frame([PAD.A, PAD.RIGHT]), 100);
    expect(e.pressed.size).toBe(0);
    // Past the repeat delay the direction goes again; A doesn't
    e.update(frame([PAD.A, PAD.RIGHT]), PadEdges.REPEAT_DELAY + 1);
    expect([...e.pressed]).toEqual([PAD.RIGHT]);
    e.update(frame([PAD.RIGHT]), PadEdges.REPEAT_DELAY + 20);
    expect(e.released.has(PAD.A)).toBe(true);
    expect(e.dir()).toBe(null);
  });

  test("the left stick pushed far enough counts as the d-pad", () => {
    const e = new PadEdges();
    e.update(frame([], [0.1, 0, 0, 0]), 0);
    expect(e.dir()).toBe(null);
    e.update(frame([], [0, -0.9, 0, 0]), 10);
    expect(e.dir()).toBe('up');
    expect(e.isDown(PAD.STICK_UP)).toBe(true);
  });
});

describe("moving between controls", () => {
  // A row of three, and one below the middle
  const row = [{ x: 0, y: 0, w: 40, h: 20 }, { x: 50, y: 0, w: 40, h: 20 }, { x: 100, y: 0, w: 40, h: 20 }, { x: 50, y: 40, w: 40, h: 20 }];

  test("the nearest that way, favouring the one in line", () => {
    const from = row[1];
    const others = [row[0], row[2], row[3]];
    expect(pickInDirection(from, others, 'right')).toBe(1);
    expect(pickInDirection(from, others, 'left')).toBe(0);
    expect(pickInDirection(from, others, 'down')).toBe(2);
    expect(pickInDirection(from, others, 'up')).toBe(-1);
  });

  test("from nowhere, the first in reading order", () => {
    expect(pickInDirection(null, [row[3], row[2], row[0]], 'down')).toBe(2);
  });
});

describe("the wheel", () => {
  test("the stick points at the item that way, 0 at the top and clockwise, as the pointer does", () => {
    expect(wheelIndex(0, -1, 8)).toBe(0);
    expect(wheelIndex(1, 0, 8)).toBe(2);
    expect(wheelIndex(0, 1, 8)).toBe(4);
    expect(wheelIndex(-1, 0, 8)).toBe(6);
    expect(wheelIndex(0.1, 0.1, 8)).toBe(-1);
  });
});

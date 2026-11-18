import { describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: { gmMode: true } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import * as THREE from "three";
import { GMSeats } from "@/managers/gm/GMSeats";

/** A box's corners, as model vertices */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

// KotOR's military chair: seat 0.53 deep along x, 0.84 wide; its backrest on the +x side
const militaryChair = [...box(-0.37, -0.42, 0.35, 0.16, 0.42, 0.45), ...box(0.12, -0.42, 0.45, 0.31, 0.42, 0.86)];

describe("seats", () => {
  test("a chair faces away from its backrest, and the sitter stands its hips' offset in front of the seat", () => {
    const [seat, ...more] = GMSeats.fromPoints(militaryChair);
    expect(more).toEqual([]);
    expect(seat.fx).toBe(-1);
    expect(seat.fy).toBe(0);
    expect(seat.either).toBe(false);
    // The seat is the part in front of the backrest
    expect(seat.x).toBeCloseTo(-0.125, 2);

    const prop: any = { position: new THREE.Vector3(10, 20, 0), bearing: 0, rotation: { z: 0 }, model: {}, getName: () => "Chair" };
    jest.spyOn(GMSeats, "seatsOf").mockReturnValue([seat]);
    const spot = GMSeats.spot(prop, 0)!;
    // The 0.5 m and 90 degrees the military chair needed by hand
    expect(spot.position.x).toBeCloseTo(10 - 0.125 - GMSeats.HIP_OFFSET, 2);
    expect(spot.position.y).toBeCloseTo(20, 2);
    expect(spot.facing).toBeCloseTo(Math.PI / 2, 3);
    // Turned with the chair
    prop.bearing = Math.PI / 2;
    const turned = GMSeats.spot(prop, 0)!;
    expect(turned.position.y).toBeCloseTo(20 - 0.125 - GMSeats.HIP_OFFSET, 2);
    expect(turned.facing).toBeCloseTo(Math.PI, 3);
    jest.restoreAllMocks();
  });

  test("a bench seats one per 65 cm; a backless one can face either way", () => {
    const bench = GMSeats.fromPoints([...box(-0.24, -0.69, 0.35, 0.27, 0.69, 0.45), ...box(0.24, -0.51, 0.6, 0.27, 0.51, 1.0)]);
    expect(bench).toHaveLength(2);
    expect(bench.map((s) => s.y)).toEqual([expect.closeTo(-0.345, 2), expect.closeTo(0.345, 2)]);
    expect(bench.every((s) => s.fx === -1 && !s.either)).toBe(true);

    const long = GMSeats.fromPoints(box(-1.15, -0.29, 0.35, 1.15, 0.28, 0.47));
    expect(long).toHaveLength(3);
    expect(long.every((s) => s.either && s.fx === 0)).toBe(true);
  });

  test("nothing at seat height is no seat", () => {
    expect(GMSeats.fromPoints(box(-1, -1, 0.7, 1, 1, 0.9))).toEqual([]);
    expect(GMSeats.looksLikeSeat("plc_chair_mil_01")).toBe(true);
    expect(GMSeats.looksLikeSeat("plc_gentable")).toBe(false);
  });
});

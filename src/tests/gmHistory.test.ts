import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// The real GameState pulls in the whole browser engine (WebGL, window, File System Access)
jest.mock("@/GameState", () => ({ GameState: { gmMode: true, PartyManager: { party: [] as any[], Player: undefined as any } } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import * as THREE from "three";
import { GMManager } from "@/managers/GMManager";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import { GMViewport } from "@/managers/gm/GMViewport";
import { GMHistory } from "@/managers/gm/GMHistory";
import { GMEditTools } from "@/managers/gm/GMEditTools";
import { GMSpawner } from "@/managers/gm/GMSpawner";
import { GameState } from "@/GameState";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";

let nextId = 1;
/** A placeable-like object: position, bearing, and what history and the tools read */
function mockObject(name = `crate${nextId}`, at = new THREE.Vector3()): any {
  const obj: any = {
    id: nextId++,
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModulePlaceable,
    position: at.clone(),
    rotation: new THREE.Euler(),
    bearing: 0,
    destroyed: false,
    destroy() { this.destroyed = true; },
    getCurrentRoom: jest.fn(),
    computeBoundingBox: jest.fn(),
    getName: () => name,
    isLocked: () => false,
  };
  return obj;
}

const spawned: any[] = [];

beforeEach(() => {
  GMManager.selection = [];
  GMNetworkManager.role = "offline";
  (GameState as any).PartyManager = { party: [], Player: undefined };
  GMHistory.clear();
  GMEditTools.groups.clear();
  GMEditTools.clipboard = [];
  spawned.length = 0;
  // Spawning makes a new mock where the description says; describing reads the mock's name
  jest.spyOn(GMSpawner, 'describeObject').mockImplementation((o: any) => ({ kind: 'placeable', config: { name: o.getName() } as any }));
  jest.spyOn(GMSpawner, 'spawnDescribed').mockImplementation(async (d: any, pos: THREE.Vector3, facing: number) => {
    const o = mockObject(d.config.name, pos);
    o.bearing = facing;
    spawned.push(o);
    return o;
  });
  jest.spyOn(GMViewport, 'floorBelow').mockImplementation((_x: number, _y: number, z: number) => z);
});

describe("GM undo and redo", () => {
  test("a move is undone and redone", async () => {
    const crate = mockObject();
    GMHistory.track('Move crate', [crate], () => GMManager.teleportObject(crate, new THREE.Vector3(4, 0, 0)));
    expect(crate.position.x).toBe(4);
    expect(await GMHistory.undo()).toBe('Move crate');
    expect(crate.position.x).toBe(0);
    await GMHistory.redo();
    expect(crate.position.x).toBe(4);
  });

  test("turns in quick succession are one step", async () => {
    const crate = mockObject();
    for (let i = 0; i < 3; i++) GMHistory.track('Turn crate', [crate], () => GMManager.rotateObject(crate, 0.25));
    expect(GMHistory.undoStack.length).toBe(1);
    await GMHistory.undo();
    expect(crate.bearing).toBeCloseTo(0);
  });

  test("undoing a delete brings it back as it was, and later steps still find it", async () => {
    const crate = mockObject('Footlocker', new THREE.Vector3(2, 3, 0));
    GMHistory.track('Move', [crate], () => GMManager.teleportObject(crate, new THREE.Vector3(5, 5, 0)));
    GMHistory.track('Delete', [crate], () => GMManager.deleteObject(crate));
    expect(crate.destroyed).toBe(true);
    await GMHistory.undo();
    const back = spawned[0];
    expect(back.getName()).toBe('Footlocker');
    expect(back.position.toArray()).toEqual([5, 5, 0]);
    // Undoing the move moves the new one
    await GMHistory.undo();
    expect(back.position.toArray()).toEqual([2, 3, 0]);
    // Redo all the way: moved, then deleted again
    await GMHistory.redo();
    await GMHistory.redo();
    expect(back.destroyed).toBe(true);
  });

  test("undoing a placement removes it; a new change clears what could be redone", async () => {
    const crate = mockObject();
    GMHistory.created('Place crate', [crate]);
    await GMHistory.undo();
    expect(crate.destroyed).toBe(true);
    expect(GMHistory.canRedo()).toBe(true);
    const other = mockObject();
    GMHistory.track('Move', [other], () => GMManager.teleportObject(other, new THREE.Vector3(1, 0, 0)));
    expect(GMHistory.canRedo()).toBe(false);
  });

  test("nothing changed is not a step; the log lists newest first, undone ones marked", async () => {
    const crate = mockObject();
    GMHistory.track('Nothing', [crate], () => {});
    expect(GMHistory.undoStack.length).toBe(0);
    GMHistory.track('First', [crate], () => GMManager.teleportObject(crate, new THREE.Vector3(1, 0, 0)));
    GMHistory.track('Second', [crate], () => GMManager.teleportObject(crate, new THREE.Vector3(2, 0, 0)));
    await GMHistory.undo();
    expect(GMHistory.log().map((e) => [e.label, e.undone])).toEqual([['Second', true], ['First', false]]);
  });
});

describe("GM edit tools", () => {
  test("paste keeps the copied layout around the point, selects the copies, and is undoable", async () => {
    const a = mockObject('A', new THREE.Vector3(0, 0, 0));
    const b = mockObject('B', new THREE.Vector3(2, 0, 0));
    expect(GMEditTools.copy([a, b])).toBe(2);
    const made = await GMEditTools.paste(new THREE.Vector3(10, 10, 0));
    expect(made.map((o) => o.position.toArray())).toEqual([[9, 10, 0], [11, 10, 0]]);
    expect(GMManager.selectedObjects()).toEqual(made);
    await GMHistory.undo();
    expect(made.every((o) => o.destroyed)).toBe(true);
  });

  test("duplicate puts copies next to the originals and keeps the clipboard", async () => {
    const a = mockObject('A', new THREE.Vector3(0, 0, 0));
    const saved = mockObject('Saved');
    GMEditTools.copy([saved]);
    const made = await GMEditTools.duplicate([a]);
    expect(made[0].position.toArray()).toEqual([1.5, 1, 0]);
    expect(GMEditTools.clipboard[0].state.described.config.name).toBe('Saved');
  });

  test("groups: saved, selected again, and a deleted member brought back by undo is still in it", async () => {
    const a = mockObject('A'), b = mockObject('B');
    GMEditTools.saveGroup(1, [a, b]);
    GMManager.setSelection([]);
    expect(GMEditTools.recallGroup(1)).toEqual([a, b]);
    GMHistory.track('Delete', [a], () => GMManager.deleteObject(a));
    expect(GMEditTools.groupMembers(1)).toEqual([b]);
    await GMHistory.undo();
    expect(GMEditTools.groupMembers(1).map((o) => o.getName())).toEqual(['A', 'B']);
  });

  test("a group turns around its middle, keeping its layout", () => {
    const a = mockObject('A', new THREE.Vector3(-1, 0, 0)), b = mockObject('B', new THREE.Vector3(1, 0, 0));
    GMEditTools.rotateAround([a, b], Math.PI / 2);
    expect(a.position.x).toBeCloseTo(0);
    expect(a.position.y).toBeCloseTo(-1);
    expect(b.position.y).toBeCloseTo(1);
    expect(a.bearing).toBeCloseTo(Math.PI / 2);
  });

  test("facing a point turns each toward it", () => {
    const a = mockObject('A', new THREE.Vector3(0, 0, 0));
    GMEditTools.faceToward([a], new THREE.Vector3(0, 5, 0));
    // KotOR facing: atan2(self - target) + 90°; due north of it is 0 (the way the model looks unturned)
    expect(Math.cos(a.bearing)).toBeCloseTo(Math.cos(Math.atan2(-5, 0) + Math.PI / 2));
  });

  test("line up spreads them across the view in their left-to-right order", () => {
    jest.spyOn(GMViewport, 'getActiveThreeCamera').mockReturnValue({ getWorldDirection: (v: THREE.Vector3) => v.set(0, 1, 0) } as any);
    const a = mockObject('A', new THREE.Vector3(3, 2, 0)), b = mockObject('B', new THREE.Vector3(-3, -2, 0)), c = mockObject('C', new THREE.Vector3(0, 0, 0));
    GMEditTools.lineUp([a, b, c]);
    // Looking north, right is east: B, C, A from west to east, 1.5 m apart through the middle, all at y = 0
    expect([b, c, a].map((o) => +o.position.x.toFixed(2))).toEqual([-1.5, 0, 1.5]);
    expect([a, b, c].every((o) => Math.abs(o.position.y) < 1e-9)).toBe(true);
  });

  test("pinned objects can't be picked in the scene, but stay selected", () => {
    const a = mockObject('A');
    GMManager.setSelection([a]);
    GMEditTools.setPinned([a], true);
    expect(a.gmPinned).toBe(true);
    expect(GMManager.selectedObjects()).toEqual([a]);
  });
});

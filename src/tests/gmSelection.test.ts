import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// The real GameState pulls in the whole browser engine (WebGL, window, File System Access)
jest.mock("@/GameState", () => ({ GameState: { gmMode: true, PartyManager: { party: [] as any[], Player: undefined as any } } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import * as THREE from "three";
import { GMManager } from "@/managers/GMManager";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import { GMViewport } from "@/managers/gm/GMViewport";
import { GameState } from "@/GameState";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";

let nextId = 1;
function mockObject(kind: 'creature' | 'placeable' | 'door', extra: Record<string, any> = {}): any {
  const type = kind === 'creature' ? ModuleObjectType.ModuleCreature : kind === 'door' ? ModuleObjectType.ModuleDoor : ModuleObjectType.ModulePlaceable;
  let facing = 0;
  const obj: any = {
    id: nextId++,
    objectType: ModuleObjectType.ModuleObject | type,
    position: new THREE.Vector3(0, 0, 0),
    rotation: new THREE.Euler(),
    bearing: 0,
    destroyed: false,
    destroy() { this.destroyed = true; },
    getFacing: () => facing,
    setFacing: (f: number) => { facing = f; },
    getCurrentRoom: jest.fn(),
    computeBoundingBox: jest.fn(),
    clearAllActions: jest.fn(),
    setAnimationState: jest.fn(),
    getName: () => `obj${obj.id}`,
    ...extra,
  };
  return obj;
}

beforeEach(() => {
  GMManager.selection = [];
  GMNetworkManager.role = "offline";
  (GameState as any).PartyManager = { party: [], Player: undefined };
});

describe("GM selection", () => {
  test("click selects one thing; Shift + click adds and takes out", () => {
    const a = mockObject('creature'), b = mockObject('placeable'), c = mockObject('creature');
    GMManager.selectObject(a);
    GMManager.selectObject(b, 'toggle');
    GMManager.selectObject(c, 'toggle');
    expect(GMManager.selectedObjects()).toEqual([a, b, c]);
    // The Inspector shows the last one picked
    expect(GMManager.selectedObject).toBe(c);
    GMManager.selectObject(b, 'toggle');
    expect(GMManager.selectedObjects()).toEqual([a, c]);
    GMManager.selectObject(b);
    expect(GMManager.selectedObjects()).toEqual([b]);
    GMManager.selectedObject = null;
    expect(GMManager.selectedObjects()).toEqual([]);
  });

  test("something deleted elsewhere leaves the selection", () => {
    const a = mockObject('creature'), b = mockObject('creature');
    GMManager.setSelection([a, b, a]);
    expect(GMManager.selection).toEqual([a, b]);
    b.destroyed = true;
    expect(GMManager.selectedObjects()).toEqual([a]);
  });

  test("Delete removes everything selected but the characters players are playing", () => {
    const npc = mockObject('creature'), crate = mockObject('placeable');
    const players = mockObject('creature', { gmOwnerPeerId: 'peer-1' });
    GMManager.setSelection([npc, crate, players]);
    expect(GMManager.deleteObjects(GMManager.selectedObjects())).toBe(2);
    expect(npc.destroyed && crate.destroyed).toBe(true);
    expect(players.destroyed).toBe(false);
    expect(GMManager.selectedObjects()).toEqual([players]);
  });

  test("Ctrl + wheel turns each selected object in place; doors don't move or turn", () => {
    const npc = mockObject('creature'), crate = mockObject('placeable'), door = mockObject('door');
    GMManager.setSelection([npc, crate, door]);
    const list = GMViewport.movableSelection();
    expect(list).toEqual([npc, crate]);
    GMManager.rotateObjects(list, Math.PI / 4);
    expect(npc.getFacing()).toBeCloseTo(Math.PI / 4);
    expect(crate.rotation.z).toBeCloseTo(Math.PI / 4);
    expect(npc.position.length()).toBe(0);
  });

  test("dragging moves the whole selection by the same amount, each standing on the ground", () => {
    const a = mockObject('creature'), b = mockObject('placeable');
    b.position.set(2, 1, 0);
    const delta = new THREE.Vector3(3, -1, 0);
    for (const obj of [a, b]) GMViewport.moveTo({ obj, start: obj.position.clone() }, delta, false);
    expect(a.position.toArray()).toEqual([3, -1, 0]);
    expect(b.position.toArray()).toEqual([5, 0, 0]);
    // A creature put down by a drag stops what it was doing
    expect(a.clearAllActions).toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: { gmMode: true } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import * as THREE from "three";
import { GameState } from "@/GameState";
import { GMManager } from "@/managers/GMManager";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import { GMNpcOrders } from "@/managers/GMNpcOrders";
import { GMViewport } from "@/managers/gm/GMViewport";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ActionType } from "@/enums/actions/ActionType";

/** ActionMoveToPoint stand-in: remembers where it was sent */
class MoveAction {
  type = ActionType.ActionMoveToPoint;
  params: any[] = [];
  setParameter(i: number, _t: number, v: any) { this.params[i] = v; }
  get target() { return new THREE.Vector3(this.params[0], this.params[1], this.params[2]); }
  get run() { return this.params[5] === 1; }
}

function creature(netId: string, x: number, overrides: Record<string, any> = {}): any {
  const queue: any[] = [];
  (queue as any).add = (a: any) => queue.push(a);
  const cre: any = {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    id: netId,
    position: new THREE.Vector3(x, 0, 0),
    actionQueue: queue,
    combatRound: { action: undefined, scheduledActionList: [] as any[], clearActions: jest.fn() },
    combatData: { combatState: false, lastAttacker: undefined },
    isReady: true,
    dead: false,
    hostileTo: new Set<any>(),
    attacks: [] as any[],
    getName() { return netId; },
    isDead() { return this.dead; },
    isHostile(other: any) { return this.hostileTo.has(other); },
    hasLineOfSight: () => true,
    clearAllActions() { queue.length = 0; },
    attackCreature(target: any) { this.attacks.push(target); },
    ...overrides,
  };
  GMManager.registerNetObject(netId, cre);
  return cre;
}

const moves = (cre: any) => cre.actionQueue.filter((a: any) => a instanceof MoveAction) as MoveAction[];

beforeEach(() => {
  GMManager.netIdMap.clear();
  GMNetworkManager.role = "host";
  (GameState as any).GMManager = GMManager;
  (GameState as any).PartyManager = { party: [] };
  (GameState as any).ActionFactory = { ActionMoveToPoint: MoveAction };
  (GameState as any).module = {
    readyToProcessEvents: true,
    area: { id: 1, creatures: [], getNearestWalkablePoint: (p: THREE.Vector3) => p.clone() },
  };
});

afterEach(() => jest.restoreAllMocks());

describe("GM orders for NPCs", () => {
  test("attack: goes after its target until it's dead, then back to its own judgement", () => {
    const npc = creature("cre_0", 0);
    const target = creature("pc_1", 10);
    GMManager.giveOrder(npc, { kind: "attack", targetNetId: "pc_1" });
    GMNpcOrders.think(npc, [npc, target]);
    expect(npc.attacks).toEqual([target]);

    target.dead = true;
    GMNpcOrders.think(npc, [npc, target]);
    expect(GMNpcOrders.getOrder(npc)).toBeUndefined();
  });

  test("follow: walks after its leader (running when far behind), and fights back if attacked", () => {
    const npc = creature("cre_0", 0);
    const leader = creature("pc_1", 12);
    GMManager.giveOrder(npc, { kind: "follow", targetNetId: "pc_1" });
    GMNpcOrders.think(npc, [npc, leader]);
    expect(moves(npc)).toHaveLength(1);
    expect(moves(npc)[0].run).toBe(true);

    npc.actionQueue.length = 0;
    leader.position.set(2, 0, 0);
    GMNpcOrders.think(npc, [npc, leader]);
    expect(moves(npc)).toHaveLength(0);

    const raider = creature("cre_1", 4);
    npc.hostileTo.add(raider);
    npc.combatData.lastAttacker = raider;
    GMNpcOrders.think(npc, [npc, leader, raider]);
    expect(npc.attacks).toEqual([raider]);
  });

  test("move: walks to the spot, then guards it", () => {
    const npc = creature("cre_0", 0);
    GMManager.giveOrder(npc, { kind: "move", point: { x: 10, y: 0, z: 0 } });
    GMNpcOrders.think(npc, [npc]);
    expect(moves(npc)[0].target.x).toBe(10);

    npc.position.set(9.5, 0, 0);
    GMNpcOrders.think(npc, [npc]);
    expect(GMNpcOrders.getOrder(npc)).toEqual({ kind: "guard", point: { x: 10, y: 0, z: 0 }, radius: GMNpcOrders.GUARD_RADIUS });
  });

  test("guard: fights enemies that come close to its spot, ignores far ones, and walks back", () => {
    const npc = creature("cre_0", 0);
    const near = creature("pc_1", 5);
    const far = creature("pc_2", 20);
    npc.hostileTo.add(near).add(far);
    GMManager.giveOrder(npc, { kind: "guard", point: { x: 0, y: 0, z: 0 }, radius: 8 });

    GMNpcOrders.think(npc, [npc, far]);
    expect(npc.attacks).toEqual([]);
    GMNpcOrders.think(npc, [npc, near, far]);
    expect(npc.attacks).toEqual([near]);

    npc.position.set(6, 0, 0);
    GMNpcOrders.think(npc, [npc, far]);
    expect(moves(npc)[0].target.x).toBe(0);
  });

  test("a guard (or someone moving) put somewhere by the GM stays there instead of walking back", () => {
    const placeable = { setAnimationState: jest.fn(), getCurrentRoom: jest.fn(), computeBoundingBox: jest.fn() };
    const guard = creature("cre_0", 0, placeable);
    GMManager.giveOrder(guard, { kind: "guard", point: { x: 0, y: 0, z: 0 }, radius: 8 });
    GMManager.placeAt(guard, new THREE.Vector3(6, 2, 0));
    expect((guard.gmOrder as any).point).toEqual({ x: 6, y: 2, z: 0 });
    GMNpcOrders.think(guard, [guard]);
    expect(moves(guard)).toEqual([]);

    const walker = creature("cre_1", 0, placeable);
    GMManager.giveOrder(walker, { kind: "move", point: { x: 10, y: 0, z: 0 } });
    GMManager.placeAt(walker, new THREE.Vector3(3, 0, 0));
    expect(walker.gmOrder).toMatchObject({ kind: "guard", point: { x: 3, y: 0, z: 0 } });
    GMNpcOrders.think(walker, [walker]);
    expect(moves(walker)).toEqual([]);
  });

  test("a selected NPC's patrol is drawn numbered, in order, with the point it's heading for; so is one being placed", () => {
    const npc = creature("cre_0", 0);
    const points = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, { x: 5, y: 5, z: 0 }];
    GMManager.giveOrder(npc, { kind: "patrol", points, index: 2 });
    GMManager.selection = [npc];
    expect(GMManager.routesToShow()).toEqual([{ points, loop: true, next: 2, numbered: true }]);

    GMManager.activeTool = "order_patrol";
    GMViewport.patrolDraft = [{ x: 1, y: 1, z: 0 }, { x: 2, y: 2, z: 0 }];
    expect(GMManager.routesToShow()[0]).toMatchObject({ points: GMViewport.patrolDraft, draft: true, numbered: true });
    GMManager.activeTool = "select";
    GMViewport.patrolDraft = [];
    GMManager.selection = [];
  });

  test("melee reach: 2 m between people, more when bodies are too big to get that close", () => {
    const { ModuleCreature } = jest.requireActual("@/module/ModuleCreature") as any;
    const size = (creperspace: number) => Object.assign(Object.create(ModuleCreature.prototype), {
      objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
      creatureAppearance: { creperspace, hitdist: creperspace > 2 ? 7 : 1 },
      getAppearance() { return this.creatureAppearance; },
    });
    const person = size(0.4), hound = size(1.2), rancor = size(3.06);
    expect(person.getMeleeRange(person)).toBe(2);
    // Collision keeps a rancor and a hound 4.26 m apart: it has to reach further than that
    expect(rancor.getMeleeRange(hound)).toBeGreaterThan(3.06 + 1.2);
    expect(hound.getMeleeRange(rancor)).toBe(rancor.getMeleeRange(hound));
    // Its size for steering is its body, not appearance.2da's hitdist of 7
    expect(rancor.getHitDistance()).toBeCloseTo(3.06);
    expect(person.getHitDistance()).toBe(1);
  });

  test("patrol: walks from point to point in a loop", () => {
    const npc = creature("cre_0", 0);
    GMManager.giveOrder(npc, { kind: "patrol", points: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], index: 1 });
    jest.spyOn(GMManager, "chooseNpcTarget").mockReturnValue(null);
    GMNpcOrders.think(npc, [npc]);
    expect(moves(npc)[0].target.x).toBe(10);

    npc.actionQueue.length = 0;
    npc.position.set(10, 0, 0);
    GMNpcOrders.think(npc, [npc]);
    expect((GMNpcOrders.getOrder(npc) as any).index).toBe(0);
    GMNpcOrders.think(npc, [npc]);
    expect(moves(npc)[0].target.x).toBe(0);
  });

  test("flee: runs away from the nearest enemy, and never attacks", () => {
    const npc = creature("cre_0", 0);
    const enemy = creature("pc_1", 5);
    npc.hostileTo.add(enemy);
    npc.combatData.lastAttacker = enemy;
    GMManager.giveOrder(npc, { kind: "flee" });
    GMNpcOrders.think(npc, [npc, enemy]);
    expect(npc.attacks).toEqual([]);
    expect(moves(npc)[0].target.x).toBeLessThan(0);
    expect(moves(npc)[0].run).toBe(true);
  });

  test("stand down: drops out of combat, even while being attacked", () => {
    const npc = creature("cre_0", 0);
    const enemy = creature("pc_1", 2);
    npc.hostileTo.add(enemy);
    npc.combatData.lastAttacker = enemy;
    npc.combatData.combatState = true;
    npc.combatRound.action = { target: enemy };
    GMManager.giveOrder(npc, { kind: "standDown" });
    GMNpcOrders.think(npc, [npc, enemy]);
    expect(npc.attacks).toEqual([]);
    expect(npc.combatRound.clearActions).toHaveBeenCalled();
    expect(npc.combatData.combatState).toBe(false);
  });

  test("orders still run when the GM has switched the NPC AI off; NPCs without one then stay put", () => {
    const ordered = creature("cre_0", 0);
    const idle = creature("cre_1", 1);
    const enemy = creature("pc_1", 3, { gmOwnerPeerId: "peer_a" });
    ordered.hostileTo.add(enemy);
    idle.hostileTo.add(enemy);
    (GameState as any).module.area.creatures = [ordered, idle, enemy];
    GMManager.giveOrder(ordered, { kind: "attack", targetNetId: "pc_1" });

    GMManager.updateNpcCombat(false);
    expect(ordered.attacks).toEqual([enemy]);
    expect(idle.attacks).toEqual([]);
  });

  test("players' characters can't be given orders", () => {
    const pc = creature("pc_1", 0, { gmOwnerPeerId: "peer_a" });
    GMManager.giveOrder(pc, { kind: "flee" });
    expect(GMNpcOrders.getOrder(pc)).toBeUndefined();
  });
});

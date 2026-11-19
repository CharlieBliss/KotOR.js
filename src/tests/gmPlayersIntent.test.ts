import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: { gmMode: true } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import * as THREE from "three";
import { GMPlayers } from "@/managers/gm/GMPlayers";
import { GMPacing } from "@/managers/gm/GMPacing";
import { GMManager } from "@/managers/GMManager";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { CombatActionType } from "@/enums/combat/CombatActionType";

function makeActor(netId: string, overrides: Record<string, any> = {}): any {
  const cre: any = {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    gmNetId: netId,
    gmOwnerPeerId: "peer_1",
    position: new THREE.Vector3(0, 0, 0),
    dead: false,
    fp: 20,
    spells: [] as any[],
    feats: [] as any[],
    gmInventory: [] as any[],
    combatRound: { action: null, scheduledActionList: [] as any[] },
    getName: () => overrides.name || "Padawan",
    isDead: () => !!cre.dead,
    getFP: () => cre.fp,
    getSpells: () => cre.spells,
    getFeats: () => cre.feats,
    clearAllActions: jest.fn(),
    attackCreature: jest.fn(),
    ...overrides,
  };
  GMManager.registerNetObject(netId, cre);
  return cre;
}

describe("GMPlayers rules, intents, and refusal explanations", () => {
  beforeEach(() => {
    GMManager.netIdMap.clear();
    GMManager.playersFrozen = false;
    GMNetworkManager.role = "host";
    GMNetworkManager.peers = new Map([["peer_1", { peerId: "peer_1", name: "Alice", role: "client", joinedAt: 1, controlledNetId: "pc_1" } as any]]);
    GMNetworkManager.appendChat = jest.fn();
    GMNetworkManager.send = jest.fn() as any;
    GMNetworkManager.broadcastSessionRules = jest.fn();
    GMManager.notifyChange = jest.fn();
    GMPlayers.deathRule = "kotor";
    GMPlayers.creationLimits = {};
  });

  test("setDeathRule ignores unknown rules and broadcasts valid ones; setCreationLimits stores and broadcasts", () => {
    GMPlayers.setDeathRule("invalid" as any);
    expect(GMPlayers.deathRule).toBe("kotor");
    expect(GMNetworkManager.broadcastSessionRules).not.toHaveBeenCalled();

    GMPlayers.setDeathRule("respawn");
    expect(GMPlayers.deathRule).toBe("respawn");
    expect(GMNetworkManager.broadcastSessionRules).toHaveBeenCalledTimes(1);

    GMPlayers.setCreationLimits({ level: [1, 12], extraPoints: 6, freeFeats: true });
    expect(GMPlayers.creationLimits).toEqual({ level: [1, 12], extraPoints: 6, freeFeats: true });
    expect(GMNetworkManager.broadcastSessionRules).toHaveBeenCalledTimes(2);
  });

  test("whyNot gives clear player-facing reasons for refused abilities", () => {
    const pc = makeActor("pc_1", {
      fp: 5,
      spells: [
        { id: 35, forcehostile: "5", getForcePointCost: () => 25 },
        { id: 36, forcehostile: "1", getForcePointCost: () => 1 },
      ],
      feats: [{ id: 28 }],
      gmInventory: [],
    });
    const enemy = makeActor("npc_enemy", {
      name: "Sith Trooper",
      gmOwnerPeerId: undefined,
      racialType: 6,
    });
    const hidden = makeActor("npc_hidden", { name: "Hidden", gmHidden: true, gmOwnerPeerId: undefined });

    expect(GMPlayers.whyNot(pc, { seq: 1, netId: "pc_1", kind: "ability", ability: "spell", abilityId: 99, targetNetId: "npc_enemy" }))
      .toContain("doesn't know that power");
    expect(GMPlayers.whyNot(pc, { seq: 2, netId: "pc_1", kind: "ability", ability: "spell", abilityId: 36, targetNetId: "npc_enemy" }))
      .toContain("only works on droids");
    expect(GMPlayers.whyNot(pc, { seq: 3, netId: "pc_1", kind: "ability", ability: "spell", abilityId: 35, targetNetId: "npc_enemy" }))
      .toContain("Not enough Force");
    expect(GMPlayers.whyNot(pc, { seq: 4, netId: "pc_1", kind: "ability", ability: "feat", abilityId: 999, targetNetId: "npc_enemy" }))
      .toContain("doesn't have that feat");
    expect(GMPlayers.whyNot(pc, { seq: 5, netId: "pc_1", kind: "ability", ability: "item", resRef: "medpac", targetNetId: "pc_1" }))
      .toContain("none of those left");
    expect(GMPlayers.whyNot(pc, { seq: 6, netId: "pc_1", kind: "ability", ability: "spell", abilityId: 35, targetNetId: "npc_hidden" }))
      .toContain("isn't there any more");

    pc.dead = true;
    expect(GMPlayers.whyNot(pc, { seq: 7, netId: "pc_1", kind: "ability", ability: "spell", abilityId: 35, targetNetId: "npc_enemy" }))
      .toContain("is down");
  });

  test("applyClientIntentOnHost blocks non-cancel intents while playersFrozen and enforces QUEUE_LIMIT", () => {
    const pc = makeActor("pc_1");
    const enemy = makeActor("npc_1", { gmOwnerPeerId: undefined });

    GMManager.playersFrozen = true;
    GMPlayers.applyClientIntentOnHost("peer_1", { seq: 1, netId: "pc_1", kind: "attack", targetNetId: "npc_1" });
    expect(pc.attackCreature).not.toHaveBeenCalled();
    expect(GMNetworkManager.send as any).toHaveBeenCalledWith(
      "player.notice",
      expect.objectContaining({ text: expect.stringContaining("watching for now") }),
      "peer_1"
    );

    // Cancel still succeeds while frozen
    pc.gmFightTarget = enemy;
    GMPlayers.applyClientIntentOnHost("peer_1", { seq: 2, netId: "pc_1", kind: "cancel" });
    expect(pc.gmFightTarget).toBeUndefined();

    // Queue full rejects additional queued abilities without clearing existing actions
    pc.clearAllActions.mockClear();
    GMManager.playersFrozen = false;
    pc.combatRound.scheduledActionList = [1, 2, 3];
    GMPlayers.applyClientIntentOnHost("peer_1", {
      seq: 3, netId: "pc_1", kind: "ability", ability: "spell", abilityId: 35, targetNetId: "npc_1",
    });
    expect(pc.clearAllActions).not.toHaveBeenCalled();
    expect(GMNetworkManager.send as any).toHaveBeenCalledWith(
      "player.notice",
      expect.objectContaining({ text: expect.stringContaining("queue is full") }),
      "peer_1"
    );
  });

  test("isAttackingTarget detects active or queued attacks and avoids restarting current swing", () => {
    const pc = makeActor("pc_1");
    const enemy = makeActor("npc_1", { gmOwnerPeerId: undefined });
    pc.combatRound.action = { target: enemy, actionType: CombatActionType.ATTACK };
    expect(GMPlayers.isAttackingTarget(pc, enemy)).toBe(true);

    GMPlayers.applyClientIntentOnHost("peer_1", { seq: 4, netId: "pc_1", kind: "attack", targetNetId: "npc_1" });
    expect(pc.clearAllActions).not.toHaveBeenCalled();
    expect(pc.gmHostDriven).toBe(true);
  });

  test("during planning, an attack after a planned move keeps the move at the front; cancel drops it", () => {
    const queue: any = [];
    queue.addFront = (a: any) => queue.unshift(a);
    const plannedMove = { gmPlannedMove: true };
    const pc = makeActor("pc_1", {
      actionQueue: queue,
      clearAllActions: jest.fn(() => { queue.length = 0; }),
      attackCreature: jest.fn(() => { queue.push({ kind: "attack" }); }),
    });
    makeActor("npc_1", { gmOwnerPeerId: undefined });
    queue.push(plannedMove);

    GMPacing.phase = "plan";
    try {
      GMPlayers.applyClientIntentOnHost("peer_1", { seq: 5, netId: "pc_1", kind: "attack", targetNetId: "npc_1" });
      expect(pc.attackCreature).toHaveBeenCalled();
      expect(queue[0]).toBe(plannedMove);
      expect(queue[1]).toEqual({ kind: "attack" });
      expect(pc.gmHostDriven).toBe(true);

      // Cancel (Stop) still clears the planned move
      GMPlayers.applyClientIntentOnHost("peer_1", { seq: 6, netId: "pc_1", kind: "cancel" });
      expect(queue).toHaveLength(0);
    } finally {
      GMPacing.phase = "off";
    }
  });
});

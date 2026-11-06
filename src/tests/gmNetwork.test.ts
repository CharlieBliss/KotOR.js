import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

// The real GameState pulls in the whole browser engine (WebGL, window, File System Access)
jest.mock("@/GameState", () => ({ GameState: { gmMode: true } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import * as THREE from "three";
import { GMManager } from "@/managers/GMManager";
import { GMNetworkManager, GMPacket } from "@/managers/GMNetworkManager";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import { OdysseyModelAnimation } from "@/odyssey";
import { GameState } from "@/GameState";
import { CreatureClass } from "@/combat/CreatureClass";
import { TalentFeat } from "@/talents/TalentFeat";
import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";
import { TextSprite3D } from "@/engine/TextSprite3D";

function mockCreature(netId: string, overrides: Record<string, any> = {}): any {
  const cre: any = {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    position: new THREE.Vector3(0, 0, 0),
    actionQueue: [] as any[],
    animationState: { index: ModuleCreatureAnimState.PAUSE },
    combatData: { combatState: false },
    dead: false,
    hostile: false,
    isDead() { return this.dead; },
    isHostile() { return this.hostile; },
    getWalkSpeed: () => 1.75,
    getCurrentRoom: jest.fn(),
    setFacing: jest.fn(),
    setAnimationState(index: number) { this.animationState.index = index; },
    clearAllActions() { this.actionQueue.length = 0; },
    actionOpenDoor(target: any) { this.actionQueue.push({ type: "open", target }); },
    actionUseObject(target: any) { this.actionQueue.push({ type: "use", target }); },
    attackCreature(target: any) { this.actionQueue.push({ type: "attack", target }); },
    ...overrides,
  };
  GMManager.registerNetObject(netId, cre);
  return cre;
}

function mockDoor(netId: string): any {
  const door: any = {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleDoor,
    position: new THREE.Vector3(5, 0, 0),
  };
  GMManager.registerNetObject(netId, door);
  return door;
}

let sent: GMPacket[];

beforeEach(() => {
  GMManager.netIdMap.clear();
  GMNetworkManager.role = "offline";
  GMNetworkManager.assignedActorNetId = null;
  GMNetworkManager.awaitingHost = false;
  GMNetworkManager.localIntentSeq = 0;
  sent = [];
  jest.spyOn(GMNetworkManager, "sendPacket").mockImplementation((pkt: GMPacket) => { sent.push(pkt); });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GM multiplayer host authority", () => {
  describe("host", () => {
    beforeEach(() => {
      GMNetworkManager.role = "host";
    });

    test("ignores intents and movement from a peer that does not own the actor", () => {
      const pc = mockCreature("pc_1", { gmOwnerPeerId: "peer_a" });
      const door = mockDoor("door_0");

      GMManager.applyClientIntentOnHost("peer_b", { netId: "pc_1", kind: "open", targetNetId: "door_0", seq: 1 });
      GMManager.applyClientInputOnHost("peer_b", { netId: "pc_1", x: 9, y: 9, z: 0 });

      expect(pc.actionQueue).toHaveLength(0);
      expect(pc.gmHostDriven).toBeFalsy();
      expect(pc.gmNetTarget).toBeUndefined();
      expect(door).toBeDefined();
    });

    test("runs an owned open intent through the normal door action and takes position authority", () => {
      const pc = mockCreature("pc_1", { gmOwnerPeerId: "peer_a" });
      const door = mockDoor("door_0");

      GMManager.applyClientIntentOnHost("peer_a", { netId: "pc_1", kind: "open", targetNetId: "door_0", seq: 3 });

      expect(pc.actionQueue).toEqual([{ type: "open", target: door }]);
      expect(pc.gmHostDriven).toBe(true);
      expect(pc.gmIntentSeq).toBe(3);

      // Client positions are ignored while the host walks the actor to the door
      GMManager.applyClientInputOnHost("peer_a", { netId: "pc_1", x: 9, y: 9, z: 0 });
      expect(pc.gmNetTarget).toBeUndefined();
    });

    test("only attacks creatures and rejects unknown or self targets", () => {
      const pc = mockCreature("pc_1", { gmOwnerPeerId: "peer_a" });
      mockDoor("door_0");

      GMManager.applyClientIntentOnHost("peer_a", { netId: "pc_1", kind: "attack", targetNetId: "door_0", seq: 1 });
      expect(pc.actionQueue).toHaveLength(0);
      expect(pc.gmHostDriven).toBe(false);

      GMManager.applyClientIntentOnHost("peer_a", { netId: "pc_1", kind: "use", targetNetId: "pc_1", seq: 2 });
      expect(pc.gmHostDriven).toBe(false);

      GMManager.applyClientIntentOnHost("peer_a", { netId: "pc_1", kind: "use", targetNetId: "missing", seq: 3 });
      expect(pc.gmHostDriven).toBe(false);
    });

    test("hands authority back when the action queue empties or the client cancels", () => {
      const pc = mockCreature("pc_1", { gmOwnerPeerId: "peer_a" });
      const enemy = mockCreature("cre_0");

      GMManager.applyClientIntentOnHost("peer_a", { netId: "pc_1", kind: "attack", targetNetId: "cre_0", seq: 1 });
      GMManager.updateHostDrivenActors();
      expect(pc.gmHostDriven).toBe(true);

      pc.actionQueue.length = 0; // target died / attack finished
      GMManager.updateHostDrivenActors();
      expect(pc.gmHostDriven).toBe(false);

      GMManager.applyClientIntentOnHost("peer_a", { netId: "pc_1", kind: "attack", targetNetId: "cre_0", seq: 2 });
      GMManager.applyClientIntentOnHost("peer_a", { netId: "pc_1", kind: "cancel", seq: 3 });
      expect(pc.gmHostDriven).toBe(false);
      expect(pc.actionQueue).toHaveLength(0);
      expect(pc.gmIntentSeq).toBe(3);
      expect(enemy).toBeDefined();
    });

    test("streams owned actor movement as a smoothed target, not a teleport", () => {
      const pc = mockCreature("pc_1", { gmOwnerPeerId: "peer_a" });

      GMManager.applyClientInputOnHost("peer_a", { netId: "pc_1", x: 2, y: 0, z: 0, facing: 1 });

      expect(pc.gmNetTarget.x).toBe(2);
      expect(pc.position.x).toBe(0);
      expect(pc.setFacing).toHaveBeenCalledWith(1, false);
      expect(GMManager.isNetMotionDriven(pc)).toBe(true);
      expect(GMManager.isNetReplica(pc)).toBe(false);
    });
  });

  describe("client", () => {
    beforeEach(() => {
      GMNetworkManager.role = "client";
      GMNetworkManager.assignedActorNetId = "pc_1";
    });

    test("treats every networked creature except our own actor as a host-simulated replica", () => {
      const mine = mockCreature("pc_1");
      const npc = mockCreature("cre_0");

      expect(GMManager.isNetReplica(npc)).toBe(true);
      expect(GMManager.isNetReplica(mine)).toBe(false);

      GMNetworkManager.awaitingHost = true;
      expect(GMManager.isNetReplica(mine)).toBe(true);
    });

    test("turns clicks on doors, containers and enemies into intents, leaving friendly creatures local", () => {
      const mine = mockCreature("pc_1");
      const door = mockDoor("door_0");
      const container: any = { objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModulePlaceable, gmNetId: "plc_0" };
      const enemy = mockCreature("cre_0", { hostile: true });
      const friend = mockCreature("cre_1");

      expect(GMManager.interceptInteraction(mine, door)).toBe(true);
      expect(GMManager.interceptInteraction(mine, container)).toBe(true);
      expect(GMManager.interceptInteraction(mine, enemy)).toBe(true);
      expect(GMManager.interceptInteraction(mine, friend)).toBe(false);

      expect(sent.map((p) => [p.payload.kind, p.payload.targetNetId, p.payload.seq])).toEqual([
        ["open", "door_0", 1],
        ["use", "plc_0", 2],
        ["attack", "cre_0", 3],
      ]);
      expect(GMNetworkManager.awaitingHost).toBe(true);
    });

    test("does not intercept clicks for a creature we do not control or when offline", () => {
      const other = mockCreature("pc_2");
      const door = mockDoor("door_0");
      expect(GMManager.interceptInteraction(other, door)).toBe(false);

      GMNetworkManager.role = "offline";
      const mine = mockCreature("pc_1");
      expect(GMManager.interceptInteraction(mine, door)).toBe(false);
      expect(sent).toHaveLength(0);
    });

    test("follows the host while it drives our actor and resumes only after the host has finished our latest intent", () => {
      const mine = mockCreature("pc_1");
      jest.spyOn(GMManager, "spawnOrUpdateFromSerialized").mockImplementation(async () => mine);
      jest.spyOn(GMManager, "setCreatureHP").mockImplementation(() => {});
      GMManager.controlMode = "POSSESS";
      (GameState as any).module = { readyToProcessEvents: true };

      GMNetworkManager.sendIntent("open", "door_0");
      const tick = (intentSeq: number, hostDriven: boolean): any => ({ netId: "pc_1", intentSeq, hostDriven, hp: 10, maxHp: 10 });

      // Host has not seen the intent yet: stay host-driven even though hostDriven is false
      GMManager.applyWorldTickOnClient([tick(0, false)]);
      expect(GMNetworkManager.awaitingHost).toBe(true);

      GMManager.applyWorldTickOnClient([tick(1, true)]);
      expect(GMNetworkManager.awaitingHost).toBe(true);
      expect(GMManager.spawnOrUpdateFromSerialized).toHaveBeenCalledTimes(2);

      GMManager.applyWorldTickOnClient([tick(1, false)]);
      expect(GMNetworkManager.awaitingHost).toBe(false);
      expect(GMManager.spawnOrUpdateFromSerialized).toHaveBeenCalledTimes(2);
    });

    test("local movement cancels a pending intent and reclaims the actor", () => {
      GMNetworkManager.sendIntent("attack", "cre_0");
      GMNetworkManager.notifyLocalMovement();

      expect(GMNetworkManager.awaitingHost).toBe(false);
      expect(sent.map((p) => p.payload.kind)).toEqual(["attack", "cancel"]);

      GMNetworkManager.notifyLocalMovement();
      expect(sent).toHaveLength(2);
    });
  });

  describe("session robustness", () => {
    beforeEach(() => {
      GMNetworkManager.gmManager = GMManager;
      GMNetworkManager.peers.clear();
      jest.spyOn(GMNetworkManager, "sendWorldSnapshot").mockImplementation(() => {});
    });

    const packet = (type: any, senderId: string, payload: any = {}): GMPacket => ({ type, senderId, timestamp: 0, payload });

    test("a reconnecting player takes back their existing character instead of spawning a new one", async () => {
      GMNetworkManager.role = "host";
      mockCreature("pc_1", { gmOwnerPeerId: "peer_a" });
      const spawn = jest.spyOn(GMManager, "spawnPlayerFromNetworkPreset").mockImplementation(async () => "pc_new");

      await GMNetworkManager.onPacketReceived(packet("peer.join", "peer_a", { name: "Alice" }));

      expect(spawn).not.toHaveBeenCalled();
      expect(GMNetworkManager.peers.get("peer_a")?.controlledNetId).toBe("pc_1");
      expect(sent).toContainEqual(expect.objectContaining({ type: "actor.assign", targetPeerId: "peer_a", payload: expect.objectContaining({ netId: "pc_1" }) }));
    });

    test("a new player still gets a freshly spawned character", async () => {
      GMNetworkManager.role = "host";
      const spawn = jest.spyOn(GMManager, "spawnPlayerFromNetworkPreset").mockImplementation(async () => "pc_new");

      await GMNetworkManager.onPacketReceived(packet("peer.join", "peer_b", { name: "Bob" }));

      expect(spawn).toHaveBeenCalledTimes(1);
      expect(GMNetworkManager.peers.get("peer_b")?.controlledNetId).toBe("pc_new");
    });

    test("a leaving player's character stops what the host was doing for it and stays in the world", async () => {
      GMNetworkManager.role = "host";
      const pc = mockCreature("pc_1", { gmOwnerPeerId: "peer_a" });
      mockDoor("door_0");
      GMNetworkManager.peers.set("peer_a", { peerId: "peer_a", name: "Alice", role: "client", joinedAt: 0, controlledNetId: "pc_1" });
      GMManager.applyClientIntentOnHost("peer_a", { netId: "pc_1", kind: "open", targetNetId: "door_0", seq: 1 });
      expect(pc.gmHostDriven).toBe(true);

      await GMNetworkManager.onPacketReceived(packet("peer.leave", "peer_a"));

      expect(pc.gmHostDriven).toBe(false);
      expect(pc.actionQueue).toHaveLength(0);
      expect(GMManager.netIdMap.get("pc_1")).toBe(pc);
      expect(GMNetworkManager.peers.has("peer_a")).toBe(false);
    });

    test("the host ignores world-changing packets, which only it may send", async () => {
      GMNetworkManager.role = "host";
      const remove = jest.spyOn(GMManager, "removeActorByNetId");
      const update = jest.spyOn(GMManager, "spawnOrUpdateFromSerialized");
      const door = jest.spyOn(GMManager, "applyDoorStateOnClient");

      await GMNetworkManager.onPacketReceived(packet("actor.remove", "peer_a", { netId: "cre_0" }));
      await GMNetworkManager.onPacketReceived(packet("actor.update", "peer_a", { actor: { netId: "cre_0" } }));
      await GMNetworkManager.onPacketReceived(packet("door.state", "peer_a", { netId: "door_0" }));

      expect(remove).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(door).not.toHaveBeenCalled();
    });

    test("picks a new player id and re-registers when the relay says the id is taken", async () => {
      GMNetworkManager.role = "client";
      const oldId = GMNetworkManager.peerId;
      const resend = jest.fn();
      GMNetworkManager.resendRegistration = resend;

      await GMNetworkManager.onPacketReceived(packet("relay.error", "relay", { code: "peer-id-in-use" }));

      expect(GMNetworkManager.peerId).not.toBe(oldId);
      expect(resend).toHaveBeenCalledTimes(1);
    });

    test("goes offline when another GM is already hosting", async () => {
      GMNetworkManager.role = "host";
      await GMNetworkManager.onPacketReceived(packet("relay.error", "relay", { code: "host-exists", message: "A GM is already hosting on this server." }));

      expect(GMNetworkManager.role).toBe("offline");
      expect(GMNetworkManager.statusMessage).toBe("A GM is already hosting on this server.");
    });
  });

  describe("host visuals mirrored to players", () => {
    const fxSent = () => sent.filter((p) => p.type === "fx.event").map((p) => p.payload);
    const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

    test("sends a creature's 2DA animation with the state index its caller set afterwards", async () => {
      GMNetworkManager.role = "host";
      const cre = mockCreature("cre_0");
      const animation: any = { name: "g8a1" };

      cre.animationState = { index: 10000, animation };
      GMManager.onHostTwoDAAnimation(cre, animation);
      cre.animationState.index = ModuleCreatureAnimState.ATTACK; // CombatRound sets this right after playing
      await flushMicrotasks();

      expect(fxSent()).toEqual([{ kind: "anim", netId: "cre_0", anim: "g8a1", index: ModuleCreatureAnimState.ATTACK }]);
    });

    test("sends nothing for objects players don't know about, or when not hosting", async () => {
      GMNetworkManager.role = "host";
      const local: any = { animationState: {}, effects: [] };
      GMManager.onHostTwoDAAnimation(local, { name: "g8a1" } as any);
      GMManager.onHostTextSprite(local, "12", 1, 1500);

      GMNetworkManager.role = "client";
      const cre = mockCreature("cre_0");
      GMManager.onHostTextSprite(cre, "12", 1, 1500);
      await flushMicrotasks();

      expect(fxSent()).toEqual([]);
    });

    test("sends combat text and visual effects, but no removal for instant effects", () => {
      GMNetworkManager.role = "host";
      const cre = mockCreature("cre_0");
      const effect = (durationType: number): any => ({
        object: cre,
        getInt: (i: number) => (i === 0 ? 1007 : 0),
        getDurationType: () => durationType,
        getDuration: () => 6000,
      });

      GMManager.onHostTextSprite(cre, "miss", 0, 1500);
      const aura = effect(2);
      GMManager.onHostVisualEffectApplied(aura);
      GMManager.onHostVisualEffectRemoved(aura);
      const impact = effect(0);
      GMManager.onHostVisualEffectApplied(impact);
      GMManager.onHostVisualEffectRemoved(impact);

      expect(fxSent().map((e: any) => e.kind)).toEqual(["text", "vfx.add", "vfx.remove", "vfx.add"]);
      expect(fxSent()[1]).toEqual(expect.objectContaining({ netId: "cre_0", vfx: 1007, durationType: 2, duration: 6000 }));
      expect(fxSent()[2].fxId).toBe(aura.gmFxId);
    });

    test("players replay the animation and keep the host's state index", () => {
      GMNetworkManager.role = "client";
      const cre = mockCreature("cre_0", {
        playTwoDAAnimation(anim: any) { this.animationState = { index: ModuleCreatureAnimState.PAUSE, animation: anim }; },
      });
      const animation = { name: "g8a1" };
      jest.spyOn(OdysseyModelAnimation, "GetAnimation2DA").mockReturnValue(animation as any);

      GMManager.applyFxEventOnClient({ kind: "anim", netId: "cre_0", anim: "g8a1", index: ModuleCreatureAnimState.ATTACK });

      expect(cre.animationState).toEqual({ index: ModuleCreatureAnimState.ATTACK, animation });
    });

    test("a running replayed animation isn't cut short by the tick's state", () => {
      GMNetworkManager.role = "client";
      const animation = { name: "g8d1" };
      const cre = mockCreature("cre_0", {
        playTwoDAAnimation(anim: any) { this.animationState = { index: ModuleCreatureAnimState.PAUSE, animation: anim }; },
      });
      jest.spyOn(OdysseyModelAnimation, "GetAnimation2DA").mockReturnValue(animation as any);
      GMManager.applyFxEventOnClient({ kind: "anim", netId: "cre_0", anim: "g8d1", index: ModuleCreatureAnimState.DAMAGE });
      GMManager.setNetTarget(cre, 0, 0, 0);

      cre.gmNetAnim = ModuleCreatureAnimState.READY;
      GMManager.updateNetMotion(cre, 1 / 60);
      expect(cre.animationState.animation).toBe(animation);

      cre.animationState = { index: ModuleCreatureAnimState.PAUSE, animation: { name: "pause1" } }; // replay finished
      GMManager.updateNetMotion(cre, 1 / 60);
      expect(cre.animationState.index).toBe(ModuleCreatureAnimState.READY);
    });

    test("players show the host's combat text on their copy", () => {
      GMNetworkManager.role = "client";
      const cre = mockCreature("cre_0");
      const create = jest.spyOn(TextSprite3D, "CreateOnObject").mockImplementation(() => undefined as any);

      GMManager.applyFxEventOnClient({ kind: "text", netId: "cre_0", text: "14", style: 1, timer: 1500 });

      expect(create).toHaveBeenCalledWith(cre, "14", 1, 1500);
    });
  });

  describe("host-granted looting", () => {
    const item = (resRef: string, stack = 1): any => ({
      getEquippedRes: () => resRef, getInventoryRes: () => resRef, getTemplateResRef: () => resRef, getStackSize: () => stack,
    });
    const container = (netId: string, items: any[]): any => {
      const plc: any = { objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModulePlaceable, position: new THREE.Vector3(1, 0, 0), inventory: items };
      GMManager.registerNetObject(netId, plc);
      return plc;
    };

    test("the host sends a remote player the contents instead of opening its own loot window", () => {
      GMNetworkManager.role = "host";
      const pc = mockCreature("pc_1", { gmOwnerPeerId: "peer_a" });
      const chest = container("plc_0", [item("g_i_medeqpmnt01"), item("g_i_credits001", 50)]);

      expect(GMManager.routeContainerOpen(chest, pc)).toBe(true);
      expect(sent).toEqual([expect.objectContaining({
        type: "container.open",
        targetPeerId: "peer_a",
        payload: { containerNetId: "plc_0", items: [{ resRef: "g_i_medeqpmnt01", stack: 1 }, { resRef: "g_i_credits001", stack: 50 }] },
      })]);
    });

    test("the GM's own character still uses the normal loot window", () => {
      GMNetworkManager.role = "host";
      const gmCharacter = mockCreature("pc_gm");
      const chest = container("plc_0", [item("g_i_medeqpmnt01")]);
      expect(GMManager.routeContainerOpen(chest, gmCharacter)).toBe(false);
    });

    test("taking items empties the host's container and grants them to that player only once", () => {
      GMNetworkManager.role = "host";
      mockCreature("pc_1", { gmOwnerPeerId: "peer_a" });
      const chest = container("plc_0", [item("g_i_medeqpmnt01"), item("g_i_secspike01")]);

      GMManager.applyClientIntentOnHost("peer_a", { netId: "pc_1", kind: "loot", targetNetId: "plc_0", seq: 1 });
      GMManager.applyClientIntentOnHost("peer_a", { netId: "pc_1", kind: "loot", targetNetId: "plc_0", seq: 2 });

      expect(chest.inventory).toEqual([]);
      const grants = sent.filter((p) => p.type === "container.loot");
      expect(grants.map((p) => p.payload.items.length)).toEqual([2, 0]);
      expect(grants[0].targetPeerId).toBe("peer_a");
    });

    test("players out of reach get nothing", () => {
      GMNetworkManager.role = "host";
      mockCreature("pc_1", { gmOwnerPeerId: "peer_a", position: new THREE.Vector3(50, 0, 0) });
      const chest = container("plc_0", [item("g_i_medeqpmnt01")]);

      GMManager.applyClientIntentOnHost("peer_a", { netId: "pc_1", kind: "loot", targetNetId: "plc_0", seq: 1 });

      expect(chest.inventory).toHaveLength(1);
      expect(sent.filter((p) => p.type === "container.loot")).toHaveLength(0);
    });

    test("on a player's screen, taking items asks the host instead of taking locally", () => {
      GMNetworkManager.role = "client";
      GMNetworkManager.assignedActorNetId = "pc_1";
      const chest = container("plc_0", [item("g_i_medeqpmnt01")]);

      expect(GMManager.requestNetworkLoot(chest)).toBe(true);
      expect(chest.inventory).toEqual([]);
      expect(sent.map((p) => [p.type, p.payload.kind, p.payload.targetNetId])).toEqual([["client.intent", "loot", "plc_0"]]);
      // Looting doesn't hand the character's movement to the host
      expect(GMNetworkManager.awaitingHost).toBe(false);
    });
  });

  describe("host-owned character sheets and inventories", () => {
    const mockItem = (resRef: string): any => ({ getEquippedRes: () => resRef, getInventoryRes: () => resRef, setStackSize: jest.fn() });
    const sheetCreature = (netId: string, overrides: Record<string, any> = {}) => mockCreature(netId, {
      str: 18, dex: 14, con: 15, int: 12, wis: 14, cha: 14,
      classes: [{ id: 3, level: 10, spells: [{ id: 5 }] }],
      feats: [{ id: 11 }, { id: 27 }],
      skills: [{ rank: 4, setRank(r: number) { this.rank = r; } }, { rank: 0, setRank(r: number) { this.rank = r; } }],
      forcePoints: 40, maxForcePoints: 40, currentForce: 0, experience: 1200,
      equipment: { RIGHTHAND: mockItem("g_w_lghtsbr01") },
      getHP: () => 150, getMaxHP: () => 150,
      equipItem: jest.fn(async function (this: any, slot: number, item: any) { this.equipment[slot === 0x10 ? "RIGHTHAND" : "ARMOR"] = item; }),
      unequipSlot: jest.fn(function (this: any, slot: number) { delete this.equipment[slot === 0x10 ? "RIGHTHAND" : "ARMOR"]; }),
      ...overrides,
    });

    test("loot goes into the host's record of that player's inventory, merging stacks", () => {
      GMNetworkManager.role = "host";
      const pc = sheetCreature("pc_1", { gmOwnerPeerId: "peer_a" });
      GMManager.addToPlayerInventory(pc, [{ resRef: "g_i_medeqpmnt01", stack: 1 }]);
      const chest: any = { objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModulePlaceable, position: new THREE.Vector3(1, 0, 0), inventory: [mockItem("g_i_medeqpmnt01"), mockItem("g_i_secspike01")] };
      chest.inventory.forEach((i: any) => (i.getStackSize = () => 1, i.getTemplateResRef = () => ""));
      GMManager.registerNetObject("plc_0", chest);

      GMManager.applyClientIntentOnHost("peer_a", { netId: "pc_1", kind: "loot", targetNetId: "plc_0", seq: 1 });

      expect(GMManager.getPlayerInventory(pc)).toEqual([{ resRef: "g_i_medeqpmnt01", stack: 2 }, { resRef: "g_i_secspike01", stack: 1 }]);
    });

    test("the sheet carries the host's real stats, equipment and inventory", () => {
      GMNetworkManager.role = "host";
      const pc = sheetCreature("pc_1");
      GMManager.addToPlayerInventory(pc, [{ resRef: "g_i_medeqpmnt02", stack: 1 }]);

      expect(GMManager.buildPlayerSheet(pc)).toEqual({
        netId: "pc_1",
        classes: [{ id: 3, level: 10, spells: [5] }],
        attributes: { str: 18, dex: 14, con: 15, int: 12, wis: 14, cha: 14 },
        feats: [11, 27],
        skills: [4, 0],
        hp: 150, maxHp: 150,
        forcePoints: 40, maxForcePoints: 40, currentForce: 0,
        xp: 1200,
        equipment: { RIGHTHAND: "g_w_lghtsbr01" },
        inventory: [{ resRef: "g_i_medeqpmnt02", stack: 1 }],
      });
    });

    test("each player is sent their sheet when it changes, and not otherwise", () => {
      GMNetworkManager.role = "host";
      const pc = sheetCreature("pc_1", { gmOwnerPeerId: "peer_a" });
      GMNetworkManager.peers.clear();
      GMNetworkManager.peers.set("peer_a", { peerId: "peer_a", name: "A", role: "client", joinedAt: 0, controlledNetId: "pc_1" });

      GMManager.updatePlayerSheets();
      GMManager.updatePlayerSheets();
      pc.experience = 1500;
      GMManager.updatePlayerSheets();

      const sheets = sent.filter((p) => p.type === "player.sheet");
      expect(sheets.map((p) => [p.targetPeerId, p.payload.xp])).toEqual([["peer_a", 1200], ["peer_a", 1500]]);
      GMNetworkManager.peers.clear();
    });

    test("a player who rejoins is sent their unchanged sheet again", () => {
      GMNetworkManager.role = "host";
      sheetCreature("pc_1", { gmOwnerPeerId: "peer_a" });
      GMNetworkManager.peers.clear();
      GMNetworkManager.peers.set("peer_a", { peerId: "peer_a", name: "A", role: "client", joinedAt: 1000, controlledNetId: "pc_1" });
      GMManager.updatePlayerSheets();

      // Same player id after a reload, new join
      GMNetworkManager.peers.set("peer_a", { peerId: "peer_a", name: "A", role: "client", joinedAt: 2000, controlledNetId: "pc_1" });
      GMManager.updatePlayerSheets();

      expect(sent.filter((p) => p.type === "player.sheet")).toHaveLength(2);
      GMNetworkManager.peers.clear();
    });

    test("equipping takes the item out of the player's inventory and returns what was in the slot", async () => {
      GMNetworkManager.role = "host";
      const pc = sheetCreature("pc_1", { gmOwnerPeerId: "peer_a" });
      GMManager.addToPlayerInventory(pc, [{ resRef: "g_w_dblsbr001", stack: 1 }]);
      jest.spyOn(GMManager, "createItemFromResRefAsync").mockImplementation(async (resRef: string) => mockItem(resRef));

      await GMManager.equipOnHost(pc, ModuleCreatureArmorSlot.RIGHTHAND, "g_w_dblsbr001");

      expect(pc.equipment.RIGHTHAND.getEquippedRes()).toBe("g_w_dblsbr001");
      expect(GMManager.getPlayerInventory(pc)).toEqual([{ resRef: "g_w_lghtsbr01", stack: 1 }]);
    });

    test("players can't equip items they don't have", async () => {
      GMNetworkManager.role = "host";
      const pc = sheetCreature("pc_1", { gmOwnerPeerId: "peer_a" });

      await GMManager.equipOnHost(pc, ModuleCreatureArmorSlot.RIGHTHAND, "g_w_cheatsbr01");

      expect(pc.equipItem).not.toHaveBeenCalled();
      expect(pc.equipment.RIGHTHAND.getEquippedRes()).toBe("g_w_lghtsbr01");
    });

    test("unequipping moves the item back into the player's inventory", () => {
      GMNetworkManager.role = "host";
      const pc = sheetCreature("pc_1", { gmOwnerPeerId: "peer_a" });

      GMManager.applyClientIntentOnHost("peer_a", { netId: "pc_1", kind: "unequip", slot: ModuleCreatureArmorSlot.RIGHTHAND, seq: 1 });

      expect(pc.equipment.RIGHTHAND).toBeUndefined();
      expect(GMManager.getPlayerInventory(pc)).toEqual([{ resRef: "g_w_lghtsbr01", stack: 1 }]);
    });

    test("on a player's screen, equipping their own character sends a request instead", () => {
      GMNetworkManager.role = "client";
      GMNetworkManager.assignedActorNetId = "pc_1";
      const mine = sheetCreature("pc_1");
      const other = sheetCreature("pc_2");

      expect(GMManager.requestNetworkEquip(mine, ModuleCreatureArmorSlot.ARMOR, mockItem("g_a_jedirobe01"))).toBe(true);
      expect(GMManager.requestNetworkUnequip(mine, ModuleCreatureArmorSlot.RIGHTHAND)).toBe(true);
      expect(GMManager.requestNetworkEquip(other, ModuleCreatureArmorSlot.ARMOR, mockItem("g_a_jedirobe01"))).toBe(false);

      GMManager.applyingHostSheet = true;
      expect(GMManager.requestNetworkEquip(mine, ModuleCreatureArmorSlot.ARMOR, mockItem("g_a_jedirobe01"))).toBe(false);
      GMManager.applyingHostSheet = false;

      expect(sent.map((p) => [p.payload.kind, p.payload.slot, p.payload.resRef])).toEqual([
        ["equip", ModuleCreatureArmorSlot.ARMOR, "g_a_jedirobe01"],
        ["unequip", ModuleCreatureArmorSlot.RIGHTHAND, undefined],
      ]);
      expect(GMNetworkManager.awaitingHost).toBe(false);
    });

    test("applying the host's sheet makes the player's character match it", async () => {
      GMNetworkManager.role = "client";
      GMNetworkManager.assignedActorNetId = "pc_1";
      const mine = sheetCreature("pc_1", { str: 16, con: 14, classes: [], feats: [], experience: 0, equipment: { RIGHTHAND: mockItem("g_w_lghtsbr01") } });
      (GameState as any).TwoDAManager = { datatables: new Map([["feat", { rows: {} }], ["classes", { rows: {} }]]) };
      (GameState as any).InventoryManager = { inventory: [] };
      jest.spyOn(CreatureClass.prototype as any, "apply2DA").mockImplementation(() => {});
      jest.spyOn(TalentFeat, "From2DA").mockImplementation((row: any) => ({ id: row.__index }) as any);
      jest.spyOn(GMManager, "createItemFromResRefAsync").mockImplementation(async (resRef: string) => mockItem(resRef));
      jest.spyOn(GMManager, "setCreatureHP").mockImplementation(() => {});
      GMManager.lastAppliedInventoryJson = "";

      await GMManager.applyPlayerSheetOnClient({
        netId: "pc_1",
        classes: [{ id: 3, level: 10, spells: [] }],
        attributes: { str: 18, dex: 14, con: 15, int: 12, wis: 14, cha: 14 },
        feats: [11],
        skills: [6, 2],
        hp: 150, maxHp: 150, forcePoints: 40, maxForcePoints: 40, currentForce: 0,
        xp: 1200,
        equipment: { ARMOR: "g_a_jedirobe01" },
        inventory: [{ resRef: "g_i_medeqpmnt02", stack: 1 }],
      });

      expect([mine.str, mine.con, mine.experience]).toEqual([18, 15, 1200]);
      expect(mine.classes.map((c: any) => [c.id, c.level])).toEqual([[3, 10]]);
      expect(mine.feats.map((f: any) => f.id)).toEqual([11]);
      expect(mine.skills.map((s: any) => s.rank)).toEqual([6, 2]);
      expect(mine.unequipSlot).toHaveBeenCalledWith(ModuleCreatureArmorSlot.RIGHTHAND);
      expect(mine.equipment.ARMOR.getEquippedRes()).toBe("g_a_jedirobe01");
      expect((GameState as any).InventoryManager.inventory.map((i: any) => i.getEquippedRes())).toEqual(["g_i_medeqpmnt02"]);
      // Applying the host's equipment must not be sent back to the host as requests
      expect(sent.filter((p) => p.type === "client.intent")).toHaveLength(0);
    });
  });

  describe("scene changes", () => {
    test("no world updates are sent or applied while a scene is loading", () => {
      (GameState as any).module = { readyToProcessEvents: true, area: { creatures: [], placeables: [] } };
      (GameState as any).PartyManager = { party: [] };
      const spawn = jest.spyOn(GMManager, "spawnOrUpdateFromSerialized").mockImplementation(async () => null);
      const tick: any = [{ netId: "cre_old", kind: "creature" }];

      GMManager.sceneLoading = true;
      GMManager.applyWorldTickOnClient(tick);
      expect(GMManager.serializeActorsForTick()).toEqual([]);
      expect(spawn).not.toHaveBeenCalled();

      GMManager.sceneLoading = false;
      GMManager.applyWorldTickOnClient(tick);
      expect(spawn).toHaveBeenCalledTimes(1);
    });
  });

  describe("GM tool rules", () => {
    afterEach(() => {
      GMManager.selectedObject = null;
      GMManager.controlMode = "FREECAM";
      GMManager.placementYawOffset = 0;
    });

    test("teleport only targets the selection, or the character being played", () => {
      (GameState as any).getCurrentPlayer = () => ({ name: "played" });
      GMManager.selectedObject = null;
      GMManager.controlMode = "FREECAM";
      expect(GMManager.getTeleportTarget()).toBeNull();

      GMManager.controlMode = "POSSESS";
      expect(GMManager.getTeleportTarget()).toEqual({ name: "played" });

      const selected: any = { name: "selected" };
      GMManager.selectedObject = selected;
      expect(GMManager.getTeleportTarget()).toBe(selected);
    });

    test("placement rotation wraps around in both directions", () => {
      GMManager.rotatePlacement(-45);
      expect(GMManager.placementYawOffset).toBe(315);
      GMManager.rotatePlacement(90);
      expect(GMManager.placementYawOffset).toBe(45);
    });

    test("GM tools are for the GM, not for players joined to a session", () => {
      GMNetworkManager.role = "offline";
      expect(GMManager.isGMUser()).toBe(true);
      GMNetworkManager.role = "host";
      expect(GMManager.isGMUser()).toBe(true);
      GMNetworkManager.role = "client";
      expect(GMManager.isGMUser()).toBe(false);
    });
  });

  describe("replica motion", () => {
    test("snaps on first sync or teleport, otherwise glides toward the target with a run animation", () => {
      const cre = mockCreature("cre_0");

      GMManager.setNetTarget(cre, 20, 0, 0);
      expect(cre.position.x).toBe(20);

      GMManager.setNetTarget(cre, 22, 0, 0);
      expect(cre.position.x).toBe(20);

      GMManager.updateNetMotion(cre, 1 / 60);
      expect(cre.position.x).toBeGreaterThan(20);
      expect(cre.position.x).toBeLessThan(22);
      expect(cre.animationState.index).toBe(ModuleCreatureAnimState.RUNNING);

      for (let i = 0; i < 240; i++) GMManager.updateNetMotion(cre, 1 / 60);
      expect(cre.position.x).toBeCloseTo(22, 3);
      expect(cre.animationState.index).toBe(ModuleCreatureAnimState.PAUSE);
    });

    test("plays the host's non-locomotion animation once the replica stops moving", () => {
      const cre = mockCreature("cre_0");
      GMManager.setNetTarget(cre, 0, 0, 0);
      cre.gmNetAnim = ModuleCreatureAnimState.READY;

      GMManager.updateNetMotion(cre, 1 / 60);
      expect(cre.animationState.index).toBe(ModuleCreatureAnimState.READY);
    });
  });
});

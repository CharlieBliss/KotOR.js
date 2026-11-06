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
import { GFFStruct } from "@/resource/GFFStruct";
import { GFFField } from "@/resource/GFFField";
import { GFFDataType } from "@/enums/resource/GFFDataType";

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

  describe("DM tools", () => {
    beforeEach(() => {
      GMNetworkManager.gmManager = GMManager;
      GMNetworkManager.peers.clear();
      GMManager.dmPrompts.clear();
    });
    afterEach(() => GMNetworkManager.peers.clear());

    const join = (peerId: string, name: string, netId: string) =>
      GMNetworkManager.peers.set(peerId, { peerId, name, role: "client", joinedAt: 1, controlledNetId: netId });

    test("asks players a question as an NPC, everyone or one player", () => {
      GMNetworkManager.role = "host";
      const npc = mockCreature("cre_0", { getName: () => "Trooper" });

      expect(GMManager.askPlayers(npc, "Who goes there?", [" Friend ", "", "Foe"])).toBeTruthy();
      join("peer_a", "Alice", "pc_1");
      GMManager.askPlayers(null, "Ready?", ["Yes"], "peer_a");
      expect(GMManager.askPlayers(npc, "  ", ["Yes"])).toBeNull();
      expect(GMManager.askPlayers(npc, "No replies?", [" "])).toBeNull();

      const prompts = sent.filter((p) => p.type === "dm.prompt");
      expect(prompts.map((p) => [p.targetPeerId, p.payload.speaker, p.payload.options])).toEqual([
        [undefined, "Trooper", ["Friend", "Foe"]],
        ["peer_a", "GM", ["Yes"]],
      ]);
    });

    test("records one reply per player, and only from the player asked", () => {
      GMNetworkManager.role = "host";
      join("peer_a", "Alice", "pc_1");
      join("peer_b", "Bob", "pc_2");
      const id = GMManager.askPlayers(null, "Ready?", ["Yes", "No"], "peer_a");

      GMManager.onDmReply("peer_b", { promptId: id, choice: 0 });
      GMManager.onDmReply("peer_a", { promptId: id, choice: 1 });
      GMManager.onDmReply("peer_a", { promptId: id, choice: 0 });
      GMManager.onDmReply("peer_a", { promptId: "ask_unknown", choice: 0 });

      expect(GMManager.dmPrompts.get(id).replies).toEqual([{ peerId: "peer_a", name: "Alice", choice: 1 }]);
    });

    test("players see a question and reply to the host", async () => {
      GMNetworkManager.role = "client";
      GMNetworkManager.pendingPrompts = [];
      await GMNetworkManager.onPacketReceived({ type: "dm.prompt", senderId: "gm", timestamp: 0, payload: { promptId: "ask_1", speaker: "Trooper", text: "Halt!", options: ["Run", "Fight"] } });
      expect(GMNetworkManager.pendingPrompts.map((p) => p.promptId)).toEqual(["ask_1"]);

      GMNetworkManager.answerPrompt("ask_1", 1);
      expect(GMNetworkManager.pendingPrompts).toEqual([]);
      expect(sent.filter((p) => p.type === "dm.reply").map((p) => p.payload)).toEqual([{ promptId: "ask_1", choice: 1 }]);
    });

    test("gives XP and items to the one player named, and tells only them", () => {
      GMNetworkManager.role = "host";
      const alice = mockCreature("pc_1", { gmOwnerPeerId: "peer_a", experience: 100 });
      const bob = mockCreature("pc_2", { gmOwnerPeerId: "peer_b", experience: 100 });
      join("peer_a", "Alice", "pc_1");
      join("peer_b", "Bob", "pc_2");

      expect(GMManager.giveXP("peer_a", 250)).toBe(true);
      expect(GMManager.giveItem("peer_a", " G_I_MEDEQPMNT01 ", 2)).toBe(true);
      expect(GMManager.giveXP("peer_a", -5)).toBe(false);
      expect(GMManager.giveItem("peer_unknown", "g_i_medeqpmnt01")).toBe(false);

      expect([alice.experience, bob.experience]).toEqual([350, 100]);
      expect(GMManager.getPlayerInventory(alice)).toEqual([{ resRef: "g_i_medeqpmnt01", stack: 2 }]);
      expect(GMManager.getPlayerInventory(bob)).toEqual([]);
      expect(sent.filter((p) => p.type === "chat.message").map((p) => p.targetPeerId)).toEqual(["peer_a", "peer_a"]);
    });

    test("hidden objects are removed from players' games and left out of every sync", () => {
      GMNetworkManager.role = "host";
      const npc = mockCreature("cre_0");
      jest.spyOn(GMManager, "serializeSingleActor").mockImplementation((obj: any) => ({ netId: obj.gmNetId, hidden: !!obj.gmHidden } as any));

      expect(GMManager.setObjectHidden(npc, true)).toBe(true);
      jest.spyOn(GMManager, "serializeAllActors").mockReturnValue([{ netId: "cre_0", hidden: true } as any, { netId: "cre_1" } as any]);
      expect(GMManager.serializeActorsForTick().map((a) => a.netId)).toEqual(["cre_1"]);
      GMNetworkManager.broadcastActorUpdate({ netId: "cre_0", hidden: true } as any);

      GMManager.setObjectHidden(npc, false);
      expect(sent.map((p) => [p.type, p.payload.netId ?? p.payload.actor?.netId])).toEqual([["actor.remove", "cre_0"], ["actor.spawn", "cre_0"]]);
    });

    test("a connected player's character can't be hidden", () => {
      GMNetworkManager.role = "host";
      const pc = mockCreature("pc_1", { gmOwnerPeerId: "peer_a" });
      expect(GMManager.setObjectHidden(pc, true)).toBe(false);
      expect(pc.gmHidden).toBeFalsy();
      expect(sent).toHaveLength(0);
    });
  });

  describe("session save and load", () => {
    const item = (resRef: string): any => ({ getEquippedRes: () => resRef, getInventoryRes: () => resRef, getTemplateResRef: () => resRef, getStackSize: () => 1 });

    test("saves the scene, GM-placed objects, doors and player characters, but not module objects", () => {
      GMNetworkManager.role = "host";
      const npc = mockCreature("cre_0", {
        gmSpawnConfig: { name: "Guard", factionId: 2, hp: 45 }, factionId: 1, getHP: () => 20, getMaxHP: () => 45,
        getFacing: () => 1.5, inventory: [item("g_w_vbroswrd01")], gmBarkText: "Halt", gmHidden: true,
      });
      const moduleNpc = mockCreature("cre_area_0", { inventory: [], getFacing: () => 0 });
      const pc = mockCreature("pc_1", {
        gmOwnerPeerId: "peer_a", gmPlayerConfig: { name: "Alice", classId: 3 }, getFacing: () => 0, inventory: [],
        classes: [], feats: [], skills: [], equipment: {}, getHP: () => 150, getMaxHP: () => 150,
      });
      GMManager.addToPlayerInventory(pc, [{ resRef: "g_i_secspike01", stack: 1 }]);
      const crate: any = {
        gmSpawnConfig: { name: "Crate", hasInventory: true, lootResRefs: ["old"] }, position: new THREE.Vector3(1, 2, 3), bearing: 0.5,
        isLocked: () => true, inventory: [item("g_i_medeqpmnt01")],
      };
      const door: any = { gmNetId: "door_0", openState: 1, isLocked: () => false };
      (GameState as any).module = { filename: "DANM14AB", area: { creatures: [npc, moduleNpc, pc], placeables: [crate], doors: [door] } };
      (GameState as any).PartyManager = { party: [] };
      GMManager.spawnedPlayers = [];

      const save = GMManager.buildSessionSave("Test")!;

      expect(save.scene.module).toBe("danm14ab");
      expect(save.objects.map((o) => [o.kind, o.config.name, o.loot, o.hidden])).toEqual([
        ["creature", "Guard", ["g_w_vbroswrd01"], true],
        ["placeable", "Crate", ["g_i_medeqpmnt01"], false],
      ]);
      expect(save.objects[0]).toEqual(expect.objectContaining({ factionId: 1, hp: 20, maxHp: 45, barkText: "Halt" }));
      expect(save.objects[1]).toEqual(expect.objectContaining({ locked: true, x: 1, y: 2, z: 3 }));
      expect(save.doors).toEqual([{ netId: "door_0", openState: 1, locked: false }]);
      expect(save.players.map((p) => [p.name, p.local, p.sheet.inventory])).toEqual([["Alice", false, [{ resRef: "g_i_secspike01", stack: 1 }]]]);
    });

    test("imports only files that are GM session saves", () => {
      const store: Record<string, string> = {};
      (global as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
      const save: any = { version: 1, id: "x", name: "Imported", savedAt: 0, scene: { module: "danm13" }, objects: [], doors: [], players: [] };

      expect(GMManager.importSessionJSON(JSON.stringify(save))?.name).toBe("Imported");
      expect(GMManager.importSessionJSON('{"version":2}')).toBeNull();
      expect(GMManager.importSessionJSON("not json")).toBeNull();
      expect(GMManager.getSavedSessions().map((s) => s.name)).toEqual(["Imported"]);
    });

    test("a player rejoining under a saved name gets their saved character, once", async () => {
      GMNetworkManager.role = "host";
      const saved: any = { name: "Alice", local: false, config: { name: "Alice" }, sheet: { inventory: [] }, x: 0, y: 0, z: 0, facing: 0 };
      GMManager.reservedPlayers = new Map([["alice", saved]]);
      const spawnSaved = jest.spyOn(GMManager, "spawnSavedPlayer").mockImplementation(async () => ({ gmNetId: "pc_saved" }) as any);
      const spawnNew = jest.spyOn(GMManager, "spawnPlayerCharacter").mockImplementation(async () => ({ gmNetId: "pc_new" }) as any);

      expect(await GMManager.spawnPlayerFromNetworkPreset("peer_a", " ALICE ", { name: "Alice" } as any)).toBe("pc_saved");
      expect(spawnSaved).toHaveBeenCalledWith(saved, "peer_a");
      expect(await GMManager.spawnPlayerFromNetworkPreset("peer_b", "Alice", { name: "Alice" } as any)).toBe("pc_new");
      expect(spawnNew).toHaveBeenCalledTimes(1);
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

  describe("NPC combat", () => {
    const npc = (netId: string, x: number, overrides: Record<string, any> = {}) => mockCreature(netId, {
      position: new THREE.Vector3(x, 0, 0),
      isReady: true,
      combatRound: { action: undefined, scheduledActionList: [] as any[] },
      hasLineOfSight: () => true,
      ...overrides,
    });

    beforeEach(() => {
      (GameState as any).PartyManager = { party: [] };
      (GameState as any).module = { readyToProcessEvents: true, area: { creatures: [] } };
    });

    test("a hostile NPC attacks the nearest enemy it can see, including a player's character", () => {
      const player = npc("pc_1", 6, { gmOwnerPeerId: "peer_a" });
      const farPlayer = npc("pc_2", 15, { gmOwnerPeerId: "peer_b" });
      const trooper = npc("cre_0", 0, { isHostile: (c: any) => c === player || c === farPlayer });
      (GameState as any).module.area.creatures = [trooper, player, farPlayer];

      GMManager.updateNpcCombat();

      expect(trooper.actionQueue).toEqual([{ type: "attack", target: player }]);
      // Players' characters are driven by their players, never by the NPC AI
      expect(player.actionQueue).toHaveLength(0);
    });

    test("ignores creatures it isn't hostile to, out of sight, out of range or dead", () => {
      const friend = npc("cre_1", 2);
      const hidden = npc("pc_1", 3, { gmOwnerPeerId: "peer_a" });
      const far = npc("pc_2", 40, { gmOwnerPeerId: "peer_b" });
      const dead = npc("pc_3", 1, { gmOwnerPeerId: "peer_c", dead: true });
      const trooper = npc("cre_0", 0, {
        isHostile: (c: any) => c !== friend,
        hasLineOfSight: (c: any) => c !== hidden,
      });
      (GameState as any).module.area.creatures = [trooper, friend, hidden, far, dead];

      GMManager.updateNpcCombat();
      expect(trooper.actionQueue).toHaveLength(0);
    });

    test("keeps its target, fights back against an attacker, and doesn't interrupt an attack in progress", () => {
      const a = npc("pc_1", 2, { gmOwnerPeerId: "peer_a" });
      const b = npc("pc_2", 25, { gmOwnerPeerId: "peer_b" });
      const trooper = npc("cre_0", 0, { hostile: true, combatData: { lastAttacker: b } });
      (GameState as any).module.area.creatures = [trooper, a, b];

      // Hit from beyond its sight range: it goes after the attacker, not the nearer player
      GMManager.updateNpcCombat();
      expect(trooper.actionQueue).toEqual([{ type: "attack", target: b }]);

      trooper.actionQueue.length = 0;
      trooper.combatRound.action = { target: b };
      GMManager.updateNpcCombat();
      expect(trooper.actionQueue).toHaveLength(0);
    });

    test("leaves alone the character the GM is playing and the players' characters", () => {
      const enemy = npc("cre_1", 1, { hostile: true });
      const possessed = npc("cre_0", 0, { hostile: true });
      const pc = npc("pc_1", 0, { hostile: true, gmPlayerConfig: { name: "PC" } });
      (GameState as any).PartyManager.party = [possessed];
      (GameState as any).module.area.creatures = [enemy, pc];

      GMManager.updateNpcCombat();
      expect(possessed.actionQueue).toHaveLength(0);
      expect(pc.actionQueue).toHaveLength(0);
      expect(enemy.actionQueue).toHaveLength(1);
    });
  });

  describe("placeable presets", () => {
    beforeEach(() => {
      const rows: [number, string, string][] = [
        [27, "Desk1_office", "PLC_Desk1"],
        [28, "Desk2_fancy", "PLC_Desk2"],
        [39, "Footlocker", "PLC_FootLker"],
        [41, "FountnMetal", "PLC_FntnMetl"],
        [52, "HumanSkeleton", "PLC_HmnSkel"],
        [55, "JnkSpeeder1", "PLC_JnkSpdr1"],
        [72, "MetalBox_octagonal", "PLC_MetalBox"],
        [92, "RuneObelisk", "PLC_RneObelsk"],
      ];
      (GameState as any).AppearanceManager = {
        placeableAppearances: new Map(rows.map(([id, label, modelname]) => [id, { label, modelname }])),
      };
    });

    test("a preset gets the model its keywords mean, not a stale id or a loose keyword match", () => {
      // The old id pointed at a junk speeder; 'safe' used to match a metal fountain
      expect(GMManager.resolvePlaceableAppearance({ appearanceId: 55, modelKeywords: ["desk", "table"] })).toBe(28);
      expect(GMManager.resolvePlaceableAppearance({ appearanceId: 54, modelKeywords: ["safe", "vault", "metal"] })).toBe(72);
    });

    test("an exact label wins, and a model the GM picked is used as is", () => {
      expect(GMManager.resolvePlaceableAppearance({ appearanceId: 65, appearanceLabel: "RuneObelisk", modelKeywords: ["pillar"] })).toBe(92);
      expect(GMManager.resolvePlaceableAppearance({ appearanceId: 41 })).toBe(41);
      // The default footlocker is a footlocker, not the skeleton its old id named
      expect(GMManager.resolvePlaceableAppearance(GMManager.pendingPlaceableConfig)).toBe(39);
    });

    test("picking a preset gives a clean copy: nothing from the last pick, and edits never reach the preset", () => {
      const preset = GMManager.CATEGORIZED_PROPS.find((p) => p.hasInventory)!;
      const copy = GMManager.copyPlaceablePreset(preset);
      expect(copy.customized).toBe(false);
      copy.lootResRefs.push("g_i_credits001");
      copy.modelKeywords?.push("extra");
      expect(preset.lootResRefs).not.toContain("g_i_credits001");
      expect(preset.modelKeywords).not.toContain("extra");

      // A preset without a template doesn't inherit one from a previously picked object
      const withTemplate = GMManager.copyPlaceablePreset({ ...preset, templateResRef: "plc_template", barkText: "old" });
      const next = GMManager.copyPlaceablePreset(GMManager.CATEGORIZED_PROPS[0]);
      expect(withTemplate.templateResRef).toBe("plc_template");
      expect(next.templateResRef).toBeUndefined();
      expect(next.barkText).toBe(GMManager.CATEGORIZED_PROPS[0].barkText);
    });
  });

  describe("creature presets", () => {
    const gearOf = (root: GFFStruct) =>
      Object.fromEntries(root.getFieldByLabel("Equip_ItemList").getChildStructs().map((st) => [st.type, st.getFieldByLabel("EquippedRes").getValue()]));
    const template = (gear: Record<number, string>) => {
      const root = new GFFStruct();
      const list = root.addField(new GFFField(GFFDataType.LIST, "Equip_ItemList"));
      for (const [slot, resRef] of Object.entries(gear)) {
        const st = new GFFStruct(Number(slot));
        st.addField(new GFFField(GFFDataType.RESREF, "EquippedRes")).setValue(resRef);
        list.addChildStruct(st);
      }
      return root;
    };
    const CLAW = 16384;

    test("every preset is a game template, with the appearance it really has", () => {
      (GameState as any).AppearanceManager = {
        appearances: new Map([[28, { label: "Sith_Soldier_01" }], [29, { label: "****" }], [38, { label: "Republic_Soldier_Mal_White" }]]),
      };
      for (const preset of GMManager.CREATURE_PRESETS) {
        expect(preset.templateResRef).toBeTruthy();
        expect(preset.appearanceLabel).toBeTruthy();
      }
      const soldier = GMManager.CREATURE_PRESETS.find((c) => c.name === "Republic Soldier")!;
      // Its old appearance (29) was an empty row, which made it fight with claws it doesn't have
      expect(GMManager.resolveCreatureAppearance(soldier)).toBe(38);
      expect(GMManager.resolveCreatureAppearance({ appearanceId: 28, appearanceLabel: "Missing_Label" })).toBe(28);
    });

    test("from a template it keeps its own gear; a preset's weapon only fills an empty hand", () => {
      const armed = template({ [ModuleCreatureArmorSlot.RIGHTHAND]: "g_w_blstrrfl001", [ModuleCreatureArmorSlot.ARMOR]: "g_a_class8001" });
      GMManager.applyCreatureGear(armed, { name: "x", appearanceId: 0, factionId: 1, hp: 1, level: 1, classId: 0, rightHandResRef: "g_w_blstrpstl001", armorResRef: "" }, false);
      expect(gearOf(armed)).toEqual({ [ModuleCreatureArmorSlot.RIGHTHAND]: "g_w_blstrrfl001", [ModuleCreatureArmorSlot.ARMOR]: "g_a_class8001" });

      const unarmed = template({});
      GMManager.applyCreatureGear(unarmed, { name: "x", appearanceId: 0, factionId: 2, hp: 1, level: 1, classId: 0, rightHandResRef: "g_w_blstrrfl001" }, false);
      expect(gearOf(unarmed)).toEqual({ [ModuleCreatureArmorSlot.RIGHTHAND]: "g_w_blstrrfl001" });
    });

    test("customized, its hands and armour are the GM's ('' empties one), and its claws stay", () => {
      const beast = template({ [CLAW]: "g_w_crslash006", [ModuleCreatureArmorSlot.RIGHTHAND]: "g_w_gaffi001", [ModuleCreatureArmorSlot.ARMOR]: "g_a_class8001" });
      GMManager.applyCreatureGear(beast, { name: "x", appearanceId: 0, factionId: 1, hp: 1, level: 1, classId: 0, rightHandResRef: "g_w_lghtsbr01", armorResRef: "" }, true);
      expect(gearOf(beast)).toEqual({ [CLAW]: "g_w_crslash006", [ModuleCreatureArmorSlot.RIGHTHAND]: "g_w_lghtsbr01" });
    });

    test("a template picked from the browser is placed as the game has it, faction included", () => {
      const config = GMManager.creatureConfigFromTemplate({
        resRef: "g_bandon", name: "Darth Bandon", appearanceId: 184, appearanceLabel: "Unique_Darth_Bandon", factionId: 5,
        hp: 40, fp: 150, level: 15, classId: 3, classes: "Jedi Guardian 15", rightHandResRef: "g_w_drkjdisbr002", leftHandResRef: "", armorResRef: "",
      });
      expect(config).toMatchObject({ templateResRef: "g_bandon", factionId: 5, appearanceId: 184 });
      expect(config.customized).toBeFalsy();
      expect(config.rightHandResRef).toBeUndefined();
    });
  });

  describe("teleporting", () => {
    const place = (overrides: Record<string, any> = {}) => mockCreature("pc_1", {
      position: new THREE.Vector3(0, 0, 0),
      getCurrentRoom: jest.fn(),
      computeBoundingBox: jest.fn(),
      ...overrides,
    });

    afterEach(() => {
      GMNetworkManager.teleportSeq = 0;
    });

    test("a creature stops whatever it was doing, so it doesn't walk back", () => {
      const npc = place();
      npc.actionQueue.push({ type: "move" });
      GMManager.teleportObject(npc, new THREE.Vector3(8, 2, 0));
      expect(npc.position.toArray()).toEqual([8, 2, 0]);
      expect(npc.actionQueue).toHaveLength(0);
    });

    test("a player's character stays put on the host and is moved on its player's machine", () => {
      GMNetworkManager.role = "host";
      jest.spyOn(GMManager, "serializeSingleActor").mockImplementation((obj: any) => ({ netId: obj.gmNetId } as any));
      const pc = place({ gmOwnerPeerId: "peer_a" });
      GMManager.applyClientInputOnHost("peer_a", { netId: "pc_1", x: 1, y: 0, z: 0, teleportSeq: 0 });

      GMManager.teleportObject(pc, new THREE.Vector3(10, 0, 0));
      const tp = sent.find((p) => p.type === "actor.teleport");
      expect(tp).toMatchObject({ targetPeerId: "peer_a", payload: { netId: "pc_1", x: 10, y: 0, z: 0, seq: 1 } });
      // It doesn't drift back toward the last position its player reported
      expect(pc.gmNetTarget.toArray()).toEqual([10, 0, 0]);

      // A report sent before the player's game moved the character is ignored...
      GMManager.applyClientInputOnHost("peer_a", { netId: "pc_1", x: 1, y: 0, z: 0, teleportSeq: 0 });
      expect(pc.gmNetTarget.toArray()).toEqual([10, 0, 0]);
      // ...and the next one, from the new spot, is followed
      GMManager.applyClientInputOnHost("peer_a", { netId: "pc_1", x: 10.5, y: 0, z: 0, teleportSeq: 1 });
      expect(pc.gmNetTarget.x).toBe(10.5);
    });

    test("the player's game moves its own character and reports from there", () => {
      GMNetworkManager.role = "client";
      GMNetworkManager.assignedActorNetId = "pc_1";
      GMNetworkManager.awaitingHost = true;
      const me = place();
      me.actionQueue.push({ type: "move" });

      GMManager.applyTeleportOnClient({ netId: "pc_1", x: 4, y: 5, z: 0, seq: 3 });
      expect(me.position.toArray()).toEqual([4, 5, 0]);
      expect(me.actionQueue).toHaveLength(0);
      expect(GMNetworkManager.teleportSeq).toBe(3);
      expect(GMNetworkManager.awaitingHost).toBe(false);
    });
  });

  describe("player death", () => {
    const pcAt = (netId: string, x: number, peer?: string) => mockCreature(netId, {
      position: new THREE.Vector3(x, 0, 0),
      hpNow: 0,
      max: 40,
      getName() { return netId; },
      getHP() { return this.hpNow; },
      getMaxHP() { return this.max; },
      isDead() { return this.hpNow <= 0; },
      ...(peer ? { gmOwnerPeerId: peer } : { gmPlayerConfig: { name: netId } }),
    });

    let chat: string[];
    beforeEach(() => {
      chat = [];
      GMManager.deathRule = "kotor";
      GMManager.everyoneDown = false;
      (GameState as any).PartyManager = { party: [] };
      (GameState as any).module = { readyToProcessEvents: true, area: { creatures: [] } };
      jest.spyOn(GMNetworkManager, "appendChat").mockImplementation((_s: string, text: string) => { chat.push(text); });
      jest.spyOn(GMManager, "setCreatureHP").mockImplementation((cre: any, hp: number) => { cre.hpNow = hp; });
      jest.spyOn(GMNetworkManager, "broadcastActorUpdate").mockImplementation(() => {});
    });

    const tick = (seconds: number) => {
      for (let t = 0; t < seconds; t += 0.5) GMManager.updateDownedPlayers(0.5);
    };

    test("KotOR rule: a fallen player gets back up with 1 HP only once no enemy is near", () => {
      const pc = pcAt("pc_1", 0, "peer_a");
      const trooper = mockCreature("cre_0", { hostile: true, position: new THREE.Vector3(5, 0, 0) });
      (GameState as any).module.area.creatures = [pc, trooper];

      tick(5);
      expect(pc.hpNow).toBe(0);
      expect(chat).toContain("pc_1 is down.");

      trooper.dead = true;
      tick(2.5);
      expect(pc.hpNow).toBe(0);
      tick(1);
      expect(pc.hpNow).toBe(1);
      expect(pc.gmDowned).toBeUndefined();
    });

    test("GM rule: they stay down until the GM revives them", () => {
      GMManager.deathRule = "gm";
      const pc = pcAt("pc_1", 0, "peer_a");
      (GameState as any).module.area.creatures = [pc];
      tick(30);
      expect(pc.hpNow).toBe(0);
      GMManager.revivePlayer(pc);
      expect(pc.hpNow).toBe(40);
    });

    test("respawn rule: a player can respawn at the entrance, but only after the wait", () => {
      GMManager.deathRule = "respawn";
      const pc = pcAt("pc_1", 0, "peer_a");
      (GameState as any).module.area.creatures = [pc];
      GMNetworkManager.peers.set("peer_a", { peerId: "peer_a", name: "Alice", role: "client", joinedAt: 0, controlledNetId: "pc_1" } as any);
      const respawn = jest.spyOn(GMManager, "respawnPlayer").mockImplementation(() => {});
      tick(1);

      GMManager.onRespawnRequest("peer_a");
      expect(respawn).not.toHaveBeenCalled();

      pc.gmDowned.since -= GMManager.RESPAWN_DELAY_SECONDS * 1000;
      GMManager.onRespawnRequest("peer_a");
      expect(respawn).toHaveBeenCalledWith(pc);

      // Not under another rule
      respawn.mockClear();
      GMManager.deathRule = "kotor";
      GMManager.onRespawnRequest("peer_a");
      expect(respawn).not.toHaveBeenCalled();
      GMNetworkManager.peers.clear();
    });

    test("tells the GM once when every player is down", () => {
      GMManager.deathRule = "gm";
      const a = pcAt("pc_1", 0, "peer_a");
      const b = pcAt("pc_2", 1);
      b.hpNow = 10;
      (GameState as any).module.area.creatures = [a, b];
      tick(1);
      expect(chat.filter((c) => c.startsWith("Every player is down"))).toHaveLength(0);
      b.hpNow = 0;
      tick(3);
      expect(chat.filter((c) => c.startsWith("Every player is down"))).toHaveLength(1);
      GMManager.reviveAllPlayers();
      expect([a.hpNow, b.hpNow]).toEqual([40, 40]);
    });

    test("the rule reaches players, and is saved with the world snapshot", async () => {
      GMNetworkManager.role = "host";
      const broadcast = jest.spyOn(GMNetworkManager, "broadcastSessionRules");
      GMManager.setDeathRule("respawn");
      expect(broadcast).toHaveBeenCalledWith({ deathRule: "respawn" });

      GMNetworkManager.role = "client";
      await GMNetworkManager.onPacketReceived({ type: "session.rules", senderId: "gm", timestamp: 0, payload: { deathRule: "gm" } });
      expect(GMNetworkManager.sessionRules.deathRule).toBe("gm");
      GMManager.deathRule = "kotor";
    });
  });

  describe("spawning and bolts", () => {
    test("an object still loading is left out of world updates, so players never get a second copy", () => {
      const loading = mockCreature("cre_0", { gmSpawning: true });
      const ready = mockCreature("cre_1");
      const crate: any = { objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModulePlaceable, gmNetId: "plc_2", gmSpawning: true };
      (GameState as any).PartyManager = { party: [] };
      (GameState as any).module = { readyToProcessEvents: true, area: { creatures: [loading, ready], placeables: [crate] } };
      jest.spyOn(GMManager, "serializeSingleActor").mockImplementation((obj: any) => ({ netId: obj.gmNetId } as any));

      expect(GMManager.serializeAllActors().map((a) => a.netId)).toEqual(["cre_1"]);

      delete loading.gmSpawning;
      delete crate.gmSpawning;
      expect(GMManager.serializeAllActors().map((a) => a.netId)).toEqual(["cre_0", "cre_1", "plc_2"]);
    });

    test("the host sends each blaster bolt to players, who draw it between the same two objects", () => {
      GMNetworkManager.role = "host";
      const shooter = mockCreature("pc_1");
      const target = mockCreature("cre_0");
      const broadcast = jest.spyOn(GMNetworkManager, "broadcastFx").mockImplementation(() => {});
      GMManager.onHostProjectile(shooter, target, 1, true, 0.4);
      expect(broadcast).toHaveBeenCalledWith({ kind: "projectile", netId: "pc_1", targetNetId: "cre_0", ammunition: 1, hit: true, delay: 0.4 });

      // A hidden target is invisible to players, so is the bolt aimed at it
      broadcast.mockClear();
      target.gmHidden = true;
      GMManager.onHostProjectile(shooter, target, 1, true, 0);
      expect(broadcast).not.toHaveBeenCalled();

      GMNetworkManager.role = "client";
      const launch = jest.fn();
      (GameState as any).ProjectileManager = { Launch: launch };
      GMManager.applyFxEventOnClient({ kind: "projectile", netId: "pc_1", targetNetId: "cre_0", ammunition: 1, hit: false, delay: 0.2 });
      expect(launch).toHaveBeenCalledWith(shooter, target, 1, false, 0.2);
    });
  });

  describe("joining a GM's game", () => {
    beforeEach(() => {
      GMNetworkManager.role = "client";
      GMNetworkManager.joinState = "joining";
      GMNetworkManager.resendRegistration = jest.fn() as any;
    });

    afterEach(() => {
      GMNetworkManager.clearJoinTimer();
      GMNetworkManager.joinState = "idle";
      GMNetworkManager.resendRegistration = null;
    });

    test("waits when no GM is hosting yet, then joins as soon as one starts", async () => {
      await GMNetworkManager.onPacketReceived({ type: "relay.error", senderId: "relay", timestamp: 0, payload: { code: "no-host" } });
      expect(GMNetworkManager.joinState).toBe("waiting-for-host");
      expect(GMNetworkManager.role).toBe("client");

      await GMNetworkManager.onPacketReceived({ type: "relay.host-ready", senderId: "relay", timestamp: 0, payload: {} });
      expect(GMNetworkManager.joinState).toBe("joining");
      expect(GMNetworkManager.resendRegistration).toHaveBeenCalledTimes(1);
    });

    test("is playing once the GM hands over a character", async () => {
      GMNetworkManager.gmManager = { netIdMap: new Map(), possessCharacter: jest.fn() };
      await GMNetworkManager.onPacketReceived({ type: "actor.assign", senderId: "gm", targetPeerId: GMNetworkManager.peerId, timestamp: 0, payload: { netId: "pc_1" } });
      expect(GMNetworkManager.joinState).toBe("playing");
    });

    test("goes back to waiting when the GM leaves", async () => {
      GMNetworkManager.joinState = "playing";
      await GMNetworkManager.onPacketReceived({ type: "peer.leave", senderId: "gm", timestamp: 0, payload: { wasHost: true } });
      expect(GMNetworkManager.joinState).toBe("waiting-for-host");
    });

    test("a failed join says why and leaves the player offline", () => {
      jest.spyOn(GMNetworkManager, "disconnect").mockImplementation(() => { GMNetworkManager.role = "offline"; });
      GMNetworkManager.failJoin("No GM answered.");
      expect(GMNetworkManager.joinState).toBe("failed");
      expect(GMNetworkManager.joinError).toBe("No GM answered.");
      expect(GMNetworkManager.role).toBe("offline");
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

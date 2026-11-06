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

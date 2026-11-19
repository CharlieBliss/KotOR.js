import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: { gmMode: true } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import * as THREE from "three";
import { GameState } from "@/GameState";
import { GMSessions } from "@/managers/gm/GMSessions";
import { GMDifficulty } from "@/managers/gm/GMDifficulty";
import { GMPacing } from "@/managers/gm/GMPacing";
import { GMManager } from "@/managers/GMManager";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import { GMSpawner } from "@/managers/gm/GMSpawner";
import { GMPlayers } from "@/managers/gm/GMPlayers";
import { GMEditTools } from "@/managers/gm/GMEditTools";
import { GMAtmosphere } from "@/managers/gm/GMAtmosphere";
import { GMSetPieces } from "@/managers/gm/GMSetPieces";
import { ModuleDoorOpenState } from "@/enums/module/ModuleDoorOpenState";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { Dice } from "@/utility/Dice";
import { DiceType } from "@/enums/combat/DiceType";

function installMemoryLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  return store;
}

describe("GMSessions blueprints, persistence cap & loadSession", () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    GMManager.netIdMap.clear();
    GMManager.spawnedPlayers = [];
    GMManager.keepDefaultCreatures = false;
    GMManager.keepDefaultTriggers = false;
    GMManager.keepDefaultPlaceables = true;
    GMEditTools.groups.clear();
    GMAtmosphere.current = {};
    GMNetworkManager.peers = new Map();
    GMNetworkManager.role = "host";
    GMNetworkManager.appendChat = jest.fn();
    GMNetworkManager.broadcastSessionRules = jest.fn();
    GMManager.notifyChange = jest.fn();

    const G: any = GameState;
    G.PartyManager = { party: [] };
    G.module = {
      filename: "danm14aa",
      entryX: 10,
      entryY: 20,
      entryZ: 0,
      area: {
        creatures: [],
        placeables: [],
        doors: [],
      },
    };
  });

  afterEach(() => {
    Dice.setRng(null);
    jest.restoreAllMocks();
  });

  test("saves, imports, and deletes custom scene blueprints relative to module entry", () => {
    const plc: any = {
      objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModulePlaceable,
      position: new THREE.Vector3(13, 24, 1),
      bearing: Math.PI / 2,
      isLocked: () => false,
      inventory: [],
    };
    const npc: any = {
      position: new THREE.Vector3(15, 18, 0),
      getFacing: () => 0,
      getName: () => "Guard",
      factionId: 1,
      getHP: () => 30,
      getMaxHP: () => 30,
      inventory: [],
    };
    (GameState.module as any).area.placeables = [plc];
    (GameState.module as any).area.creatures = [npc];

    jest.spyOn(GMSpawner, "describePlaceable").mockReturnValue({ label: "Crate", modelName: "plc_crate" } as any);
    jest.spyOn(GMSpawner, "describeCreature").mockReturnValue({ name: "Guard", templateResRef: "n_guard" } as any);

    const bp = GMSessions.saveCurrentSceneAsBlueprint("Ambush Kit", "Test layout");
    expect(bp).not.toBeNull();
    expect(bp!.recommendedModule).toBe("danm14aa");
    expect(bp!.items[0]).toMatchObject({ dx: 3, dy: 4, dz: 1, yawDeg: 90 });
    expect(bp!.creatures[0]).toMatchObject({ dx: 5, dy: -2, dz: 0 });
    expect(GMSessions.getSavedCustomBlueprints()).toHaveLength(1);

    expect(GMSessions.importCustomBlueprintFromJSON("{bad")).toBeNull();
    expect(GMSessions.importCustomBlueprintFromJSON(JSON.stringify({ title: "Missing items" }))).toBeNull();
    const imported = GMSessions.importCustomBlueprintFromJSON(JSON.stringify({
      title: "Imported Kit",
      recommendedModule: "003ebo",
      items: [{ dx: 1, dy: 2, dz: 0, yawDeg: 0, config: { label: "Bed" } }],
      creatures: [],
    }));
    expect(imported?.isCustom).toBe(true);
    expect(GMSessions.getSavedCustomBlueprints().map((b) => b.title)).toEqual(["Imported Kit", "Ambush Kit"]);

    GMSessions.deleteCustomBlueprint(bp!.id);
    expect(GMSessions.getSavedCustomBlueprints().map((b) => b.title)).toEqual(["Imported Kit"]);
  });

  test("caps saved sessions at MAX_SAVED_SESSIONS and deletes by id", () => {
    for (let i = 0; i < GMSessions.MAX_SAVED_SESSIONS + 3; i++) {
      jest.spyOn(Date, "now").mockReturnValue(1000 + i);
      const saved = GMSessions.saveSession(`Session ${i}`);
      expect(saved).not.toBeNull();
    }
    const list = GMSessions.getSavedSessions();
    expect(list).toHaveLength(GMSessions.MAX_SAVED_SESSIONS);
    expect(list[0].name).toBe(`Session ${GMSessions.MAX_SAVED_SESSIONS + 2}`);

    GMSessions.deleteSavedSession(list[0].id);
    expect(GMSessions.getSavedSessions()).toHaveLength(GMSessions.MAX_SAVED_SESSIONS - 1);
  });

  test("loadSession rejects invalid saves and restores doors, sets, objects, groups, and connected/reserved players", async () => {
    expect(await GMSessions.loadSession({} as any)).toBe(false);

    const door: any = {
      objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleDoor,
      gmNetId: "door_1",
      openState: ModuleDoorOpenState.CLOSED,
      setLocked: jest.fn(),
      isOpen: jest.fn(() => false),
      openDoor: jest.fn(),
      closeDoor: jest.fn(),
    };
    const connectedActor: any = {
      objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
      gmNetId: "pc_1",
      setFacing: jest.fn(),
    };
    GMManager.netIdMap.set("door_1", door);
    GMManager.netIdMap.set("pc_1", connectedActor);
    GMNetworkManager.peers.set("peer_1", {
      peerId: "peer_1",
      name: "Bastila",
      role: "client",
      joinedAt: 1,
      controlledNetId: "pc_1",
    } as any);

    const spawnedCre: any = {
      objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
      gmNetId: "cre_1",
    };
    const spawnedPlc: any = {
      objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModulePlaceable,
      gmNetId: "plc_1",
    };

    jest.spyOn(GMManager, "loadScene").mockResolvedValue(undefined);
    jest.spyOn(GMManager, "waitForScene").mockResolvedValue(true);
    jest.spyOn(GMManager, "setCreatureHP").mockImplementation(() => {});
    jest.spyOn(GMManager, "setObjectHidden").mockImplementation(() => true);
    jest.spyOn(GMManager, "teleportObject").mockImplementation(() => {});
    const setPiecesSpy = jest.spyOn(GMSetPieces, "sync").mockResolvedValue(undefined);
    const atmSpy = jest.spyOn(GMAtmosphere, "set").mockResolvedValue(undefined);
    jest.spyOn(GMSpawner, "spawnCreature").mockResolvedValue(spawnedCre);
    jest.spyOn(GMSpawner, "spawnPlaceable").mockResolvedValue(spawnedPlc);
    jest.spyOn(GMPlayers, "applySheetToCharacter").mockResolvedValue(undefined);
    const spawnSavedSpy = jest.spyOn(GMSessions, "spawnSavedPlayer").mockResolvedValue(null);

    const save: any = {
      version: 1,
      id: "save_1",
      name: "Restored Run",
      savedAt: 1234,
      scene: { module: "danm14aa", keepCreatures: false, keepTriggers: false, keepPlaceables: true },
      rules: { deathRule: "respawn", tacticalPause: { enabled: true, holdCount: 0, holders: [] } },
      sets: [{ id: "set_1", module: "003ebo", rooms: ["003ebob"], offset: { x: 0, y: 0, z: 0 } }],
      doors: [{ netId: "door_1", openState: ModuleDoorOpenState.OPEN1, locked: true }],
      objects: [
        {
          kind: "creature",
          config: { name: "Sith Trooper", factionId: 1, hp: 40 },
          x: 1, y: 2, z: 0, facing: 1.5,
          factionId: 1, hp: 18, maxHp: 40,
          hidden: true, loot: ["g_i_medeqpmnt01"], barkText: "Halt",
          combatStyle: "melee", scripted: true, pinned: true,
        },
        {
          kind: "placeable",
          config: { label: "Footlocker", hasInventory: false },
          x: 4, y: 5, z: 0, facing: 0.5,
          locked: true, hidden: false, loot: ["g_w_blstrpstl01"], barkText: "", pinned: false,
        },
      ],
      groups: [{ n: 1, objects: [0, 1], netIds: ["door_1"] }],
      atmosphere: { ambient: 0x334455 },
      players: [
        {
          name: "Local Hero",
          local: true,
          config: { name: "Local Hero" },
          sheet: { inventory: [] },
          x: 0, y: 0, z: 0, facing: 0,
        },
        {
          name: "Bastila",
          local: false,
          config: { name: "Bastila" },
          sheet: { inventory: [{ resRef: "g_w_lghtsbr01", stack: 1 }] },
          x: 7, y: 8, z: 0, facing: 2.1,
          hidden: true,
        },
        {
          name: "Offline Player",
          local: false,
          config: { name: "Offline Player" },
          sheet: { inventory: [] },
          x: 9, y: 9, z: 0, facing: 0,
        },
      ],
    };

    GMDifficulty.configure({ enemyHp: 2, enemyDamage: 1.5 });
    GMPacing.configure({ mode: "every", timeLimit: 30, showIntents: false });

    const ok = await GMSessions.loadSession(save);
    expect(ok).toBe(true);
    // Older save without difficulty/pacing resets both back to defaults
    expect(GMDifficulty.enemyHp).toBe(1);
    expect(GMDifficulty.enemyDamage).toBe(1);
    expect(GMPacing.mode).toBe("off");
    expect(GMPacing.timeLimit).toBe(0);
    expect(GMPacing.showIntents).toBe(true);
    expect(setPiecesSpy).toHaveBeenCalledWith(save.sets);
    expect(door.setLocked).toHaveBeenCalledWith(true);
    expect(door.openDoor).toHaveBeenCalledWith(door);
    expect(spawnedCre.gmCombatStyle).toBe("melee");
    expect(spawnedCre.gmScripted).toBe(true);
    expect(spawnedCre.gmPinned).toBe(true);
    expect(GMManager.setCreatureHP).toHaveBeenCalledWith(spawnedCre, 18, 40);
    expect(GMManager.setObjectHidden).toHaveBeenCalledWith(spawnedCre, true);
    expect(atmSpy).toHaveBeenCalledWith({ ambient: 0x334455 });
    expect(GMEditTools.groups.get(1)).toEqual([spawnedCre, spawnedPlc, door]);
    expect(spawnSavedSpy).toHaveBeenCalledTimes(1);
    expect(GMManager.teleportObject).toHaveBeenCalled();
    expect(connectedActor.setFacing).toHaveBeenCalledWith(2.1, true);
    expect(GMSessions.reservedPlayers.has("bastila")).toBe(false);
    expect(GMSessions.reservedPlayers.has("offline player")).toBe(true);
  });
});

describe("Dice seeded PRNG", () => {
  afterEach(() => {
    Dice.setRng(null);
  });

  test("produces repeatable sequences across dice sizes when seeded", () => {
    const makeSeq = (seed: number) => {
      let s = seed >>> 0;
      return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), s | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };

    Dice.setRng(makeSeq(42));
    const runA = [Dice.rollD20(1), Dice.rollD6(3), Dice.roll(2, DiceType.d8, 4), Dice.rollD100(1)];

    Dice.setRng(makeSeq(42));
    const runB = [Dice.rollD20(1), Dice.rollD6(3), Dice.roll(2, DiceType.d8, 4), Dice.rollD100(1)];

    expect(runA).toEqual(runB);
    expect(runA[0]).toBeGreaterThanOrEqual(1);
    expect(runA[0]).toBeLessThanOrEqual(20);
  });
});

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: { gmMode: true } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: { OTHER_GAME_PREFIX: "@othergame" } }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import * as THREE from "three";
import { GameState } from "@/GameState";
import { GMManager } from "@/managers/GMManager";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import { GMScenePlan } from "@/managers/GMScenePlan";
import type { GMScenePlanData } from "@/managers/GMScenePlan";
import { ApplicationProfile } from "@/utility/ApplicationProfile";
import { GameEngineType } from "@/enums/engine/GameEngineType";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { GMPlayers } from "@/managers/gm/GMPlayers";
import { GMViewport } from "@/managers/gm/GMViewport";

const plan = (extra: Partial<GMScenePlanData> = {}): GMScenePlanData => ({
  format: "kotorjs-gm-scene",
  version: 1,
  title: "Massacre",
  content: "tsl",
  area: { game: "kotor", module: "danm13" },
  players: { at: { spot: "entry" }, frozen: true },
  actors: [
    { id: "jedi", template: "n_jedi", faction: "friendly", count: 3, at: { spot: "room:hall" } },
    { id: "dark", template: "n_darkjedi", faction: "hostile", count: 2, hidden: true, at: { spot: "waypoint:door" }, order: { kind: "attack", target: "jedi" } },
  ],
  props: [{ id: "rubble", appearance: "BurningJunk", at: { spot: "actor:jedi", offset: [3, 0] } }],
  beats: [{ title: "They arrive", actions: [{ do: "reveal", ids: ["dark"] }] }],
  ...extra,
});

function creature(netId: string, x: number): any {
  const cre: any = {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    gmNetId: netId,
    position: new THREE.Vector3(x, 0, 0),
    dead: false,
    isDead() { return this.dead; },
  };
  return cre;
}

beforeEach(() => {
  ApplicationProfile.GameKey = GameEngineType.TSL;
  (GameState as any).module = {
    area: {
      waypoints: [{ getTag: () => "DOOR", position: new THREE.Vector3(20, 0, 0) }],
      rooms: [],
      getNearestWalkablePoint: (p: THREE.Vector3) => p.clone(),
    },
  };
  jest.spyOn(GMViewport, "getGroundZAt").mockImplementation((_x, _y, z) => z);
  jest.spyOn(GMPlayers, "getRespawnPoint").mockReturnValue(new THREE.Vector3(0, 0, 0));
  jest.spyOn(GMNetworkManager, "appendChat").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  ApplicationProfile.GameKey = GameEngineType.KOTOR;
});

describe("scene plans", () => {
  test("a good plan passes; broken references are errors", () => {
    expect(GMScenePlan.validate(plan()).filter((p) => p.level === "error")).toEqual([]);

    const broken = plan({
      actors: [{ id: "dark", template: "x", faction: "evil" as any, at: { spot: "actor:nobody" }, order: { kind: "attack", target: "ghosts" } }],
      beats: [{ title: "", actions: [{ do: "reveal", ids: ["missing"] }, { do: "dance" } as any] }],
    });
    const errors = GMScenePlan.validate(broken).filter((p) => p.level === "error").map((p) => p.message);
    expect(errors).toEqual(expect.arrayContaining([
      'Faction is "hostile", "friendly" or "neutral".',
      'No actor "nobody".',
      'No actor "ghosts" to attack.',
      'No actor or prop "missing".',
      'Unknown action "dance".',
    ]));
  });

  test("customize.level restats an actor: a whole level 1 to 50, and a class by name or number", () => {
    const at = (customize: any) => GMScenePlan.validate(plan({ actors: [{ id: "a", template: "x", faction: "hostile", at: { spot: "entry" }, customize }], props: [], beats: [] }))
      .filter((p) => p.level === "error").map((p) => p.message);
    expect(at({ level: 8 })).toEqual([]);
    expect(at({ level: 0 })).toContain("customize.level is a whole number, 1 to 50.");
    expect(at({ level: 7.5 })).toContain("customize.level is a whole number, 1 to 50.");

    (GameState as any).TwoDAManager = { datatables: new Map([["classes", { rows: { 0: { label: "Soldier", name: "****" }, 3: { label: "JediGuardian", name: "****" }, 8: { label: "Minion", name: "****" } } }]]) };
    (GameState as any).TLKManager = { GetStringById: () => ({ Value: "" }) };
    expect(GMScenePlan.classIdOf("jedi guardian")).toBe(3);
    expect(GMScenePlan.classIdOf("Jedi_Guardian")).toBe(3);
    expect(GMScenePlan.classIdOf("minion")).toBe(8);
    expect(GMScenePlan.classIdOf(0)).toBe(0);
    expect(GMScenePlan.classIdOf("Bounty Hunter")).toBeUndefined();
  });

  test("content from the other game is only a warning; the area of the other game is borrowed", () => {
    const problems = GMScenePlan.validate(plan({ content: "kotor" }));
    expect(problems.find((p) => p.where === "content")?.level).toBe("warning");
    expect(GMScenePlan.areaModuleName(plan())).toBe("kotor:danm13");
    expect(GMScenePlan.areaModuleName(plan({ area: { game: "tsl", module: "001EBO" } }))).toBe("001ebo");
  });

  test("spots resolve in the area, with offsets and formations on walkable ground", () => {
    const runner = new GMScenePlan(plan());
    expect(runner.resolveSpot("waypoint:door")?.x).toBe(20);
    expect(runner.resolveSpot("room:nowhere")).toBeNull();

    const line = runner.placementPoints({ spot: "waypoint:door", offset: [0, 5], formation: "line", spacing: 2 }, 3)!;
    expect(line.map((p) => [p.x, p.y])).toEqual([[18, 5], [20, 5], [22, 5]]);

    const ring = runner.placementPoints({ spot: "entry", formation: "ring", spacing: 2 }, 4)!;
    for (const p of ring) expect(p.length()).toBeCloseTo(2);
  });

  test("facing toward a spot, and toward the players by default", () => {
    const runner = new GMScenePlan(plan());
    runner.playerStart = new THREE.Vector3(0, 10, 0);
    // Due north of the actor: facing 0
    expect(runner.facingFrom(new THREE.Vector3(0, 0, 0), undefined)).toBeCloseTo(0);
    expect(runner.facingFrom(new THREE.Vector3(0, 0, 0), 90)).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(runner.facingFrom(new THREE.Vector3(0, 0, 0), "toward:waypoint:door"))).toBeCloseTo(Math.PI / 2);
  });

  test("an attack on a group shares its members out among the attackers", () => {
    const runner = new GMScenePlan(plan());
    runner.objects.set("jedi", [creature("j1", 0), creature("j2", 1)]);
    expect(runner.toEngineOrder({ kind: "attack", target: "jedi" }, 0)).toEqual({ kind: "attack", targetNetId: "j1" });
    expect(runner.toEngineOrder({ kind: "attack", target: "jedi" }, 1)).toEqual({ kind: "attack", targetNetId: "j2" });
    expect(runner.toEngineOrder({ kind: "attack", target: "jedi" }, 2)).toEqual({ kind: "attack", targetNetId: "j1" });
  });

  test("revealing hidden actors shows them and gives them the order they were placed with", () => {
    const runner = new GMScenePlan(plan());
    const dark = [creature("d1", 20), creature("d2", 21)];
    runner.objects.set("dark", dark);
    runner.pendingOrders.set("dark", { kind: "attack", target: "jedi" });
    const hide = jest.spyOn(runner, "setHidden").mockImplementation(() => {});
    const order = jest.spyOn(runner, "giveOrder").mockImplementation(() => {});

    runner.runBeat(0);
    expect(hide).toHaveBeenCalledWith(dark[0], false);
    expect(hide).toHaveBeenCalledWith(dark[1], false);
    expect(order).toHaveBeenCalledWith(["dark"], { kind: "attack", target: "jedi" });
    expect(runner.beatsRun.has(0)).toBe(true);
    // Given once
    expect(runner.pendingOrders.has("dark")).toBe(false);
  });

  test("checks by name: skills and saves", () => {
    expect(GMScenePlan.parseCheck("Awareness")).toEqual({ kind: "skill", skill: 3 });
    expect(GMScenePlan.parseCheck("will")).toEqual({ kind: "save", save: "will" });
    expect(GMScenePlan.parseCheck("juggling")).toBeNull();
  });
});

describe("players watching a scene", () => {
  test("frozen players can't be targeted, and neither can hidden actors", () => {
    const pc: any = { gmOwnerPeerId: "peer_a", objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature };
    jest.spyOn(GMManager, "isPlayerCharacter").mockImplementation((o: any) => !!o?.gmOwnerPeerId);
    GMManager.playersFrozen = false;
    expect(GMManager.isUntargetable(pc)).toBe(false);
    GMManager.playersFrozen = true;
    expect(GMManager.isUntargetable(pc)).toBe(true);
    expect(GMManager.isUntargetable({ gmHidden: true } as any)).toBe(true);
    GMManager.playersFrozen = false;
  });

  test("on a player's machine, their own character is frozen when the rules say so", () => {
    GMNetworkManager.role = "client";
    GMNetworkManager.assignedActorNetId = "pc_1";
    GMNetworkManager.sessionRules = { deathRule: "kotor", frozen: true };
    expect(GMManager.isPlayerFrozen({ gmNetId: "pc_1" } as any)).toBe(true);
    expect(GMManager.isPlayerFrozen({ gmNetId: "pc_2" } as any)).toBe(false);
    GMNetworkManager.sessionRules = { deathRule: "kotor" };
    GMNetworkManager.role = "offline";
  });
});

describe("Scene plans: nobody stands inside a prop", () => {
  const table = { id: "table", box: new THREE.Box3(new THREE.Vector3(-2, -1, -1), new THREE.Vector3(2, 1, 1)) };

  test("an actor on a table's spot is moved just clear of it, to the nearest side", () => {
    const runner = new GMScenePlan(plan());
    runner.footprints = [table];
    jest.spyOn(GMViewport, "getGroundZAt").mockImplementation((_x: number, _y: number, z: number = 0) => z);
    const clear = runner.clearOfProps(new THREE.Vector3(0, 0.3, 0));
    expect(clear?.from).toBe("table");
    // The long side it's nearest: just past the table's edge plus an actor's room
    expect(clear!.point.y).toBeGreaterThanOrEqual(1 + GMScenePlan.ACTOR_CLEARANCE);
    expect(runner.footprintAt(clear!.point)).toBeNull();
  });

  test("someone already beside it stays put", () => {
    const runner = new GMScenePlan(plan());
    runner.footprints = [table];
    expect(runner.footprintAt(new THREE.Vector3(0, 2, 0))).toBeNull();
  });

  test("a seated actor on a chair belongs in it; on a table it doesn't", () => {
    const runner = new GMScenePlan(plan({
      props: [
        { id: "seat", template: "plc_chair_mil_01", at: { spot: "entry" } },
        { id: "table", template: "plc_gentable", at: { spot: "entry" } },
        { id: "food", template: "plc_chair1", at: { spot: "entry" } },
      ],
    }));
    const actor = (spot: string, stance?: string) => ({ id: "a", template: "n_rodian", faction: "neutral" as const, at: { spot }, stance });
    expect(runner.seatFor(actor("prop:seat", "chair_pazaak"))).toBe("seat");
    expect(runner.seatFor(actor("prop:table", "chair_pazaak"))).toBeUndefined();
    expect(runner.seatFor(actor("prop:seat"))).toBeUndefined();
    // KotOR II's plc_chair1 is a food pile
    expect(runner.seatFor(actor("prop:food", "chair"))).toBeUndefined();
  });
});

import { describe, expect, jest, test } from "@jest/globals";

// The real GameState pulls in the whole browser engine (WebGL, window, File System Access)
jest.mock("@/GameState", () => ({ GameState: { gmMode: true } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import * as THREE from "three";
import { GMManager } from "@/managers/GMManager";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { GMSpawner } from "@/managers/gm/GMSpawner";

const item = (resRef: string) => ({ getEquippedRes: () => resRef, getInventoryRes: () => resRef });

function creature(overrides: Record<string, any> = {}): any {
  return {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    position: new THREE.Vector3(),
    appearance: 12,
    factionId: 1,
    heldStance: '',
    inventory: [],
    equipment: {},
    getName: () => "Dark Jedi",
    getMaxHP: () => 80,
    getTemplateResRef: () => "n_darkjedi01",
    getMainClass: () => ({ id: 4, level: 9 }),
    getTotalClassLevel: () => 9,
    getFacing: () => 0,
    ...overrides,
  };
}

describe("GM objects described as spawn configs", () => {
  test("a module creature keeps its template, class, level, gear and stance", () => {
    const cre = creature({
      heldStance: "meditate",
      equipment: { RIGHTHAND: item("g_w_lghtsbr02") },
      gmBarkText: "You are too late.",
    });

    expect(GMSpawner.describeCreature(cre)).toEqual(expect.objectContaining({
      name: "Dark Jedi",
      templateResRef: "n_darkjedi01",
      classId: 4,
      level: 9,
      appearanceId: 12,
      customized: true,
      factionId: 1,
      hp: 80,
      rightHandResRef: "g_w_lghtsbr02",
      leftHandResRef: "",
      armorResRef: "",
      stance: "meditate",
      barkText: "You are too late.",
    }));
  });

  test("a GM-placed creature starts from what it was spawned from, with its current side and stance", () => {
    const cre = creature({
      factionId: 2,
      heldStance: "sit",
      gmSpawnConfig: { name: "Guard", templateResRef: "g_sithtroop01", appearanceId: 28, factionId: 1, hp: 25, level: 3, classId: 0, lootResRefs: ["g_i_medeqpmnt01"] },
    });

    const config = GMSpawner.describeCreature(cre);
    expect(config).toEqual(expect.objectContaining({ templateResRef: "g_sithtroop01", level: 3, factionId: 2, stance: "sit", lootResRefs: ["g_i_medeqpmnt01"] }));
    expect(config.customized).toBeUndefined();
    // A copy: changing it never reaches the creature's own config
    config.lootResRefs!.push("x");
    expect(cre.gmSpawnConfig.lootResRefs).toEqual(["g_i_medeqpmnt01"]);
  });

  test("a placeable keeps its current lock, size and skill gate", () => {
    const plc: any = {
      objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModulePlaceable,
      gmSpawnConfig: { name: "Vault", appearanceId: 54, useable: true, hasInventory: true, locked: false, openLockDC: 18, lootResRefs: [] },
      gmScale: 1.5,
      gmSkillGate: { skill: 6, dc: 20 },
      isLocked: () => true,
      inventory: [],
    };

    expect(GMSpawner.describeObject(plc)).toEqual({
      kind: "placeable",
      config: expect.objectContaining({ name: "Vault", locked: true, scale: 1.5, skillGate: { skill: 6, dc: 20 }, zOffset: 0 }),
    });
  });
});

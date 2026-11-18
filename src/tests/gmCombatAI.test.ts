import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import * as THREE from "three";

const mockSpellsRows: Record<number, any> = {
  10: { label: "FORCE_POWER_CURE", impactscript: "k_sup_healing", forcefriendly: "0", range: "S" },
  20: { label: "FORCE_POWER_VALOR", impactscript: "k_sp1_generic", forcefriendly: "0x01", range: "S" },
  30: { label: "FORCE_POWER_STUN", impactscript: "k_sp1_generic", forcehostile: "0x04", range: "M", category: "0x1101" },
  40: { label: "FORCE_POWER_DROID_DISABLE", impactscript: "k_sp1_generic", forcehostile: "1", range: "M", category: "0x1101" },
  50: { label: "FORCE_POWER_STORM", impactscript: "k_sp1_generic", forcehostile: "0x04", range: "L", category: "0x2101" },
  60: { label: "GRENADE_FRAG", impactscript: "k_sup_grenade", range: "M" },
  70: { label: "GRENADE_ION", impactscript: "k_sup_grenade", range: "M" },
};

const mockGMManager: any = {
  npcAiEnabled: true,
  isAutonomousNpc: jest.fn(() => true),
  isPlayerCharacter: jest.fn(() => false),
  attackTargetOf: jest.fn(),
};

jest.mock("@/GameState", () => ({
  GameState: {
    gmMode: true,
    simTimeMs: 10000,
    random: () => 0.1,
    TwoDAManager: {
      datatables: new Map([["spells", { rows: mockSpellsRows }]]),
    },
    GMManager: mockGMManager,
    GMNetworkManager: { role: "host" },
    hooks: { isNetReplica: () => false },
  },
}));

jest.mock("@/managers/gm/GMPlayers", () => ({ GMPlayers: { keepFighting: jest.fn() } }));
jest.mock("@/managers/gm/GMLog", () => ({ GMLog: { info: jest.fn(), warn: jest.fn() } }));
jest.mock("@/managers/gm/GMSpawner", () => ({ GMSpawner: { createItemFromResRefAsync: jest.fn() } }));
jest.mock("@/managers/GMNpcOrders", () => ({ GMNpcOrders: { getOrder: jest.fn() } }));
jest.mock("@/module/ModuleItem", () => ({
  ModuleItem: { GetCastSpellId: (prop: any) => prop?.spellId ?? -1 },
}));

import { GMCombatAI } from "@/managers/gm/GMCombatAI";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ActionType } from "@/enums/actions/ActionType";

function makeCreature(overrides: Record<string, any> = {}): any {
  const pos = overrides.position || new THREE.Vector3(0, 0, 0);
  const hp = overrides.hp ?? 100;
  const maxHp = overrides.maxHp ?? 100;
  return {
    id: overrides.id ?? Math.floor(Math.random() * 10000),
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    position: pos,
    effects: [],
    actionQueue: [],
    inventory: [],
    equipment: {},
    combatData: { combatState: false },
    combatRound: { roundStarted: false, scheduledActionList: [], clearActions: jest.fn(), endCombatRound: jest.fn() },
    getName: () => overrides.name || "Creature",
    getHP: () => hp,
    getMaxHP: () => maxHp,
    getFP: () => overrides.fp ?? 100,
    getMaxFP: () => overrides.maxFp ?? 0,
    getRace: () => overrides.race ?? 6, // 5 = Droid, 6 = Human
    getSpells: () => overrides.spells || [],
    getFeats: () => overrides.feats || [],
    isDead: () => !!overrides.dead,
    isHostile: (other: any) => (overrides.faction ?? 1) !== (other?.faction ?? 1),
    isRangedEquipped: () => !!overrides.ranged,
    getMeleeRange: () => 2,
    clearAllActions: jest.fn(),
    attackCreature: jest.fn(),
    faction: overrides.faction ?? 1,
    ...overrides,
  };
}

describe("GMCombatAI", () => {
  beforeEach(() => {
    mockGMManager.npcAiEnabled = true;
    mockGMManager.isAutonomousNpc.mockReturnValue(true);
    mockGMManager.isPlayerCharacter.mockReturnValue(false);
  });

  test("bestRanks keeps only the highest rank of each feat chain", () => {
    const flurry = { id: 11, successor: 91 };
    const improved = { id: 91, successor: 53 };
    const master = { id: 53, successor: -1 };
    const toughness = { id: 40, successor: -1 };

    const best = GMCombatAI.bestRanks([flurry, improved, master, toughness]);
    expect(best.map((f) => f.id)).toEqual([53, 40]);
  });

  test("powerTargetRule and worksOn enforce droid and Force-user target restrictions", () => {
    const human = makeCreature({ race: 6, maxFp: 0 });
    const jedi = makeCreature({ race: 6, maxFp: 120 });
    const droid = makeCreature({ race: 5, maxFp: 0 });

    expect(GMCombatAI.powerTargetRule("1")).toBe("droids");
    expect(GMCombatAI.powerTargetRule("8")).toBe("forceUsers");
    expect(GMCombatAI.powerTargetRule("0x04")).toBeUndefined();

    expect(GMCombatAI.worksOn("droids", droid)).toBe(true);
    expect(GMCombatAI.worksOn("droids", human)).toBe(false);
    expect(GMCombatAI.worksOn("forceUsers", jedi)).toBe(true);
    expect(GMCombatAI.worksOn("forceUsers", human)).toBe(false);
    expect(GMCombatAI.worksOn(undefined, human)).toBe(true);

    const replicaJedi = makeCreature({ race: 6, maxFp: 0, gmForceUser: true });
    const classJedi = makeCreature({ race: 6, maxFp: 0, classes: [{ spellcaster: true }] });
    expect(GMCombatAI.isForceUser(replicaJedi)).toBe(true);
    expect(GMCombatAI.isForceUser(classJedi)).toBe(true);
  });

  test("clearWay detects creatures blocking the line of attack outside melee cluster", () => {
    const attacker = makeCreature({ id: 1, position: new THREE.Vector3(0, 0, 0) });
    const blocker = makeCreature({ id: 2, position: new THREE.Vector3(5, 0.2, 0) });
    const bystander = makeCreature({ id: 3, position: new THREE.Vector3(5, 3, 0) });
    const target = makeCreature({ id: 4, position: new THREE.Vector3(10, 0, 0) });

    expect(GMCombatAI.clearWay(attacker, target, [attacker, blocker, target])).toBe(false);
    expect(GMCombatAI.clearWay(attacker, target, [attacker, bystander, target])).toBe(true);
  });

  test("choose prioritizes self-heal under 40% HP and respects style and cooldowns", () => {
    const npc = makeCreature({
      id: 1,
      hp: 20,
      maxHp: 100,
      fp: 100,
      faction: 1,
      equipment: { RIGHTHAND: { isRangedWeapon: () => false } },
      spells: [{ id: 10, getForcePointCost: () => 15, useTalentOnObject: jest.fn() }],
      feats: [{ id: 11, category: 0x1104, label: "Flurry", useTalentOnObject: jest.fn() }],
    });
    const target = makeCreature({ id: 2, faction: 2, position: new THREE.Vector3(1.5, 0, 0) });

    const s = GMCombatAI.situation(npc, target, [npc, target]);
    const picked = GMCombatAI.choose(s, "all");
    expect(picked?.tactic.id).toBe("heal-self");

    // Put heal-self on cooldown -> falls back to feat or attack
    npc.gmCombatCooldowns = { "heal-self": s.now + 5000 };
    const next = GMCombatAI.choose(s, "all");
    expect(next?.tactic.id).toBe("feat");

    // Style 'weapons' excludes spells even when off cooldown
    npc.gmCombatCooldowns = {};
    const weaponOnly = GMCombatAI.choose(s, "weapons");
    expect(weaponOnly?.tactic.id).toBe("feat");
  });

  test("area tactic skips friendly-fire grenades when allies stand near the target", () => {
    const npc = makeCreature({
      id: 1,
      faction: 1,
      fp: 100,
      position: new THREE.Vector3(0, 0, 0),
      equipment: { RIGHTHAND: {} },
      inventory: [
        {
          getBaseItem: () => ({ equipableSlots: 0 }),
          getWeaponType: () => 0,
          getUsableCastSpellProperties: () => [{ spellId: 60 }], // GRENADE_FRAG (discriminate = false)
          getEquippedRes: () => "g_w_fraggren01",
          useItemOnObject: jest.fn(),
        },
      ],
    });
    const target1 = makeCreature({ id: 2, faction: 2, position: new THREE.Vector3(10, 0, 0) });
    const target2 = makeCreature({ id: 3, faction: 2, position: new THREE.Vector3(11, 0, 0) });
    const allyNearTarget = makeCreature({ id: 4, faction: 1, position: new THREE.Vector3(10.5, 1, 0) });

    const sWithAlly = GMCombatAI.situation(npc, target1, [npc, target1, target2, allyNearTarget]);
    const choiceWithAlly = GMCombatAI.choose(sWithAlly, "all");
    expect(choiceWithAlly?.tactic.id).not.toBe("area");

    const sClear = GMCombatAI.situation(npc, target1, [npc, target1, target2]);
    const choiceClear = GMCombatAI.choose(sClear, "all");
    expect(choiceClear?.tactic.id).toBe("area");
  });

  test("runsBehaviourScripts hands control to GM AI when active unless scripted or player-owned", () => {
    const npc = makeCreature();
    expect(GMCombatAI.runsBehaviourScripts(npc)).toBe(false);

    npc.gmScripted = true;
    expect(GMCombatAI.runsBehaviourScripts(npc)).toBe(true);

    npc.gmScripted = false;
    npc.gmOwnerPeerId = "peer_1";
    expect(GMCombatAI.runsBehaviourScripts(npc)).toBe(false);

    // Hidden by the GM: nothing of its own, even one left to its scripts (hidden, it fought on unseen)
    npc.gmOwnerPeerId = undefined;
    npc.gmScripted = true;
    npc.gmHidden = true;
    expect(GMCombatAI.runsBehaviourScripts(npc)).toBe(false);
  });

  test("holdsScriptAttack returns true during standDown/flee orders or queued spell casts", () => {
    const npc = makeCreature({ gmOrder: { kind: "standDown" } });
    expect(GMCombatAI.holdsScriptAttack(npc)).toBe(true);

    npc.gmOrder = undefined;
    npc.actionQueue = [{ type: ActionType.ActionCastSpell }];
    expect(GMCombatAI.holdsScriptAttack(npc)).toBe(true);
  });
});

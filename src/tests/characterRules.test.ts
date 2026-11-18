import { describe, expect, jest, test } from "@jest/globals";

const tables = new Map<string, any>([
  [
    "classes",
    {
      rows: {
        0: { __index: 0, label: "Soldier", playerclass: "1", name: 100 },
        3: { __index: 3, label: "Jedi_Guardian", playerclass: "1", name: 101, hitdie: "10", forcedie: "4", spellcaster: "1" },
        8: { __index: 8, label: "Minion", playerclass: "0", name: 102 },
      },
    },
  ],
  [
    "skills",
    {
      rows: {
        0: { __index: 0, label: "COMPUTER_USE", name: 200, jgd_class: "0" },
        1: { __index: 1, label: "PERSUADE", name: 201, jgd_class: "1" },
      },
    },
  ],
]);

jest.mock("@/GameState", () => ({
  GameState: {
    TwoDAManager: { datatables: tables },
    TLKManager: {
      GetStringById: (id: number) => ({
        Value: ({ 100: "Soldier", 101: "Jedi Guardian", 200: "Computer Use", 201: "Persuade" } as Record<number, string>)[id] || "",
      }),
    },
  },
}));

import { CharacterRules } from "@/engine/rules/CharacterRules";

describe("CharacterRules", () => {
  test("computes ability raise costs using KotOR's 30-point buy curve", () => {
    expect(CharacterRules.abilityCost(8)).toBe(0);
    expect(CharacterRules.abilityCost(14)).toBe(7); // 9..13 cost 1 each (5), 14 costs 2
    expect(CharacterRules.raiseCost(14)).toBe(2);
    expect(CharacterRules.raiseCost(16)).toBe(3);
    expect(CharacterRules.raiseCost(18)).toBe(4);

    const balanced = { str: 14, dex: 14, con: 14, int: 10, wis: 10, cha: 10 };
    expect(CharacterRules.abilitiesCost(balanced)).toBe(27);
    expect(CharacterRules.abilitiesCost(balanced)).toBeLessThanOrEqual(CharacterRules.ABILITY_POOL);
  });

  test("clamps out-of-range attributes and brings overspent pools within session limits", () => {
    const overspent = { str: 24, dex: 18, con: 18, int: 18, wis: 18, cha: 18 };
    const clamped = CharacterRules.clampAbilities(overspent);

    expect(clamped.str).toBeLessThanOrEqual(CharacterRules.ABILITY_MAX);
    expect(CharacterRules.abilitiesCost(clamped)).toBeLessThanOrEqual(CharacterRules.ABILITY_POOL);

    const boostedPool = CharacterRules.abilityPool({ extraPoints: 10 });
    expect(boostedPool).toBe(40);
    const clampedExpanded = CharacterRules.clampAbilities(overspent, { extraPoints: 10 });
    expect(CharacterRules.abilitiesCost(clampedExpanded)).toBeLessThanOrEqual(40);
  });

  test("filters playable classes from classes.2da and reads skill options via TLK", () => {
    const classes = CharacterRules.classes();
    expect(classes.map((c) => c.name)).toEqual(["Soldier", "Jedi Guardian"]);
    expect(CharacterRules.skillOptions().map((s) => s.name)).toEqual(["Computer Use", "Persuade"]);
  });

  test("validate flags invalid class, level range, and overspent attribute pools", () => {
    const problems = CharacterRules.validate(
      {
        classId: 8, // Minion (non-playerclass)
        level: 10,
        attributes: { str: 18, dex: 18, con: 18, int: 18, wis: 18, cha: 18 },
      },
      { level: [1, 5] }
    );
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

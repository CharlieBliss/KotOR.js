import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: {} }));

import { GameState } from "@/GameState";
import { CharacterRules } from "@/engine/rules/CharacterRules";
import { CharacterBuilder } from "@/engine/rules/CharacterBuilder";

/** A 2DA table as the engine holds it: rows keyed by index, each with __index */
function table(rows: Record<string, any>[]) {
  const out: Record<number, any> = {};
  rows.forEach((row, i) => { out[i] = { __index: i, ...row }; });
  return { rows: out };
}

const tables = new Map<string, any>();

beforeEach(() => {
  tables.clear();
  (GameState as any).TwoDAManager = { datatables: tables };
  (GameState as any).TLKManager = { GetStringById: (): any => undefined };

  tables.set('classes', table([
    { label: 'Soldier', playerclass: '1', featstable: 'SOL', skillstable: 'SOL', spellgaintable: '****', featgain: 'SOL', forcedie: '0', skillpointbase: '2', hitdie: '10' },
    { label: 'JediGuardian', playerclass: '1', featstable: 'JGD', skillstable: 'JGD', spellgaintable: 'JGD', featgain: 'JGD', forcedie: '4', skillpointbase: '2', hitdie: '10' },
    { label: 'Droid', playerclass: '0', featstable: 'DRO', skillstable: 'DRO', spellgaintable: '****', featgain: 'DRO', forcedie: '0', skillpointbase: '1', hitdie: '8' },
  ]));
  tables.set('featgain', table([
    { sol_reg: '1', jgd_reg: '1' },
    { sol_reg: '1', jgd_reg: '0' },
  ]));
  tables.set('classpowergain', table([
    { jgd: '2' },
    { jgd: '1' },
  ]));
  tables.set('feat', table([
    /* 0 */ { label: 'WEAPON_PROF', sol_list: '3', sol_granted: '1', jgd_list: '3', jgd_granted: '1', prereqfeat1: '****', prereqfeat2: '****' },
    /* 1 */ { label: 'POWER_ATTACK', sol_list: '1', sol_recom: '1', jgd_list: '1', jgd_recom: '2', prereqfeat1: '****', prereqfeat2: '****' },
    /* 2 */ { label: 'IMPROVED_POWER_ATTACK', sol_list: '1', sol_recom: '2', jgd_list: '1', prereqfeat1: '1', prereqfeat2: '****' },
    /* 3 */ { label: 'JEDI_DEFENSE', sol_list: '4', jgd_list: '3', jgd_granted: '2', prereqfeat1: '****', prereqfeat2: '****' },
    /* 4 */ { label: 'XXXX_UNUSED', sol_list: '0', jgd_list: '0', prereqfeat1: '****', prereqfeat2: '****' },
  ]));
  tables.set('spells', table([
    /* 0 */ { label: 'FORCE_POWER_PUSH', usertype: '1', guardian: '0', prerequisites: '****', light_recom: '1', dark_recom: '3' },
    /* 1 */ { label: 'FORCE_POWER_WHIRLWIND', usertype: '1', guardian: '0', prerequisites: '0', light_recom: '4', dark_recom: '4' },
    /* 2 */ { label: 'FORCE_POWER_LATE', usertype: '1', guardian: '9', prerequisites: '****', light_recom: '0', dark_recom: '0' },
  ]));
  tables.set('skills', table([
    /* 0 */ { label: 'Awareness', jgd_class: '1', jgd_reco: '1', sol_class: '1', sol_reco: '2' },
    /* 1 */ { label: 'Security', jgd_class: '0', jgd_reco: '2', sol_class: '0', sol_reco: '****' },
  ]));
});

const base = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };

describe('ability point-buy', () => {
  test('a point costs 1 up to 13, then 2, 3 and 4, by the score it raises to', () => {
    expect([9, 13, 14, 15, 16, 17, 18].map((s) => CharacterRules.raiseCost(s))).toEqual([1, 1, 2, 2, 3, 3, 4]);
    expect(CharacterRules.abilityCost(8)).toBe(0);
    expect(CharacterRules.abilityCost(13)).toBe(5);
    expect(CharacterRules.abilityCost(18)).toBe(5 + 2 + 2 + 3 + 3 + 4);
  });

  test('spending is checked against the pool, which a session can enlarge', () => {
    const strong = { ...base, str: 18, dex: 16 };  // 19 + 12
    expect(CharacterRules.abilitiesCost(strong)).toBe(31);
    const tooMuch = { ...base, str: 18, dex: 18 };  // 38
    expect(CharacterRules.validate({ classId: 0, level: 1, attributes: tooMuch }).join()).toMatch(/cost 38 points; there are 30/);
    expect(CharacterRules.validate({ classId: 0, level: 1, attributes: tooMuch }, { extraPoints: 8 })).toEqual([]);
  });
});

describe('classes and levels', () => {
  test('only player classes can be taken', () => {
    expect(CharacterRules.classes().map((c) => c.label)).toEqual(['Soldier', 'JediGuardian']);
    expect(CharacterRules.validate({ classId: 2, level: 1, attributes: base }).join()).toMatch(/isn't one a player can take/);
  });

  test('a session can fix the starting level or give a range', () => {
    expect(CharacterRules.validate({ classId: 0, level: 3, attributes: base }, { level: 5 }).join()).toMatch(/start at level 5/);
    expect(CharacterRules.validate({ classId: 0, level: 3, attributes: base }, { level: [2, 4] })).toEqual([]);
  });
});

describe('feats, powers and skills', () => {
  test('the recommended build passes its own rules', () => {
    for (const classId of [0, 1]) {
      const built = CharacterBuilder.build({ classId, level: 2, attributes: { ...base, int: 12 } });
      expect(CharacterRules.validate({ classId, level: 2, attributes: { ...base, int: 12 }, feats: built.feats, powers: built.powers, skillRanks: built.skillRanks })).toEqual([]);
    }
  });

  test('a feat needs its prerequisites, its class, and a pick to spend', () => {
    // Improved Power Attack without Power Attack
    expect(CharacterRules.validate({ classId: 0, level: 2, attributes: base, feats: [0, 2] }).join()).toMatch(/IMPROVED_POWER_ATTACK can't be taken/);
    // Three picks where the soldier gets two by level 2
    expect(CharacterRules.validate({ classId: 0, level: 1, attributes: base, feats: [0, 1, 2] }).join()).toMatch(/2 feats picked; the class picks 1/);
    // Jedi Defense isn't a soldier's feat, unless the session allows free feats
    expect(CharacterRules.validate({ classId: 0, level: 1, attributes: base, feats: [0, 3] }).join()).toMatch(/JEDI_DEFENSE can't be taken/);
    expect(CharacterRules.validate({ classId: 0, level: 1, attributes: base, feats: [0, 3] }, { freeFeats: true })).toEqual([]);
  });

  test('picker options follow prerequisites', () => {
    const has = new Set([0]);
    expect(CharacterRules.featOptions(0, has, 2).map((o) => o.id)).toEqual([1]);
    has.add(1);
    expect(CharacterRules.featOptions(0, has, 2).map((o) => o.id)).toEqual([1, 2]);
  });

  test('a power must be the class\'s by this level, with its prerequisites known', () => {
    expect(CharacterRules.validate({ classId: 1, level: 1, attributes: base, powers: [1] }).join()).toMatch(/FORCE_POWER_WHIRLWIND can't be learned/);
    expect(CharacterRules.validate({ classId: 1, level: 1, attributes: base, powers: [0, 2] }).join()).toMatch(/FORCE_POWER_LATE can't be learned/);
    expect(CharacterRules.validate({ classId: 1, level: 1, attributes: base, powers: [0, 1] })).toEqual([]);
  });

  test('skills cost 1 a rank for class skills and 2 otherwise, within the points and caps', () => {
    // Jedi level 1, INT 8: (2 - 1) * 4 = 4 points; Awareness max 4, Security (cross-class) max 2
    expect(CharacterRules.skillPoints(1, 1, 8)).toBe(4);
    expect(CharacterRules.validate({ classId: 1, level: 1, attributes: base, skillRanks: [4, 0] })).toEqual([]);
    expect(CharacterRules.validate({ classId: 1, level: 1, attributes: base, skillRanks: [2, 2] }).join()).toMatch(/cost 6 points; there are 4/);
    expect(CharacterRules.validate({ classId: 1, level: 1, attributes: base, skillRanks: [5, 0] }).join()).toMatch(/Awareness can have at most 4/);
  });
});

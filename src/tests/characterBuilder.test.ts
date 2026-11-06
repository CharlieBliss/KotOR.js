import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: {} }));

import { GameState } from "@/GameState";
import { CharacterBuilder } from "@/engine/rules/CharacterBuilder";
import { AbilityChains } from "@/engine/rules/AbilityChains";

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

  tables.set('classes', table([
    { label: 'Soldier', featstable: 'SOL', skillstable: 'SOL', spellgaintable: '****', featgain: 'SOL', forcedie: '0', skillpointbase: '2', hitdie: '10' },
    { label: 'JediGuardian', featstable: 'JGD', skillstable: 'JGD', spellgaintable: 'JGD', featgain: 'JGD', forcedie: '4', skillpointbase: '2', hitdie: '10' },
  ]));
  // Two levels of gains
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
    /* 3 */ { label: 'MASTER_POWER_ATTACK', sol_list: '1', sol_recom: '3', jgd_list: '1', prereqfeat1: '2', prereqfeat2: '****' },
    /* 4 */ { label: 'JEDI_DEFENSE', sol_list: '4', jgd_list: '3', jgd_granted: '2', prereqfeat1: '****', prereqfeat2: '****' },
    /* 5 */ { label: 'XXXX_UNUSED', sol_list: '0', sol_recom: '0', jgd_list: '0', prereqfeat1: '****', prereqfeat2: '****' },
  ]));
  tables.set('spells', table([
    /* 0 */ { label: 'FORCE_POWER_PUSH', usertype: '1', guardian: '0', prerequisites: '****', light_recom: '1', dark_recom: '3' },
    /* 1 */ { label: 'FORCE_POWER_WHIRLWIND', usertype: '1', guardian: '0', prerequisites: '0', light_recom: '4', dark_recom: '4' },
    /* 2 */ { label: 'FORCE_POWER_HEAL', usertype: '1', guardian: '0', prerequisites: '****', light_recom: '2', dark_recom: '****' },
    /* 3 */ { label: 'FORCE_POWER_CHOKE', usertype: '1', guardian: '0', prerequisites: '****', light_recom: '****', dark_recom: '1' },
    /* 4 */ { label: 'FORCE_POWER_LATE', usertype: '1', guardian: '9', prerequisites: '****', light_recom: '0', dark_recom: '0' },
    /* 5 */ { label: 'ITEM_MEDPAC', usertype: '3', guardian: '****', prerequisites: '****' },
  ]));
  tables.set('skills', table([
    /* 0 */ { label: 'Awareness', jgd_class: '1', jgd_reco: '1', sol_class: '1', sol_reco: '2' },
    /* 1 */ { label: 'Security', jgd_class: '0', jgd_reco: '2', sol_class: '0', sol_reco: '****' },
    /* 2 */ { label: 'Persuade', jgd_class: '1', jgd_reco: '****', sol_class: '0', sol_reco: '1' },
  ]));
});

const attributes = { str: 14, dex: 14, con: 14, int: 10, wis: 14, cha: 10 };

describe('building a character from the class tables', () => {
  test('vitality and Force points come from the hit die, Force die and modifiers', () => {
    const jedi = CharacterBuilder.build({ classId: 1, level: 2, attributes });
    expect(jedi.maxHp).toBe(2 * (10 + 2));
    expect(jedi.maxFp).toBe(2 * (4 + 2));
    expect(CharacterBuilder.build({ classId: 0, level: 2, attributes }).maxFp).toBe(0);
  });

  test('takes automatic feats by level, then picks in recommended order with prerequisites', () => {
    // Soldier: weapon proficiency is automatic; 2 picks go to Power Attack then Improved (needs Power Attack)
    expect(CharacterBuilder.build({ classId: 0, level: 2, attributes }).feats).toEqual([0, 1, 2]);
    // Jedi Defense is automatic only from level 2
    expect(CharacterBuilder.build({ classId: 1, level: 1, attributes }).feats).toEqual([0, 1]);
    expect(CharacterBuilder.build({ classId: 1, level: 2, attributes }).feats).toEqual([0, 1, 4]);
  });

  test('learns the class\'s powers by level, in the light or dark recommended order, prerequisites first', () => {
    // 2 + 1 powers by level 2; light: Push (1), Heal (2), then Whirlwind (needs Push); Late needs level 9
    expect(CharacterBuilder.build({ classId: 1, level: 2, attributes }).powers).toEqual([0, 1, 2]);
    // Dark: Choke (1), Push (3), Whirlwind (4)
    expect(CharacterBuilder.build({ classId: 1, level: 2, attributes, alignment: 'dark' }).powers).toEqual([0, 1, 3]);
    // Non-Force classes learn none
    expect(CharacterBuilder.build({ classId: 0, level: 9, attributes }).powers).toEqual([]);
  });

  test('spends skill points in the recommended order, class skills to level + 3, cross-class at double cost', () => {
    // Jedi level 2, INT 10: (2 + 0) * 4 + 2 = 10 points. Awareness (class) to 5, Security (cross-class, max 2) costs 4
    expect(CharacterBuilder.build({ classId: 1, level: 2, attributes }).skillRanks).toEqual([5, 2, 0]);
  });
});

describe('ability chains for the character sheet', () => {
  const creature = (feats: number[], powers: number[]) => ({
    feats: feats.map((id) => ({ id })),
    getHasFeat: (id: number) => feats.includes(id),
    getHasSpell: (id: number) => powers.includes(id),
  }) as any;

  test('groups ranked feats by prerequisite, including ranks not yet learned', () => {
    const chains = AbilityChains.featChains(creature([0, 1, 2], []));
    expect(chains.map((c) => c.map((r: any) => r.label))).toEqual([
      ['WEAPON_PROF'],
      ['POWER_ATTACK', 'IMPROVED_POWER_ATTACK', 'MASTER_POWER_ATTACK'],
    ]);
  });

  test('groups powers by prerequisite, only Force powers the character knows', () => {
    const chains = AbilityChains.powerChains(creature([], [1, 2]));
    expect(chains.map((c) => c.map((r: any) => r.label))).toEqual([
      ['FORCE_POWER_PUSH', 'FORCE_POWER_WHIRLWIND'],
      ['FORCE_POWER_HEAL'],
    ]);
  });
});

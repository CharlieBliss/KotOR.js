import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const pc: any = { name: 'Mira', isHostile: () => false };
const ally: any = { name: 'Atton', isHostile: () => false };
const enemy: any = { name: 'Sith', isHostile: (o: any) => o === pc || o === ally };
const neutral: any = { name: 'Droid', isHostile: () => false };

const mockGMManager: any = {
  spawnedPlayers: [pc, ally],
  isPlayerCharacter: (o: any) => o === pc || o === ally,
  notifyChange: jest.fn(),
};

jest.mock("@/GameState", () => ({ GameState: { GMManager: mockGMManager } }));
jest.mock("@/managers/gm/GMLog", () => ({ GMLog: { info: jest.fn(), warn: jest.fn() } }));
jest.mock("@/managers/gm/GMCombatStats", () => ({ GMCombatStats: { profile: jest.fn() } }));

import { GMDifficulty } from "@/managers/gm/GMDifficulty";

beforeEach(() => {
  GMDifficulty.enemyHp = 1;
  GMDifficulty.enemyDamage = 1;
  GMDifficulty.carry = new WeakMap();
});

describe('the multipliers on damage as it lands', () => {
  test('at 1× nothing changes', () => {
    expect(GMDifficulty.scale(enemy, pc, 7)).toBe(7);
    expect(GMDifficulty.scale(pc, enemy, 7)).toBe(7);
  });

  test('tougher enemies take less damage, from anyone; others are untouched', () => {
    GMDifficulty.configure({ enemyHp: 2 });
    expect(GMDifficulty.scale(enemy, pc, 8)).toBe(4);
    expect(GMDifficulty.scale(neutral, pc, 8)).toBe(8);
    expect(GMDifficulty.scale(pc, enemy, 8)).toBe(8);
  });

  test("enemies' damage to player characters scales; their damage to others doesn't", () => {
    GMDifficulty.configure({ enemyDamage: 1.5 });
    expect(GMDifficulty.scale(pc, enemy, 10)).toBe(15);
    expect(GMDifficulty.scale(neutral, enemy, 10)).toBe(10);
    expect(GMDifficulty.scale(pc, neutral, 10)).toBe(10);
  });

  test('fractions carry over to the next hit instead of vanishing', () => {
    GMDifficulty.configure({ enemyHp: 2 });
    const hits = [3, 3, 3, 3].map((d) => GMDifficulty.scale(enemy, pc, d));
    expect(hits).toEqual([1, 2, 1, 2]);
    expect(hits.reduce((a, b) => a + b, 0)).toBe(6);
  });

  test('no damage stays no damage, and bad settings are ignored', () => {
    GMDifficulty.configure({ enemyHp: 2 });
    expect(GMDifficulty.scale(enemy, pc, 0)).toBe(0);
    GMDifficulty.configure({ enemyHp: 0, enemyDamage: NaN });
    expect(GMDifficulty.enemyHp).toBe(2);
    expect(GMDifficulty.enemyDamage).toBe(1);
  });
});

describe('the readout', () => {
  const fighter = (hp: number, ac: number, bonus: number, damage: number): any => ({ hp, ac, attacks: [{ bonus, damage }] });

  test('a hit needs the AC less the bonus on a d20, between 5% and 95%', () => {
    expect(GMDifficulty.hitChance(5, 15)).toBeCloseTo(0.55);
    expect(GMDifficulty.hitChance(0, 40)).toBe(0.05);
    expect(GMDifficulty.hitChance(30, 10)).toBe(0.95);
  });

  test('rounds to win against rounds to lose give the verdict, and the multipliers move it', () => {
    const party = [fighter(100, 16, 8, 10), fighter(80, 16, 8, 10)];
    const weak = [fighter(30, 12, 2, 4)];
    const r = GMDifficulty.measure(party, weak);
    expect(r.party.count).toBe(2);
    expect(r.enemies.hp).toBe(30);
    expect(r.verdict).toBe('easy');

    const strong = [fighter(150, 18, 10, 14), fighter(150, 18, 10, 14), fighter(150, 18, 10, 14)];
    expect(GMDifficulty.measure(party, strong).verdict).toBe('deadly');
    // The same enemies, halved: easier
    const halved = GMDifficulty.measure(party, strong, 0.5, 0.5);
    expect(halved.enemies.hp).toBe(225);
    expect(halved.partyRounds / halved.enemyRounds).toBeLessThan(GMDifficulty.measure(party, strong).partyRounds / GMDifficulty.measure(party, strong).enemyRounds);
  });

  test('nobody to fight is no verdict', () => {
    expect(GMDifficulty.measure([fighter(100, 16, 8, 10)], []).verdict).toBe('none');
  });
});

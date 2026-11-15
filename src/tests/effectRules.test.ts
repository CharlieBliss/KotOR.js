import { describe, expect, jest, test, afterEach } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: { gmMode: false } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import { ModuleCreature } from "@/module/ModuleCreature";
import { ModuleObject } from "@/module/ModuleObject";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ModuleItemProperty } from "@/enums/module/ModuleItemProperty";
import { ModuleItem } from "@/module/ModuleItem";
import { GameState } from "@/GameState";

const C = ModuleCreature.prototype as any;

/** A stand-in effect: a type and its integers */
const effect = (type: GameEffectType, ...ints: number[]) => ({ type, getInt: (i: number) => ints[i] ?? 0 });

/** A creature stand-in that uses ModuleCreature's own rules */
function creature(fields: Record<string, any> = {}): any {
  const cre = Object.create(ModuleCreature.prototype);
  Object.assign(cre, {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    equipment: {},
    effects: [],
    skills: [],
    classes: [],
    ...fields,
  });
  return cre;
}

afterEach(() => jest.restoreAllMocks());

describe("passive effects reach the rules", () => {
  test("Ability Increase / Decrease change ability scores (an adrenal's Strength, a poison's Dexterity)", () => {
    const cre = creature({ str: 12, dex: 14 });
    cre.effects.push(effect(GameEffectType.EffectAbilityIncrease, 0, 4), effect(GameEffectType.EffectAbilityDecrease, 1, 2));
    expect(cre.getSTR()).toBe(16);
    expect(cre.getDEX()).toBe(12);
    expect(cre.getSTR(false)).toBe(12);
  });

  test("a skill's total is ranks + key ability + skill effects, as GetSkillRank returns it", () => {
    const cre = creature({ int: 14, skills: [{ rank: 3, keyAbility: "INT" }] });
    expect(cre.getSkillLevel(0)).toBe(5);
    cre.effects.push(effect(GameEffectType.EffectSkillIncrease, 0, 2), effect(GameEffectType.EffectSkillIncrease, 255, 1));
    expect(cre.getSkillLevel(0)).toBe(8);
    expect(cre.getSkillRanks(0)).toBe(3);
    expect(cre.getSkillLevel(7)).toBe(0);
  });

  test("only a creature with Force resistance can resist a power: d20 + caster level against it", () => {
    const caster = creature({ getTotalClassLevel: () => 5 });
    const target = creature({ getTotalClassLevel: () => 20 });
    // No resistance: never resists, whatever the levels
    for (let i = 0; i < 50; i++) expect(ModuleObject.prototype.resistForce.call(target, caster)).toBe(0);

    target.effects.push(effect(GameEffectType.EffectForceResistanceIncrease, 30));
    expect(target.getForceResistance()).toBe(30);
    // d20 + 5 can't reach 30
    expect(ModuleObject.prototype.resistForce.call(target, caster)).toBe(1);
    // A power on yourself is never resisted
    expect(ModuleObject.prototype.resistForce.call(target, target)).toBe(0);
  });

  test("concealment and miss chance: the best concealment on the target, the worst miss chance on the attacker", () => {
    const cre = creature();
    cre.effects.push(effect(GameEffectType.EffectConcealment, 20), effect(GameEffectType.EffectConcealment, 50), effect(GameEffectType.EffectMissChance, 30));
    expect(cre.getConcealment()).toBe(50);
    expect(cre.getMissChance()).toBe(30);
  });

  test("immunities: from an Immunity effect, or a hide's item property in iprp_immunity's numbering", () => {
    const droid = creature();
    const mindImmunity = { is: (k: number) => k === ModuleItemProperty.Immunity, isUseable: () => true, subType: 2 };
    droid.equipment.HIDE = { properties: [mindImmunity] };
    // Mind immunity (iprp 2) covers stun (IMMUNITY_TYPE_STUN 12) and fear (4), not poison (2)
    expect(droid.isImmune(12)).toBe(true);
    expect(droid.isImmune(4)).toBe(true);
    expect(droid.isImmune(2)).toBe(false);

    const jedi = creature();
    jedi.effects.push(effect(GameEffectType.EffectImmunity, 2));
    expect(jedi.isImmune(2)).toBe(true);
  });

  test("an effect the creature is immune to doesn't take hold", () => {
    const droid = creature();
    droid.equipment.HIDE = { properties: [{ is: (k: number) => k === ModuleItemProperty.Immunity, isUseable: () => true, subType: 2 }] };
    expect(droid.isImmuneToEffect(effect(GameEffectType.EffectSetState, 4))).toBe(true); // stunned
    expect(droid.isImmuneToEffect(effect(GameEffectType.EffectSetState, 3))).toBe(false); // droid stun is meant for droids
    expect(droid.isImmuneToEffect(effect(GameEffectType.EffectDamage, 10))).toBe(false);
  });

  test("blaster deflection bonus from effects", () => {
    const cre = creature();
    cre.effects.push(effect(GameEffectType.EffectBlasterDeflectionIncrease, 4), effect(GameEffectType.EffectBlasterDeflectionDecrease, 1));
    expect(cre.getBlasterDeflectionBonus()).toBe(3);
  });
});

describe("skills", () => {
  const skillProperty = (kind: ModuleItemProperty, skill: number, amount: number) =>
    ({ is: (k: number) => k === kind, isUseable: () => true, subType: skill, getValue: () => amount });

  test("skill bonuses on worn items count toward the total (a stealth unit's +Stealth)", () => {
    const cre = creature({ dex: 10, skills: [, , { rank: 2, keyAbility: "DEX" }] });
    cre.equipment.BELT = { getAbilityBonus: () => 0, properties: [skillProperty(ModuleItemProperty.Skill, 2, 4), skillProperty(ModuleItemProperty.DecreasedSkill, 2, 1)] };
    expect(cre.getSkillLevel(2)).toBe(5);
  });

  test("stealth needs a stealth unit in the belt slot", () => {
    const cre = creature({ isDead: () => false, setOpacity: jest.fn() });
    expect(cre.setStealthMode(true)).toBe(false);
    cre.equipment.BELT = { baseItemId: 88 };
    expect(cre.setStealthMode(true)).toBe(true);
    expect(cre.stealthMode).toBe(true);
    expect(cre.setOpacity).toHaveBeenCalledWith(0.35);
  });

  test("a hostile in stealth is only noticed on a won Awareness check, which holds for a while", () => {
    const sneak = creature({ stealthMode: true, skills: [, , { rank: 40, keyAbility: "DEX" }] });
    const guard = creature({ skills: [, , , { rank: 0, keyAbility: "WIS" }], isHostile: () => true, stealthChecks: new Map() });
    const ally = creature({ isHostile: () => false, stealthChecks: new Map() });
    // Stealth 40 against Awareness 0: never noticed
    for (let i = 0; i < 20; i++) {
      guard.stealthChecks.clear();
      expect(guard.canDetect(sneak)).toBe(false);
    }
    // Friends always see each other; out of stealth, everyone does
    expect(ally.canDetect(sneak)).toBe(true);
    sneak.stealthMode = false;
    expect(guard.canDetect(sneak)).toBe(true);
  });
});

describe("usable items", () => {
  test("a Cast Spell property's subtype is the spells.2da row it casts (iprp_spells is a Neverwinter Nights leftover)", () => {
    (GameState as any).TwoDAManager = { datatables: new Map([["spells", { rows: { 64: { label: "ITEM_ABILITY_MED_PACK" }, 87: { label: "ITEM_ABILITY_GRENADE_FRAGMENTATION" } } }]]) };
    expect(ModuleItem.GetCastSpellId({ subType: 64 } as any)).toBe(64);
    expect(ModuleItem.GetCastSpellId({ subType: 87 } as any)).toBe(87);
    expect(ModuleItem.GetCastSpellId({ subType: 999 } as any)).toBe(-1);
  });
});

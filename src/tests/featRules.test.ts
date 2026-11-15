import { describe, expect, jest, test, afterEach } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: { gmMode: false } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import { ModuleCreature } from "@/module/ModuleCreature";
import { ModuleObject } from "@/module/ModuleObject";
import { CombatRound } from "@/combat/CombatRound";
import { CombatFeatType } from "@/enums/combat/CombatFeatType";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { SkillType } from "@/enums/nwscript/SkillType";
import { CharacterBuilder } from "@/engine/rules/CharacterBuilder";
import { GameState } from "@/GameState";

/** A creature stand-in using ModuleCreature's own rules, with these feats */
function creature(feats: number[] = [], fields: Record<string, any> = {}): any {
  const cre = Object.create(ModuleCreature.prototype);
  Object.assign(cre, {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    equipment: {}, effects: [], skills: [], classes: [],
    getHasFeat: (id: number) => feats.includes(id),
    getRace: () => 6,
    ...fields,
  });
  return cre;
}

afterEach(() => jest.restoreAllMocks());

describe("passive feats", () => {
  test("defense feats: the best of each chain counts (Scoundrel's Luck, Jedi Sense, droid logic upgrades)", () => {
    expect(creature([CombatFeatType.SCOUNDRELS_LUCK]).getFeatDefenseBonus()).toBe(2);
    expect(creature([CombatFeatType.SCOUNDRELS_LUCK, CombatFeatType.IMPROVED_SCOUNDRELS_LUCK]).getFeatDefenseBonus()).toBe(4);
    expect(creature([CombatFeatType.JEDI_SENSE, CombatFeatType.KNIGHT_SENSE, CombatFeatType.MASTER_SENSE]).getFeatDefenseBonus()).toBe(6);
    expect(creature([CombatFeatType.LOGIC_UPGRADE_TACTICIAN]).getFeatDefenseBonus()).toBe(4);
  });

  test("skill feats: Caution, Empathy and Gear Head add +1 / +2 / +3 to their skills", () => {
    const cre = creature([CombatFeatType.GEAR_HEAD, CombatFeatType.GEAR_HEAD_ADEPT, CombatFeatType.CAUTIOUS]);
    expect(cre.getSkillFeatBonus(SkillType.SECURITY)).toBe(2);
    expect(cre.getSkillFeatBonus(SkillType.STEALTH)).toBe(1);
    expect(cre.getSkillFeatBonus(SkillType.PERSUADE)).toBe(0);
  });

  test("Force Immunity: Fear, then Stun as well, then Paralysis as well", () => {
    expect(creature([CombatFeatType.FORCE_IMMUNITY_FEAR]).isImmune(4)).toBe(true);
    expect(creature([CombatFeatType.FORCE_IMMUNITY_FEAR]).isImmune(12)).toBe(false);
    const sentinel = creature([CombatFeatType.FORCE_IMMUNITY_FEAR, CombatFeatType.FORCE_IMMUNITY_STUN, CombatFeatType.FORCE_IMMUNITY_PARALYSIS]);
    expect([4, 12, 6].every((t) => sentinel.isImmune(t))).toBe(true);
  });

  test("a save against something it's immune to returns 2 without rolling, as the script functions say", () => {
    const sentinel = creature([CombatFeatType.FORCE_IMMUNITY_FEAR], { getWIS: () => 10, getWillSave: () => -100 });
    // SAVING_THROW_TYPE_FEAR = 8
    expect(ModuleObject.prototype.willSave.call(sentinel, 99, 8)).toBe(2);
  });

  test("Uncanny Dodge helps saves against grenades only", () => {
    (GameState as any).TwoDAManager = { datatables: new Map([["spells", { rows: { 87: { impactscript: "k_sup_grenade" }, 35: { impactscript: "k_sp1_generic" } } }]]) };
    const scout = creature([CombatFeatType.UNCANNY_DODGE_1, CombatFeatType.UNCANNY_DODGE_2]);
    expect(scout.saveSituationalBonus(87)).toBe(4);
    expect(scout.saveSituationalBonus(35)).toBe(0);
  });

  test("items need every feat their base item requires, and droid or human only items stay with them", () => {
    const heavyArmour = { baseItem: { requiredFeat0: 4, requiredFeat1: 5, requiredFeat2: 6, requiredFeat3: -1, requiredFeat4: -1, droidOrHuman: 1 } };
    expect(creature([4, 5]).canUseItem(heavyArmour)).toBe(false);
    expect(creature([4, 5, 6]).canUseItem(heavyArmour)).toBe(true);
    // Droids can't wear armour suits
    expect(creature([4, 5, 6], { getRace: () => 5 }).canUseItem(heavyArmour)).toBe(false);
    const droidShield = { baseItem: { requiredFeat0: -1, droidOrHuman: 2 } };
    expect(creature([], { getRace: () => 5 }).canUseItem(droidShield)).toBe(true);
    expect(creature([]).canUseItem(droidShield)).toBe(false);
  });

  test("attacks add Strength in melee and Dexterity at range; base attack bonus is the classes' alone", () => {
    const cre = creature([], { str: 16, dex: 12, classes: [{ getBaseAttackBonus: () => 5 }] });
    expect(cre.getBaseAttackBonus()).toBe(5);
    expect(cre.getAttackAbilityModifier({ isRangedWeapon: () => false })).toBe(3);
    expect(cre.getAttackAbilityModifier({ isRangedWeapon: () => true })).toBe(1);
    expect(cre.getAttackAbilityModifier(undefined)).toBe(3);
  });
});

describe("Jedi Defense", () => {
  const saber = { baseItemId: 8, isRangedWeapon: () => false, getAbilityBonus: () => 0 };
  const blaster = { isRangedWeapon: () => true, getBaseDamage: () => 6, getDamageBonus: () => 0, getBaseDamageType: () => 0 };

  function jedi(feats: number[]) {
    return creature(feats, { equipment: { RIGHTHAND: saber }, hasEffect: () => false, combatRound: { deflectArrow: true }, classes: [{ getBaseAttackBonus: () => 0 }] });
  }

  test("no deflection without the feat (or a deflection item); with it, an opposed roll", () => {
    const round = Object.create(CombatRound.prototype);
    expect(round.checkBlasterDeflection(jedi([]), blaster, 1)).toBe(false);
    jest.spyOn(Math, "random").mockReturnValue(0.99); // d20 = 20
    expect(round.checkBlasterDeflection(jedi([CombatFeatType.JEDI_DEFENSE]), blaster, 15)).toBe(true);
  });

  test("beating the attack by 10 or more sends the bolt back at the shooter", () => {
    const shooter = creature([], { addEffect: jest.fn(), isDead: () => false });
    const round = Object.assign(Object.create(CombatRound.prototype), { owner: shooter });
    const effect = { setCreator: jest.fn(), setSpellId: jest.fn(), setInt: jest.fn(), initialize: jest.fn() };
    (GameState as any).GameEffectFactory = { EffectDamage: jest.fn(() => effect) };
    jest.spyOn(Math, "random").mockReturnValue(0.99);
    expect(round.checkBlasterDeflection(jedi([CombatFeatType.JEDI_DEFENSE]), blaster, 5)).toBe(true);
    expect(shooter.addEffect).toHaveBeenCalledWith(effect);
  });
});

describe("Toughness and Force Sensitive", () => {
  test("Toughness adds 1 vitality per level, Master Toughness another, Force Sensitive 40 Force points", () => {
    jest.spyOn(CharacterBuilder, "classRow").mockReturnValue({ hitdie: 8, forcedie: 4 } as any);
    jest.spyOn(CharacterBuilder, "buildPowers").mockReturnValue([]);
    jest.spyOn(CharacterBuilder, "buildSkills").mockReturnValue([]);
    const attributes = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    jest.spyOn(CharacterBuilder, "buildFeats").mockReturnValue([]);
    const plain = CharacterBuilder.build({ classId: 3, level: 4, attributes });
    jest.spyOn(CharacterBuilder, "buildFeats").mockReturnValue([84, 124, 116]);
    const tough = CharacterBuilder.build({ classId: 3, level: 4, attributes });
    expect(tough.maxHp - plain.maxHp).toBe(8);
    expect(tough.maxFp - plain.maxFp).toBe(40);
  });
});

describe("Two-Weapon Fighting", () => {
  const round = Object.create(CombatRound.prototype);
  const fighter = (feats: number[], offHandSize: number) => creature(feats, {
    isSimpleCreature: () => false,
    equipment: { RIGHTHAND: { getBaseItem: () => ({ weaponSize: 3 }) }, LEFTHAND: { getBaseItem: () => ({ weaponSize: offHandSize }) } },
  });
  const penalties = (feats: number[], offHandSize = 3) => [round.calculateTwoWeaponPenalty(fighter(feats, offHandSize), 16), round.calculateTwoWeaponPenalty(fighter(feats, offHandSize), 32)];

  test("-6/-10, then -6/-6, -4/-4 and -2/-2 with the feats, as their descriptions give", () => {
    expect(penalties([])).toEqual([6, 10]);
    expect(penalties([CombatFeatType.TWO_WEAPON_FIGHTING])).toEqual([6, 6]);
    expect(penalties([CombatFeatType.TWO_WEAPON_FIGHTING, CombatFeatType.TWO_WEAPON_ADVANCED])).toEqual([4, 4]);
    expect(penalties([CombatFeatType.TWO_WEAPON_MASTERY])).toEqual([2, 2]);
  });

  test("a balanced (small) off-hand weapon lowers only the main hand's penalty, by 2", () => {
    // WeaponSize.SMALL = 2
    expect(penalties([CombatFeatType.TWO_WEAPON_FIGHTING], 2)).toEqual([4, 6]);
    expect(penalties([CombatFeatType.TWO_WEAPON_MASTERY], 2)).toEqual([0, 2]);
  });
});

import { afterEach, describe, expect, jest, test } from "@jest/globals";

// The real GameState pulls in the whole browser engine (WebGL, window, File System Access);
// these tests only need it as a bag for the few managers they stub per-test.
jest.mock("@/GameState", () => ({ GameState: {} }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));

import { CombatAttackData } from "@/combat/CombatAttackData";
import { CombatRound } from "@/combat/CombatRound";
import { CombatRoundAction } from "@/combat/CombatRoundAction";
import { SpellCastInstance } from "@/combat/SpellCastInstance";
import { EffectDamage } from "@/effects/EffectDamage";
import { EffectDamageImmunityDecrease } from "@/effects/EffectDamageImmunityDecrease";
import { EffectDamageImmunityIncrease } from "@/effects/EffectDamageImmunityIncrease";
import { EffectDamageReduction } from "@/effects/EffectDamageReduction";
import { EffectDamageResistance } from "@/effects/EffectDamageResistance";
import { EffectSetState } from "@/effects/EffectSetState";
import { AttackResult } from "@/enums/combat/AttackResult";
import { CombatActionType } from "@/enums/combat/CombatActionType";
import { CombatFeatType } from "@/enums/combat/CombatFeatType";
import { DamageType } from "@/enums/combat/DamageType";
import { WeaponSize } from "@/enums/combat/WeaponSize";
import { WeaponType } from "@/enums/combat/WeaponType";
import { WeaponWield } from "@/enums/combat/WeaponWield";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
import { GameEffectSetStateType } from "@/enums/effects/GameEffectSetStateType";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { GameState } from "@/GameState";
import { TalentFeat } from "@/talents/TalentFeat";
import { TalentSpell } from "@/talents/TalentSpell";
import { Dice } from "@/utility/Dice";
import * as THREE from "three";

function createMockCreature(overrides: Record<string, any> = {}): any {
  const feats = new Set<number>(overrides.feats || []);
  const effects: any[] = overrides.effects ? [...overrides.effects] : [];
  let hp = overrides.hp ?? 100;
  let fp = overrides.fp ?? 50;

  const creature: any = {
    id: overrides.id ?? 1,
    tag: overrides.tag ?? "mock_creature",
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    position: overrides.position ?? new THREE.Vector3(0, 0, 0),
    rotation: new THREE.Vector3(0, 0, 0),
    effects,
    equipment: overrides.equipment ?? {},
    combatData: {
      lastAttacker: undefined,
      lastDamager: undefined,
      lastAttackTarget: undefined,
      lastSpellTarget: undefined,
      lastSpellAttacker: undefined,
      lastAttemptedSpellTarget: undefined,
      lastForcePowerUsed: undefined,
      lastCombatFeatUsed: undefined,
      lastAttackResult: AttackResult.MISS,
      lastAttackAction: -1,
    },
    animationState: {
      index: 0,
    },
    model: undefined,
    getName: () => overrides.name ?? "MockCreature",
    isSimpleCreature: () => Boolean(overrides.isSimple),
    getSTR: () => overrides.str ?? 14,
    getDEX: () => overrides.dex ?? 14,
    getCON: () => overrides.con ?? 14,
    getINT: () => overrides.int ?? 14,
    getWIS: () => overrides.wis ?? 14,
    getCHA: () => overrides.cha ?? 14,
    getGoodEvil: () => overrides.goodEvil ?? 50,
    getTotalClassLevel: () => overrides.level ?? 8,
    getBaseAttackBonus: () => overrides.bab ?? 6,
    getAC: () => overrides.ac ?? 15,
    getHP: () => hp,
    subtractHP: (amount: number) => {
      hp -= amount;
    },
    getFP: () => fp,
    subtractFP: (amount: number) => {
      fp = Math.max(0, fp - amount);
    },
    damage: jest.fn((amount: number, attacker?: any) => {
      hp -= amount;
      creature.combatData.lastDamager = attacker;
      creature.combatData.lastAttacker = attacker;
    }),
    getHasFeat: (featId: number) => feats.has(featId),
    hasEffect: (type: number) => creature.effects.some((e: any) => e && e.type === type),
    getEffect: (type: number) => creature.effects.find((e: any) => e && e.type === type),
    addEffect: (eff: any, durationType?: number, duration?: number) => {
      if (typeof durationType === "number") eff.setDurationType(durationType);
      if (typeof duration === "number") eff.setDuration(duration);
      eff.setAttachedObject(creature);
      eff.onApply(creature);
      creature.effects.push(eff);
    },
    removeEffect: (targetEff: any) => {
      const idx = creature.effects.indexOf(targetEff);
      if (idx >= 0) creature.effects.splice(idx, 1);
    },
    removeEffectsByType: (type: number) => {
      for (let i = creature.effects.length - 1; i >= 0; i--) {
        if (creature.effects[i]?.type === type) creature.effects.splice(i, 1);
      }
    },
    isDebilitated: () =>
      creature.effects.some(
        (e: any) => e?.type === GameEffectType.EffectSetState && e.getInt(0) >= 1 && e.getInt(0) <= 10
      ),
    isStunned: () =>
      creature.effects.some(
        (e: any) => e?.type === GameEffectType.EffectSetState && (e.getInt(0) === 3 || e.getInt(0) === 4)
      ),
    isParalyzed: () =>
      creature.effects.some(
        (e: any) => e?.type === GameEffectType.EffectSetState && e.getInt(0) === 5
      ),
    fortitudeSave: jest.fn(() => overrides.fortSaveResult ?? 0),
    reflexSave: jest.fn(() => overrides.reflexSaveResult ?? 0),
    willSave: jest.fn(() => overrides.willSaveResult ?? 0),
    weaponPowered: jest.fn(),
    onAttacked: jest.fn(),
    onCombatRoundEnd: jest.fn(),
    playTwoDAAnimation: jest.fn(),
    getDamageAnimation: jest.fn(),
    getDodgeAnimation: jest.fn(),
    getParryAnimation: jest.fn(),
    getCombatAnimationAttackType: () => "m",
    getCombatAnimationWeaponType: () => 2,
    isDuelingObject: () => false,
    getFacing: () => 0,
    resetExcitedDuration: jest.fn(),
  };

  creature.combatRound = new CombatRound(creature);
  return creature;
}

function createMockWeapon(overrides: Record<string, any> = {}): any {
  const baseItem = {
    criticalHitMultiplier: overrides.critMult ?? 2,
    criticalThreat: overrides.critThreat ?? 1,
    weaponWield: overrides.weaponWield ?? WeaponWield.ONE_HANDED_SWORD,
    weaponType: overrides.weaponType ?? WeaponType.PIERCING,
    weaponSize: overrides.weaponSize ?? WeaponSize.MEDIUM,
    rangedWeapon: Boolean(overrides.ranged),
  };
  return {
    baseItemId: overrides.baseItemId ?? 1,
    baseItem,
    possessor: overrides.possessor,
    getName: () => overrides.name ?? "MockWeapon",
    getBaseItem: () => baseItem,
    getWeaponWield: () => baseItem.weaponWield,
    getWeaponType: () => baseItem.weaponType,
    isRangedWeapon: () => baseItem.rangedWeapon,
    getBaseDamageType: () => overrides.baseDamageType ?? DamageType.SLASHING,
    getBaseDamage: () => overrides.baseDamage ?? 8,
    hasDamageBonus: () => Boolean(overrides.damageBonus),
    getDamageBonusType: () => overrides.damageBonusType ?? DamageType.ENERGY,
    getDamageBonus: () => overrides.damageBonus ?? 0,
    getAttackBonus: () => overrides.attackBonus ?? 0,
    getCriticalThreatRangeMin: () => 20 - baseItem.criticalThreat,
  };
}

describe("Combat, Feats, and Force Powers", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("EffectDamage & Damage Mitigation", () => {
    test("sums multi-type damage across indices 0..15", () => {
      const target = createMockCreature({ hp: 100 });
      const attacker = createMockCreature();
      const dmg = new EffectDamage();
      dmg.setCreator(attacker);
      dmg.setInt(DamageType.SLASHING, 12);
      dmg.setInt(DamageType.ENERGY, 8);
      dmg.setInt(DamageType.ION, 5);

      expect(dmg.getDamageAmount()).toBe(25);
      target.addEffect(dmg, GameEffectDurationType.INSTANT);
      expect(target.getHP()).toBe(75);
    });

    test("applies EffectDamageImmunityIncrease and EffectDamageImmunityDecrease percentages", () => {
      const inc = new EffectDamageImmunityIncrease();
      inc.setInt(0, 1 << DamageType.ENERGY);
      inc.setInt(1, 50); // 50% immunity to Energy

      const dec = new EffectDamageImmunityDecrease();
      dec.setInt(0, 1 << DamageType.COLD);
      dec.setInt(1, 50); // +50% vulnerability to Cold

      const target = createMockCreature({ hp: 100, effects: [inc, dec] });
      const dmg = new EffectDamage();
      dmg.setInt(DamageType.ENERGY, 20); // -> 10
      dmg.setInt(DamageType.COLD, 10); // -> 15

      target.addEffect(dmg, GameEffectDurationType.INSTANT);
      expect(target.getHP()).toBe(75);
    });

    test("absorbs damage via EffectDamageResistance (Force/Energy Shield) and depletes shield pool", () => {
      const shield = new EffectDamageResistance();
      shield.setInt(0, 1 << DamageType.ENERGY);
      shield.setInt(1, 20); // max per hit
      shield.setInt(2, 15); // remaining pool of 15

      const target = createMockCreature({ hp: 100, effects: [shield] });

      const dmg = new EffectDamage();
      dmg.setInt(DamageType.ENERGY, 25); // 15 absorbed, 10 passes through

      target.addEffect(dmg, GameEffectDurationType.INSTANT);
      expect(target.getHP()).toBe(90);
      expect(target.hasEffect(GameEffectType.EffectDamageResistance)).toBe(false);
    });

    test("reduces physical damage via EffectDamageReduction and Improved Toughness", () => {
      const dr = new EffectDamageReduction();
      dr.setInt(0, 5); // 5 DR
      dr.setInt(2, 0); // unlimited pool

      const target = createMockCreature({
        hp: 100,
        feats: [CombatFeatType.IMPROVED_TOUGHNESS],
        effects: [dr],
      });

      const dmg = new EffectDamage();
      dmg.setInt(DamageType.BLUDGEONING, 12); // 12 - 5 (DR) - 2 (Improved Toughness) = 5

      target.addEffect(dmg, GameEffectDurationType.INSTANT);
      expect(target.getHP()).toBe(95);
    });
  });

  describe("TalentFeat Penalties & Impact", () => {
    test("returns accurate AC and Attack penalties for Flurry, Rapid Shot, Power Attack, Power Blast, and Critical Strike", () => {
      expect(new TalentFeat(CombatFeatType.FLURRY).getArmorClassPenalty()).toBe(4);
      expect(new TalentFeat(CombatFeatType.FLURRY).getAttackPenalty()).toBe(4);

      expect(new TalentFeat(CombatFeatType.IMPROVED_FLURRY).getArmorClassPenalty()).toBe(2);
      expect(new TalentFeat(CombatFeatType.IMPROVED_FLURRY).getAttackPenalty()).toBe(2);

      expect(new TalentFeat(CombatFeatType.MASTER_FLURRY).getArmorClassPenalty()).toBe(1);
      expect(new TalentFeat(CombatFeatType.MASTER_FLURRY).getAttackPenalty()).toBe(1);

      expect(new TalentFeat(CombatFeatType.MASTER_RAPID_SHOT).getArmorClassPenalty()).toBe(1);
      expect(new TalentFeat(CombatFeatType.MASTER_RAPID_SHOT).getAttackPenalty()).toBe(1);

      expect(new TalentFeat(CombatFeatType.POWER_ATTACK).getAttackPenalty()).toBe(3);
      expect(new TalentFeat(CombatFeatType.IMPROVED_POWER_ATTACK).getAttackPenalty()).toBe(3);
      expect(new TalentFeat(CombatFeatType.MASTER_POWER_ATTACK).getAttackPenalty()).toBe(3);
      expect(new TalentFeat(CombatFeatType.MASTER_POWER_BLAST).getAttackPenalty()).toBe(3);

      expect(new TalentFeat(CombatFeatType.CRITICAL_STRIKE).getArmorClassPenalty()).toBe(5);
      expect(new TalentFeat(CombatFeatType.IMPROVED_CRITICAL_STRIKE).getArmorClassPenalty()).toBe(5);
      expect(new TalentFeat(CombatFeatType.MASTER_CRITICAL_STRIKE).getArmorClassPenalty()).toBe(5);
    });

    test("impactCaster applies temporary AC and Attack decrease effects to caster", () => {
      const caster = createMockCreature();
      const flurry = new TalentFeat(CombatFeatType.FLURRY);
      flurry.impactCaster(caster);

      expect(caster.hasEffect(GameEffectType.EffectACDecrease)).toBe(true);
      expect(caster.hasEffect(GameEffectType.EffectAttackDecrease)).toBe(true);
      expect(caster.getEffect(GameEffectType.EffectAttackDecrease).getInt(0)).toBe(4);
    });
  });

  describe("CombatAttackData Damage Calculations", () => {
    test("applies Power Attack bonus damage ONLY when Power Attack feat is actively used", () => {
      const attacker = createMockCreature({
        str: 10,
        feats: [CombatFeatType.MASTER_POWER_ATTACK, CombatFeatType.WEAPON_SPEC_MELEE_WEAPONS],
      });
      const target = createMockCreature({ hp: 100 });
      const weapon = createMockWeapon({ baseDamage: 6 });

      // Basic attack (no active feat) -> 6 base + 2 weapon spec = 8 (no +10 Power Attack)
      const normalAttack = new CombatAttackData();
      normalAttack.attackWeapon = weapon;
      normalAttack.reactObject = target;
      normalAttack.calculateDamage(attacker, false, undefined);
      expect(normalAttack.getTotalDamage()).toBe(8);

      // Active Master Power Attack -> 6 base + 2 weapon spec + 10 Master Power Attack = 18
      const powerAttack = new CombatAttackData();
      powerAttack.attackWeapon = weapon;
      powerAttack.reactObject = target;
      powerAttack.calculateDamage(attacker, false, new TalentFeat(CombatFeatType.MASTER_POWER_ATTACK));
      expect(powerAttack.getTotalDamage()).toBe(18);
    });

    test("scales melee Strength bonus for main hand (1.0x), off-hand (0.5x), and two-handed (1.5x)", () => {
      const attacker = createMockCreature({ str: 18 }); // +4 STR mod
      const target = createMockCreature({ hp: 100 });

      const oneHandSword = createMockWeapon({
        baseDamage: 5,
        weaponWield: WeaponWield.ONE_HANDED_SWORD,
      });

      const mainAtk = new CombatAttackData();
      mainAtk.attackWeapon = oneHandSword;
      mainAtk.reactObject = target;
      mainAtk.calculateDamage(attacker, false, undefined, false);
      expect(mainAtk.getTotalDamage()).toBe(9); // 5 + 4

      const offAtk = new CombatAttackData();
      offAtk.attackWeapon = oneHandSword;
      offAtk.reactObject = target;
      offAtk.calculateDamage(attacker, false, undefined, true);
      expect(offAtk.getTotalDamage()).toBe(7); // 5 + 2 (0.5x STR)

      const twoHandSword = createMockWeapon({
        baseItemId: 5,
        baseDamage: 5,
        weaponWield: WeaponWield.TWO_HANDED_SWORD,
      });
      const twoHandAtk = new CombatAttackData();
      twoHandAtk.attackWeapon = twoHandSword;
      twoHandAtk.reactObject = target;
      twoHandAtk.calculateDamage(attacker, false, undefined, false);
      expect(twoHandAtk.getTotalDamage()).toBe(11); // 5 + 6 (1.5x STR)
    });

    test("applies Sneak Attack damage against stunned/debilitated targets and stuns on Critical Strike crit", () => {
      jest.spyOn(Dice, "roll").mockReturnValue(4);

      const stunState = new EffectSetState();
      stunState.setInt(0, GameEffectSetStateType.CUT_SCENE_STUNNED);
      const target = createMockCreature({ hp: 100, effects: [stunState], fortSaveResult: 0 });
      const attacker = createMockCreature({
        str: 14, // +2 STR
        feats: [CombatFeatType.SNEAK_ATTACK_3D6],
      });
      const weapon = createMockWeapon({ baseDamage: 6, critMult: 2 });

      const critFeat = new TalentFeat(CombatFeatType.CRITICAL_STRIKE);
      const attack = new CombatAttackData();
      attack.attackWeapon = weapon;
      attack.reactObject = target;
      attack.calculateDamage(attacker, true, critFeat, false);

      // (6 base + 2 STR) * 2 crit + 4 sneak attack = 20
      expect(attack.sneakAttack).toBe(true);
      expect(attack.getTotalDamage()).toBe(20);
      expect(target.fortitudeSave).toHaveBeenCalled();
      expect(target.effects.length).toBe(2); // original stun + newly applied crit stun
    });
  });

  describe("CombatRound Mechanics", () => {
    test("multiplies critical threat range for Critical Strike and Sniper Shot", () => {
      const owner = createMockCreature();
      const round = owner.combatRound as CombatRound;
      // 19-20 base threat range (criticalThreat = 2)
      const keenSword = createMockWeapon({ critThreat: 2 });

      expect(round.isCritical(19, keenSword)).toBe(true);
      expect(round.isCritical(18, keenSword)).toBe(false);

      // Critical Strike (x2 -> 17-20)
      expect(round.isCritical(17, keenSword, new TalentFeat(CombatFeatType.CRITICAL_STRIKE))).toBe(true);
      expect(round.isCritical(16, keenSword, new TalentFeat(CombatFeatType.CRITICAL_STRIKE))).toBe(false);

      // Improved Critical Strike (x3 -> 15-20)
      expect(round.isCritical(15, keenSword, new TalentFeat(CombatFeatType.IMPROVED_CRITICAL_STRIKE))).toBe(true);

      // Master Critical Strike (x4 -> 13-20)
      expect(round.isCritical(13, keenSword, new TalentFeat(CombatFeatType.MASTER_CRITICAL_STRIKE))).toBe(true);
      expect(round.isCritical(12, keenSword, new TalentFeat(CombatFeatType.MASTER_CRITICAL_STRIKE))).toBe(false);
    });

    test("calculates Dueling bonus, Weapon Focus bonus, and Two-Weapon Fighting penalties", () => {
      const sword = createMockWeapon({
        baseItemId: 8, // Lightsaber
        weaponWield: WeaponWield.ONE_HANDED_SWORD,
      });
      const duelist = createMockCreature({
        bab: 5,
        feats: [CombatFeatType.MASTER_DUELING, CombatFeatType.WEAPON_FOCUS_LIGHTSABER],
        equipment: { RIGHTHAND: sword },
      });

      // 5 BAB + 1 Weapon Focus + 3 Master Dueling = 9
      expect(duelist.combatRound.calculateAttackBonus(duelist, sword)).toBe(9);

      // Dual-wielding with a balanced/small off-hand weapon and Improved Two-Weapon Fighting
      const shortSword = createMockWeapon({
        weaponWield: WeaponWield.ONE_HANDED_SWORD,
        weaponSize: WeaponSize.SMALL,
      });
      const dualWielder = createMockCreature({
        feats: [CombatFeatType.TWO_WEAPON_ADVANCED],
        equipment: { RIGHTHAND: sword, LEFTHAND: shortSword },
      });
      expect(dualWielder.combatRound.isDualWielding(dualWielder)).toBe(true);
      expect(
        dualWielder.combatRound.calculateTwoWeaponPenalty(dualWielder, ModuleCreatureArmorSlot.RIGHTHAND)
      ).toBe(2); // 4 - 2 (small off-hand) = 2
      expect(
        dualWielder.combatRound.calculateTwoWeaponPenalty(dualWielder, ModuleCreatureArmorSlot.LEFTHAND)
      ).toBe(2); // 4 - 2 (small off-hand) = 2
    });

    test("deflects incoming blaster attacks when target has Lightsaber and Jedi Defense", () => {
      // Fixed d20 face of 15, but keep Dice.roll's modifier so the deflect bonus (BAB + Jedi Defense) applies
      jest.spyOn(Dice, "roll").mockImplementation((_num: number, _die: any, modifier: number = 0) => 15 + modifier);

      const blaster = createMockWeapon({
        weaponWield: WeaponWield.BLASTER_PISTOL,
        ranged: true,
      });
      const lightsaber = createMockWeapon({
        baseItemId: 8,
        weaponWield: WeaponWield.ONE_HANDED_SWORD,
      });

      const shooter = createMockCreature({
        bab: 2,
        equipment: { RIGHTHAND: blaster },
      });
      const jedi = createMockCreature({
        bab: 8,
        ac: 12,
        feats: [CombatFeatType.MASTER_JEDI_DEFENSE],
        equipment: { RIGHTHAND: lightsaber },
      });

      const action = new CombatRoundAction();
      action.actionType = CombatActionType.ATTACK;
      action.target = jedi;
      shooter.combatRound.action = action;

      shooter.combatRound.calculateWeaponAttack(
        shooter,
        blaster,
        ModuleCreatureArmorSlot.RIGHTHAND,
        action
      );

      expect(action.attackResult).toBe(AttackResult.DEFLECTED);
      expect(shooter.combatRound.attackList[0].attackResult).toBe(AttackResult.DEFLECTED);
    });
  });

  describe("TalentSpell & SpellCastInstance Force Powers", () => {
    test("calculates Force Point cost adjusted by Charisma and Light/Dark alignment", () => {
      const healPower = new TalentSpell(0);
      healPower.forcepoints = 20;
      healPower.userType = 1;
      healPower.goodEvil = "G";

      const lightJedi = createMockCreature({ cha: 16, goodEvil: 100 }); // +3 CHA, 100 Light (-50%)
      // 20 * 0.5 - 3 = 7
      expect(healPower.getForcePointCost(lightJedi)).toBe(7);

      const darkSith = createMockCreature({ cha: 10, goodEvil: 0 }); // +0 CHA, 0 Dark (+50%)
      // 20 * 1.5 - 0 = 30
      expect(healPower.getForcePointCost(darkSith)).toBe(30);
    });

    test("SpellCastInstance deducts Force Points, updates combatData, and runs impactscript", () => {
      const mockScriptInstance: any = {
        talent: undefined,
        spellTarget: undefined,
        spellItem: undefined,
        lastSpellCaster: undefined,
        lastSpellAttacker: undefined,
        lastSpell: -1,
        lastSpellHarmful: false,
        run: jest.fn(),
      };
      GameState.NWScript = {
        Load: jest.fn(() => mockScriptInstance),
      } as any;

      const spell = new TalentSpell(15);
      spell.forcepoints = 10;
      spell.userType = 1;
      spell.goodEvil = "-";
      spell.conjtime = "500";
      spell.casttime = 500;
      spell.impactscript = "k_sp1_generic";
      spell.hostilesetting = 1;

      const caster = createMockCreature({ fp: 40, cha: 10, goodEvil: 50 });
      const target = createMockCreature({ hp: 80 });

      const instance = new SpellCastInstance(caster, target, spell);
      instance.init();
      instance.update(0.6); // completes conjureTime (500ms)
      instance.update(0.2); // enters castTime and triggers impact()

      expect(instance.impacted).toBe(true);
      expect(caster.getFP()).toBe(30);
      expect(caster.combatData.lastSpellTarget).toBe(target);
      expect(target.combatData.lastSpellAttacker).toBe(caster);
      expect(GameState.NWScript.Load).toHaveBeenCalledWith("k_sp1_generic");
      expect(mockScriptInstance.run).toHaveBeenCalledWith(caster, 0);
    });
  });
});

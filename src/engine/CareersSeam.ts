import type { GameEffect } from "@/effects/GameEffect";
import type { ModuleItem } from "@/module/ModuleItem";
import type { ModuleObject } from "@/module/ModuleObject";

/** What the engine tells the Careers rules about an attack whose damage is being worked out */
export interface ICareersDamageContext {
  weapon?: ModuleItem;
  isCritical?: boolean;
  isOffHand?: boolean;
}

/**
 * The engine's view of the Careers rules on a creature (`ModuleObject.careersRules`): only what combat, saves,
 * skills, casting and movement ask. ModuleCreature's seam methods ask it and fall back to KotOR's own rules when
 * it's absent (enemies, classic characters, campaign creatures). The GM side (Strain HUD, active talents, the
 * host's clock) works with the full CareersRuntime instead.
 */
export interface ICareersCreatureRules {
  // --- Stats replacing KotOR's class numbers
  /** Base attack bonus replacing class BAB: combat skill rank * 2 + level baseline */
  getAttackBase(weapon?: ModuleItem): number;
  /** Blaster deflection base replacing class BAB: Lightsaber skill rank * 2 + level baseline */
  getDeflectionBase(): number;
  /** Defence replacing KotOR's class AC bonus: level baseline + talent defence (passive and buffs) */
  getDefenseBonus(): number;
  /** Raw save base (rank * 2 + talent saves, without ability mod) replacing class save fields */
  getSaveBase(save: 'fortitude' | 'reflex' | 'will'): number;

  // --- Talent modifiers
  /** Extra defence against a ranged (or melee) attack */
  getDefenseBonusVs(isRanged: boolean): number;
  getTalentAttackBonus(weapon?: ModuleItem): number;
  /** Extra critical threat span (+1 widens 20 to 19-20) */
  getCritThreatBonus(weapon?: ModuleItem): number;
  getDamageBonus(ctx: ICareersDamageContext): number;
  /** Taken off each incoming hit */
  getDamageReduction(): number;
  /** Bonus on a KotOR skill check (skills.2da row) */
  getSkillCheckBonus(engineSkill: number): number;
  getSpellSaveDCBonus(): number;
  /** Force points taken off each power's cost */
  getSpellCostReduction(): number;

  // --- Force power trees (the power-cast hook)
  /** Save DC added to this power (spells.2da row) by its tree's upgrades */
  getPowerSaveDCBonus(spellId: number): number;
  /** More enemies near a single target that this power also hits */
  getPowerExtraTargets(spellId: number): number;
  /**
   * A Force power of this caster is applying one of its effects (NWScript ApplyEffectToObject): its tree's upgrades
   * change it in place (damage, push distance, Pull, Stun) and the duration it's applied for comes back.
   * `talent` is the power object cast, which says when it was cast as a variant
   */
  adjustPowerEffect(effect: GameEffect, target: ModuleObject, durationType: number, duration: number, talent?: unknown): number;

  // --- Paying for things
  /**
   * TalentFeat.impactCaster: pays a combat feat's Strain; true when KotOR's attack/AC penalties are skipped
   */
  payCombatFeatStrain(featId: number): boolean;
  /** SpellCastInstance: Force points to spend, pushing the missing ones with Strain when it can */
  payForceCost(fpCost: number, currentFp: number): { fpToSpend: number; ok: boolean };
  /** Movement speed multiplier (1 normally, < 1 while winded) */
  getSpeedMultiplier(): number;

  // --- Combat events
  onCombatRoundStart(): void;
  /** An attack was rolled (hit or miss): next-attack buffs are used up */
  onAttackResolved(): void;
  /** This creature's attack killed its target (after the damage landed) */
  onKill(): void;
}

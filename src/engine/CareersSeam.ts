import type { ModuleCreature } from "@/module/ModuleCreature";
import type { ModuleItem } from "@/module/ModuleItem";

/**
 * Runtime Strain snapshot for HUD / network replication.
 */
export interface ICareersStrainState {
  strain: number;
  maxStrain: number;
  /** Seconds remaining in the winded state (0 when not winded) */
  windedSeconds: number;
}

/**
 * Context passed to talent damage hooks during CombatAttackData.calculateDamage.
 */
export interface ICareersDamageContext {
  weapon?: ModuleItem;
  isCritical?: boolean;
  isRanged?: boolean;
  isOffHand?: boolean;
}

/**
 * Active talent metadata exposed to the player HUD / power wheel without importing careers internals.
 */
export interface ICareersActiveTalentInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  rank: number;
  strainCost: number;
  aim: 'self' | 'enemy' | 'ally';
  category: 'feat' | 'buff' | 'heal';
  cooldownRemaining: number;
  usable: boolean;
  why?: string;
}

/**
 * Result of attempting to activate a custom Careers talent.
 */
export interface ICareersTalentActivationResult {
  ok: boolean;
  reason?: string;
  message?: string;
}

/**
 * Single seam interface attached to spawned Careers creatures (`ModuleCreature.careersRules`).
 * Engine combat, defence, save, feat, skill, and Force-casting methods check this first (via
 * ModuleCreature seam methods) and fall back to classic KotOR behaviour whenever it is absent
 * (enemies, classic PCs, campaign creatures).
 */
export interface ICareersCreatureRules {
  /** Base attack bonus replacing class BAB: combat skill rank * 2 + level baseline */
  getAttackBase(weapon?: ModuleItem): number;
  /** Blaster deflection base replacing class BAB: Lightsaber skill rank * 2 + level baseline */
  getDeflectionBase(): number;
  /** Defence bonus replacing KotOR class AC bonus: level baseline + passive/active talent defence */
  getDefenseBonus(): number;
  /** Conditional defence bonus against melee or ranged attacks from talents */
  getDefenseBonusVs(isRanged: boolean): number;
  /** Raw save skill base (rank * 2 + passive talent saves, without ability mod) replacing class save fields */
  getSaveBase(save: 'fortitude' | 'reflex' | 'will'): number;

  /** Talent attack bonus (passive + active buffs) for a weapon */
  getTalentAttackBonus(weapon?: ModuleItem): number;
  /** Talent critical threat span bonus (passive + active buffs) for a weapon */
  getCritThreatBonus(weapon?: ModuleItem): number;
  /** Talent damage bonus (passive + crit + active buffs) for an attack */
  getDamageBonus(ctx: ICareersDamageContext): number;
  /** Flat damage reduction per incoming hit from passive + active talents */
  getDamageReduction(): number;
  /** Flat skill check bonus from talents for a KotOR SkillType (0..7) */
  getSkillCheckBonus(engineSkill: number): number;

  /** Force power cast modifiers from talents (and Phase 5 power upgrades) */
  getSpellSaveDCBonus(): number;
  getSpellCostReduction(): number;
  getSpellDamageBonus(): number;
  getSpellDurationBonus(): number;
  getSpellRangeBonus(): number;

  /** Strain cost for a KotOR combat feat (0 if the feat does not cost Strain) */
  getCombatFeatStrainCost(featId: number): number;
  /**
   * Called by TalentFeat.impactCaster instead of applying attack/AC penalties.
   * Pays the feat's Strain cost and returns true when penalties should be skipped.
   */
  payCombatFeatStrain(featId: number): boolean;
  /**
   * Called by SpellCastInstance before deducting FP. When FP is short, pays the missing FP in
   * Strain (2 Strain per missing FP) if not winded.
   */
  payForceCost(fpCost: number, currentFp: number): { fpToSpend: number; ok: boolean };
  /** Strain a push would cost (0 when the Force points cover it), or null when the power can't be pushed */
  strainToPush(fpCost: number, currentFp: number): number | null;
  /** Whether the creature is currently winded (unable to spend Strain and slowed) */
  isWinded(): boolean;
  /** Movement speed multiplier (1 normally, < 1 while winded) */
  getSpeedMultiplier(): number;
  /** Current Strain / winded state */
  getStrainState(): ICareersStrainState;

  /** Combat lifecycle triggers */
  onCombatRoundStart(): void;
  onAttackResolved(landed: boolean, isCritical: boolean, killedTarget: boolean): void;
  onTakeDamage(amount: number): void;

  /** Active talents for the player HUD / power wheel */
  getActiveTalents(): ICareersActiveTalentInfo[];
  /** Active talent buffs for HUD buff badges */
  getActiveBuffs(): { label: string; secondsLeft?: number }[];
  /** Execute an active talent on the host (validating ownership, winded, cooldown, Strain) */
  activateTalent(talentId: string, target?: ModuleCreature): ICareersTalentActivationResult;

  /** Advance Strain recovery, winded timers, active talent buffs, cooldowns, and combat transitions */
  tick(delta: number, inCombat: boolean): void;
}

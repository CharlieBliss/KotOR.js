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
 * Single seam interface attached to spawned Careers creatures (`ModuleCreature.careersRules`).
 * Engine combat, defence, save, feat, and Force-casting methods check this first and fall back
 * to classic KotOR behaviour whenever it is absent (enemies, classic PCs, campaign creatures).
 */
export interface ICareersCreatureRules {
  /** Base attack bonus replacing class BAB: combat skill rank * 2 + level baseline */
  getAttackBase(weapon?: ModuleItem): number;
  /** Blaster deflection base replacing class BAB: Lightsaber skill rank * 2 + level baseline */
  getDeflectionBase(): number;
  /** Defence bonus replacing KotOR class AC bonus: level baseline (+ future talent bonuses) */
  getDefenseBonus(): number;
  /** Raw save skill base (rank * 2, without ability mod) replacing class save fields */
  getSaveBase(save: 'fortitude' | 'reflex' | 'will'): number;
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
  /** Advance Strain recovery and winded timers (host world time in seconds) */
  tick(delta: number, inCombat: boolean): void;
}

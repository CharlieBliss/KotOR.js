import { CombatFeatType } from "@/enums/combat/CombatFeatType";
import { WeaponWield } from "@/enums/combat/WeaponWield";
import type { ICareersCreatureRules, ICareersStrainState } from "@/engine/CareersSeam";
import { CareersRules } from "@/managers/gm/careers/rules";
import type { CombatSkillId, GMCareersCharacter, GMCareersDerived } from "@/managers/gm/careers/types";
import type { ModuleItem } from "@/module/ModuleItem";

/** Strain cost for KotOR combat feats (tier 1 / improved / master), replacing attack/AC penalties */
export const COMBAT_FEAT_STRAIN_COST: Readonly<Record<number, number>> = {
  // Tier 1: 2 Strain
  [CombatFeatType.POWER_ATTACK]: 2,
  [CombatFeatType.FLURRY]: 2,
  [CombatFeatType.RAPID_SHOT]: 2,
  [CombatFeatType.SNIPER_SHOT]: 2,
  [CombatFeatType.CRITICAL_STRIKE]: 2,
  [CombatFeatType.POWER_BLAST]: 2,
  // Tier 2 (Improved): 3 Strain
  [CombatFeatType.IMPROVED_POWER_ATTACK]: 3,
  [CombatFeatType.IMPROVED_FLURRY]: 3,
  [CombatFeatType.IMPROVED_RAPID_SHOT]: 3,
  [CombatFeatType.IMPROVED_SNIPER_SHOT]: 3,
  [CombatFeatType.IMPROVED_CRITICAL_STRIKE]: 3,
  [CombatFeatType.IMPROVED_POWER_BLAST]: 3,
  // Tier 3 (Master): 4 Strain
  [CombatFeatType.MASTER_POWER_ATTACK]: 4,
  [CombatFeatType.MASTER_FLURRY]: 4,
  [CombatFeatType.MASTER_RAPID_SHOT]: 4,
  [CombatFeatType.MASTER_SNIPER_SHOT]: 4,
  [CombatFeatType.MASTER_CRITICAL_STRIKE]: 4,
  [CombatFeatType.MASTER_POWER_BLAST]: 4,
};

/** Map a KotOR weapon (or unarmed) to the Careers combat skill that drives its attack bonus */
export function combatSkillForWeapon(weapon?: ModuleItem): CombatSkillId {
  if (!weapon) return 'brawl';
  const baseId = weapon.baseItemId ?? weapon.getBaseItemId?.();
  if (baseId === 8 || baseId === 9 || baseId === 10) return 'lightsaber';
  const wield = weapon.getWeaponWield?.();
  switch (wield) {
    case WeaponWield.STUN_BATON:
      return 'brawl';
    case WeaponWield.ONE_HANDED_SWORD:
    case WeaponWield.TWO_HANDED_SWORD:
      return 'melee';
    case WeaponWield.BLASTER_PISTOL:
      return 'ranged_light';
    case WeaponWield.BLASTER_RIFLE:
      return 'ranged_heavy';
    case WeaponWield.BLASTER_HEAVY:
      return 'gunnery';
    default:
      return 'brawl';
  }
}

/**
 * Runtime Careers rules object attached to a spawned careers creature (`creature.careersRules`).
 * Drives attack bonus, lightsaber deflection, defence, saves, Strain & winded state,
 * combat feats paid in Strain, and Force-point pushing with Strain.
 */
export class CareersRuntime implements ICareersCreatureRules {
  static WINDED_SECONDS = 6; // 2 combat rounds
  static WINDED_SPEED_MULTIPLIER = 0.65;
  static ROUND_REFILL_INTERVAL = 3; // 1 combat round
  static ROUND_REFILL_AMOUNT = 1;
  static OUT_OF_COMBAT_REFILL_SECONDS = 4;
  static STRAIN_PER_MISSING_FP = 2;

  character: GMCareersCharacter;
  derived: GMCareersDerived;
  owner?: { updateMovementSpeed?: () => void };

  /** Accumulated Strain (0 .. maxStrain); exceeding maxStrain triggers winded */
  strain: number = 0;
  /** Seconds remaining in winded state (0 when not winded) */
  windedSeconds: number = 0;

  private roundTimer: number = 0;
  private quietTimer: number = 0;

  constructor(character: GMCareersCharacter, owner?: { updateMovementSpeed?: () => void }) {
    this.character = character;
    this.derived = CareersRules.derive(character);
    this.owner = owner;
  }

  /** Refresh derived numbers after live XP advancement or sheet sync (preserving current Strain) */
  refresh(character: GMCareersCharacter) {
    this.character = character;
    this.derived = CareersRules.derive(character);
    if (this.strain > this.derived.maxStrain) this.strain = this.derived.maxStrain;
  }

  /** Apply host-replicated Strain state on a client replica */
  syncStrain(state: ICareersStrainState) {
    const wasWinded = this.isWinded();
    this.strain = Math.max(0, Math.min(this.derived.maxStrain, Number(state.strain) || 0));
    this.windedSeconds = Math.max(0, Number(state.windedSeconds) || 0);
    if (wasWinded !== this.isWinded()) {
      this.owner?.updateMovementSpeed?.();
    }
  }

  get maxStrain(): number {
    return this.derived.maxStrain;
  }

  /** Base attack bonus replacing class BAB: combat skill rank * 2 + level baseline */
  getAttackBase(weapon?: ModuleItem): number {
    const skill = combatSkillForWeapon(weapon);
    const rank = this.derived.skillRanks[skill] || 0;
    return rank * 2 + this.derived.levelBaseline;
  }

  /** Blaster deflection base replacing class BAB: Lightsaber skill rank * 2 + level baseline */
  getDeflectionBase(): number {
    const rank = this.derived.skillRanks.lightsaber || 0;
    return rank * 2 + this.derived.levelBaseline;
  }

  /** Defence bonus replacing KotOR class AC bonus: level baseline (talents plug in at Phase 4) */
  getDefenseBonus(): number {
    return this.derived.levelBaseline;
  }

  /** Raw save skill base (rank * 2, without ability mod; saving throws & GM checks add ability mod) */
  getSaveBase(save: 'fortitude' | 'reflex' | 'will'): number {
    return this.derived.saveRanks[save];
  }

  getCombatFeatStrainCost(featId: number): number {
    return COMBAT_FEAT_STRAIN_COST[featId] || 0;
  }

  isWinded(): boolean {
    return this.windedSeconds > 0;
  }

  getSpeedMultiplier(): number {
    return this.isWinded() ? CareersRuntime.WINDED_SPEED_MULTIPLIER : 1;
  }

  getStrainState(): ICareersStrainState {
    return {
      strain: this.strain,
      maxStrain: this.derived.maxStrain,
      windedSeconds: this.windedSeconds,
    };
  }

  /**
   * Spend Strain. Cannot spend while already winded.
   * Exceeding maxStrain triggers winded (slowed, Strain abilities locked); when winded ends, Strain drops to half max.
   */
  spendStrain(amount: number): { ok: boolean; becameWinded: boolean } {
    const cost = Math.max(0, Math.ceil(amount));
    if (cost === 0) return { ok: true, becameWinded: false };
    if (this.isWinded()) return { ok: false, becameWinded: false };
    this.strain += cost;
    this.quietTimer = 0;
    if (this.strain > this.derived.maxStrain) {
      this.strain = this.derived.maxStrain;
      this.windedSeconds = CareersRuntime.WINDED_SECONDS;
      this.owner?.updateMovementSpeed?.();
      return { ok: true, becameWinded: true };
    }
    return { ok: true, becameWinded: false };
  }

  /**
   * Seam called by TalentFeat.impactCaster: pays Strain for KotOR combat feats and returns true
   * so KotOR's classic attack/AC penalties are skipped.
   */
  payCombatFeatStrain(featId: number): boolean {
    const cost = this.getCombatFeatStrainCost(featId);
    if (cost <= 0) return false;
    // Winded (a feat queued before it came on): no Strain to pay, so KotOR's own penalties apply instead
    if (!this.spendStrain(cost).ok) return false;
    return true;
  }

  /**
   * Seam called by SpellCastInstance: if FP is short, pays the missing FP in Strain (2 Strain / FP).
   * Fails if already winded and lacking FP.
   */
  payForceCost(fpCost: number, currentFp: number): { fpToSpend: number; ok: boolean } {
    if (fpCost <= 0) return { fpToSpend: 0, ok: true };
    if (currentFp >= fpCost) return { fpToSpend: fpCost, ok: true };
    const strainCost = this.strainToPush(fpCost, currentFp);
    if (strainCost === null) return { fpToSpend: 0, ok: false };
    const paid = this.spendStrain(strainCost);
    if (!paid.ok) return { fpToSpend: 0, ok: false };
    return { fpToSpend: Math.max(0, currentFp), ok: true };
  }

  /**
   * The Strain it takes to push a power the Force points don't cover (2 per missing point), or null when it can't
   * be pushed: while winded, or when it needs more than the Strain left plus one point's worth. Without that limit a
   * character with no Force points could cast any power, take the winded spell, and cast it again.
   */
  strainToPush(fpCost: number, currentFp: number): number | null {
    const missingFp = Math.ceil(fpCost - Math.max(0, currentFp));
    if (missingFp <= 0) return 0;
    if (this.isWinded()) return null;
    const strainCost = missingFp * CareersRuntime.STRAIN_PER_MISSING_FP;
    const room = Math.max(0, this.derived.maxStrain - this.strain);
    return strainCost > room + CareersRuntime.STRAIN_PER_MISSING_FP ? null : strainCost;
  }

  /** Advance Strain recovery and winded duration (world time in seconds) */
  tick(delta: number, inCombat: boolean) {
    if (!(delta > 0)) return;
    if (this.windedSeconds > 0) {
      this.windedSeconds = Math.max(0, this.windedSeconds - delta);
      if (this.windedSeconds === 0) {
        // Winded over: drop Strain back to a safe level
        this.strain = Math.min(this.strain, Math.floor(this.derived.maxStrain / 2));
        this.owner?.updateMovementSpeed?.();
      }
      return;
    }

    if (inCombat) {
      this.quietTimer = 0;
      if (this.strain > 0) {
        this.roundTimer += delta;
        while (this.roundTimer >= CareersRuntime.ROUND_REFILL_INTERVAL) {
          this.roundTimer -= CareersRuntime.ROUND_REFILL_INTERVAL;
          this.strain = Math.max(0, this.strain - CareersRuntime.ROUND_REFILL_AMOUNT);
        }
      } else {
        this.roundTimer = 0;
      }
    } else {
      this.roundTimer = 0;
      if (this.strain > 0) {
        this.quietTimer += delta;
        if (this.quietTimer >= CareersRuntime.OUT_OF_COMBAT_REFILL_SECONDS) {
          this.strain = 0;
          this.quietTimer = 0;
        }
      } else {
        this.quietTimer = 0;
      }
    }
  }
}

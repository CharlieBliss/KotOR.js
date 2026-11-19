import { CombatFeatType } from "@/enums/combat/CombatFeatType";
import { WeaponWield } from "@/enums/combat/WeaponWield";
import { SkillType } from "@/enums/nwscript/SkillType";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
import { EffectACIncrease } from "@/effects/EffectACIncrease";
import { EffectAttackIncrease } from "@/effects/EffectAttackIncrease";
import type {
  ICareersActiveTalentInfo,
  ICareersCreatureRules,
  ICareersDamageContext,
  ICareersStrainState,
  ICareersTalentActivationResult,
} from "@/engine/CareersSeam";
import { CareersRules } from "@/managers/gm/careers/rules";
import { CAREERS_TALENT_BY_ID, weaponMatchesScope } from "@/managers/gm/careers/talents";
import type { CareerTalentDef } from "@/managers/gm/careers/talents";
import type {
  CareerSkillId,
  CombatSkillId,
  GMCareersCharacter,
  GMCareersDerived,
  GMCareersNetworkState,
} from "@/managers/gm/careers/types";
import type { ModuleCreature } from "@/module/ModuleCreature";
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

/** Temporary combat buff created by an active or reactive Careers talent */
export interface CareerTempBuff {
  id: string;
  label: string;
  remaining: number;
  attackBonus?: number;
  damageBonus?: number;
  critThreatBonus?: number;
  defenseBonus?: number;
  damageReduction?: number;
  nextAttackOnly?: boolean;
}

const ENGINE_SKILL_TO_CAREER: Readonly<Record<number, CareerSkillId>> = {
  [SkillType.COMPUTER_USE]: 'computer_use',
  [SkillType.DEMOLITIONS]: 'demolitions',
  [SkillType.STEALTH]: 'stealth',
  [SkillType.AWARENESS]: 'awareness',
  [SkillType.REPAIR]: 'repair',
  [SkillType.SECURITY]: 'security',
  [SkillType.TREAT_INJURY]: 'treat_injury',
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
 * combat feats paid in Strain, Force-point pushing with Strain, and custom talent hooks & active talents.
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
  owner?: Partial<ModuleCreature>;

  /** Accumulated Strain (0 .. maxStrain); exceeding maxStrain triggers winded */
  strain: number = 0;
  /** Seconds remaining in winded state (0 when not winded) */
  windedSeconds: number = 0;

  /** Active temporary buffs from active/reactive talents */
  buffs: CareerTempBuff[] = [];
  /** Remaining cooldowns (seconds) keyed by talent id */
  cooldowns: Map<string, number> = new Map();

  private roundTimer: number = 0;
  private quietTimer: number = 0;
  private wasInCombat: boolean = false;
  /** Client-replicated buff badges when running as a replica */
  private syncedBuffs?: { label: string; secondsLeft?: number }[];

  constructor(character: GMCareersCharacter, owner?: Partial<ModuleCreature>) {
    this.character = character;
    this.derived = CareersRules.derive(character);
    this.owner = owner;
  }

  /** Refresh derived numbers after live XP advancement or sheet sync (preserving current Strain & buffs) */
  refresh(character: GMCareersCharacter) {
    this.character = character;
    this.derived = CareersRules.derive(character);
    if (this.strain > this.derived.maxStrain) this.strain = this.derived.maxStrain;
  }

  /** Apply host-replicated Strain, buff badges, and cooldowns on a client replica */
  syncStrain(state: ICareersStrainState & Partial<Pick<GMCareersNetworkState, 'activeBuffs' | 'cooldowns'>>) {
    const wasWinded = this.isWinded();
    this.strain = Math.max(0, Math.min(this.derived.maxStrain, Number(state.strain) || 0));
    this.windedSeconds = Math.max(0, Number(state.windedSeconds) || 0);
    this.syncedBuffs = Array.isArray(state.activeBuffs) ? state.activeBuffs.map((b) => ({ ...b })) : [];
    this.cooldowns.clear();
    if (state.cooldowns && typeof state.cooldowns === 'object') {
      for (const [id, secs] of Object.entries(state.cooldowns)) {
        const n = Number(secs);
        if (Number.isFinite(n) && n > 0) this.cooldowns.set(id, n);
      }
    }
    if (wasWinded !== this.isWinded()) {
      this.owner?.updateMovementSpeed?.();
    }
  }

  get maxStrain(): number {
    return this.derived.maxStrain;
  }

  private forEachOwnedTalent(fn: (def: CareerTalentDef, rank: number) => void) {
    for (const [id, rank] of Object.entries(this.derived.talentRanks)) {
      if (!(rank > 0)) continue;
      const def = CAREERS_TALENT_BY_ID.get(id);
      if (def) fn(def, rank);
    }
  }

  private healCreature(target: Partial<ModuleCreature> | undefined, amount: number) {
    if (!target || !(amount > 0)) return;
    if (typeof target.addHP === 'function') {
      target.addHP(amount);
      return;
    }
    const maxHp = target.getMaxHP?.() ?? target.maxHitPoints ?? 0;
    const curHp = target.getHP?.() ?? target.currentHitPoints ?? 0;
    const next = maxHp > 0 ? Math.min(maxHp, curHp + amount) : curHp + amount;
    target.currentHitPoints = next;
  }

  /** Recover Strain (never below 0) */
  recoverStrain(amount: number) {
    if (!(amount > 0)) return;
    this.strain = Math.max(0, this.strain - amount);
  }

  /** Add or refresh a temporary combat buff on this creature */
  addBuff(buff: CareerTempBuff) {
    const idx = this.buffs.findIndex((b) => b.id === buff.id);
    if (idx >= 0) this.buffs[idx] = { ...buff };
    else this.buffs.push({ ...buff });
  }

  /** Export remaining cooldowns as whole seconds for network sheet sync */
  getCooldownSnapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, secs] of this.cooldowns.entries()) {
      const whole = Math.ceil(secs);
      if (whole > 0) out[id] = whole;
    }
    return out;
  }

  // --- Core stat & combat seams ---------------------------------------------------------------

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

  /** Defence bonus replacing KotOR class AC bonus: level baseline + passive/active talent defence */
  getDefenseBonus(): number {
    let bonus = this.derived.levelBaseline + this.derived.defenseTalentBonus;
    for (const b of this.buffs) {
      if (b.defenseBonus) bonus += b.defenseBonus;
    }
    return bonus;
  }

  /** Conditional defence bonus against melee or ranged attacks from talents */
  getDefenseBonusVs(isRanged: boolean): number {
    let bonus = 0;
    this.forEachOwnedTalent((def, rank) => {
      const vs = def.hooks.defenseVs;
      if (!vs) return;
      if (isRanged && vs.ranged) bonus += vs.ranged * rank;
      if (!isRanged && vs.melee) bonus += vs.melee * rank;
    });
    return bonus;
  }

  /** Raw save skill base (rank * 2 + passive talent saves, without ability mod) */
  getSaveBase(save: 'fortitude' | 'reflex' | 'will'): number {
    return this.derived.saveRanks[save];
  }

  /** Talent attack roll bonus (passive + active buffs) */
  getTalentAttackBonus(weapon?: ModuleItem): number {
    let bonus = 0;
    this.forEachOwnedTalent((def, rank) => {
      const atk = def.hooks.attackBonus;
      if (atk && weaponMatchesScope(atk.scope, weapon)) {
        bonus += atk.amount * rank;
      }
    });
    for (const b of this.buffs) {
      if (b.attackBonus) bonus += b.attackBonus;
    }
    return bonus;
  }

  /** Talent critical threat span bonus (passive + active buffs) */
  getCritThreatBonus(weapon?: ModuleItem): number {
    let bonus = 0;
    this.forEachOwnedTalent((def, rank) => {
      const crit = def.hooks.critThreatBonus;
      if (crit && weaponMatchesScope(crit.scope, weapon)) {
        bonus += crit.amount * rank;
      }
    });
    for (const b of this.buffs) {
      if (b.critThreatBonus) bonus += b.critThreatBonus;
    }
    return bonus;
  }

  /** Talent damage bonus (passive + critical damage + active buffs) */
  getDamageBonus(ctx: ICareersDamageContext): number {
    let bonus = 0;
    this.forEachOwnedTalent((def, rank) => {
      const dmg = def.hooks.damageBonus;
      if (dmg && weaponMatchesScope(dmg.scope, ctx.weapon)) {
        bonus += dmg.amount * rank;
      }
      const critDmg = def.hooks.critDamageBonus;
      if (ctx.isCritical && critDmg && weaponMatchesScope(critDmg.scope, ctx.weapon)) {
        bonus += critDmg.amount * rank;
      }
    });
    for (const b of this.buffs) {
      if (b.damageBonus) bonus += b.damageBonus;
    }
    return bonus;
  }

  /** Flat damage reduction per incoming hit from passive + active talents */
  getDamageReduction(): number {
    let dr = this.derived.damageReduction;
    for (const b of this.buffs) {
      if (b.damageReduction) dr += b.damageReduction;
    }
    return Math.max(0, dr);
  }

  /** Flat skill check bonus from talents for a KotOR SkillType (0..7) */
  getSkillCheckBonus(engineSkill: number): number {
    if (engineSkill === SkillType.PERSUADE) {
      return Math.max(
        this.derived.skillBonuses.charm || 0,
        this.derived.skillBonuses.negotiation || 0,
        this.derived.skillBonuses.deception || 0,
      );
    }
    const id = ENGINE_SKILL_TO_CAREER[engineSkill];
    return id ? (this.derived.skillBonuses[id] || 0) : 0;
  }

  /** Flat check bonus for any Careers skill (including narrative skills) */
  getNarrativeSkillBonus(skillId: CareerSkillId): number {
    return this.derived.skillBonuses[skillId] || 0;
  }

  // --- Force power cast modifiers (ready for Phase 5 power trees) -----------------------------

  getSpellSaveDCBonus(): number {
    let bonus = 0;
    this.forEachOwnedTalent((def, rank) => {
      if (def.hooks.powerSaveDC) bonus += def.hooks.powerSaveDC * rank;
    });
    return bonus;
  }

  getSpellCostReduction(): number {
    let bonus = 0;
    this.forEachOwnedTalent((def, rank) => {
      if (def.hooks.powerCostReduction) bonus += def.hooks.powerCostReduction * rank;
    });
    return bonus;
  }

  getSpellDamageBonus(): number {
    let bonus = 0;
    this.forEachOwnedTalent((def, rank) => {
      if (def.hooks.powerDamageBonus) bonus += def.hooks.powerDamageBonus * rank;
    });
    return bonus;
  }

  getSpellDurationBonus(): number {
    let bonus = 0;
    this.forEachOwnedTalent((def, rank) => {
      if (def.hooks.powerDurationBonusSeconds) bonus += def.hooks.powerDurationBonusSeconds * rank;
    });
    return bonus;
  }

  getSpellRangeBonus(): number {
    let bonus = 0;
    this.forEachOwnedTalent((def, rank) => {
      if (def.hooks.powerRangeBonusMeters) bonus += def.hooks.powerRangeBonusMeters * rank;
    });
    return bonus;
  }

  // --- Strain, combat feats, and Force pushing ------------------------------------------------

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

  // --- Combat lifecycle reactions -------------------------------------------------------------

  onCombatRoundStart() {
    this.forEachOwnedTalent((def, rank) => {
      const hook = def.hooks.onRoundStart;
      if (!hook) return;
      if (hook.healStrain) this.recoverStrain(hook.healStrain * rank);
      if (hook.healHp) this.healCreature(this.owner, hook.healHp * rank);
    });
  }

  onAttackResolved(_landed: boolean, _isCritical: boolean, killedTarget: boolean) {
    // Consume single-attack buffs (e.g. Battle Focus, Relentless) once an attack resolves
    if (this.buffs.length > 0) {
      this.buffs = this.buffs.filter((b) => !b.nextAttackOnly);
    }
    if (!killedTarget) return;
    this.forEachOwnedTalent((def, rank) => {
      const hook = def.hooks.onKill;
      if (!hook) return;
      if (hook.healStrain) this.recoverStrain(hook.healStrain * rank);
      if (hook.healHp) this.healCreature(this.owner, hook.healHp * rank);
      if (hook.nextAttackBonus) {
        this.addBuff({
          id: `kill:${def.id}`,
          label: def.name,
          remaining: 9,
          attackBonus: hook.nextAttackBonus * rank,
          nextAttackOnly: true,
        });
      }
    });
  }

  onTakeDamage(amount: number) {
    if (!(amount > 0)) return;
    this.forEachOwnedTalent((def, rank) => {
      const hook = def.hooks.onTakeDamage;
      if (!hook) return;
      if (hook.healStrain) this.recoverStrain(hook.healStrain * rank);
      if (hook.nextAttackBonus) {
        this.addBuff({
          id: `hurt:${def.id}`,
          label: def.name,
          remaining: 6,
          attackBonus: hook.nextAttackBonus * rank,
          nextAttackOnly: true,
        });
      }
    });
  }

  private triggerCombatStart() {
    this.forEachOwnedTalent((def, rank) => {
      const hook = def.hooks.onCombatStart;
      if (!hook) return;
      if (hook.healStrain) this.recoverStrain(hook.healStrain * rank);
      if (hook.tempDefense) {
        this.addBuff({
          id: `start:${def.id}`,
          label: def.name,
          remaining: hook.durationSeconds || 3,
          defenseBonus: hook.tempDefense * rank,
        });
      }
    });
  }

  private triggerCombatEnd() {
    this.forEachOwnedTalent((def, rank) => {
      const hook = def.hooks.onCombatEnd;
      if (!hook) return;
      if (hook.healStrain) this.recoverStrain(hook.healStrain * rank);
      if (hook.healHp) this.healCreature(this.owner, hook.healHp * rank);
    });
  }

  // --- Active talents (HUD / power wheel / host execution) ------------------------------------

  getActiveTalents(): ICareersActiveTalentInfo[] {
    const out: ICareersActiveTalentInfo[] = [];
    this.forEachOwnedTalent((def, rank) => {
      if (def.activation !== 'active') return;
      const strainCost = def.strainCost || 0;
      const cd = Math.max(0, this.cooldowns.get(def.id) || 0);
      const windedBlock = this.isWinded() && strainCost > 0;
      const usable = !windedBlock && cd <= 0;
      const why = windedBlock
        ? 'Winded: can\'t spend Strain'
        : cd > 0
          ? `Ready in ${Math.ceil(cd)}s`
          : undefined;
      out.push({
        id: def.id,
        name: def.name,
        description: def.description,
        icon: def.icon,
        rank,
        strainCost,
        aim: def.aim || 'self',
        category: def.category || 'buff',
        cooldownRemaining: Math.ceil(cd),
        usable,
        why,
      });
    });
    return out;
  }

  getActiveBuffs(): { label: string; secondsLeft?: number }[] {
    if (this.buffs.length > 0) {
      return this.buffs.map((b) => ({
        label: b.label,
        ...(b.remaining > 0 ? { secondsLeft: Math.ceil(b.remaining) } : {}),
      }));
    }
    return this.syncedBuffs ? this.syncedBuffs.map((b) => ({ ...b })) : [];
  }

  activateTalent(talentId: string, target?: ModuleCreature): ICareersTalentActivationResult {
    const rank = this.derived.talentRanks[talentId] || 0;
    const def = CAREERS_TALENT_BY_ID.get(talentId);
    if (!def || def.activation !== 'active' || rank <= 0) {
      return { ok: false, reason: 'You don\'t have that active talent.' };
    }
    const cd = this.cooldowns.get(def.id) || 0;
    if (cd > 0) {
      return { ok: false, reason: `${def.name} is ready in ${Math.ceil(cd)}s.` };
    }
    const cost = def.strainCost || 0;
    if (cost > 0) {
      const paid = this.spendStrain(cost);
      if (!paid.ok) {
        return { ok: false, reason: 'Winded: cannot spend Strain.' };
      }
    }

    const hook = def.hooks.active || {};
    const recipient: Partial<ModuleCreature> | undefined =
      hook.affectTarget && target ? target : this.owner;

    if (hook.healHp) {
      this.healCreature(recipient, hook.healHp * rank);
    }
    if (hook.healStrain) {
      if (recipient?.careersRules instanceof CareersRuntime) {
        recipient.careersRules.recoverStrain(hook.healStrain * rank);
      } else if (recipient === this.owner) {
        this.recoverStrain(hook.healStrain * rank);
      }
    }

    const hasBuff = Boolean(
      hook.attackBonus || hook.damageBonus || hook.critThreatBonus || hook.defenseBonus || hook.damageReduction
    );
    if (hasBuff) {
      const duration = hook.durationSeconds || 3;
      const buff: CareerTempBuff = {
        id: `active:${def.id}`,
        label: def.name,
        remaining: duration,
        ...(hook.attackBonus ? { attackBonus: hook.attackBonus * rank } : {}),
        ...(hook.damageBonus ? { damageBonus: hook.damageBonus * rank } : {}),
        ...(hook.critThreatBonus ? { critThreatBonus: hook.critThreatBonus * rank } : {}),
        ...(hook.defenseBonus ? { defenseBonus: hook.defenseBonus * rank } : {}),
        ...(hook.damageReduction ? { damageReduction: hook.damageReduction * rank } : {}),
        ...(hook.nextAttackOnly ? { nextAttackOnly: true } : {}),
      };
      if (recipient === this.owner) {
        this.addBuff(buff);
      } else if (recipient?.careersRules instanceof CareersRuntime) {
        recipient.careersRules.addBuff(buff);
      } else if (recipient && typeof recipient.addEffect === 'function') {
        // Non-Careers ally: apply equivalent standard KotOR attack / AC buffs
        if (buff.attackBonus) {
          const eff = new EffectAttackIncrease();
          eff.setInt(0, buff.attackBonus);
          eff.setDurationType(GameEffectDurationType.TEMPORARY);
          eff.setDuration(duration);
          recipient.addEffect(eff, GameEffectDurationType.TEMPORARY, duration);
        }
        if (buff.defenseBonus) {
          const eff = new EffectACIncrease();
          eff.setInt(0, buff.defenseBonus);
          eff.setInt(1, buff.defenseBonus);
          eff.setDurationType(GameEffectDurationType.TEMPORARY);
          eff.setDuration(duration);
          recipient.addEffect(eff, GameEffectDurationType.TEMPORARY, duration);
        }
      }
    }

    if (def.cooldownSeconds && def.cooldownSeconds > 0) {
      this.cooldowns.set(def.id, def.cooldownSeconds);
    }

    const who = this.owner?.getName?.() || 'Character';
    return { ok: true, message: `${who} activated ${def.name}.` };
  }

  // --- World time tick ------------------------------------------------------------------------

  /** Advance Strain recovery, winded duration, active talent buffs, cooldowns, and combat transitions */
  tick(delta: number, inCombat: boolean) {
    if (!(delta > 0)) return;

    // Combat state transitions (start / end hooks)
    if (inCombat && !this.wasInCombat) {
      this.wasInCombat = true;
      this.triggerCombatStart();
    } else if (!inCombat && this.wasInCombat) {
      this.wasInCombat = false;
      this.triggerCombatEnd();
    }

    // Active talent cooldowns
    for (const [id, secs] of this.cooldowns.entries()) {
      const next = secs - delta;
      if (next <= 0) this.cooldowns.delete(id);
      else this.cooldowns.set(id, next);
    }

    // Temporary talent buffs
    if (this.buffs.length > 0) {
      for (const b of this.buffs) b.remaining -= delta;
      this.buffs = this.buffs.filter((b) => b.remaining > 0);
    }

    // Winded timer
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

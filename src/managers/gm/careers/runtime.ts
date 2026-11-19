import { CombatFeatType } from "@/enums/combat/CombatFeatType";
import { SkillType } from "@/enums/nwscript/SkillType";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
import { EffectACIncrease } from "@/effects/EffectACIncrease";
import { EffectAttackIncrease } from "@/effects/EffectAttackIncrease";
import type { ICareersCreatureRules, ICareersDamageContext } from "@/engine/CareersSeam";
import { CareersRules } from "@/managers/gm/careers/rules";
import { CAREERS_TALENT_BY_ID } from "@/managers/gm/careers/talents";
import type { TalentAim } from "@/managers/gm/careers/talents";
import { CareersTalentState, forEachTalent, scopeTotal } from "@/managers/gm/careers/talentEffects";
import type { CareerBuffBadge, CareerTempBuff } from "@/managers/gm/careers/talentEffects";
import { combatSkillForWeapon } from "@/managers/gm/careers/weapons";
import type {
  CareerSkillId,
  GMCareersCharacter,
  GMCareersDerived,
  GMCareersNetworkState,
} from "@/managers/gm/careers/types";
import type { ModuleCreature } from "@/module/ModuleCreature";
import type { ModuleItem } from "@/module/ModuleItem";

export { combatSkillForWeapon } from "@/managers/gm/careers/weapons";
export type { CareerTempBuff } from "@/managers/gm/careers/talentEffects";

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

const ENGINE_SKILL_TO_CAREER: Readonly<Record<number, CareerSkillId>> = {
  [SkillType.COMPUTER_USE]: 'computer_use',
  [SkillType.DEMOLITIONS]: 'demolitions',
  [SkillType.STEALTH]: 'stealth',
  [SkillType.AWARENESS]: 'awareness',
  [SkillType.REPAIR]: 'repair',
  [SkillType.SECURITY]: 'security',
  [SkillType.TREAT_INJURY]: 'treat_injury',
};

/** Strain and winded, as the HUD and the network show them */
export interface CareersStrainState {
  strain: number;
  maxStrain: number;
  /** Seconds left winded (0 when not) */
  windedSeconds: number;
}

/** An active talent as the HUD and power wheel list it */
export interface CareersActiveTalentInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  rank: number;
  strainCost: number;
  aim: TalentAim;
  category: 'feat' | 'buff' | 'heal';
  cooldownRemaining: number;
  usable: boolean;
  why?: string;
}

export interface CareersTalentActivationResult {
  ok: boolean;
  reason?: string;
  message?: string;
}

/** The Careers rules on a creature, when it has them (the GM side's way to reach the full runtime) */
export function careersRuntimeOf(obj: { careersRules?: ICareersCreatureRules } | undefined | null): CareersRuntime | undefined {
  return obj?.careersRules instanceof CareersRuntime ? obj.careersRules : undefined;
}

/**
 * The Careers rules attached to a spawned Careers creature (`creature.careersRules`): its stats, Strain and winded
 * state, combat feats paid in Strain, Force pushes, and its talents (passive totals from the sheet, plus the
 * buffs and cooldowns of active talents in CareersTalentState).
 */
export class CareersRuntime implements ICareersCreatureRules {
  static WINDED_SECONDS = 6; // 2 combat rounds
  static WINDED_SPEED_MULTIPLIER = 0.65;
  static ROUND_REFILL_INTERVAL = 3; // 1 combat round
  static ROUND_REFILL_AMOUNT = 1;
  static OUT_OF_COMBAT_REFILL_SECONDS = 4;
  static STRAIN_PER_MISSING_FP = 2;
  /** How far an ally talent reaches (metres) */
  static ALLY_TALENT_RANGE = 15;
  /** Seconds a buff from a kill waits for the next attack */
  static KILL_BUFF_SECONDS = 9;

  character: GMCareersCharacter;
  derived: GMCareersDerived;
  owner?: Partial<ModuleCreature>;

  /** Accumulated Strain (0 .. maxStrain); exceeding maxStrain triggers winded */
  strain: number = 0;
  /** Seconds remaining in winded state (0 when not winded) */
  windedSeconds: number = 0;
  /** Buffs and cooldowns from active talents and combat reactions */
  talents = new CareersTalentState();

  private roundTimer: number = 0;
  private quietTimer: number = 0;
  private wasInCombat: boolean = false;

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

  /** A player's machine: take the host's Strain, winded time, buff badges and cooldowns */
  syncStrain(state: CareersStrainState & Partial<Pick<GMCareersNetworkState, 'activeBuffs' | 'cooldowns'>>) {
    const wasWinded = this.isWinded();
    this.strain = Math.max(0, Math.min(this.derived.maxStrain, Number(state.strain) || 0));
    this.windedSeconds = Math.max(0, Number(state.windedSeconds) || 0);
    this.talents.mirror(state.activeBuffs, state.cooldowns);
    if (wasWinded !== this.isWinded()) this.owner?.updateMovementSpeed?.();
  }

  get maxStrain(): number {
    return this.derived.maxStrain;
  }

  // --- Stats (the engine seam) ----------------------------------------------------------------

  getAttackBase(weapon?: ModuleItem): number {
    const rank = this.derived.skillRanks[combatSkillForWeapon(weapon)] || 0;
    return rank * 2 + this.derived.levelBaseline;
  }

  getDeflectionBase(): number {
    return (this.derived.skillRanks.lightsaber || 0) * 2 + this.derived.levelBaseline;
  }

  getDefenseBonus(): number {
    return this.derived.levelBaseline + this.derived.talents.defense + this.talents.buffTotal('defenseBonus');
  }

  getDefenseBonusVs(isRanged: boolean): number {
    const vs = this.derived.talents.defenseVs;
    return isRanged ? vs.ranged : vs.melee;
  }

  getSaveBase(save: 'fortitude' | 'reflex' | 'will'): number {
    return this.derived.saveRanks[save];
  }

  getTalentAttackBonus(weapon?: ModuleItem): number {
    return scopeTotal(this.derived.talents.attack, weapon) + this.talents.buffTotal('attackBonus');
  }

  getCritThreatBonus(weapon?: ModuleItem): number {
    return scopeTotal(this.derived.talents.critThreat, weapon) + this.talents.buffTotal('critThreatBonus');
  }

  getDamageBonus(ctx: ICareersDamageContext): number {
    const t = this.derived.talents;
    return scopeTotal(t.damage, ctx.weapon)
      + (ctx.isCritical ? scopeTotal(t.critDamage, ctx.weapon) : 0)
      + this.talents.buffTotal('damageBonus');
  }

  getDamageReduction(): number {
    return Math.max(0, this.derived.talents.damageReduction + this.talents.buffTotal('damageReduction'));
  }

  getSkillCheckBonus(engineSkill: number): number {
    const bonus = this.derived.talents.skillBonus;
    if (engineSkill === SkillType.PERSUADE) return Math.max(bonus.charm || 0, bonus.negotiation || 0, bonus.deception || 0);
    const id = ENGINE_SKILL_TO_CAREER[engineSkill];
    return id ? (bonus[id] || 0) : 0;
  }

  getSpellSaveDCBonus(): number {
    return this.derived.talents.powerSaveDC;
  }

  getSpellCostReduction(): number {
    return this.derived.talents.powerCostReduction;
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

  getStrainState(): CareersStrainState {
    return { strain: this.strain, maxStrain: this.derived.maxStrain, windedSeconds: this.windedSeconds };
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

  /** Recover Strain (never below 0) */
  recoverStrain(amount: number) {
    if (amount > 0) this.strain = Math.max(0, this.strain - amount);
  }

  payCombatFeatStrain(featId: number): boolean {
    const cost = this.getCombatFeatStrainCost(featId);
    if (cost <= 0) return false;
    // Winded (a feat queued before it came on): no Strain to pay, so KotOR's own penalties apply instead
    return this.spendStrain(cost).ok;
  }

  payForceCost(fpCost: number, currentFp: number): { fpToSpend: number; ok: boolean } {
    if (fpCost <= 0) return { fpToSpend: 0, ok: true };
    if (currentFp >= fpCost) return { fpToSpend: fpCost, ok: true };
    const strainCost = this.strainToPush(fpCost, currentFp);
    if (strainCost === null || !this.spendStrain(strainCost).ok) return { fpToSpend: 0, ok: false };
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

  // --- Combat events --------------------------------------------------------------------------

  private heal(target: Partial<ModuleCreature> | undefined, amount: number) {
    if (!target || !(amount > 0)) return;
    if (typeof target.addHP === 'function') {
      target.addHP(amount);
      return;
    }
    const maxHp = target.getMaxHP?.() ?? target.maxHitPoints ?? 0;
    const curHp = target.getHP?.() ?? target.currentHitPoints ?? 0;
    target.currentHitPoints = maxHp > 0 ? Math.min(maxHp, curHp + amount) : curHp + amount;
  }

  /** Strain and Vitality a reaction hook gives back, times rank */
  private react(hook: { healStrain?: number; healHp?: number } | undefined, rank: number) {
    if (!hook) return;
    if (hook.healStrain) this.recoverStrain(hook.healStrain * rank);
    if (hook.healHp) this.heal(this.owner, hook.healHp * rank);
  }

  onCombatRoundStart() {
    forEachTalent(this.derived.talentRanks, (def, rank) => this.react(def.hooks.onRoundStart, rank));
  }

  onAttackResolved() {
    // Battle Focus, a kill's bonus and the like last one attack, hit or miss
    this.talents.consumeNextAttackBuffs();
  }

  onKill() {
    forEachTalent(this.derived.talentRanks, (def, rank) => {
      const hook = def.hooks.onKill;
      if (!hook) return;
      this.react(hook, rank);
      if (hook.nextAttackBonus) {
        this.talents.addBuff({
          id: `kill:${def.id}`,
          label: def.name,
          remaining: CareersRuntime.KILL_BUFF_SECONDS,
          attackBonus: hook.nextAttackBonus * rank,
          nextAttackOnly: true,
        });
      }
    });
  }

  private onCombatEnd() {
    forEachTalent(this.derived.talentRanks, (def, rank) => this.react(def.hooks.onCombatEnd, rank));
  }

  // --- Active talents (HUD / power wheel / host) ----------------------------------------------

  getActiveTalents(): CareersActiveTalentInfo[] {
    const out: CareersActiveTalentInfo[] = [];
    forEachTalent(this.derived.talentRanks, (def, rank) => {
      if (def.activation !== 'active') return;
      const strainCost = def.strainCost || 0;
      const cd = this.talents.cooldownLeft(def.id);
      const windedBlock = this.isWinded() && strainCost > 0;
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
        usable: !windedBlock && cd <= 0,
        why: windedBlock ? "Winded: can't spend Strain" : cd > 0 ? `Ready in ${Math.ceil(cd)}s` : undefined,
      });
    });
    return out;
  }

  getActiveBuffs(): CareerBuffBadge[] {
    return this.talents.badges();
  }

  getCooldownSnapshot(): Record<string, number> {
    return this.talents.cooldownSnapshot();
  }

  /**
   * Who a talent aimed at `target` lands on, or why it can't be used on them. 'self' talents land on the user
   * whatever was aimed at; 'ally' talents on the user or a living, non-hostile creature in range
   */
  private recipientFor(aim: TalentAim, target: Partial<ModuleCreature> | undefined): { recipient?: Partial<ModuleCreature>; reason?: string } {
    const self = this.owner;
    if (aim === 'self' || !target || target === self) return { recipient: self };
    if (target.isDead?.()) return { reason: 'They are down.' };
    const hostile = !!(target.isHostile?.(self as ModuleCreature) || (self as ModuleCreature | undefined)?.isHostile?.(target as ModuleCreature));
    if (aim === 'ally' && hostile) return { reason: 'That only works on allies.' };
    if (aim === 'enemy' && !hostile) return { reason: 'That only works on enemies.' };
    const from = self?.position, to = target.position;
    if (from && to && typeof from.distanceTo === 'function' && from.distanceTo(to) > CareersRuntime.ALLY_TALENT_RANGE) {
      return { reason: 'Too far away.' };
    }
    return { recipient: target };
  }

  /** Why a talent can't be used on this target (undefined when it can, or the talent isn't aimed) */
  talentTargetProblem(talentId: string, target?: ModuleCreature): string | undefined {
    const def = CAREERS_TALENT_BY_ID.get(talentId);
    if (!def?.hooks.active?.affectTarget) return undefined;
    return this.recipientFor(def.aim || 'self', target).reason;
  }

  /** Use an active talent (host): checks ownership, cooldown, target and Strain before anything is spent */
  activateTalent(talentId: string, target?: ModuleCreature): CareersTalentActivationResult {
    const rank = this.derived.talentRanks[talentId] || 0;
    const def = CAREERS_TALENT_BY_ID.get(talentId);
    if (!def || def.activation !== 'active' || rank <= 0) return { ok: false, reason: "You don't have that active talent." };
    const cd = this.talents.cooldownLeft(def.id);
    if (cd > 0) return { ok: false, reason: `${def.name} is ready in ${Math.ceil(cd)}s.` };

    const hook = def.hooks.active || {};
    const aimed = this.recipientFor(def.aim || 'self', hook.affectTarget ? target : undefined);
    if (!aimed.recipient) return { ok: false, reason: aimed.reason || "That can't be used on them." };
    const recipient = aimed.recipient;

    if ((def.strainCost || 0) > 0 && !this.spendStrain(def.strainCost || 0).ok) {
      return { ok: false, reason: 'Winded: cannot spend Strain.' };
    }

    if (hook.healHp) this.heal(recipient, hook.healHp * rank);

    const buff: CareerTempBuff = {
      id: `active:${def.id}`,
      label: def.name,
      remaining: hook.durationSeconds || 3,
      ...(hook.attackBonus ? { attackBonus: hook.attackBonus * rank } : {}),
      ...(hook.damageBonus ? { damageBonus: hook.damageBonus * rank } : {}),
      ...(hook.critThreatBonus ? { critThreatBonus: hook.critThreatBonus * rank } : {}),
      ...(hook.defenseBonus ? { defenseBonus: hook.defenseBonus * rank } : {}),
      ...(hook.damageReduction ? { damageReduction: hook.damageReduction * rank } : {}),
      ...(hook.nextAttackOnly ? { nextAttackOnly: true } : {}),
    };
    if (buff.attackBonus || buff.damageBonus || buff.critThreatBonus || buff.defenseBonus || buff.damageReduction) {
      this.giveBuff(recipient, buff);
    }

    this.talents.startCooldown(def.id, def.cooldownSeconds);
    return { ok: true, message: `${this.owner?.getName?.() || 'Character'} activated ${def.name}.` };
  }

  /** A buff on a Careers character goes in its talent state; anyone else gets KotOR's own attack / AC effects */
  private giveBuff(recipient: Partial<ModuleCreature>, buff: CareerTempBuff) {
    const careers = recipient === this.owner ? this : careersRuntimeOf(recipient);
    if (careers) {
      careers.talents.addBuff(buff);
      return;
    }
    if (typeof recipient.addEffect !== 'function') return;
    const duration = buff.remaining;
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

  // --- World time (host) ----------------------------------------------------------------------

  /** Advance Strain recovery, winded time, buffs, cooldowns, and the end of a fight */
  tick(delta: number, inCombat: boolean) {
    if (!(delta > 0)) return;

    if (!inCombat && this.wasInCombat) this.onCombatEnd();
    this.wasInCombat = inCombat;

    this.talents.tick(delta);

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

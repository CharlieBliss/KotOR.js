import { CAREERS_TALENT_BY_ID } from "@/managers/gm/careers/talents";
import type { CareerTalentDef, TalentAttackScope } from "@/managers/gm/careers/talents";
import type { CareerSkillId } from "@/managers/gm/careers/types";
import { weaponMatchesScope } from "@/managers/gm/careers/weapons";
import type { ModuleItem } from "@/module/ModuleItem";

/*
 * The talent maths: what a character's owned talents add up to (worked out once with the sheet), and the
 * short-lived buffs and cooldowns that active talents and combat reactions leave behind.
 */

/** A bonus split by the attacks it covers ('any', 'melee', 'ranged', 'lightsaber', 'unarmed') */
export type ScopeTotals = Partial<Record<TalentAttackScope, number>>;

/** Every passive talent hook, added up over the character's ranks */
export interface CareerTalentTotals {
  maxHp: number;
  maxStrain: number;
  maxFp: number;
  defense: number;
  damageReduction: number;
  saves: { fortitude: number; reflex: number; will: number };
  skillBonus: Partial<Record<CareerSkillId, number>>;
  attack: ScopeTotals;
  critThreat: ScopeTotals;
  damage: ScopeTotals;
  critDamage: ScopeTotals;
  defenseVs: { melee: number; ranged: number };
  powerSaveDC: number;
  powerCostReduction: number;
}

/** Call fn for each talent the character has ranks in (unknown ids are skipped) */
export function forEachTalent(ranks: Readonly<Record<string, number>>, fn: (def: CareerTalentDef, rank: number) => void) {
  for (const [id, rank] of Object.entries(ranks)) {
    if (!(rank > 0)) continue;
    const def = CAREERS_TALENT_BY_ID.get(id);
    if (def) fn(def, rank);
  }
}

/** Add up every passive hook of the talents owned (each times its rank) */
export function totalTalentHooks(ranks: Readonly<Record<string, number>>): CareerTalentTotals {
  const t: CareerTalentTotals = {
    maxHp: 0, maxStrain: 0, maxFp: 0, defense: 0, damageReduction: 0,
    saves: { fortitude: 0, reflex: 0, will: 0 },
    skillBonus: {},
    attack: {}, critThreat: {}, damage: {}, critDamage: {},
    defenseVs: { melee: 0, ranged: 0 },
    powerSaveDC: 0, powerCostReduction: 0,
  };
  const addScoped = (into: ScopeTotals, hook: { amount: number; scope?: TalentAttackScope } | undefined, rank: number) => {
    if (!hook?.amount) return;
    const scope = hook.scope || 'any';
    into[scope] = (into[scope] || 0) + hook.amount * rank;
  };
  forEachTalent(ranks, (def, rank) => {
    const h = def.hooks;
    t.maxHp += (h.maxHp || 0) * rank;
    t.maxStrain += (h.maxStrain || 0) * rank;
    t.maxFp += (h.maxFp || 0) * rank;
    t.defense += (h.defense || 0) * rank;
    t.damageReduction += (h.damageReduction || 0) * rank;
    t.saves.fortitude += (h.saves?.fortitude || 0) * rank;
    t.saves.reflex += (h.saves?.reflex || 0) * rank;
    t.saves.will += (h.saves?.will || 0) * rank;
    for (const [skillId, bonus] of Object.entries(h.skillBonus || {}) as [CareerSkillId, number][]) {
      if (bonus) t.skillBonus[skillId] = (t.skillBonus[skillId] || 0) + bonus * rank;
    }
    addScoped(t.attack, h.attackBonus, rank);
    addScoped(t.critThreat, h.critThreatBonus, rank);
    addScoped(t.damage, h.damageBonus, rank);
    addScoped(t.critDamage, h.critDamageBonus, rank);
    t.defenseVs.melee += (h.defenseVs?.melee || 0) * rank;
    t.defenseVs.ranged += (h.defenseVs?.ranged || 0) * rank;
    t.powerSaveDC += (h.powerSaveDC || 0) * rank;
    t.powerCostReduction += (h.powerCostReduction || 0) * rank;
  });
  return t;
}

/** The part of a scoped bonus that covers this weapon (or unarmed) */
export function scopeTotal(totals: ScopeTotals, weapon?: ModuleItem): number {
  let sum = 0;
  for (const [scope, amount] of Object.entries(totals) as [TalentAttackScope, number][]) {
    if (amount && weaponMatchesScope(scope, weapon)) sum += amount;
  }
  return sum;
}

/** A temporary bonus from an active talent or a combat reaction */
export interface CareerTempBuff {
  id: string;
  label: string;
  /** Seconds left */
  remaining: number;
  attackBonus?: number;
  damageBonus?: number;
  critThreatBonus?: number;
  defenseBonus?: number;
  damageReduction?: number;
  /** Used up by the next attack, hit or miss */
  nextAttackOnly?: boolean;
}

export type CareerBuffStat = 'attackBonus' | 'damageBonus' | 'critThreatBonus' | 'defenseBonus' | 'damageReduction';

/** A buff as the HUD and the network show it */
export interface CareerBuffBadge {
  label: string;
  secondsLeft?: number;
}

/** A character's temporary buffs and talent cooldowns (the host's; a player's machine mirrors the badges) */
export class CareersTalentState {
  buffs: CareerTempBuff[] = [];
  /** Seconds left before each talent (by id) can be used again */
  cooldowns: Map<string, number> = new Map();
  /** A player's machine: the host's buff badges (the host owns the buffs themselves) */
  private mirroredBadges?: CareerBuffBadge[];

  /** Add a buff, or refresh one with the same id */
  addBuff(buff: CareerTempBuff) {
    const idx = this.buffs.findIndex((b) => b.id === buff.id);
    if (idx >= 0) this.buffs[idx] = { ...buff };
    else this.buffs.push({ ...buff });
  }

  /** What the buffs add to one stat */
  buffTotal(stat: CareerBuffStat): number {
    let sum = 0;
    for (const b of this.buffs) sum += b[stat] || 0;
    return sum;
  }

  /** An attack resolved: its next-attack buffs are used up */
  consumeNextAttackBuffs() {
    if (this.buffs.some((b) => b.nextAttackOnly)) this.buffs = this.buffs.filter((b) => !b.nextAttackOnly);
  }

  cooldownLeft(talentId: string): number {
    return Math.max(0, this.cooldowns.get(talentId) || 0);
  }

  startCooldown(talentId: string, seconds: number | undefined) {
    if (seconds && seconds > 0) this.cooldowns.set(talentId, seconds);
  }

  /** Run buffs and cooldowns down by world time (seconds) */
  tick(delta: number) {
    for (const [id, secs] of this.cooldowns) {
      const next = secs - delta;
      if (next <= 0) this.cooldowns.delete(id);
      else this.cooldowns.set(id, next);
    }
    if (this.buffs.length) {
      for (const b of this.buffs) b.remaining -= delta;
      this.buffs = this.buffs.filter((b) => b.remaining > 0);
    }
  }

  /** The buffs as badges: the real ones on the host, the host's copy on a player's machine */
  badges(): CareerBuffBadge[] {
    if (this.buffs.length) {
      return this.buffs.map((b) => ({ label: b.label, ...(b.remaining > 0 ? { secondsLeft: Math.ceil(b.remaining) } : {}) }));
    }
    return (this.mirroredBadges || []).map((b) => ({ ...b }));
  }

  /** Cooldowns in whole seconds, for the player's sheet */
  cooldownSnapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, secs] of this.cooldowns) {
      const whole = Math.ceil(secs);
      if (whole > 0) out[id] = whole;
    }
    return out;
  }

  /** A player's machine: take the host's badges and cooldowns (anything malformed is dropped) */
  mirror(badges: unknown, cooldowns: unknown) {
    this.mirroredBadges = Array.isArray(badges)
      ? badges.filter((b) => b && typeof b.label === 'string').map((b) => ({
        label: String(b.label),
        ...(Number.isFinite(Number(b.secondsLeft)) ? { secondsLeft: Number(b.secondsLeft) } : {}),
      }))
      : [];
    this.cooldowns.clear();
    if (cooldowns && typeof cooldowns === 'object') {
      for (const [id, secs] of Object.entries(cooldowns as Record<string, unknown>)) {
        const n = Number(secs);
        if (Number.isFinite(n) && n > 0) this.cooldowns.set(id, n);
      }
    }
  }
}

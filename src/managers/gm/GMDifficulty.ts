import { GameState } from "@/GameState";
import { GMLog } from "@/managers/gm/GMLog";
import { GMCombatStats } from "@/managers/gm/GMCombatStats";
import type { GMCombatProfile } from "@/managers/gm/GMCombatStats";
import type { ModuleCreature } from "@/module/ModuleCreature";
import type { ModuleObject } from "@/module/ModuleObject";

/** One side of a fight, as GMDifficulty measures it */
export interface GMSideMeasure {
  count: number;
  /** Vitality, all of them together (enemies' with the HP multiplier) */
  hp: number;
  /** Their average AC */
  ac: number;
  /** Damage a round they'd deal the other side, from their weapons' hit chance against its average AC */
  damagePerRound: number;
}

export type GMDifficultyVerdict = 'none' | 'easy' | 'fair' | 'hard' | 'deadly';

/** The party against the enemies in the scene */
export interface GMDifficultyReadout {
  party: GMSideMeasure;
  enemies: GMSideMeasure;
  /** Rounds the party needs to beat the enemies, and the enemies to beat the party (Infinity: never) */
  partyRounds: number;
  enemyRounds: number;
  verdict: GMDifficultyVerdict;
}

export const GM_DIFFICULTY_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/**
 * The GM's difficulty knobs, changeable any time (mid-fight too): enemies' vitality and the damage enemies deal to
 * player characters, as multipliers. Both work on damage as it lands (EngineHooks.scaleDamage), so they apply to
 * every enemy at once, whatever its faction was when it arrived: an enemy with twice the vitality takes half
 * damage. And a readout of the party against the enemies in the scene, from their weapons (GMCombatStats).
 */
export class GMDifficulty {
  static enemyHp: number = 1;
  static enemyDamage: number = 1;

  /** Damage left over from rounding, per creature, so halves and quarters add up instead of vanishing */
  static carry: WeakMap<object, number> = new WeakMap();

  static configure(settings: { enemyHp?: number; enemyDamage?: number }) {
    const ok = (n: any) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 10;
    let changed = false;
    if (ok(settings.enemyHp) && settings.enemyHp !== this.enemyHp) { this.enemyHp = settings.enemyHp as number; changed = true; }
    if (ok(settings.enemyDamage) && settings.enemyDamage !== this.enemyDamage) { this.enemyDamage = settings.enemyDamage as number; changed = true; }
    if (!changed) return;
    GMLog.info('difficulty', `enemy vitality ×${this.enemyHp}, enemy damage ×${this.enemyDamage}`);
    GameState.GMManager?.notifyChange?.();
  }

  static isPlayer(obj: ModuleObject | undefined): boolean {
    return !!GameState.GMManager?.isPlayerCharacter?.(obj);
  }

  static players(): ModuleCreature[] {
    return ((GameState.GMManager?.spawnedPlayers || []) as ModuleCreature[]).filter((p: any) => p && !p.destroyed);
  }

  /** An NPC hostile to any player character */
  static isEnemy(obj: ModuleObject | undefined, players: ModuleCreature[] = this.players()): boolean {
    if (!obj || this.isPlayer(obj) || typeof (obj as any).isHostile !== 'function') return false;
    return players.some((p) => (obj as any).isHostile(p));
  }

  /** The factor damage from attacker to target is scaled by (1: as the game has it) */
  static factor(target: ModuleObject | undefined, attacker: ModuleObject | undefined): number {
    if (this.enemyHp === 1 && this.enemyDamage === 1) return 1;
    const players = this.players();
    let f = 1;
    if (this.enemyHp !== 1 && this.isEnemy(target, players)) f /= this.enemyHp;
    if (this.enemyDamage !== 1 && this.isPlayer(target) && this.isEnemy(attacker, players)) f *= this.enemyDamage;
    return f;
  }

  /** Damage as it lands (EngineHooks.scaleDamage): whole points, the fractions carried to the next hit */
  static scale(target: ModuleObject | undefined, attacker: ModuleObject | undefined, amount: number): number {
    if (!(amount > 0) || !target) return amount;
    const f = this.factor(target, attacker);
    if (f === 1) return amount;
    const value = amount * f + (this.carry.get(target) || 0);
    const out = Math.floor(value);
    this.carry.set(target, value - out);
    return out;
  }

  /** A d20 attack against an AC: 1 always misses, 20 always hits */
  static hitChance(bonus: number, ac: number): number {
    return Math.min(0.95, Math.max(0.05, (21 - (ac - bonus)) / 20));
  }

  static damagePerRound(profile: GMCombatProfile, ac: number): number {
    return profile.attacks.reduce((sum, a) => sum + this.hitChance(a.bonus, ac) * Math.max(0, a.damage), 0);
  }

  /** The two sides measured, and how the fight looks (with the multipliers) */
  static measure(party: GMCombatProfile[], enemies: GMCombatProfile[], hp = this.enemyHp, damage = this.enemyDamage): GMDifficultyReadout {
    const avgAc = (list: GMCombatProfile[]) => (list.length ? list.reduce((s, p) => s + p.ac, 0) / list.length : 10);
    const partyAc = avgAc(party), enemyAc = avgAc(enemies);
    const side = (list: GMCombatProfile[], hpScale: number, dmgScale: number, againstAc: number): GMSideMeasure => ({
      count: list.length,
      hp: Math.round(list.reduce((s, p) => s + p.hp, 0) * hpScale),
      ac: Math.round(avgAc(list)),
      damagePerRound: +(list.reduce((s, p) => s + this.damagePerRound(p, againstAc), 0) * dmgScale).toFixed(1),
    });
    const us = side(party, 1, 1, enemyAc);
    const them = side(enemies, hp, damage, partyAc);
    const partyRounds = us.damagePerRound > 0 ? them.hp / us.damagePerRound : Infinity;
    const enemyRounds = them.damagePerRound > 0 ? us.hp / them.damagePerRound : Infinity;
    let verdict: GMDifficultyVerdict = 'none';
    if (party.length && enemies.length) {
      // How long winning takes against how long losing would
      const ratio = partyRounds / enemyRounds;
      verdict = !Number.isFinite(partyRounds) ? 'deadly' : ratio < 0.35 ? 'easy' : ratio < 0.7 ? 'fair' : ratio < 1 ? 'hard' : 'deadly';
    }
    return { party: us, enemies: them, partyRounds, enemyRounds, verdict };
  }

  /** The party against the visible, living enemies in the scene now */
  static readout(): GMDifficultyReadout {
    const players = this.players().filter((p) => !p.isDead?.());
    const area = GameState.module?.area;
    const enemies = ((area?.creatures || []) as ModuleCreature[])
      .filter((c) => c && !c.destroyed && !c.gmHidden && !c.gmSpawning && !c.isDead?.() && this.isEnemy(c, players));
    const profile = (c: ModuleCreature): GMCombatProfile | null => {
      try { return GMCombatStats.profile(c); } catch (e) { return null; }
    };
    return this.measure(players.map(profile).filter(Boolean) as GMCombatProfile[], enemies.map(profile).filter(Boolean) as GMCombatProfile[]);
  }
}

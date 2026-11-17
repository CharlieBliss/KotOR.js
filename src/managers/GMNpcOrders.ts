import { GMObjectKind } from "@/managers/gm/GMObjectKind";
import * as THREE from "three";
import { GameState } from "@/GameState";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { ActionType } from "@/enums/actions/ActionType";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ModuleObjectConstant } from "@/enums/module/ModuleObjectConstant";
import { BitWise } from "@/utility/BitWise";
import { GMCombatAI } from "@/managers/gm/GMCombatAI";
import type { ModuleCreature } from "@/module/ModuleCreature";
import type { ModuleObject } from "@/module/ModuleObject";

export interface GMPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * A standing order the GM gives an NPC, which replaces its own judgement until cleared:
 * - move: walk to a spot, then guard it
 * - follow: stay near a creature (a player, say); fights back if attacked
 * - attack: fight one target until it's dead, then back to its own judgement
 * - guard: hold a spot, fight enemies that come within the radius, then return to it
 * - patrol: walk a loop of points, fight what it meets, then carry on
 * - flee: run from the nearest enemy, never fight
 * - standDown: no fighting at all, even when attacked
 */
export type GMNpcOrder =
  | { kind: 'move'; point: GMPoint }
  | { kind: 'follow'; targetNetId: string }
  | { kind: 'attack'; targetNetId: string }
  | { kind: 'guard'; point: GMPoint; radius: number }
  | { kind: 'patrol'; points: GMPoint[]; index: number }
  | { kind: 'flee' }
  | { kind: 'standDown' };

export type GMNpcOrderKind = GMNpcOrder['kind'];

/**
 * GMNpcOrders class.
 *
 * Runs on the GM's machine, as part of the NPC update: each NPC with a standing order (see GMNpcOrder) does
 * what its order says instead of its own judgement (fight the nearest enemy). Players see the result through
 * the world updates, like any other NPC behaviour.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file GMNpcOrders.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class GMNpcOrders {

  /** Follow: how far behind it walks, and when it starts running to catch up (metres) */
  static FOLLOW_DISTANCE = 2.5;
  static FOLLOW_RUN_DISTANCE = 8;
  /** Arrived at a move or patrol point (metres) */
  static ARRIVE_DISTANCE = 1.2;
  /** Guard: how far from its spot it fights, and wanders before walking back (metres) */
  static GUARD_RADIUS = 8;
  static GUARD_RETURN_DISTANCE = 2;
  /** Flee: run when an enemy is this close, and this far each time (metres) */
  static FLEE_FROM_RANGE = 15;
  static FLEE_DISTANCE = 12;

  static getOrder(cre: ModuleObject): GMNpcOrder | undefined {
    return cre?.gmOrder;
  }

  /** Give an NPC an order (or undefined to hand it back to its own judgement) */
  static setOrder(cre: ModuleCreature, order: GMNpcOrder | undefined) {
    if (!cre) return;
    cre.clearAllActions();
    if (order && ['move', 'flee', 'standDown', 'follow'].includes(order.kind)) this.stopFighting(cre);
    if (order) cre.gmOrder = order;
    else delete cre.gmOrder;
  }

  static describe(order: GMNpcOrder | undefined): string {
    if (!order) return 'Its own judgement: fights the nearest enemy';
    const name = (netId: string) => GameState.GMManager?.netIdMap.get(netId)?.getName() || 'someone';
    switch (order.kind) {
      case 'move': return 'Moving to a spot, then guarding it';
      case 'follow': return `Following ${name(order.targetNetId)}`;
      case 'attack': return `Attacking ${name(order.targetNetId)}`;
      case 'guard': return `Guarding a spot (${order.radius}m)`;
      case 'patrol': return `Patrolling ${order.points.length} points`;
      case 'flee': return 'Fleeing from enemies';
      case 'standDown': return 'Standing down: won\'t fight';
    }
  }

  /** One step of the NPC update for an NPC with an order */
  static think(cre: ModuleCreature, everyone: ModuleCreature[]) {
    const order = this.getOrder(cre);
    if (!order) return;
    const busy = !!(cre.combatRound?.action || cre.combatRound?.scheduledActionList?.length);

    switch (order.kind) {
      case 'standDown':
        this.stopFighting(cre);
        return;

      case 'flee': {
        this.stopFighting(cre);
        const enemy = this.nearestEnemy(cre, everyone, this.FLEE_FROM_RANGE, false);
        if (!enemy || this.isMoving(cre)) return;
        const away = cre.position.clone().sub(enemy.position).setZ(0);
        if (away.lengthSq() < 0.01) away.set(1, 0, 0);
        const spot = cre.position.clone().add(away.normalize().multiplyScalar(this.FLEE_DISTANCE));
        this.moveTo(cre, this.walkable(spot), true);
        return;
      }

      case 'attack': {
        const target = this.creature(order.targetNetId);
        if (!target || target.isDead()) {
          this.setOrder(cre, undefined);
          return;
        }
        if (!busy) GMCombatAI.engage(cre, target, everyone);
        return;
      }

      case 'follow': {
        const target = this.creature(order.targetNetId);
        if (!target) {
          this.setOrder(cre, undefined);
          return;
        }
        // Fights back, but doesn't go looking for trouble
        const attacker = this.retaliateTarget(cre);
        if (attacker) {
          if (!busy) GMCombatAI.engage(cre, attacker, everyone);
          return;
        }
        if (busy) return;
        const distance = cre.position.distanceTo(target.position);
        if (distance > this.FOLLOW_DISTANCE + 1) {
          this.moveTo(cre, target.position, distance > this.FOLLOW_RUN_DISTANCE, this.FOLLOW_DISTANCE, target);
        }
        return;
      }

      case 'move': {
        // Met the enemy on the way, or hit: it stops and fights there (walking on, it ignored the fight and
        // circled the melee for its spot)
        const enemy = this.retaliateTarget(cre) || this.nearestEnemy(cre, everyone, this.MEET_ENEMY_RANGE, true);
        if (enemy) {
          cre.gmOrder = { kind: 'guard', point: this.here(cre), radius: this.GUARD_RADIUS };
          cre.gmOrderProgress = undefined;
          if (!busy) GMCombatAI.engage(cre, enemy, everyone);
          return;
        }
        if (this.arrived(cre, order.point, everyone)) {
          // Short of a spot someone else stands on: it guards where it got to
          const there = this.distance2D(cre.position, order.point) <= this.ARRIVE_DISTANCE;
          cre.gmOrder = { kind: 'guard', point: there ? order.point : this.here(cre), radius: this.GUARD_RADIUS };
          if (!there) cre.clearAllActions();
          return;
        }
        if (!this.isMoving(cre)) this.moveTo(cre, this.vector(order.point), true);
        return;
      }

      case 'guard': {
        const enemy = this.keptTarget(cre, order.radius + this.KEEP_TARGET_SLACK, order.point)
          || this.retaliateTarget(cre) || this.nearestEnemy(cre, everyone, order.radius, true, order.point)
          || this.assistTarget(cre, everyone);
        if (enemy) {
          if (!busy) GMCombatAI.engage(cre, enemy, everyone);
          return;
        }
        if (busy) return;
        const away = this.distance2D(cre.position, order.point) > this.GUARD_RETURN_DISTANCE;
        if (away && this.isMoving(cre) && this.arrived(cre, order.point, everyone)) {
          // Back as near as it gets (someone stands on its spot, or it can't get closer): its post is here now.
          // It kept walking at the taken spot after every fight
          order.point = this.here(cre);
          cre.clearAllActions();
          return;
        }
        // Nearly back but held off its spot (a neighbour stands on it): this is its post now. Walking on, it
        // turned on the spot trying to reach it after every fight
        if (!away && this.isMoving(cre) && this.distance2D(cre.position, order.point) > 0.3 && this.arrived(cre, order.point, everyone)) {
          order.point = this.here(cre);
          cre.clearAllActions();
          return;
        }
        if (away && !this.isMoving(cre)) {
          this.stopFighting(cre);
          cre.gmOrderProgress = undefined;
          // Its post crowded (posts taken up mid-melee end up a step apart): the nearest clear spot beside it is
          // its post now. They jostled for the same few metres, turning on the spot, after every fight
          const clear = this.clearSpotNear(cre, order.point, everyone);
          if (clear) order.point = clear;
          this.moveTo(cre, this.vector(order.point), false);
        }
        return;
      }

      case 'patrol': {
        if (!order.points.length) return;
        const enemy = this.keptTarget(cre, (GameState.GMManager?.NPC_AI_RETALIATE_RANGE || 30))
          || this.retaliateTarget(cre) || GameState.GMManager?.chooseNpcTarget(cre, everyone);
        if (enemy) {
          if (!busy) GMCombatAI.engage(cre, enemy, everyone);
          return;
        }
        if (busy) return;
        const point = order.points[order.index % order.points.length];
        if (this.arrived(cre, point, everyone)) {
          order.index = (order.index + 1) % order.points.length;
          return;
        }
        if (!this.isMoving(cre)) this.moveTo(cre, this.vector(point), false);
        return;
      }
    }
  }

  // --------------------------------------------------------------------------------------------------------

  static creature(netId: string): ModuleCreature | null {
    const obj = GameState.GMManager?.netIdMap.get(netId);
    return obj && GMObjectKind.isCreature(obj) ? obj as ModuleCreature : null;
  }

  /** Metres past its guard radius a guard still keeps after the enemy it's fighting */
  static KEEP_TARGET_SLACK = 4;
  /** On the way somewhere: an enemy this close (and in sight) and it stops to fight */
  static MEET_ENEMY_RANGE = 10;
  /** Someone standing this close to a spot has it */
  static SPOT_TAKEN_RADIUS = 0.9;
  /** Within this of a taken spot counts as there */
  static CROWD_ARRIVE_DISTANCE = 4;
  /** Seconds not getting closer to a spot before it counts as as close as it gets */
  static STALL_SECONDS = 2;
  /** ...when within this of it (metres) */
  static STALL_ARRIVE_DISTANCE = 6;

  /** A guard joins a fight a friend this close is in */
  static ASSIST_RANGE = 12;

  /**
   * The enemy a friend nearby is fighting (or being hit by), if it's within reach of a little more than that:
   * guards stood and watched a fight a few metres beyond their radius
   */
  static assistTarget(cre: ModuleCreature, everyone: ModuleCreature[]): ModuleCreature | null {
    const G = GameState.GMManager;
    let best: ModuleCreature | null = null;
    let bestDistance = Infinity;
    for (const friend of everyone) {
      if (!friend || friend === cre || friend.isDead?.() || cre.isHostile(friend)) continue;
      if (this.distance2D(cre.position, friend.position) > this.ASSIST_RANGE) continue;
      for (const enemy of [G?.attackTargetOf?.(friend), friend.combatData?.lastAttacker] as (ModuleCreature | undefined)[]) {
        if (!enemy || enemy === cre || !GMObjectKind.isCreature(enemy) || enemy.isDead?.() || !cre.isHostile(enemy)) continue;
        if (G?.isUntargetable?.(enemy)) continue;
        const d = this.distance2D(cre.position, enemy.position);
        if (d <= this.ASSIST_RANGE + this.KEEP_TARGET_SLACK && d < bestDistance) { best = enemy; bestDistance = d; }
      }
    }
    return best;
  }

  /** Where it stands, as an order point */
  static here(cre: ModuleCreature): GMPoint {
    return { x: cre.position.x, y: cre.position.y, z: cre.position.z };
  }

  /** How far apart (m) two creatures' posts need to be to stand on them without jostling */
  static POST_SPACING = 1.3;

  /**
   * A spot by point that no one else stands on or holds as their post: the point itself when it's clear, else the
   * nearest clear one on rings around it (walkable). Null when the point is clear, or nothing nearby is
   */
  static clearSpotNear(cre: ModuleCreature, point: GMPoint, everyone: ModuleCreature[]): GMPoint | null {
    const others = everyone.filter((c) => c && c !== cre && !c.isDead?.());
    const clear = (p: GMPoint) => others.every((c) =>
      this.distance2D(c.position, p) >= this.POST_SPACING &&
      (!c.gmOrder || c.gmOrder.kind !== 'guard' || this.distance2D(c.gmOrder.point, p) >= this.POST_SPACING));
    if (clear(point)) return null;
    let best: GMPoint | null = null, bestDistance = Infinity;
    for (const r of [this.POST_SPACING, this.POST_SPACING * 2, this.POST_SPACING * 3]) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const v = this.walkable(new THREE.Vector3(point.x + Math.cos(a) * r, point.y + Math.sin(a) * r, point.z));
        const p = { x: v.x, y: v.y, z: v.z };
        if (this.distance2D(p, point) > r + 0.5 || !clear(p)) continue;
        const d = this.distance2D(cre.position, p);
        if (d < bestDistance) { best = p; bestDistance = d; }
      }
      if (best) return best;
    }
    return null;
  }

  /** Someone else (alive) stands on this spot */
  static spotTaken(cre: ModuleCreature, point: GMPoint, everyone: ModuleCreature[]): boolean {
    return everyone.some((c) => c && c !== cre && !c.isDead?.() && this.distance2D(c.position, point) < this.SPOT_TAKEN_RADIUS);
  }

  /**
   * As close to a spot as it's going to get: there, near it with someone else on it, or walking without getting
   * any closer for a couple of seconds (others in the way)
   */
  static arrived(cre: ModuleCreature, point: GMPoint, everyone: ModuleCreature[]): boolean {
    const d = this.distance2D(cre.position, point);
    if (d <= this.ARRIVE_DISTANCE) return true;
    if (d <= this.CROWD_ARRIVE_DISTANCE && this.spotTaken(cre, point, everyone)) return true;
    // Held up far from it (behind its own side, setting off): it keeps going. Counted as there, soldiers at the
    // back of a line took up their post 20 m short of the fight and never joined it
    if (d > this.STALL_ARRIVE_DISTANCE) {
      cre.gmOrderProgress = undefined;
      return false;
    }
    const now = performance.now();
    const p = cre.gmOrderProgress;
    if (!p || Math.abs(p.x - point.x) + Math.abs(p.y - point.y) > 0.01 || d < p.distance - 0.3) {
      cre.gmOrderProgress = { x: point.x, y: point.y, distance: d, since: now };
      return false;
    }
    return now - p.since > this.STALL_SECONDS * 1000;
  }

  /**
   * The enemy it's already fighting, while that one is alive, hostile and within range (of a point): it sees
   * the fight through rather than turning on whoever hit it last. Guards in a melee took each new attacker as
   * their target and bounced between them.
   */
  static keptTarget(cre: ModuleCreature, range: number, around?: GMPoint): ModuleCreature | null {
    const G = GameState.GMManager;
    const from = around ? this.vector(around) : cre.position;
    // The round's target, else the enemy it last attacked: a heal or buff on a friend in between doesn't make it
    // forget who it was fighting
    for (const current of [G?.attackTargetOf?.(cre), cre.combatData?.lastAttackTarget] as (ModuleCreature | undefined)[]) {
      if (!current || current === cre || !GMObjectKind.isCreature(current) || current.isDead?.() || !cre.isHostile(current)) continue;
      if (G?.isUntargetable?.(current)) continue;
      if (this.distance2D(from, current.position) <= range) return current;
    }
    return null;
  }

  /** Whoever last attacked it, if still alive, hostile and nearby */
  static retaliateTarget(cre: ModuleCreature): ModuleCreature | null {
    const attacker = cre.combatData?.lastAttacker as ModuleCreature | undefined;
    if (!attacker || attacker === cre || attacker.isDead?.() || !cre.isHostile(attacker)) return null;
    return cre.position.distanceTo(attacker.position) <= (GameState.GMManager?.NPC_AI_RETALIATE_RANGE || 30) ? attacker : null;
  }

  /** The nearest living creature hostile to it, within range of it (or of a spot) */
  static nearestEnemy(cre: ModuleCreature, everyone: ModuleCreature[], range: number, mustSee: boolean, around?: GMPoint): ModuleCreature | null {
    const centre = around ? this.vector(around) : cre.position;
    let best: ModuleCreature | null = null;
    let bestDistance = Infinity;
    for (const other of everyone) {
      if (!other || other === cre || other.isDead() || !cre.isHostile(other) || cre.canDetect?.(other) === false) continue;
      if (GameState.GMManager?.isUntargetable(other)) continue;
      const d = other.position.distanceTo(centre);
      if (d > range || d >= bestDistance) continue;
      if (mustSee && !cre.hasLineOfSight(other, Math.max(range, 30))) continue;
      best = other;
      bestDistance = d;
    }
    return best;
  }

  static stopFighting(cre: ModuleCreature) {
    if (cre.combatRound?.action || cre.combatRound?.scheduledActionList?.length) {
      cre.combatRound.clearActions();
    }
    if (cre.combatData) cre.combatData.combatState = false;
    const queue = cre.actionQueue as any;
    if (queue?.some?.((a: any) => a.type === ActionType.ActionCombat || a.type === ActionType.ActionPhysicalAttacks)) {
      cre.clearAllActions();
    }
  }

  static isMoving(cre: ModuleCreature): boolean {
    return !!(cre.actionQueue as any)?.some?.((a: any) => a.type === ActionType.ActionMoveToPoint);
  }

  static moveTo(cre: ModuleCreature, point: THREE.Vector3, run: boolean, range: number = 0.5, target?: ModuleObject) {
    cre.clearAllActions();
    const move = new GameState.ActionFactory.ActionMoveToPoint();
    move.setParameter(0, ActionParameterType.FLOAT, point.x);
    move.setParameter(1, ActionParameterType.FLOAT, point.y);
    move.setParameter(2, ActionParameterType.FLOAT, point.z);
    move.setParameter(3, ActionParameterType.DWORD, GameState.module.area.id);
    move.setParameter(4, ActionParameterType.DWORD, target ? target.id : ModuleObjectConstant.OBJECT_INVALID);
    move.setParameter(5, ActionParameterType.INT, run ? 1 : 0);
    move.setParameter(6, ActionParameterType.FLOAT, range);
    move.setParameter(7, ActionParameterType.INT, 0);
    move.setParameter(8, ActionParameterType.FLOAT, 30.0);
    cre.actionQueue.add(move);
  }

  static walkable(point: THREE.Vector3): THREE.Vector3 {
    const area = GameState.module?.area;
    return area?.getNearestWalkablePoint ? area.getNearestWalkablePoint(point, 0.5).clone() : point;
  }

  static vector(p: GMPoint): THREE.Vector3 {
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  static distance2D(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

}

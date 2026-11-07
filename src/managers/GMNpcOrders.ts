import * as THREE from "three";
import { GameState } from "@/GameState";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { ActionType } from "@/enums/actions/ActionType";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ModuleObjectConstant } from "@/enums/module/ModuleObjectConstant";
import { BitWise } from "@/utility/BitWise";
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
    return (cre as any)?.gmOrder;
  }

  /** Give an NPC an order (or undefined to hand it back to its own judgement) */
  static setOrder(cre: ModuleCreature, order: GMNpcOrder | undefined) {
    if (!cre) return;
    cre.clearAllActions();
    if (order && ['move', 'flee', 'standDown', 'follow'].includes(order.kind)) this.stopFighting(cre);
    if (order) (cre as any).gmOrder = order;
    else delete (cre as any).gmOrder;
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
        if (!busy) cre.attackCreature(target, undefined);
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
          if (!busy) cre.attackCreature(attacker, undefined);
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
        if (this.distance2D(cre.position, order.point) <= this.ARRIVE_DISTANCE) {
          (cre as any).gmOrder = { kind: 'guard', point: order.point, radius: this.GUARD_RADIUS };
          return;
        }
        if (!this.isMoving(cre)) this.moveTo(cre, this.vector(order.point), true);
        return;
      }

      case 'guard': {
        const enemy = this.retaliateTarget(cre) || this.nearestEnemy(cre, everyone, order.radius, true, order.point);
        if (enemy) {
          if (!busy) cre.attackCreature(enemy, undefined);
          return;
        }
        if (!busy && !this.isMoving(cre) && this.distance2D(cre.position, order.point) > this.GUARD_RETURN_DISTANCE) {
          this.stopFighting(cre);
          this.moveTo(cre, this.vector(order.point), false);
        }
        return;
      }

      case 'patrol': {
        if (!order.points.length) return;
        const enemy = this.retaliateTarget(cre) || GameState.GMManager?.chooseNpcTarget(cre, everyone);
        if (enemy) {
          if (!busy) cre.attackCreature(enemy, undefined);
          return;
        }
        if (busy) return;
        const point = order.points[order.index % order.points.length];
        if (this.distance2D(cre.position, point) <= this.ARRIVE_DISTANCE) {
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
    return obj && BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModuleCreature) ? obj as ModuleCreature : null;
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

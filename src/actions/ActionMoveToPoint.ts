import * as THREE from "three";
import { ActionStatus } from "@/enums/actions/ActionStatus";
import { ActionType } from "@/enums/actions/ActionType";
import { Action } from "@/actions/Action";
import { Utility } from "@/utility/Utility";
import { GameState } from "@/GameState";
import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { BitWise } from "@/utility/BitWise";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import type { ModuleObject } from "@/module/ModuleObject";
import { ComputedPath } from "@/engine/pathfinding/ComputedPath";
import { PathPoint } from "@/engine/pathfinding/PathPoint";
import { TURN_SPEED_FAST } from "@/engine/TurnSpeeds";

/**
 * ActionMoveToPoint class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file ActionMoveToPoint.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
/** Move flags (parameter 5) */
export const MOVE_FLAG_RUN = 0x01;
/** Keep going when the target creature is dead, e.g. walking over to loot a body */
export const MOVE_FLAG_TARGET_MAY_BE_DEAD = 0x02;

export class ActionMoveToPoint extends Action {

  target_position: THREE.Vector3 = new THREE.Vector3();
  real_target_position: THREE.Vector3 = new THREE.Vector3();

  /** Seconds walking without getting anywhere before stepping aside and finding another way */
  static STUCK_SECONDS = 1.2;
  /** Metres it must cover to count as getting somewhere */
  static PROGRESS_DISTANCE = 0.4;
  /** How far it steps aside when stuck */
  static SIDESTEP_DISTANCE = 1.5;

  progressFrom: THREE.Vector3 | undefined;
  stuckTime = 0;
  sidestepLeft = false;

  constructor( actionId: number = -1, groupId: number = -1 ){
    super(actionId, groupId);
    this.type = ActionType.ActionMoveToPoint;

    //PARAMS
    // 0 - float: x
    // 1 - float: y
    // 2 - float: z
    // 3 - dword: area object id
    // 4 - dword: target object id
    // 5 - int: move flags
    // 6 - float: min range/distance
    // 7 - int: unknown
    // 8 - float: timeout value The amount of time to search for path before jumping to the object (as in ActionJumpToObject()) default 30

  }

  update(delta: number = 0): ActionStatus {
    if(!BitWise.InstanceOfObject(this.owner, ModuleObjectType.ModuleCreature))
      return ActionStatus.FAILED;

    this.target_position.set(
      this.getParameter<number>(0),
      this.getParameter<number>(1),
      this.getParameter<number>(2),
    );

    const range = this.getParameter<number>(6) || 0.1;
    const moveFlags = this.getParameter<number>(5) || 0;
    const run = moveFlags & 0x01 ? true : false;

    this.real_target_position.copy(this.target_position);

    this.target = this.getParameter<ModuleObject>(4);
    if(this.target){
      this.real_target_position.copy(this.target.position);
      if( BitWise.InstanceOfObject(this.target, ModuleObjectType.ModuleCreature) && this.target.isDead() && !(moveFlags & MOVE_FLAG_TARGET_MAY_BE_DEAD) ){
        this.setComputedPath(undefined);
        return ActionStatus.FAILED;
      }

      const distanceRT = Utility.Distance2D(this.owner.position, this.target_position);
      if( distanceRT <= range ){
        return ActionStatus.COMPLETE;
      }

      // Closing to melee with a creature others already surround: as close as it gets is close enough
      if(this.closeAsItGets(delta, range)){
        this.owner.force = 0;
        this.owner.speed = 0;
        this.setComputedPath(undefined);
        if(this.owner.combatData) this.owner.combatData.meleeContact = this.target;
        return ActionStatus.COMPLETE;
      }
    }

    if(!this.computedPath){
      this.target_position.copy(this.owner.area.getNearestWalkablePoint(this.target_position, this.owner.getHitDistance()));
      this.calculatePath();
    }

    // this.computedPath = this.owner.getComputedPath();

    const distance = Utility.Distance2D(this.owner.position, this.target_position);
    if(distance > (this.computedPath.points.length > 1 ? 0.5 : range)){
  
      if((this.owner as any).blockingTimer >= 5 || this.owner.collisionTimer >= 1){
        (this.owner as any).blockingTimer = 0;
        this.owner.collisionTimer = 0;
      }
  
      const point = this.computedPath.points[0];
      if(point){
        let pointDistance = Utility.Distance2D(this.owner.position, point.vector);
        if(pointDistance > (this.computedPath.points.length > 1 ? 0.5 : range)){
          const tangent = point.vector.clone().sub(this.owner.position.clone());
          const atan = Math.atan2(-tangent.y, -tangent.x);
          this.owner.setFacing(atan + Math.PI/2, false, TURN_SPEED_FAST);
          this.owner.forceVector.x = Math.cos(atan);
          this.owner.forceVector.y = Math.sin(atan);
    
          this.runCreatureAvoidance(delta, this.target_position, this.target);

          this.owner.forceVector.negate();
          this.owner.force = 1;//Math.min( 1, Math.max( 0.5, ( ( distanceToTarget - arrivalDistance ) / 1 ) ) );
          // this.owner.walk = !run;
          this.owner.setAnimationState(run ? ModuleCreatureAnimState.RUNNING : ModuleCreatureAnimState.WALKING);
          this.watchProgress(delta);
        }else{
          this.computedPath.pop();
        }
      }
  
      if(this.computedPath.timer < 0){
        if(this.computedPath.realtime){
          this.setComputedPath(undefined);
        }
      }else{
        this.computedPath.timer -= 10*delta;
      }

      const timeout = this.getParameter<number>(8) - delta;
      if(timeout <= 0){
        const fallback_action = new GameState.ActionFactory.ActionJumpToPoint(undefined, this.groupId);
        fallback_action.setParameter(0, ActionParameterType.FLOAT, this.real_target_position.x);
        fallback_action.setParameter(1, ActionParameterType.FLOAT, this.real_target_position.y);
        fallback_action.setParameter(2, ActionParameterType.FLOAT, this.real_target_position.z);
        fallback_action.setParameter(3, ActionParameterType.DWORD, GameState.module.area.id);
        fallback_action.setParameter(4, ActionParameterType.INT, 0);
        fallback_action.setParameter(5, ActionParameterType.FLOAT, 20.0);
        fallback_action.setParameter(6, ActionParameterType.FLOAT, 0);//target.rotation.x);
        fallback_action.setParameter(7, ActionParameterType.FLOAT, 0)//target.rotation.y);
        this.owner.actionQueue.addFront(fallback_action);
        return ActionStatus.FAILED;
      }
      this.setParameter(8, timeout);

      return ActionStatus.IN_PROGRESS;
    }else{
      this.owner.setAnimationState(ModuleCreatureAnimState.IDLE);
      this.owner.force = 0;
      this.owner.speed = 0;
      this.setComputedPath(undefined);
      return ActionStatus.COMPLETE;
    }

    this.setComputedPath(undefined);
    return ActionStatus.FAILED;
  }

  /**
   * Walking to melee reach of a creature (a short range) and, within a little more than that, not getting any
   * closer for a moment: the spots around it are taken. Without this it slid round the crowd for good (and
   * everyone after a target in a melee did, the whole fight)
   */
  closeAsItGets(delta: number, range: number): boolean {
    if(!BitWise.InstanceOfObject(this.target, ModuleObjectType.ModuleCreature) || range > ActionMoveToPoint.MELEE_RANGE_MAX){
      return false;
    }
    const toTarget = Utility.Distance2D(this.owner.position, this.target.position);
    if(toTarget > range + ActionMoveToPoint.CROWD_SLACK){
      this.closestToTarget = undefined;
      return false;
    }
    if(this.closestToTarget === undefined || toTarget < this.closestToTarget - ActionMoveToPoint.CLOSING_DISTANCE){
      this.closestToTarget = toTarget;
      this.closingTime = 0;
      return false;
    }
    this.closingTime += delta;
    return this.closingTime >= ActionMoveToPoint.CLOSING_SECONDS;
  }

  /** Moves this short are closing to melee */
  static MELEE_RANGE_MAX = 3;
  /** Metres past the range a crowded approach may stop at */
  static CROWD_SLACK = 1.2;
  /** Closer by this... */
  static CLOSING_DISTANCE = 0.3;
  /** ...within this many seconds, or it's as close as it gets */
  static CLOSING_SECONDS = 0.8;
  closestToTarget: number | undefined;
  closingTime = 0;

  /**
   * Walking into something the path didn't know about (a prop, a crowd) and getting nowhere: step aside,
   * alternating sides, and find the way from there
   */
  watchProgress(delta: number){
    if(!this.progressFrom){
      this.progressFrom = this.owner.position.clone();
      this.stuckTime = 0;
      return;
    }
    if(Utility.Distance2D(this.owner.position, this.progressFrom) >= ActionMoveToPoint.PROGRESS_DISTANCE){
      this.progressFrom.copy(this.owner.position);
      this.stuckTime = 0;
      return;
    }
    this.stuckTime += delta;
    if(this.stuckTime < ActionMoveToPoint.STUCK_SECONDS) return;
    this.stuckTime = 0;
    this.progressFrom.copy(this.owner.position);
    this.sidestep();
  }

  sidestep(){
    const owner = this.owner;
    const area = owner?.area;
    if(!area) return;
    const next = this.computedPath?.points[0]?.vector || this.target_position;
    const ahead = new THREE.Vector3(next.x - owner.position.x, next.y - owner.position.y, 0);
    if(ahead.lengthSq() < 1e-6) ahead.set(0, 1, 0);
    ahead.normalize();
    const sides = this.sidestepLeft ? [1, -1] : [-1, 1];
    this.sidestepLeft = !this.sidestepLeft;
    for(const side of sides){
      // Sideways and a little back, away from what it walked into
      const step = new THREE.Vector3(-ahead.y * side, ahead.x * side, 0).multiplyScalar(ActionMoveToPoint.SIDESTEP_DISTANCE).addScaledVector(ahead, -0.5);
      const aside = area.getNearestWalkablePoint(owner.position.clone().add(step), owner.getHitDistance());
      if(Utility.Distance2D(aside, owner.position) < 0.5) continue;
      const from = PathPoint.FromVector3(owner.position); from.setArea(area);
      const to = PathPoint.FromVector3(aside); to.setArea(area);
      if(!from.hasLOS(to, owner)) continue;
      const path = ComputedPath.FromVector3List([owner.position.clone(), aside]);
      const onward = area.path.traverseToPoint(owner, aside, this.target_position);
      path.merge(onward);
      path.fixWalkEdges(owner.getHitDistance());
      path.setOwner?.(owner);
      path.setColor(owner.helperColor);
      if(BitWise.InstanceOfObject(this.target, ModuleObjectType.ModuleCreature)) path.realtime = true;
      path.timer = 20;
      this.setComputedPath(path);
      return;
    }
  }

  calculatePath(){
    if(!BitWise.InstanceOfObject(this.owner, ModuleObjectType.ModuleCreature)) return;

    const path = GameState.module.area.path.traverseToPoint(this.owner, this.owner.position, this.target_position);
    path.fixWalkEdges(this.owner.getHitDistance());
    path.setColor(this.owner.helperColor);
    if(BitWise.InstanceOfObject(this.target, ModuleObjectType.ModuleCreature)){
      path.realtime = true;
    }
    path.timer = 20;
    this.setComputedPath(path);
  }

  dispose(): void {
    super.dispose();
    if(this.owner.getComputedPath() == this.computedPath){
      this.owner.setComputedPath(undefined);
    }
    this.computedPath = undefined;
  }

}

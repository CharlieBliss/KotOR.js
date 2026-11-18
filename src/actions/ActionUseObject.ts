import { ModuleObjectType } from "@/enums";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { ActionStatus } from "@/enums/actions/ActionStatus";
import { ActionType } from "@/enums/actions/ActionType";
import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import { GameState } from "@/GameState";
import type { ModuleObject } from "@/module/ModuleObject";
import type { ModuleCreature } from "@/module/ModuleCreature";
import { MOVE_FLAG_RUN, MOVE_FLAG_TARGET_MAY_BE_DEAD } from "@/actions/ActionMoveToPoint";

/** How close (in metres) to an object, or to a creature's edge, a character must be to use it */
const USE_RANGE = 1.5;
import { BitWise } from "@/utility/BitWise";
import { Utility } from "@/utility/Utility";
import { Action } from "@/actions/Action";

/**
 * ActionUseObject class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file ActionUseObject.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class ActionUseObject extends Action {

  constructor( actionId: number = -1, groupId: number = -1 ){
    super(actionId, groupId);
    this.type = ActionType.ActionUseObject;

    //PARAMS
    // 0 - dword: object id
    
  }

  update(delta: number = 0): ActionStatus {

    this.target = this.getParameter<ModuleObject>(0);

    if(!BitWise.InstanceOfObject(this.target, ModuleObjectType.ModuleObject)){
      return ActionStatus.FAILED;
    }

    // Within reach of a creature means of its edge, not its centre: someone else may be standing on a body
    const useRange = USE_RANGE + (BitWise.InstanceOfObject(this.target, ModuleObjectType.ModuleCreature) ? this.target.getHitDistance() : 0);
    let distance = Utility.Distance2D(this.owner.position, this.target.position);
    if(distance > useRange){
        
      // this.owner.openSpot = undefined;
      let actionMoveToTarget = new GameState.ActionFactory.ActionMoveToPoint();
      actionMoveToTarget.setParameter(0, ActionParameterType.FLOAT, this.target.position.x);
      actionMoveToTarget.setParameter(1, ActionParameterType.FLOAT, this.target.position.y);
      actionMoveToTarget.setParameter(2, ActionParameterType.FLOAT, this.target.position.z);
      actionMoveToTarget.setParameter(3, ActionParameterType.DWORD, GameState.module.area.id);
      actionMoveToTarget.setParameter(4, ActionParameterType.DWORD, this.target.id);
      // Moving to a dead creature normally fails at once (so combat doesn't chase the dead);
      // using a body (looting it) has to be able to walk over to it
      const targetIsBody = BitWise.InstanceOfObject(this.target, ModuleObjectType.ModuleCreature) && (this.target as ModuleCreature).isDead();
      actionMoveToTarget.setParameter(5, ActionParameterType.INT, MOVE_FLAG_RUN | (targetIsBody ? MOVE_FLAG_TARGET_MAY_BE_DEAD : 0));
      actionMoveToTarget.setParameter(6, ActionParameterType.FLOAT, useRange );
      actionMoveToTarget.setParameter(7, ActionParameterType.INT, 0);
      actionMoveToTarget.setParameter(8, ActionParameterType.FLOAT, 30.0);
      this.owner.actionQueue.addFront(actionMoveToTarget);

      return ActionStatus.IN_PROGRESS;
    }else{
      this.owner.setAnimationState(ModuleCreatureAnimState.IDLE);
      this.owner.force = 0;
      this.owner.speed = 0;
      //console.log(this.target);

      // Something to sit on: sit in it (GM mode), instead of using it
      if(GameState.hooks.useSeat(this.owner, this.target)){
        return ActionStatus.COMPLETE;
      }

      this.owner.setFacingObject( this.target );

      if(this.target != GameState.PartyManager.Player){
        this.target.use(this.owner);
      }

      return ActionStatus.COMPLETE;
    }
    return ActionStatus.FAILED;
  }

}

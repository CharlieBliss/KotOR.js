import { GameState } from "@/GameState";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { ActionStatus } from "@/enums/actions/ActionStatus";
import { ActionType } from "@/enums/actions/ActionType";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ModuleTriggerType } from "@/enums/module/ModuleTriggerType";
import { ResourceLoader } from "@/loaders/ResourceLoader";
import type { ModuleObject } from "@/module/ModuleObject";
import type { ModuleTrigger } from "@/module/ModuleTrigger";
import { GFFObject } from "@/resource/GFFObject";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { BitWise } from "@/utility/BitWise";
import { Utility } from "@/utility/Utility";
import { Action } from "@/actions/Action";

/**
 * ActionRecoverMine class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file ActionRecoverMine.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */

export class ActionRecoverMine extends Action {

  constructor( actionId: number = -1, groupId: number = -1 ){
    super(actionId, groupId);
    this.type = ActionType.ActionRecoverMine;

    //PARAMS - unknown
    //0 - DWORD: oTarget
  }

  update(delta?: number): ActionStatus {

    this.target = this.getParameter<ModuleObject>(0);
    if(!this.target){
      return ActionStatus.FAILED;
    }

    if(BitWise.InstanceOfObject(this.owner, ModuleObjectType.ModuleCreature)){
      let distance = Utility.Distance2D(this.owner.position, this.target.position);
            
      if(distance > 3){
        // this.owner.openSpot = undefined;
        let actionMoveToTarget = new GameState.ActionFactory.ActionMoveToPoint();
        actionMoveToTarget.setParameter(0, ActionParameterType.FLOAT, this.target.position.x);
        actionMoveToTarget.setParameter(1, ActionParameterType.FLOAT, this.target.position.y);
        actionMoveToTarget.setParameter(2, ActionParameterType.FLOAT, this.target.position.z);
        actionMoveToTarget.setParameter(3, ActionParameterType.DWORD, this.target.area.id);
        actionMoveToTarget.setParameter(4, ActionParameterType.DWORD, this.target.id);
        actionMoveToTarget.setParameter(5, ActionParameterType.INT, 1);
        actionMoveToTarget.setParameter(6, ActionParameterType.FLOAT, 3 );
        actionMoveToTarget.setParameter(7, ActionParameterType.INT, 0);
        actionMoveToTarget.setParameter(8, ActionParameterType.FLOAT, 30.0);
        this.owner.actionQueue.addFront(actionMoveToTarget);

        return ActionStatus.IN_PROGRESS;
      }

      if(BitWise.InstanceOfObject(this.target, ModuleObjectType.ModuleTrigger)){
        const trap: ModuleTrigger = this.target as any;
        if(trap.type != ModuleTriggerType.TRAP){
          return ActionStatus.FAILED;
        }


        // Demolitions (d20 + skill) against the mine's DC; a failed try leaves it where it is
        const roll = 1 + Math.floor(Math.random() * 20);
        const skill = (this.owner as any).getSkillLevel?.(1) || 0;
        const success = roll + skill >= trap.getRecoverDC();
        GameState.hooks.announceSkillRoll(this.owner, 'Recover mine', roll, skill, trap.getRecoverDC(), success);
        if(!success){
          return ActionStatus.COMPLETE;
        }

        // The mine goes back into the inventory as its item (traps.2da resref, an item template)
        const resRef = String(trap.trapResRef || trap.getTrapRow()?.resref || '');
        trap.destroy();
        if(resRef && resRef !== '****'){
          if(GameState.hooks.giveRecoveredMine(this.owner, resRef)) return ActionStatus.COMPLETE;
          ResourceLoader.loadResource(ResourceTypes['uti'], resRef).then((buffer) => {
            if(!buffer) return;
            const item = new GameState.Module.ModuleArea.ModuleItem(new GFFObject(buffer));
            item.inventoryRes = resRef;
            item.initProperties();
            this.owner.addItem(item);
          }).catch(() => {});
        }
      }

      return ActionStatus.COMPLETE;
    }
    
    return ActionStatus.FAILED;
  }

}
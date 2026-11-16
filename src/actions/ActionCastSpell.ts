import { Action } from "@/actions/Action";
import { SpellCastInstance } from "@/combat";
import { ModuleObjectType } from "@/enums";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { ActionStatus } from "@/enums/actions/ActionStatus";
import { ActionType } from "@/enums/actions/ActionType";
import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import { ModuleObjectConstant } from "@/enums/module/ModuleObjectConstant";
import { GameState } from "@/GameState";
import { BitWise } from "@/utility/BitWise";
import type { ModuleObject } from "@/module/ModuleObject";

/**
 * ActionCastSpell class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file ActionCastSpell.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class ActionCastSpell extends Action {
  
  spell: any = {}

  constructor( actionId: number = -1, groupId: number = -1 ){
    super(actionId, groupId);
    this.type = ActionType.ActionCastSpell;

    //PARAMS
    // 0 - int: nSpellId
    // 1 - int: Unknown: -1 if cheat enabled
    // 2 - int: nDomainLevel
    // 3 - int: Unknown: Always 0?
    // 4 - int: Unknown: Always 0?
    // 5 - dword: target object id
    // 6 - float: target x
    // 7 - float: target y
    // 8 - float: target z
    // 9 - int: nProjectilePath
    // 10 - int: Unknown: Always -1?
    // 11 - int: Unknown: -1 if cheat enabled

  }

  update(delta: number = 0): ActionStatus {
    this.target = this.getParameter<ModuleObject>(5) || this.owner?.combatRound?.action?.target || this.owner;
    const spellId = this.getParameter<number>(0);
    this.spell = this.owner?.combatRound?.action?.spell || new GameState.TalentSpell(spellId);

    if(this.spell){
      if(this.target && !this.spell.inRange(this.target, this.owner)){

        let actionMoveToTarget = new GameState.ActionFactory.ActionMoveToPoint(this.groupId);
        actionMoveToTarget.setParameter(0, ActionParameterType.FLOAT, this.target.position.x);
        actionMoveToTarget.setParameter(1, ActionParameterType.FLOAT, this.target.position.y);
        actionMoveToTarget.setParameter(2, ActionParameterType.FLOAT, this.target.position.z);
        actionMoveToTarget.setParameter(3, ActionParameterType.DWORD, GameState.module.area.id);
        actionMoveToTarget.setParameter(4, ActionParameterType.DWORD, this.target ? this.target.id : ModuleObjectConstant.OBJECT_INVALID);
        actionMoveToTarget.setParameter(5, ActionParameterType.INT, 1);
        actionMoveToTarget.setParameter(6, ActionParameterType.FLOAT, this.spell.getCastRange() );
        actionMoveToTarget.setParameter(7, ActionParameterType.INT, 0);
        actionMoveToTarget.setParameter(8, ActionParameterType.FLOAT, 30.0);
        this.owner.actionQueue.addFront(actionMoveToTarget);

        return ActionStatus.IN_PROGRESS;

      }else{
        if(BitWise.InstanceOfObject(this.owner, ModuleObjectType.ModuleCreature)){
          this.owner.force = 0;
          this.owner.speed = 0;
          if(this.target && this.target != this.owner){
            this.owner.setFacingObject(this.target);
          }
        }

        if(this.owner.combatRound){
          const combatRound = this.owner.combatRound;
          if(!combatRound.roundPaused) {
            
            combatRound.beginCombatRound();
            combatRound.pauseRound(this.owner, combatRound.roundLength);
            if(combatRound.action){
              combatRound.action.animation = this.target == this.owner ? ModuleCreatureAnimState.CASTOUT2 : ModuleCreatureAnimState.CASTOUT1;
            }

            if(combatRound.roundStarted){
              const spellTarget = combatRound.action?.target || this.target;
              const spellTalent = combatRound.action?.spell || this.spell;
              const spellCastInstance = new SpellCastInstance(this.owner, spellTarget, spellTalent);
              if(this.owner.area && typeof this.owner.area.attachSpellInstance === 'function'){
                this.owner.area.attachSpellInstance(spellCastInstance);
              }
              spellCastInstance.init();

              return ActionStatus.COMPLETE;
            }

          }
          return ActionStatus.IN_PROGRESS;
        }else{
          const spellCastInstance = new SpellCastInstance(this.owner, this.target, this.spell);
          if(this.owner?.area && typeof this.owner.area.attachSpellInstance === 'function'){
            this.owner.area.attachSpellInstance(spellCastInstance);
          }
          spellCastInstance.init();
          return ActionStatus.COMPLETE;
        }
      }
    }

    return ActionStatus.FAILED;
  }

}

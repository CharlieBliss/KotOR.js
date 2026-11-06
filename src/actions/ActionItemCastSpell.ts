import { ActionStatus } from "@/enums/actions/ActionStatus";
import { ActionType } from "@/enums/actions/ActionType";
import { Action } from "@/actions/Action";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { ModuleObjectConstant } from "@/enums/module/ModuleObjectConstant";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import { SpellCastInstance } from "@/combat";
import { GameState } from "@/GameState";
import { BitWise } from "@/utility/BitWise";
import type { ModuleObject } from "@/module/ModuleObject";
import type { ModuleItem } from "@/module/ModuleItem";

/**
 * ActionItemCastSpell class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file ActionItemCastSpell.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class ActionItemCastSpell extends Action {

  spell: any = {}

  constructor( actionId: number = -1, groupId: number = -1 ){
    super(actionId, groupId);
    this.type = ActionType.ActionItemCastSpell;

    //PARAMS - need to verify!! https://github.com/nwnxee/unified/blob/2f732e7f5e278e4de848d119bf3689dc928f2ab2/Plugins/Creature/Creature.cpp#L2846
    // 0 - dword: oTarget
    // 1 - dword: oArea
    // 2 - float: x
    // 3 - float: y
    // 4 - float: z
    // 5 - int: spellId
    // 6 - int: casterLevel
    // 7 - float: delay
    // 8 - int: projectilePath
    // 9 - int: projectileSpellId
    // 10 - dword: oItem
    // 11 - string: impactScript
  }

  update(delta: number = 0): ActionStatus {
    this.target = this.getParameter<ModuleObject>(0) || this.owner?.combatRound?.action?.target || this.owner;
    const spellId = this.getParameter<number>(5);
    const item = this.getParameter<ModuleItem>(10) || this.owner?.combatRound?.action?.item;
    this.spell = this.owner?.combatRound?.action?.spell || new GameState.TalentSpell(spellId);
    if(this.spell && item){
      this.spell.item = item;
    }

    if(!this.spell){
      return ActionStatus.FAILED;
    }

    if(this.target && !this.spell.inRange(this.target, this.owner)){
      let actionMoveToTarget = new GameState.ActionFactory.ActionMoveToPoint(this.groupId);
      actionMoveToTarget.setParameter(0, ActionParameterType.FLOAT, this.target.position.x);
      actionMoveToTarget.setParameter(1, ActionParameterType.FLOAT, this.target.position.y);
      actionMoveToTarget.setParameter(2, ActionParameterType.FLOAT, this.target.position.z);
      actionMoveToTarget.setParameter(3, ActionParameterType.DWORD, GameState.module?.area?.id || ModuleObjectConstant.OBJECT_INVALID);
      actionMoveToTarget.setParameter(4, ActionParameterType.DWORD, this.target ? this.target.id : ModuleObjectConstant.OBJECT_INVALID);
      actionMoveToTarget.setParameter(5, ActionParameterType.INT, 1);
      actionMoveToTarget.setParameter(6, ActionParameterType.FLOAT, this.spell.getCastRange());
      actionMoveToTarget.setParameter(7, ActionParameterType.INT, 0);
      actionMoveToTarget.setParameter(8, ActionParameterType.FLOAT, 30.0);
      this.owner.actionQueue.addFront(actionMoveToTarget);

      return ActionStatus.IN_PROGRESS;
    }

    if(BitWise.InstanceOfObject(this.owner, ModuleObjectType.ModuleCreature)){
      this.owner.force = 0;
      this.owner.speed = 0;
      if(this.target && this.target != this.owner){
        this.owner.setFacingObject(this.target);
      }
    }

    if(this.owner.combatRound){
      const combatRound = this.owner.combatRound;
      if(!combatRound.roundPaused){
        combatRound.beginCombatRound();
        combatRound.pauseRound(this.owner, combatRound.roundLength);
        if(combatRound.action){
          combatRound.action.animation = this.target == this.owner ? ModuleCreatureAnimState.CASTOUT2 : ModuleCreatureAnimState.THROW_HIGH;
        }

        if(combatRound.roundStarted){
          const spellTarget = combatRound.action?.target || this.target;
          const spellTalent = combatRound.action?.spell || this.spell;
          const spellCastInstance = new SpellCastInstance(this.owner, spellTarget, spellTalent);
          spellCastInstance.item = item;
          if(this.owner.area && typeof this.owner.area.attachSpellInstance === 'function'){
            this.owner.area.attachSpellInstance(spellCastInstance);
          }
          spellCastInstance.init();

          return ActionStatus.COMPLETE;
        }
      }
      return ActionStatus.IN_PROGRESS;
    }

    return ActionStatus.FAILED;
  }

}

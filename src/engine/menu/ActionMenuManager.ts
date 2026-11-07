import { GameState } from "@/GameState";
import { ActionMenuPanel } from "@/engine/menu/ActionMenuPanel";
import { ActionMenuItem } from "@/engine/menu/ActionMenuItem";
import type { ModuleObject } from "@/module/ModuleObject";
import type { ModuleCreature } from "@/module/ModuleCreature";
import type { ModuleItem } from "@/module/ModuleItem";
import { IActionPanelLists } from "@/interface/gui/IActionPanelLists";
import { GameEngineType } from "@/enums/engine/GameEngineType";
import { ActionType } from "@/enums/actions/ActionType";
import { SkillType } from "@/enums/nwscript/SkillType";
import { ActionParameterType, ModuleObjectConstant, ModuleTriggerType } from "@/enums";
import { TalentObject } from "@/talents/TalentObject";

/**
 * ActionMenuManager class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file ActionMenuManager.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class ActionMenuManager {

  static ActionMenuPanel: typeof ActionMenuPanel = ActionMenuPanel;
  static ActionMenuItem: typeof ActionMenuItem = ActionMenuItem;

  static TARGET_MENU_COUNT = 3;
  static SELF_MENU_COUNT = 4;

  static oPC: ModuleCreature;
  static oTarget: ModuleObject;

  static ActionPanels: IActionPanelLists = {
    targetPanels: [],
    selfPanels: [],
  };
  
  static SetPC(oPC: ModuleCreature){
    ActionMenuManager.oPC = oPC;
  }
  
  static SetTarget(oTarget: ModuleObject){
    ActionMenuManager.oTarget = oTarget;
  }

  static InitActionMenuPanels(){
    ActionMenuManager.TARGET_MENU_COUNT = 3;
    ActionMenuManager.SELF_MENU_COUNT = (GameState.GameKey == GameEngineType.KOTOR ? 4 : 6);
    ActionMenuManager.ActionPanels = {
      targetPanels: [],
      selfPanels: [],
    };
    
    for(let i = 0; i < ActionMenuManager.TARGET_MENU_COUNT; i++){
      ActionMenuManager.ActionPanels.targetPanels[i] = new GameState.ActionMenuManager.ActionMenuPanel();
    }
    
    for(let i = 0; i < ActionMenuManager.SELF_MENU_COUNT; i++){
      ActionMenuManager.ActionPanels.selfPanels[i] = new GameState.ActionMenuManager.ActionMenuPanel();
    }
  }

  static UpdateMenuActions(){
    for(let i = 0; i < ActionMenuManager.TARGET_MENU_COUNT; i++){
      ActionMenuManager.ActionPanels.targetPanels[i].clearActions();
    }
    
    for(let i = 0; i < ActionMenuManager.SELF_MENU_COUNT; i++){
      ActionMenuManager.ActionPanels.selfPanels[i].clearActions();
    }

    const securityTalent = ActionMenuManager.oPC.skills[SkillType.SECURITY];
    const ranks = (skill: SkillType) => ActionMenuManager.oPC.getSkillRanks?.(skill) ?? ActionMenuManager.oPC.getSkillLevel(skill);
    const bHasSecuritySkill = ranks(SkillType.SECURITY) >= 1;
    const bHasDemolitionsSkill = ranks(SkillType.DEMOLITIONS) >= 1;

    if(ActionMenuManager.oTarget instanceof GameState.Module.ModuleArea.ModuleObject){

      if(ActionMenuManager.oTarget instanceof GameState.Module.ModuleArea.ModulePlaceable){
        if(ActionMenuManager.oTarget.isLocked()){
          if(bHasSecuritySkill){
            const action = new GameState.ActionFactory.ActionUnlockObject();
            action.setOwner(ActionMenuManager.oPC as ModuleObject);
            action.setParameter(0, ActionParameterType.DWORD, this.oTarget);
            action.setParameter(1, ActionParameterType.DWORD, ModuleObjectConstant.OBJECT_INVALID);
            ActionMenuManager.ActionPanels.targetPanels[1].addAction(new GameState.ActionMenuManager.ActionMenuItem({
              action: action,
              icon: securityTalent.getIcon()
            }));
          }

          const securityTunnelers = ActionMenuManager.oPC.getInventory().filter((item) => {
            return item.baseItemId == 59
          });

          if(securityTunnelers.length){
            const item = securityTunnelers[0];
            
            const action = new GameState.ActionFactory.ActionUnlockObject();
            action.setOwner(ActionMenuManager.oPC as ModuleObject);
            action.setParameter(0, ActionParameterType.DWORD, this.oTarget);
            action.setParameter(1, ActionParameterType.DWORD, securityTunnelers[0]);
            ActionMenuManager.ActionPanels.targetPanels[1].addAction(new GameState.ActionMenuManager.ActionMenuItem({
              action: action,
              icon: item.getIcon()
            }));
          }
          
          if(!this.oTarget?.notBlastable){
            ActionMenuManager.ActionPanels.targetPanels[0].addAction(new GameState.ActionMenuManager.ActionMenuItem({
              action: {
                type: ActionType.ActionPhysicalAttacks,
                object: ActionMenuManager.oTarget,
                talent: undefined
              },
              icon: 'i_attack'
            }));
          }

          if(!ActionMenuManager.oTarget?.notBlastable){
            const mineList = ActionMenuManager.oPC.getInventory().filter((item) => {
              return item.baseItemId == 58
            });
            for(let i = 0, len = mineList.length; i < len; i++){
              const item = mineList[i];
              const setMine = new GameState.ActionFactory.ActionSetMine();
              setMine.setOwner(ActionMenuManager.oPC as ModuleObject);
              setMine.setTarget(ActionMenuManager.oTarget as ModuleObject);
              setMine.setParameter(0, ActionParameterType.DWORD, item);
              setMine.setParameter(1, ActionParameterType.DWORD, ActionMenuManager.oTarget);
              setMine.setParameter(2, ActionParameterType.FLOAT, ActionMenuManager.oTarget.position.x);
              setMine.setParameter(3, ActionParameterType.FLOAT, ActionMenuManager.oTarget.position.y);
              setMine.setParameter(4, ActionParameterType.FLOAT, ActionMenuManager.oTarget.position.z);
              ActionMenuManager.ActionPanels.targetPanels[2].addAction(new GameState.ActionMenuManager.ActionMenuItem({
                action: setMine,
                icon: item.getIcon()
              }));
            }
          }
        }
      }else if(ActionMenuManager.oTarget instanceof GameState.Module.ModuleArea.ModuleDoor){
        if(ActionMenuManager.oTarget.isLocked()){
          if(bHasSecuritySkill){
            const action = new GameState.ActionFactory.ActionUnlockObject();
            action.setOwner(ActionMenuManager.oPC as ModuleObject);
            action.setParameter(0, ActionParameterType.DWORD, this.oTarget);
            action.setParameter(1, ActionParameterType.DWORD, ModuleObjectConstant.OBJECT_INVALID);

            ActionMenuManager.ActionPanels.targetPanels[1].addAction(new GameState.ActionMenuManager.ActionMenuItem({
              action: action,
              icon: securityTalent.getIcon()
            }));
          }

          const securityTunnelers = this.oPC.getInventory().filter((item) => {
            return item.baseItemId == 59
          });

          if(securityTunnelers.length){
            const item = securityTunnelers[0];
            
            const action = new GameState.ActionFactory.ActionUnlockObject();
            action.setOwner(ActionMenuManager.oPC as ModuleObject);
            action.setParameter(0, ActionParameterType.DWORD, this.oTarget);
            action.setParameter(1, ActionParameterType.DWORD, securityTunnelers[0]);
            ActionMenuManager.ActionPanels.targetPanels[1].addAction(new GameState.ActionMenuManager.ActionMenuItem({
              action: action,
              icon: item.getIcon()
            }));
          }
          
          if(!this.oTarget?.notBlastable){
            ActionMenuManager.ActionPanels.targetPanels[0].addAction(new GameState.ActionMenuManager.ActionMenuItem({
              action: {
                type: ActionType.ActionPhysicalAttacks,
                object: ActionMenuManager.oTarget,
                talent: undefined
              },
              icon: 'i_attack'
            }));
          }

          const mineList = this.oPC.getInventory().filter((item) => {
            return item.baseItemId == 58
          });

          if(!this.oTarget?.notBlastable){
            for(let i = 0, len = mineList.length; i < len; i++){
              const item = mineList[i];
              const setMine = new GameState.ActionFactory.ActionSetMine();
              setMine.setOwner(ActionMenuManager.oPC as ModuleObject);
              setMine.setTarget(ActionMenuManager.oTarget as ModuleObject);
              setMine.setParameter(0, ActionParameterType.DWORD, item);
              setMine.setParameter(1, ActionParameterType.DWORD, ActionMenuManager.oTarget);
              setMine.setParameter(2, ActionParameterType.FLOAT, ActionMenuManager.oTarget.position.x);
              setMine.setParameter(3, ActionParameterType.FLOAT, ActionMenuManager.oTarget.position.y);
              setMine.setParameter(4, ActionParameterType.FLOAT, ActionMenuManager.oTarget.position.z);
              ActionMenuManager.ActionPanels.targetPanels[2].addAction(new GameState.ActionMenuManager.ActionMenuItem({
                action: setMine,
                icon: item.getIcon()
              }));
            }
          }
        }
      }else if(ActionMenuManager.oTarget instanceof GameState.Module.ModuleArea.ModuleCreature && ActionMenuManager.oTarget.isHostile(ActionMenuManager.oPC as ModuleObject)){
        ActionMenuManager.ActionPanels.targetPanels[0].addAction(new GameState.ActionMenuManager.ActionMenuItem({
          action: {
            type: ActionType.ActionPhysicalAttacks,
            object: ActionMenuManager.oTarget,
            talent: undefined
          },
          icon: 'i_attack'
        }));

        if(ActionMenuManager.oPC.getEquippedWeaponType() == 1){
          //category = 0x1104
          const feats = ActionMenuManager.oPC.getFeats().filter( (f: any, i:number, array: any[]) => { 
            return f.category == 0x1104 && (
              f.successor == '****' || 
              (!array.find( (f2: any) => f2.__index == f.successor))
            ) 
          });

          for(let i = 0, len = feats.length; i < len; i++){
            const feat = feats[i];
            ActionMenuManager.ActionPanels.targetPanels[0].addAction(new GameState.ActionMenuManager.ActionMenuItem({
              talent: feat,
              icon: feat.icon
            }));
          }

        }

        if(ActionMenuManager.oPC.getEquippedWeaponType() == 4){
          //category = 0x1111
          const feats = ActionMenuManager.oPC.getFeats().filter( (f: any, i:number, array: any[]) => { 
            return f.category == 0x1111 && (
              f.successor == '****' || 
              (!array.find( (f2: any) => f2.__index == f.successor))
            ) 
          });

          for(let i = 0, len = feats.length; i < len; i++){
            const feat = feats[i];
            ActionMenuManager.ActionPanels.targetPanels[0].addAction(new GameState.ActionMenuManager.ActionMenuItem({
              talent: feat,
              icon: feat.icon
            }));
          }

        }

        const hostileSpells = ActionMenuManager.oPC.getSpells().filter( (s: any) => {
          return !isNaN(parseInt(s.forcehostile));
        });

        for(let i = 0; i < hostileSpells.length; i++){
          ActionMenuManager.ActionPanels.targetPanels[1].addAction(new GameState.ActionMenuManager.ActionMenuItem({
            talent: hostileSpells[i],
            target: ActionMenuManager.oTarget,
            icon: hostileSpells[i].iconresref
          }));
        }

        for(const item of ActionMenuManager.getUsableItems('hostile')){
          ActionMenuManager.ActionPanels.targetPanels[2].addAction(new GameState.ActionMenuManager.ActionMenuItem({
            item,
            target: ActionMenuManager.oTarget,
            icon: item.getIcon()
          }));
        }

      }else if(ActionMenuManager.oTarget instanceof GameState.Module.ModuleArea.ModuleTrigger){
        if(ActionMenuManager.oTarget.type == ModuleTriggerType.TRAP){
          /**
           * Disarm Mine
           */
          if(bHasDemolitionsSkill && ActionMenuManager.oTarget.trapDisarmable){
            const action = new GameState.ActionFactory.ActionDisarmMine();
            action.setOwner(ActionMenuManager.oPC as ModuleObject);
            action.setParameter(0, ActionParameterType.DWORD, this.oTarget);
            ActionMenuManager.ActionPanels.targetPanels[0].addAction(new GameState.ActionMenuManager.ActionMenuItem({
              action: action,
              icon: 'gui_mp_dismined'
            }));
          }

          /**
           * Recover Mine
           */
          if(bHasDemolitionsSkill){
            const action = new GameState.ActionFactory.ActionRecoverMine();
            action.setOwner(ActionMenuManager.oPC as ModuleObject);
            action.setParameter(0, ActionParameterType.DWORD, this.oTarget);
            ActionMenuManager.ActionPanels.targetPanels[1].addAction(new GameState.ActionMenuManager.ActionMenuItem({
              action: action,
              icon: 'gui_mp_recmined'
            }));
          }
        }
      }

    }

    const friendlySpells = ActionMenuManager.oPC.getSpells().filter( (s: any) => {
      return !isNaN(parseInt(s.forcefriendly));
    });

    for(let i = 0; i < friendlySpells.length; i++){
      ActionMenuManager.ActionPanels.selfPanels[1].addAction(new GameState.ActionMenuManager.ActionMenuItem({
        talent: friendlySpells[i],
        target: ActionMenuManager.oPC,
        icon: friendlySpells[i].iconresref
      }));
    }

    if(ActionMenuManager.oPC.canEnterStealth?.() || ActionMenuManager.oPC.stealthMode){
      ActionMenuManager.ActionPanels.selfPanels[0].addAction(new GameState.ActionMenuManager.ActionMenuItem({
        action: { type: ActionMenuManager.STEALTH_ACTION },
        target: ActionMenuManager.oPC,
        icon: ActionMenuManager.oPC.skills?.[SkillType.STEALTH]?.getIcon?.() || ''
      }));
    }

    // Mines carried can be laid in front of you
    const minesToLay = new Set<string>();
    for(const item of ActionMenuManager.oPC.getInventory?.() || []){
      if(item?.baseItemId != 58 || minesToLay.has(item.getItemResRef())) continue;
      minesToLay.add(item.getItemResRef());
      const layMine = new GameState.ActionFactory.ActionSetMine();
      layMine.setOwner(ActionMenuManager.oPC as ModuleObject);
      layMine.setParameter(0, ActionParameterType.DWORD, item);
      layMine.setParameter(1, ActionParameterType.DWORD, ActionMenuManager.oPC);
      ActionMenuManager.ActionPanels.selfPanels[3].addAction(new GameState.ActionMenuManager.ActionMenuItem({
        action: layMine,
        target: ActionMenuManager.oPC,
        icon: item.getIcon()
      }));
    }

    for(const item of ActionMenuManager.getUsableItems('self')){
      ActionMenuManager.ActionPanels.selfPanels[2].addAction(new GameState.ActionMenuManager.ActionMenuItem({
        item,
        target: ActionMenuManager.oPC,
        icon: item.getIcon()
      }));
    }

    return ActionMenuManager.ActionPanels;
  }

  /** The menu entry that toggles stealth (not an engine action type) */
  static STEALTH_ACTION = 'stealth';

  /**
   * Usable items for the menu: what it carries and wears that casts a spell, one entry per kind of item.
   * 'self' items (medpacs, stims, shields) go on the self menu; 'hostile' ones (grenades, droid weapons) on an enemy.
   */
  static getUsableItems(use: 'self' | 'hostile'): ModuleItem[] {
    const pc = ActionMenuManager.oPC;
    if(!pc) return [];
    const items = [...(pc.getInventory?.() || []), ...Object.values(pc.equipment || {})] as ModuleItem[];
    const seen = new Set<string>();
    const out: ModuleItem[] = [];
    for(const item of items){
      if(!item?.getUseTargeting || item.getUseTargeting() !== use) continue;
      const key = item.getItemResRef();
      if(seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  /** Run one menu entry: an attack, a talent, an item, stealth or a queued action */
  static runMenuItem(action: any, target: ModuleObject){
    const pc = ActionMenuManager.oPC;
    if(!pc || !action) return;
    // In a GM session a player's character acts on the GM's machine
    if(GameState.gmMode && GameState.GMManager?.interceptMenuAction?.(pc, action, target)) return;
    if(action.item){
      action.item.useItemOnObject(pc, target);
    }else if(action.action?.type === ActionMenuManager.STEALTH_ACTION){
      pc.setStealthMode(!pc.stealthMode);
    }else if(action.action && action.action.type == ActionType.ActionPhysicalAttacks){
      pc.attackCreature(target, undefined);
    }else if(action.talent instanceof TalentObject){
      action.talent.useTalentOnObject(target, pc);
    }else if(action.action){
      pc.actionQueue.addFront(action.action);
    }
  }

  static targetActionCount(){
    return ActionMenuManager.ActionPanels.targetPanels.reduce(
      (previousValue, currentValue, currentIndex, panels) => {
        return previousValue += currentValue.actions.length;
      }, 0
    );
  }

  static selfActionCount(){
    return ActionMenuManager.ActionPanels.selfPanels.reduce(
      (previousValue, currentValue, currentIndex, panels) => {
        return previousValue += currentValue.actions.length;
      }, 0
    );
  }

  static onTargetMenuAction(index: number = 0){
    if(!ActionMenuManager.oPC){ return; }

    const action = ActionMenuManager.ActionPanels.targetPanels[index].getSelectedAction();
    if(action){
      ActionMenuManager.runMenuItem(action, action.target || ActionMenuManager.oTarget);
    }
  }

  static onSelfMenuAction(index: number = 0){
    if(!ActionMenuManager.oPC){ return; }
    
    const action = ActionMenuManager.ActionPanels.selfPanels[index].getSelectedAction();
    if(!action){ return; }
    ActionMenuManager.runMenuItem(action, ActionMenuManager.oPC);
  }

}

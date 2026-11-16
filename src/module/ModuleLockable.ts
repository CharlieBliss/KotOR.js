import { ModuleObject } from "@/module/ModuleObject";
import { GameState } from "@/GameState";
import { ModuleObjectScript, ModuleObjectType, SkillType } from "@/enums";
import { ModulePlaceableObjectSound } from "@/enums/module/ModulePlaceableObjectSound";
import { SSFType } from "@/enums/resource/SSFType";
import { BitWise } from "@/utility/BitWise";

/**
 * What doors and placeables share: a lock that a key or the Security skill opens, and the sounds
 * (placeableobjsnds.2da) they make when opened, closed, used, locked or destroyed.
 */
export class ModuleLockable extends ModuleObject {

  keyRequired: boolean;
  lockable: boolean;
  locked: boolean;
  openLockDC: number;
  closeLockDC: number;

  isLocked(){
    return this.locked;
  }

  setLocked(value: boolean){
    this.locked = value ? true : false;
  }

  lock(object: ModuleObject){
    if(this.locked){ return; }
    this.locked = true;
    // Doors and placeables name their lock scripts the same way (OnLock)
    this.scripts[ModuleObjectScript.PlaceableOnLock]?.run(this);
  }

  unlock(object: ModuleObject){
    if(!this.locked){ return; }
    this.locked = false;
    this.scripts[ModuleObjectScript.PlaceableOnUnlock]?.run(this);
  }

  /**
   * Try to open the lock with object's Security skill (a check of WIS/2 + Security + 20 against openLockDC;
   * rolls are always 20 outside combat), then use the object whether or not the lock opened
   */
  attemptUnlock(object: ModuleObject){
    if(!BitWise.InstanceOf(object?.objectType, ModuleObjectType.ModuleObject)){
      return false;
    }

    const nSecuritySkill = object.getSkillLevel(SkillType.SECURITY);
    if(this.isLocked() && !this.keyRequired && nSecuritySkill >= 1){
      const d20 = 20;
      const skillCheck = (((object.getWIS()/2) + nSecuritySkill) + d20) - this.openLockDC;
      const isCreature = BitWise.InstanceOf(object?.objectType, ModuleObjectType.ModuleCreature);
      if(skillCheck >= 1){
        this.unlock(object);
        if(isCreature){ object.playSoundSet(SSFType.UNLOCK_SUCCESS); }
      }else if(isCreature){
        object.playSoundSet(SSFType.UNLOCK_FAIL);
      }
    }

    this.use(object);
    return true;
  }

  /** The appearance row whose soundapptype picks this object's sounds */
  getObjectSoundsAppearance(): any {
    return this.getAppearance();
  }

  /** This object's row of placeableobjsnds.2da (every sound '****' when it has none) */
  getObjectSounds(){
    const none = {"__rowlabel":-1,"label":"","armortype":"","opened":"****","closed":"****","destroyed":"****","used":"****","locked":"****"};
    const appearance = this.getObjectSoundsAppearance();
    if(!appearance) return none;

    const soundIdx = appearance.soundapptype;
    if(!isNaN(soundIdx) && soundIdx >= 0){
      const table = GameState.TwoDAManager.datatables.get('placeableobjsnds');
      if(table && typeof table.rows[soundIdx] !== 'undefined'){
        return table.rows[soundIdx];
      }
    }
    return none;
  }

  playObjectSound(type: ModulePlaceableObjectSound){
    if(!this.audioEmitter){
      return;
    }
    const objSounds = this.getObjectSounds();
    const column = ({
      [ModulePlaceableObjectSound.OPENED]: 'opened',
      [ModulePlaceableObjectSound.CLOSED]: 'closed',
      [ModulePlaceableObjectSound.DESTROYED]: 'destroyed',
      [ModulePlaceableObjectSound.USED]: 'used',
      [ModulePlaceableObjectSound.LOCKED]: 'locked',
    } as Record<number, string>)[type];
    if(column && objSounds?.[column] != '****'){
      this.audioEmitter.playSound(objSounds?.[column]);
    }
  }

}

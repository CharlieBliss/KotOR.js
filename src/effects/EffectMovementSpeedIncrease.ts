import { GameEffect } from "@/effects/GameEffect";
import { GameEffectType } from "@/enums/effects/GameEffectType";

/**
 * EffectMovementSpeedIncrease class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file EffectMovementSpeedIncrease.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class EffectMovementSpeedIncrease extends GameEffect {
  constructor(){
    super();
    this.type = GameEffectType.EffectMovementSpeedIncrease;
    
    //intList[0] : nPercentChange

  }

  onApply(){
    if(this.applied)
      return;
      
    super.onApply();
    
    // The object works its speed out once this is on its list (ModuleObject.effectsChanged): under 100 is read
    // as 100 more (99 is 199%), so it isn't changed here, where applying it again added another 100
  }

  onRemove(){
    super.onRemove();
  }

}


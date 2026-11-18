import { GameEffect } from "@/effects/GameEffect";
import { GameEffectType } from "@/enums/effects/GameEffectType";

/**
 * EffectMovementSpeedDecrease class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file EffectMovementSpeedDecrease.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class EffectMovementSpeedDecrease extends GameEffect {
  constructor(){
    super();
    this.type = GameEffectType.EffectMovementSpeedDecrease;
    
    //intList[0] : nPercentChange

  }

  onApply(){
    if(this.applied)
      return;
      
    super.onApply();
    
    // The object works its speed out once this is on its list (ModuleObject.effectsChanged)
  }

  onRemove(){
    super.onRemove();
  }

}


import { GameEffect } from "@/effects/GameEffect";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { TextSprite3D } from "@/engine/TextSprite3D";
import { TextSprite3DType } from "@/enums/engine/TextSprite3DType";

/**
 * EffectForceResisted class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file EffectForceResisted.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class EffectForceResisted extends GameEffect {
  constructor(){
    super();
    this.type = GameEffectType.EffectForceResisted;
    
    //objectList[0] : oTarget
    
  }

  onApply(){
    if(this.applied)
      return;
      
    super.onApply();
    // Said over the target, as a miss is: a power it shrugged off (a save made, or its Force resistance) looked
    // like one that did nothing at all. Players see it too (TextSprite3D.onCreateOnObject)
    if(this.object && !this.mirrored) TextSprite3D.CreateOnObjectOnce(this.object, 'resisted', TextSprite3DType.NEUTRAL, 1500);
  }

}


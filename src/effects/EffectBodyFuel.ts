import { GameEffect } from "@/effects/GameEffect";
import { GameEffectType } from "@/enums/effects/GameEffectType";

/**
 * EffectBodyFuel class.
 *
 * Body Fuel (Sith Energy Shield, SPECIAL_ABILITY_BODY_FUEL). KotOR's scripts link it with other effects; it carries no rule of its own here, so the effects linked with it apply.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file EffectBodyFuel.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class EffectBodyFuel extends GameEffect {
  constructor(){
    super();
    this.type = GameEffectType.EffectBodyFuel;
  }
}

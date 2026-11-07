import { GameEffect } from "@/effects/GameEffect";
import { GameEffectType } from "@/enums/effects/GameEffectType";

/**
 * EffectModifyNumAttacks class.
 *
 * Extra attacks each combat round (int 0, at most 5 in all): adrenals, battle stimulants, Force Speed. CombatRound reads it.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file EffectModifyNumAttacks.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class EffectModifyNumAttacks extends GameEffect {
  constructor(){
    super();
    this.type = GameEffectType.EffectModifyNumAttacks;
  }
}

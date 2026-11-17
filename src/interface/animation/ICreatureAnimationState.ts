import type { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import type { ITwoDAAnimation } from "@/interface/twoDA/ITwoDAAnimation";

/**
 * ICreatureAnimationState interface.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file ICreatureAnimationState.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 * @interface
 */
export interface ICreatureAnimationState {
  index: ModuleCreatureAnimState;
  animation: ITwoDAAnimation;
  started: boolean;
  speed: number;
  /**
   * A cast held for its whole length (ModuleCreature.playCastAnimation): the raise, then its loop for hold seconds,
   * then the raise backwards. Only castoutN has these (ModuleCreature.CAST_HOLDS)
   */
  hold?: number;
  phase?: 'in' | 'hold' | 'out';
  /** Played backwards (the hands coming down) */
  reverse?: boolean;
}
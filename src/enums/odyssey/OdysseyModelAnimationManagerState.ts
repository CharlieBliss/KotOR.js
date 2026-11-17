/**
 * OdysseyModelAnimationManagerState interface.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file OdysseyModelAnimationManagerState.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export interface OdysseyModelAnimationManagerState {
  loop: boolean;
  cFrame: number;
  elapsed: number;
  elapsedCount: number;
  lastTime: number;
  delta: number;
  lastEvent: number;
  events: boolean[];
  animation?: any;
  /** Played backwards: a cast's raise played again lowers the hands (KotOR has no separate animation for it) */
  reverse?: boolean;
}
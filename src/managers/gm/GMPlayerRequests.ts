import { GameState } from "@/GameState";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import { GMManager } from "@/managers/GMManager";
import { GMLog } from "@/managers/gm/GMLog";
import { GM_SKILL_NAMES } from "@/managers/gm/GMVocab";
import type { GMCheck } from "@/managers/gm/GMTypes";

/**
 * GMPlayerRequests: everything a player's character sheet can ask the GM's machine to do, in one place. The
 * host owns the character, so the sheet never changes it itself: it asks here, the host does it (or refuses, in
 * GMPlayers.INTENT_HANDLERS) and the next player.sheet brings the result back.
 *
 * Each request is refused here when the session would refuse it anyway, and says why in the console (GMLog).
 * Add new ones (spending a level-up's picks, using an item...) as methods beside these.
 */
export class GMPlayerRequests {

  /** Why a request can't be sent now, or '' when it can */
  static refusal(): string {
    if (GMNetworkManager.role !== 'client') return 'not a player in a GM session';
    if (!GMNetworkManager.assignedActorNetId) return 'no character yet';
    const pc = GameState.getCurrentPlayer?.();
    if (pc && GMManager.isPlayerFrozen(pc)) return 'the GM has players watching';
    return '';
  }

  /** Level our character up (Auto Level-Up), if it has the XP */
  static levelUp(): boolean {
    const why = this.refusal();
    if (why) {
      GMLog.warn('request', `Level up not sent: ${why}`);
      return false;
    }
    GMNetworkManager.sendIntent('levelup');
    GMLog.info('request', 'Asked the host to level our character up');
    return true;
  }

  /** Roll one of our skills or saves; the host rolls it and everyone sees the result */
  static roll(check: GMCheck): boolean {
    const label = check.kind === 'skill' ? (GM_SKILL_NAMES[check.skill] || `skill ${check.skill}`) : `${check.save} save`;
    const why = this.refusal();
    if (why) {
      GMLog.warn('request', `Roll ${label} not sent: ${why}`);
      return false;
    }
    GMNetworkManager.sendIntent('roll', undefined, { check, abilityId: check.kind === 'skill' ? check.skill : undefined });
    GMLog.info('request', `Asked the host to roll ${label}`);
    return true;
  }
}

import { ModuleObjectScript } from "@/enums/module/ModuleObjectScript";

/**
 * A creature's scripts do two jobs. Some decide what it does from moment to moment: they look about on its
 * heartbeat, start fights on seeing an enemy, pick its next attack at the end of each combat round, turn on
 * whoever hit it. Others carry the story and the rules: its spawn set-up, what happens when it dies, its
 * conversations, and the scripts that make powers and items work.
 *
 * Something else can take over the first kind (in a GM session, the GM's AI runs its NPCs). Then those events
 * don't run the creature's scripts at all, so the two can't give it conflicting orders; the second kind always
 * runs. EngineHooks.runsBehaviourScripts says who's in charge of a creature.
 */

/** The script slots that decide a creature's behaviour */
export const BEHAVIOUR_SCRIPTS: ReadonlySet<string> = new Set([
  ModuleObjectScript.CreatureOnHeartbeat,
  ModuleObjectScript.CreatureOnNotice,
  ModuleObjectScript.CreatureOnEndRound,
  ModuleObjectScript.CreatureOnAttacked,
  ModuleObjectScript.CreatureOnDamaged,
  ModuleObjectScript.CreatureOnBlocked,
  ModuleObjectScript.CreatureOnDisturbed,
  ModuleObjectScript.CreatureOnSpellAt,
]);

/**
 * The game's AI passes its own events through user-defined events too (k_ai_master signals them on the creature
 * for its OnUserDefined script): 1001 heartbeat, 1002 perceived, 1003 end of combat round, 1005 attacked, 1006
 * damaged, 1008 disturbed, 1009 blocked, 1010 spell cast at. Those are behaviour. 1004 (dialogue), 1007 (death),
 * 1011 (dialogue ended) and the story's own numbers always run
 */
export const BEHAVIOUR_USER_EVENTS: ReadonlySet<number> = new Set([1001, 1002, 1003, 1005, 1006, 1008, 1009, 1010]);

/** Whether a script slot (and, for a user-defined event, its number) is one that decides behaviour */
export function isBehaviourScript(slot: string, userEvent?: number): boolean {
  if (slot === ModuleObjectScript.CreatureOnUserDefined) return userEvent !== undefined && BEHAVIOUR_USER_EVENTS.has(Number(userEvent));
  return BEHAVIOUR_SCRIPTS.has(slot);
}

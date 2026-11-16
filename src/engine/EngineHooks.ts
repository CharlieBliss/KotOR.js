import type { ModuleObject } from "@/module/ModuleObject";
import type { ModuleCreature } from "@/module/ModuleCreature";
import type { ModuleDoor } from "@/module/ModuleDoor";
import type { ModuleItem } from "@/module/ModuleItem";
import type { ModuleTrigger } from "@/module/ModuleTrigger";
import type { GameEffect } from "@/effects/GameEffect";
import type { ITwoDAAnimation } from "@/interface/twoDA/ITwoDAAnimation";

/**
 * The places where the engine lets a game mode step in: to take over an action (return true to say it was
 * handled), to be told something happened on this machine, or to answer a question about an object.
 *
 * GameState.hooks is the active mode's implementation: GM mode's (GMManager.engineHooks) while
 * GameState.gmMode is on, DEFAULT_ENGINE_HOOKS otherwise. Engine code calls GameState.hooks.x(...) and
 * never names the mode; a mode that needs a new point of cooperation adds it here, with a default.
 */
export interface EngineHooks {
  // --- Objects simulated elsewhere
  /** The creature is a copy of one simulated on another machine: don't run its AI or combat here */
  isNetReplica(creature: ModuleCreature): boolean;
  /** The creature's position comes from another machine: don't move it from its own force */
  isNetMotionDriven(creature: ModuleCreature): boolean;
  /** Move a network-driven creature toward the position it was last sent */
  updateNetMotion(creature: ModuleCreature, delta: number): void;
  /** The object is hidden by the mode (waiting for its cue): nobody perceives it, and it perceives nobody */
  isHidden(obj: ModuleObject): boolean;
  /** This machine's mines are copies: they don't trigger here, and creatures here don't spot them */
  isMineReplica(mine?: ModuleTrigger): boolean;

  // --- Actions a mode may take over (true: handled, the engine does nothing more)
  /** The player clicked target */
  interceptInteraction(pc: ModuleObject, target: ModuleObject): boolean;
  /** The player chose an action-menu entry against target */
  interceptMenuAction(pc: ModuleObject, entry: any, target: ModuleObject): boolean;
  /** creature equips item in slot */
  requestNetworkEquip(creature: ModuleObject, slot: number, item: ModuleItem): boolean;
  /** creature empties slot */
  requestNetworkUnequip(creature: ModuleObject, slot: number): boolean;
  /** Someone loots container */
  requestNetworkLoot(container: ModuleObject): boolean;
  /** user opens container's inventory */
  routeContainerOpen(container: ModuleObject, user: ModuleObject | undefined): boolean;
  /** owner uses up item (a mine being set) */
  consumePlayerItem(owner: ModuleObject, item: ModuleItem): boolean;
  /** owner recovers a mine, gaining the item resRef */
  giveRecoveredMine(owner: ModuleObject, resRef: string): boolean;

  // --- Questions
  /** The world is paused: projectiles and the module clock hold still */
  isWorldPaused(): boolean;
  /** The creature may not act (it is held by the mode) */
  isPlayerFrozen(creature: ModuleObject): boolean;
  /** The object is a player's character (knocked out when it falls, not a body to loot) */
  isPlayerCharacter(obj: ModuleObject | undefined): boolean;
  /** The container's contents live on another machine: the container menu leaves them alone */
  isNetworkContainer(container: ModuleObject): boolean;
  /** user meets obj's skill requirement to use it */
  skillGatePasses(obj: ModuleObject, user: ModuleObject): boolean;
  /** The player controls only their own character: the party leader can't be switched */
  isLeaderLocked(): boolean;
  /** The area leaves out its own placeables, creatures or triggers */
  skipsModuleObjects(kind: 'placeables' | 'creatures' | 'triggers'): boolean;

  // --- Things that happened on this machine
  /** A creature played an animations.2da animation */
  onHostTwoDAAnimation(creature: ModuleCreature, animation: ITwoDAAnimation): void;
  onHostVisualEffectApplied(effect: GameEffect): void;
  onHostVisualEffectRemoved(effect: GameEffect): void;
  onHostProjectile(caster: ModuleObject, target: ModuleObject, ammunition: number, hit: boolean, delay: number): void;
  /** by opened door (by is the door itself when it opened on its own) */
  onDoorOpened(door: ModuleDoor, by: ModuleObject): void;
  onMineChanged(mine: ModuleTrigger): void;
  onMineRemoved(mine: ModuleTrigger): void;
  /** A skill check was rolled (setting, recovering or disarming a mine) */
  announceSkillRoll(owner: ModuleObject, label: string, roll: number, bonus: number, dc: number, success: boolean): void;
  /** The player moved their character */
  notifyLocalMovement(): void;
  /** user tried to use obj and couldn't: it's locked, or they failed the skill check in front of it */
  onUseBlocked(obj: ModuleObject, user: ModuleObject | undefined, reason: 'locked' | 'skill'): void;
  /** A click in the world and what came of it, for the console */
  traceInteraction(message: string, data?: unknown): void;
  /** Level the character up elsewhere (the machine that owns it); true when that was asked for instead */
  requestNetworkLevelUp(creature: ModuleObject): boolean;
  /** Show the mode's own character sheet instead of the game's Character or Abilities screen; true when it did */
  openCharacterSheet(section: 'overview' | 'abilities'): boolean;
  /** A creature in combat finished a combat round (the mode may choose its next one) */
  onCombatRoundEnd(creature: ModuleCreature): void;
  /** A creature's own script asks it to attack: true when the mode has it busy with something else */
  holdsScriptAttack(creature: ModuleCreature): boolean;
  /** Creatures walk through this one rather than around it (it isn't there for them, e.g. hidden by the GM) */
  walksThrough(creature: ModuleObject): boolean;
  /** A creature uses something it can sit on: sit in it. True when that's what happened (no other use) */
  useSeat(creature: ModuleObject, target: ModuleObject): boolean;
  /** Something to sit on (players can use it to sit) */
  isSeat(object: ModuleObject): boolean;
}

/** The engine on its own: nothing is taken over, nothing is simulated elsewhere */
export const DEFAULT_ENGINE_HOOKS: EngineHooks = {
  isNetReplica: () => false,
  isNetMotionDriven: () => false,
  updateNetMotion: () => {},
  isHidden: () => false,
  isMineReplica: () => false,
  interceptInteraction: () => false,
  interceptMenuAction: () => false,
  requestNetworkEquip: () => false,
  requestNetworkUnequip: () => false,
  requestNetworkLoot: () => false,
  routeContainerOpen: () => false,
  consumePlayerItem: () => false,
  giveRecoveredMine: () => false,
  isWorldPaused: () => false,
  isPlayerFrozen: () => false,
  isPlayerCharacter: () => false,
  isNetworkContainer: () => false,
  skillGatePasses: () => true,
  isLeaderLocked: () => false,
  skipsModuleObjects: () => false,
  onHostTwoDAAnimation: () => {},
  onHostVisualEffectApplied: () => {},
  onHostVisualEffectRemoved: () => {},
  onHostProjectile: () => {},
  onDoorOpened: () => {},
  onMineChanged: () => {},
  onMineRemoved: () => {},
  announceSkillRoll: () => {},
  notifyLocalMovement: () => {},
  onUseBlocked: () => {},
  traceInteraction: () => {},
  requestNetworkLevelUp: () => false,
  openCharacterSheet: () => false,
  onCombatRoundEnd: () => {},
  holdsScriptAttack: () => false,
  walksThrough: () => false,
  useSeat: () => false,
  isSeat: () => false,
};

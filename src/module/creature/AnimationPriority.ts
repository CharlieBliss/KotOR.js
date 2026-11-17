import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";

/**
 * Who owns a creature's body right now, highest first. A creature's animation is set from many places every frame
 * (its life state, movement, turning, combat swings and flinches, casting, scripts, gestures, a network replay),
 * and whichever ran last used to win: a swing or a stun pose over "die", a flinch over getting up. Each owner here
 * decides what the rest may still do; ModuleCreature.setAnimationState and playTwoDAAnimation ask before changing
 * anything.
 */
export enum BodyOwner {
  /** Nothing holds it: movement, combat, casting and gestures share it as before */
  NONE = 0,
  /** Stunned, held, paralyzed, asleep, choking, pushed...: its pose comes from the effect */
  HELD = 1,
  /** Getting back up after being revived */
  GETTING_UP = 2,
  /** Dying or dead */
  DEAD = 3,
}

export const DEATH_STATES: ReadonlySet<number> = new Set([
  ModuleCreatureAnimState.DIE, ModuleCreatureAnimState.DIE1,
  ModuleCreatureAnimState.DEAD, ModuleCreatureAnimState.DEAD1,
]);

export const GET_UP_STATES: ReadonlySet<number> = new Set([
  ModuleCreatureAnimState.GET_UP_DEAD, ModuleCreatureAnimState.GET_UP_DEAD1,
]);

/** What the priority rules need to know about a creature */
export interface AnimatedBody {
  isDead(): boolean;
  isDebilitated(): boolean;
  animationState: { index: number };
}

export function bodyOwner(body: AnimatedBody): BodyOwner {
  if (body.isDead()) return BodyOwner.DEAD;
  if (GET_UP_STATES.has(body.animationState?.index)) return BodyOwner.GETTING_UP;
  if (body.isDebilitated()) return BodyOwner.HELD;
  return BodyOwner.NONE;
}

/**
 * The animation state a request becomes. The dead only die and lie dead: any other request (the end of "die"
 * asking for idle, a swing, a turn) becomes lying dead. Everyone else gets what they ask for; a held creature's
 * pose is drawn from its effect whatever its state (ModuleObject.animationConstantToAnimation).
 */
export function resolveStateRequest(owner: BodyOwner, requested: number): number {
  if (owner === BodyOwner.DEAD && !DEATH_STATES.has(requested)) return ModuleCreatureAnimState.DEAD;
  return requested;
}

/**
 * Whether a one-off animation may play (a swing, a flinch, a cast, a gesture, a stance, one replayed from the
 * GM's machine). Only a body nothing holds: they bypass the state rules, and drew over dying, getting up and
 * being held.
 */
export function allowsOneOffAnimation(owner: BodyOwner): boolean {
  return owner === BodyOwner.NONE;
}

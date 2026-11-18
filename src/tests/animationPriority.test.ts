import { describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: { hooks: { onHostTwoDAAnimation: () => {} } } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import { BodyOwner, bodyOwner, resolveStateRequest, allowsOneOffAnimation } from "@/module/creature/AnimationPriority";
import { ModuleCreatureAnimState as S } from "@/enums/module/ModuleCreatureAnimState";
import { ModuleCreature } from "@/module/ModuleCreature";

const body = (o: { dead?: boolean; held?: boolean; index?: number } = {}): any => ({
  isDead: () => !!o.dead,
  isDebilitated: () => !!o.held,
  animationState: { index: o.index ?? S.PAUSE, animation: undefined, started: false, speed: 1 },
  animationConstantToAnimation: (state: number) => ({ name: `anim-${state}` }),
  resetAnimationState() { return ModuleCreature.prototype.resetAnimationState.call(this); },
});
const setState = (b: any, state: number) => ModuleCreature.prototype.setAnimationState.call(b, state);
const playOneOff = (b: any, index?: number) => ModuleCreature.prototype.playTwoDAAnimation.call(b, { name: 'swing' } as any, index);

describe('who owns the body', () => {
  test('dead over getting up over held over nothing', () => {
    expect(bodyOwner(body({ dead: true, held: true }))).toBe(BodyOwner.DEAD);
    expect(bodyOwner(body({ held: true, index: S.GET_UP_DEAD }))).toBe(BodyOwner.GETTING_UP);
    expect(bodyOwner(body({ held: true }))).toBe(BodyOwner.HELD);
    expect(bodyOwner(body())).toBe(BodyOwner.NONE);
  });
});

describe('the dead', () => {
  test('only die and lie dead: anything else asked of them becomes lying dead', () => {
    expect(resolveStateRequest(BodyOwner.DEAD, S.DIE)).toBe(S.DIE);
    for (const asked of [S.PAUSE, S.READY, S.IDLE, S.WALKING, S.TURN_LEFT, S.ATTACK]) {
      expect(resolveStateRequest(BodyOwner.DEAD, asked)).toBe(S.DEAD);
    }
  });

  test('killed while held, a creature dies rather than keeping the stun pose (it stood there for good)', () => {
    const b = body({ dead: true, held: true, index: S.IDLE });
    setState(b, S.DIE);
    expect(b.animationState.index).toBe(S.DIE);
    // The stun's idle every frame, the end of "die" asking for idle: it lies dead
    setState(b, S.IDLE);
    expect(b.animationState.index).toBe(S.DEAD);
  });

  test("swings, flinches, casts and replays don't play on the dead", () => {
    const b = body({ dead: true, index: S.DEAD });
    expect(playOneOff(b, S.ATTACK)).toBe(false);
    expect(b.animationState.index).toBe(S.DEAD);
  });
});

describe('getting up and being held', () => {
  test("a flinch or swing doesn't cut short getting up", () => {
    const b = body({ index: S.GET_UP_DEAD });
    expect(playOneOff(b, S.DAMAGE)).toBe(false);
    expect(b.animationState.index).toBe(S.GET_UP_DEAD);
    expect(allowsOneOffAnimation(BodyOwner.GETTING_UP)).toBe(false);
  });

  test("a held creature doesn't swing, flinch or cast; its states still change (its pose comes from the effect)", () => {
    const b = body({ held: true });
    expect(playOneOff(b, S.ATTACK)).toBe(false);
    setState(b, S.READY);
    expect(b.animationState.index).toBe(S.READY);
  });
});

describe('a free body', () => {
  test('a one-off plays under the state it counts as (a swing is ATTACK)', () => {
    const b = body();
    expect(playOneOff(b, S.ATTACK)).toBe(true);
    expect(b.animationState.index).toBe(S.ATTACK);
    expect(b.animationState.animation.name).toBe('swing');
    expect(playOneOff(b)).toBe(true);
    expect(b.animationState.index).toBe(S.PAUSE);
  });

  test('states are set as asked', () => {
    const b = body();
    setState(b, S.WALKING);
    expect(b.animationState.index).toBe(S.WALKING);
    expect(b.animationState.animation.name).toBe(`anim-${S.WALKING}`);
  });
});

import { describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: { gmMode: true } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import { ModuleCreature } from "@/module/ModuleCreature";
import { GMManager } from "@/managers/GMManager";
import { OdysseyModelAnimation } from "@/odyssey/OdysseyModelAnimation";

describe("poses: an animation held at a moment", () => {
  test("a stance names its animation and, for a pose, the moment it's held at", () => {
    expect(ModuleCreature.parseStance('kneel@2.9')).toEqual({ anim: 'kneel', holdAt: 2.9 });
    expect(ModuleCreature.parseStance('Kneel@0')).toEqual({ anim: 'kneel', holdAt: 0 });
    expect(ModuleCreature.parseStance('sit')).toEqual({ anim: 'sit' });
    expect(ModuleCreature.parseStance('')).toEqual({ anim: '' });
  });

  test("a pose is offered when the model has its animation, though that animation doesn't loop", () => {
    jest.spyOn(OdysseyModelAnimation, 'GetAnimation2DA').mockImplementation(((name: string) => ({ name, looping: name === 'sit' ? '1' : '0' })) as any);
    const cre: any = { hasModelAnimation: (n: string) => ['kneel', 'sit', 'bow'].includes(n) };
    expect(GMManager.animationFor(cre, { id: 'kneel', label: 'Kneeling', group: 'Poses', anims: ['kneel@2.9'] }, true)).toBe('kneel@2.9');
    expect(GMManager.animationFor(cre, { id: 'sit', label: 'Sit', group: 'Sitting', anims: ['sit'] }, true)).toBe('sit');
    // Not looping and not a pose: not a stance
    expect(GMManager.animationFor(cre, { id: 'bow', label: 'Bow', group: 'Social', anims: ['bow'] }, true)).toBe('');
    // A pose of an animation the model lacks
    expect(GMManager.animationFor(cre, { id: 'x', label: 'X', group: 'Poses', anims: ['forcerage@0.9'] }, true)).toBe('');
  });

  test("a pose the GM made reads as its animation and moment; a listed one by its name", () => {
    expect(GMManager.stanceLabel('kneel@2.9')).toBe('Kneeling');
    expect(GMManager.stanceLabel('g2a1@0.35')).toBe('Pose: g2a1 at 0.35 s');
  });
});

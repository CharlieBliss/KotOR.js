import { describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: { hooks: { onEffectRemoved: () => {}, onEffectApplied: () => {} } } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import { GameEffect } from "@/effects/GameEffect";
import { ModuleObject } from "@/module/ModuleObject";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";

/** An object with just what addEffect / removeEffect use */
const holder = (name: string): any => ({
  name, effects: [] as GameEffect[], isImmuneToEffect: () => false,
  removeEffect(effect: GameEffect) { return ModuleObject.prototype.removeEffect.call(this, effect); },
  detachEffect(effect: GameEffect) { return ModuleObject.prototype.detachEffect.call(this, effect); },
});
const addEffect = (obj: any, effect: GameEffect) => ModuleObject.prototype.addEffect.call(obj, effect, effect.getDurationType(), effect.getDuration());
const removeEffect = (obj: any, effect: GameEffect) => ModuleObject.prototype.removeEffect.call(obj, effect);

/** Every effect instance that was applied, in order */
const applied: GameEffect[] = [];

class CountingEffect extends GameEffect {
  removes = 0;
  onApply() { if (this.applied) return; super.onApply(); applied.push(this); }
  onRemove() { this.removes++; }
}

describe('one effect a script applies to several objects', () => {
  test('each object gets its own copy, applied on its own', () => {
    const effect = new CountingEffect();
    effect.setDurationType(GameEffectDurationType.TEMPORARY);
    effect.setDuration(3);
    effect.setInt(0, 2038);
    const a = holder('a'), b = holder('b'), c = holder('c');
    applied.length = 0;
    for (const o of [a, b, c]) addEffect(o, effect);
    const [ea, eb, ec] = [a.effects[0], b.effects[0], c.effects[0]];
    expect(new Set([ea, eb, ec]).size).toBe(3);
    expect([ea, eb, ec].map((e: any) => e.object)).toEqual([a, b, c]);
    expect(applied).toEqual([ea, eb, ec]);
    expect(eb.getInt(0)).toBe(2038);
    expect(eb.getDuration()).toBe(3);
  });

  test('when its time runs out it comes off every one of them', () => {
    const effect = new CountingEffect();
    effect.setDurationType(GameEffectDurationType.TEMPORARY);
    effect.setDuration(0.5);
    const objs = [holder('a'), holder('b'), holder('c')];
    for (const o of objs) addEffect(o, effect);
    for (let i = 0; i < 4; i++) for (const o of objs) for (const e of [...o.effects]) e.update(0.25);
    // update's removal goes through the object's removeEffect
    expect(objs.map((o) => o.effects.length)).toEqual([0, 0, 0]);
  });

  test("a copy's lists are its own", () => {
    const effect = new CountingEffect();
    effect.setInt(0, 1);
    const copy = effect.clone();
    copy.setInt(0, 2);
    expect(effect.getInt(0)).toBe(1);
    expect(copy.applied).toBe(false);
  });

  test('applying it again to the same object does not copy it', () => {
    const effect = new CountingEffect();
    const a = holder('a');
    addEffect(a, effect);
    removeEffect(a, effect);
    expect(effect.removes).toBe(1);
  });
});

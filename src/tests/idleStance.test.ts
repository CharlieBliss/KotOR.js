import { describe, expect, jest, test, beforeEach } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: { gmMode: false } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import { ModuleCreature } from "@/module/ModuleCreature";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import { GameState } from "@/GameState";
import { TwoDAManager } from "@/managers/TwoDAManager";

const rows: Record<number, any> = {
  6: { name: 'pause1', looping: '1', fireforget: '0' },
  7: { name: 'pause2', looping: '1', fireforget: '0' },
  8: { name: 'pauseinj', looping: '1', fireforget: '0' },
  15: { name: 'pausetired', looping: '1', fireforget: '0' },
  357: { name: 'pause4', looping: '1', fireforget: '0' },
  359: { name: 'pause3', looping: '1', fireforget: '0' },
  42: { name: 'talknorm', looping: '1', fireforget: '0' },
};

/** A humanoid stand-in with the given HP, idling */
function idler(hp: number, maxHp: number, animation: any): any {
  const cre = Object.create(ModuleCreature.prototype);
  Object.assign(cre, {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    effects: [],
    getHP: () => hp,
    getMaxHP: () => maxHp,
    isSimpleCreature: () => false,
    isPoisoned: () => false,
    isDiseased: () => false,
    animationState: { index: ModuleCreatureAnimState.PAUSE, animation, started: true, speed: 1 },
  });
  return cre;
}

describe('idle stance', () => {
  beforeEach(() => {
    (GameState as any).TwoDAManager = { datatables: new Map([['animations', { rows }]]) };
  });

  test('a creature at full health stops limping (it was spawned before its HP was set)', () => {
    const cre = idler(120, 120, rows[8]);
    cre.refreshIdleStance();
    expect(cre.animationState.animation.name).toBe('pause1');
    expect(cre.animationState.started).toBe(false);
  });

  test('a badly hurt idle creature starts limping', () => {
    const cre = idler(10, 120, rows[6]);
    cre.refreshIdleStance();
    expect(cre.animationState.animation.name).toBe('pauseinj');
  });

  test('a stance that still fits is left playing', () => {
    const cre = idler(100, 120, rows[6]);
    cre.refreshIdleStance();
    expect(cre.animationState.started).toBe(true);
  });

  test('a scripted animation playing in the idle state is not replaced', () => {
    const cre = idler(120, 120, rows[42]);
    cre.refreshIdleStance();
    expect(cre.animationState.animation.name).toBe('talknorm');
  });
});

describe('held stance', () => {
  const meditate = { name: 'meditate', looping: '1', fireforget: '0' };
  const bow = { name: 'bow', looping: '0', fireforget: '1' };
  beforeEach(() => {
    const table: any = { rows: [] as any[] };
    for (const [i, r] of Object.entries({ ...rows, 24: meditate, 19: bow })) table.rows[Number(i)] = r;
    for (let i = 0; i < table.rows.length; i++) table.rows[i] = table.rows[i] || { name: `row${i}` };
    table.RowCount = table.rows.length;
    (GameState as any).TwoDAManager = { datatables: new Map([['animations', table]]) };
    // Animation lookups by name read the manager directly
    TwoDAManager.datatables.set('animations', table);
  });

  /** An idler whose model has these animations; playTwoDAAnimation is recorded */
  function holder(animation: any, models = ['pause1', 'pauseinj', 'meditate', 'bow']): any {
    const cre = idler(100, 100, animation);
    cre.model = { odysseyAnimationMap: new Map(models.map((m) => [m, {}])) };
    cre.isDead = () => false;
    cre.combatData = { combatState: false };
    cre.played = [];
    cre.playTwoDAAnimation = (anim: any) => { cre.played.push(anim.name); cre.animationState = { index: ModuleCreatureAnimState.PAUSE, animation: anim, started: false, speed: 1 }; };
    return cre;
  }

  test('a creature standing idle takes up its stance', () => {
    const cre = holder(rows[6]);
    cre.setHeldStance('Meditate');
    expect(cre.heldStance).toBe('meditate');
    expect(cre.played).toEqual(['meditate']);
  });

  test('the stance comes back after walking somewhere', () => {
    const cre = holder(rows[6]);
    cre.setHeldStance('meditate');
    cre.animationState = { index: ModuleCreatureAnimState.WALKING, animation: { name: 'walk' }, started: true, speed: 1 };
    cre.holdStance();
    expect(cre.played).toEqual(['meditate']);
    cre.animationState = { index: ModuleCreatureAnimState.PAUSE, animation: rows[6], started: true, speed: 1 };
    cre.holdStance();
    expect(cre.played).toEqual(['meditate', 'meditate']);
  });

  test('a gesture plays out before the stance returns', () => {
    const cre = holder(meditate);
    cre.heldStance = 'meditate';
    cre.animationState = { index: ModuleCreatureAnimState.PAUSE, animation: bow, started: true, speed: 1 };
    cre.holdStance();
    expect(cre.played).toEqual([]);
  });

  test('combat and death interrupt it', () => {
    const cre = holder(rows[6]);
    cre.heldStance = 'meditate';
    cre.combatData.combatState = true;
    cre.holdStance();
    cre.combatData.combatState = false;
    cre.isDead = () => true;
    cre.holdStance();
    expect(cre.played).toEqual([]);
  });

  test("a model without the animation just stands (and doesn't retry every frame)", () => {
    const cre = holder(rows[6], ['pause1']);
    cre.setHeldStance('meditate');
    expect(cre.played).toEqual([]);
  });

  test('the injured stance holds even at full health', () => {
    const cre = holder(rows[8]);
    cre.heldStance = 'pauseinj';
    cre.refreshIdleStance();
    cre.holdStance();
    expect(cre.animationState.animation.name).toBe('pauseinj');
  });

  test('clearing the stance stands it up', () => {
    const cre = holder(meditate);
    cre.heldStance = 'meditate';
    cre.setAnimationState = jest.fn((index: number) => { cre.animationState = { index, animation: rows[6], started: false, speed: 1 }; });
    cre.setHeldStance('');
    expect(cre.setAnimationState).toHaveBeenCalledWith(ModuleCreatureAnimState.PAUSE);
    expect(cre.heldStance).toBe('');
  });
});

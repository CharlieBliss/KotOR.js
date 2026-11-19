import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({
  GameState: {
    gmMode: true,
    GameKey: 'TSL',
    SWRuleSet: {},
    TwoDAManager: { datatables: new Map() },
    hooks: jest.requireActual<typeof import("@/engine/EngineHooks")>("@/engine/EngineHooks").DEFAULT_ENGINE_HOOKS,
  },
}));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import * as THREE from "three";
import { GameState } from "@/GameState";
import { SpellCastInstance } from "@/combat/SpellCastInstance";
import { EffectDamage } from "@/effects/EffectDamage";
import { EffectForcePushed } from "@/effects/EffectForcePushed";
import { EffectSetState } from "@/effects/EffectSetState";
import { GameEffectSetStateType } from "@/enums/effects/GameEffectSetStateType";
import { DamageType } from "@/enums/combat/DamageType";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ModuleCreature } from "@/module/ModuleCreature";
import { TwoDAManager } from "@/managers/TwoDAManager";
import { GMManager } from "@/managers/GMManager";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import { GMPlayerHud } from "@/managers/gm/GMPlayerHud";
import { GMPlayers } from "@/managers/gm/GMPlayers";
import { NWScriptDefK1 } from "@/nwscript/NWScriptDefK1";
import {
  CAREERS_POWER_TREE_BY_ID,
  CAREERS_POWER_TREES,
  CareersAdvancement,
  CareersRules,
  CareersRuntime,
  FORCE_PUSH,
  FORCE_WAVE,
  FORCE_WHIRLWIND,
  GMCareersCharacters,
} from "@/managers/gm/careers";
import type { GMCareersCharacter } from "@/managers/gm/careers";

const PUSH_ROWS = {
  [FORCE_PUSH]: { __index: FORCE_PUSH, label: 'FORCE_POWER_FORCE_PUSH', usertype: '1', forcepoints: '20', forcehostile: '6', range: 'M', impactscript: 'k_sp1_generic', prerequisites: '****' },
  [FORCE_WAVE]: { __index: FORCE_WAVE, label: 'FORCE_POWER_FORCE_WAVE', usertype: '1', forcepoints: '25', forcehostile: '6', range: 'S', impactscript: 'k_sp1_generic', prerequisites: '23_27' },
  [FORCE_WHIRLWIND]: { __index: FORCE_WHIRLWIND, label: 'FORCE_POWER_FORCE_WHIRLWIND', usertype: '1', forcepoints: '25', forcehostile: '6', range: 'M', impactscript: 'k_sp1_generic', prerequisites: '23' },
};

function makeCreature(fields: Record<string, any> = {}): any {
  const cre = Object.create(ModuleCreature.prototype);
  Object.assign(cre, {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    gmNetId: 'pc_1',
    firstName: 'Hero',
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    maxHitPoints: 40, currentHitPoints: 40, maxForcePoints: 60, currentForce: 60,
    goodEvil: 50,
    effects: [] as any[],
    feats: [] as any[],
    spells: [] as any[],
    skills: [],
    classes: [{ id: 3, level: 1, spells: [] as any[], getACBonus: () => 0, getBaseAttackBonus: () => 0 }],
    equipment: {},
    combatData: { combatState: false },
    position: new THREE.Vector3(0, 0, 0),
    getName: () => cre.firstName,
    isDead: () => cre.currentHitPoints <= 0,
    getHP: () => cre.currentHitPoints,
    getMaxHP: () => cre.maxHitPoints,
    getFP: () => cre.currentForce,
    getMaxFP: () => cre.maxForcePoints,
    getFeats: () => cre.feats,
    getSpells: () => cre.spells,
    getHasFeat: () => false,
    getTotalClassLevel: () => 1,
    getSpellCasterLevel: () => 1,
    addEffect: jest.fn(function (this: any, e: any, type?: number, duration?: number) { this.effects.push({ e, type, duration }); }),
    isHostile: (other: any) => !!cre.hostileTo?.includes(other),
    ...fields,
  });
  return cre;
}

/** A Jedi with Force Push and the tree nodes given */
function jediWith(nodes: string[]): GMCareersCharacter {
  const c = GMCareersCharacters.blank('human', 'jedi_guardian');
  c.name = 'Kira';
  c.powerNodes = { force_push: nodes };
  return c;
}

/** A Careers caster spawned with that sheet, knowing its powers */
function casterWith(nodes: string[]) {
  const sheet = jediWith(nodes);
  const caster = makeCreature({ gmNetId: 'pc_kira' });
  const rt = new CareersRuntime(sheet, caster);
  caster.careersRules = rt;
  return { sheet, caster, rt };
}

beforeEach(() => {
  TwoDAManager.datatables = new Map([['spells', { rows: PUSH_ROWS }]]) as any;
  (GameState as any).TwoDAManager = TwoDAManager;
  GMManager.ruleset = 'careers';
  GMManager.netIdMap.clear();
  GMManager.notifyChange = jest.fn();
  GMNetworkManager.role = 'host';
  GMNetworkManager.peers = new Map();
  GMNetworkManager.sendIntent = jest.fn() as any;
});

describe('the Force Push tree', () => {
  test('10 nodes, 105 XP, links both ways, every node reaching the power', () => {
    const tree = CAREERS_POWER_TREE_BY_ID.get('force_push')!;
    expect(tree.rootSpellId).toBe(FORCE_PUSH);
    expect(tree.nodes).toHaveLength(10);
    expect(tree.nodes.reduce((n, node) => n + node.xpCost, 0)).toBe(105);
    const byId = new Map(tree.nodes.map((n) => [n.id, n]));
    for (const node of tree.nodes) {
      for (const link of node.links) expect(byId.get(link)?.links).toContain(node.id);
    }
    expect(CareersRules.powerTreeLinksValid(tree, tree.nodes.map((n) => n.id))).toBe(true);
    expect(CAREERS_POWER_TREES.map((t) => t.id)).toEqual(['force_push']);
  });

  test('buying: Force-sensitive only, the power first, then along its links, starting XP only at creation', () => {
    const soldier = GMCareersCharacters.blank('human', 'soldier');
    expect(CareersRules.canBuyPowerNode(soldier, 'force_push', 'root').reason).toMatch(/Force-sensitive/);

    const jedi = jediWith([]);
    expect(CareersRules.canBuyPowerNode(jedi, 'force_push', 'strength').reason).toBe('Learn Force Push first.');
    expect(CareersRules.canBuyPowerNode(jedi, 'force_push', 'root', true).ok).toBe(true);

    jedi.powerNodes!.force_push = ['root'];
    expect(CareersRules.canBuyPowerNode(jedi, 'force_push', 'stun').reason).toBe('Needs a link to an owned node.');
    expect(CareersRules.canBuyPowerNode(jedi, 'force_push', 'strength').ok).toBe(true);
    expect(CareersRules.canBuyPowerNode(jedi, 'force_push', 'root').reason).toBe('Already owned.');

    // Starting XP only: a Human's 110 is gone once 105 is spent elsewhere
    jedi.powerNodes!.force_push = CAREERS_POWER_TREE_BY_ID.get('force_push')!.nodes.map((n) => n.id).filter((id) => id !== 'wave');
    jedi.characteristics.str = 3; // 30 XP
    expect(CareersRules.canBuyPowerNode(jedi, 'force_push', 'wave', true).ok).toBe(false);
    jedi.campaignXpEarned = 100;
    expect(CareersRules.canBuyPowerNode(jedi, 'force_push', 'wave', false).ok).toBe(true);
  });

  test('a creation refund keeps the tree joined up', () => {
    const jedi = jediWith(['root', 'pull', 'whirlwind']);
    expect(CareersRules.canRemovePowerNode(jedi, 'force_push', 'pull')).toBe(false);
    expect(CareersRules.canRemovePowerNode(jedi, 'force_push', 'whirlwind')).toBe(true);
    expect(CareersRules.canRemovePowerNode(jedi, 'force_push', 'root')).toBe(false);
  });

  test('bought in play, refunded by undo and respec, and parsed from a player safely', () => {
    const jedi = jediWith([]);
    jedi.campaignXpEarned = 200;
    expect(CareersAdvancement.parsePurchase({ kind: 'power_node', treeId: 'force_push', nodeId: 'root', cost: 0 }))
      .toEqual({ kind: 'power_node', treeId: 'force_push', nodeId: 'root' });
    expect(CareersAdvancement.parsePurchase({ kind: 'power_node', treeId: 7 })).toBeNull();

    expect(CareersAdvancement.applyPurchase(jedi, { kind: 'power_node', treeId: 'force_push', nodeId: 'root' }).ok).toBe(true);
    expect(CareersAdvancement.applyPurchase(jedi, { kind: 'power_node', treeId: 'force_push', nodeId: 'pull' }).ok).toBe(true);
    expect(jedi.powerNodes!.force_push).toEqual(['root', 'pull']);
    expect(CareersRules.derive(jedi).totalPurchaseCost).toBe(15);

    expect(CareersAdvancement.undoLastPurchase(jedi)?.kind).toBe('power_node');
    expect(jedi.powerNodes!.force_push).toEqual(['root']);
    CareersAdvancement.respecPurchases(jedi);
    expect(jedi.powerNodes!.force_push).toEqual([]);
    expect(jedi.campaignXpSpent).toBe(0);
    expect(CareersRules.validate(jedi)).toEqual([]);
  });

  test('derive: the powers learnt, one set of upgrades for the whole family, and Pull for the wheel', () => {
    const d = CareersRules.derive(jediWith(['root', 'strength', 'strength_2', 'distance', 'pull', 'whirlwind', 'magnitude', 'wave']));
    expect(d.spellIds).toEqual(expect.arrayContaining([FORCE_PUSH, FORCE_WHIRLWIND, FORCE_WAVE]));
    for (const id of [FORCE_PUSH, FORCE_WHIRLWIND, FORCE_WAVE]) {
      expect(d.powerFamilies[id]).toMatchObject({ damage: 8, saveDC: 4, pushDistance: 2, extraTargets: 2 });
    }
    expect(d.powerVariants.map((v) => [v.variant, v.spellId])).toEqual([['pull', FORCE_PUSH]]);
    // Upgrades without the power count for nothing
    expect(CareersRules.derive(jediWith(['strength'])).powerFamilies).toEqual({});
  });
});

describe('characters saved with the old power ids', () => {
  test("version 1: each power becomes the one it meant, and its Force Push the tree's root, purchases kept", () => {
    const old: any = {
      ...GMCareersCharacters.blank('human', 'jedi_guardian'),
      version: 1,
      name: 'Old',
      powers: [27, 11, 8],
      campaignXpEarned: 50,
      campaignXpSpent: 10,
      purchases: [{ kind: 'power', spellId: 27, cost: 10, startingXpPaid: 0, campaignXpPaid: 10, at: 1 }],
    };
    delete old.powerNodes;
    GMCareersCharacters.upgrade(old);
    expect(old.version).toBe(2);
    expect(old.powers).toEqual([6, 8]);
    expect(old.powerNodes).toEqual({ force_push: ['root'] });
    expect(old.purchases[0]).toMatchObject({ kind: 'power_node', treeId: 'force_push', nodeId: 'root', campaignXpPaid: 10 });
    expect(old.purchases[0].spellId).toBeUndefined();
    expect(CareersRules.derive(old).spellIds).toEqual(expect.arrayContaining([FORCE_PUSH, 6, 8]));
    // Undo refunds the Push it bought
    CareersAdvancement.undoLastPurchase(old);
    expect(old.powerNodes.force_push).toEqual([]);
    expect(old.campaignXpSpent).toBe(0);
    // Already up to date: left alone
    expect(GMCareersCharacters.upgrade(old)).toBe(old);
    expect(old.powers).toEqual([6, 8]);
  });

  test('a spawned Careers creature brings its sheet up to date', () => {
    const old: any = { ...GMCareersCharacters.blank('human', 'jedi_guardian'), version: 1, powers: [27] };
    const rt = new CareersRuntime(old, makeCreature());
    expect(rt.character.version).toBe(2);
    expect(rt.derived.spellIds).toContain(FORCE_PUSH);
  });
});

describe('the power-cast hook', () => {
  const apply = NWScriptDefK1.Actions[220].action as Function;
  const run = (caster: any, effect: any, target: any, type: number, duration: number, talent?: any) =>
    apply.call({ caller: caster, talent, getSpellId: () => effect.getSpellId() }, [type, effect, target, duration]);

  test("Strength adds damage to every power in the family, once per effect, and its save DC", () => {
    const { caster } = casterWith(['root', 'strength', 'pull', 'whirlwind', 'magnitude', 'wave']);
    const a = makeCreature({ gmNetId: 'a' }), b = makeCreature({ gmNetId: 'b' });
    const dmg = new EffectDamage();
    dmg.setCreator(caster);
    dmg.setSpellId(FORCE_WAVE);
    dmg.setInt(DamageType.BLUDGEONING, 10);
    run(caster, dmg, a, GameEffectDurationType.INSTANT, 0);
    run(caster, dmg, b, GameEffectDurationType.INSTANT, 0); // Wave: the same effect on someone else
    expect(dmg.getInt(DamageType.BLUDGEONING)).toBe(14);

    const plain = makeCreature();
    expect(caster.getSpellSaveDC(FORCE_WHIRLWIND) - plain.getSpellSaveDC(FORCE_WHIRLWIND)).toBe(2);
    expect(caster.getSpellSaveDC(43) - plain.getSpellSaveDC(43)).toBe(0);
  });

  test('nothing changes for a classic caster, or for a power outside the family', () => {
    const classic = makeCreature();
    const dmg = new EffectDamage();
    dmg.setCreator(classic);
    dmg.setSpellId(FORCE_PUSH);
    dmg.setInt(DamageType.BLUDGEONING, 10);
    run(classic, dmg, makeCreature(), GameEffectDurationType.INSTANT, 0);
    expect(dmg.getInt(DamageType.BLUDGEONING)).toBe(10);

    const { caster, rt } = casterWith(['root', 'strength']);
    const shock = new EffectDamage();
    shock.setCreator(caster);
    shock.setSpellId(43);
    shock.setInt(DamageType.ELECTRICAL, 10);
    expect(rt.adjustPowerEffect(shock, makeCreature(), GameEffectDurationType.TEMPORARY, 6)).toBe(6);
    expect(shock.getInt(DamageType.ELECTRICAL)).toBe(10);
  });

  test("Duration holds Whirlwind longer, Stun lengthens the script's stun, Distance pushes further", () => {
    const { caster, rt } = casterWith(['root', 'strength', 'stun', 'distance', 'pull', 'whirlwind', 'duration']);
    const target = makeCreature({ gmNetId: 'npc' });
    const state = (spellId: number, s: number) => {
      const e = new EffectSetState();
      e.setSpellId(spellId);
      e.setInt(0, s);
      return e;
    };
    expect(rt.adjustPowerEffect(state(FORCE_WHIRLWIND, GameEffectSetStateType.WHIRLWIND), target, GameEffectDurationType.TEMPORARY, 6)).toBe(9);
    expect(rt.adjustPowerEffect(state(FORCE_PUSH, GameEffectSetStateType.CUT_SCENE_STUNNED), target, GameEffectDurationType.TEMPORARY, 2)).toBe(5);
    // Anything else the power leaves lasts as long as it did
    const other = new EffectDamage();
    other.setSpellId(FORCE_WHIRLWIND);
    expect(rt.adjustPowerEffect(other, target, GameEffectDurationType.TEMPORARY, 6)).toBe(6);

    const push = new EffectForcePushed();
    push.setCreator(caster);
    push.setSpellId(FORCE_PUSH);
    rt.adjustPowerEffect(push, target, GameEffectDurationType.INSTANT, 0);
    expect(push.pushDistance).toBe(7);
    expect(target.addEffect).not.toHaveBeenCalled();
  });

  test('Pull lands the target just in front of the caster', () => {
    const { caster, rt } = casterWith(['root', 'pull']);
    caster.position.set(0, 0, 0);
    const target = makeCreature({ gmNetId: 'npc', position: new THREE.Vector3(8, 0, 0) });
    const [{ talent }] = rt.getPowerVariants();
    expect((talent as any).careersVariant).toBe('pull');
    const push = new EffectForcePushed();
    push.setSpellId(FORCE_PUSH);
    push.validateWalkablePosition = (p: THREE.Vector3) => ({ face: {} as any, surfaceId: 0, closestPoint: p.clone() });
    rt.adjustPowerEffect(push, target, GameEffectDurationType.INSTANT, 0, talent);
    expect(push.getInt(0)).toBe(1);
    expect(push.getFloat(0)).toBeCloseTo(1.5);
    expect(push.getFloat(1)).toBeCloseTo(0);
  });

  test('Magnitude: the two nearest living enemies around a single target, and none for Wave', () => {
    const { caster } = casterWith(['root', 'distance', 'magnitude']);
    const at = (x: number, extra: Record<string, any> = {}) => {
      const c = makeCreature({ gmNetId: `npc_${x}`, position: new THREE.Vector3(x, 0, 0), ...extra });
      c.hostileTo = [caster];
      return c;
    };
    const target = at(10), near = at(11), nearer = at(10.5), far = at(20), down = at(10.2, { currentHitPoints: 0 });
    const friend = makeCreature({ position: new THREE.Vector3(10.1, 0, 0) });
    caster.area = { creatures: [caster, target, far, near, nearer, down, friend] };
    const cast = Object.create(SpellCastInstance.prototype);
    Object.assign(cast, { owner: caster, target, spell: { id: FORCE_PUSH, range: 'M' } });
    expect(cast.extraPowerTargets()).toEqual([nearer, near]);
    cast.spell = { id: FORCE_WAVE, range: 'S' };
    expect(cast.extraPowerTargets()).toEqual([]);
  });
});

describe('effects end with a whole turn', () => {
  test("in a GM session a lasting effect is stretched to a whole turn; shows, mirrors and players' copies aren't", () => {
    const was = (GameState as any).hooks;
    (GameState as any).hooks = GMManager.engineHooks;
    try {
      const target = makeCreature();
      target.addEffect = Object.getPrototypeOf(Object.getPrototypeOf(target)).addEffect; // the real ModuleObject one
      target.isImmuneToEffect = () => false;
      target.effectsChanged = () => {};
      const lasting = (type: number, seconds: number, mirrored = false) => {
        const e = type === GameEffectType.EffectSetState ? new EffectSetState() : new EffectDamage();
        e.type = type;
        e.setDurationType(GameEffectDurationType.TEMPORARY);
        e.setDuration(seconds);
        e.mirrored = mirrored;
        (e as any).onApply = () => {};
        (e as any).loadModel = () => {};
        target.addEffect(e, GameEffectDurationType.TEMPORARY, seconds);
        return e.getDuration();
      };
      expect(lasting(GameEffectType.EffectSetState, 2)).toBe(3);
      expect(lasting(GameEffectType.EffectSetState, 6)).toBe(6);
      expect(lasting(GameEffectType.EffectVisualEffect, 1.5)).toBe(1.5);
      expect(lasting(GameEffectType.EffectSetState, 2, true)).toBe(2);
      GMNetworkManager.role = 'client';
      expect(lasting(GameEffectType.EffectSetState, 2)).toBe(2);
    } finally {
      (GameState as any).hooks = was;
      GMNetworkManager.role = 'host';
    }
  });

  test("Careers buffs, cooldowns and winded run whole turns too", () => {
    const was = (GameState as any).hooks;
    (GameState as any).hooks = GMManager.engineHooks;
    try {
      const { rt } = casterWith(['root']);
      rt.talents.addBuff({ id: 'x', label: 'X', remaining: 4 });
      expect(rt.talents.buffs[0].remaining).toBe(6);
      rt.talents.startCooldown('y', 7);
      expect(rt.talents.cooldownLeft('y')).toBe(9);
      rt.spendStrain(99);
      expect(rt.windedSeconds).toBe(6);
    } finally {
      (GameState as any).hooks = was;
    }
  });
});

describe('variants on the power wheel', () => {
  test('Push, Pull, Whirlwind and Wave are four entries, and a player asking for Pull gets the variant', () => {
    const { caster, rt } = casterWith(['root', 'pull', 'whirlwind', 'magnitude', 'wave']);
    caster.spells = rt.derived.spellIds.map((id) => ({ ...PUSH_ROWS[id as keyof typeof PUSH_ROWS], id, forcehostile: 6, forcepoints: 20 }));
    const keys = GMPlayerHud.abilities(caster).filter((a) => a.kind === 'power').map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining([`power:${FORCE_PUSH}`, `power:${FORCE_PUSH}:pull`, `power:${FORCE_WHIRLWIND}`, `power:${FORCE_WAVE}`]));
    expect(GMPlayerHud.abilities(caster).find((a) => a.key === `power:${FORCE_PUSH}:pull`)?.name).toBe('Pull');

    expect((GMPlayers.spellToCast(caster, FORCE_PUSH, 'pull') as any)?.careersVariant).toBe('pull');
    expect(GMPlayers.spellToCast(caster, FORCE_PUSH, 'yank')).toBeUndefined();
    expect(GMPlayers.spellToCast(caster, FORCE_WAVE, 'pull')).toBeUndefined();
    expect(GMPlayers.spellToCast(caster, FORCE_PUSH)?.careersVariant).toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: { gmMode: true } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import * as THREE from "three";
import { GameState } from "@/GameState";
import { GMCombatAI } from "@/managers/gm/GMCombatAI";
import { ModuleItem } from "@/module/ModuleItem";
import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";

// spells.2da rows the tests use (the real columns: category, forcehostile, forcefriendly, impactscript, range)
const SPELLS: Record<number, any> = {
  28: { label: 'FORCE_POWER_HEAL', category: '0x2441', forcehostile: '****', forcefriendly: '0', range: 'T' },
  8: { label: 'FORCE_POWER_SPEED_BURST', category: '0x1808', forcehostile: '****', forcefriendly: '2', range: 'P' },
  35: { label: 'FORCE_POWER_LIGHTNING', category: '0x8101', forcehostile: '5', forcefriendly: '****', range: 'M' },
  46: { label: 'FORCE_POWER_STUN', category: '0x1201', forcehostile: '0', forcefriendly: '****', range: 'M' },
  25: { label: 'FORCE_POWER_FORCE_STORM', category: '0x2111', forcehostile: '5', forcefriendly: '****', range: 'S' },
  12: { label: 'FORCE_POWER_DROID_DISABLE', category: '0x2201', forcehostile: '1', forcefriendly: '****', range: 'M' },
  // A single-target droid power (KotOR's own droid powers hit an area)
  900: { label: 'TEST_DROID_SHOCK', category: '0x1201', forcehostile: '1', forcefriendly: '****', range: 'M' },
  95: { label: 'ITEM_ABILITY_GRENADE_ION', category: '****', forcehostile: '****', forcefriendly: '****', impactscript: 'k_sup_grenade', range: 'L' },
  64: { label: 'ITEM_ABILITY_MED_PACK', category: '0x1408', forcehostile: '****', forcefriendly: '****', impactscript: 'k_sup_healing', range: 'T' },
  87: { label: 'ITEM_ABILITY_GRENADE_FRAGMENTATION', category: '****', forcehostile: '****', forcefriendly: '****', impactscript: 'k_sup_grenade', range: 'L' },
};

const power = (id: number, cost = 10, range = 15) => ({ id, getForcePointCost: () => cost, getCastRange: () => range, useTalentOnObject: jest.fn() });
const usable = (spellId: number, resRef: string) => ({
  getUsableCastSpellProperties: () => [{ spellId }],
  getItemResRef: () => resRef,
  getEquippedRes: () => resRef,
  getInventoryRes: () => resRef,
  getBaseItem: () => ({ equipableSlots: 0 }),
  getWeaponType: () => 0,
  useItemOnObject: jest.fn(),
});
const weapon = (resRef: string, ranged: boolean) => ({
  ...usable(-1, resRef),
  getUsableCastSpellProperties: (): any[] => [],
  getBaseItem: () => ({ equipableSlots: ModuleCreatureArmorSlot.RIGHTHAND }),
  getWeaponType: () => (ranged ? 4 : 1),
  isRangedWeapon: () => ranged,
  getName: () => resRef,
});

function creature(name: string, x: number, overrides: Record<string, any> = {}): any {
  return {
    name,
    position: new THREE.Vector3(x, 0, 0),
    hp: 100, maxHp: 100, fp: 100, maxFp: 100,
    effects: [] as any[],
    inventory: [] as any[],
    equipment: {} as Record<string, any>,
    spells: [] as any[],
    feats: [] as any[],
    race: 6,
    hostileTo: new Set<any>(),
    getName() { return this.name; },
    getHP() { return this.hp; },
    getMaxHP() { return this.maxHp; },
    getFP() { return this.fp; },
    getMaxFP() { return this.maxFp; },
    getRace() { return this.race; },
    getSpells() { return this.spells; },
    getFeats() { return this.feats; },
    isDead() { return false; },
    isHostile(other: any) { return this.hostileTo.has(other); },
    isRangedEquipped() { return !!this.equipment.RIGHTHAND?.isRangedWeapon?.(); },
    attackCreature: jest.fn(),
    clearAllActions: jest.fn(),
    actionQueue: [] as any[],
    combatRound: {} as any,
    unequipSlot: jest.fn(),
    equipItem: jest.fn(async () => {}),
    ...overrides,
  };
}

/** Two creatures hostile to each other */
function fight(npcProps: Record<string, any> = {}, foeProps: Record<string, any> = {}, distance = 4) {
  const npc = creature('Sith', 0, npcProps);
  const foe = creature('Hero', distance, foeProps);
  npc.hostileTo.add(foe);
  foe.hostileTo.add(npc);
  return { npc, foe };
}

beforeEach(() => {
  (GameState as any).TwoDAManager = { datatables: new Map([['spells', { rows: SPELLS }]]) };
  jest.spyOn(ModuleItem, 'GetCastSpellId').mockImplementation((p: any) => p.spellId);
  jest.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => jest.restoreAllMocks());

describe("what an NPC has to fight with", () => {
  test("its powers, combat feats, items and spare weapons are sorted by what they're for", () => {
    const blaster = weapon('g_w_blstrpstl001', true);
    const { npc } = fight({
      spells: [power(28), power(8), power(35), power(25)],
      feats: [{ id: 28, category: 0x1104, successor: 29 }, { id: 29, category: 0x1104, successor: -1 }, { id: 30, category: 0x1111, successor: -1 }],
      inventory: [usable(64, 'g_i_medeqpmnt01'), usable(87, 'g_w_fraggren01'), blaster],
    });
    const kit = GMCombatAI.kitOf(npc);
    expect(kit.heals.map((t) => t.label)).toEqual(['FORCE_POWER_HEAL', 'ITEM_ABILITY_MED_PACK']);
    expect(kit.buffs.map((t) => t.label)).toEqual(['FORCE_POWER_SPEED_BURST']);
    expect(kit.harms.map((t) => [t.label, t.area])).toEqual([['FORCE_POWER_LIGHTNING', false], ['FORCE_POWER_FORCE_STORM', true]]);
    expect(kit.grenades.map((t) => [t.label, t.area, t.discriminate, t.droidsOnly])).toEqual([['ITEM_ABILITY_GRENADE_FRAGMENTATION', true, false, false]]);
    expect(GMCombatAI.describeSpell(95, { cost: 0 }).droidsOnly).toBe(true);
    // Only the top of a feat chain
    expect(kit.meleeFeats.map((f) => f.id)).toEqual([29]);
    expect(kit.rangedFeats.map((f) => f.id)).toEqual([30]);
    expect(kit.rangedWeapons).toEqual([blaster]);
  });
});

describe("choosing what to do", () => {
  test("badly hurt, it heals itself (a medpac when it has no healing power)", () => {
    const medpac = usable(64, 'g_i_medeqpmnt01');
    const { npc, foe } = fight({ hp: 20, inventory: [medpac] });
    expect(GMCombatAI.engage(npc, foe, [npc, foe])).toBe('heal-self');
    expect(medpac.useItemOnObject).toHaveBeenCalledWith(npc, npc);
  });

  test("a grenade only at a cluster, and never with its own side in the blast", () => {
    const grenade = () => usable(87, 'g_w_fraggren01');
    const one = fight({ inventory: [grenade()] }, {}, 8);
    expect(GMCombatAI.engage(one.npc, one.foe, [one.npc, one.foe])).not.toBe('area');

    const { npc, foe } = fight({ inventory: [grenade()] }, {}, 8);
    const second = creature('Sidekick', 9);
    npc.hostileTo.add(second);
    expect(GMCombatAI.engage(npc, foe, [npc, foe, second])).toBe('area');

    const again = fight({ inventory: [grenade()] }, {}, 8);
    const third = creature('Sidekick', 9);
    again.npc.hostileTo.add(third);
    const friend = creature('Trooper', 9.5);
    expect(GMCombatAI.engage(again.npc, again.foe, [again.npc, again.foe, third, friend])).not.toBe('area');
  });

  test("it doesn't recast a buff it has, or a debuff its target is still under", () => {
    const speed = power(8);
    const stun = power(46);
    const { npc, foe } = fight({ spells: [speed, stun] });
    npc.effects.push({ spellId: 8 });
    foe.effects.push({ spellId: 46 });
    expect(GMCombatAI.engage(npc, foe, [npc, foe])).not.toMatch(/buff|power/);
    expect(speed.useTalentOnObject).not.toHaveBeenCalled();
    expect(stun.useTalentOnObject).not.toHaveBeenCalled();
  });

  test("droid powers only on droids", () => {
    const disable = power(900);
    const { npc, foe } = fight({ spells: [disable] });
    GMCombatAI.engage(npc, foe, [npc, foe]);
    expect(disable.useTalentOnObject).not.toHaveBeenCalled();
    const droid = fight({ spells: [disable] }, { race: 5 });
    expect(GMCombatAI.engage(droid.npc, droid.foe, [droid.npc, droid.foe])).toBe('power');
  });

  test("out of Force points, it falls back to its weapons", () => {
    const lightning = power(35, 20);
    const { npc, foe } = fight({ fp: 5, spells: [lightning] });
    expect(GMCombatAI.engage(npc, foe, [npc, foe])).toBe('attack');
    expect(lightning.useTalentOnObject).not.toHaveBeenCalled();
    expect(npc.attackCreature).toHaveBeenCalledWith(foe, undefined);
  });

  test("it gets out a ranged weapon for a distant target, and its melee weapon when someone closes in, not flip-flopping", () => {
    const sword = weapon('g_w_vbroswrd01', false);
    const rifle = weapon('g_w_blstrrfl001', true);
    const far = fight({ equipment: { RIGHTHAND: sword }, inventory: [rifle] }, {}, 12);
    expect(GMCombatAI.engage(far.npc, far.foe, [far.npc, far.foe])).toBe('weapon');
    expect(far.npc.equipItem).toHaveBeenCalledWith(ModuleCreatureArmorSlot.RIGHTHAND, rifle);
    // Straight after, the swap is on cooldown
    expect(GMCombatAI.engage(far.npc, far.foe, [far.npc, far.foe])).not.toBe('weapon');

    const close = fight({ equipment: { RIGHTHAND: rifle }, inventory: [sword] }, {}, 1.5);
    expect(GMCombatAI.engage(close.npc, close.foe, [close.npc, close.foe])).toBe('weapon');
    expect(close.npc.equipItem).toHaveBeenCalledWith(ModuleCreatureArmorSlot.RIGHTHAND, sword);
  });

  test("it takes out the weapon in its pack, not a stale copy, and swaps one at a time (a body dropped two rifles and no sword)", async () => {
    const staleRifle = weapon('g_w_blstrrfl001', true);
    const packRifle = weapon('g_w_blstrrfl001', true);
    const sword = weapon('g_w_vbroswrd01', false);
    const { npc } = fight({ equipment: { RIGHTHAND: sword }, inventory: [packRifle] }, {}, 12);
    const first = GMCombatAI.equipWeapon(npc, staleRifle as any);
    const second = GMCombatAI.equipWeapon(npc, sword as any);
    expect(second).toBe(first);
    await first;
    expect(npc.equipItem).toHaveBeenCalledTimes(1);
    expect(npc.equipItem).toHaveBeenCalledWith(ModuleCreatureArmorSlot.RIGHTHAND, packRifle);
    expect(npc.inventory).not.toContain(packRifle);
  });

  test("a weapon it no longer carries isn't taken out", async () => {
    const gone = weapon('g_w_blstrrfl001', true);
    const { npc } = fight({ inventory: [] }, {}, 12);
    await GMCombatAI.equipWeapon(npc, gone as any);
    expect(npc.equipItem).not.toHaveBeenCalled();
  });

  test("the GM's styles limit what it uses", () => {
    const lightning = power(35);
    const medpac = usable(64, 'g_i_medeqpmnt01');
    const weaponsOnly = fight({ gmCombatStyle: 'weapons', hp: 10, spells: [lightning], inventory: [medpac], feats: [{ id: 28, category: 0x1104, successor: -1, useTalentOnObject: jest.fn() }] });
    expect(['feat', 'attack']).toContain(GMCombatAI.engage(weaponsOnly.npc, weaponsOnly.foe, [weaponsOnly.npc, weaponsOnly.foe]));
    expect(lightning.useTalentOnObject).not.toHaveBeenCalled();
    expect(medpac.useItemOnObject).not.toHaveBeenCalled();

    const plain = fight({ gmCombatStyle: 'attack', spells: [lightning] });
    expect(GMCombatAI.engage(plain.npc, plain.foe, [plain.npc, plain.foe])).toBe('attack');
    expect(plain.npc.attackCreature).toHaveBeenCalledWith(plain.foe, undefined);
  });
});

describe("deciding every round", () => {
  test("an NPC already attacking its target keeps at it, and stops to do anything else", () => {
    const lightning = power(35);
    const { npc, foe } = fight({ spells: [lightning] });
    npc.combatRound.action = { target: foe };
    // Out of Force: the attack goes on, untouched
    npc.fp = 0;
    expect(GMCombatAI.engage(npc, foe, [npc, foe])).toBe('attack');
    expect(npc.attackCreature).not.toHaveBeenCalled();
    expect(npc.clearAllActions).not.toHaveBeenCalled();
    // With the Force for it, the attack stops for the power
    npc.fp = 100;
    expect(GMCombatAI.engage(npc, foe, [npc, foe])).toBe('power');
    expect(npc.clearAllActions).toHaveBeenCalled();
    expect(lightning.useTalentOnObject).toHaveBeenCalledWith(foe, npc);
  });
});

describe("who runs a GM NPC's behaviour: the GM's AI or its own scripts", () => {
  const npc = (o: Record<string, any> = {}): any => ({ ...o });
  const withGM = (o: Record<string, any>, net: Record<string, any> = {}) => {
    (GameState as any).gmMode = true;
    (GameState as any).GMManager = { isAutonomousNpc: () => true, npcAiEnabled: true, ...o };
    (GameState as any).GMNetworkManager = { role: 'host', ...net };
    (GameState as any).hooks = { isNetReplica: () => false };
  };

  test("with the NPC AI on, the GM's AI does (its scripts kept pulling it another way)", () => {
    withGM({});
    expect(GMCombatAI.runsBehaviourScripts(npc())).toBe(false);
  });

  test('the NPC AI off: its own scripts, unless the GM gave it an order', () => {
    withGM({ npcAiEnabled: false });
    expect(GMCombatAI.runsBehaviourScripts(npc())).toBe(true);
    expect(GMCombatAI.runsBehaviourScripts(npc({ gmOrder: { kind: 'guard' } }))).toBe(false);
  });

  test('the GM can leave one to its own scripts (a boss, a plot NPC)', () => {
    withGM({});
    expect(GMCombatAI.runsBehaviourScripts(npc({ gmScripted: true }))).toBe(true);
  });

  test("players' characters keep their scripts; outside GM mode nothing changes", () => {
    withGM({ isAutonomousNpc: () => false });
    expect(GMCombatAI.runsBehaviourScripts(npc())).toBe(true);
    withGM({});
    (GameState as any).gmMode = false;
    expect(GMCombatAI.runsBehaviourScripts(npc())).toBe(true);
  });

  test("on a player's machine, copies of the GM's creatures run no behaviour scripts (the GM's machine does)", () => {
    withGM({}, { role: 'client' });
    (GameState as any).hooks = { isNetReplica: () => true };
    expect(GMCombatAI.runsBehaviourScripts(npc())).toBe(false);
  });
});

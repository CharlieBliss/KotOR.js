import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: { gmMode: true } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));
jest.mock("@/engine/rules/CharacterRules", () => ({ CharacterRules: { text: (_s: any, fallback = '') => fallback } }));

import * as THREE from "three";
import { GameState } from "@/GameState";
import { GMPlayerHud } from "@/managers/gm/GMPlayerHud";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { SkillType } from "@/enums/nwscript/SkillType";

const spell = (id: number, label: string, cols: Record<string, any>, cost = 10) => ({
  id, label, name: -1, iconresref: `ip_${id}`, forcehostile: '****', forcefriendly: '****', range: 'M', ...cols,
  getForcePointCost: () => cost,
});
const item = (resRef: string, use: 'self' | 'hostile', stack = 1) => ({
  getUseTargeting: () => use, getItemResRef: () => resRef, getStackSize: () => stack, getName: () => resRef, getIcon: () => `i_${resRef}`,
});

function creature(name: string, x: number, o: Record<string, any> = {}): any {
  return {
    name, objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    position: new THREE.Vector3(x, 0, 0), dead: false, hostile: false, friendly: false,
    fp: 30, spells: [] as any[], feats: [] as any[], inventory: [] as any[], equipment: {}, weaponType: 1,
    getName() { return this.name; }, isDead() { return this.dead; },
    isHostile() { return this.hostile; }, isFriendly() { return this.friendly; },
    getFP() { return this.fp; }, getSpells() { return this.spells; }, getFeats() { return this.feats; },
    getInventory() { return this.inventory; }, getEquippedWeaponType() { return this.weaponType; },
    ...o,
  };
}

let pc: any;
let creatures: any[];
const runMenuItem = jest.fn();

beforeEach(() => {
  pc = creature('Hero', 0);
  creatures = [pc];
  runMenuItem.mockReset();
  const G: any = GameState;
  G.getCurrentPlayer = () => pc;
  G.module = { area: { creatures } };
  G.hooks = { isPlayerCharacter: (o: any) => !!o?.isPC };
  G.CursorManager = {
    selectedObject: undefined,
    setReticleSelectedObject(o: any) { this.selectedObject = o; },
    setReticleHoveredObject() { /* the hover reticle */ },
  };
  G.ActionMenuManager = { SetPC: jest.fn(), runMenuItem };
  G.GameKey = 'kotor';
  (GMNetworkManager as any).sessionRules = { deathRule: 'kotor' };
});

describe('what a player can use', () => {
  test('attack, combat feats for the weapon in hand, hostile then friendly powers, then grenades and medpacs', () => {
    pc.feats = [
      { id: 28, category: 0x1104, successor: 29, icon: 'ip_pa', label: 'Power Attack' },
      { id: 29, category: 0x1104, successor: -1, icon: 'ip_ipa', label: 'Improved Power Attack' },
      { id: 26, category: 0x1111, successor: -1, icon: 'ip_rf', label: 'Rapid Shot' },
    ];
    pc.spells = [spell(28, 'Heal', { forcefriendly: '0', range: 'T' }, 20), spell(35, 'Lightning', { forcehostile: '5' }, 40), spell(8, 'Speed', { forcefriendly: '2', range: 'P' }, 5)];
    pc.inventory = [item('medpac', 'self', 3), item('frag', 'hostile', 2), item('frag', 'hostile', 1)];
    const list = GMPlayerHud.abilities(pc);
    expect(list.map((a) => a.key)).toEqual(['attack', 'feat:29', 'feat:26', 'power:35', 'power:28', 'power:8', 'item:frag', 'item:medpac']);
    const by = new Map(list.map((a) => [a.key, a]));
    expect(by.get('feat:26')!.usable).toBe(false);
    expect(by.get('feat:26')!.why).toMatch(/ranged/);
    expect(by.get('power:35')).toMatchObject({ aim: 'enemy', cost: 40, usable: false });
    expect(by.get('power:28')).toMatchObject({ aim: 'ally', usable: true });
    expect(by.get('power:8')).toMatchObject({ aim: 'self' });
    expect(by.get('item:frag')).toMatchObject({ aim: 'enemy', count: 3 });
    expect(by.get('item:medpac')).toMatchObject({ aim: 'self', count: 3 });
  });

  test("a power's empty hostile or friendly cell (-1 once loaded) doesn't count; a personal power is cast on you", () => {
    pc.spells = [
      spell(8, 'Speed', { forcehostile: -1, forcefriendly: 2, range: 'P' }),
      spell(28, 'Heal', { forcehostile: -1, forcefriendly: 0, range: 'T' }),
      spell(35, 'Lightning', { forcehostile: 5, forcefriendly: -1 }),
      spell(138, 'Battle Meditation', { forcehostile: 1, forcefriendly: 1, range: 'P' }),
    ];
    const aims = Object.fromEntries(GMPlayerHud.abilities(pc).filter((a) => a.kind === 'power').map((a) => [a.name, a.aim]));
    expect(aims).toEqual({ Lightning: 'enemy', 'Battle Meditation': 'self', Speed: 'self', Heal: 'ally' });
  });

  test('the default bar: offensive powers and grenades first, no plain attack, eight slots', () => {
    pc.spells = [spell(28, 'Heal', { forcefriendly: '0' }), spell(35, 'Lightning', { forcehostile: '5' })];
    pc.inventory = [item('medpac', 'self'), item('frag', 'hostile')];
    const bar = GMPlayerHud.defaultLoadout(GMPlayerHud.abilities(pc));
    expect(bar).toHaveLength(8);
    expect(bar.slice(0, 4)).toEqual(['power:35', 'item:frag', 'power:28', 'item:medpac']);
    expect(bar).not.toContain('attack');
  });
});

describe('aiming', () => {
  test('a hostile use goes to the enemy target, else the nearest enemy, which becomes the target', () => {
    const far = creature('Far', 20, { hostile: true }), near = creature('Near', 5, { hostile: true }), dead = creature('Dead', 1, { hostile: true, dead: true });
    creatures.push(far, near, dead);
    expect(GMPlayerHud.targetFor('enemy')).toBe(near);
    expect(GameState.CursorManager.selectedObject).toBe(near);
    GameState.CursorManager.selectedObject = far;
    expect(GMPlayerHud.targetFor('enemy')).toBe(far);
  });

  test('no enemy around: nothing to aim at, and nothing is sent', () => {
    creatures.push(creature('Friend', 3, { friendly: true }));
    expect(GMPlayerHud.targetFor('enemy')).toBeUndefined();
    expect(GMPlayerHud.use({ key: 'attack', kind: 'attack', name: 'Attack', icon: '', aim: 'enemy', cost: 0, usable: true, entry: {} }))
      .toMatchObject({ ok: false, message: 'No enemy in sight' });
    expect(runMenuItem).not.toHaveBeenCalled();
  });

  test('a friendly power goes to the selected ally, else you; a personal one always to you', () => {
    const ally = creature('Ally', 4, { isPC: true });
    creatures.push(ally);
    expect(GMPlayerHud.targetFor('ally')).toBe(pc);
    GameState.CursorManager.selectedObject = ally;
    expect(GMPlayerHud.targetFor('ally')).toBe(ally);
    expect(GMPlayerHud.targetFor('self')).toBe(pc);
  });

  test('a use runs through the action menu with its target; one that cannot be used says why', () => {
    const foe = creature('Foe', 3, { hostile: true });
    creatures.push(foe);
    const entry = { talent: {} };
    expect(GMPlayerHud.use({ key: 'power:35', kind: 'power', name: 'Lightning', icon: '', aim: 'enemy', cost: 5, usable: true, entry }).ok).toBe(true);
    expect(runMenuItem).toHaveBeenCalledWith(entry, foe);
    expect(GMPlayerHud.use({ key: 'power:36', kind: 'power', name: 'Storm', icon: '', aim: 'enemy', cost: 50, usable: false, why: 'Needs 50 Force', entry }))
      .toMatchObject({ ok: false, message: 'Needs 50 Force' });
    expect(runMenuItem).toHaveBeenCalledTimes(1);
  });
});

describe('Tab targeting', () => {
  test('Tab steps through living, visible enemies in reach, nearest first, and wraps; Shift+Tab through allies', () => {
    const a = creature('A', 3, { hostile: true }), b = creature('B', 8, { hostile: true }), hidden = creature('Hidden', 2, { hostile: true, gmHidden: true });
    const out = creature('Out', 80, { hostile: true }), ally = creature('Ally', 6, { friendly: true });
    creatures.push(b, a, hidden, out, ally);
    expect(GMPlayerHud.cycle('enemy')).toBe(a);
    expect(GMPlayerHud.cycle('enemy')).toBe(b);
    expect(GMPlayerHud.cycle('enemy')).toBe(a);
    expect(GMPlayerHud.cycle('ally')).toBe(ally);
  });

  test('the target falls: the next nearest enemy is picked', () => {
    const a = creature('A', 3, { hostile: true }), b = creature('B', 8, { hostile: true });
    creatures.push(a, b);
    GameState.CursorManager.selectedObject = a;
    expect(GMPlayerHud.retargetAfterKill()).toBeUndefined();
    a.dead = true;
    expect(GMPlayerHud.retargetAfterKill()).toBe(b);
    expect(GameState.CursorManager.selectedObject).toBe(b);
  });
});

describe('the bar is saved per character', () => {
  test('assigning moves an ability into a slot (out of any other) and is kept; reset brings back the default', () => {
    const store: Record<string, string> = {};
    (global as any).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    };
    pc.spells = [spell(35, 'Lightning', { forcehostile: '5' }), spell(28, 'Heal', { forcefriendly: '0' })];
    expect(GMPlayerHud.loadout(pc).slice(0, 2)).toEqual(['power:35', 'power:28']);
    GMPlayerHud.assignSlot(5, 'power:35', pc);
    const bar = GMPlayerHud.loadout(pc);
    expect(bar[0]).toBeNull();
    expect(bar[5]).toBe('power:35');
    GMPlayerHud.resetLoadout(pc);
    expect(GMPlayerHud.loadout(pc)[0]).toBe('power:35');
  });
});

describe('picking a body', () => {
  test("a body the player picks on purpose (to search it) stays picked; only a kill while targeted moves on", () => {
    const body = creature('Body', 3, { hostile: true, dead: true }), next = creature('Next', 6, { hostile: true });
    creatures.push(body, next);
    GameState.CursorManager.selectedObject = body;
    expect(GMPlayerHud.retargetAfterKill()).toBeUndefined();
    expect(GMPlayerHud.retargetAfterKill()).toBeUndefined();
    expect(GameState.CursorManager.selectedObject).toBe(body);
  });
});

describe('what the target allows', () => {
  const T = ModuleObjectType;
  const obj = (type: number, o: Record<string, any> = {}): any => ({
    objectType: T.ModuleObject | type, position: new THREE.Vector3(2, 0, 0), getName: () => 'Thing', ...o,
  });
  beforeEach(() => {
    (GameState as any).GMConversationManager = { canTalkTo: (o: any) => !!o.talks };
    pc.getSkillRanks = (skill: number) => pc.skillRanks?.[skill] ?? 0;
  });
  const ids = (target: any) => GMPlayerHud.targetActions(target, pc).map((a) => `${a.id}${a.primary ? '*' : ''}${a.usable ? '' : '(no)'}`);

  test('an enemy: attack; a friend you can talk to: talk; a body: search', () => {
    expect(ids(creature('Foe', 3, { hostile: true }))).toEqual(['attack*']);
    expect(ids(creature('Friend', 3, { friendly: true, talks: true }))).toEqual(['talk*']);
    expect(ids(creature('Body', 3, { hostile: true, dead: true }))).toEqual(['search*']);
    expect(ids(creature('Mute', 3, { friendly: true }))).toEqual([]);
  });

  test('a locked door: Open is out, Unlock is the main action with the Security skill; without it, why not', () => {
    const door = obj(T.ModuleDoor, { isOpen: () => false, isLocked: () => true });
    pc.skillRanks = { [SkillType.SECURITY]: 2 };
    expect(ids(door)).toEqual(['open(no)', 'unlock*']);
    pc.skillRanks = {};
    expect(ids(door)).toEqual(['open(no)', 'unlock(no)']);
    pc.inventory = [{ baseItemId: 59, getName: () => 'Security Tunneler' }];
    expect(ids(door)).toEqual(['open(no)', 'tunneler*']);
  });

  test('an unlocked door opens; an open one offers nothing', () => {
    expect(ids(obj(T.ModuleDoor, { isOpen: () => false, isLocked: () => false }))).toEqual(['open*']);
    expect(ids(obj(T.ModuleDoor, { isOpen: () => true }))).toEqual([]);
  });

  test('a container is searched, a computer used', () => {
    expect(ids(obj(T.ModulePlaceable, { hasInventory: true, isLocked: () => false }))).toEqual(['search*']);
    expect(ids(obj(T.ModulePlaceable, { talks: true }))).toEqual(['use*']);
  });

  test('a mine: disarm and recover with Demolitions; without it, why not', () => {
    const mine = obj(T.ModuleTrigger, { type: 2, trapDisarmable: true });
    pc.skillRanks = { [SkillType.DEMOLITIONS]: 1 };
    expect(ids(mine)).toEqual(['disarm*', 'recover']);
    pc.skillRanks = {};
    expect(ids(mine)).toEqual(['disarm(no)']);
  });

  test("a locked door's unlock goes to the host as KotOR's own menu sends it", () => {
    const door = obj(T.ModuleDoor, { isOpen: () => false, isLocked: () => true });
    pc.skillRanks = { [SkillType.SECURITY]: 2 };
    (GameState as any).ActionFactory = { ActionUnlockObject: class { params: any[] = []; setOwner() {} setParameter(i: number, _t: number, v: any) { this.params[i] = v; } } };
    GameState.CursorManager.selectedObject = door;
    expect(GMPlayerHud.runTargetAction('unlock').ok).toBe(true);
    const entry = runMenuItem.mock.calls[0][0] as any;
    expect(entry.action.params[0]).toBe(door);
    expect(runMenuItem.mock.calls[0][1]).toBe(door);
    expect(GMPlayerHud.runTargetAction('open')).toMatchObject({ ok: false, message: 'Locked' });
  });

  test('in Host POSSESS or Offline GM mode, runTargetAction attacks/interacts locally and stop() clears queue', () => {
    const foe = creature('Foe', 3, { hostile: true });
    pc.cancelCombat = jest.fn();
    pc.clearAllActions = jest.fn();
    pc.attackCreature = jest.fn();
    pc.combatRound = { clearActions: jest.fn() };
    pc.gmFightTarget = foe;
    GMNetworkManager.role = 'host';
    (GameState as any).hooks = { isPlayerCharacter: (o: any) => !!o?.isPC, interceptInteraction: () => false };
    GameState.CursorManager.selectedObject = foe;

    expect(GMPlayerHud.runTargetAction('attack')).toEqual({ ok: true });
    expect(pc.clearAllActions).toHaveBeenCalled();
    expect(pc.attackCreature).toHaveBeenCalledWith(foe, undefined);

    GMPlayerHud.stop();
    expect(pc.cancelCombat).toHaveBeenCalled();
    expect(pc.combatRound.clearActions).toHaveBeenCalled();
    expect(pc.gmFightTarget).toBeUndefined();
  });
});

describe('where an ability lands now', () => {
  const ability = (aim: 'enemy' | 'ally' | 'self'): any => ({ key: aim, kind: 'power', name: aim, icon: '', aim, cost: 0, usable: true, entry: {} });

  test('an attack: the enemy target, else the nearest enemy (without changing the target), else no one', () => {
    expect(GMPlayerHud.landsOn(ability('enemy'), pc).how).toBe('none');
    const near = creature('Near', 5, { hostile: true }), far = creature('Far', 15, { hostile: true });
    creatures.push(far, near);
    expect(GMPlayerHud.landsOn(ability('enemy'), pc)).toEqual({ how: 'nearest', who: near });
    expect(GameState.CursorManager.selectedObject).toBeUndefined();
    GameState.CursorManager.selectedObject = far;
    expect(GMPlayerHud.landsOn(ability('enemy'), pc)).toEqual({ how: 'target', who: far });
  });

  test('a helping power: the friend targeted, else you; a personal one: you', () => {
    const friend = creature('Friend', 4, { friendly: true });
    creatures.push(friend);
    expect(GMPlayerHud.landsOn(ability('ally'), pc).how).toBe('self');
    GameState.CursorManager.selectedObject = friend;
    expect(GMPlayerHud.landsOn(ability('ally'), pc)).toEqual({ how: 'target', who: friend });
    expect(GMPlayerHud.landsOn(ability('self'), pc).how).toBe('self');
  });

  test("the wheel puts what fits the target first: helping powers when a friend's targeted", () => {
    const list = [ability('enemy'), ability('ally'), ability('self')];
    expect(GMPlayerHud.orderForTarget(list, pc).map((a) => a.aim)).toEqual(['enemy', 'ally', 'self']);
    const friend = creature('Friend', 4, { friendly: true });
    creatures.push(friend);
    GameState.CursorManager.selectedObject = friend;
    expect(GMPlayerHud.orderForTarget(list, pc).map((a) => a.aim)).toEqual(['ally', 'self', 'enemy']);
  });
});

describe('the default bar', () => {
  test('keeps up to three slots for what helps, even when attack powers alone would fill it', () => {
    const attack = (id: number) => spell(id, `A${id}`, { forcehostile: '1' });
    pc.spells = [101, 102, 103, 104, 105, 106, 107, 108, 109].map(attack).concat([spell(28, 'Heal', { forcefriendly: '0' }), spell(8, 'Speed', { forcefriendly: '2', range: 'P' })]);
    pc.inventory = [item('medpac', 'self'), item('stim', 'self')];
    const bar = GMPlayerHud.defaultLoadout(GMPlayerHud.abilities(pc));
    expect(bar.slice(0, 5)).toEqual(['power:101', 'power:102', 'power:103', 'power:104', 'power:105']);
    expect(bar.slice(5)).toEqual(['power:28', 'power:8', 'item:medpac']);
  });
});

describe('descriptions, spell chains & active effects', () => {
  test('marks superseded lower spell ranks and populates category, range and item descriptions', () => {
    pc.spells = [
      spell(8, 'Burst of Speed', { forcefriendly: '2', range: 'P', prerequisites: [] }, 10),
      spell(33, 'Knight Speed', { forcefriendly: '2', range: 'P', prerequisites: [8] }, 15),
      spell(46, 'Stun', { forcehostile: '1', range: 'M', prerequisites: [] }, 10),
    ];
    pc.inventory = [{ ...item('medpac', 'self', 2), descIdentified: 'Restores 30 vitality.' }];
    const byKey = new Map(GMPlayerHud.abilities(pc).map((a) => [a.key, a]));
    expect(byKey.get('power:8')).toMatchObject({ category: 'buff', range: 'Personal', isBestRank: false });
    expect(byKey.get('power:33')).toMatchObject({ category: 'buff', range: 'Personal', isBestRank: true });
    expect(byKey.get('power:46')).toMatchObject({ category: 'offense', range: 'Medium (15 m)', isBestRank: true });
    expect(byKey.get('item:medpac')).toMatchObject({ category: 'item', description: 'Restores 30 vitality.' });
  });
});

describe('planning countdown', () => {
  test('refreshes secondsLeft when the GM adds or changes a time limit mid-hold', () => {
    GMPlayerHud.planRound = -1;
    GMPlayerHud.planPacingRef = undefined;
    GMPlayerHud.planSecondsLeft = undefined;
    (GMNetworkManager as any).sessionRules = {
      deathRule: 'kotor',
      pacing: { mode: 'every', phase: 'plan', round: 1, ready: [], waiting: ['Hero'], timeLimit: 0, showIntents: true },
    };
    GMPlayerHud.updatePlannedMove(0.016);
    expect(GMPlayerHud.planSecondsLeftNow()).toBeUndefined();

    // GM turns on a 15 s time limit during the same round
    (GMNetworkManager as any).sessionRules = {
      deathRule: 'kotor',
      pacing: { mode: 'every', phase: 'plan', round: 1, ready: [], waiting: ['Hero'], secondsLeft: 15, timeLimit: 15, showIntents: true },
    };
    GMPlayerHud.updatePlannedMove(0.016);
    expect(GMPlayerHud.planSecondsLeftNow()).toBe(15);

    // GM turns the limit back off mid-hold
    (GMNetworkManager as any).sessionRules = {
      deathRule: 'kotor',
      pacing: { mode: 'every', phase: 'plan', round: 1, ready: [], waiting: ['Hero'], timeLimit: 0, showIntents: true },
    };
    GMPlayerHud.updatePlannedMove(0.016);
    expect(GMPlayerHud.planSecondsLeftNow()).toBeUndefined();
  });

  test('WASD steering combines simultaneous axes diagonally and setPlannedMove clamps & sends', () => {
    GMPlayerHud.planRound = -1;
    GMPlayerHud.plannedMove = null;
    const prevRole = GMNetworkManager.role;
    const prevJoin = GMNetworkManager.joinState;
    const prevNetId = GMNetworkManager.assignedActorNetId;
    GMNetworkManager.role = 'client';
    GMNetworkManager.joinState = 'playing';
    GMNetworkManager.assignedActorNetId = 'net_hero';
    const sendSpy = jest.spyOn(GMNetworkManager, 'sendIntent').mockImplementation(() => {});
    (GMNetworkManager as any).sessionRules = {
      deathRule: 'kotor',
      pacing: { mode: 'rounds', phase: 'plan', round: 2, ready: [], waiting: ['Hero'], timeLimit: 0, showIntents: true },
    };

    try {
      // Start round 2, then press W (facing 0 -> +Y) and D (facing -PI/2 -> +X) in the same frame
      GMPlayerHud.updatePlannedMove(0.016);
      expect(GMPlayerHud.steerPlannedMove(pc, 0)).toBe(true);
      expect(GMPlayerHud.steerPlannedMove(pc, -Math.PI / 2)).toBe(true);
      GMPlayerHud.updatePlannedMove(0.2);

      expect(GMPlayerHud.plannedMove).not.toBeNull();
      expect(GMPlayerHud.plannedMove!.x).toBeGreaterThan(0.1);
      expect(GMPlayerHud.plannedMove!.y).toBeGreaterThan(0.1);
      expect(GMPlayerHud.plannedMove!.x).toBeCloseTo(GMPlayerHud.plannedMove!.y, 3);

      // Direct mouse placement clamps to one round's run and sends immediately when requested
      const reach = GMPlayerHud.roundReach(pc);
      expect(GMPlayerHud.setPlannedMove({ x: 100, y: 0, z: 0 }, true)).toBe(true);
      expect(GMPlayerHud.plannedMove!.x).toBeCloseTo(reach, 3);
      expect(GMPlayerHud.plannedMove!.y).toBeCloseTo(0, 3);
      expect(sendSpy).toHaveBeenCalledWith('move', undefined, expect.objectContaining({ x: expect.any(Number), y: 0, z: 0 }));
    } finally {
      sendSpy.mockRestore();
      GMNetworkManager.role = prevRole;
      GMNetworkManager.joinState = prevJoin;
      GMNetworkManager.assignedActorNetId = prevNetId;
    }
  });
});

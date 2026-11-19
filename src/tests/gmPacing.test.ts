import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockGMManager: any = {
  npcAiEnabled: true,
  updateNpcCombat: jest.fn(),
  sessionRules: jest.fn(() => ({ deathRule: 'kotor' })),
  notifyChange: jest.fn(),
};
const mockNetwork: any = {
  role: 'host',
  peers: new Map([['p1', { name: 'Mira' }], ['p2', { name: 'Atton' }]]),
  broadcastSessionRules: jest.fn(),
};

jest.mock("@/GameState", () => ({
  GameState: {
    GMManager: mockGMManager,
    GMNetworkManager: mockNetwork,
    TLKManager: { GetStringById: (id: number) => ({ Value: id === 42 ? 'Force Lightning' : '' }) },
  },
}));
jest.mock("@/managers/gm/GMLog", () => ({ GMLog: { info: jest.fn(), warn: jest.fn() } }));
jest.mock("@/combat/CombatRound", () => ({ CombatRound: { ROUND_LENGTH: 3000 } }));

import { GMPacing, GMPacingScan } from "@/managers/gm/GMPacing";
import { CombatActionType } from "@/enums/combat/CombatActionType";
import { ActionType } from "@/enums/actions/ActionType";

const enemy = { getName: () => 'Sith trooper' };
const enemy2 = { getName: () => 'Dark Jedi' };

function scan(over: Partial<GMPacingScan> = {}): GMPacingScan {
  return {
    fighting: true,
    hostilesInCombat: new Set([enemy]),
    players: [{ id: 'Mira', health: 1 }, { id: 'Atton', health: 1 }],
    planners: ['p1', 'p2'],
    ...over,
  };
}

let clock = 0;

beforeEach(() => {
  clock = 100000;
  GMPacing.now = () => clock;
  GMPacing.mode = 'rounds';
  GMPacing.everyRounds = 1;
  GMPacing.timeLimit = 0;
  GMPacing.showIntents = true;
  GMPacing.reset();
  jest.clearAllMocks();
});

/** Play world time in frames of 0.1 s */
function play(seconds: number, s: GMPacingScan = scan()) {
  for (let t = 0; t < seconds - 1e-9; t += 0.1) GMPacing.update(0.1, s);
}

describe('the plan-then-play loop', () => {
  test('a fight starting holds the world for round 1, after the enemies decide', () => {
    GMPacing.update(0.1, scan());
    expect(GMPacing.phase).toBe('plan');
    expect(GMPacing.round).toBe(1);
    expect(mockGMManager.updateNpcCombat).toHaveBeenCalled();
    expect(mockNetwork.broadcastSessionRules).toHaveBeenCalled();
    expect(GMPacing.state().waiting).toEqual(['Mira', 'Atton']);
  });

  test('nothing holds while pacing is off, and turning it off mid-fight lets go', () => {
    GMPacing.mode = 'off';
    const scanSpy = jest.spyOn(GMPacing, 'scan');
    GMPacing.update(0.1);
    expect(scanSpy).not.toHaveBeenCalled();
    scanSpy.mockRestore();
    GMPacing.update(0.1, scan());
    expect(GMPacing.phase).toBe('off');
    GMPacing.configure({ mode: 'rounds' });
    GMPacing.update(0.1, scan());
    expect(GMPacing.phase).toBe('plan');
    GMPacing.configure({ mode: 'off' });
    expect(GMPacing.phase).toBe('off');
  });

  test('the round plays once everyone is ready', () => {
    GMPacing.update(0.1, scan());
    GMPacing.setReady('p1', true);
    GMPacing.update(0.1, scan());
    expect(GMPacing.phase).toBe('plan');
    expect(GMPacing.state()).toMatchObject({ ready: ['Mira'], waiting: ['Atton'] });
    GMPacing.setReady('p2', true);
    GMPacing.update(0.1, scan());
    expect(GMPacing.phase).toBe('play');
  });

  test("the GM's Go plays the round without waiting", () => {
    GMPacing.update(0.1, scan());
    GMPacing.go('the GM says go');
    expect(GMPacing.phase).toBe('play');
  });

  test('a time limit plays the round anyway', () => {
    GMPacing.timeLimit = 15;
    GMPacing.update(0.1, scan());
    expect(GMPacing.state().secondsLeft).toBe(15);
    clock += 14000;
    GMPacing.update(0.1, scan());
    expect(GMPacing.phase).toBe('plan');
    clock += 1000;
    GMPacing.update(0.1, scan());
    expect(GMPacing.phase).toBe('play');
  });

  test('a player who leaves no longer holds the round up', () => {
    GMPacing.update(0.1, scan());
    GMPacing.setReady('p1', true);
    GMPacing.update(0.1, scan({ planners: ['p1'] }));
    expect(GMPacing.phase).toBe('play');
  });

  test('every round: one 3 s round plays, then the world holds for the next', () => {
    GMPacing.update(0.1, scan());
    GMPacing.go('go');
    play(2.9);
    expect(GMPacing.phase).toBe('play');
    play(0.2);
    expect(GMPacing.phase).toBe('plan');
    expect(GMPacing.round).toBe(2);
  });

  test('every 2 rounds: two rounds play between holds', () => {
    GMPacing.everyRounds = 2;
    GMPacing.update(0.1, scan());
    GMPacing.go('go');
    play(3.05);
    expect(GMPacing.phase).toBe('play');
    play(3);
    expect(GMPacing.phase).toBe('plan');
    expect(GMPacing.round).toBe(3);
  });

  test('any number of rounds between holds, kept to 1..10', () => {
    GMPacing.configure({ everyRounds: 4 });
    GMPacing.update(0.1, scan());
    GMPacing.go('go');
    play(9.05);
    expect(GMPacing.phase).toBe('play');
    play(3);
    expect(GMPacing.phase).toBe('plan');
    expect(GMPacing.round).toBe(5);
    GMPacing.configure({ everyRounds: 99 });
    expect(GMPacing.everyRounds).toBe(10);
    GMPacing.configure({ everyRounds: 0 });
    expect(GMPacing.everyRounds).toBe(10);
  });

  test("older saves' 'every2'-style modes still load", () => {
    GMPacing.configure({ mode: 'every3' as any });
    expect(GMPacing.mode).toBe('rounds');
    expect(GMPacing.everyRounds).toBe(3);
    GMPacing.configure({ mode: 'every' as any, everyRounds: undefined });
    expect(GMPacing.everyRounds).toBe(1);
  });

  test('reset clears everything a fight left behind', () => {
    GMPacing.update(0.1, scan());
    GMPacing.setReady('p1', true);
    GMPacing.reset();
    expect(GMPacing.phase).toBe('off');
    expect(GMPacing.round).toBe(0);
    expect(GMPacing.ready.size).toBe(0);
    expect(GMPacing.planners).toEqual([]);
    expect(GMPacing.seenHostiles.size).toBe(0);
  });

  test("the round's clock stops while the GM pauses or a wheel holds the world", () => {
    GMPacing.update(0.1, scan());
    GMPacing.go('go');
    for (let i = 0; i < 100; i++) GMPacing.update(0.1, scan(), true);
    expect(GMPacing.phase).toBe('play');
    expect(GMPacing.windowTime).toBe(0);
  });

  test('the fight ending goes back to real time', () => {
    GMPacing.update(0.1, scan());
    GMPacing.go('go');
    const quiet = scan({ fighting: false, hostilesInCombat: new Set() });
    play(3.9, quiet);
    expect(GMPacing.phase).toBe('play');
    play(0.2, quiet);
    expect(GMPacing.phase).toBe('off');
  });
});

describe('on events', () => {
  beforeEach(() => {
    GMPacing.mode = 'events';
    GMPacing.update(0.1, scan());
    GMPacing.go('go');
  });

  test('rounds play on with nothing new', () => {
    play(10);
    expect(GMPacing.phase).toBe('play');
  });

  test('a new enemy joining holds the world', () => {
    GMPacing.update(0.1, scan({ hostilesInCombat: new Set([enemy, enemy2]) }));
    expect(GMPacing.phase).toBe('plan');
  });

  test('a player going down holds the world', () => {
    GMPacing.update(0.1, scan({ players: [{ id: 'Mira', health: 0 }, { id: 'Atton', health: 1 }] }));
    expect(GMPacing.phase).toBe('plan');
  });

  test('a player badly hurt holds the world once a fight', () => {
    const hurt = scan({ players: [{ id: 'Mira', health: 0.2 }, { id: 'Atton', health: 1 }] });
    GMPacing.update(0.1, hurt);
    expect(GMPacing.phase).toBe('plan');
    GMPacing.go('go');
    // Healed and hurt again: no second hold
    GMPacing.update(0.1, scan());
    GMPacing.update(0.1, hurt);
    expect(GMPacing.phase).toBe('play');
  });
});

describe('describing what a creature is about to do', () => {
  const mira = { getName: () => 'Mira' };

  test('an attack, a power, a move, and nothing', () => {
    expect(GMPacing.describeIntent({ combatRound: { action: { actionType: CombatActionType.ATTACK, target: mira } } } as any)).toBe('attacking Mira');
    expect(GMPacing.describeIntent({ combatRound: { scheduledActionList: [{ actionType: CombatActionType.CAST_SPELL, target: mira, spell: { name: 42 } }] } } as any)).toBe('Force Lightning → Mira');
    expect(GMPacing.describeIntent({ combatRound: {}, actionQueue: [{ type: ActionType.ActionMoveToPoint }] } as any)).toBe('moving');
    expect(GMPacing.describeIntent({ combatRound: {}, actionQueue: [{ type: ActionType.ActionPhysicalAttacks, target: mira }] } as any)).toBe('attacking Mira');
    expect(GMPacing.describeIntent({ combatRound: {}, actionQueue: [] } as any)).toBe('—');
  });

  test("a power with no name in the talk table uses its label", () => {
    expect(GMPacing.describeIntent({ combatRound: { action: { actionType: CombatActionType.CAST_SPELL, spell: { name: 7, label: 'FORCE_STUN' } } } } as any)).toBe('FORCE STUN');
  });
});

describe('a planned move', () => {
  test('stays within one round of running', () => {
    expect(GMPacing.clampMove({ x: 0, y: 0 }, { x: 30, y: 40 }, 10)).toEqual({ x: 6, y: 8 });
    expect(GMPacing.clampMove({ x: 1, y: 1 }, { x: 2, y: 2 }, 10)).toEqual({ x: 2, y: 2 });
  });
});

describe('requests from players', () => {
  test('only someone planning this hold can be ready', () => {
    GMPacing.update(0.1, scan());
    GMPacing.setReady('stranger', true);
    expect(GMPacing.ready.has('stranger')).toBe(false);
    GMPacing.setReady('p1', true);
    expect(GMPacing.ready.has('p1')).toBe(true);
  });
});

describe('lasting effects end with a whole turn', () => {
  test('in real time: rounded up to whole 3 s rounds', () => {
    expect(GMPacing.phase).toBe('off');
    expect(GMPacing.turnAlignedSeconds(2)).toBe(3);
    expect(GMPacing.turnAlignedSeconds(3)).toBe(3);
    expect(GMPacing.turnAlignedSeconds(5.9995)).toBe(6); // a timer's 6 s
    expect(GMPacing.turnAlignedSeconds(7)).toBe(9);
    expect(GMPacing.turnAlignedSeconds(0)).toBe(0);
  });

  test('in a paced fight: on a round boundary of the shared clock', () => {
    GMPacing.update(0.1, scan());
    // Planning: the round hasn't started, so it's whole rounds from its start
    expect(GMPacing.turnAlignedSeconds(4)).toBe(6);
    GMPacing.go('go');
    play(1);
    // 1 s into the round: a 6 s stun runs to the end of the round after next (5 s), not 1 s into a fourth
    expect(GMPacing.windowTime).toBeCloseTo(1, 5);
    expect(GMPacing.turnAlignedSeconds(6) + GMPacing.windowTime).toBeCloseTo(9, 5);
    expect(GMPacing.turnAlignedSeconds(1)).toBeCloseTo(2, 5);
    expect(GMPacing.turnAlignedSeconds(2)).toBeCloseTo(2, 5);
  });
});

describe('pause stability & combat continuity', () => {
  test('hold() marks phase=plan before enemies pick intents so world stays held during enemy AI', () => {
    let phaseDuringAi: string | undefined;
    mockGMManager.updateNpcCombat.mockImplementationOnce(() => {
      phaseDuringAi = GMPacing.phase;
    });
    GMPacing.update(0.1, scan());
    expect(phaseDuringAi).toBe('plan');
    expect(GMPacing.phase).toBe('plan');
  });

  test('time limit does not expire while the world is held by another pause', () => {
    GMPacing.timeLimit = 10;
    GMPacing.update(0.1, scan());
    expect(GMPacing.phase).toBe('plan');
    clock += 15000;
    GMPacing.update(0.1, scan(), true);
    expect(GMPacing.phase).toBe('plan');
  });

  test('scan() keeps fighting=true while a creature has active combat actions even after combatState drops', () => {
    const hero: any = {
      destroyed: false,
      isDead: () => false,
      getName: () => 'Hero',
      getHP: () => 20,
      getMaxHP: () => 20,
      combatData: { combatState: false },
      combatRound: { action: { actionType: CombatActionType.ATTACK, target: enemy }, scheduledActionList: [] },
      actionQueue: [],
    };
    const foe: any = {
      destroyed: false,
      gmHidden: false,
      isDead: () => false,
      getName: () => 'Trooper',
      isHostile: () => true,
      combatData: { combatState: false },
      combatRound: { action: null, scheduledActionList: [] },
      actionQueue: [{ type: ActionType.ActionPhysicalAttacks, target: hero }],
    };
    mockGMManager.spawnedPlayers = [hero];
    mockGMManager.findPlayerPeer = () => 'p1';
    const gs: any = require("@/GameState").GameState;
    gs.module = { area: { creatures: [hero, foe] } };

    const result = GMPacing.scan();
    expect(result.fighting).toBe(true);
    expect(result.hostilesInCombat.has(foe)).toBe(true);

    // Once both stop fighting (no combatState, no combat actions), fight ends
    hero.combatRound.action = null;
    foe.actionQueue = [];
    const ended = GMPacing.scan();
    expect(ended.fighting).toBe(false);
  });
});

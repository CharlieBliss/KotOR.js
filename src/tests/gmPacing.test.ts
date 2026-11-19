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
  GMPacing.mode = 'every';
  GMPacing.timeLimit = 0;
  GMPacing.showIntents = true;
  GMPacing.phase = 'off';
  GMPacing.round = 0;
  GMPacing.windowTime = 0;
  GMPacing.windowsSinceHold = 0;
  GMPacing.quietTime = 0;
  GMPacing.deadline = 0;
  GMPacing.ready.clear();
  GMPacing.planners = [];
  GMPacing.seenHostiles.clear();
  GMPacing.hurtPlayers.clear();
  GMPacing.downPlayers.clear();
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
    GMPacing.configure({ mode: 'every' });
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
    GMPacing.mode = 'every2';
    GMPacing.update(0.1, scan());
    GMPacing.go('go');
    play(3.05);
    expect(GMPacing.phase).toBe('play');
    play(3);
    expect(GMPacing.phase).toBe('plan');
    expect(GMPacing.round).toBe(3);
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

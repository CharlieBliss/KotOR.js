import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import * as THREE from "three";

const mockArea: any = {
  id: 1,
  creatures: [] as any[],
  placeables: [] as any[],
  doors: [] as any[],
};

const mockGMManager: any = {
  sceneLoading: false,
  controlMode: "POSSESS",
  NPC_AI_RETALIATE_RANGE: 30,
  netIdMap: new Map<string, any>(),
  keepDefaultCreatures: false,
  keepDefaultTriggers: false,
  keepDefaultPlaceables: true,
  notifyChange: jest.fn(),
  getNextNetId: jest.fn(() => "obj_99"),
  registerNetObject: jest.fn((id: string, obj: any) => {
    obj.gmNetId = id;
    mockGMManager.netIdMap.set(id, obj);
  }),
  setCreatureHP: jest.fn((cre: any, hp: number, max: number) => {
    cre.hp = hp;
    cre.maxHP = max;
  }),
  assignFaction: jest.fn((cre: any, f: number) => {
    cre.factionId = f;
  }),
  attackTargetOf: jest.fn(() => null),
  chooseNpcTarget: jest.fn(() => null),
  isUntargetable: jest.fn(() => false),
  sessionRules: jest.fn(() => ({ deathRule: "kotor", frozen: false })),
};

const mockNetworkManager: any = {
  role: "client",
  assignedActorNetId: "pc_1",
  awaitingHost: true,
  localIntentSeq: 5,
  broadcastActorUpdate: jest.fn(),
  on: jest.fn(),
};

jest.mock("@/GameState", () => ({
  GameState: {
    gmMode: true,
    module: { filename: "danm14aa", readyToProcessEvents: true, area: mockArea },
    PartyManager: { party: [] as any[] },
    ActionFactory: {
      ActionMoveToPoint: class {
        params: any[] = [];
        setParameter(i: number, _t: number, v: any) {
          this.params[i] = v;
        }
      },
    },
    GMManager: mockGMManager,
  },
}));

jest.mock("@/managers/GMManager", () => ({ GMManager: mockGMManager }));
jest.mock("@/managers/GMNetworkManager", () => ({ GMNetworkManager: mockNetworkManager }));
jest.mock("@/managers/gm/GMCombatAI", () => ({ GMCombatAI: { engage: jest.fn() } }));
jest.mock("@/managers/gm/GMSpawner", () => ({
  GMSpawner: {
    gearOf: () => ({ rightHandResRef: "g_w_lghtsbr01", leftHandResRef: "", armorResRef: "" }),
    lootOf: (): any[] => [],
  },
}));
jest.mock("@/managers/gm/GMPlayers", () => ({ GMPlayers: { pendingPlayerSheet: null as any, applyPlayerSheetOnClient: jest.fn() } }));
jest.mock("@/managers/gm/GMMines", () => ({ GMMines: { getMines: (): any[] => [] } }));
jest.mock("@/managers/gm/GMAtmosphere", () => ({ GMAtmosphere: { current: {} } }));
jest.mock("@/managers/gm/GMSetPieces", () => ({ GMSetPieces: { serialize: (): any[] => [] } }));

import { GMNpcOrders } from "@/managers/GMNpcOrders";
import { GMReplication } from "@/managers/gm/GMReplication";
import { GMCombatAI } from "@/managers/gm/GMCombatAI";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";

function makeActor(overrides: Record<string, any> = {}): any {
  return {
    id: overrides.id ?? 1,
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    gmNetId: overrides.gmNetId,
    position: overrides.position || new THREE.Vector3(0, 0, 0),
    container: { position: new THREE.Vector3(), scale: { setScalar: jest.fn() } },
    actionQueue: [],
    combatData: { combatState: false },
    combatRound: { scheduledActionList: [], clearActions: jest.fn() },
    animationState: { index: 0 },
    factionId: 2,
    hp: 50,
    maxHP: 50,
    getName: () => overrides.name || "Actor",
    getTag: () => "tag_actor",
    getTemplateResRef: () => "n_actor",
    getHP: () => overrides.hp ?? 50,
    getMaxHP: () => overrides.maxHP ?? 50,
    getFacing: () => 0,
    setFacing: jest.fn(),
    setStealthMode: jest.fn(),
    setHeldStance: jest.fn(),
    resetExcitedDuration: jest.fn(),
    clearAllActions: jest.fn(),
    isDead: () => !!overrides.dead,
    isHostile: (other: any) => overrides.factionId !== other?.factionId,
    ...overrides,
  };
}

describe("GMNpcOrders & GMReplication", () => {
  beforeEach(() => {
    mockArea.creatures = [];
    mockArea.placeables = [];
    mockGMManager.netIdMap.clear();
    mockGMManager.sceneLoading = false;
    mockNetworkManager.role = "client";
    mockNetworkManager.assignedActorNetId = "pc_1";
    mockNetworkManager.awaitingHost = true;
    mockNetworkManager.localIntentSeq = 5;
    jest.clearAllMocks();
  });

  test("GMNpcOrders clears completed attack orders when target dies", () => {
    const npc = makeActor({ gmNetId: "npc_1", factionId: 1 });
    const deadTarget = makeActor({ gmNetId: "pc_1", factionId: 2, dead: true });
    mockGMManager.netIdMap.set("npc_1", npc);
    mockGMManager.netIdMap.set("pc_1", deadTarget);

    GMNpcOrders.setOrder(npc, { kind: "attack", targetNetId: "pc_1" });
    expect(GMNpcOrders.getOrder(npc)?.kind).toBe("attack");

    GMNpcOrders.think(npc, [npc, deadTarget]);
    expect(GMNpcOrders.getOrder(npc)).toBeUndefined();
  });

  test("GMNpcOrders transitions 'move' to 'guard' on arrival and cycles patrol waypoints", () => {
    const npc = makeActor({ gmNetId: "npc_2", position: new THREE.Vector3(10, 10, 0) });
    GMNpcOrders.setOrder(npc, { kind: "move", point: { x: 10.2, y: 10.1, z: 0 } });
    GMNpcOrders.think(npc, [npc]);
    expect(GMNpcOrders.getOrder(npc)?.kind).toBe("guard");

    const patrolOrder = {
      kind: "patrol" as const,
      points: [
        { x: 10, y: 10, z: 0 },
        { x: 20, y: 10, z: 0 },
      ],
      index: 0,
    };
    GMNpcOrders.setOrder(npc, patrolOrder);
    GMNpcOrders.think(npc, [npc]);
    expect(GMNpcOrders.getOrder(npc)).toEqual({ ...patrolOrder, index: 1 });
  });

  test("GMNpcOrders standDown stops combat without engaging", () => {
    const npc = makeActor({ gmNetId: "npc_3" });
    npc.combatData.combatState = true;
    GMNpcOrders.setOrder(npc, { kind: "standDown" });
    GMNpcOrders.think(npc, [npc]);
    expect(npc.combatData.combatState).toBe(false);
    expect(GMCombatAI.engage).not.toHaveBeenCalled();
  });

  test("GMReplication filters hidden and still-spawning actors from ticks", () => {
    const visible = makeActor({ gmNetId: "cre_1", name: "Visible" });
    const hidden = makeActor({ gmNetId: "cre_2", name: "Hidden", gmHidden: true });
    const spawning = makeActor({ gmNetId: "cre_3", name: "Loading", gmSpawning: true });
    mockArea.creatures = [visible, hidden, spawning];

    const actors = GMReplication.serializeActorsForTick();
    expect(actors.map((a) => a.netId)).toEqual(["cre_1"]);
  });

  test("GMReplication hands position authority back to local client once host completes intentSeq", () => {
    const pc = makeActor({ gmNetId: "pc_1", position: new THREE.Vector3(1, 2, 0) });
    mockGMManager.netIdMap.set("pc_1", pc);

    // Host has processed intentSeq >= 5 and is no longer driving the actor -> awaitingHost clears
    GMReplication.applyWorldTickOnClient([
      {
        netId: "pc_1",
        kind: "player",
        templateResRef: "",
        appearanceId: 136,
        name: "Hero",
        tag: "",
        factionId: 0,
        hp: 42,
        maxHp: 60,
        x: 99,
        y: 99,
        z: 0,
        facing: 0,
        intentSeq: 5,
        hostDriven: false,
      },
    ]);

    expect(mockNetworkManager.awaitingHost).toBe(false);
    // Local position is preserved once client regains authority; HP still syncs from host
    expect(pc.position.x).toBe(1);
    expect(pc.hp).toBe(42);
  });
});

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: { gmMode: true } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import * as THREE from "three";
import { GameState } from "@/GameState";
import { GMManager } from "@/managers/GMManager";
import { GMNetworkManager, GMPacket } from "@/managers/GMNetworkManager";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { TalentObjectType } from "@/enums/engine/TalentObjectType";
import { ActionType } from "@/enums/actions/ActionType";
import { GMChecks } from "@/managers/gm/GMChecks";
import { GMMines } from "@/managers/gm/GMMines";
import { GMPlayers } from "@/managers/gm/GMPlayers";
import { GMSpawner } from "@/managers/gm/GMSpawner";

const talent = (kind: TalentObjectType, id: number) => ({
  objectType: TalentObjectType.TalentObject | kind,
  id,
  useTalentOnObject: jest.fn(),
});

function actor(netId: string, fields: Record<string, any> = {}): any {
  const queue: any[] = [];
  const cre: any = {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    position: new THREE.Vector3(),
    actionQueue: Object.assign(queue, { add: (a: any) => queue.push(a) }),
    equipment: {},
    skills: [],
    stealthMode: false,
    gmOwnerPeerId: "peer_a",
    getName: () => netId,
    isDead: () => false,
    clearAllActions() { queue.length = 0; },
    getSpells: (): any[] => [],
    getFeats: (): any[] => [],
    getSkillRanks: () => 0,
    setStealthMode(on: boolean) { this.stealthMode = on; return true; },
    ...fields,
  };
  GMManager.registerNetObject(netId, cre);
  return cre;
}

let sent: GMPacket[];
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  GMManager.netIdMap.clear();
  sent = [];
  jest.spyOn(GMNetworkManager, "sendPacket").mockImplementation((pkt: GMPacket) => { sent.push(pkt); });
  jest.spyOn(GMNetworkManager, "appendChat").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("players' abilities in a GM session", () => {
  test("a player's pick from the action menu goes to the host instead of running locally", () => {
    GMNetworkManager.role = "client";
    GMNetworkManager.assignedActorNetId = "pc_1";
    const pc = actor("pc_1");
    const enemy = actor("cre_0", { gmOwnerPeerId: undefined });

    const lightning = talent(TalentObjectType.TalentSpell, 35);
    expect(GMPlayers.interceptMenuAction(pc, { talent: lightning }, enemy)).toBe(true);
    expect(lightning.useTalentOnObject).not.toHaveBeenCalled();
    expect(sent.at(-1)!.payload).toMatchObject({ kind: "ability", ability: "spell", abilityId: 35, targetNetId: "cre_0" });

    const medpac = { getItemResRef: () => "g_i_medeqpmnt01" };
    GMPlayers.interceptMenuAction(pc, { item: medpac }, pc);
    // Used on yourself: no target
    expect(sent.at(-1)!.payload).toMatchObject({ kind: "ability", ability: "item", resRef: "g_i_medeqpmnt01", targetNetId: undefined });

    GMPlayers.interceptMenuAction(pc, { action: { type: "stealth" } }, pc);
    expect(sent.at(-1)!.payload).toMatchObject({ kind: "stealth" });

    GMPlayers.interceptMenuAction(pc, { action: { type: ActionType.ActionPhysicalAttacks } }, enemy);
    expect(sent.at(-1)!.payload).toMatchObject({ kind: "attack", targetNetId: "cre_0" });
  });

  test("the GM's own characters and offline play act locally", () => {
    GMNetworkManager.role = "host";
    const pc = actor("pc_1");
    expect(GMPlayers.interceptMenuAction(pc, { talent: talent(TalentObjectType.TalentSpell, 35) }, pc)).toBe(false);
  });

  test("host: a power or feat runs only if the player's character knows it", async () => {
    GMNetworkManager.role = "host";
    const heal = talent(TalentObjectType.TalentSpell, 12);
    const flurry = talent(TalentObjectType.TalentFeat, 11);
    const pc = actor("pc_1", { getSpells: () => [heal], getFeats: () => [flurry] });
    const enemy = actor("cre_0", { gmOwnerPeerId: undefined });

    expect(await GMPlayers.useAbilityOnHost(pc, { netId: "pc_1", kind: "ability", seq: 1, ability: "spell", abilityId: 12 })).toBe(true);
    expect(heal.useTalentOnObject).toHaveBeenCalledWith(pc, pc);

    expect(await GMPlayers.useAbilityOnHost(pc, { netId: "pc_1", kind: "ability", seq: 2, ability: "feat", abilityId: 11, targetNetId: "cre_0" })).toBe(true);
    expect(flurry.useTalentOnObject).toHaveBeenCalledWith(enemy, pc);

    // Force Lightning isn't theirs
    expect(await GMPlayers.useAbilityOnHost(pc, { netId: "pc_1", kind: "ability", seq: 3, ability: "spell", abilityId: 35, targetNetId: "cre_0" })).toBe(false);
  });

  test("host: a carried single-use item comes out of the player's inventory and is used", async () => {
    GMNetworkManager.role = "host";
    const pc = actor("pc_1");
    GMPlayers.addToPlayerInventory(pc, [{ resRef: "g_i_medeqpmnt01", stack: 2 }]);
    const used = jest.fn();
    jest.spyOn(GMSpawner, "createItemFromResRefAsync").mockResolvedValue({
      getUsableCastSpellProperties: () => [{ costTable: 3, costValue: 1 }],
      useItemOnObject: used,
    } as any);
    (GameState as any).TwoDAManager = { datatables: new Map([["iprp_chargecost", { rows: { 1: { label: "Single_Use" } } }]]) };

    expect(await GMPlayers.useAbilityOnHost(pc, { netId: "pc_1", kind: "ability", seq: 1, ability: "item", abilityId: -1, resRef: "g_i_medeqpmnt01" })).toBe(true);
    expect(used).toHaveBeenCalledWith(pc, pc);
    expect(GMPlayers.getPlayerInventory(pc)).toEqual([{ resRef: "g_i_medeqpmnt01", stack: 1 }]);

    // Nothing to use once it's gone, or for something they never had
    expect(await GMPlayers.useAbilityOnHost(pc, { netId: "pc_1", kind: "ability", seq: 2, ability: "item", abilityId: -1, resRef: "g_w_fraggren01" })).toBe(false);
  });

  test("host: the stealth intent toggles the player's stealth", async () => {
    GMNetworkManager.role = "host";
    const pc = actor("pc_1");
    GMPlayers.applyClientIntentOnHost("peer_a", { netId: "pc_1", kind: "stealth", seq: 1 });
    expect(pc.stealthMode).toBe(true);
    // Someone else's character can't be toggled
    GMPlayers.applyClientIntentOnHost("peer_b", { netId: "pc_1", kind: "stealth", seq: 2 });
    expect(pc.stealthMode).toBe(true);
    await flush();
  });
});

describe("GM checks", () => {
  test("a skill check is d20 + the skill's total against the DC, announced to everyone unless secret", () => {
    GMNetworkManager.role = "host";
    jest.spyOn(Math, "random").mockReturnValue(0.5); // d20 = 11
    const pc = actor("pc_1", { getSkillLevel: () => 4 });
    const chat = jest.spyOn(GMNetworkManager, "sendChat").mockImplementation(() => {});
    const [r] = GMChecks.callCheck([pc], { kind: "skill", skill: 4 }, 15);
    expect(r).toMatchObject({ roll: 11, bonus: 4, total: 15, success: true, label: "Persuade" });
    expect(chat).toHaveBeenCalledWith("Check", "pc_1: Persuade 11 + 4 = 15 vs DC 15, success");

    chat.mockClear();
    GMChecks.callCheck([pc], { kind: "skill", skill: 4 }, 16, true);
    expect(chat).not.toHaveBeenCalled();
  });

  test("a skill-gated object can't be used until its check is passed once", () => {
    GMNetworkManager.role = "host";
    jest.spyOn(GMNetworkManager, "sendChat").mockImplementation(() => {});
    const terminal: any = { objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModulePlaceable };
    GMChecks.setSkillGate(terminal, { skill: 0, dc: 20 });
    const slicer = actor("pc_1", { getSkillLevel: () => 5 });

    jest.spyOn(Math, "random").mockReturnValue(0); // d20 = 1
    expect(GMChecks.skillGatePasses(terminal, slicer)).toBe(false);
    jest.spyOn(Math, "random").mockReturnValue(0.99); // d20 = 20
    expect(GMChecks.skillGatePasses(terminal, slicer)).toBe(true);
    // Passed for good: no more rolls
    jest.spyOn(Math, "random").mockReturnValue(0);
    expect(GMChecks.skillGatePasses(terminal, slicer)).toBe(true);
  });
});

describe("mines", () => {
  const traps = { 4: { label: "TRAP_FRAGMENTATION_MINE_AVERAGE", setdc: "20", detectdcmod: "30", disarmdcmod: "25", resref: "g_i_trapkit005" } };
  beforeEach(() => {
    (GameState as any).TwoDAManager = { datatables: new Map([["traps", { rows: traps }]]) };
  });

  test("Demolitions DCs follow the skill's description: set, +5 to disarm, +10 to recover", () => {
    const { ModuleTrigger } = jest.requireActual("@/module/ModuleTrigger") as any;
    const mine = Object.assign(Object.create(ModuleTrigger.prototype), { trapType: 4, trapDisarmDC: 0 });
    expect(mine.getSetDC()).toBe(20);
    expect(mine.getDisarmDC()).toBe(25);
    expect(mine.getRecoverDC()).toBe(30);
    // A mine placed with its own disarm DC keeps it
    mine.trapDisarmDC = 28;
    expect(mine.getRecoverDC()).toBe(33);
  });

  test("a player's mine picks go to the host; a mine is named by its network id", () => {
    GMNetworkManager.role = "client";
    GMNetworkManager.assignedActorNetId = "pc_1";
    const pc = actor("pc_1");
    const mine: any = { objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleTrigger, type: 2, position: new THREE.Vector3(1, 2, 0), trapType: 4 };

    GMPlayers.interceptMenuAction(pc, { action: { type: ActionType.ActionDisarmMine } }, mine);
    expect(sent.at(-1)!.payload).toMatchObject({ kind: "mine", mine: "disarm", targetNetId: "trap_10_20_4" });

    const kit = { getItemResRef: () => "g_i_trapkit005" };
    GMPlayers.interceptMenuAction(pc, { action: { type: ActionType.ActionSetMine, getParameter: () => kit } }, pc);
    expect(sent.at(-1)!.payload).toMatchObject({ kind: "mine", mine: "lay", resRef: "g_i_trapkit005", targetNetId: undefined });
  });

  test("host: Demolitions needs ranks, the mine must be theirs to lay, and only spotted mines can be disarmed", async () => {
    GMNetworkManager.role = "host";
    const novice = actor("pc_1", { getSkillRanks: () => 0 });
    expect(await GMMines.useMineOnHost(novice, { netId: "pc_1", kind: "mine", seq: 1, mine: "lay", resRef: "g_i_trapkit005" })).toBe(false);

    const sapper = actor("pc_2", { getSkillRanks: () => 4 });
    (GameState as any).ActionFactory = { ActionSetMine: jest.fn(() => ({ setOwner: jest.fn(), setParameter: jest.fn() })), ActionDisarmMine: jest.fn(() => ({ setOwner: jest.fn(), setParameter: jest.fn() })) };
    jest.spyOn(GMSpawner, "createItemFromResRefAsync").mockResolvedValue({ getItemResRef: () => "g_i_trapkit005" } as any);
    // Not in their inventory
    expect(await GMMines.useMineOnHost(sapper, { netId: "pc_2", kind: "mine", seq: 2, mine: "lay", resRef: "g_i_trapkit005" })).toBe(false);
    GMPlayers.addToPlayerInventory(sapper, [{ resRef: "g_i_trapkit005", stack: 1 }]);
    expect(await GMMines.useMineOnHost(sapper, { netId: "pc_2", kind: "mine", seq: 3, mine: "lay", resRef: "g_i_trapkit005" })).toBe(true);

    const hidden: any = { objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleTrigger, type: 2, trapDetected: false };
    GMManager.registerNetObject("mine_1", hidden);
    expect(await GMMines.useMineOnHost(sapper, { netId: "pc_2", kind: "mine", seq: 4, mine: "disarm", targetNetId: "mine_1" })).toBe(false);
    hidden.trapDetected = true;
    expect(await GMMines.useMineOnHost(sapper, { netId: "pc_2", kind: "mine", seq: 5, mine: "disarm", targetNetId: "mine_1" })).toBe(true);
  });

  test("on a player's machine mines are only a mirror: none go off or get spotted there", () => {
    GMNetworkManager.role = "client";
    expect(GMMines.isMineReplica()).toBe(true);
    GMNetworkManager.role = "host";
    expect(GMMines.isMineReplica()).toBe(false);
  });

  test("host: a GM session player's mine comes out of, and a recovered one goes into, their inventory", () => {
    GMNetworkManager.role = "host";
    (GameState as any).gmMode = true;
    const pc = actor("pc_1");
    GMPlayers.addToPlayerInventory(pc, [{ resRef: "g_i_trapkit005", stack: 2 }]);
    expect(GMPlayers.consumePlayerItem(pc, { getItemResRef: () => "g_i_trapkit005" } as any)).toBe(true);
    expect(GMMines.giveRecoveredMine(pc, "g_i_trapkit004")).toBe(true);
    expect(GMPlayers.getPlayerInventory(pc)).toEqual([{ resRef: "g_i_trapkit005", stack: 1 }, { resRef: "g_i_trapkit004", stack: 1 }]);
    // NPCs and the GM's own characters use their own inventories
    expect(GMPlayers.consumePlayerItem(actor("cre_0", { gmOwnerPeerId: undefined }), { getItemResRef: () => "x" } as any)).toBe(false);
  });
});

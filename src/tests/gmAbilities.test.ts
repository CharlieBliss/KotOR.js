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
    expect(GMManager.interceptMenuAction(pc, { talent: lightning }, enemy)).toBe(true);
    expect(lightning.useTalentOnObject).not.toHaveBeenCalled();
    expect(sent.at(-1)!.payload).toMatchObject({ kind: "ability", ability: "spell", abilityId: 35, targetNetId: "cre_0" });

    const medpac = { getItemResRef: () => "g_i_medeqpmnt01" };
    GMManager.interceptMenuAction(pc, { item: medpac }, pc);
    // Used on yourself: no target
    expect(sent.at(-1)!.payload).toMatchObject({ kind: "ability", ability: "item", resRef: "g_i_medeqpmnt01", targetNetId: undefined });

    GMManager.interceptMenuAction(pc, { action: { type: "stealth" } }, pc);
    expect(sent.at(-1)!.payload).toMatchObject({ kind: "stealth" });

    GMManager.interceptMenuAction(pc, { action: { type: ActionType.ActionPhysicalAttacks } }, enemy);
    expect(sent.at(-1)!.payload).toMatchObject({ kind: "attack", targetNetId: "cre_0" });
  });

  test("the GM's own characters and offline play act locally", () => {
    GMNetworkManager.role = "host";
    const pc = actor("pc_1");
    expect(GMManager.interceptMenuAction(pc, { talent: talent(TalentObjectType.TalentSpell, 35) }, pc)).toBe(false);
  });

  test("host: a power or feat runs only if the player's character knows it", async () => {
    GMNetworkManager.role = "host";
    const heal = talent(TalentObjectType.TalentSpell, 12);
    const flurry = talent(TalentObjectType.TalentFeat, 11);
    const pc = actor("pc_1", { getSpells: () => [heal], getFeats: () => [flurry] });
    const enemy = actor("cre_0", { gmOwnerPeerId: undefined });

    expect(await GMManager.useAbilityOnHost(pc, { netId: "pc_1", kind: "ability", seq: 1, ability: "spell", abilityId: 12 })).toBe(true);
    expect(heal.useTalentOnObject).toHaveBeenCalledWith(pc, pc);

    expect(await GMManager.useAbilityOnHost(pc, { netId: "pc_1", kind: "ability", seq: 2, ability: "feat", abilityId: 11, targetNetId: "cre_0" })).toBe(true);
    expect(flurry.useTalentOnObject).toHaveBeenCalledWith(enemy, pc);

    // Force Lightning isn't theirs
    expect(await GMManager.useAbilityOnHost(pc, { netId: "pc_1", kind: "ability", seq: 3, ability: "spell", abilityId: 35, targetNetId: "cre_0" })).toBe(false);
  });

  test("host: a carried single-use item comes out of the player's inventory and is used", async () => {
    GMNetworkManager.role = "host";
    const pc = actor("pc_1");
    GMManager.addToPlayerInventory(pc, [{ resRef: "g_i_medeqpmnt01", stack: 2 }]);
    const used = jest.fn();
    jest.spyOn(GMManager, "createItemFromResRefAsync").mockResolvedValue({
      getUsableCastSpellProperties: () => [{ costTable: 3, costValue: 1 }],
      useItemOnObject: used,
    } as any);
    (GameState as any).TwoDAManager = { datatables: new Map([["iprp_chargecost", { rows: { 1: { label: "Single_Use" } } }]]) };

    expect(await GMManager.useAbilityOnHost(pc, { netId: "pc_1", kind: "ability", seq: 1, ability: "item", abilityId: -1, resRef: "g_i_medeqpmnt01" })).toBe(true);
    expect(used).toHaveBeenCalledWith(pc, pc);
    expect(GMManager.getPlayerInventory(pc)).toEqual([{ resRef: "g_i_medeqpmnt01", stack: 1 }]);

    // Nothing to use once it's gone, or for something they never had
    expect(await GMManager.useAbilityOnHost(pc, { netId: "pc_1", kind: "ability", seq: 2, ability: "item", abilityId: -1, resRef: "g_w_fraggren01" })).toBe(false);
  });

  test("host: the stealth intent toggles the player's stealth", async () => {
    GMNetworkManager.role = "host";
    const pc = actor("pc_1");
    GMManager.applyClientIntentOnHost("peer_a", { netId: "pc_1", kind: "stealth", seq: 1 });
    expect(pc.stealthMode).toBe(true);
    // Someone else's character can't be toggled
    GMManager.applyClientIntentOnHost("peer_b", { netId: "pc_1", kind: "stealth", seq: 2 });
    expect(pc.stealthMode).toBe(true);
    await flush();
  });
});

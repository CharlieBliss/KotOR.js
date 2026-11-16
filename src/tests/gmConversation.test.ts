import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

// The real GameState pulls in the whole browser engine (WebGL, window, File System Access)
jest.mock("@/GameState", () => ({ GameState: { gmMode: true } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import * as THREE from "three";
import { GMManager } from "@/managers/GMManager";
import { GMNetworkManager, GMPacket } from "@/managers/GMNetworkManager";
import { GMConversationManager } from "@/managers/GMConversationManager";
import { GameState } from "@/GameState";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";

function mockCreature(netId: string, x: number, overrides: Record<string, any> = {}): any {
  const cre: any = {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    position: new THREE.Vector3(x, 0, 0),
    actionQueue: [] as any[],
    hostile: false,
    dead: false,
    name: netId,
    getName() { return this.name; },
    isDead() { return this.dead; },
    isHostile() { return this.hostile; },
    clearAllActions: jest.fn(),
    setFacingObject: jest.fn(),
    ...overrides,
  };
  GMManager.registerNetObject(netId, cre);
  return cre;
}

let sent: GMPacket[];

beforeEach(() => {
  GMManager.netIdMap.clear();
  GMConversationManager.conversations.clear();
  GMNetworkManager.role = "host";
  GMNetworkManager.peers.clear();
  GMNetworkManager.peers.set("peer_a", { peerId: "peer_a", name: "Alice", role: "client", joinedAt: 0, controlledNetId: "pc_a" } as any);
  GMNetworkManager.peers.set("peer_b", { peerId: "peer_b", name: "Bob", role: "client", joinedAt: 0, controlledNetId: "pc_b" } as any);
  sent = [];
  jest.spyOn(GMNetworkManager, "sendPacket").mockImplementation((pkt: GMPacket) => { sent.push(pkt); });
  jest.spyOn(GMNetworkManager, "appendChat").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const lines = (peerId?: string) => sent.filter((p) => p.type === "talk.line" && (!peerId || p.targetPeerId === peerId));

describe("talking to NPCs the GM voices", () => {
  test("a player next to a friendly NPC opens a conversation on its greeting", () => {
    mockCreature("pc_a", 1);
    const npc = mockCreature("cre_0", 0, { name: "Dock Officer", gmBarkText: "Papers, please." });

    GMConversationManager.onTalkRequest("peer_a", { npcNetId: "cre_0" });

    const conv = GMConversationManager.getConversationForNpc("cre_0")!;
    expect(conv.npcName).toBe("Dock Officer");
    expect([...conv.peers]).toEqual(["peer_a"]);
    expect(npc.setFacingObject).toHaveBeenCalled();
    expect(lines("peer_a").map((p) => p.payload)).toEqual([
      expect.objectContaining({ text: "Papers, please.", replies: ["[Continue]"], speaker: "Dock Officer" }),
    ]);
  });

  test("won't talk for hostile, dead or far-away creatures, or another player's character", () => {
    mockCreature("pc_a", 0);
    mockCreature("cre_hostile", 1, { hostile: true });
    mockCreature("cre_dead", 1, { dead: true });
    mockCreature("cre_far", 50);
    mockCreature("pc_b", 1, { gmOwnerPeerId: "peer_b" });
    for (const npcNetId of ["cre_hostile", "cre_dead", "cre_far", "pc_b", "missing"]) {
      GMConversationManager.onTalkRequest("peer_a", { npcNetId });
    }
    expect(GMConversationManager.conversations.size).toBe(0);
    expect(sent).toHaveLength(0);
  });

  test("the GM's lines reach everyone in the conversation, and a late joiner hears the latest one", () => {
    mockCreature("pc_a", 1);
    mockCreature("pc_b", 2);
    mockCreature("cre_0", 0);
    GMConversationManager.onTalkRequest("peer_a", { npcNetId: "cre_0" });
    const conv = GMConversationManager.getConversationForNpc("cre_0")!;

    GMConversationManager.say(conv.id, "The Sith took the cantina.", ["Who are you?", "  ", "Goodbye."]);
    expect(lines("peer_a").pop()!.payload).toMatchObject({ text: "The Sith took the cantina.", replies: ["Who are you?", "Goodbye."] });

    GMConversationManager.onTalkRequest("peer_b", { npcNetId: "cre_0" });
    expect([...conv.peers]).toEqual(["peer_a", "peer_b"]);
    expect(lines("peer_b").map((p) => p.payload.text)).toEqual(["The Sith took the cantina."]);
  });

  test("records a reply only from someone in the conversation, to the current line, with one of its replies", () => {
    mockCreature("pc_a", 1);
    mockCreature("cre_0", 0);
    GMConversationManager.onTalkRequest("peer_a", { npcNetId: "cre_0" });
    const conv = GMConversationManager.getConversationForNpc("cre_0")!;
    const first = conv.lastLine!;
    const line = GMConversationManager.say(conv.id, "What do you want?", ["Information.", "Nothing."])!;

    GMConversationManager.onTalkReply("peer_b", { convId: conv.id, lineId: line.lineId, choice: 0 }); // not in it
    GMConversationManager.onTalkReply("peer_a", { convId: conv.id, lineId: first.lineId, choice: 0 }); // stale line
    GMConversationManager.onTalkReply("peer_a", { convId: conv.id, lineId: line.lineId, choice: 5 }); // no such reply
    GMConversationManager.onTalkReply("peer_a", { convId: conv.id, lineId: line.lineId, choice: 1 });

    expect(conv.transcript.filter((t) => !t.npc)).toEqual([{ speaker: "Alice", text: "Nothing.", npc: false }]);
  });

  test("ends when the last player leaves, and the GM can end it for everyone", () => {
    mockCreature("pc_a", 1);
    mockCreature("pc_b", 1);
    mockCreature("cre_0", 0);
    mockCreature("cre_1", 0);
    GMConversationManager.onTalkRequest("peer_a", { npcNetId: "cre_0" });
    const first = GMConversationManager.getConversationForNpc("cre_0")!;
    GMConversationManager.onTalkLeave("peer_a", { convId: first.id });
    expect(GMConversationManager.conversations.size).toBe(0);

    GMConversationManager.join(GMManager.netIdMap.get("cre_1") as any, ["peer_a", "peer_b"]);
    const second = GMConversationManager.getConversationForNpc("cre_1")!;
    sent = [];
    GMConversationManager.end(second.id);
    expect(sent.filter((p) => p.type === "talk.end").map((p) => p.targetPeerId).sort()).toEqual(["peer_a", "peer_b"]);
    expect(GMConversationManager.conversations.size).toBe(0);
  });

  test("a disconnected player is dropped from their conversation", () => {
    mockCreature("pc_a", 1);
    mockCreature("pc_b", 1);
    mockCreature("cre_0", 0);
    GMConversationManager.join(GMManager.netIdMap.get("cre_0") as any, ["peer_a", "peer_b"]);
    GMConversationManager.onPeerLeft("peer_b");
    expect([...GMConversationManager.getConversationForNpc("cre_0")!.peers]).toEqual(["peer_a"]);
  });

  test("a live dialog line offers the GM's replies plus [End conversation]", () => {
    const { DLGObject } = jest.requireActual("@/resource/DLGObject") as any;
    const dialog = new DLGObject("gm_test");
    const entry = GMConversationManager.addLine(dialog, { convId: "c", lineId: 4, npcNetId: "cre_0", speaker: "NPC", text: "Hello.", replies: ["Hi."] });
    expect(entry.text).toBe("Hello.");
    expect(entry.replies.map((link: any) => dialog.replyList[link.index].text)).toEqual(["Hi.", "[End conversation]"]);
    expect(dialog.replyList.map((r: any) => r.gmChoice)).toEqual([0, -1]);
  });
});

describe("directing a conversation's camera", () => {
  test("a line is shown long enough to read: 3 to 12 seconds", () => {
    expect(GMConversationManager.lineDuration("Hi.")).toBe(3);
    expect(GMConversationManager.lineDuration("x".repeat(100))).toBe(7);
    expect(GMConversationManager.lineDuration("x".repeat(1000))).toBe(12);
  });

  test("lines carry their duration and the conversation's camera", () => {
    mockCreature("pc_a", 1);
    const npc = mockCreature("cre_0", 0, { name: "Guide" });
    const conv = GMConversationManager.join(npc, ["peer_a"])!;
    GMConversationManager.setCamera(conv.id, { focus: "cre_0", shot: "shoulder" });
    expect(sent.filter((p) => p.type === "talk.camera").map((p) => [p.targetPeerId, p.payload.camera])).toEqual([["peer_a", { focus: "cre_0", shot: "shoulder" }]]);

    const line = GMConversationManager.say(conv.id, "The ruins lie north.")!;
    expect(line.duration).toBe(GMConversationManager.lineDuration("The ruins lie north."));
    expect(line.camera).toEqual({ focus: "cre_0", shot: "shoulder" });
  });

  test("auto follows KotOR: the NPC while it speaks, then the player choosing a reply", () => {
    const pc = mockCreature("pc_a", 1);
    const npc = mockCreature("cre_0", 0);
    const speaking = GMConversationManager.shotFor({ focus: "auto", shot: "close" }, npc, pc, true)!;
    const replying = GMConversationManager.shotFor({ focus: "auto", shot: "close" }, npc, pc, false)!;
    expect([speaking.speaker, speaking.listener]).toEqual([npc, pc]);
    expect([replying.speaker, replying.listener]).toEqual([pc, npc]);
  });

  test("a chosen focus holds whether or not the line is showing, facing the other side", () => {
    const pc = mockCreature("pc_a", 1);
    const other = mockCreature("pc_b", 2);
    const npc = mockCreature("cre_0", 0);
    for (const speaking of [true, false]) {
      const onNpc = GMConversationManager.shotFor({ focus: "cre_0", shot: "both" }, npc, pc, speaking)!;
      expect([onNpc.speaker, onNpc.listener]).toEqual([npc, pc]);
      expect(onNpc.angle).toBe(GMConversationManager.shotAngle("both"));
    }
    // On another player: the camera is on them, facing the NPC
    const onOther = GMConversationManager.shotFor({ focus: "pc_b", shot: "close" }, npc, pc, true)!;
    expect([onOther.speaker, onOther.listener]).toEqual([other, npc]);
  });

  test("watching stops when the conversation ends", () => {
    mockCreature("pc_a", 1);
    const npc = mockCreature("cre_0", 0);
    const conv = GMConversationManager.join(npc, ["peer_a"])!;
    (GameState as any).camera = new THREE.PerspectiveCamera();
    GMConversationManager.setWatching(conv.id, "peer_a");
    expect(GMConversationManager.watching).toEqual({ convId: conv.id, peerId: "peer_a" });
    GMConversationManager.end(conv.id);
    expect(GMConversationManager.watching).toBeNull();
  });
});

describe("using objects in a GM session", () => {
  const placeable = (netId: string, overrides: Record<string, any> = {}) => mockCreature(netId, 0, {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModulePlaceable,
    ...overrides,
  });

  test("a computer (an object with a conversation) is talked to; a container or plain object isn't", () => {
    const pc = mockCreature("pc_a", 1);
    expect(GMConversationManager.canTalkTo(placeable("plc_comp", { conversation: { resref: "comp" } }), pc)).toBe(true);
    expect(GMConversationManager.canTalkTo(placeable("plc_box", { conversation: { resref: "box" }, hasInventory: true }), pc)).toBe(false);
    expect(GMConversationManager.canTalkTo(placeable("plc_chair"), pc)).toBe(false);
  });

  test("a player who reaches a computer opens a conversation the GM voices", () => {
    mockCreature("pc_a", 1);
    placeable("plc_comp", { name: "TRAINING COMPUTER", conversation: { resref: "comp" } });
    GMConversationManager.onTalkRequest("peer_a", { npcNetId: "plc_comp" });
    expect(GMConversationManager.getConversationForNpc("plc_comp")?.npcName).toBe("TRAINING COMPUTER");
  });

  test("a player who tries a locked object is told so", () => {
    const { GMPlayers } = jest.requireActual("@/managers/gm/GMPlayers") as any;
    const chest = placeable("plc_chest", { name: "Chest" });
    const pc = mockCreature("pc_a", 1, { gmOwnerPeerId: "peer_a" });
    (GameState as any).gmMode = true;
    GMPlayers.onUseBlocked(chest, pc, "locked");
    const told = sent.find((p) => p.type === "chat.message" && p.targetPeerId === "peer_a");
    expect(told?.payload.text).toMatch(/Chest is locked/);
  });
});

describe("the action queue", () => {
  test("an action that throws is dropped, not run again every frame", () => {
    const { ActionQueue } = jest.requireActual("@/actions/ActionQueue") as any;
    const queue = new ActionQueue();
    queue.setOwner?.({ getName: () => "User" });
    let calls = 0;
    const broken = { type: 40, update: () => { calls++; throw new Error("no listener"); }, dispose: () => {} };
    let nextCalls = 0;
    const next = { type: 1, update: () => { nextCalls++; return 2; }, dispose: () => {} };
    queue.push(broken);
    queue.push(next);
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    queue.process(0);
    queue.process(0);
    expect(calls).toBe(1);
    expect(nextCalls).toBe(1);
    expect(queue.length).toBe(0);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe("levelling up a player's character", () => {
  test("a player's Auto Level-Up is asked of the host, for their own character only", () => {
    const { GMPlayers } = jest.requireActual("@/managers/gm/GMPlayers") as any;
    GMNetworkManager.role = "client";
    GMNetworkManager.assignedActorNetId = "pc_a";
    expect(GMPlayers.requestNetworkLevelUp(mockCreature("pc_a", 0))).toBe(true);
    expect(GMPlayers.requestNetworkLevelUp(mockCreature("pc_b", 0))).toBe(false);
    expect(sent.filter((p) => p.type === "client.intent").map((p) => p.payload.kind)).toEqual(["levelup"]);
  });

  test("the host levels them up only with the XP for it", () => {
    const { GMPlayers } = jest.requireActual("@/managers/gm/GMPlayers") as any;
    let level = 2;
    const ready = mockCreature("pc_a", 0, { canLevelUp: () => level < 3, autoLevelUp: () => { level++; }, getTotalClassLevel: () => level });
    expect(GMPlayers.levelUpOnHost(ready)).toBe(true);
    expect(level).toBe(3);
    jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(GMPlayers.levelUpOnHost(ready)).toBe(false);
    expect(level).toBe(3);
  });
});

describe("players rolling their own skills", () => {
  test("the host rolls d20 + the skill, tells everyone, and holds back a second roll within a second", () => {
    const { GMChecks } = jest.requireActual("@/managers/gm/GMChecks") as any;
    jest.spyOn(Math, "random").mockReturnValue(0.5); // d20 = 11
    const pc = mockCreature("pc_a", 0, { name: "Talker", getSkillLevel: (skill: number) => (skill === 4 ? 5 : 0) });

    const result = GMChecks.rollForPlayer(pc, 4);
    expect(result).toMatchObject({ name: "Talker", label: "Persuade", roll: 11, bonus: 5, total: 16 });
    expect(sent.filter((p) => p.type === "roll.result").map((p) => [p.targetPeerId, p.payload.total])).toEqual([[undefined, 16]]);
    expect(GMChecks.shownRolls().map((r: any) => r.total)).toContain(16);

    expect(GMChecks.rollForPlayer(pc, 4)).toBeNull();
  });

  test("only real skills can be rolled", () => {
    const { GMChecks } = jest.requireActual("@/managers/gm/GMChecks") as any;
    const pc = mockCreature("pc_b", 0, { getSkillLevel: () => 0 });
    expect(GMChecks.rollForPlayer(pc, 99)).toBeNull();
    expect(GMChecks.rollForPlayer(pc, -1)).toBeNull();
    expect(GMChecks.rollForPlayer(pc, Number.NaN)).toBeNull();
  });
});

describe("the player character sheet", () => {
  test("a player in a GM session gets the sheet; the GM keeps the game's screens", () => {
    const opened: string[] = [];
    const listener = (section: string) => opened.push(section);
    GMNetworkManager.events.addEventListener("open-character-sheet", listener);
    (GameState as any).gmMode = true;
    const isGM = jest.spyOn(GMManager, "isGMUser");
    try {
      isGM.mockReturnValue(false);
      expect(GMManager.engineHooks.openCharacterSheet("abilities")).toBe(true);
      isGM.mockReturnValue(true);
      expect(GMManager.engineHooks.openCharacterSheet("overview")).toBe(false);
      expect(opened).toEqual(["abilities"]);
    } finally {
      GMNetworkManager.events.removeEventListener("open-character-sheet", listener);
    }
  });

  test("saves are rolled on the host as d20 + the save + its ability", () => {
    const { GMChecks } = jest.requireActual("@/managers/gm/GMChecks") as any;
    jest.spyOn(Math, "random").mockReturnValue(0.5); // d20 = 11
    const pc = mockCreature("pc_s", 0, { name: "Saver", getWillSave: () => 3, getWIS: () => 14 });
    expect(GMChecks.rollForPlayer(pc, { kind: "save", save: "will" })).toMatchObject({ label: "Will save", roll: 11, bonus: 5, total: 16 });
    expect(GMChecks.rollForPlayer(mockCreature("pc_t", 0), { kind: "save", save: "luck" })).toBeNull();
  });

  test("a player's requests wait while the GM has players watching", () => {
    const { GMPlayerRequests } = jest.requireActual("@/managers/gm/GMPlayerRequests") as any;
    GMNetworkManager.role = "client";
    GMNetworkManager.assignedActorNetId = "pc_a";
    (GameState as any).getCurrentPlayer = () => ({ gmNetId: "pc_a" });
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const frozen = jest.spyOn(GMManager, "isPlayerFrozen").mockReturnValue(true);
    expect(GMPlayerRequests.roll({ kind: "skill", skill: 4 })).toBe(false);
    expect(GMPlayerRequests.levelUp()).toBe(false);
    frozen.mockReturnValue(false);
    expect(GMPlayerRequests.roll({ kind: "save", save: "reflex" })).toBe(true);
    expect(sent.filter((p) => p.type === "client.intent").map((p) => [p.payload.kind, p.payload.check])).toEqual([["roll", { kind: "save", save: "reflex" }]]);
  });

  test("a feat built from its feat.2da row keeps the row's id", () => {
    const { TalentFeat } = jest.requireActual("@/talents/TalentFeat") as any;
    expect(TalentFeat.From2DA({ __index: 46, label: "JEDI_SENSE" }).id).toBe(46);
  });
});

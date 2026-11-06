import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

// The real GameState pulls in the whole browser engine (WebGL, window, File System Access)
jest.mock("@/GameState", () => ({ GameState: { gmMode: true } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import * as THREE from "three";
import { GMManager } from "@/managers/GMManager";
import { GMNetworkManager, GMPacket } from "@/managers/GMNetworkManager";
import { GMConversationManager } from "@/managers/GMConversationManager";
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

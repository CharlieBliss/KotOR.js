import { afterEach, describe, expect, jest, test } from "@jest/globals";

// The real GameState pulls in the whole browser engine (WebGL, window, File System Access)
jest.mock("@/GameState", () => ({ GameState: { gmMode: true } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import { GMManager } from "@/managers/GMManager";
import { GMConversationManager } from "@/managers/GMConversationManager";
import { GMNetworkManager, GMPacket, GM_INTENTS } from "@/managers/GMNetworkManager";

describe("GM packet routes", () => {
  const before = new Map(GMNetworkManager.routes);
  afterEach(() => {
    GMNetworkManager.routes = new Map(before);
    GMNetworkManager.role = "offline";
  });

  const packet = (targetPeerId?: string): GMPacket<"chat.message"> =>
    ({ type: "chat.message", senderId: "other", targetPeerId, timestamp: 0, payload: { sender: "x", text: "hi" } });

  test("a handler runs only on its side, and only for packets addressed the way it asks", async () => {
    GMNetworkManager.routes = new Map();
    const handler = () => jest.fn<(p: GMPacket<"chat.message">) => void>();
    const host = handler(), client = handler(), mine = handler(), mineOrAll = handler(), any = handler();
    GMNetworkManager.on("chat.message", "host", host);
    GMNetworkManager.on("chat.message", "client", client);
    GMNetworkManager.on("chat.message", "any", mine, "to-me");
    GMNetworkManager.on("chat.message", "any", mineOrAll, "to-me-or-all");
    GMNetworkManager.on("chat.message", "any", any);

    GMNetworkManager.role = "client";
    await GMNetworkManager.onPacketReceived(packet());
    await GMNetworkManager.onPacketReceived(packet(GMNetworkManager.peerId));
    await GMNetworkManager.onPacketReceived(packet("someone_else"));

    expect(host).not.toHaveBeenCalled();
    expect(client).toHaveBeenCalledTimes(3);
    expect(mine).toHaveBeenCalledTimes(1);
    expect(mineOrAll).toHaveBeenCalledTimes(2);
    expect(any).toHaveBeenCalledTimes(3);
  });

  test("every GM class routes its own packets once it is loaded", () => {
    expect(GMManager && GMConversationManager).toBeDefined();
    for (const type of ["peer.join", "world.tick", "client.intent", "mine.state", "talk.line", "actor.assign", "chat.message"] as const) {
      expect(GMNetworkManager.routes.get(type)?.length).toBeGreaterThan(0);
    }
  });

  test("only intents where the host acts for the player take over their character", () => {
    const hostDriven = Object.entries(GM_INTENTS).filter(([, v]) => v.hostDriven).map(([k]) => k).sort();
    expect(hostDriven).toEqual(["ability", "attack", "mine", "move", "open", "use"]);
  });
});

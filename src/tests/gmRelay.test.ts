import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { AddressInfo } from "net";

// The relay is plain CommonJS shared with the dev server
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { WebSocketServer, WebSocket } = require("ws");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createRelayState, attachSocketHandlers } = require("../../scripts/gm-server.js");

type Packet = { type: string; senderId?: string; targetPeerId?: string; payload?: any; timestamp?: number };

interface TestSocket {
  ws: any;
  received: Packet[];
  send(pkt: Packet): void;
}

let server: any;
let url: string;
const sockets: TestSocket[] = [];

async function connect(): Promise<TestSocket> {
  const ws = new WebSocket(url);
  const sock: TestSocket = {
    ws,
    received: [],
    send(pkt) { ws.send(JSON.stringify({ timestamp: Date.now(), payload: {}, ...pkt })); },
  };
  ws.on("message", (raw: Buffer) => sock.received.push(JSON.parse(raw.toString("utf8"))));
  await new Promise((resolve) => ws.once("open", resolve));
  sockets.push(sock);
  return sock;
}

/** Wait long enough for the relay to have forwarded anything it was going to forward */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

const types = (sock: TestSocket) => sock.received.map((p) => p.type);

beforeEach(async () => {
  server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  attachSocketHandlers(server, createRelayState());
  await new Promise((resolve) => server.once("listening", resolve));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.ws.terminate();
  await new Promise((resolve) => server.close(resolve));
});

describe("GM relay server", () => {
  test("only the registered host can send world-changing packets", async () => {
    const host = await connect();
    const alice = await connect();
    const bob = await connect();
    host.send({ type: "host.register", senderId: "gm" });
    alice.send({ type: "peer.join", senderId: "alice" });
    bob.send({ type: "peer.join", senderId: "bob" });
    await settle();

    alice.send({ type: "actor.remove", senderId: "alice", payload: { netId: "cre_1" } });
    alice.send({ type: "world.tick", senderId: "alice", payload: { actors: [] } });
    host.send({ type: "actor.remove", senderId: "gm", payload: { netId: "cre_1" } });
    await settle();

    expect(types(bob).filter((t) => t === "actor.remove")).toHaveLength(1);
    expect(bob.received.find((p) => p.type === "actor.remove")?.senderId).toBe("gm");
    expect(types(bob)).not.toContain("world.tick");
    expect(types(host)).not.toContain("actor.remove");
  });

  test("player input and intents go only to the host, chat goes to everyone", async () => {
    const host = await connect();
    const alice = await connect();
    const bob = await connect();
    host.send({ type: "host.register", senderId: "gm" });
    alice.send({ type: "peer.join", senderId: "alice" });
    bob.send({ type: "peer.join", senderId: "bob" });
    await settle();

    alice.send({ type: "client.intent", senderId: "alice", payload: { kind: "attack" } });
    alice.send({ type: "client.input", senderId: "alice", payload: { x: 1 } });
    alice.send({ type: "chat.message", senderId: "alice", payload: { text: "hi" } });
    await settle();

    expect(types(host)).toEqual(expect.arrayContaining(["peer.join", "client.intent", "client.input", "chat.message"]));
    expect(types(bob)).toEqual(["chat.message"]);
  });

  test("a socket cannot speak for another player once its identity is set", async () => {
    const host = await connect();
    const mallory = await connect();
    host.send({ type: "host.register", senderId: "gm" });
    mallory.send({ type: "peer.join", senderId: "mallory" });
    await settle();

    mallory.send({ type: "client.intent", senderId: "alice", payload: { kind: "attack" } });
    await settle();

    const intent = host.received.find((p) => p.type === "client.intent");
    expect(intent?.senderId).toBe("mallory");
  });

  test("rejects a second host while the first is connected, and allows a new host after it leaves", async () => {
    const host = await connect();
    const usurper = await connect();
    host.send({ type: "host.register", senderId: "gm" });
    await settle();
    usurper.send({ type: "host.register", senderId: "gm2" });
    await settle();

    expect(usurper.received).toEqual([
      expect.objectContaining({ type: "relay.error", payload: expect.objectContaining({ code: "host-exists" }) }),
    ]);

    host.ws.close();
    await settle();
    const replacement = await connect();
    replacement.send({ type: "host.register", senderId: "gm3" });
    const player = await connect();
    player.send({ type: "peer.join", senderId: "carol" });
    await settle();
    expect(types(replacement)).toContain("peer.join");
    expect(types(replacement)).not.toContain("relay.error");
  });

  test("tells a connection to pick a new id when its player id is already connected", async () => {
    const host = await connect();
    const first = await connect();
    const duplicate = await connect();
    host.send({ type: "host.register", senderId: "gm" });
    first.send({ type: "peer.join", senderId: "alice" });
    await settle();

    duplicate.send({ type: "peer.join", senderId: "alice" });
    await settle();
    expect(duplicate.received).toEqual([
      expect.objectContaining({ type: "relay.error", payload: expect.objectContaining({ code: "peer-id-in-use" }) }),
    ]);
    expect(host.received.filter((p) => p.type === "peer.join")).toHaveLength(1);

    // Retrying under a fresh id is accepted
    duplicate.send({ type: "peer.join", senderId: "alice_2" });
    await settle();
    expect(host.received.filter((p) => p.type === "peer.join").map((p) => p.senderId)).toEqual(["alice", "alice_2"]);
  });

  test("announces a disconnect to the remaining connections", async () => {
    const host = await connect();
    const alice = await connect();
    host.send({ type: "host.register", senderId: "gm" });
    alice.send({ type: "peer.join", senderId: "alice" });
    await settle();

    alice.ws.close();
    await settle();
    expect(host.received).toContainEqual(expect.objectContaining({ type: "peer.leave", senderId: "alice" }));
  });
});

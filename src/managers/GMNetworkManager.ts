import { GameState } from "@/GameState";

export class GMEventEmitter {
  private listeners: Map<string, Set<Function>> = new Map();

  addEventListener(event: string, cb: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(cb);
  }

  removeEventListener(event: string, cb: Function) {
    this.listeners.get(event)?.delete(cb);
  }

  dispatchEvent(event: string, ...args: any[]) {
    const set = this.listeners.get(event);
    if (!set) return;
    set.forEach(cb => {
      try {
        cb(...args);
      } catch (e) {
        console.error(e);
      }
    });
  }
}

export type GMNetworkRole = 'offline' | 'host' | 'client';

/**
 * Where a player is in joining a GM's game, for the join screen
 * - connecting: opening the connection to the address they gave
 * - waiting-for-host: connected, but no GM is hosting there yet (the join goes through when one does)
 * - joining: the GM has the join and is sending the scene and their character
 * - playing: they control their character
 * - failed: nothing answered; joinError says why
 */
export type GMJoinState = 'idle' | 'connecting' | 'waiting-for-host' | 'joining' | 'playing' | 'failed';

/** How long a player waits for any answer from a GM before the join screen says it failed */
const JOIN_ANSWER_TIMEOUT_MS = 12000;

export type GMIntentKind = 'open' | 'use' | 'attack' | 'loot' | 'equip' | 'unequip' | 'cancel' | 'ability' | 'stealth' | 'mine';

/** Demolitions: lay a mine at your feet, set one on a door or container, disarm or recover one */
export type GMMineAction = 'lay' | 'set' | 'disarm' | 'recover';

/** A mine as players see it: where, which traps.2da row, whose, and whether it has been spotted */
export interface GMSerializedMine {
  netId: string;
  trapType: number;
  x: number;
  y: number;
  z: number;
  factionId: number;
  detected: boolean;
}

/** What a player uses from KotOR's action menu: a Force power, feat, skill or item */
export type GMAbilityKind = 'spell' | 'feat' | 'skill' | 'item';

/** Intents where the host walks and acts for the player, so it takes over the actor's position */
const HOST_DRIVEN_INTENTS: GMIntentKind[] = ['open', 'use', 'attack', 'ability', 'mine'];

/**
 * A visual the host just showed on a networked object, replayed on clients
 * - anim: a 2DA animation (attack swings, hit/dodge/parry reactions, casting)
 * - text: floating combat text (damage numbers, miss, deflected)
 * - vfx.add / vfx.remove: a visualeffects.2da effect (Force power impacts, auras, shields)
 * - projectile: a blaster bolt (ammunitiontypes.2da row) from netId to targetNetId
 */
export type GMFxEvent =
  | { kind: 'anim'; netId: string; anim: string; index: number }
  | { kind: 'text'; netId: string; text: string; style: number; timer: number }
  | { kind: 'vfx.add'; netId: string; fxId: string; vfx: number; miss: number; durationType: number; duration: number }
  | { kind: 'vfx.remove'; netId: string; fxId: string }
  | { kind: 'projectile'; netId: string; targetNetId: string; ammunition: number; hit: boolean; delay: number };

/** A question the GM asks players, as an NPC or as the GM, with replies to pick from */
export interface GMDmPrompt {
  promptId: string;
  speaker: string;
  text: string;
  options: string[];
}

export interface GMLootItem {
  resRef: string;
  stack: number;
}

/**
 * A player's character as the host has it: what combat actually uses, and what the
 * player's character sheet, equipment screen and inventory should show
 */
export interface GMPlayerSheet {
  netId: string;
  classes: { id: number; level: number; spells: number[] }[];
  attributes: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  feats: number[];
  skills: number[];
  hp: number;
  maxHp: number;
  forcePoints: number;
  maxForcePoints: number;
  currentForce: number;
  xp: number;
  /** equipment slot name (RIGHTHAND, ARMOR...) -> item resref */
  equipment: Record<string, string>;
  inventory: GMLootItem[];
}

export interface GMClientIntent {
  netId: string;
  kind: GMIntentKind;
  targetNetId?: string;
  seq: number;
  /** equip / unequip: the equipment slot (ModuleCreatureArmorSlot) */
  slot?: number;
  /** equip: which inventory item to put in the slot; ability: the item used (an item, or a security tunneler) */
  resRef?: string;
  /** ability: what kind, and its id (spells.2da, feat.2da or skills.2da row) */
  ability?: GMAbilityKind;
  abilityId?: number;
  /** mine: what to do (targetNetId is the mine, door or container; resRef the mine item) */
  mine?: GMMineAction;
}

export interface GMPeerInfo {
  peerId: string;
  name: string;
  role: 'host' | 'client';
  controlledNetId?: string;
  joinedAt: number;
}

export interface GMSerializedActor {
  netId: string;
  kind: 'creature' | 'player' | 'placeable';
  ownerPeerId?: string;
  templateResRef: string;
  appearanceId: number;
  name: string;
  tag: string;
  factionId: number;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  z: number;
  facing: number;
  animState?: number;
  /** Host is executing an intent for this player-owned actor, so the host owns its position */
  hostDriven?: boolean;
  /** Last client intent sequence number the host has applied to this actor */
  intentSeq?: number;
  /** Hidden from players by the GM: never spawned or updated on their machines */
  hidden?: boolean;
  /** In stealth (shown see-through) */
  stealth?: boolean;
  rightHandResRef?: string;
  leftHandResRef?: string;
  armorResRef?: string;
  barkText?: string;
  /** A held stance: a looping animations.2da name ('' standing) */
  stance?: string;
  hasInventory?: boolean;
  locked?: boolean;
  openState?: number;
  lootResRefs?: string[];
  scale?: number;
}

export interface GMSerializedDoorState {
  netId: string;
  tag: string;
  x: number;
  y: number;
  locked: boolean;
  openState: number;
}

/**
 * What happens when a player's character falls (0 HP):
 * - kotor: like KotOR's party, they get back up with 1 HP once no enemy is near
 * - gm: they stay down until the GM revives them
 * - respawn: after a short wait they can respawn at the scene's entry
 * The GM can revive anyone under any rule.
 */
export type GMDeathRule = 'kotor' | 'gm' | 'respawn';

/** Session-wide rules the GM sets, which players need to know */
export interface GMSessionRules {
  deathRule: GMDeathRule;
  /** Players can only watch: no moving or acting, and NPCs leave them alone */
  frozen?: boolean;
}

export interface GMWorldSnapshot {
  moduleResRef: string;
  rules?: GMSessionRules;
  keepDefaultCreatures: boolean;
  keepDefaultTriggers: boolean;
  keepDefaultPlaceables?: boolean;
  actors: GMSerializedActor[];
  doors: GMSerializedDoorState[];
  mines?: GMSerializedMine[];
}

export interface GMPlayerJoinPreset {
  name: string;
  appearanceId: number;
  classId: number;
  rightHandResRef?: string;
  armorResRef?: string;
}

export interface GMPacket {
  type:
    | 'host.register'
    | 'peer.join'
    | 'peer.leave'
    | 'world.snapshot'
    | 'world.tick'
    | 'scene.load'
    | 'actor.spawn'
    | 'actor.update'
    | 'actor.remove'
    | 'actor.assign'
    | 'actor.teleport'
    | 'door.state'
    | 'client.input'
    | 'client.intent'
    | 'chat.message'
    | 'mine.state'
    | 'mine.remove'
    | 'fx.event'
    | 'container.open'
    | 'container.loot'
    | 'player.sheet'
    | 'dm.prompt'
    | 'dm.reply'
    | 'relay.error'
    | 'relay.host-ready'
    | 'talk.request'
    | 'talk.reply'
    | 'talk.leave'
    | 'talk.line'
    | 'talk.end'
    | 'session.rules'
    | 'player.respawn';
  senderId: string;
  targetPeerId?: string;
  timestamp: number;
  payload: any;
}

const PEER_ID_STORAGE_KEY = 'kotor_gm_peer_id';

function createPeerId(): string {
  return 'peer_' + Math.random().toString(36).substring(2, 9);
}

/**
 * Per-tab player id that survives a reload, so a reconnecting player gets their character back.
 * sessionStorage is per tab, so two tabs in one browser are still different players.
 */
function loadPeerId(): string {
  try {
    const stored = window.sessionStorage.getItem(PEER_ID_STORAGE_KEY);
    if (stored) return stored;
    const id = createPeerId();
    window.sessionStorage.setItem(PEER_ID_STORAGE_KEY, id);
    return id;
  } catch (e) {
    return createPeerId();
  }
}

/**
 * GMNetworkManager
 *
 * Implements Neverwinter Nights-style GM Hosting & Player Client networking.
 * Supports WebSocket connections (`ws://<host>:7878` for LAN / port-forwarded machines,
 * or `/gm-ws` on the dev server) plus `BroadcastChannel` for instant local multi-tab testing.
 */
export class GMNetworkManager {
  static events: GMEventEmitter = new GMEventEmitter();

  static role: GMNetworkRole = 'offline';
  static peerId: string = typeof window !== 'undefined' ? loadPeerId() : createPeerId();
  static playerName: string = 'GM';
  static serverUrl: string = 'ws://localhost:7878';
  static connected: boolean = false;
  static statusMessage: string = 'Offline (Local GM Session)';

  static ws: WebSocket | null = null;
  static broadcastChannel: BroadcastChannel | null = null;

  static peers: Map<string, GMPeerInfo> = new Map();
  static assignedActorNetId: string | null = null;
  /** Client: the latest GM teleport of our character we've applied; our position reports carry it */
  static teleportSeq: number = 0;
  static joinState: GMJoinState = 'idle';
  static joinError: string = '';
  static joinTimer: ReturnType<typeof setTimeout> | null = null;

  // Client-side intent tracking: while awaitingHost, the host drives our actor and we stop sending positions
  static localIntentSeq: number = 0;
  static awaitingHost: boolean = false;

  // Client: questions from the GM still waiting for our reply
  static pendingPrompts: GMDmPrompt[] = [];
  /** Client: the session's rules, as the GM last sent them */
  static sessionRules: GMSessionRules = { deathRule: 'kotor' };

  // Re-sends our host.register / peer.join, used when the relay asks us to retry under a new id
  static resendRegistration: (() => void) | null = null;
  static chatLog: { sender: string; text: string; time: number }[] = [];

  static gmManager: any = null;
  static syncAccumulator: number = 0;
  static SYNC_INTERVAL: number = 0.066; // ~15 Hz world state tick

  static Init(gmManagerRef: any) {
    this.gmManager = gmManagerRef;
    if (typeof BroadcastChannel !== 'undefined' && !this.broadcastChannel) {
      try {
        this.broadcastChannel = new BroadcastChannel('kotor_gm_nwn_channel');
        this.broadcastChannel.onmessage = (ev: MessageEvent) => {
          if (ev.data && ev.data.senderId !== this.peerId) {
            this.onPacketReceived(ev.data as GMPacket);
          }
        };
      } catch (e) {}
    }
  }

  static notifyChange() {
    this.events.dispatchEvent('change');
  }

  static getDefaultDevWsUrl(): string {
    if (typeof window === 'undefined' || !window.location) return 'ws://localhost:7878';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/gm-ws`;
  }

  /**
   * Start hosting a GM game (NWN Dungeon Master Host)
   */
  static hostSession(wsUrl?: string, sessionName: string = 'KotOR GM Server') {
    this.disconnect();
    this.role = 'host';
    this.playerName = 'GM (' + sessionName + ')';
    this.serverUrl = wsUrl || 'ws://localhost:7878';
    this.statusMessage = `Starting GM Host on ${this.serverUrl}...`;
    this.peers.clear();
    this.resendRegistration = () => this.sendPacket({
      type: 'host.register',
      senderId: this.peerId,
      timestamp: Date.now(),
      payload: { sessionName }
    });
    this.notifyChange();

    this.connectWebSocket(this.serverUrl, () => {
      this.connected = true;
      this.statusMessage = `Hosting GM Session on ${this.serverUrl} (Ready for players)`;
      this.sendPacket({
        type: 'host.register',
        senderId: this.peerId,
        timestamp: Date.now(),
        payload: { sessionName }
      });
      this.appendChat('System', `GM Host started on ${this.serverUrl}. Forward TCP port 7878 on your router for remote players!`);
      this.notifyChange();
    }, () => {
      const devUrl = this.getDefaultDevWsUrl();
      if (devUrl !== this.serverUrl) {
        this.connectWebSocket(devUrl, () => {
          this.connected = true;
          this.serverUrl = devUrl;
          this.statusMessage = `Hosting GM Session on ${devUrl} & Port 7878`;
          this.sendPacket({
            type: 'host.register',
            senderId: this.peerId,
            timestamp: Date.now(),
            payload: { sessionName }
          });
          this.appendChat('System', `GM Host active on ${devUrl} (and port 7878).`);
          this.notifyChange();
        }, () => {
          this.connected = true;
          this.statusMessage = 'Hosting GM Session (Local Broadcast active; run `npm run gm:server` for external WS port 7878)';
          this.appendChat('System', 'Hosting on local BroadcastChannel. Run `npm run gm:server` to open port 7878 for external machines.');
          this.notifyChange();
        });
      } else {
        this.connected = true;
        this.statusMessage = 'Hosting GM Session (Local Broadcast active)';
        this.notifyChange();
      }
    });
  }

  /**
   * Join a hosted GM game as a Player Client
   */
  static joinSession(wsUrl: string, playerName: string, preset: GMPlayerJoinPreset) {
    this.disconnect();
    this.role = 'client';
    this.playerName = playerName || 'Player';
    this.serverUrl = wsUrl || 'ws://localhost:7878';
    this.statusMessage = `Connecting to GM Host at ${this.serverUrl}...`;
    this.setJoinState('connecting');

    const sendJoin = () => {
      this.connected = true;
      this.setJoinState('joining');
      // Nothing comes back when nobody is listening at all (e.g. the BroadcastChannel fallback with no GM tab)
      this.clearJoinTimer();
      this.joinTimer = setTimeout(() => {
        this.joinTimer = null;
        if (this.role === 'client' && this.joinState === 'joining') {
          this.failJoin(`No GM answered at ${this.serverUrl}. Check the address with your GM, and that they have clicked Host.`);
        }
      }, JOIN_ANSWER_TIMEOUT_MS);
      this.statusMessage = `Connected to ${this.serverUrl} as ${this.playerName}`;
      this.sendPacket({
        type: 'peer.join',
        senderId: this.peerId,
        timestamp: Date.now(),
        payload: {
          name: this.playerName,
          preset
        }
      });
      this.appendChat('System', `Connected to GM Server as ${this.playerName}. Syncing world...`);
      this.notifyChange();
    };
    this.resendRegistration = () => this.sendPacket({
      type: 'peer.join',
      senderId: this.peerId,
      timestamp: Date.now(),
      payload: { name: this.playerName, preset }
    });

    this.connectWebSocket(this.serverUrl, sendJoin, () => {
      const devUrl = this.getDefaultDevWsUrl();
      if (devUrl !== this.serverUrl) {
        this.connectWebSocket(devUrl, () => {
          this.serverUrl = devUrl;
          sendJoin();
        }, sendJoin);
      } else {
        sendJoin();
      }
    });
  }

  static setJoinState(state: GMJoinState) {
    this.joinState = state;
    if (state !== 'failed') this.joinError = '';
    if (state === 'playing' || state === 'waiting-for-host' || state === 'idle') this.clearJoinTimer();
    this.notifyChange();
  }

  static clearJoinTimer() {
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.joinTimer = null;
  }

  /** Give up joining: back to offline, with a reason for the join screen */
  static failJoin(reason: string) {
    this.disconnect();
    this.joinState = 'failed';
    this.joinError = reason;
    this.statusMessage = reason;
    this.notifyChange();
  }

  static connectWebSocket(url: string, onOpen: () => void, onErrorFallback: () => void) {
    try {
      const socket = new WebSocket(url);
      let handled = false;
      const timer = setTimeout(() => {
        if (!handled && socket.readyState !== WebSocket.OPEN) {
          handled = true;
          try { socket.close(); } catch (e) {}
          onErrorFallback();
        }
      }, 2200);

      socket.onopen = () => {
        if (handled) return;
        handled = true;
        clearTimeout(timer);
        this.ws = socket;
        onOpen();
      };

      socket.onmessage = (ev: MessageEvent) => {
        try {
          const pkt = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
          if (pkt && pkt.senderId !== this.peerId) {
            this.onPacketReceived(pkt as GMPacket);
          }
        } catch (e) {}
      };

      socket.onerror = () => {
        if (handled) return;
        handled = true;
        clearTimeout(timer);
        onErrorFallback();
      };

      socket.onclose = () => {
        if (this.ws === socket) {
          this.ws = null;
          if (this.role !== 'offline') {
            this.statusMessage = 'WebSocket closed (Local BroadcastChannel fallback active)';
            this.notifyChange();
          }
        }
      };
    } catch (e) {
      onErrorFallback();
    }
  }

  static disconnect() {
    if (this.role !== 'offline') {
      this.sendPacket({
        type: 'peer.leave',
        senderId: this.peerId,
        timestamp: Date.now(),
        payload: { name: this.playerName }
      });
    }
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.role = 'offline';
    this.connected = false;
    this.assignedActorNetId = null;
    this.teleportSeq = 0;
    this.awaitingHost = false;
    this.pendingPrompts = [];
    GameState.GMConversationManager?.reset();
    this.clearJoinTimer();
    this.joinState = 'idle';
    this.joinError = '';
    this.peers.clear();
    this.statusMessage = 'Offline (Local GM Session)';
    this.notifyChange();
  }

  static sendPacket(packet: GMPacket) {
    const raw = JSON.stringify(packet);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(raw);
        // Same-browser tabs also hear the BroadcastChannel, so sending on both would deliver every packet twice
        return;
      } catch (e) {}
    }
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(packet);
      } catch (e) {}
    }
  }

  static appendChat(sender: string, text: string) {
    this.chatLog.push({ sender, text, time: Date.now() });
    if (this.chatLog.length > 60) {
      this.chatLog.shift();
    }
    this.notifyChange();
  }

  static sendChat(sender: string, text: string) {
    if (!text.trim()) return;
    this.appendChat(sender, text);
    this.sendPacket({
      type: 'chat.message',
      senderId: this.peerId,
      timestamp: Date.now(),
      payload: { sender, text }
    });
    GameState.MenuManager.InGameBark?.barkFromString(`${sender}: ${text}`);
  }

  static async onPacketReceived(packet: GMPacket) {
    if (!packet || !packet.type) return;

    switch (packet.type) {
      case 'peer.join': {
        if (this.role === 'host') {
          const { name, preset } = packet.payload || {};
          // A repeated join from a peer we already spawned must not create a second character
          const existingPeer = this.peers.get(packet.senderId);
          if (existingPeer) {
            // Still spawning: the in-flight join will send the snapshot and assignment
            if (!existingPeer.controlledNetId) break;
            this.sendWorldSnapshot(packet.senderId);
            this.sendPacket({
              type: 'actor.assign',
              senderId: this.peerId,
              targetPeerId: packet.senderId,
              timestamp: Date.now(),
              payload: { netId: existingPeer.controlledNetId, ownerPeerId: packet.senderId }
            });
            break;
          }
          const peerInfo: GMPeerInfo = {
            peerId: packet.senderId,
            name: name || 'Player',
            role: 'client',
            joinedAt: Date.now()
          };
          this.peers.set(packet.senderId, peerInfo);

          if (this.gmManager) {
            // A reconnecting player (same id, e.g. after a reload) takes back the character they left behind
            const rejoinNetId: string | null = this.gmManager.findActorOwnedBy(packet.senderId);
            this.appendChat('System', rejoinNetId ? `${peerInfo.name} rejoined the game.` : `${peerInfo.name} joined the game!`);
            const spawnedNetId = rejoinNetId || await this.gmManager.spawnPlayerFromNetworkPreset(packet.senderId, peerInfo.name, preset);
            peerInfo.controlledNetId = spawnedNetId;
            this.sendWorldSnapshot(packet.senderId);
            if (spawnedNetId) {
              this.sendPacket({
                type: 'actor.assign',
                senderId: this.peerId,
                targetPeerId: packet.senderId,
                timestamp: Date.now(),
                payload: { netId: spawnedNetId, ownerPeerId: packet.senderId }
              });
            }
          }
          this.notifyChange();
        }
        break;
      }

      case 'peer.leave': {
        if (this.role === 'client' && packet.payload?.wasHost) {
          this.appendChat('System', 'The GM left the game. You will rejoin when they host again.');
          this.setJoinState('waiting-for-host');
          break;
        }
        const peer = this.peers.get(packet.senderId);
        if (peer && this.role === 'host') GameState.GMConversationManager?.onPeerLeft(packet.senderId);
        if (peer) {
          this.appendChat('System', `${peer.name} left the session. Their character stays until they rejoin.`);
          this.peers.delete(packet.senderId);
          if (this.role === 'host' && peer.controlledNetId) {
            this.gmManager?.releaseActor(peer.controlledNetId);
          }
          this.notifyChange();
        }
        break;
      }

      case 'scene.load': {
        if (this.role === 'client' && (!packet.targetPeerId || packet.targetPeerId === this.peerId)) {
          const { moduleResRef, keepDefaultCreatures, keepDefaultTriggers, keepDefaultPlaceables } = packet.payload || {};
          if (moduleResRef && this.gmManager) {
            if (this.joinState !== 'playing') this.clearJoinTimer();
            this.appendChat('GM', `Loading scene: ${moduleResRef}...`);
            await this.gmManager.loadSceneFromNetwork(moduleResRef, !!keepDefaultCreatures, !!keepDefaultTriggers, keepDefaultPlaceables !== false);
          }
        }
        break;
      }

      case 'world.snapshot': {
        if (this.role === 'client' && (!packet.targetPeerId || packet.targetPeerId === this.peerId)) {
          const snapshot = packet.payload as GMWorldSnapshot;
          if (snapshot && this.gmManager) {
            await this.gmManager.applyWorldSnapshotOnClient(snapshot);
          }
        }
        break;
      }

      case 'world.tick': {
        if (this.role === 'client' && this.gmManager) {
          this.gmManager.applyWorldTickOnClient(packet.payload?.actors || []);
        }
        break;
      }

      case 'actor.spawn': {
        if (this.role === 'client' && this.gmManager && packet.payload?.actor) {
          await this.gmManager.spawnOrUpdateFromSerialized(packet.payload.actor);
        }
        break;
      }

      case 'actor.update': {
        if (this.role === 'client' && this.gmManager && packet.payload?.actor) {
          await this.gmManager.spawnOrUpdateFromSerialized(packet.payload.actor);
        }
        break;
      }

      case 'actor.teleport': {
        if (this.role === 'client' && this.gmManager && packet.payload?.netId) {
          this.gmManager.applyTeleportOnClient(packet.payload);
        }
        break;
      }

      case 'actor.remove': {
        if (this.role === 'client' && this.gmManager && packet.payload?.netId) {
          this.gmManager.removeActorByNetId(packet.payload.netId);
        }
        break;
      }

      case 'actor.assign': {
        if (this.role === 'client' && (!packet.targetPeerId || packet.targetPeerId === this.peerId)) {
          const { netId } = packet.payload || {};
          if (netId) {
            this.assignedActorNetId = netId;
            this.setJoinState('playing');
            if (this.gmManager) {
              const obj = this.gmManager.netIdMap.get(netId);
              if (obj) {
                this.gmManager.possessCharacter(obj);
              }
            }
            this.notifyChange();
          }
        }
        break;
      }

      case 'door.state': {
        if (this.role === 'client' && this.gmManager && packet.payload) {
          this.gmManager.applyDoorStateOnClient(packet.payload as GMSerializedDoorState);
        }
        break;
      }

      case 'client.input': {
        if (this.role === 'host' && this.gmManager && packet.payload) {
          this.gmManager.applyClientInputOnHost(packet.senderId, packet.payload);
        }
        break;
      }

      case 'client.intent': {
        if (this.role === 'host' && this.gmManager && packet.payload) {
          this.gmManager.applyClientIntentOnHost(packet.senderId, packet.payload);
        }
        break;
      }

      case 'relay.error': {
        const { code, message } = packet.payload || {};
        if (code === 'peer-id-in-use') {
          // Usually a duplicated browser tab carrying the same session id: pick a fresh id and retry
          this.peerId = createPeerId();
          try { window.sessionStorage.setItem(PEER_ID_STORAGE_KEY, this.peerId); } catch (e) {}
          this.resendRegistration?.();
        } else {
          if (code === 'no-host') {
            // The relay keeps our connection; it tells us when a GM starts hosting
            this.statusMessage = 'Connected. Waiting for the GM to start hosting...';
            this.setJoinState('waiting-for-host');
            break;
          }
          this.appendChat('System', message || `Relay error: ${code}`);
          if (code === 'host-exists') {
            this.disconnect();
            this.statusMessage = message || 'A GM is already hosting on this server.';
          }
          this.notifyChange();
        }
        break;
      }

      case 'relay.host-ready': {
        // A GM started hosting on the relay we're waiting on: send our join again
        if (this.role === 'client' && this.joinState === 'waiting-for-host') {
          this.appendChat('System', 'The GM is hosting. Joining...');
          this.setJoinState('joining');
          this.resendRegistration?.();
        }
        break;
      }

      case 'fx.event': {
        if (this.role === 'client' && this.gmManager && packet.payload) {
          this.gmManager.applyFxEventOnClient(packet.payload as GMFxEvent);
        }
        break;
      }

      case 'container.open': {
        if (this.role === 'client' && packet.targetPeerId === this.peerId && this.gmManager && packet.payload) {
          await this.gmManager.openNetworkContainer(packet.payload.containerNetId, packet.payload.items || []);
        }
        break;
      }

      case 'player.sheet': {
        if (this.role === 'client' && packet.targetPeerId === this.peerId && this.gmManager && packet.payload) {
          await this.gmManager.applyPlayerSheetOnClient(packet.payload as GMPlayerSheet);
        }
        break;
      }

      case 'container.loot': {
        if (this.role === 'client' && packet.targetPeerId === this.peerId && this.gmManager && packet.payload) {
          await this.gmManager.receiveNetworkLoot(packet.payload.items || []);
        }
        break;
      }

      case 'dm.prompt': {
        if (this.role === 'client' && (!packet.targetPeerId || packet.targetPeerId === this.peerId) && packet.payload?.promptId) {
          const prompt = packet.payload as GMDmPrompt;
          this.pendingPrompts.push(prompt);
          this.appendChat(prompt.speaker, prompt.text);
          this.notifyChange();
        }
        break;
      }

      // Talking to NPCs the GM voices (GMConversationManager)
      case 'talk.request':
        if (this.role === 'host') GameState.GMConversationManager?.onTalkRequest(packet.senderId, packet.payload);
        break;
      case 'talk.reply':
        if (this.role === 'host') GameState.GMConversationManager?.onTalkReply(packet.senderId, packet.payload);
        break;
      case 'talk.leave':
        if (this.role === 'host') GameState.GMConversationManager?.onTalkLeave(packet.senderId, packet.payload);
        break;
      case 'talk.line':
        if (this.role === 'client' && (!packet.targetPeerId || packet.targetPeerId === this.peerId)) {
          GameState.GMConversationManager?.onLine(packet.payload);
        }
        break;
      case 'talk.end':
        if (this.role === 'client' && (!packet.targetPeerId || packet.targetPeerId === this.peerId)) {
          GameState.GMConversationManager?.onEnd(packet.payload);
        }
        break;

      case 'session.rules':
        if (this.role === 'client' && packet.payload?.deathRule) {
          this.sessionRules = { ...this.sessionRules, ...packet.payload };
          this.notifyChange();
        }
        break;
      case 'player.respawn':
        if (this.role === 'host') this.gmManager?.onRespawnRequest(packet.senderId);
        break;

      case 'dm.reply': {
        if (this.role === 'host' && this.gmManager && packet.payload) {
          this.gmManager.onDmReply(packet.senderId, packet.payload);
        }
        break;
      }

      case 'mine.state': {
        if (this.role === 'client' && this.gmManager && packet.payload) this.gmManager.applyMineOnClient(packet.payload);
        break;
      }
      case 'mine.remove': {
        if (this.role === 'client' && this.gmManager && packet.payload?.netId) this.gmManager.removeMineOnClient(packet.payload.netId);
        break;
      }
      case 'chat.message': {
        if (packet.targetPeerId && packet.targetPeerId !== this.peerId) break;
        if (packet.payload?.text) {
          this.appendChat(packet.payload.sender || 'Player', packet.payload.text);
          GameState.MenuManager.InGameBark?.barkFromString(`${packet.payload.sender || 'Player'}: ${packet.payload.text}`);
        }
        break;
      }
    }
  }

  /**
   * Ask the host to perform an interaction with our assigned actor (NWN-style server authority).
   * The host walks the actor into range and resolves the action; we follow its updates until it finishes.
   */
  static sendIntent(kind: GMIntentKind, targetNetId?: string, extra: { slot?: number; resRef?: string; ability?: GMAbilityKind; abilityId?: number; mine?: GMMineAction } = {}) {
    if (this.role !== 'client' || !this.assignedActorNetId) return;
    this.localIntentSeq++;
    if (HOST_DRIVEN_INTENTS.includes(kind)) {
      this.awaitingHost = true;
    } else if (kind === 'cancel') {
      this.awaitingHost = false;
    }
    this.sendPacket({
      type: 'client.intent',
      senderId: this.peerId,
      timestamp: Date.now(),
      payload: { netId: this.assignedActorNetId, kind, targetNetId, seq: this.localIntentSeq, ...extra }
    });
  }

  /**
   * Local movement input reclaims control of our actor from any host-driven intent
   */
  static notifyLocalMovement() {
    if (this.role === 'client' && this.awaitingHost) {
      this.sendIntent('cancel');
    }
  }

  /**
   * Host: replay a visual on every client
   */
  static broadcastFx(event: GMFxEvent) {
    if (this.role !== 'host') return;
    this.sendPacket({ type: 'fx.event', senderId: this.peerId, timestamp: Date.now(), payload: event });
  }

  static sendWorldSnapshot(targetPeerId?: string) {
    if (this.role !== 'host' || !this.gmManager) return;
    const snapshot = this.gmManager.buildWorldSnapshot();
    this.sendPacket({
      type: 'world.snapshot',
      senderId: this.peerId,
      targetPeerId,
      timestamp: Date.now(),
      payload: snapshot
    });
  }

  static broadcastSceneLoad(moduleResRef: string, keepDefaultCreatures: boolean, keepDefaultTriggers: boolean, keepDefaultPlaceables: boolean = true) {
    if (this.role !== 'host') return;
    this.sendPacket({
      type: 'scene.load',
      senderId: this.peerId,
      timestamp: Date.now(),
      payload: { moduleResRef, keepDefaultCreatures, keepDefaultTriggers, keepDefaultPlaceables }
    });
  }

  /**
   * Host: ask players a question with replies to choose from; everyone, or one player
   */
  /** Host: tell every player the session's rules */
  static broadcastSessionRules(rules: GMSessionRules) {
    if (this.role !== 'host') return;
    this.sendPacket({ type: 'session.rules', senderId: this.peerId, timestamp: Date.now(), payload: rules });
  }

  /** Client: ask to respawn our fallen character (only under the respawn rule) */
  static requestRespawn() {
    if (this.role !== 'client') return;
    this.sendPacket({ type: 'player.respawn', senderId: this.peerId, timestamp: Date.now(), payload: {} });
  }

  static sendDmPrompt(prompt: GMDmPrompt, targetPeerId?: string) {
    if (this.role !== 'host') return;
    this.sendPacket({ type: 'dm.prompt', senderId: this.peerId, targetPeerId, timestamp: Date.now(), payload: prompt });
  }

  /**
   * Client: answer one of the GM's questions
   */
  static answerPrompt(promptId: string, choice: number) {
    const prompt = this.pendingPrompts.find((p) => p.promptId === promptId);
    if (!prompt || !prompt.options[choice]) return;
    this.pendingPrompts = this.pendingPrompts.filter((p) => p !== prompt);
    this.sendPacket({ type: 'dm.reply', senderId: this.peerId, timestamp: Date.now(), payload: { promptId, choice } });
    this.appendChat(this.playerName, prompt.options[choice]);
    this.notifyChange();
  }

  /**
   * Host: a chat line only one player sees
   */
  static sendChatTo(targetPeerId: string, sender: string, text: string) {
    if (this.role !== 'host') return;
    this.sendPacket({ type: 'chat.message', senderId: this.peerId, targetPeerId, timestamp: Date.now(), payload: { sender, text } });
  }

  static broadcastActorSpawn(actor: GMSerializedActor) {
    if (this.role === 'offline' || actor?.hidden) return;
    this.sendPacket({
      type: 'actor.spawn',
      senderId: this.peerId,
      timestamp: Date.now(),
      payload: { actor }
    });
  }

  static broadcastActorUpdate(actor: GMSerializedActor) {
    if (this.role === 'offline' || actor?.hidden) return;
    this.sendPacket({
      type: 'actor.update',
      senderId: this.peerId,
      timestamp: Date.now(),
      payload: { actor }
    });
  }

  static broadcastActorRemove(netId: string) {
    if (this.role === 'offline') return;
    this.sendPacket({
      type: 'actor.remove',
      senderId: this.peerId,
      timestamp: Date.now(),
      payload: { netId }
    });
  }

  static broadcastDoorState(doorState: GMSerializedDoorState) {
    if (this.role === 'offline') return;
    this.sendPacket({
      type: 'door.state',
      senderId: this.peerId,
      timestamp: Date.now(),
      payload: doorState
    });
  }

  static update(delta: number) {
    if (this.role === 'offline' || !this.gmManager) return;
    this.syncAccumulator += delta;
    if (this.syncAccumulator < this.SYNC_INTERVAL) return;
    this.syncAccumulator = 0;

    if (this.role === 'host') {
      const actors = this.gmManager.serializeActorsForTick();
      if (actors.length > 0) {
        this.sendPacket({
          type: 'world.tick',
          senderId: this.peerId,
          timestamp: Date.now(),
          payload: { actors }
        });
      }
    } else if (this.role === 'client' && this.assignedActorNetId && !this.awaitingHost) {
      const controlled = this.gmManager.netIdMap.get(this.assignedActorNetId);
      if (controlled && controlled.position) {
        this.sendPacket({
          type: 'client.input',
          senderId: this.peerId,
          timestamp: Date.now(),
          payload: {
            netId: this.assignedActorNetId,
            x: controlled.position.x,
            y: controlled.position.y,
            z: controlled.position.z,
            facing: typeof controlled.getFacing === 'function' ? controlled.getFacing() : 0,
            animState: controlled.animState || 0,
            teleportSeq: this.teleportSeq
          }
        });
      }
    }
  }
}

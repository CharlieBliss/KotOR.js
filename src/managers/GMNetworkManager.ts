import type { GMCharacter, GMCheck, GMAtmosphereSettings } from "@/managers/gm/GMTypes";
import type { ICharacterLimits } from "@/engine/rules/CharacterRules";
import type { GMPacingState } from "@/managers/gm/GMPacing";
import type { GMCareersCharacter, GMCareersNetworkState, GMRuleset, CareersPurchaseRequest } from "@/managers/gm/careers/types";
import type { AreaSetPieceDef } from "@/module/AreaSetPiece";
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

export type GMIntentKind = 'open' | 'use' | 'attack' | 'loot' | 'equip' | 'unequip' | 'cancel' | 'ability' | 'stealth' | 'mine' | 'levelup' | 'roll' | 'wheel' | 'ready' | 'move' | 'spend_xp';

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


/**
 * A visual the host just showed on a networked object, replayed on clients
 * - anim: a 2DA animation (attack swings, hit/dodge/parry reactions, casting)
 * - text: floating combat text (damage numbers, miss, deflected)
 * - effect.add / effect.remove: an effect that changes how something looks (GMReplication.MIRRORED_EFFECTS:
 *   visuals and auras, beams, stun and hold poses), made on the copy and drawn only
 * - vfx.at: a visual effect at a spot
 * - projectile: a blaster bolt (ammunitiontypes.2da row) from netId to targetNetId
 */
/**
 * An effect on the GM's machine as players get it (GMReplication.MIRRORED_EFFECTS): enough to make the same effect
 * there, drawn only (GameEffect.mirrored)
 */
export interface GMEffectMirror {
  fxId: string;
  /** GameEffectType */
  type: number;
  spellId?: number;
  ints: number[];
  floats: number[];
  durationType: number;
  duration: number;
  /** A beam's caster (its objectList[0]): the beam is drawn from them */
  casterNetId?: string;
}

export type GMFxEvent =
  | { kind: 'anim'; netId: string; anim: string; index: number; hold?: number }
  | { kind: 'text'; netId: string; text: string; style: number; timer: number }
  /** An effect that changes how something looks (a visual, a beam, a stun or hold pose), shown on players' copies */
  | { kind: 'effect.add'; netId: string; effect: GMEffectMirror }
  /** It came off (on an object; at: on a spot, a 'vfx.at' effect) */
  | { kind: 'effect.remove'; netId?: string; fxId: string; at?: boolean }
  /** A visual effect at a spot (an area power's burst, a grenade blast, a beam aimed at a spot) */
  | { kind: 'vfx.at'; fxId: string; vfx: number; miss: number; durationType: number; duration: number; x: number; y: number; z: number;
      beam?: { casterNetId: string; bodyPart: number } }
  | { kind: 'projectile'; netId: string; targetNetId: string; ammunition: number; hit: boolean; delay: number; deflected?: boolean; powerShot?: boolean }
  | { kind: 'cast.fx'; netId: string; targetNetId?: string; spellId: number; casthandvisual?: string; projmodel?: string; castTime: number; conjureTime: number; range?: string };

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
  /** Alignment value (0 = Dark, 50 = Neutral, 100 = Light); older hosts don't send it */
  goodEvil?: number;
  /** Natural armour (part of defense); older hosts don't send it */
  naturalAC?: number;
  /** equipment slot name (RIGHTHAND, ARMOR...) -> item resref */
  equipment: Record<string, string>;
  inventory: GMLootItem[];
  /** Live Careers state (character sheet, Strain, winded) when running under the Careers rule set */
  careers?: GMCareersNetworkState;
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
  /** roll: the skill or save (older players send abilityId, a skill) */
  check?: GMCheck;
  /** wheel: the player opened (true) or closed their power wheel (the tactical pause rule holds the world meanwhile) */
  open?: boolean;
  /** ready: the player is ready (true) or not to play the planned round (GMPacing) */
  ready?: boolean;
  /** move: where the player plans to go in the coming round */
  x?: number;
  y?: number;
  z?: number;
  /** spend_xp: a Careers post-creation XP purchase to validate and apply on the host */
  purchase?: CareersPurchaseRequest;
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
  /** In combat on the host (its combat stance and powered weapons) */
  combat?: boolean;
  /** A player's character: the icons of its combat action and what's queued after it, for its player's HUD */
  queue?: string[];
  /** While the world holds to plan: what this NPC is about to do ("attacking Mira"), when the GM shows intents */
  intent?: string;
  /** Host is executing an intent for this player-owned actor, so the host owns its position */
  hostDriven?: boolean;
  /** Last client intent sequence number the host has applied to this actor */
  intentSeq?: number;
  /** Hidden from players by the GM: never spawned or updated on their machines */
  hidden?: boolean;
  /** In stealth (shown see-through) */
  stealth?: boolean;
  /** Movement speed multiplier from active speed effects (1 = normal) */
  movementSpeed?: number;
  /** True when the creature is a Force user on the host */
  forceUser?: boolean;
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
  /** Which rule set this session runs ('kotor' by default; 'careers' in KotOR II only) */
  ruleset?: GMRuleset;
  deathRule: GMDeathRule;
  /** Players can only watch: no moving or acting, and NPCs leave them alone */
  frozen?: boolean;
  /** How far character creation may go beyond the game's rules (CharacterRules) */
  creation?: ICharacterLimits;
  /** A cutscene is on: players watch the GM camera in widescreen (GMCutscene) */
  cutscene?: { active: boolean; caption?: string };
  /** Tactical pause: a player's open power wheel holds the world; by names who is choosing now */
  tacticalPause?: { enabled: boolean; by?: string[] };
  /** The GM paused the world: it holds on every machine */
  paused?: boolean;
  /** Plan-then-play fights (GMPacing) */
  pacing?: GMPacingState;
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
  /** Rooms of other areas the GM placed in the scene (GMSetPieces); put in before the actors standing on them */
  sets?: AreaSetPieceDef[];
  /** Lasting effects on the scene's objects that change how they look (an aura, a stun), for a player joining now */
  effects?: { netId: string; effect: GMEffectMirror }[];
  /** The music, sound and look the GM gave this scene */
  atmosphere?: GMAtmosphereSettings;
}

export interface GMPlayerJoinPreset {
  name: string;
  appearanceId: number;
  classId: number;
  rightHandResRef?: string;
  armorResRef?: string;
  /** A character the player made (GMCharacters); the host holds it to the session's creation limits */
  character?: GMCharacter;
  /** A character made for the Careers rule set (KotOR II); checked on join by the host */
  careersCharacter?: GMCareersCharacter;
}

/** A player's character as their game streams it to the host (see GMNetworkManager.update) */
export interface GMClientInput {
  netId: string;
  x: number;
  y: number;
  z: number;
  facing: number;
  animState: number;
  /** The last GM teleport this player has seen; older positions are dropped */
  teleportSeq: number;
  /** Our character's held stance, sent when it changes (sitting down, standing up) */
  stance?: string;
}

/**
 * What each request a player can send means for their character on the host:
 * - hostDriven: the host walks and acts for them, so it takes over the character's position until done
 * - interrupts: it stops what the character is doing (taking items or changing equipment don't)
 * GMPlayers.INTENT_HANDLERS says what each one does.
 */
export const GM_INTENTS: Record<GMIntentKind, { hostDriven: boolean; interrupts: boolean }> = {
  open: { hostDriven: true, interrupts: true },
  use: { hostDriven: true, interrupts: true },
  attack: { hostDriven: true, interrupts: true },
  ability: { hostDriven: true, interrupts: true },
  mine: { hostDriven: true, interrupts: true },
  cancel: { hostDriven: false, interrupts: true },
  loot: { hostDriven: false, interrupts: false },
  equip: { hostDriven: false, interrupts: false },
  unequip: { hostDriven: false, interrupts: false },
  stealth: { hostDriven: false, interrupts: false },
  levelup: { hostDriven: false, interrupts: false },
  roll: { hostDriven: false, interrupts: false },
  wheel: { hostDriven: false, interrupts: false },
  ready: { hostDriven: false, interrupts: false },
  // Planned during the hold: it goes in front of what's queued, so it doesn't stop it
  move: { hostDriven: true, interrupts: false },
  spend_xp: { hostDriven: false, interrupts: false },
};

/** Every packet a GM session sends, and what it carries */
export interface GMPacketMap {
  'host.register': { sessionName?: string; [key: string]: any };
  'peer.join': { name?: string; preset?: GMPlayerJoinPreset; [key: string]: any };
  /** Host to one player: refused on join (e.g. character doesn't match the session's rule set) */
  'join.refused': { reason: string; ruleset?: GMRuleset };
  'peer.leave': { wasHost?: boolean; name?: string };
  'world.snapshot': GMWorldSnapshot;
  'world.tick': { actors: GMSerializedActor[] };
  'scene.load': { moduleResRef: string; keepDefaultCreatures: boolean; keepDefaultTriggers: boolean; keepDefaultPlaceables?: boolean };
  'actor.spawn': { actor: GMSerializedActor };
  'actor.update': { actor: GMSerializedActor };
  'actor.remove': { netId: string };
  'actor.assign': { netId: string; ownerPeerId?: string };
  'actor.teleport': { netId: string; x: number; y: number; z: number; seq?: number };
  'door.state': GMSerializedDoorState;
  'client.input': GMClientInput;
  'client.intent': GMClientIntent;
  'chat.message': { sender: string; text: string };
  /** Host to one player: something about what they asked for (why a power didn't go off). Their HUD shows it */
  'player.notice': { text: string };
  'mine.state': GMSerializedMine;
  'mine.remove': { netId: string };
  'set.state': AreaSetPieceDef;
  'set.remove': { id: string };
  'fx.event': GMFxEvent;
  'container.open': { containerNetId: string; items: GMLootItem[] };
  'container.loot': { items: GMLootItem[]; [key: string]: any };
  'player.sheet': GMPlayerSheet;
  'dm.prompt': GMDmPrompt;
  'dm.reply': { promptId: string; choice: number };
  'relay.error': { code: string; message?: string };
  'relay.host-ready': Record<string, never>;
  'talk.request': { npcNetId?: string };
  'talk.reply': { convId?: string; lineId?: number; choice?: number };
  'talk.leave': { convId?: string };
  'talk.line': any;
  'talk.end': { convId?: string; [key: string]: any };
  'roll.result': { name: string; netId?: string; label: string; roll: number; bonus: number; total: number };
  'alignment.shift': { targetName: string; targetNetId?: string; alignment: 'light' | 'dark'; points: number; total: number; soundResRef: string; text: string };
  'talk.camera': { convId?: string; camera?: { focus: string; shot: 'close' | 'shoulder' | 'both' } };
  'session.rules': GMSessionRules;
  /** The GM camera during a cutscene (GMCutscene): cut jumps there instead of easing */
  'cutscene.pose': { x: number; y: number; z: number; yaw: number; pitch: number; hfov: number; cut?: boolean };
  'scene.atmosphere': { atmosphere: GMAtmosphereSettings };
  'player.respawn': Record<string, never>;
}

export type GMPacketType = keyof GMPacketMap;

export interface GMPacket<T extends GMPacketType = GMPacketType> {
  type: T;
  senderId: string;
  targetPeerId?: string;
  timestamp: number;
  payload: GMPacketMap[T];
}

/** How a machine handles one packet type (GMNetworkManager.on) */
export interface GMPacketRoute<T extends GMPacketType = GMPacketType> {
  /** host: only the GM's machine; client: only players' machines; any: both (offline included) */
  side: 'host' | 'client' | 'any';
  /** to-me: only packets sent to this machine; to-me-or-all: those and ones sent to everyone; unset: any */
  addressed?: 'to-me' | 'to-me-or-all';
  handle: (packet: GMPacket<T>) => void | Promise<void>;
}

/** What the network layer needs from the GM's world (GMReplication provides it) */
export interface GMWorldSource {
  buildWorldSnapshot(): GMWorldSnapshot;
  serializeActorsForTick(): GMSerializedActor[];
  /** A networked object, for streaming our own character's position */
  getNetObject(netId: string): { position: { x: number; y: number; z: number }; getFacing?: () => number; animState?: number; animationState?: { index: number } } | undefined;
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

  /** The stance our character last told the host about */
  static sentStance: string | undefined = undefined;

  /** Our character's held stance, when it has changed since we last sent it */
  static stanceToSend(controlled: any): { stance?: string } {
    const stance = String(controlled?.heldStance || '');
    if (stance === this.sentStance) return {};
    this.sentStance = stance;
    return { stance };
  }
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

  /** The GM's world, as the network layer needs it (GMReplication sets it) */
  static world: GMWorldSource | null = null;
  static syncAccumulator: number = 0;
  static SYNC_INTERVAL: number = 0.066; // ~15 Hz world state tick

  static Init() {
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
    this.resendRegistration = () => this.send('host.register', { sessionName });
    this.notifyChange();

    this.connectWebSocket(this.serverUrl, () => {
      this.connected = true;
      this.statusMessage = `Hosting GM Session on ${this.serverUrl} (Ready for players)`;
      this.send('host.register', { sessionName });
      this.appendChat('System', `GM Host started on ${this.serverUrl}. Forward TCP port 7878 on your router for remote players!`);
      this.notifyChange();
    }, () => {
      const devUrl = this.getDefaultDevWsUrl();
      if (devUrl !== this.serverUrl) {
        this.connectWebSocket(devUrl, () => {
          this.connected = true;
          this.serverUrl = devUrl;
          this.statusMessage = `Hosting GM Session on ${devUrl} & Port 7878`;
          this.send('host.register', { sessionName });
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
      this.send('peer.join', {
          name: this.playerName,
          preset
        });
      this.appendChat('System', `Connected to GM Server as ${this.playerName}. Syncing world...`);
      this.notifyChange();
    };
    this.resendRegistration = () => this.send('peer.join', { name: this.playerName, preset });

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
      this.send('peer.leave', { name: this.playerName });
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
    this.send('chat.message', { sender, text });
    GameState.MenuManager.InGameBark?.barkFromString(`${sender}: ${text}`);
  }

  // -------------------------------------------------------------------------
  // Receiving packets: each packet type's handlers, by which machine handles it
  // -------------------------------------------------------------------------

  static routes: Map<GMPacketType, GMPacketRoute<any>[]> = new Map();

  /**
   * Handle a packet type on the host, on players' machines, or on both. addressed: 'to-me' takes only packets
   * sent to this machine; 'to-me-or-all' also takes ones sent to everyone. A type can have several handlers
   * (the network layer's and a GM class's); they run in the order they were added.
   */
  static on<T extends GMPacketType>(
    type: T,
    side: GMPacketRoute['side'],
    handle: GMPacketRoute<T>['handle'],
    addressed?: GMPacketRoute['addressed']
  ) {
    const list = this.routes.get(type) || [];
    list.push({ side, addressed, handle });
    this.routes.set(type, list);
  }

  static async onPacketReceived(packet: GMPacket) {
    if (!packet || !packet.type) return;
    for (const route of this.routes.get(packet.type) || []) {
      if (route.side !== 'any' && route.side !== this.role) continue;
      if (route.addressed === 'to-me' && packet.targetPeerId !== this.peerId) continue;
      if (route.addressed === 'to-me-or-all' && packet.targetPeerId && packet.targetPeerId !== this.peerId) continue;
      await route.handle(packet);
    }
  }

  /** The network layer's own packets: joining, the relay, chat, prompts and rules */
  static registerCoreRoutes() {
    this.on('peer.leave', 'any', (packet) => {
      if (this.role === 'client' && packet.payload?.wasHost) {
        this.appendChat('System', 'The GM left the game. You will rejoin when they host again.');
        this.setJoinState('waiting-for-host');
        return;
      }
      const peer = this.peers.get(packet.senderId);
      if (!peer) return;
      this.appendChat('System', `${peer.name} left the session. Their character stays until they rejoin.`);
      this.peers.delete(packet.senderId);
      this.notifyChange();
    });

    this.on('actor.assign', 'client', (packet) => {
      const netId = packet.payload?.netId;
      if (!netId) return;
      this.assignedActorNetId = netId;
      this.setJoinState('playing');
      this.notifyChange();
    }, 'to-me-or-all');

    this.on('join.refused', 'client', (packet) => {
      const reason = packet.payload?.reason || 'The GM could not admit that character to this session.';
      this.failJoin(reason);
    }, 'to-me');

    this.on('relay.error', 'any', (packet) => {
      const { code, message } = packet.payload || ({} as GMPacketMap['relay.error']);
      if (code === 'peer-id-in-use') {
        // Usually a duplicated browser tab carrying the same session id: pick a fresh id and retry
        this.peerId = createPeerId();
        try { window.sessionStorage.setItem(PEER_ID_STORAGE_KEY, this.peerId); } catch (e) {}
        this.resendRegistration?.();
        return;
      }
      if (code === 'no-host') {
        // The relay keeps our connection; it tells us when a GM starts hosting
        this.statusMessage = 'Connected. Waiting for the GM to start hosting...';
        this.setJoinState('waiting-for-host');
        return;
      }
      this.appendChat('System', message || `Relay error: ${code}`);
      if (code === 'host-exists') {
        this.disconnect();
        this.statusMessage = message || 'A GM is already hosting on this server.';
      }
      this.notifyChange();
    });

    this.on('relay.host-ready', 'client', () => {
      // A GM started hosting on the relay we're waiting on: send our join again
      if (this.joinState !== 'waiting-for-host') return;
      this.appendChat('System', 'The GM is hosting. Joining...');
      this.setJoinState('joining');
      this.resendRegistration?.();
    });

    this.on('dm.prompt', 'client', (packet) => {
      const prompt = packet.payload;
      if (!prompt?.promptId) return;
      this.pendingPrompts.push(prompt);
      this.appendChat(prompt.speaker, prompt.text);
      this.notifyChange();
    }, 'to-me-or-all');

    this.on('session.rules', 'client', (packet) => {
      if (!packet.payload?.deathRule) return;
      this.sessionRules = { ...this.sessionRules, ...packet.payload };
      this.notifyChange();
    });

    this.on('chat.message', 'any', (packet) => {
      const { sender, text } = packet.payload || ({} as GMPacketMap['chat.message']);
      if (!text) return;
      this.appendChat(sender || 'Player', text);
      GameState.MenuManager.InGameBark?.barkFromString(`${sender || 'Player'}: ${text}`);
    }, 'to-me-or-all');
  }

  /** Send a packet from this machine: to everyone, or to one peer */
  static send<T extends GMPacketType>(type: T, payload: GMPacketMap[T], targetPeerId?: string) {
    const packet: GMPacket<T> = { type, senderId: this.peerId, timestamp: Date.now(), payload };
    if (targetPeerId) packet.targetPeerId = targetPeerId;
    this.sendPacket(packet);
  }

  /**
   * Ask the host to perform an interaction with our assigned actor (NWN-style server authority).
   * The host walks the actor into range and resolves the action; we follow its updates until it finishes.
   */
  static sendIntent(kind: GMIntentKind, targetNetId?: string, extra: { slot?: number; resRef?: string; ability?: GMAbilityKind; abilityId?: number; mine?: GMMineAction; check?: GMCheck; open?: boolean; ready?: boolean; x?: number; y?: number; z?: number; purchase?: CareersPurchaseRequest } = {}) {
    if (this.role !== 'client' || !this.assignedActorNetId) return;
    this.localIntentSeq++;
    if (GM_INTENTS[kind]?.hostDriven) {
      this.awaitingHost = true;
    } else if (kind === 'cancel') {
      this.awaitingHost = false;
    }
    this.send('client.intent', { netId: this.assignedActorNetId, kind, targetNetId, seq: this.localIntentSeq, ...extra });
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
    this.send('fx.event', event);
  }

  static sendWorldSnapshot(targetPeerId?: string) {
    if (this.role !== 'host' || !this.world) return;
    const snapshot = this.world.buildWorldSnapshot();
    this.send('world.snapshot', snapshot, targetPeerId);
  }

  static broadcastSceneLoad(moduleResRef: string, keepDefaultCreatures: boolean, keepDefaultTriggers: boolean, keepDefaultPlaceables: boolean = true) {
    if (this.role !== 'host') return;
    this.send('scene.load', { moduleResRef, keepDefaultCreatures, keepDefaultTriggers, keepDefaultPlaceables });
  }

  /**
   * Host: ask players a question with replies to choose from; everyone, or one player
   */
  /** Host: tell every player the session's rules */
  static broadcastSessionRules(rules: GMSessionRules) {
    if (this.role !== 'host') return;
    this.send('session.rules', rules);
  }

  /** Client: ask to respawn our fallen character (only under the respawn rule) */
  static requestRespawn() {
    if (this.role !== 'client') return;
    this.send('player.respawn', {});
  }

  static sendDmPrompt(prompt: GMDmPrompt, targetPeerId?: string) {
    if (this.role !== 'host') return;
    this.send('dm.prompt', prompt, targetPeerId);
  }

  /**
   * Client: answer one of the GM's questions
   */
  static answerPrompt(promptId: string, choice: number) {
    const prompt = this.pendingPrompts.find((p) => p.promptId === promptId);
    if (!prompt || !prompt.options[choice]) return;
    this.pendingPrompts = this.pendingPrompts.filter((p) => p !== prompt);
    this.send('dm.reply', { promptId, choice });
    this.appendChat(this.playerName, prompt.options[choice]);
    this.notifyChange();
  }

  /**
   * Host: a chat line only one player sees
   */
  static sendChatTo(targetPeerId: string, sender: string, text: string) {
    if (this.role !== 'host') return;
    this.send('chat.message', { sender, text }, targetPeerId);
  }

  static broadcastActorSpawn(actor: GMSerializedActor) {
    if (this.role === 'offline' || actor?.hidden) return;
    this.send('actor.spawn', { actor });
  }

  static broadcastActorUpdate(actor: GMSerializedActor) {
    if (this.role === 'offline' || actor?.hidden) return;
    this.send('actor.update', { actor });
  }

  static broadcastActorRemove(netId: string) {
    if (this.role === 'offline') return;
    this.send('actor.remove', { netId });
  }

  static broadcastDoorState(doorState: GMSerializedDoorState) {
    if (this.role === 'offline') return;
    this.send('door.state', doorState);
  }

  static update(delta: number) {
    if (this.role === 'offline' || !this.world) return;
    this.syncAccumulator += delta;
    if (this.syncAccumulator < this.SYNC_INTERVAL) return;
    this.syncAccumulator = 0;

    if (this.role === 'host') {
      const actors = this.world.serializeActorsForTick();
      if (actors.length > 0) {
        this.send('world.tick', { actors });
      }
    } else if (this.role === 'client' && this.assignedActorNetId && !this.awaitingHost) {
      const controlled = this.world.getNetObject(this.assignedActorNetId);
      if (controlled && controlled.position) {
        this.send('client.input', {
            netId: this.assignedActorNetId,
            x: controlled.position.x,
            y: controlled.position.y,
            z: controlled.position.z,
            facing: typeof controlled.getFacing === 'function' ? controlled.getFacing() : 0,
            animState: controlled.animationState?.index ?? controlled.animState ?? 0,
            teleportSeq: this.teleportSeq,
            // Our character sat down or stood up: the host's copy (and everyone's) does too
            ...(this.stanceToSend(controlled))
          });
      }
    }
  }
}

GMNetworkManager.registerCoreRoutes();

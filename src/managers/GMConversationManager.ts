import { GMObjectKind } from "@/managers/gm/GMObjectKind";
import { GameState } from "@/GameState";
import { GMManager } from "@/managers/GMManager";
import { GMNetworkManager, GMEventEmitter } from "@/managers/GMNetworkManager";
import { DLGObject } from "@/resource/DLGObject";
import { DLGNode } from "@/resource/DLGNode";
import { DLGNodeType } from "@/enums/dialog/DLGNodeType";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import type { ModuleCreature } from "@/module/ModuleCreature";
import type { ModuleObject } from "@/module/ModuleObject";
import { GMPlayers } from "@/managers/gm/GMPlayers";
import { GMLog } from "@/managers/gm/GMLog";
import { DLGCameraAngle } from "@/enums/dialog/DLGCameraAngle";
import { EngineMode } from "@/enums/engine/EngineMode";
import * as THREE from "three";

/** How the camera frames a conversation: close on someone, over the other's shoulder, or both side by side */
export type GMTalkShot = 'close' | 'shoulder' | 'both';

/**
 * Where players' cameras point in a conversation. focus 'auto' is KotOR's own: on the NPC while it speaks, then
 * on the player while they choose a reply. Otherwise focus is the net id of the NPC or a player's character, and
 * the camera stays on them, lines and replies alike, until the GM changes it.
 */
export interface GMTalkCamera {
  focus: string;
  shot: GMTalkShot;
}

/** One line the GM speaks for an NPC, with the replies players can pick */
export interface GMConversationLine {
  convId: string;
  lineId: number;
  npcNetId: string;
  speaker: string;
  text: string;
  replies: string[];
  /** Seconds the line is shown before players choose a reply (they can click on sooner) */
  duration?: number;
  camera?: GMTalkCamera;
}

export interface GMConversationTranscriptEntry {
  speaker: string;
  text: string;
  /** true for the NPC (the GM), false for a player's reply */
  npc: boolean;
}

/** Host: a conversation between an NPC the GM voices and one or more players */
export interface GMConversation {
  id: string;
  npcNetId: string;
  npcName: string;
  peers: Set<string>;
  transcript: GMConversationTranscriptEntry[];
  lastLine: GMConversationLine | null;
  nextLineId: number;
  camera: GMTalkCamera;
  /** Host clock (GMConversationManager.clock) when the last line was said */
  lineAt: number;
}

/**
 * GMConversationManager class.
 *
 * Talking to NPCs in a GM session. Module dialogs and their scripts don't run in GM scenes, so the GM speaks
 * for the NPC instead, as a Neverwinter Nights DM would:
 * - a player clicks a friendly NPC: their character walks over and asks the host to talk
 * - the GM sees the conversation, types what the NPC says and the replies players may pick
 * - players see each line in KotOR's own conversation screen (a live DLG), pick a reply, and the GM sees it
 * Several players can join the same NPC's conversation; the GM can also start one with players nearby.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file GMConversationManager.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class GMConversationManager {

  /** How close (metres) a player's character walks to an NPC before talking */
  static TALK_RANGE = 2.5;
  /** If the walk gets stuck (the NPC stands somewhere unreachable), talk anyway from this close */
  static TALK_STUCK_RANGE = 6;
  /** Seconds without getting closer before the walk counts as stuck */
  static TALK_STUCK_SECONDS = 1;
  /** How far (metres) from the NPC the GM can pull nearby players into a conversation */
  static NEARBY_RANGE = 12;
  /** Most replies the GM can offer on one line */
  static MAX_REPLIES = 8;
  static END_REPLY = '[End conversation]';
  static AUTO_CAMERA: GMTalkCamera = { focus: 'auto', shot: 'close' };
  /** Host: seconds since the session began, for timing lines */
  static clock = 0;
  /** Host: the conversation the GM is watching, through which player's eyes */
  static watching: { convId: string; peerId: string } | null = null;
  /** Host: the GM camera's pose before watching, put back after */
  static savedView: { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number } | null = null;
  static CONTINUE_REPLY = '[Continue]';

  static events: GMEventEmitter = new GMEventEmitter();

  // Host
  static conversations: Map<string, GMConversation> = new Map();
  static nextConversationId = 1;

  // Client
  /** The conversation this player is in, and its live dialog */
  static current: { convId: string; npcNetId: string; dialog: DLGObject; lineId: number; endedByHost?: boolean } | null = null;
  /** Walking over to an NPC to talk to it */
  static pendingTalk: { npcNetId: string; closest: number; stuckFor: number } | null = null;

  static notifyChange() {
    this.events.dispatchEvent('change');
    GMManager.notifyChange();
  }

  // ===========================================================================
  // Host
  // ===========================================================================

  static getConversationForNpc(npcNetId: string): GMConversation | undefined {
    for (const conv of this.conversations.values()) {
      if (conv.npcNetId === npcNetId) return conv;
    }
    return undefined;
  }

  /** A creature the GM can speak for: alive, not hostile to the player, not a player's character */
  static canTalkTo(npc: ModuleObject | undefined, pc?: ModuleObject | null): npc is ModuleObject {
    if (!npc || npc.gmHidden) return false;
    // A computer or other object with a conversation (not a container): the GM speaks for it
    if (GMObjectKind.isPlaceable(npc)) return !!(npc as any).conversation && !(npc as any).hasInventory;
    if (!GMObjectKind.isCreature(npc)) return false;
    const cre = npc as ModuleCreature;
    if (cre.isDead() || cre.gmOwnerPeerId || cre.gmPlayerConfig) return false;
    if (pc && cre.isHostile(pc)) return false;
    return true;
  }

  /**
   * Host: a player's character is next to an NPC and wants to talk. Starts the NPC's conversation, or adds
   * them to the one already going, and shows them the NPC's latest line.
   */
  static onTalkRequest(peerId: string, payload: { npcNetId?: string }) {
    if (GMNetworkManager.role !== 'host' || !payload?.npcNetId) return;
    const pc = GMPlayers.getPeerActor(peerId);
    const npc = GMManager.netIdMap.get(payload.npcNetId);
    const request = `${GMNetworkManager.peers.get(peerId)?.name || peerId} wants to talk to ${npc ? GMLog.describe(npc) : payload.npcNetId}`;
    if (!pc || !this.canTalkTo(npc, pc)) {
      GMLog.warn('talk', `${request}: refused, ${!pc ? 'they have no character' : !npc ? "it isn't in this scene" : "it can't be talked to (hostile, dead, a player, or nothing to say)"}`);
      return;
    }
    if (pc.position.distanceTo(npc.position) > this.TALK_RANGE * 3) {
      GMLog.warn('talk', `${request}: refused, they're ${pc.position.distanceTo(npc.position).toFixed(1)} m away`);
      return;
    }
    GMLog.info('talk', request);
    this.join(npc, [peerId]);
  }

  /**
   * Host: start talking as an NPC with the given players, or bring them into its conversation
   */
  static join(npc: ModuleObject, peerIds: string[]): GMConversation | null {
    const npcNetId = npc.gmNetId as string | undefined;
    if (!npcNetId || !peerIds.length) return null;
    let conv = this.getConversationForNpc(npcNetId);
    if (!conv) {
      conv = {
        id: `conv_${this.nextConversationId++}`,
        npcNetId,
        npcName: npc.getName() || 'NPC',
        peers: new Set(),
        transcript: [],
        lastLine: null,
        nextLineId: 1,
        camera: { ...this.AUTO_CAMERA },
        lineAt: 0,
      };
      this.conversations.set(conv.id, conv);
    }

    const newcomers = peerIds.filter((id) => !conv.peers.has(id) && GMNetworkManager.peers.has(id));
    for (const peerId of newcomers) {
      conv.peers.add(peerId);
      const pc = GMPlayers.getPeerActor(peerId);
      if (pc) {
        npc.clearAllActions();
        // A creature turns to them; a computer stays where it is
        if (GMObjectKind.isCreature(npc)) (npc as ModuleCreature).setFacingObject?.(pc);
      }
      GMNetworkManager.appendChat('System', `${GMNetworkManager.peers.get(peerId)?.name || 'A player'} is talking to ${conv.npcName}.`);
    }

    // Newcomers hear what the NPC last said; a new conversation opens on its greeting
    if (!conv.lastLine) {
      const greeting = String(npc.gmBarkText || '').trim() || '...';
      this.say(conv.id, greeting, []);
    } else {
      for (const peerId of newcomers) this.sendLine(conv.lastLine, peerId);
    }
    this.notifyChange();
    return conv;
  }

  /** Host: players whose characters stand near the NPC */
  static getNearbyPeers(npc: ModuleObject, range: number = this.NEARBY_RANGE): string[] {
    const out: string[] = [];
    for (const peerId of GMNetworkManager.peers.keys()) {
      const pc = GMPlayers.getPeerActor(peerId);
      if (pc && pc.position.distanceTo(npc.position) <= range) out.push(peerId);
    }
    return out;
  }

  /**
   * Host: the NPC says something. Replies are what players may answer (one per entry); with none, they get
   * [Continue]. Every line also offers [End conversation].
   */
  static say(convId: string, text: string, replies: string[] = []): GMConversationLine | null {
    const conv = this.conversations.get(convId);
    const message = String(text || '').trim();
    if (!conv || !message) return null;
    const cleanReplies = replies.map((r) => String(r || '').trim()).filter(Boolean).slice(0, this.MAX_REPLIES);
    const line: GMConversationLine = {
      convId,
      lineId: conv.nextLineId++,
      npcNetId: conv.npcNetId,
      speaker: conv.npcName,
      text: message,
      replies: cleanReplies.length ? cleanReplies : [this.CONTINUE_REPLY],
      duration: this.lineDuration(message),
      camera: { ...conv.camera },
    };
    conv.lastLine = line;
    conv.lineAt = this.clock;
    conv.transcript.push({ speaker: conv.npcName, text: message, npc: true });
    for (const peerId of conv.peers) this.sendLine(line, peerId);
    GMNetworkManager.appendChat(conv.npcName, message);
    this.notifyChange();
    return line;
  }

  static sendLine(line: GMConversationLine, peerId: string) {
    // A latecomer hears the last line with the camera as it is now
    GMNetworkManager.send('talk.line', { ...line, camera: this.conversations.get(line.convId)?.camera || line.camera }, peerId);
  }

  /** Seconds to show a line: time to read it, at least 3 and at most 12 */
  static lineDuration(text: string): number {
    return Math.round(Math.min(12, Math.max(3, 1 + String(text || '').length * 0.06)) * 10) / 10;
  }

  /**
   * Host: point the conversation's camera (GMTalkCamera). Players' cameras move at once, and later lines keep
   * it until it changes.
   */
  static setCamera(convId: string, camera: GMTalkCamera) {
    const conv = this.conversations.get(convId);
    if (!conv || !camera) return;
    conv.camera = { focus: String(camera.focus || 'auto'), shot: camera.shot || 'close' };
    for (const peerId of conv.peers) GMNetworkManager.send('talk.camera', { convId, camera: conv.camera }, peerId);
    this.notifyChange();
  }

  static shotAngle(shot: GMTalkShot): DLGCameraAngle {
    if (shot === 'shoulder') return DLGCameraAngle.ANGLE_SPEAKER_BEHIND_PLAYER;
    if (shot === 'both') return DLGCameraAngle.ANGLE_SPEAKER_AND_PLAYER_SIDE;
    return DLGCameraAngle.ANGLE_SPEAKER;
  }

  /**
   * The shot a player sees: who the camera is on (speaker), who they face (listener), and the angle. npc is the
   * NPC, pc the player's own character; speaking is whether the NPC's line is still showing.
   */
  static shotFor(camera: GMTalkCamera | undefined, npc: ModuleObject, pc: ModuleObject, speaking: boolean): { angle: DLGCameraAngle; speaker: ModuleObject; listener: ModuleObject } | null {
    if (!npc || !pc) return null;
    if (!camera || camera.focus === 'auto') {
      // KotOR's own: the NPC while it speaks, then the player choosing a reply
      return speaking
        ? { angle: DLGCameraAngle.ANGLE_SPEAKER, speaker: npc, listener: pc }
        : { angle: DLGCameraAngle.ANGLE_FOCUS_PLAYER, speaker: pc, listener: npc };
    }
    const focus = GMManager.netIdMap.get(camera.focus) || (camera.focus === pc.gmNetId ? pc : null);
    if (!focus) return null;
    return { angle: this.shotAngle(camera.shot), speaker: focus, listener: focus === npc ? pc : npc };
  }

  /** Host: watch a conversation as one of its players sees it (null: back to the GM camera) */
  static setWatching(convId: string | null, peerId?: string) {
    if (!convId || !peerId) {
      if (this.watching && this.savedView) {
        GameState.camera.position.copy(this.savedView.position);
        GameState.camera.quaternion.copy(this.savedView.quaternion);
        GameState.camera.fov = this.savedView.fov;
        GameState.camera.updateProjectionMatrix();
      }
      this.watching = null;
      this.savedView = null;
      this.notifyChange();
      return;
    }
    if (!this.watching) {
      this.savedView = { position: GameState.camera.position.clone(), quaternion: GameState.camera.quaternion.clone(), fov: GameState.camera.fov };
    }
    this.watching = { convId, peerId };
    this.notifyChange();
  }

  /**
   * Host, every frame: keep time, and while watching, put the GM camera where that player's camera is. The
   * player's screen follows the same rules (shotFor), so the two match.
   */
  static updateHost(delta: number = 0) {
    this.clock += delta;
    const watching = this.watching;
    if (!watching) return;
    const conv = this.conversations.get(watching.convId);
    const npc = conv ? GMManager.netIdMap.get(conv.npcNetId) : undefined;
    const pc = GMPlayers.getPeerActor(watching.peerId);
    if (!conv || !npc || !pc || !conv.peers.has(watching.peerId)) {
      this.setWatching(null);
      return;
    }
    if (GameState.Mode !== EngineMode.FREELOOK) return;
    const lastIsLine = !!conv.transcript.length && conv.transcript[conv.transcript.length - 1].npc;
    const speaking = lastIsLine && this.clock - conv.lineAt < (conv.lastLine?.duration ?? 3);
    const shot = this.shotFor(conv.camera, npc, pc, speaking);
    if (!shot) return;
    const view = GameState.CutsceneManager.frameDialogShot(shot.angle, shot.speaker, shot.listener);
    GameState.camera.position.copy(view.position);
    GameState.camera.quaternion.copy(view.quaternion);
    if (GameState.camera.fov !== view.fov) {
      GameState.camera.fov = view.fov;
      GameState.camera.updateProjectionMatrix();
    }
  }

  /**
   * Host: a player picked a reply to the NPC's latest line
   */
  static onTalkReply(peerId: string, payload: { convId?: string; lineId?: number; choice?: number }) {
    if (GMNetworkManager.role !== 'host' || !payload) return;
    const conv = payload.convId ? this.conversations.get(payload.convId) : undefined;
    const line = conv?.lastLine;
    // Only someone in the conversation, answering the line on screen now, with one of its replies
    if (!conv || !line || !conv.peers.has(peerId) || payload.lineId !== line.lineId) return;
    const choice = Number(payload.choice);
    if (!Number.isInteger(choice) || choice < 0 || choice >= line.replies.length) return;
    const speaker = GMNetworkManager.peers.get(peerId)?.name || 'Player';
    conv.transcript.push({ speaker, text: line.replies[choice], npc: false });
    GMNetworkManager.appendChat(speaker, line.replies[choice]);
    this.notifyChange();
  }

  /**
   * Host: a player left the conversation (picked [End conversation], pressed Esc, or disconnected)
   */
  static onTalkLeave(peerId: string, payload: { convId?: string }) {
    if (GMNetworkManager.role !== 'host') return;
    const conv = payload?.convId ? this.conversations.get(payload.convId) : undefined;
    if (!conv || !conv.peers.delete(peerId)) return;
    GMNetworkManager.appendChat('System', `${GMNetworkManager.peers.get(peerId)?.name || 'A player'} left the conversation with ${conv.npcName}.`);
    if (!conv.peers.size) this.conversations.delete(conv.id);
    if (this.watching?.peerId === peerId && this.watching.convId === conv.id) this.setWatching(null);
    this.notifyChange();
  }

  /** Host: a player disconnected; drop them from any conversation */
  static onPeerLeft(peerId: string) {
    for (const conv of [...this.conversations.values()]) {
      if (conv.peers.has(peerId)) this.onTalkLeave(peerId, { convId: conv.id });
    }
  }

  /**
   * Host: the GM ends the conversation for everyone in it
   */
  static end(convId: string) {
    const conv = this.conversations.get(convId);
    if (!conv) return;
    for (const peerId of conv.peers) {
      GMNetworkManager.send('talk.end', { convId }, peerId);
    }
    this.conversations.delete(convId);
    if (this.watching?.convId === convId) this.setWatching(null);
    this.notifyChange();
  }

  /** Host: forget every conversation (scene change, session end) */
  static clear() {
    for (const convId of [...this.conversations.keys()]) this.end(convId);
  }

  // ===========================================================================
  // Client
  // ===========================================================================

  /**
   * Client: talk to a friendly NPC. Our character walks over (we move it ourselves), then asks the host.
   */
  static requestTalk(npc: ModuleObject): boolean {
    const pc = GameState.getCurrentPlayer();
    const npcNetId = npc?.gmNetId as string | undefined;
    if (!pc || !npcNetId || !this.canTalkTo(npc, pc)) return false;
    this.pendingTalk = { npcNetId, closest: Infinity, stuckFor: 0 };
    if (pc.position.distanceTo(npc.position) > this.TALK_RANGE) {
      pc.clearAllActions();
      const move = new GameState.ActionFactory.ActionMoveToPoint();
      move.setParameter(0, ActionParameterType.FLOAT, npc.position.x);
      move.setParameter(1, ActionParameterType.FLOAT, npc.position.y);
      move.setParameter(2, ActionParameterType.FLOAT, npc.position.z);
      move.setParameter(3, ActionParameterType.DWORD, GameState.module.area.id);
      move.setParameter(4, ActionParameterType.DWORD, npc.id);
      move.setParameter(5, ActionParameterType.INT, 1);
      move.setParameter(6, ActionParameterType.FLOAT, this.TALK_RANGE - 0.3);
      move.setParameter(7, ActionParameterType.INT, 0);
      move.setParameter(8, ActionParameterType.FLOAT, 30.0);
      pc.actionQueue.add(move);
    }
    this.update(0);
    return true;
  }

  /** Client, every frame: arrived next to the NPC we're walking to? */
  static update(delta: number = 0) {
    if (!this.pendingTalk) return;
    const pc = GameState.getCurrentPlayer();
    const npc = GMManager.netIdMap.get(this.pendingTalk.npcNetId);
    if (!pc || !npc || GMNetworkManager.role !== 'client') {
      this.pendingTalk = null;
      return;
    }
    const pending = this.pendingTalk;
    const distance = pc.position.distanceTo(npc.position);
    if (distance < pending.closest - 0.05) {
      pending.closest = distance;
      pending.stuckFor = 0;
    } else {
      pending.stuckFor += delta;
    }
    const stopped = !pc.actionQueue.length || pending.stuckFor >= this.TALK_STUCK_SECONDS;
    if (distance <= this.TALK_RANGE || (stopped && distance <= this.TALK_STUCK_RANGE)) {
      pc.clearAllActions();
      GMNetworkManager.send('talk.request', { npcNetId: this.pendingTalk.npcNetId });
      this.pendingTalk = null;
    } else if (stopped) {
      // The player walked off instead, or can't get there
      pc.clearAllActions();
      this.pendingTalk = null;
    }
  }

  /**
   * Client: the NPC said something. Shown in KotOR's conversation screen; starts it if it isn't open.
   */
  static onLine(line: GMConversationLine) {
    if (GMNetworkManager.role !== 'client' || !line) return;
    const npc = GMManager.netIdMap.get(line.npcNetId);
    const pc = GameState.getCurrentPlayer();
    if (!npc || !pc) return;

    const CM = GameState.CutsceneManager;
    const sameConversation = this.current && this.current.convId === line.convId && CM.dialog === this.current.dialog && CM.active;
    const dialog = sameConversation ? this.current.dialog : this.createLiveDialog(line.convId, npc, pc);
    const entry = this.addLine(dialog, line);
    this.current = { convId: line.convId, npcNetId: line.npcNetId, dialog, lineId: line.lineId };
    // Shown long enough to read, framed on the NPC (or held where the GM put the camera)
    entry.delay = Number(line.duration) > 0 ? Number(line.duration) : this.lineDuration(line.text);
    entry.cameraAngle = DLGCameraAngle.ANGLE_SPEAKER;
    this.applyCamera(line.camera, npc, pc);

    if (sameConversation) {
      CM.showEntry(entry);
    } else {
      dialog.startingList = [this.link(dialog, entry.index, DLGNodeType.STARTING)];
      CM.startConversation(dialog, npc, pc);
    }
    this.notifyChange();
  }

  /** Client: the GM moved the conversation's camera */
  static onCamera(payload: { convId?: string; camera?: GMTalkCamera }) {
    if (!this.current || payload?.convId !== this.current.convId) return;
    const npc = GMManager.netIdMap.get(this.current.npcNetId);
    const pc = GameState.getCurrentPlayer();
    if (npc && pc) this.applyCamera(payload.camera, npc, pc);
  }

  /** Client: hold the camera where the GM points it, or hand it back to KotOR's own ('auto') */
  static applyCamera(camera: GMTalkCamera | undefined, npc: ModuleObject, pc: ModuleObject) {
    const CM = GameState.CutsceneManager;
    if (!camera || camera.focus === 'auto') {
      CM.releaseCamera();
      return;
    }
    const shot = this.shotFor(camera, npc, pc, true);
    if (shot) CM.holdCamera(shot.angle, shot.speaker, shot.listener);
    else CM.releaseCamera();
  }

  /** Client: the GM ended the conversation */
  static onEnd(payload: { convId?: string }) {
    if (!this.current || payload?.convId !== this.current.convId) return;
    this.current.endedByHost = true;
    if (GameState.CutsceneManager.dialog === this.current.dialog) {
      GameState.CutsceneManager.endConversation();
    }
    this.current = null;
    this.notifyChange();
  }

  /** A dialog with no .dlg behind it: entries are added as the GM speaks */
  static createLiveDialog(convId: string, npc: ModuleObject, pc: ModuleObject): DLGObject {
    const dialog = new DLGObject(`gm_${convId}`);
    dialog.owner = npc;
    dialog.listener = pc;
    dialog.live = {
      onReply: (reply: DLGNode) => this.onLocalReply(convId, reply),
      onEnd: (aborted: boolean) => this.onLocalEnd(convId, aborted),
    };
    return dialog;
  }

  /** Add the NPC's line and its replies (plus [End conversation]) to a live dialog; returns the entry */
  static addLine(dialog: DLGObject, line: GMConversationLine): DLGNode {
    const entry = new DLGNode(dialog);
    entry.nodeType = DLGNodeType.ENTRY;
    entry.text = line.text;
    entry.index = dialog.entryList.length;
    (entry as any).gmLineId = line.lineId;
    dialog.entryList.push(entry);

    const texts = [...line.replies, this.END_REPLY];
    entry.replies = texts.map((text, i) => {
      const reply = new DLGNode(dialog);
      reply.nodeType = DLGNodeType.REPLY;
      reply.text = text;
      reply.index = dialog.replyList.length;
      (reply as any).gmLineId = line.lineId;
      (reply as any).gmChoice = i < line.replies.length ? i : -1;
      dialog.replyList.push(reply);
      return this.link(dialog, reply.index, DLGNodeType.REPLY);
    });
    return entry;
  }

  static link(dialog: DLGObject, index: number, nodeType: DLGNodeType): DLGNode {
    const link = new DLGNode(dialog);
    link.nodeType = nodeType;
    link.index = index;
    return link;
  }

  /** Client: we picked a reply in the conversation screen */
  static onLocalReply(convId: string, reply: DLGNode) {
    const choice = (reply as any).gmChoice as number;
    if (choice < 0) {
      // [End conversation]
      GameState.CutsceneManager.endConversation();
      return;
    }
    GMNetworkManager.send('talk.reply', { convId, lineId: (reply as any).gmLineId, choice });
  }

  /** Client: our conversation screen closed (we left, pressed Esc, or the GM ended it) */
  static onLocalEnd(convId: string, _aborted: boolean) {
    const endedByHost = !!this.current?.endedByHost;
    if (this.current?.convId === convId) this.current = null;
    if (!endedByHost && GMNetworkManager.role === 'client') {
      GMNetworkManager.send('talk.leave', { convId });
    }
    this.notifyChange();
  }

  /** Client: leaving the session or scene */
  static reset() {
    this.pendingTalk = null;
    this.current = null;
    if (this.watching) this.setWatching(null);
    this.conversations.clear();
  }

}

// Players talk to NPCs (host); the GM's lines reach them (client)
GMNetworkManager.on('talk.request', 'host', (packet) => GMConversationManager.onTalkRequest(packet.senderId, packet.payload));
GMNetworkManager.on('talk.reply', 'host', (packet) => GMConversationManager.onTalkReply(packet.senderId, packet.payload));
GMNetworkManager.on('talk.leave', 'host', (packet) => GMConversationManager.onTalkLeave(packet.senderId, packet.payload));
GMNetworkManager.on('peer.leave', 'host', (packet) => GMConversationManager.onPeerLeft(packet.senderId));
GMNetworkManager.on('talk.line', 'client', (packet) => GMConversationManager.onLine(packet.payload), 'to-me-or-all');
GMNetworkManager.on('talk.camera', 'client', (packet) => GMConversationManager.onCamera(packet.payload), 'to-me-or-all');
GMNetworkManager.on('talk.end', 'client', (packet) => GMConversationManager.onEnd(packet.payload), 'to-me-or-all');

import { CharacterRules, ABILITIES } from "@/engine/rules/CharacterRules";
import { GMCombatAI } from "@/managers/gm/GMCombatAI";
import { GMPlayerHud } from "@/managers/gm/GMPlayerHud";
import { GMCharacters } from "@/managers/gm/GMCharacters";
import type { GMCharacter, GMPlayerSpawnConfig } from "@/managers/gm/GMTypes";
import type { ICharacterLimits } from "@/engine/rules/CharacterRules";
import { gmItemResRef } from "@/managers/gm/GMVocab";
import { GMObjectKind } from "@/managers/gm/GMObjectKind";
import * as THREE from "three";
import { GameState } from "@/GameState";
import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";
import { CreatureClass } from "@/combat/CreatureClass";
import { GMNpcOrders } from "@/managers/GMNpcOrders";
import type { ModuleTrigger } from "@/module/ModuleTrigger";
import { TalentFeat, TalentSpell } from "@/talents";
import { ModuleObject, ModuleCreature, ModuleItem } from "@/module";
import { ActionType } from "@/enums/actions/ActionType";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { ModuleObjectConstant } from "@/enums/module/ModuleObjectConstant";
import { TalentObjectType } from "@/enums/engine/TalentObjectType";
import { SkillType } from "@/enums/nwscript/SkillType";
import { BitWise } from "@/utility/BitWise";
import {
  GMDeathRule,
  GMNetworkManager,
  GMPlayerJoinPreset,
  GMClientIntent,
  GMLootItem,
  GMPlayerSheet,
  GMDmPrompt,
  GMIntentKind,
  GMPacketMap,
  GMPeerInfo,
  GM_INTENTS,
} from "@/managers/GMNetworkManager";
import { GMManager } from "@/managers/GMManager";
import { GMPacing } from "@/managers/gm/GMPacing";
import { CareersAdvancement, CareersRules, CareersRuntime, GMCareersCharacters, careersRuntimeOf } from "@/managers/gm/careers";
import type { CareersPurchaseRequest, GMCareersCharacter } from "@/managers/gm/careers";
import { CombatRound } from "@/combat/CombatRound";
import { GMSpawner } from "@/managers/gm/GMSpawner";
import { GMReplication } from "@/managers/gm/GMReplication";
import { GMMines } from "@/managers/gm/GMMines";
import { GMSessions } from "@/managers/gm/GMSessions";
import { GMLog } from "@/managers/gm/GMLog";
import { CombatActionType } from "@/enums/combat/CombatActionType";
import { GMChecks } from "@/managers/gm/GMChecks";
import { GMPlayerRequests } from "@/managers/gm/GMPlayerRequests";
import { UINotificationManager } from "@/managers/UINotificationManager";
import { UIIconTimerType } from "@/enums/engine/UIIconTimerType";

export interface GMAlignmentAlert {
  id: string;
  targetName: string;
  targetNetId?: string;
  alignment: 'light' | 'dark';
  points: number;
  total: number;
  text: string;
  at: number;
}

/** Players in a GM session: their characters' sheets and inventories (kept by the host), what they ask the host to do, looting, rewards, questions from the GM, and what happens when they fall. */
export class GMPlayers {
  // How close a player must be to a container for the host to hand over its items
  static LOOT_RANGE: number = 4;

  // Equipment slots shown on a player's character sheet and kept in sync by the host
  static PLAYER_EQUIP_SLOTS: string[] = ['HEAD', 'ARMS', 'ARMOR', 'BELT', 'IMPLANT', 'LEFTARMBAND', 'RIGHTARMBAND', 'RIGHTHAND', 'LEFTHAND'];

  // Host: how often player sheets are checked for changes and resent
  static SHEET_SYNC_INTERVAL: number = 1.0;

  static sheetSyncTimer: number = 0;

  /** What happens when a player's character falls; see GMDeathRule */
  static deathRule: GMDeathRule = 'kotor';

  /** KotOR rule: a fallen player gets up once no living enemy is this close (metres)... */
  static RECOVER_ENEMY_RANGE = 20;

  /** ...for this long (seconds) */
  static RECOVER_AFTER_SECONDS = 3;

  /** Respawn rule: how long (seconds) a fallen player waits before they can respawn */
  static RESPAWN_DELAY_SECONDS = 10;

  static DOWNED_CHECK_INTERVAL = 0.5;

  static downedTimer = 0;

  /** Everyone was down at the last check (so the GM is told once) */
  static everyoneDown = false;

  // Client: set while applying the host's sheet, so our own equip calls aren't sent back as requests
  static applyingHostSheet: boolean = false;

  // Host: questions asked of players, and their replies
  static dmPrompts: Map<string, { prompt: GMDmPrompt; targetPeerId?: string; replies: { peerId: string; name: string; choice: number }[] }> = new Map();

  // Client: a sheet that arrived before our character finished spawning
  static pendingPlayerSheet: GMPlayerSheet | null = null;

  static lastAppliedInventoryJson: string = '';

  /** How far players' characters may go beyond the game's rules; sent to players with the session rules */
  static creationLimits: ICharacterLimits = {};

  static setCreationLimits(limits: ICharacterLimits) {
    this.creationLimits = { ...limits };
    GMNetworkManager.broadcastSessionRules(GMManager.sessionRules());
    GMManager.notifyChange();
  }

  static setDeathRule(rule: GMDeathRule) {
    if (!['kotor', 'gm', 'respawn'].includes(rule)) return;
    this.deathRule = rule;
    GMNetworkManager.broadcastSessionRules(GMManager.sessionRules());
    GMManager.notifyChange();
  }

  /** Host: notice players falling, stand them back up under the KotOR rule, tell the GM if everyone is down */
  static updateDownedPlayers(elapsed: number) {
    const pcs = GMManager.getPlayerCharacters();
    const now = Date.now();
    for (const pc of pcs) {
      const state = pc.gmDowned as { since: number; clearFor: number } | undefined;
      if (!pc.isDead()) {
        if (state) delete pc.gmDowned;
        continue;
      }
      if (!state) {
        pc.gmDowned = { since: now, clearFor: 0 };
        GMNetworkManager.appendChat('System', `${pc.getName() || 'A player'} is down.`);
        GMManager.notifyChange();
        continue;
      }
      if (this.deathRule !== 'kotor') continue;
      // KotOR: party members get back up once the fight is over
      if (this.isEnemyNear(pc)) {
        state.clearFor = 0;
      } else {
        state.clearFor += elapsed;
        if (state.clearFor >= this.RECOVER_AFTER_SECONDS) {
          this.revivePlayer(pc, 1);
          GMNetworkManager.appendChat('System', `${pc.getName() || 'A player'} gets back up.`);
        }
      }
    }

    const everyoneDown = pcs.length > 0 && pcs.every((pc) => pc.isDead());
    if (everyoneDown && !this.everyoneDown) {
      GMNetworkManager.appendChat('System', 'Every player is down. Revive them, or send them back to the scene\'s entry, from the Players tab.');
    }
    this.everyoneDown = everyoneDown;
  }

  /** A living creature hostile to this character within RECOVER_ENEMY_RANGE */
  static isEnemyNear(pc: ModuleCreature): boolean {
    const area = GameState.module?.area;
    if (!area) return false;
    return area.creatures.some((c) =>
      c !== pc && !c.isDead() && !GMManager.isPlayerCharacter(c) &&
      c.position.distanceTo(pc.position) <= this.RECOVER_ENEMY_RANGE && c.isHostile(pc)
    );
  }

  /** Host: bring a fallen character back, with hp hit points (default: full) */
  static revivePlayer(pc: ModuleCreature, hp?: number) {
    if (!pc) return;
    const max = pc.getMaxHP() || 1;
    GMManager.setCreatureHP(pc, Math.max(1, Math.min(max, hp ?? max)), max);
    delete pc.gmDowned;
    pc.clearAllActions();
    pc.combatRound?.clearActions?.();
    if (pc.combatData) pc.combatData.combatState = false;
    if (GMNetworkManager.role === 'host' && pc.gmNetId) {
      GMNetworkManager.broadcastActorUpdate(GMReplication.serializeSingleActor(pc));
    }
    GMManager.notifyChange();
  }

  static reviveAllPlayers() {
    for (const pc of GMManager.getPlayerCharacters()) {
      if (pc.isDead()) this.revivePlayer(pc);
    }
  }

  /** Where a respawned character appears: the scene's entry point */
  static getRespawnPoint(): THREE.Vector3 | null {
    const mod = GameState.module;
    if (!mod?.area) return null;
    const entry = new THREE.Vector3(mod.entryX, mod.entryY, mod.entryZ);
    return mod.area.getNearestWalkablePoint ? mod.area.getNearestWalkablePoint(entry, 0.5).clone() : entry;
  }

  /** Host: back to the scene's entry, on half their vitality */
  static respawnPlayer(pc: ModuleCreature) {
    const point = this.getRespawnPoint();
    if (!pc || !point) return;
    this.revivePlayer(pc, Math.ceil((pc.getMaxHP() || 2) / 2));
    GMManager.teleportObject(pc, point);
    GMNetworkManager.appendChat('System', `${pc.getName() || 'A player'} respawned at the entrance.`);
  }

  /** Host: a player asked to respawn; allowed under the respawn rule once they've waited */
  static onRespawnRequest(peerId: string) {
    if (this.deathRule !== 'respawn') return;
    const pc = this.getPeerActor(peerId);
    const state = pc?.gmDowned as { since: number } | undefined;
    if (!pc || !pc.isDead() || !state) return;
    if (Date.now() - state.since < this.RESPAWN_DELAY_SECONDS * 1000) return;
    this.respawnPlayer(pc);
  }

  /**
   * One step of the NPCs' behaviour. NPCs with a GM order follow it (GMNpcOrders); the rest, when ownJudgement
   * is on (the GM's NPC AI switch), fight the nearest enemy.
   */

  static toLootItems(items: ModuleItem[]): GMLootItem[] {
    return (items || [])
      .map((item) => ({ resRef: item.getEquippedRes() || item.getInventoryRes() || item.getTemplateResRef(), stack: item.getStackSize() || 1 }))
      .filter((item) => !!item.resRef);
  }

  static async createLootItems(items: GMLootItem[]): Promise<ModuleItem[]> {
    const created = await Promise.all(items.map(async (entry) => {
      const item = await GMSpawner.createItemFromResRefAsync(entry.resRef);
      item.setStackSize(Math.max(1, entry.stack || 1));
      return item;
    }));
    return created.filter(Boolean);
  }

  /**
   * Host: a container was opened. When the user is another player, show them its contents
   * instead of opening the loot window on the GM's screen. Returns true when handled.
   */
  static routeContainerOpen(container: ModuleObject, user: ModuleObject | undefined): boolean {
    if (!GameState.gmMode || GMNetworkManager.role !== 'host') return false;
    const peerId = user?.gmOwnerPeerId;
    const containerNetId = container?.gmNetId;
    if (!peerId || !containerNetId) return false;
    const items = this.toLootItems((container as any).inventory);
    GMLog.info('host', `Showing ${GMLog.describe(user)} what's in ${GMLog.describe(container)} (${items.length} item${items.length === 1 ? '' : 's'})`);
    GMNetworkManager.send('container.open', { containerNetId, items }, peerId);
    return true;
  }

  /**
   * Host: move a container's items to the requesting player, so two players can't both take them
   */
  static grantLootOnHost(peerId: string, actor: ModuleCreature, containerNetId?: string) {
    const container = containerNetId ? GMManager.netIdMap.get(containerNetId) : null;
    const inventory: ModuleItem[] | undefined = (container as any)?.inventory;
    if (!container || !Array.isArray(inventory)) return;
    if (actor.position.distanceTo(container.position) > this.LOOT_RANGE) return;
    const taken = inventory.splice(0, inventory.length);
    this.addToPlayerInventory(actor, this.toLootItems(taken));
    GMNetworkManager.send('container.loot', { containerNetId, items: this.toLootItems(taken) }, peerId);
    GMManager.notifyChange();
  }

  /**
   * Client: show the host's container contents in the normal loot window
   */
  static async openNetworkContainer(containerNetId: string, items: GMLootItem[]) {
    const container = GMManager.netIdMap.get(containerNetId);
    if (!container) return;
    (container as any).inventory = await this.createLootItems(items);
    const menu = GameState.MenuManager.MenuContainer;
    menu.AttachContainer(container);
    menu.open();
  }

  /**
   * Client: the loot window's "take items" asks the host instead of taking locally. Returns true when handled.
   */
  static requestNetworkLoot(container: ModuleObject): boolean {
    if (!this.isNetworkContainer(container)) return false;
    (container as any).inventory = [];
    GMNetworkManager.sendIntent('loot', container.gmNetId);
    return true;
  }

  /** Client: a container whose contents the host owns */
  static isNetworkContainer(container: ModuleObject): boolean {
    return GameState.gmMode && GMNetworkManager.role === 'client' && !!container?.gmNetId;
  }

  /** Client: the items themselves arrive with our next character sheet; this just tells the player */
  static async receiveNetworkLoot(items: GMLootItem[]) {
    if (items.length) {
      GMNetworkManager.appendChat('System', `Received ${items.length} item${items.length === 1 ? '' : 's'}.`);
    }
  }

  /** Host: the character a connected player controls */
  static getPeerActor(peerId: string): ModuleCreature | null {
    const netId = GMNetworkManager.peers.get(peerId)?.controlledNetId;
    const actor = netId ? GMManager.netIdMap.get(netId) : null;
    return actor && GMObjectKind.isCreature(actor) ? actor as ModuleCreature : null;
  }

  /**
   * Host: ask players a question, as an NPC (speaker) or as the GM, with replies for them to pick.
   * Goes to every player, or only targetPeerId. Returns the prompt id.
   */
  static askPlayers(speaker: ModuleObject | null, text: string, options: string[], targetPeerId?: string): string | null {
    if (GMNetworkManager.role !== 'host') return null;
    const replies = (options || []).map((o) => String(o).trim()).filter(Boolean).slice(0, 6);
    if (!String(text || '').trim() || !replies.length) return null;
    const prompt: GMDmPrompt = {
      promptId: GMManager.getNextNetId('ask'),
      speaker: speaker?.getName() || 'GM',
      text: text.trim(),
      options: replies,
    };
    this.dmPrompts.set(prompt.promptId, { prompt, targetPeerId, replies: [] });
    GMNetworkManager.sendDmPrompt(prompt, targetPeerId);
    const to = targetPeerId ? GMNetworkManager.peers.get(targetPeerId)?.name || 'a player' : 'everyone';
    GMNetworkManager.appendChat(prompt.speaker, `${prompt.text} (asked ${to}: ${replies.join(' / ')})`);
    GMManager.notifyChange();
    return prompt.promptId;
  }

  /** Host: a player answered one of our questions */
  static onDmReply(peerId: string, reply: { promptId: string; choice: number }) {
    const record = this.dmPrompts.get(reply?.promptId);
    if (!record || !record.prompt.options[reply.choice]) return;
    if (record.targetPeerId && record.targetPeerId !== peerId) return;
    if (record.replies.some((r) => r.peerId === peerId)) return;
    const name = GMNetworkManager.peers.get(peerId)?.name || 'A player';
    record.replies.push({ peerId, name, choice: reply.choice });
    GMNetworkManager.appendChat('Reply', `${name} answered "${record.prompt.options[reply.choice]}"`);
    GMManager.notifyChange();
  }

  /** Recent Light/Dark alignment shift banners shown to all connected players */
  static alignmentAlerts: GMAlignmentAlert[] = [];
  static ALIGNMENT_ALERT_MS = 6500;

  static activeAlignmentAlerts(now: number = Date.now()): GMAlignmentAlert[] {
    this.alignmentAlerts = this.alignmentAlerts.filter((a) => now - a.at < this.ALIGNMENT_ALERT_MS);
    return this.alignmentAlerts;
  }

  /** Play Light/Dark Side shift stinger + record visible alert banner */
  static notifyAlignmentShift(payload: GMPacketMap['alignment.shift']) {
    if (!payload) return;
    UINotificationManager.PlayAlignmentShiftSound?.(payload.alignment, payload.soundResRef);
    const localPlayer = GameState.getCurrentPlayer?.();
    if (!payload.targetNetId || (localPlayer as any)?.gmNetId === payload.targetNetId || GMManager.isGMUser?.()) {
      if (payload.alignment === 'light') UINotificationManager.LightShiftTimer = 10;
      else UINotificationManager.DarkShiftTimer = 10;
    }
    this.alignmentAlerts.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      targetName: payload.targetName,
      targetNetId: payload.targetNetId,
      alignment: payload.alignment,
      points: payload.points,
      total: payload.total,
      text: payload.text,
      at: Date.now(),
    });
    if (this.alignmentAlerts.length > 4) this.alignmentAlerts.shift();
    GMManager.notifyChange();
  }

  /** Host: award Light Side or Dark Side points to one player (`peerId` or `netId` or creature), or `'all'`, and alert everyone */
  static giveAlignment(target: string | ModuleCreature, alignment: 'light' | 'dark', amount: number = 5): boolean {
    const points = Math.round(Number(amount));
    if (!(points > 0)) return false;

    const recipients: ModuleCreature[] = [];
    const pushUnique = (cre: ModuleCreature | null | undefined) => {
      if (cre && !recipients.includes(cre)) recipients.push(cre);
    };

    if (typeof target === 'string') {
      if (target === 'all') {
        for (const peer of GMNetworkManager.peers.values()) pushUnique(this.getPeerActor(peer.peerId));
        for (const pc of GMManager.getPlayerCharacters()) pushUnique(pc);
      } else {
        pushUnique(this.getPeerActor(target) || (GMManager.netIdMap.get(target) as ModuleCreature | undefined));
      }
    } else if (target) {
      pushUnique(target);
    }

    if (!recipients.length) return false;

    const label = alignment === 'light' ? 'Light Side' : 'Dark Side';
    const soundResRef = UINotificationManager.GetAlignmentShiftSound?.(alignment) || (alignment === 'light' ? 'mus_s_lightshort' : 'mus_s_darkshort');

    for (const actor of recipients) {
      const before = Number(actor.getGoodEvil?.() ?? actor.goodEvil ?? 50);
      if (typeof actor.adjustAlignment === 'function') {
        // 2 = ALIGNMENT_LIGHT, 3 = ALIGNMENT_DARK
        actor.adjustAlignment(points, alignment === 'light' ? 2 : 3);
      } else {
        const delta = alignment === 'light' ? points : -points;
        actor.goodEvil = Math.max(0, Math.min(100, before + delta));
      }
    }

    const primary = recipients[0];
    const total = Math.round(Number(primary.getGoodEvil?.() ?? primary.goodEvil ?? 50));
    const targetName = recipients.length > 1
      ? `All players (${recipients.length})`
      : (primary.getName?.() || 'Player');
    const text = recipients.length > 1
      ? `The GM awarded ${targetName} ${points} ${label} point${points === 1 ? '' : 's'}!`
      : `${targetName} gained ${points} ${label} point${points === 1 ? '' : 's'}! (${total}/100)`;

    const payload: GMPacketMap['alignment.shift'] = {
      targetName,
      targetNetId: recipients.length === 1 ? primary.gmNetId : undefined,
      alignment,
      points,
      total,
      soundResRef,
      text,
    };

    GMNetworkManager.appendChat('GM', text);
    if (GMNetworkManager.role === 'host') {
      GMNetworkManager.send('alignment.shift', payload);
      this.updatePlayerSheets();
    }
    this.notifyAlignmentShift(payload);
    GMManager.notifyChange();
    return true;
  }

  /** The Careers character sheet attached to an actor, if it runs under the Careers rule set */
  static careersOf(actor: ModuleCreature | undefined): GMCareersCharacter | undefined {
    if (!actor) return undefined;
    return careersRuntimeOf(actor)?.character || actor.gmPlayerConfig?.careers;
  }

  /** Host: award XP to one connected player (campaign XP in Careers mode); reaches them with their next sheet */
  static giveXP(peerId: string, amount: number, reason: string = ''): boolean {
    const actor = this.getPeerActor(peerId);
    const xp = Math.round(Number(amount));
    if (!actor || !(xp > 0)) return false;
    const careers = this.careersOf(actor);
    if (careers) {
      if (!CareersAdvancement.awardXp(careers, xp, reason)) return false;
      // The host's record of what it awarded, which a later join is held to
      this.recordCareersXp(GMNetworkManager.peers.get(peerId)?.name, xp);
      CareersAdvancement.syncToCreature(actor, careers);
      const note = reason ? ` (${reason})` : '';
      GMNetworkManager.sendChatTo(peerId, 'GM', `You gained ${xp} campaign XP${note}.`);
      this.updatePlayerSheets();
      GMManager.notifyChange();
      return true;
    }
    actor.experience = (actor.experience || 0) + xp;
    GMNetworkManager.sendChatTo(peerId, 'GM', `You gained ${xp} XP.`);
    GMManager.notifyChange();
    return true;
  }

  /** Host: award campaign XP to a single careers character (connected or local) or the entire party */
  static giveCareersXP(target: ModuleCreature | 'all', amount: number, reason: string = ''): number {
    const xp = Math.round(Number(amount));
    if (!(xp > 0)) return 0;
    const list: ModuleCreature[] = target === 'all'
      ? GMManager.getPlayerCharacters()
      : (target ? [target] : []);
    let awarded = 0;
    for (const actor of list) {
      const careers = this.careersOf(actor);
      if (!careers) continue;
      if (!CareersAdvancement.awardXp(careers, xp, reason)) continue;
      // A connected player's award goes in the host's record (the GM's own characters never join)
      if (actor.gmOwnerPeerId) this.recordCareersXp(GMNetworkManager.peers.get(actor.gmOwnerPeerId)?.name, xp);
      CareersAdvancement.syncToCreature(actor, careers);
      awarded++;
      if (actor.gmOwnerPeerId) {
        const note = reason ? ` (${reason})` : '';
        GMNetworkManager.sendChatTo(actor.gmOwnerPeerId, 'GM', `You gained ${xp} campaign XP${note}.`);
      }
    }
    if (awarded > 0) {
      const note = reason ? ` — ${reason}` : '';
      GMLog.info('host', `awarded ${xp} campaign XP to ${awarded} character${awarded === 1 ? '' : 's'}${note}`);
      this.updatePlayerSheets();
      GMManager.notifyChange();
    }
    return awarded;
  }

  /** Host: validate and apply a Careers post-creation XP purchase live (outside combat, no respawn) */
  static spendXpOnHost(actor: ModuleCreature, raw: unknown, peerId?: string): boolean {
    if (!actor) return false;
    // A player's request is rebuilt from known fields before anything trusts it
    const purchase = CareersAdvancement.parsePurchase(raw);
    if (!purchase) {
      if (peerId) this.tellPlayer(peerId, "The host didn't understand that XP purchase.");
      return false;
    }
    const careers = this.careersOf(actor);
    if (!careers) {
      if (peerId) this.tellPlayer(peerId, 'Only Careers characters spend campaign XP this way.');
      return false;
    }
    const res = CareersAdvancement.applyPurchase(careers, purchase, !!actor.combatData?.combatState);
    if (!res.ok) {
      if (peerId) this.tellPlayer(peerId, res.reason || 'That XP purchase is not allowed right now.');
      return false;
    }
    CareersAdvancement.syncToCreature(actor, careers);
    GMLog.info('host', `${actor.getName()} spent ${res.record?.cost || 0} XP on ${purchase.kind}`);
    this.updatePlayerSheets();
    GMManager.notifyChange();
    return true;
  }

  /** Host: refund a Careers character's most recent post-creation XP purchase live */
  static undoCareersPurchase(actor: ModuleCreature): boolean {
    const careers = this.careersOf(actor);
    if (!careers) return false;
    const undone = CareersAdvancement.undoLastPurchase(careers);
    if (!undone) return false;
    CareersAdvancement.syncToCreature(actor, careers);
    GMLog.info('host', `refunded ${actor.getName()}'s last purchase (${undone.kind}, ${undone.cost} XP)`);
    this.updatePlayerSheets();
    GMManager.notifyChange();
    return true;
  }

  /** Host: refund all post-creation XP purchases for a full respec live */
  static respecCareers(actor: ModuleCreature): number {
    const careers = this.careersOf(actor);
    if (!careers) return 0;
    const count = CareersAdvancement.respecPurchases(careers);
    if (count > 0) {
      CareersAdvancement.syncToCreature(actor, careers);
      GMLog.info('host', `respecced ${actor.getName()} (${count} purchase${count === 1 ? '' : 's'} refunded)`);
      this.updatePlayerSheets();
      GMManager.notifyChange();
    }
    return count;
  }

  /** Host: put an item straight into one connected player's inventory */
  static giveItem(peerId: string, resRef: string, stack: number = 1): boolean {
    const actor = this.getPeerActor(peerId);
    const ref = String(resRef || '').trim().toLowerCase();
    const count = Math.max(1, Math.round(Number(stack) || 1));
    if (!actor || !ref) return false;
    this.addToPlayerInventory(actor, [{ resRef: ref, stack: count }]);
    GMNetworkManager.sendChatTo(peerId, 'GM', `You received ${ref}${count > 1 ? ` x${count}` : ''}.`);
    GMManager.notifyChange();
    return true;
  }

  /** Host: a network player's inventory, kept as resrefs so it can't drift from what the host grants */
  static getPlayerInventory(actor: ModuleObject): GMLootItem[] {
    if (!Array.isArray(actor.gmInventory)) actor.gmInventory = [];
    return actor.gmInventory;
  }

  static addToPlayerInventory(actor: ModuleObject, items: GMLootItem[]) {
    const inventory = this.getPlayerInventory(actor);
    for (const item of items) {
      const existing = inventory.find((e) => e.resRef === item.resRef);
      if (existing) existing.stack += item.stack;
      else inventory.push({ resRef: item.resRef, stack: item.stack });
    }
  }

  static removeFromPlayerInventory(actor: ModuleObject, resRef: string): boolean {
    const inventory = this.getPlayerInventory(actor);
    const entry = inventory.find((e) => e.resRef === resRef);
    if (!entry) return false;
    entry.stack--;
    if (entry.stack <= 0) inventory.splice(inventory.indexOf(entry), 1);
    return true;
  }

  /** A creature's classes as a sheet lists them (class, level, powers) */
  static sheetClassesOf(cre: ModuleCreature): GMPlayerSheet['classes'] {
    return (cre.classes || []).map((c) => ({ id: c.id, level: c.level, spells: (c.spells || []).map((s) => s.id) }));
  }

  static buildPlayerSheet(cre: ModuleCreature): GMPlayerSheet {
    const equipment: Record<string, string> = {};
    for (const slot of this.PLAYER_EQUIP_SLOTS) {
      const item: ModuleItem | undefined = (cre.equipment as any)?.[slot];
      const resRef = gmItemResRef(item);
      if (resRef) equipment[slot] = resRef;
    }
    const careersRuntime = careersRuntimeOf(cre);
    return {
      netId: cre.gmNetId,
      classes: this.sheetClassesOf(cre),
      attributes: { str: cre.str, dex: cre.dex, con: cre.con, int: cre.int, wis: cre.wis, cha: cre.cha },
      feats: (cre.feats || []).map((f) => f.id),
      skills: (cre.skills || []).map((s) => s?.rank ?? 0),
      hp: cre.getHP?.() ?? (cre.currentHitPoints || 0),
      maxHp: cre.getMaxHP?.() ?? (cre.maxHitPoints || 0),
      forcePoints: cre.forcePoints || 0,
      maxForcePoints: cre.maxForcePoints || 0,
      currentForce: cre.currentForce || 0,
      xp: cre.experience || 0,
      goodEvil: cre.getGoodEvil?.() ?? cre.goodEvil ?? 50,
      naturalAC: cre.naturalAC || 0,
      equipment,
      inventory: this.getPlayerInventory(cre).map((e) => ({ ...e })),
      ...(careersRuntime ? (() => {
        const st = careersRuntime.getStrainState();
        const activeBuffs = careersRuntime.getActiveBuffs();
        const cooldowns = careersRuntime.getCooldownSnapshot();
        return {
          careers: {
            character: careersRuntime.character,
            strain: st.strain,
            maxStrain: st.maxStrain,
            // Whole seconds avoid sub-second float jitter in sheet diffing while winded
            windedSeconds: Math.ceil(st.windedSeconds),
            ...(activeBuffs.length ? { activeBuffs } : {}),
            ...(Object.keys(cooldowns).length ? { cooldowns } : {}),
          },
        };
      })() : {}),
    };
  }

  /** Host: send each connected player their sheet whenever anything on it changed */
  static updatePlayerSheets() {
    for (const peer of GMNetworkManager.peers.values()) {
      const actor = peer.controlledNetId ? GMManager.netIdMap.get(peer.controlledNetId) : null;
      if (!actor || !GMObjectKind.isCreature(actor)) continue;
      const sheet = this.buildPlayerSheet(actor as ModuleCreature);
      const json = JSON.stringify(sheet);
      // A rejoining player keeps their id but starts with an empty sheet, so track each join separately
      const session = `${peer.peerId}:${peer.joinedAt}`;
      if (actor.gmLastSheetJson === json && actor.gmLastSheetSession === session) continue;
      actor.gmLastSheetJson = json;
      actor.gmLastSheetSession = session;
      GMNetworkManager.send('player.sheet', sheet, peer.peerId);
    }
  }

  /**
   * Host: tell a player why something they asked for didn't happen. It was only written in the GM's chat, so to
   * the player a power, item or action that the host refused simply never went off. Shown on their HUD
   */
  static tellPlayer(peerId: string | undefined, text: string) {
    GMNetworkManager.appendChat('System', text);
    if (peerId && GMNetworkManager.role === 'host') GMNetworkManager.send('player.notice', { text }, peerId);
  }

  /** Host: put an item from the player's inventory into an equipment slot */
  static async equipOnHost(actor: ModuleCreature, slot: number, resRef: string, peerId?: string) {
    const slotName = ModuleCreatureArmorSlot[slot];
    if (!slotName || !this.PLAYER_EQUIP_SLOTS.includes(slotName) || !resRef) return;
    if (!this.getPlayerInventory(actor).some((e) => e.resRef === resRef)) return;
    const wanted = await GMSpawner.createItemFromResRefAsync(resRef);
    if (wanted && actor.canUseItem?.(wanted) === false) {
      this.tellPlayer(peerId, `${actor.getName()} can't use that: it needs a feat they don't have.`);
      return;
    }
    if (!this.removeFromPlayerInventory(actor, resRef)) return;
    const current: ModuleItem | undefined = (actor.equipment as any)[slotName];
    const currentResRef = gmItemResRef(current);
    if (currentResRef) this.addToPlayerInventory(actor, [{ resRef: currentResRef, stack: 1 }]);
    const item = wanted || await GMSpawner.createItemFromResRefAsync(resRef);
    await actor.equipItem(slot, item);
  }

  /** Host: move an equipped item back into the player's inventory */
  static unequipOnHost(actor: ModuleCreature, slot: number) {
    const slotName = ModuleCreatureArmorSlot[slot];
    if (!slotName || !this.PLAYER_EQUIP_SLOTS.includes(slotName)) return;
    const current: ModuleItem | undefined = (actor.equipment as any)[slotName];
    const currentResRef = gmItemResRef(current);
    if (!currentResRef) return;
    this.addToPlayerInventory(actor, [{ resRef: currentResRef, stack: 1 }]);
    actor.unequipSlot(slot);
  }

  /** Client: equipping our own character becomes a request to the host. Returns true when handled. */
  static requestNetworkEquip(cre: ModuleObject, slot: number, item: ModuleItem): boolean {
    if (!this.isOwnNetworkCharacter(cre)) return false;
    const resRef = gmItemResRef(item);
    if (!resRef) return true;
    GMNetworkManager.sendIntent('equip', undefined, { slot, resRef });
    return true;
  }

  /** Client: unequipping our own character becomes a request to the host. Returns true when handled. */
  static requestNetworkUnequip(cre: ModuleObject, slot: number): boolean {
    if (!this.isOwnNetworkCharacter(cre)) return false;
    GMNetworkManager.sendIntent('unequip', undefined, { slot });
    return true;
  }

  static isOwnNetworkCharacter(cre: ModuleObject): boolean {
    return GameState.gmMode &&
      GMNetworkManager.role === 'client' &&
      !this.applyingHostSheet &&
      !!cre?.gmNetId &&
      cre.gmNetId === GMNetworkManager.assignedActorNetId;
  }

  /**
   * Client: make our character match the host's: stats, classes, feats, skills, equipment and inventory
   */
  static async applyPlayerSheetOnClient(sheet: GMPlayerSheet) {
    if (!sheet || sheet.netId !== GMNetworkManager.assignedActorNetId) return;
    const cre = GMManager.netIdMap.get(sheet.netId) as ModuleCreature;
    if (!cre) {
      this.pendingPlayerSheet = sheet;
      return;
    }
    this.pendingPlayerSheet = null;
    this.applyingHostSheet = true;
    try {
      await this.applySheetToCharacter(cre, sheet);
      // The GM's awards and our purchases go back into our own saved Careers character, so they come to the next session
      if (sheet.careers?.character) GMCareersCharacters.keepFromSession(sheet.careers.character);

      const inventoryJson = JSON.stringify(sheet.inventory);
      if (inventoryJson !== this.lastAppliedInventoryJson) {
        this.lastAppliedInventoryJson = inventoryJson;
        // Assigned directly: InventoryManager.addItem would re-credit gold on every resync
        GameState.InventoryManager.inventory = await this.createLootItems(sheet.inventory);
      }
    } finally {
      this.applyingHostSheet = false;
    }
    GMManager.notifyChange();
  }

  /** Make a character's stats, classes, feats, skills, XP, HP/FP and equipment match a sheet */
  static async applySheetToCharacter(cre: ModuleCreature, sheet: GMPlayerSheet) {
    Object.assign(cre, sheet.attributes);
    // Rebuild the class, feat and power objects only when the creature's own build differs from the sheet's.
    // Compared with the creature as it is now (not the last sheet applied), so a level-up, GM grant or Careers
    // purchase made some other way is still put back by the next sheet
    const sameBuild = JSON.stringify(this.sheetClassesOf(cre)) === JSON.stringify(sheet.classes)
      && JSON.stringify((cre.feats || []).map((f) => f.id)) === JSON.stringify(sheet.feats);
    if (!sameBuild) {
      cre.classes = sheet.classes.map((c) => {
        const cls = new CreatureClass(c.id);
        cls.setLevel(c.level);
        for (const spellId of c.spells) cls.addSpell(new TalentSpell(spellId));
        return cls;
      });
      const featRows = GameState.TwoDAManager.datatables.get('feat')?.rows || {};
      cre.feats = sheet.feats.map((id) => TalentFeat.From2DA({ __index: id, ...(featRows[id] || {}) }));
    }
    sheet.skills.forEach((rank, i) => cre.skills?.[i]?.setRank(rank));
    cre.experience = sheet.xp;
    // Set, not setGoodEvil: that queues KotOR's own shift icon and stinger, and the GM's alignment.shift has
    // already played it (it played twice for the player who got the points)
    if (typeof sheet.goodEvil === 'number') cre.goodEvil = Math.max(0, Math.min(100, sheet.goodEvil));
    if (typeof sheet.naturalAC === "number") cre.naturalAC = sheet.naturalAC;
    cre.forcePoints = sheet.forcePoints;
    cre.maxForcePoints = sheet.maxForcePoints;
    cre.currentForce = sheet.currentForce;
    GMManager.setCreatureHP(cre, sheet.hp, sheet.maxHp);
    if (sheet.careers?.character) {
      if (cre.careersRules instanceof CareersRuntime) {
        cre.careersRules.refresh(sheet.careers.character);
      } else {
        cre.careersRules = new CareersRuntime(sheet.careers.character, cre);
      }
      (cre.careersRules as CareersRuntime).syncStrain(sheet.careers);
    }
    await this.syncEquipmentTo(cre, sheet.equipment);
  }

  /** Make a character's equipped items match a slot name -> resref map */
  static async syncEquipmentTo(cre: ModuleCreature, equipment: Record<string, string>) {
    for (const slotName of this.PLAYER_EQUIP_SLOTS) {
      const want = equipment[slotName] || '';
      const current: ModuleItem | undefined = (cre.equipment as any)[slotName];
      const have = gmItemResRef(current);
      if (want === have) continue;
      const slot = (ModuleCreatureArmorSlot as any)[slotName] as number;
      if (want) {
        await cre.equipItem(slot, await GMSpawner.createItemFromResRefAsync(want));
      } else {
        cre.unequipSlot(slot);
      }
    }
  }

  /**
   * Careers rules: the campaign XP the GM has awarded each player, by lowercased player name. The host's record,
   * not the player's file: a joining character may not claim more than this. Saved with the session.
   */
  static careersXpAwarded: Map<string, number> = new Map();

  static careersXpKey(playerName: string | undefined): string {
    return String(playerName || 'Player').trim().toLowerCase();
  }

  /** Campaign XP the GM has awarded this player so far (0 when none) */
  static careersXpFor(playerName: string | undefined): number {
    return this.careersXpAwarded.get(this.careersXpKey(playerName)) || 0;
  }

  /** Record an award of campaign XP to a player (the Careers advancement path calls this as the GM awards XP) */
  static recordCareersXp(playerName: string | undefined, amount: number) {
    const xp = Math.floor(Number(amount));
    if (!Number.isFinite(xp) || xp <= 0) return;
    const key = this.careersXpKey(playerName);
    this.careersXpAwarded.set(key, (this.careersXpAwarded.get(key) || 0) + xp);
  }

  /** Host: verify a joining player's character matches the session's rule set; returns a refusal reason or null */
  static checkJoinRuleset(preset: GMPlayerJoinPreset | undefined, playerName?: string): string | null {
    const ruleset = GMManager.ruleset || 'kotor';
    const hasCareers = !!preset?.careersCharacter;
    if (ruleset === 'careers') {
      if (!hasCareers || !GMCareersCharacters.isCareersCharacter(preset!.careersCharacter)) {
        return 'This session uses the Careers rule set (KotOR II). Pick or make a Careers character to join.';
      }
      const problems = CareersRules.validate(preset!.careersCharacter);
      if (problems.length) {
        return `Your Careers character can't join: ${problems[0]}`;
      }
      // The GM hands out campaign XP; a file can't award itself any
      const claimed = Math.max(0, Math.floor(Number(preset!.careersCharacter!.campaignXpEarned) || 0));
      const awarded = this.careersXpFor(playerName ?? preset!.name);
      if (claimed > awarded) {
        return `Your Careers character has ${claimed} campaign XP, but the GM has awarded you ${awarded} in this session. `
          + 'Join with a character that has no more than that, or ask the GM.';
      }
      return null;
    }
    if (hasCareers) {
      return 'This session uses classic KotOR rules. Pick a classic character or quick build to join.';
    }
    return null;
  }

  /**
   * Host: a player connected (or reconnected). A reconnecting player, same peer id, takes back the character
   * they left behind; a new one gets a character from the build they picked. Either way they get the scene.
   */
  static async onPeerJoin(peerId: string, payload: GMPacketMap['peer.join']) {
    const { name, preset } = payload || {};
    const net = GMNetworkManager;
    const assign = (netId: string) => net.send('actor.assign', { netId, ownerPeerId: peerId }, peerId);
    // A repeated join from a peer we already spawned must not create a second character
    const existingPeer = net.peers.get(peerId);
    if (existingPeer) {
      // Still spawning: the in-flight join will send the snapshot and assignment
      if (!existingPeer.controlledNetId) return;
      net.sendWorldSnapshot(peerId);
      assign(existingPeer.controlledNetId);
      return;
    }

    const rejoinNetId = GMReplication.findActorOwnedBy(peerId);
    const reserved = GMSessions.reservedPlayers.get(String(name || 'Player').trim().toLowerCase());
    if (!rejoinNetId && !reserved) {
      const refusal = this.checkJoinRuleset(preset, name);
      if (refusal) {
        GMLog.info('host', `refused ${name || peerId}: ${refusal}`);
        net.send('join.refused', { reason: refusal, ruleset: GMManager.ruleset }, peerId);
        return;
      }
    }

    const peerInfo: GMPeerInfo = { peerId, name: name || 'Player', role: 'client', joinedAt: Date.now() };
    net.peers.set(peerId, peerInfo);

    net.appendChat('System', rejoinNetId ? `${peerInfo.name} rejoined the game.` : `${peerInfo.name} joined the game!`);
    const spawnedNetId = rejoinNetId || await this.spawnPlayerFromNetworkPreset(peerId, peerInfo.name, preset);
    peerInfo.controlledNetId = spawnedNetId;
    net.sendWorldSnapshot(peerId);
    if (spawnedNetId) assign(spawnedNetId);
    this.updatePlayerSheets();
    net.notifyChange();
  }

  /**
   * Host: what each request a player sends does (GM_INTENTS says which take over the character's position and
   * which interrupt it). An interrupting request returns whether the host now drives the character.
   */
  static INTENT_HANDLERS: Record<GMIntentKind, (actor: ModuleCreature, intent: GMClientIntent, peerId: string) => void | boolean | Promise<boolean>> = {
    loot: (actor, intent, peerId) => GMPlayers.grantLootOnHost(peerId, actor, intent.targetNetId),
    equip: (actor, intent, peerId) => {
      GMPlayers.equipOnHost(actor, intent.slot, intent.resRef, peerId).catch((e) => console.warn('[GMPlayers] equip failed', e));
    },
    unequip: (actor, intent) => GMPlayers.unequipOnHost(actor, intent.slot),
    stealth: (actor) => actor.setStealthMode(!actor.stealthMode),
    levelup: (actor) => GMPlayers.levelUpOnHost(actor),
    roll: (actor, intent) => !!GMChecks.rollForPlayer(actor, intent.check || Number(intent.abilityId)),
    cancel: (actor) => { actor.gmFightTarget = undefined; return false; },
    wheel: (actor, intent, peerId) => GMManager.holdForWheel(peerId, actor.getName() || 'A player', !!intent.open),
    ready: (actor, intent, peerId) => GMPacing.setReady(peerId, !!intent.ready),
    move: (actor, intent, peerId) => {
      if (!GMPlayers.planMoveOnHost(actor, intent)) GMPlayers.tellPlayer(peerId, 'Moves are planned while the world holds.');
    },
    spend_xp: (actor, intent, peerId) => GMPlayers.spendXpOnHost(actor, intent.purchase, peerId),
    mine: (actor, intent, peerId) => {
      actor.gmNetTarget = undefined;
      return GMMines.useMineOnHost(actor, intent).then((ok) => {
        if (!ok) GMPlayers.tellPlayer(peerId, `${actor.getName()} can't do that right now.`);
        return ok;
      });
    },
    ability: (actor, intent, peerId) => {
      actor.gmNetTarget = undefined;
      return GMPlayers.useAbilityOnHost(actor, intent).then((ok) => {
        if (!ok) GMPlayers.tellPlayer(peerId, GMPlayers.whyNot(actor, intent));
        return ok;
      });
    },
    open: (actor, intent) => GMPlayers.actOnTarget(actor, intent),
    attack: (actor, intent) => GMPlayers.actOnTarget(actor, intent),
    use: (actor, intent) => GMPlayers.actOnTarget(actor, intent),
  };

  /**
   * Host: a move planned in the hold (GMPacing): the character runs there first when the round plays, then does
   * what else it planned. At most one round's run from where it stands.
   */
  static planMoveOnHost(actor: ModuleCreature, intent: GMClientIntent): boolean {
    if (GMPacing.phase !== 'plan' || ![intent.x, intent.y, intent.z].every((n) => Number.isFinite(n))) return false;
    const reach = (actor.getRunSpeed?.() || 3.66) * CombatRound.ROUND_LENGTH / 1000;
    const to = GMPacing.clampMove(actor.position, { x: intent.x as number, y: intent.y as number }, reach);
    // A move planned again replaces the last one
    const queue: any[] = actor.actionQueue as any;
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i]?.gmPlannedMove) queue.splice(i, 1);
    const move: any = new GameState.ActionFactory.ActionMoveToPoint();
    move.setParameter(0, ActionParameterType.FLOAT, to.x);
    move.setParameter(1, ActionParameterType.FLOAT, to.y);
    // The height too stays within a round's run of where they stand (the client's word is only a suggestion)
    const z = Math.max(actor.position.z - reach, Math.min(actor.position.z + reach, intent.z as number));
    move.setParameter(2, ActionParameterType.FLOAT, z);
    move.setParameter(3, ActionParameterType.DWORD, GameState.module.area.id);
    move.setParameter(4, ActionParameterType.DWORD, ModuleObjectConstant.OBJECT_INVALID);
    move.setParameter(5, ActionParameterType.INT, 1);
    move.setParameter(6, ActionParameterType.FLOAT, 0.5);
    move.setParameter(7, ActionParameterType.INT, 0);
    move.setParameter(8, ActionParameterType.FLOAT, 30.0);
    move.gmPlannedMove = true;
    actor.actionQueue.addFront(move);
    actor.gmHostDriven = true;
    GMLog.info('host', `${actor.getName()} plans to move ${Math.hypot(to.x - actor.position.x, to.y - actor.position.y).toFixed(1)} m`);
    return true;
  }

  /** Host: why a power, feat, skill or item a player asked for couldn't be used, in words they can act on */
  static whyNot(actor: ModuleCreature, intent: GMClientIntent): string {
    const name = actor.getName() || 'You';
    const target = intent.targetNetId ? GMManager.netIdMap.get(intent.targetNetId) : actor;
    const careers = careersRuntimeOf(actor);
    if (actor.isDead?.()) return `${name} is down.`;
    if (!target || target.gmHidden) return "That target isn't there any more.";
    const id = Number(intent.abilityId);
    if (intent.ability === 'spell') {
      const spell = this.spellToCast(actor, id, intent.variant);
      if (!spell) return `${name} doesn't know that power.`;
      if (spell.isBlockedByArmor?.(actor)) return `${name} can't use that power while wearing armour.`;
      const rule = GMCombatAI.powerTargetRule(spell.forcehostile);
      if (target !== actor && !GMCombatAI.worksOn(rule, target)) return `That power only works on ${GMCombatAI.ruleText(rule)}.`;
      const cost = Number(spell.getForcePointCost?.(actor) ?? 0);
      if (cost > actor.getFP()) {
        if (careers) {
          if (careers.isWinded()) return `${name} is winded and cannot push with Strain.`;
          if (careers.strainToPush(cost, actor.getFP()) === null) {
            return `Not enough Force or Strain: it needs ${cost} Force, ${name} has ${Math.floor(actor.getFP())} and too little Strain left to push.`;
          }
        } else {
          return `Not enough Force: it needs ${cost}, ${name} has ${Math.floor(actor.getFP())}.`;
        }
      }
    }
    if (intent.ability === 'feat') {
      if (!actor.getFeats().some((f: any) => f.id === id)) return `${name} doesn't have that feat.`;
      if (careers?.isWinded() && careers.getCombatFeatStrainCost(id) > 0) {
        return `${name} is winded and cannot spend Strain.`;
      }
    }
    if (intent.ability === 'talent') {
      if (!careers) return `${name} doesn't have active talents.`;
      const tId = typeof intent.talentId === 'string' ? intent.talentId : '';
      const info = careers.getActiveTalents().find((t) => t.id === tId);
      if (!info) return `${name} doesn't have that talent.`;
      if (info.why) return `${info.name}: ${info.why}.`;
      const onTarget = careers.talentTargetProblem(tId, GMObjectKind.isCreature(target) ? target as ModuleCreature : undefined);
      if (onTarget) return `${info.name}: ${onTarget}`;
    }
    if (intent.ability === 'item' && intent.resRef && !this.getPlayerInventory(actor).some((e) => e.resRef === intent.resRef)) return `${name} has none of those left.`;
    if (intent.ability === 'skill') return `${name} doesn't have the skill for that.`;
    return `${name} can't use that right now.`;
  }

  /**
   * Host: a player's character finished a combat round with nothing more queued: it goes on attacking the enemy its
   * player chose, as the character you control does in KotOR, until that enemy is down or the player moves away
   * (a cancel). KotOR's AI scripts used to do this for it, and picked their own attacks over the player's powers
   */
  static keepFighting(actor: ModuleCreature) {
    const round = actor.combatRound;
    if (!round || round.action || round.scheduledActionList.length || actor.isDead()) return;
    const target = actor.gmFightTarget as ModuleCreature | undefined;
    if (!target || target.isDead?.() || target.gmHidden || !GMObjectKind.isCreature(target) || !target.isHostile?.(actor)) {
      actor.gmFightTarget = undefined;
      return;
    }
    if (GMManager.isPlayerFrozen(actor) || actor.isDebilitated?.()) return;
    actor.attackCreature(target, undefined);
  }

  /** Open a door, attack a creature or use an object: the host walks the character there and does it */
  static actOnTarget(actor: ModuleCreature, intent: GMClientIntent): boolean {
    const target = intent.targetNetId ? GMManager.netIdMap.get(intent.targetNetId) : null;
    if (!target || target === actor) return false;
    // The host now owns this actor's position; drop any half-applied client movement
    actor.gmNetTarget = undefined;
    if (intent.kind === 'open' && !GMObjectKind.isDoor(target)) return false;
    if (intent.kind === 'attack' && !GMObjectKind.isCreature(target)) return false;
    if (intent.kind === 'open') actor.actionOpenDoor(target);
    else if (intent.kind === 'attack') {
      actor.attackCreature(target, undefined);
      actor.gmFightTarget = target;
    }
    else actor.actionUseObject(target);
    return true;
  }

  /**
   * Execute a client's interaction request on the host using the engine's normal actions,
   * so pathing into range, door/placeable use, and combat resolve exactly as in single player.
   */
  static applyClientIntentOnHost(peerId: string, intent: GMClientIntent) {
    if (!intent) return;
    const who = GMNetworkManager.peers.get(peerId)?.name || peerId;
    const target = intent.targetNetId ? GMManager.netIdMap.get(intent.targetNetId) : undefined;
    const request = `${who} asks to ${intent.kind}${intent.targetNetId ? ` ${target ? GMLog.describe(target) : `${intent.targetNetId} (not in this scene)`}` : ''}`;
    const actor = GMReplication.getOwnedActor(peerId, intent.netId);
    if (!actor) {
      GMLog.warn('host', `${request}: refused, ${intent.netId} isn't their character`);
      return;
    }
    actor.gmIntentSeq = intent.seq;
    // A watching player can't act (a late request from before the freeze is dropped too)
    if (GMManager.playersFrozen && intent.kind !== 'cancel') {
      GMLog.info('host', `${request}: ignored, players are watching (frozen)`);
      if (intent.kind !== 'wheel') this.tellPlayer(peerId, 'The GM has everyone watching for now.');
      return;
    }
    const meta = GM_INTENTS[intent.kind];
    const handler = this.INTENT_HANDLERS[intent.kind];
    if (!meta || !handler) {
      GMLog.warn('host', `${request}: refused, the host doesn't know that request`);
      return;
    }

    // Already attacking the enemy they clicked: the attack carries on (restarting it cost the swing in progress)
    if (intent.kind === 'attack' && target && GMObjectKind.isCreature(target) && this.isAttackingTarget(actor, target as ModuleCreature)) {
      actor.gmNetTarget = undefined;
      actor.gmHostDriven = true;
      GMLog.info('host', `${request}: already on it`);
      return;
    }
    // A power, combat feat or item joins the combat queue behind what's there, as in KotOR (each one cleared
    // the queue: it never filled, and a power waiting for its round was dropped by the next click)
    const queues = intent.kind === 'ability' && this.QUEUED_ABILITIES.includes(String(intent.ability));
    const isInstantTalent = intent.kind === 'ability' && intent.ability === 'talent';
    if (queues && (actor.combatRound?.scheduledActionList?.length || 0) >= this.QUEUE_LIMIT) {
      this.tellPlayer(peerId, `${actor.getName()}'s queue is full: wait for what's queued, or Stop.`);
      return;
    }
    // While planning, an order that clears the queue keeps the move already planned for the round
    const plannedMove = (GMPacing.phase === 'plan' && intent.kind !== 'cancel' && meta.interrupts && !queues && !isInstantTalent)
      ? ((actor.actionQueue as any) || []).find((a: any) => a?.gmPlannedMove)
      : undefined;
    if (meta.interrupts && !queues && !isInstantTalent) actor.clearAllActions();
    const result = handler(actor, intent, peerId);
    if (!meta.interrupts) {
      GMLog.info('host', request);
      return;
    }
    const report = (ok: boolean) => {
      if (plannedMove && GMPacing.phase === 'plan' && !((actor.actionQueue as any) || []).some((a: any) => a?.gmPlannedMove)) {
        actor.actionQueue.addFront(plannedMove);
      }
      if (!isInstantTalent) actor.gmHostDriven = ok || !!plannedMove;
      if (ok) GMLog.info('host', `${request}: on it`);
      else GMLog.warn('host', `${request}: can't be done`);
    };
    if (result instanceof Promise) {
      result.then(report).catch((e) => console.warn(`[GM host] ${request}: failed`, e));
    } else {
      report(!!result);
    }
  }

  /** Abilities that queue in combat rather than interrupt */
  static QUEUED_ABILITIES = ['spell', 'feat', 'item'];
  /** Actions waiting behind the current one, at most (KotOR's HUD shows the current one and three more) */
  static QUEUE_LIMIT = 3;

  /** Host: this character's attack (queued, or its combat round's) is on that target */
  static isAttackingTarget(actor: ModuleCreature, target: ModuleCreature): boolean {
    const round = actor.combatRound;
    const attack = (a: any) => a && a.target === target && (a.actionType === CombatActionType.ATTACK || a.actionType === CombatActionType.ATTACK_USE_FEAT);
    return attack(round?.action) || !!round?.scheduledActionList?.some(attack);
  }

  /**
   * Host: the power object a player's request casts: one their character knows, or (with a variant) a Careers power
   * tree variant they own, which casts its root power differently (Pull). Anything else isn't theirs to cast
   */
  static spellToCast(actor: ModuleCreature, spellId: number, variant?: unknown): any {
    if (variant === undefined) return actor.getSpells().find((s: any) => s.id === spellId);
    return careersRuntimeOf(actor)?.getPowerVariants()
      .find((v) => v.def.variant === variant && v.talent.id === spellId)?.talent;
  }

  /**
   * Host: use a Force power, feat, skill or item a player picked from KotOR's action menu, through the same
   * engine path as anyone else. It must be theirs: a power or feat their character knows, a skill they have
   * ranks in, an item they carry or wear. Returns false when it can't be used.
   */
  static async useAbilityOnHost(actor: ModuleCreature, intent: GMClientIntent): Promise<boolean> {
    if (!actor || actor.isDead()) return false;
    const target = intent.targetNetId ? GMManager.netIdMap.get(intent.targetNetId) : actor;
    if (!target || target.gmHidden) return false;
    const careers = careersRuntimeOf(actor);
    // Aimed at an enemy: that's who they're fighting now (they go back to attacking it after)
    if (target !== actor && GMObjectKind.isCreature(target) && (target as ModuleCreature).isHostile?.(actor)) actor.gmFightTarget = target;
    const id = Number(intent.abilityId);

    switch (intent.ability) {
      case 'spell': {
        const spell = this.spellToCast(actor, id, intent.variant);
        if (!spell) return false;
        if (spell.isBlockedByArmor?.(actor)) return false;
        // Disable Droid on a person, and the like: it does nothing, so it isn't cast
        if (target !== actor && !GMCombatAI.worksOn(GMCombatAI.powerTargetRule(spell.forcehostile), target)) return false;
        const cost = Number(spell.getForcePointCost?.(actor) ?? 0);
        // Only a Careers character pushes with Strain (not while winded, nor past its Strain); classic characters never stop here
        if (careers && cost > actor.getFP() && careers.strainToPush(cost, actor.getFP()) === null) return false;
        spell.useTalentOnObject(target, actor);
        return true;
      }
      case 'feat': {
        const feat = actor.getFeats().find((f: any) => f.id === id);
        if (!feat) return false;
        if (careers?.isWinded() && careers.getCombatFeatStrainCost(id) > 0) return false;
        feat.useTalentOnObject(target, actor);
        return true;
      }
      case 'talent': {
        if (!careers) return false;
        const talentId = typeof intent.talentId === 'string' && intent.talentId.length > 0 && intent.talentId.length <= 64
          ? intent.talentId
          : '';
        if (!talentId) return false;
        const targetCreature = GMObjectKind.isCreature(target) ? (target as ModuleCreature) : actor;
        // The runtime checks the talent is theirs and that its target is one it may land on (an ally in range)
        const res = careers.activateTalent(talentId, targetCreature);
        if (!res.ok) return false;
        if (res.message) GMLog.info('host', res.message);
        this.updatePlayerSheets();
        GMManager.notifyChange();
        return true;
      }
      case 'skill': {
        if (id === SkillType.SECURITY) {
          // A security tunneler, if they used one; otherwise their Security ranks
          let tool: ModuleItem | undefined;
          if (intent.resRef) {
            if (!this.getPlayerInventory(actor).some((e) => e.resRef === intent.resRef)) return false;
            tool = await GMSpawner.createItemFromResRefAsync(intent.resRef);
          } else if ((actor.getSkillRanks?.(id) ?? 0) < 1) {
            return false;
          }
          const action = new GameState.ActionFactory.ActionUnlockObject();
          action.setParameter(0, ActionParameterType.DWORD, target);
          action.setParameter(1, ActionParameterType.DWORD, tool || ModuleObjectConstant.OBJECT_INVALID);
          actor.actionQueue.add(action);
          return true;
        }
        const skill = actor.skills?.[id];
        if (!skill || (actor.getSkillRanks?.(id) ?? 0) < 1) return false;
        skill.useTalentOnObject(target, actor);
        return true;
      }
      case 'item': {
        const resRef = String(intent.resRef || '');
        if (!resRef) return false;
        // Worn items (droid shields and utilities) use their own charges
        const worn = Object.values(actor.equipment || {}).find((i: any) => i?.getItemResRef?.() === resRef) as ModuleItem | undefined;
        if (worn) {
          if (!worn.getUseTargeting()) return false;
          worn.useItemOnObject(actor, target);
          return true;
        }
        // Carried items come out of the player's inventory, one per use when they're single-use
        if (!this.getPlayerInventory(actor).some((e) => e.resRef === resRef)) return false;
        const item = await GMSpawner.createItemFromResRefAsync(resRef);
        const property = item?.getUsableCastSpellProperties()[0];
        if (!item || !property) return false;
        if (ModuleItem.GetCastSpellUseCost(property).single) this.removeFromPlayerInventory(actor, resRef);
        item.possessor = actor;
        item.useItemOnObject(actor, target);
        return true;
      }
    }
    return false;
  }

  /**
   * Client: a pick from KotOR's action menu becomes a request to the GM's machine, which owns the world.
   * Returns true when it was sent (or can't be sent and shouldn't run locally).
   */
  static interceptMenuAction(pc: ModuleObject, entry: any, target: ModuleObject): boolean {
    if (GMNetworkManager.role !== 'client') return false;
    if (!pc || pc.gmNetId !== GMNetworkManager.assignedActorNetId) return false;
    if (GMManager.isPlayerFrozen(pc)) return true;
    const targetNetId = target && target !== pc ? (target.gmNetId as string | undefined) : undefined;
    const send = (ability: 'spell' | 'feat' | 'skill' | 'item', abilityId: number, resRef?: string) => {
      GMNetworkManager.sendIntent('ability', targetNetId, { ability, abilityId, resRef });
      return true;
    };

    if (entry.item) return send('item', -1, entry.item.getItemResRef());
    if (entry.action?.type === 'stealth') {
      GMNetworkManager.sendIntent('stealth');
      return true;
    }
    if (entry.action?.type === ActionType.ActionPhysicalAttacks) {
      if (targetNetId) GMNetworkManager.sendIntent('attack', targetNetId);
      return true;
    }
    const talent = entry.talent;
    if (talent) {
      if (BitWise.InstanceOf(talent.objectType, TalentObjectType.TalentSpell)) {
        // A Careers power tree variant (Pull) is its root power cast differently: the host is told which
        if (talent.careersVariant) {
          GMNetworkManager.sendIntent('ability', targetNetId, { ability: 'spell', abilityId: talent.id, variant: talent.careersVariant });
          return true;
        }
        return send('spell', talent.id);
      }
      if (BitWise.InstanceOf(talent.objectType, TalentObjectType.TalentFeat)) return send('feat', talent.id);
      if (BitWise.InstanceOf(talent.objectType, TalentObjectType.TalentSkill)) return send('skill', talent.id);
    }
    const mineAction = ({
      [ActionType.ActionSetMine]: 'set', [ActionType.ActionDisarmMine]: 'disarm', [ActionType.ActionRecoverMine]: 'recover',
    } as Record<number, 'set' | 'disarm' | 'recover'>)[entry.action?.type];
    if (mineAction) {
      const item = mineAction === 'set' ? entry.action.getParameter?.(0) : undefined;
      const layingHere = mineAction === 'set' && (!target || target === pc);
      const onWhat = layingHere ? undefined : (mineAction === 'set' ? targetNetId : GMMines.mineNetId(target as ModuleTrigger));
      if (!layingHere && !onWhat) return true;
      GMNetworkManager.sendIntent('mine', onWhat, { mine: layingHere ? 'lay' : mineAction, resRef: item?.getItemResRef?.() });
      return true;
    }
    if (entry.action?.type === ActionType.ActionUnlockObject) {
      const tool = entry.action.getParameter?.(1);
      return send('skill', SkillType.SECURITY, tool && typeof tool === 'object' ? tool.getItemResRef?.() : undefined);
    }
    GMNetworkManager.appendChat('System', "That can't be done in a GM session yet.");
    GMPlayerHud.notice("That can't be done in a GM session yet.");
    return true;
  }

  /** Host: a player's mine came out of their inventory (true when it was a GM session player's) */
  static consumePlayerItem(owner: ModuleObject, item: ModuleItem): boolean {
    if (!GameState.gmMode || GMNetworkManager.role !== 'host' || !owner?.gmOwnerPeerId) return false;
    this.removeFromPlayerInventory(owner, item.getItemResRef());
    return true;
  }

  /**
   * Client: turn a click on a world object into a host intent instead of running it locally.
   * Returns true when the click was handled.
   */
  static interceptInteraction(pc: ModuleObject, target: ModuleObject): boolean {
    if (GMNetworkManager.role !== 'client' || !target) return false;
    const what = GMLog.describe(target);
    if (!pc || pc.gmNetId !== GMNetworkManager.assignedActorNetId) {
      GMLog.warn('click', `Not sent: the character clicking ${what} isn't the one this player was given (${GMNetworkManager.assignedActorNetId || 'none yet'})`);
      return false;
    }
    if (GMManager.isPlayerFrozen(pc)) {
      GMLog.warn('click', `Not sent: the GM has players watching (frozen), so ${what} can't be used now`);
      return true;
    }
    const targetNetId = target.gmNetId as string | undefined;
    if (!targetNetId) {
      GMLog.warn('click', `Not sent: ${what} has no net id, so the host can't tell which object it is; it's handled locally`);
      return false;
    }
    const send = (kind: 'open' | 'use' | 'attack') => {
      GMNetworkManager.sendIntent(kind, targetNetId);
      GMLog.info('click', `Asked the host to ${kind} ${what}`);
      return true;
    };

    if (GMObjectKind.isDoor(target)) return send('open');
    if (GMObjectKind.isPlaceable(target)) {
      // A computer or other object with a conversation: the GM speaks for it, as for an NPC
      if (GameState.GMConversationManager?.canTalkTo(target, pc) && GameState.GMConversationManager.requestTalk(target)) {
        GMLog.info('click', `${what} has a conversation; walking over to talk (the GM speaks for it)`);
        return true;
      }
      return send('use');
    }
    if (GMObjectKind.isCreature(target)) {
      const cre = target as ModuleCreature;
      if (cre.isHostile(pc) && !cre.isDead()) return send('attack');
      if (cre.isDead()) return send('use');
    }
    // Anyone else: walk over and talk; the GM speaks for them
    if (GameState.GMConversationManager?.requestTalk(target)) {
      GMLog.info('click', `Walking over to talk to ${what}`);
      return true;
    }
    GMLog.warn('click', `Not sent: ${what} isn't something a player can use, open, attack or talk to`);
    return false;
  }

  /**
   * Client: level our character up on the host, which owns it (levelling up only here would be undone by the
   * next sheet, and the host's fights would use the old level). Returns true when asked for.
   */
  static requestNetworkLevelUp(creature: ModuleObject): boolean {
    if (GMNetworkManager.role !== 'client') return false;
    if (!creature || creature.gmNetId !== GMNetworkManager.assignedActorNetId) return false;
    GMPlayerRequests.levelUp();
    return true;
  }

  /** Host: level a player's character up, if they have the XP. Their next sheet carries the new level. */
  static levelUpOnHost(actor: ModuleCreature): boolean {
    if (!actor?.canLevelUp?.()) {
      GMLog.warn('host', `${GMLog.describe(actor)} asked to level up without the XP for it`);
      return false;
    }
    const before = actor.getTotalClassLevel();
    actor.autoLevelUp();
    const after = actor.getTotalClassLevel();
    GMLog.info('host', `${GMLog.describe(actor)} levelled up: ${before} → ${after}`);
    if (after > before) GMNetworkManager.appendChat('System', `${actor.getName()} reached level ${after}.`);
    return after > before;
  }

  /**
   * Host: a player's character tried to use something and couldn't. They don't hear the "locked" sound on
   * the GM's machine, so tell them.
   */
  static onUseBlocked(obj: ModuleObject, user: ModuleObject | undefined, reason: 'locked' | 'skill') {
    if (!GameState.gmMode || GMNetworkManager.role !== 'host') return;
    const peerId = user?.gmOwnerPeerId as string | undefined;
    const name = obj?.getName?.() || 'It';
    GMLog.info('host', `${GMLog.describe(user)} couldn't use ${GMLog.describe(obj)}: ${reason === 'locked' ? 'it is locked' : 'they failed its skill check'}`);
    if (!peerId) return;
    const text = reason === 'locked'
      ? `${name} is locked. Pick Security (or a security spike) from its action menu to open it.`
      : `You couldn't work out how to use ${name}.`;
    GMNetworkManager.sendChatTo(peerId, 'System', text);
  }

  /**
   * A player's character held to this session's creation limits (CharacterRules), as the config to spawn:
   * - a class a player can't take becomes the first one they can; the level comes into the session's range;
   * - abilities come within the base, cap and pool (highest first);
   * - feats, powers or skills that don't fit go back to the class's recommended ones;
   * - with player bodies only, another model becomes the class preset's;
   * - with gear off, the class preset's gear replaces the character's.
   * changes says what was adjusted, for the GM.
   */
  static admitCharacter(character: GMCharacter): { config: GMPlayerSpawnConfig, changes: string[] } {
    const limits = this.creationLimits;
    const changes: string[] = [];
    const c: GMCharacter = { ...character, attributes: { ...character.attributes } };

    const classes = CharacterRules.classes();
    if (classes.length && !classes.some((k) => k.id === c.classId)) {
      c.classId = classes[0].id;
      changes.push(`Its class isn't one a player can take; it's now ${classes[0].name}.`);
    }
    const [minLevel, maxLevel] = CharacterRules.levelRange(limits);
    const level = Math.max(minLevel, Math.min(maxLevel, Math.round(c.level || 1)));
    if (level !== c.level) {
      changes.push(`Level ${c.level} is now ${level}.`);
      c.level = level;
    }
    const attributes = CharacterRules.clampAbilities(c.attributes, limits);
    if (ABILITIES.some((k) => attributes[k] !== c.attributes[k])) {
      changes.push('Its abilities were brought within the points.');
      c.attributes = attributes;
    }

    const preset = GMManager.PLAYER_PRESETS.find((p) => p.classId === c.classId) || GMManager.PLAYER_PRESETS[0];
    const config = GMCharacters.toSpawnConfig(c);
    const choices = { classId: c.classId, level: c.level, attributes: c.attributes };
    if (c.feats && CharacterRules.validate({ ...choices, feats: c.feats }, limits).length) {
      config.featIds = undefined;
      changes.push('Its feats went back to the recommended ones.');
    }
    if (c.powers && CharacterRules.validate({ ...choices, powers: c.powers }, limits).length) {
      config.spellIds = undefined;
      changes.push('Its Force powers went back to the recommended ones.');
    }
    if (c.skillRanks && CharacterRules.validate({ ...choices, skillRanks: c.skillRanks }, limits).length) {
      config.skillRanks = undefined;
      changes.push('Its skills went back to the recommended ones.');
    }
    if (limits.anyModel === false && !CharacterRules.playerAppearances().has(config.appearanceId)) {
      config.appearanceId = preset.appearanceId;
      changes.push('This session only allows the player bodies, so it took its class\'s.');
    }
    if (limits.gear === false && (config.rightHandResRef || config.leftHandResRef || config.armorResRef)) {
      config.rightHandResRef = preset.rightHandResRef;
      config.leftHandResRef = preset.leftHandResRef;
      config.armorResRef = preset.armorResRef;
      changes.push('This session chooses gear, so it has its class\'s.');
    }
    return { config, changes };
  }

  static async spawnPlayerFromNetworkPreset(peerId: string, playerName: string, preset: GMPlayerJoinPreset): Promise<string | null> {
    // A player rejoining a loaded session gets the character saved under their name
    const reserved = GMSessions.reservedPlayers.get(String(playerName || '').trim().toLowerCase());
    if (reserved) {
      GMSessions.reservedPlayers.delete(reserved.name.trim().toLowerCase());
      const pc = await GMSessions.spawnSavedPlayer(reserved, peerId);
      if (pc) GMNetworkManager.appendChat('System', `${reserved.name} picked up their saved character.`);
      return pc ? (pc.gmNetId || null) : null;
    }
    if (GMManager.ruleset === 'careers' && preset?.careersCharacter && GMCareersCharacters.isCareersCharacter(preset.careersCharacter)) {
      const config = GMCareersCharacters.toSpawnConfig({
        ...preset.careersCharacter,
        name: preset.name || preset.careersCharacter.name || playerName || 'Connected Player',
      });
      const pc = await GMSpawner.spawnPlayerCharacter(
        { ...config, possessImmediately: false, ownerPeerId: peerId },
        GMManager.sceneStartPoint ? GMManager.sceneStartPoint.clone() : undefined
      );
      return pc ? (pc.gmNetId || null) : null;
    }
    if (preset?.character && GMCharacters.isCharacter(preset.character)) {
      const { config, changes } = this.admitCharacter(preset.character);
      if (changes.length) GMNetworkManager.appendChat('System', `${config.name}'s character was adjusted to this session's rules: ${changes.join(' ')}`);
      const pc = await GMSpawner.spawnPlayerCharacter(
        { ...config, possessImmediately: false, ownerPeerId: peerId },
        GMManager.sceneStartPoint ? GMManager.sceneStartPoint.clone() : undefined
      );
      return pc ? (pc.gmNetId || null) : null;
    }
    const basePreset = GMManager.PLAYER_PRESETS.find(p => p.classId === preset?.classId) || GMManager.PLAYER_PRESETS[0];
    const spawned = await GMSpawner.spawnPlayerCharacter(
      {
        ...basePreset,
        name: preset?.name || playerName || 'Connected Player',
        appearanceId: preset?.appearanceId ?? basePreset.appearanceId,
        classId: preset?.classId ?? basePreset.classId,
        rightHandResRef: preset?.rightHandResRef ?? basePreset.rightHandResRef,
        armorResRef: preset?.armorResRef ?? basePreset.armorResRef,
        possessImmediately: false,
        ownerPeerId: peerId
      },
      GMManager.sceneStartPoint ? GMManager.sceneStartPoint.clone() : undefined
    );
    return spawned ? (spawned.gmNetId || null) : null;
  }
}

// Players' requests (host) and what the host sends each player about their character (client)
GMNetworkManager.on('peer.join', 'host', (packet) => GMPlayers.onPeerJoin(packet.senderId, packet.payload));
GMNetworkManager.on('client.intent', 'host', (packet) => {
  if (packet.payload) GMPlayers.applyClientIntentOnHost(packet.senderId, packet.payload);
});
GMNetworkManager.on('player.respawn', 'host', (packet) => GMPlayers.onRespawnRequest(packet.senderId));
GMNetworkManager.on('dm.reply', 'host', (packet) => {
  if (packet.payload) GMPlayers.onDmReply(packet.senderId, packet.payload);
});
GMNetworkManager.on('container.open', 'client', async (packet) => {
  if (!packet.payload) return;
  GMLog.info('net', `The host opened ${packet.payload.containerNetId} for us (${(packet.payload.items || []).length} items)`);
  await GMPlayers.openNetworkContainer(packet.payload.containerNetId, packet.payload.items || []);
}, 'to-me');
GMNetworkManager.on('player.sheet', 'client', async (packet) => {
  if (!packet.payload) return;
  await GMPlayers.applyPlayerSheetOnClient(packet.payload);
  // An open character screen shows it (a level-up the host just did, new XP...)
  const characterMenu = GameState.MenuManager?.MenuCharacter;
  if (characterMenu?.bVisible) characterMenu.updateCharacterStats(GameState.getCurrentPlayer());
}, 'to-me');
GMNetworkManager.on('container.loot', 'client', async (packet) => {
  if (packet.payload) await GMPlayers.receiveNetworkLoot(packet.payload.items || []);
}, 'to-me');

// A notice from the host about something this player asked for: their HUD shows it (and it goes in their chat)
GMNetworkManager.on('player.notice', 'client', (packet) => {
  const text = packet.payload?.text;
  if (!text) return;
  GMNetworkManager.appendChat('System', text);
  GMPlayerHud.notice(text);
}, 'to-me-or-all');


// Broadcast to all connected players when the GM awards Light Side or Dark Side points
GMNetworkManager.on('alignment.shift', 'client', (packet) => {
  const payload = packet.payload;
  if (!payload) return;
  GMNetworkManager.appendChat('GM', payload.text);
  GMPlayers.notifyAlignmentShift(payload);
  const characterMenu = GameState.MenuManager?.MenuCharacter;
  if (characterMenu?.bVisible) characterMenu.updateCharacterStats?.(GameState.getCurrentPlayer());
});

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
} from "@/managers/GMNetworkManager";
import { GMManager } from "@/managers/GMManager";
import { GMSpawner } from "@/managers/gm/GMSpawner";
import { GMReplication } from "@/managers/gm/GMReplication";
import { GMMines } from "@/managers/gm/GMMines";
import { GMSessions } from "@/managers/gm/GMSessions";

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
    GMNetworkManager.sendPacket({
      type: 'container.open',
      senderId: GMNetworkManager.peerId,
      targetPeerId: peerId,
      timestamp: Date.now(),
      payload: { containerNetId, items: this.toLootItems((container as any).inventory) }
    });
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
    GMNetworkManager.sendPacket({
      type: 'container.loot',
      senderId: GMNetworkManager.peerId,
      targetPeerId: peerId,
      timestamp: Date.now(),
      payload: { containerNetId, items: this.toLootItems(taken) }
    });
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

  /** Host: award XP to one connected player; it reaches them with their next character sheet */
  static giveXP(peerId: string, amount: number): boolean {
    const actor = this.getPeerActor(peerId);
    const xp = Math.round(Number(amount));
    if (!actor || !(xp > 0)) return false;
    actor.experience = (actor.experience || 0) + xp;
    GMNetworkManager.sendChatTo(peerId, 'GM', `You gained ${xp} XP.`);
    GMManager.notifyChange();
    return true;
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

  static buildPlayerSheet(cre: ModuleCreature): GMPlayerSheet {
    const equipment: Record<string, string> = {};
    for (const slot of this.PLAYER_EQUIP_SLOTS) {
      const item: ModuleItem | undefined = (cre.equipment as any)[slot];
      const resRef = gmItemResRef(item);
      if (resRef) equipment[slot] = resRef;
    }
    return {
      netId: cre.gmNetId,
      classes: (cre.classes || []).map((c) => ({ id: c.id, level: c.level, spells: (c.spells || []).map((s) => s.id) })),
      attributes: { str: cre.str, dex: cre.dex, con: cre.con, int: cre.int, wis: cre.wis, cha: cre.cha },
      feats: (cre.feats || []).map((f) => f.id),
      skills: (cre.skills || []).map((s) => s?.rank ?? 0),
      hp: cre.getHP(),
      maxHp: cre.getMaxHP(),
      forcePoints: cre.forcePoints || 0,
      maxForcePoints: cre.maxForcePoints || 0,
      currentForce: cre.currentForce || 0,
      xp: cre.experience || 0,
      equipment,
      inventory: this.getPlayerInventory(cre).map((e) => ({ ...e })),
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
      GMNetworkManager.sendPacket({
        type: 'player.sheet',
        senderId: GMNetworkManager.peerId,
        targetPeerId: peer.peerId,
        timestamp: Date.now(),
        payload: sheet
      });
    }
  }

  /** Host: put an item from the player's inventory into an equipment slot */
  static async equipOnHost(actor: ModuleCreature, slot: number, resRef: string) {
    const slotName = ModuleCreatureArmorSlot[slot];
    if (!slotName || !this.PLAYER_EQUIP_SLOTS.includes(slotName) || !resRef) return;
    if (!this.getPlayerInventory(actor).some((e) => e.resRef === resRef)) return;
    const wanted = await GMSpawner.createItemFromResRefAsync(resRef);
    if (wanted && actor.canUseItem?.(wanted) === false) {
      GMNetworkManager.appendChat('System', `${actor.getName()} can't use that: it needs a feat they don't have.`);
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
    cre.classes = sheet.classes.map((c) => {
      const cls = new CreatureClass(c.id);
      cls.setLevel(c.level);
      for (const spellId of c.spells) cls.addSpell(new TalentSpell(spellId));
      return cls;
    });
    const featRows = GameState.TwoDAManager.datatables.get('feat')?.rows || {};
    cre.feats = sheet.feats.map((id) => TalentFeat.From2DA({ __index: id, ...(featRows[id] || {}) }));
    sheet.skills.forEach((rank, i) => cre.skills?.[i]?.setRank(rank));
    cre.experience = sheet.xp;
    cre.forcePoints = sheet.forcePoints;
    cre.maxForcePoints = sheet.maxForcePoints;
    cre.currentForce = sheet.currentForce;
    GMManager.setCreatureHP(cre, sheet.hp, sheet.maxHp);
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
   * Execute a client's interaction request on the host using the engine's normal actions,
   * so pathing into range, door/placeable use, and combat resolve exactly as in single player.
   */
  static applyClientIntentOnHost(peerId: string, intent: GMClientIntent) {
    if (!intent) return;
    const actor = GMReplication.getOwnedActor(peerId, intent.netId);
    if (!actor) return;
    actor.gmIntentSeq = intent.seq;
    // A watching player can't act (a late request from before the freeze is dropped too)
    if (GMManager.playersFrozen && intent.kind !== 'cancel') return;

    // Taking items and changing equipment don't interrupt anything the actor is doing
    if (intent.kind === 'loot') {
      this.grantLootOnHost(peerId, actor, intent.targetNetId);
      return;
    }
    if (intent.kind === 'equip') {
      this.equipOnHost(actor, intent.slot, intent.resRef).catch((e) => console.warn('[GMManager] equip failed', e));
      return;
    }
    if (intent.kind === 'unequip') {
      this.unequipOnHost(actor, intent.slot);
      return;
    }

    if (intent.kind === 'stealth') {
      (actor as ModuleCreature).setStealthMode(!(actor as ModuleCreature).stealthMode);
      return;
    }

    actor.clearAllActions();
    if (intent.kind === 'cancel') {
      actor.gmHostDriven = false;
      return;
    }
    if (intent.kind === 'mine') {
      actor.gmNetTarget = undefined;
      GMMines.useMineOnHost(actor as ModuleCreature, intent).then((ok) => {
        actor.gmHostDriven = ok;
        if (!ok) GMNetworkManager.appendChat('System', `${actor.getName()} can't do that right now.`);
      }).catch((e) => console.warn('[GMManager] mine failed', e));
      return;
    }
    if (intent.kind === 'ability') {
      actor.gmNetTarget = undefined;
      this.useAbilityOnHost(actor as ModuleCreature, intent).then((ok) => {
        actor.gmHostDriven = ok;
        if (!ok) GMNetworkManager.appendChat('System', `${actor.getName()} can't use that right now.`);
      }).catch((e) => console.warn('[GMManager] ability failed', e));
      return;
    }

    const target = intent.targetNetId ? GMManager.netIdMap.get(intent.targetNetId) : null;
    if (!target || target === actor) {
      actor.gmHostDriven = false;
      return;
    }

    // The host now owns this actor's position; drop any half-applied client movement
    actor.gmNetTarget = undefined;
    if (intent.kind === 'open' && GMObjectKind.isDoor(target)) {
      actor.actionOpenDoor(target);
    } else if (intent.kind === 'attack' && GMObjectKind.isCreature(target)) {
      actor.attackCreature(target, undefined);
    } else if (intent.kind === 'use') {
      actor.actionUseObject(target);
    } else {
      actor.gmHostDriven = false;
      return;
    }
    actor.gmHostDriven = true;
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
    const id = Number(intent.abilityId);

    switch (intent.ability) {
      case 'spell': {
        const spell = actor.getSpells().find((s: any) => s.id === id);
        if (!spell) return false;
        spell.useTalentOnObject(target, actor);
        return true;
      }
      case 'feat': {
        const feat = actor.getFeats().find((f: any) => f.id === id);
        if (!feat) return false;
        feat.useTalentOnObject(target, actor);
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
      if (BitWise.InstanceOf(talent.objectType, TalentObjectType.TalentSpell)) return send('spell', talent.id);
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
    if (!pc || pc.gmNetId !== GMNetworkManager.assignedActorNetId) return false;
    if (GMManager.isPlayerFrozen(pc)) return true;
    const targetNetId = target.gmNetId as string | undefined;
    if (!targetNetId) return false;

    if (GMObjectKind.isDoor(target)) {
      GMNetworkManager.sendIntent('open', targetNetId);
      return true;
    }
    if (GMObjectKind.isPlaceable(target)) {
      GMNetworkManager.sendIntent('use', targetNetId);
      return true;
    }
    if (GMObjectKind.isCreature(target)) {
      const cre = target as ModuleCreature;
      if (cre.isHostile(pc) && !cre.isDead()) {
        GMNetworkManager.sendIntent('attack', targetNetId);
        return true;
      }
      if (cre.isDead()) {
        GMNetworkManager.sendIntent('use', targetNetId);
        return true;
      }
    }
    // Anyone else: walk over and talk; the GM speaks for them
    if (GameState.GMConversationManager?.requestTalk(target)) return true;
    return false;
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

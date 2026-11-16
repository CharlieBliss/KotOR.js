import { GMObjectKind } from "@/managers/gm/GMObjectKind";
import * as THREE from "three";
import { GameState } from "@/GameState";
import { ModuleDoorOpenState } from "@/enums/module/ModuleDoorOpenState";
import { ModuleObject, ModuleCreature, ModulePlayer, ModuleDoor } from "@/module";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import type {
  GMCreatureSpawnConfig,
  GMPlaceableSpawnConfig,
  GMSceneBlueprintItem,
  GMSceneBlueprintCreature,
  GMSceneBlueprint,
  GMPlayerSpawnConfig,
  GMSavedObject, GMSavedGroup,
  GMSavedPlayer,
  GMSessionSave,
} from "@/managers/gm/GMTypes";
import { GMManager } from "@/managers/GMManager";
import { GMSpawner } from "@/managers/gm/GMSpawner";
import { GMPlayers } from "@/managers/gm/GMPlayers";
import { GMEditTools } from "@/managers/gm/GMEditTools";

/** Saving GM work in this browser: whole sessions to pick back up later, and kits (saved layouts) to place again. */
export class GMSessions {
  static CUSTOM_BLUEPRINTS_STORAGE_KEY: string = 'kotor_gm_saved_scenes_v1';

  // Host: characters from a loaded session waiting for their player to (re)join, by lower-case player name
  static reservedPlayers: Map<string, GMSavedPlayer> = new Map();

  static SESSIONS_STORAGE_KEY: string = 'kotor_gm_sessions_v1';

  static MAX_SAVED_SESSIONS: number = 20;

  /**
   * Save all GM-placed placeables and creatures in the current scene as a reusable Custom Scene Blueprint
   */
  static saveCurrentSceneAsBlueprint(title: string, description: string = 'Custom GM Scene Layout'): GMSceneBlueprint | null {
    const mod = GameState.module;
    if (!mod || !mod.area || !title.trim()) return null;

    const originX = mod.entryX || 0;
    const originY = mod.entryY || 0;
    const originZ = mod.entryZ || 0;

    // Where each object stands, relative to the area's entry point
    const offset = (obj: ModuleObject) => ({
      dx: Number((obj.position.x - originX).toFixed(2)),
      dy: Number((obj.position.y - originY).toFixed(2)),
      dz: Number((obj.position.z - originZ).toFixed(2)),
      yawDeg: Math.round((GMSpawner.facingOf(obj) * 180) / Math.PI),
    });

    // Every placeable left in the scene, and every NPC (not the players' characters)
    const items: GMSceneBlueprintItem[] = mod.area.placeables
      .filter(Boolean)
      .map((plc) => ({ ...offset(plc), config: GMSpawner.describePlaceable(plc) }));
    const creatures: GMSceneBlueprintCreature[] = mod.area.creatures
      .filter((cre) => cre && !GameState.PartyManager.party.includes(cre) && !GMManager.isPlayerCharacter(cre))
      .map((cre) => ({ ...offset(cre), config: GMSpawner.describeCreature(cre) }));

    const customBp: GMSceneBlueprint = {
      id: `custom_${Date.now()}`,
      title: title.trim(),
      category: 'Custom Saved',
      description: `${description} (${items.length} props, ${creatures.length} NPCs in ${mod.filename})`,
      recommendedModule: mod.filename || 'danm14aa',
      items,
      creatures,
      isCustom: true
    };

    try {
      const existing = this.getSavedCustomBlueprints();
      existing.unshift(customBp);
      localStorage.setItem(this.CUSTOM_BLUEPRINTS_STORAGE_KEY, JSON.stringify(existing));
    } catch (e) {
      console.warn('[GMManager] Could not persist custom blueprint to localStorage:', e);
    }

    GMManager.notifyChange();
    return customBp;
  }

  static getSavedCustomBlueprints(): GMSceneBlueprint[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(this.CUSTOM_BLUEPRINTS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  static deleteCustomBlueprint(id: string) {
    try {
      const list = this.getSavedCustomBlueprints().filter(b => b.id !== id);
      localStorage.setItem(this.CUSTOM_BLUEPRINTS_STORAGE_KEY, JSON.stringify(list));
      GMManager.notifyChange();
    } catch (e) {
      // ignore
    }
  }

  static importCustomBlueprintFromJSON(jsonStr: string): GMSceneBlueprint | null {
    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed || !parsed.title || !Array.isArray(parsed.items)) return null;
      const bp: GMSceneBlueprint = {
        ...parsed,
        id: parsed.id || `custom_${Date.now()}`,
        isCustom: true
      };
      const list = this.getSavedCustomBlueprints().filter(b => b.id !== bp.id);
      list.unshift(bp);
      localStorage.setItem(this.CUSTOM_BLUEPRINTS_STORAGE_KEY, JSON.stringify(list));
      GMManager.notifyChange();
      return bp;
    } catch (e) {
      return null;
    }
  }

  /** Snapshot the running session: scene, GM-placed objects, doors and every player character */
  static buildSessionSave(name: string): GMSessionSave | null {
    const mod = GameState.module;
    const area = mod?.area;
    if (!mod || !area) return null;
    const objects: GMSavedObject[] = [];
    const players: GMSavedPlayer[] = [];
    const seen = new Set<ModuleObject>();
    // Where each placed object is in the save, for the groups
    const savedIndex = new Map<ModuleObject, number>();

    for (const obj of [...area.creatures, ...GameState.PartyManager.party, ...GMManager.spawnedPlayers]) {
      if (!obj || seen.has(obj) || obj.destroyed) continue;
      seen.add(obj);
      const cre = obj as ModuleCreature;
      const playerConfig: GMPlayerSpawnConfig | undefined = cre.gmPlayerConfig;
      if (playerConfig) {
        players.push({
          name: playerConfig.name || cre.getName() || 'Player',
          local: !cre.gmOwnerPeerId,
          config: { ...playerConfig, ownerPeerId: undefined, possessImmediately: false },
          sheet: GMPlayers.buildPlayerSheet(cre),
          x: cre.position.x, y: cre.position.y, z: cre.position.z,
          facing: cre.getFacing(),
          hidden: !!cre.gmHidden,
        });
        continue;
      }
      if (!cre.gmSpawnConfig) continue; // part of the module itself; reloaded with the scene
      savedIndex.set(cre, objects.length);
      objects.push({
        kind: 'creature',
        config: { ...GMSpawner.describeCreature(cre), lootResRefs: undefined },
        x: cre.position.x, y: cre.position.y, z: cre.position.z,
        facing: cre.getFacing(),
        factionId: cre.factionId,
        hp: cre.getHP(),
        maxHp: cre.getMaxHP(),
        hidden: !!cre.gmHidden,
        loot: GMPlayers.toLootItems(cre.inventory).map((e) => e.resRef),
        barkText: cre.gmBarkText || '',
        stance: cre.heldStance || undefined,
        combatStyle: cre.gmCombatStyle && cre.gmCombatStyle !== 'all' ? cre.gmCombatStyle : undefined,
        pinned: cre.gmPinned || undefined,
      });
    }

    for (const plc of area.placeables) {
      if (!plc || !plc.gmSpawnConfig || plc.destroyed) continue;
      savedIndex.set(plc, objects.length);
      objects.push({
        kind: 'placeable',
        config: { ...GMSpawner.describePlaceable(plc), lootResRefs: [] },
        x: plc.position.x, y: plc.position.y, z: plc.position.z,
        facing: plc.bearing || 0,
        locked: plc.isLocked(),
        hidden: !!plc.gmHidden,
        loot: GMPlayers.toLootItems(plc.inventory).map((e) => e.resRef),
        barkText: plc.gmBarkText || '',
        pinned: plc.gmPinned || undefined,
      });
    }

    const pinnedNetIds = [...area.creatures, ...area.placeables]
      .filter((o) => o && !o.destroyed && o.gmPinned && !o.gmSpawnConfig && o.gmNetId)
      .map((o) => o.gmNetId as string);
    const groups: GMSavedGroup[] = [];
    for (const [n] of GMEditTools.groups) {
      const members = GMEditTools.groupMembers(n);
      const group: GMSavedGroup = { n, objects: [], netIds: [] };
      for (const m of members) {
        if (savedIndex.has(m)) group.objects.push(savedIndex.get(m)!);
        else if (m.gmNetId) group.netIds.push(m.gmNetId);
      }
      if (group.objects.length || group.netIds.length) groups.push(group);
    }

    const doors = area.doors
      .filter((d) => d.gmNetId)
      .map((d) => ({ netId: d.gmNetId, openState: d.openState, locked: !!d.isLocked() }));

    return {
      version: 1,
      id: `session_${Date.now()}`,
      name: String(name || '').trim() || `${mod.filename} session`,
      savedAt: Date.now(),
      scene: {
        module: String(mod.filename).toLowerCase(),
        keepCreatures: GMManager.keepDefaultCreatures,
        keepTriggers: GMManager.keepDefaultTriggers,
        keepPlaceables: GMManager.keepDefaultPlaceables,
      },
      objects,
      doors,
      players,
      rules: GMManager.sessionRules(),
      pinnedNetIds: pinnedNetIds.length ? pinnedNetIds : undefined,
      groups: groups.length ? groups : undefined,
    };
  }

  static getSavedSessions(): GMSessionSave[] {
    try {
      const raw = localStorage.getItem(this.SESSIONS_STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((s) => s && s.version === 1 && s.scene?.module) : [];
    } catch (e) {
      return [];
    }
  }

  static writeSavedSessions(list: GMSessionSave[]) {
    try {
      localStorage.setItem(this.SESSIONS_STORAGE_KEY, JSON.stringify(list.slice(0, this.MAX_SAVED_SESSIONS)));
    } catch (e) {
      console.warn('[GMManager] Could not store GM sessions', e);
    }
    GMManager.notifyChange();
  }

  /** Save the running session to this browser's GM session list */
  static saveSession(name: string): GMSessionSave | null {
    const save = this.buildSessionSave(name);
    if (!save) return null;
    this.writeSavedSessions([save, ...this.getSavedSessions()]);
    GMNetworkManager.appendChat('System', `Saved session "${save.name}".`);
    return save;
  }

  static deleteSavedSession(id: string) {
    this.writeSavedSessions(this.getSavedSessions().filter((s) => s.id !== id));
  }

  /** Add a session exported as JSON to the saved list; returns it, or null when it isn't a GM session */
  static importSessionJSON(json: string): GMSessionSave | null {
    try {
      const save = JSON.parse(json) as GMSessionSave;
      if (!save || save.version !== 1 || !save.scene?.module || !Array.isArray(save.objects) || !Array.isArray(save.players)) return null;
      const imported = { ...save, id: `session_${Date.now()}` };
      this.writeSavedSessions([imported, ...this.getSavedSessions()]);
      return imported;
    } catch (e) {
      return null;
    }
  }

  /** Spawn a saved player character; owned by peerId when a connected player takes it */
  static async spawnSavedPlayer(saved: GMSavedPlayer, ownerPeerId?: string): Promise<ModulePlayer | null> {
    const pc = await GMSpawner.spawnPlayerCharacter(
      { ...saved.config, name: saved.name, ownerPeerId, possessImmediately: false },
      new THREE.Vector3(saved.x, saved.y, saved.z),
      saved.facing
    );
    if (!pc) return null;
    await GMPlayers.applySheetToCharacter(pc, saved.sheet);
    if (ownerPeerId) pc.gmInventory = saved.sheet.inventory.map((e) => ({ ...e }));
    if (saved.hidden) GMManager.setObjectHidden(pc, true);
    return pc;
  }

  /**
   * Load a saved session: its scene, placed objects, doors and characters. Connected players are given
   * their saved character by name now; the rest get theirs when they (re)join under the same name.
   */
  static async loadSession(save: GMSessionSave): Promise<boolean> {
    if (!save?.scene?.module) return false;
    if (save.rules?.deathRule) GMPlayers.setDeathRule(save.rules.deathRule);
    const networkPlayers = save.players.filter((p) => !p.local);
    this.reservedPlayers = new Map(networkPlayers.map((p) => [p.name.trim().toLowerCase(), p]));

    await GMManager.loadScene(save.scene.module, {
      keepCreatures: save.scene.keepCreatures,
      keepTriggers: save.scene.keepTriggers,
      keepPlaceables: save.scene.keepPlaceables,
      preserveParty: false,
    });
    if (!await GMManager.waitForScene(save.scene.module)) return false;

    // Connected players' characters are carried into the new scene; wait for them before restoring
    const connected = [...GMNetworkManager.peers.values()];
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && connected.some((p) => p.controlledNetId && !GMManager.netIdMap.has(p.controlledNetId))) {
      await new Promise((r) => setTimeout(r, 250));
    }

    for (const door of save.doors || []) {
      const obj = GMManager.netIdMap.get(door.netId) as ModuleDoor;
      if (!obj || !GMObjectKind.isDoor(obj)) continue;
      obj.setLocked(door.locked);
      const shouldBeOpen = door.openState === ModuleDoorOpenState.OPEN1 || door.openState === ModuleDoorOpenState.OPEN2;
      if (shouldBeOpen && !obj.isOpen()) obj.openDoor(obj);
      else if (!shouldBeOpen && obj.isOpen()) obj.closeDoor(obj);
    }

    const spawned: (ModuleObject | null)[] = [];
    for (const saved of save.objects || []) {
      const pos = new THREE.Vector3(saved.x, saved.y, saved.z);
      let obj: ModuleObject | null = null;
      if (saved.kind === 'creature') {
        const cfg = saved.config as GMCreatureSpawnConfig;
        const cre = await GMSpawner.spawnCreature(
          { ...cfg, factionId: saved.factionId ?? cfg.factionId, hp: saved.maxHp ?? cfg.hp, barkText: saved.barkText, stance: saved.stance, lootResRefs: saved.loot },
          pos,
          saved.facing
        );
        if (cre && typeof saved.hp === 'number') GMManager.setCreatureHP(cre, saved.hp, saved.maxHp);
        if (cre && saved.combatStyle) cre.gmCombatStyle = saved.combatStyle;
        obj = cre;
      } else {
        const cfg = saved.config as GMPlaceableSpawnConfig;
        obj = await GMSpawner.spawnPlaceable(
          { ...cfg, locked: !!saved.locked, barkText: saved.barkText, lootResRefs: saved.loot, hasInventory: cfg.hasInventory || saved.loot.length > 0 },
          pos,
          saved.facing
        );
      }
      if (obj && saved.hidden) GMManager.setObjectHidden(obj, true);
      if (obj && saved.pinned) obj.gmPinned = true;
      spawned.push(obj);
    }

    for (const netId of save.pinnedNetIds || []) {
      const obj = GMManager.netIdMap.get(netId);
      if (obj) obj.gmPinned = true;
    }
    GMEditTools.groups.clear();
    for (const g of save.groups || []) {
      const members = [
        ...g.objects.map((i) => spawned[i]),
        ...g.netIds.map((id) => GMManager.netIdMap.get(id) || null),
      ].filter((o): o is ModuleObject => !!o);
      if (members.length) GMEditTools.groups.set(g.n, members);
    }

    for (const saved of save.players.filter((p) => p.local)) {
      await this.spawnSavedPlayer(saved);
    }

    // Players already here take over their saved character now
    for (const peer of connected) {
      const reserved = this.reservedPlayers.get(String(peer.name || '').trim().toLowerCase());
      const actor = GMPlayers.getPeerActor(peer.peerId);
      if (!reserved || !actor) continue;
      this.reservedPlayers.delete(reserved.name.trim().toLowerCase());
      await GMPlayers.applySheetToCharacter(actor, reserved.sheet);
      actor.gmInventory = reserved.sheet.inventory.map((e) => ({ ...e }));
      GMManager.teleportObject(actor, new THREE.Vector3(reserved.x, reserved.y, reserved.z));
      actor.setFacing(reserved.facing, true);
      if (reserved.hidden) GMManager.setObjectHidden(actor, true);
    }

    GMNetworkManager.appendChat('System', `Loaded session "${save.name}".${this.reservedPlayers.size ? ` Waiting for: ${[...this.reservedPlayers.values()].map((p) => p.name).join(', ')}.` : ''}`);
    GMManager.notifyChange();
    return true;
  }
}

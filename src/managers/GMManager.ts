import { GMFaction } from "@/managers/gm/GMVocab";
import { GMTemplates } from "@/managers/gm/GMTemplates";
import { GMObjectKind } from "@/managers/gm/GMObjectKind";
import * as THREE from "three";
import { GameState } from "@/GameState";
import { EngineMode } from "@/enums/engine/EngineMode";
import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import { CacheScope } from "@/enums/resource/CacheScope";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { ResourceLoader } from "@/loaders";
import { FollowerCamera } from "@/engine/FollowerCamera";
import { GMNpcOrders } from "@/managers/GMNpcOrders";
import type { GMNpcOrder, GMPoint } from "@/managers/GMNpcOrders";
import { ModuleObject, ModuleCreature, ModulePlaceable, ModuleDoor } from "@/module";
import { OdysseyModelAnimation } from "@/odyssey";
import { TextSprite3D } from "@/engine/TextSprite3D";
import { GameEngineType } from "@/enums/engine/GameEngineType";
import { OtherGameManager } from "@/managers/OtherGameManager";
import { Utility } from "@/utility/Utility";
import { GameFileSystem } from "@/utility/GameFileSystem";
import { GMEventEmitter, GMSessionRules, GMNetworkManager, GMPlayerSheet } from "@/managers/GMNetworkManager";
import type {
  GMControlMode,
  GMToolMode,
  GMModuleEntry,
  GMAnimationChoice,
  GMCreatureSpawnConfig,
  GMPlaceableSpawnConfig,
  GMSceneBlueprint,
  GMPlayerSpawnConfig,
} from "@/managers/gm/GMTypes";
import { CURATED_MODULES, CURATED_MODULES_TSL } from "@/managers/gm/data/modules";
import { CREATURE_PRESETS } from "@/managers/gm/data/creaturePresets";
import { PLACEABLE_PRESETS, CATEGORIZED_PROPS, PLACEABLE_KEYWORD_LABELS } from "@/managers/gm/data/placeablePresets";
import { SCENE_BLUEPRINTS } from "@/managers/gm/data/sceneBlueprints";
import { PLAYER_PRESETS } from "@/managers/gm/data/playerPresets";
import { WEAPON_OPTIONS, ARMOR_OPTIONS, LOOT_ITEM_OPTIONS } from "@/managers/gm/data/itemOptions";
import { STANCES, GESTURES } from "@/managers/gm/data/animations";
import { GMViewport } from "@/managers/gm/GMViewport";
import { GMSpawner } from "@/managers/gm/GMSpawner";
import { GMReplication } from "@/managers/gm/GMReplication";
import { GMPlayers } from "@/managers/gm/GMPlayers";
import { GMMines } from "@/managers/gm/GMMines";
import { GMChecks } from "@/managers/gm/GMChecks";

export * from "@/managers/gm/GMTypes";
export * from "@/managers/gm/GMObjectKind";
export * from "@/managers/gm/GMVocab";
export * from "@/managers/gm/GMTemplates";

export class GMManager {
  static events: GMEventEmitter = new GMEventEmitter();

  static active: boolean = false;

  static controlMode: GMControlMode = 'FREECAM';

  static activeTool: GMToolMode = 'select';

  // Scene loading flags
  static keepDefaultCreatures: boolean = false;

  static keepDefaultTriggers: boolean = false;

  static keepDefaultPlaceables: boolean = true;

  static preservePartyOnWarp: boolean = true;

  static worldPaused: boolean = false;

  // Currently selected object in the GM Inspector
  static selectedObject: ModuleObject | null = null;

  // Player characters loaded into the GM session
  static spawnedPlayers: ModuleCreature[] = [];

  // Map of network IDs -> ModuleObjects for NWN-style multiplayer sync
  static netIdMap: Map<string, ModuleObject> = new Map();

  static nextNetIdCounter: number = 1;

  // True from the start of a scene change until the new scene's objects are registered.
  // World ticks are neither sent nor applied meanwhile, so nothing from the old scene is
  // re-registered against objects that are about to be destroyed.
  static sceneLoading: boolean = false;

  /** How often (seconds) idle NPCs look for someone to fight */
  static NPC_AI_INTERVAL: number = 0.75;

  /** How far (metres) an NPC with no perception range of its own sees enemies */
  static NPC_AI_SIGHT_RANGE: number = 20;

  /** NPCs fight back against an attacker up to this far away (metres) even if they can't see them */
  static NPC_AI_RETALIATE_RANGE: number = 30;

  static npcAiTimer: number = 0;

  /** Players can only watch (a scene plan's cutscene): they can't move or act, and NPCs leave them alone */
  static playersFrozen: boolean = false;

  /** Where players joining this scene appear (a scene plan's start), instead of the camera target */
  static sceneStartPoint: THREE.Vector3 | null = null;

  static sessionRules(): GMSessionRules {
    return { deathRule: GMPlayers.deathRule, frozen: this.playersFrozen };
  }

  static setPlayersFrozen(on: boolean) {
    this.playersFrozen = !!on;
    if (on) {
      // Anyone fighting a player stops; players stop what they were doing
      for (const pc of this.getPlayerCharacters()) {
        pc.clearAllActions();
        pc.gmHostDriven = false;
      }
      for (const cre of GameState.module?.area?.creatures || []) {
        const target = (cre as ModuleCreature).combatData?.lastAttackTarget as ModuleObject | undefined;
        if (target && this.isPlayerCharacter(target)) (cre as ModuleCreature).combatRound?.clearActions?.();
      }
    }
    GMNetworkManager.broadcastSessionRules(this.sessionRules());
    this.notifyChange();
  }

  /** Whether a player's character is frozen right now (on the GM's machine, or the player's own) */
  static isPlayerFrozen(cre: ModuleObject): boolean {
    if (!GameState.gmMode || !cre) return false;
    if (GMNetworkManager.role === 'client') {
      return !!GMNetworkManager.sessionRules?.frozen && cre.gmNetId === GMNetworkManager.assignedActorNetId;
    }
    return this.playersFrozen && this.isPlayerCharacter(cre);
  }

  /** NPCs don't go after frozen players, or anything the GM has hidden (actors waiting for their cue) */
  static isUntargetable(cre: ModuleObject): boolean {
    return !!cre?.gmHidden || (this.playersFrozen && this.isPlayerCharacter(cre));
  }

  /** The GM can switch the NPC combat AI off (NPCs then only act when told to) */
  static npcAiEnabled: boolean = true;

  // Pending spawn configurations for 3D viewport click-to-place
  static pendingCreatureConfig: GMCreatureSpawnConfig = {
    name: 'Sith Trooper',
    templateResRef: 'g_sithtroop01',
    appearanceId: 28,
    appearanceLabel: 'Sith_Soldier_01',
    factionId: GMFaction.HOSTILE,
    hp: 25,
    level: 3,
    classId: 8,
    barkText: 'Halt! By order of the Sith!'
  };

  static pendingPlaceableConfig: GMPlaceableSpawnConfig = {
    name: 'Supply Footlocker',
    templateResRef: '',
    appearanceId: 39,
    appearanceLabel: 'Footlocker',
    useable: true,
    hasInventory: true,
    locked: false,
    openLockDC: 15,
    lootResRefs: ['g_i_medeqpmnt01', 'g_w_lghtsbr01', 'g_i_secspike01'],
    barkText: ''
  };

  static pendingPlayerConfig: GMPlayerSpawnConfig = {
    name: 'Jedi Knight',
    appearanceId: 136,
    portraitId: 15,
    gender: 0,
    classId: 3, // Jedi Guardian
    level: 8,
    str: 16,
    dex: 14,
    con: 14,
    int: 12,
    wis: 16,
    cha: 14,
    rightHandResRef: 'g_w_lghtsbr01',
    leftHandResRef: '',
    armorResRef: 'g_a_jedirobe01',
    possessImmediately: true
  };

  // Discovered module files from disk
  static discoveredModules: string[] = [];

  static CURATED_MODULES: GMModuleEntry[] = CURATED_MODULES;

  static CURATED_MODULES_TSL: GMModuleEntry[] = CURATED_MODULES_TSL;

  /** Whether a creature preset's template exists in the running game */
  static isPresetAvailable(preset: GMCreatureSpawnConfig): boolean {
    return !preset.onlyIn || preset.onlyIn === (GameState.GameKey === GameEngineType.TSL ? 'tsl' : 'kotor');
  }

  /** The curated scenes for a game (default: the one running) */
  static getCuratedModules(game?: 'kotor' | 'tsl'): GMModuleEntry[] {
    const which = game || (GameState.GameKey === GameEngineType.TSL ? 'tsl' : 'kotor');
    return which === 'tsl' ? this.CURATED_MODULES_TSL : this.CURATED_MODULES;
  }

  static CREATURE_PRESETS: GMCreatureSpawnConfig[] = CREATURE_PRESETS;

  static PLACEABLE_PRESETS: GMPlaceableSpawnConfig[] = PLACEABLE_PRESETS;

  static CATEGORIZED_PROPS: GMPlaceableSpawnConfig[] = CATEGORIZED_PROPS;

  static SCENE_BLUEPRINTS: GMSceneBlueprint[] = SCENE_BLUEPRINTS;

  static PLAYER_PRESETS: GMPlayerSpawnConfig[] = PLAYER_PRESETS;

  static WEAPON_OPTIONS: { resRef: string; label: string }[] = WEAPON_OPTIONS;

  static ARMOR_OPTIONS: { resRef: string; label: string }[] = ARMOR_OPTIONS;

  static LOOT_ITEM_OPTIONS: { resRef: string; label: string }[] = LOOT_ITEM_OPTIONS;

  static init() {
    GMNetworkManager.Init(GMManager);
    TextSprite3D.onCreateOnObject = (object, text, style, timer) => GMReplication.onHostTextSprite(object, text, style, timer);
    GMViewport.init3DIndicators();
    GMViewport.attachViewportListeners();
    this.scanAvailableModules();
  }

  static notifyChange() {
    this.events.dispatchEvent('change');
  }

  static PLACEABLE_KEYWORD_LABELS: Record<string, string> = PLACEABLE_KEYWORD_LABELS;

  /** Players joined to someone else's session don't get GM tools */
  static isGMUser(): boolean {
    return GMNetworkManager.role !== 'client';
  }

  /** The placement tool the toolbar's Place button turns on: the last one used */
  static lastPlacementTool: GMToolMode = 'place_creature';

  static setToolMode(tool: GMToolMode) {
    const previous = this.activeTool;
    if (GMViewport.isPlacementTool(tool)) this.lastPlacementTool = tool;
    if (previous === 'order_patrol' && tool !== 'order_patrol') GMViewport.finishPatrolOrder();
    if (GMViewport.isOrderTool(previous) && !GMViewport.isOrderTool(tool)) GMViewport.orderSubject = null;
    this.activeTool = tool;
    if (GMViewport.placementRing) {
      if (tool === 'select') {
        GMViewport.placementRing.visible = false;
      } else {
        const mat = GMViewport.placementRing.material as THREE.MeshBasicMaterial;
        if (tool === 'place_creature') mat.color.setHex(0xff5555);
        else if (tool === 'place_placeable') mat.color.setHex(0xffaa00);
        else if (tool === 'place_player') mat.color.setHex(0x00ff88);
        else if (tool === 'teleport') mat.color.setHex(0x00e5ff);
        else if (GMViewport.isOrderTool(tool)) mat.color.setHex(0xffd740);
      }
    }
    this.notifyChange();
  }

  static selectObject(obj: ModuleObject | null) {
    this.selectedObject = obj;
    this.notifyChange();
  }

  /** An open, quiet area to start GM mode in, for each game */
  static DEFAULT_SCENE: Record<'kotor' | 'tsl', string> = { kotor: 'danm14aa', tsl: '601dan' };

  static defaultSceneModule(): string {
    return this.DEFAULT_SCENE[GameState.GameKey === GameEngineType.TSL ? 'tsl' : 'kotor'];
  }

  /**
   * The module to load for a scene name: this game's own; the other game's, borrowed, when only it has one by
   * that name (the curated scenes and blueprints name KotOR areas, so KotOR II borrows them); or else this
   * game's default scene.
   */
  static async resolveSceneModule(moduleResRef: string): Promise<string> {
    const name = String(moduleResRef || '').toLowerCase();
    if (!name || OtherGameManager.isForeignModule(name)) return name;
    if (!this.discoveredModules.length) await this.scanAvailableModules();
    if (!this.discoveredModules.length || this.discoveredModules.includes(name)) return name;
    if ((await OtherGameManager.listModules()).includes(name)) return OtherGameManager.foreignModuleName(name);
    const fallback = this.defaultSceneModule();
    GMNetworkManager.appendChat('System', `There's no "${name}" area in this game; loading ${fallback} instead.`);
    return fallback;
  }

  static async scanAvailableModules(): Promise<string[]> {
    try {
      const files = await GameFileSystem.readdir('modules');
      const set = new Set<string>();
      for (const f of files) {
        const base = f.split(/[\\/]/).pop() || '';
        const lower = base.toLowerCase();
        if (lower.endsWith('_s.rim')) continue;
        if (lower.endsWith('.rim') || lower.endsWith('.mod')) {
          const name = lower.replace(/\.(rim|mod)$/i, '');
          if (name) set.add(name);
        }
      }
      this.discoveredModules = Array.from(set).sort();
      this.notifyChange();
    } catch (e) {
      // Fallback to curated modules if readdir fails
    }
    return this.discoveredModules;
  }

  static getAvailableUTCTemplates(): string[] {
    const set = new Set<string>();
    const scopes = [CacheScope.MODULE, CacheScope.GLOBAL, CacheScope.OVERRIDE];
    for (const scope of scopes) {
      const map = ResourceLoader.CacheScopes[scope]?.get(ResourceTypes.utc);
      if (map) {
        for (const k of map.keys()) set.add(k);
      }
    }
    return Array.from(set).sort();
  }

  static getAvailableUTPTemplates(): string[] {
    const set = new Set<string>();
    const scopes = [CacheScope.MODULE, CacheScope.GLOBAL, CacheScope.OVERRIDE];
    for (const scope of scopes) {
      const map = ResourceLoader.CacheScopes[scope]?.get(ResourceTypes.utp);
      if (map) {
        for (const k of map.keys()) set.add(k);
      }
    }
    return Array.from(set).sort();
  }

  static getAvailableAppearanceOptions(): { id: number; label: string }[] {
    const list: { id: number; label: string }[] = [];
    const map = GameState.AppearanceManager?.appearances;
    if (map) {
      map.forEach((app, id) => {
        if (app && app.label && app.label !== '****') {
          list.push({ id, label: `${id}: ${app.label}` });
        }
      });
    }
    return list;
  }

  static getAvailablePlaceableAppearances(): { id: number; label: string }[] {
    const list: { id: number; label: string }[] = [];
    const map = GameState.AppearanceManager?.placeableAppearances;
    if (map) {
      map.forEach((app, id) => {
        if (app && app.label && app.label !== '****') {
          list.push({ id, label: `${id}: ${app.label}` });
        }
      });
    }
    return list;
  }

  static getNextNetId(prefix: string = 'gm'): string {
    return `${prefix}_${Date.now().toString(36)}_${this.nextNetIdCounter++}`;
  }

  static registerNetObject(netId: string, obj: ModuleObject) {
    obj.gmNetId = netId;
    this.netIdMap.set(netId, obj);
  }

  /**
   * Load any module/scene in GM Mode
   */
  static async loadScene(
    moduleResRef: string,
    options?: {
      keepCreatures?: boolean;
      keepTriggers?: boolean;
      keepPlaceables?: boolean;
      preserveParty?: boolean;
    }
  ): Promise<string> {
    if (!moduleResRef) return '';
    GameState.gmMode = true;
    this.active = true;
    // The GM's machine decides which module that is (players load exactly what it sends)
    if (GMNetworkManager.role !== 'client') moduleResRef = await this.resolveSceneModule(moduleResRef);

    // Conversations are with NPCs in this scene
    if (GMNetworkManager.role === 'host') {
      GameState.GMConversationManager?.clear();
    } else {
      GameState.GMConversationManager?.reset();
    }

    if (typeof options?.keepCreatures === 'boolean') {
      this.keepDefaultCreatures = options.keepCreatures;
    }
    if (typeof options?.keepTriggers === 'boolean') {
      this.keepDefaultTriggers = options.keepTriggers;
    }
    if (typeof options?.keepPlaceables === 'boolean') {
      this.keepDefaultPlaceables = options.keepPlaceables;
    }
    if (typeof options?.preserveParty === 'boolean') {
      this.preservePartyOnWarp = options.preserveParty;
    }

    // Snapshot saved player templates if preserving party across warps
    const savedPlayerConfigs: GMPlayerSpawnConfig[] = [];
    const wasPossessing = this.controlMode === 'POSSESS';
    if (this.preservePartyOnWarp && this.spawnedPlayers.length > 0) {
      for (const p of this.spawnedPlayers) {
        if (p.gmPlayerConfig && !p.gmOwnerPeerId) {
          savedPlayerConfigs.push({ ...p.gmPlayerConfig, possessImmediately: false });
        }
      }
    }

    // Players connected to this session always come along, keeping the same character:
    // net id (so their game keeps controlling it), inventory, equipment and HP
    const savedNetworkPlayers: { netId: string; config: GMPlayerSpawnConfig; sheet: GMPlayerSheet }[] = [];
    if (GMNetworkManager.role === 'host') {
      for (const [netId, obj] of this.netIdMap.entries()) {
        if (!obj.gmOwnerPeerId || obj.destroyed || !obj.gmPlayerConfig) continue;
        savedNetworkPlayers.push({
          netId,
          config: { ...obj.gmPlayerConfig, ownerPeerId: obj.gmOwnerPeerId, possessImmediately: false },
          sheet: GMPlayers.buildPlayerSheet(obj as ModuleCreature),
        });
      }
    }

    this.sceneLoading = true;
    this.selectedObject = null;
    // A new scene starts unfrozen, with its own start point (a scene plan sets them again)
    this.sceneStartPoint = null;
    if (this.playersFrozen) this.setPlayersFrozen(false);
    this.spawnedPlayers = [];
    this.netIdMap.clear();

    if (GMNetworkManager.role === 'host') {
      GMNetworkManager.broadcastSceneLoad(
        moduleResRef,
        this.keepDefaultCreatures,
        this.keepDefaultTriggers,
        this.keepDefaultPlaceables
      );
    }

    GameState.LoadModule(moduleResRef);

    // Once the new scene is up, bring the preserved players back (not awaited: callers only start the load)
    if (savedPlayerConfigs.length > 0 || savedNetworkPlayers.length > 0) {
      this.waitForScene(moduleResRef, Infinity).then(async (ready) => {
        if (!ready) return;
        const entryAt = (slot: number) => new THREE.Vector3(
          (GameState.module.entryX || 0) + slot * 1.5, GameState.module.entryY || 0, GameState.module.entryZ || 0
        );
        for (let i = 0; i < savedNetworkPlayers.length; i++) {
          const saved = savedNetworkPlayers[i];
          const pc = await GMSpawner.spawnPlayerCharacter(saved.config, entryAt(savedPlayerConfigs.length + i), 0, saved.netId);
          if (!pc) continue;
          pc.gmInventory = saved.sheet.inventory.map((e) => ({ ...e }));
          await GMPlayers.syncEquipmentTo(pc, saved.sheet.equipment);
          this.setCreatureHP(pc, saved.sheet.hp, saved.sheet.maxHp);
        }
        for (let i = 0; i < savedPlayerConfigs.length; i++) {
          await GMSpawner.spawnPlayerCharacter({ ...savedPlayerConfigs[i], possessImmediately: wasPossessing && i === 0 }, entryAt(i), 0);
        }
        this.notifyChange();
      });
    }
    return moduleResRef;
  }

  /**
   * Called by GameState.LoadModule once the area & rooms are loaded in GM Mode
   */
  static onSceneLoaded() {
    this.active = true;
    this.sceneLoading = false;
    GMViewport.init3DIndicators();
    const mod = GameState.module;
    if (!mod || !mod.area) return;

    // Assign deterministic gmNetIds to existing area doors, placeables, and creatures
    mod.area.doors.forEach((d, idx) => {
      const netId = `door_${idx}_${d.getTag() || d.id}`;
      this.registerNetObject(netId, d);
    });
    mod.area.placeables.forEach((p, idx) => {
      if (!p.gmNetId) {
        this.registerNetObject(`plc_area_${idx}_${p.getTag() || p.id}`, p);
      }
    });
    mod.area.creatures.forEach((c, idx) => {
      if (!c.gmNetId) {
        this.registerNetObject(`cre_area_${idx}_${c.getTag() || c.id}`, c);
      }
    });

    // Show all rooms so GM free camera can see the entire area
    for (const room of mod.area.rooms) {
      room.show(true);
    }

    // Position the Free Camera at the module's entry spawn point
    const entryX = mod.entryX || 0;
    const entryY = mod.entryY || 0;
    const entryZ = mod.entryZ || 0;
    const dirX = mod.entryDirectionX || 0;
    const dirY = mod.entryDirectionY || 1;

    GameState.camera.position.set(entryX, entryY, entryZ + 2.2);
    const lookTarget = new THREE.Vector3(entryX + dirX * 10, entryY + dirY * 10, entryZ + 1.6);
    GameState.camera.up.set(0, 0, 1);
    GameState.camera.lookAt(lookTarget);
    GameState.camera.updateProjectionMatrix();
    GameState.camera.updateMatrixWorld();

    if (this.controlMode === 'FREECAM' || !GameState.PartyManager.party.length) {
      this.enterFreeCamera(false);
    }

    this.notifyChange();
  }

  /**
   * Possess a Player Character or Creature (switches to EngineMode.INGAME with full world interaction)
   */
  static possessCharacter(creature: ModuleCreature) {
    if (!creature || !GameState.module?.area) return;

    // Move creature into PartyManager.party[0] so GameState.getCurrentPlayer() returns it
    const area = GameState.module.area;
    const areaIdx = area.creatures.indexOf(creature);
    if (areaIdx >= 0) {
      area.creatures.splice(areaIdx, 1);
    }
    GameState.group.creatures.remove(creature.container);
    GameState.group.party.add(creature.container);

    const existingPartyIdx = GameState.PartyManager.party.indexOf(creature);
    if (existingPartyIdx > 0) {
      GameState.PartyManager.party.splice(existingPartyIdx, 1);
      GameState.PartyManager.party.unshift(creature);
    } else if (existingPartyIdx === -1) {
      GameState.PartyManager.party.unshift(creature);
    }

    GameState.PartyManager.Player = creature;
    creature.getCurrentRoom();

    // Align FollowerCamera behind the possessed character
    FollowerCamera.facing = Utility.NormalizeRadian(creature.getFacing() - Math.PI / 2);
    FollowerCamera.speed = 0;

    this.controlMode = 'POSSESS';
    this.activeTool = 'select';
    if (GMViewport.placementRing) GMViewport.placementRing.visible = false;

    GameState.SetEngineMode(EngineMode.INGAME);
    if (GameState.MenuManager?.InGameOverlay) {
      GameState.MenuManager.InGameOverlay.open();
    }

    this.selectedObject = creature;
    this.notifyChange();
  }

  /**
   * Return to GM Free Camera mode (EngineMode.FREELOOK)
   */
  static enterFreeCamera(repositionNearPlayer: boolean = true) {
    const currentLeader = GameState.getCurrentPlayer();
    if (repositionNearPlayer && currentLeader) {
      const angle = currentLeader.getFacing();
      GameState.camera.position.set(
        currentLeader.position.x + Math.sin(angle) * 3.5,
        currentLeader.position.y - Math.cos(angle) * 3.5,
        currentLeader.position.z + 2.4
      );
      GameState.camera.up.set(0, 0, 1);
      GameState.camera.lookAt(
        currentLeader.position.x,
        currentLeader.position.y,
        currentLeader.position.z + 1.2
      );
    }

    // Show all rooms when entering Free Camera mode
    if (GameState.module?.area) {
      for (const room of GameState.module.area.rooms) {
        room.show(true);
      }
    }

    this.controlMode = 'FREECAM';
    GameState.SetEngineMode(EngineMode.FREELOOK);
    this.notifyChange();
  }

  /**
   * Inspector Actions on Selected World Objects
   */
  static setObjectFaction(obj: ModuleObject, factionId: number) {
    if (!obj || !GMObjectKind.isCreature(obj)) return;
    const cre = obj as ModuleCreature;
    this.assignFaction(cre, factionId);
    cre.clearAllActions();
    cre.resetExcitedDuration();
    if (GMNetworkManager.role !== 'offline') {
      GMNetworkManager.broadcastActorUpdate(GMReplication.serializeSingleActor(cre));
    }
    this.notifyChange();
  }

  /**
   * Reliably sets HP & MaxHP on a ModuleCreature across both K1 subrace formulas and legacy fields
   */
  static setCreatureHP(cre: ModuleCreature, currentHp: number, maxHp?: number) {
    if (!cre) return;
    const max = typeof maxHp === 'number' && maxHp > 0 ? maxHp : (cre.getMaxHP() || 100);
    const cur = Math.max(0, Math.min(max, currentHp));
    cre.maxHitPoints = max;
    cre.hitPoints = max;
    if (cre.subraceIndex === 1 || cre.subraceIndex === 2) {
      cre.currentHitPoints = cur - max;
    } else {
      cre.currentHitPoints = cur;
    }
    cre.hp = max;
    cre.currentHP = cur;
  }

  /**
   * Moves a creature into a faction and keeps the FactionManager membership lists in sync
   */
  static assignFaction(cre: ModuleCreature, factionId: number) {
    if (!cre) return;
    cre.factionId = factionId;
    cre.faction = GameState.FactionManager.factions.get(factionId);
    GameState.FactionManager.AddCreatureToFaction(cre);
  }

  static healObject(obj: ModuleObject) {
    if (!obj) return;
    if (GMObjectKind.isCreature(obj)) {
      const cre = obj as ModuleCreature;
      const max = cre.getMaxHP() || 100;
      this.setCreatureHP(cre, max, max);
      cre.setFP(cre.getMaxFP() || 100);
      cre.deathAnimationPlayed = false;
    } else {
      obj.currentHP = obj.getMaxHP() || 100;
    }
    if (GMNetworkManager.role !== 'offline') {
      GMNetworkManager.broadcastActorUpdate(GMReplication.serializeSingleActor(obj));
    }
    this.notifyChange();
  }

  static killObject(obj: ModuleObject) {
    if (!obj) return;
    if (GMObjectKind.isCreature(obj)) {
      const cre = obj as ModuleCreature;
      cre.min1HP = false;
      this.setCreatureHP(cre, 0);
      cre.clearAllActions();
    } else {
      obj.currentHP = 0;
    }
    if (GMNetworkManager.role !== 'offline') {
      GMNetworkManager.broadcastActorUpdate(GMReplication.serializeSingleActor(obj));
    }
    this.notifyChange();
  }

  static teleportObject(obj: ModuleObject, pos: THREE.Vector3) {
    if (!obj || !pos) return;
    this.placeAt(obj, pos);

    // A player's character goes where its player says: move it on their machine too, and ignore their
    // position reports from before the teleport (some are already on their way)
    const ownerPeerId = obj.gmOwnerPeerId;
    if (GMNetworkManager.role === 'host' && ownerPeerId && obj.gmNetId) {
      const seq = (obj.gmTeleportSeq || 0) + 1;
      obj.gmTeleportSeq = seq;
      obj.gmHostDriven = false;
      GMNetworkManager.sendPacket({
        type: 'actor.teleport',
        senderId: GMNetworkManager.peerId,
        targetPeerId: ownerPeerId,
        timestamp: Date.now(),
        payload: { netId: obj.gmNetId, x: pos.x, y: pos.y, z: pos.z, seq }
      });
    }

    if (GMNetworkManager.role !== 'offline') {
      GMNetworkManager.broadcastActorUpdate(GMReplication.serializeSingleActor(obj));
    }
    this.notifyChange();
  }

  /**
   * Put an object somewhere outright. A creature drops whatever it was doing (a walk would carry on from
   * the new spot back to where it was heading) and stops following any older synced position.
   */
  static placeAt(obj: ModuleObject, pos: THREE.Vector3) {
    if (GMObjectKind.isCreature(obj)) {
      const cre = obj as ModuleCreature;
      cre.clearAllActions();
      cre.force = 0;
      cre.speed = 0;
      cre.setAnimationState(ModuleCreatureAnimState.PAUSE);
    }
    obj.position.copy(pos);
    if (obj.container) {
      obj.container.position.copy(pos);
    }
    const netTarget = obj.gmNetTarget as THREE.Vector3 | undefined;
    if (netTarget) netTarget.copy(pos);
    obj.getCurrentRoom();
    obj.computeBoundingBox(true);
  }

  static rotateObject(obj: ModuleObject, deltaRadians: number) {
    if (!obj) return;
    if (GMObjectKind.isCreature(obj)) {
      const cre = obj as ModuleCreature;
      cre.setFacing(Utility.NormalizeRadian(cre.getFacing() + deltaRadians), true);
    } else {
      obj.bearing = Utility.NormalizeRadian((obj.bearing || 0) + deltaRadians);
      obj.rotation.z = obj.bearing;
    }
    obj.computeBoundingBox(true);
    if (GMNetworkManager.role !== 'offline') {
      GMNetworkManager.broadcastActorUpdate(GMReplication.serializeSingleActor(obj));
    }
    this.notifyChange();
  }

  static STANCES: GMAnimationChoice[] = STANCES;

  static GESTURES: GMAnimationChoice[] = GESTURES;

  /** The animation a creature would play for a choice, or '' when its model has none of them */
  static animationFor(cre: ModuleCreature, choice: GMAnimationChoice, looping: boolean): string {
    for (const name of choice.anims) {
      if (!cre.hasModelAnimation?.(name)) continue;
      const row = OdysseyModelAnimation.GetAnimation2DA(name);
      if (!row) continue;
      if (looping && String(row.looping) !== '1') continue;
      return name;
    }
    return '';
  }

  /** The choices this creature's model can do */
  static availableAnimations(cre: ModuleCreature, kind: 'stance' | 'gesture'): GMAnimationChoice[] {
    const list = kind === 'stance' ? this.STANCES : this.GESTURES;
    return list.filter((choice) => !!this.animationFor(cre, choice, kind === 'stance'));
  }

  /** Find a choice by id, label or animation name */
  static findAnimationChoice(kind: 'stance' | 'gesture', key: string): GMAnimationChoice | undefined {
    const k = String(key || '').trim().toLowerCase();
    if (!k) return undefined;
    const list = kind === 'stance' ? this.STANCES : this.GESTURES;
    return list.find((c) => c.id === k || c.label.toLowerCase() === k || c.anims.includes(k));
  }

  /** The id of the stance a creature holds ('' standing) */
  static stanceOf(cre: ModuleCreature): string {
    const held = cre?.heldStance || '';
    if (!held) return '';
    return this.STANCES.find((c) => c.anims.includes(held))?.id || held;
  }

  /**
   * Hold a creature in a stance until changed ('' to stand normally). Returns false when its model can't do it.
   * Takes a stance id, its label or an animations.2da name.
   */
  static setCreatureStance(obj: ModuleObject, stance: string): boolean {
    if (!obj || !GMObjectKind.isCreature(obj)) return false;
    const cre = obj as ModuleCreature;
    let anim = '';
    if (stance) {
      const choice = this.findAnimationChoice('stance', stance) || { id: stance, label: stance, group: '', anims: [String(stance).toLowerCase()] };
      anim = this.animationFor(cre, choice, true);
      if (!anim) return false;
    }
    cre.setHeldStance(anim);
    if (cre.gmSpawnConfig) cre.gmSpawnConfig.stance = anim || undefined;
    if (GMNetworkManager.role === 'host') {
      GMNetworkManager.broadcastActorUpdate(GMReplication.serializeSingleActor(cre));
    }
    this.notifyChange();
    return true;
  }

  /** Play a gesture once (an id, label or animations.2da name). Players see it too. */
  static playGesture(obj: ModuleObject, gesture: string): boolean {
    if (!obj || !GMObjectKind.isCreature(obj)) return false;
    const cre = obj as ModuleCreature;
    if (cre.isDead()) return false;
    const choice = this.findAnimationChoice('gesture', gesture) || { id: gesture, label: gesture, group: '', anims: [String(gesture).toLowerCase()] };
    const anim = this.animationFor(cre, choice, false);
    const row = anim && OdysseyModelAnimation.GetAnimation2DA(anim);
    if (!row) return false;
    // From a held stance (or just standing): play it in the idle slot, and the stance comes back after
    if (cre.animationState.index !== ModuleCreatureAnimState.PAUSE) cre.setAnimationState(ModuleCreatureAnimState.PAUSE);
    cre.playTwoDAAnimation(row);
    return true;
  }

  static setObjectBark(obj: ModuleObject, barkText: string) {
    if (!obj) return;
    obj.gmBarkText = barkText;
    if (GMNetworkManager.role !== 'offline') {
      GMNetworkManager.broadcastActorUpdate(GMReplication.serializeSingleActor(obj));
    }
    this.notifyChange();
  }

  static triggerBarkNow(obj: ModuleObject, text?: string) {
    const msg = text || obj?.gmBarkText || `${obj?.getName() || 'Actor'}: Greetings!`;
    GameState.MenuManager.InGameBark?.barkFromString(msg);
    if (GMNetworkManager.role !== 'offline') {
      GMNetworkManager.sendChat(obj?.getName() || 'GM', msg);
    }
  }

  static toggleDoorOrPlaceableOpen(obj: ModuleObject) {
    if (!obj) return;
    if (GMObjectKind.isDoor(obj)) {
      const door = obj as ModuleDoor;
      if (door.isOpen()) {
        door.closeDoor(door);
      } else {
        const wasLocked = door.isLocked();
        door.setLocked(false);
        door.openDoor(door);
        if (wasLocked) door.setLocked(false);
      }
      if (GMNetworkManager.role !== 'offline') {
        GMNetworkManager.broadcastDoorState({
          netId: door.gmNetId || `door_${door.id}`,
          tag: door.getTag(),
          x: door.position.x,
          y: door.position.y,
          locked: door.isLocked(),
          openState: door.openState
        });
      }
    } else if (GMObjectKind.isPlaceable(obj)) {
      const plc = obj as ModulePlaceable;
      if (plc.isOpen()) {
        plc.close(plc);
      } else {
        plc.setLocked(false);
        plc.use(GameState.getCurrentPlayer() || plc);
      }
      if (GMNetworkManager.role !== 'offline') {
        GMNetworkManager.broadcastActorUpdate(GMReplication.serializeSingleActor(plc));
      }
    }
    this.notifyChange();
  }

  static toggleDoorOrPlaceableLock(obj: ModuleObject) {
    if (!obj) return;
    if (GMObjectKind.isDoor(obj)) {
      const door = obj as ModuleDoor;
      door.setLocked(!door.isLocked());
      if (GMNetworkManager.role !== 'offline') {
        GMNetworkManager.broadcastDoorState({
          netId: door.gmNetId || `door_${door.id}`,
          tag: door.getTag(),
          x: door.position.x,
          y: door.position.y,
          locked: door.isLocked(),
          openState: door.openState
        });
      }
    } else if (GMObjectKind.isPlaceable(obj)) {
      const plc = obj as ModulePlaceable;
      plc.setLocked(!plc.isLocked());
      if (GMNetworkManager.role !== 'offline') {
        GMNetworkManager.broadcastActorUpdate(GMReplication.serializeSingleActor(plc));
      }
    }
    this.notifyChange();
  }

  static deleteObject(obj: ModuleObject) {
    if (!obj) return;
    const netId = obj.gmNetId;
    if (this.selectedObject === obj) {
      this.selectedObject = null;
    }

    const partyIdx = GameState.PartyManager.party.indexOf(obj as ModuleCreature);
    if (partyIdx >= 0) {
      GameState.PartyManager.party.splice(partyIdx, 1);
    }
    const spIdx = this.spawnedPlayers.indexOf(obj as ModuleCreature);
    if (spIdx >= 0) {
      this.spawnedPlayers.splice(spIdx, 1);
    }

    if (GameState.PartyManager.Player === obj) {
      GameState.PartyManager.Player = GameState.PartyManager.party[0] || undefined;
      if (!GameState.PartyManager.Player) {
        this.enterFreeCamera(false);
      }
    }

    obj.destroy();
    if (netId) {
      this.netIdMap.delete(netId);
      if (GMNetworkManager.role !== 'offline') {
        GMNetworkManager.broadcastActorRemove(netId);
      }
    }
    this.notifyChange();
  }

  /**
   * Adjust the 3D scale of a Placeable or Creature
   */
  static setObjectScale(obj: ModuleObject, scale: number) {
    if (!obj || !obj.container) return;
    const clamped = Math.max(0.25, Math.min(4.0, scale));
    obj.gmScale = clamped;
    if (obj.gmSpawnConfig) {
      (obj.gmSpawnConfig as GMPlaceableSpawnConfig).scale = clamped;
    }
    obj.container.scale.setScalar(clamped);
    obj.computeBoundingBox(true);
    if (GMNetworkManager.role !== 'offline') {
      GMNetworkManager.broadcastActorUpdate(GMReplication.serializeSingleActor(obj));
    }
    this.notifyChange();
  }

  /**
   * Nudge an object's X, Y, or Z position for fine architectural alignment
   */
  static nudgeObjectPosition(obj: ModuleObject, dx: number, dy: number, dz: number) {
    if (!obj) return;
    const nextPos = new THREE.Vector3(
      obj.position.x + dx,
      obj.position.y + dy,
      obj.position.z + dz
    );
    this.teleportObject(obj, nextPos);
  }

  /**
   * Clear default module placeables (leaves GM-spawned placeables intact)
   */
  static clearDefaultAreaPlaceables() {
    const area = GameState.module?.area;
    if (!area) return;
    const toRemove = area.placeables.filter(
      plc => !plc.gmNetId || String(plc.gmNetId).startsWith('plc_area_')
    );
    for (const plc of toRemove) {
      this.deleteObject(plc);
    }
    this.notifyChange();
  }

  /**
   * Clear all GM-spawned placeables in the current scene
   */
  static clearGMSpawnedPlaceables() {
    const area = GameState.module?.area;
    if (!area) return;
    const toRemove = area.placeables.filter(
      plc => plc.gmNetId && !String(plc.gmNetId).startsWith('plc_area_')
    );
    for (const plc of toRemove) {
      this.deleteObject(plc);
    }
    this.notifyChange();
  }

  /** A character a player plays: a connected player's, or one the GM spawned as a player character */
  static isPlayerCharacter(obj: ModuleObject | undefined): boolean {
    if (!obj || !GMObjectKind.isCreature(obj)) return false;
    return !!(obj.gmOwnerPeerId || obj.gmPlayerConfig);
  }

  static getPlayerCharacters(): ModuleCreature[] {
    const area = GameState.module?.area;
    if (!area) return [];
    const all = [...GameState.PartyManager.party, ...area.creatures] as ModuleCreature[];
    return [...new Set(all)].filter((c) => this.isPlayerCharacter(c));
  }

  /** An NPC the GM can order: a creature no player plays and the GM isn't playing */
  static canOrder(obj: ModuleObject | null | undefined): obj is ModuleCreature {
    return !!obj && GMObjectKind.isCreature(obj) &&
      !this.isPlayerCharacter(obj) && !GameState.PartyManager.party.includes(obj as ModuleCreature) && !(obj as ModuleCreature).isDead();
  }

  /** Give an NPC an order, or undefined to hand it back to its own judgement */
  static giveOrder(cre: ModuleCreature, order: GMNpcOrder | undefined) {
    if (!this.canOrder(cre)) return;
    GMNpcOrders.setOrder(cre, order);
    this.notifyChange();
  }

  static pointOf(obj: { position: THREE.Vector3 }): GMPoint {
    return { x: obj.position.x, y: obj.position.y, z: obj.position.z };
  }

  /**
   * GM scenes don't run the module's creature scripts, which is where KotOR decides who an NPC fights.
   * Stand in for them: an NPC that isn't already mid-attack goes after its current target, else whoever
   * last attacked it, else the nearest creature it is hostile to and can see.
   */
  static updateNpcCombat(ownJudgement: boolean = true) {
    const area = GameState.module?.area;
    if (!area || !GameState.module.readyToProcessEvents) return;

    const everyone: ModuleCreature[] = [...area.creatures, ...GameState.PartyManager.party];
    for (const cre of area.creatures) {
      if (!this.isAutonomousNpc(cre)) continue;
      if (GMNpcOrders.getOrder(cre)) {
        GMNpcOrders.think(cre, everyone);
        continue;
      }
      if (!ownJudgement) continue;
      // Already swinging, or with attacks queued: let the combat round play out
      if (cre.combatRound.action || cre.combatRound.scheduledActionList.length) continue;

      const target = this.chooseNpcTarget(cre, everyone);
      if (target) cre.attackCreature(target, undefined);
    }
  }

  /** NPCs the GM isn't controlling and no player owns */
  static isAutonomousNpc(cre: ModuleCreature): boolean {
    if (!cre || !cre.isReady || cre.isDead() || cre.destroyed) return false;
    if (GameState.PartyManager.party.includes(cre)) return false;
    if (cre.gmOwnerPeerId || cre.gmPlayerConfig || cre.gmHostDriven) return false;
    return true;
  }

  static chooseNpcTarget(cre: ModuleCreature, everyone: ModuleCreature[]): ModuleCreature | null {
    const usable = (c: ModuleObject | undefined, range: number): c is ModuleCreature =>
      !!c && c !== cre && GMObjectKind.isCreature(c) &&
      !c.isDead() && everyone.includes(c as ModuleCreature) &&
      cre.position.distanceTo(c.position) <= range && cre.isHostile(c) && cre.canDetect?.(c as ModuleCreature) !== false &&
      !this.isUntargetable(c);

    const sight = cre.perceptionRange ? Math.max(cre.getPerceptionRangePrimary(), 1) : this.NPC_AI_SIGHT_RANGE;
    const current = cre.combatData.lastAttackTarget;
    if (usable(current, this.NPC_AI_RETALIATE_RANGE)) return current;
    const attacker = cre.combatData.lastAttacker;
    if (usable(attacker, this.NPC_AI_RETALIATE_RANGE)) return attacker;

    let nearest: ModuleCreature | null = null;
    let nearestDistance = Infinity;
    for (const other of everyone) {
      if (!usable(other, sight)) continue;
      const d = cre.position.distanceTo(other.position);
      if (d < nearestDistance && cre.hasLineOfSight(other, sight)) {
        nearest = other;
        nearestDistance = d;
      }
    }
    return nearest;
  }

  /**
   * Frame Update (updates 3D selection ring & multiplayer network sync)
   */
  static update(delta: number) {
    if (!GameState.gmMode) return;
    GMViewport.init3DIndicators();
    GMViewport.updateSelectionRing(this.selectedObject);

    if (GMNetworkManager.role === 'client') GameState.GMConversationManager?.update(delta);

    // Fallen player characters: getting back up, respawning, telling the GM when everyone is down
    if (GMNetworkManager.role !== 'client' && !this.worldPaused && !this.sceneLoading) {
      GMPlayers.downedTimer += delta;
      if (GMPlayers.downedTimer >= GMPlayers.DOWNED_CHECK_INTERVAL) {
        GMPlayers.updateDownedPlayers(GMPlayers.downedTimer);
        GMPlayers.downedTimer = 0;
      }
    }

    // NPCs run on the GM's machine only; players see the result through the world updates
    if (GMNetworkManager.role !== 'client' && !this.worldPaused && !this.sceneLoading) {
      this.npcAiTimer += delta;
      if (this.npcAiTimer >= this.NPC_AI_INTERVAL) {
        this.npcAiTimer = 0;
        this.updateNpcCombat(this.npcAiEnabled);
      }
    }

    if (GMNetworkManager.role === 'host') {
      GMReplication.updateHostDrivenActors();
      GMPlayers.sheetSyncTimer += delta;
      if (GMPlayers.sheetSyncTimer >= GMPlayers.SHEET_SYNC_INTERVAL) {
        GMPlayers.sheetSyncTimer = 0;
        GMPlayers.updatePlayerSheets();
      }
    }
    GMNetworkManager.update(delta);
  }

  /**
   * Hide an object from players (it stays visible to the GM), or reveal it. Hidden objects are removed
   * from players' games and never synced, which also gives the GM an invisible character to play.
   */
  static setObjectHidden(obj: ModuleObject, hidden: boolean): boolean {
    // A connected player's character can't be hidden: it would vanish from their own game
    if (!obj || obj.gmOwnerPeerId) return false;
    obj.gmHidden = !!hidden;
    const netId = obj.gmNetId;
    if (netId && GMNetworkManager.role === 'host') {
      if (hidden) {
        GMNetworkManager.broadcastActorRemove(netId);
      } else {
        GMNetworkManager.broadcastActorSpawn(GMReplication.serializeSingleActor(obj));
      }
    }
    this.notifyChange();
    return true;
  }

  static isHiddenFromPlayers(obj: ModuleObject | null | undefined): boolean {
    return !!obj?.gmHidden;
  }

  /**
   * Resolves once the given scene has finished loading, or false after timeoutMs. The old module still reports
   * ready until the new one replaces it, so this waits for the scene by name.
   */
  static waitForScene(moduleResRef: string, timeoutMs: number = 120000): Promise<boolean> {
    const want = moduleResRef.toLowerCase();
    const start = Date.now();
    return new Promise((resolve) => {
      const check = setInterval(() => {
        const ready = !this.sceneLoading &&
          String(GameState.module?.filename || '').toLowerCase() === want &&
          GameState.module?.readyToProcessEvents && !GameState.loadingTextures;
        if (ready || Date.now() - start > timeoutMs) {
          clearInterval(check);
          resolve(!!ready);
        }
      }, 250);
    });
  }

  // -------------------------------------------------------------------------
  // Engine hooks: what the engine (GameState.GMManager) and GMNetworkManager call, kept here so they
  // need not know which GM class does it
  // -------------------------------------------------------------------------

  static announceSkillRoll(...args: Parameters<typeof GMMines.announceSkillRoll>): ReturnType<typeof GMMines.announceSkillRoll> {
    return GMMines.announceSkillRoll(...args);
  }

  static applyClientInputOnHost(...args: Parameters<typeof GMReplication.applyClientInputOnHost>): ReturnType<typeof GMReplication.applyClientInputOnHost> {
    return GMReplication.applyClientInputOnHost(...args);
  }

  static applyClientIntentOnHost(...args: Parameters<typeof GMPlayers.applyClientIntentOnHost>): ReturnType<typeof GMPlayers.applyClientIntentOnHost> {
    return GMPlayers.applyClientIntentOnHost(...args);
  }

  static applyDoorStateOnClient(...args: Parameters<typeof GMReplication.applyDoorStateOnClient>): ReturnType<typeof GMReplication.applyDoorStateOnClient> {
    return GMReplication.applyDoorStateOnClient(...args);
  }

  static applyFxEventOnClient(...args: Parameters<typeof GMReplication.applyFxEventOnClient>): ReturnType<typeof GMReplication.applyFxEventOnClient> {
    return GMReplication.applyFxEventOnClient(...args);
  }

  static applyMineOnClient(...args: Parameters<typeof GMMines.applyMineOnClient>): ReturnType<typeof GMMines.applyMineOnClient> {
    return GMMines.applyMineOnClient(...args);
  }

  static applyPlayerSheetOnClient(...args: Parameters<typeof GMPlayers.applyPlayerSheetOnClient>): ReturnType<typeof GMPlayers.applyPlayerSheetOnClient> {
    return GMPlayers.applyPlayerSheetOnClient(...args);
  }

  static applyTeleportOnClient(...args: Parameters<typeof GMReplication.applyTeleportOnClient>): ReturnType<typeof GMReplication.applyTeleportOnClient> {
    return GMReplication.applyTeleportOnClient(...args);
  }

  static applyWorldSnapshotOnClient(...args: Parameters<typeof GMReplication.applyWorldSnapshotOnClient>): ReturnType<typeof GMReplication.applyWorldSnapshotOnClient> {
    return GMReplication.applyWorldSnapshotOnClient(...args);
  }

  static applyWorldTickOnClient(...args: Parameters<typeof GMReplication.applyWorldTickOnClient>): ReturnType<typeof GMReplication.applyWorldTickOnClient> {
    return GMReplication.applyWorldTickOnClient(...args);
  }

  static buildWorldSnapshot(...args: Parameters<typeof GMReplication.buildWorldSnapshot>): ReturnType<typeof GMReplication.buildWorldSnapshot> {
    return GMReplication.buildWorldSnapshot(...args);
  }

  static consumePlayerItem(...args: Parameters<typeof GMPlayers.consumePlayerItem>): ReturnType<typeof GMPlayers.consumePlayerItem> {
    return GMPlayers.consumePlayerItem(...args);
  }

  static findActorOwnedBy(...args: Parameters<typeof GMReplication.findActorOwnedBy>): ReturnType<typeof GMReplication.findActorOwnedBy> {
    return GMReplication.findActorOwnedBy(...args);
  }

  static giveRecoveredMine(...args: Parameters<typeof GMMines.giveRecoveredMine>): ReturnType<typeof GMMines.giveRecoveredMine> {
    return GMMines.giveRecoveredMine(...args);
  }

  static interceptInteraction(...args: Parameters<typeof GMPlayers.interceptInteraction>): ReturnType<typeof GMPlayers.interceptInteraction> {
    return GMPlayers.interceptInteraction(...args);
  }

  static interceptMenuAction(...args: Parameters<typeof GMPlayers.interceptMenuAction>): ReturnType<typeof GMPlayers.interceptMenuAction> {
    return GMPlayers.interceptMenuAction(...args);
  }

  static isMineReplica(...args: Parameters<typeof GMMines.isMineReplica>): ReturnType<typeof GMMines.isMineReplica> {
    return GMMines.isMineReplica(...args);
  }

  static isNetMotionDriven(...args: Parameters<typeof GMReplication.isNetMotionDriven>): ReturnType<typeof GMReplication.isNetMotionDriven> {
    return GMReplication.isNetMotionDriven(...args);
  }

  static isNetReplica(...args: Parameters<typeof GMReplication.isNetReplica>): ReturnType<typeof GMReplication.isNetReplica> {
    return GMReplication.isNetReplica(...args);
  }

  static isNetworkContainer(...args: Parameters<typeof GMPlayers.isNetworkContainer>): ReturnType<typeof GMPlayers.isNetworkContainer> {
    return GMPlayers.isNetworkContainer(...args);
  }

  static loadSceneFromNetwork(...args: Parameters<typeof GMReplication.loadSceneFromNetwork>): ReturnType<typeof GMReplication.loadSceneFromNetwork> {
    return GMReplication.loadSceneFromNetwork(...args);
  }

  static onDmReply(...args: Parameters<typeof GMPlayers.onDmReply>): ReturnType<typeof GMPlayers.onDmReply> {
    return GMPlayers.onDmReply(...args);
  }

  static onHostProjectile(...args: Parameters<typeof GMReplication.onHostProjectile>): ReturnType<typeof GMReplication.onHostProjectile> {
    return GMReplication.onHostProjectile(...args);
  }

  static onHostTwoDAAnimation(...args: Parameters<typeof GMReplication.onHostTwoDAAnimation>): ReturnType<typeof GMReplication.onHostTwoDAAnimation> {
    return GMReplication.onHostTwoDAAnimation(...args);
  }

  static onHostVisualEffectApplied(...args: Parameters<typeof GMReplication.onHostVisualEffectApplied>): ReturnType<typeof GMReplication.onHostVisualEffectApplied> {
    return GMReplication.onHostVisualEffectApplied(...args);
  }

  static onHostVisualEffectRemoved(...args: Parameters<typeof GMReplication.onHostVisualEffectRemoved>): ReturnType<typeof GMReplication.onHostVisualEffectRemoved> {
    return GMReplication.onHostVisualEffectRemoved(...args);
  }

  static onMineChanged(...args: Parameters<typeof GMMines.onMineChanged>): ReturnType<typeof GMMines.onMineChanged> {
    return GMMines.onMineChanged(...args);
  }

  static onMineRemoved(...args: Parameters<typeof GMMines.onMineRemoved>): ReturnType<typeof GMMines.onMineRemoved> {
    return GMMines.onMineRemoved(...args);
  }

  static onRespawnRequest(...args: Parameters<typeof GMPlayers.onRespawnRequest>): ReturnType<typeof GMPlayers.onRespawnRequest> {
    return GMPlayers.onRespawnRequest(...args);
  }

  static openNetworkContainer(...args: Parameters<typeof GMPlayers.openNetworkContainer>): ReturnType<typeof GMPlayers.openNetworkContainer> {
    return GMPlayers.openNetworkContainer(...args);
  }

  static receiveNetworkLoot(...args: Parameters<typeof GMPlayers.receiveNetworkLoot>): ReturnType<typeof GMPlayers.receiveNetworkLoot> {
    return GMPlayers.receiveNetworkLoot(...args);
  }

  static releaseActor(...args: Parameters<typeof GMReplication.releaseActor>): ReturnType<typeof GMReplication.releaseActor> {
    return GMReplication.releaseActor(...args);
  }

  static removeActorByNetId(...args: Parameters<typeof GMReplication.removeActorByNetId>): ReturnType<typeof GMReplication.removeActorByNetId> {
    return GMReplication.removeActorByNetId(...args);
  }

  static removeMineOnClient(...args: Parameters<typeof GMMines.removeMineOnClient>): ReturnType<typeof GMMines.removeMineOnClient> {
    return GMMines.removeMineOnClient(...args);
  }

  static requestNetworkEquip(...args: Parameters<typeof GMPlayers.requestNetworkEquip>): ReturnType<typeof GMPlayers.requestNetworkEquip> {
    return GMPlayers.requestNetworkEquip(...args);
  }

  static requestNetworkLoot(...args: Parameters<typeof GMPlayers.requestNetworkLoot>): ReturnType<typeof GMPlayers.requestNetworkLoot> {
    return GMPlayers.requestNetworkLoot(...args);
  }

  static requestNetworkUnequip(...args: Parameters<typeof GMPlayers.requestNetworkUnequip>): ReturnType<typeof GMPlayers.requestNetworkUnequip> {
    return GMPlayers.requestNetworkUnequip(...args);
  }

  static routeContainerOpen(...args: Parameters<typeof GMPlayers.routeContainerOpen>): ReturnType<typeof GMPlayers.routeContainerOpen> {
    return GMPlayers.routeContainerOpen(...args);
  }

  static serializeActorsForTick(...args: Parameters<typeof GMReplication.serializeActorsForTick>): ReturnType<typeof GMReplication.serializeActorsForTick> {
    return GMReplication.serializeActorsForTick(...args);
  }

  static skillGatePasses(...args: Parameters<typeof GMChecks.skillGatePasses>): ReturnType<typeof GMChecks.skillGatePasses> {
    return GMChecks.skillGatePasses(...args);
  }

  static spawnOrUpdateFromSerialized(...args: Parameters<typeof GMReplication.spawnOrUpdateFromSerialized>): ReturnType<typeof GMReplication.spawnOrUpdateFromSerialized> {
    return GMReplication.spawnOrUpdateFromSerialized(...args);
  }

  static spawnPlayerFromNetworkPreset(...args: Parameters<typeof GMPlayers.spawnPlayerFromNetworkPreset>): ReturnType<typeof GMPlayers.spawnPlayerFromNetworkPreset> {
    return GMPlayers.spawnPlayerFromNetworkPreset(...args);
  }

  static updateNetMotion(...args: Parameters<typeof GMReplication.updateNetMotion>): ReturnType<typeof GMReplication.updateNetMotion> {
    return GMReplication.updateNetMotion(...args);
  }
}

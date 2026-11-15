import { GMFaction, GM_SKILL_NAMES, gmItemResRef } from "@/managers/gm/GMVocab";
import { GMTemplates } from "@/managers/gm/GMTemplates";
import type { GMGear } from "@/managers/gm/GMTemplates";
import { GMObjectKind } from "@/managers/gm/GMObjectKind";
import * as THREE from "three";
import { GameState } from "@/GameState";
import { EngineMode } from "@/enums/engine/EngineMode";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";
import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import { ModuleDoorOpenState } from "@/enums/module/ModuleDoorOpenState";
import { ModulePlaceableState } from "@/enums/module/ModulePlaceableState";
import { GFFDataType } from "@/enums/resource/GFFDataType";
import { CacheScope } from "@/enums/resource/CacheScope";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { CExoLocString } from "@/resource/CExoLocString";
import { GFFObject } from "@/resource/GFFObject";
import { GFFStruct } from "@/resource/GFFStruct";
import { GFFField } from "@/resource/GFFField";
import { ResourceLoader } from "@/loaders";
import { FollowerCamera } from "@/engine/FollowerCamera";
import type { SaveGame } from "@/engine/SaveGame";
import { CreatureClass } from "@/combat/CreatureClass";
import { CharacterBuilder } from "@/engine/rules/CharacterBuilder";
import { GMNpcOrders } from "@/managers/GMNpcOrders";
import type { GMNpcOrder, GMPoint } from "@/managers/GMNpcOrders";
import type { GMSerializedMine } from "@/managers/GMNetworkManager";
import { ModuleTriggerType } from "@/enums/module/ModuleTriggerType";
import type { ModuleTrigger } from "@/module/ModuleTrigger";
import type { ICharacterBuild } from "@/engine/rules/CharacterBuilder";
import { TalentFeat, TalentSpell } from "@/talents";
import { ModuleObject, ModuleCreature, ModulePlayer, ModulePlaceable, ModuleDoor, ModuleItem } from "@/module";
import { OdysseyModel3D } from "@/three/odyssey";
import { OdysseyModelAnimation } from "@/odyssey";
import { TextSprite3D } from "@/engine/TextSprite3D";
import type { ITwoDAAnimation } from "@/interface/twoDA/ITwoDAAnimation";
import type { GameEffect } from "@/effects/GameEffect";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
import { ActionType } from "@/enums/actions/ActionType";
import { GameEngineType } from "@/enums/engine/GameEngineType";
import { OtherGameManager } from "@/managers/OtherGameManager";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { ModuleObjectConstant } from "@/enums/module/ModuleObjectConstant";
import { TalentObjectType } from "@/enums/engine/TalentObjectType";
import { SkillType } from "@/enums/nwscript/SkillType";
import { BitWise } from "@/utility/BitWise";
import { Utility } from "@/utility/Utility";
import { GameFileSystem } from "@/utility/GameFileSystem";
import {
  GMEventEmitter,
  GMDeathRule,
  GMSessionRules,
  GMNetworkManager,
  GMSerializedActor,
  GMSerializedDoorState,
  GMWorldSnapshot,
  GMPlayerJoinPreset,
  GMClientIntent,
  GMFxEvent,
  GMLootItem,
  GMPlayerSheet,
  GMDmPrompt
} from "@/managers/GMNetworkManager";

import type {
  GMControlMode,
  GMToolMode,
  GMModuleEntry,
  GMAnimationChoice,
  GMCreatureSpawnConfig,
  GMCheck,
  GMCheckResult,
  GMCreatureTemplateInfo,
  GMPlaceablePropCategory,
  GMPlaceableSpawnConfig,
  GMSkillGate,
  GMSceneBlueprintItem,
  GMSceneBlueprintCreature,
  GMSceneBlueprint,
  GMPlayerSpawnConfig,
  GMSavedObject,
  GMSavedPlayer,
  GMSessionSave,
} from "@/managers/gm/GMTypes";
import { CURATED_MODULES, CURATED_MODULES_TSL } from "@/managers/gm/data/modules";
import { CREATURE_PRESETS } from "@/managers/gm/data/creaturePresets";
import { PLACEABLE_PRESETS, CATEGORIZED_PROPS, PLACEABLE_KEYWORD_LABELS } from "@/managers/gm/data/placeablePresets";
import { SCENE_BLUEPRINTS } from "@/managers/gm/data/sceneBlueprints";
import { PLAYER_PRESETS } from "@/managers/gm/data/playerPresets";
import { WEAPON_OPTIONS, ARMOR_OPTIONS, LOOT_ITEM_OPTIONS } from "@/managers/gm/data/itemOptions";
import { STANCES, GESTURES } from "@/managers/gm/data/animations";

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

  // Architectural & Scene Builder placement helpers
  static gridSnapSize: number = 0; // 0 = Off, 0.5, 1.0, 2.0
  static placementYawOffset: number = 0; // degrees (0..360)
  static CUSTOM_BLUEPRINTS_STORAGE_KEY: string = 'kotor_gm_saved_scenes_v1';

  // Currently selected object in the GM Inspector
  static selectedObject: ModuleObject | null = null;

  // Player characters loaded into the GM session
  static spawnedPlayers: ModuleCreature[] = [];

  // Map of network IDs -> ModuleObjects for NWN-style multiplayer sync
  static netIdMap: Map<string, ModuleObject> = new Map();
  static nextNetIdCounter: number = 1;

  // Network actors whose spawn is still loading, so repeated ticks don't spawn duplicates
  static pendingNetSpawns: Set<string> = new Set();

  // True from the start of a scene change until the new scene's objects are registered.
  // World ticks are neither sent nor applied meanwhile, so nothing from the old scene is
  // re-registered against objects that are about to be destroyed.
  static sceneLoading: boolean = false;

  // Replica motion smoothing (higher = snappier) and the distance beyond which we teleport instead
  static NET_SMOOTHING: number = 12;
  static NET_SNAP_DISTANCE: number = 6;

  // Animation states set alongside a replayed 2DA animation (see applyFxEventOnClient)
  static FX_DRIVEN_ANIM_STATES: number[] = [
    ModuleCreatureAnimState.ATTACK,
    ModuleCreatureAnimState.DAMAGE,
    ModuleCreatureAnimState.DODGE,
    ModuleCreatureAnimState.PARRY,
  ];

  // Degrees per placement rotation step: R / Shift+R, and per mouse-wheel notch
  static PLACEMENT_KEY_STEP: number = 45;
  static PLACEMENT_WHEEL_STEP: number = 15;

  // How close a player must be to a container for the host to hand over its items
  static LOOT_RANGE: number = 4;

  // Equipment slots shown on a player's character sheet and kept in sync by the host
  static PLAYER_EQUIP_SLOTS: string[] = ['HEAD', 'ARMS', 'ARMOR', 'BELT', 'IMPLANT', 'LEFTARMBAND', 'RIGHTARMBAND', 'RIGHTHAND', 'LEFTHAND'];

  // Host: how often player sheets are checked for changes and resent
  static SHEET_SYNC_INTERVAL: number = 1.0;
  static sheetSyncTimer: number = 0;
  /** How often (seconds) idle NPCs look for someone to fight */
  static NPC_AI_INTERVAL: number = 0.75;
  /** How far (metres) an NPC with no perception range of its own sees enemies */
  static NPC_AI_SIGHT_RANGE: number = 20;
  /** NPCs fight back against an attacker up to this far away (metres) even if they can't see them */
  static NPC_AI_RETALIATE_RANGE: number = 30;
  static npcAiTimer: number = 0;
  /** What happens when a player's character falls; see GMDeathRule */
  static deathRule: GMDeathRule = 'kotor';

  /** Players can only watch (a scene plan's cutscene): they can't move or act, and NPCs leave them alone */
  static playersFrozen: boolean = false;

  /** Where players joining this scene appear (a scene plan's start), instead of the camera target */
  static sceneStartPoint: THREE.Vector3 | null = null;

  static sessionRules(): GMSessionRules {
    return { deathRule: this.deathRule, frozen: this.playersFrozen };
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

  /** The NPC an order tool (order_move, order_attack...) is giving its order to */
  static orderSubject: ModuleCreature | null = null;
  /** Patrol points clicked so far with the order_patrol tool */
  static patrolDraft: GMPoint[] = [];

  /** The GM can switch the NPC combat AI off (NPCs then only act when told to) */
  static npcAiEnabled: boolean = true;

  // Client: set while applying the host's sheet, so our own equip calls aren't sent back as requests
  static applyingHostSheet: boolean = false;
  // Host: questions asked of players, and their replies
  static dmPrompts: Map<string, { prompt: GMDmPrompt; targetPeerId?: string; replies: { peerId: string; name: string; choice: number }[] }> = new Map();

  // Host: characters from a loaded session waiting for their player to (re)join, by lower-case player name
  static reservedPlayers: Map<string, GMSavedPlayer> = new Map();
  static SESSIONS_STORAGE_KEY: string = 'kotor_gm_sessions_v1';
  static MAX_SAVED_SESSIONS: number = 20;

  // Client: a sheet that arrived before our character finished spawning
  static pendingPlayerSheet: GMPlayerSheet | null = null;
  static lastAppliedInventoryJson: string = '';

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

  // 3D viewport visual indicators
  static selectionRing: THREE.Mesh | null = null;
  static placementRing: THREE.Mesh | null = null;
  static lastRaycastPoint: THREE.Vector3 = new THREE.Vector3();
  static hasValidRaycastPoint: boolean = false;
  static raycaster: THREE.Raycaster = new THREE.Raycaster();
  static mouseNDC: THREE.Vector2 = new THREE.Vector2();
  static domListenersAttached: boolean = false;
  static pointerDownPos: { x: number; y: number } = { x: 0, y: 0 };
  /** The last viewport click, to recognise a double-click (pointer events don't count clicks) */
  static lastViewportClick: { x: number; y: number; at: number } = { x: 0, y: 0, at: 0 };
  static DOUBLE_CLICK_MS = 400;

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
    TextSprite3D.onCreateOnObject = (object, text, style, timer) => this.onHostTextSprite(object, text, style, timer);
    this.init3DIndicators();
    this.attachViewportListeners();
    this.scanAvailableModules();
  }

  static notifyChange() {
    this.events.dispatchEvent('change');
  }

  static init3DIndicators() {
    if (!GameState.scene) return;

    if (!this.selectionRing) {
      const geo = new THREE.RingGeometry(0.65, 0.82, 32);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffcc00,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
      });
      this.selectionRing = new THREE.Mesh(geo, mat);
      this.selectionRing.visible = false;
      this.selectionRing.renderOrder = 999;
      GameState.scene.add(this.selectionRing);
    }

    if (!this.placementRing) {
      const geo = new THREE.RingGeometry(0.5, 0.72, 32);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
      });
      this.placementRing = new THREE.Mesh(geo, mat);
      this.placementRing.visible = false;
      this.placementRing.renderOrder = 999;
      GameState.scene.add(this.placementRing);
    }
  }

  static attachViewportListeners() {
    if (this.domListenersAttached || typeof window === 'undefined') return;
    this.domListenersAttached = true;

    window.addEventListener('pointerdown', (e: PointerEvent) => {
      if (!GameState.gmMode) return;
      const target = e.target as HTMLElement;
      if (target && target.closest('.gm-panel-root')) return;
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('pointermove', (e: PointerEvent) => {
      if (!GameState.gmMode) return;
      const target = e.target as HTMLElement;
      if (target && target.closest('.gm-panel-root')) {
        if (this.placementRing) this.placementRing.visible = false;
        return;
      }
      this.updateMouseRaycast(e.clientX, e.clientY);
    });

    // While placing, the mouse wheel turns what's being placed
    window.addEventListener('wheel', (e: WheelEvent) => {
      if (!GameState.gmMode || !this.isPlacementTool(this.activeTool) || !this.isGMUser()) return;
      const target = e.target as HTMLElement;
      if (target && target.closest('.gm-panel-root')) return;
      this.rotatePlacement(e.deltaY > 0 ? this.PLACEMENT_WHEEL_STEP : -this.PLACEMENT_WHEEL_STEP);
    }, { passive: true });

    window.addEventListener('pointerup', (e: PointerEvent) => {
      if (!GameState.gmMode || (e.button !== 0 && e.button !== 2) || !this.isGMUser()) return;
      const target = e.target as HTMLElement;
      if (target && target.closest('.gm-panel-root')) return;

      // Ignore drags (camera rotation)
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      if (Math.hypot(dx, dy) > 6) return;

      // A right-click (not a right-drag, which looks around) puts down the placement or teleport tool
      if (e.button === 2) {
        if (this.activeTool !== 'select') this.setToolMode('select');
        return;
      }

      // In POSSESS mode, let standard KotOR IngameControls handle left-clicks unless a placement/teleport tool is explicitly active
      if (this.controlMode === 'POSSESS' && this.activeTool === 'select') {
        return;
      }

      const last = this.lastViewportClick;
      const now = performance.now();
      const isDoubleClick = now - last.at < this.DOUBLE_CLICK_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) <= 6;
      this.lastViewportClick = isDoubleClick ? { x: 0, y: 0, at: 0 } : { x: e.clientX, y: e.clientY, at: now };

      this.handleViewportClick(e.clientX, e.clientY, isDoubleClick);
    });
  }

  static getActiveThreeCamera(): THREE.Camera {
    if (GameState.Mode === EngineMode.INGAME && GameState.followerCamera) {
      return GameState.followerCamera;
    }
    return GameState.currentCamera || GameState.camera;
  }

  static snapVectorToGrid(pt: THREE.Vector3): THREE.Vector3 {
    const out = pt.clone();
    if (this.gridSnapSize > 0) {
      out.x = Math.round(out.x / this.gridSnapSize) * this.gridSnapSize;
      out.y = Math.round(out.y / this.gridSnapSize) * this.gridSnapSize;
    }
    return out;
  }

  static getGroundZAt(x: number, y: number, fallbackZ: number = 0): number {
    const targets: THREE.Object3D[] = [];
    if (GameState.walkmeshList?.length) targets.push(...GameState.walkmeshList);
    if (GameState.group?.rooms) targets.push(GameState.group.rooms);
    if (!targets.length) return fallbackZ;

    const downRay = new THREE.Raycaster(
      new THREE.Vector3(x, y, fallbackZ + 15),
      new THREE.Vector3(0, 0, -1)
    );
    const hits = downRay.intersectObjects(targets, true);
    if (hits.length > 0) {
      return hits[0].point.z;
    }
    return fallbackZ;
  }

  static PLACEABLE_KEYWORD_LABELS: Record<string, string> = PLACEABLE_KEYWORD_LABELS;

  /** A fresh, uncustomized copy of a placeable preset (lists copied, so edits never reach the preset) */
  static copyPlaceablePreset(preset: GMPlaceableSpawnConfig): GMPlaceableSpawnConfig {
    return {
      ...preset,
      scale: preset.scale ?? 1.0,
      zOffset: preset.zOffset ?? 0,
      modelKeywords: preset.modelKeywords ? [...preset.modelKeywords] : undefined,
      lootResRefs: [...(preset.lootResRefs || [])],
      customized: false,
    };
  }

  static getPlaceableAppearanceLabel(id: number): string {
    const app = GameState.AppearanceManager?.placeableAppearances?.get(id);
    return app?.label && app.label !== '****' ? `${app.label} (#${id})` : `#${id}`;
  }

  static findPlaceableAppearanceByLabel(label?: string): number | null {
    const wanted = (label || '').trim().toLowerCase();
    const map = GameState.AppearanceManager?.placeableAppearances;
    if (!wanted || !map) return null;
    let found: number | null = null;
    map.forEach((app, id) => {
      if (found === null && app && (app.label || '').toLowerCase() === wanted && app.modelname && app.modelname !== '****') {
        found = id;
      }
    });
    return found;
  }

  /**
   * The placeables.2da row a spawn config means: its exact label, else the checked model for its keywords,
   * else a loose keyword search (other games' tables), else its numeric id
   */
  static resolvePlaceableAppearance(config: Pick<GMPlaceableSpawnConfig, 'appearanceId' | 'appearanceLabel' | 'modelKeywords'>): number {
    const byLabel = this.findPlaceableAppearanceByLabel(config.appearanceLabel);
    if (byLabel !== null) return byLabel;
    const firstKeyword = (config.modelKeywords?.[0] || '').toLowerCase();
    const byKeyword = this.findPlaceableAppearanceByLabel(this.PLACEABLE_KEYWORD_LABELS[firstKeyword]);
    if (byKeyword !== null) return byKeyword;
    return this.resolvePlaceableAppearanceId(config.modelKeywords, config.appearanceId ?? 52);
  }

  static resolvePlaceableAppearanceId(keywords?: string[], fallbackId: number = 52): number {
    const map = GameState.AppearanceManager?.placeableAppearances;
    if (!map || map.size === 0) return fallbackId;

    if (Array.isArray(keywords) && keywords.length > 0) {
      for (const kw of keywords) {
        const lowerKw = (kw || '').trim().toLowerCase();
        if (!lowerKw) continue;
        let matchedId = -1;
        map.forEach((app, id) => {
          if (matchedId >= 0 || !app) return;
          const model = (app.modelname || '').toLowerCase();
          const label = (app.label || '').toLowerCase();
          if (!model || model === '****') return;
          if (model.includes(lowerKw) || label.includes(lowerKw)) {
            matchedId = id;
          }
        });
        if (matchedId >= 0) return matchedId;
      }
    }

    const fbApp = map.get(fallbackId);
    if (fbApp && fbApp.modelname && fbApp.modelname !== '****') {
      return fallbackId;
    }

    let firstValid = fallbackId;
    map.forEach((app, id) => {
      if (firstValid === fallbackId && app?.modelname && app.modelname !== '****') {
        firstValid = id;
      }
    });
    return firstValid;
  }

  static updateMouseRaycast(clientX: number, clientY: number) {
    const canvas = GameState.canvas;
    if (!canvas || !GameState.module?.area) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    this.mouseNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    const cam = this.getActiveThreeCamera();
    if (!cam) return;

    this.raycaster.setFromCamera(this.mouseNDC, cam);

    // Raycast against walkmeshes and room models
    const targets: THREE.Object3D[] = [];
    if (GameState.walkmeshList?.length) {
      targets.push(...GameState.walkmeshList);
    }
    if (GameState.group?.rooms) {
      targets.push(GameState.group.rooms);
    }

    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length > 0) {
      const snapped = this.activeTool !== 'select' ? this.snapVectorToGrid(hits[0].point) : hits[0].point.clone();
      this.lastRaycastPoint.copy(snapped);
      this.hasValidRaycastPoint = true;
      if (this.placementRing && this.activeTool !== 'select') {
        const zOff = this.activeTool === 'place_placeable' ? (this.pendingPlaceableConfig.zOffset || 0) : 0;
        this.placementRing.position.set(snapped.x, snapped.y, snapped.z + zOff + 0.08);
        this.placementRing.visible = true;
      } else if (this.placementRing) {
        this.placementRing.visible = false;
      }
    } else {
      this.hasValidRaycastPoint = false;
      if (this.placementRing) this.placementRing.visible = false;
    }
  }

  static async handleViewportClick(clientX: number, clientY: number, isDoubleClick: boolean = false) {
    this.updateMouseRaycast(clientX, clientY);

    if (this.activeTool === 'select') {
      const picked = this.pickObjectAtCursor();
      this.selectObject(picked);
      if (isDoubleClick && picked) {
        // The GM panel opens its Inspect tab on this
        this.events.dispatchEvent('inspect', picked);
      }
      return;
    }

    if (this.isOrderTool(this.activeTool)) {
      this.handleOrderClick();
      return;
    }

    if (!this.hasValidRaycastPoint) return;
    const spawnPos = this.snapVectorToGrid(this.lastRaycastPoint);
    const cam = this.getActiveThreeCamera();
    const baseFacing = cam ? Math.atan2(cam.position.x - spawnPos.x, cam.position.y - spawnPos.y) : 0;
    const yawRad = (this.placementYawOffset * Math.PI) / 180;
    const facing = Utility.NormalizeRadian(baseFacing + yawRad);

    if (this.activeTool === 'place_creature') {
      const creature = await this.spawnCreature(this.pendingCreatureConfig, spawnPos, facing);
      if (creature) this.selectObject(creature);
    } else if (this.activeTool === 'place_placeable') {
      const plc = await this.spawnPlaceable(this.pendingPlaceableConfig, spawnPos, facing);
      if (plc) this.selectObject(plc);
    } else if (this.activeTool === 'place_player') {
      const player = await this.spawnPlayerCharacter(this.pendingPlayerConfig, spawnPos, facing);
      if (player) this.selectObject(player);
      this.setToolMode('select');
    } else if (this.activeTool === 'place_mine') {
      this.placeMine(this.pendingMineType, spawnPos);
    } else if (this.activeTool === 'teleport') {
      const target = this.getTeleportTarget();
      if (target) {
        this.teleportObject(target, spawnPos);
      }
    }
  }

  /** Players joined to someone else's session don't get GM tools */
  static isGMUser(): boolean {
    return GMNetworkManager.role !== 'client';
  }

  static isPlacementTool(tool: GMToolMode): boolean {
    return tool === 'place_creature' || tool === 'place_placeable' || tool === 'place_player' || tool === 'place_mine';
  }

  static rotatePlacement(degrees: number) {
    this.placementYawOffset = ((this.placementYawOffset + degrees) % 360 + 360) % 360;
    this.notifyChange();
  }

  /**
   * What Teleport will move: the selected object, or while playing as a character, that character.
   * Nothing otherwise, so a stray click can't silently move someone.
   */
  static getTeleportTarget(): ModuleObject | null {
    if (this.selectedObject) return this.selectedObject;
    if (this.controlMode === 'POSSESS') return GameState.getCurrentPlayer() || null;
    return null;
  }

  static pickObjectAtCursor(): ModuleObject | null {
    const area = GameState.module?.area;
    if (!area) return null;

    const candidates: ModuleObject[] = [
      ...GameState.PartyManager.party,
      ...area.creatures,
      ...area.placeables,
      ...area.doors
    ];

    // First try 3D mesh raycast
    const meshes: THREE.Object3D[] = [];
    for (const obj of candidates) {
      if (obj?.container) meshes.push(obj.container);
    }

    const hits = this.raycaster.intersectObjects(meshes, true);
    for (const hit of hits) {
      let cur: THREE.Object3D | null = hit.object;
      while (cur) {
        if (cur.userData?.moduleObject) {
          return cur.userData.moduleObject as ModuleObject;
        }
        const match = candidates.find(c => c.container === cur || c.model === cur);
        if (match) return match;
        cur = cur.parent;
      }
    }

    // Fallback: closest object to walkmesh intersection point within 1.75m
    if (this.hasValidRaycastPoint) {
      let best: ModuleObject | null = null;
      let bestDist = 1.75;
      for (const obj of candidates) {
        if (!obj?.position) continue;
        const d = Math.hypot(obj.position.x - this.lastRaycastPoint.x, obj.position.y - this.lastRaycastPoint.y);
        if (d < bestDist) {
          bestDist = d;
          best = obj;
        }
      }
      return best;
    }

    return null;
  }

  static isOrderTool(tool: GMToolMode): boolean {
    return tool === 'order_move' || tool === 'order_attack' || tool === 'order_follow' || tool === 'order_patrol';
  }

  /** The placement tool the toolbar's Place button turns on: the last one used */
  static lastPlacementTool: GMToolMode = 'place_creature';

  static setToolMode(tool: GMToolMode) {
    const previous = this.activeTool;
    if (this.isPlacementTool(tool)) this.lastPlacementTool = tool;
    if (previous === 'order_patrol' && tool !== 'order_patrol') this.finishPatrolOrder();
    if (this.isOrderTool(previous) && !this.isOrderTool(tool)) this.orderSubject = null;
    this.activeTool = tool;
    if (this.placementRing) {
      if (tool === 'select') {
        this.placementRing.visible = false;
      } else {
        const mat = this.placementRing.material as THREE.MeshBasicMaterial;
        if (tool === 'place_creature') mat.color.setHex(0xff5555);
        else if (tool === 'place_placeable') mat.color.setHex(0xffaa00);
        else if (tool === 'place_player') mat.color.setHex(0x00ff88);
        else if (tool === 'teleport') mat.color.setHex(0x00e5ff);
        else if (this.isOrderTool(tool)) mat.color.setHex(0xffd740);
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

  static getCameraTargetSpawnPoint(distance: number = 3.5): { position: THREE.Vector3; facing: number } {
    if (this.controlMode === 'POSSESS' && GameState.getCurrentPlayer()) {
      const p = GameState.getCurrentPlayer();
      const angle = p.getFacing();
      const pos = new THREE.Vector3(
        p.position.x - Math.sin(angle) * 2.5,
        p.position.y + Math.cos(angle) * 2.5,
        p.position.z
      );
      return { position: pos, facing: Utility.NormalizeRadian(angle + Math.PI) };
    }

    const cam = this.getActiveThreeCamera();
    if (!cam) {
      const area = GameState.module?.area;
      return {
        position: new THREE.Vector3(area?.module?.entryX || 0, area?.module?.entryY || 0, area?.module?.entryZ || 0),
        facing: 0
      };
    }

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const ray = new THREE.Raycaster(cam.position.clone(), forward.clone().normalize());
    const targets: THREE.Object3D[] = [];
    if (GameState.walkmeshList?.length) targets.push(...GameState.walkmeshList);
    if (GameState.group?.rooms) targets.push(GameState.group.rooms);

    const hits = ray.intersectObjects(targets, true);
    if (hits.length > 0 && hits[0].distance < 35) {
      const pt = hits[0].point.clone();
      const facing = Math.atan2(cam.position.x - pt.x, cam.position.y - pt.y);
      return { position: pt, facing };
    }

    // Fallback: project forward and snap Z down onto walkmesh
    const fallbackPos = cam.position.clone().addScaledVector(forward, distance);
    const downRay = new THREE.Raycaster(
      new THREE.Vector3(fallbackPos.x, fallbackPos.y, fallbackPos.z + 10),
      new THREE.Vector3(0, 0, -1)
    );
    const downHits = downRay.intersectObjects(targets, true);
    if (downHits.length > 0) {
      fallbackPos.z = downHits[0].point.z;
    } else if (GameState.module) {
      fallbackPos.z = GameState.module.entryZ || 0;
    }
    const facing = Math.atan2(cam.position.x - fallbackPos.x, cam.position.y - fallbackPos.y);
    return { position: fallbackPos, facing };
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
          sheet: this.buildPlayerSheet(obj as ModuleCreature),
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
          const pc = await this.spawnPlayerCharacter(saved.config, entryAt(savedPlayerConfigs.length + i), 0, saved.netId);
          if (!pc) continue;
          pc.gmInventory = saved.sheet.inventory.map((e) => ({ ...e }));
          await this.syncEquipmentTo(pc, saved.sheet.equipment);
          this.setCreatureHP(pc, saved.sheet.hp, saved.sheet.maxHp);
        }
        for (let i = 0; i < savedPlayerConfigs.length; i++) {
          await this.spawnPlayerCharacter({ ...savedPlayerConfigs[i], possessImmediately: wasPossessing && i === 0 }, entryAt(i), 0);
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
    this.init3DIndicators();
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
   * Objects the area loads with the module are spawned by the area (ModuleArea.initAreaObjects); ones the GM
   * adds later are not. Without it they can't perceive or see anything (hasLineOfSight needs it), so NPCs
   * never notice enemies. Module scripts stay off in GM scenes, so their OnSpawn script doesn't run.
   */
  static markSpawned(obj: ModuleObject) {
    if (obj && !obj.spawned) obj.onSpawn(false);
  }

  /** A creature's appearance.2da row: its exact label if it has one, else its id */
  static resolveCreatureAppearance(config: Pick<GMCreatureSpawnConfig, 'appearanceId' | 'appearanceLabel'>): number {
    if (config.appearanceLabel) {
      const map = GameState.AppearanceManager?.appearances;
      if (map) {
        const wanted = config.appearanceLabel.toLowerCase();
        for (const [id, app] of map) {
          if (app?.label && app.label.toLowerCase() === wanted) return id;
        }
      }
    }
    return config.appearanceId ?? 28;
  }

  static creatureTemplateIndex: GMCreatureTemplateInfo[] | null = null;
  static creatureTemplateIndexLoading: Promise<GMCreatureTemplateInfo[]> | null = null;

  /** Read a creature template (.utc): its name, look, faction, stats, class and gear */
  static async describeCreatureTemplate(resRef: string): Promise<GMCreatureTemplateInfo | null> {
    const key = (resRef || '').toLowerCase();
    const buffer = await GMTemplates.loadBuffer(ResourceTypes.utc, key);
    if (!buffer) return null;
    try {
      const root = new GFFObject(buffer).RootNode;
      const value = (label: string, fallback: any = 0) => root.hasField(label) ? root.getFieldByLabel(label).getValue() : fallback;
      const first = root.hasField('FirstName') ? root.getFieldByLabel('FirstName').getCExoLocString().getValue() : '';
      const last = root.hasField('LastName') ? root.getFieldByLabel('LastName').getCExoLocString().getValue() : '';
      const appearanceId = Number(value('Appearance_Type', 0));
      const classRows = GameState.TwoDAManager?.datatables.get('classes')?.rows || {};
      const classStructs = root.hasField('ClassList') ? root.getFieldByLabel('ClassList').getChildStructs() : [];
      const classes = classStructs.map((st) => {
        const id = st.getFieldByLabel('Class')?.getValue() ?? 0;
        const row = classRows[id];
        const name = row ? (GameState.TLKManager?.GetStringById(Number(row.name))?.Value || row.label) : 'Class ' + id;
        return { id, level: Number(st.getFieldByLabel('ClassLevel')?.getValue() ?? 1), name };
      });
      const gear = root.hasField('Equip_ItemList') ? root.getFieldByLabel('Equip_ItemList').getChildStructs() : [];
      const slot = (s: number) => gear.find((st) => st.type === s)?.getFieldByLabel('EquippedRes')?.getValue() || '';
      return {
        resRef: key,
        name: [first, last].filter(Boolean).join(' ') || key,
        appearanceId,
        appearanceLabel: GameState.AppearanceManager?.appearances.get(appearanceId)?.label || '',
        factionId: Number(value('FactionID', 5)),
        hp: Number(value('MaxHitPoints', 0)) || Number(value('HitPoints', 0)),
        fp: Number(value('ForcePoints', 0)),
        level: classes.reduce((sum, c) => sum + c.level, 0) || 1,
        classId: classes[0]?.id ?? 0,
        classes: classes.map((c) => `${c.name} ${c.level}`).join(' / '),
        rightHandResRef: slot(ModuleCreatureArmorSlot.RIGHTHAND),
        leftHandResRef: slot(ModuleCreatureArmorSlot.LEFTHAND),
        armorResRef: slot(ModuleCreatureArmorSlot.ARMOR),
      };
    } catch (e) {
      return null;
    }
  }

  /** Every creature template the game has (read once, then cached), for the template browser */
  static async loadCreatureTemplateIndex(): Promise<GMCreatureTemplateInfo[]> {
    if (this.creatureTemplateIndex) return this.creatureTemplateIndex;
    if (!this.creatureTemplateIndexLoading) {
      this.creatureTemplateIndexLoading = (async () => {
        const out: GMCreatureTemplateInfo[] = [];
        for (const resRef of this.getAvailableUTCTemplates()) {
          const info = await this.describeCreatureTemplate(resRef);
          if (info) out.push(info);
        }
        out.sort((a, b) => a.name.localeCompare(b.name) || a.resRef.localeCompare(b.resRef));
        this.creatureTemplateIndex = out;
        return out;
      })().finally(() => { this.creatureTemplateIndexLoading = null; });
    }
    return this.creatureTemplateIndexLoading;
  }

  /** Place a template exactly as the game has it (its own faction too) */
  static creatureConfigFromTemplate(info: GMCreatureTemplateInfo): GMCreatureSpawnConfig {
    return {
      name: info.name,
      templateResRef: info.resRef,
      appearanceId: info.appearanceId,
      appearanceLabel: info.appearanceLabel || undefined,
      factionId: info.factionId,
      hp: info.hp,
      level: info.level,
      classId: info.classId,
    };
  }

  /**
   * Spawn a Creature / NPC in the current area
   */
  static async spawnCreature(
    config: GMCreatureSpawnConfig,
    position?: THREE.Vector3,
    facing?: number,
    existingNetId?: string
  ): Promise<ModuleCreature | null> {
    const area = GameState.module?.area;
    if (!area) return null;

    const targetLoc = position
      ? { position: position.clone(), facing: facing ?? 0 }
      : this.getCameraTargetSpawnPoint(3.5);

    const template = await GMTemplates.load(ResourceTypes.utc, config.templateResRef);
    const loadedFromUTC = !!template;
    const gff = template || new GFFObject();

    const root = gff.RootNode;
    // Remove TemplateResRef so creature.load() does not re-merge the unmodified .utc over our custom fields
    root.removeFieldByLabel('TemplateResRef');
    const setOrAdd = (type: GFFDataType, label: string, val: any) => GMTemplates.set(root, type, label, val);

    // A template keeps its own look, stats and gear unless the GM customized them
    const useConfig = !loadedFromUTC || !!config.customized;
    if (useConfig) {
      setOrAdd(GFFDataType.WORD, 'Appearance_Type', this.resolveCreatureAppearance(config));
    }
    const targetHp = config.hp || 50;
    setOrAdd(GFFDataType.WORD, 'FactionID', config.factionId ?? GMFaction.HOSTILE);
    if (useConfig) {
      setOrAdd(GFFDataType.WORD, 'HitPoints', targetHp);
      setOrAdd(GFFDataType.WORD, 'CurrentHitPoints', targetHp);
      setOrAdd(GFFDataType.WORD, 'MaxHitPoints', targetHp);
    }

    if (config.name) {
      GMTemplates.setText(root, 'FirstName', config.name);
      if (root.hasField('LastName')) GMTemplates.setText(root, 'LastName', '');
    }

    if (!loadedFromUTC) {
      setOrAdd(GFFDataType.BYTE, 'Str', 14);
      setOrAdd(GFFDataType.BYTE, 'Dex', 14);
      setOrAdd(GFFDataType.BYTE, 'Con', 14);
      setOrAdd(GFFDataType.BYTE, 'Int', 10);
      setOrAdd(GFFDataType.BYTE, 'Wis', 12);
      setOrAdd(GFFDataType.BYTE, 'Cha', 10);
      setOrAdd(GFFDataType.BYTE, 'NaturalAC', 2);
      setOrAdd(GFFDataType.BYTE, 'PerceptionRange', 13);
      setOrAdd(GFFDataType.BYTE, 'Race', 6);
      setOrAdd(GFFDataType.RESREF, 'ScriptAttacked', 'k_def_attacked01');
      setOrAdd(GFFDataType.RESREF, 'ScriptDamaged', 'k_def_damage01');
      setOrAdd(GFFDataType.RESREF, 'ScriptDeath', 'k_def_death01');
      setOrAdd(GFFDataType.RESREF, 'ScriptDialogue', 'k_def_dialogue01');
      setOrAdd(GFFDataType.RESREF, 'ScriptEndRound', 'k_def_combend01');
      setOrAdd(GFFDataType.RESREF, 'ScriptHeartbeat', 'k_def_heartbt01');
      setOrAdd(GFFDataType.RESREF, 'ScriptOnBlocked', 'k_def_blocked01');
      setOrAdd(GFFDataType.RESREF, 'ScriptOnNotice', 'k_def_percept01');
      setOrAdd(GFFDataType.RESREF, 'ScriptSpawn', 'k_def_spawn01');

      // What its class gives it at this level: feats, Force powers, skills and Force points
      const abilities = CharacterBuilder.build({
        classId: config.classId ?? 0,
        level: config.level || 4,
        attributes: { str: 14, dex: 14, con: 14, int: 12, wis: 14, cha: 12 },
        alignment: config.factionId === GMFaction.HOSTILE ? 'dark' : 'light',
      });
      GMTemplates.writeBuild(root, abilities, config.classId ?? 0, config.level || 4);
    }

    // Gear. Customized (or built without a template): the hands and armour are what the config says, '' for
    // empty. From a template: its own gear, with the config only filling an empty hand. Either way the template's
    // other slots (creature claws and hides, belts, implants) stay.
    GMTemplates.writeGear(root, config, useConfig);

    setOrAdd(GFFDataType.FLOAT, 'XPosition', targetLoc.position.x);
    setOrAdd(GFFDataType.FLOAT, 'YPosition', targetLoc.position.y);
    setOrAdd(GFFDataType.FLOAT, 'ZPosition', targetLoc.position.z);
    setOrAdd(GFFDataType.FLOAT, 'XOrientation', -Math.sin(targetLoc.facing));
    setOrAdd(GFFDataType.FLOAT, 'YOrientation', Math.cos(targetLoc.facing));

    const creature = new ModuleCreature(gff);
    // Its network id is fixed before it joins the area: world updates sent while its model loads must not
    // give it a second id (players would get a frozen duplicate)
    const netId = existingNetId || this.getNextNetId('cre');
    this.registerNetObject(netId, creature);
    creature.gmSpawning = true;
    creature.gmSpawnConfig = { ...config };
    if (config.barkText) {
      creature.gmBarkText = config.barkText;
    }
    if (config.stance) creature.setHeldStance(config.stance);

    area.attachObject(creature);
    creature.load();
    creature.firstName = config.name || creature.firstName;
    if (useConfig) {
      this.setCreatureHP(creature, targetHp, targetHp);
    } else {
      // Some templates' current HP is above their maximum (it includes their Constitution bonus): start at full
      const full = Math.max(creature.getHP() || 0, creature.getMaxHP() || 0);
      if (full > 0) this.setCreatureHP(creature, full, full);
    }
    this.assignFaction(creature, config.factionId ?? GMFaction.HOSTILE);
    if (Array.isArray(config.lootResRefs)) {
      for (const resRef of config.lootResRefs) {
        if (resRef) creature.inventory.push(await this.createItemFromResRefAsync(resRef));
      }
    }

    const model = await creature.loadModel();
    if (model) {
      model.userData.moduleObject = creature;
      model.hasCollision = true;
    }
    creature.position.copy(targetLoc.position);
    creature.setFacing(targetLoc.facing, true);
    GameState.group.creatures.add(creature.container);

    creature.getCurrentRoom();
    creature.computeBoundingBox(true);
    this.markSpawned(creature);
    delete creature.gmSpawning;

    if (!existingNetId && GMNetworkManager.role !== 'offline') {
      GMNetworkManager.broadcastActorSpawn(this.serializeSingleActor(creature));
    }

    this.notifyChange();
    return creature;
  }

  /**
   * Spawn an interactive Placeable or Container in the current area
   */
  static async spawnPlaceable(
    config: GMPlaceableSpawnConfig,
    position?: THREE.Vector3,
    facing?: number,
    existingNetId?: string
  ): Promise<ModulePlaceable | null> {
    const area = GameState.module?.area;
    if (!area) return null;

    const targetLoc = position
      ? { position: position.clone(), facing: facing ?? 0 }
      : this.getCameraTargetSpawnPoint(3.0);

    if (typeof config.zOffset === 'number' && config.zOffset !== 0) {
      targetLoc.position.z += config.zOffset;
    }

    const template = await GMTemplates.load(ResourceTypes.utp, config.templateResRef);
    const fromTemplate = !!template;
    const gff = template || new GFFObject();
    // A template keeps its own model, name and settings unless the GM customized them
    const useConfig = !fromTemplate || !!config.customized;
    const resolvedAppearanceId = useConfig
      ? this.resolvePlaceableAppearance(config)
      : (gff.RootNode.getFieldByLabel('Appearance')?.getValue() ?? this.resolvePlaceableAppearance(config));

    const root = gff.RootNode;
    root.removeFieldByLabel('TemplateResRef');
    const setOrAdd = (type: GFFDataType, label: string, val: any) => GMTemplates.set(root, type, label, val);

    if (useConfig) {
      GMTemplates.setText(root, 'LocName', config.name || 'Interactive Object');

      setOrAdd(GFFDataType.DWORD, 'Appearance', resolvedAppearanceId);
      setOrAdd(GFFDataType.BYTE, 'Useable', config.useable ? 1 : 0);
      setOrAdd(GFFDataType.BYTE, 'HasInventory', config.hasInventory ? 1 : 0);
      setOrAdd(GFFDataType.BYTE, 'Locked', config.locked ? 1 : 0);
      setOrAdd(GFFDataType.BYTE, 'OpenLockDC', config.openLockDC || 15);
      setOrAdd(GFFDataType.SHORT, 'HP', 50);
      setOrAdd(GFFDataType.SHORT, 'CurrentHP', 50);
    }
    // Placed objects can always be moved and interacted with
    setOrAdd(GFFDataType.BYTE, 'Static', 0);
    setOrAdd(GFFDataType.FLOAT, 'X', targetLoc.position.x);
    setOrAdd(GFFDataType.FLOAT, 'Y', targetLoc.position.y);
    setOrAdd(GFFDataType.FLOAT, 'Z', targetLoc.position.z);
    setOrAdd(GFFDataType.FLOAT, 'Bearing', targetLoc.facing);

    const plc = new ModulePlaceable(gff);
    const netId = existingNetId || this.getNextNetId('plc');
    this.registerNetObject(netId, plc);
    plc.gmSpawning = true;
    if (config.barkText) {
      plc.gmBarkText = config.barkText;
    }
    const scale = typeof config.scale === 'number' && config.scale > 0 ? config.scale : 1.0;
    plc.gmScale = scale;
    if (config.skillGate) plc.gmSkillGate = { ...config.skillGate };
    plc.gmSpawnConfig = {
      ...config,
      appearanceId: resolvedAppearanceId,
      scale,
      lootResRefs: Array.isArray(config.lootResRefs) ? [...config.lootResRefs] : []
    };

    area.attachObject(plc);
    plc.load();
    if (useConfig) {
      plc.appearance = resolvedAppearanceId;
      plc.useable = config.useable;
      plc.hasInventory = config.hasInventory;
      plc.locked = config.locked;
      plc.openLockDC = config.openLockDC || 15;
    }
    plc.position.copy(targetLoc.position);
    plc.bearing = targetLoc.facing;
    plc.rotation.set(0, 0, targetLoc.facing);

    // Populate container inventory items (on top of any the template carries)
    if ((useConfig ? config.hasInventory : plc.hasInventory) && Array.isArray(config.lootResRefs)) {
      for (const itemRes of config.lootResRefs) {
        if (!itemRes) continue;
        await this.addItemToObjectAsync(plc, itemRes);
      }
    }

    const model = await plc.loadModel();
    if (plc.container && scale !== 1.0) {
      plc.container.scale.setScalar(scale);
    }
    GameState.group.placeables.add(plc.container);

    if (model) {
      const pwk = await plc.loadWalkmesh(model.name);
      if (pwk?.mesh instanceof THREE.Object3D && pwk.faces && pwk.faces.length > 0) {
        GameState.walkmeshList.push(pwk.mesh);
        pwk.mat4.makeRotationFromEuler(plc.rotation);
        pwk.mat4.setPosition(plc.position.x, plc.position.y, plc.position.z + 0.01);
        pwk.mesh.geometry.applyMatrix4(pwk.mat4);
        pwk.updateMatrix();
        pwk.buildEdgeNormalHelpers();
        GameState.group.room_walkmeshes.add(pwk.mesh);
      }
    }

    plc.getCurrentRoom();
    plc.computeBoundingBox(true);
    this.markSpawned(plc);
    delete plc.gmSpawning;

    if (!existingNetId && GMNetworkManager.role !== 'offline') {
      GMNetworkManager.broadcastActorSpawn(this.serializeSingleActor(plc));
    }

    this.notifyChange();
    return plc;
  }

  /**
   * Spawn a playable Player Character in the current area
   */
  /**
   * A player character's feats, Force powers, skill ranks, vitality and Force points: what its class and level
   * give it by the game's rules (CharacterBuilder), unless the config sets them explicitly
   */
  static buildPlayerAbilities(config: Partial<GMPlayerSpawnConfig>): ICharacterBuild {
    const build = CharacterBuilder.build({
      classId: config.classId ?? 3,
      level: config.level || 1,
      attributes: {
        str: config.str || 14,
        dex: config.dex || 14,
        con: config.con || 14,
        int: config.int || 12,
        wis: config.wis || 14,
        cha: config.cha || 14,
      },
      alignment: config.alignment,
    });
    if (Array.isArray(config.featIds) && config.featIds.length) build.feats = [...config.featIds];
    if (Array.isArray(config.spellIds) && config.spellIds.length) build.powers = [...config.spellIds];
    if (typeof config.hp === 'number' && config.hp > 0) build.maxHp = config.hp;
    if (typeof config.fp === 'number' && config.fp >= 0) build.maxFp = config.fp;
    return build;
  }

  static async spawnPlayerCharacter(
    config: GMPlayerSpawnConfig,
    position?: THREE.Vector3,
    facing?: number,
    existingNetId?: string
  ): Promise<ModulePlayer | null> {
    const area = GameState.module?.area;
    if (!area) return null;

    const targetLoc = position
      ? { position: position.clone(), facing: facing ?? 0 }
      : this.getCameraTargetSpawnPoint(3.0);

    const abilities = this.buildPlayerAbilities(config);
    const template = new GFFObject();
    const root = template.RootNode;
    const set = (type: GFFDataType, label: string, val: any) => GMTemplates.set(root, type, label, val);

    set(GFFDataType.DWORD, 'ObjectId', GameState.ModuleObjectManager.GetNextPlayerId());
    set(GFFDataType.WORD, 'Appearance_Type', config.appearanceId ?? 136);
    set(GFFDataType.WORD, 'PortraitId', config.portraitId ?? 15);
    set(GFFDataType.BYTE, 'Gender', config.gender ?? 0);
    set(GFFDataType.WORD, 'FactionID', GMFaction.PARTY);
    GMTemplates.setText(root, 'FirstName', config.name || 'Player Character');
    GMTemplates.setText(root, 'LastName', '');
    set(GFFDataType.WORD, 'HitPoints', abilities.maxHp);
    set(GFFDataType.WORD, 'CurrentHitPoints', abilities.maxHp);
    set(GFFDataType.WORD, 'MaxHitPoints', abilities.maxHp);
    set(GFFDataType.BYTE, 'Str', config.str || 14);
    set(GFFDataType.BYTE, 'Dex', config.dex || 14);
    set(GFFDataType.BYTE, 'Con', config.con || 14);
    set(GFFDataType.BYTE, 'Int', config.int || 12);
    set(GFFDataType.BYTE, 'Wis', config.wis || 14);
    set(GFFDataType.BYTE, 'Cha', config.cha || 14);
    set(GFFDataType.BYTE, 'GoodEvil', 50);
    set(GFFDataType.BYTE, 'NaturalAC', 2);
    set(GFFDataType.BYTE, 'PerceptionRange', 13);
    set(GFFDataType.WORD, 'SoundSetFile', config.gender === 1 ? 83 : 85);
    set(GFFDataType.BYTE, 'Race', 6);

    // Scripts for party/player behavior
    set(GFFDataType.RESREF, 'ScriptAttacked', 'k_hen_attacked01');
    set(GFFDataType.RESREF, 'ScriptDamaged', 'k_hen_damage01');
    set(GFFDataType.RESREF, 'ScriptDialogue', 'k_hen_dialogue01');
    set(GFFDataType.RESREF, 'ScriptEndRound', 'k_hen_combend01');
    set(GFFDataType.RESREF, 'ScriptHeartbeat', 'k_hen_heartbt01');
    set(GFFDataType.RESREF, 'ScriptOnBlocked', 'k_hen_blocked01');
    set(GFFDataType.RESREF, 'ScriptOnNotice', 'k_hen_percept01');
    set(GFFDataType.RESREF, 'ScriptSpawn', 'k_hen_spawn01');

    // Class, Force powers, feats, skills and Force points, then gear
    GMTemplates.writeBuild(root, abilities, config.classId ?? 3, config.level || 8);
    GMTemplates.writeGear(root, config, true);

    const player = new ModulePlayer(template);
    player.gmPlayerConfig = { ...config };
    if (config.ownerPeerId) {
      player.gmOwnerPeerId = config.ownerPeerId;
    }
    player.npcId = -1;
    player.load();
    this.setCreatureHP(player, abilities.maxHp, abilities.maxHp);

    // Ensure runtime feats & spells are populated if not already
    {
      for (const fId of abilities.feats) {
        if (!player.getHasFeat(fId)) {
          player.addFeat(TalentFeat.From2DA({ __index: fId, ...(GameState.TwoDAManager.datatables.get('feat')?.rows?.[fId] || {}) }));
        }
      }
    }
    if (player.classes[0]) {
      for (const sId of abilities.powers) {
        if (!player.classes[0].spells.some(s => s.id === sId)) {
          player.classes[0].addSpell(new TalentSpell(sId));
        }
      }
    }

    // Starter items (Medpacs, Security Spikes). A network player's inventory is kept by the host
    // and sent to them; only characters controlled on this machine use the local inventory.
    const starterItems: GMLootItem[] = [{ resRef: 'g_i_medeqpmnt02', stack: 1 }, { resRef: 'g_i_secspike01', stack: 1 }];
    if (!config.ownerPeerId) {
      for (const entry of starterItems) {
        GameState.InventoryManager.addItem(await this.createItemFromResRefAsync(entry.resRef));
      }
    } else if (GMNetworkManager.role === 'host') {
      this.addToPlayerInventory(player, starterItems);
    }

    return this.admitPlayer(player, targetLoc, {
      netIdPrefix: 'pc',
      existingNetId,
      // Other players' characters are world creatures here, not members of this machine's 3-slot party;
      // that keeps them off our HUD and out of party AI, and lets any number of players join
      remote: !!config.ownerPeerId && config.ownerPeerId !== GMNetworkManager.peerId,
      possess: !!config.possessImmediately,
    });
  }

  /**
   * Put a newly built player character into the scene: its model, the party (or the area, for another
   * player's character or a full party), a network id, players told about it, and possessed if asked
   */
  static async admitPlayer(
    player: ModulePlayer,
    loc: { position: THREE.Vector3; facing: number },
    opts: { netIdPrefix: string; existingNetId?: string; remote?: boolean; leadParty?: boolean; possess?: boolean }
  ): Promise<ModulePlayer> {
    const area = GameState.module.area;
    const model = await player.loadModel();
    if (model) {
      model.userData.moduleObject = player;
      model.hasCollision = true;
    }

    player.position.copy(loc.position);
    player.setFacing(loc.facing, true);

    if (!this.spawnedPlayers.includes(player)) {
      this.spawnedPlayers.push(player);
    }
    const party = GameState.PartyManager.party;
    if (opts.remote) {
      GameState.group.creatures.add(player.container);
      area.attachObject(player);
    } else {
      GameState.group.party.add(player.container);
      if (!party.includes(player)) {
        if (opts.leadParty) {
          party.unshift(player);
          if (party.length > 3) party.length = 3;
        } else if (party.length < 3) {
          party.push(player);
        } else {
          area.attachObject(player);
        }
      }
    }

    player.getCurrentRoom();
    player.computeBoundingBox(true);
    this.markSpawned(player);

    this.registerNetObject(opts.existingNetId || this.getNextNetId(opts.netIdPrefix), player);
    if (!opts.existingNetId && GMNetworkManager.role !== 'offline') {
      GMNetworkManager.broadcastActorSpawn(this.serializeSingleActor(player));
    }

    if (opts.possess) {
      this.possessCharacter(player);
    }

    this.notifyChange();
    return player;
  }

  /**
   * Load a Player Character from a SaveGame instance
   */
  static async loadPlayerFromSaveGame(saveGame: SaveGame, possessImmediately: boolean = true): Promise<ModulePlayer | null> {
    if (!saveGame || !GameState.module?.area) return null;
    try {
      await saveGame.initSaveGameResourceLoader();
      await saveGame.loadPIFO();
      await saveGame.loadPC();

      let template = saveGame.pc || GameState.PartyManager.PlayerTemplate;
      if (!template) {
        console.warn('[GMManager] SaveGame did not contain a valid PC template');
        return null;
      }

      const targetLoc = this.getCameraTargetSpawnPoint(3.0);
      const player = new ModulePlayer(template);
      player.npcId = -1;
      player.load();
      if (saveGame.PCNAME) {
        player.firstName = saveGame.PCNAME;
      }
      return await this.admitPlayer(player, targetLoc, { netIdPrefix: 'pc_save', possess: possessImmediately });
    } catch (e) {
      console.error('[GMManager] Failed to load PC from SaveGame:', e);
      return null;
    }
  }

  /**
   * Import a Player Character from an uploaded .utc file buffer
   */
  static async importPlayerFromUTCBuffer(buffer: Uint8Array, customName?: string, possessImmediately: boolean = true): Promise<ModulePlayer | null> {
    if (!buffer || !GameState.module?.area) return null;
    try {
      const gff = new GFFObject(buffer);
      const targetLoc = this.getCameraTargetSpawnPoint(3.0);
      const player = new ModulePlayer(gff);
      player.npcId = -1;
      player.load();
      if (customName) {
        player.firstName = customName;
      }
      this.assignFaction(player, GMFaction.PARTY);
      return await this.admitPlayer(player, targetLoc, { netIdPrefix: 'pc_utc', leadParty: true, possess: possessImmediately });
    } catch (e) {
      console.error('[GMManager] Failed to import UTC player:', e);
      return null;
    }
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
    if (this.placementRing) this.placementRing.visible = false;

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
      GMNetworkManager.broadcastActorUpdate(this.serializeSingleActor(cre));
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
      GMNetworkManager.broadcastActorUpdate(this.serializeSingleActor(obj));
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
      GMNetworkManager.broadcastActorUpdate(this.serializeSingleActor(obj));
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
      GMNetworkManager.broadcastActorUpdate(this.serializeSingleActor(obj));
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

  /**
   * Client: the GM teleported a character. Our own character is moved here, since we normally ignore the
   * host's position for it; anyone else's just snaps.
   */
  static applyTeleportOnClient(payload: { netId: string; x: number; y: number; z: number; seq?: number }) {
    const obj = this.netIdMap.get(payload.netId);
    if (!obj) return;
    this.placeAt(obj, new THREE.Vector3(payload.x, payload.y, payload.z));
    if (payload.netId === GMNetworkManager.assignedActorNetId) {
      GMNetworkManager.teleportSeq = Math.max(GMNetworkManager.teleportSeq, payload.seq || 0);
      GMNetworkManager.awaitingHost = false;
    }
    this.notifyChange();
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
      GMNetworkManager.broadcastActorUpdate(this.serializeSingleActor(obj));
    }
    this.notifyChange();
  }

  // =========================================================================
  // Stances and gestures
  // =========================================================================

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
      GMNetworkManager.broadcastActorUpdate(this.serializeSingleActor(cre));
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
      GMNetworkManager.broadcastActorUpdate(this.serializeSingleActor(obj));
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
        GMNetworkManager.broadcastActorUpdate(this.serializeSingleActor(plc));
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
        GMNetworkManager.broadcastActorUpdate(this.serializeSingleActor(plc));
      }
    }
    this.notifyChange();
  }

  static async createItemFromResRefAsync(itemResRef: string): Promise<ModuleItem> {
    const resKey = itemResRef.toLowerCase().trim();
    const buffer = await GMTemplates.loadBuffer(ResourceTypes.uti, resKey);
    if (buffer) {
      const gff = new GFFObject(buffer);
      const item = new ModuleItem(gff);
      item.equippedRes = resKey;
      item.inventoryRes = resKey;
      if (!item.stackSize || item.stackSize < 1) item.stackSize = 1;
      item.initProperties();
      return item;
    }
    const item = new ModuleItem();
    item.equippedRes = resKey;
    item.inventoryRes = resKey;
    item.stackSize = 1;
    item.load();
    return item;
  }

  static async addItemToObjectAsync(obj: ModuleObject, itemResRef: string): Promise<ModuleItem | null> {
    if (!obj || !itemResRef) return null;
    try {
      const item = await this.createItemFromResRefAsync(itemResRef);
      if (GMObjectKind.isPlaceable(obj)) {
        const plc = obj as ModulePlaceable;
        plc.hasInventory = true;
        plc.useable = true;
        plc.inventory.push(item);
      } else if (GMObjectKind.isCreature(obj)) {
        GameState.InventoryManager.addItem(item);
      }
      this.notifyChange();
      return item;
    } catch (e) {
      console.error('[GMManager] Failed to add item async:', e);
      return null;
    }
  }

  static addItemToObject(obj: ModuleObject, itemResRef: string): ModuleItem | null {
    if (!obj || !itemResRef) return null;
    try {
      const resKey = itemResRef.toLowerCase().trim();
      const buffer = ResourceLoader.loadCachedResource(ResourceTypes.uti, resKey);
      const item = buffer ? new ModuleItem(new GFFObject(buffer)) : new ModuleItem();
      item.equippedRes = resKey;
      item.inventoryRes = resKey;
      if (!item.stackSize || item.stackSize < 1) item.stackSize = 1;
      if (!buffer) {
        item.load();
        // Also asynchronously hydrate from BIF if not in cache yet
        ResourceLoader.loadResource(ResourceTypes.uti, resKey).then((asyncBuf) => {
          if (asyncBuf && item.template) {
            item.template.merge(new GFFObject(asyncBuf));
            item.loaded = false;
            item.initProperties();
          }
        }).catch(() => {});
      } else {
        item.initProperties();
      }
      if (GMObjectKind.isPlaceable(obj)) {
        const plc = obj as ModulePlaceable;
        plc.hasInventory = true;
        plc.useable = true;
        plc.inventory.push(item);
      } else if (GMObjectKind.isCreature(obj)) {
        GameState.InventoryManager.addItem(item);
      }
      this.notifyChange();
      return item;
    } catch (e) {
      console.error('[GMManager] Failed to add item:', e);
      return null;
    }
  }

  static async equipWeaponOnCreature(creature: ModuleCreature, slot: ModuleCreatureArmorSlot, itemResRef: string) {
    if (!creature) return;
    try {
      if (!itemResRef) {
        creature.unequipSlot(slot);
      } else {
        const item = await this.createItemFromResRefAsync(itemResRef);
        await creature.equipItem(slot, item);
      }
      if (GMNetworkManager.role !== 'offline') {
        GMNetworkManager.broadcastActorUpdate(this.serializeSingleActor(creature));
      }
      this.notifyChange();
    } catch (e) {
      console.error('[GMManager] Failed to equip item on creature:', e);
    }
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
   * Duplicate / Clone an existing Placeable or Creature slightly offset from its current position
   */
  static async duplicateObject(obj: ModuleObject): Promise<ModuleObject | null> {
    if (!obj || !GameState.module?.area) return null;
    const described = this.describeObject(obj);
    if (!described) return null;
    const offsetPos = new THREE.Vector3(obj.position.x + 1.5, obj.position.y + 1.0, obj.position.z);
    const cloned = await this.spawnDescribed(described, offsetPos, this.facingOf(obj));
    if (cloned) this.selectObject(cloned);
    return cloned;
  }

  // =========================================================================
  // Describing objects as spawn configs (duplicating, kits, saved sessions)
  // =========================================================================

  /** A creature's hands and armour as item resrefs ('' for empty) */
  static gearOf(cre: ModuleCreature): Required<GMGear> {
    const eq = cre?.equipment;
    return {
      rightHandResRef: eq?.RIGHTHAND?.getEquippedRes() || '',
      leftHandResRef: eq?.LEFTHAND?.getEquippedRes() || '',
      armorResRef: eq?.ARMOR?.getEquippedRes() || '',
    };
  }

  /** The item resrefs an object carries */
  static lootOf(obj: ModuleObject): string[] {
    return (obj?.inventory || []).map((i) => gmItemResRef(i)).filter(Boolean);
  }

  /** Which way an object faces (placeables keep a bearing, creatures a facing) */
  static facingOf(obj: ModuleObject): number {
    return GMObjectKind.isPlaceable(obj) ? (obj.bearing || 0) : ((obj as ModuleCreature).getFacing?.() || 0);
  }

  /**
   * A creature as the config that spawns it again as it is now: what it was spawned from (GM-placed) or its
   * module template, with its current side, health, gear, bark and stance
   */
  static describeCreature(cre: ModuleCreature): GMCreatureSpawnConfig {
    const base = cre.gmSpawnConfig;
    const mainClass = cre.getMainClass?.() || undefined;
    return {
      ...(base || {
        name: '',
        templateResRef: cre.getTemplateResRef() || undefined,
        appearanceId: cre.appearance || 28,
        level: cre.getTotalClassLevel?.() || 5,
        classId: mainClass ? mainClass.id : 0,
        // A module creature has no preset to fall back on: keep the look, health and gear it has now
        customized: true,
      }),
      name: cre.getName() || cre.firstName || base?.name || 'Actor',
      factionId: cre.factionId ?? GMFaction.HOSTILE,
      hp: cre.getMaxHP() || base?.hp || 50,
      ...this.gearOf(cre),
      barkText: cre.gmBarkText || '',
      stance: cre.heldStance || undefined,
      lootResRefs: base?.lootResRefs ? [...base.lootResRefs] : undefined,
    };
  }

  /**
   * A placeable as the config that spawns it again as it is now: what it was spawned from (GM-placed) or its
   * current model and settings, with its current lock, size, bark and skill gate
   */
  static describePlaceable(plc: ModulePlaceable): GMPlaceableSpawnConfig {
    const base = plc.gmSpawnConfig;
    return {
      ...(base || {
        name: plc.getName() || 'Placeable',
        appearanceId: plc.appearance || 52,
        useable: plc.useable,
        hasInventory: plc.hasInventory,
        openLockDC: plc.openLockDC || 15,
        lootResRefs: this.lootOf(plc),
      }),
      zOffset: 0,
      scale: plc.gmScale || base?.scale || 1.0,
      locked: plc.isLocked(),
      lootResRefs: base ? [...(base.lootResRefs || [])] : this.lootOf(plc),
      barkText: plc.gmBarkText || '',
      skillGate: plc.gmSkillGate ? { ...plc.gmSkillGate } : undefined,
    };
  }

  /** A creature or placeable as a config that spawns it again, or null for anything else */
  static describeObject(obj: ModuleObject):
    | { kind: 'creature'; config: GMCreatureSpawnConfig }
    | { kind: 'placeable'; config: GMPlaceableSpawnConfig }
    | null {
    if (GMObjectKind.isPlaceable(obj)) return { kind: 'placeable', config: this.describePlaceable(obj) };
    if (GMObjectKind.isCreature(obj)) return { kind: 'creature', config: this.describeCreature(obj) };
    return null;
  }

  /** Spawn what describeObject (or a saved kit / session) describes */
  static async spawnDescribed(
    described: { kind: 'creature'; config: GMCreatureSpawnConfig } | { kind: 'placeable'; config: GMPlaceableSpawnConfig },
    position: THREE.Vector3,
    facing: number
  ): Promise<ModuleObject | null> {
    return described.kind === 'creature'
      ? this.spawnCreature(described.config, position, facing)
      : this.spawnPlaceable(described.config, position, facing);
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
      GMNetworkManager.broadcastActorUpdate(this.serializeSingleActor(obj));
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

  /**
   * Build a multi-placeable Scene Blueprint (e.g. Office Building, Ancient Temple, Command Center)
   * either in a freshly loaded clean default background (danm14aa or chosen module) or in the current scene.
   */
  static async buildSceneBlueprint(
    blueprint: GMSceneBlueprint,
    options?: {
      loadCleanBackgroundFirst?: boolean;
      backgroundModuleResRef?: string;
      clearExistingPlaceables?: boolean;
      spawnNPCs?: boolean;
      useCameraTargetAsOrigin?: boolean;
    }
  ) {
    if (!blueprint) return;
    const loadClean = options?.loadCleanBackgroundFirst ?? false;
    const targetModule = options?.backgroundModuleResRef || blueprint.recommendedModule || 'danm14aa';
    const spawnNPCs = options?.spawnNPCs ?? true;

    if (loadClean) {
      const loaded = await this.loadScene(targetModule, {
        keepCreatures: false,
        keepTriggers: false,
        keepPlaceables: false,
        preserveParty: this.preservePartyOnWarp
      });
      // Placed once the new scene is up (not awaited, like loadScene itself)
      this.waitForScene(loaded, Infinity).then((ready) => {
        if (ready) return this.spawnBlueprintInCurrentArea(blueprint, { useCameraTargetAsOrigin: false, clearExistingPlaceables: false, spawnNPCs });
      });
      return;
    }

    await this.spawnBlueprintInCurrentArea(blueprint, {
      useCameraTargetAsOrigin: options?.useCameraTargetAsOrigin ?? false,
      clearExistingPlaceables: options?.clearExistingPlaceables ?? false,
      spawnNPCs
    });
  }

  static async spawnBlueprintInCurrentArea(
    blueprint: GMSceneBlueprint,
    options?: {
      useCameraTargetAsOrigin?: boolean;
      clearExistingPlaceables?: boolean;
      spawnNPCs?: boolean;
    }
  ) {
    const mod = GameState.module;
    if (!mod || !mod.area) return;

    if (options?.clearExistingPlaceables) {
      const allExisting = [...mod.area.placeables];
      for (const plc of allExisting) {
        this.deleteObject(plc);
      }
    }

    let originX = mod.entryX || 0;
    let originY = mod.entryY || 0;
    let originZ = mod.entryZ || 0;
    let baseYaw = Math.atan2(mod.entryDirectionX || 0, mod.entryDirectionY || 1);

    if (options?.useCameraTargetAsOrigin) {
      const target = this.getCameraTargetSpawnPoint(3.0);
      originX = target.position.x;
      originY = target.position.y;
      originZ = target.position.z;
      const cam = this.getActiveThreeCamera();
      if (cam) {
        baseYaw = Math.atan2(target.position.x - cam.position.x, target.position.y - cam.position.y);
      }
    }

    const cosA = Math.cos(-baseYaw);
    const sinA = Math.sin(-baseYaw);

    for (const item of blueprint.items) {
      const worldX = originX + (item.dx * cosA - item.dy * sinA);
      const worldY = originY + (item.dx * sinA + item.dy * cosA);
      const groundZ = this.getGroundZAt(worldX, worldY, originZ);
      const worldZ = groundZ + (item.dz || 0);
      const worldFacing = Utility.NormalizeRadian(baseYaw + (item.yawDeg * Math.PI) / 180);

      await this.spawnPlaceable(
        {
          ...item.config,
          zOffset: 0
        },
        new THREE.Vector3(worldX, worldY, worldZ),
        worldFacing
      );
    }

    if ((options?.spawnNPCs ?? true) && Array.isArray(blueprint.creatures)) {
      for (const creItem of blueprint.creatures) {
        const worldX = originX + (creItem.dx * cosA - creItem.dy * sinA);
        const worldY = originY + (creItem.dx * sinA + creItem.dy * cosA);
        const groundZ = this.getGroundZAt(worldX, worldY, originZ);
        const worldZ = groundZ + (creItem.dz || 0);
        const worldFacing = Utility.NormalizeRadian(baseYaw + (creItem.yawDeg * Math.PI) / 180);

        await this.spawnCreature(
          creItem.config,
          new THREE.Vector3(worldX, worldY, worldZ),
          worldFacing
        );
      }
    }

    if (GMNetworkManager.role === 'host') {
      GMNetworkManager.sendWorldSnapshot();
    }
    this.notifyChange();
  }

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
      yawDeg: Math.round((this.facingOf(obj) * 180) / Math.PI),
    });

    // Every placeable left in the scene, and every NPC (not the players' characters)
    const items: GMSceneBlueprintItem[] = mod.area.placeables
      .filter(Boolean)
      .map((plc) => ({ ...offset(plc), config: this.describePlaceable(plc) }));
    const creatures: GMSceneBlueprintCreature[] = mod.area.creatures
      .filter((cre) => cre && !GameState.PartyManager.party.includes(cre) && !this.isPlayerCharacter(cre))
      .map((cre) => ({ ...offset(cre), config: this.describeCreature(cre) }));

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

    this.notifyChange();
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
      this.notifyChange();
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
      this.notifyChange();
      return bp;
    } catch (e) {
      return null;
    }
  }

  /**
   * GM scenes don't run the module's creature scripts, which is where KotOR decides who an NPC fights.
   * Stand in for them: an NPC that isn't already mid-attack goes after its current target, else whoever
   * last attacked it, else the nearest creature it is hostile to and can see.
   */
  // =========================================================================
  // Player death
  // =========================================================================

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

  // =========================================================================
  // GM checks: skills and saving throws, rolled on the GM's machine
  // =========================================================================

  /** skills.2da order (SKILL_*) */
  static SKILL_NAMES = GM_SKILL_NAMES;

  static checkLabel(check: GMCheck): string {
    if (check.kind === 'skill') return this.SKILL_NAMES[check.skill] || `Skill ${check.skill}`;
    return check.save === 'fortitude' ? 'Fortitude save' : check.save === 'reflex' ? 'Reflex save' : 'Will save';
  }

  /**
   * Roll a check as KotOR does: d20 + the skill's total (ranks, ability, feats, items, effects), or d20 + the save
   * and its ability, against a difficulty. Saves succeed on a natural 20 and fail on a 1; skills don't.
   */
  static rollCheck(cre: ModuleCreature, check: GMCheck, dc: number): GMCheckResult {
    const roll = 1 + Math.floor(Math.random() * 20);
    const mod = (score: number) => Math.floor(((score || 10) - 10) / 2);
    let bonus = 0;
    if (check.kind === 'skill') {
      bonus = cre.getSkillLevel(check.skill);
    } else if (check.save === 'fortitude') {
      bonus = cre.getFortitudeSave() + mod(cre.getCON());
    } else if (check.save === 'reflex') {
      bonus = cre.getReflexSave() + mod(cre.getDEX());
    } else {
      bonus = cre.getWillSave() + mod(cre.getWIS());
    }
    const total = roll + bonus;
    let success = total >= dc;
    if (check.kind === 'save' && roll === 20) success = true;
    if (check.kind === 'save' && roll === 1) success = false;
    return { name: cre.getName() || 'Someone', label: this.checkLabel(check), roll, bonus, total, dc, success };
  }

  static describeCheck(r: GMCheckResult): string {
    const sign = r.bonus >= 0 ? '+' : '-';
    return `${r.name}: ${r.label} ${r.roll} ${sign} ${Math.abs(r.bonus)} = ${r.total} vs DC ${r.dc}, ${r.success ? 'success' : 'failure'}`;
  }

  /** Roll a check for each creature and announce it: to everyone, or only to the GM when secret */
  static callCheck(creatures: ModuleCreature[], check: GMCheck, dc: number, secret: boolean = false): GMCheckResult[] {
    const results = creatures.filter((c) => c && !c.isDead()).map((c) => this.rollCheck(c, check, dc));
    for (const r of results) {
      const text = this.describeCheck(r);
      if (secret || GMNetworkManager.role !== 'host') GMNetworkManager.appendChat(secret ? 'Check (secret)' : 'Check', text);
      else GMNetworkManager.sendChat('Check', text);
    }
    return results;
  }

  /** Give an object a skill check to pass before it can be used, or undefined to remove it */
  static setSkillGate(obj: ModuleObject, gate: GMSkillGate | undefined) {
    if (!obj) return;
    if (gate) obj.gmSkillGate = { skill: gate.skill, dc: gate.dc };
    else delete obj.gmSkillGate;
    delete obj.gmSkillGateSolved;
    const config = obj.gmSpawnConfig as GMPlaceableSpawnConfig | undefined;
    if (config) config.skillGate = gate ? { ...gate } : undefined;
    this.notifyChange();
  }

  /**
   * Using an object with a skill gate: the user rolls the skill against its difficulty (on the GM's machine,
   * where objects are used). Passing opens it for good; failing blocks this use, and they can try again.
   */
  static skillGatePasses(obj: ModuleObject, user: ModuleObject): boolean {
    const gate = obj?.gmSkillGate as GMSkillGate | undefined;
    if (!gate || obj.gmSkillGateSolved) return true;
    if (!user || !GMObjectKind.isCreature(user)) return true;
    const result = this.callCheck([user as ModuleCreature], { kind: 'skill', skill: gate.skill }, gate.dc)[0];
    if (!result) return false;
    if (result.success) obj.gmSkillGateSolved = true;
    return result.success;
  }

  static setDeathRule(rule: GMDeathRule) {
    if (!['kotor', 'gm', 'respawn'].includes(rule)) return;
    this.deathRule = rule;
    GMNetworkManager.broadcastSessionRules(this.sessionRules());
    this.notifyChange();
  }

  /** Host: notice players falling, stand them back up under the KotOR rule, tell the GM if everyone is down */
  static updateDownedPlayers(elapsed: number) {
    const pcs = this.getPlayerCharacters();
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
        this.notifyChange();
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
      c !== pc && !c.isDead() && !this.isPlayerCharacter(c) &&
      c.position.distanceTo(pc.position) <= this.RECOVER_ENEMY_RANGE && c.isHostile(pc)
    );
  }

  /** Host: bring a fallen character back, with hp hit points (default: full) */
  static revivePlayer(pc: ModuleCreature, hp?: number) {
    if (!pc) return;
    const max = pc.getMaxHP() || 1;
    this.setCreatureHP(pc, Math.max(1, Math.min(max, hp ?? max)), max);
    delete pc.gmDowned;
    pc.clearAllActions();
    pc.combatRound?.clearActions?.();
    if (pc.combatData) pc.combatData.combatState = false;
    if (GMNetworkManager.role === 'host' && pc.gmNetId) {
      GMNetworkManager.broadcastActorUpdate(this.serializeSingleActor(pc));
    }
    this.notifyChange();
  }

  static reviveAllPlayers() {
    for (const pc of this.getPlayerCharacters()) {
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
    this.teleportObject(pc, point);
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
  // =========================================================================
  // Ordering NPCs (GMNpcOrders)
  // =========================================================================

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

  /** Start an order that needs a click in the world (where to go, whom to attack or follow, patrol points) */
  static startOrderTool(tool: GMToolMode, cre: ModuleCreature) {
    if (!this.isOrderTool(tool) || !this.canOrder(cre)) return;
    this.setToolMode(tool);
    this.orderSubject = cre;
    this.patrolDraft = tool === 'order_patrol' ? [this.pointOf(cre)] : [];
    this.notifyChange();
  }

  /** A click in the world with an order tool */
  static handleOrderClick() {
    const cre = this.orderSubject;
    if (!cre || !this.canOrder(cre)) {
      this.setToolMode('select');
      return;
    }
    const tool = this.activeTool;
    if (tool === 'order_move' || tool === 'order_patrol') {
      if (!this.hasValidRaycastPoint) return;
      const p = this.lastRaycastPoint;
      if (tool === 'order_move') {
        this.giveOrder(cre, { kind: 'move', point: { x: p.x, y: p.y, z: p.z } });
        this.setToolMode('select');
      } else {
        this.patrolDraft.push({ x: p.x, y: p.y, z: p.z });
        this.notifyChange();
      }
      return;
    }
    const picked = this.pickObjectAtCursor();
    if (!picked || picked === cre || !GMObjectKind.isCreature(picked)) return;
    const netId = picked.gmNetId as string | undefined;
    if (!netId) return;
    this.giveOrder(cre, tool === 'order_attack' ? { kind: 'attack', targetNetId: netId } : { kind: 'follow', targetNetId: netId });
    this.setToolMode('select');
  }

  /** Putting down the patrol tool: patrol the points clicked (with where it started), if any were */
  static finishPatrolOrder() {
    const cre = this.orderSubject;
    const points = this.patrolDraft;
    this.patrolDraft = [];
    if (cre && points.length >= 2) this.giveOrder(cre, { kind: 'patrol', points, index: 1 });
  }

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
    this.init3DIndicators();

    if (this.selectionRing) {
      if (this.selectedObject && this.selectedObject.position) {
        this.selectionRing.visible = true;
        this.selectionRing.position.set(
          this.selectedObject.position.x,
          this.selectedObject.position.y,
          this.selectedObject.position.z + 0.08
        );
        const mat = this.selectionRing.material as THREE.MeshBasicMaterial;
        if (GMObjectKind.isCreature(this.selectedObject)) {
          const cre = this.selectedObject as ModuleCreature;
          if (cre.factionId === GMFaction.HOSTILE) mat.color.setHex(0xff3333);
          else if (cre.factionId === GMFaction.PARTY || GameState.PartyManager.party.includes(cre)) mat.color.setHex(0x00ff88);
          else mat.color.setHex(0xffcc00);
        } else {
          mat.color.setHex(0x00e5ff);
        }
      } else {
        this.selectionRing.visible = false;
      }
    }

    if (GMNetworkManager.role === 'client') GameState.GMConversationManager?.update(delta);

    // Fallen player characters: getting back up, respawning, telling the GM when everyone is down
    if (GMNetworkManager.role !== 'client' && !this.worldPaused && !this.sceneLoading) {
      this.downedTimer += delta;
      if (this.downedTimer >= this.DOWNED_CHECK_INTERVAL) {
        this.updateDownedPlayers(this.downedTimer);
        this.downedTimer = 0;
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
      this.updateHostDrivenActors();
      this.sheetSyncTimer += delta;
      if (this.sheetSyncTimer >= this.SHEET_SYNC_INTERVAL) {
        this.sheetSyncTimer = 0;
        this.updatePlayerSheets();
      }
    }
    GMNetworkManager.update(delta);
  }

  // =========================================================================
  // Neverwinter Nights-Style Multiplayer Serialization & State Sync Methods
  // =========================================================================

  static serializeSingleActor(obj: ModuleObject): GMSerializedActor {
    const netId = obj.gmNetId || this.getNextNetId('obj');
    if (!obj.gmNetId) {
      this.registerNetObject(netId, obj);
    }

    const isPlayer = GMObjectKind.isPlayer(obj) || GameState.PartyManager.party.includes(obj as ModuleCreature);
    const isPlaceable = GMObjectKind.isPlaceable(obj);
    const kind: 'creature' | 'player' | 'placeable' = isPlaceable ? 'placeable' : (isPlayer ? 'player' : 'creature');

    const { rightHandResRef, leftHandResRef, armorResRef } = isPlaceable
      ? { rightHandResRef: '', leftHandResRef: '', armorResRef: '' }
      : this.gearOf(obj as ModuleCreature);

    return {
      netId,
      kind,
      ownerPeerId: obj.gmOwnerPeerId,
      templateResRef: obj.gmSpawnConfig?.templateResRef || obj.getTemplateResRef() || '',
      appearanceId: obj.appearance || 0,
      name: obj.getName() || (obj as ModuleCreature).firstName || 'Actor',
      tag: obj.getTag() || '',
      factionId: obj.factionId ?? GMFaction.FRIENDLY,
      hp: obj.getHP() ?? 50,
      maxHp: obj.getMaxHP() ?? 50,
      x: obj.position.x,
      y: obj.position.y,
      z: obj.position.z,
      facing: isPlaceable ? (obj.bearing || 0) : (obj as ModuleCreature).getFacing(),
      scale: obj.gmScale || 1.0,
      animState: isPlaceable ? 0 : ((obj as ModuleCreature).animationState?.index || 0),
      hidden: !!obj.gmHidden,
      stealth: !!(obj as any).stealthMode,
      hostDriven: !!obj.gmHostDriven,
      intentSeq: obj.gmIntentSeq || 0,
      rightHandResRef,
      leftHandResRef,
      armorResRef,
      barkText: obj.gmBarkText || '',
      stance: isPlaceable ? undefined : ((obj as ModuleCreature).heldStance || ''),
      hasInventory: isPlaceable ? (obj as ModulePlaceable).hasInventory : false,
      locked: isPlaceable ? (obj as ModulePlaceable).isLocked() : false,
      openState: isPlaceable ? (obj as ModulePlaceable).state : 0,
      lootResRefs: isPlaceable ? this.lootOf(obj) : []
    };
  }

  static serializeActorsForTick(): GMSerializedActor[] {
    return this.serializeAllActors().filter((actor) => !actor.hidden);
  }

  static serializeAllActors(): GMSerializedActor[] {
    const area = GameState.module?.area;
    if (!area || this.sceneLoading || !GameState.module.readyToProcessEvents) return [];
    const list: GMSerializedActor[] = [];
    for (const p of GameState.PartyManager.party) {
      if (p) list.push(this.serializeSingleActor(p));
    }
    // Objects still loading are sent once, complete, when their spawn finishes
    for (const c of area.creatures) {
      if (c && !GameState.PartyManager.party.includes(c) && !c.gmSpawning) {
        list.push(this.serializeSingleActor(c));
      }
    }
    for (const plc of area.placeables) {
      if (plc && plc.gmNetId && !plc.gmSpawning && !String(plc.gmNetId).startsWith('plc_area_')) {
        list.push(this.serializeSingleActor(plc));
      }
    }
    return list;
  }

  static buildWorldSnapshot(): GMWorldSnapshot {
    const area = GameState.module?.area;
    const doors: GMSerializedDoorState[] = (area?.doors || []).map((d, idx) => ({
      netId: d.gmNetId || `door_${idx}_${d.getTag() || d.id}`,
      tag: d.getTag(),
      x: d.position.x,
      y: d.position.y,
      locked: d.isLocked(),
      openState: d.openState
    }));

    return {
      moduleResRef: GameState.module?.filename || 'danm14aa',
      keepDefaultCreatures: this.keepDefaultCreatures,
      keepDefaultTriggers: this.keepDefaultTriggers,
      keepDefaultPlaceables: this.keepDefaultPlaceables,
      rules: this.sessionRules(),
      actors: this.serializeActorsForTick(),
      doors,
      mines: this.getMines().map((m) => this.serializeMine(m)),
    };
  }

  static async loadSceneFromNetwork(
    moduleResRef: string,
    keepCreatures: boolean,
    keepTriggers: boolean,
    keepPlaceables: boolean = true
  ) {
    this.keepDefaultCreatures = keepCreatures;
    this.keepDefaultTriggers = keepTriggers;
    this.keepDefaultPlaceables = keepPlaceables;
    return this.loadScene(moduleResRef, {
      keepCreatures,
      keepTriggers,
      keepPlaceables,
      preserveParty: false
    });
  }

  static async applyWorldSnapshotOnClient(snapshot: GMWorldSnapshot) {
    if (!snapshot) return;
    const keepPlaceables = snapshot.keepDefaultPlaceables ?? true;
    if (!GameState.module || GameState.module.filename !== snapshot.moduleResRef) {
      const loaded = await this.loadSceneFromNetwork(
        snapshot.moduleResRef,
        snapshot.keepDefaultCreatures,
        snapshot.keepDefaultTriggers,
        keepPlaceables
      );
      // Applied once the new scene is up (not awaited, so later packets aren't held up)
      this.waitForScene(loaded, Infinity).then((ready) => {
        if (ready) return this.syncSnapshotEntitiesOnClient(snapshot);
      });
      return;
    }
    await this.syncSnapshotEntitiesOnClient(snapshot);
  }

  static async syncSnapshotEntitiesOnClient(snapshot: GMWorldSnapshot) {
    if (Array.isArray(snapshot.mines)) {
      const known = new Set(snapshot.mines.map((m) => m.netId));
      for (const mine of this.getMines()) {
        if (!known.has(this.mineNetId(mine))) this.removeMineOnClient(this.mineNetId(mine));
      }
      for (const mine of snapshot.mines) this.applyMineOnClient(mine);
    }
    if (snapshot.rules?.deathRule) {
      GMNetworkManager.sessionRules = { ...GMNetworkManager.sessionRules, ...snapshot.rules };
    }
    if (Array.isArray(snapshot.doors)) {
      for (const ds of snapshot.doors) {
        this.applyDoorStateOnClient(ds);
      }
    }
    if (Array.isArray(snapshot.actors)) {
      for (const actor of snapshot.actors) {
        await this.spawnOrUpdateFromSerialized(actor);
      }
    }
  }

  static applyWorldTickOnClient(actors: GMSerializedActor[]) {
    if (!Array.isArray(actors) || this.sceneLoading || !GameState.module?.readyToProcessEvents) return;
    for (const actor of actors) {
      if (actor.netId === GMNetworkManager.assignedActorNetId && this.controlMode === 'POSSESS') {
        // Once the host has seen our latest intent and finished it, position authority returns to us
        if (
          GMNetworkManager.awaitingHost &&
          (actor.intentSeq ?? 0) >= GMNetworkManager.localIntentSeq &&
          !actor.hostDriven
        ) {
          GMNetworkManager.awaitingHost = false;
        }
        // While the host drives our actor, follow it like any other replica
        if (GMNetworkManager.awaitingHost) {
          this.spawnOrUpdateFromSerialized(actor);
          continue;
        }
        // Otherwise keep our local position and only take the host's HP
        const localObj = this.netIdMap.get(actor.netId);
        if (localObj) {
          if (GMObjectKind.isCreature(localObj)) {
            this.setCreatureHP(localObj as ModuleCreature, actor.hp, actor.maxHp);
            const own = localObj as ModuleCreature;
            if (!!own.stealthMode !== !!actor.stealth) own.setStealthMode(!!actor.stealth, true);
          } else {
            localObj.setMaxHP(actor.maxHp);
            localObj.currentHP = actor.hp;
          }
        }
        continue;
      }
      this.spawnOrUpdateFromSerialized(actor);
    }
  }

  static async spawnOrUpdateFromSerialized(actor: GMSerializedActor): Promise<ModuleObject | null> {
    if (!actor || actor.hidden || !GameState.module?.area) return null;
    const existing = this.netIdMap.get(actor.netId);
    if (existing) {
      if (actor.kind === 'placeable') {
        existing.position.set(actor.x, actor.y, actor.z);
      } else {
        this.setNetTarget(existing, actor.x, actor.y, actor.z);
        existing.gmNetAnim = actor.animState;
      }
      if (existing.container) {
        if (typeof actor.scale === 'number' && actor.scale > 0) {
          existing.container.scale.setScalar(actor.scale);
          existing.gmScale = actor.scale;
        }
      }
      if (GMObjectKind.isCreature(existing)) {
        this.setCreatureHP(existing as ModuleCreature, actor.hp, actor.maxHp);
      } else {
        existing.setMaxHP(actor.maxHp);
        existing.currentHP = actor.hp;
      }
      if (actor.barkText !== undefined) {
        existing.gmBarkText = actor.barkText;
      }
      if (actor.kind === 'placeable') {
        const plc = existing as ModulePlaceable;
        plc.setLocked(!!actor.locked);
        plc.bearing = actor.facing;
        plc.rotation.z = actor.facing;
      } else {
        const cre = existing as ModuleCreature;
        cre.setFacing(actor.facing, false);
        if (!!cre.stealthMode !== !!actor.stealth) cre.setStealthMode(!!actor.stealth, true);
        if (actor.stance !== undefined && (cre.heldStance || '') !== actor.stance) cre.setHeldStance(actor.stance);
        if (cre.factionId !== actor.factionId) {
          this.assignFaction(cre, actor.factionId);
        }
        // Our own character's equipment comes from our character sheet instead
        if (actor.netId !== GMNetworkManager.assignedActorNetId) {
          this.syncReplicaEquipment(cre, actor);
        }
      }
      return existing;
    }

    // Spawning loads models asynchronously; ignore further ticks for this actor until it exists
    if (this.pendingNetSpawns.has(actor.netId)) return null;
    this.pendingNetSpawns.add(actor.netId);
    try {
      return await this.spawnFromSerialized(actor);
    } finally {
      this.pendingNetSpawns.delete(actor.netId);
    }
  }

  static async spawnFromSerialized(actor: GMSerializedActor): Promise<ModuleObject | null> {
    const spawned = await this.spawnFromSerializedInner(actor);
    if (spawned && this.pendingPlayerSheet?.netId === actor.netId) {
      await this.applyPlayerSheetOnClient(this.pendingPlayerSheet);
    }
    return spawned;
  }

  static async spawnFromSerializedInner(actor: GMSerializedActor): Promise<ModuleObject | null> {
    const pos = new THREE.Vector3(actor.x, actor.y, actor.z);
    if (actor.kind === 'placeable') {
      return await this.spawnPlaceable(
        {
          name: actor.name,
          templateResRef: actor.templateResRef,
          appearanceId: actor.appearanceId,
          // Mirror what the host built (its model, name and lock), not the template's defaults
          customized: true,
          scale: actor.scale || 1.0,
          useable: true,
          hasInventory: !!actor.hasInventory,
          locked: !!actor.locked,
          openLockDC: 15,
          lootResRefs: actor.lootResRefs || [],
          barkText: actor.barkText
        },
        pos,
        actor.facing,
        actor.netId
      );
    } else if (actor.kind === 'player') {
      const isMine = actor.ownerPeerId === GMNetworkManager.peerId || actor.netId === GMNetworkManager.assignedActorNetId;
      return await this.spawnPlayerCharacter(
        {
          ...this.pendingPlayerConfig,
          name: actor.name,
          appearanceId: actor.appearanceId || 136,
          hp: actor.maxHp || 120,
          rightHandResRef: actor.rightHandResRef,
          leftHandResRef: actor.leftHandResRef,
          armorResRef: actor.armorResRef,
          possessImmediately: isMine,
          ownerPeerId: actor.ownerPeerId
        },
        pos,
        actor.facing,
        actor.netId
      );
    } else {
      return await this.spawnCreature(
        {
          name: actor.name,
          templateResRef: actor.templateResRef,
          appearanceId: actor.appearanceId,
          // Mirror what the host built (look, HP, gear), on top of the template's other slots
          customized: true,
          factionId: actor.factionId,
          hp: actor.maxHp || 50,
          level: 4,
          classId: 0,
          rightHandResRef: actor.rightHandResRef,
          leftHandResRef: actor.leftHandResRef,
          armorResRef: actor.armorResRef,
          barkText: actor.barkText,
          stance: actor.stance
        },
        pos,
        actor.facing,
        actor.netId
      );
    }
  }

  static removeActorByNetId(netId: string) {
    const obj = this.netIdMap.get(netId);
    if (obj) {
      this.netIdMap.delete(netId);
      obj.destroy();
      this.notifyChange();
    }
  }

  static applyDoorStateOnClient(doorState: GMSerializedDoorState) {
    const area = GameState.module?.area;
    if (!area || !doorState) return;
    let door = this.netIdMap.get(doorState.netId) as ModuleDoor;
    if (!door) {
      door = area.doors.find(
        d => d.getTag() === doorState.tag && Math.hypot(d.position.x - doorState.x, d.position.y - doorState.y) < 2.0
      );
    }
    if (!door) return;
    door.setLocked(doorState.locked);
    if (door.openState !== doorState.openState) {
      if (doorState.openState === ModuleDoorOpenState.OPEN1 || doorState.openState === ModuleDoorOpenState.OPEN2) {
        door.openDoor(door);
      } else {
        door.closeDoor(door);
      }
    }
  }

  /**
   * Resolve a network actor that the given peer is allowed to control
   */
  /**
   * Host: the net id of a character still in the world that belongs to this peer, so a reconnecting player gets it back
   */
  static findActorOwnedBy(peerId: string): string | null {
    for (const [netId, obj] of this.netIdMap.entries()) {
      if (obj.gmOwnerPeerId === peerId && !obj.destroyed) return netId;
    }
    return null;
  }

  /**
   * Host: a disconnected player's character stops any intent in progress and stands still until they rejoin
   */
  static releaseActor(netId: string) {
    const actor = this.netIdMap.get(netId);
    if (!actor) return;
    actor.clearAllActions();
    actor.gmHostDriven = false;
    actor.gmNetTarget = undefined;
  }

  static getOwnedActor(peerId: string, netId: string): ModuleCreature | null {
    const actor = this.netIdMap.get(netId);
    if (!actor || !GMObjectKind.isCreature(actor)) return null;
    if (actor.gmOwnerPeerId !== peerId) return null;
    return actor as ModuleCreature;
  }

  /**
   * Client-owned movement: the client is authoritative over its actor's position
   * except while the host is executing one of its intents.
   */
  static applyClientInputOnHost(peerId: string, payload: any) {
    if (!payload) return;
    const actor = this.getOwnedActor(peerId, payload.netId);
    if (!actor || actor.gmHostDriven) return;
    // Sent before the player's game had moved their character to where the GM teleported it
    if ((payload.teleportSeq ?? 0) < (actor.gmTeleportSeq || 0)) return;
    if (typeof payload.x === 'number' && typeof payload.y === 'number') {
      this.setNetTarget(actor, payload.x, payload.y, payload.z);
      if (typeof payload.facing === 'number') {
        actor.setFacing(payload.facing, false);
      }
    }
  }

  // =========================================================================
  // Host visuals mirrored to clients (combat animations, combat text, visual effects)
  // =========================================================================

  /** Host only, and only for objects clients know about */
  static getHostFxNetId(obj: ModuleObject | undefined): string | null {
    if (!GameState.gmMode || GMNetworkManager.role !== 'host' || !obj || obj.gmHidden) return null;
    return obj.gmNetId || null;
  }

  /**
   * Host: a creature started a 2DA animation. Callers set the animation state index right after
   * (ATTACK, DAMAGE, DODGE...), so read it once the current call stack has finished.
   */
  static onHostTwoDAAnimation(cre: ModuleCreature, animation: ITwoDAAnimation) {
    const netId = this.getHostFxNetId(cre);
    if (!netId || !animation?.name) return;
    queueMicrotask(() => {
      if (cre.animationState?.animation !== animation) return;
      GMNetworkManager.broadcastFx({ kind: 'anim', netId, anim: animation.name, index: cre.animationState.index });
    });
  }

  static onHostTextSprite(obj: ModuleObject, text: string, style: number, timer: number) {
    const netId = this.getHostFxNetId(obj);
    if (!netId) return;
    GMNetworkManager.broadcastFx({ kind: 'text', netId, text, style, timer });
  }

  /** Host: a ranged attack fired a bolt; players draw it too */
  static onHostProjectile(caster: ModuleObject, target: ModuleObject, ammunition: number, hit: boolean, delay: number) {
    const netId = this.getHostFxNetId(caster);
    const targetNetId = this.getHostFxNetId(target);
    if (!netId || !targetNetId) return;
    GMNetworkManager.broadcastFx({ kind: 'projectile', netId, targetNetId, ammunition, hit, delay });
  }

  static onHostVisualEffectApplied(effect: GameEffect) {
    const netId = this.getHostFxNetId(effect.object);
    if (!netId) return;
    const fxId = this.getNextNetId('fx');
    (effect as any).gmFxId = fxId;
    GMNetworkManager.broadcastFx({
      kind: 'vfx.add',
      netId,
      fxId,
      vfx: effect.getInt(0),
      miss: effect.getInt(2),
      durationType: effect.getDurationType(),
      duration: effect.getDuration(),
    });
  }

  static onHostVisualEffectRemoved(effect: GameEffect) {
    const fxId = (effect as any).gmFxId;
    const netId = this.getHostFxNetId(effect.object);
    // Instant effects finish on their own on every machine
    if (!fxId || !netId || effect.getDurationType() === GameEffectDurationType.INSTANT) return;
    GMNetworkManager.broadcastFx({ kind: 'vfx.remove', netId, fxId });
  }

  /**
   * Client: replay a host visual on our copy of the object
   */
  static applyFxEventOnClient(event: GMFxEvent) {
    const obj = this.netIdMap.get(event?.netId);
    if (!obj) return;
    switch (event.kind) {
      case 'anim': {
        if (!GMObjectKind.isCreature(obj)) return;
        const cre = obj as ModuleCreature;
        const animation = OdysseyModelAnimation.GetAnimation2DA(event.anim);
        if (!animation || cre.isDead()) return;
        cre.playTwoDAAnimation(animation);
        cre.animationState.index = event.index;
        cre.gmFxAnimation = cre.animationState.animation;
        break;
      }
      case 'text':
        TextSprite3D.CreateOnObject(obj, event.text, event.style, event.timer);
        break;
      case 'vfx.add': {
        const effect = new GameState.GameEffectFactory.EffectVisualEffect();
        effect.setInt(0, event.vfx);
        effect.setInt(2, event.miss);
        effect.setDurationType(event.durationType);
        effect.setDuration(event.duration);
        effect.initialize();
        (effect as any).gmFxId = event.fxId;
        obj.addEffect(effect);
        break;
      }
      case 'vfx.remove': {
        const effect = obj.effects.find((e) => (e as any).gmFxId === event.fxId);
        if (effect) obj.removeEffect(effect);
        break;
      }
      case 'projectile': {
        const target = this.netIdMap.get(event.targetNetId);
        if (target) GameState.ProjectileManager?.Launch(obj, target, event.ammunition, event.hit, event.delay);
        break;
      }
    }
  }

  // =========================================================================
  // Host-granted looting
  // =========================================================================

  static toLootItems(items: ModuleItem[]): GMLootItem[] {
    return (items || [])
      .map((item) => ({ resRef: item.getEquippedRes() || item.getInventoryRes() || item.getTemplateResRef(), stack: item.getStackSize() || 1 }))
      .filter((item) => !!item.resRef);
  }

  static async createLootItems(items: GMLootItem[]): Promise<ModuleItem[]> {
    const created = await Promise.all(items.map(async (entry) => {
      const item = await this.createItemFromResRefAsync(entry.resRef);
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
    const container = containerNetId ? this.netIdMap.get(containerNetId) : null;
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
    this.notifyChange();
  }

  /**
   * Client: show the host's container contents in the normal loot window
   */
  static async openNetworkContainer(containerNetId: string, items: GMLootItem[]) {
    const container = this.netIdMap.get(containerNetId);
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

  // =========================================================================
  // DM tools: questions, rewards, hiding, encounters
  // =========================================================================

  /** Host: the character a connected player controls */
  static getPeerActor(peerId: string): ModuleCreature | null {
    const netId = GMNetworkManager.peers.get(peerId)?.controlledNetId;
    const actor = netId ? this.netIdMap.get(netId) : null;
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
      promptId: this.getNextNetId('ask'),
      speaker: speaker?.getName() || 'GM',
      text: text.trim(),
      options: replies,
    };
    this.dmPrompts.set(prompt.promptId, { prompt, targetPeerId, replies: [] });
    GMNetworkManager.sendDmPrompt(prompt, targetPeerId);
    const to = targetPeerId ? GMNetworkManager.peers.get(targetPeerId)?.name || 'a player' : 'everyone';
    GMNetworkManager.appendChat(prompt.speaker, `${prompt.text} (asked ${to}: ${replies.join(' / ')})`);
    this.notifyChange();
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
    this.notifyChange();
  }

  /** Host: award XP to one connected player; it reaches them with their next character sheet */
  static giveXP(peerId: string, amount: number): boolean {
    const actor = this.getPeerActor(peerId);
    const xp = Math.round(Number(amount));
    if (!actor || !(xp > 0)) return false;
    actor.experience = (actor.experience || 0) + xp;
    GMNetworkManager.sendChatTo(peerId, 'GM', `You gained ${xp} XP.`);
    this.notifyChange();
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
    this.notifyChange();
    return true;
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
        GMNetworkManager.broadcastActorSpawn(this.serializeSingleActor(obj));
      }
    }
    this.notifyChange();
    return true;
  }

  static isHiddenFromPlayers(obj: ModuleObject | null | undefined): boolean {
    return !!obj?.gmHidden;
  }

  /**
   * Spawn a group of one creature preset in a ring around a point (the camera target by default)
   */
  static async spawnEncounter(options: { presetIndex: number; count: number; spread?: number; factionId?: number; center?: THREE.Vector3 }): Promise<string[]> {
    const preset = this.CREATURE_PRESETS[options.presetIndex] || this.CREATURE_PRESETS[0];
    const count = Math.min(12, Math.max(1, Math.round(options.count || 1)));
    const spread = Math.max(0.5, options.spread ?? 2.5);
    const center = options.center || this.getCameraTargetSpawnPoint().position;
    const netIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = count === 1 ? 0 : spread;
      const x = center.x + Math.cos(angle) * radius;
      const y = center.y + Math.sin(angle) * radius;
      const pos = new THREE.Vector3(x, y, this.getGroundZAt(x, y, center.z));
      const facing = Math.atan2(center.x - x, center.y - y);
      const cre = await this.spawnCreature(
        { ...preset, name: count > 1 ? `${preset.name} ${i + 1}` : preset.name, factionId: options.factionId ?? preset.factionId },
        pos,
        facing
      );
      if (cre) netIds.push(cre.gmNetId);
    }
    this.notifyChange();
    return netIds;
  }

  // =========================================================================
  // Session save & load
  // =========================================================================

  /** Snapshot the running session: scene, GM-placed objects, doors and every player character */
  static buildSessionSave(name: string): GMSessionSave | null {
    const mod = GameState.module;
    const area = mod?.area;
    if (!mod || !area) return null;
    const objects: GMSavedObject[] = [];
    const players: GMSavedPlayer[] = [];
    const seen = new Set<ModuleObject>();

    for (const obj of [...area.creatures, ...GameState.PartyManager.party, ...this.spawnedPlayers]) {
      if (!obj || seen.has(obj) || obj.destroyed) continue;
      seen.add(obj);
      const cre = obj as ModuleCreature;
      const playerConfig: GMPlayerSpawnConfig | undefined = cre.gmPlayerConfig;
      if (playerConfig) {
        players.push({
          name: playerConfig.name || cre.getName() || 'Player',
          local: !cre.gmOwnerPeerId,
          config: { ...playerConfig, ownerPeerId: undefined, possessImmediately: false },
          sheet: this.buildPlayerSheet(cre),
          x: cre.position.x, y: cre.position.y, z: cre.position.z,
          facing: cre.getFacing(),
          hidden: !!cre.gmHidden,
        });
        continue;
      }
      if (!cre.gmSpawnConfig) continue; // part of the module itself; reloaded with the scene
      objects.push({
        kind: 'creature',
        config: { ...this.describeCreature(cre), lootResRefs: undefined },
        x: cre.position.x, y: cre.position.y, z: cre.position.z,
        facing: cre.getFacing(),
        factionId: cre.factionId,
        hp: cre.getHP(),
        maxHp: cre.getMaxHP(),
        hidden: !!cre.gmHidden,
        loot: this.toLootItems(cre.inventory).map((e) => e.resRef),
        barkText: cre.gmBarkText || '',
        stance: cre.heldStance || undefined,
      });
    }

    for (const plc of area.placeables) {
      if (!plc || !plc.gmSpawnConfig || plc.destroyed) continue;
      objects.push({
        kind: 'placeable',
        config: { ...this.describePlaceable(plc), lootResRefs: [] },
        x: plc.position.x, y: plc.position.y, z: plc.position.z,
        facing: plc.bearing || 0,
        locked: plc.isLocked(),
        hidden: !!plc.gmHidden,
        loot: this.toLootItems(plc.inventory).map((e) => e.resRef),
        barkText: plc.gmBarkText || '',
      });
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
        keepCreatures: this.keepDefaultCreatures,
        keepTriggers: this.keepDefaultTriggers,
        keepPlaceables: this.keepDefaultPlaceables,
      },
      objects,
      doors,
      players,
      rules: this.sessionRules(),
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
    this.notifyChange();
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

  /** Spawn a saved player character; owned by peerId when a connected player takes it */
  static async spawnSavedPlayer(saved: GMSavedPlayer, ownerPeerId?: string): Promise<ModulePlayer | null> {
    const pc = await this.spawnPlayerCharacter(
      { ...saved.config, name: saved.name, ownerPeerId, possessImmediately: false },
      new THREE.Vector3(saved.x, saved.y, saved.z),
      saved.facing
    );
    if (!pc) return null;
    await this.applySheetToCharacter(pc, saved.sheet);
    if (ownerPeerId) pc.gmInventory = saved.sheet.inventory.map((e) => ({ ...e }));
    if (saved.hidden) this.setObjectHidden(pc, true);
    return pc;
  }

  /**
   * Load a saved session: its scene, placed objects, doors and characters. Connected players are given
   * their saved character by name now; the rest get theirs when they (re)join under the same name.
   */
  static async loadSession(save: GMSessionSave): Promise<boolean> {
    if (!save?.scene?.module) return false;
    if (save.rules?.deathRule) this.setDeathRule(save.rules.deathRule);
    const networkPlayers = save.players.filter((p) => !p.local);
    this.reservedPlayers = new Map(networkPlayers.map((p) => [p.name.trim().toLowerCase(), p]));

    await this.loadScene(save.scene.module, {
      keepCreatures: save.scene.keepCreatures,
      keepTriggers: save.scene.keepTriggers,
      keepPlaceables: save.scene.keepPlaceables,
      preserveParty: false,
    });
    if (!await this.waitForScene(save.scene.module)) return false;

    // Connected players' characters are carried into the new scene; wait for them before restoring
    const connected = [...GMNetworkManager.peers.values()];
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && connected.some((p) => p.controlledNetId && !this.netIdMap.has(p.controlledNetId))) {
      await new Promise((r) => setTimeout(r, 250));
    }

    for (const door of save.doors || []) {
      const obj = this.netIdMap.get(door.netId) as ModuleDoor;
      if (!obj || !GMObjectKind.isDoor(obj)) continue;
      obj.setLocked(door.locked);
      const shouldBeOpen = door.openState === ModuleDoorOpenState.OPEN1 || door.openState === ModuleDoorOpenState.OPEN2;
      if (shouldBeOpen && !obj.isOpen()) obj.openDoor(obj);
      else if (!shouldBeOpen && obj.isOpen()) obj.closeDoor(obj);
    }

    for (const saved of save.objects || []) {
      const pos = new THREE.Vector3(saved.x, saved.y, saved.z);
      let obj: ModuleObject | null = null;
      if (saved.kind === 'creature') {
        const cfg = saved.config as GMCreatureSpawnConfig;
        const cre = await this.spawnCreature(
          { ...cfg, factionId: saved.factionId ?? cfg.factionId, hp: saved.maxHp ?? cfg.hp, barkText: saved.barkText, stance: saved.stance, lootResRefs: saved.loot },
          pos,
          saved.facing
        );
        if (cre && typeof saved.hp === 'number') this.setCreatureHP(cre, saved.hp, saved.maxHp);
        obj = cre;
      } else {
        const cfg = saved.config as GMPlaceableSpawnConfig;
        obj = await this.spawnPlaceable(
          { ...cfg, locked: !!saved.locked, barkText: saved.barkText, lootResRefs: saved.loot, hasInventory: cfg.hasInventory || saved.loot.length > 0 },
          pos,
          saved.facing
        );
      }
      if (obj && saved.hidden) this.setObjectHidden(obj, true);
    }

    for (const saved of save.players.filter((p) => p.local)) {
      await this.spawnSavedPlayer(saved);
    }

    // Players already here take over their saved character now
    for (const peer of connected) {
      const reserved = this.reservedPlayers.get(String(peer.name || '').trim().toLowerCase());
      const actor = this.getPeerActor(peer.peerId);
      if (!reserved || !actor) continue;
      this.reservedPlayers.delete(reserved.name.trim().toLowerCase());
      await this.applySheetToCharacter(actor, reserved.sheet);
      actor.gmInventory = reserved.sheet.inventory.map((e) => ({ ...e }));
      this.teleportObject(actor, new THREE.Vector3(reserved.x, reserved.y, reserved.z));
      actor.setFacing(reserved.facing, true);
      if (reserved.hidden) this.setObjectHidden(actor, true);
    }

    GMNetworkManager.appendChat('System', `Loaded session "${save.name}".${this.reservedPlayers.size ? ` Waiting for: ${[...this.reservedPlayers.values()].map((p) => p.name).join(', ')}.` : ''}`);
    this.notifyChange();
    return true;
  }

  // =========================================================================
  // Host-owned player character sheets and inventories
  // =========================================================================

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
      const actor = peer.controlledNetId ? this.netIdMap.get(peer.controlledNetId) : null;
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
    const wanted = await this.createItemFromResRefAsync(resRef);
    if (wanted && actor.canUseItem?.(wanted) === false) {
      GMNetworkManager.appendChat('System', `${actor.getName()} can't use that: it needs a feat they don't have.`);
      return;
    }
    if (!this.removeFromPlayerInventory(actor, resRef)) return;
    const current: ModuleItem | undefined = (actor.equipment as any)[slotName];
    const currentResRef = gmItemResRef(current);
    if (currentResRef) this.addToPlayerInventory(actor, [{ resRef: currentResRef, stack: 1 }]);
    const item = wanted || await this.createItemFromResRefAsync(resRef);
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
    const cre = this.netIdMap.get(sheet.netId) as ModuleCreature;
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
    this.notifyChange();
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
    this.setCreatureHP(cre, sheet.hp, sheet.maxHp);
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
        await cre.equipItem(slot, await this.createItemFromResRefAsync(want));
      } else {
        cre.unequipSlot(slot);
      }
    }
  }

  /**
   * Client: keep another player's or NPC's visible weapons and armor matching the host
   */
  static syncReplicaEquipment(cre: ModuleCreature, actor: GMSerializedActor) {
    const wanted: [string, string | undefined][] = [
      ['RIGHTHAND', actor.rightHandResRef],
      ['LEFTHAND', actor.leftHandResRef],
      ['ARMOR', actor.armorResRef],
    ];
    const loading: Record<string, boolean> = cre.gmEquipLoading || (cre.gmEquipLoading = {});
    for (const [slotName, resRef] of wanted) {
      if (resRef === undefined || loading[slotName]) continue;
      const current: ModuleItem | undefined = (cre.equipment as any)[slotName];
      const have = gmItemResRef(current);
      if (have === resRef) continue;
      const slot = (ModuleCreatureArmorSlot as any)[slotName] as number;
      if (!resRef) {
        cre.unequipSlot(slot);
        continue;
      }
      loading[slotName] = true;
      this.createItemFromResRefAsync(resRef)
        .then((item) => cre.equipItem(slot, item))
        .catch((e) => console.warn('[GMManager] replica equip failed', resRef, e))
        .finally(() => { loading[slotName] = false; });
    }
  }

  /**
   * Execute a client's interaction request on the host using the engine's normal actions,
   * so pathing into range, door/placeable use, and combat resolve exactly as in single player.
   */
  static applyClientIntentOnHost(peerId: string, intent: GMClientIntent) {
    if (!intent) return;
    const actor = this.getOwnedActor(peerId, intent.netId);
    if (!actor) return;
    actor.gmIntentSeq = intent.seq;
    // A watching player can't act (a late request from before the freeze is dropped too)
    if (this.playersFrozen && intent.kind !== 'cancel') return;

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
      this.useMineOnHost(actor as ModuleCreature, intent).then((ok) => {
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

    const target = intent.targetNetId ? this.netIdMap.get(intent.targetNetId) : null;
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
    const target = intent.targetNetId ? this.netIdMap.get(intent.targetNetId) : actor;
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
            tool = await this.createItemFromResRefAsync(intent.resRef);
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
        const item = await this.createItemFromResRefAsync(resRef);
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
    if (this.isPlayerFrozen(pc)) return true;
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
      const onWhat = layingHere ? undefined : (mineAction === 'set' ? targetNetId : this.mineNetId(target as ModuleTrigger));
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

  // =========================================================================
  // Mines (Demolitions) in GM sessions: the GM's machine owns them and tells players
  // =========================================================================

  /** traps.2da row the GM's mine tool places */
  static pendingMineType: number = 4;

  static isMine(obj: ModuleObject | undefined): obj is ModuleTrigger {
    return !!obj && GMObjectKind.isTrigger(obj) && (obj as ModuleTrigger).type === ModuleTriggerType.TRAP;
  }

  static getMines(): ModuleTrigger[] {
    return (GameState.module?.area?.triggers || []).filter((t) => this.isMine(t)) as ModuleTrigger[];
  }

  /**
   * A mine's network id. The module's own mines get one from where they are, the same on every machine;
   * mines laid during the session get one from the GM's machine.
   */
  static mineNetId(mine: ModuleTrigger | undefined): string {
    if (!mine) return '';
    if (!mine.gmNetId) {
      const p = mine.position;
      const id = `trap_${Math.round(p.x * 10)}_${Math.round(p.y * 10)}_${mine.trapType}`;
      mine.gmNetId = GMNetworkManager.role === 'client' ? id : (this.netIdMap.has(id) ? this.getNextNetId('mine') : id);
      this.registerNetObject(mine.gmNetId, mine);
    }
    return mine.gmNetId;
  }

  static serializeMine(mine: ModuleTrigger): GMSerializedMine {
    return {
      netId: this.mineNetId(mine),
      trapType: mine.trapType,
      x: mine.position.x, y: mine.position.y, z: mine.position.z,
      factionId: mine.factionId,
      detected: !!mine.trapDetected,
    };
  }

  /** On a player's machine, mines only mirror the GM's: they don't go off, and nobody spots them there */
  static isMineReplica(_mine?: ModuleTrigger): boolean {
    return GMNetworkManager.role === 'client';
  }

  /** Host: a mine was laid or spotted */
  static onMineChanged(mine: ModuleTrigger) {
    if (GMNetworkManager.role !== 'host') return;
    GMNetworkManager.sendPacket({ type: 'mine.state', senderId: GMNetworkManager.peerId, timestamp: Date.now(), payload: this.serializeMine(mine) });
  }

  /** Host: a mine went off, was disarmed or recovered */
  static onMineRemoved(mine: ModuleTrigger) {
    const netId = mine.gmNetId;
    if (!netId) return;
    this.netIdMap.delete(netId);
    if (GMNetworkManager.role === 'host') {
      GMNetworkManager.sendPacket({ type: 'mine.remove', senderId: GMNetworkManager.peerId, timestamp: Date.now(), payload: { netId } });
    }
  }

  static applyMineOnClient(state: GMSerializedMine) {
    const area = GameState.module?.area;
    if (!area || !state) return;
    // Match the module's own mines by their id, which every machine works out the same way
    for (const mine of this.getMines()) this.mineNetId(mine);
    let mine = this.netIdMap.get(state.netId) as ModuleTrigger | undefined;
    if (!mine) {
      mine = GameState.Module.ModuleArea.ModuleTrigger.CreateMine(area, new THREE.Vector3(state.x, state.y, state.z), state.trapType, undefined, state.factionId);
      if (!mine) return;
      mine.gmNetId = state.netId;
      this.registerNetObject(state.netId, mine);
    }
    if (state.detected) mine.trapDetected = true;
  }

  static removeMineOnClient(netId: string) {
    const mine = this.netIdMap.get(netId) as ModuleTrigger | undefined;
    this.netIdMap.delete(netId);
    if (mine && this.isMine(mine) && mine.area) mine.destroy();
  }

  /** GM: place a mine (hostile to the players) */
  static placeMine(trapType: number, position: THREE.Vector3): ModuleTrigger | undefined {
    const mine = GameState.Module.ModuleArea.ModuleTrigger.CreateMine(GameState.module?.area, position.clone(), trapType, undefined, 1);
    if (mine) this.onMineChanged(mine);
    this.notifyChange();
    return mine;
  }

  /** The mine kinds the GM can place: traps.2da rows with a mine item */
  static getMineTypes(): { id: number; label: string }[] {
    const rows = GameState.TwoDAManager?.datatables.get('traps')?.rows || {};
    return Object.values(rows).filter((r: any) => r.resref && r.resref !== '****').map((r: any) => ({
      id: Number(r.__index),
      label: GameState.TLKManager?.GetStringById(Number(r.name))?.Value || String(r.label),
    }));
  }

  /** Host: a player's Demolitions pick (lay, set on a door or container, disarm, recover) */
  static async useMineOnHost(actor: ModuleCreature, intent: GMClientIntent): Promise<boolean> {
    if (!actor || actor.isDead()) return false;
    if ((actor.getSkillRanks?.(SkillType.DEMOLITIONS) ?? 0) < 1) return false;
    const target = intent.targetNetId ? this.netIdMap.get(intent.targetNetId) : undefined;
    switch (intent.mine) {
      case 'lay':
      case 'set': {
        const resRef = String(intent.resRef || '');
        if (!resRef || !this.getPlayerInventory(actor).some((e) => e.resRef === resRef)) return false;
        const item = await this.createItemFromResRefAsync(resRef);
        if (!item) return false;
        const onTarget = intent.mine === 'set' ? target : actor;
        if (!onTarget) return false;
        const action = new GameState.ActionFactory.ActionSetMine();
        action.setOwner(actor);
        action.setParameter(0, ActionParameterType.DWORD, item);
        action.setParameter(1, ActionParameterType.DWORD, onTarget);
        action.setParameter(2, ActionParameterType.FLOAT, onTarget.position.x);
        action.setParameter(3, ActionParameterType.FLOAT, onTarget.position.y);
        action.setParameter(4, ActionParameterType.FLOAT, onTarget.position.z);
        actor.actionQueue.add(action);
        return true;
      }
      case 'disarm':
      case 'recover': {
        if (!this.isMine(target) || !target.trapDetected) return false;
        const action = intent.mine === 'disarm' ? new GameState.ActionFactory.ActionDisarmMine() : new GameState.ActionFactory.ActionRecoverMine();
        action.setOwner(actor);
        action.setParameter(0, ActionParameterType.DWORD, target);
        actor.actionQueue.add(action);
        return true;
      }
    }
    return false;
  }

  /** Host: a player's mine came out of their inventory (true when it was a GM session player's) */
  static consumePlayerItem(owner: ModuleObject, item: ModuleItem): boolean {
    if (!GameState.gmMode || GMNetworkManager.role !== 'host' || !owner?.gmOwnerPeerId) return false;
    this.removeFromPlayerInventory(owner, item.getItemResRef());
    return true;
  }

  /** Host: a recovered mine goes into a GM session player's inventory (true when it did) */
  static giveRecoveredMine(owner: ModuleObject, resRef: string): boolean {
    if (!GameState.gmMode || GMNetworkManager.role !== 'host' || !owner?.gmOwnerPeerId) return false;
    this.addToPlayerInventory(owner, [{ resRef, stack: 1 }]);
    return true;
  }

  /** A Demolitions roll, said in chat in a GM session */
  static announceSkillRoll(owner: ModuleObject, label: string, roll: number, bonus: number, dc: number, success: boolean) {
    if (!GameState.gmMode) return;
    const text = this.describeCheck({ name: owner?.getName?.() || 'Someone', label, roll, bonus, total: roll + bonus, dc, success });
    if (GMNetworkManager.role === 'host') GMNetworkManager.sendChat('Check', text);
    else GMNetworkManager.appendChat('Check', text);
  }

  /**
   * Host: hand position authority back to the owning client once its intent has finished
   */
  static updateHostDrivenActors() {
    for (const obj of this.netIdMap.values()) {
      if (!obj.gmHostDriven) continue;
      const cre = obj as ModuleCreature;
      if (!cre.actionQueue?.length || cre.isDead()) {
        cre.gmHostDriven = false;
      }
    }
  }

  /**
   * True when this creature's logic (actions, AI, combat) is owned by another machine and must not run locally
   */
  static isNetReplica(cre: ModuleCreature): boolean {
    if (GMNetworkManager.role !== 'client') return false;
    if (!cre.gmNetId) return false;
    if (cre.gmNetId !== GMNetworkManager.assignedActorNetId) return true;
    return GMNetworkManager.awaitingHost;
  }

  /**
   * True when this creature's position is streamed from the network and smoothed locally
   */
  static isNetMotionDriven(cre: ModuleCreature): boolean {
    if (this.isNetReplica(cre)) return true;
    return GMNetworkManager.role === 'host' && !!cre.gmOwnerPeerId && !cre.gmHostDriven;
  }

  static setNetTarget(obj: ModuleObject, x: number, y: number, z: number) {
    let target = obj.gmNetTarget as THREE.Vector3 | undefined;
    if (!target) {
      target = new THREE.Vector3();
      obj.gmNetTarget = target;
    }
    target.set(x, y, z);
    // Snap on first sync or teleports instead of sliding across the map
    if (obj.position.distanceTo(target) > this.NET_SNAP_DISTANCE) {
      obj.position.copy(target);
      obj.getCurrentRoom();
    }
  }

  /**
   * Smooth a network-driven creature toward its latest synced position and pick a locomotion animation from its speed
   */
  static updateNetMotion(cre: ModuleCreature, delta: number) {
    const target = cre.gmNetTarget as THREE.Vector3 | undefined;
    let speed = 0;
    if (target && delta > 0) {
      const alpha = 1 - Math.exp(-delta * this.NET_SMOOTHING);
      const dx = (target.x - cre.position.x) * alpha;
      const dy = (target.y - cre.position.y) * alpha;
      const dz = (target.z - cre.position.z) * alpha;
      cre.position.x += dx;
      cre.position.y += dy;
      cre.position.z += dz;
      speed = Math.sqrt(dx * dx + dy * dy) / delta;
      if (speed > 0.05) {
        cre.getCurrentRoom();
      }
    }

    if (cre.isDead()) return;
    const anim = cre.animationState.index;
    const isLocomotion = anim === ModuleCreatureAnimState.RUNNING || anim === ModuleCreatureAnimState.WALKING;
    if (speed > cre.getWalkSpeed() * 1.25) {
      if (anim !== ModuleCreatureAnimState.RUNNING) cre.setAnimationState(ModuleCreatureAnimState.RUNNING);
    } else if (speed > 0.4) {
      if (anim !== ModuleCreatureAnimState.WALKING) cre.setAnimationState(ModuleCreatureAnimState.WALKING);
    } else {
      const hostAnim = cre.gmNetAnim as number | undefined;
      const hostIsLocomotion = hostAnim === ModuleCreatureAnimState.RUNNING || hostAnim === ModuleCreatureAnimState.WALKING;
      const hostIsFxDriven = this.FX_DRIVEN_ANIM_STATES.includes(hostAnim);
      // Let a replayed attack/reaction animation finish before applying the tick's state
      const fxPlaying = !!cre.gmFxAnimation && cre.animationState.animation === cre.gmFxAnimation;
      if (hostAnim && !hostIsLocomotion && !hostIsFxDriven && !fxPlaying && hostAnim !== anim) {
        cre.setAnimationState(hostAnim);
      } else if (isLocomotion) {
        cre.setAnimationState(cre.combatData.combatState ? ModuleCreatureAnimState.READY : ModuleCreatureAnimState.PAUSE);
      }
    }
  }

  /**
   * Client: turn a click on a world object into a host intent instead of running it locally.
   * Returns true when the click was handled.
   */
  static interceptInteraction(pc: ModuleObject, target: ModuleObject): boolean {
    if (GMNetworkManager.role !== 'client' || !target) return false;
    if (!pc || pc.gmNetId !== GMNetworkManager.assignedActorNetId) return false;
    if (this.isPlayerFrozen(pc)) return true;
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
    const reserved = this.reservedPlayers.get(String(playerName || '').trim().toLowerCase());
    if (reserved) {
      this.reservedPlayers.delete(reserved.name.trim().toLowerCase());
      const pc = await this.spawnSavedPlayer(reserved, peerId);
      if (pc) GMNetworkManager.appendChat('System', `${reserved.name} picked up their saved character.`);
      return pc ? (pc.gmNetId || null) : null;
    }
    const basePreset = this.PLAYER_PRESETS.find(p => p.classId === preset?.classId) || this.PLAYER_PRESETS[0];
    const spawned = await this.spawnPlayerCharacter(
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
      this.sceneStartPoint ? this.sceneStartPoint.clone() : undefined
    );
    return spawned ? (spawned.gmNetId || null) : null;
  }
}

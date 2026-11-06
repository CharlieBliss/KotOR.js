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
import type { ICharacterBuild } from "@/engine/rules/CharacterBuilder";
import { TalentFeat, TalentSpell } from "@/talents";
import { ModuleObject, ModuleCreature, ModulePlayer, ModulePlaceable, ModuleDoor, ModuleItem } from "@/module";
import { OdysseyModel3D } from "@/three/odyssey";
import { OdysseyModelAnimation } from "@/odyssey";
import { TextSprite3D } from "@/engine/TextSprite3D";
import type { ITwoDAAnimation } from "@/interface/twoDA/ITwoDAAnimation";
import type { GameEffect } from "@/effects/GameEffect";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
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

export type GMControlMode = 'FREECAM' | 'POSSESS';
export type GMToolMode = 'select' | 'place_creature' | 'place_placeable' | 'place_player' | 'teleport'
  // Ordering an NPC (GMNpcOrders): click the ground to move it, a creature to attack or follow, points to patrol
  | 'order_move' | 'order_attack' | 'order_follow' | 'order_patrol';

export interface GMModuleEntry {
  resRef: string;
  planet: string;
  title: string;
  description: string;
}

export interface GMCreatureSpawnConfig {
  name: string;
  /** A game template (.utc). Without customized, the creature keeps the template's own look, stats and gear */
  templateResRef?: string;
  appearanceId: number;
  /** Exact appearance.2da label; wins over appearanceId when the creature is built without a template */
  appearanceLabel?: string;
  /**
   * The GM changed this creature from its preset or template: its appearance, HP and gear are used instead of
   * the template's. Name, faction, bark and loot always apply.
   */
  customized?: boolean;
  factionId: number; // 0 = Party/Player, 1 = Hostile, 2 = Friendly, 5 = Neutral
  hp: number;
  level: number;
  classId: number;
  rightHandResRef?: string;
  leftHandResRef?: string;
  armorResRef?: string;
  barkText?: string;
  aiDisabled?: boolean;
  /** Items the creature carries, lootable from its body once it dies */
  lootResRefs?: string[];
}

/** What a creature template (.utc) holds, for choosing one in the GM panel */
export interface GMCreatureTemplateInfo {
  resRef: string;
  name: string;
  appearanceId: number;
  appearanceLabel: string;
  factionId: number;
  hp: number;
  fp: number;
  level: number;
  classId: number;
  /** e.g. "Soldier 5" or "Soldier 10 / Scoundrel 3" */
  classes: string;
  rightHandResRef: string;
  leftHandResRef: string;
  armorResRef: string;
}

export type GMPlaceablePropCategory =
  | 'Office & Furniture'
  | 'Temple & Sacred'
  | 'Tech & Consoles'
  | 'Medical & Lab'
  | 'Storage & Cargo';

export interface GMPlaceableSpawnConfig {
  name: string;
  category?: GMPlaceablePropCategory;
  templateResRef?: string;
  appearanceId: number;
  /** Exact placeables.2da label for the model; wins over appearanceId and modelKeywords */
  appearanceLabel?: string;
  modelKeywords?: string[];
  /**
   * The GM changed this object from its preset or template. Without it, an object built from a .utp
   * template keeps the template's own model, name and settings.
   */
  customized?: boolean;
  scale?: number;
  zOffset?: number;
  useable: boolean;
  hasInventory: boolean;
  locked: boolean;
  openLockDC: number;
  lootResRefs: string[];
  barkText?: string;
}

export interface GMSceneBlueprintItem {
  dx: number;
  dy: number;
  dz?: number;
  yawDeg: number;
  config: GMPlaceableSpawnConfig;
}

export interface GMSceneBlueprintCreature {
  dx: number;
  dy: number;
  dz?: number;
  yawDeg: number;
  config: GMCreatureSpawnConfig;
}

export interface GMSceneBlueprint {
  id: string;
  title: string;
  category: string;
  description: string;
  recommendedModule: string;
  items: GMSceneBlueprintItem[];
  creatures?: GMSceneBlueprintCreature[];
  isCustom?: boolean;
}

export interface GMPlayerSpawnConfig {
  name: string;
  appearanceId: number;
  portraitId: number;
  gender: number;
  classId: number; // 0=Soldier, 1=Scout, 2=Scoundrel, 3=Jedi Guardian, 4=Jedi Consular, 5=Jedi Sentinel
  level: number;
  /** Override the class's vitality (CharacterBuilder) */
  hp?: number;
  /** Override the class's Force points (CharacterBuilder) */
  fp?: number;
  /** Which side's recommended Force powers the class takes (light by default) */
  alignment?: 'light' | 'dark';
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  rightHandResRef?: string;
  leftHandResRef?: string;
  armorResRef?: string;
  /** Override the class's feats (CharacterBuilder): feat.2da rows */
  featIds?: number[];
  /** Override the class's Force powers (CharacterBuilder): spells.2da rows */
  spellIds?: number[];
  possessImmediately?: boolean;
  ownerPeerId?: string;
}

/** A GM-placed creature or placeable as saved in a session */
export interface GMSavedObject {
  kind: 'creature' | 'placeable';
  config: GMCreatureSpawnConfig | GMPlaceableSpawnConfig;
  x: number;
  y: number;
  z: number;
  facing: number;
  factionId?: number;
  hp?: number;
  maxHp?: number;
  locked?: boolean;
  hidden?: boolean;
  loot: string[];
  barkText: string;
}

/** A player character as saved in a session; network players are matched back by name */
export interface GMSavedPlayer {
  name: string;
  /** Controlled on the GM's machine rather than by a connected player */
  local: boolean;
  config: GMPlayerSpawnConfig;
  sheet: GMPlayerSheet;
  x: number;
  y: number;
  z: number;
  facing: number;
  hidden?: boolean;
}

/** Everything needed to pick a GM session back up later */
export interface GMSessionSave {
  version: 1;
  id: string;
  name: string;
  savedAt: number;
  scene: { module: string; keepCreatures: boolean; keepTriggers: boolean; keepPlaceables: boolean };
  objects: GMSavedObject[];
  doors: { netId: string; openState: number; locked: boolean }[];
  players: GMSavedPlayer[];
  /** Added later; older saves use the default rules */
  rules?: GMSessionRules;
}

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
    factionId: 1, // Hostile
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

  // Curated Module Catalog (KotOR 1 & 2)
  static CURATED_MODULES: GMModuleEntry[] = [
    // Dantooine
    { resRef: 'danm14aa', planet: 'Dantooine', title: 'Courtyard (danm14aa)', description: 'Jedi Enclave exterior courtyard and grassy plains' },
    { resRef: 'danm13', planet: 'Dantooine', title: 'Jedi Enclave (danm13)', description: 'Jedi Council chambers, training rooms, and landing pad' },
    { resRef: 'danm14ab', planet: 'Dantooine', title: 'Matale Grounds (danm14ab)', description: 'Rolling plains, bridge, and estate grounds' },
    { resRef: 'danm14ac', planet: 'Dantooine', title: 'Grove (danm14ac)', description: 'Ancient grove, ruins path, and kath hound plains' },
    { resRef: 'danm14ad', planet: 'Dantooine', title: 'Sandral Grounds (danm14ad)', description: 'Sandral estate exterior and crystal cave entrance' },
    { resRef: 'danm15', planet: 'Dantooine', title: 'Ancient Ruins (danm15)', description: 'Star Map temple interior with droid guardians' },
    { resRef: 'danm16', planet: 'Dantooine', title: 'Sandral Estate (danm16)', description: 'Fortified private compound interior' },
    // Taris
    { resRef: 'tar_m02aa', planet: 'Taris', title: 'Upper City South (tar_m02aa)', description: 'Skyscraper walkways, apartamentos plaza, and cantina entrance' },
    { resRef: 'tar_m02ab', planet: 'Taris', title: 'Upper City North (tar_m02ab)', description: 'Upper City promenade, medical clinic, and Sith base entrance' },
    { resRef: 'tar_m02ac', planet: 'Taris', title: 'Upper City Cantina (tar_m02ac)', description: 'Dueling ring, pazaak den, and lounge' },
    { resRef: 'tar_m03aa', planet: 'Taris', title: 'Lower City (tar_m03aa)', description: 'Swoop gang street between Javyar\'s Cantina and bases' },
    { resRef: 'tar_m03ae', planet: 'Taris', title: 'Javyar\'s Cantina (tar_m03ae)', description: 'Lower City cantina interior' },
    { resRef: 'tar_m04aa', planet: 'Taris', title: 'Undercity (tar_m04aa)', description: 'Outcast village and rakghoul-infested wasteland' },
    { resRef: 'tar_m09aa', planet: 'Taris', title: 'Sith Military Base (tar_m09aa)', description: 'Imperial/Sith garrison command center' },
    { resRef: 'tar_m10aa', planet: 'Taris', title: 'Black Vulkar Base (tar_m10aa)', description: 'Gang headquarters and garage' },
    { resRef: 'tar_m11aa', planet: 'Taris', title: 'Hidden Bek Base (tar_m11aa)', description: 'Gadon Thek\'s base of operations' },
    // Ships & Stations
    { resRef: 'ebo_m12aa', planet: 'Ships & Stations', title: 'Ebon Hawk Interior (ebo_m12aa)', description: 'Player starship interior hub' },
    { resRef: 'end_m01aa', planet: 'Ships & Stations', title: 'Endar Spire - Command Module (end_m01aa)', description: 'Republic cruiser corridors under Sith attack' },
    { resRef: 'end_m01ab', planet: 'Ships & Stations', title: 'Endar Spire - Starboard Section (end_m01ab)', description: 'Bridge, engine room, and escape pods' },
    { resRef: 'liv_m99aa', planet: 'Ships & Stations', title: 'Yavin Station (liv_m99aa)', description: 'Suvam Tan\'s orbital space station' },
    { resRef: 'lev_m40aa', planet: 'Ships & Stations', title: 'Leviathan - Prison Block (lev_m40aa)', description: 'Sith flagship detention cells' },
    { resRef: 'lev_m40ab', planet: 'Ships & Stations', title: 'Leviathan - Command Deck (lev_m40ab)', description: 'Sith flagship bridge and hangar access' },
    { resRef: 'lev_m40ac', planet: 'Ships & Stations', title: 'Leviathan - Hangar (lev_m40ac)', description: 'Main docking bay where Darth Malak confronts the party' },
    // Tatooine
    { resRef: 'tat_m17aa', planet: 'Tatooine', title: 'Anchorhead (tat_m17aa)', description: 'Desert spaceport town streets' },
    { resRef: 'tat_m17ab', planet: 'Tatooine', title: 'Docking Bay (tat_m17ab)', description: 'Anchorhead starport landing pad' },
    { resRef: 'tat_m17ae', planet: 'Tatooine', title: 'Hunting Lodge (tat_m17ae)', description: 'Czerka hunters lounge' },
    { resRef: 'tat_m18aa', planet: 'Tatooine', title: 'Dune Sea (tat_m18aa)', description: 'Vast desert dunes and Sandcrawler' },
    { resRef: 'tat_m18ab', planet: 'Tatooine', title: 'Eastern Dune Sea (tat_m18ab)', description: 'Krayt Dragon cave and Star Map ruins' },
    { resRef: 'tat_m20aa', planet: 'Tatooine', title: 'Sand People Enclave (tat_m20aa)', description: 'Tusken Raider camp interior' },
    // Kashyyyk
    { resRef: 'kas_m22aa', planet: 'Kashyyyk', title: 'Czerka Landing Port (kas_m22aa)', description: 'Wroshyr tree landing pad' },
    { resRef: 'kas_m22ab', planet: 'Kashyyyk', title: 'The Great Walkway (kas_m22ab)', description: 'Canopy bridges leading to the Wookiee village' },
    { resRef: 'kas_m23aa', planet: 'Kashyyyk', title: 'Village of Rwookrrorro (kas_m23aa)', description: 'Wookiee chieftain halls and tree village' },
    { resRef: 'kas_m24aa', planet: 'Kashyyyk', title: 'Upper Shadowlands (kas_m24aa)', description: 'Dark forest floor where Jolee Bindo dwells' },
    { resRef: 'kas_m25aa', planet: 'Kashyyyk', title: 'Lower Shadowlands (kas_m25aa)', description: 'Deep jungle floor with Star Map and Mandalorians' },
    // Manaan
    { resRef: 'manm26aa', planet: 'Manaan', title: 'Ahto West (manm26aa)', description: 'Floating city courts and Republic/Sith embassies' },
    { resRef: 'manm26ab', planet: 'Manaan', title: 'Ahto East (manm26ab)', description: 'Central plaza and swoop track' },
    { resRef: 'manm26ad', planet: 'Manaan', title: 'Docking Bay (manm26ad)', description: 'Ahto City hangar bay' },
    { resRef: 'manm27aa', planet: 'Manaan', title: 'Sith Base (manm27aa)', description: 'Sith Embassy interior on Manaan' },
    { resRef: 'manm28aa', planet: 'Manaan', title: 'Hrakert Station (manm28aa)', description: 'Underwater research facility' },
    // Korriban
    { resRef: 'korr_m33aa', planet: 'Korriban', title: 'Dreshdae (korr_m33aa)', description: 'Sith colony port and cantina' },
    { resRef: 'korr_m35aa', planet: 'Korriban', title: 'Sith Academy (korr_m35aa)', description: 'Main Sith training academy halls' },
    { resRef: 'korr_m36aa', planet: 'Korriban', title: 'Valley of the Dark Lords (korr_m36aa)', description: 'Canyon of ancient Sith Lord tombs' },
    { resRef: 'korr_m37aa', planet: 'Korriban', title: 'Tomb of Ajunta Pall (korr_m37aa)', description: 'Ancient Sith tomb with blade bridge' },
    { resRef: 'korr_m38aa', planet: 'Korriban', title: 'Tomb of Marko Ragnos (korr_m38aa)', description: 'Rogue droid tomb interior' },
    { resRef: 'korr_m38ab', planet: 'Korriban', title: 'Tomb of Tulak Hord (korr_m38ab)', description: 'Ancient Sith Lord tomb' },
    { resRef: 'korr_m39aa', planet: 'Korriban', title: 'Tomb of Naga Sadow (korr_m39aa)', description: 'Final trial tomb with Star Map and Terentateks' },
    // Unknown World & Star Forge
    { resRef: 'unk_m41aa', planet: 'Unknown World', title: 'Central Beach (unk_m41aa)', description: 'Tropical beach landing site on Lehon' },
    { resRef: 'unk_m41ac', planet: 'Unknown World', title: 'Temple Exterior (unk_m41ac)', description: 'Summit of the Ancient Rakatan Temple' },
    { resRef: 'unk_m44aa', planet: 'Unknown World', title: 'Temple Main Floor (unk_m44aa)', description: 'Interior of the Rakatan Temple' },
    { resRef: 'sta_m45aa', planet: 'Star Forge', title: 'Deck 1 (sta_m45aa)', description: 'Star Forge exterior walkways and defense towers' },
    { resRef: 'sta_m45ad', planet: 'Star Forge', title: 'Viewing Platform (sta_m45ad)', description: 'Final confrontation arena with Darth Malak' },
  ];

  // Curated Creature Presets
  /**
   * Creature presets: KotOR's own templates (.utc), so each keeps the game's look, stats, class, powers and gear.
   * The appearance, HP, level and class here are the template's (shown in the panel), and the fallback when a
   * template is missing (another game's data). A preset's weapon only fills a hand the template leaves empty.
   */
  static CREATURE_PRESETS: GMCreatureSpawnConfig[] = [
    // Hostile
    { name: 'Sith Trooper', templateResRef: 'g_sithtroop01', appearanceId: 28, appearanceLabel: 'Sith_Soldier_01', factionId: 1, hp: 25, level: 3, classId: 8, barkText: 'Halt! By order of the Sith!' },
    { name: 'Sith Elite Trooper', templateResRef: 'g_sithtroop02', appearanceId: 44, appearanceLabel: 'Sith_Soldier_02', factionId: 1, hp: 35, level: 5, classId: 0, barkText: 'For the Sith Empire!' },
    { name: 'Sith Heavy Trooper', templateResRef: 'g_sithtroop03', appearanceId: 44, appearanceLabel: 'Sith_Soldier_02', factionId: 1, hp: 48, level: 8, classId: 0, barkText: 'Open fire!' },
    { name: 'Sith Grenadier', templateResRef: 'g_sithtroop04', appearanceId: 28, appearanceLabel: 'Sith_Soldier_01', factionId: 1, hp: 30, level: 6, classId: 0, barkText: 'Grenade out!' },
    { name: 'Sith Assault Trooper', templateResRef: 'g_sithtroop07', appearanceId: 44, appearanceLabel: 'Sith_Soldier_02', factionId: 1, hp: 96, level: 12, classId: 0, barkText: 'Leave no survivors!' },
    { name: 'Sith Lieutenant', templateResRef: 'g_sithcomm01', appearanceId: 42, appearanceLabel: 'Sith_Female_Albino', factionId: 1, hp: 42, level: 5, classId: 1, barkText: 'Take them down!' },
    { name: 'Sith Captain', templateResRef: 'g_sithcomm02', appearanceId: 43, appearanceLabel: 'Sith_Male_Albino', factionId: 1, hp: 64, level: 8, classId: 1, barkText: 'You will answer to the Sith!' },
    { name: 'Dark Jedi Apprentice', templateResRef: 'g_darkjedi01', appearanceId: 20, appearanceLabel: 'Dark_Jedi_Male_01', factionId: 1, hp: 31, level: 4, classId: 3, barkText: 'The dark side will consume you!' },
    { name: 'Dark Jedi', templateResRef: 'g_darkjedi02', appearanceId: 19, appearanceLabel: 'Dark_Jedi_Female_01', factionId: 1, hp: 80, level: 8, classId: 3, barkText: 'Your feeble skills are no match for the dark side!' },
    { name: 'Dark Jedi Master', templateResRef: 'g_darkjedi03', appearanceId: 20, appearanceLabel: 'Dark_Jedi_Male_01', factionId: 1, hp: 110, level: 12, classId: 3, barkText: 'You know nothing of true power.' },
    { name: 'Darth Malak', templateResRef: 'n_darthmalak', appearanceId: 21, appearanceLabel: 'Unique_Darth_Malak', factionId: 1, hp: 114, level: 20, classId: 3, barkText: 'Wipe this pathetic planet from the face of the galaxy!' },
    { name: 'Darth Bandon', templateResRef: 'g_bandon', appearanceId: 184, appearanceLabel: 'Unique_Darth_Bandon', factionId: 1, hp: 40, level: 15, classId: 3, barkText: 'You will bow before the Sith!' },
    { name: 'Calo Nord', templateResRef: 'n_calonord', appearanceId: 13, appearanceLabel: 'Unique_Calo_Nord', factionId: 1, hp: 219, level: 13, classId: 0, barkText: 'One... Two... Three.' },
    { name: 'Mandalorian Warrior', templateResRef: 'g_mandalor01', appearanceId: 35, appearanceLabel: 'Alien_Mandalorian_01', factionId: 1, hp: 34, level: 4, classId: 8, barkText: 'For Mandalore!' },
    { name: 'Mandalorian Elite', templateResRef: 'g_mandalor02', appearanceId: 351, appearanceLabel: 'Alien_Mandalorian_02', factionId: 1, hp: 56, level: 8, classId: 0, barkText: 'This is the way of the warrior!' },
    { name: 'Sand People Warrior', templateResRef: 'g_tuskenmale01', appearanceId: 46, appearanceLabel: 'Alien_Sand_People_01', factionId: 1, hp: 16, level: 3, classId: 8, barkText: '*Aggressive Tusken war cry!*' },
    { name: 'Rodian Thug', templateResRef: 'g_thug01', appearanceId: 257, appearanceLabel: 'Alien_Rodian_03', factionId: 1, hp: 20, level: 3, classId: 8, barkText: 'Hand over your credits!' },
    { name: 'Gamorrean', templateResRef: 'g_gammorean01', appearanceId: 240, appearanceLabel: 'Alien_Gammorean_02', factionId: 1, hp: 6, level: 1, classId: 8, barkText: '*Gamorrean grunting*' },
    { name: 'War Droid Mark I', templateResRef: 'g_wardroid01', appearanceId: 66, appearanceLabel: 'Droid_War_01', factionId: 1, hp: 8, level: 1, classId: 8, barkText: 'Target acquired. Eliminating threat.' },
    { name: 'War Droid Mark II', templateResRef: 'c_drdwar', appearanceId: 236, appearanceLabel: 'Droid_War_02', factionId: 1, hp: 14, level: 3, classId: 8, barkText: 'Target acquired. Eliminating threat.' },
    { name: 'Assassin Droid', templateResRef: 'g_assassindrd01', appearanceId: 56, appearanceLabel: 'Droid_Assassin', factionId: 1, hp: 59, level: 6, classId: 6, barkText: 'Termination protocol engaged.' },
    { name: 'Kath Hound', templateResRef: 'c_khounda', appearanceId: 75, appearanceLabel: 'Creature_Kath_Hound_A01', factionId: 1, hp: 25, level: 3, classId: 8, barkText: '*Snarls menacingly*' },
    { name: 'Rakghoul', templateResRef: 'g_rakghoul01', appearanceId: 79, appearanceLabel: 'Creature_Rakghoul', factionId: 1, hp: 6, level: 1, classId: 8, barkText: '*Ferocious screech!*' },
    { name: 'Kinrath', templateResRef: 'c_kinrath', appearanceId: 88, appearanceLabel: 'Creature_Kinrath', factionId: 1, hp: 35, level: 4, classId: 8, barkText: '*Clicking mandibles*' },
    { name: 'Tuk\'ata', templateResRef: 'c_tukata', appearanceId: 89, appearanceLabel: 'Creature_Tukata', factionId: 1, hp: 56, level: 8, classId: 8, barkText: '*Low growl*' },
    { name: 'Terentatek', templateResRef: 'g_terantanak', appearanceId: 353, appearanceLabel: 'Creature_Terantanak', factionId: 1, hp: 150, level: 10, classId: 0, barkText: '*Earth-shaking roar!*' },
    { name: 'Rancor', templateResRef: 'g_rancor01', appearanceId: 80, appearanceLabel: 'Creature_Rancor', factionId: 1, hp: 350, level: 20, classId: 0, barkText: '*Deafening Rancor roar!*' },
    // Friendly: armed with what they carry, plus a weapon where the template has none
    { name: 'Republic Soldier', templateResRef: 'n_repsold', appearanceId: 38, appearanceLabel: 'Republic_Soldier_Mal_White', factionId: 2, hp: 8, level: 1, classId: 0, rightHandResRef: 'g_w_blstrrfl001', barkText: 'Reporting for duty! For the Republic!' },
    { name: 'Republic Officer', templateResRef: 'n_repoff', appearanceId: 37, appearanceLabel: 'Republic_Officer_Mal_White', factionId: 2, hp: 8, level: 1, classId: 0, rightHandResRef: 'g_w_blstrpstl001', barkText: 'Hold the line!' },
    { name: 'Jedi', templateResRef: 'n_jedicounm', appearanceId: 214, appearanceLabel: 'Jedi_White_Male_02', factionId: 2, hp: 8, level: 1, classId: 3, barkText: 'May the Force be with you.' },
    { name: 'Wookiee Warrior', templateResRef: 'g_wookiemale01', appearanceId: 272, appearanceLabel: 'Alien_Wookie_Male_03', factionId: 2, hp: 30, level: 4, classId: 0, barkText: '*Fierce Wookiee roar*' },
    { name: 'Bastila Shan', templateResRef: 'p_bastilla', appearanceId: 4, appearanceLabel: 'Party_NPC_Bastila', factionId: 2, hp: 27, level: 3, classId: 5, rightHandResRef: 'g_w_dblsbr001', barkText: 'Keep your guard up. The Force is with us.' },
    { name: 'Carth Onasi', templateResRef: 'p_carth', appearanceId: 6, appearanceLabel: 'Party_NPC_Carth', factionId: 2, hp: 44, level: 4, classId: 0, barkText: 'Down you go!' },
    { name: 'Canderous Ordo', templateResRef: 'p_cand', appearanceId: 5, appearanceLabel: 'Party_NPC_Cand', factionId: 2, hp: 65, level: 5, classId: 0, barkText: 'Yeah, this is what I live for!' },
    { name: 'HK-47', templateResRef: 'p_hk47', appearanceId: 3, appearanceLabel: 'Party_NPC_HK47', factionId: 2, hp: 66, level: 6, classId: 6, barkText: 'Statement: Ready to terminate any hostile meatbags, Master.' },
    { name: 'Jolee Bindo', templateResRef: 'p_jolee', appearanceId: 7, appearanceLabel: 'Party_NPC_Jolee', factionId: 2, hp: 42, level: 6, classId: 4, barkText: 'Get off my lawn, you kids!' },
    { name: 'Juhani', templateResRef: 'p_juhani', appearanceId: 8, appearanceLabel: 'Party_NPC_Juhani', factionId: 2, hp: 78, level: 6, classId: 3, barkText: 'I will be your doom!' },
    { name: 'Mission Vao', templateResRef: 'p_mission', appearanceId: 10, appearanceLabel: 'Party_NPC_Mission', factionId: 2, hp: 21, level: 3, classId: 2, barkText: 'Need something unlocked? I\'m on it!' },
    { name: 'Zaalbar', templateResRef: 'p_zaalbar', appearanceId: 9, appearanceLabel: 'Party_NPC_Zaalbar', factionId: 2, hp: 52, level: 4, classId: 1, rightHandResRef: 'g_w_bowcstr001', barkText: '*Loyal Wookiee growl*' },
    { name: 'T3-M4', templateResRef: 'p_t3m4', appearanceId: 2, appearanceLabel: 'Party_NPC_T3M3', factionId: 2, hp: 30, level: 3, classId: 7, barkText: '*Cheerful astromech binary whistle*' },
    // Neutral
    { name: 'Protocol Droid', templateResRef: 'c_drdprot', appearanceId: 63, appearanceLabel: 'Droid_Protocol_01', factionId: 5, hp: 9, level: 1, classId: 7, barkText: 'Greetings! How may I be of assistance today?' },
    { name: 'Selkath', templateResRef: 'n_selkath', appearanceId: 40, appearanceLabel: 'Alien_Selkath_01', factionId: 5, hp: 9, level: 1, classId: 8, barkText: 'Obey the neutrality laws of Ahto City.' },
    { name: 'Twi\'lek', templateResRef: 'n_twilekf', appearanceId: 47, appearanceLabel: 'Alien_Twilek_Female_01', factionId: 5, hp: 8, level: 1, classId: 0, barkText: 'Welcome, traveler! Looking for rare goods?' },
    { name: 'Rodian', templateResRef: 'n_rodian', appearanceId: 39, appearanceLabel: 'Alien_Rodian_01', factionId: 5, hp: 8, level: 1, classId: 2, barkText: 'Keep moving, outsider.' },
    { name: 'Commoner', templateResRef: 'n_commm', appearanceId: 17, appearanceLabel: 'Commoner_01_Mal_Asian', factionId: 5, hp: 8, level: 1, classId: 0, barkText: 'Can I help you?' },
    { name: 'Jawa', templateResRef: 'c_jawa', appearanceId: 73, appearanceLabel: 'Alien_Jawa', factionId: 5, hp: 8, level: 1, classId: 2, barkText: 'Utinni!' },
    { name: 'Dewback', templateResRef: 'g_dewback01', appearanceId: 55, appearanceLabel: 'Creature_Dewback', factionId: 5, hp: 42, level: 5, classId: 0, barkText: '*Placid snort*' },
  ];

  // Curated Placeable Presets
  static PLACEABLE_PRESETS: GMPlaceableSpawnConfig[] = [
    { name: 'Supply Footlocker', category: 'Storage & Cargo', appearanceId: 52, modelKeywords: ['footlker', 'locker', 'box'], useable: true, hasInventory: true, locked: false, openLockDC: 15, lootResRefs: ['g_i_medeqpmnt01', 'g_i_medeqpmnt02', 'g_i_secspike01'], barkText: '' },
    { name: 'Jedi Weapons Cache', category: 'Temple & Sacred', appearanceId: 53, modelKeywords: ['ornate', 'chest', 'wicker', 'box'], useable: true, hasInventory: true, locked: false, openLockDC: 18, lootResRefs: ['g_w_lghtsbr01', 'g_w_lghtsbr02', 'g_w_dblsbr001', 'g_a_jedirobe01'], barkText: '' },
    { name: 'Locked Sith Vault (DC 18)', category: 'Storage & Cargo', appearanceId: 54, modelKeywords: ['metal', 'vault', 'safe', 'box'], useable: true, hasInventory: true, locked: true, openLockDC: 18, lootResRefs: ['g_w_lghtsbr02', 'g_a_mstrrobe02', 'g_i_medeqpmnt03'], barkText: '' },
    { name: 'Sith Sarcophagus', category: 'Temple & Sacred', appearanceId: 64, modelKeywords: ['sarcoph', 'tomb', 'altar'], useable: true, hasInventory: true, locked: false, openLockDC: 20, lootResRefs: ['g_w_dblsbr002', 'g_a_mstrrobe02'], barkText: '' },
    { name: 'Computer Terminal', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'terminal', 'console', 'panel'], useable: true, hasInventory: false, locked: false, openLockDC: 15, lootResRefs: [], barkText: '[Terminal Active]: Security grid online. All sector doors operational.' },
    { name: 'Workbench', category: 'Storage & Cargo', appearanceId: 68, modelKeywords: ['workbench', 'bench'], useable: true, hasInventory: true, locked: false, openLockDC: 10, lootResRefs: ['g_w_blstrrfl001', 'g_w_vbroswrd01'], barkText: '[Workbench]: Ready for weapon & armor modifications.' },
    { name: 'Kolto Healing Tank', category: 'Medical & Lab', appearanceId: 39, modelKeywords: ['kolto', 'bacta', 'tank'], useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [], barkText: '[Kolto Dispenser]: Dispensing emergency Bacta/Kolto mist.' },
    { name: 'Skeletal Remains', category: 'Temple & Sacred', appearanceId: 62, modelKeywords: ['skeleton', 'corpse', 'remains', 'bones'], useable: true, hasInventory: true, locked: false, openLockDC: 10, lootResRefs: ['g_i_medeqpmnt01', 'g_w_blstrpstl001'], barkText: '' },
  ];

  // Categorized Architectural & Prop Library for Building Custom Scenes (Office, Temple, Lab, etc.)
  static CATEGORIZED_PROPS: GMPlaceableSpawnConfig[] = [
    // Office & Furniture
    {
      name: 'Executive Office Desk',
      category: 'Office & Furniture',
      appearanceId: 55,
      modelKeywords: ['desk', 'table', 'counter'],
      scale: 1.0,
      useable: true,
      hasInventory: true,
      locked: false,
      openLockDC: 12,
      lootResRefs: ['g_i_progspike01', 'g_i_secspike01'],
      barkText: '[Executive Desk]: Stacked with corporate datapads and sector clearance files.'
    },
    {
      name: 'Office / Cantina Chair',
      category: 'Office & Furniture',
      appearanceId: 44,
      modelKeywords: ['chair', 'seat', 'stool'],
      scale: 1.0,
      useable: true,
      hasInventory: false,
      locked: false,
      openLockDC: 10,
      lootResRefs: [],
      barkText: '[Office Chair]: Ergonomic repulsor-cushioned seating.'
    },
    {
      name: 'Conference / Briefing Table',
      category: 'Office & Furniture',
      appearanceId: 45,
      modelKeywords: ['table', 'pazaak', 'desk'],
      scale: 1.3,
      useable: true,
      hasInventory: false,
      locked: false,
      openLockDC: 10,
      lootResRefs: [],
      barkText: '[Conference Table]: Built-in holo-emitters for executive briefings.'
    },
    {
      name: 'Workstation Computer Terminal',
      category: 'Office & Furniture',
      appearanceId: 57,
      modelKeywords: ['comp', 'panel', 'terminal', 'console'],
      scale: 0.9,
      useable: true,
      hasInventory: false,
      locked: false,
      openLockDC: 14,
      lootResRefs: [],
      barkText: '[Desktop Terminal]: Connected to the facility intranet and personnel directory.'
    },
    {
      name: 'Filing Cabinet / Office Locker',
      category: 'Office & Furniture',
      appearanceId: 52,
      modelKeywords: ['locker', 'cabinet', 'footlker'],
      scale: 1.0,
      useable: true,
      hasInventory: true,
      locked: false,
      openLockDC: 14,
      lootResRefs: ['g_i_progspike01', 'g_i_medeqpmnt01'],
      barkText: '[Filing Cabinet]: Contains classified employee records and keycards.'
    },
    {
      name: 'Executive Vault Safe (Locked DC 18)',
      category: 'Office & Furniture',
      appearanceId: 54,
      modelKeywords: ['safe', 'vault', 'metal', 'box', 'footlker'],
      scale: 1.05,
      useable: true,
      hasInventory: true,
      locked: true,
      openLockDC: 18,
      lootResRefs: ['g_w_blstrpstl001', 'g_i_secspike01', 'g_i_medeqpmnt03'],
      barkText: '[Executive Safe]: Heavy durasteel safe with biometric security lock.'
    },
    {
      name: 'Architectural Partition / Pillar',
      category: 'Office & Furniture',
      appearanceId: 50,
      modelKeywords: ['pillar', 'column', 'sign', 'post'],
      scale: 1.25,
      useable: false,
      hasInventory: false,
      locked: false,
      openLockDC: 10,
      lootResRefs: [],
      barkText: ''
    },

    // Temple & Sacred
    {
      name: 'Ancient Temple Guardian Statue',
      category: 'Temple & Sacred',
      appearanceId: 65,
      modelKeywords: ['statue', 'idol', 'monument'],
      scale: 1.4,
      useable: true,
      hasInventory: false,
      locked: false,
      openLockDC: 10,
      lootResRefs: [],
      barkText: '[Guardian Statue]: A towering stone sentinel carved in a forgotten era of the Force.'
    },
    {
      name: 'Sacred Temple Pillar / Obelisk',
      category: 'Temple & Sacred',
      appearanceId: 65,
      appearanceLabel: 'RuneObelisk',
      modelKeywords: ['pillar', 'obelisk', 'column', 'statue'],
      scale: 1.75,
      useable: true,
      hasInventory: false,
      locked: false,
      openLockDC: 10,
      lootResRefs: [],
      barkText: '[Temple Obelisk]: Ancient Force runes shimmer faintly along the weathered stone.'
    },
    {
      name: 'Sacred Altar / Sith Sarcophagus',
      category: 'Temple & Sacred',
      appearanceId: 64,
      modelKeywords: ['sarcoph', 'altar', 'tomb', 'grave'],
      scale: 1.2,
      useable: true,
      hasInventory: true,
      locked: false,
      openLockDC: 20,
      lootResRefs: ['g_w_lghtsbr01', 'g_w_dblsbr002', 'g_a_mstrrobe02'],
      barkText: '[Sacred Altar]: A ceremonial stone altar radiating a powerful presence in the Force.'
    },
    {
      name: 'Holocron Pedestal / Star Map Shrine',
      category: 'Temple & Sacred',
      appearanceId: 57,
      modelKeywords: ['starmap', 'holo', 'pedestal', 'panel', 'console'],
      scale: 1.05,
      useable: true,
      hasInventory: true,
      locked: false,
      openLockDC: 15,
      lootResRefs: ['g_w_lghtsbr03', 'g_a_mstrrobe01'],
      barkText: '[Holocron Pedestal]: A crystalline matrix projects ancient teachings of the Force.'
    },
    {
      name: 'Ceremonial Temple Brazier',
      category: 'Temple & Sacred',
      appearanceId: 48,
      modelKeywords: ['brazier', 'torch', 'flame', 'light', 'lamp'],
      scale: 1.15,
      useable: true,
      hasInventory: false,
      locked: false,
      openLockDC: 10,
      lootResRefs: [],
      barkText: '[Ceremonial Brazier]: Eternal temple flames cast dancing shadows across the sanctuary.'
    },
    {
      name: 'Sanctified Relic Chest',
      category: 'Temple & Sacred',
      appearanceId: 53,
      modelKeywords: ['ornate', 'chest', 'wicker', 'box', 'footlker'],
      scale: 1.05,
      useable: true,
      hasInventory: true,
      locked: false,
      openLockDC: 18,
      lootResRefs: ['g_w_lghtsbr01', 'g_w_lghtsbr04', 'g_a_jedirobe01'],
      barkText: '[Sacred Relic Chest]: Ornate reliquary containing ancient Jedi artifacts.'
    },
    {
      name: 'Fallen Pilgrim Remains',
      category: 'Temple & Sacred',
      appearanceId: 62,
      modelKeywords: ['skeleton', 'corpse', 'bones', 'remains'],
      scale: 1.0,
      useable: true,
      hasInventory: true,
      locked: false,
      openLockDC: 10,
      lootResRefs: ['g_i_medeqpmnt01', 'g_w_lghtsbr02'],
      barkText: '[Ancient Remains]: A fallen acolyte who did not survive the temple trials.'
    },

    // Tech & Consoles
    {
      name: 'Mainframe Command Console',
      category: 'Tech & Consoles',
      appearanceId: 57,
      modelKeywords: ['comp', 'terminal', 'console'],
      scale: 1.1,
      useable: true,
      hasInventory: false,
      locked: false,
      openLockDC: 15,
      lootResRefs: [],
      barkText: '[Mainframe Console]: Sector defense grid, security cameras, and blast doors online.'
    },
    {
      name: 'Tactical Holo-Projector Table',
      category: 'Tech & Consoles',
      appearanceId: 58,
      modelKeywords: ['holo', 'table', 'comp', 'console'],
      scale: 1.35,
      useable: true,
      hasInventory: false,
      locked: false,
      openLockDC: 15,
      lootResRefs: [],
      barkText: '[Tactical Holo-Projector]: Displaying live planetary sector coordinates and fleet telemetry.'
    },
    {
      name: 'Security Override Panel',
      category: 'Tech & Consoles',
      appearanceId: 56,
      modelKeywords: ['panel', 'switch', 'comp'],
      scale: 1.0,
      useable: true,
      hasInventory: false,
      locked: false,
      openLockDC: 15,
      lootResRefs: [],
      barkText: '[Security Panel]: Insert computer spike to override lockdown protocols.'
    },
    {
      name: 'Power Core / Reactor Conduit',
      category: 'Tech & Consoles',
      appearanceId: 60,
      modelKeywords: ['gen', 'power', 'turbine', 'droid'],
      scale: 1.25,
      useable: true,
      hasInventory: false,
      locked: false,
      openLockDC: 18,
      lootResRefs: [],
      barkText: '[Power Core]: Primary fusion generator humming at 98% output.'
    },

    // Medical & Lab
    {
      name: 'Kolto Regeneration Tank',
      category: 'Medical & Lab',
      appearanceId: 39,
      modelKeywords: ['kolto', 'bacta', 'tank'],
      scale: 1.15,
      useable: true,
      hasInventory: false,
      locked: false,
      openLockDC: 10,
      lootResRefs: [],
      barkText: '[Kolto Tank]: Pressurized Manaan Kolto immersion cylinder.'
    },
    {
      name: 'Medical Examination Bed',
      category: 'Medical & Lab',
      appearanceId: 40,
      modelKeywords: ['bed', 'cot', 'table'],
      scale: 1.0,
      useable: true,
      hasInventory: false,
      locked: false,
      openLockDC: 10,
      lootResRefs: [],
      barkText: '[Examination Bed]: Surgical recovery bed with integrated vital monitors.'
    },
    {
      name: 'Bio-Research Lab Bench',
      category: 'Medical & Lab',
      appearanceId: 68,
      modelKeywords: ['workbench', 'bench', 'table'],
      scale: 1.0,
      useable: true,
      hasInventory: true,
      locked: false,
      openLockDC: 12,
      lootResRefs: ['g_i_medeqpmnt01', 'g_i_medeqpmnt02', 'g_i_medeqpmnt03'],
      barkText: '[Bio-Research Bench]: Stocked with chemical analyzers and medpac synthesis supplies.'
    },
    {
      name: 'Medical Trauma Locker',
      category: 'Medical & Lab',
      appearanceId: 52,
      modelKeywords: ['med', 'locker', 'footlker', 'box'],
      scale: 1.0,
      useable: true,
      hasInventory: true,
      locked: false,
      openLockDC: 12,
      lootResRefs: ['g_i_medeqpmnt02', 'g_i_medeqpmnt03'],
      barkText: '[Medical Locker]: Emergency trauma kits and life-support packs.'
    },

    // Storage & Cargo
    {
      name: 'Heavy Industrial Cargo Crate',
      category: 'Storage & Cargo',
      appearanceId: 51,
      modelKeywords: ['crate', 'cargo', 'box'],
      scale: 1.2,
      useable: true,
      hasInventory: true,
      locked: false,
      openLockDC: 14,
      lootResRefs: ['g_w_blstrrfl001', 'g_i_medeqpmnt01'],
      barkText: '[Cargo Crate]: Heavy durasteel shipping crate.'
    },
    {
      name: 'Plasteel Storage Cylinder',
      category: 'Storage & Cargo',
      appearanceId: 53,
      modelKeywords: ['cylinder', 'plasteel', 'canister', 'barrel'],
      scale: 1.0,
      useable: true,
      hasInventory: true,
      locked: false,
      openLockDC: 14,
      lootResRefs: ['g_i_secspike01', 'g_i_progspike01', 'g_w_vbroswrd01'],
      barkText: '[Plasteel Cylinder]: Sealed cylindrical storage container.'
    },
    {
      name: 'Armory Weapons Locker',
      category: 'Storage & Cargo',
      appearanceId: 54,
      modelKeywords: ['rack', 'weapon', 'metal', 'locker', 'footlker'],
      scale: 1.1,
      useable: true,
      hasInventory: true,
      locked: false,
      openLockDC: 16,
      lootResRefs: ['g_w_blstrrfl001', 'g_w_hvrptbltr01', 'g_w_blstrpstl001', 'g_w_vbroswrd01'],
      barkText: '[Weapons Locker]: Military ordnance and heavy blasters.'
    },
    {
      name: 'Armorer Upgrade Workbench',
      category: 'Storage & Cargo',
      appearanceId: 68,
      modelKeywords: ['workbench', 'bench'],
      scale: 1.05,
      useable: true,
      hasInventory: true,
      locked: false,
      openLockDC: 10,
      lootResRefs: ['g_w_lghtsbr01', 'g_w_blstrrfl001'],
      barkText: '[Upgrade Workbench]: Calibrated for weapon and armor assembly.'
    }
  ];

  // Pre-Built Multi-Placeable Scene Blueprints (Office Building, Temple, Command Center, MedLab, Cantina, Warehouse)
  static SCENE_BLUEPRINTS: GMSceneBlueprint[] = [
    {
      id: 'office_building',
      title: 'Office Building & Executive Suite',
      category: 'Urban / Corporate',
      description: 'Complete corporate office layout: Front reception desk & terminal, waiting chairs, 4 open-plan office cubicles with desks, chairs, computer workstations & filing lockers, plus an Executive Director office with a locked vault safe.',
      recommendedModule: 'danm14aa',
      items: [
        // Front Reception Area
        {
          dx: 0, dy: 4.0, dz: 0, yawDeg: 180,
          config: {
            name: 'Reception Front Desk', category: 'Office & Furniture', appearanceId: 55, modelKeywords: ['desk', 'table', 'counter'], scale: 1.25,
            useable: true, hasInventory: true, locked: false, openLockDC: 10, lootResRefs: ['g_i_progspike01'],
            barkText: '[Reception Desk]: Visitor passes and floor directory.'
          }
        },
        {
          dx: 0.9, dy: 4.0, dz: 0.65, yawDeg: 180,
          config: {
            name: 'Reception Check-In Terminal', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'panel', 'terminal'], scale: 0.75,
            useable: true, hasInventory: false, locked: false, openLockDC: 12, lootResRefs: [],
            barkText: '[Reception Terminal]: Welcome to Czerka / Republic Sector Headquarters. Please sign in.'
          }
        },
        {
          dx: -3.2, dy: 2.2, dz: 0, yawDeg: 90,
          config: {
            name: 'Lobby Waiting Chair', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
            barkText: '[Waiting Area Chair]: Visitors please wait to be called.'
          }
        },
        {
          dx: 3.2, dy: 2.2, dz: 0, yawDeg: -90,
          config: {
            name: 'Lobby Waiting Chair', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
            barkText: '[Waiting Area Chair]: Visitors please wait to be called.'
          }
        },

        // Cubicle Row 1 (Left & Right)
        {
          dx: -4.2, dy: 8.0, dz: 0, yawDeg: 90,
          config: {
            name: 'Workstation Desk A1 (Operations)', category: 'Office & Furniture', appearanceId: 55, modelKeywords: ['desk', 'table'], scale: 1.0,
            useable: true, hasInventory: true, locked: false, openLockDC: 12, lootResRefs: ['g_i_progspike01'],
            barkText: '[Workstation A1]: Logistics & shipping manifests.'
          }
        },
        {
          dx: -5.3, dy: 8.0, dz: 0, yawDeg: 90,
          config: {
            name: 'Office Chair A1', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },
        {
          dx: -4.0, dy: 8.7, dz: 0, yawDeg: 90,
          config: {
            name: 'Terminal A1', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'terminal'], scale: 0.85,
            useable: true, hasInventory: false, locked: false, openLockDC: 12, lootResRefs: [],
            barkText: '[Terminal A1]: Quarterly trade route spreadsheets displayed.'
          }
        },
        {
          dx: -5.8, dy: 9.4, dz: 0, yawDeg: 0,
          config: {
            name: 'Filing Cabinet A1', category: 'Office & Furniture', appearanceId: 52, modelKeywords: ['locker', 'footlker'], scale: 1.0,
            useable: true, hasInventory: true, locked: false, openLockDC: 12, lootResRefs: ['g_i_medeqpmnt01'],
            barkText: '[Filing Locker A1]: Archived invoices.'
          }
        },

        {
          dx: 4.2, dy: 8.0, dz: 0, yawDeg: -90,
          config: {
            name: 'Workstation Desk B1 (Security)', category: 'Office & Furniture', appearanceId: 55, modelKeywords: ['desk', 'table'], scale: 1.0,
            useable: true, hasInventory: true, locked: false, openLockDC: 12, lootResRefs: ['g_i_secspike01'],
            barkText: '[Workstation B1]: Internal security incident reports.'
          }
        },
        {
          dx: 5.3, dy: 8.0, dz: 0, yawDeg: -90,
          config: {
            name: 'Office Chair B1', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },
        {
          dx: 4.0, dy: 8.7, dz: 0, yawDeg: -90,
          config: {
            name: 'Terminal B1', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'terminal'], scale: 0.85,
            useable: true, hasInventory: false, locked: false, openLockDC: 14, lootResRefs: [],
            barkText: '[Terminal B1]: Perimeter sensor logs and badge access control.'
          }
        },
        {
          dx: 5.8, dy: 9.4, dz: 0, yawDeg: 0,
          config: {
            name: 'Filing Cabinet B1', category: 'Office & Furniture', appearanceId: 52, modelKeywords: ['locker', 'footlker'], scale: 1.0,
            useable: true, hasInventory: true, locked: false, openLockDC: 14, lootResRefs: ['g_i_secspike01', 'g_w_blstrpstl001'],
            barkText: '[Filing Locker B1]: Confiscated visitor items.'
          }
        },

        // Cubicle Row 2 (Left & Right)
        {
          dx: -4.2, dy: 12.0, dz: 0, yawDeg: 90,
          config: {
            name: 'Workstation Desk A2 (Research)', category: 'Office & Furniture', appearanceId: 55, modelKeywords: ['desk', 'table'], scale: 1.0,
            useable: true, hasInventory: true, locked: false, openLockDC: 14, lootResRefs: ['g_i_progspike01'],
            barkText: '[Workstation A2]: R&D project notes and holodiscs.'
          }
        },
        {
          dx: -5.3, dy: 12.0, dz: 0, yawDeg: 90,
          config: {
            name: 'Office Chair A2', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },
        {
          dx: 4.2, dy: 12.0, dz: 0, yawDeg: -90,
          config: {
            name: 'Workstation Desk B2 (Finance)', category: 'Office & Furniture', appearanceId: 55, modelKeywords: ['desk', 'table'], scale: 1.0,
            useable: true, hasInventory: true, locked: false, openLockDC: 14, lootResRefs: ['g_i_progspike01'],
            barkText: '[Workstation B2]: Payroll and off-world account ledgers.'
          }
        },
        {
          dx: 5.3, dy: 12.0, dz: 0, yawDeg: -90,
          config: {
            name: 'Office Chair B2', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },

        // Executive Director Suite (Back Center)
        {
          dx: -2.6, dy: 14.5, dz: 0, yawDeg: 0,
          config: {
            name: 'Executive Suite Pillar (Left)', category: 'Office & Furniture', appearanceId: 50, modelKeywords: ['pillar', 'column', 'sign'], scale: 1.3,
            useable: false, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },
        {
          dx: 2.6, dy: 14.5, dz: 0, yawDeg: 0,
          config: {
            name: 'Executive Suite Pillar (Right)', category: 'Office & Furniture', appearanceId: 50, modelKeywords: ['pillar', 'column', 'sign'], scale: 1.3,
            useable: false, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },
        {
          dx: 0, dy: 16.5, dz: 0, yawDeg: 180,
          config: {
            name: 'Executive Director Desk', category: 'Office & Furniture', appearanceId: 45, modelKeywords: ['desk', 'table'], scale: 1.35,
            useable: true, hasInventory: true, locked: false, openLockDC: 16, lootResRefs: ['g_i_progspike01', 'g_i_secspike01'],
            barkText: '[Executive Desk]: Polished hardwood desk of the Sector Director.'
          }
        },
        {
          dx: 0, dy: 17.8, dz: 0, yawDeg: 180,
          config: {
            name: 'Executive Director Chair', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.15,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },
        {
          dx: -1.8, dy: 17.2, dz: 0, yawDeg: 150,
          config: {
            name: 'Executive Mainframe Console', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'console', 'terminal'], scale: 1.05,
            useable: true, hasInventory: false, locked: false, openLockDC: 18, lootResRefs: [],
            barkText: '[Director Mainframe]: Master override access to all building systems and classified archives.'
          }
        },
        {
          dx: 2.0, dy: 17.2, dz: 0, yawDeg: -150,
          config: {
            name: 'Executive Vault Safe (Locked DC 18)', category: 'Office & Furniture', appearanceId: 54, modelKeywords: ['safe', 'vault', 'metal', 'box'], scale: 1.1,
            useable: true, hasInventory: true, locked: true, openLockDC: 18,
            lootResRefs: ['g_w_lghtsbr04', 'g_w_blstrpstl001', 'g_i_medeqpmnt03', 'g_i_secspike01'],
            barkText: '[Director Vault]: High-security biometric vault.'
          }
        }
      ],
      creatures: [
        {
          dx: 0, dy: 5.1, dz: 0, yawDeg: 180,
          config: {
            name: 'Receptionist Protocol Droid', templateResRef: 'c_drdprot', appearanceId: 63, factionId: 5, hp: 45, level: 3, classId: 1,
            barkText: 'Welcome to the Executive Office Complex! Do you have an appointment with the Director?'
          }
        },
        {
          dx: 0, dy: 17.4, dz: 0, yawDeg: 180,
          config: {
            name: 'Sector Director', templateResRef: 'n_czerkaoff', appearanceId: 18, factionId: 5, hp: 75, level: 6, classId: 2, rightHandResRef: 'g_w_blstrpstl001',
            barkText: 'Who authorized you to enter my private office? Security!'
          }
        }
      ]
    },
    {
      id: 'ancient_temple',
      title: 'Ancient Jedi / Sith Temple Sanctuary',
      category: 'Sacred / Ruins',
      description: 'Monumental Force sanctuary: 2 towering entrance Guardian Statues, processional colonnade of 6 sacred temple obelisks, ceremonial braziers, central raised Sacred Altar / Sarcophagus, Holocron pedestal, and Relic Chest.',
      recommendedModule: 'danm14aa',
      items: [
        // Entrance Guardian Statues & Braziers
        {
          dx: -3.8, dy: 3.5, dz: 0, yawDeg: 0,
          config: {
            name: 'Ancient Guardian Statue (West)', category: 'Temple & Sacred', appearanceId: 65, modelKeywords: ['statue', 'idol', 'monument'], scale: 1.5,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
            barkText: '[Ancient Guardian Statue]: Inscribed in High Galactic — "Only those who master the Force may pass."'
          }
        },
        {
          dx: 3.8, dy: 3.5, dz: 0, yawDeg: 0,
          config: {
            name: 'Ancient Guardian Statue (East)', category: 'Temple & Sacred', appearanceId: 65, modelKeywords: ['statue', 'idol', 'monument'], scale: 1.5,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
            barkText: '[Ancient Guardian Statue]: Inscribed in High Galactic — "Beware the shadow that dwells within."'
          }
        },
        {
          dx: -2.4, dy: 3.5, dz: 0, yawDeg: 0,
          config: {
            name: 'Threshold Brazier (West)', category: 'Temple & Sacred', appearanceId: 48, modelKeywords: ['brazier', 'torch', 'flame', 'light'], scale: 1.15,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
            barkText: '[Sacred Brazier]: Blue-white temple flames burn without fuel.'
          }
        },
        {
          dx: 2.4, dy: 3.5, dz: 0, yawDeg: 0,
          config: {
            name: 'Threshold Brazier (East)', category: 'Temple & Sacred', appearanceId: 48, modelKeywords: ['brazier', 'torch', 'flame', 'light'], scale: 1.15,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
            barkText: '[Sacred Brazier]: Blue-white temple flames burn without fuel.'
          }
        },

        // Colonnade of 6 Temple Obelisks / Pillars
        {
          dx: -4.2, dy: 7.5, dz: 0, yawDeg: 90,
          config: {
            name: 'Temple Colonnade Pillar I', category: 'Temple & Sacred', appearanceId: 65, modelKeywords: ['pillar', 'obelisk', 'column', 'statue'], scale: 1.65,
            useable: false, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },
        {
          dx: 4.2, dy: 7.5, dz: 0, yawDeg: -90,
          config: {
            name: 'Temple Colonnade Pillar II', category: 'Temple & Sacred', appearanceId: 65, modelKeywords: ['pillar', 'obelisk', 'column', 'statue'], scale: 1.65,
            useable: false, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },
        {
          dx: -4.2, dy: 11.5, dz: 0, yawDeg: 90,
          config: {
            name: 'Temple Colonnade Pillar III', category: 'Temple & Sacred', appearanceId: 65, modelKeywords: ['pillar', 'obelisk', 'column', 'statue'], scale: 1.65,
            useable: false, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },
        {
          dx: 4.2, dy: 11.5, dz: 0, yawDeg: -90,
          config: {
            name: 'Temple Colonnade Pillar IV', category: 'Temple & Sacred', appearanceId: 65, modelKeywords: ['pillar', 'obelisk', 'column', 'statue'], scale: 1.65,
            useable: false, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },
        {
          dx: -4.2, dy: 15.5, dz: 0, yawDeg: 90,
          config: {
            name: 'Temple Colonnade Pillar V', category: 'Temple & Sacred', appearanceId: 65, modelKeywords: ['pillar', 'obelisk', 'column', 'statue'], scale: 1.65,
            useable: false, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },
        {
          dx: 4.2, dy: 15.5, dz: 0, yawDeg: -90,
          config: {
            name: 'Temple Colonnade Pillar VI', category: 'Temple & Sacred', appearanceId: 65, modelKeywords: ['pillar', 'obelisk', 'column', 'statue'], scale: 1.65,
            useable: false, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },

        // Inner Sanctum Altar, Holocron Pedestal, Braziers & Relic Chest
        {
          dx: 0, dy: 16.5, dz: 0, yawDeg: 180,
          config: {
            name: 'High Altar of the Force', category: 'Temple & Sacred', appearanceId: 64, modelKeywords: ['sarcoph', 'altar', 'tomb'], scale: 1.3,
            useable: true, hasInventory: true, locked: false, openLockDC: 20,
            lootResRefs: ['g_w_lghtsbr01', 'g_w_dblsbr001', 'g_a_mstrrobe01', 'g_a_mstrrobe02'],
            barkText: '[High Altar]: Ancient kyber crystals and sacred vestments rest within the stone vault.'
          }
        },
        {
          dx: 0, dy: 13.5, dz: 0, yawDeg: 180,
          config: {
            name: 'Ancient Holocron Pedestal', category: 'Temple & Sacred', appearanceId: 57, modelKeywords: ['starmap', 'holo', 'pedestal', 'panel'], scale: 1.1,
            useable: true, hasInventory: false, locked: false, openLockDC: 15, lootResRefs: [],
            barkText: '[Holocron Pedestal]: A glowing geometric holocron awakens at your approach: "Peace is a lie... or is there only the Force?"'
          }
        },
        {
          dx: -2.8, dy: 16.5, dz: 0, yawDeg: 0,
          config: {
            name: 'Sanctum Brazier (Left)', category: 'Temple & Sacred', appearanceId: 48, modelKeywords: ['brazier', 'torch', 'flame'], scale: 1.25,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },
        {
          dx: 2.8, dy: 16.5, dz: 0, yawDeg: 0,
          config: {
            name: 'Sanctum Brazier (Right)', category: 'Temple & Sacred', appearanceId: 48, modelKeywords: ['brazier', 'torch', 'flame'], scale: 1.25,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },
        {
          dx: 0, dy: 18.8, dz: 0, yawDeg: 180,
          config: {
            name: 'Sanctified Relic Chest', category: 'Temple & Sacred', appearanceId: 53, modelKeywords: ['ornate', 'chest', 'wicker', 'box'], scale: 1.15,
            useable: true, hasInventory: true, locked: false, openLockDC: 18,
            lootResRefs: ['g_w_lghtsbr03', 'g_w_lghtsbr05', 'g_a_kghtrobe01'],
            barkText: '[Sacred Reliquary]: Relics preserved from the Old Republic.'
          }
        }
      ],
      creatures: [
        {
          dx: 0, dy: 14.8, dz: 0, yawDeg: 180,
          config: {
            name: 'Ancient Temple Guardian', templateResRef: 'n_jedicounm', appearanceId: 214, factionId: 5, hp: 160, level: 12, classId: 3,
            rightHandResRef: 'g_w_dblsbr001', armorResRef: 'g_a_mstrrobe01',
            barkText: 'State your purpose, seeker. This sanctuary has stood for a thousand generations.'
          }
        }
      ]
    },
    {
      id: 'command_center',
      title: 'Military Command & Tactical Operations Center',
      category: 'Military / Sci-Fi',
      description: 'Tactical war room: Central Holo-Projector briefing table surrounded by 4 sensor, defense, and communications consoles, 2 armory weapons lockers, power core, and workbench.',
      recommendedModule: 'danm14aa',
      items: [
        {
          dx: 0, dy: 9.0, dz: 0, yawDeg: 0,
          config: {
            name: 'Central Tactical Holo-Table', category: 'Tech & Consoles', appearanceId: 58, modelKeywords: ['holo', 'table', 'comp'], scale: 1.4,
            useable: true, hasInventory: false, locked: false, openLockDC: 15, lootResRefs: [],
            barkText: '[Tactical Holo-Map]: Live orbital battle-group telemetry and planetary defense sectors.'
          }
        },
        {
          dx: -3.2, dy: 9.0, dz: 0, yawDeg: 90,
          config: {
            name: 'Orbital Sensor Console', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'terminal', 'console'], scale: 1.05,
            useable: true, hasInventory: false, locked: false, openLockDC: 15, lootResRefs: [],
            barkText: '[Sensor Console]: Long-range scanners detect vessels exiting hyperspace.'
          }
        },
        {
          dx: 3.2, dy: 9.0, dz: 0, yawDeg: -90,
          config: {
            name: 'Planetary Defense Grid Console', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'terminal', 'console'], scale: 1.05,
            useable: true, hasInventory: false, locked: false, openLockDC: 15, lootResRefs: [],
            barkText: '[Defense Grid Console]: Turbolaser batteries and shield generators online.'
          }
        },
        {
          dx: 0, dy: 12.4, dz: 0, yawDeg: 180,
          config: {
            name: 'Subspace Communications Array', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'terminal', 'console'], scale: 1.1,
            useable: true, hasInventory: false, locked: false, openLockDC: 15, lootResRefs: [],
            barkText: '[Comms Console]: Encrypted holo-channel open to Fleet Command.'
          }
        },
        {
          dx: -4.8, dy: 13.5, dz: 0, yawDeg: 135,
          config: {
            name: 'Armory Heavy Weapons Locker', category: 'Storage & Cargo', appearanceId: 54, modelKeywords: ['rack', 'weapon', 'metal', 'locker'], scale: 1.15,
            useable: true, hasInventory: true, locked: false, openLockDC: 16,
            lootResRefs: ['g_w_hvrptbltr01', 'g_w_blstrrfl001', 'g_w_blstrpstl001', 'g_a_class8001'],
            barkText: '[Armory Locker]: Heavy repeating blasters and battle armor.'
          }
        },
        {
          dx: 4.8, dy: 13.5, dz: 0, yawDeg: -135,
          config: {
            name: 'Ordnance & Demolitions Locker', category: 'Storage & Cargo', appearanceId: 52, modelKeywords: ['locker', 'footlker', 'box'], scale: 1.15,
            useable: true, hasInventory: true, locked: false, openLockDC: 16,
            lootResRefs: ['g_i_secspike01', 'g_i_progspike01', 'g_i_medeqpmnt02', 'g_w_vbrdblswd01'],
            barkText: '[Ordnance Locker]: Field tech supplies and melee weapons.'
          }
        },
        {
          dx: 0, dy: 15.2, dz: 0, yawDeg: 180,
          config: {
            name: 'Auxiliary Reactor Core', category: 'Tech & Consoles', appearanceId: 60, modelKeywords: ['gen', 'power', 'turbine'], scale: 1.3,
            useable: true, hasInventory: false, locked: false, openLockDC: 18, lootResRefs: [],
            barkText: '[Reactor Core]: Command bunker fusion generator operating nominal.'
          }
        }
      ],
      creatures: [
        {
          dx: 0, dy: 10.6, dz: 0, yawDeg: 180,
          config: {
            name: 'Tactical Commander', templateResRef: 'n_repoff', appearanceId: 37, factionId: 2, hp: 95, level: 8, classId: 0, rightHandResRef: 'g_w_blstrpstl001',
            barkText: 'Gather around the holo-table. Our strike team deploys on your mark!'
          }
        },
        {
          dx: -3.5, dy: 5.5, dz: 0, yawDeg: 0,
          config: {
            name: 'Command Security Droid', templateResRef: 'c_drdwar', appearanceId: 236, factionId: 2, hp: 80, level: 6, classId: 0, rightHandResRef: 'g_w_blstrrfl001',
            barkText: 'Command deck perimeter secure.'
          }
        }
      ]
    },
    {
      id: 'medical_lab',
      title: 'Medical Bay & Kolto Research Facility',
      category: 'Medical / Science',
      description: 'Field hospital & research clinic: 3 pressurized Kolto healing tanks, 2 surgical examination beds, diagnostic bio-scanner consoles, research workbench, and trauma supply cabinets.',
      recommendedModule: 'danm14aa',
      items: [
        {
          dx: -3.2, dy: 12.5, dz: 0, yawDeg: 180,
          config: {
            name: 'Kolto Regeneration Tank Alpha', category: 'Medical & Lab', appearanceId: 39, modelKeywords: ['kolto', 'bacta', 'tank'], scale: 1.2,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
            barkText: '[Kolto Tank Alpha]: Nutrient-rich Manaan Kolto suspension ready for critically injured patients.'
          }
        },
        {
          dx: 0, dy: 12.5, dz: 0, yawDeg: 180,
          config: {
            name: 'Kolto Regeneration Tank Beta', category: 'Medical & Lab', appearanceId: 39, modelKeywords: ['kolto', 'bacta', 'tank'], scale: 1.2,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
            barkText: '[Kolto Tank Beta]: Vital signs stabilized.'
          }
        },
        {
          dx: 3.2, dy: 12.5, dz: 0, yawDeg: 180,
          config: {
            name: 'Kolto Regeneration Tank Gamma', category: 'Medical & Lab', appearanceId: 39, modelKeywords: ['kolto', 'bacta', 'tank'], scale: 1.2,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
            barkText: '[Kolto Tank Gamma]: Pressurized Kolto synthesizer online.'
          }
        },
        {
          dx: -3.5, dy: 7.5, dz: 0, yawDeg: 90,
          config: {
            name: 'Surgical Recovery Bed 1', category: 'Medical & Lab', appearanceId: 40, modelKeywords: ['bed', 'cot', 'table'], scale: 1.0,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
            barkText: '[Surgical Bed 1]: Sterile bio-foam mattress with neural monitor.'
          }
        },
        {
          dx: 3.5, dy: 7.5, dz: 0, yawDeg: -90,
          config: {
            name: 'Surgical Recovery Bed 2', category: 'Medical & Lab', appearanceId: 40, modelKeywords: ['bed', 'cot', 'table'], scale: 1.0,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
            barkText: '[Surgical Bed 2]: Ready for triage patients.'
          }
        },
        {
          dx: -1.8, dy: 9.8, dz: 0, yawDeg: 180,
          config: {
            name: 'Bio-Scanner Diagnostic Console', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'terminal', 'console'], scale: 0.95,
            useable: true, hasInventory: false, locked: false, openLockDC: 12, lootResRefs: [],
            barkText: '[Medical Console]: Midi-chlorian and cellular regeneration analysis active.'
          }
        },
        {
          dx: 2.2, dy: 9.8, dz: 0, yawDeg: 180,
          config: {
            name: 'Pharmaceutical Synthesis Workbench', category: 'Medical & Lab', appearanceId: 68, modelKeywords: ['workbench', 'bench', 'table'], scale: 1.0,
            useable: true, hasInventory: true, locked: false, openLockDC: 10,
            lootResRefs: ['g_i_medeqpmnt01', 'g_i_medeqpmnt02', 'g_i_medeqpmnt03'],
            barkText: '[Medical Workbench]: Synthesize medpacs, stimulants, and antidotes.'
          }
        },
        {
          dx: 0, dy: 5.5, dz: 0, yawDeg: 0,
          config: {
            name: 'Emergency Trauma Supply Locker', category: 'Medical & Lab', appearanceId: 52, modelKeywords: ['med', 'locker', 'footlker'], scale: 1.05,
            useable: true, hasInventory: true, locked: false, openLockDC: 12,
            lootResRefs: ['g_i_medeqpmnt02', 'g_i_medeqpmnt03', 'g_i_medeqpmnt03'],
            barkText: '[Trauma Locker]: Stocked with Advanced Medpacs and Life Support Packs.'
          }
        }
      ],
      creatures: [
        {
          dx: 0, dy: 8.5, dz: 0, yawDeg: 180,
          config: {
            name: 'Chief Medical Officer Droid', templateResRef: 'c_drdprot', appearanceId: 63, factionId: 2, hp: 60, level: 5, classId: 1,
            barkText: 'Please state the nature of your medical emergency. Step into a Kolto tank if you require immediate healing.'
          }
        }
      ]
    },
    {
      id: 'cantina_lounge',
      title: 'Outer Rim Cantina & VIP Pazaak Lounge',
      category: 'Social / Cantina',
      description: 'Lively cantina setup: Bar counter with drink cylinders, jukebox music console, 3 booth tables with 6 chairs, VIP Pazaak table, and Bartender.',
      recommendedModule: 'danm14aa',
      items: [
        // Bar Counter
        {
          dx: -1.4, dy: 13.0, dz: 0, yawDeg: 180,
          config: {
            name: 'Cantina Bar Counter (Left)', category: 'Office & Furniture', appearanceId: 55, modelKeywords: ['counter', 'desk', 'table'], scale: 1.2,
            useable: true, hasInventory: true, locked: false, openLockDC: 10, lootResRefs: ['g_i_medeqpmnt01'],
            barkText: '[Cantina Bar]: Corellian ale and Tarisianitzel on tap.'
          }
        },
        {
          dx: 1.4, dy: 13.0, dz: 0, yawDeg: 180,
          config: {
            name: 'Cantina Bar Counter (Right)', category: 'Office & Furniture', appearanceId: 55, modelKeywords: ['counter', 'desk', 'table'], scale: 1.2,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
            barkText: '[Cantina Bar]: Wipe marks from countless smugglers and bounty hunters.'
          }
        },
        {
          dx: -3.2, dy: 14.2, dz: 0, yawDeg: 180,
          config: {
            name: 'Cantina Jukebox Console', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'panel', 'terminal'], scale: 0.95,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
            barkText: '[Jukebox]: Playing upbeat Bith cantina swing music across the lounge!'
          }
        },
        // Booth 1 (Left)
        {
          dx: -4.2, dy: 7.5, dz: 0, yawDeg: 0,
          config: {
            name: 'Cantina Booth Table West', category: 'Office & Furniture', appearanceId: 45, modelKeywords: ['table', 'pazaak', 'desk'], scale: 1.05,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
            barkText: '[Booth Table]: A shadowy corner booth ideal for clandestine deals.'
          }
        },
        {
          dx: -4.2, dy: 6.3, dz: 0, yawDeg: 0,
          config: {
            name: 'Booth Chair', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },
        {
          dx: -4.2, dy: 8.7, dz: 0, yawDeg: 180,
          config: {
            name: 'Booth Chair', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },
        // Booth 2 (Right)
        {
          dx: 4.2, dy: 7.5, dz: 0, yawDeg: 0,
          config: {
            name: 'VIP Pazaak Table East', category: 'Office & Furniture', appearanceId: 45, modelKeywords: ['pazaak', 'table', 'desk'], scale: 1.05,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: [],
            barkText: '[Pazaak Table]: High-stakes Pazaak den — pure +/- decks welcome.'
          }
        },
        {
          dx: 4.2, dy: 6.3, dz: 0, yawDeg: 0,
          config: {
            name: 'Pazaak Chair', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        },
        {
          dx: 4.2, dy: 8.7, dz: 0, yawDeg: 180,
          config: {
            name: 'Pazaak Chair', category: 'Office & Furniture', appearanceId: 44, modelKeywords: ['chair', 'seat'], scale: 1.0,
            useable: true, hasInventory: false, locked: false, openLockDC: 10, lootResRefs: []
          }
        }
      ],
      creatures: [
        {
          dx: 0, dy: 14.3, dz: 0, yawDeg: 180,
          config: {
            name: 'Twi\'lek Cantina Bartender', templateResRef: 'n_twilekf', appearanceId: 47, factionId: 5, hp: 55, level: 4, classId: 2,
            barkText: 'Welcome to the cantina! Keep your blasters holstered and pay your tab.'
          }
        }
      ]
    },
    {
      id: 'cargo_warehouse',
      title: 'Smuggler\'s Cargo Warehouse & Armory',
      category: 'Industrial / Cargo',
      description: 'Multi-level stacked cargo crates, plasteel cylinders, quartermaster manifest desk, upgrade workbench, and locked contraband vault.',
      recommendedModule: 'danm14aa',
      items: [
        {
          dx: -3.5, dy: 7.5, dz: 0, yawDeg: 15,
          config: {
            name: 'Heavy Cargo Crate 101', category: 'Storage & Cargo', appearanceId: 51, modelKeywords: ['crate', 'cargo', 'box'], scale: 1.25,
            useable: true, hasInventory: true, locked: false, openLockDC: 12, lootResRefs: ['g_w_blstrrfl001', 'g_i_medeqpmnt01']
          }
        },
        {
          dx: -3.5, dy: 7.5, dz: 1.15, yawDeg: -10,
          config: {
            name: 'Stacked Upper Cargo Crate 102', category: 'Storage & Cargo', appearanceId: 51, modelKeywords: ['crate', 'cargo', 'box'], scale: 1.05, zOffset: 1.15,
            useable: true, hasInventory: true, locked: false, openLockDC: 14, lootResRefs: ['g_i_secspike01', 'g_i_progspike01']
          }
        },
        {
          dx: 3.5, dy: 7.5, dz: 0, yawDeg: -20,
          config: {
            name: 'Heavy Cargo Crate 201', category: 'Storage & Cargo', appearanceId: 51, modelKeywords: ['crate', 'cargo', 'box'], scale: 1.25,
            useable: true, hasInventory: true, locked: false, openLockDC: 12, lootResRefs: ['g_w_vbroswrd01']
          }
        },
        {
          dx: 3.5, dy: 9.8, dz: 0, yawDeg: 0,
          config: {
            name: 'Plasteel Contraband Cylinder', category: 'Storage & Cargo', appearanceId: 53, modelKeywords: ['cylinder', 'plasteel', 'canister'], scale: 1.1,
            useable: true, hasInventory: true, locked: false, openLockDC: 15, lootResRefs: ['g_w_hvrptbltr01', 'g_a_class6001']
          }
        },
        {
          dx: -3.5, dy: 10.5, dz: 0, yawDeg: 90,
          config: {
            name: 'Smuggler Upgrade Workbench', category: 'Storage & Cargo', appearanceId: 68, modelKeywords: ['workbench', 'bench'], scale: 1.1,
            useable: true, hasInventory: true, locked: false, openLockDC: 10, lootResRefs: ['g_w_lghtsbr04', 'g_w_blstrpstl001'],
            barkText: '[Smuggler Workbench]: Custom illegal blaster & lightsaber modifications.'
          }
        },
        {
          dx: 0, dy: 12.5, dz: 0, yawDeg: 180,
          config: {
            name: 'Quartermaster Manifest Desk', category: 'Office & Furniture', appearanceId: 55, modelKeywords: ['desk', 'table'], scale: 1.1,
            useable: true, hasInventory: true, locked: false, openLockDC: 14, lootResRefs: ['g_i_progspike01'],
            barkText: '[Manifest Desk]: Smuggling route logs for the Outer Rim.'
          }
        },
        {
          dx: 1.8, dy: 12.8, dz: 0, yawDeg: 180,
          config: {
            name: 'Locked Contraband Vault (DC 18)', category: 'Storage & Cargo', appearanceId: 54, modelKeywords: ['safe', 'vault', 'metal', 'box'], scale: 1.15,
            useable: true, hasInventory: true, locked: true, openLockDC: 18,
            lootResRefs: ['g_w_dblsbr001', 'g_w_lghtsbr05', 'g_a_mstrrobe01', 'g_i_medeqpmnt03'],
            barkText: '[Contraband Vault]: High-value Exchange shipment.'
          }
        }
      ],
      creatures: [
        {
          dx: 0, dy: 13.7, dz: 0, yawDeg: 180,
          config: {
            name: 'Warehouse Quartermaster', templateResRef: 'n_smuggler', appearanceId: 179, factionId: 5, hp: 90, level: 7, classId: 2, rightHandResRef: 'g_w_blstrpstl001',
            barkText: 'Don\'t touch the crates unless you\'ve got credits or clearance from the boss.'
          }
        }
      ]
    }
  ];

  // Curated Player Character Presets
  static PLAYER_PRESETS: GMPlayerSpawnConfig[] = [
    {
      name: 'Jedi Guardian',
      appearanceId: 136,
      portraitId: 15,
      gender: 0,
      classId: 3, // Jedi Guardian
      level: 10,
      str: 18,
      dex: 14,
      con: 15,
      int: 10,
      wis: 14,
      cha: 12,
      rightHandResRef: 'g_w_lghtsbr01',
      leftHandResRef: '',
      armorResRef: 'g_a_jedirobe01',
      possessImmediately: true
    },
    {
      name: 'Jedi Consular (Force Master)',
      appearanceId: 166,
      portraitId: 21,
      gender: 1,
      classId: 4, // Jedi Consular
      level: 10,
      str: 12,
      dex: 14,
      con: 14,
      int: 14,
      wis: 18,
      cha: 16,
      rightHandResRef: 'g_w_lghtsbr03',
      leftHandResRef: '',
      armorResRef: 'g_a_mstrrobe01',
      possessImmediately: true
    },
    {
      name: 'Jedi Sentinel (Dual Saber)',
      appearanceId: 121,
      portraitId: 12,
      gender: 0,
      classId: 5, // Jedi Sentinel
      level: 10,
      str: 14,
      dex: 17,
      con: 14,
      int: 14,
      wis: 15,
      cha: 12,
      rightHandResRef: 'g_w_dblsbr001',
      leftHandResRef: '',
      armorResRef: 'g_a_kghtrobe01',
      possessImmediately: true
    },
    {
      name: 'Sith Marauder (Dark Side)',
      alignment: 'dark',
      appearanceId: 138,
      portraitId: 16,
      gender: 0,
      classId: 3, // Jedi Guardian
      level: 12,
      str: 18,
      dex: 15,
      con: 16,
      int: 10,
      wis: 15,
      cha: 14,
      rightHandResRef: 'g_w_lghtsbr02',
      leftHandResRef: 'g_w_lghtsbr02',
      armorResRef: 'g_a_mstrrobe02',
      possessImmediately: true
    },
    {
      name: 'Republic Heavy Soldier',
      appearanceId: 91,
      portraitId: 7,
      gender: 0,
      classId: 0, // Soldier
      level: 8,
      str: 16,
      dex: 16,
      con: 16,
      int: 12,
      wis: 12,
      cha: 10,
      rightHandResRef: 'g_w_hvrptbltr01',
      leftHandResRef: '',
      armorResRef: 'g_a_class8001',
      possessImmediately: true
    },
    {
      name: 'Smuggler Scoundrel',
      appearanceId: 151,
      portraitId: 18,
      gender: 1,
      classId: 2, // Scoundrel
      level: 8,
      str: 12,
      dex: 18,
      con: 13,
      int: 15,
      wis: 13,
      cha: 15,
      rightHandResRef: 'g_w_blstrpstl001',
      leftHandResRef: 'g_w_blstrpstl001',
      armorResRef: 'g_a_class4001',
      possessImmediately: true
    }
  ];

  static WEAPON_OPTIONS: { resRef: string; label: string }[] = [
    { resRef: '', label: 'None (Unarmed)' },
    { resRef: 'g_w_lghtsbr01', label: 'Blue Lightsaber (g_w_lghtsbr01)' },
    { resRef: 'g_w_lghtsbr02', label: 'Red Lightsaber (g_w_lghtsbr02)' },
    { resRef: 'g_w_lghtsbr03', label: 'Green Lightsaber (g_w_lghtsbr03)' },
    { resRef: 'g_w_lghtsbr04', label: 'Yellow Lightsaber (g_w_lghtsbr04)' },
    { resRef: 'g_w_lghtsbr05', label: 'Violet Lightsaber (g_w_lghtsbr05)' },
    { resRef: 'g_w_dblsbr001', label: 'Double-Bladed Lightsaber Blue (g_w_dblsbr001)' },
    { resRef: 'g_w_dblsbr002', label: 'Double-Bladed Lightsaber Red (g_w_dblsbr002)' },
    { resRef: 'g_w_vbroswrd01', label: 'Vibrosword (g_w_vbroswrd01)' },
    { resRef: 'g_w_vbrdblswd01', label: 'Vibro Double-Blade (g_w_vbrdblswd01)' },
    { resRef: 'g_w_gaffi001', label: 'Gaffi Stick (g_w_gaffi001)' },
    { resRef: 'g_w_blstrrfl001', label: 'Blaster Rifle (g_w_blstrrfl001)' },
    { resRef: 'g_w_hvrptbltr01', label: 'Heavy Repeating Blaster (g_w_hvrptbltr01)' },
    { resRef: 'g_w_blstrpstl001', label: 'Blaster Pistol (g_w_blstrpstl001)' },
    { resRef: 'g_w_bowcstr001', label: 'Wookiee Bowcaster (g_w_bowcstr001)' },
  ];

  static ARMOR_OPTIONS: { resRef: string; label: string }[] = [
    { resRef: '', label: 'Default / Creature Skin' },
    { resRef: 'g_a_clothes01', label: 'Basic Clothing (g_a_clothes01)' },
    { resRef: 'g_a_jedirobe01', label: 'Jedi Robe (g_a_jedirobe01)' },
    { resRef: 'g_a_kghtrobe01', label: 'Jedi Knight Robe (g_a_kghtrobe01)' },
    { resRef: 'g_a_mstrrobe01', label: 'Jedi Master Robe (g_a_mstrrobe01)' },
    { resRef: 'g_a_mstrrobe02', label: 'Dark Jedi Master Robe (g_a_mstrrobe02)' },
    { resRef: 'g_a_class4001', label: 'Combat Suit (g_a_class4001)' },
    { resRef: 'g_a_class6001', label: 'Military Suit (g_a_class6001)' },
    { resRef: 'g_a_class8001', label: 'Heavy Battle Armor (g_a_class8001)' },
  ];

  static LOOT_ITEM_OPTIONS: { resRef: string; label: string }[] = [
    { resRef: 'g_i_medeqpmnt01', label: 'Medpac (g_i_medeqpmnt01)' },
    { resRef: 'g_i_medeqpmnt02', label: 'Advanced Medpac (g_i_medeqpmnt02)' },
    { resRef: 'g_i_medeqpmnt03', label: 'Life Support Pack (g_i_medeqpmnt03)' },
    { resRef: 'g_i_secspike01', label: 'Security Tunneler (g_i_secspike01)' },
    { resRef: 'g_i_progspike01', label: 'Computer Spike (g_i_progspike01)' },
    { resRef: 'g_w_lghtsbr01', label: 'Blue Lightsaber (g_w_lghtsbr01)' },
    { resRef: 'g_w_lghtsbr02', label: 'Red Lightsaber (g_w_lghtsbr02)' },
    { resRef: 'g_w_dblsbr001', label: 'Double-Bladed Lightsaber (g_w_dblsbr001)' },
    { resRef: 'g_w_blstrrfl001', label: 'Blaster Rifle (g_w_blstrrfl001)' },
    { resRef: 'g_w_blstrpstl001', label: 'Blaster Pistol (g_w_blstrpstl001)' },
    { resRef: 'g_a_jedirobe01', label: 'Jedi Robe (g_a_jedirobe01)' },
    { resRef: 'g_a_mstrrobe02', label: 'Dark Jedi Master Robe (g_a_mstrrobe02)' },
  ];

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

  /**
   * The placeables.2da model each preset keyword means (by its first keyword). Checked against KotOR's
   * table: the presets' numeric ids and a loose keyword search had picked unrelated models (a speeder for
   * a desk, a fountain for a vault).
   */
  static PLACEABLE_KEYWORD_LABELS: Record<string, string> = {
    comp: 'CompPanel',
    panel: 'ButtonPanel_hightech',
    chair: 'Chair1_military_style',
    desk: 'Desk2_fancy',
    counter: 'Desk1_office',
    table: 'ManaanTable1',
    pazaak: 'ManaanTable2',
    pillar: 'Pillar',
    statue: 'Statue2_heroic_Jedi',
    starmap: 'StarMap',
    holo: 'Hologram2_abstract',
    sarcoph: 'Sith_Sarcophagus',
    brazier: 'Firepit',
    skeleton: 'HumanSkeleton',
    ornate: 'RakataBin2_wicker_footlocker',
    footlker: 'Footlocker',
    locker: 'LargeLocker',
    rack: 'LargeLocker',
    med: 'Footlocker',
    safe: 'MetalBox_octagonal',
    metal: 'MetalBox_octagonal',
    crate: 'Crate_wooden',
    cylinder: 'PlasticCrate_cylinder',
    workbench: 'RepairTable1',
    bed: 'Bed1_military_cot',
    kolto: 'KoltoTank_empty',
    gen: 'PowerConductor',
  };

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
    return tool === 'place_creature' || tool === 'place_placeable' || tool === 'place_player';
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

  static setToolMode(tool: GMToolMode) {
    const previous = this.activeTool;
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
    (obj as any).gmNetId = netId;
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
  ) {
    if (!moduleResRef) return;
    GameState.gmMode = true;
    this.active = true;

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
        if ((p as any).gmPlayerConfig && !(p as any).gmOwnerPeerId) {
          savedPlayerConfigs.push({ ...(p as any).gmPlayerConfig, possessImmediately: false });
        }
      }
    }

    // Players connected to this session always come along, keeping the same character:
    // net id (so their game keeps controlling it), inventory, equipment and HP
    const savedNetworkPlayers: { netId: string; config: GMPlayerSpawnConfig; sheet: GMPlayerSheet }[] = [];
    if (GMNetworkManager.role === 'host') {
      for (const [netId, obj] of this.netIdMap.entries()) {
        if (!(obj as any).gmOwnerPeerId || obj.destroyed || !(obj as any).gmPlayerConfig) continue;
        savedNetworkPlayers.push({
          netId,
          config: { ...(obj as any).gmPlayerConfig, ownerPeerId: (obj as any).gmOwnerPeerId, possessImmediately: false },
          sheet: this.buildPlayerSheet(obj as ModuleCreature),
        });
      }
    }

    this.sceneLoading = true;
    this.selectedObject = null;
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

    // Wait until module finishes loading and then restore preserved players if any
    if (savedPlayerConfigs.length > 0 || savedNetworkPlayers.length > 0) {
      const checkInterval = setInterval(async () => {
        // The old module still reports ready until the new one replaces it, so wait for this scene by name
        const newSceneReady = !this.sceneLoading &&
          String(GameState.module?.filename || '').toLowerCase() === moduleResRef.toLowerCase() &&
          GameState.module?.readyToProcessEvents && !GameState.loadingTextures;
        if (newSceneReady) {
          clearInterval(checkInterval);
          for (let i = 0; i < savedNetworkPlayers.length; i++) {
            const saved = savedNetworkPlayers[i];
            const offset = (savedPlayerConfigs.length + i) * 1.5;
            const pc = await this.spawnPlayerCharacter(
              saved.config,
              new THREE.Vector3((GameState.module.entryX || 0) + offset, GameState.module.entryY || 0, GameState.module.entryZ || 0),
              0,
              saved.netId
            );
            if (!pc) continue;
            (pc as any).gmInventory = saved.sheet.inventory.map((e) => ({ ...e }));
            await this.syncEquipmentTo(pc, saved.sheet.equipment);
            this.setCreatureHP(pc, saved.sheet.hp, saved.sheet.maxHp);
          }
          for (let i = 0; i < savedPlayerConfigs.length; i++) {
            const cfg = savedPlayerConfigs[i];
            const entryX = (GameState.module.entryX || 0) + (i * 1.5);
            const entryY = (GameState.module.entryY || 0);
            const entryZ = (GameState.module.entryZ || 0);
            const spawned = await this.spawnPlayerCharacter(
              { ...cfg, possessImmediately: wasPossessing && i === 0 },
              new THREE.Vector3(entryX, entryY, entryZ),
              0
            );
            if (spawned && i === 0 && wasPossessing) {
              this.possessCharacter(spawned);
            }
          }
          this.notifyChange();
        }
      }, 250);
    }
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
      if (!(p as any).gmNetId) {
        this.registerNetObject(`plc_area_${idx}_${p.getTag() || p.id}`, p);
      }
    });
    mod.area.creatures.forEach((c, idx) => {
      if (!(c as any).gmNetId) {
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

  /** Set a creature template's hands and armour (see spawnCreature) */
  static applyCreatureGear(root: GFFStruct, config: GMCreatureSpawnConfig, replace: boolean) {
    let list = root.getFieldByLabel('Equip_ItemList');
    if (!list) list = root.addField(new GFFField(GFFDataType.LIST, 'Equip_ItemList'));
    const slots: [number, string | undefined][] = [
      [ModuleCreatureArmorSlot.ARMOR, config.armorResRef],
      [ModuleCreatureArmorSlot.RIGHTHAND, config.rightHandResRef],
      [ModuleCreatureArmorSlot.LEFTHAND, config.leftHandResRef],
    ];
    for (const [slot, resRef] of slots) {
      if (resRef === undefined) continue;
      const structs = list.getChildStructs();
      const existing = structs.find((st) => st.type === slot);
      if (!replace) {
        if (existing || !resRef) continue;
      } else if (existing) {
        list.removeChildStruct(existing);
      }
      if (!resRef) continue;
      const st = new GFFStruct(slot);
      st.addField(new GFFField(GFFDataType.RESREF, 'EquippedRes')).setValue(resRef);
      list.addChildStruct(st);
    }
  }

  static creatureTemplateIndex: GMCreatureTemplateInfo[] | null = null;
  static creatureTemplateIndexLoading: Promise<GMCreatureTemplateInfo[]> | null = null;

  /** Read a creature template (.utc): its name, look, faction, stats, class and gear */
  static async describeCreatureTemplate(resRef: string): Promise<GMCreatureTemplateInfo | null> {
    const key = (resRef || '').toLowerCase();
    if (!key) return null;
    let buffer = ResourceLoader.loadCachedResource(ResourceTypes.utc, key);
    if (!buffer) {
      try { buffer = await ResourceLoader.loadResource(ResourceTypes.utc, key); } catch (e) { buffer = undefined; }
    }
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

    let gff = new GFFObject();
    let loadedFromUTC = false;
    if (config.templateResRef) {
      const resKey = config.templateResRef.toLowerCase();
      let buffer = ResourceLoader.loadCachedResource(ResourceTypes.utc, resKey);
      if (!buffer) {
        try {
          buffer = await ResourceLoader.loadResource(ResourceTypes.utc, resKey);
        } catch (e) {
          // fallback to procedural GFF
        }
      }
      if (buffer) {
        gff = new GFFObject(buffer);
        loadedFromUTC = true;
      }
    }

    const root = gff.RootNode;
    // Remove TemplateResRef so creature.load() does not re-merge the unmodified .utc over our custom fields
    root.removeFieldByLabel('TemplateResRef');
    const setOrAdd = (type: number, label: string, val: any) => {
      if (root.hasField(label)) {
        root.getFieldByLabel(label).setValue(val);
      } else {
        root.addField(new GFFField(type, label)).setValue(val);
      }
    };

    // A template keeps its own look, stats and gear unless the GM customized them
    const useConfig = !loadedFromUTC || !!config.customized;
    if (useConfig) {
      setOrAdd(GFFDataType.WORD, 'Appearance_Type', this.resolveCreatureAppearance(config));
    }
    const targetHp = config.hp || 50;
    setOrAdd(GFFDataType.WORD, 'FactionID', config.factionId ?? 1);
    if (useConfig) {
      setOrAdd(GFFDataType.WORD, 'HitPoints', targetHp);
      setOrAdd(GFFDataType.WORD, 'CurrentHitPoints', targetHp);
      setOrAdd(GFFDataType.WORD, 'MaxHitPoints', targetHp);
    }

    if (config.name) {
      const locName = new CExoLocString();
      locName.addSubString(config.name, 0);
      if (root.hasField('FirstName')) {
        root.getFieldByLabel('FirstName').setCExoLocString(locName);
      } else {
        root.addField(new GFFField(GFFDataType.CEXOLOCSTRING, 'FirstName', locName));
      }
      if (root.hasField('LastName')) {
        root.getFieldByLabel('LastName').setCExoLocString(new CExoLocString());
      }
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
        alignment: config.factionId === 1 ? 'dark' : 'light',
      });
      const classList = root.addField(new GFFField(GFFDataType.LIST, 'ClassList'));
      const classStruct = new GFFStruct();
      classStruct.addField(new GFFField(GFFDataType.INT, 'Class')).setValue(config.classId ?? 0);
      classStruct.addField(new GFFField(GFFDataType.SHORT, 'ClassLevel')).setValue(config.level || 4);
      const knownList = classStruct.addField(new GFFField(GFFDataType.LIST, 'KnownList0'));
      for (const spellId of abilities.powers) {
        const sp = new GFFStruct();
        sp.addField(new GFFField(GFFDataType.WORD, 'Spell')).setValue(spellId);
        knownList.addChildStruct(sp);
      }
      classList.addChildStruct(classStruct);

      root.removeFieldByLabel('FeatList');
      const featList = root.addField(new GFFField(GFFDataType.LIST, 'FeatList'));
      for (const featId of abilities.feats) {
        const ft = new GFFStruct();
        ft.addField(new GFFField(GFFDataType.WORD, 'Feat')).setValue(featId);
        featList.addChildStruct(ft);
      }
      root.removeFieldByLabel('SkillList');
      const skillList = root.addField(new GFFField(GFFDataType.LIST, 'SkillList'));
      for (let i = 0; i < Math.max(8, abilities.skillRanks.length); i++) {
        const sk = new GFFStruct();
        sk.addField(new GFFField(GFFDataType.BYTE, 'Rank')).setValue(abilities.skillRanks[i] || 0);
        skillList.addChildStruct(sk);
      }
      setOrAdd(GFFDataType.WORD, 'ForcePoints', abilities.maxFp);
      setOrAdd(GFFDataType.WORD, 'CurrentForce', abilities.maxFp);
      setOrAdd(GFFDataType.WORD, 'MaxForcePoints', abilities.maxFp);
    }

    // Gear. Customized (or built without a template): the hands and armour are what the config says, '' for
    // empty. From a template: its own gear, with the config only filling an empty hand. Either way the template's
    // other slots (creature claws and hides, belts, implants) stay.
    this.applyCreatureGear(root, config, useConfig);

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
    (creature as any).gmSpawning = true;
    (creature as any).gmSpawnConfig = { ...config };
    if (config.barkText) {
      (creature as any).gmBarkText = config.barkText;
    }

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
    this.assignFaction(creature, config.factionId ?? 1);
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
    delete (creature as any).gmSpawning;

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

    let gff = new GFFObject();
    let fromTemplate = false;
    if (config.templateResRef) {
      const resKey = config.templateResRef.toLowerCase();
      let buffer = ResourceLoader.loadCachedResource(ResourceTypes.utp, resKey);
      if (!buffer) {
        try {
          buffer = await ResourceLoader.loadResource(ResourceTypes.utp, resKey);
        } catch (e) {
          // fallback to procedural GFF
        }
      }
      if (buffer) {
        gff = new GFFObject(buffer);
        fromTemplate = true;
      }
    }
    // A template keeps its own model, name and settings unless the GM customized them
    const useConfig = !fromTemplate || !!config.customized;
    const resolvedAppearanceId = useConfig
      ? this.resolvePlaceableAppearance(config)
      : (gff.RootNode.getFieldByLabel('Appearance')?.getValue() ?? this.resolvePlaceableAppearance(config));

    const root = gff.RootNode;
    root.removeFieldByLabel('TemplateResRef');
    const setOrAdd = (type: number, label: string, val: any) => {
      if (root.hasField(label)) {
        root.getFieldByLabel(label).setValue(val);
      } else {
        root.addField(new GFFField(type, label)).setValue(val);
      }
    };

    if (useConfig) {
      const locName = new CExoLocString();
      locName.addSubString(config.name || 'Interactive Object', 0);
      if (root.hasField('LocName')) {
        root.getFieldByLabel('LocName').setCExoLocString(locName);
      } else {
        root.addField(new GFFField(GFFDataType.CEXOLOCSTRING, 'LocName', locName));
      }

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
    (plc as any).gmSpawning = true;
    if (config.barkText) {
      (plc as any).gmBarkText = config.barkText;
    }
    const scale = typeof config.scale === 'number' && config.scale > 0 ? config.scale : 1.0;
    (plc as any).gmScale = scale;
    (plc as any).gmSpawnConfig = {
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
    delete (plc as any).gmSpawning;

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
    const locName = new CExoLocString();
    locName.addSubString(config.name || 'Player Character', 0);

    root.addField(new GFFField(GFFDataType.DWORD, 'ObjectId')).setValue(GameState.ModuleObjectManager.GetNextPlayerId());
    root.addField(new GFFField(GFFDataType.WORD, 'Appearance_Type')).setValue(config.appearanceId ?? 136);
    root.addField(new GFFField(GFFDataType.WORD, 'PortraitId')).setValue(config.portraitId ?? 15);
    root.addField(new GFFField(GFFDataType.BYTE, 'Gender')).setValue(config.gender ?? 0);
    root.addField(new GFFField(GFFDataType.WORD, 'FactionID')).setValue(0); // Party/Player Faction
    root.addField(new GFFField(GFFDataType.CEXOLOCSTRING, 'FirstName', locName));
    root.addField(new GFFField(GFFDataType.CEXOLOCSTRING, 'LastName', new CExoLocString()));
    root.addField(new GFFField(GFFDataType.WORD, 'HitPoints')).setValue(abilities.maxHp);
    root.addField(new GFFField(GFFDataType.WORD, 'CurrentHitPoints')).setValue(abilities.maxHp);
    root.addField(new GFFField(GFFDataType.WORD, 'MaxHitPoints')).setValue(abilities.maxHp);
    root.addField(new GFFField(GFFDataType.WORD, 'ForcePoints')).setValue(abilities.maxFp);
    root.addField(new GFFField(GFFDataType.WORD, 'CurrentForce')).setValue(abilities.maxFp);
    root.addField(new GFFField(GFFDataType.WORD, 'MaxForcePoints')).setValue(abilities.maxFp);
    root.addField(new GFFField(GFFDataType.BYTE, 'Str')).setValue(config.str || 14);
    root.addField(new GFFField(GFFDataType.BYTE, 'Dex')).setValue(config.dex || 14);
    root.addField(new GFFField(GFFDataType.BYTE, 'Con')).setValue(config.con || 14);
    root.addField(new GFFField(GFFDataType.BYTE, 'Int')).setValue(config.int || 12);
    root.addField(new GFFField(GFFDataType.BYTE, 'Wis')).setValue(config.wis || 14);
    root.addField(new GFFField(GFFDataType.BYTE, 'Cha')).setValue(config.cha || 14);
    root.addField(new GFFField(GFFDataType.BYTE, 'GoodEvil')).setValue(50);
    root.addField(new GFFField(GFFDataType.BYTE, 'NaturalAC')).setValue(2);
    root.addField(new GFFField(GFFDataType.BYTE, 'PerceptionRange')).setValue(13);
    root.addField(new GFFField(GFFDataType.WORD, 'SoundSetFile')).setValue(config.gender === 1 ? 83 : 85);
    root.addField(new GFFField(GFFDataType.BYTE, 'Race')).setValue(6);

    // Scripts for party/player behavior
    root.addField(new GFFField(GFFDataType.RESREF, 'ScriptAttacked')).setValue('k_hen_attacked01');
    root.addField(new GFFField(GFFDataType.RESREF, 'ScriptDamaged')).setValue('k_hen_damage01');
    root.addField(new GFFField(GFFDataType.RESREF, 'ScriptDialogue')).setValue('k_hen_dialogue01');
    root.addField(new GFFField(GFFDataType.RESREF, 'ScriptEndRound')).setValue('k_hen_combend01');
    root.addField(new GFFField(GFFDataType.RESREF, 'ScriptHeartbeat')).setValue('k_hen_heartbt01');
    root.addField(new GFFField(GFFDataType.RESREF, 'ScriptOnBlocked')).setValue('k_hen_blocked01');
    root.addField(new GFFField(GFFDataType.RESREF, 'ScriptOnNotice')).setValue('k_hen_percept01');
    root.addField(new GFFField(GFFDataType.RESREF, 'ScriptSpawn')).setValue('k_hen_spawn01');

    // Skills, as the class spends its skill points
    const skillList = root.addField(new GFFField(GFFDataType.LIST, 'SkillList'));
    for (let i = 0; i < Math.max(8, abilities.skillRanks.length); i++) {
      const s = new GFFStruct();
      s.addField(new GFFField(GFFDataType.BYTE, 'Rank')).setValue(abilities.skillRanks[i] || 0);
      skillList.addChildStruct(s);
    }

    // Class & Force Powers
    const classList = root.addField(new GFFField(GFFDataType.LIST, 'ClassList'));
    const classStruct = new GFFStruct();
    classStruct.addField(new GFFField(GFFDataType.INT, 'Class')).setValue(config.classId ?? 3);
    classStruct.addField(new GFFField(GFFDataType.SHORT, 'ClassLevel')).setValue(config.level || 8);
    const knownList = classStruct.addField(new GFFField(GFFDataType.LIST, 'KnownList0'));
    {
      for (const spellId of abilities.powers) {
        const sp = new GFFStruct();
        sp.addField(new GFFField(GFFDataType.WORD, 'Spell')).setValue(spellId);
        knownList.addChildStruct(sp);
      }
    }
    classList.addChildStruct(classStruct);

    // Feats
    const featList = root.addField(new GFFField(GFFDataType.LIST, 'FeatList'));
    {
      for (const featId of abilities.feats) {
        const ft = new GFFStruct();
        ft.addField(new GFFField(GFFDataType.WORD, 'Feat')).setValue(featId);
        featList.addChildStruct(ft);
      }
    }

    // Equipment
    const equipList = root.addField(new GFFField(GFFDataType.LIST, 'Equip_ItemList'));
    if (config.armorResRef) {
      const s = new GFFStruct(ModuleCreatureArmorSlot.ARMOR);
      s.addField(new GFFField(GFFDataType.RESREF, 'EquippedRes')).setValue(config.armorResRef);
      equipList.addChildStruct(s);
    }
    if (config.rightHandResRef) {
      const s = new GFFStruct(ModuleCreatureArmorSlot.RIGHTHAND);
      s.addField(new GFFField(GFFDataType.RESREF, 'EquippedRes')).setValue(config.rightHandResRef);
      equipList.addChildStruct(s);
    }
    if (config.leftHandResRef) {
      const s = new GFFStruct(ModuleCreatureArmorSlot.LEFTHAND);
      s.addField(new GFFField(GFFDataType.RESREF, 'EquippedRes')).setValue(config.leftHandResRef);
      equipList.addChildStruct(s);
    }

    const player = new ModulePlayer(template);
    (player as any).gmPlayerConfig = { ...config };
    if (config.ownerPeerId) {
      (player as any).gmOwnerPeerId = config.ownerPeerId;
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

    const model = await player.loadModel();
    if (model) {
      model.userData.moduleObject = player;
      model.hasCollision = true;
    }

    player.position.copy(targetLoc.position);
    player.setFacing(targetLoc.facing, true);

    if (!this.spawnedPlayers.includes(player)) {
      this.spawnedPlayers.push(player);
    }
    // Other players' characters are world creatures here, not members of this machine's 3-slot party;
    // that keeps them off our HUD and out of party AI, and lets any number of players join
    const remotelyControlled = !!config.ownerPeerId && config.ownerPeerId !== GMNetworkManager.peerId;
    if (remotelyControlled) {
      GameState.group.creatures.add(player.container);
      area.attachObject(player);
    } else {
      GameState.group.party.add(player.container);
      if (!GameState.PartyManager.party.includes(player)) {
        if (GameState.PartyManager.party.length < 3) {
          GameState.PartyManager.party.push(player);
        } else {
          area.attachObject(player);
        }
      }
    }

    player.getCurrentRoom();
    player.computeBoundingBox(true);
    this.markSpawned(player);

    const netId = existingNetId || this.getNextNetId('pc');
    this.registerNetObject(netId, player);

    if (!existingNetId && GMNetworkManager.role !== 'offline') {
      GMNetworkManager.broadcastActorSpawn(this.serializeSingleActor(player));
    }

    if (config.possessImmediately) {
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

      const model = await player.loadModel();
      if (model) {
        model.userData.moduleObject = player;
        model.hasCollision = true;
      }

      player.position.copy(targetLoc.position);
      player.setFacing(targetLoc.facing, true);

      GameState.group.party.add(player.container);
      if (!this.spawnedPlayers.includes(player)) {
        this.spawnedPlayers.push(player);
      }
      if (!GameState.PartyManager.party.includes(player)) {
        if (GameState.PartyManager.party.length < 3) {
          GameState.PartyManager.party.push(player);
        } else {
          GameState.module.area.attachObject(player);
        }
      }

      player.getCurrentRoom();
      player.computeBoundingBox(true);
      this.markSpawned(player);

      const netId = this.getNextNetId('pc_save');
      this.registerNetObject(netId, player);

      if (GMNetworkManager.role !== 'offline') {
        GMNetworkManager.broadcastActorSpawn(this.serializeSingleActor(player));
      }

      if (possessImmediately) {
        this.possessCharacter(player);
      }

      this.notifyChange();
      return player;
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
      this.assignFaction(player, 0);

      const model = await player.loadModel();
      if (model) {
        model.userData.moduleObject = player;
        model.hasCollision = true;
      }

      player.position.copy(targetLoc.position);
      player.setFacing(targetLoc.facing, true);

      GameState.group.party.add(player.container);
      if (!this.spawnedPlayers.includes(player)) {
        this.spawnedPlayers.push(player);
      }
      if (!GameState.PartyManager.party.includes(player)) {
        GameState.PartyManager.party.unshift(player);
        if (GameState.PartyManager.party.length > 3) {
          GameState.PartyManager.party.length = 3;
        }
      }

      player.getCurrentRoom();
      player.computeBoundingBox(true);
      this.markSpawned(player);

      const netId = this.getNextNetId('pc_utc');
      this.registerNetObject(netId, player);

      if (GMNetworkManager.role !== 'offline') {
        GMNetworkManager.broadcastActorSpawn(this.serializeSingleActor(player));
      }

      if (possessImmediately) {
        this.possessCharacter(player);
      }

      this.notifyChange();
      return player;
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
    if (!obj || !BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModuleCreature)) return;
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
    if (BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModuleCreature)) {
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
    if (BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModuleCreature)) {
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
    const ownerPeerId = (obj as any).gmOwnerPeerId;
    if (GMNetworkManager.role === 'host' && ownerPeerId && (obj as any).gmNetId) {
      const seq = ((obj as any).gmTeleportSeq || 0) + 1;
      (obj as any).gmTeleportSeq = seq;
      (obj as any).gmHostDriven = false;
      GMNetworkManager.sendPacket({
        type: 'actor.teleport',
        senderId: GMNetworkManager.peerId,
        targetPeerId: ownerPeerId,
        timestamp: Date.now(),
        payload: { netId: (obj as any).gmNetId, x: pos.x, y: pos.y, z: pos.z, seq }
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
    if (BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModuleCreature)) {
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
    const netTarget = (obj as any).gmNetTarget as THREE.Vector3 | undefined;
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
    if (BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModuleCreature)) {
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

  static setObjectBark(obj: ModuleObject, barkText: string) {
    if (!obj) return;
    (obj as any).gmBarkText = barkText;
    if (GMNetworkManager.role !== 'offline') {
      GMNetworkManager.broadcastActorUpdate(this.serializeSingleActor(obj));
    }
    this.notifyChange();
  }

  static triggerBarkNow(obj: ModuleObject, text?: string) {
    const msg = text || (obj as any)?.gmBarkText || `${obj?.getName() || 'Actor'}: Greetings!`;
    GameState.MenuManager.InGameBark?.barkFromString(msg);
    if (GMNetworkManager.role !== 'offline') {
      GMNetworkManager.sendChat(obj?.getName() || 'GM', msg);
    }
  }

  static toggleDoorOrPlaceableOpen(obj: ModuleObject) {
    if (!obj) return;
    if (BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModuleDoor)) {
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
          netId: (door as any).gmNetId || `door_${door.id}`,
          tag: door.getTag(),
          x: door.position.x,
          y: door.position.y,
          locked: door.isLocked(),
          openState: door.openState
        });
      }
    } else if (BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModulePlaceable)) {
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
    if (BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModuleDoor)) {
      const door = obj as ModuleDoor;
      door.setLocked(!door.isLocked());
      if (GMNetworkManager.role !== 'offline') {
        GMNetworkManager.broadcastDoorState({
          netId: (door as any).gmNetId || `door_${door.id}`,
          tag: door.getTag(),
          x: door.position.x,
          y: door.position.y,
          locked: door.isLocked(),
          openState: door.openState
        });
      }
    } else if (BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModulePlaceable)) {
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
    let buffer = ResourceLoader.loadCachedResource(ResourceTypes.uti, resKey);
    if (!buffer) {
      try {
        buffer = await ResourceLoader.loadResource(ResourceTypes.uti, resKey);
      } catch (e) {
        // fallback to basic item stub
      }
    }
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
      if (BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModulePlaceable)) {
        const plc = obj as ModulePlaceable;
        plc.hasInventory = true;
        plc.useable = true;
        plc.inventory.push(item);
      } else if (BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModuleCreature)) {
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
      if (BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModulePlaceable)) {
        const plc = obj as ModulePlaceable;
        plc.hasInventory = true;
        plc.useable = true;
        plc.inventory.push(item);
      } else if (BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModuleCreature)) {
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
    const netId = (obj as any).gmNetId;
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
    const offsetPos = new THREE.Vector3(
      obj.position.x + 1.5,
      obj.position.y + 1.0,
      obj.position.z
    );

    if (BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModulePlaceable)) {
      const plc = obj as ModulePlaceable;
      const savedCfg: GMPlaceableSpawnConfig = (plc as any).gmSpawnConfig || {
        name: plc.getName() || 'Cloned Object',
        appearanceId: plc.appearance || 52,
        scale: (plc as any).gmScale || 1.0,
        useable: plc.useable,
        hasInventory: plc.hasInventory,
        locked: plc.isLocked(),
        openLockDC: plc.openLockDC || 15,
        lootResRefs: (plc.inventory || []).map(i => i.getEquippedRes() || i.getInventoryRes()).filter(Boolean),
        barkText: (plc as any).gmBarkText || ''
      };
      const cloned = await this.spawnPlaceable(
        { ...savedCfg, zOffset: 0 },
        offsetPos,
        plc.bearing || 0
      );
      if (cloned) this.selectObject(cloned);
      return cloned;
    } else if (BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModuleCreature)) {
      const cre = obj as ModuleCreature;
      const eq = cre.equipment;
      const cloned = await this.spawnCreature(
        {
          name: cre.getName() || cre.firstName || 'Cloned Creature',
          appearanceId: cre.appearance || 28,
          factionId: cre.factionId ?? 1,
          hp: cre.getMaxHP() || 50,
          level: 5,
          classId: 0,
          rightHandResRef: eq?.RIGHTHAND?.getEquippedRes() || '',
          leftHandResRef: eq?.LEFTHAND?.getEquippedRes() || '',
          armorResRef: eq?.ARMOR?.getEquippedRes() || '',
          barkText: (cre as any).gmBarkText || ''
        },
        offsetPos,
        cre.getFacing()
      );
      if (cloned) this.selectObject(cloned);
      return cloned;
    }
    return null;
  }

  /**
   * Adjust the 3D scale of a Placeable or Creature
   */
  static setObjectScale(obj: ModuleObject, scale: number) {
    if (!obj || !obj.container) return;
    const clamped = Math.max(0.25, Math.min(4.0, scale));
    (obj as any).gmScale = clamped;
    if ((obj as any).gmSpawnConfig) {
      (obj as any).gmSpawnConfig.scale = clamped;
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
      plc => !(plc as any).gmNetId || String((plc as any).gmNetId).startsWith('plc_area_')
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
      plc => (plc as any).gmNetId && !String((plc as any).gmNetId).startsWith('plc_area_')
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
      await this.loadScene(targetModule, {
        keepCreatures: false,
        keepTriggers: false,
        keepPlaceables: false,
        preserveParty: this.preservePartyOnWarp
      });

      const waitTimer = setInterval(async () => {
        if (GameState.module?.readyToProcessEvents && !GameState.loadingTextures && GameState.module?.area) {
          clearInterval(waitTimer);
          await this.spawnBlueprintInCurrentArea(blueprint, {
            useCameraTargetAsOrigin: false,
            clearExistingPlaceables: false,
            spawnNPCs
          });
        }
      }, 250);
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

    const items: GMSceneBlueprintItem[] = [];
    for (const plc of mod.area.placeables) {
      if (!plc) continue;
      // Include all remaining placeables in the scene
      const savedCfg: GMPlaceableSpawnConfig = (plc as any).gmSpawnConfig || {
        name: plc.getName() || 'Placeable',
        appearanceId: plc.appearance || 52,
        scale: (plc as any).gmScale || 1.0,
        useable: plc.useable,
        hasInventory: plc.hasInventory,
        locked: plc.isLocked(),
        openLockDC: plc.openLockDC || 15,
        lootResRefs: (plc.inventory || []).map(i => i.getEquippedRes() || i.getInventoryRes()).filter(Boolean),
        barkText: (plc as any).gmBarkText || ''
      };
      items.push({
        dx: Number((plc.position.x - originX).toFixed(2)),
        dy: Number((plc.position.y - originY).toFixed(2)),
        dz: Number((plc.position.z - originZ).toFixed(2)),
        yawDeg: Math.round(((plc.bearing || 0) * 180) / Math.PI),
        config: { ...savedCfg }
      });
    }

    const creatures: GMSceneBlueprintCreature[] = [];
    for (const cre of mod.area.creatures) {
      if (!cre || GameState.PartyManager.party.includes(cre)) continue;
      const eq = cre.equipment;
      creatures.push({
        dx: Number((cre.position.x - originX).toFixed(2)),
        dy: Number((cre.position.y - originY).toFixed(2)),
        dz: Number((cre.position.z - originZ).toFixed(2)),
        yawDeg: Math.round(((cre.getFacing() || 0) * 180) / Math.PI),
        config: {
          name: cre.getName() || cre.firstName || 'Actor',
          appearanceId: cre.appearance || 28,
          factionId: cre.factionId ?? 1,
          hp: cre.getMaxHP() || 50,
          level: 5,
          classId: 0,
          rightHandResRef: eq?.RIGHTHAND?.getEquippedRes() || '',
          leftHandResRef: eq?.LEFTHAND?.getEquippedRes() || '',
          armorResRef: eq?.ARMOR?.getEquippedRes() || '',
          barkText: (cre as any).gmBarkText || ''
        }
      });
    }

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
    if (!obj || !BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModuleCreature)) return false;
    return !!((obj as any).gmOwnerPeerId || (obj as any).gmPlayerConfig);
  }

  static getPlayerCharacters(): ModuleCreature[] {
    const area = GameState.module?.area;
    if (!area) return [];
    const all = [...GameState.PartyManager.party, ...area.creatures] as ModuleCreature[];
    return [...new Set(all)].filter((c) => this.isPlayerCharacter(c));
  }

  static setDeathRule(rule: GMDeathRule) {
    if (!['kotor', 'gm', 'respawn'].includes(rule)) return;
    this.deathRule = rule;
    GMNetworkManager.broadcastSessionRules({ deathRule: rule });
    this.notifyChange();
  }

  /** Host: notice players falling, stand them back up under the KotOR rule, tell the GM if everyone is down */
  static updateDownedPlayers(elapsed: number) {
    const pcs = this.getPlayerCharacters();
    const now = Date.now();
    for (const pc of pcs) {
      const state = (pc as any).gmDowned as { since: number; clearFor: number } | undefined;
      if (!pc.isDead()) {
        if (state) delete (pc as any).gmDowned;
        continue;
      }
      if (!state) {
        (pc as any).gmDowned = { since: now, clearFor: 0 };
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
    delete (pc as any).gmDowned;
    pc.clearAllActions();
    pc.combatRound?.clearActions?.();
    if (pc.combatData) pc.combatData.combatState = false;
    if (GMNetworkManager.role === 'host' && (pc as any).gmNetId) {
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
    const state = (pc as any)?.gmDowned as { since: number } | undefined;
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
    return !!obj && BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModuleCreature) &&
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
    if (!picked || picked === cre || !BitWise.InstanceOf(picked.objectType, ModuleObjectType.ModuleCreature)) return;
    const netId = (picked as any).gmNetId as string | undefined;
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
    if ((cre as any).gmOwnerPeerId || (cre as any).gmPlayerConfig || (cre as any).gmHostDriven) return false;
    return true;
  }

  static chooseNpcTarget(cre: ModuleCreature, everyone: ModuleCreature[]): ModuleCreature | null {
    const usable = (c: ModuleObject | undefined, range: number): c is ModuleCreature =>
      !!c && c !== cre && BitWise.InstanceOf(c.objectType, ModuleObjectType.ModuleCreature) &&
      !c.isDead() && everyone.includes(c as ModuleCreature) &&
      cre.position.distanceTo(c.position) <= range && cre.isHostile(c);

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
        if (BitWise.InstanceOf(this.selectedObject.objectType, ModuleObjectType.ModuleCreature)) {
          const cre = this.selectedObject as ModuleCreature;
          if (cre.factionId === 1) mat.color.setHex(0xff3333);
          else if (cre.factionId === 0 || GameState.PartyManager.party.includes(cre)) mat.color.setHex(0x00ff88);
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
    const netId = (obj as any).gmNetId || this.getNextNetId('obj');
    if (!(obj as any).gmNetId) {
      this.registerNetObject(netId, obj);
    }

    const isPlayer = BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModulePlayer) || GameState.PartyManager.party.includes(obj as ModuleCreature);
    const isPlaceable = BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModulePlaceable);
    const kind: 'creature' | 'player' | 'placeable' = isPlaceable ? 'placeable' : (isPlayer ? 'player' : 'creature');

    let rightHandResRef = '';
    let leftHandResRef = '';
    let armorResRef = '';
    if (!isPlaceable && (obj as ModuleCreature).equipment) {
      const eq = (obj as ModuleCreature).equipment;
      rightHandResRef = eq.RIGHTHAND?.getEquippedRes() || '';
      leftHandResRef = eq.LEFTHAND?.getEquippedRes() || '';
      armorResRef = eq.ARMOR?.getEquippedRes() || '';
    }

    return {
      netId,
      kind,
      ownerPeerId: (obj as any).gmOwnerPeerId,
      templateResRef: (obj as any).gmSpawnConfig?.templateResRef || obj.getTemplateResRef() || '',
      appearanceId: obj.appearance || 0,
      name: obj.getName() || (obj as ModuleCreature).firstName || 'Actor',
      tag: obj.getTag() || '',
      factionId: obj.factionId ?? 2,
      hp: obj.getHP() ?? 50,
      maxHp: obj.getMaxHP() ?? 50,
      x: obj.position.x,
      y: obj.position.y,
      z: obj.position.z,
      facing: isPlaceable ? (obj.bearing || 0) : (obj as ModuleCreature).getFacing(),
      scale: (obj as any).gmScale || 1.0,
      animState: isPlaceable ? 0 : ((obj as ModuleCreature).animationState?.index || 0),
      hidden: !!(obj as any).gmHidden,
      hostDriven: !!(obj as any).gmHostDriven,
      intentSeq: (obj as any).gmIntentSeq || 0,
      rightHandResRef,
      leftHandResRef,
      armorResRef,
      barkText: (obj as any).gmBarkText || '',
      hasInventory: isPlaceable ? (obj as ModulePlaceable).hasInventory : false,
      locked: isPlaceable ? (obj as ModulePlaceable).isLocked() : false,
      openState: isPlaceable ? (obj as ModulePlaceable).state : 0,
      lootResRefs: isPlaceable
        ? ((obj as ModulePlaceable).inventory || []).map(i => i.getEquippedRes() || i.getInventoryRes()).filter(Boolean)
        : []
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
      if (c && !GameState.PartyManager.party.includes(c) && !(c as any).gmSpawning) {
        list.push(this.serializeSingleActor(c));
      }
    }
    for (const plc of area.placeables) {
      if (plc && (plc as any).gmNetId && !(plc as any).gmSpawning && !String((plc as any).gmNetId).startsWith('plc_area_')) {
        list.push(this.serializeSingleActor(plc));
      }
    }
    return list;
  }

  static buildWorldSnapshot(): GMWorldSnapshot {
    const area = GameState.module?.area;
    const doors: GMSerializedDoorState[] = (area?.doors || []).map((d, idx) => ({
      netId: (d as any).gmNetId || `door_${idx}_${d.getTag() || d.id}`,
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
      rules: { deathRule: this.deathRule },
      actors: this.serializeActorsForTick(),
      doors
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
    await this.loadScene(moduleResRef, {
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
      await this.loadSceneFromNetwork(
        snapshot.moduleResRef,
        snapshot.keepDefaultCreatures,
        snapshot.keepDefaultTriggers,
        keepPlaceables
      );
      const waitTimer = setInterval(async () => {
        if (GameState.module?.readyToProcessEvents && !GameState.loadingTextures) {
          clearInterval(waitTimer);
          await this.syncSnapshotEntitiesOnClient(snapshot);
        }
      }, 250);
      return;
    }
    await this.syncSnapshotEntitiesOnClient(snapshot);
  }

  static async syncSnapshotEntitiesOnClient(snapshot: GMWorldSnapshot) {
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
          if (BitWise.InstanceOf(localObj.objectType, ModuleObjectType.ModuleCreature)) {
            this.setCreatureHP(localObj as ModuleCreature, actor.hp, actor.maxHp);
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
        (existing as any).gmNetAnim = actor.animState;
      }
      if (existing.container) {
        if (typeof actor.scale === 'number' && actor.scale > 0) {
          existing.container.scale.setScalar(actor.scale);
          (existing as any).gmScale = actor.scale;
        }
      }
      if (BitWise.InstanceOf(existing.objectType, ModuleObjectType.ModuleCreature)) {
        this.setCreatureHP(existing as ModuleCreature, actor.hp, actor.maxHp);
      } else {
        existing.setMaxHP(actor.maxHp);
        existing.currentHP = actor.hp;
      }
      if (actor.barkText !== undefined) {
        (existing as any).gmBarkText = actor.barkText;
      }
      if (actor.kind === 'placeable') {
        const plc = existing as ModulePlaceable;
        plc.setLocked(!!actor.locked);
        plc.bearing = actor.facing;
        plc.rotation.z = actor.facing;
      } else {
        const cre = existing as ModuleCreature;
        cre.setFacing(actor.facing, false);
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
          barkText: actor.barkText
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
      if ((obj as any).gmOwnerPeerId === peerId && !obj.destroyed) return netId;
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
    (actor as any).gmHostDriven = false;
    (actor as any).gmNetTarget = undefined;
  }

  static getOwnedActor(peerId: string, netId: string): ModuleCreature | null {
    const actor = this.netIdMap.get(netId);
    if (!actor || !BitWise.InstanceOf(actor.objectType, ModuleObjectType.ModuleCreature)) return null;
    if ((actor as any).gmOwnerPeerId !== peerId) return null;
    return actor as ModuleCreature;
  }

  /**
   * Client-owned movement: the client is authoritative over its actor's position
   * except while the host is executing one of its intents.
   */
  static applyClientInputOnHost(peerId: string, payload: any) {
    if (!payload) return;
    const actor = this.getOwnedActor(peerId, payload.netId);
    if (!actor || (actor as any).gmHostDriven) return;
    // Sent before the player's game had moved their character to where the GM teleported it
    if ((payload.teleportSeq ?? 0) < ((actor as any).gmTeleportSeq || 0)) return;
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
    if (!GameState.gmMode || GMNetworkManager.role !== 'host' || !obj || (obj as any).gmHidden) return null;
    return (obj as any).gmNetId || null;
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
        if (!BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModuleCreature)) return;
        const cre = obj as ModuleCreature;
        const animation = OdysseyModelAnimation.GetAnimation2DA(event.anim);
        if (!animation || cre.isDead()) return;
        cre.playTwoDAAnimation(animation);
        cre.animationState.index = event.index;
        (cre as any).gmFxAnimation = cre.animationState.animation;
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
    const peerId = (user as any)?.gmOwnerPeerId;
    const containerNetId = (container as any)?.gmNetId;
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
    GMNetworkManager.sendIntent('loot', (container as any).gmNetId);
    return true;
  }

  /** Client: a container whose contents the host owns */
  static isNetworkContainer(container: ModuleObject): boolean {
    return GameState.gmMode && GMNetworkManager.role === 'client' && !!(container as any)?.gmNetId;
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
    return actor && BitWise.InstanceOf(actor.objectType, ModuleObjectType.ModuleCreature) ? actor as ModuleCreature : null;
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
    if (!obj || (obj as any).gmOwnerPeerId) return false;
    (obj as any).gmHidden = !!hidden;
    const netId = (obj as any).gmNetId;
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
    return !!(obj as any)?.gmHidden;
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
      if (cre) netIds.push((cre as any).gmNetId);
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
      const playerConfig: GMPlayerSpawnConfig | undefined = (cre as any).gmPlayerConfig;
      if (playerConfig) {
        players.push({
          name: playerConfig.name || cre.getName() || 'Player',
          local: !(cre as any).gmOwnerPeerId,
          config: { ...playerConfig, ownerPeerId: undefined, possessImmediately: false },
          sheet: this.buildPlayerSheet(cre),
          x: cre.position.x, y: cre.position.y, z: cre.position.z,
          facing: cre.getFacing(),
          hidden: !!(cre as any).gmHidden,
        });
        continue;
      }
      const config: GMCreatureSpawnConfig | undefined = (cre as any).gmSpawnConfig;
      if (!config) continue; // part of the module itself; reloaded with the scene
      objects.push({
        kind: 'creature',
        config: { ...config, lootResRefs: undefined },
        x: cre.position.x, y: cre.position.y, z: cre.position.z,
        facing: cre.getFacing(),
        factionId: cre.factionId,
        hp: cre.getHP(),
        maxHp: cre.getMaxHP(),
        hidden: !!(cre as any).gmHidden,
        loot: this.toLootItems(cre.inventory).map((e) => e.resRef),
        barkText: (cre as any).gmBarkText || '',
      });
    }

    for (const plc of area.placeables) {
      const config: GMPlaceableSpawnConfig | undefined = (plc as any)?.gmSpawnConfig;
      if (!plc || !config || plc.destroyed) continue;
      objects.push({
        kind: 'placeable',
        config: { ...config, lootResRefs: [] },
        x: plc.position.x, y: plc.position.y, z: plc.position.z,
        facing: plc.bearing || 0,
        locked: plc.isLocked(),
        hidden: !!(plc as any).gmHidden,
        loot: this.toLootItems(plc.inventory).map((e) => e.resRef),
        barkText: (plc as any).gmBarkText || '',
      });
    }

    const doors = area.doors
      .filter((d) => (d as any).gmNetId)
      .map((d) => ({ netId: (d as any).gmNetId, openState: d.openState, locked: !!d.isLocked() }));

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
      rules: { deathRule: this.deathRule },
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

  /** Resolves once the given scene has finished loading, or false after timeoutMs */
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
    if (ownerPeerId) (pc as any).gmInventory = saved.sheet.inventory.map((e) => ({ ...e }));
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
      if (!obj || !BitWise.InstanceOf(obj.objectType, ModuleObjectType.ModuleDoor)) continue;
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
          { ...cfg, factionId: saved.factionId ?? cfg.factionId, hp: saved.maxHp ?? cfg.hp, barkText: saved.barkText, lootResRefs: saved.loot },
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
      (actor as any).gmInventory = reserved.sheet.inventory.map((e) => ({ ...e }));
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
    if (!Array.isArray((actor as any).gmInventory)) (actor as any).gmInventory = [];
    return (actor as any).gmInventory;
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
      const resRef = item?.getEquippedRes() || item?.getInventoryRes();
      if (resRef) equipment[slot] = resRef;
    }
    return {
      netId: (cre as any).gmNetId,
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
      if (!actor || !BitWise.InstanceOf(actor.objectType, ModuleObjectType.ModuleCreature)) continue;
      const sheet = this.buildPlayerSheet(actor as ModuleCreature);
      const json = JSON.stringify(sheet);
      // A rejoining player keeps their id but starts with an empty sheet, so track each join separately
      const session = `${peer.peerId}:${peer.joinedAt}`;
      if ((actor as any).gmLastSheetJson === json && (actor as any).gmLastSheetSession === session) continue;
      (actor as any).gmLastSheetJson = json;
      (actor as any).gmLastSheetSession = session;
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
    if (!this.removeFromPlayerInventory(actor, resRef)) return;
    const current: ModuleItem | undefined = (actor.equipment as any)[slotName];
    const currentResRef = current?.getEquippedRes() || current?.getInventoryRes();
    if (currentResRef) this.addToPlayerInventory(actor, [{ resRef: currentResRef, stack: 1 }]);
    const item = await this.createItemFromResRefAsync(resRef);
    await actor.equipItem(slot, item);
  }

  /** Host: move an equipped item back into the player's inventory */
  static unequipOnHost(actor: ModuleCreature, slot: number) {
    const slotName = ModuleCreatureArmorSlot[slot];
    if (!slotName || !this.PLAYER_EQUIP_SLOTS.includes(slotName)) return;
    const current: ModuleItem | undefined = (actor.equipment as any)[slotName];
    const currentResRef = current?.getEquippedRes() || current?.getInventoryRes();
    if (!currentResRef) return;
    this.addToPlayerInventory(actor, [{ resRef: currentResRef, stack: 1 }]);
    actor.unequipSlot(slot);
  }

  /** Client: equipping our own character becomes a request to the host. Returns true when handled. */
  static requestNetworkEquip(cre: ModuleObject, slot: number, item: ModuleItem): boolean {
    if (!this.isOwnNetworkCharacter(cre)) return false;
    const resRef = item?.getEquippedRes() || item?.getInventoryRes();
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
      !!(cre as any)?.gmNetId &&
      (cre as any).gmNetId === GMNetworkManager.assignedActorNetId;
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
      const have = current?.getEquippedRes() || current?.getInventoryRes() || '';
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
    const loading: Record<string, boolean> = (cre as any).gmEquipLoading || ((cre as any).gmEquipLoading = {});
    for (const [slotName, resRef] of wanted) {
      if (resRef === undefined || loading[slotName]) continue;
      const current: ModuleItem | undefined = (cre.equipment as any)[slotName];
      const have = current?.getEquippedRes() || current?.getInventoryRes() || '';
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
    (actor as any).gmIntentSeq = intent.seq;

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

    actor.clearAllActions();
    if (intent.kind === 'cancel') {
      (actor as any).gmHostDriven = false;
      return;
    }

    const target = intent.targetNetId ? this.netIdMap.get(intent.targetNetId) : null;
    if (!target || target === actor) {
      (actor as any).gmHostDriven = false;
      return;
    }

    // The host now owns this actor's position; drop any half-applied client movement
    (actor as any).gmNetTarget = undefined;
    if (intent.kind === 'open' && BitWise.InstanceOf(target.objectType, ModuleObjectType.ModuleDoor)) {
      actor.actionOpenDoor(target);
    } else if (intent.kind === 'attack' && BitWise.InstanceOf(target.objectType, ModuleObjectType.ModuleCreature)) {
      actor.attackCreature(target, undefined);
    } else if (intent.kind === 'use') {
      actor.actionUseObject(target);
    } else {
      (actor as any).gmHostDriven = false;
      return;
    }
    (actor as any).gmHostDriven = true;
  }

  /**
   * Host: hand position authority back to the owning client once its intent has finished
   */
  static updateHostDrivenActors() {
    for (const obj of this.netIdMap.values()) {
      if (!(obj as any).gmHostDriven) continue;
      const cre = obj as ModuleCreature;
      if (!cre.actionQueue?.length || cre.isDead()) {
        (cre as any).gmHostDriven = false;
      }
    }
  }

  /**
   * True when this creature's logic (actions, AI, combat) is owned by another machine and must not run locally
   */
  static isNetReplica(cre: ModuleCreature): boolean {
    if (GMNetworkManager.role !== 'client') return false;
    if (!(cre as any).gmNetId) return false;
    if ((cre as any).gmNetId !== GMNetworkManager.assignedActorNetId) return true;
    return GMNetworkManager.awaitingHost;
  }

  /**
   * True when this creature's position is streamed from the network and smoothed locally
   */
  static isNetMotionDriven(cre: ModuleCreature): boolean {
    if (this.isNetReplica(cre)) return true;
    return GMNetworkManager.role === 'host' && !!(cre as any).gmOwnerPeerId && !(cre as any).gmHostDriven;
  }

  static setNetTarget(obj: ModuleObject, x: number, y: number, z: number) {
    let target = (obj as any).gmNetTarget as THREE.Vector3 | undefined;
    if (!target) {
      target = new THREE.Vector3();
      (obj as any).gmNetTarget = target;
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
    const target = (cre as any).gmNetTarget as THREE.Vector3 | undefined;
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
      const hostAnim = (cre as any).gmNetAnim as number | undefined;
      const hostIsLocomotion = hostAnim === ModuleCreatureAnimState.RUNNING || hostAnim === ModuleCreatureAnimState.WALKING;
      const hostIsFxDriven = this.FX_DRIVEN_ANIM_STATES.includes(hostAnim);
      // Let a replayed attack/reaction animation finish before applying the tick's state
      const fxPlaying = !!(cre as any).gmFxAnimation && cre.animationState.animation === (cre as any).gmFxAnimation;
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
    if (!pc || (pc as any).gmNetId !== GMNetworkManager.assignedActorNetId) return false;
    const targetNetId = (target as any).gmNetId as string | undefined;
    if (!targetNetId) return false;

    if (BitWise.InstanceOf(target.objectType, ModuleObjectType.ModuleDoor)) {
      GMNetworkManager.sendIntent('open', targetNetId);
      return true;
    }
    if (BitWise.InstanceOf(target.objectType, ModuleObjectType.ModulePlaceable)) {
      GMNetworkManager.sendIntent('use', targetNetId);
      return true;
    }
    if (BitWise.InstanceOf(target.objectType, ModuleObjectType.ModuleCreature)) {
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
      return pc ? ((pc as any).gmNetId || null) : null;
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
      }
    );
    return spawned ? ((spawned as any).gmNetId || null) : null;
  }
}

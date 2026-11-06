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
  GMNetworkManager,
  GMSerializedActor,
  GMSerializedDoorState,
  GMWorldSnapshot,
  GMPlayerJoinPreset,
  GMClientIntent,
  GMFxEvent,
  GMLootItem,
  GMPlayerSheet
} from "@/managers/GMNetworkManager";

export type GMControlMode = 'FREECAM' | 'POSSESS';
export type GMToolMode = 'select' | 'place_creature' | 'place_placeable' | 'place_player' | 'teleport';

export interface GMModuleEntry {
  resRef: string;
  planet: string;
  title: string;
  description: string;
}

export interface GMCreatureSpawnConfig {
  name: string;
  templateResRef?: string;
  appearanceId: number;
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
  modelKeywords?: string[];
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
  hp: number;
  fp: number;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  rightHandResRef?: string;
  leftHandResRef?: string;
  armorResRef?: string;
  featIds: number[];
  spellIds: number[];
  possessImmediately?: boolean;
  ownerPeerId?: string;
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

  // Client: set while applying the host's sheet, so our own equip calls aren't sent back as requests
  static applyingHostSheet: boolean = false;
  // Client: a sheet that arrived before our character finished spawning
  static pendingPlayerSheet: GMPlayerSheet | null = null;
  static lastAppliedInventoryJson: string = '';

  // Pending spawn configurations for 3D viewport click-to-place
  static pendingCreatureConfig: GMCreatureSpawnConfig = {
    name: 'Sith Trooper',
    templateResRef: 'n_sithtrooper',
    appearanceId: 28,
    factionId: 1, // Hostile
    hp: 45,
    level: 4,
    classId: 0,
    rightHandResRef: 'w_blaste_01',
    leftHandResRef: '',
    armorResRef: '',
    barkText: 'Halt! By order of the Sith Empire!'
  };

  static pendingPlaceableConfig: GMPlaceableSpawnConfig = {
    name: 'Supply Footlocker',
    templateResRef: '',
    appearanceId: 52, // Footlocker
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
    hp: 120,
    fp: 100,
    str: 16,
    dex: 14,
    con: 14,
    int: 12,
    wis: 16,
    cha: 14,
    rightHandResRef: 'g_w_lghtsbr01',
    leftHandResRef: '',
    armorResRef: 'g_a_jedirobe01',
    featIds: [1, 3, 8, 11, 28, 29, 30, 53], // Flurry, Power Attack, Critical Strike, Weapon Proficiency Lightsaber
    spellIds: [9, 14, 15, 21, 29, 43], // Cure/Heal, Force Push/Wave, Force Lightning, Knight Speed, Throw Lightsaber
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
  static CREATURE_PRESETS: GMCreatureSpawnConfig[] = [
    { name: 'Sith Trooper', templateResRef: 'n_sithtrooper', appearanceId: 28, factionId: 1, hp: 45, level: 4, classId: 0, rightHandResRef: 'w_blaste_01', barkText: 'Halt! By order of the Sith!' },
    { name: 'Sith Commando (Elite)', templateResRef: 'n_sithcommando', appearanceId: 27, factionId: 1, hp: 75, level: 7, classId: 0, rightHandResRef: 'g_w_blstrrfl001', barkText: 'For the Sith Empire!' },
    { name: 'Dark Jedi Knight', templateResRef: 'n_darkjedi01', appearanceId: 58, factionId: 1, hp: 95, level: 8, classId: 3, rightHandResRef: 'g_w_lghtsbr02', barkText: 'Your feeble skills are no match for the Dark Side!' },
    { name: 'Darth Malak', templateResRef: 'n_darthmalak', appearanceId: 21, factionId: 1, hp: 250, level: 15, classId: 3, rightHandResRef: 'g_w_lghtsbr02', barkText: 'Wipe this pathetic planet from the face of the galaxy!' },
    { name: 'Darth Bandon', templateResRef: 'n_darthbandon', appearanceId: 185, factionId: 1, hp: 160, level: 12, classId: 3, rightHandResRef: 'g_w_dblsbr002', barkText: 'You will bow before the Sith!' },
    { name: 'Calo Nord', templateResRef: 'n_calonord', appearanceId: 25, factionId: 1, hp: 130, level: 10, classId: 0, rightHandResRef: 'g_w_hvyrptbltr01', barkText: 'One... Two... Three.' },
    { name: 'Mandalorian Raider', templateResRef: '', appearanceId: 30, factionId: 1, hp: 85, level: 7, classId: 0, rightHandResRef: 'g_w_blstrrfl001', barkText: 'For Mandalore!' },
    { name: 'Tusken Raider (Sand Person)', templateResRef: '', appearanceId: 17, factionId: 1, hp: 65, level: 6, classId: 0, rightHandResRef: 'g_w_gaffi001', barkText: '*Aggressive Tusken war cry!*' },
    { name: 'Kath Hound', templateResRef: '', appearanceId: 6, factionId: 1, hp: 40, level: 4, classId: 0, barkText: '*Snarls menacingly*' },
    { name: 'Rakghoul', templateResRef: '', appearanceId: 13, factionId: 1, hp: 50, level: 5, classId: 0, barkText: '*Ferocious screech!*' },
    { name: 'Terentatek', templateResRef: '', appearanceId: 19, factionId: 1, hp: 220, level: 14, classId: 0, barkText: '*Earth-shaking roar!*' },
    { name: 'Rancor', templateResRef: '', appearanceId: 15, factionId: 1, hp: 300, level: 16, classId: 0, barkText: '*Deafening Rancor roar!*' },
    { name: 'War Droid', templateResRef: '', appearanceId: 37, factionId: 1, hp: 70, level: 6, classId: 0, rightHandResRef: 'g_w_blstrrfl001', barkText: 'Target acquired. Eliminating threat.' },
    { name: 'Republic Soldier', templateResRef: '', appearanceId: 29, factionId: 2, hp: 60, level: 5, classId: 0, rightHandResRef: 'g_w_blstrrfl001', barkText: 'Reporting for duty! For the Republic!' },
    { name: 'Jedi Guardian Ally', templateResRef: '', appearanceId: 136, factionId: 2, hp: 110, level: 8, classId: 3, rightHandResRef: 'g_w_lghtsbr01', armorResRef: 'g_a_jedirobe01', barkText: 'May the Force be with you.' },
    { name: 'Bastila Shan', templateResRef: 'p_bastila', appearanceId: 4, factionId: 2, hp: 110, level: 8, classId: 5, rightHandResRef: 'g_w_dblsbr001', armorResRef: 'g_a_jedirobe01', barkText: 'Keep your guard up. The Force is with us.' },
    { name: 'Carth Onasi', templateResRef: 'p_carth', appearanceId: 6, factionId: 2, hp: 105, level: 8, classId: 0, rightHandResRef: 'g_w_blstrpstl001', leftHandResRef: 'g_w_blstrpstl001', barkText: 'Down you go!' },
    { name: 'Canderous Ordo', templateResRef: 'p_cand', appearanceId: 0, factionId: 2, hp: 130, level: 8, classId: 0, rightHandResRef: 'g_w_hvyrptbltr01', barkText: 'Yeah, this is what I live for!' },
    { name: 'HK-47', templateResRef: 'p_hk47', appearanceId: 11, factionId: 2, hp: 115, level: 8, classId: 0, rightHandResRef: 'g_w_blstrrfl001', barkText: 'Statement: Ready to terminate any hostile meatbags, Master.' },
    { name: 'Jolee Bindo', templateResRef: 'p_jolee', appearanceId: 9, factionId: 2, hp: 100, level: 8, classId: 4, rightHandResRef: 'g_w_lghtsbr01', barkText: 'Get off my lawn, you kids!' },
    { name: 'Juhani', templateResRef: 'p_juhani', appearanceId: 10, factionId: 2, hp: 120, level: 8, classId: 3, rightHandResRef: 'g_w_lghtsbr01', barkText: 'I will be your doom!' },
    { name: 'Mission Vao', templateResRef: 'p_mission', appearanceId: 7, factionId: 2, hp: 85, level: 7, classId: 2, rightHandResRef: 'g_w_blstrpstl001', barkText: 'Need something unlocked? I\'m on it!' },
    { name: 'Zaalbar', templateResRef: 'p_zaalbar', appearanceId: 8, factionId: 2, hp: 145, level: 8, classId: 1, rightHandResRef: 'g_w_bowcaster001', barkText: '*Loyal Wookiee growl*' },
    { name: 'T3-M4', templateResRef: 'p_t3m4', appearanceId: 12, factionId: 2, hp: 80, level: 7, classId: 1, barkText: '*Cheerful astromech binary whistle*' },
    { name: 'Protocol Droid', templateResRef: '', appearanceId: 36, factionId: 5, hp: 40, level: 2, classId: 1, barkText: 'Greetings! How may I be of assistance today?' },
    { name: 'Selkath Officer', templateResRef: '', appearanceId: 16, factionId: 5, hp: 65, level: 5, classId: 0, barkText: 'Obey the neutrality laws of Ahto City.' },
    { name: 'Twi\'lek Merchant', templateResRef: '', appearanceId: 50, factionId: 5, hp: 45, level: 3, classId: 2, barkText: 'Welcome, traveler! Looking for rare goods from across the Outer Rim?' },
  ];

  // Curated Placeable Presets
  static PLACEABLE_PRESETS: GMPlaceableSpawnConfig[] = [
    { name: 'Supply Footlocker', category: 'Storage & Cargo', appearanceId: 52, modelKeywords: ['footlker', 'locker', 'box'], useable: true, hasInventory: true, locked: false, openLockDC: 15, lootResRefs: ['g_i_medeqpmnt01', 'g_i_medeqpmnt02', 'g_i_secspike01'], barkText: '' },
    { name: 'Jedi Weapons Cache', category: 'Temple & Sacred', appearanceId: 53, modelKeywords: ['ornate', 'chest', 'wicker', 'box'], useable: true, hasInventory: true, locked: false, openLockDC: 18, lootResRefs: ['g_w_lghtsbr01', 'g_w_lghtsbr02', 'g_w_dblsbr001', 'g_a_jedirobe01'], barkText: '' },
    { name: 'Locked Sith Vault (DC 18)', category: 'Storage & Cargo', appearanceId: 54, modelKeywords: ['metal', 'vault', 'safe', 'box'], useable: true, hasInventory: true, locked: true, openLockDC: 18, lootResRefs: ['g_w_lghtsbr02', 'g_a_mstrrobe02', 'g_i_medeqpmnt03'], barkText: '' },
    { name: 'Sith Sarcophagus', category: 'Temple & Sacred', appearanceId: 64, modelKeywords: ['sarcoph', 'tomb', 'altar'], useable: true, hasInventory: true, locked: false, openLockDC: 20, lootResRefs: ['g_w_dblsbr002', 'g_a_mstrrobe02'], barkText: '' },
    { name: 'Computer Terminal', category: 'Tech & Consoles', appearanceId: 57, modelKeywords: ['comp', 'terminal', 'console', 'panel'], useable: true, hasInventory: false, locked: false, openLockDC: 15, lootResRefs: [], barkText: '[Terminal Active]: Security grid online. All sector doors operational.' },
    { name: 'Workbench', category: 'Storage & Cargo', appearanceId: 68, modelKeywords: ['workbench', 'bench'], useable: true, hasInventory: true, locked: false, openLockDC: 10, lootResRefs: ['g_w_blstrrfl001', 'g_w_vbrswrd01'], barkText: '[Workbench]: Ready for weapon & armor modifications.' },
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
      lootResRefs: ['g_i_secspike01', 'g_i_progspike01', 'g_w_vbrswrd01'],
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
      lootResRefs: ['g_w_blstrrfl001', 'g_w_hvyrptbltr01', 'g_w_blstrpstl001', 'g_w_vbrswrd01'],
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
            name: 'Receptionist Protocol Droid', appearanceId: 36, factionId: 5, hp: 45, level: 3, classId: 1,
            barkText: 'Welcome to the Executive Office Complex! Do you have an appointment with the Director?'
          }
        },
        {
          dx: 0, dy: 17.4, dz: 0, yawDeg: 180,
          config: {
            name: 'Sector Director', appearanceId: 50, factionId: 5, hp: 75, level: 6, classId: 2, rightHandResRef: 'g_w_blstrpstl001',
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
            name: 'Ancient Temple Guardian', appearanceId: 136, factionId: 5, hp: 160, level: 12, classId: 3,
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
            lootResRefs: ['g_w_hvyrptbltr01', 'g_w_blstrrfl001', 'g_w_blstrpstl001', 'g_a_class8001'],
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
            name: 'Tactical Commander', appearanceId: 29, factionId: 2, hp: 95, level: 8, classId: 0, rightHandResRef: 'g_w_blstrpstl001',
            barkText: 'Gather around the holo-table. Our strike team deploys on your mark!'
          }
        },
        {
          dx: -3.5, dy: 5.5, dz: 0, yawDeg: 0,
          config: {
            name: 'Command Security Droid', appearanceId: 37, factionId: 2, hp: 80, level: 6, classId: 0, rightHandResRef: 'g_w_blstrrfl001',
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
            name: 'Chief Medical Officer Droid', appearanceId: 36, factionId: 2, hp: 60, level: 5, classId: 1,
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
            name: 'Twi\'lek Cantina Bartender', appearanceId: 50, factionId: 5, hp: 55, level: 4, classId: 2,
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
            useable: true, hasInventory: true, locked: false, openLockDC: 12, lootResRefs: ['g_w_vbrswrd01']
          }
        },
        {
          dx: 3.5, dy: 9.8, dz: 0, yawDeg: 0,
          config: {
            name: 'Plasteel Contraband Cylinder', category: 'Storage & Cargo', appearanceId: 53, modelKeywords: ['cylinder', 'plasteel', 'canister'], scale: 1.1,
            useable: true, hasInventory: true, locked: false, openLockDC: 15, lootResRefs: ['g_w_hvyrptbltr01', 'g_a_class6001']
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
            name: 'Warehouse Quartermaster', appearanceId: 25, factionId: 5, hp: 90, level: 7, classId: 2, rightHandResRef: 'g_w_blstrpstl001',
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
      hp: 150,
      fp: 110,
      str: 18,
      dex: 14,
      con: 15,
      int: 10,
      wis: 14,
      cha: 12,
      rightHandResRef: 'g_w_lghtsbr01',
      leftHandResRef: '',
      armorResRef: 'g_a_jedirobe01',
      featIds: [1, 3, 8, 11, 28, 29, 30, 53],
      spellIds: [9, 14, 15, 29, 43],
      possessImmediately: true
    },
    {
      name: 'Jedi Consular (Force Master)',
      appearanceId: 166,
      portraitId: 21,
      gender: 1,
      classId: 4, // Jedi Consular
      level: 10,
      hp: 115,
      fp: 180,
      str: 12,
      dex: 14,
      con: 14,
      int: 14,
      wis: 18,
      cha: 16,
      rightHandResRef: 'g_w_lghtsbr03',
      leftHandResRef: '',
      armorResRef: 'g_a_mstrrobe01',
      featIds: [1, 3, 8, 11, 53],
      spellIds: [9, 10, 14, 15, 21, 22, 29, 43],
      possessImmediately: true
    },
    {
      name: 'Jedi Sentinel (Dual Saber)',
      appearanceId: 121,
      portraitId: 12,
      gender: 0,
      classId: 5, // Jedi Sentinel
      level: 10,
      hp: 130,
      fp: 140,
      str: 14,
      dex: 17,
      con: 14,
      int: 14,
      wis: 15,
      cha: 12,
      rightHandResRef: 'g_w_dblsbr001',
      leftHandResRef: '',
      armorResRef: 'g_a_kghtrobe01',
      featIds: [1, 2, 3, 8, 9, 11, 28, 53],
      spellIds: [9, 14, 15, 29, 43],
      possessImmediately: true
    },
    {
      name: 'Sith Marauder (Dark Side)',
      appearanceId: 138,
      portraitId: 16,
      gender: 0,
      classId: 3, // Jedi Guardian
      level: 12,
      hp: 175,
      fp: 150,
      str: 18,
      dex: 15,
      con: 16,
      int: 10,
      wis: 15,
      cha: 14,
      rightHandResRef: 'g_w_lghtsbr02',
      leftHandResRef: 'g_w_lghtsbr02',
      armorResRef: 'g_a_mstrrobe02',
      featIds: [1, 2, 3, 8, 9, 11, 28, 29, 30, 53],
      spellIds: [9, 14, 15, 21, 22, 29, 43],
      possessImmediately: true
    },
    {
      name: 'Republic Heavy Soldier',
      appearanceId: 91,
      portraitId: 7,
      gender: 0,
      classId: 0, // Soldier
      level: 8,
      hp: 140,
      fp: 0,
      str: 16,
      dex: 16,
      con: 16,
      int: 12,
      wis: 12,
      cha: 10,
      rightHandResRef: 'g_w_hvyrptbltr01',
      leftHandResRef: '',
      armorResRef: 'g_a_class8001',
      featIds: [1, 3, 8, 11, 20, 29],
      spellIds: [],
      possessImmediately: true
    },
    {
      name: 'Smuggler Scoundrel',
      appearanceId: 151,
      portraitId: 18,
      gender: 1,
      classId: 2, // Scoundrel
      level: 8,
      hp: 105,
      fp: 0,
      str: 12,
      dex: 18,
      con: 13,
      int: 15,
      wis: 13,
      cha: 15,
      rightHandResRef: 'g_w_blstrpstl001',
      leftHandResRef: 'g_w_blstrpstl001',
      armorResRef: 'g_a_class4001',
      featIds: [1, 2, 3, 8, 9, 11, 19],
      spellIds: [],
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
    { resRef: 'g_w_vbrswrd01', label: 'Vibrosword (g_w_vbrswrd01)' },
    { resRef: 'g_w_vbrdblswd01', label: 'Vibro Double-Blade (g_w_vbrdblswd01)' },
    { resRef: 'g_w_gaffi001', label: 'Gaffi Stick (g_w_gaffi001)' },
    { resRef: 'w_blaste_01', label: 'Sith Blaster Rifle (w_blaste_01)' },
    { resRef: 'g_w_blstrrfl001', label: 'Blaster Rifle (g_w_blstrrfl001)' },
    { resRef: 'g_w_hvyrptbltr01', label: 'Heavy Repeating Blaster (g_w_hvyrptbltr01)' },
    { resRef: 'g_w_blstrpstl001', label: 'Blaster Pistol (g_w_blstrpstl001)' },
    { resRef: 'g_w_bowcaster001', label: 'Wookiee Bowcaster (g_w_bowcaster001)' },
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
      if (!GameState.gmMode || e.button !== 0 || !this.isGMUser()) return;
      const target = e.target as HTMLElement;
      if (target && target.closest('.gm-panel-root')) return;

      // Ignore drags (camera rotation)
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      if (Math.hypot(dx, dy) > 6) return;

      // In POSSESS mode, let standard KotOR IngameControls handle left-clicks unless a placement/teleport tool is explicitly active
      if (this.controlMode === 'POSSESS' && this.activeTool === 'select') {
        return;
      }

      this.handleViewportClick(e.clientX, e.clientY, e.detail >= 2);
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
      if (isDoubleClick && picked && BitWise.InstanceOf(picked.objectType, ModuleObjectType.ModuleCreature)) {
        this.possessCharacter(picked as ModuleCreature);
      }
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

  static setToolMode(tool: GMToolMode) {
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

    if (!loadedFromUTC || config.appearanceId >= 0) {
      setOrAdd(GFFDataType.WORD, 'Appearance_Type', config.appearanceId ?? 28);
    }
    const targetHp = config.hp || 50;
    setOrAdd(GFFDataType.WORD, 'FactionID', config.factionId ?? 1);
    setOrAdd(GFFDataType.WORD, 'HitPoints', targetHp);
    setOrAdd(GFFDataType.WORD, 'CurrentHitPoints', targetHp);
    setOrAdd(GFFDataType.WORD, 'MaxHitPoints', targetHp);

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

      const classList = root.addField(new GFFField(GFFDataType.LIST, 'ClassList'));
      const classStruct = new GFFStruct();
      classStruct.addField(new GFFField(GFFDataType.INT, 'Class')).setValue(config.classId ?? 0);
      classStruct.addField(new GFFField(GFFDataType.SHORT, 'ClassLevel')).setValue(config.level || 4);
      classList.addChildStruct(classStruct);
    }

    // Configure Equipped Items if specified
    if (config.rightHandResRef || config.leftHandResRef || config.armorResRef) {
      root.removeFieldByLabel('Equip_ItemList');
      const equipField = root.addField(new GFFField(GFFDataType.LIST, 'Equip_ItemList'));
      if (config.armorResRef) {
        const s = new GFFStruct(ModuleCreatureArmorSlot.ARMOR);
        s.addField(new GFFField(GFFDataType.RESREF, 'EquippedRes')).setValue(config.armorResRef);
        equipField.addChildStruct(s);
      }
      if (config.rightHandResRef) {
        const s = new GFFStruct(ModuleCreatureArmorSlot.RIGHTHAND);
        s.addField(new GFFField(GFFDataType.RESREF, 'EquippedRes')).setValue(config.rightHandResRef);
        equipField.addChildStruct(s);
      }
      if (config.leftHandResRef) {
        const s = new GFFStruct(ModuleCreatureArmorSlot.LEFTHAND);
        s.addField(new GFFField(GFFDataType.RESREF, 'EquippedRes')).setValue(config.leftHandResRef);
        equipField.addChildStruct(s);
      }
    }

    setOrAdd(GFFDataType.FLOAT, 'XPosition', targetLoc.position.x);
    setOrAdd(GFFDataType.FLOAT, 'YPosition', targetLoc.position.y);
    setOrAdd(GFFDataType.FLOAT, 'ZPosition', targetLoc.position.z);
    setOrAdd(GFFDataType.FLOAT, 'XOrientation', -Math.sin(targetLoc.facing));
    setOrAdd(GFFDataType.FLOAT, 'YOrientation', Math.cos(targetLoc.facing));

    const creature = new ModuleCreature(gff);
    if (config.barkText) {
      (creature as any).gmBarkText = config.barkText;
    }

    area.attachObject(creature);
    creature.load();
    creature.firstName = config.name || creature.firstName;
    this.setCreatureHP(creature, targetHp, targetHp);
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

    const netId = existingNetId || this.getNextNetId('cre');
    this.registerNetObject(netId, creature);

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

    const resolvedAppearanceId = this.resolvePlaceableAppearanceId(
      config.modelKeywords,
      config.appearanceId ?? 52
    );

    let gff = new GFFObject();
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
      }
    }

    const root = gff.RootNode;
    root.removeFieldByLabel('TemplateResRef');
    const setOrAdd = (type: number, label: string, val: any) => {
      if (root.hasField(label)) {
        root.getFieldByLabel(label).setValue(val);
      } else {
        root.addField(new GFFField(type, label)).setValue(val);
      }
    };

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
    setOrAdd(GFFDataType.BYTE, 'Static', 0);
    setOrAdd(GFFDataType.SHORT, 'HP', 50);
    setOrAdd(GFFDataType.SHORT, 'CurrentHP', 50);
    setOrAdd(GFFDataType.FLOAT, 'X', targetLoc.position.x);
    setOrAdd(GFFDataType.FLOAT, 'Y', targetLoc.position.y);
    setOrAdd(GFFDataType.FLOAT, 'Z', targetLoc.position.z);
    setOrAdd(GFFDataType.FLOAT, 'Bearing', targetLoc.facing);

    const plc = new ModulePlaceable(gff);
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
    plc.appearance = resolvedAppearanceId;
    plc.useable = config.useable;
    plc.hasInventory = config.hasInventory;
    plc.locked = config.locked;
    plc.openLockDC = config.openLockDC || 15;
    plc.position.copy(targetLoc.position);
    plc.bearing = targetLoc.facing;
    plc.rotation.set(0, 0, targetLoc.facing);

    // Populate container inventory items
    if (config.hasInventory && Array.isArray(config.lootResRefs)) {
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

    const netId = existingNetId || this.getNextNetId('plc');
    this.registerNetObject(netId, plc);

    if (!existingNetId && GMNetworkManager.role !== 'offline') {
      GMNetworkManager.broadcastActorSpawn(this.serializeSingleActor(plc));
    }

    this.notifyChange();
    return plc;
  }

  /**
   * Spawn a playable Player Character in the current area
   */
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
    root.addField(new GFFField(GFFDataType.WORD, 'HitPoints')).setValue(config.hp || 120);
    root.addField(new GFFField(GFFDataType.WORD, 'CurrentHitPoints')).setValue(config.hp || 120);
    root.addField(new GFFField(GFFDataType.WORD, 'MaxHitPoints')).setValue(config.hp || 120);
    root.addField(new GFFField(GFFDataType.WORD, 'ForcePoints')).setValue(config.fp ?? 100);
    root.addField(new GFFField(GFFDataType.WORD, 'CurrentForce')).setValue(config.fp ?? 100);
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

    // Skills (give high Security, Computer Use, Persuade, Repair, Treat Injury so player can unlock doors and use objects)
    const skillList = root.addField(new GFFField(GFFDataType.LIST, 'SkillList'));
    for (let i = 0; i < 8; i++) {
      const s = new GFFStruct();
      s.addField(new GFFField(GFFDataType.BYTE, 'Rank')).setValue(12);
      skillList.addChildStruct(s);
    }

    // Class & Force Powers
    const classList = root.addField(new GFFField(GFFDataType.LIST, 'ClassList'));
    const classStruct = new GFFStruct();
    classStruct.addField(new GFFField(GFFDataType.INT, 'Class')).setValue(config.classId ?? 3);
    classStruct.addField(new GFFField(GFFDataType.SHORT, 'ClassLevel')).setValue(config.level || 8);
    const knownList = classStruct.addField(new GFFField(GFFDataType.LIST, 'KnownList0'));
    if (Array.isArray(config.spellIds)) {
      for (const spellId of config.spellIds) {
        const sp = new GFFStruct();
        sp.addField(new GFFField(GFFDataType.WORD, 'Spell')).setValue(spellId);
        knownList.addChildStruct(sp);
      }
    }
    classList.addChildStruct(classStruct);

    // Feats
    const featList = root.addField(new GFFField(GFFDataType.LIST, 'FeatList'));
    if (Array.isArray(config.featIds)) {
      for (const featId of config.featIds) {
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
    this.setCreatureHP(player, config.hp || 120, config.hp || 120);

    // Ensure runtime feats & spells are populated if not already
    if (Array.isArray(config.featIds)) {
      for (const fId of config.featIds) {
        if (!player.getHasFeat(fId)) {
          player.addFeat(TalentFeat.From2DA({ __index: fId, ...(GameState.TwoDAManager.datatables.get('feat')?.rows?.[fId] || {}) }));
        }
      }
    }
    if (Array.isArray(config.spellIds) && player.classes[0]) {
      for (const sId of config.spellIds) {
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
    obj.position.copy(pos);
    if (obj.container) {
      obj.container.position.copy(pos);
    }
    obj.getCurrentRoom();
    obj.computeBoundingBox(true);
    if (GMNetworkManager.role !== 'offline') {
      GMNetworkManager.broadcastActorUpdate(this.serializeSingleActor(obj));
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
      templateResRef: obj.getTemplateResRef() || '',
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
    const area = GameState.module?.area;
    if (!area || this.sceneLoading || !GameState.module.readyToProcessEvents) return [];
    const list: GMSerializedActor[] = [];
    for (const p of GameState.PartyManager.party) {
      if (p) list.push(this.serializeSingleActor(p));
    }
    for (const c of area.creatures) {
      if (c && !GameState.PartyManager.party.includes(c)) {
        list.push(this.serializeSingleActor(c));
      }
    }
    for (const plc of area.placeables) {
      if (plc && (plc as any).gmNetId && !String((plc as any).gmNetId).startsWith('plc_area_')) {
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
    if (!actor || !GameState.module?.area) return null;
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
    if (!GameState.gmMode || GMNetworkManager.role !== 'host' || !obj) return null;
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
    // Friendly creatures (barks/greetings) stay local and cosmetic for now
    return false;
  }

  static async spawnPlayerFromNetworkPreset(peerId: string, playerName: string, preset: GMPlayerJoinPreset): Promise<string | null> {
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

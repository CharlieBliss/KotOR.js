import type { GMPlayerSheet, GMSessionRules } from "@/managers/GMNetworkManager";
import type { ICharacterAttributes } from "@/engine/rules/CharacterBuilder";

export type GMControlMode = 'FREECAM' | 'POSSESS';
export type GMToolMode = 'select' | 'place_creature' | 'place_placeable' | 'place_player' | 'teleport' | 'place_mine'
  // Ordering an NPC (GMNpcOrders): click the ground to move it, a creature to attack or follow, points to patrol
  | 'order_move' | 'order_attack' | 'order_follow' | 'order_patrol';

export interface GMModuleEntry {
  resRef: string;
  planet: string;
  title: string;
  description: string;
}

/** A stance or gesture the GM can give a creature */
export interface GMAnimationChoice {
  id: string;
  label: string;
  group: string;
  /** animations.2da names, best first */
  anims: string[];
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
  /** A held stance (a looping animations.2da name) */
  stance?: string;
  aiDisabled?: boolean;
  /** A preset only one game has the template for */
  onlyIn?: 'kotor' | 'tsl';
  /** Items the creature carries, lootable from its body once it dies */
  lootResRefs?: string[];
}

/** A check the GM calls for: a skill (SKILL_*) or a saving throw */
export type GMCheck = { kind: 'skill'; skill: number } | { kind: 'save'; save: 'fortitude' | 'reflex' | 'will' };

/** A roll a player made themselves (no difficulty: the GM decides what it means) */
export interface GMRollResult {
  /** Who rolled: their character's name and net id */
  name: string;
  netId?: string;
  /** What they rolled, e.g. "Persuade" */
  label: string;
  roll: number;
  bonus: number;
  total: number;
  /** When it arrived here (ms, performance clock), for showing it a while */
  at?: number;
}

export interface GMCheckResult {
  name: string;
  label: string;
  roll: number;
  bonus: number;
  total: number;
  dc: number;
  success: boolean;
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
  /** Using it takes a skill check first (a terminal needing Computer Use, a panel needing Repair...) */
  skillGate?: GMSkillGate;
}

/** A skill check that stands between a player and using an object; passing it once opens it for good */
export interface GMSkillGate {
  skill: number;
  dc: number;
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
  /** Override the class's skill ranks (CharacterBuilder): skills.2da row -> rank */
  skillRanks?: number[];
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
  stance?: string;
  /** What it fights with (GMCombatAI), when not everything */
  combatStyle?: 'weapons' | 'attack';
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

/**
 * A character a player made (GMCharacters keeps them; they join a session with one). The model is kept by
 * appearance label so it means the same thing on every machine; the id is the fallback.
 */
export interface GMCharacter {
  id: string;
  version: 1;
  /** The game it was made for */
  game: 'kotor' | 'tsl';
  name: string;
  appearanceLabel: string;
  appearanceId: number;
  portraitId: number;
  gender: number;
  classId: number;
  level: number;
  attributes: ICharacterAttributes;
  alignment?: 'light' | 'dark';
  /** feat.2da rows, automatic ones included; left out: the class's recommended feats */
  feats?: number[];
  /** spells.2da rows; left out: the class's recommended powers */
  powers?: number[];
  /** skills.2da row -> rank; left out: the class's recommended ranks */
  skillRanks?: number[];
  gear?: { rightHand?: string; leftHand?: string; armor?: string };
  /** When it was last saved (ms) */
  updated: number;
}

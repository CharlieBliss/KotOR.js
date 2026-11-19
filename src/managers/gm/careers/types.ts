import type { SkillType } from "@/enums/nwscript/SkillType";

/** Which character/combat rule set a GM session uses (KotOR II only for 'careers') */
export type GMRuleset = 'kotor' | 'careers';

/** The six characteristics in FFG scale (1–6); converted to KotOR ability scores via 6 + 2 * value */
export type CareerAbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type CareerAttributes = Record<CareerAbilityKey, number>;

export type CareerSkillCategory = 'combat' | 'engine' | 'general' | 'social' | 'knowledge';

export type CombatSkillId =
  | 'brawl'
  | 'melee'
  | 'lightsaber'
  | 'ranged_light'
  | 'ranged_heavy'
  | 'gunnery';

export type EngineSkillId =
  | 'computer_use'
  | 'demolitions'
  | 'stealth'
  | 'awareness'
  | 'repair'
  | 'security'
  | 'treat_injury';

export type NarrativeGeneralSkillId =
  | 'astrogation'
  | 'athletics'
  | 'cool'
  | 'coordination'
  | 'discipline'
  | 'piloting_planetary'
  | 'piloting_space'
  | 'resilience'
  | 'streetwise'
  | 'survival';

export type NarrativeSocialSkillId =
  | 'charm'
  | 'coercion'
  | 'deception'
  | 'leadership'
  | 'negotiation';

export type NarrativeKnowledgeSkillId =
  | 'knowledge_core_worlds'
  | 'knowledge_education'
  | 'knowledge_lore'
  | 'knowledge_outer_rim'
  | 'knowledge_underworld'
  | 'knowledge_warfare'
  | 'knowledge_xenology';

/** Every skill on a careers character sheet (Persuade is derived from best of Charm, Negotiation, Deception) */
export type CareerSkillId =
  | CombatSkillId
  | EngineSkillId
  | NarrativeGeneralSkillId
  | NarrativeSocialSkillId
  | NarrativeKnowledgeSkillId;

export interface CareerSkillDef {
  id: CareerSkillId;
  name: string;
  category: CareerSkillCategory;
  ability: CareerAbilityKey;
  /** Corresponding KotOR skills.2da row, when this skill maps directly to an engine skill */
  engineSkill?: SkillType;
  /** Saving throw this skill drives (Resilience -> Fortitude, Coordination -> Reflex, Discipline -> Will) */
  save?: 'fortitude' | 'reflex' | 'will';
  /** Subject to the level-gated rank cap (combat skills and save skills) */
  levelCapped?: boolean;
}

export interface CareerSpeciesDef {
  id: string;
  name: string;
  description: string;
  modelType: 'B' | 'F';
  /** KotOR Race byte: 6 = humanoid/organic, 5 = droid */
  race: 5 | 6;
  /** SubraceIndex written at spawn (0 avoids Wookiee SubRace 1 HP override) */
  subraceIndex: number;
  /** Starting characteristics on the 1–6 FFG scale */
  characteristics: CareerAttributes;
  startingXp: number;
  hpBase: number;
  strainBase: number;
  /** Free career skill ranks at creation (4 for organics, 6 for droids) */
  freeCareerSkills: number;
  /** Free non-career skill ranks at creation (2 for Humans, 0 for others) */
  freeNonCareerSkills: number;
  /** Force-sensitive regardless of career (Miraluka) */
  forceSensitive?: boolean;
  /** Can never become Force-sensitive (Droids) */
  forceIneligible?: boolean;
  abilitySummary: string;
  /** Model filtering hints for the creator's model picker */
  modelGroup: 'player' | 'humanoid' | 'droid';
  modelKeywords?: string[];
  /** Default appearanceId when creating a blank character of this species */
  defaultAppearanceId: number;
  defaultPortraitId: number;
}

export type CareerTreeNodeKind = 'feat' | 'talent' | 'career_skill' | 'characteristic' | 'capstone';

export interface CareerTreeNodeDef {
  /** Grid coordinate id, e.g. 'r0c0' .. 'r3c2' */
  id: string;
  row: 0 | 1 | 2 | 3;
  col: 0 | 1 | 2;
  kind: CareerTreeNodeKind;
  label: string;
  description: string;
  /** KotOR feat.2da row (for kind === 'feat') */
  featId?: number;
  /** Skill made a career skill (for kind === 'career_skill') or unlocked to rank 6 (for kind === 'capstone') */
  skillId?: CareerSkillId;
  /** Neighbour node ids connected to this node (across or down) */
  links: string[];
}

export interface CareerSpecializationDef {
  id: string;
  name: string;
  careerId: string;
  description: string;
  /** 4 additional career skills granted by this specialization */
  bonusSkills: CareerSkillId[];
  /** 12 nodes arranged in a 3 columns x 4 rows grid */
  nodes: CareerTreeNodeDef[];
}

export interface CareerStartingKit {
  rightHand?: string;
  leftHand?: string;
  armor?: string;
  items?: { resRef: string; stack: number }[];
}

export interface CareerDef {
  id: string;
  name: string;
  description: string;
  forceSensitive: boolean;
  /** 8 career skills */
  careerSkills: CareerSkillId[];
  /** Specializations whose home career this is (first is the default starting specialization) */
  specializations: string[];
  startingKit: CareerStartingKit;
}

export interface CareerStarterPowerDef {
  spellId: number;
  label: string;
  name: string;
  alignment: 'universal' | 'light' | 'dark';
  xpCost: number;
  description: string;
}

/**
 * Saved character under the Careers rule set. Kept separate from classic GMCharacter files and
 * explicitly tagged with `ruleset: 'careers'`.
 */
export interface GMCareersCharacter {
  id: string;
  version: 1;
  ruleset: 'careers';
  game: 'tsl';
  name: string;
  speciesId: string;
  appearanceLabel: string;
  appearanceId: number;
  portraitId: number;
  gender: number;
  careerId: string;
  startingSpecId: string;
  /** Owned specializations (always starts with startingSpecId) */
  specializations: string[];
  /** FFG-scale characteristics (1–6) */
  characteristics: CareerAttributes;
  /** Free creation ranks: 4 career skills (6 for droids) */
  freeCareerSkills: CareerSkillId[];
  /** Free creation ranks: 2 from starting specialization's bonus skills */
  freeSpecSkills: CareerSkillId[];
  /** Free creation ranks from species (e.g. 2 non-career skills for Humans) */
  freeSpeciesSkills: CareerSkillId[];
  /** Purchased skill ranks (added on top of free ranks; total rank = free + bought) */
  boughtSkillRanks: Partial<Record<CareerSkillId, number>>;
  /** Purchased tree nodes, keyed by specialization id */
  nodes: Record<string, string[]>;
  /** Purchased Force powers (spells.2da rows) */
  powers: number[];
  alignment: 'light' | 'dark';
  /** Starting XP spent during creation (does NOT count toward level) */
  startingXpSpent: number;
  /** Campaign XP awarded by the GM after creation */
  campaignXpEarned: number;
  /** Campaign XP spent after creation (drives XP-derived level) */
  campaignXpSpent: number;
  /** Optional gear overrides (defaults to career's starting kit) */
  gear?: { rightHand?: string; leftHand?: string; armor?: string };
  updated: number;
}

/** Derived numbers for a careers character sheet and spawn conversion */
export interface GMCareersDerived {
  level: number;
  levelBaseline: number;
  forceSensitive: boolean;
  /** KotOR-scale attributes (6 + 2 * FFG value) */
  kotorAttributes: CareerAttributes;
  /** Ability modifiers (FFG value - 2) */
  modifiers: CareerAttributes;
  maxHp: number;
  maxStrain: number;
  maxFp: number;
  /** Raw save ranks * 2 (without ability modifier, for raw save fields / seams) */
  saveRanks: { fortitude: number; reflex: number; will: number };
  /** Total saves including ability modifiers */
  saves: { fortitude: number; reflex: number; will: number };
  /** Base unarmoured defence: 10 + DEX mod + level baseline */
  baseDefense: number;
  /** Attack bonus per combat skill: rank * 2 + ability mod + level baseline */
  combatAttack: Record<CombatSkillId, number>;
  /** Effective skill ranks (free + bought) for all skills */
  skillRanks: Record<CareerSkillId, number>;
  /** 8-element KotOR skills.2da array (rank * 4; Persuade = max(Charm, Negotiation, Deception) * 4) */
  engineSkills: number[];
  /** Full set of career skills (career + all owned specializations) */
  careerSkills: Set<CareerSkillId>;
  /** Effective KotOR feat IDs (baseline proficiencies + owned feat nodes) */
  featIds: number[];
  /** Known Force power spell IDs */
  spellIds: number[];
  /** XP accounting */
  startingXpBudget: number;
  startingXpUsed: number;
  startingXpRemaining: number;
  campaignXpRemaining: number;
  totalXpRemaining: number;
  /** Total XP cost of all purchases currently on the sheet */
  totalPurchaseCost: number;
}

import type { SkillType } from "@/enums/nwscript/SkillType";
import type { CareerBuffBadge, CareerTalentTotals } from "@/managers/gm/careers/talentEffects";

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
  /** Custom talent registry id (for kind === 'talent') */
  talentId?: string;
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
  /** What a droid of this career wears instead of `armor` (droids can't wear armour suits); none when omitted */
  droidArmor?: string;
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

export type CareerPowerNodeKind = 'root' | 'passive' | 'variant';
/** A variant that has no KotOR power of its own: the family's root power, cast differently */
export type CareerPowerVariant = 'pull';

/** What one rank of a passive power upgrade adds, to every power in its family */
export interface CareerPowerUpgrade {
  /** Damage added to each of the power's damage effects */
  damage?: number;
  /** Added to the power's save DC */
  saveDC?: number;
  /** Metres added to a Force push's knockback */
  pushDistance?: number;
  /** Seconds added to the stun the power's script leaves (Push's, once the target lands) */
  stunSeconds?: number;
  /** More enemies near a single target that the power also hits */
  extraTargets?: number;
  /** Seconds added to the power's hold (Whirlwind's) */
  durationSeconds?: number;
}

export interface CareerPowerNodeDef {
  id: string;
  row: 0 | 1 | 2 | 3;
  col: 0 | 1 | 2;
  kind: CareerPowerNodeKind;
  label: string;
  description: string;
  xpCost: number;
  /** Neighbour node ids (the branch above and below; every row 1 node links to the root) */
  links: string[];
  /** kind 'passive': what each rank adds */
  upgrade?: CareerPowerUpgrade;
  /** kind 'variant': the KotOR power it adds to the wheel (spells.2da row) */
  variantSpellId?: number;
  /** kind 'variant' with no KotOR power: how the root power is cast instead */
  variant?: CareerPowerVariant;
}

/** One Force power family as a tree: the basic power at the root, upgrades and variants below */
export interface CareerPowerTreeDef {
  id: string;
  name: string;
  description: string;
  /** spells.2da row of the root power */
  rootSpellId: number;
  alignment: 'universal' | 'light' | 'dark';
  nodes: CareerPowerNodeDef[];
}

/** A family's passive upgrades added up (each rank owned times its numbers) */
export type CareerPowerModifiers = Required<CareerPowerUpgrade>;

/** A variant with no KotOR power of its own, as the wheel lists it */
export interface CareerPowerVariantDef {
  treeId: string;
  variant: CareerPowerVariant;
  /** The root power it's cast as */
  spellId: number;
  name: string;
  description: string;
}

export interface CareersXpLogEntry {
  amount: number;
  reason: string;
  at: number;
}

export type CareersPurchaseRequest =
  | { kind: 'skill'; skillId: CareerSkillId }
  | { kind: 'node'; specId: string; nodeId: string; ability?: CareerAbilityKey }
  | { kind: 'specialization'; specId: string }
  | { kind: 'power'; spellId: number }
  | { kind: 'power_node'; treeId: string; nodeId: string };

export type CareersPurchaseRecord = CareersPurchaseRequest & {
  cost: number;
  startingXpPaid: number;
  campaignXpPaid: number;
  at: number;
};

/** Live careers state synced from host to client in GMPlayerSheet */
export interface GMCareersNetworkState {
  character: GMCareersCharacter;
  strain: number;
  maxStrain: number;
  windedSeconds: number;
  /** Active talent buffs currently ticking on the host (for HUD badges) */
  activeBuffs?: CareerBuffBadge[];
  /** Remaining active talent cooldowns in whole seconds (for HUD usability) */
  cooldowns?: Record<string, number>;
}

/** Alignment on a Careers sheet (starts neutral at creation; shifts through story play) */
export type CareerAlignment = 'neutral' | 'light' | 'dark';

/**
 * Saved character under the Careers rule set. Kept separate from classic GMCharacter files and
 * explicitly tagged with `ruleset: 'careers'`.
 */
export interface GMCareersCharacter {
  id: string;
  /** 2 since the Force power ids were corrected and Force Push became a tree (GMCareersCharacters.upgrade) */
  version: 1 | 2;
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
  /** Chosen characteristic (+1) for owned 'characteristic' (Dedication) nodes, keyed by `${specId}:${nodeId}` */
  nodeChoices?: Record<string, CareerAbilityKey>;
  /** Purchased Force powers bought on their own (spells.2da rows) */
  powers: number[];
  /** Purchased Force power tree nodes, keyed by power tree id (the root first) */
  powerNodes?: Record<string, string[]>;
  alignment: CareerAlignment;
  /** Starting XP spent during creation (does NOT count toward level) */
  startingXpSpent: number;
  /** Campaign XP awarded by the GM after creation */
  campaignXpEarned: number;
  /** Campaign XP spent after creation (drives XP-derived level) */
  campaignXpSpent: number;
  /** Log of GM XP awards (for advancement history) */
  xpLog?: CareersXpLogEntry[];
  /** Ordered post-creation purchases (for GM undo / full respec) */
  purchases?: CareersPurchaseRecord[];
  /** Optional gear overrides (defaults to career's starting kit) */
  gear?: { rightHand?: string; leftHand?: string; armor?: string };
  updated: number;
}

/** Derived numbers for a careers character sheet and spawn conversion */
export interface GMCareersDerived {
  level: number;
  levelBaseline: number;
  forceSensitive: boolean;
  /** Effective FFG-scale characteristics (creation + owned Dedication nodes, capped at 6) */
  effectiveCharacteristics: CareerAttributes;
  /** KotOR-scale attributes (6 + 2 * FFG value) */
  kotorAttributes: CareerAttributes;
  /** Ability modifiers (FFG value - 2) */
  modifiers: CareerAttributes;
  maxHp: number;
  maxStrain: number;
  maxFp: number;
  /** Raw save ranks * 2 + passive talent save bonuses (without ability modifier, for raw save fields / seams) */
  saveRanks: { fortitude: number; reflex: number; will: number };
  /** Total saves including ability modifiers and passive talents */
  saves: { fortitude: number; reflex: number; will: number };
  /** Base unarmoured defence: 10 + DEX mod + level baseline + passive talent defence */
  baseDefense: number;
  /** Attack bonus per combat skill: rank * 2 + ability mod + level baseline */
  combatAttack: Record<CombatSkillId, number>;
  /** Effective skill ranks (free + bought) for all skills */
  skillRanks: Record<CareerSkillId, number>;
  /** Total stacked ranks of each owned custom talent across all owned specializations */
  talentRanks: Record<string, number>;
  /** Every passive talent hook added up (defence, saves, skill bonuses, scoped attack and damage bonuses...) */
  talents: CareerTalentTotals;
  /** 8-element KotOR skills.2da array (rank * 4; Persuade = max(Charm, Negotiation, Deception) * 4) */
  engineSkills: number[];
  /** Full set of career skills (career + all owned specializations + owned 'career_skill' nodes) */
  careerSkills: Set<CareerSkillId>;
  /** Effective KotOR feat IDs (baseline proficiencies + owned feat nodes) */
  featIds: number[];
  /** Known Force power spell IDs (powers bought on their own, tree roots, and KotOR variants) */
  spellIds: number[];
  /** Each owned power family's passive upgrades added up, under every spell id in the family */
  powerFamilies: Record<number, CareerPowerModifiers>;
  /** Owned variants with no KotOR power of their own (Pull), for the wheel */
  powerVariants: CareerPowerVariantDef[];
  /** XP accounting */
  startingXpBudget: number;
  startingXpUsed: number;
  startingXpRemaining: number;
  campaignXpRemaining: number;
  totalXpRemaining: number;
  /** Total XP cost of all purchases currently on the sheet */
  totalPurchaseCost: number;
}

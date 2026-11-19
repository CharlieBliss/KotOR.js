import { CombatFeatType } from "@/enums/combat/CombatFeatType";
import { CAREERS_TALENT_BY_ID } from "@/managers/gm/careers/talents";
import type {
  CareerDef,
  CareerSpecializationDef,
  CareerTreeNodeDef,
  CareerSpeciesDef,
  CareerStarterPowerDef,
} from "@/managers/gm/careers/types";

/**
 * Proficiencies granted automatically to every careers character:
 * all weapon proficiencies plus light and medium armour (heavy armour requires a talent/feat node).
 */
export const BASELINE_CAREER_FEATS: readonly number[] = [
  CombatFeatType.WEAPON_PROF_BLASTER,
  CombatFeatType.WEAPON_PROF_BLASTER_RIFLE,
  CombatFeatType.WEAPON_PROF_HEAVY_WEAPONS,
  CombatFeatType.WEAPON_PROF_LIGHTSABER,
  CombatFeatType.WEAPON_PROF_MELEE_WEAPONS,
  CombatFeatType.ARMOUR_PROF_LIGHT,
  CombatFeatType.ARMOUR_PROF_MEDIUM,
];

/** Force point base added to level * (4 + WIS mod) for Force-sensitive careers characters */
export const CAREERS_FORCE_BASE = 10;

/** Default post-creation XP spent per derived level (50 XP -> Lv.20 at 950 XP) */
export const CAREERS_XP_PER_LEVEL = 50;

/**
 * Vertical slice species (3 species exercising all species mechanics:
 * Human extra non-career ranks, Miraluka cross-career Force sensitivity, Droid Race 5 & 175 XP).
 * The remaining 16 species from the design doc follow as pure data entries.
 */
export const CAREERS_SPECIES: readonly CareerSpeciesDef[] = [
  {
    id: 'human',
    name: 'Human',
    description: 'Adaptable and widespread across the galaxy. Balanced characteristics with two extra non-career skills.',
    modelType: 'B',
    race: 6,
    subraceIndex: 0,
    characteristics: { str: 2, dex: 2, con: 2, int: 2, wis: 2, cha: 2 },
    startingXp: 110,
    hpBase: 10,
    strainBase: 10,
    freeCareerSkills: 4,
    freeNonCareerSkills: 2,
    abilitySummary: 'Start with 1 free rank in two non-career skills.',
    modelGroup: 'player',
    defaultAppearanceId: 136,
    defaultPortraitId: 15,
  },
  {
    id: 'miraluka',
    name: 'Miraluka',
    description: 'Near-human Force-sensitives who perceive the world through the Force rather than physical eyes.',
    modelType: 'B',
    race: 6,
    subraceIndex: 0,
    characteristics: { str: 2, dex: 2, con: 1, int: 2, wis: 3, cha: 2 },
    startingXp: 100,
    hpBase: 8,
    strainBase: 11,
    freeCareerSkills: 4,
    freeNonCareerSkills: 0,
    forceSensitive: true,
    abilitySummary: 'Force-sensitive in any career; perceives through Force sight.',
    modelGroup: 'humanoid',
    modelKeywords: ['visas', 'miraluka', 'p_visas'],
    defaultAppearanceId: 166,
    defaultPortraitId: 21,
  },
  {
    id: 'droid',
    name: 'Droid',
    description: 'Custom-built chassis with low baseline specs and a large starting XP pool to specialize freely.',
    modelType: 'F',
    race: 5,
    subraceIndex: 0,
    characteristics: { str: 1, dex: 1, con: 2, int: 1, wis: 1, cha: 1 },
    startingXp: 175,
    hpBase: 10,
    strainBase: 10,
    freeCareerSkills: 6,
    freeNonCareerSkills: 0,
    forceIneligible: true,
    abilitySummary: 'Equips droid plating and upgrades (Race 5); 6 free career skills; never Force-sensitive.',
    modelGroup: 'droid',
    modelKeywords: ['droid', 'hk', 't3', 'protocol', 'war'],
    defaultAppearanceId: 236,
    defaultPortraitId: 0,
  },
];

export const CAREERS_SPECIES_BY_ID: ReadonlyMap<string, CareerSpeciesDef> = new Map(
  CAREERS_SPECIES.map((s) => [s.id, s])
);

/**
 * Vertical slice careers (Soldier + Jedi Guardian).
 * Remaining 8 careers follow once the slice plays well.
 */
export const CAREERS_LIST: readonly CareerDef[] = [
  {
    id: 'soldier',
    name: 'Soldier',
    description: 'Frontline combatant trained across blasters, heavy weapons, melee combat, and field endurance.',
    forceSensitive: false,
    careerSkills: [
      'athletics', 'brawl', 'melee', 'ranged_light',
      'ranged_heavy', 'resilience', 'survival', 'treat_injury',
    ],
    specializations: ['commando'],
    startingKit: {
      rightHand: 'g_w_blstrrfl001',
      leftHand: '',
      armor: 'g_a_class4001',
      items: [{ resRef: 'g_i_medeqpmnt02', stack: 2 }],
    },
  },
  {
    id: 'jedi_guardian',
    name: 'Jedi Guardian',
    description: 'Force-sensitive warrior focused on lightsaber discipline, resilience, and physical mastery.',
    forceSensitive: true,
    careerSkills: [
      'athletics', 'awareness', 'brawl', 'cool',
      'discipline', 'lightsaber', 'melee', 'resilience',
    ],
    specializations: ['peacekeeper'],
    startingKit: {
      rightHand: 'g_w_lghtsbr01',
      leftHand: '',
      armor: 'g_a_jedirobe01',
      items: [{ resRef: 'g_i_medeqpmnt02', stack: 1 }],
    },
  },
];

export const CAREERS_BY_ID: ReadonlyMap<string, CareerDef> = new Map(
  CAREERS_LIST.map((c) => [c.id, c])
);

/** A tree node for a talent: its name and description come from the talent table, so the two never disagree */
function talentNode(
  id: string, row: CareerTreeNodeDef['row'], col: CareerTreeNodeDef['col'], talentId: string, links: string[]
): CareerTreeNodeDef {
  const talent = CAREERS_TALENT_BY_ID.get(talentId);
  if (!talent) throw new Error(`Careers tree node ${id}: unknown talent ${talentId}`);
  return { id, row, col, kind: 'talent', talentId, label: talent.name, description: talent.description, links };
}

/**
 * Vertical slice specialization trees (12 nodes each: 3 columns x 4 rows, costing 5/10/15/20 XP).
 * Mixes custom passive/active talents, KotOR feats, career skill unlocks, Dedication (+1 stat), and rank-6 capstones.
 */
export const CAREERS_SPECIALIZATIONS: readonly CareerSpecializationDef[] = [
  {
    id: 'commando',
    name: 'Commando',
    careerId: 'soldier',
    description: 'Hard-hitting trooper who breaks lines with heavy blows, sustained fire, and rugged toughness.',
    bonusSkills: ['brawl', 'melee', 'resilience', 'survival'],
    nodes: [
      // Row 0 (5 XP) — open entry
      { id: 'r0c0', row: 0, col: 0, kind: 'feat', featId: CombatFeatType.POWER_ATTACK, label: 'Power Attack', description: 'Unleash heavy melee strikes for extra damage (2 Strain).', links: ['r1c0'] },
      talentNode('r0c1', 0, 1, 'toughened', ['r1c1']),
      { id: 'r0c2', row: 0, col: 2, kind: 'feat', featId: CombatFeatType.RAPID_SHOT, label: 'Rapid Shot', description: 'Fire an extra blaster bolt in a single round (2 Strain).', links: ['r1c2'] },
      // Row 1 (10 XP)
      talentNode('r1c0', 1, 0, 'feral_strength', ['r0c0', 'r1c1', 'r2c0']),
      { id: 'r1c1', row: 1, col: 1, kind: 'feat', featId: CombatFeatType.ARMOUR_PROF_HEAVY, label: 'Heavy Armour', description: 'Unlocks wearing heavy battle armour.', links: ['r0c1', 'r1c0', 'r1c2', 'r2c1'] },
      talentNode('r1c2', 1, 2, 'point_blank', ['r0c2', 'r1c1', 'r2c2']),
      // Row 2 (15 XP)
      talentNode('r2c0', 2, 0, 'second_wind', ['r1c0', 'r2c1', 'r3c0']),
      talentNode('r2c1', 2, 1, 'enduring', ['r1c1', 'r2c0', 'r2c2', 'r3c1']),
      { id: 'r2c2', row: 2, col: 2, kind: 'career_skill', skillId: 'awareness', label: 'Tactical Edge', description: 'Awareness becomes a career skill.', links: ['r1c2', 'r2c1', 'r3c2'] },
      // Row 3 (20 XP)
      talentNode('r3c0', 3, 0, 'lethal_blows', ['r2c0', 'r3c1']),
      { id: 'r3c1', row: 3, col: 1, kind: 'characteristic', label: 'Dedication', description: 'Permanently increase one characteristic by +1 (up to 6).', links: ['r2c1', 'r3c0', 'r3c2'] },
      { id: 'r3c2', row: 3, col: 2, kind: 'capstone', skillId: 'ranged_heavy', label: 'Heavy Weapons Mastery', description: 'Unlocks Ranged (Heavy) rank 6 from level 17.', links: ['r2c2', 'r3c1'] },
    ],
  },
  {
    id: 'peacekeeper',
    name: 'Peacekeeper',
    careerId: 'jedi_guardian',
    description: 'Disciplined Jedi sentinel of the blade who balances swift strikes, blaster deflection, and poise.',
    bonusSkills: ['awareness', 'discipline', 'lightsaber', 'resilience'],
    nodes: [
      // Row 0 (5 XP) — open entry
      { id: 'r0c0', row: 0, col: 0, kind: 'feat', featId: CombatFeatType.FLURRY, label: 'Flurry', description: 'Strike with an extra lightsaber or melee attack per round (2 Strain).', links: ['r1c0'] },
      { id: 'r0c1', row: 0, col: 1, kind: 'feat', featId: CombatFeatType.JEDI_DEFENSE, label: 'Jedi Defense', description: 'Deflect incoming blaster bolts with a lightsaber.', links: ['r1c1'] },
      { id: 'r0c2', row: 0, col: 2, kind: 'feat', featId: CombatFeatType.DUELING, label: 'Dueling', description: 'Bonus attack and defence when wielding a single blade.', links: ['r1c2'] },
      // Row 1 (10 XP)
      talentNode('r1c0', 1, 0, 'battle_focus', ['r0c0', 'r1c1', 'r2c0']),
      talentNode('r1c1', 1, 1, 'parry_stance', ['r0c1', 'r1c0', 'r1c2', 'r2c1']),
      talentNode('r1c2', 1, 2, 'sidestep', ['r0c2', 'r1c1', 'r2c2']),
      // Row 2 (15 XP)
      talentNode('r2c0', 2, 0, 'relentless', ['r1c0', 'r2c1', 'r3c0']),
      talentNode('r2c1', 2, 1, 'force_rating', ['r1c1', 'r2c0', 'r2c2', 'r3c1']),
      { id: 'r2c2', row: 2, col: 2, kind: 'career_skill', skillId: 'negotiation', label: 'Diplomat\'s Poise', description: 'Negotiation becomes a career skill.', links: ['r1c2', 'r2c1', 'r3c2'] },
      // Row 3 (20 XP)
      talentNode('r3c0', 3, 0, 'calm_center', ['r2c0', 'r3c1']),
      { id: 'r3c1', row: 3, col: 1, kind: 'characteristic', label: 'Dedication', description: 'Permanently increase one characteristic by +1 (up to 6).', links: ['r2c1', 'r3c0', 'r3c2'] },
      { id: 'r3c2', row: 3, col: 2, kind: 'capstone', skillId: 'lightsaber', label: 'Lightsaber Mastery', description: 'Unlocks Lightsaber rank 6 from level 17.', links: ['r2c2', 'r3c1'] },
    ],
  },
];

export const CAREERS_SPEC_BY_ID: ReadonlyMap<string, CareerSpecializationDef> = new Map(
  CAREERS_SPECIALIZATIONS.map((s) => [s.id, s])
);

/**
 * Vertical slice starter Force powers (root powers from KotOR II spells.2da).
 * Full Force power trees plug in at Phase 5.
 */
export const CAREERS_STARTER_POWERS: readonly CareerStarterPowerDef[] = [
  { spellId: 27, label: 'FORCE_POWER_FORCE_PUSH', name: 'Force Push', alignment: 'universal', xpCost: 10, description: 'Telekinetic blast that knocks an enemy back and off their feet.' },
  { spellId: 8, label: 'FORCE_POWER_SPEED_BURST', name: 'Burst of Speed', alignment: 'universal', xpCost: 10, description: 'Accelerate movement speed and reflexes through the Force.' },
  { spellId: 11, label: 'FORCE_POWER_AFFECT_MIND', name: 'Affect Mind', alignment: 'universal', xpCost: 10, description: 'Nudge weak minds in conversation and tense scenes.' },
  { spellId: 28, label: 'FORCE_POWER_CURE', name: 'Cure', alignment: 'light', xpCost: 10, description: 'Channel the light side to mend wounds for yourself or an ally.' },
  { spellId: 20, label: 'FORCE_POWER_FORCE_VALOR', name: 'Force Valor', alignment: 'light', xpCost: 10, description: 'Bolster attributes and saving throws for nearby allies.' },
  { spellId: 46, label: 'FORCE_POWER_STUN', name: 'Stun', alignment: 'light', xpCost: 10, description: 'Lock a foe in place briefly without dealing lethal harm.' },
  { spellId: 24, label: 'FORCE_POWER_SHOCK', name: 'Shock', alignment: 'dark', xpCost: 15, description: 'Discharge a bolt of dark-side lightning at a target.' },
  { spellId: 34, label: 'FORCE_POWER_WOUND', name: 'Wound', alignment: 'dark', xpCost: 15, description: 'Crush an enemy\'s lungs with telekinetic malice.' },
  { spellId: 18, label: 'FORCE_POWER_FEAR', name: 'Fear', alignment: 'dark', xpCost: 10, description: 'Break an opponent\'s resolve so they cower in terror.' },
];

export const CAREERS_POWER_BY_ID: ReadonlyMap<number, CareerStarterPowerDef> = new Map(
  CAREERS_STARTER_POWERS.map((p) => [p.spellId, p])
);

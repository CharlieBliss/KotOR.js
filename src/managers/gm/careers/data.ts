import { CombatFeatType } from "@/enums/combat/CombatFeatType";
import type {
  CareerDef,
  CareerSpecializationDef,
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
      { id: 'r0c1', row: 0, col: 1, kind: 'talent', talentId: 'toughened', label: 'Toughened', description: '+4 maximum Vitality per rank.', links: ['r1c1'] },
      { id: 'r0c2', row: 0, col: 2, kind: 'feat', featId: CombatFeatType.RAPID_SHOT, label: 'Rapid Shot', description: 'Fire an extra blaster bolt in a single round (2 Strain).', links: ['r1c2'] },
      // Row 1 (10 XP)
      { id: 'r1c0', row: 1, col: 0, kind: 'talent', talentId: 'feral_strength', label: 'Feral Strength', description: '+2 damage with melee and unarmed attacks per rank.', links: ['r0c0', 'r1c1', 'r2c0'] },
      { id: 'r1c1', row: 1, col: 1, kind: 'feat', featId: CombatFeatType.ARMOUR_PROF_HEAVY, label: 'Heavy Armour', description: 'Unlocks wearing heavy battle armour.', links: ['r0c1', 'r1c0', 'r1c2', 'r2c1'] },
      { id: 'r1c2', row: 1, col: 2, kind: 'talent', talentId: 'point_blank', label: 'Point Blank', description: '+2 damage with ranged weapons per rank.', links: ['r0c2', 'r1c1', 'r2c2'] },
      // Row 2 (15 XP)
      { id: 'r2c0', row: 2, col: 0, kind: 'talent', talentId: 'second_wind', label: 'Second Wind', description: 'Active (2 Strain): Rally through pain, restoring 8 Vitality per rank.', links: ['r1c0', 'r2c1', 'r3c0'] },
      { id: 'r2c1', row: 2, col: 1, kind: 'talent', talentId: 'enduring', label: 'Enduring', description: 'Reduce incoming damage from hits by 2 per rank.', links: ['r1c1', 'r2c0', 'r2c2', 'r3c1'] },
      { id: 'r2c2', row: 2, col: 2, kind: 'career_skill', skillId: 'awareness', label: 'Tactical Edge', description: 'Awareness becomes a career skill.', links: ['r1c2', 'r2c1', 'r3c2'] },
      // Row 3 (20 XP)
      { id: 'r3c0', row: 3, col: 0, kind: 'talent', talentId: 'lethal_blows', label: 'Lethal Blows', description: '+1 critical threat range and +4 critical hit damage per rank.', links: ['r2c0', 'r3c1'] },
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
      { id: 'r1c0', row: 1, col: 0, kind: 'talent', talentId: 'battle_focus', label: 'Battle Focus', description: 'Active (2 Strain): +2 attack, +4 damage, and +1 crit threat on your next attack per rank.', links: ['r0c0', 'r1c1', 'r2c0'] },
      { id: 'r1c1', row: 1, col: 1, kind: 'talent', talentId: 'parry_stance', label: 'Parry Stance', description: 'Active (2 Strain): Brace for 1 round, gaining +2 Defence and +3 damage reduction per rank.', links: ['r0c1', 'r1c0', 'r1c2', 'r2c1'] },
      { id: 'r1c2', row: 1, col: 2, kind: 'talent', talentId: 'sidestep', label: 'Sidestep', description: '+1 Defence (+1 additional vs ranged attacks) per rank.', links: ['r0c2', 'r1c1', 'r2c2'] },
      // Row 2 (15 XP)
      { id: 'r2c0', row: 2, col: 0, kind: 'talent', talentId: 'relentless', label: 'Relentless', description: 'On a kill, recover 2 Strain and gain +2 attack on your next strike per rank.', links: ['r1c0', 'r2c1', 'r3c0'] },
      { id: 'r2c1', row: 2, col: 1, kind: 'talent', talentId: 'force_rating', label: 'Force Rating', description: '+6 max Force points, +2 Force power save DC, and -1 Force power cost per rank.', links: ['r1c1', 'r2c0', 'r2c2', 'r3c1'] },
      { id: 'r2c2', row: 2, col: 2, kind: 'career_skill', skillId: 'negotiation', label: 'Diplomat\'s Poise', description: 'Negotiation becomes a career skill.', links: ['r1c2', 'r2c1', 'r3c2'] },
      // Row 3 (20 XP)
      { id: 'r3c0', row: 3, col: 0, kind: 'talent', talentId: 'calm_center', label: 'Calm Center', description: 'Recover 1 extra Strain each round and 4 Vitality when combat ends per rank.', links: ['r2c0', 'r3c1'] },
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

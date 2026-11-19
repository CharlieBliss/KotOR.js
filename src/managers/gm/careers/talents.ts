import type { CareerSkillId } from "@/managers/gm/careers/types";

export type TalentActivation = 'passive' | 'active';
export type TalentAttackScope = 'any' | 'melee' | 'ranged' | 'lightsaber' | 'unarmed';
export type TalentAim = 'self' | 'enemy' | 'ally';

export interface CareerTalentRequirements {
  forceSensitive?: boolean;
  alignment?: 'light' | 'dark';
}

export interface CareerTalentActiveHook {
  /** Immediate HP healed per rank */
  healHp?: number;
  /** Buff duration in seconds */
  durationSeconds?: number;
  /** Temporary Defence bonus per rank */
  defenseBonus?: number;
  /** Temporary flat damage reduction per rank */
  damageReduction?: number;
  /** Temporary attack roll bonus per rank */
  attackBonus?: number;
  /** Temporary damage bonus per rank */
  damageBonus?: number;
  /** Temporary critical threat range bonus per rank */
  critThreatBonus?: number;
  /** When true, attack/damage/crit bonuses apply to the next attack only and are consumed */
  nextAttackOnly?: boolean;
  /** When true (with aim: 'ally'), applies buffs/healing to the targeted ally (or the user) instead of self */
  affectTarget?: boolean;
}

export interface CareerTalentHooks {
  /** Passive stat bonuses (multiplied by rank) */
  maxHp?: number;
  maxStrain?: number;
  maxFp?: number;
  defense?: number;
  saves?: { fortitude?: number; reflex?: number; will?: number };

  /**
   * Flat bonus on skill checks (multiplied by rank; not ranks). Only the seven engine skills are rolled today
   * (KotOR's checks and the GM's skill checks); a narrative skill's bonus waits for narrative checks
   */
  skillBonus?: Partial<Record<CareerSkillId, number>>;

  /** Attack roll modifiers (multiplied by rank) */
  attackBonus?: { amount: number; scope?: TalentAttackScope };
  /** Extra critical threat span (multiplied by rank; e.g. +1 widens 20 -> 19-20) */
  critThreatBonus?: { amount: number; scope?: TalentAttackScope };

  /** Damage modifiers (multiplied by rank) */
  damageBonus?: { amount: number; scope?: TalentAttackScope };
  /** Extra flat damage added on critical hits (multiplied by rank) */
  critDamageBonus?: { amount: number; scope?: TalentAttackScope };

  /** Conditional defence against melee or ranged attacks (multiplied by rank) */
  defenseVs?: { melee?: number; ranged?: number };
  /** Flat damage reduction per incoming hit (multiplied by rank) */
  damageReduction?: number;

  /** Force power casting modifiers (multiplied by rank): save DC up, Force point cost down */
  powerSaveDC?: number;
  powerCostReduction?: number;

  /** Combat lifecycle reactions (multiplied by rank) */
  onCombatEnd?: { healHp?: number; healStrain?: number };
  onRoundStart?: { healStrain?: number; healHp?: number };
  onKill?: { healStrain?: number; healHp?: number; nextAttackBonus?: number };

  /** Active talent behaviour (for activation === 'active') */
  active?: CareerTalentActiveHook;
}

export interface CareerTalentDef {
  id: string;
  name: string;
  description: string;
  /** Existing KotOR feat or Force power icon resref */
  icon: string;
  /** Whether multiple nodes of this talent stack ranks without a per-talent cap */
  ranked: boolean;
  activation: TalentActivation;
  /** Strain spent to activate (active talents only) */
  strainCost?: number;
  /** HUD targeting mode (default 'self') */
  aim?: TalentAim;
  /** HUD category hint for active talents */
  category?: 'feat' | 'buff' | 'heal';
  /** Cooldown in seconds between activations */
  cooldownSeconds?: number;
  requirements?: CareerTalentRequirements;
  hooks: CareerTalentHooks;
}

/**
 * Shared Careers talent registry.
 * Trees reference talents by id; ranks of ranked talents stack across nodes and specializations.
 */
export const CAREERS_TALENTS: readonly CareerTalentDef[] = [
  {
    id: 'toughened',
    name: 'Toughened',
    description: '+4 maximum Vitality per rank.',
    icon: 'ifeat_toughness',
    ranked: true,
    activation: 'passive',
    hooks: { maxHp: 4 },
  },
  {
    id: 'grit',
    name: 'Grit',
    description: '+2 maximum Strain per rank.',
    icon: 'ifeat_condit',
    ranked: true,
    activation: 'passive',
    hooks: { maxStrain: 2 },
  },
  {
    id: 'sidestep',
    name: 'Sidestep',
    description: '+1 Defence (+1 additional Defence against ranged attacks) per rank.',
    icon: 'ifeat_dueling',
    ranked: true,
    activation: 'passive',
    hooks: { defense: 1, defenseVs: { ranged: 1 } },
  },
  {
    id: 'feral_strength',
    name: 'Feral Strength',
    description: '+2 damage with melee and unarmed attacks per rank.',
    icon: 'ifeat_pwratt',
    ranked: true,
    activation: 'passive',
    hooks: { damageBonus: { amount: 2, scope: 'melee' } },
  },
  {
    id: 'point_blank',
    name: 'Point Blank',
    description: '+2 damage with ranged weapons per rank.',
    icon: 'ifeat_rpdshot',
    ranked: true,
    activation: 'passive',
    hooks: { damageBonus: { amount: 2, scope: 'ranged' } },
  },
  {
    id: 'lethal_blows',
    name: 'Lethal Blows',
    description: '+1 critical threat range and +4 critical hit damage per rank.',
    icon: 'ifeat_critstrk',
    ranked: true,
    activation: 'passive',
    hooks: {
      critThreatBonus: { amount: 1, scope: 'any' },
      critDamageBonus: { amount: 4, scope: 'any' },
    },
  },
  {
    id: 'enduring',
    name: 'Enduring',
    description: 'Reduce incoming damage from hits by 2 per rank.',
    icon: 'ifeat_imp_tough',
    ranked: true,
    activation: 'passive',
    hooks: { damageReduction: 2 },
  },
  {
    id: 'resolve',
    name: 'Resolve',
    description: '+1 to all saving throws and +2 to Discipline checks per rank.',
    icon: 'ifeat_mstr_cond',
    ranked: true,
    activation: 'passive',
    hooks: {
      saves: { fortitude: 1, reflex: 1, will: 1 },
      skillBonus: { discipline: 2 },
    },
  },
  {
    id: 'keen_eye',
    name: 'Keen Eye',
    description: '+3 to Awareness and Survival checks per rank.',
    icon: 'ifeat_awarness',
    ranked: true,
    activation: 'passive',
    hooks: {
      skillBonus: { awareness: 3, survival: 3 },
    },
  },
  {
    id: 'force_rating',
    name: 'Force Rating',
    description: '+6 max Force points, +2 Force power save DC, and -1 Force power cost per rank.',
    icon: 'ip_forcefocus',
    ranked: true,
    activation: 'passive',
    requirements: { forceSensitive: true },
    hooks: {
      maxFp: 6,
      powerSaveDC: 2,
      powerCostReduction: 1,
    },
  },
  {
    id: 'relentless',
    name: 'Relentless',
    description: 'On a kill, recover 2 Strain and gain +2 attack on your next strike per rank.',
    icon: 'ifeat_flurry',
    ranked: true,
    activation: 'passive',
    hooks: {
      onKill: { healStrain: 2, nextAttackBonus: 2 },
    },
  },
  {
    id: 'calm_center',
    name: 'Calm Center',
    description: 'Recover 1 extra Strain each combat round and 4 Vitality when combat ends per rank.',
    icon: 'ip_meditate',
    ranked: true,
    activation: 'passive',
    hooks: {
      onRoundStart: { healStrain: 1 },
      onCombatEnd: { healHp: 4 },
    },
  },
  {
    id: 'second_wind',
    name: 'Second Wind',
    description: 'Active (2 Strain): Rally through pain, restoring 8 Vitality per rank.',
    icon: 'ip_heal',
    ranked: true,
    activation: 'active',
    strainCost: 2,
    aim: 'self',
    category: 'heal',
    cooldownSeconds: 9,
    hooks: {
      active: { healHp: 8 },
    },
  },
  {
    id: 'battle_focus',
    name: 'Battle Focus',
    description: 'Active (2 Strain): Line up your next attack for +2 attack, +4 damage, and +1 crit threat per rank.',
    icon: 'ifeat_wpnfoc',
    ranked: true,
    activation: 'active',
    strainCost: 2,
    aim: 'self',
    category: 'feat',
    cooldownSeconds: 3,
    hooks: {
      active: {
        attackBonus: 2,
        damageBonus: 4,
        critThreatBonus: 1,
        nextAttackOnly: true,
        durationSeconds: 9,
      },
    },
  },
  {
    id: 'parry_stance',
    name: 'Parry Stance',
    description: 'Active (2 Strain): Brace your guard for 1 round, gaining +2 Defence and +3 damage reduction per rank.',
    icon: 'ifeat_jedidef',
    ranked: true,
    activation: 'active',
    strainCost: 2,
    aim: 'self',
    category: 'buff',
    cooldownSeconds: 3,
    hooks: {
      active: {
        defenseBonus: 2,
        damageReduction: 3,
        durationSeconds: 3,
      },
    },
  },
  {
    id: 'inspiring_command',
    name: 'Inspiring Command',
    description: 'Active (2 Strain): Bolster an ally (or yourself) for 2 rounds with +2 attack and +2 Defence per rank.',
    icon: 'ip_valor',
    ranked: true,
    activation: 'active',
    strainCost: 2,
    aim: 'ally',
    category: 'buff',
    cooldownSeconds: 6,
    hooks: {
      active: {
        attackBonus: 2,
        defenseBonus: 2,
        durationSeconds: 6,
        affectTarget: true,
      },
    },
  },
];

export const CAREERS_TALENT_BY_ID: ReadonlyMap<string, CareerTalentDef> = new Map(
  CAREERS_TALENTS.map((t) => [t.id, t])
);

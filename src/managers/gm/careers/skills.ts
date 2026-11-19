import { SkillType } from "@/enums/nwscript/SkillType";
import type { CareerAbilityKey, CareerSkillDef, CareerSkillId, CombatSkillId } from "@/managers/gm/careers/types";

export const CAREER_ABILITIES: readonly CareerAbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const CAREER_ABILITY_LABELS: Record<CareerAbilityKey, { kotor: string; ffg: string; short: string }> = {
  str: { kotor: 'Strength', ffg: 'Brawn', short: 'STR' },
  dex: { kotor: 'Dexterity', ffg: 'Agility', short: 'DEX' },
  con: { kotor: 'Constitution', ffg: 'Constitution', short: 'CON' },
  int: { kotor: 'Intelligence', ffg: 'Intellect', short: 'INT' },
  wis: { kotor: 'Wisdom', ffg: 'Willpower', short: 'WIS' },
  cha: { kotor: 'Charisma', ffg: 'Presence', short: 'CHA' },
};

export const COMBAT_SKILL_IDS: readonly CombatSkillId[] = [
  'brawl', 'melee', 'lightsaber', 'ranged_light', 'ranged_heavy', 'gunnery',
];

/** Complete catalog of skills on a careers sheet: 6 combat, 7 direct engine, 22 narrative */
export const CAREER_SKILLS: readonly CareerSkillDef[] = [
  // Combat skills (each rank adds +2 to attack; level-capped)
  { id: 'brawl', name: 'Brawl', category: 'combat', ability: 'str', levelCapped: true },
  { id: 'melee', name: 'Melee', category: 'combat', ability: 'str', levelCapped: true },
  { id: 'lightsaber', name: 'Lightsaber', category: 'combat', ability: 'str', levelCapped: true },
  { id: 'ranged_light', name: 'Ranged (Light)', category: 'combat', ability: 'dex', levelCapped: true },
  { id: 'ranged_heavy', name: 'Ranged (Heavy)', category: 'combat', ability: 'dex', levelCapped: true },
  { id: 'gunnery', name: 'Gunnery', category: 'combat', ability: 'dex', levelCapped: true },

  // Engine skills (converted at rank * 4 into KotOR's skills.2da; Persuade derives from Charm/Negotiation/Deception)
  { id: 'computer_use', name: 'Computer Use', category: 'engine', ability: 'int', engineSkill: SkillType.COMPUTER_USE },
  { id: 'demolitions', name: 'Demolitions', category: 'engine', ability: 'int', engineSkill: SkillType.DEMOLITIONS },
  { id: 'stealth', name: 'Stealth', category: 'engine', ability: 'dex', engineSkill: SkillType.STEALTH },
  { id: 'awareness', name: 'Awareness', category: 'engine', ability: 'wis', engineSkill: SkillType.AWARENESS },
  { id: 'repair', name: 'Repair', category: 'engine', ability: 'int', engineSkill: SkillType.REPAIR },
  { id: 'security', name: 'Security', category: 'engine', ability: 'dex', engineSkill: SkillType.SECURITY },
  { id: 'treat_injury', name: 'Treat Injury', category: 'engine', ability: 'wis', engineSkill: SkillType.TREAT_INJURY },

  // Narrative — General (Resilience, Coordination and Discipline also drive saves and follow the level cap)
  { id: 'astrogation', name: 'Astrogation', category: 'general', ability: 'int' },
  { id: 'athletics', name: 'Athletics', category: 'general', ability: 'str' },
  { id: 'cool', name: 'Cool', category: 'general', ability: 'cha' },
  { id: 'coordination', name: 'Coordination', category: 'general', ability: 'dex', save: 'reflex', levelCapped: true },
  { id: 'discipline', name: 'Discipline', category: 'general', ability: 'wis', save: 'will', levelCapped: true },
  { id: 'piloting_planetary', name: 'Piloting (Planetary)', category: 'general', ability: 'dex' },
  { id: 'piloting_space', name: 'Piloting (Space)', category: 'general', ability: 'dex' },
  { id: 'resilience', name: 'Resilience', category: 'general', ability: 'con', save: 'fortitude', levelCapped: true },
  { id: 'streetwise', name: 'Streetwise', category: 'general', ability: 'wis' },
  { id: 'survival', name: 'Survival', category: 'general', ability: 'wis' },

  // Narrative — Social (best of Charm, Negotiation, Deception drives KotOR's Persuade)
  { id: 'charm', name: 'Charm', category: 'social', ability: 'cha' },
  { id: 'coercion', name: 'Coercion', category: 'social', ability: 'cha' },
  { id: 'deception', name: 'Deception', category: 'social', ability: 'cha' },
  { id: 'leadership', name: 'Leadership', category: 'social', ability: 'cha' },
  { id: 'negotiation', name: 'Negotiation', category: 'social', ability: 'cha' },

  // Narrative — Knowledge
  { id: 'knowledge_core_worlds', name: 'Knowledge (Core Worlds)', category: 'knowledge', ability: 'int' },
  { id: 'knowledge_education', name: 'Knowledge (Education)', category: 'knowledge', ability: 'int' },
  { id: 'knowledge_lore', name: 'Knowledge (Lore)', category: 'knowledge', ability: 'int' },
  { id: 'knowledge_outer_rim', name: 'Knowledge (Outer Rim)', category: 'knowledge', ability: 'int' },
  { id: 'knowledge_underworld', name: 'Knowledge (Underworld)', category: 'knowledge', ability: 'int' },
  { id: 'knowledge_warfare', name: 'Knowledge (Warfare)', category: 'knowledge', ability: 'int' },
  { id: 'knowledge_xenology', name: 'Knowledge (Xenology)', category: 'knowledge', ability: 'int' },
];

export const CAREER_SKILL_BY_ID: ReadonlyMap<CareerSkillId, CareerSkillDef> = new Map(
  CAREER_SKILLS.map((s) => [s.id, s])
);

/** Scale factor converting a 0–5 careers skill rank into a KotOR engine skill rank (rank 5 -> 20) */
export const ENGINE_SKILL_MULTIPLIER = 4;

/** Convert effective careers skill ranks into KotOR's 8-element skills.2da array */
export function toEngineSkillRanks(ranks: Partial<Record<CareerSkillId, number>>): number[] {
  const out = new Array<number>(SkillType.MAX_SKILLS).fill(0);
  for (const def of CAREER_SKILLS) {
    if (def.engineSkill !== undefined) {
      out[def.engineSkill] = Math.max(0, Math.floor(ranks[def.id] || 0)) * ENGINE_SKILL_MULTIPLIER;
    }
  }
  const persuadeRank = Math.max(ranks.charm || 0, ranks.negotiation || 0, ranks.deception || 0);
  out[SkillType.PERSUADE] = Math.max(0, Math.floor(persuadeRank)) * ENGINE_SKILL_MULTIPLIER;
  return out;
}

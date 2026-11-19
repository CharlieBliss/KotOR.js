import {
  BASELINE_CAREER_FEATS,
  CAREERS_BY_ID,
  CAREERS_FORCE_BASE,
  CAREERS_POWER_BY_ID,
  CAREERS_SPEC_BY_ID,
  CAREERS_SPECIES_BY_ID,
  CAREERS_XP_PER_LEVEL,
} from "@/managers/gm/careers/data";
import {
  CAREER_ABILITIES,
  CAREER_SKILL_BY_ID,
  CAREER_SKILLS,
  COMBAT_SKILL_IDS,
  toEngineSkillRanks,
} from "@/managers/gm/careers/skills";
import type {
  CareerAbilityKey,
  CareerAttributes,
  CareerSkillId,
  CareerTreeNodeDef,
  CombatSkillId,
  GMCareersCharacter,
  GMCareersDerived,
} from "@/managers/gm/careers/types";

const ROW_COSTS = [5, 10, 15, 20] as const;

/**
 * Pure rules engine for the Careers rule set: XP costs, level derivation, skill rank caps,
 * specialization tree links, Force sensitivity / alignment restrictions, derived stats, and validation.
 */
export class CareersRules {

  /** Convert an FFG-scale characteristic (1–6) to a KotOR ability score (8–18) */
  static ffgToKotor(value: number): number {
    return 6 + 2 * value;
  }

  /** KotOR ability modifier for a KotOR score (equals FFG value - 2) */
  static abilityMod(kotorScore: number): number {
    return Math.floor((kotorScore - 10) / 2);
  }

  /** Character level worked out from post-creation campaign XP spent (never starting XP) */
  static levelFromXp(campaignXpSpent: number, xpPerLevel: number = CAREERS_XP_PER_LEVEL): number {
    const step = Math.max(1, Math.floor(xpPerLevel || CAREERS_XP_PER_LEVEL));
    const spent = Math.max(0, Math.floor(campaignXpSpent || 0));
    return Math.min(20, 1 + Math.floor(spent / step));
  }

  /** Calibration baseline added to attack and defence: (level - 1) / 3 rounded down, up to +6 */
  static levelBaseline(level: number): number {
    return Math.floor((Math.max(1, Math.min(20, Math.floor(level || 1))) - 1) / 3);
  }

  /** Highest rank a skill can reach at this level (2 at creation for all skills) */
  static maxSkillRank(skillId: CareerSkillId, level: number, atCreation: boolean = false, hasCapstone: boolean = false): number {
    if (atCreation) return 2;
    const def = CAREER_SKILL_BY_ID.get(skillId);
    if (!def?.levelCapped) return 5;
    const lvl = Math.max(1, Math.min(20, Math.floor(level || 1)));
    const cap = Math.min(5, 2 + Math.floor((lvl - 1) / 4));
    if (hasCapstone && lvl >= 17 && def.category === 'combat') return 6;
    return cap;
  }

  /** XP cost to raise a characteristic from (newValue - 1) to newValue at creation */
  static characteristicCost(newValue: number): number {
    return 10 * newValue;
  }

  /** XP cost to buy a single skill rank (from newRank - 1 to newRank) */
  static skillRankCost(newRank: number, isCareer: boolean): number {
    return 5 * newRank + (isCareer ? 0 : 5);
  }

  /** XP cost of a specialization tree node by row (0..3 -> 5/10/15/20) */
  static nodeCost(row: 0 | 1 | 2 | 3): number {
    return ROW_COSTS[row] ?? 20;
  }

  /** XP cost of buying an additional specialization (ownedCountAfter includes the new one) */
  static specializationCost(ownedCountAfter: number, inCareer: boolean): number {
    return 10 * ownedCountAfter + (inCareer ? 0 : 10);
  }

  /** Whether a character is Force-sensitive (Jedi careers or Miraluka; never Droids) */
  static isForceSensitive(c: Pick<GMCareersCharacter, 'speciesId' | 'careerId'>): boolean {
    const species = CAREERS_SPECIES_BY_ID.get(c.speciesId);
    const career = CAREERS_BY_ID.get(c.careerId);
    if (!species || !career) return false;
    if (species.forceIneligible) return false;
    return !!(species.forceSensitive || career.forceSensitive);
  }

  /** All career skills granted by the character's career and owned specializations */
  static careerSkillsOf(c: Pick<GMCareersCharacter, 'careerId' | 'specializations' | 'startingSpecId'>): Set<CareerSkillId> {
    const set = new Set<CareerSkillId>();
    const career = CAREERS_BY_ID.get(c.careerId);
    if (career) for (const s of career.careerSkills) set.add(s);
    const specs = c.specializations?.length ? c.specializations : (c.startingSpecId ? [c.startingSpecId] : []);
    for (const specId of specs) {
      const spec = CAREERS_SPEC_BY_ID.get(specId);
      if (spec) for (const s of spec.bonusSkills) set.add(s);
    }
    return set;
  }

  /** Free creation rank count for each skill (from career, starting spec, and species picks) */
  static freeRanksOf(c: Pick<GMCareersCharacter, 'freeCareerSkills' | 'freeSpecSkills' | 'freeSpeciesSkills'>): Partial<Record<CareerSkillId, number>> {
    const free: Partial<Record<CareerSkillId, number>> = {};
    const add = (list: CareerSkillId[] | undefined) => {
      if (!Array.isArray(list)) return;
      for (const s of list) free[s] = (free[s] || 0) + 1;
    };
    add(c.freeCareerSkills);
    add(c.freeSpecSkills);
    add(c.freeSpeciesSkills);
    return free;
  }

  /** Effective total skill ranks (free + bought) for every skill in the catalog */
  static effectiveSkillRanks(c: GMCareersCharacter): Record<CareerSkillId, number> {
    const free = this.freeRanksOf(c);
    const out = {} as Record<CareerSkillId, number>;
    for (const def of CAREER_SKILLS) {
      const f = free[def.id] || 0;
      const b = Math.max(0, Math.floor(c.boughtSkillRanks?.[def.id] || 0));
      out[def.id] = f + b;
    }
    return out;
  }

  /** Total XP cost of all characteristic raises, bought skills, extra specs, tree nodes, and powers */
  static totalPurchaseCost(c: GMCareersCharacter): number {
    const species = CAREERS_SPECIES_BY_ID.get(c.speciesId);
    const career = CAREERS_BY_ID.get(c.careerId);
    let total = 0;

    // 1. Characteristic raises above species base
    if (species) {
      for (const k of CAREER_ABILITIES) {
        const base = species.characteristics[k];
        const cur = c.characteristics?.[k] ?? base;
        for (let v = base + 1; v <= cur; v++) total += this.characteristicCost(v);
      }
    }

    // 2. Bought skill ranks (stacked on top of free ranks)
    const careerSkills = this.careerSkillsOf(c);
    const free = this.freeRanksOf(c);
    for (const def of CAREER_SKILLS) {
      const f = free[def.id] || 0;
      const b = Math.max(0, Math.floor(c.boughtSkillRanks?.[def.id] || 0));
      const isCareer = careerSkills.has(def.id);
      for (let r = f + 1; r <= f + b; r++) total += this.skillRankCost(r, isCareer);
    }

    // 3. Additional specializations beyond the free starting specialization
    const specs = Array.isArray(c.specializations) ? c.specializations : [];
    let ownedCount = 1;
    for (const specId of specs) {
      if (specId === c.startingSpecId) continue;
      ownedCount++;
      const spec = CAREERS_SPEC_BY_ID.get(specId);
      const inCareer = !!spec && !!career && spec.careerId === career.id;
      total += this.specializationCost(ownedCount, inCareer);
    }

    // 4. Specialization tree nodes
    if (c.nodes) {
      for (const [specId, nodeIds] of Object.entries(c.nodes)) {
        const spec = CAREERS_SPEC_BY_ID.get(specId);
        if (!spec || !Array.isArray(nodeIds)) continue;
        const byId = new Map(spec.nodes.map((n) => [n.id, n]));
        for (const nodeId of nodeIds) {
          const node = byId.get(nodeId);
          if (node) total += this.nodeCost(node.row);
        }
      }
    }

    // 5. Force powers
    if (Array.isArray(c.powers)) {
      for (const spellId of c.powers) {
        const power = CAREERS_POWER_BY_ID.get(spellId);
        total += power ? power.xpCost : 10;
      }
    }

    return total;
  }

  /** Whether every owned node in a specialization tree is reachable from row 0 via owned links */
  static treeLinksValid(specId: string, ownedNodeIds: string[]): boolean {
    const spec = CAREERS_SPEC_BY_ID.get(specId);
    if (!spec) return ownedNodeIds.length === 0;
    const owned = new Set(ownedNodeIds);
    if (owned.size === 0) return true;
    const byId = new Map(spec.nodes.map((n) => [n.id, n]));
    for (const id of owned) if (!byId.has(id)) return false;

    const visited = new Set<string>();
    const queue: string[] = [];
    for (const id of owned) {
      const node = byId.get(id)!;
      if (node.row === 0) {
        visited.add(id);
        queue.push(id);
      }
    }
    while (queue.length > 0) {
      const cur = byId.get(queue.shift()!)!;
      for (const neighbor of cur.links) {
        if (owned.has(neighbor) && !visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return visited.size === owned.size;
  }

  /** Check whether a node in a specialization tree can be bought right now */
  static canBuyNode(c: GMCareersCharacter, specId: string, nodeId: string): { ok: boolean; cost: number; reason?: string } {
    const spec = CAREERS_SPEC_BY_ID.get(specId);
    if (!spec) return { ok: false, cost: 0, reason: 'Unknown specialization.' };
    if (!c.specializations.includes(specId)) return { ok: false, cost: 0, reason: `You don't own ${spec.name}.` };
    const node: CareerTreeNodeDef | undefined = spec.nodes.find((n) => n.id === nodeId);
    if (!node) return { ok: false, cost: 0, reason: 'Unknown node.' };
    const cost = this.nodeCost(node.row);
    const owned = new Set(c.nodes?.[specId] || []);
    if (owned.has(nodeId)) return { ok: false, cost, reason: 'Already owned.' };
    if (node.row > 0 && !node.links.some((link) => owned.has(link))) {
      return { ok: false, cost, reason: 'Needs a link to an owned node.' };
    }
    const derived = this.derive(c);
    if (derived.totalXpRemaining < cost) return { ok: false, cost, reason: `Needs ${cost} XP (${derived.totalXpRemaining} left).` };
    return { ok: true, cost };
  }

  /** Check whether a node can be refunded without breaking links to other owned nodes */
  static canRemoveNode(c: GMCareersCharacter, specId: string, nodeId: string): boolean {
    const owned = c.nodes?.[specId] || [];
    if (!owned.includes(nodeId)) return false;
    return this.treeLinksValid(specId, owned.filter((id) => id !== nodeId));
  }

  /** Check whether a characteristic can be raised by +1 at creation */
  static canRaiseCharacteristic(c: GMCareersCharacter, ability: CareerAbilityKey): { ok: boolean; cost: number; nextValue: number; reason?: string } {
    const current = c.characteristics[ability] ?? 2;
    const nextValue = current + 1;
    const cost = this.characteristicCost(nextValue);
    if (nextValue > 5) return { ok: false, cost, nextValue, reason: 'Characteristics cap at 5 during creation.' };
    const derived = this.derive(c);
    if (derived.startingXpRemaining < cost) return { ok: false, cost, nextValue, reason: `Needs ${cost} starting XP (${derived.startingXpRemaining} left).` };
    return { ok: true, cost, nextValue };
  }

  /** Check whether a skill rank can be bought right now */
  static canBuySkillRank(c: GMCareersCharacter, skillId: CareerSkillId, atCreation: boolean = true): { ok: boolean; cost: number; nextRank: number; reason?: string } {
    const derived = this.derive(c);
    const current = derived.skillRanks[skillId] || 0;
    const nextRank = current + 1;
    const cap = this.maxSkillRank(skillId, derived.level, atCreation);
    const cost = this.skillRankCost(nextRank, derived.careerSkills.has(skillId));
    if (nextRank > cap) return { ok: false, cost, nextRank, reason: atCreation ? 'Rank 2 is the maximum at creation.' : `Capped at rank ${cap} for level ${derived.level}.` };
    if (derived.totalXpRemaining < cost) return { ok: false, cost, nextRank, reason: `Needs ${cost} XP (${derived.totalXpRemaining} left).` };
    return { ok: true, cost, nextRank };
  }

  /** Check whether a Force power can be learned right now */
  static canBuyPower(c: GMCareersCharacter, spellId: number): { ok: boolean; cost: number; reason?: string } {
    const power = CAREERS_POWER_BY_ID.get(spellId);
    if (!power) return { ok: false, cost: 0, reason: 'Unknown Force power.' };
    if (!this.isForceSensitive(c)) return { ok: false, cost: power.xpCost, reason: 'Only Force-sensitive characters can learn Force powers.' };
    if (power.alignment !== 'universal' && power.alignment !== c.alignment) {
      return { ok: false, cost: power.xpCost, reason: `Only ${power.alignment}-side characters can learn ${power.name}.` };
    }
    if (c.powers.includes(spellId)) return { ok: false, cost: power.xpCost, reason: 'Already known.' };
    const derived = this.derive(c);
    if (derived.totalXpRemaining < power.xpCost) return { ok: false, cost: power.xpCost, reason: `Needs ${power.xpCost} XP (${derived.totalXpRemaining} left).` };
    return { ok: true, cost: power.xpCost };
  }

  /** Compute all derived stats, engine numbers, and XP balances for a careers character */
  static derive(c: GMCareersCharacter, xpPerLevel: number = CAREERS_XP_PER_LEVEL): GMCareersDerived {
    const species = CAREERS_SPECIES_BY_ID.get(c.speciesId) || CAREERS_SPECIES_BY_ID.get('human')!;
    const level = this.levelFromXp(c.campaignXpSpent || 0, xpPerLevel);
    const levelBaseline = this.levelBaseline(level);
    const forceSensitive = this.isForceSensitive(c);

    const kotorAttributes = {} as CareerAttributes;
    const modifiers = {} as CareerAttributes;
    for (const k of CAREER_ABILITIES) {
      const ffg = c.characteristics?.[k] ?? species.characteristics[k];
      kotorAttributes[k] = this.ffgToKotor(ffg);
      modifiers[k] = this.abilityMod(kotorAttributes[k]);
    }

    const skillRanks = this.effectiveSkillRanks(c);
    const careerSkills = this.careerSkillsOf(c);
    const engineSkills = toEngineSkillRanks(skillRanks);

    const saveRanks = {
      fortitude: (skillRanks.resilience || 0) * 2,
      reflex: (skillRanks.coordination || 0) * 2,
      will: (skillRanks.discipline || 0) * 2,
    };
    const saves = {
      fortitude: saveRanks.fortitude + modifiers.con,
      reflex: saveRanks.reflex + modifiers.dex,
      will: saveRanks.will + modifiers.wis,
    };

    const combatAttack = {} as Record<CombatSkillId, number>;
    for (const id of COMBAT_SKILL_IDS) {
      const def = CAREER_SKILL_BY_ID.get(id)!;
      combatAttack[id] = (skillRanks[id] || 0) * 2 + modifiers[def.ability] + levelBaseline;
    }

    const baseDefense = 10 + modifiers.dex + levelBaseline;

    // Effective KotOR feat IDs: baseline proficiencies + bought feat nodes
    const featSet = new Set<number>(BASELINE_CAREER_FEATS);
    if (c.nodes) {
      for (const [specId, nodeIds] of Object.entries(c.nodes)) {
        const spec = CAREERS_SPEC_BY_ID.get(specId);
        if (!spec || !Array.isArray(nodeIds)) continue;
        const byId = new Map(spec.nodes.map((n) => [n.id, n]));
        for (const nodeId of nodeIds) {
          const node = byId.get(nodeId);
          if (node?.kind === 'feat' && typeof node.featId === 'number') featSet.add(node.featId);
        }
      }
    }

    const maxHp = Math.max(1, species.hpBase + level * (6 + modifiers.con));
    const maxStrain = Math.max(1, species.strainBase + modifiers.wis);
    const maxFp = forceSensitive ? Math.max(0, CAREERS_FORCE_BASE + level * (4 + modifiers.wis)) : 0;

    const totalPurchaseCost = this.totalPurchaseCost(c);
    const startingXpBudget = species.startingXp;
    const campaignXpSpent = Math.max(0, Math.floor(c.campaignXpSpent || 0));
    const campaignXpEarned = Math.max(0, Math.floor(c.campaignXpEarned || 0));
    const startingXpUsed = Math.max(0, totalPurchaseCost - campaignXpSpent);
    const startingXpRemaining = startingXpBudget - startingXpUsed;
    const campaignXpRemaining = campaignXpEarned - campaignXpSpent;
    const totalXpRemaining = startingXpRemaining + campaignXpRemaining;

    return {
      level,
      levelBaseline,
      forceSensitive,
      kotorAttributes,
      modifiers,
      maxHp,
      maxStrain,
      maxFp,
      saveRanks,
      saves,
      baseDefense,
      combatAttack,
      skillRanks,
      engineSkills,
      careerSkills,
      featIds: [...featSet].sort((a, b) => a - b),
      spellIds: forceSensitive ? [...(c.powers || [])] : [],
      startingXpBudget,
      startingXpUsed,
      startingXpRemaining,
      campaignXpRemaining,
      totalXpRemaining,
      totalPurchaseCost,
    };
  }

  /** Validate a careers character against the rules; returns an empty list when valid */
  static validate(c: GMCareersCharacter, atCreation: boolean = c.campaignXpSpent === 0): string[] {
    const problems: string[] = [];
    if (!c || typeof c !== 'object' || c.ruleset !== 'careers') {
      return ['Not a valid Careers character.'];
    }
    if (!String(c.name || '').trim()) problems.push('Give your character a name.');

    const species = CAREERS_SPECIES_BY_ID.get(c.speciesId);
    if (!species) problems.push(`Unknown species: ${c.speciesId}.`);

    const career = CAREERS_BY_ID.get(c.careerId);
    if (!career) problems.push(`Unknown career: ${c.careerId}.`);

    const startingSpec = CAREERS_SPEC_BY_ID.get(c.startingSpecId);
    if (!startingSpec) {
      problems.push(`Unknown starting specialization: ${c.startingSpecId}.`);
    } else if (career && startingSpec.careerId !== career.id) {
      problems.push(`${startingSpec.name} is not a starting specialization for ${career.name}.`);
    }

    if (species) {
      for (const k of CAREER_ABILITIES) {
        const base = species.characteristics[k];
        const val = c.characteristics?.[k];
        if (!Number.isInteger(val) || val < base || val > (atCreation ? 5 : 6)) {
          problems.push(`Characteristic ${k.toUpperCase()} must be between ${base} and ${atCreation ? 5 : 6}.`);
        }
      }
    }

    // Free creation skills validation
    if (species && career) {
      const freeCareer = c.freeCareerSkills || [];
      if (freeCareer.length > species.freeCareerSkills) {
        problems.push(`Choose at most ${species.freeCareerSkills} free career skills.`);
      }
      if (new Set(freeCareer).size !== freeCareer.length) {
        problems.push('Free career skills must be distinct.');
      }
      for (const s of freeCareer) {
        if (!career.careerSkills.includes(s)) problems.push(`${s} is not a ${career.name} career skill.`);
      }
    }

    if (startingSpec) {
      const freeSpec = c.freeSpecSkills || [];
      if (freeSpec.length > 2) problems.push('Choose at most 2 free specialization skills.');
      if (new Set(freeSpec).size !== freeSpec.length) problems.push('Free specialization skills must be distinct.');
      for (const s of freeSpec) {
        if (!startingSpec.bonusSkills.includes(s)) problems.push(`${s} is not a ${startingSpec.name} specialization skill.`);
      }
    }

    if (species) {
      const freeSpecies = c.freeSpeciesSkills || [];
      if (freeSpecies.length > species.freeNonCareerSkills) {
        problems.push(`${species.name} gets at most ${species.freeNonCareerSkills} free non-career skills.`);
      }
      if (new Set(freeSpecies).size !== freeSpecies.length) {
        problems.push('Free species skills must be distinct.');
      }
      const careerSkills = this.careerSkillsOf(c);
      for (const s of freeSpecies) {
        if (careerSkills.has(s)) problems.push(`Free species skill ${s} must be a non-career skill.`);
      }
    }

    const derived = this.derive(c);

    // Skill rank caps
    for (const def of CAREER_SKILLS) {
      const rank = derived.skillRanks[def.id] || 0;
      const cap = this.maxSkillRank(def.id, derived.level, atCreation);
      if (rank > cap) {
        problems.push(`${def.name} rank ${rank} exceeds the maximum of ${cap}${atCreation ? ' at creation' : ` at level ${derived.level}`}.`);
      }
    }

    // Tree links
    if (c.nodes) {
      for (const [specId, nodeIds] of Object.entries(c.nodes)) {
        if (!Array.isArray(nodeIds) || nodeIds.length === 0) continue;
        if (!c.specializations.includes(specId)) {
          problems.push(`Owns nodes in unowned specialization ${specId}.`);
          continue;
        }
        if (!this.treeLinksValid(specId, nodeIds)) {
          const specName = CAREERS_SPEC_BY_ID.get(specId)?.name || specId;
          problems.push(`${specName} tree has nodes not linked from the top row.`);
        }
      }
    }

    // Force powers
    if (Array.isArray(c.powers) && c.powers.length > 0) {
      if (!derived.forceSensitive) {
        problems.push('Non-Force-sensitive characters cannot learn Force powers.');
      } else {
        for (const spellId of c.powers) {
          const power = CAREERS_POWER_BY_ID.get(spellId);
          if (!power) problems.push(`Unknown Force power (${spellId}).`);
          else if (power.alignment !== 'universal' && power.alignment !== c.alignment) {
            problems.push(`${power.name} requires ${power.alignment}-side alignment.`);
          }
        }
      }
    }

    // XP budget
    if (derived.startingXpRemaining < 0) {
      problems.push(`Overspent starting XP by ${-derived.startingXpRemaining}.`);
    }
    if (derived.campaignXpRemaining < 0) {
      problems.push(`Overspent campaign XP by ${-derived.campaignXpRemaining}.`);
    }

    return problems;
  }
}

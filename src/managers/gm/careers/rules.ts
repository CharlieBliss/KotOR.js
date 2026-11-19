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
import { CAREERS_TALENT_BY_ID } from "@/managers/gm/careers/talents";
import { totalTalentHooks } from "@/managers/gm/careers/talentEffects";
import { CAREERS_POWER_TREE_BY_ID, CAREERS_POWER_TREES, ownedPowerNodes, totalPowerTrees } from "@/managers/gm/careers/powerTrees";
import type {
  CareerAbilityKey,
  CareerAttributes,
  CareerPowerTreeDef,
  CareerSkillId,
  CareerTreeNodeDef,
  CombatSkillId,
  GMCareersCharacter,
  GMCareersDerived,
} from "@/managers/gm/careers/types";

const ROW_COSTS = [5, 10, 15, 20] as const;

/** The most ranks a sheet can hold in one skill (rank 6 needs a capstone) */
export const MAX_SKILL_RANK = 6;

/** A bought-rank count from a sheet, made safe: a whole number from 0 to MAX_SKILL_RANK (anything else counts as 0) */
export function safeRanks(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_SKILL_RANK, Math.floor(n)));
}

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
    if (hasCapstone && lvl >= 17) return MAX_SKILL_RANK;
    return cap;
  }

  /** Key in `character.nodeChoices` for a specialization tree node */
  static nodeChoiceKey(specId: string, nodeId: string): string {
    return `${specId}:${nodeId}`;
  }

  /** Owned (specId, node) entries across all owned specializations */
  static ownedNodes(c: Pick<GMCareersCharacter, 'nodes' | 'specializations' | 'startingSpecId'>): { specId: string; node: CareerTreeNodeDef }[] {
    const ownedSpecs = new Set(c.specializations?.length ? c.specializations : (c.startingSpecId ? [c.startingSpecId] : []));
    const out: { specId: string; node: CareerTreeNodeDef }[] = [];
    for (const [specId, nodeIds] of Object.entries(c.nodes || {})) {
      if (!Array.isArray(nodeIds) || (ownedSpecs.size > 0 && !ownedSpecs.has(specId))) continue;
      const spec = CAREERS_SPEC_BY_ID.get(specId);
      if (!spec) continue;
      const byId = new Map(spec.nodes.map((n) => [n.id, n]));
      for (const nodeId of nodeIds) {
        const node = byId.get(nodeId);
        if (node) out.push({ specId, node });
      }
    }
    return out;
  }

  /** Stacked custom talent ranks across all owned specializations (no per-talent cap for ranked talents) */
  static ownedTalentRanks(c: Pick<GMCareersCharacter, 'nodes' | 'specializations' | 'startingSpecId'>): Record<string, number> {
    const ranks: Record<string, number> = {};
    for (const { node } of this.ownedNodes(c)) {
      if (node.kind === 'talent' && node.talentId) {
        ranks[node.talentId] = (ranks[node.talentId] || 0) + 1;
      }
    }
    return ranks;
  }

  /** Effective FFG characteristics: creation characteristics + owned Dedication ('characteristic') nodes */
  static effectiveCharacteristics(c: Pick<GMCareersCharacter, 'speciesId' | 'characteristics' | 'nodes' | 'nodeChoices' | 'specializations' | 'startingSpecId'>): CareerAttributes {
    const species = CAREERS_SPECIES_BY_ID.get(c.speciesId) || CAREERS_SPECIES_BY_ID.get('human')!;
    const out = {} as CareerAttributes;
    for (const k of CAREER_ABILITIES) {
      out[k] = c.characteristics?.[k] ?? species.characteristics[k];
    }
    for (const { specId, node } of this.ownedNodes(c)) {
      if (node.kind !== 'characteristic') continue;
      const chosen = c.nodeChoices?.[this.nodeChoiceKey(specId, node.id)];
      if (chosen && CAREER_ABILITIES.includes(chosen)) {
        out[chosen] = (out[chosen] || 0) + 1;
      }
    }
    return out;
  }

  /** Whether the character owns a capstone node for this skill (which opens rank 6 from level 17) */
  static hasCapstone(c: Pick<GMCareersCharacter, 'nodes' | 'specializations' | 'startingSpecId'>, skillId: CareerSkillId): boolean {
    return this.ownedNodes(c).some(({ node }) => node.kind === 'capstone' && node.skillId === skillId);
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

  /** Whether a species may take a career (a species that can never use the Force can't take a Force career) */
  static careerAllowed(speciesId: string, careerId: string): boolean {
    const species = CAREERS_SPECIES_BY_ID.get(speciesId);
    const career = CAREERS_BY_ID.get(careerId);
    if (!species || !career) return false;
    return !(species.forceIneligible && career.forceSensitive);
  }

  /** The career's starting gear for this species: droids (Race 5) swap the armour suit for droid armour, or nothing */
  static kitFor(careerId: string, speciesId: string): { rightHand: string; leftHand: string; armor: string } {
    const kit = CAREERS_BY_ID.get(careerId)?.startingKit || {};
    const droid = CAREERS_SPECIES_BY_ID.get(speciesId)?.race === 5;
    return {
      rightHand: kit.rightHand || '',
      leftHand: kit.leftHand || '',
      armor: (droid ? kit.droidArmor : kit.armor) || '',
    };
  }

  /** Career skills granted at creation (career + starting specialization) */
  static creationCareerSkillsOf(c: Pick<GMCareersCharacter, 'careerId' | 'startingSpecId'>): Set<CareerSkillId> {
    const set = new Set<CareerSkillId>();
    const career = CAREERS_BY_ID.get(c.careerId);
    if (career) for (const s of career.careerSkills) set.add(s);
    const startSpec = CAREERS_SPEC_BY_ID.get(c.startingSpecId);
    if (startSpec) for (const s of startSpec.bonusSkills) set.add(s);
    return set;
  }

  /** All career skills granted by the character's career, owned specializations, and owned 'career_skill' nodes */
  static careerSkillsOf(c: Pick<GMCareersCharacter, 'careerId' | 'specializations' | 'startingSpecId' | 'nodes'>): Set<CareerSkillId> {
    const set = new Set<CareerSkillId>();
    const career = CAREERS_BY_ID.get(c.careerId);
    if (career) for (const s of career.careerSkills) set.add(s);
    const specs = c.specializations?.length ? c.specializations : (c.startingSpecId ? [c.startingSpecId] : []);
    for (const specId of specs) {
      const spec = CAREERS_SPEC_BY_ID.get(specId);
      if (spec) for (const s of spec.bonusSkills) set.add(s);
    }
    for (const { node } of this.ownedNodes(c)) {
      if (node.kind === 'career_skill' && node.skillId) set.add(node.skillId);
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
      out[def.id] = f + safeRanks(c.boughtSkillRanks?.[def.id]);
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
      const b = safeRanks(c.boughtSkillRanks?.[def.id]);
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

    // 5. Force powers bought on their own
    if (Array.isArray(c.powers)) {
      for (const spellId of c.powers) {
        const power = CAREERS_POWER_BY_ID.get(spellId);
        total += power ? power.xpCost : 10;
      }
    }

    // 6. Force power tree nodes
    for (const tree of CAREERS_POWER_TREES) {
      for (const node of ownedPowerNodes(tree, c.powerNodes?.[tree.id])) total += node.xpCost;
    }

    return total;
  }

  /** Check whether a node of a Force power tree can be bought right now (the root first, then along its links) */
  static canBuyPowerNode(
    c: GMCareersCharacter, treeId: string, nodeId: string, startingOnly: boolean = false
  ): { ok: boolean; cost: number; reason?: string } {
    const tree = CAREERS_POWER_TREE_BY_ID.get(treeId);
    if (!tree) return { ok: false, cost: 0, reason: 'Unknown Force power tree.' };
    const node = tree.nodes.find((n) => n.id === nodeId);
    if (!node) return { ok: false, cost: 0, reason: 'Unknown node.' };
    const cost = node.xpCost;
    if (!this.isForceSensitive(c)) return { ok: false, cost, reason: 'Only Force-sensitive characters can learn Force powers.' };
    if (tree.alignment !== 'universal' && tree.alignment !== c.alignment) {
      return { ok: false, cost, reason: `Only ${tree.alignment}-side characters can learn ${tree.name}.` };
    }
    const owned = new Set(ownedPowerNodes(tree, c.powerNodes?.[treeId]).map((n) => n.id));
    if (owned.has(nodeId)) return { ok: false, cost, reason: 'Already owned.' };
    if (node.kind !== 'root' && !owned.has('root')) return { ok: false, cost, reason: `Learn ${tree.name} first.` };
    if (node.kind !== 'root' && !node.links.some((link) => owned.has(link))) {
      return { ok: false, cost, reason: 'Needs a link to an owned node.' };
    }
    const short = this.shortOfXp(this.derive(c), cost, startingOnly);
    if (short) return { ok: false, cost, reason: short };
    return { ok: true, cost };
  }

  /** Whether a power tree node can be refunded at creation: nothing owned below it depends on it alone */
  static canRemovePowerNode(c: GMCareersCharacter, treeId: string, nodeId: string): boolean {
    const tree = CAREERS_POWER_TREE_BY_ID.get(treeId);
    if (!tree) return false;
    const remaining = ownedPowerNodes(tree, c.powerNodes?.[treeId]).filter((n) => n.id !== nodeId);
    return this.powerTreeLinksValid(tree, remaining.map((n) => n.id));
  }

  /** Whether every owned node of a power tree reaches the root through owned nodes */
  static powerTreeLinksValid(tree: CareerPowerTreeDef, ownedIds: string[]): boolean {
    const owned = new Set(ownedIds);
    if (owned.size === 0) return true;
    if (!owned.has('root')) return false;
    const byId = new Map(tree.nodes.map((n) => [n.id, n]));
    const reached = new Set(['root']);
    const queue = ['root'];
    while (queue.length) {
      for (const link of byId.get(queue.shift()!)?.links || []) {
        if (owned.has(link) && !reached.has(link)) {
          reached.add(link);
          queue.push(link);
        }
      }
    }
    return [...owned].every((id) => reached.has(id));
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
  static canBuyNode(
    c: GMCareersCharacter,
    specId: string,
    nodeId: string,
    startingOnly: boolean = false,
    ability?: CareerAbilityKey
  ): { ok: boolean; cost: number; reason?: string } {
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
    // Never sell a feat the character already has, from baseline proficiencies or another tree
    if (node.kind === 'feat' && typeof node.featId === 'number' && this.ownedFeatIds(c).has(node.featId)) {
      return { ok: false, cost, reason: `You already have ${node.label}.` };
    }
    if (node.kind === 'talent') {
      const talent = node.talentId ? CAREERS_TALENT_BY_ID.get(node.talentId) : undefined;
      if (!talent) return { ok: false, cost, reason: `Unknown talent: ${node.talentId || node.label}.` };
      if (!talent.ranked && (this.ownedTalentRanks(c)[talent.id] || 0) > 0) {
        return { ok: false, cost, reason: `You already have ${talent.name}.` };
      }
      if (talent.requirements?.forceSensitive && !this.isForceSensitive(c)) {
        return { ok: false, cost, reason: `${talent.name} requires Force sensitivity.` };
      }
      if (talent.requirements?.alignment && talent.requirements.alignment !== c.alignment) {
        return { ok: false, cost, reason: `${talent.name} requires ${talent.requirements.alignment}-side alignment.` };
      }
    }
    if (node.kind === 'characteristic') {
      const eff = this.effectiveCharacteristics(c);
      if (ability !== undefined) {
        if (!CAREER_ABILITIES.includes(ability)) return { ok: false, cost, reason: `Unknown characteristic: ${ability}.` };
        if (eff[ability] >= 6) return { ok: false, cost, reason: `${ability.toUpperCase()} is already at the maximum of 6.` };
      } else if (CAREER_ABILITIES.every((k) => eff[k] >= 6)) {
        return { ok: false, cost, reason: 'All characteristics are already at the maximum of 6.' };
      }
    }
    if ((node.kind === 'career_skill' || node.kind === 'capstone') && (!node.skillId || !CAREER_SKILL_BY_ID.has(node.skillId))) {
      return { ok: false, cost, reason: `Unknown skill on ${node.label}.` };
    }
    const short = this.shortOfXp(this.derive(c), cost, startingOnly);
    if (short) return { ok: false, cost, reason: short };
    return { ok: true, cost };
  }

  /**
   * Why a purchase can't be paid for, or null when it can. The creator pays from starting XP only
   * (`startingOnly`): it never moves `campaignXpSpent`, so letting it spend campaign XP would book that XP as
   * starting XP and overspend it. Spending campaign XP goes through the in-play purchase path, which records it.
   */
  static shortOfXp(derived: GMCareersDerived, cost: number, startingOnly: boolean): string | null {
    const left = startingOnly ? derived.startingXpRemaining : derived.totalXpRemaining;
    if (left >= cost) return null;
    return `Needs ${cost} ${startingOnly ? 'starting ' : ''}XP (${left} left).`;
  }

  /** Effective KotOR feat IDs: baseline proficiencies + bought feat nodes */
  static ownedFeatIds(c: Pick<GMCareersCharacter, 'nodes' | 'specializations' | 'startingSpecId'>): Set<number> {
    const featSet = new Set<number>(BASELINE_CAREER_FEATS);
    for (const { node } of this.ownedNodes(c)) {
      if (node.kind === 'feat' && typeof node.featId === 'number') featSet.add(node.featId);
    }
    return featSet;
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
  static canBuySkillRank(c: GMCareersCharacter, skillId: CareerSkillId, atCreation: boolean = true, startingOnly: boolean = false): { ok: boolean; cost: number; nextRank: number; reason?: string } {
    // A purchase can come from a player's request: a name outside the catalogue would book XP for nothing
    if (!CAREER_SKILL_BY_ID.has(skillId)) return { ok: false, cost: 0, nextRank: 0, reason: `Unknown skill: ${skillId}.` };
    const derived = this.derive(c);
    const current = derived.skillRanks[skillId] || 0;
    const nextRank = current + 1;
    const cap = this.maxSkillRank(skillId, derived.level, atCreation, this.hasCapstone(c, skillId));
    const cost = this.skillRankCost(nextRank, derived.careerSkills.has(skillId));
    if (nextRank > cap) return { ok: false, cost, nextRank, reason: atCreation ? 'Rank 2 is the maximum at creation.' : `Capped at rank ${cap} for level ${derived.level}.` };
    const short = this.shortOfXp(derived, cost, startingOnly);
    if (short) return { ok: false, cost, nextRank, reason: short };
    return { ok: true, cost, nextRank };
  }

  /** Check whether a Force power can be learned right now */
  static canBuyPower(c: GMCareersCharacter, spellId: number, startingOnly: boolean = false): { ok: boolean; cost: number; reason?: string } {
    const power = CAREERS_POWER_BY_ID.get(spellId);
    if (!power) return { ok: false, cost: 0, reason: 'Unknown Force power.' };
    if (!this.isForceSensitive(c)) return { ok: false, cost: power.xpCost, reason: 'Only Force-sensitive characters can learn Force powers.' };
    if (power.alignment !== 'universal' && power.alignment !== c.alignment) {
      return { ok: false, cost: power.xpCost, reason: `Only ${power.alignment}-side characters can learn ${power.name}.` };
    }
    if (c.powers.includes(spellId)) return { ok: false, cost: power.xpCost, reason: 'Already known.' };
    const short = this.shortOfXp(this.derive(c), power.xpCost, startingOnly);
    if (short) return { ok: false, cost: power.xpCost, reason: short };
    return { ok: true, cost: power.xpCost };
  }

  /** Compute all derived stats, engine numbers, and XP balances for a careers character */
  static derive(c: GMCareersCharacter, xpPerLevel: number = CAREERS_XP_PER_LEVEL): GMCareersDerived {
    const species = CAREERS_SPECIES_BY_ID.get(c.speciesId) || CAREERS_SPECIES_BY_ID.get('human')!;
    const level = this.levelFromXp(c.campaignXpSpent || 0, xpPerLevel);
    const levelBaseline = this.levelBaseline(level);
    const forceSensitive = this.isForceSensitive(c);

    const effectiveCharacteristics = this.effectiveCharacteristics(c);
    const kotorAttributes = {} as CareerAttributes;
    const modifiers = {} as CareerAttributes;
    for (const k of CAREER_ABILITIES) {
      const ffg = effectiveCharacteristics[k];
      kotorAttributes[k] = this.ffgToKotor(ffg);
      modifiers[k] = this.abilityMod(kotorAttributes[k]);
    }

    const skillRanks = this.effectiveSkillRanks(c);
    const careerSkills = this.careerSkillsOf(c);
    const engineSkills = toEngineSkillRanks(skillRanks);
    const talentRanks = this.ownedTalentRanks(c);

    // Every passive talent hook, added up once here (combat reads these totals, not the talent list)
    const talents = totalTalentHooks(talentRanks);
    // Force power trees: the powers they teach and each family's upgrades
    const powerTrees = totalPowerTrees(c.powerNodes);

    const saveRanks = {
      fortitude: (skillRanks.resilience || 0) * 2 + talents.saves.fortitude,
      reflex: (skillRanks.coordination || 0) * 2 + talents.saves.reflex,
      will: (skillRanks.discipline || 0) * 2 + talents.saves.will,
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

    const baseDefense = 10 + modifiers.dex + levelBaseline + talents.defense;

    const featSet = this.ownedFeatIds(c);

    const maxHp = Math.max(1, species.hpBase + level * (6 + modifiers.con) + talents.maxHp);
    const maxStrain = Math.max(1, species.strainBase + modifiers.wis + talents.maxStrain);
    const maxFp = forceSensitive ? Math.max(0, CAREERS_FORCE_BASE + level * (4 + modifiers.wis) + talents.maxFp) : 0;

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
      effectiveCharacteristics,
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
      talentRanks,
      talents,
      engineSkills,
      careerSkills,
      featIds: [...featSet].sort((a, b) => a - b),
      spellIds: forceSensitive ? [...new Set([...(c.powers || []), ...powerTrees.spellIds])] : [],
      powerFamilies: forceSensitive ? powerTrees.families : {},
      powerVariants: forceSensitive ? powerTrees.variants : [],
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
      const creationCareerSkills = this.creationCareerSkillsOf(c);
      for (const s of freeSpecies) {
        if (creationCareerSkills.has(s)) problems.push(`Free species skill ${s} must be a non-career skill.`);
      }
    }

    // Bought ranks must be whole numbers in range (the sums ignore anything else, so say so)
    for (const [skillId, value] of Object.entries(c.boughtSkillRanks || {})) {
      const def = CAREER_SKILL_BY_ID.get(skillId as CareerSkillId);
      if (!def) problems.push(`Unknown skill: ${skillId}.`);
      else if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > MAX_SKILL_RANK) {
        problems.push(`${def.name} has an invalid rank count (${value}).`);
      }
    }

    // A species that can never use the Force can't take a Force career
    if (species && career && !this.careerAllowed(species.id, career.id)) {
      problems.push(`${species.name} characters can't take the ${career.name} career: they can never use the Force.`);
    }

    const derived = this.derive(c);

    // Skill rank caps
    for (const def of CAREER_SKILLS) {
      const rank = derived.skillRanks[def.id] || 0;
      const cap = this.maxSkillRank(def.id, derived.level, atCreation, this.hasCapstone(c, def.id));
      if (rank > cap) {
        problems.push(`${def.name} rank ${rank} exceeds the maximum of ${cap}${atCreation ? ' at creation' : ` at level ${derived.level}`}.`);
      }
    }

    // Tree links and node rules (talents, Dedication characteristic choices)
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

    for (const { specId, node } of this.ownedNodes(c)) {
      if (node.kind === 'talent') {
        const talent = node.talentId ? CAREERS_TALENT_BY_ID.get(node.talentId) : undefined;
        if (!talent) {
          problems.push(`Unknown talent on node ${node.label}.`);
        } else {
          if (!talent.ranked && (derived.talentRanks[talent.id] || 0) > 1) {
            problems.push(`${talent.name} cannot be taken more than once.`);
          }
          if (talent.requirements?.forceSensitive && !derived.forceSensitive) {
            problems.push(`${talent.name} requires Force sensitivity.`);
          }
          if (talent.requirements?.alignment && talent.requirements.alignment !== c.alignment) {
            problems.push(`${talent.name} requires ${talent.requirements.alignment}-side alignment.`);
          }
        }
      } else if (node.kind === 'characteristic') {
        const chosen = c.nodeChoices?.[this.nodeChoiceKey(specId, node.id)];
        if (!chosen || !CAREER_ABILITIES.includes(chosen)) {
          problems.push(`Choose a characteristic for ${node.label} (${specId}:${node.id}).`);
        }
      }
    }

    for (const k of CAREER_ABILITIES) {
      if (derived.effectiveCharacteristics[k] > 6) {
        problems.push(`Characteristic ${k.toUpperCase()} exceeds the maximum of 6.`);
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

    // Force power trees
    for (const [treeId, nodeIds] of Object.entries(c.powerNodes || {})) {
      if (!Array.isArray(nodeIds) || nodeIds.length === 0) continue;
      const tree = CAREERS_POWER_TREE_BY_ID.get(treeId);
      if (!tree) {
        problems.push(`Unknown Force power tree (${treeId}).`);
        continue;
      }
      if (!derived.forceSensitive) problems.push(`Non-Force-sensitive characters cannot learn ${tree.name}.`);
      if (tree.alignment !== 'universal' && tree.alignment !== c.alignment) {
        problems.push(`${tree.name} requires ${tree.alignment}-side alignment.`);
      }
      const unknown = nodeIds.filter((id) => !tree.nodes.some((n) => n.id === id));
      if (unknown.length) problems.push(`Unknown ${tree.name} nodes: ${unknown.join(', ')}.`);
      if (!this.powerTreeLinksValid(tree, nodeIds.filter((id) => !unknown.includes(id)))) {
        problems.push(`${tree.name}: every node needs a link back to the power.`);
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

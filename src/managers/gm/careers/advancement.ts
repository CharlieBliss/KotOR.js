import { GameState } from "@/GameState";
import { CAREERS_BY_ID, CAREERS_SPEC_BY_ID } from "@/managers/gm/careers/data";
import { CareersRules } from "@/managers/gm/careers/rules";
import { CareersRuntime } from "@/managers/gm/careers/runtime";
import type {
  CareersPurchaseRecord,
  CareersPurchaseRequest,
  GMCareersCharacter,
} from "@/managers/gm/careers/types";
import { TalentFeat } from "@/talents/TalentFeat";
import { TalentSpell } from "@/talents/TalentSpell";
import type { ModuleCreature } from "@/module/ModuleCreature";

export interface CareersPurchaseResult {
  ok: boolean;
  reason?: string;
  record?: CareersPurchaseRecord;
}

/**
 * In-play advancement for Careers characters:
 * - GM awards campaign XP with a short reason kept in xpLog
 * - Players spend XP outside combat (leftover starting XP pays first without raising level;
 *   campaign XP spent drives the XP-derived level)
 * - Live recomputation on the spawned creature (no respawn needed)
 * - GM undo last purchase or full post-creation respec
 */
export class CareersAdvancement {

  /** Award campaign XP to a careers character with an optional reason */
  static awardXp(character: GMCareersCharacter, amount: number, reason: string = ''): boolean {
    const xp = Math.round(Number(amount));
    if (!character || !(xp > 0)) return false;
    character.campaignXpEarned = (character.campaignXpEarned || 0) + xp;
    if (!Array.isArray(character.xpLog)) character.xpLog = [];
    character.xpLog.push({ amount: xp, reason: String(reason || '').trim(), at: Date.now() });
    character.updated = Date.now();
    return true;
  }

  /** Split an XP cost across leftover starting XP first (never raises level), then campaign XP */
  private static splitCost(character: GMCareersCharacter, cost: number): { startingXpPaid: number; campaignXpPaid: number } {
    const derived = CareersRules.derive(character);
    const startingAvail = Math.max(0, derived.startingXpRemaining);
    const startingXpPaid = Math.min(startingAvail, cost);
    const campaignXpPaid = cost - startingXpPaid;
    return { startingXpPaid, campaignXpPaid };
  }

  /** Validate and apply a post-creation XP purchase (blocked while in combat) */
  static applyPurchase(character: GMCareersCharacter, req: CareersPurchaseRequest, inCombat: boolean = false): CareersPurchaseResult {
    if (!character || character.ruleset !== 'careers') {
      return { ok: false, reason: 'Not a Careers character.' };
    }
    if (inCombat) {
      return { ok: false, reason: 'XP can only be spent outside combat.' };
    }

    let cost = 0;
    if (req.kind === 'skill') {
      const check = CareersRules.canBuySkillRank(character, req.skillId, false);
      if (!check.ok) return { ok: false, reason: check.reason };
      cost = check.cost;
      const split = this.splitCost(character, cost);
      character.boughtSkillRanks[req.skillId] = (character.boughtSkillRanks[req.skillId] || 0) + 1;
      character.startingXpSpent = (character.startingXpSpent || 0) + split.startingXpPaid;
      character.campaignXpSpent = (character.campaignXpSpent || 0) + split.campaignXpPaid;
      return this.record(character, req, cost, split);
    }

    if (req.kind === 'node') {
      const check = CareersRules.canBuyNode(character, req.specId, req.nodeId);
      if (!check.ok) return { ok: false, reason: check.reason };
      cost = check.cost;
      const split = this.splitCost(character, cost);
      if (!character.nodes[req.specId]) character.nodes[req.specId] = [];
      character.nodes[req.specId].push(req.nodeId);
      character.startingXpSpent = (character.startingXpSpent || 0) + split.startingXpPaid;
      character.campaignXpSpent = (character.campaignXpSpent || 0) + split.campaignXpPaid;
      return this.record(character, req, cost, split);
    }

    if (req.kind === 'specialization') {
      const spec = CAREERS_SPEC_BY_ID.get(req.specId);
      if (!spec) return { ok: false, reason: 'Unknown specialization.' };
      if (character.specializations.includes(req.specId)) return { ok: false, reason: `Already owns ${spec.name}.` };
      const career = CAREERS_BY_ID.get(character.careerId);
      const inCareer = !!career && spec.careerId === career.id;
      cost = CareersRules.specializationCost(character.specializations.length + 1, inCareer);
      const derived = CareersRules.derive(character);
      if (derived.totalXpRemaining < cost) return { ok: false, reason: `Needs ${cost} XP (${derived.totalXpRemaining} left).` };
      const split = this.splitCost(character, cost);
      character.specializations.push(req.specId);
      if (!character.nodes[req.specId]) character.nodes[req.specId] = [];
      character.startingXpSpent = (character.startingXpSpent || 0) + split.startingXpPaid;
      character.campaignXpSpent = (character.campaignXpSpent || 0) + split.campaignXpPaid;
      return this.record(character, req, cost, split);
    }

    if (req.kind === 'power') {
      const check = CareersRules.canBuyPower(character, req.spellId);
      if (!check.ok) return { ok: false, reason: check.reason };
      cost = check.cost;
      const split = this.splitCost(character, cost);
      character.powers.push(req.spellId);
      character.startingXpSpent = (character.startingXpSpent || 0) + split.startingXpPaid;
      character.campaignXpSpent = (character.campaignXpSpent || 0) + split.campaignXpPaid;
      return this.record(character, req, cost, split);
    }

    return { ok: false, reason: 'Unknown purchase.' };
  }

  private static record(
    character: GMCareersCharacter,
    req: CareersPurchaseRequest,
    cost: number,
    split: { startingXpPaid: number; campaignXpPaid: number }
  ): CareersPurchaseResult {
    const rec: CareersPurchaseRecord = { ...req, cost, ...split, at: Date.now() };
    if (!Array.isArray(character.purchases)) character.purchases = [];
    character.purchases.push(rec);
    character.updated = Date.now();
    return { ok: true, record: rec };
  }

  /** GM undo: refund the most recent post-creation purchase */
  static undoLastPurchase(character: GMCareersCharacter): CareersPurchaseRecord | null {
    if (!Array.isArray(character?.purchases) || character.purchases.length === 0) return null;
    const last = character.purchases.pop()!;

    if (last.kind === 'skill') {
      const cur = character.boughtSkillRanks[last.skillId] || 0;
      if (cur <= 1) delete character.boughtSkillRanks[last.skillId];
      else character.boughtSkillRanks[last.skillId] = cur - 1;
    } else if (last.kind === 'node') {
      const list = character.nodes[last.specId];
      if (Array.isArray(list)) {
        const idx = list.lastIndexOf(last.nodeId);
        if (idx >= 0) list.splice(idx, 1);
      }
    } else if (last.kind === 'specialization') {
      const idx = character.specializations.lastIndexOf(last.specId);
      if (idx >= 0 && last.specId !== character.startingSpecId) {
        character.specializations.splice(idx, 1);
        delete character.nodes[last.specId];
      }
    } else if (last.kind === 'power') {
      const idx = character.powers.lastIndexOf(last.spellId);
      if (idx >= 0) character.powers.splice(idx, 1);
    }

    character.startingXpSpent = Math.max(0, (character.startingXpSpent || 0) - last.startingXpPaid);
    character.campaignXpSpent = Math.max(0, (character.campaignXpSpent || 0) - last.campaignXpPaid);
    character.updated = Date.now();
    return last;
  }

  /** GM full respec: refund every post-creation purchase back to creation state */
  static respecPurchases(character: GMCareersCharacter): number {
    let count = 0;
    while (this.undoLastPurchase(character)) count++;
    return count;
  }

  /**
   * Recompute HP, Strain, Force points, level, saves, skills, feats, and powers live on a spawned
   * creature without respawning it.
   */
  static syncToCreature(creature: ModuleCreature, character: GMCareersCharacter) {
    if (!creature || !character) return;
    const derived = CareersRules.derive(character);
    const prevMaxHp = creature.getMaxHP?.() ?? creature.maxHitPoints ?? derived.maxHp;
    const prevHp = creature.getHP?.() ?? creature.currentHitPoints ?? prevMaxHp;
    const hpDelta = derived.maxHp - prevMaxHp;

    // Attributes
    creature.str = derived.kotorAttributes.str;
    creature.dex = derived.kotorAttributes.dex;
    creature.con = derived.kotorAttributes.con;
    creature.int = derived.kotorAttributes.int;
    creature.wis = derived.kotorAttributes.wis;
    creature.cha = derived.kotorAttributes.cha;

    // Placeholder class level = XP-derived level (drives GetHitDice, GetCasterLevel, getSpellSaveDC)
    if (creature.classes?.[0]) {
      creature.classes[0].setLevel(derived.level);
    }

    // Raw save fields (for NWScript GetFortitudeSavingThrow etc.)
    creature.fortitudeSaveThrow = derived.saveRanks.fortitude;
    creature.reflexSaveThrow = derived.saveRanks.reflex;
    creature.willSaveThrow = derived.saveRanks.will;

    // HP (add delta when maxHp increases, clamp when respec reduces maxHp)
    const nextHp = Math.max(1, Math.min(derived.maxHp, prevHp + Math.max(0, hpDelta)));
    creature.hitPoints = derived.maxHp;
    creature.maxHitPoints = derived.maxHp;
    creature.currentHitPoints = nextHp;

    // Force points
    const prevMaxFp = creature.maxForcePoints || 0;
    const prevFp = creature.getFP?.() ?? creature.currentForce ?? prevMaxFp;
    const fpDelta = derived.maxFp - prevMaxFp;
    creature.forcePoints = derived.maxFp;
    creature.maxForcePoints = derived.maxFp;
    creature.currentForce = Math.max(0, Math.min(derived.maxFp, prevFp + Math.max(0, fpDelta)));

    // Engine skills
    derived.engineSkills.forEach((rank, i) => creature.skills?.[i]?.setRank(rank));

    // Feats and powers: the sheet's own, plus anything the GM granted by hand (not from the sheet before or now).
    // Talents the creature already has are kept as they are, so their state survives
    const previous = creature.careersRules instanceof CareersRuntime ? creature.careersRules.derived : undefined;
    const sheetFeats = new Set(derived.featIds);
    const oldSheetFeats = new Set(previous?.featIds || []);
    const featRows = GameState.TwoDAManager?.datatables?.get('feat')?.rows || {};
    const haveFeats = new Map<number, any>((creature.feats || []).map((f: any) => [f.id, f]));
    creature.feats = [
      ...derived.featIds.map((id) => haveFeats.get(id) || TalentFeat.From2DA({ __index: id, ...(featRows[id] || {}) })),
      ...[...haveFeats.values()].filter((f) => !sheetFeats.has(f.id) && !oldSheetFeats.has(f.id)),
    ];

    // Force powers on placeholder class
    if (creature.classes?.[0]) {
      const sheetSpells = new Set(derived.spellIds);
      const oldSheetSpells = new Set(previous?.spellIds || []);
      const haveSpells = new Map<number, any>((creature.classes[0].spells || []).map((s: any) => [s.id, s]));
      creature.classes[0].spells = [
        ...derived.spellIds.map((id) => haveSpells.get(id) || new TalentSpell(id)),
        ...[...haveSpells.values()].filter((s) => !sheetSpells.has(s.id) && !oldSheetSpells.has(s.id)),
      ];
    }

    // Attach or refresh runtime rules seam
    if (creature.careersRules instanceof CareersRuntime) {
      creature.careersRules.refresh(character);
    } else {
      creature.careersRules = new CareersRuntime(character, creature);
    }
    if (creature.gmPlayerConfig) {
      creature.gmPlayerConfig.careers = character;
      creature.gmPlayerConfig.level = derived.level;
    }
  }
}

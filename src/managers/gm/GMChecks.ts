import { GM_SKILL_NAMES } from "@/managers/gm/GMVocab";
import { GMObjectKind } from "@/managers/gm/GMObjectKind";
import { ModuleObject, ModuleCreature } from "@/module";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import type { GMCheck, GMCheckResult, GMPlaceableSpawnConfig, GMSkillGate } from "@/managers/gm/GMTypes";
import { GMManager } from "@/managers/GMManager";

/** GM checks: skills and saving throws rolled on the GM's machine, and skill checks that stand between a player and an object. */
export class GMChecks {
  /** skills.2da order (SKILL_*) */
  static SKILL_NAMES = GM_SKILL_NAMES;

  static checkLabel(check: GMCheck): string {
    if (check.kind === 'skill') return this.SKILL_NAMES[check.skill] || `Skill ${check.skill}`;
    return check.save === 'fortitude' ? 'Fortitude save' : check.save === 'reflex' ? 'Reflex save' : 'Will save';
  }

  /**
   * Roll a check as KotOR does: d20 + the skill's total (ranks, ability, feats, items, effects), or d20 + the save
   * and its ability, against a difficulty. Saves succeed on a natural 20 and fail on a 1; skills don't.
   */
  static rollCheck(cre: ModuleCreature, check: GMCheck, dc: number): GMCheckResult {
    const roll = 1 + Math.floor(Math.random() * 20);
    const mod = (score: number) => Math.floor(((score || 10) - 10) / 2);
    let bonus = 0;
    if (check.kind === 'skill') {
      bonus = cre.getSkillLevel(check.skill);
    } else if (check.save === 'fortitude') {
      bonus = cre.getFortitudeSave() + mod(cre.getCON());
    } else if (check.save === 'reflex') {
      bonus = cre.getReflexSave() + mod(cre.getDEX());
    } else {
      bonus = cre.getWillSave() + mod(cre.getWIS());
    }
    const total = roll + bonus;
    let success = total >= dc;
    if (check.kind === 'save' && roll === 20) success = true;
    if (check.kind === 'save' && roll === 1) success = false;
    return { name: cre.getName() || 'Someone', label: this.checkLabel(check), roll, bonus, total, dc, success };
  }

  static describeCheck(r: GMCheckResult): string {
    const sign = r.bonus >= 0 ? '+' : '-';
    return `${r.name}: ${r.label} ${r.roll} ${sign} ${Math.abs(r.bonus)} = ${r.total} vs DC ${r.dc}, ${r.success ? 'success' : 'failure'}`;
  }

  /** Roll a check for each creature and announce it: to everyone, or only to the GM when secret */
  static callCheck(creatures: ModuleCreature[], check: GMCheck, dc: number, secret: boolean = false): GMCheckResult[] {
    const results = creatures.filter((c) => c && !c.isDead()).map((c) => this.rollCheck(c, check, dc));
    for (const r of results) {
      const text = this.describeCheck(r);
      if (secret || GMNetworkManager.role !== 'host') GMNetworkManager.appendChat(secret ? 'Check (secret)' : 'Check', text);
      else GMNetworkManager.sendChat('Check', text);
    }
    return results;
  }

  /** Give an object a skill check to pass before it can be used, or undefined to remove it */
  static setSkillGate(obj: ModuleObject, gate: GMSkillGate | undefined) {
    if (!obj) return;
    if (gate) obj.gmSkillGate = { skill: gate.skill, dc: gate.dc };
    else delete obj.gmSkillGate;
    delete obj.gmSkillGateSolved;
    const config = obj.gmSpawnConfig as GMPlaceableSpawnConfig | undefined;
    if (config) config.skillGate = gate ? { ...gate } : undefined;
    GMManager.notifyChange();
  }

  /**
   * Using an object with a skill gate: the user rolls the skill against its difficulty (on the GM's machine,
   * where objects are used). Passing opens it for good; failing blocks this use, and they can try again.
   */
  static skillGatePasses(obj: ModuleObject, user: ModuleObject): boolean {
    const gate = obj?.gmSkillGate as GMSkillGate | undefined;
    if (!gate || obj.gmSkillGateSolved) return true;
    if (!user || !GMObjectKind.isCreature(user)) return true;
    const result = this.callCheck([user as ModuleCreature], { kind: 'skill', skill: gate.skill }, gate.dc)[0];
    if (!result) return false;
    if (result.success) obj.gmSkillGateSolved = true;
    return result.success;
  }
}

import { GM_SKILL_NAMES } from "@/managers/gm/GMVocab";
import { GMObjectKind } from "@/managers/gm/GMObjectKind";
import { ModuleObject, ModuleCreature } from "@/module";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import type { GMCheck, GMCheckResult, GMPlaceableSpawnConfig, GMRollResult, GMSkillGate } from "@/managers/gm/GMTypes";
import { GMLog } from "@/managers/gm/GMLog";
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
    const bonus = this.checkBonus(cre, check);
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

  /** Seconds a roll stays on screen */
  static ROLL_SHOWN_SECONDS = 10;
  /** Seconds between one player's rolls, so a held-down click can't flood everyone's screen */
  static ROLL_COOLDOWN_SECONDS = 1;
  /** Rolls players made, newest last, as they arrived here */
  static recentRolls: GMRollResult[] = [];

  /**
   * Host: a player rolls one of their character's skills: d20 + the skill's total, as the GM's checks roll it,
   * with no difficulty. Everyone sees it. Returns the result, or null when it can't be rolled now.
   */
  static rollForPlayer(actor: ModuleCreature, check: GMCheck | number): GMRollResult | null {
    // A bare number is a skill (players before saves could be rolled)
    const c: GMCheck | null = typeof check === 'number' ? { kind: 'skill', skill: check } : check || null;
    if (!actor || !this.isValidCheck(c)) return null;
    const now = performance.now();
    if (actor.gmLastRollAt && now - actor.gmLastRollAt < this.ROLL_COOLDOWN_SECONDS * 1000) return null;
    actor.gmLastRollAt = now;
    const r = this.rollCheck(actor, c, 0);
    const result: GMRollResult = { name: r.name, netId: actor.gmNetId, label: r.label, roll: r.roll, bonus: r.bonus, total: r.total };
    GMNetworkManager.send('roll.result', result);
    this.onRollResult(result);
    GMNetworkManager.appendChat('Roll', this.describeRoll(result));
    return result;
  }

  /** A skill that exists, or one of the three saves */
  static isValidCheck(check: GMCheck | null | undefined): check is GMCheck {
    if (!check) return false;
    if (check.kind === 'skill') return Number.isInteger(check.skill) && check.skill >= 0 && check.skill < this.SKILL_NAMES.length;
    return check.kind === 'save' && ['fortitude', 'reflex', 'will'].includes(check.save);
  }

  /** The bonus a check adds to the d20, as rollCheck works it out (for showing it) */
  static checkBonus(cre: ModuleCreature, check: GMCheck): number {
    const mod = (score: number) => Math.floor(((score || 10) - 10) / 2);
    if (check.kind === 'skill') return Number(cre.getSkillLevel(check.skill)) || 0;
    if (check.save === 'fortitude') return cre.getFortitudeSave() + mod(cre.getCON());
    if (check.save === 'reflex') return cre.getReflexSave() + mod(cre.getDEX());
    return cre.getWillSave() + mod(cre.getWIS());
  }

  static describeRoll(r: GMRollResult): string {
    const sign = r.bonus >= 0 ? '+' : '-';
    return `${r.name} rolled ${r.label}: ${r.roll} ${sign} ${Math.abs(r.bonus)} = ${r.total}`;
  }

  /** Everyone: a roll to show for a while */
  static onRollResult(result: GMRollResult) {
    if (!result) return;
    const now = performance.now();
    this.recentRolls = [...this.recentRolls.filter((r) => now - (r.at || 0) < this.ROLL_SHOWN_SECONDS * 1000), { ...result, at: now }].slice(-6);
    GMLog.info('roll', this.describeRoll(result));
    GMNetworkManager.notifyChange();
  }

  /** The rolls still on screen */
  static shownRolls(): GMRollResult[] {
    const now = performance.now();
    return this.recentRolls.filter((r) => now - (r.at || 0) < this.ROLL_SHOWN_SECONDS * 1000);
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

// Players' own rolls: everyone shows them, and a client's copy goes in its chat
GMNetworkManager.on('roll.result', 'client', (packet) => {
  if (!packet.payload) return;
  GMChecks.onRollResult(packet.payload);
  GMNetworkManager.appendChat('Roll', GMChecks.describeRoll(packet.payload));
}, 'to-me-or-all');

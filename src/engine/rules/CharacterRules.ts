import { GameState } from "@/GameState";
import type { ICharacterAttributes } from "@/engine/rules/CharacterBuilder";

const valid = (v: any) => v !== undefined && v !== null && v !== '' && v !== '****';
const num = (v: any, d = -1) => (valid(v) && Number.isFinite(Number(v)) ? Number(v) : d);
const mod = (score: number) => Math.floor((score - 10) / 2);

/** The ability keys, in the order the game lists them */
export const ABILITIES: (keyof ICharacterAttributes)[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/**
 * How far a session lets character creation go beyond KotOR's own rules (all optional: left out, the game's
 * rules apply)
 */
export interface ICharacterLimits {
  /** The level characters start at, or the range they may choose from */
  level?: number | [number, number];
  /** Ability points on top of the game's pool */
  extraPoints?: number;
  /** Any creature model, not just the player bodies */
  anyModel?: boolean;
  /** Any feat whose prerequisites are met, not just the class's own picks */
  freeFeats?: boolean;
  /** Starting weapons and armour may be chosen */
  gear?: boolean;
}

/** A character's rule choices: what creation decides */
export interface ICharacterChoices {
  classId: number;
  level: number;
  attributes: ICharacterAttributes;
  /** feat.2da rows chosen (automatic feats included); left out: the class's recommended picks */
  feats?: number[];
  /** spells.2da rows chosen; left out: the class's recommended powers */
  powers?: number[];
  /** skills.2da row -> rank; left out: the class's recommended ranks */
  skillRanks?: number[];
  /** appearance.2da row of the model (checked against the player bodies when a session asks) */
  appearanceId?: number;
}

/** A row of a picker: a 2DA row id and its name */
export interface IRuleOption {
  id: number;
  label: string;
  name: string;
}

/** spells.2da's per-class minimum level column, by class power-gain code */
const POWER_LEVEL_COLUMNS: Record<string, string> = { jgd: 'guardian', jcn: 'consular', jsn: 'sentinel' };

/**
 * CharacterRules class.
 *
 * The rules of making a character, read from the game's tables, for anything that builds one: the GM
 * character creator, CharacterBuilder (which picks the recommended choices), and the game's own creator
 * menus (ability costs). Every table is read through a small method here (classes, featGain, powerGain,
 * featEligible...), so a different progression (new classes, feats gained another way) replaces those
 * methods rather than the screens that use them.
 *
 * @file CharacterRules.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class CharacterRules {

  /** Abilities start here */
  static ABILITY_BASE = 8;
  /** ...and creation can raise them to this */
  static ABILITY_MAX = 18;
  /** Points to spend on abilities */
  static ABILITY_POOL = 30;
  /** Levels a character can have */
  static LEVEL_MAX = 20;

  static table(name: string): any[] {
    return Object.values(GameState.TwoDAManager.datatables.get(name)?.rows || {});
  }

  static row(name: string, id: number): any {
    return GameState.TwoDAManager.datatables.get(name)?.rows[id];
  }

  static text(strref: any, fallback = ''): string {
    if (!valid(strref)) return fallback;
    try { return GameState.TLKManager.GetStringById(Number(strref))?.Value?.trim() || fallback; } catch (e) { return fallback; }
  }

  // --- Abilities ---------------------------------------------------------------------------------

  /** Points it costs to raise an ability to score: 1 up to 13, then 2, 3, 4 (as the game's creator charges) */
  static raiseCost(score: number): number {
    return Math.max(1, mod(score));
  }

  /** Points an ability at score has cost, from the base */
  static abilityCost(score: number): number {
    let total = 0;
    for (let s = this.ABILITY_BASE + 1; s <= score; s++) total += this.raiseCost(s);
    return total;
  }

  /** Points spent on a set of abilities */
  static abilitiesCost(attributes: ICharacterAttributes): number {
    return ABILITIES.reduce((sum, key) => sum + this.abilityCost(attributes[key]), 0);
  }

  /** Points there are to spend */
  static abilityPool(limits: ICharacterLimits = {}): number {
    return this.ABILITY_POOL + Math.max(0, limits.extraPoints || 0);
  }

  static abilityModifier(score: number): number {
    return mod(score);
  }

  /** Bring abilities within the base, the cap and the pool: the highest scores come down first */
  static clampAbilities(attributes: ICharacterAttributes, limits: ICharacterLimits = {}): ICharacterAttributes {
    const out = { ...attributes };
    for (const key of ABILITIES) out[key] = Math.max(this.ABILITY_BASE, Math.min(this.ABILITY_MAX, Math.round(out[key] || this.ABILITY_BASE)));
    const pool = this.abilityPool(limits);
    while (this.abilitiesCost(out) > pool) {
      const highest = ABILITIES.reduce((a, b) => (out[b] > out[a] ? b : a));
      out[highest]--;
    }
    return out;
  }

  // --- Models ------------------------------------------------------------------------------------

  /** The player bodies: the models the game's own creator offers (portraits.2da rows for PCs) */
  static playerAppearances(): Set<number> {
    const ids = new Set<number>();
    for (const row of this.table('portraits')) {
      if (num(row.forpc, 0) !== 1) continue;
      for (const column of ['appearancenumber', 'appearance_s', 'appearance_l']) {
        const id = num(row[column]);
        if (id >= 0) ids.add(id);
      }
    }
    return ids;
  }

  // --- Classes -----------------------------------------------------------------------------------

  /** The classes a player character may take */
  static classes(): IRuleOption[] {
    const rows = GameState.TwoDAManager.datatables.get('classes')?.rows || {};
    return Object.entries(rows)
      // Player classes with a name in the game's text (KotOR II keeps a cut, unnamed one)
      .filter(([, row]: [string, any]) => num(row.playerclass, 0) === 1 && valid(row.name))
      .map(([id, row]: [string, any]) => ({ id: Number(id), label: String(row.label || ''), name: this.text(row.name, String(row.label || '')) }));
  }

  static classRow(classId: number): any {
    return this.row('classes', classId);
  }

  /** The level range a session allows */
  static levelRange(limits: ICharacterLimits = {}): [number, number] {
    if (Array.isArray(limits.level)) return [Math.max(1, limits.level[0]), Math.min(this.LEVEL_MAX, limits.level[1])];
    if (typeof limits.level === 'number') return [limits.level, limits.level];
    return [1, this.LEVEL_MAX];
  }

  /** How many of something a class gains over levels 1..level, from a per-level gain table column */
  static gainedBy(tableName: string, column: string, level: number): number {
    const rows = this.table(tableName);
    let total = 0;
    for (let i = 0; i < level && i < rows.length; i++) total += Math.max(0, num(rows[i][column], 0));
    return total;
  }

  static vitality(classId: number, level: number, attributes: ICharacterAttributes): { maxHp: number, maxFp: number } {
    const cls = this.classRow(classId);
    if (!cls) return { maxHp: 1, maxFp: 0 };
    const hitDie = num(cls.hitdie, 8);
    const forceDie = num(cls.forcedie, 0);
    return {
      maxHp: Math.max(level, level * (hitDie + mod(attributes.con))),
      maxFp: forceDie > 0 ? Math.max(0, level * (forceDie + mod(attributes.wis))) : 0,
    };
  }

  /** A class's row of a per-level table it names (classes.2da attackbonustable, savingthrowtable), for this level */
  static classLevelRow(classId: number, column: string, level: number): any {
    const name = String(this.classRow(classId)?.[column] || '').toLowerCase();
    if (!valid(name)) return undefined;
    const rows = this.table(name);
    return rows[Math.max(0, Math.min(rows.length - 1, level - 1))];
  }

  /** Base attack bonus at this level */
  static baseAttack(classId: number, level: number): number {
    return num(this.classLevelRow(classId, 'attackbonustable', level)?.bab, 0);
  }

  /** Base saving throws at this level */
  static saves(classId: number, level: number): { fortitude: number, reflex: number, will: number } {
    const row = this.classLevelRow(classId, 'savingthrowtable', level) || {};
    return { fortitude: num(row.fortsave, 0), reflex: num(row.refsave, 0), will: num(row.willsave, 0) };
  }

  // --- Feats -------------------------------------------------------------------------------------

  /** The class's feat-table code (feat.2da `<code>_list`) and its feat-gain code (featgain.2da `<code>_reg`) */
  static featCodes(classId: number): { code: string, gainCode: string } {
    const cls = this.classRow(classId) || {};
    const code = String(cls.featstable || '').toLowerCase();
    return { code, gainCode: String(cls.featgain || cls.featstable || '').toLowerCase() };
  }

  /** The feats the class grants by itself by this level */
  static automaticFeats(classId: number, level: number): number[] {
    const { code } = this.featCodes(classId);
    if (!code) return [];
    return this.table('feat')
      .filter((row) => num(row[`${code}_list`]) === 3 && level >= num(row[`${code}_granted`], 1))
      .map((row) => num(row.__index));
  }

  /** How many feats the class picks by this level */
  static featGain(classId: number, level: number): number {
    const { gainCode } = this.featCodes(classId);
    return gainCode ? this.gainedBy('featgain', `${gainCode}_reg`, level) : 0;
  }

  /** A feat's prerequisites (other feats, character level) are met */
  static featPrereqsMet(row: any, has: Set<number>, level: number): boolean {
    const p1 = num(row.prereqfeat1);
    const p2 = num(row.prereqfeat2);
    return (p1 < 0 || has.has(p1)) && (p2 < 0 || has.has(p2)) && level >= num(row.mincharlevel, 1);
  }

  /**
   * The feats the class may pick (feat.2da `<code>_list` 0 or 1), most recommended first; with free feats,
   * every real feat
   */
  static featPool(classId: number, limits: ICharacterLimits = {}): any[] {
    const { code } = this.featCodes(classId);
    const rows = this.table('feat').filter((row) => !String(row.label).startsWith('XXXX'));
    const inClass = (row: any) => code && [0, 1].includes(num(row[`${code}_list`]));
    return rows
      .filter((row) => inClass(row) || (limits.freeFeats && num(row[`${code}_list`]) !== 3))
      .sort((a, b) => num(a[`${code}_recom`], 9999) - num(b[`${code}_recom`], 9999));
  }

  /** A feat can be picked now: it's in the pool and its prerequisites are met by the feats held */
  static featEligible(classId: number, featId: number, has: Set<number>, level: number, limits: ICharacterLimits = {}): boolean {
    const row = this.featPool(classId, limits).find((r) => num(r.__index) === featId);
    return !!row && this.featPrereqsMet(row, has, level);
  }

  /** Picker rows for the feats a character could pick, given what it holds */
  static featOptions(classId: number, has: Set<number>, level: number, limits: ICharacterLimits = {}): IRuleOption[] {
    return this.featPool(classId, limits)
      .filter((row) => this.featPrereqsMet(row, has, level))
      .map((row) => ({ id: num(row.__index), label: String(row.label), name: this.text(row.name, String(row.label)) }));
  }

  // --- Force powers ------------------------------------------------------------------------------

  /** The class's power-gain code (classpowergain.2da column), and spells.2da's level column for it */
  static powerCodes(classId: number): { code: string, levelColumn: string } | null {
    const cls = this.classRow(classId) || {};
    const code = String(cls.spellgaintable || '').toLowerCase();
    const levelColumn = POWER_LEVEL_COLUMNS[code];
    return valid(cls.spellgaintable) && levelColumn ? { code, levelColumn } : null;
  }

  /** How many powers the class learns by this level */
  static powerGain(classId: number, level: number): number {
    const codes = this.powerCodes(classId);
    return codes ? this.gainedBy('classpowergain', codes.code, level) : 0;
  }

  /** The Force powers the class can learn by this level */
  static powerPool(classId: number, level: number): any[] {
    const codes = this.powerCodes(classId);
    if (!codes) return [];
    return this.table('spells').filter((row) => num(row.usertype) === 1 && num(row[codes.levelColumn]) >= 0 && num(row[codes.levelColumn]) <= level);
  }

  /** A power's prerequisites (other powers) are known */
  static powerPrereqsMet(row: any, known: Set<number>): boolean {
    return String(row.prerequisites || '').split('_').map((s) => num(s)).filter((n) => n >= 0).every((n) => known.has(n));
  }

  static powerOptions(classId: number, known: Set<number>, level: number): IRuleOption[] {
    return this.powerPool(classId, level)
      .filter((row) => this.powerPrereqsMet(row, known))
      .map((row) => ({ id: num(row.__index), label: String(row.label), name: this.text(row.name, String(row.label)) }));
  }

  // --- Skills ------------------------------------------------------------------------------------

  /** Skill points the class gets by this level: (base + INT modifier, at least 1) per level, four times at level 1 */
  static skillPoints(classId: number, level: number, intelligence: number): number {
    const cls = this.classRow(classId);
    if (!cls || !String(cls.skillstable || '')) return 0;
    const perLevel = Math.max(1, num(cls.skillpointbase, 1) + mod(intelligence));
    return perLevel * 4 + perLevel * (level - 1);
  }

  /** The class's skills-table code (skills.2da `<code>_class` / `<code>_reco`) */
  static skillCode(classId: number): string {
    return String(this.classRow(classId)?.skillstable || '').toLowerCase();
  }

  static isClassSkill(classId: number, skill: number): boolean {
    const code = this.skillCode(classId);
    return !!code && num(this.table('skills')[skill]?.[`${code}_class`], 0) === 1;
  }

  /** Most ranks a skill can have at this level: level + 3 for a class skill, half that otherwise */
  static skillMax(classId: number, skill: number, level: number): number {
    return this.isClassSkill(classId, skill) ? level + 3 : Math.floor((level + 3) / 2);
  }

  /** Points a rank costs: 1 for a class skill, 2 otherwise */
  static skillCost(classId: number, skill: number): number {
    return this.isClassSkill(classId, skill) ? 1 : 2;
  }

  static skillsCost(classId: number, ranks: number[]): number {
    return ranks.reduce((sum, r, i) => sum + Math.max(0, r) * this.skillCost(classId, i), 0);
  }

  static skillOptions(): IRuleOption[] {
    return this.table('skills').map((row, i) => ({ id: i, label: String(row.label), name: this.text(row.name, String(row.label)) }));
  }

  // --- Checking a character ----------------------------------------------------------------------

  /** What's wrong with a character under these limits (nothing: it's fine) */
  static validate(choices: ICharacterChoices, limits: ICharacterLimits = {}): string[] {
    const problems: string[] = [];
    if (!this.classes().some((c) => c.id === choices.classId)) problems.push('That class isn\'t one a player can take.');
    const [minLevel, maxLevel] = this.levelRange(limits);
    if (choices.level < minLevel || choices.level > maxLevel) problems.push(minLevel === maxLevel ? `Characters start at level ${minLevel}.` : `Level must be ${minLevel} to ${maxLevel}.`);

    if (limits.anyModel === false && choices.appearanceId !== undefined && !this.playerAppearances().has(choices.appearanceId)) {
      problems.push('This session only allows the player bodies as models.');
    }
    for (const key of ABILITIES) {
      const score = choices.attributes[key];
      if (score < this.ABILITY_BASE || score > this.ABILITY_MAX) problems.push(`${key.toUpperCase()} must be ${this.ABILITY_BASE} to ${this.ABILITY_MAX}.`);
    }
    const spent = this.abilitiesCost(choices.attributes), pool = this.abilityPool(limits);
    if (spent > pool) problems.push(`Abilities cost ${spent} points; there are ${pool}.`);

    if (choices.feats) {
      const automatic = new Set(this.automaticFeats(choices.classId, choices.level));
      const picks = choices.feats.filter((f) => !automatic.has(f));
      const allowed = this.featGain(choices.classId, choices.level);
      if (picks.length > allowed) problems.push(`${picks.length} feats picked; the class picks ${allowed} by level ${choices.level}.`);
      // Each pick must be possible given the feats it could have been taken after
      const has = new Set<number>(automatic);
      let pending = [...picks], progressed = true;
      while (pending.length && progressed) {
        progressed = false;
        for (const feat of [...pending]) {
          if (this.featEligible(choices.classId, feat, has, choices.level, limits)) {
            has.add(feat);
            pending = pending.filter((f) => f !== feat);
            progressed = true;
          }
        }
      }
      for (const feat of pending) problems.push(`Feat ${this.row('feat', feat)?.label ?? feat} can't be taken (not the class's, or its prerequisites aren't met).`);
    }

    if (choices.powers) {
      const allowed = this.powerGain(choices.classId, choices.level);
      if (choices.powers.length > allowed) problems.push(`${choices.powers.length} powers picked; the class learns ${allowed} by level ${choices.level}.`);
      const pool = new Set(this.powerPool(choices.classId, choices.level).map((row) => num(row.__index)));
      const known = new Set<number>();
      let pending = [...choices.powers], progressed = true;
      while (pending.length && progressed) {
        progressed = false;
        for (const power of [...pending]) {
          const row = this.row('spells', power);
          if (row && pool.has(power) && this.powerPrereqsMet(row, known)) {
            known.add(power);
            pending = pending.filter((p) => p !== power);
            progressed = true;
          }
        }
      }
      for (const power of pending) problems.push(`Power ${this.row('spells', power)?.label ?? power} can't be learned (not the class's at this level, or its prerequisites aren't known).`);
    }

    if (choices.skillRanks) {
      const points = this.skillPoints(choices.classId, choices.level, choices.attributes.int);
      const spent = this.skillsCost(choices.classId, choices.skillRanks);
      if (spent > points) problems.push(`Skills cost ${spent} points; there are ${points}.`);
      choices.skillRanks.forEach((rank, skill) => {
        const max = this.skillMax(choices.classId, skill, choices.level);
        if (rank > max) problems.push(`${this.row('skills', skill)?.label ?? `Skill ${skill}`} can have at most ${max} ranks.`);
      });
    }
    return problems;
  }

}

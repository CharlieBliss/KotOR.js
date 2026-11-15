import { GameState } from "@/GameState";
import { CharacterRules } from "@/engine/rules/CharacterRules";

const valid = (v: any) => v !== undefined && v !== null && v !== '' && v !== '****';
const num = (v: any, d = -1) => (valid(v) && Number.isFinite(Number(v)) ? Number(v) : d);

export interface ICharacterAttributes {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export interface ICharacterBuildOptions {
  classId: number;
  level: number;
  attributes: ICharacterAttributes;
  /** Which Force path's recommended powers to take (light by default) */
  alignment?: 'light' | 'dark';
}

/** A character's abilities at a class and level, by the game's rules */
export interface ICharacterBuild {
  classId: number;
  level: number;
  /** feat.2da rows: the class's automatic feats up to this level, then its picks */
  feats: number[];
  /** spells.2da rows (Force powers) */
  powers: number[];
  /** skills.2da row -> rank */
  skillRanks: number[];
  maxHp: number;
  maxFp: number;
}

/**
 * CharacterBuilder class.
 *
 * Builds a character of a class and level the way KotOR's own tables describe, as character creation and
 * level-up would with the Recommended choices:
 * - feats: every feat the class grants automatically by this level (feat.2da `<class>_list` = 3 and
 *   `<class>_granted`), plus the class's feat picks per level (featgain.2da), taken in the class's recommended
 *   order (`<class>_recom`) with prerequisites met
 * - Force powers: the class's powers per level (classpowergain.2da), available to the class by this level
 *   (spells.2da `guardian` / `consular` / `sentinel`) with prerequisites met, in the light- or dark-side
 *   recommended order
 * - skills: (class skill points + INT modifier) per level, four times over at level 1, spent in the class's
 *   recommended order (skills.2da `<class>_reco`); class skills up to level + 3 ranks, others half that at
 *   two points a rank
 * - vitality: the class's hit die + CON modifier per level; Force points: its Force die + WIS modifier per level
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file CharacterBuilder.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class CharacterBuilder {

  static build(options: ICharacterBuildOptions): ICharacterBuild {
    const level = Math.max(1, Math.floor(options.level || 1));
    const classId = options.classId;
    const attributes = options.attributes;
    const build: ICharacterBuild = { classId, level, feats: [], powers: [], skillRanks: [], maxHp: 1, maxFp: 0 };
    if (!CharacterRules.classRow(classId)) return build;

    const vitality = CharacterRules.vitality(classId, level, attributes);
    build.maxHp = vitality.maxHp;
    build.maxFp = vitality.maxFp;
    build.feats = this.buildFeats(classId, level);
    // Toughness and Master Toughness: +1 vitality per level each; Wookiee Toughness +2; Force Sensitive +40 FP
    const has = (feat: number) => build.feats.includes(feat);
    build.maxHp += level * ((has(84) ? 1 : 0) + (has(124) ? 1 : 0) + (has(95) ? 2 : 0));
    if (has(116)) build.maxFp += 40;
    build.powers = this.buildPowers(classId, level, options.alignment || 'light');
    build.skillRanks = this.buildSkills(classId, level, attributes);
    return build;
  }

  /** The class's automatic feats, then its picks: recommended first, then any it can take, prerequisites allowing */
  static buildFeats(classId: number, level: number): number[] {
    const { code } = CharacterRules.featCodes(classId);
    if (!code) return [];
    const has = new Set<number>(CharacterRules.automaticFeats(classId, level));
    let picks = CharacterRules.featGain(classId, level);
    const choosable = CharacterRules.featPool(classId);
    const recommended = choosable.filter((row) => num(row[`${code}_recom`]) >= 0);
    for (const pool of [recommended, choosable]) {
      let progressed = true;
      while (picks > 0 && progressed) {
        progressed = false;
        for (const row of pool) {
          if (picks <= 0) break;
          const id = num(row.__index);
          if (has.has(id) || !CharacterRules.featPrereqsMet(row, has, level)) continue;
          has.add(id);
          picks--;
          progressed = true;
        }
      }
    }
    return [...has].sort((a, b) => a - b);
  }

  /** The class's Force powers by level, in the light- or dark-side recommended order, prerequisites first */
  static buildPowers(classId: number, level: number, alignment: 'light' | 'dark'): number[] {
    let picks = CharacterRules.powerGain(classId, level);
    const recomColumn = alignment === 'dark' ? 'dark_recom' : 'light_recom';
    const otherColumn = alignment === 'dark' ? 'light_recom' : 'dark_recom';
    const rows = CharacterRules.powerPool(classId, level);
    const order = (row: any) => num(row[recomColumn], 1000 + num(row[otherColumn], 1000));
    rows.sort((a, b) => order(a) - order(b));
    const known = new Set<number>();

    let progressed = true;
    while (picks > 0 && progressed) {
      progressed = false;
      for (const row of rows) {
        if (picks <= 0) break;
        const id = num(row.__index);
        if (known.has(id) || !CharacterRules.powerPrereqsMet(row, known)) continue;
        known.add(id);
        picks--;
        progressed = true;
        break; // re-scan in order: taking a power can unlock a more recommended one
      }
    }
    return [...known].sort((a, b) => a - b);
  }

  /** Skill points spent in the class's recommended order, each skill up to its most ranks */
  static buildSkills(classId: number, level: number, attributes: ICharacterAttributes): number[] {
    const code = CharacterRules.skillCode(classId);
    const skills = CharacterRules.table('skills');
    const ranks = skills.map(() => 0);
    if (!code) return ranks;

    let points = CharacterRules.skillPoints(classId, level, attributes.int);
    const order = skills
      .map((row, i) => ({ i, reco: num(row[`${code}_reco`]) }))
      .filter((s) => s.reco >= 0)
      .sort((a, b) => a.reco - b.reco);
    for (const skill of order) {
      const max = CharacterRules.skillMax(classId, skill.i, level);
      const cost = CharacterRules.skillCost(classId, skill.i);
      while (ranks[skill.i] < max && points >= cost) {
        ranks[skill.i]++;
        points -= cost;
      }
      if (points <= 0) break;
    }
    return ranks;
  }

}

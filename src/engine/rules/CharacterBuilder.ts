import { GameState } from "@/GameState";

const valid = (v: any) => v !== undefined && v !== null && v !== '' && v !== '****';
const num = (v: any, d = -1) => (valid(v) && Number.isFinite(Number(v)) ? Number(v) : d);
const mod = (score: number) => Math.floor((score - 10) / 2);

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

/** spells.2da's per-class minimum level column, by class power-gain code */
const POWER_LEVEL_COLUMNS: Record<string, string> = { jgd: 'guardian', jcn: 'consular', jsn: 'sentinel' };

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

  static table(name: string): any[] {
    return Object.values(GameState.TwoDAManager.datatables.get(name)?.rows || {});
  }

  static classRow(classId: number): any {
    return GameState.TwoDAManager.datatables.get('classes')?.rows[classId];
  }

  static build(options: ICharacterBuildOptions): ICharacterBuild {
    const level = Math.max(1, Math.floor(options.level || 1));
    const cls = this.classRow(options.classId);
    const attributes = options.attributes;
    const build: ICharacterBuild = { classId: options.classId, level, feats: [], powers: [], skillRanks: [], maxHp: 1, maxFp: 0 };
    if (!cls) return build;

    const hitDie = num(cls.hitdie, 8);
    const forceDie = num(cls.forcedie, 0);
    build.maxHp = Math.max(level, level * (hitDie + mod(attributes.con)));
    build.maxFp = forceDie > 0 ? Math.max(0, level * (forceDie + mod(attributes.wis))) : 0;
    build.feats = this.buildFeats(cls, level);
    build.powers = this.buildPowers(cls, level, options.alignment || 'light');
    build.skillRanks = this.buildSkills(cls, level, attributes);
    return build;
  }

  /** How many of something a class gains over levels 1..level, from a per-level gain table column */
  static gainedBy(tableName: string, column: string, level: number): number {
    const rows = this.table(tableName);
    let total = 0;
    for (let i = 0; i < level && i < rows.length; i++) total += Math.max(0, num(rows[i][column], 0));
    return total;
  }

  static buildFeats(cls: any, level: number): number[] {
    const code = String(cls.featstable || '').toLowerCase();
    const gainCode = String(cls.featgain || cls.featstable || '').toLowerCase();
    if (!code) return [];
    const rows = this.table('feat');
    const has = new Set<number>();

    // Automatic feats
    for (const row of rows) {
      if (num(row[`${code}_list`]) === 3 && level >= num(row[`${code}_granted`], 1)) has.add(num(row.__index));
    }

    // Picks, recommended first, as prerequisites allow
    let picks = this.gainedBy('featgain', `${gainCode}_reg`, level);
    const meetsPrereqs = (row: any) => {
      const p1 = num(row.prereqfeat1);
      const p2 = num(row.prereqfeat2);
      return (p1 < 0 || has.has(p1)) && (p2 < 0 || has.has(p2)) && level >= num(row.mincharlevel, 1);
    };
    const choosable = rows
      .filter((row) => [0, 1].includes(num(row[`${code}_list`])) && !String(row.label).startsWith('XXXX'))
      .sort((a, b) => num(a[`${code}_recom`], 9999) - num(b[`${code}_recom`], 9999));
    const recommended = choosable.filter((row) => num(row[`${code}_recom`]) >= 0);
    for (const pool of [recommended, choosable]) {
      let progressed = true;
      while (picks > 0 && progressed) {
        progressed = false;
        for (const row of pool) {
          if (picks <= 0) break;
          const id = num(row.__index);
          if (has.has(id) || !meetsPrereqs(row)) continue;
          has.add(id);
          picks--;
          progressed = true;
        }
      }
    }
    return [...has].sort((a, b) => a - b);
  }

  static buildPowers(cls: any, level: number, alignment: 'light' | 'dark'): number[] {
    const code = String(cls.spellgaintable || '').toLowerCase();
    const levelColumn = POWER_LEVEL_COLUMNS[code];
    if (!valid(cls.spellgaintable) || !levelColumn) return [];
    let picks = this.gainedBy('classpowergain', code, level);
    const recomColumn = alignment === 'dark' ? 'dark_recom' : 'light_recom';
    const otherColumn = alignment === 'dark' ? 'light_recom' : 'dark_recom';

    const rows = this.table('spells').filter((row) => num(row.usertype) === 1 && num(row[levelColumn]) >= 0 && num(row[levelColumn]) <= level);
    const order = (row: any) => num(row[recomColumn], 1000 + num(row[otherColumn], 1000));
    rows.sort((a, b) => order(a) - order(b));
    const known = new Set<number>();
    const prereqsMet = (row: any) => String(row.prerequisites || '').split('_').map((s) => num(s)).filter((n) => n >= 0).every((n) => known.has(n));

    let progressed = true;
    while (picks > 0 && progressed) {
      progressed = false;
      for (const row of rows) {
        if (picks <= 0) break;
        const id = num(row.__index);
        if (known.has(id) || !prereqsMet(row)) continue;
        known.add(id);
        picks--;
        progressed = true;
        break; // re-scan in order: taking a power can unlock a more recommended one
      }
    }
    return [...known].sort((a, b) => a - b);
  }

  static buildSkills(cls: any, level: number, attributes: ICharacterAttributes): number[] {
    const code = String(cls.skillstable || '').toLowerCase();
    const skills = this.table('skills');
    const ranks = skills.map(() => 0);
    if (!code) return ranks;

    const perLevel = Math.max(1, num(cls.skillpointbase, 1) + mod(attributes.int));
    let points = perLevel * 4 + perLevel * (level - 1);
    const classMax = level + 3;

    const order = skills
      .map((row, i) => ({ i, reco: num(row[`${code}_reco`]), classSkill: num(row[`${code}_class`], 0) === 1 }))
      .filter((s) => s.reco >= 0)
      .sort((a, b) => a.reco - b.reco);
    for (const skill of order) {
      const max = skill.classSkill ? classMax : Math.floor(classMax / 2);
      const cost = skill.classSkill ? 1 : 2;
      while (ranks[skill.i] < max && points >= cost) {
        ranks[skill.i]++;
        points -= cost;
      }
      if (points <= 0) break;
    }
    return ranks;
  }

}

import { GameState } from "@/GameState";
import type { ModuleCreature } from "@/module/ModuleCreature";

const valid = (v: any) => v !== undefined && v !== null && v !== '' && v !== '****';
const num = (v: any, d = -1) => (valid(v) && Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * AbilityChains class.
 *
 * Groups feats and Force powers into the ranked chains KotOR shows them in (e.g. Power Attack → Improved
 * Power Attack → Master Power Attack, or Force Push → Force Whirlwind → Force Wave), using the game's own
 * tables: feat.2da's `prereqfeat1`, and spells.2da's `prerequisites`.
 *
 * Each chain is a list of 2DA rows, first rank first. Only chains the creature has at least one rank of are
 * returned; ranks it hasn't learned are included so the sheet can show them locked.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file AbilityChains.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class AbilityChains {

  /** The longest chain followed, as a guard against loops in modded tables */
  static MAX_CHAIN = 6;

  /**
   * Feats as rank chains. A rank's `prereqfeat1` is the rank before it (Improved Power Attack requires Power
   * Attack); feat.2da's `successor` column doesn't describe ranks, so it isn't used.
   */
  static featChains(creature: ModuleCreature): any[][] {
    const rows: any[] = Object.values(GameState.TwoDAManager.datatables.get('feat')?.rows || {});
    const byIndex = new Map<number, any>(rows.map((r) => [num(r.__index), r]));
    const next = (id: number) => rows.filter((r) => num(r.prereqfeat1) === id);

    const chains: any[][] = [];
    const seenRoots = new Set<number>();
    for (const feat of creature?.feats || []) {
      let root = feat.id;
      for (let i = 0; i < this.MAX_CHAIN; i++) {
        const prereq = num(byIndex.get(root)?.prereqfeat1);
        if (prereq < 0 || !byIndex.has(prereq)) break;
        root = prereq;
      }
      if (seenRoots.has(root)) continue;
      seenRoots.add(root);

      const chain: any[] = [];
      let current = byIndex.get(root);
      for (let i = 0; i < this.MAX_CHAIN && current; i++) {
        chain.push(current);
        const ranks = next(num(current.__index));
        current = ranks.find((r) => creature.getHasFeat(num(r.__index))) || ranks[0];
      }
      if (chain.length) chains.push(chain.slice(0, 3));
    }
    return chains.sort((a, b) => num(a[0].__index) - num(b[0].__index));
  }

  /** Force powers (user type 1) as chains: a power, then powers that require it */
  static powerChains(creature: ModuleCreature): any[][] {
    const rows: any[] = Object.values(GameState.TwoDAManager.datatables.get('spells')?.rows || {})
      .filter((r: any) => num(r.usertype) === 1);
    const byIndex = new Map<number, any>(rows.map((r) => [num(r.__index), r]));
    const requires = (row: any): number[] => String(row.prerequisites || '')
      .split('_').map((s) => num(s)).filter((n) => n >= 0);
    // power -> the power it needs first
    const previous = new Map<number, number>();
    for (const row of rows) {
      const prereq = requires(row)[0];
      if (prereq !== undefined && byIndex.has(prereq)) previous.set(num(row.__index), prereq);
    }

    const known = rows.filter((r) => creature?.getHasSpell(num(r.__index)));
    const chains: any[][] = [];
    const seenRoots = new Set<number>();
    for (const power of known) {
      let root = num(power.__index);
      for (let i = 0; i < this.MAX_CHAIN && previous.has(root); i++) root = previous.get(root);
      if (seenRoots.has(root)) continue;
      seenRoots.add(root);

      const chain: any[] = [];
      let current = byIndex.get(root);
      for (let i = 0; i < this.MAX_CHAIN && current; i++) {
        chain.push(current);
        const id = num(current.__index);
        // The next rank: the power requiring this one, preferring one the creature knows
        const nextRanks = rows.filter((r) => requires(r)[0] === id);
        current = nextRanks.find((r) => creature.getHasSpell(num(r.__index))) || nextRanks[0];
      }
      if (chain.length) chains.push(chain.slice(0, 3));
    }
    return chains.sort((a, b) => num(a[0].__index) - num(b[0].__index));
  }

}

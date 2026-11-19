import type {
  CareerPowerModifiers,
  CareerPowerNodeDef,
  CareerPowerTreeDef,
  CareerPowerVariantDef,
} from "@/managers/gm/careers/types";

/*
 * Force power trees: each power family is its own tree, the basic power at the root and upgrades below.
 * - Passive nodes are always on once bought: their numbers apply when any power in the family is cast (the
 *   power-cast hook, CareersRuntime.adjustPowerEffect), so Strength also makes Pull, Whirlwind and Wave hit harder.
 * - Variant nodes add a power-wheel entry: a KotOR power of the family (Whirlwind, Wave) at its own Force point cost,
 *   or the root power cast differently (Pull).
 * Rows cost what the doc's table says; the upgrade numbers are first drafts, kept together here to tune.
 */

/** spells.2da rows (KotOR II) of the Push family */
export const FORCE_PUSH = 23;
export const FORCE_WHIRLWIND = 27;
export const FORCE_WAVE = 26;

/** The first-draft numbers of each Push upgrade, per rank */
export const PUSH_UPGRADES = {
  strength: { damage: 4, saveDC: 2 },
  distance: { pushDistance: 2 },
  stun: { stunSeconds: 3 },
  magnitude: { extraTargets: 2 },
  duration: { durationSeconds: 3 },
} as const;

export const CAREERS_POWER_TREES: readonly CareerPowerTreeDef[] = [
  {
    id: 'force_push',
    name: 'Force Push',
    description: 'Telekinetic force: hit harder (left), reach further and wider (middle), or change what it does (right).',
    rootSpellId: FORCE_PUSH,
    alignment: 'universal',
    nodes: [
      { id: 'root', row: 0, col: 1, kind: 'root', xpCost: 10, label: 'Force Push',
        description: 'One target is knocked back about 5 m and off their feet, with the power\'s own damage and save.',
        links: ['strength', 'distance', 'pull'] },
      // Row 1 (5 XP)
      { id: 'strength', row: 1, col: 0, kind: 'passive', xpCost: 5, label: 'Strength', upgrade: PUSH_UPGRADES.strength,
        description: '+4 damage and +2 save DC for every power in the Push family.', links: ['root', 'stun'] },
      { id: 'distance', row: 1, col: 1, kind: 'passive', xpCost: 5, label: 'Distance', upgrade: PUSH_UPGRADES.distance,
        description: 'Targets fly 2 m further.', links: ['root', 'magnitude'] },
      { id: 'pull', row: 1, col: 2, kind: 'variant', xpCost: 5, label: 'Pull', variant: 'pull',
        description: 'Variant: draws the target to you instead (Force Push\'s cost).', links: ['root', 'whirlwind'] },
      // Row 2 (10 XP)
      { id: 'stun', row: 2, col: 0, kind: 'passive', xpCost: 10, label: 'Stun', upgrade: PUSH_UPGRADES.stun,
        description: 'Pushed targets stay stunned a turn (3 s) longer after they land.', links: ['strength', 'strength_2'] },
      { id: 'magnitude', row: 2, col: 1, kind: 'passive', xpCost: 10, label: 'Magnitude', upgrade: PUSH_UPGRADES.magnitude,
        description: 'Up to 2 more enemies within 4 m of the target are pushed too.', links: ['distance', 'wave'] },
      { id: 'whirlwind', row: 2, col: 2, kind: 'variant', xpCost: 10, label: 'Whirlwind', variantSpellId: FORCE_WHIRLWIND,
        description: 'Variant: holds the target in the air instead (KotOR\'s Force Whirlwind).', links: ['pull', 'duration'] },
      // Row 3
      { id: 'strength_2', row: 3, col: 0, kind: 'passive', xpCost: 15, label: 'Strength (rank 2)', upgrade: PUSH_UPGRADES.strength,
        description: '+4 damage and +2 save DC again.', links: ['stun'] },
      { id: 'wave', row: 3, col: 1, kind: 'variant', xpCost: 20, label: 'Mastery: Wave', variantSpellId: FORCE_WAVE,
        description: 'Variant: pushes everyone around you (KotOR\'s Force Wave).', links: ['magnitude'] },
      { id: 'duration', row: 3, col: 2, kind: 'passive', xpCost: 15, label: 'Duration', upgrade: PUSH_UPGRADES.duration,
        description: 'Whirlwind holds a turn (3 s) longer.', links: ['whirlwind'] },
    ],
  },
];

export const CAREERS_POWER_TREE_BY_ID: ReadonlyMap<string, CareerPowerTreeDef> = new Map(
  CAREERS_POWER_TREES.map((t) => [t.id, t])
);

/** The power tree whose root is this spell, if it has one */
export function powerTreeForRoot(spellId: number): CareerPowerTreeDef | undefined {
  return CAREERS_POWER_TREES.find((t) => t.rootSpellId === spellId);
}

/** Every KotOR power in a tree's family: its root and its KotOR variants */
export function powerTreeSpellIds(tree: CareerPowerTreeDef): number[] {
  return [tree.rootSpellId, ...tree.nodes.filter((n) => n.variantSpellId !== undefined).map((n) => n.variantSpellId!)];
}

export function noPowerModifiers(): CareerPowerModifiers {
  return { damage: 0, saveDC: 0, pushDistance: 0, stunSeconds: 0, extraTargets: 0, durationSeconds: 0 };
}

/** The owned nodes of a tree that exist in it (anything unknown in a save is ignored) */
export function ownedPowerNodes(tree: CareerPowerTreeDef, owned: readonly string[] | undefined): CareerPowerNodeDef[] {
  const ids = new Set(Array.isArray(owned) ? owned : []);
  return tree.nodes.filter((n) => ids.has(n.id));
}

/** What a character's power tree nodes add up to: powers known, each family's passive totals, and odd variants */
export function totalPowerTrees(powerNodes: Readonly<Record<string, string[]>> | undefined): {
  spellIds: number[];
  families: Record<number, CareerPowerModifiers>;
  variants: CareerPowerVariantDef[];
} {
  const spellIds: number[] = [];
  const families: Record<number, CareerPowerModifiers> = {};
  const variants: CareerPowerVariantDef[] = [];
  for (const tree of CAREERS_POWER_TREES) {
    const owned = ownedPowerNodes(tree, powerNodes?.[tree.id]);
    // Without the root, nothing else in the tree counts (it can't be bought without it, but a save could say so)
    if (!owned.some((n) => n.kind === 'root')) continue;
    const mods = noPowerModifiers();
    for (const node of owned) {
      if (node.kind === 'root') spellIds.push(tree.rootSpellId);
      if (node.variantSpellId !== undefined) spellIds.push(node.variantSpellId);
      if (node.variant) {
        variants.push({ treeId: tree.id, variant: node.variant, spellId: tree.rootSpellId, name: node.label, description: node.description });
      }
      for (const [key, amount] of Object.entries(node.upgrade || {}) as [keyof CareerPowerModifiers, number][]) {
        mods[key] += amount || 0;
      }
    }
    for (const id of powerTreeSpellIds(tree)) families[id] = mods;
  }
  return { spellIds, families, variants };
}

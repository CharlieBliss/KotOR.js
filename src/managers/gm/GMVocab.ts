import type { ModuleItem } from "@/module";

/** The faction.2da rows GM mode uses for sides */
export const GMFaction = {
  PARTY: 0,
  HOSTILE: 1,
  FRIENDLY: 2,
  NEUTRAL: 5,
} as const;

/** The name of a side, for the GM panel (anything else reads as Neutral) */
export function gmFactionName(id: number): string {
  if (id === GMFaction.HOSTILE) return 'Hostile';
  if (id === GMFaction.FRIENDLY) return 'Friendly';
  if (id === GMFaction.PARTY) return 'Party';
  return 'Neutral';
}

/** KotOR's eight skills, in skills.2da order (SKILL_* constants) */
export const GM_SKILL_NAMES = ['Computer Use', 'Demolitions', 'Stealth', 'Awareness', 'Persuade', 'Repair', 'Security', 'Treat Injury'];

/** The template an item was made from: its equipped or inventory resref */
export function gmItemResRef(item: ModuleItem | null | undefined): string {
  return item?.getEquippedRes() || item?.getInventoryRes() || item?.getTemplateResRef?.() || '';
}

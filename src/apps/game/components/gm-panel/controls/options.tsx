import React from "react";
import type * as KotOR from "@/apps/game/KotOR";
import { GMChecks } from "@/apps/game/components/gm-panel/gmPanelStore";

/**
 * An item list's <option>s (weapons, armour, loot). current: the value the select shows; when it isn't in the
 * list (a template's own item) it is offered first, marked "(template)".
 */
export const ItemOptions: React.FC<{ items: { resRef: string; label: string }[]; current?: string }> = ({ items, current }) => (
  <>
    {current !== undefined && !items.some((item) => item.resRef === (current || '')) && (
      <option value={current}>{current} (template)</option>
    )}
    {items.map((item) => (
      <option key={item.resRef} value={item.resRef}>{item.label}</option>
    ))}
  </>
);

/** The skills as <option>s, valued by their skills.2da row (after prefix, e.g. "skill:4") */
export const SkillOptions: React.FC<{ prefix?: string }> = ({ prefix = '' }) => (
  <>
    {GMChecks.SKILL_NAMES.map((name, i) => <option key={name} value={`${prefix}${i}`}>{name}</option>)}
  </>
);

/** Player characters as <option>s, valued by their network id */
export const PlayerOptions: React.FC<{ players: KotOR.ModuleCreature[] }> = ({ players }) => (
  <>
    {players.map((pc) => (
      <option key={pc.gmNetId} value={pc.gmNetId}>{pc.getName()}</option>
    ))}
  </>
);

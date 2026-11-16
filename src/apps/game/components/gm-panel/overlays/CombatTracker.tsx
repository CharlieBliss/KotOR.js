import React, { useEffect, useRef, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { GMManager, GMEditTools, GMNpcOrders, useGMStore } from "@/apps/game/components/gm-panel/gmPanelStore";

/** Seconds a fallen fighter stays on the list, greyed */
const DOWN_SECONDS = 12;

interface Fighter {
  cre: KotOR.ModuleCreature;
  hostile: boolean;
  dead: boolean;
}

const nameOf = (c: KotOR.ModuleCreature | null | undefined) => c?.getName?.() || (c as any)?.firstName || c?.getTag?.() || '?';

/** What it's busy with, in a word or two */
function doing(cre: KotOR.ModuleCreature): string {
  if (cre.isDead()) return 'down';
  const action = cre.combatRound?.action as any;
  const spell = action?.spell;
  if (spell) {
    const label = String(spell.label || '').replace(/^FORCE_POWER_/, '').replace(/^ITEM_ABILITY_/, '').replace(/_/g, ' ').toLowerCase();
    return label ? `casting ${label}` : 'casting';
  }
  if ((cre.gmCombatHoldUntil || 0) > performance.now()) return 'waiting for an opening';
  const order = GMNpcOrders.getOrder(cre);
  if (order && order.kind !== 'guard') return GMNpcOrders.describe(order).toLowerCase();
  return '';
}

/** Living creatures in the fight now, and those that fell in it lately */
function fighters(seenDown: Map<KotOR.ModuleCreature, number>): Fighter[] {
  const area = KotOR.GameState.module?.area;
  if (!area) return [];
  const all = new Set<KotOR.ModuleCreature>([...area.creatures, ...KotOR.GameState.PartyManager.party].filter(Boolean) as KotOR.ModuleCreature[]);
  const now = performance.now();
  const out: Fighter[] = [];
  for (const cre of all) {
    if (cre.gmHidden || cre.gmSpawning) continue;
    const dead = cre.isDead();
    if (dead) {
      const at = seenDown.get(cre);
      if (at === undefined || now - at > DOWN_SECONDS * 1000) continue;
    } else if (!cre.combatData?.combatState) {
      continue;
    }
    out.push({ cre, dead, hostile: cre.factionId === KotOR.GMFaction.HOSTILE });
  }
  // Most hurt first within a side; the fallen at the bottom
  const ratio = (c: KotOR.ModuleCreature) => (c.getHP() || 0) / Math.max(1, c.getMaxHP() || 1);
  out.sort((a, b) => (a.dead ? 1 : 0) - (b.dead ? 1 : 0) || ratio(a.cre) - ratio(b.cre));
  return out;
}

/**
 * Who's fighting, at a glance: each side's fighters with their health, Force, target and what they're doing.
 * Click selects (Shift adds), double-click goes to them, right-click opens the GM's menu for them. It comes up when a
 * fight starts and goes when it ends; T (or the palette) shows or hides it.
 */
export const CombatTracker: React.FC<{ shown: boolean | null; onShownChange: (shown: boolean | null) => void }> = ({ shown, onShownChange }) => {
  useGMStore();
  // When each fighter was first seen down, so the fallen stay a little while (fighting, then dead)
  const seenDown = useRef(new Map<KotOR.ModuleCreature, number>());
  const wasFighting = useRef(new Set<KotOR.ModuleCreature>());
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const area = KotOR.GameState.module?.area;
  const now = performance.now();
  if (area) {
    for (const cre of [...area.creatures, ...KotOR.GameState.PartyManager.party] as KotOR.ModuleCreature[]) {
      if (!cre) continue;
      if (cre.isDead()) {
        if (wasFighting.current.has(cre) && !seenDown.current.has(cre)) seenDown.current.set(cre, now);
      } else {
        seenDown.current.delete(cre);
        if (cre.combatData?.combatState) wasFighting.current.add(cre);
      }
    }
  }
  const list = fighters(seenDown.current);
  const fighting = list.some((f) => !f.dead);

  // A new fight brings it back up after the GM closed it for the last one
  const fightingBefore = useRef(false);
  useEffect(() => {
    if (fighting && !fightingBefore.current && shown === false) onShownChange(null);
    if (!fighting && fightingBefore.current) wasFighting.current.clear();
    fightingBefore.current = fighting;
  }, [fighting]);

  // null: automatic (while there's a fight); true / false: the GM's choice
  const visible = shown === null ? fighting : shown;
  if (!visible || !GMManager.isGMUser() || GMManager.controlMode === 'POSSESS') return null;

  const sides: { id: string; label: string; members: Fighter[] }[] = [
    { id: 'hostile', label: 'Hostile', members: list.filter((f) => f.hostile) },
    { id: 'others', label: 'Players & allies', members: list.filter((f) => !f.hostile) },
  ];
  const select = (cre: KotOR.ModuleCreature, e: React.MouseEvent) => GMManager.selectObject(cre, e.shiftKey ? 'toggle' : 'only');
  const focus = (cre: KotOR.ModuleCreature) => { GMManager.selectObject(cre); GMEditTools.focusCamera([cre]); };
  const menu = (cre: KotOR.ModuleCreature, e: React.MouseEvent) => {
    e.preventDefault();
    GMManager.events.dispatchEvent('context-menu', { x: e.clientX, y: e.clientY, target: cre, point: null });
  };

  return (
    <div className="gm-tracker" onContextMenu={(e) => e.preventDefault()}>
      <div className="gm-tracker-head">
        <span>Combat{!fighting ? ' (over)' : ''}</span>
        <button className="gm-btn small" title="Hide the tracker (T shows it again; it comes back for the next fight)" onClick={() => onShownChange(false)}>Hide</button>
      </div>
      {!list.length && <div className="gm-hint">Nobody's fighting.</div>}
      {sides.map((side) => !side.members.length ? null : (
        <div key={side.id} className={`gm-tracker-side ${side.id}`}>
          <div className="gm-tracker-side-head">
            <button className="gm-tracker-toggle" onClick={() => setCollapsed({ ...collapsed, [side.id]: !collapsed[side.id] })}>
              {collapsed[side.id] ? '▸' : '▾'} {side.label} <span>{side.members.filter((f) => !f.dead).length} standing</span>
            </button>
            <button
              className="gm-btn small"
              title={`Select every ${side.label.toLowerCase()} fighter still standing`}
              onClick={() => GMManager.setSelection(side.members.filter((f) => !f.dead).map((f) => f.cre))}
            >
              Select
            </button>
          </div>
          {!collapsed[side.id] && side.members.map(({ cre, dead }) => {
            const hp = cre.getHP() || 0, max = Math.max(1, cre.getMaxHP() || 1);
            const fpMax = cre.getMaxFP?.() || 0, fp = cre.getFP?.() || 0;
            const target = !dead ? GMManager.attackTargetOf(cre) : undefined;
            const what = doing(cre);
            const ratio = Math.max(0, Math.min(1, hp / max));
            return (
              <div
                key={cre.id}
                className={`gm-tracker-row ${dead ? 'dead' : ''} ${GMManager.isSelected(cre) ? 'selected' : ''}`}
                onClick={(e) => select(cre, e)}
                onDoubleClick={() => focus(cre)}
                onContextMenu={(e) => menu(cre, e)}
                title="Click: select (Shift: add) · double-click: go to · right-click: menu"
              >
                <div className="gm-tracker-line">
                  <span className="gm-tracker-name">{nameOf(cre)}{cre.gmOwnerPeerId ? ' (player)' : ''}</span>
                  <span className="gm-tracker-hp">{dead ? 'down' : `${hp}/${max}`}</span>
                </div>
                <div className="gm-tracker-bar"><div style={{ width: `${ratio * 100}%` }} className={ratio < 0.3 ? 'low' : ratio < 0.6 ? 'mid' : ''} /></div>
                {fpMax > 0 && !dead && <div className="gm-tracker-bar fp"><div style={{ width: `${Math.max(0, Math.min(1, fp / fpMax)) * 100}%` }} /></div>}
                {!dead && (target || what) && (
                  <div className="gm-tracker-sub">
                    {target && target !== cre && <span>→ {nameOf(target as KotOR.ModuleCreature)}</span>}
                    {what && <span className="gm-tracker-doing">{what}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/** Anyone in the scene in a fight now (whether the tracker shows by itself) */
export function anyoneFighting(): boolean {
  const area = KotOR.GameState.module?.area;
  if (!area) return false;
  return [...area.creatures, ...KotOR.GameState.PartyManager.party]
    .some((c: any) => c && !c.gmHidden && !c.isDead?.() && c.combatData?.combatState);
}

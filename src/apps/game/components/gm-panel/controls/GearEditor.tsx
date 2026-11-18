import React, { useEffect, useMemo, useRef, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { GMManager, GMSpawner } from "@/apps/game/components/gm-panel/gmPanelStore";

type Creature = KotOR.ModuleCreature;
type Option = { resRef: string; label: string };

/** The item in a slot, by whichever resref names it (a template's own item or one drawn later has no equipped one) */
const heldIn = (cre: Creature, slot: 'RIGHTHAND' | 'LEFTHAND' | 'ARMOR'): string =>
  ((cre.equipment as any)?.[slot]?.getItemResRef?.() || '').toLowerCase();

/** How many matches the list draws at once (KotOR II has hundreds of weapons): type to narrow it */
const SHOWN = 200;

/**
 * Pick an item from a dropdown of every item of the kind the game has: clicking opens the whole list (the one
 * held marked), typing narrows it by name or resref, arrows and Enter or a click equip it, Escape closes it.
 * It was a text box with the browser's suggestions, filtered by the name already in it: clicking showed nothing
 */
export const ItemPicker: React.FC<{ items: Option[]; value: string | null; onPick: (resRef: string) => void; listId: string }> = ({ items, value, onPick, listId }) => {
  const labelOf = (resRef: string) => items.find((i) => i.resRef === resRef)?.label || resRef || '';
  const shown = value === null ? '' : labelOf(value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.label.toLowerCase().includes(q) || i.resRef.toLowerCase().includes(q)) : items;
  }, [items, query]);

  const show = () => {
    setQuery('');
    const at = items.findIndex((i) => i.resRef === value);
    setActive(Math.max(0, at));
    setOpen(true);
  };
  const close = () => { setOpen(false); setQuery(''); };
  const pick = (resRef: string) => { close(); if (resRef !== value) onPick(resRef); };

  // The held item in view when it opens; the active one as the arrows move
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);
  // A click anywhere else closes it
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const typedResRef = () => {
    const s = query.trim().toLowerCase();
    const m = /\(([^)]+)\)\s*$/.exec(s);
    if (m) return m[1];
    return /^[a-z0-9_]{3,16}$/.test(s) ? s : null;
  };

  return (
    <div className="gm-picker" ref={root}>
      <input
        className="gm-input"
        aria-expanded={open}
        aria-controls={listId}
        role="combobox"
        value={open ? query : shown}
        placeholder={open ? 'Type to narrow the list…' : (value === null ? 'Mixed' : 'None')}
        onFocus={show}
        onMouseDown={() => { if (!open) show(); }}
        onChange={(e) => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) show(); else setActive((a) => Math.min(Math.min(matches.length, SHOWN) - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            const hit = matches[active];
            if (hit) pick(hit.resRef);
            else { const r = typedResRef(); if (r) pick(r); }
          }
          else if (e.key === 'Escape') { e.preventDefault(); close(); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'Tab') close();
        }}
      />
      <span className="gm-picker-caret" aria-hidden="true" onMouseDown={(e) => { e.preventDefault(); open ? close() : show(); }}>▾</span>
      {open && (
        <div className="gm-picker-list" id={listId} role="listbox" ref={list}>
          {matches.slice(0, SHOWN).map((i, n) => (
            <div
              key={i.resRef || 'none'}
              data-index={n}
              role="option"
              aria-selected={i.resRef === value}
              className={`gm-picker-option ${n === active ? 'active' : ''} ${i.resRef === value ? 'held' : ''}`}
              onMouseEnter={() => setActive(n)}
              onMouseDown={(e) => { e.preventDefault(); pick(i.resRef); }}
            >
              {i.label}
            </div>
          ))}
          {!matches.length && <div className="gm-picker-empty">{typedResRef() ? `Enter equips “${typedResRef()}”` : 'No item matches'}</div>}
          {matches.length > SHOWN && <div className="gm-picker-empty">{matches.length - SHOWN} more: type to narrow the list</div>}
        </div>
      )}
    </div>
  );
};

/** What one or more NPCs hold and wear, changeable any time: each slot shows the shared item, or "Mixed" */
export const GearEditor: React.FC<{ creatures: Creature[]; id: string }> = ({ creatures, id }) => {
  if (!creatures.length) return null;
  const slots: { key: 'RIGHTHAND' | 'LEFTHAND' | 'ARMOR'; label: string; items: Option[] }[] = [
    { key: 'RIGHTHAND', label: 'Weapon', items: GMManager.WEAPON_OPTIONS },
    { key: 'LEFTHAND', label: 'Off hand', items: GMManager.WEAPON_OPTIONS },
    { key: 'ARMOR', label: 'Armor or robes', items: GMManager.ARMOR_OPTIONS },
  ];
  const shared = (key: 'RIGHTHAND' | 'LEFTHAND' | 'ARMOR'): string | null => {
    const first = heldIn(creatures[0], key);
    return creatures.every((c) => heldIn(c, key) === first) ? first : null;
  };
  const equip = (key: 'RIGHTHAND' | 'LEFTHAND' | 'ARMOR', resRef: string) => {
    const slot = (KotOR.ModuleCreatureArmorSlot as any)[key] as number;
    for (const c of creatures) void GMSpawner.equipWeaponOnCreature(c, slot, resRef);
    GMManager.notifyChange();
  };
  return (
    <div className="gm-grid-2" title="Click a slot for every item of the kind; type to narrow it. Picking one equips it on each of them">
      {slots.map((s) => (
        <div className="gm-field" key={s.key}>
          <label>{s.label}</label>
          <ItemPicker items={s.items} value={shared(s.key)} onPick={(r) => equip(s.key, r)} listId={`${id}-${s.key}`} />
        </div>
      ))}
    </div>
  );
};

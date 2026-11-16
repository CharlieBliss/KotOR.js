import React, { useEffect, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { GMManager, GMSpawner } from "@/apps/game/components/gm-panel/gmPanelStore";

type Creature = KotOR.ModuleCreature;
type Option = { resRef: string; label: string };

/** The item in a slot, by whichever resref names it (a template's own item or one drawn later has no equipped one) */
const heldIn = (cre: Creature, slot: 'RIGHTHAND' | 'LEFTHAND' | 'ARMOR'): string =>
  ((cre.equipment as any)?.[slot]?.getItemResRef?.() || '').toLowerCase();

/**
 * Pick an item by typing: its name or resref, from every item of the kind the game has. The text box shows what
 * the creatures hold now ("Mixed" when they differ); Enter, or picking a suggestion, equips it.
 */
export const ItemPicker: React.FC<{ items: Option[]; value: string | null; onPick: (resRef: string) => void; listId: string }> = ({ items, value, onPick, listId }) => {
  const labelOf = (resRef: string) => items.find((i) => i.resRef === resRef)?.label || resRef;
  const shown = value === null ? '' : labelOf(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);

  const resolve = (t: string): string | null => {
    const s = t.trim().toLowerCase();
    if (!s) return '';
    const hit = items.find((i) => i.label.toLowerCase() === s || i.resRef.toLowerCase() === s);
    if (hit) return hit.resRef;
    // "Name (resref)" typed by hand, or a resref the list doesn't know
    const m = /\(([^)]+)\)\s*$/.exec(s);
    if (m) return m[1];
    return /^[a-z0-9_]{3,16}$/.test(s) ? s : null;
  };
  const commit = (t: string) => {
    const resRef = resolve(t);
    if (resRef === null) { setText(shown); return; }
    if (resRef !== value) onPick(resRef);
  };

  return (
    <>
      <input
        className="gm-input"
        list={listId}
        value={text}
        placeholder={value === null ? 'Mixed' : 'Type a name or resref…'}
        onChange={(e) => {
          setText(e.target.value);
          // Picking a suggestion sets the whole label at once: equip it straight away
          if (items.some((i) => i.label === e.target.value)) commit(e.target.value);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(text); if (e.key === 'Escape') setText(shown); }}
        onBlur={() => setText(shown)}
      />
      <datalist id={listId}>
        {items.map((i) => <option key={i.resRef || 'none'} value={i.label} />)}
      </datalist>
    </>
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
    <div className="gm-grid-2" title="Type to search every item of the kind; Enter equips it on each of them">
      {slots.map((s) => (
        <div className="gm-field" key={s.key}>
          <label>{s.label}</label>
          <ItemPicker items={s.items} value={shared(s.key)} onPick={(r) => equip(s.key, r)} listId={`${id}-${s.key}`} />
        </div>
      ))}
    </div>
  );
};

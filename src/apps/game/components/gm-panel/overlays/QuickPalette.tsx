import React, { useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import * as KotOR from "@/apps/game/KotOR";
import { GMManager, GMSpawner, GMHistory, GMEditTools, GMNpcOrders } from "@/apps/game/components/gm-panel/gmPanelStore";
import type { DrawerTab } from "@/apps/game/components/gm-panel/gmPanelStore";
import { armPlacement, orderableSelection, placeNow, recentPlacements } from "@/apps/game/components/gm-panel/controls/quickActions";
import type { GMRecentPlacement } from "@/apps/game/components/gm-panel/controls/quickActions";

interface PaletteEntry {
  id: string;
  label: string;
  detail: string;
  group: 'Recent' | 'Creature' | 'Object' | 'Template' | 'Command';
  /** Lower-case text the search matches against */
  haystack: string;
  placement?: GMRecentPlacement;
  run?: () => void;
}

const MAX_SHOWN = 40;

/** Every query word appears (in order of typing doesn't matter); names starting with the query come first */
function score(entry: PaletteEntry, words: string[], query: string): number {
  if (!words.length) return entry.group === 'Recent' ? 3 : entry.group === 'Command' ? 1 : 0;
  for (const w of words) if (!entry.haystack.includes(w)) return -1;
  const label = entry.label.toLowerCase();
  let s = 1;
  if (label === query) s += 10;
  else if (label.startsWith(query)) s += 6;
  else if (label.split(/\s+/).some((part) => part.startsWith(words[0]))) s += 3;
  if (entry.group === 'Recent') s += 2;
  if (entry.group === 'Creature' || entry.group === 'Object') s += 1;
  return s;
}

/** The GM's commands, as palette entries (what the top bar and the selection's buttons do) */
function commands(onOpenTab: (tab: DrawerTab) => void, onToggleTracker: () => void): PaletteEntry[] {
  const selection = GMManager.selectedObjects();
  const creatures = selection.filter((o) => KotOR.GMObjectKind.isCreature(o)) as KotOR.ModuleCreature[];
  const orderable = orderableSelection();
  const area = KotOR.GameState.module?.area;
  const inScene = (): KotOR.ModuleCreature[] => [...(area?.creatures || []), ...KotOR.GameState.PartyManager.party]
    .filter((c) => c && !c.isDead?.()) as KotOR.ModuleCreature[];
  const cmd = (id: string, label: string, detail: string, run: () => void, keywords = ''): PaletteEntry =>
    ({ id: `cmd:${id}`, label, detail, group: 'Command', haystack: `${label} ${detail} ${keywords}`.toLowerCase(), run });
  const list: PaletteEntry[] = [
    cmd('pause', GMManager.worldPaused ? 'Resume the world' : 'Pause the world', 'Freeze movement, combat and effects for everyone', () => { GMManager.worldPaused = !GMManager.worldPaused; GMManager.notifyChange(); }, 'unpause freeze stop time'),
    cmd('ai', GMManager.npcAiEnabled ? 'Turn NPC AI off' : 'Turn NPC AI on', 'Whether hostile NPCs pick fights on their own', () => { GMManager.npcAiEnabled = !GMManager.npcAiEnabled; GMManager.notifyChange(); }, 'npc ai fight'),
    cmd('watch', GMManager.playersFrozen ? 'Let players act again' : 'Players watch', "Players can't move or act, and NPCs leave them alone", () => GMManager.setPlayersFrozen(!GMManager.playersFrozen), 'freeze cutscene'),
    cmd('hidden', GMEditTools.placeHidden ? 'Place visible' : 'Place hidden', 'Whether new creatures and objects arrive hidden from players', () => { GMEditTools.placeHidden = !GMEditTools.placeHidden; GMManager.notifyChange(); }, 'reveal'),
    cmd('tracker', 'Combat tracker', 'Show or hide the list of who is fighting (T)', onToggleTracker, 'initiative fight battle'),
    cmd('undo', 'Undo', GMHistory.undoStack.length ? GMHistory.undoStack[GMHistory.undoStack.length - 1].label : 'Nothing to undo', () => void GMHistory.undo()),
    cmd('redo', 'Redo', GMHistory.redoStack.length ? GMHistory.redoStack[GMHistory.redoStack.length - 1].label : 'Nothing to redo', () => void GMHistory.redo()),
    cmd('sel-view', 'Select creatures on screen', 'Ctrl+A', () => GMManager.setSelection(GMEditTools.creaturesInView())),
    cmd('sel-hostile', 'Select every hostile', 'Every living hostile creature in the scene', () => GMManager.setSelection(inScene().filter((c) => c.factionId === KotOR.GMFaction.HOSTILE)), 'enemies'),
    cmd('sel-friendly', 'Select every friendly NPC', 'Friendly creatures, not players', () => GMManager.setSelection(inScene().filter((c) => c.factionId === KotOR.GMFaction.FRIENDLY && !c.gmOwnerPeerId && !KotOR.GMObjectKind.isPlayer(c))), 'allies'),
  ];
  for (const [tab, label] of [['scenes', 'Scene'], ['actors', 'Place'], ['players', 'Players'], ['inspector', 'Inspect'], ['multiplayer', 'Session']] as [DrawerTab, string][]) {
    list.push(cmd(`tab:${tab}`, `Open ${label}`, 'The drawer tab', () => onOpenTab(tab), 'tab panel'));
  }
  if (selection.length) {
    list.push(cmd('focus', 'Go to the selection', 'F', () => GMEditTools.focusCamera(selection), 'camera'));
  }
  if (creatures.length) {
    const track = (label: string, change: () => void) => GMHistory.track(`${label} ${GMHistory.nameOf(creatures)}`, creatures, change);
    list.push(
      cmd('heal', `Heal ${GMHistory.nameOf(creatures)}`, 'Full health and Force', () => track('Heal', () => creatures.forEach((c) => GMManager.healObject(c)))),
      cmd('hurt', `Hurt ${GMHistory.nameOf(creatures)}`, 'A quarter of their health (never below 1)', () => track('Hurt', () => creatures.forEach((c) => GMManager.hurtObject(c, 0.25))), 'damage'),
    );
    const npcs = creatures.filter((c) => !c.gmOwnerPeerId && !KotOR.GMObjectKind.isPlayer(c));
    for (const [label, id] of [['hostile', KotOR.GMFaction.HOSTILE], ['friendly', KotOR.GMFaction.FRIENDLY], ['neutral', KotOR.GMFaction.NEUTRAL]] as [string, number][]) {
      if (npcs.length) list.push(cmd(`side:${id}`, `Make ${GMHistory.nameOf(npcs)} ${label}`, 'Change side', () => GMHistory.track(`Change side of ${GMHistory.nameOf(npcs)}`, npcs, () => npcs.forEach((c) => GMManager.setObjectFaction(c, id))), 'faction side'));
    }
  }
  if (orderable.length) {
    const order = (label: string, make: (c: KotOR.ModuleCreature) => any) =>
      () => GMHistory.track(`Order ${GMHistory.nameOf(orderable)}`, orderable, () => orderable.forEach((c) => GMManager.giveOrder(c, make(c))));
    list.push(
      cmd('guard', `Order ${GMHistory.nameOf(orderable)} to guard`, 'Each guards the spot it stands on', order('guard', (c) => ({ kind: 'guard', point: GMManager.pointOf(c), radius: GMNpcOrders.GUARD_RADIUS }))),
      cmd('standdown', `Order ${GMHistory.nameOf(orderable)} to stand down`, 'Stop fighting, even if attacked', order('standDown', () => ({ kind: 'standDown' })), 'stop peace'),
      cmd('flee', `Order ${GMHistory.nameOf(orderable)} to flee`, 'Run from the nearest enemy', order('flee', () => ({ kind: 'flee' })), 'run retreat'),
      cmd('clear', `Clear ${GMHistory.nameOf(orderable)}'s orders`, 'Back to their own judgement', order('clear', () => undefined)),
    );
  }
  return list;
}

/**
 * Quick place and commands: type to find any creature preset, object, creature template or GM command. Enter
 * puts the creature or object down where the GM right-clicked (Search… in the menu), or picks up the Place tool
 * with it; a command runs. Opened with / or Ctrl+K in the GM camera.
 */
export const QuickPalette: React.FC<{
  open: boolean;
  point: THREE.Vector3 | null;
  onClose: () => void;
  onOpenTab: (tab: DrawerTab) => void;
  onToggleTracker: () => void;
}> = ({ open, point, onClose, onOpenTab, onToggleTracker }) => {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [templates, setTemplates] = useState<KotOR.GMCreatureTemplateInfo[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    // Every template in the game, read once
    if (!templates) GMSpawner.loadCreatureTemplateIndex().then((list) => setTemplates(list)).catch((): void => undefined);
  }, [open]);

  const placements = useMemo((): PaletteEntry[] => {
    if (!open) return [];
    const out: PaletteEntry[] = [];
    recentPlacements().forEach((r, i) => out.push({
      id: `recent:${i}`, label: r.label, detail: r.kind === 'creature' ? 'Placed lately · creature' : 'Placed lately · object',
      group: 'Recent', haystack: `${r.label} ${r.config?.templateResRef || ''}`.toLowerCase(), placement: r,
    }));
    for (const p of GMManager.CREATURE_PRESETS) {
      if (!GMManager.isPresetAvailable(p)) continue;
      out.push({
        id: `preset:${p.name}:${p.templateResRef}`, label: p.name, group: 'Creature',
        detail: `${KotOR.gmFactionName(p.factionId)} · level ${p.level} · ${p.hp} HP`,
        haystack: `${p.name} ${p.templateResRef || ''} ${KotOR.gmFactionName(p.factionId)}`.toLowerCase(),
        placement: { kind: 'creature', label: p.name, config: { ...p, customized: false } },
      });
    }
    for (const p of GMManager.PLACEABLE_PRESETS) {
      out.push({
        id: `object:${p.name}`, label: p.name, group: 'Object', detail: p.category ? `Object · ${p.category}` : 'Object',
        haystack: `${p.name} ${p.category || ''} ${(p.modelKeywords || []).join(' ')}`.toLowerCase(),
        placement: { kind: 'placeable', label: p.name, config: GMSpawner.copyPlaceablePreset(p) },
      });
    }
    for (const t of templates || []) {
      out.push({
        id: `template:${t.resRef}`, label: t.name || t.resRef, group: 'Template',
        detail: `${t.resRef} · ${KotOR.gmFactionName(t.factionId)} · ${t.classes || 'no class'} · ${t.hp} HP`,
        haystack: `${t.name} ${t.resRef} ${t.classes}`.toLowerCase(),
        placement: { kind: 'creature', label: t.name || t.resRef, config: GMSpawner.creatureConfigFromTemplate(t) },
      });
    }
    return out;
  }, [open, templates]);

  const entries = open ? [...commands(onOpenTab, onToggleTracker), ...placements] : [];
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const matches = entries
    .map((e) => ({ e, s: score(e, words, q) }))
    .filter((m) => m.s >= 0 && (words.length || m.e.group === 'Recent' || m.e.group === 'Command'))
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_SHOWN)
    .map((m) => m.e);
  const current = Math.min(index, Math.max(0, matches.length - 1));

  useEffect(() => {
    const el = listRef.current?.children[current] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [current, open]);

  if (!open) return null;

  const choose = (entry: PaletteEntry | undefined, keepPlacing = false) => {
    if (!entry) return;
    onClose();
    if (entry.run) { entry.run(); return; }
    if (!entry.placement) return;
    if (point && !keepPlacing) placeNow(entry.placement, point);
    else armPlacement(entry.placement);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(Math.min(current + 1, matches.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(current - 1, 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); choose(matches[current], e.shiftKey); }
    // Keep the GM's other keys (WASD, digits, Delete) out of the game while typing
    e.stopPropagation();
  };

  const placingHint = point ? 'Enter: place it where you right-clicked · Shift+Enter: pick up the Place tool' : 'Enter: pick up the Place tool (click the ground to put it down)';
  return (
    <div className="gm-palette-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gm-palette" role="dialog" aria-label="Quick place and commands">
        <input
          ref={inputRef}
          className="gm-input gm-palette-input"
          placeholder={point ? 'Place here: creature, object or template…' : 'Find a creature, object, template or command…'}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
          onKeyDown={onKeyDown}
        />
        <div className="gm-palette-list" ref={listRef}>
          {!matches.length && <div className="gm-hint">{templates ? 'Nothing matches.' : 'Nothing matches yet (still reading the creature templates)…'}</div>}
          {matches.map((m, i) => (
            <div
              key={m.id}
              className={`gm-palette-item ${i === current ? 'active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={(e) => choose(m, e.shiftKey)}
            >
              <span className={`gm-palette-group g-${m.group.toLowerCase()}`}>{m.group}</span>
              <span className="gm-palette-label">{m.label}</span>
              <span className="gm-palette-detail">{m.detail}</span>
            </div>
          ))}
        </div>
        <div className="gm-palette-foot">↑↓ choose · {placingHint} · Esc close</div>
      </div>
    </div>
  );
};

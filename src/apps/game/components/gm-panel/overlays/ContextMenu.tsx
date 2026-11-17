import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import * as KotOR from "@/apps/game/KotOR";
import { GMManager, GMViewport, GMHistory, GMEditTools, GMNpcOrders, GMSetPieces } from "@/apps/game/components/gm-panel/gmPanelStore";
import { deleteSelection } from "@/apps/game/components/gm-panel/controls/editShortcuts";
import { orderableSelection, placeNow, recentPlacements } from "@/apps/game/components/gm-panel/controls/quickActions";

interface MenuRequest {
  x: number;
  y: number;
  target: KotOR.ModuleObject | null;
  point: THREE.Vector3 | null;
}

type MenuItem =
  | { kind: 'heading'; label: string; note?: string }
  | { kind: 'sep' }
  | { kind: 'row'; items: MenuAction[] }
  | MenuAction;

interface MenuAction {
  kind?: 'action';
  label: string;
  title?: string;
  tone?: 'danger' | 'warning' | 'success';
  run: () => void;
}

const name = (o: KotOR.ModuleObject | null | undefined) => o?.getName?.() || (o as any)?.firstName || o?.getTag?.() || 'Object';
const short = (list: KotOR.ModuleObject[]) => (list.length === 1 ? name(list[0]) : `${list.length} selected`);
/** A character a player plays (or the GM's own): no side to change */
const isPlayerCharacter = (cre: KotOR.ModuleObject): boolean => !!cre.gmOwnerPeerId || KotOR.GMObjectKind.isPlayer(cre);

/** One undoable step over these objects */
const track = (label: string, objs: KotOR.ModuleObject[], change: () => unknown) => {
  if (objs.length) GMHistory.track(`${label} ${GMHistory.nameOf(objs)}`, objs, change);
};

/** What the menu offers for a creature, an object, or the ground */
function buildItems(req: MenuRequest, openPalette: (point: THREE.Vector3 | null) => void): MenuItem[] {
  const items: MenuItem[] = [];
  const { target, point } = req;
  const subjects = orderableSelection(target);

  if (target && KotOR.GMObjectKind.isCreature(target)) {
    const cre = target as KotOR.ModuleCreature;
    const netId = cre.gmNetId;
    const isPlayer = isPlayerCharacter(cre);
    items.push({ kind: 'heading', label: name(cre), note: `${cre.getHP()}/${cre.getMaxHP()} HP · ${KotOR.gmFactionName(cre.factionId)}${cre.gmHidden ? ' · hidden' : ''}` });

    // The selected NPCs act on it
    if (subjects.length && netId && !cre.isDead()) {
      items.push({ kind: 'row', items: [
        { label: `${short(subjects)}: attack`, tone: 'warning', title: `The selected NPCs attack ${name(cre)} until it's down`, run: () => track('Order', subjects, () => subjects.forEach((s) => GMManager.giveOrder(s, { kind: 'attack', targetNetId: netId }))) },
        { label: 'follow', title: `The selected NPCs follow ${name(cre)}`, run: () => track('Order', subjects, () => subjects.forEach((s) => GMManager.giveOrder(s, { kind: 'follow', targetNetId: netId }))) },
      ] });
      items.push({ kind: 'sep' });
    }

    // Its own orders
    if (GMManager.canOrder(cre)) {
      const order = GMNpcOrders.getOrder(cre);
      items.push({ kind: 'row', items: [
        { label: 'Guard', title: 'Guard the spot it stands on', run: () => track('Order', [cre], () => GMManager.giveOrder(cre, { kind: 'guard', point: GMManager.pointOf(cre), radius: GMNpcOrders.GUARD_RADIUS })) },
        { label: 'Stand down', tone: 'warning', title: "Stop fighting, even if attacked", run: () => track('Order', [cre], () => GMManager.giveOrder(cre, { kind: 'standDown' })) },
        { label: 'Flee', tone: 'warning', title: 'Run from the nearest enemy', run: () => track('Order', [cre], () => GMManager.giveOrder(cre, { kind: 'flee' })) },
        ...(order ? [{ label: 'Clear order', title: `Now: ${GMNpcOrders.describe(order)}. Back to its own judgement`, run: () => track('Order', [cre], () => GMManager.giveOrder(cre, undefined)) }] : []),
      ] });
      items.push({ label: 'Move it…', title: 'Click the ground: it walks there, then guards the spot', run: () => GMViewport.startOrderTool('order_move', cre) });
    }

    // Its side
    if (!isPlayer) {
      const sides: [string, number][] = [['Hostile', KotOR.GMFaction.HOSTILE], ['Friendly', KotOR.GMFaction.FRIENDLY], ['Neutral', KotOR.GMFaction.NEUTRAL]];
      items.push({ kind: 'row', items: sides.filter(([, id]) => id !== cre.factionId).map(([label, id]) => ({
        label, tone: id === KotOR.GMFaction.HOSTILE ? 'danger' as const : undefined, title: `Make it ${label.toLowerCase()}`,
        run: () => track('Change side of', [cre], () => GMManager.setObjectFaction(cre, id)),
      })) });
    }

    // Its health
    items.push({ kind: 'row', items: [
      { label: 'Heal', tone: 'success', title: 'Full health and Force', run: () => track('Heal', [cre], () => GMManager.healObject(cre)) },
      { label: 'Hurt ¼', title: 'Take a quarter of its health off (never below 1)', run: () => track('Hurt', [cre], () => GMManager.hurtObject(cre, 0.25)) },
      { label: 'Kill', tone: 'danger', run: () => track('Kill', [cre], () => GMManager.killObject(cre)) },
    ] });
    items.push({ kind: 'sep' });
  } else if (target) {
    items.push({ kind: 'heading', label: name(target), note: target.gmHidden ? 'hidden' : undefined });
  }

  if (target) {
    items.push({ kind: 'row', items: [
      { label: 'Select', run: () => GMManager.selectObject(target) },
      { label: 'Add', title: 'Add it to the selection', run: () => GMManager.selectObject(target, 'add') },
      { label: 'Inspect', title: 'Open it in the Inspect tab', run: () => { GMManager.selectObject(target); GMManager.events.dispatchEvent('inspect', target); } },
    ] });
    items.push({ kind: 'row', items: [
      { label: target.gmHidden ? 'Show to players' : 'Hide from players', run: () => track('Hide or reveal', [target], () => GMManager.setObjectHidden(target, !target.gmHidden)) },
      { label: 'Duplicate', run: () => void GMEditTools.duplicate([target]) },
      ...(GMManager.isDeletable(target) ? [{ label: 'Delete', tone: 'danger' as const, run: () => deleteSelection([target]) }] : []),
    ] });
    return items;
  }

  // The ground
  if (!point) {
    items.push({ kind: 'heading', label: 'Nothing here', note: 'Right-click the ground or a creature' });
    return items;
  }
  const selection = GMViewport.movableSelection();
  if (subjects.length || selection.length) {
    items.push({ kind: 'heading', label: short(subjects.length ? subjects : selection) });
    const row: MenuAction[] = [];
    if (subjects.length) {
      row.push({
        label: 'Move here', tone: 'warning', title: 'They walk here, keeping their layout, then guard it',
        run: () => {
          const centre = GMViewport.groupPoint(subjects);
          const at = { x: point.x, y: point.y, z: point.z };
          track('Send', subjects, () => subjects.forEach((s) => GMManager.giveOrder(s, { kind: 'move', point: subjects.length > 1 ? GMViewport.offsetPoint(at, s, centre) : at })));
        },
      });
    }
    if (selection.length) {
      row.push({
        label: 'Teleport here', title: 'Put them here now, keeping their layout',
        run: () => {
          const centre = GMEditTools.centreOf(selection);
          track('Teleport', selection, () => selection.forEach((o) => {
            const to = new THREE.Vector3(point.x + o.position.x - centre.x, point.y + o.position.y - centre.y, point.z);
            to.z = GMViewport.getGroundZAt(to.x, to.y, point.z);
            GMManager.teleportObject(o, to);
          }));
        },
      });
      row.push({ label: 'Face here', run: () => GMEditTools.faceToward(selection, point.clone()) });
    }
    items.push({ kind: 'row', items: row });
    items.push({ kind: 'sep' });
  }

  // A set piece here (rooms of another area), or the one picked in the Place tab's Sets
  const host = KotOR.GMNetworkManager.role !== 'client';
  const set = host ? GMSetPieces.setAt(point) : undefined;
  if (set) {
    items.push({ kind: 'heading', label: `Set: ${GMSetPieces.describe(set)}`, note: `${set.seams.length} joins with this area` });
    items.push({ kind: 'row', items: [
      { label: 'Turn 90°', title: 'Turn it clockwise about its middle', run: () => void GMSetPieces.move(set.id, { turnBy: -Math.PI / 2 }) },
      { label: 'Up', title: 'Raise it 0.25 m', run: () => void GMSetPieces.move(set.id, { by: { z: 0.25 } }) },
      { label: 'Down', title: 'Lower it 0.25 m', run: () => void GMSetPieces.move(set.id, { by: { z: -0.25 } }) },
      { label: 'Pick', title: "Pick it in the Place tab's Sets, to move it", run: () => { GMSetPieces.selectedId = set.id; GMManager.notifyChange(); } },
      { label: 'Remove', tone: 'danger', run: () => void GMSetPieces.remove(set.id) },
    ] });
    items.push({ kind: 'sep' });
  }
  const picked = host ? GMSetPieces.selected() : undefined;
  if (picked && picked !== set) {
    items.push({ label: `Move set ${GMSetPieces.describe(picked)} here`, title: 'The middle of its floor goes here', run: () => void GMSetPieces.move(picked.id, { to: { x: point.x, y: point.y, z: point.z } }) });
  }

  items.push({ kind: 'heading', label: 'Place here' });
  const pending = GMManager.pendingCreatureConfig;
  const shown = new Set<string>();
  const place: MenuAction[] = [];
  if (pending?.name || pending?.templateResRef) {
    const label = pending.name || pending.templateResRef;
    shown.add(`creature:${label}`);
    place.push({ label, title: "The Place tab's creature", run: () => placeNow({ kind: 'creature', label, config: pending }, point) });
  }
  for (const r of recentPlacements()) {
    const key = `${r.kind}:${r.label}`;
    if (shown.has(key) || place.length >= 5) continue;
    shown.add(key);
    place.push({ label: r.label, title: `Placed lately (${r.kind === 'creature' ? 'creature' : 'object'})`, run: () => placeNow(r, point) });
  }
  for (const p of place) items.push(p);
  if (host && GMManager.lastPlacementTool === 'place_set') {
    items.push({ label: `Set: ${GMSetPieces.describe(GMSetPieces.pending)}`, title: "The Place tab's set: the middle of its floor goes here", run: () => void GMSetPieces.place(GMSetPieces.pending, point.clone(), -(GMViewport.placementYawOffset * Math.PI) / 180) });
  }
  items.push({ label: 'Search…', title: 'Find any creature or object and put it here (/ opens this anywhere)', run: () => openPalette(point.clone()) });
  return items;
}

/**
 * The GM's right-click menu in the viewport: orders, sides, health and editing for what was clicked, or moving the
 * selection and placing things at the spot. Everything that changes the scene is one undoable step.
 */
export const ContextMenu: React.FC<{ onOpenPalette: (point: THREE.Vector3 | null) => void }> = ({ onOpenPalette }) => {
  const [req, setReq] = useState<MenuRequest | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOpen = (r: MenuRequest) => setReq(r);
    GMManager.events.addEventListener('context-menu', onOpen);
    return () => GMManager.events.removeEventListener('context-menu', onOpen);
  }, []);

  // Closes on a click elsewhere, Esc, the wheel, or a tool being picked up
  useEffect(() => {
    if (!req) return;
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'pointerdown' && ref.current && ref.current.contains(e.target as Node)) return;
      if (e.type === 'keydown') { e.preventDefault(); e.stopPropagation(); }
      setReq(null);
    };
    // A tick later: the right-click's own pointerup is still going round
    const t = setTimeout(() => {
      window.addEventListener('pointerdown', close, true);
      window.addEventListener('wheel', close, true);
      window.addEventListener('keydown', close, true);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('keydown', close, true);
    };
  }, [req]);

  // Kept on screen
  useLayoutEffect(() => {
    if (!req || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(req.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(req.y, window.innerHeight - r.height - 8)),
    });
  }, [req]);

  if (!req) return null;
  const items = buildItems(req, onOpenPalette);
  const run = (a: MenuAction) => { setReq(null); a.run(); };
  const button = (a: MenuAction, i: number) => (
    <button key={i} className={`gm-btn small ${a.tone || ''}`} title={a.title} onClick={() => run(a)}>{a.label}</button>
  );

  return (
    <div ref={ref} className="gm-context-menu" style={{ left: pos.left, top: pos.top }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) => {
        if (item.kind === 'heading') return <div key={i} className="gm-context-heading">{item.label}{item.note && <span>{item.note}</span>}</div>;
        if (item.kind === 'sep') return <div key={i} className="gm-context-sep" />;
        if (item.kind === 'row') return item.items.length ? <div key={i} className="gm-context-row">{item.items.map(button)}</div> : null;
        return <button key={i} className={`gm-context-item ${item.tone || ''}`} title={item.title} onClick={() => run(item)}>{item.label}</button>;
      })}
    </div>
  );
};

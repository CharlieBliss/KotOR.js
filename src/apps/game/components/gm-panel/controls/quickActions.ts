import * as THREE from "three";
import * as KotOR from "@/apps/game/KotOR";
import { GMManager, GMViewport } from "@/apps/game/components/gm-panel/gmPanelStore";

/** Something the GM placed lately, to place again (the quick-place palette, the right-click menu) */
export interface GMRecentPlacement {
  kind: 'creature' | 'placeable';
  label: string;
  config: any;
}

const STORAGE_KEY = 'gm.recentPlacements';
const MAX_RECENT = 8;
let recent: GMRecentPlacement[] | null = null;

function load(): GMRecentPlacement[] {
  if (recent) return recent;
  recent = [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) recent = list.filter((r) => r && (r.kind === 'creature' || r.kind === 'placeable') && r.config);
  } catch (e) {}
  return recent;
}

function save() {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recent || [])); } catch (e) {}
}

/** What was placed lately, newest first */
export function recentPlacements(): GMRecentPlacement[] {
  return load();
}

/** Remember a placement (the same thing again moves to the front) */
export function rememberPlacement(entry: GMRecentPlacement) {
  const list = load();
  const key = (r: GMRecentPlacement) => `${r.kind}:${r.config?.templateResRef || ''}:${r.label}`;
  const k = key(entry);
  recent = [entry, ...list.filter((r) => key(r) !== k)].slice(0, MAX_RECENT);
  save();
}

let wired = false;
/** Keep the recent list from everything placed, however it was placed (the Place tab too) */
export function wireRecentPlacements() {
  if (wired) return;
  wired = true;
  GMManager.events.addEventListener('placed', (obj: KotOR.ModuleObject) => {
    const config = obj?.gmSpawnConfig;
    if (!config || KotOR.GMObjectKind.isPlayer(obj)) return;
    const kind = KotOR.GMObjectKind.isCreature(obj) ? 'creature' : KotOR.GMObjectKind.isPlaceable(obj) ? 'placeable' : null;
    if (!kind) return;
    rememberPlacement({ kind, label: (config as any).name || obj.getName?.() || 'Object', config: { ...config } });
  });
}

/** Arm the Place tool with this: the next click on the ground puts it down */
export function armPlacement(entry: GMRecentPlacement) {
  if (entry.kind === 'creature') {
    GMManager.pendingCreatureConfig = { ...entry.config, customized: !!entry.config.customized };
    GMManager.setToolMode('place_creature');
  } else {
    GMManager.pendingPlaceableConfig = { ...entry.config };
    GMManager.setToolMode('place_placeable');
  }
}

/** Put it down at a point now (the spot that was right-clicked) */
export function placeNow(entry: GMRecentPlacement, point: { x: number; y: number; z: number }) {
  void GMViewport.placeAt(entry.kind, { ...entry.config }, new THREE.Vector3(point.x, point.y, point.z));
}

/** The selected NPCs that can take orders, leaving out one (the creature they'd act on) */
export function orderableSelection(except?: KotOR.ModuleObject | null): KotOR.ModuleCreature[] {
  return GMManager.selectedObjects().filter((o) => o !== except && GMManager.canOrder(o)) as KotOR.ModuleCreature[];
}

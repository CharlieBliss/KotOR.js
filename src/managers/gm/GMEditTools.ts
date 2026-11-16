import * as THREE from "three";
import type { ModuleObject, ModuleCreature } from "@/module";
import { GameState } from "@/GameState";
import { GMManager } from "@/managers/GMManager";
import { GMViewport } from "@/managers/gm/GMViewport";
import { GMHistory, GMObjectSnapshot } from "@/managers/gm/GMHistory";
import { GMSpawner } from "@/managers/gm/GMSpawner";
import { GMObjectKind } from "@/managers/gm/GMObjectKind";
import { GMCombatAI } from "@/managers/gm/GMCombatAI";
import { GMLog } from "@/managers/gm/GMLog";
import { Utility } from "@/utility/Utility";

/** A copied object: how it was, and where it stood from the middle of what was copied */
interface GMClipboardEntry { state: GMObjectSnapshot; dx: number; dy: number }

/**
 * The GM's editing tools that work on the selection: copy and paste, pinning scenery, saved groups,
 * facing and lining up, turning a group, and pointing the camera at it. Each change is a step of GMHistory.
 */
export class GMEditTools {
  static clipboard: GMClipboardEntry[] = [];

  /** New creatures and objects arrive hidden from players, to be revealed together later */
  static placeHidden = false;

  /** Saved groups, by number key (1 to 9) */
  static groups = new Map<number, ModuleObject[]>();

  /** Metres between objects lined up */
  static LINE_SPACING = 1.5;

  static centreOf(list: ModuleObject[]): THREE.Vector3 {
    const c = new THREE.Vector3();
    if (!list.length) return c;
    for (const o of list) c.add(o.position);
    return c.divideScalar(list.length);
  }

  /** What copy, line up and the rest act on: the selection, without players' characters for copying */
  static copyable(list: ModuleObject[]): ModuleObject[] {
    return list.filter((o) => GMHistory.trackable(o));
  }

  static copy(list: ModuleObject[] = GMManager.selectedObjects()): number {
    const objs = this.copyable(list);
    if (!objs.length) return 0;
    const c = this.centreOf(objs);
    this.clipboard = objs
      .map((o) => ({ state: GMHistory.snapshot(o)!, dx: o.position.x - c.x, dy: o.position.y - c.y }))
      .filter((e) => e.state);
    GMLog.info('world', `Copied ${this.clipboard.length}`);
    GMManager.notifyChange();
    return this.clipboard.length;
  }

  /** Spawn the clipboard around a point, keeping how it was laid out; the copies become the selection */
  static async paste(at?: THREE.Vector3 | null, label = 'Paste'): Promise<ModuleObject[]> {
    if (!this.clipboard.length) return [];
    const centre = at || (GMViewport.hasValidRaycastPoint ? GMViewport.lastRaycastPoint.clone() : null);
    if (!centre) return [];
    const made: ModuleObject[] = [];
    for (const entry of this.clipboard) {
      const x = centre.x + entry.dx, y = centre.y + entry.dy;
      const pos = new THREE.Vector3(x, y, GMViewport.floorBelow(x, y, centre.z));
      const obj = await GMSpawner.spawnDescribed(entry.state.described, pos, entry.state.facing);
      if (!obj) continue;
      if (entry.state.hidden || this.placeHidden) GMManager.setObjectHidden(obj, true);
      if (GMObjectKind.isCreature(obj)) {
        const cre = obj as ModuleCreature;
        if (entry.state.factionId !== undefined) GMManager.setObjectFaction(cre, entry.state.factionId);
        if (entry.state.combatStyle && entry.state.combatStyle !== 'all') GMCombatAI.setStyle(cre, entry.state.combatStyle);
      }
      if (entry.state.scale !== 1) GMManager.setObjectScale(obj, entry.state.scale);
      made.push(obj);
    }
    GMHistory.created(`${label} ${GMHistory.nameOf(made)}`, made);
    GMManager.setSelection(made);
    return made;
  }

  /** Copy the selection and paste it next to itself */
  static async duplicate(list: ModuleObject[] = GMManager.selectedObjects()): Promise<ModuleObject[]> {
    const objs = this.copyable(list);
    if (!objs.length) return [];
    const saved = this.clipboard;
    this.copy(objs);
    const c = this.centreOf(objs);
    const made = await this.paste(new THREE.Vector3(c.x + 1.5, c.y + 1.0, c.z), 'Duplicate');
    this.clipboard = saved.length ? saved : this.clipboard;
    return made;
  }

  /** Pin or unpin: pinned scenery can't be clicked, boxed, dragged or deleted in the scene */
  static setPinned(list: ModuleObject[], pinned: boolean) {
    GMHistory.track(`${pinned ? 'Pin' : 'Unpin'} ${GMHistory.nameOf(list)}`, list, () => {
      for (const o of list) o.gmPinned = pinned || undefined;
    });
    GMManager.notifyChange();
  }

  /** Pin everything the scene came with (its own placeables), so only what the GM added is in the way */
  static pinSceneObjects(): number {
    const area = GameState.module?.area;
    if (!area) return 0;
    const list = area.placeables.filter((p) => p && !p.destroyed && !p.gmSpawnConfig && !p.gmPinned);
    if (list.length) this.setPinned(list, true);
    return list.length;
  }

  static saveGroup(n: number, list: ModuleObject[] = GMManager.selectedObjects()) {
    if (!list.length) this.groups.delete(n);
    else this.groups.set(n, [...list]);
    GMLog.info('world', list.length ? `Group ${n}: ${GMHistory.nameOf(list)}` : `Group ${n} cleared`);
    GMManager.notifyChange();
  }

  /** A saved group's members still in the scene (an undone delete brings its new self back into it) */
  static groupMembers(n: number): ModuleObject[] {
    const list = (this.groups.get(n) || []).map((o) => (o.destroyed ? GMHistory.refs.get(o)?.obj || null : o));
    return list.filter((o): o is ModuleObject => !!o && !o.destroyed);
  }

  static recallGroup(n: number, add = false): ModuleObject[] {
    const members = this.groupMembers(n);
    if (!members.length) return [];
    GMManager.setSelection(add ? [...GMManager.selectedObjects(), ...members] : members);
    return members;
  }

  /** Turn each to face a point (or a creature: where it stands) */
  static faceToward(list: ModuleObject[], point: THREE.Vector3) {
    const objs = list.filter((o) => !GMObjectKind.isDoor(o) && o.position.distanceTo(point) > 0.05);
    GMHistory.track(`Turn ${GMHistory.nameOf(objs)} to face`, objs, () => {
      for (const o of objs) {
        const facing = Math.atan2(o.position.y - point.y, o.position.x - point.x) + Math.PI / 2;
        GMManager.rotateObject(o, Utility.NormalizeRadian(facing - GMSpawner.facingOf(o)));
      }
    });
  }

  /** Turn the group around its middle, keeping its layout, each also turning with it */
  static rotateAround(list: ModuleObject[], radians: number) {
    const objs = list.filter((o) => !GMObjectKind.isDoor(o));
    if (!objs.length) return;
    const c = this.centreOf(objs);
    const cos = Math.cos(radians), sin = Math.sin(radians);
    GMHistory.track(`Turn ${GMHistory.nameOf(objs)}`, objs, () => {
      for (const o of objs) {
        const dx = o.position.x - c.x, dy = o.position.y - c.y;
        const x = c.x + dx * cos - dy * sin, y = c.y + dx * sin + dy * cos;
        GMManager.teleportObject(o, new THREE.Vector3(x, y, GMViewport.floorBelow(x, y, o.position.z)));
        GMManager.rotateObject(o, radians);
      }
    });
  }

  /** Spread them in a line across the view through their middle, in the order they stand left to right */
  static lineUp(list: ModuleObject[]) {
    const objs = list.filter((o) => !GMObjectKind.isDoor(o));
    if (objs.length < 2) return;
    const cam = GMViewport.getActiveThreeCamera();
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    fwd.z = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 1, 0);
    fwd.normalize();
    const right = new THREE.Vector3(fwd.y, -fwd.x, 0);
    const c = this.centreOf(objs);
    const sorted = [...objs].sort((a, b) => a.position.clone().sub(c).dot(right) - b.position.clone().sub(c).dot(right));
    GMHistory.track(`Line up ${GMHistory.nameOf(objs)}`, objs, () => {
      sorted.forEach((o, i) => {
        const along = (i - (sorted.length - 1) / 2) * this.LINE_SPACING;
        const x = c.x + right.x * along, y = c.y + right.y * along;
        GMManager.teleportObject(o, new THREE.Vector3(x, y, GMViewport.floorBelow(x, y, o.position.z)));
      });
    });
  }

  /** Bring the free camera to the selection, looking the way it already looks */
  static focusCamera(list: ModuleObject[] = GMManager.selectedObjects()) {
    if (!list.length || GMManager.controlMode === 'POSSESS') return;
    const cam = GMViewport.getActiveThreeCamera();
    const c = this.centreOf(list);
    c.z += 1;
    const spread = Math.max(...list.map((o) => o.position.distanceTo(c)), 0);
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    cam.position.copy(c).addScaledVector(fwd, -Math.max(6, spread * 2.2));
    cam.updateMatrixWorld();
  }

  /** Every creature on screen the GM can pick (not pinned, not hidden behind the camera) */
  static creaturesInView(): ModuleObject[] {
    const canvas = GameState.canvas;
    if (!canvas) return [];
    const r = canvas.getBoundingClientRect();
    return GMViewport.objectsInBox(r.left, r.top, r.right, r.bottom).filter((o) => GMObjectKind.isCreature(o));
  }
}

import * as THREE from "three";
import type { ModuleObject, ModuleCreature } from "@/module";
import { GMManager } from "@/managers/GMManager";
import { GMSpawner } from "@/managers/gm/GMSpawner";
import { GMNpcOrders } from "@/managers/GMNpcOrders";
import { GMCombatAI } from "@/managers/gm/GMCombatAI";
import { GMObjectKind } from "@/managers/gm/GMObjectKind";
import { GMLog } from "@/managers/gm/GMLog";
import type { GMNpcOrder } from "@/managers/GMNpcOrders";

/** An object as it was at one moment: enough to put it back that way, or to spawn it again */
export interface GMObjectSnapshot {
  described: NonNullable<ReturnType<typeof GMSpawner.describeObject>>;
  x: number; y: number; z: number;
  facing: number;
  factionId?: number;
  hp?: number;
  maxHp?: number;
  dead?: boolean;
  hidden: boolean;
  pinned: boolean;
  scale: number;
  stance?: string;
  combatStyle?: 'all' | 'weapons' | 'attack';
  scripted?: boolean;
  order?: GMNpcOrder;
}

/**
 * One object across the history. Undoing a delete spawns it again as a new object; the ref follows it, so
 * earlier and later changes to it still find it.
 */
export interface GMHistoryRef { obj: ModuleObject | null }

export interface GMHistoryEntry {
  label: string;
  at: number;
  refs: GMHistoryRef[];
  before: (GMObjectSnapshot | null)[];
  after: (GMObjectSnapshot | null)[];
}

/** A change being made (a drag, a paste): what the objects were like when it began */
export interface GMHistoryChange {
  commit(created?: ModuleObject[]): void;
}

/**
 * The GM's undo and redo, and the log of what changed. Every change the GM makes with the tools goes through
 * track(), begin() or created(): the objects it touches are snapshotted before and after, and undo puts the
 * before back (spawning what was deleted, removing what was made), redo the after.
 */
export class GMHistory {
  static LIMIT = 100;

  /** Changes to the same objects with the same label this close together are one step (wheel turns, nudges) */
  static MERGE_MS = 1200;

  static undoStack: GMHistoryEntry[] = [];

  static redoStack: GMHistoryEntry[] = [];

  static refs = new Map<ModuleObject, GMHistoryRef>();

  /** Undo or redo is putting objects back: their own changes aren't new history */
  static applying = false;

  static busy = false;

  static refFor(obj: ModuleObject): GMHistoryRef {
    let ref = this.refs.get(obj);
    if (!ref) {
      ref = { obj };
      this.refs.set(obj, ref);
    }
    return ref;
  }

  static snapshot(obj: ModuleObject | null): GMObjectSnapshot | null {
    if (!obj || obj.destroyed) return null;
    const described = GMSpawner.describeObject(obj);
    if (!described) return null;
    const isCreature = GMObjectKind.isCreature(obj);
    const cre = obj as ModuleCreature;
    const order = isCreature ? GMNpcOrders.getOrder(cre) : undefined;
    return {
      described,
      x: obj.position.x, y: obj.position.y, z: obj.position.z,
      facing: GMSpawner.facingOf(obj),
      factionId: isCreature ? cre.factionId : undefined,
      hp: isCreature ? cre.getHP() : undefined,
      maxHp: isCreature ? cre.getMaxHP() : undefined,
      dead: isCreature ? !!cre.isDead?.() : undefined,
      hidden: !!obj.gmHidden,
      pinned: !!obj.gmPinned,
      scale: obj.gmScale || 1,
      stance: isCreature ? GMManager.stanceOf(cre) || undefined : undefined,
      combatStyle: isCreature ? cre.gmCombatStyle || 'all' : undefined,
      scripted: isCreature ? !!cre.gmScripted : undefined,
      order: order ? JSON.parse(JSON.stringify(order)) : undefined,
    };
  }

  /** Is this something history can follow? (players' characters come and go with their players) */
  static trackable(obj: ModuleObject | null | undefined): obj is ModuleObject {
    return !!obj && !GMManager.isPlayerCharacter(obj) && !!GMSpawner.describeObject(obj);
  }

  /** Make a change to some objects, as one step of history */
  static track<T>(label: string, objs: (ModuleObject | null | undefined)[], change: () => T): T {
    const step = this.begin(label, objs);
    const result = change();
    step.commit();
    return result;
  }

  /** Start a change that ends later (a drag, an async paste); commit() records it, with anything it made */
  static begin(label: string, objs: (ModuleObject | null | undefined)[]): GMHistoryChange {
    if (this.applying) return { commit: () => {} };
    const refs = [...new Set(objs.filter((o) => this.trackable(o)))].map((o) => this.refFor(o as ModuleObject));
    const before = refs.map((r) => this.snapshot(r.obj));
    return {
      commit: (created: ModuleObject[] = []) => {
        const made = created.filter((o) => this.trackable(o)).map((o) => this.refFor(o));
        const all = [...refs, ...made];
        const entry: GMHistoryEntry = {
          label, at: Date.now(), refs: all,
          before: [...before, ...made.map((): GMObjectSnapshot | null => null)],
          after: all.map((r) => this.snapshot(r.obj)),
        };
        this.push(entry);
      },
    };
  }

  /** Objects just made (placed, pasted): undo removes them */
  static created(label: string, objs: (ModuleObject | null | undefined)[]) {
    this.begin(label, []).commit(objs.filter(Boolean) as ModuleObject[]);
  }

  static push(entry: GMHistoryEntry) {
    // Nothing changed: not a step
    if (entry.before.every((b, i) => JSON.stringify(b) === JSON.stringify(entry.after[i]))) return;
    const last = this.undoStack[this.undoStack.length - 1];
    if (last && last.label === entry.label && entry.at - last.at < this.MERGE_MS &&
      last.refs.length === entry.refs.length && last.refs.every((r, i) => r === entry.refs[i])) {
      last.after = entry.after;
      last.at = entry.at;
    } else {
      this.undoStack.push(entry);
      if (this.undoStack.length > this.LIMIT) this.undoStack.shift();
    }
    this.redoStack = [];
    GMManager.notifyChange();
  }

  static canUndo(): boolean { return !this.busy && this.undoStack.length > 0; }

  static canRedo(): boolean { return !this.busy && this.redoStack.length > 0; }

  static async undo(): Promise<string | null> {
    if (!this.canUndo()) return null;
    const entry = this.undoStack.pop()!;
    await this.restore(entry, entry.before);
    this.redoStack.push(entry);
    GMLog.info('history', `Undid: ${entry.label}`);
    GMManager.notifyChange();
    return entry.label;
  }

  static async redo(): Promise<string | null> {
    if (!this.canRedo()) return null;
    const entry = this.redoStack.pop()!;
    await this.restore(entry, entry.after);
    this.undoStack.push(entry);
    GMLog.info('history', `Redid: ${entry.label}`);
    GMManager.notifyChange();
    return entry.label;
  }

  /** A new scene: what was here is gone, and so is its history */
  static clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.refs.clear();
    GMManager.notifyChange();
  }

  static async restore(entry: GMHistoryEntry, states: (GMObjectSnapshot | null)[]) {
    this.busy = true;
    this.applying = true;
    try {
      for (let i = 0; i < entry.refs.length; i++) await this.apply(entry.refs[i], states[i]);
    } finally {
      this.applying = false;
      this.busy = false;
    }
  }

  /** Put one object the way a snapshot has it: removed, spawned again, or changed back */
  static async apply(ref: GMHistoryRef, state: GMObjectSnapshot | null) {
    let obj = ref.obj && !ref.obj.destroyed ? ref.obj : null;
    if (!state) {
      if (obj) GMManager.deleteObject(obj);
      return;
    }
    // A creature brought back from the dead comes back as new
    if (obj && GMObjectKind.isCreature(obj) && (obj as ModuleCreature).isDead?.() && !state.dead) {
      GMManager.deleteObject(obj);
      obj = null;
    }
    const pos = new THREE.Vector3(state.x, state.y, state.z);
    if (!obj) {
      obj = await GMSpawner.spawnDescribed(state.described, pos, state.facing);
      if (!obj) return;
      // The old object keeps pointing here too, so groups and earlier steps holding it find the new one
      ref.obj = obj;
      this.refs.set(obj, ref);
    }
    if (obj.position.distanceTo(pos) > 0.001) GMManager.teleportObject(obj, pos);
    const turn = state.facing - GMSpawner.facingOf(obj);
    if (Math.abs(turn) > 0.0001) GMManager.rotateObject(obj, turn);
    if ((obj.gmScale || 1) !== state.scale) GMManager.setObjectScale(obj, state.scale);
    if (!!obj.gmHidden !== state.hidden) GMManager.setObjectHidden(obj, state.hidden);
    obj.gmPinned = state.pinned || undefined;
    if (GMObjectKind.isCreature(obj)) {
      const cre = obj as ModuleCreature;
      if (state.factionId !== undefined && cre.factionId !== state.factionId) GMManager.setObjectFaction(cre, state.factionId);
      if (typeof state.hp === 'number' && (cre.getHP() !== state.hp || cre.getMaxHP() !== state.maxHp)) GMManager.setCreatureHP(cre, state.hp, state.maxHp);
      if ((GMManager.stanceOf(cre) || '') !== (state.stance || '')) GMManager.setCreatureStance(cre, state.stance || '');
      if ((cre.gmCombatStyle || 'all') !== (state.combatStyle || 'all')) GMCombatAI.setStyle(cre, state.combatStyle || 'all');
      if (!!cre.gmScripted !== !!state.scripted) GMCombatAI.setScripted(cre, !!state.scripted);
      const order = GMNpcOrders.getOrder(cre);
      if (JSON.stringify(order || null) !== JSON.stringify(state.order || null) && GMManager.canOrder(cre)) {
        GMManager.giveOrder(cre, state.order ? JSON.parse(JSON.stringify(state.order)) : undefined);
      }
    }
  }

  /** The log, newest first: what can be undone, then (greyed in the panel) what can be redone */
  static log(limit = 15): { label: string; at: number; undone: boolean }[] {
    // The first thing undone (the newest change) is at the bottom of the redo stack
    const undone = this.redoStack.map((e) => ({ label: e.label, at: e.at, undone: true }));
    const done = this.undoStack.slice().reverse().map((e) => ({ label: e.label, at: e.at, undone: false }));
    return [...undone, ...done].slice(0, limit);
  }

  /** "Sith Trooper" for one, "3 objects" for several */
  static nameOf(objs: ModuleObject[]): string {
    if (objs.length === 1) return objs[0].getName?.() || (objs[0] as any).firstName || objs[0].getTag?.() || 'object';
    return `${objs.length} objects`;
  }
}

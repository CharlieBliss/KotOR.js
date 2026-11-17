import * as THREE from "three";
import { GameState } from "@/GameState";
import { AreaSetPiece } from "@/module/AreaSetPiece";
import type { AreaSetPieceDef } from "@/module/AreaSetPiece";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import { GMLog } from "@/managers/gm/GMLog";
import { OtherGameManager } from "@/managers/OtherGameManager";
import { GMRoomNames } from "@/managers/gm/GMRoomNames";

/** What the Place tool's set mode puts down: rooms of an area */
export interface GMSetPieceChoice {
  /** A module of this game ("ebo_m12aa"), or of the other game ("kotor:danm13", "tsl:003ebo") */
  module: string;
  /** Rooms of its layout; empty: all of them */
  rooms?: string[];
}

/**
 * Set pieces in GM sessions: rooms of one area put in another (AreaSetPiece), placed, moved, turned and removed by
 * the GM. The GM's machine owns them and tells players (set.state / set.remove, and the world snapshot); sessions
 * and scene plans keep them.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file GMSetPieces.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class GMSetPieces {

  /** What the Place tool's set mode puts down */
  static pending: GMSetPieceChoice = { module: 'ebo_m12aa' };
  /** The set the Sets list has picked (its buttons and "Move here" act on it) */
  static selectedId: string | null = null;
  /** Loading and changing sets one at a time, in the order asked (a set loads its rooms over a few seconds) */
  static queue: Promise<unknown> = Promise.resolve();
  static nextId: number = 1;

  static list(): AreaSetPiece[] {
    return GameState.module?.area?.setPieces || [];
  }

  static get(id: string | null | undefined): AreaSetPiece | undefined {
    return id ? this.list().find((s) => s.id === id) : undefined;
  }

  static selected(): AreaSetPiece | undefined {
    return this.get(this.selectedId);
  }

  /**
   * A short name: the GM's for the set, or its area's ("Ebon Hawk"), and which of its rooms ("Cargo Hold",
   * "3 rooms"). Room and area names are guessed in the background (GMRoomNames) the first time they're asked for.
   */
  static describe(set: AreaSetPiece | { module: string; rooms?: string[]; name?: string; roomNames?: Record<string, string> }): string {
    const module = String((set as any).module || '').toLowerCase();
    void GMRoomNames.estimate(module);
    const rooms = set instanceof AreaSetPiece ? (set.isWholeArea() ? [] : set.rooms.map((r) => r.roomName)) : (set.rooms || []);
    const name = (set as any).name || GMRoomNames.areaName(module);
    if (!rooms.length) return name;
    const labels = rooms.filter((r) => !GMRoomNames.about(module, r)?.scenery).map((r) => this.roomLabel(set as any, r));
    return `${name}: ${labels.length && labels.length <= 3 ? labels.join(' + ') : `${rooms.length} rooms`}`;
  }

  /** A room's name in a set: the set's own name for it, the GM's for the area's room, or the guess */
  static roomLabel(set: { module: string; roomNames?: Record<string, string> } | string, room: string): string {
    const module = typeof set === 'string' ? set : set.module;
    const own = typeof set === 'string' ? undefined : set.roomNames?.[String(room).toLowerCase()];
    return own || GMRoomNames.roomName(module, room);
  }

  /**
   * The GM names a room (or, with room null, the area) of a module: kept in this browser for that area, and on
   * every set of it in the scene, so sessions and players have it. An empty name goes back to the guess.
   */
  static rename(module: string, room: string | null, name: string) {
    const key = String(module || '').toLowerCase();
    GMRoomNames.setCustom(key, room, name);
    const clean = String(name || '').trim();
    for (const set of this.list().filter((s) => s.module === key)) {
      if (room === null) set.name = clean;
      else if (clean) set.roomNames[room.toLowerCase()] = clean;
      else delete set.roomNames[room.toLowerCase()];
      this.broadcast(set);
    }
    GameState.GMManager?.notifyChange?.();
  }

  /** The GM's names for a module's area and rooms (this browser's), to go with a new set */
  static namesFor(module: string, rooms: string[] | undefined): { name?: string; roomNames?: Record<string, string> } {
    const custom = GMRoomNames.custom()[String(module || '').toLowerCase()] || {};
    const wanted = rooms?.length ? new Set(rooms.map((r) => r.toLowerCase())) : null;
    const roomNames = Object.fromEntries(Object.entries(custom.rooms || {}).filter(([r]) => !wanted || wanted.has(r)));
    return { name: custom.area || undefined, roomNames: Object.keys(roomNames).length ? roomNames : undefined };
  }

  /** One thing at a time: each change waits for the ones asked before it */
  static serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch((): void => undefined);
    return run;
  }

  /** A source module's rooms, in layout order (for picking a few); empty when the area can't be read */
  static async listRooms(module: string): Promise<string[]> {
    if (OtherGameManager.isForeignModule(module) && !(await OtherGameManager.mount())) return [];
    const source = await AreaSetPiece.loadSource(module);
    return source ? source.rooms.map((r) => r.name) : [];
  }

  /** The set whose floor or walls are at a point */
  static setAt(point: THREE.Vector3 | null | undefined): AreaSetPiece | undefined {
    if (!point) return undefined;
    const area = GameState.module?.area;
    const floor = area?.floorAt(point, point.z, 1.5, (r) => !!r.setPiece);
    if (floor?.room.setPiece) return floor.room.setPiece;
    return this.list().find((s) => s.box.containsPoint(point));
  }

  // -------------------------------------------------------------------------------------------------
  // The GM (host or offline)
  // -------------------------------------------------------------------------------------------------

  /** Put a set down with its floor's middle at a point, turned by yaw (radians) */
  static async place(choice: GMSetPieceChoice & { name?: string; roomNames?: Record<string, string> }, at: THREE.Vector3, yaw: number = 0): Promise<AreaSetPiece | null> {
    if (GMNetworkManager.role === 'client' || !choice?.module) return null;
    const module = String(choice.module).toLowerCase();
    const rooms = choice.rooms?.length ? choice.rooms.map((r) => r.toLowerCase()) : undefined;
    // The GM's names for this area so far, and any the caller (a scene plan) gives
    const names = this.namesFor(module, rooms);
    const def: AreaSetPieceDef = {
      id: this.newId(),
      module,
      rooms,
      x: at.x, y: at.y, z: at.z,
      yaw,
      name: choice.name || names.name,
      roomNames: { ...(names.roomNames || {}), ...(choice.roomNames || {}) },
    };
    const set = await this.apply(def);
    if (!set) {
      GMNetworkManager.appendChat('System', `Couldn't place ${this.describe(def)}: its area or rooms weren't found.`);
      return null;
    }
    this.selectedId = set.id;
    GMLog.info('scene', `Placed set ${this.describe(set)}`);
    this.broadcast(set);
    GameState.GMManager?.notifyChange?.();
    return set;
  }

  /** Move or turn a set: to a point, by an offset, or both; yaw in radians */
  static async move(id: string, change: { to?: { x: number; y: number; z: number }; by?: { x?: number; y?: number; z?: number }; yaw?: number; turnBy?: number }) {
    if (GMNetworkManager.role === 'client') return;
    await this.serial(async () => {
      const set = this.get(id);
      if (!set) return;
      const p = change.to ? new THREE.Vector3(change.to.x, change.to.y, change.to.z) : set.position.clone();
      if (change.by) p.add(new THREE.Vector3(change.by.x || 0, change.by.y || 0, change.by.z || 0));
      const yaw = change.yaw ?? (set.yaw + (change.turnBy || 0));
      set.setTransform(p, yaw);
      this.broadcast(set);
    });
    GameState.GMManager?.notifyChange?.();
  }

  static async remove(id: string) {
    if (GMNetworkManager.role === 'client') return;
    await this.serial(async () => {
      const set = this.get(id);
      if (!set) return;
      set.dispose();
      GMLog.info('scene', `Removed set ${this.describe(set)}`);
      if (GMNetworkManager.role === 'host') GMNetworkManager.send('set.remove', { id });
    });
    if (this.selectedId === id) this.selectedId = null;
    GameState.GMManager?.notifyChange?.();
  }

  static broadcast(set: AreaSetPiece) {
    if (GMNetworkManager.role === 'host') GMNetworkManager.send('set.state', set.toDef());
  }

  static newId(): string {
    let id = `set_${this.nextId++}`;
    while (this.get(id)) id = `set_${this.nextId++}`;
    return id;
  }

  /** Every set as data (sessions, snapshots) */
  static serialize(): AreaSetPieceDef[] {
    return this.list().filter((s) => s.loaded).map((s) => s.toDef());
  }

  // -------------------------------------------------------------------------------------------------
  // Any machine: make the scene's sets match what they should be
  // -------------------------------------------------------------------------------------------------

  /** A set as described: moved if it's here already, (re)loaded if it isn't or holds other rooms */
  static apply(def: AreaSetPieceDef): Promise<AreaSetPiece | null> {
    return this.serial(async () => {
      const area = GameState.module?.area;
      if (!area || !def?.id || !def.module) return null;
      const existing = this.get(def.id);
      const sameRooms = (s: AreaSetPiece) => s.module === String(def.module).toLowerCase() &&
        JSON.stringify(s.toDef().rooms || []) === JSON.stringify((def.rooms || []).map((r) => r.toLowerCase()));
      if (existing && sameRooms(existing)) {
        existing.setNames(def);
        if (existing.position.distanceTo(new THREE.Vector3(def.x, def.y, def.z)) > 1e-3 || Math.abs(existing.yaw - def.yaw) > 1e-4) {
          existing.setTransform(def, def.yaw);
        }
        return existing;
      }
      existing?.dispose();
      if (OtherGameManager.isForeignModule(def.module) && !(await OtherGameManager.mount())) return null;
      const set = new AreaSetPiece(area, def);
      const ok = await set.load();
      // The scene changed while it loaded: it belongs to no scene now
      if (!ok || GameState.module?.area !== area) {
        if (ok) set.dispose();
        return null;
      }
      const n = Number(/^set_(\d+)$/.exec(def.id)?.[1]);
      if (n >= this.nextId) this.nextId = n + 1;
      return set;
    });
  }

  /** Exactly these sets (a snapshot, a session): others are removed, these placed or moved */
  static async sync(defs: AreaSetPieceDef[] | undefined) {
    const wanted = new Set((defs || []).map((d) => d.id));
    for (const set of this.list().slice()) {
      if (!wanted.has(set.id)) await this.serial(async () => set.dispose());
    }
    for (const def of defs || []) {
      const set = await this.apply(def);
      if (set) this.broadcast(set);
    }
    GameState.GMManager?.notifyChange?.();
  }

  /** A player's machine: what the GM did to sets while this machine was still loading the scene, by set id */
  static pendingChanges: Map<string, AreaSetPieceDef | null> = new Map();

  static isLoadingScene(): boolean {
    return !!GameState.GMManager?.sceneLoading || !GameState.module?.area;
  }

  /** A new scene: its sets are gone with its rooms; on a player's machine, the GM's sets placed meanwhile come in */
  static onSceneLoaded() {
    this.selectedId = null;
    this.nextId = 1;
    const pending = [...this.pendingChanges.entries()];
    this.pendingChanges.clear();
    for (const [id, def] of pending) {
      if (def) void this.apply(def);
      else void this.serial(async () => this.get(id)?.dispose());
    }
  }
}

// Sets are the host's: players are told where they are (a player still loading a scene gets them in its snapshot)
GMNetworkManager.on('set.state', 'client', async (packet) => {
  if (!packet.payload?.id) return;
  if (GMSetPieces.isLoadingScene()) { GMSetPieces.pendingChanges.set(packet.payload.id, packet.payload); return; }
  await GMSetPieces.apply(packet.payload);
  GameState.GMManager?.notifyChange?.();
});
GMNetworkManager.on('set.remove', 'client', async (packet) => {
  const id = packet.payload?.id;
  if (!id) return;
  if (GMSetPieces.isLoadingScene()) { GMSetPieces.pendingChanges.set(id, null); return; }
  await GMSetPieces.serial(async () => GMSetPieces.get(id)?.dispose());
  GameState.GMManager?.notifyChange?.();
});

// Room and area names are guessed in the background: the panel redraws when an area's are ready
GMRoomNames.onReady = () => GameState.GMManager?.notifyChange?.();

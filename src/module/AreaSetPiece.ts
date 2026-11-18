import * as THREE from "three";
import { GameState } from "@/GameState";
import { ResourceLoader } from "@/loaders/ResourceLoader";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { LYTObject } from "@/resource/LYTObject";
import { GFFObject } from "@/resource/GFFObject";
import { OdysseyModel3D } from "@/three/odyssey";
import type { OdysseyFace3 } from "@/three/odyssey";
import type { OdysseyWalkMesh } from "@/odyssey/OdysseyWalkMesh";
import { WalkmeshEdge } from "@/odyssey/WalkmeshEdge";
import { PathPoint } from "@/engine/pathfinding/PathPoint";
import { Module } from "@/module/Module";
import { ModuleRoom } from "@/module/ModuleRoom";
import type { ModuleArea } from "@/module/ModuleArea";

/** One room of the source area's layout */
export interface AreaSetPieceLayoutRoom {
  name: string;
  /** Where the source area's layout puts the room's model */
  position: THREE.Vector3;
}

/** What a source area offers to set pieces: its layout, and its path points (when its module has them) */
export interface AreaSetPieceSource {
  /** The module name, as given ("ebo_m12aa", "kotor:danm13") */
  module: string;
  /** The area inside it: the name of its layout (.lyt), and of its rooms' prefix */
  areaName: string;
  rooms: AreaSetPieceLayoutRoom[];
  /** Path points and their links, in the source area's coordinates */
  pathPoints: { x: number; y: number; links: number[] }[];
}

/** What a set piece is: which rooms of which area, where, turned how far */
export interface AreaSetPieceDef {
  id: string;
  module: string;
  /** Rooms of the source layout (lower case); empty or missing: all of them */
  rooms?: string[];
  x: number;
  y: number;
  z: number;
  /** Radians, counter-clockwise from the source area's own orientation */
  yaw: number;
  /** The GM's name for the set (otherwise its area's) */
  name?: string;
  /** The GM's names for its rooms, by room (otherwise GMRoomNames' guesses) */
  roomNames?: Record<string, string>;
}

/**
 * AreaSetPiece class.
 *
 * Rooms of one area, placed in another: a few rooms, or all of them, of any area of either game (its room models,
 * walkmeshes and layout are in the game's global archives), moved and turned to where the GM puts them. Each room
 * becomes a room of this area, so it draws, lights, animates and is walked on like the area's own:
 * - its walkmesh is moved into place, its transitions lead to the set's own rooms (those to rooms left out are
 *   walls), and where its edge meets this area's floor at about the same height, that edge is a seam: walkable
 *   across, onto whichever floor is on the other side;
 * - its other edges are walls to creatures outside it too (CollisionManager asks the area's set pieces);
 * - its area's path points come with it, joined to this area's points they can walk straight to.
 * The set's rooms keep their own lightmaps; this area's light, fog and sky are over them.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file AreaSetPiece.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class AreaSetPiece {

  /** A walkmesh edge's transition when it's a seam (WalkmeshEdge.SEAM) */
  static SEAM = WalkmeshEdge.SEAM;
  /** How far a seam may step up or down (metres) */
  static SEAM_STEP = WalkmeshEdge.SEAM_STEP;
  /**
   * How far a set's floor sits above where it's put (metres): over ground at the same height its floor is drawn on
   * top, and is the floor stood on there (ModuleArea.SET_FLOOR_OVER)
   */
  static LIFT = 0.03;
  /** How uneven one level of a set's floor may be (metres): further down is another level */
  static LEVEL_SPREAD = 0.5;
  /** How far past a set's edge its walls are felt by creatures outside it (metres) */
  static WALL_REACH = 3;

  static sources: Map<string, Promise<AreaSetPieceSource | null>> = new Map();

  id: string;
  area: ModuleArea;
  module: string;
  source: AreaSetPieceSource;
  /** The set's rooms, in the source layout's order */
  rooms: ModuleRoom[] = [];
  /** The source layout's rooms, by layout index: the set's room, or undefined for a room left out */
  layoutRooms: (ModuleRoom | undefined)[] = [];
  /** The point of the source area that's put at the set's position: the middle of its floor */
  origin: THREE.Vector3 = new THREE.Vector3();
  position: THREE.Vector3 = new THREE.Vector3();
  yaw: number = 0;
  /** Source area -> this area, as the walkmeshes are now */
  matrix: THREE.Matrix4 = new THREE.Matrix4();
  /** Edges where the set's floor meets the area's, and the room each is on */
  seams: { edge: WalkmeshEdge; room: ModuleRoom }[] = [];
  /** The set's walls (edges creatures can't cross), by room */
  walls: Map<ModuleRoom, WalkmeshEdge[]> = new Map();
  pathPoints: PathPoint[] = [];
  /** Every walk edge of the set's rooms (walls, seams and transitions), for lines along its floor */
  edges: WalkmeshEdge[] = [];
  /** Where each room's floor is, up to head height */
  floorBoxes: Map<ModuleRoom, THREE.Box3> = new Map();
  /** Where the set is, walls included, for quick tests */
  box: THREE.Box3 = new THREE.Box3();
  loaded: boolean = false;

  constructor(area: ModuleArea, def: AreaSetPieceDef){
    this.area = area;
    this.id = def.id;
    this.module = String(def.module || '').toLowerCase();
    this.position.set(def.x || 0, def.y || 0, def.z || 0);
    this.yaw = def.yaw || 0;
    this.requestedRooms = (def.rooms || []).map((r) => String(r).toLowerCase()).filter(Boolean);
    this.setNames(def);
  }

  requestedRooms: string[] = [];
  /** The GM's names for the set and its rooms (AreaSetPieceDef.name, roomNames) */
  name: string = '';
  roomNames: Record<string, string> = {};

  setNames(def: { name?: string; roomNames?: Record<string, string> }){
    this.name = String(def.name || '').trim();
    this.roomNames = {};
    for (const [room, name] of Object.entries(def.roomNames || {})) {
      if (String(name || '').trim()) this.roomNames[room.toLowerCase()] = String(name).trim();
    }
  }

  /** The set as data, to save and to send */
  toDef(): AreaSetPieceDef {
    return {
      id: this.id,
      module: this.module,
      rooms: this.isWholeArea() ? undefined : this.rooms.map((r) => r.roomName),
      x: +this.position.x.toFixed(3),
      y: +this.position.y.toFixed(3),
      z: +this.position.z.toFixed(3),
      yaw: +this.yaw.toFixed(4),
      name: this.name || undefined,
      roomNames: Object.keys(this.roomNames).length ? { ...this.roomNames } : undefined,
    };
  }

  isWholeArea(): boolean {
    return !!this.source && this.rooms.length === this.source.rooms.length;
  }

  // -------------------------------------------------------------------------------------------------
  // Source areas
  // -------------------------------------------------------------------------------------------------

  /**
   * A source area's layout and path points. The module's archives say which area it holds (and have its path
   * points); its layout and rooms come from the game's global archives, so a module that can't be opened still
   * works when it's named by its area (e.g. "m12aa").
   */
  static loadSource(module: string): Promise<AreaSetPieceSource | null> {
    const key = String(module || '').toLowerCase();
    if (!key) return Promise.resolve(null);
    if (!this.sources.has(key)) {
      const loading = this.readSource(key).catch((e): AreaSetPieceSource | null => { console.warn('[AreaSetPiece] source failed', key, e); return null; });
      this.sources.set(key, loading);
      loading.then((s) => { if (!s) this.sources.delete(key); });
    }
    return this.sources.get(key)!;
  }

  private static async readSource(module: string): Promise<AreaSetPieceSource | null> {
    let areaName = module.replace(/^(kotor|tsl):/, '');
    let pth: Uint8Array | undefined;
    let archives: any[] = [];
    try { archives = await Module.GetModuleArchives(module); } catch (e) { archives = []; }
    const find = async (resRef: string, type: number): Promise<Uint8Array | undefined> => {
      for (const archive of archives) {
        try {
          if (archive?.hasResource?.(resRef, type)) return await archive.getResourceBufferByResRef(resRef, type);
        } catch (e) { /* next archive */ }
      }
      return undefined;
    };
    const ifo = await find('module', ResourceTypes['ifo']);
    if (ifo) {
      try {
        const gff = new GFFObject(ifo);
        const entry = String(gff.RootNode.getFieldByLabel('Mod_Entry_Area')?.getValue() || '').toLowerCase();
        if (entry) areaName = entry;
      } catch (e) { /* keep the module's name */ }
    }
    pth = await find(areaName, ResourceTypes['pth']);

    let lyt: Uint8Array | undefined = await find(areaName, ResourceTypes['lyt']);
    if (!lyt) {
      try { lyt = await ResourceLoader.loadResource(ResourceTypes['lyt'], areaName); } catch (e) { lyt = undefined; }
    }
    if (!lyt?.length) return null;
    const layout = new LYTObject(lyt);
    const rooms = layout.rooms
      .filter((r) => r?.name && r.name !== '****')
      .map((r) => ({ name: r.name.toLowerCase(), position: new THREE.Vector3().copy(r.position) }));
    if (!rooms.length) return null;

    const pathPoints: AreaSetPieceSource['pathPoints'] = [];
    if (pth?.length) {
      try {
        const gff = new GFFObject(pth);
        const points = gff.RootNode.getFieldByLabel('Path_Points')?.getChildStructs() || [];
        const links = gff.RootNode.getFieldByLabel('Path_Conections')?.getChildStructs() || [];
        for (const p of points) {
          const first = p.getFieldByLabel('First_Conection').getValue();
          const count = p.getFieldByLabel('Conections').getValue();
          const to: number[] = [];
          for (let i = 0; i < count; i++) to.push(links[first + i]?.getFieldByLabel('Destination')?.getValue());
          pathPoints.push({ x: p.getFieldByLabel('X').getValue(), y: p.getFieldByLabel('Y').getValue(), links: to.filter((n) => typeof n === 'number') });
        }
      } catch (e) {
        console.warn('[AreaSetPiece] path points unreadable', module, e);
      }
    }
    return { module, areaName, rooms, pathPoints };
  }

  // -------------------------------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------------------------------

  /** Load the set's rooms into the area, where the set is. False when its area or rooms can't be found. */
  async load(): Promise<boolean> {
    const source = await AreaSetPiece.loadSource(this.module);
    if (!source) return false;
    this.source = source;
    const wanted = new Set(this.requestedRooms);
    const picked = source.rooms.filter((r) => !wanted.size || wanted.has(r.name));
    if (!picked.length) return false;

    this.layoutRooms = source.rooms.map((): ModuleRoom | undefined => undefined);
    for (const layoutRoom of picked) {
      const room = new ModuleRoom(layoutRoom.name, this.area);
      room.setPiece = this;
      room.position.copy(layoutRoom.position);
      room.setAmbientScale(this.area.rooms[0]?.ambientScale || 0);
      room.setEnvAudio(this.area.rooms[0]?.envAudio ?? 0);
      try {
        await room.loadModel();
      } catch (e) {
        console.warn('[AreaSetPiece] room failed', layoutRoom.name, e);
      }
      if (!(room.model instanceof OdysseyModel3D)) { room.destroy(); continue; }
      room.model.name = room.roomName;
      this.rooms.push(room);
      this.layoutRooms[source.rooms.indexOf(layoutRoom)] = room;
    }
    if (!this.rooms.length || this.area.destroyed) {
      this.rooms.forEach((r) => r.destroy());
      this.rooms = [];
      return false;
    }

    // Each room's transitions lead to the set's rooms; those to rooms left out are walls
    for (const room of this.rooms) {
      room.layoutRooms = this.layoutRooms;
      const wm = room.collisionManager.walkmesh;
      if (!wm) continue;
      for (const edge of wm.edges.values()) {
        if (edge.transition >= 0 && !this.layoutRooms[edge.transition]) edge.transition = -1;
      }
    }

    this.origin.copy(this.floorMiddle());
    for (const room of this.rooms) {
      GameState.group.rooms.add(room.container);
      const wm = room.collisionManager.walkmesh;
      if (wm) {
        GameState.walkmeshList.push(wm.mesh);
        GameState.group.room_walkmeshes.add(wm.mesh);
      }
      this.area.rooms.push(room);
    }
    for (const room of this.rooms) {
      for (const other of this.rooms) if (other !== room) room.addLinkedRoom(other);
    }
    this.area.setPieces.push(this);
    this.applyTransform();
    this.loaded = true;
    return true;
  }

  /** The middle of the set's floor, in the source area: the walkable face nearest the middle of them all */
  floorMiddle(): THREE.Vector3 {
    const faces: OdysseyFace3[] = [];
    for (const room of this.rooms) faces.push(...(room.collisionManager.walkmesh?.walkableFaces || []));
    if (!faces.length) return this.rooms[0]?.position.clone() || new THREE.Vector3();
    const box = new THREE.Box3();
    for (const f of faces) box.expandByPoint(f.centroid);
    const middle = box.getCenter(new THREE.Vector3());
    let best = faces[0];
    for (const f of faces) {
      if (Math.hypot(f.centroid.x - middle.x, f.centroid.y - middle.y) < Math.hypot(best.centroid.x - middle.x, best.centroid.y - middle.y)) best = f;
    }
    // On the floor itself (the middle of the box can be in a gap between a ship's corridors), at the height of the
    // lowest floor of that level: put on the ground, none of that level is under the ground (an area's other
    // levels, a courtyard below or a gallery above, stay where they are from it)
    let lowest = best.centroid.z;
    for (const f of faces) {
      if (f.centroid.z < lowest && f.centroid.z >= best.centroid.z - AreaSetPiece.LEVEL_SPREAD) lowest = f.centroid.z;
    }
    return new THREE.Vector3(best.centroid.x, best.centroid.y, lowest);
  }

  // -------------------------------------------------------------------------------------------------
  // Placing
  // -------------------------------------------------------------------------------------------------

  /** Move and turn the set */
  setTransform(position: { x: number; y: number; z: number }, yaw: number = this.yaw){
    this.position.set(position.x, position.y, position.z);
    this.yaw = yaw;
    if (this.loaded) this.applyTransform();
  }

  static #delta = new THREE.Matrix4();
  static #rotation = new THREE.Matrix4();

  /** Put the rooms' models and walkmeshes where the set is, then join it to the area again */
  applyTransform(){
    const m = new THREE.Matrix4()
      .makeTranslation(this.position.x, this.position.y, this.position.z + AreaSetPiece.LIFT)
      .multiply(AreaSetPiece.#rotation.makeRotationZ(this.yaw))
      .multiply(new THREE.Matrix4().makeTranslation(-this.origin.x, -this.origin.y, -this.origin.z));
    this.matrix.copy(m);

    for (let i = 0; i < this.rooms.length; i++) {
      const room = this.rooms[i];
      const layoutPosition = this.source.rooms.find((r) => r.name === room.roomName)?.position || new THREE.Vector3();
      room.position.copy(layoutPosition).applyMatrix4(m);
      room.rotation.set(0, 0, this.yaw);
      room.computeBoundingBox(true);
      const wm = room.collisionManager.walkmesh;
      if (wm) AreaSetPiece.moveWalkmesh(wm, m);
    }
    this.join();
  }

  /** A walkmesh read in the source area's coordinates, put where m says */
  static moveWalkmesh(wm: OdysseyWalkMesh, m: THREE.Matrix4){
    // The drawn and ray-tested mesh: undo where it was, then put it here
    const delta = AreaSetPiece.#delta.copy(wm.mat4).invert().premultiply(m);
    wm.mesh.geometry.applyMatrix4(delta);
    wm.mesh.geometry.computeBoundingBox();
    wm.mesh.geometry.computeBoundingSphere();
    wm.mat4.copy(m);
    // Vertices (the faces' triangles share them), normals, centroids and edges
    wm.updateMatrix();
    for (const face of wm.faces) {
      const v1 = wm.vertices[face.a], v2 = wm.vertices[face.b], v3 = wm.vertices[face.c];
      if (!face.normal || !v1 || !v2 || !v3) continue;
      face.normal.copy(v3).sub(v2).cross(new THREE.Vector3().copy(v1).sub(v2)).normalize();
      face.coeff = -((v1.x * face.normal.x) + (v1.y * face.normal.y) + (v1.z * face.normal.z));
    }
    // The camera's collision boxes
    for (const node of wm.aabbNodes || []) {
      if (node?._box) node.box.copy(node._box).applyMatrix4(m);
    }
    wm.box.setFromObject(wm.mesh);
  }

  /** Seams, walls, links to the area's rooms, and path points, for where the set is now */
  join(){
    // Where it can be walked (and stood in, up to head height): a room's model can be far bigger (a sky, space)
    this.box.makeEmpty();
    this.floorBoxes.clear();
    for (const room of this.rooms) {
      const faces = room.collisionManager.walkmesh?.walkableFaces || [];
      if (!faces.length) continue;
      const box = new THREE.Box3();
      for (const f of faces) box.expandByPoint(f.triangle.a).expandByPoint(f.triangle.b).expandByPoint(f.triangle.c);
      box.max.z += 2.5;
      this.floorBoxes.set(room, box);
      this.box.union(box);
    }
    this.findSeams();
    this.edges = [];
    for (const room of this.rooms) for (const edge of room.collisionManager.walkmesh?.edges.values() || []) this.edges.push(edge);
    this.linkToArea();
    this.area.rebuildWalkData();
    this.placePathPoints();
    // Whoever stands on or around it finds their floor again
    for (const obj of [...this.area.creatures, ...GameState.PartyManager.party]) {
      if (!obj || !this.box.containsPoint(obj.position) && !this.rooms.includes(obj.room)) continue;
      obj.collisionManager.groundFace = undefined;
      obj.collisionManager.findWalkableFace();
    }
  }

  static #ray = new THREE.Raycaster();

  /**
   * Which of the set's edges are seams: its floor stops there, nothing stands in the way (no wall in the room's
   * model or walkmesh), and the area has floor just past it at about the same height.
   */
  findSeams(){
    // Edges that were seams are walls again until they're found to still be
    for (const s of this.seams) s.edge.transition = -1;
    this.seams = [];
    this.walls.clear();
    const ray = AreaSetPiece.#ray;
    const outside = new THREE.Vector3();
    const from = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const blockers: THREE.Object3D[] = [];
    for (const room of this.rooms) {
      if (room.model) blockers.push(room.model);
      if (room.collisionManager.walkmesh?.mesh) blockers.push(room.collisionManager.walkmesh.mesh);
    }
    for (const room of this.rooms) {
      const wm = room.collisionManager.walkmesh;
      const walls: WalkmeshEdge[] = [];
      this.walls.set(room, walls);
      if (!wm) continue;
      for (const edge of wm.edges.values()) {
        if (edge.transition !== -1 || !edge.normal || edge.normal.lengthSq() < 1e-6) { continue; }
        const mid = edge.center_point;
        // The edge's normal points into its floor
        dir.set(-edge.normal.x, -edge.normal.y, 0).normalize();
        outside.copy(mid).addScaledVector(dir, 0.4);
        const floor = this.area.floorAt(outside, mid.z, AreaSetPiece.SEAM_STEP, (r) => r.setPiece !== this);
        let open = !!floor;
        if (open) {
          // Knee and chest height: a wall there is a wall, whatever the floor does
          for (const h of [0.5, 1.2]) {
            from.copy(mid).addScaledVector(dir, -0.3);
            from.z = mid.z + h;
            ray.set(from, dir);
            ray.far = 0.9;
            const hit = ray.intersectObjects(blockers, true).find((i) => {
              const wok = (i.object as any).userData?.wok as OdysseyWalkMesh | undefined;
              // A walkmesh's own walkable faces (a ramp) aren't in the way
              return !(wok && wok.faces[i.faceIndex ?? -1]?.walk);
            });
            if (hit) { open = false; break; }
          }
        }
        if (open) {
          edge.transition = AreaSetPiece.SEAM;
          this.seams.push({ edge, room });
        } else {
          walls.push(edge);
        }
      }
    }
  }

  /** The set's rooms and the area's rooms near it see each other (rooms are shown by what the player's room sees) */
  linkToArea(){
    const near = this.box.clone().expandByScalar(30);
    for (const other of this.area.rooms) {
      if (other.setPiece === this) continue;
      const touches = !other.box.isEmpty() && near.intersectsBox(other.box);
      for (const room of this.rooms) {
        if (touches) { room.addLinkedRoom(other); other.addLinkedRoom(room); }
        else { room.removeLinkedRoom(other); other.removeLinkedRoom(room); }
      }
    }
  }

  /** The source area's path points, where the set is, joined to the area's points they can walk straight to */
  placePathPoints(){
    const path = this.area.path;
    if (!path) return;
    this.removePathPoints();
    const points: PathPoint[] = [];
    for (const p of this.source.pathPoints) {
      const v = new THREE.Vector3(p.x, p.y, 0).applyMatrix4(this.matrix);
      v.z = this.position.z;
      const face = this.floorOf(v);
      if (!face) { points.push(undefined as any); continue; }
      v.z = face.z;
      const point = new PathPoint({ id: 0, connections: [], first_connection: 0, num_connections: 0, vector: v, area: undefined } as any);
      point.area = this.area;
      point.setPiece = this;
      points.push(point);
    }
    this.source.pathPoints.forEach((p, i) => {
      if (!points[i]) return;
      for (const link of p.links) if (points[link]) points[i].addConnection(points[link]);
    });
    this.pathPoints = points.filter(Boolean);
    // Joined to the area's own points nearby that can be walked to (across a seam). Which floor the area's points
    // are on may have changed with the set (one under it now, or not any more)
    const hostPoints = path.points.slice();
    for (const p of hostPoints) if (p.setPiece !== undefined && !this.area.setPieces.some((s) => s.pathPoints.includes(p))) p.setPiece = undefined;
    for (const point of this.pathPoints) {
      for (const other of hostPoints) {
        if (point.vector.distanceTo(other.vector) > 20) continue;
        if (Math.abs(point.vector.z - other.vector.z) > 3) continue;
        if (point.hasLOS(other)) point.addConnection(other);
      }
    }
    for (const point of this.pathPoints) {
      point.id = path.points.length;
      path.points.push(point);
      point.num_connections = point.connections.length;
    }
    for (const other of hostPoints) other.num_connections = other.connections.length;
  }

  removePathPoints(){
    const path = this.area.path;
    if (!path || !this.pathPoints.length) { this.pathPoints = []; return; }
    const mine = new Set(this.pathPoints);
    path.points = path.points.filter((p) => !mine.has(p));
    for (const p of path.points) {
      p.connections = p.connections.filter((c) => !mine.has(c));
      p.num_connections = p.connections.length;
    }
    path.points.forEach((p, i) => { p.id = i; if (p.setPiece === this) p.setPiece = undefined; });
    this.pathPoints = [];
  }

  /** The set's floor under a point: the height of its walkable face there */
  floorOf(point: THREE.Vector3): { z: number; room: ModuleRoom } | null {
    const floor = this.area.floorAt(point, point.z, Infinity, (r) => r.setPiece === this);
    return floor ? { z: floor.z, room: floor.room } : null;
  }

  // -------------------------------------------------------------------------------------------------
  // Removing
  // -------------------------------------------------------------------------------------------------

  /** Take the set out of the area; whoever stood in it finds the area's floor again */
  dispose(){
    const area = this.area;
    const stranded = [...area.creatures, ...GameState.PartyManager.party].filter((o) => o && this.rooms.includes(o.room));
    this.removePathPoints();
    for (const room of this.rooms) {
      for (const other of area.rooms) other.removeLinkedRoom(room);
      const idx = area.rooms.indexOf(room);
      if (idx >= 0) area.rooms.splice(idx, 1);
      room.collisionManager.walkmesh?.mesh?.removeFromParent();
      room.container?.removeFromParent();
      try { room.model?.dispose?.(); } catch (e) { /* already gone */ }
      room.destroy();
    }
    this.rooms = [];
    const at = area.setPieces.indexOf(this);
    if (at >= 0) area.setPieces.splice(at, 1);
    area.rebuildWalkData();
    for (const obj of stranded) {
      obj.room = undefined;
      obj.collisionManager.groundFace = undefined;
      obj.collisionManager.findWalkableFace();
    }
    this.loaded = false;
  }

  // -------------------------------------------------------------------------------------------------
  // Walking (CollisionManager)
  // -------------------------------------------------------------------------------------------------

  /** The set's walls a creature outside the set could walk into, near a point */
  wallsNear(point: THREE.Vector3, reach: number = AreaSetPiece.WALL_REACH): WalkmeshEdge[] {
    const out: WalkmeshEdge[] = [];
    if (this.box.isEmpty() || this.box.distanceToPoint(point) > reach) return out;
    for (const [room, walls] of this.walls) {
      const floor = this.floorBoxes.get(room);
      if (!floor || floor.distanceToPoint(point) > reach) continue;
      for (const edge of walls) {
        // Walls at about the creature's height (a set above or below it isn't in its way)
        if (Math.abs(edge.line.start.z - point.z) > 1.5 && Math.abs(edge.line.end.z - point.z) > 1.5) continue;
        out.push(edge);
      }
    }
    return out;
  }

}

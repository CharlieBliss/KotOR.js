import * as THREE from 'three';
import { IPathPointOptions } from "@/interface/engine/pathfinding/IPathPointOptions";
import { Utility } from "@/utility/Utility";
import type { ModuleArea } from "@/module/ModuleArea";
import type { GFFStruct } from "@/resource/GFFStruct";
import type { WalkmeshEdge } from "@/odyssey/WalkmeshEdge";
import type { ModuleObject } from "@/module/ModuleObject";

/**
 * PathPoint class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file PathPoint.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class PathPoint {
  id: number;
  connections: PathPoint[];
  first_connection: number;
  num_connections: number;
  vector: THREE.Vector3;
  nearestWalkableVector: THREE.Vector3;
  isTemp: boolean = false;
  area: ModuleArea

  //search state
  h: number = 0;
  g: number = 0;
  f: number = 0;
  cost: number = 1;
  visited: boolean = false;
  closed: boolean = false;
  parent?: PathPoint;
  end: boolean = false;

  constructor(options: IPathPointOptions){
    options = Object.assign({
      id: 0,
      connections: [],
      first_connection: 0,
      num_connections: 0,
      vector: new THREE.Vector3,
      area: undefined
    }, options);

    this.id = options.id;
    this.connections = options.connections;
    this.first_connection = options.first_connection;
    this.num_connections = options.num_connections;
    this.vector = options.vector;
    this.isTemp = false;
    this.setArea(options.area);
  }

  setArea(area: ModuleArea){
    this.area = area;
    if(this.area){
      this.nearestWalkableVector = this.area.getNearestWalkablePoint(this.vector);
      this.vector.z = this.nearestWalkableVector.z;
    }
  }

  reset(){
    this.h = this.g = this.f = 0;
    this.cost = 1;
    this.visited = false;
    this.closed = false;
    this.parent = undefined;
    this.end = false;
  }

  isWall(): boolean {
    return false;
  }

  /**
   * Can a creature walk straight from here to point_b without crossing the walkmesh's edge? With
   * withCreatures, creatures standing on the line block it too. Route planning leaves creatures out: they move,
   * and walking around them is creature avoidance's job (a crowd counted as walls leaves no route at all).
   */
  hasLOS(point_b: PathPoint, owner?: ModuleObject, withCreatures: boolean = false): boolean {
    if(!this.area)
      return true;

    const path_line = new THREE.Line3(this.vector, point_b.vector);
    /**
     * Check line intersects walkable edges
     */
    for(let j = 0, len = this.area.walkEdges.length; j < len; j++){
      const edge = this.area.walkEdges[j];

      //Ignore transition edges
      if(edge.transition != -1)
        continue;
      
      if(Utility.LineLineIntersection(path_line.start.x, path_line.start.y, path_line.end.x, path_line.end.y, edge.line.start.x, edge.line.start.y, edge.line.end.x, edge.line.end.y)){
        return false;
      }
    }

    /**
     * Check line crosses a placeable that can't be walked through (a table, a crate): they're not part of
     * the area's walkmesh, and one put down after the area loaded sits across its path points' links
     */
    if(PathPoint.crossesProps(this.area, path_line, PathPoint.clearanceFor(owner)))
      return false;

    if(!withCreatures) return true;

    /**
     * Check line intersects creatures
     */
    for(let j = 0, len = this.area.creatures.length; j < len; j++){
      const obj = this.area.creatures[j];

      //Ignore the owner if found in this list, and what nobody walks around (the dead)
      if(obj == owner || obj.isDead?.())
        continue;

      // Creatures right at either end don't block the way: the mover's neighbours (a group setting off
      // together, who'll be moving too; creature avoidance sorts out the jostling) or what it is walking up to
      if(Utility.Distance2D(obj.position, this.vector) < 2 || Utility.Distance2D(obj.position, point_b.vector) < 2)
        continue;

      if(obj.checkLineIntersectsObject(path_line))
        return false;
    }
    return true;
  }

  /** How far around a placeable's bounds a path keeps, beyond the walker's own size (metres) */
  static PROP_CLEARANCE = 0.2;

  /** The room a walker needs beside a placeable: its own size and a little more */
  static clearanceFor(owner?: ModuleObject): number {
    const size = Number((owner as any)?.getHitDistance?.()) || 0.5;
    return size + PathPoint.PROP_CLEARANCE;
  }

  static #ray = new THREE.Ray();
  static #box = new THREE.Box3();
  static #hit = new THREE.Vector3();

  /**
   * Does a straight walk along this line run into a placeable with collision? Walking out of one's
   * surroundings is fine (a creature standing by a table); walking to a point inside them isn't (a path point
   * a prop now sits on)
   */
  static crossesProps(area: ModuleArea, line: THREE.Line3, clearance: number = PathPoint.PROP_CLEARANCE + 0.5): boolean {
    const placeables = area?.placeables || [];
    if(!placeables.length) return false;
    const length = line.distance();
    if(length < 0.01) return false;
    PathPoint.#ray.origin.set(line.start.x, line.start.y, 0);
    PathPoint.#ray.direction.set(line.end.x - line.start.x, line.end.y - line.start.y, 0).normalize();
    const end2 = new THREE.Vector3(line.end.x, line.end.y, 0);
    for(let i = 0, len = placeables.length; i < len; i++){
      const plc = placeables[i];
      if(!plc || plc.destroyed || !plc.collisionManager?.walkmesh || !plc.box || plc.box.isEmpty()) continue;
      const box = PathPoint.#box.copy(plc.box).expandByScalar(clearance);
      box.min.z = -1; box.max.z = 1;
      if(box.containsPoint(PathPoint.#ray.origin)) continue;
      if(box.containsPoint(end2)) return true;
      const hit = PathPoint.#ray.intersectBox(box, PathPoint.#hit);
      if(hit && hit.distanceTo(PathPoint.#ray.origin) <= length) return true;
    }
    return false;
  }

  addConnection(node: PathPoint) {
    if(this.connections.indexOf(node) == -1){
      this.connections.push(node);
    }
    if(node.connections.indexOf(this) == -1){
      node.addConnection(this);
    }
  }

  removeConnection(node: PathPoint) {
    const index = this.connections.indexOf(node);
    if(index >= 0){
      this.connections.splice(index, 1);
    }
  }

  closestPointFromLine(point_b: PathPoint, target: THREE.Vector3): PathPoint {
    const _tempPoint= new THREE.Vector3();
    const line3 = new THREE.Line3(this.vector, point_b.vector)
    line3.closestPointToPoint(target, true, _tempPoint);
    return PathPoint.FromVector3(target);
  }

  static FromVector3(vector: THREE.Vector3): PathPoint {
    const p = new PathPoint({
      id: -1,
      connections: [],
      first_connection: 0,
      num_connections: 0,
      vector: vector
    });
    p.isTemp = true;
    return p;
  }

  static FromGFFStruct(struct: GFFStruct){
    return new PathPoint({
      id: -1,
      connections: [],
      first_connection: struct.getFieldByLabel('First_Conection').getValue(),
      num_connections: struct.getFieldByLabel('Conections').getValue(),
      vector: new THREE.Vector3(
        struct.getFieldByLabel('X').getValue(), 
        struct.getFieldByLabel('Y').getValue(), 
        0
      )
    });
  }

}
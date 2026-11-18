import * as THREE from "three";
import { GameState } from "@/GameState";
import type { ModuleObject } from "@/module/ModuleObject";
import type { ModuleCreature } from "@/module/ModuleCreature";

/** One place to sit on a seat prop, in the prop model's own frame (before the prop is turned) */
export interface GMSeat {
  /** Where the sitter's hips go: the middle of the seat */
  x: number;
  y: number;
  /** The way a sitter faces (unit vector) */
  fx: number;
  fy: number;
  /** A backless bench: it can face the other way too */
  either: boolean;
}

/** A seat in the world: where the sitter stands (its origin) and which way it faces (engine facing, radians) */
export interface GMSeatSpot {
  prop: ModuleObject;
  index: number;
  position: THREE.Vector3;
  facing: number;
}

/**
 * GMSeats class.
 *
 * Where to sit on chairs and benches, worked out from each model's own geometry, since the models carry no hook
 * for it:
 * - the seat is the geometry at seat height (0.3-0.55 m), the backrest what rises well above it;
 * - a sitter faces away from the backrest, across the seat's short side (the military chair faces its model's
 *   -x; a creature faces +y unturned, so a chair and its sitter given the same facing were 90 degrees apart);
 * - a long seat holds one sitter per 65 cm (a bench seats two);
 * - the seated animations put the hips 0.46 m behind the creature's origin (every humanoid model in both games,
 *   0.49 for a Wookiee), so the creature stands that far in front of the seat's middle.
 */
export class GMSeats {
  /** Metres the seated animations put a sitter's hips behind its origin */
  static HIP_OFFSET = 0.46;

  /** Room each sitter takes along a bench */
  static SEAT_WIDTH = 0.65;

  static SEAT_LOW = 0.3;
  static SEAT_HIGH = 0.55;
  /** What counts as backrest: this far above the seat's top */
  static BACK_ABOVE = 0.2;

  /** Seats per model name, worked out once */
  static cache = new Map<string, GMSeat[]>();

  /** Whether a prop is something to sit on, by its template, model or name */
  static looksLikeSeat(text: string): boolean {
    return /chair|bench|stool|seat|couch|sofa/i.test(text || '');
  }

  /**
   * The seats of a model, from its vertices in the model's frame (unturned, at its origin). Empty when nothing is
   * at seat height.
   */
  static fromPoints(points: THREE.Vector3[]): GMSeat[] {
    const seat = points.filter((p) => p.z >= this.SEAT_LOW && p.z <= this.SEAT_HIGH);
    if (seat.length < 3) return [];
    const box = new THREE.Box3().setFromPoints(seat);
    const top = box.max.z;
    const sizeX = box.max.x - box.min.x, sizeY = box.max.y - box.min.y;
    // Sitters line up along the long side and face across the short one
    const longX = sizeX > sizeY;
    const across = (p: { x: number; y: number }) => (longX ? p.y : p.x);
    const along = (p: { x: number; y: number }) => (longX ? p.x : p.y);
    const acrossMin = longX ? box.min.y : box.min.x, acrossMax = longX ? box.max.y : box.max.x;
    const alongMin = longX ? box.min.x : box.min.y, alongMax = longX ? box.max.x : box.max.y;

    // The backrest: what rises above the seat, inside its outline; the sitter faces away from it
    const back = points.filter((p) => p.z > top + this.BACK_ABOVE && across(p) >= acrossMin - 0.05 && across(p) <= acrossMax + 0.05
      && along(p) >= alongMin - 0.05 && along(p) <= alongMax + 0.05);
    const seatMid = (acrossMin + acrossMax) / 2;
    let dir = 0; // +1: sitters face the across axis' + side, -1: its - side, 0: either way
    let front = acrossMin, rear = acrossMax;
    if (back.length >= 3) {
      const backMid = back.reduce((s, p) => s + across(p), 0) / back.length;
      const backBox = new THREE.Box3().setFromPoints(back);
      const backMin = longX ? backBox.min.y : backBox.min.x, backMax = longX ? backBox.max.y : backBox.max.x;
      // A backrest across the whole seat (an armchair's wings) says little: go by where most of it is
      if (Math.abs(backMid - seatMid) > 0.03) {
        dir = backMid > seatMid ? -1 : 1;
        // The seat is the part in front of the backrest
        if (dir < 0) { front = acrossMin; rear = Math.max(acrossMin + 0.2, Math.min(acrossMax, backMin)); }
        else { front = acrossMax; rear = Math.min(acrossMax - 0.2, Math.max(acrossMin, backMax)); }
      }
    }
    const centreAcross = dir === 0 ? seatMid : (front + rear) / 2;

    const length = alongMax - alongMin;
    const count = Math.max(1, Math.floor(length / this.SEAT_WIDTH));
    const seats: GMSeat[] = [];
    for (let i = 0; i < count; i++) {
      const a = alongMin + (length * (i + 0.5)) / count;
      const facing = dir === 0 ? 1 : dir;
      seats.push({
        x: +(longX ? a : centreAcross).toFixed(3),
        y: +(longX ? centreAcross : a).toFixed(3),
        fx: longX ? 0 : facing,
        fy: longX ? facing : 0,
        either: dir === 0,
      });
    }
    return seats;
  }

  /** The seats of a loaded model (its meshes' vertices, in its own frame) */
  static fromModel(model: THREE.Object3D | undefined, key?: string): GMSeat[] {
    if (!model) return [];
    const name = (key || (model as any).name || '').toLowerCase();
    if (name && this.cache.has(name)) return this.cache.get(name)!;
    // The model's frame: undo where the prop stands and how it's turned
    const inverse = new THREE.Matrix4().copy(model.matrixWorld).invert();
    model.updateMatrixWorld(true);
    inverse.copy(model.matrixWorld).invert();
    const points: THREE.Vector3[] = [];
    model.traverse((o: any) => {
      if (!o.isMesh || !o.geometry?.attributes?.position || o.type === 'OdysseyEmitter') return;
      const pos = o.geometry.attributes.position;
      const toModel = new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld);
      for (let i = 0; i < pos.count; i++) points.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(toModel));
    });
    const seats = this.fromPoints(points);
    if (name) this.cache.set(name, seats);
    return seats;
  }

  /** A prop's seats, if it's a seat */
  static seatsOf(prop: ModuleObject | undefined): GMSeat[] {
    if (!prop?.model) return [];
    const label = `${(prop as any).getTemplateResRef?.() || ''} ${(prop as any).model?.name || ''} ${prop.getName?.() || ''}`;
    if (!this.looksLikeSeat(label)) return [];
    return this.fromModel(prop.model, (prop.model as any).name);
  }

  /**
   * Where a creature goes to sit in a seat: the seat's middle turned with the prop, plus the hip offset in the
   * way it faces. wantFacing (engine radians) picks the side of a backless bench.
   */
  static spot(prop: ModuleObject, index: number, wantFacing?: number): GMSeatSpot | null {
    const seat = this.seatsOf(prop)[index];
    if (!seat) return null;
    const bearing = (prop as any).bearing ?? prop.rotation?.z ?? 0;
    const cos = Math.cos(bearing), sin = Math.sin(bearing);
    const turn = (x: number, y: number) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
    const centre = turn(seat.x, seat.y);
    let dir = turn(seat.fx, seat.fy);
    if (seat.either && wantFacing !== undefined) {
      const want = { x: -Math.sin(wantFacing), y: Math.cos(wantFacing) };
      if (want.x * dir.x + want.y * dir.y < 0) dir = { x: -dir.x, y: -dir.y };
    }
    const position = new THREE.Vector3(
      prop.position.x + centre.x + dir.x * this.HIP_OFFSET,
      prop.position.y + centre.y + dir.y * this.HIP_OFFSET,
      prop.position.z,
    );
    // Engine facing: a creature at facing f looks along (-sin f, cos f)
    return { prop, index, position, facing: Math.atan2(-dir.x, dir.y) };
  }

  /** Who sits where: a creature's seat, if it has one */
  static occupant = new Map<ModuleObject, Map<number, ModuleCreature>>();

  static takenBy(prop: ModuleObject, index: number): ModuleCreature | undefined {
    const who = this.occupant.get(prop)?.get(index);
    if (who && ((who as any).destroyed || who.isDead?.() || (who as any).gmSeat?.prop !== prop || (who as any).gmSeat?.index !== index)) {
      this.occupant.get(prop)!.delete(index);
      return undefined;
    }
    return who;
  }

  /** The free seat nearest a point, among the seat props within reach of it */
  static nearestFree(props: ModuleObject[], near: THREE.Vector3, reach = 3, wantFacing?: number, except?: ModuleCreature): GMSeatSpot | null {
    let best: GMSeatSpot | null = null, bestD = reach;
    for (const prop of props) {
      if (!prop?.position || prop.position.distanceTo(near) > reach + 2) continue;
      const seats = this.seatsOf(prop);
      for (let i = 0; i < seats.length; i++) {
        const taken = this.takenBy(prop, i);
        if (taken && taken !== except) continue;
        const spot = this.spot(prop, i, wantFacing);
        if (!spot) continue;
        const d = Math.hypot(spot.position.x - near.x, spot.position.y - near.y);
        if (d < bestD) { bestD = d; best = spot; }
      }
    }
    return best;
  }

  /** Mark a creature as sitting in a seat (and free the one it had) */
  static claim(cre: ModuleCreature, spot: GMSeatSpot | null) {
    const had = (cre as any).gmSeat as { prop: ModuleObject; index: number } | undefined;
    if (had) this.occupant.get(had.prop)?.delete(had.index);
    if (!spot) { delete (cre as any).gmSeat; return; }
    (cre as any).gmSeat = { prop: spot.prop, index: spot.index, x: spot.position.x, y: spot.position.y };
    if (!this.occupant.has(spot.prop)) this.occupant.set(spot.prop, new Map());
    this.occupant.get(spot.prop)!.set(spot.index, cre);
  }

  /** The seated stances a creature can sit in */
  static SEATED_STANCES = ['chair', 'chair_drunk', 'chair_pazaak'];

  /**
   * Sit a creature in a prop's free seat nearest it (or the one asked for): put it there, facing the way the
   * seat does, in a seated stance. False when the prop has no seat free.
   */
  static sitIn(cre: ModuleCreature, prop: ModuleObject, stance?: string, index?: number): boolean {
    if (!this.seatsOf(prop).length) return false;
    const spot = index !== undefined ? this.spot(prop, index, cre.getFacing?.()) : this.nearestFree([prop], cre.position, 8, cre.getFacing?.(), cre);
    if (!spot) return false;
    const taken = this.takenBy(prop, spot.index);
    if (taken && taken !== cre) return false;
    return this.sitAt(cre, spot, stance);
  }

  static sitAt(cre: ModuleCreature, spot: GMSeatSpot, stance?: string): boolean {
    const G: any = GameState.GMManager;
    const wanted = stance || ((cre as any).gmSeatStance && this.SEATED_STANCES.includes((cre as any).gmSeatStance) ? (cre as any).gmSeatStance : 'chair');
    if (G?.placeAt) G.placeAt(cre, spot.position); else cre.position.copy(spot.position);
    cre.setFacing(spot.facing, true);
    this.claim(cre, spot);
    (cre as any).gmSeatStance = wanted;
    if (G?.setCreatureStance) G.setCreatureStance(cre, wanted);
    else cre.setHeldStance?.(wanted);
    return true;
  }

  /** Get up: the seat is free again, and it stands */
  static stand(cre: ModuleCreature) {
    if (!(cre as any).gmSeat) return;
    this.claim(cre, null);
    const G: any = GameState.GMManager;
    if (G?.setCreatureStance) G.setCreatureStance(cre, '');
    else cre.setHeldStance?.('');
  }

  /** A sitter that has left its seat (walked off, dragged away, the seat moved) stands; one that died lets it go */
  static update() {
    for (const [prop, seats] of this.occupant) {
      for (const [index, cre] of [...seats]) {
        const seat = (cre as any).gmSeat;
        if (!seat || seat.prop !== prop || seat.index !== index || (cre as any).destroyed || cre.isDead?.()) { seats.delete(index); continue; }
        const away = Math.hypot(cre.position.x - seat.x, cre.position.y - seat.y) > 0.35;
        const spot = this.spot(prop, index, cre.getFacing?.());
        const seatMoved = !spot || Math.hypot(spot.position.x - seat.x, spot.position.y - seat.y) > 0.35;
        if (away || seatMoved || (prop as any).destroyed) this.stand(cre);
      }
    }
  }
}

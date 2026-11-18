import * as THREE from "three";
import { GameState } from "@/GameState";
import type { GMPoint } from "@/managers/GMNpcOrders";

/** A route to draw on the ground: a patrol's points (numbered, in order), or one spot to walk to */
export interface GMRoute {
  points: GMPoint[];
  /** A patrol goes back to its first point after its last */
  loop: boolean;
  /** The point it's heading for now, drawn brighter */
  next?: number;
  /** Still being placed with the patrol tool */
  draft?: boolean;
  /** Numbered points (a patrol); otherwise a plain marker */
  numbered?: boolean;
}

/**
 * GMRouteMarkers class.
 *
 * Draws the routes of the NPCs the GM has selected on the ground, and the patrol being placed: a ring at each
 * point with its number above it, and lines between them in order. Only the GM sees them; they're redrawn
 * only when a route changes.
 */
export class GMRouteMarkers {
  static group: THREE.Group | null = null;

  static signature = '';

  static numberTextures = new Map<string, THREE.CanvasTexture>();

  static COLOR = 0xffb300;

  static DRAFT_COLOR = 0x00e5ff;

  static update(routes: GMRoute[]) {
    const scene = GameState.scene;
    if (!scene) return;
    if (!this.group) {
      this.group = new THREE.Group();
      this.group.name = 'gm-route-markers';
    }
    if (this.group.parent !== scene) scene.add(this.group);
    const signature = JSON.stringify(routes.map((r) => [r.loop, r.next, r.draft, r.numbered, r.points.map((p) => [p.x, p.y, p.z].map((n) => Math.round(n * 20)))]));
    if (signature === this.signature) return;
    this.signature = signature;
    this.clear();
    for (const route of routes) this.draw(route);
  }

  static clear() {
    if (!this.group) return;
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.traverse((o: any) => {
        o.geometry?.dispose?.();
        // Number textures are kept for next time
        if (o.material) o.material.dispose();
      });
    }
  }

  static draw(route: GMRoute) {
    const color = route.draft ? this.DRAFT_COLOR : this.COLOR;
    const pts = route.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    route.points.forEach((p, i) => {
      const ahead = route.next === i;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(ahead ? 0.32 : 0.36, 0.5, 28),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: ahead ? 0.95 : 0.7, depthWrite: false, depthTest: false })
      );
      ring.position.set(p.x, p.y, p.z + 0.06);
      ring.renderOrder = 997;
      this.group!.add(ring);
      if (!route.numbered) return;
      const texture = this.numberTexture(String(i + 1), color);
      if (!texture) return;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true }));
      sprite.position.set(p.x, p.y, p.z + 0.75);
      sprite.scale.set(0.55, 0.55, 1);
      sprite.renderOrder = 999;
      this.group!.add(sprite);
    });
    if (pts.length > 1) {
      const line = pts.map((v) => v.clone().setZ(v.z + 0.08));
      if (route.loop) line.push(line[0].clone());
      const path = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(line),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false })
      );
      path.renderOrder = 996;
      this.group!.add(path);
    }
  }

  /** A round badge with a number on it */
  static numberTexture(label: string, color: number): THREE.CanvasTexture | null {
    const key = `${label}:${color}`;
    const cached = this.numberTextures.get(key);
    if (cached) return cached;
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 14, 20, 0.85)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 32, 34);
    const texture = new THREE.CanvasTexture(canvas);
    this.numberTextures.set(key, texture);
    return texture;
  }
}

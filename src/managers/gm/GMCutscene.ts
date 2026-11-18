import * as THREE from "three";
import { GameState } from "@/GameState";
import { FreeLookCamera } from "@/engine/FreeLookCamera";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import type { GMPacket } from "@/managers/GMNetworkManager";

/** Where a camera is and where it looks: a saved shot, or the GM camera as it streams to players */
export interface GMCameraPose {
  x: number;
  y: number;
  z: number;
  /** Heading around world Z and tilt (0 down, PI/2 the horizon, PI up), as FreeLookCamera */
  yaw: number;
  pitch: number;
  /** Horizontal field of view across the widescreen frame (radians) */
  hfov: number;
}

/** A cutscene's state, with the session rules (so a player joining mid-scene is in it at once) */
export interface GMCutsceneState {
  active: boolean;
  caption?: string;
}

/**
 * GMCutscene class.
 *
 * Live cutscenes: the GM directs with their own camera and players watch it. Starting one puts players in Watch
 * (they can't act and NPCs leave them alone) and shows them KotOR-style widescreen bars with an optional caption;
 * the GM camera's pose streams to them and their view eases after it (a cut jumps). Saved shots (1-9 per area) let
 * the GM cut or pan between angles set up a moment before.
 *
 * Framing: players' windows aren't the GM's shape. Everyone shows the same widescreen frame (FRAME_ASPECT, bars
 * above and below), and the stream carries the frame's horizontal field of view, so what's inside the bars matches.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file GMCutscene.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class GMCutscene {

  /** Width over height of the widescreen frame between the bars */
  static FRAME_ASPECT = 2.2;
  /** Camera updates a second to players while it moves */
  static SEND_RATE = 15;
  /** And at least this often while it's still (a player who missed one still gets there) */
  static KEEPALIVE_SECONDS = 1;
  /** How fast a player's view catches up with the GM camera (higher: tighter) */
  static FOLLOW_RATE = 7;
  /** A pan to a shot takes this long */
  static PAN_SECONDS = 2.5;

  static active = false;
  static caption = '';
  /** Host: whether players were already watching before the cutscene (left that way after it) */
  static frozenBefore = false;

  // --- Host
  static sendTimer = 0;
  static sinceSent = 0;
  static lastSent: GMCameraPose | null = null;
  static pan: { from: GMCameraPose; to: GMCameraPose; t: number } | null = null;
  /** Shots 1-9 for this area (index 0 unused) */
  static shots: (GMCameraPose | null)[] = [];
  static shotsArea = '';

  // --- Client
  /** This machine is a player's, watching a cutscene */
  static watching = false;
  static camera: THREE.PerspectiveCamera | null = null;
  static target: GMCameraPose | null = null;
  static view: GMCameraPose | null = null;

  static events = new EventTarget();

  static notify() {
    GameState.GMManager?.notifyChange?.();
  }

  // ===========================================================================
  // Host
  // ===========================================================================

  /** Start a cutscene: players watch the GM camera in widescreen */
  static start(caption: string = '') {
    if (this.active || GMNetworkManager.role === 'client') return;
    const G = GameState.GMManager;
    this.frozenBefore = !!G.playersFrozen;
    this.active = true;
    this.caption = caption;
    this.lastSent = null;
    this.pan = null;
    // Watch: players can't act, NPCs leave them alone (and this sends the cutscene with the session rules)
    if (!G.playersFrozen) G.setPlayersFrozen(true);
    else GMNetworkManager.broadcastSessionRules(G.sessionRules());
    this.sendPose(true);
    this.notify();
  }

  /** End it: players' own cameras come back (and they can act again, unless they were watching before) */
  static stop() {
    if (!this.active) return;
    const G = GameState.GMManager;
    this.active = false;
    this.caption = '';
    this.pan = null;
    if (!this.frozenBefore && G.playersFrozen) G.setPlayersFrozen(false);
    else GMNetworkManager.broadcastSessionRules(G.sessionRules());
    this.notify();
  }

  static toggle() {
    if (this.active) this.stop();
    else this.start();
  }

  /** The line shown under the picture ('' for none) */
  static setCaption(text: string) {
    this.caption = String(text || '').slice(0, 300);
    if (this.active) GMNetworkManager.broadcastSessionRules(GameState.GMManager.sessionRules());
    this.notify();
  }

  /** What goes in the session rules */
  static state(): GMCutsceneState | undefined {
    return this.active ? { active: true, caption: this.caption || '' } : undefined;
  }

  /** The camera the GM directs with */
  static directorCamera(): THREE.PerspectiveCamera | null {
    const cam = (GameState.currentCamera || GameState.camera) as THREE.PerspectiveCamera;
    return cam && (cam as any).isPerspectiveCamera ? cam : null;
  }

  /** The widescreen frame's horizontal field of view for a camera on a canvas this shape */
  static frameHfov(cam: THREE.PerspectiveCamera, aspect: number): number {
    const vfov = THREE.MathUtils.degToRad(cam.fov || 55);
    return 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  }

  static viewportAspect(): number {
    const w = GameState.ResolutionManager?.getViewportWidth?.() || window.innerWidth || 16;
    const h = GameState.ResolutionManager?.getViewportHeight?.() || window.innerHeight || 9;
    return w / Math.max(1, h);
  }

  /** A camera's pose now */
  static poseOf(cam: THREE.PerspectiveCamera): GMCameraPose {
    const { yaw, pitch } = FreeLookCamera.getAngles(cam);
    return { x: cam.position.x, y: cam.position.y, z: cam.position.z, yaw, pitch, hfov: this.frameHfov(cam, this.viewportAspect()) };
  }

  /** Put the GM camera at a pose (a shot, a step of a pan) */
  static applyToDirector(pose: GMCameraPose) {
    const cam = this.directorCamera();
    if (!cam || !pose) return;
    cam.position.set(pose.x, pose.y, pose.z);
    FreeLookCamera.setAngles(cam, pose.yaw, pose.pitch);
    cam.updateMatrixWorld();
  }

  static sendPose(cut: boolean) {
    if (GMNetworkManager.role !== 'host') return;
    const cam = this.directorCamera();
    if (!cam) return;
    const pose = this.poseOf(cam);
    this.lastSent = pose;
    this.sinceSent = 0;
    GMNetworkManager.send('cutscene.pose', { ...pose, cut });
  }

  static moved(a: GMCameraPose | null, b: GMCameraPose): boolean {
    if (!a) return true;
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) > 0.01
      || Math.abs(angleDelta(a.yaw, b.yaw)) + Math.abs(a.pitch - b.pitch) > 0.002
      || Math.abs(a.hfov - b.hfov) > 0.002;
  }

  // --- Shots

  static areaKey(): string {
    return String(GameState.module?.filename || GameState.module?.area?.name || 'area');
  }

  /** This area's shots (read from storage the first time, or after moving to another area) */
  static loadShots(): (GMCameraPose | null)[] {
    const key = this.areaKey();
    if (this.shotsArea === key) return this.shots;
    this.shotsArea = key;
    this.shots = [];
    try {
      const raw = window.localStorage.getItem(`gm.shots.${key}`);
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) this.shots = list.map((s: any) => (s && typeof s.x === 'number' ? s : null));
    } catch (e) {}
    return this.shots;
  }

  static saveShots() {
    try { window.localStorage.setItem(`gm.shots.${this.shotsArea}`, JSON.stringify(this.shots)); } catch (e) {}
  }

  static getShot(n: number): GMCameraPose | null {
    return this.loadShots()[n] || null;
  }

  /** Shots saved here, as [number, pose] */
  static savedShots(): [number, GMCameraPose][] {
    const list = this.loadShots();
    const out: [number, GMCameraPose][] = [];
    for (let n = 1; n <= 9; n++) if (list[n]) out.push([n, list[n] as GMCameraPose]);
    return out;
  }

  /** The GM camera as it is now becomes shot n */
  static saveShot(n: number) {
    const cam = this.directorCamera();
    if (!cam || n < 1 || n > 9) return;
    const list = this.loadShots();
    list[n] = this.poseOf(cam);
    this.saveShots();
    this.notify();
  }

  /** The first free shot number (or 9 when they're all taken) */
  static nextFreeShot(): number {
    const list = this.loadShots();
    for (let n = 1; n <= 9; n++) if (!list[n]) return n;
    return 9;
  }

  static clearShot(n: number) {
    const list = this.loadShots();
    list[n] = null;
    this.saveShots();
    this.notify();
  }

  /** Go to shot n: a cut (players' views jump), or a pan the camera makes over PAN_SECONDS */
  static goToShot(n: number, pan: boolean = false): boolean {
    const shot = this.getShot(n);
    const cam = this.directorCamera();
    if (!shot || !cam) return false;
    if (pan) {
      this.pan = { from: this.poseOf(cam), to: { ...shot }, t: 0 };
    } else {
      this.pan = null;
      this.applyToDirector(shot);
      if (this.active) this.sendPose(true);
    }
    this.notify();
    return true;
  }

  // ===========================================================================
  // Client
  // ===========================================================================

  /** Client: the session rules say whether a cutscene is on, and its caption */
  static onRules(state: GMCutsceneState | undefined) {
    const on = !!state?.active;
    this.caption = on ? String(state?.caption || '') : '';
    if (on === this.active) {
      this.notify();
      return;
    }
    this.active = on;
    this.watching = on;
    if (on) {
      if (!this.camera) {
        this.camera = new THREE.PerspectiveCamera(55, this.viewportAspect(), 0.01, 15000);
        this.camera.up.set(0, 0, 1);
      }
      // Until the first camera update arrives: from where the player's own camera is
      const own = GameState.camera as THREE.PerspectiveCamera;
      if (own && !this.target) this.target = this.poseOf(own);
      this.view = null;
    } else {
      this.target = null;
      this.view = null;
      if (GameState.currentCamera === this.camera) GameState.currentCamera = GameState.camera;
    }
    this.notify();
  }

  /** Client: where the GM camera is */
  static onPose(packet: GMPacket<'cutscene.pose'>) {
    const p = packet.payload;
    if (!p || typeof p.x !== 'number') return;
    this.target = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, hfov: p.hfov };
    if (p.cut) this.view = null;
  }

  /** Client: the camera to draw the world with, during a cutscene */
  static renderCamera(): THREE.Camera | null {
    if (!this.active || GMNetworkManager.role !== 'client' || !this.camera || !this.target) return null;
    return this.camera;
  }

  // ===========================================================================
  // Every frame
  // ===========================================================================

  static update(delta: number) {
    if (GMNetworkManager.role === 'client') {
      this.updateClient(delta);
      return;
    }
    // Left the session mid-cutscene: our own camera back
    if (this.watching) this.reset();
    this.updateHost(delta);
  }

  static updateHost(delta: number) {
    // A pan to a shot moves the GM camera itself (the stream carries it to players)
    if (this.pan) {
      const p = this.pan;
      p.t = Math.min(1, p.t + delta / this.PAN_SECONDS);
      const e = p.t < 0.5 ? 2 * p.t * p.t : 1 - Math.pow(-2 * p.t + 2, 2) / 2;
      this.applyToDirector(lerpPose(p.from, p.to, e));
      if (p.t >= 1) this.pan = null;
    }
    if (!this.active || GMNetworkManager.role !== 'host') return;
    this.sendTimer += delta;
    this.sinceSent += delta;
    if (this.sendTimer < 1 / this.SEND_RATE) return;
    this.sendTimer = 0;
    const cam = this.directorCamera();
    if (!cam) return;
    if (this.moved(this.lastSent, this.poseOf(cam)) || this.sinceSent >= this.KEEPALIVE_SECONDS) this.sendPose(false);
  }

  static updateClient(delta: number) {
    if (!this.active || !this.camera || !this.target) return;
    const t = this.target;
    // Eased after the GM camera (updates come in steps); a cut, or the first one, jumps
    this.view = this.view ? lerpPose(this.view, t, 1 - Math.exp(-this.FOLLOW_RATE * delta)) : { ...t };
    const v = this.view;
    const aspect = this.viewportAspect();
    // The same horizontal field across the frame as the GM's: the vertical field for this window from it
    const vfov = 2 * Math.atan(Math.tan(v.hfov / 2) / aspect);
    this.camera.aspect = aspect;
    this.camera.fov = THREE.MathUtils.radToDeg(vfov);
    this.camera.updateProjectionMatrix();
    this.camera.position.set(v.x, v.y, v.z);
    FreeLookCamera.setAngles(this.camera, v.yaw, v.pitch);
    this.camera.updateMatrixWorld();
  }

  /** Session ended or scene changed */
  static reset() {
    this.active = false;
    this.watching = false;
    this.caption = '';
    this.pan = null;
    this.target = null;
    this.view = null;
    if (this.camera && GameState.currentCamera === this.camera) GameState.currentCamera = GameState.camera;
  }
}

/** The shortest turn from a to b (radians) */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function lerpPose(a: GMCameraPose, b: GMCameraPose, t: number): GMCameraPose {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    yaw: a.yaw + angleDelta(a.yaw, b.yaw) * t,
    pitch: a.pitch + (b.pitch - a.pitch) * t,
    hfov: a.hfov + (b.hfov - a.hfov) * t,
  };
}

GMNetworkManager.on('cutscene.pose', 'client', (packet) => GMCutscene.onPose(packet), 'to-me-or-all');
GMNetworkManager.on('session.rules', 'client', (packet) => GMCutscene.onRules(packet.payload?.cutscene));

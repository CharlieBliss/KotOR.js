import { GMFaction, GM_SKILL_NAMES } from "@/managers/gm/GMVocab";
import * as THREE from "three";
import { GameState } from "@/GameState";
import { GMManager } from "@/managers/GMManager";
import type { GMCreatureSpawnConfig, GMPlaceableSpawnConfig, GMCheck } from "@/managers/GMManager";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import { GMNpcOrders } from "@/managers/GMNpcOrders";
import type { GMNpcOrder } from "@/managers/GMNpcOrders";
import { OtherGameManager } from "@/managers/OtherGameManager";
import { ApplicationProfile } from "@/utility/ApplicationProfile";
import { GameEngineType } from "@/enums/engine/GameEngineType";
import type { ModuleCreature } from "@/module/ModuleCreature";
import type { ModuleObject } from "@/module/ModuleObject";
import { GMChecks } from "@/managers/gm/GMChecks";
import { GMPlayers } from "@/managers/gm/GMPlayers";
import { GMSpawner } from "@/managers/gm/GMSpawner";
import { GMViewport } from "@/managers/gm/GMViewport";
import { GMSeats } from "@/managers/gm/GMSeats";
import { GMObjectKind } from "@/managers/gm/GMObjectKind";
import { CharacterRules } from "@/engine/rules/CharacterRules";

/*
 * A scene plan: a whole GM scene written as data, so it can be drafted outside the game (by Claude, from a
 * conversation about the story) and imported. The format is documented for authors in
 * skills/kotor-gm-scenes/reference/format.md; keep the two in step.
 */

export type GMPlanGame = 'kotor' | 'tsl';

/**
 * A named spot in the area. Plans never use raw coordinates: the author can't see the area, so everything is
 * placed relative to spots that exist in it.
 * - "entry": where the area's module starts players
 * - "waypoint:<tag>": one of the area's waypoints
 * - "room:<name>": the middle of a room (layout room name, e.g. "m13aa_02a")
 * - "actor:<id>" / "prop:<id>": something this plan placed
 * - "players": where the plan puts the players
 */
export type GMPlanSpot = string;

export interface GMPlanPlacement {
  spot: GMPlanSpot;
  /** Metres from the spot along the area's x (east) and y (north) axes */
  offset?: [number, number];
  /** How several copies stand: around the spot, side by side, or bunched up (default) */
  formation?: 'cluster' | 'ring' | 'line';
  /** Metres between copies (default 1.5) */
  spacing?: number;
}

/** Degrees (0 = north, 90 = east), or "toward:<spot>" */
export type GMPlanFacing = number | string;

export type GMPlanFaction = 'hostile' | 'friendly' | 'neutral';

export type GMPlanOrder =
  | { kind: 'attack'; target: string }
  | { kind: 'follow'; target: string }
  | { kind: 'move'; to: GMPlanPlacement }
  | { kind: 'guard'; radius?: number }
  | { kind: 'patrol'; points: GMPlanPlacement[] }
  | { kind: 'flee' }
  | { kind: 'standDown' };

export interface GMPlanActor {
  id: string;
  name?: string;
  /** A creature template (.utc) of the running game */
  template?: string;
  faction: GMPlanFaction;
  count?: number;
  at: GMPlanPlacement;
  facing?: GMPlanFacing;
  /** Placed but hidden from players and inert until a beat reveals it */
  hidden?: boolean;
  bark?: string;
  /** A stance they hold (a GMManager.STANCES id, e.g. "meditate", "kneel_sad", "dead") */
  stance?: string;
  order?: GMPlanOrder;
  customize?: { appearance?: string; hp?: number; rightHand?: string; leftHand?: string; armor?: string; level?: number; class?: string | number };
  loot?: string[];
}

export interface GMPlanProp {
  id: string;
  name?: string;
  /** A placeable template (.utp) of the running game */
  template?: string;
  /** Or just a model: a placeables.2da label of the running game */
  appearance?: string;
  count?: number;
  at: GMPlanPlacement;
  facing?: GMPlanFacing;
  hidden?: boolean;
  container?: boolean;
  loot?: string[];
  locked?: { dc: number };
  skill?: { skill: string; dc: number };
  bark?: string;
  scale?: number;
}

export type GMPlanAction =
  | { do: 'reveal'; ids: string[] }
  | { do: 'hide'; ids: string[] }
  | { do: 'order'; ids: string[]; order: GMPlanOrder | null }
  | { do: 'faction'; ids: string[]; faction: GMPlanFaction }
  | { do: 'say'; id: string; text: string }
  | { do: 'animate'; ids: string[]; stance?: string; gesture?: string }
  | { do: 'narrate'; text: string }
  | { do: 'freezePlayers'; on: boolean }
  | { do: 'movePlayers'; to: GMPlanPlacement }
  | { do: 'check'; check: string; dc: number; secret?: boolean };

export interface GMPlanBeat {
  title: string;
  /** Read aloud / shown to players in chat when the beat runs */
  narration?: string;
  /** For the GM only */
  notes?: string;
  actions?: GMPlanAction[];
}

export interface GMScenePlanData {
  format: 'kotorjs-gm-scene';
  version: 1;
  title: string;
  summary?: string;
  gmNotes?: string;
  /** The game whose templates the actors and props use: the game the GM runs */
  content: GMPlanGame;
  area: { game: GMPlanGame; module: string; reason?: string };
  settings?: { npcAi?: boolean; deathRule?: 'kotor' | 'gm' | 'respawn' };
  players: { at: GMPlanPlacement; facing?: GMPlanFacing; frozen?: boolean; note?: string };
  actors?: GMPlanActor[];
  props?: GMPlanProp[];
  beats?: GMPlanBeat[];
}

export interface GMPlanProblem {
  level: 'error' | 'warning';
  where: string;
  message: string;
}

/**
 * GMScenePlan class.
 *
 * Imports a scene plan: loads its area (from either game), places its actors and props at their spots,
 * moves the players to their start, and keeps the plan's beats for the GM to run in order.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file GMScenePlan.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class GMScenePlan {

  static FORMAT = 'kotorjs-gm-scene';
  static SKILLS = GM_SKILL_NAMES.map((name) => name.toLowerCase());
  static SAVES: ('fortitude' | 'reflex' | 'will')[] = ['fortitude', 'reflex', 'will'];
  static ORDERS: GMPlanOrder['kind'][] = ['attack', 'follow', 'move', 'guard', 'patrol', 'flee', 'standDown'];
  static ACTIONS: GMPlanAction['do'][] = ['reveal', 'hide', 'order', 'faction', 'say', 'animate', 'narrate', 'freezePlayers', 'movePlayers', 'check'];
  static FACTIONS: Record<GMPlanFaction, number> = { hostile: GMFaction.HOSTILE, friendly: GMFaction.FRIENDLY, neutral: GMFaction.NEUTRAL };

  /** The plan running now, the objects each of its ids became, and the beats already run */
  static active: GMScenePlan | null = null;
  plan: GMScenePlanData;
  objects: Map<string, ModuleObject[]> = new Map();
  /** Orders actors had when placed hidden, given when they're revealed */
  pendingOrders: Map<string, GMPlanOrder> = new Map();

  /** Stances that sit in a chair: an actor with one, put on a seat prop, belongs inside it */
  static SEATED_STANCES = ['chair', 'chair_drunk', 'chair_pazaak'];

  /**
   * The seat an actor is meant to sit in: its spot is a prop that's a chair or bench, and its stance sits.
   * (KotOR II's plc_chair1 is a food pile; KotOR's is a chair the game calls "Food pile".)
   */
  seatFor(actor: GMPlanActor): string | undefined {
    const spot = String(actor.at?.spot || '');
    if (!spot.startsWith('prop:') || !GMScenePlan.SEATED_STANCES.includes(String(actor.stance || ''))) return undefined;
    const id = spot.slice(5);
    const prop = (this.plan.props || []).find((p) => p.id === id);
    if (!prop) return undefined;
    const template = String(prop.template || '').toLowerCase();
    if (template === 'plc_chair1') return this.plan.content === 'tsl' ? undefined : id;
    return /chair|bench|stool|seat|couch|sofa/.test(`${template} ${String(prop.appearance || '').toLowerCase()}`) ? id : undefined;
  }

  /** How far from where the plan puts a seated actor its seat may be (it sits in the nearest free one) */
  static SEAT_REACH = 1.6;

  /** Room an actor needs beside a prop (metres, about a creature's half-width) */
  static ACTOR_CLEARANCE = 0.45;

  /** How far an actor may be moved to get it out of a prop, before it's left where it is */
  static MAX_CLEARING_MOVE = 4;

  /** The solid props' footprints (their collision walkmesh, on the floor), by plan prop id */
  footprints: { id: string; box: THREE.Box3 }[] = [];
  beatsRun: Set<number> = new Set();
  log: string[] = [];

  constructor(plan: GMScenePlanData) {
    this.plan = plan;
  }

  // -------------------------------------------------------------------------------------------------
  // Reading and checking a plan
  // -------------------------------------------------------------------------------------------------

  static runningGame(): GMPlanGame {
    return ApplicationProfile.GameKey === GameEngineType.TSL ? 'tsl' : 'kotor';
  }

  /** The module name the engine loads for the plan's area (the other game's are borrowed) */
  static areaModuleName(plan: GMScenePlanData): string {
    const module = String(plan.area?.module || '').toLowerCase();
    return plan.area?.game && plan.area.game !== this.runningGame() ? OtherGameManager.foreignModuleName(module) : module;
  }

  static parse(json: string): { plan: GMScenePlanData | null; problems: GMPlanProblem[] } {
    let plan: any;
    try {
      plan = JSON.parse(json);
    } catch (e: any) {
      return { plan: null, problems: [{ level: 'error', where: 'file', message: `Not valid JSON: ${e?.message || e}` }] };
    }
    const problems = this.validate(plan);
    return { plan: problems.some((p) => p.level === 'error') ? null : plan, problems };
  }

  /** Check a plan's shape and references (ids, spots, orders), before anything is loaded */
  static validate(plan: any): GMPlanProblem[] {
    const problems: GMPlanProblem[] = [];
    const error = (where: string, message: string) => problems.push({ level: 'error', where, message });
    const warn = (where: string, message: string) => problems.push({ level: 'warning', where, message });
    if (!plan || typeof plan !== 'object') return [{ level: 'error', where: 'file', message: 'A scene plan is a JSON object.' }];
    if (plan.format !== this.FORMAT) error('format', `Expected "format": "${this.FORMAT}".`);
    if (plan.version !== 1) error('version', 'Only version 1 is supported.');
    if (!plan.area?.module) error('area', 'The area needs a module.');
    if (!['kotor', 'tsl'].includes(plan.area?.game)) error('area.game', 'The area\'s game is "kotor" or "tsl".');
    if (!['kotor', 'tsl'].includes(plan.content)) error('content', '"content" is "kotor" or "tsl": the game whose templates the actors and props use.');
    else if (plan.content !== this.runningGame()) {
      warn('content', `The plan's actors and props are ${plan.content === 'tsl' ? 'KotOR II' : 'KotOR'} templates, but this is ${this.runningGame() === 'tsl' ? 'KotOR II' : 'KotOR'}: some may look wrong.`);
    }
    if (!plan.players?.at?.spot) error('players.at', 'Say where the players start.');

    const ids = new Set<string>();
    const actorIds = new Set<string>();
    const propIds = new Set<string>();
    for (const [list, kind] of [[plan.actors || [], 'actor'], [plan.props || [], 'prop']] as [any[], string][]) {
      list.forEach((entry: any, i: number) => {
        const where = `${kind}s[${i}]`;
        if (!entry?.id) { error(where, 'Needs an id.'); return; }
        if (ids.has(entry.id)) error(where, `Duplicate id "${entry.id}".`);
        ids.add(entry.id);
        (kind === 'actor' ? actorIds : propIds).add(entry.id);
        if (!entry.at?.spot) error(where, 'Needs "at": { "spot": ... }.');
        if (kind === 'actor') {
          if (!entry.template) error(where, 'Needs a creature "template".');
          if (!this.FACTIONS[entry.faction as GMPlanFaction]) error(where, 'Faction is "hostile", "friendly" or "neutral".');
          const level = entry.customize?.level;
          if (level !== undefined && !(Number.isInteger(level) && level >= 1 && level <= 50)) error(where, 'customize.level is a whole number, 1 to 50.');
        } else if (!entry.template && !entry.appearance) {
          error(where, 'Needs a placeable "template" or an "appearance".');
        }
        if (entry.count !== undefined && !(entry.count >= 1 && entry.count <= 20)) error(where, 'Count is 1 to 20.');
        if (entry.skill && !this.SKILLS.includes(String(entry.skill.skill).toLowerCase())) error(where, `Unknown skill "${entry.skill.skill}".`);
      });
    }

    const spotOk = (spot: string, where: string) => {
      const [kind, name] = String(spot || '').split(':');
      if (['entry', 'players'].includes(spot)) return;
      if (kind === 'actor' && !actorIds.has(name)) error(where, `No actor "${name}".`);
      else if (kind === 'prop' && !propIds.has(name)) error(where, `No prop "${name}".`);
      else if (!['actor', 'prop', 'waypoint', 'room'].includes(kind) || !name) error(where, `Unknown spot "${spot}".`);
    };
    const orderOk = (order: any, where: string) => {
      if (!order) return;
      if (['attack', 'follow'].includes(order.kind) && order.target !== 'players' && !actorIds.has(order.target)) error(where, `No actor "${order.target}" to ${order.kind}.`);
      if (order.kind === 'move') spotOk(order.to?.spot, where);
      if (order.kind === 'patrol') (order.points || []).forEach((p: any) => spotOk(p?.spot, where));
      if (!this.ORDERS.includes(order.kind)) error(where, `Unknown order "${order.kind}".`);
    };
    // An empty stance means standing normally
    const stanceOk = (stance: any, where: string) => {
      if (stance && !GMManager.findAnimationChoice('stance', stance)) warn(where, `Unknown stance "${stance}".`);
    };
    spotOk(plan.players?.at?.spot, 'players.at');
    (plan.actors || []).forEach((a: any, i: number) => {
      spotOk(a?.at?.spot, `actors[${i}].at`);
      orderOk(a?.order, `actors[${i}].order`);
      stanceOk(a?.stance, `actors[${i}].stance`);
    });
    (plan.props || []).forEach((p: any, i: number) => spotOk(p?.at?.spot, `props[${i}].at`));
    (plan.beats || []).forEach((beat: any, b: number) => {
      if (!beat?.title) warn(`beats[${b}]`, 'A beat should have a title.');
      (beat?.actions || []).forEach((action: any, a: number) => {
        const where = `beats[${b}].actions[${a}]`;
        for (const id of action?.ids || (action?.id ? [action.id] : [])) {
          if (!ids.has(id)) error(where, `No actor or prop "${id}".`);
        }
        if (action?.do === 'order') orderOk(action.order, where);
        if (action?.do === 'movePlayers') spotOk(action.to?.spot, where);
        if (action?.do === 'animate') {
          if (action.stance === undefined && !action.gesture) error(where, 'Give a stance or a gesture.');
          stanceOk(action.stance, where);
          if (action.gesture && !GMManager.findAnimationChoice('gesture', action.gesture)) warn(where, `Unknown gesture "${action.gesture}".`);
        }
        if (!this.ACTIONS.includes(action?.do)) error(where, `Unknown action "${action?.do}".`);
      });
    });
    return problems;
  }

  // -------------------------------------------------------------------------------------------------
  // Spots
  // -------------------------------------------------------------------------------------------------

  /** Where a spot is in the loaded area, or null when it isn't there */
  resolveSpot(spot: GMPlanSpot): THREE.Vector3 | null {
    const area = GameState.module?.area;
    if (!area) return null;
    const [kind, ...rest] = String(spot || '').split(':');
    const name = rest.join(':').toLowerCase();
    if (spot === 'entry') return GMPlayers.getRespawnPoint();
    if (spot === 'players') return this.playerStart ? this.playerStart.clone() : GMPlayers.getRespawnPoint();
    if (kind === 'waypoint') {
      const wp = area.waypoints.find((w: any) => String(w.getTag?.() || w.tag || '').toLowerCase() === name);
      return wp ? wp.position.clone() : null;
    }
    if (kind === 'room') {
      const room = area.rooms.find((r: any) => String(r.roomName || '').toLowerCase() === name);
      return room ? GMScenePlan.roomPoint(room) : null;
    }
    if (kind === 'actor' || kind === 'prop') {
      const obj = this.objects.get(name)?.[0] || this.objects.get(rest.join(':'))?.[0];
      return obj ? obj.position.clone() : null;
    }
    return null;
  }

  /** A walkable point in the middle of a room: the walkable face nearest the centre of its walkable faces */
  static roomPoint(room: any): THREE.Vector3 | null {
    const faces = room?.collisionManager?.walkmesh?.walkableFaces || [];
    if (!faces.length) {
      const box = new THREE.Box3().setFromObject(room.model || room.container);
      return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
    }
    const centre = new THREE.Vector3();
    const centroids = faces.map((f: any) => {
      const c = new THREE.Vector3();
      f.triangle.getMidpoint(c);
      centre.add(c);
      return c;
    });
    centre.divideScalar(centroids.length);
    let best = centroids[0];
    for (const c of centroids) if (c.distanceToSquared(centre) < best.distanceToSquared(centre)) best = c;
    return best.clone();
  }

  /** A classes.2da row by its label or name ("Soldier", "jedi guardian", "Combat_Droid"), or its number */
  static classIdOf(name: string | number): number | undefined {
    if (typeof name === 'number' || /^\d+$/.test(String(name))) return Number(name);
    const norm = (s: any) => String(s || '').toLowerCase().replace(/[\s_-]+/g, '');
    const key = norm(name);
    const rows = GameState.TwoDAManager?.datatables.get('classes')?.rows || {};
    for (const [id, row] of Object.entries(rows) as [string, any][]) {
      if (norm(row.label) === key || norm(CharacterRules.text(row.name, '')) === key) return Number(id);
    }
    return undefined;
  }

  /** Points for count copies at a placement: offset from the spot, in a formation, on walkable ground */
  placementPoints(at: GMPlanPlacement, count: number): THREE.Vector3[] | null {
    const base = this.resolveSpot(at.spot);
    if (!base) return null;
    if (at.offset) { base.x += Number(at.offset[0]) || 0; base.y += Number(at.offset[1]) || 0; }
    const spacing = at.spacing && at.spacing > 0 ? at.spacing : 1.5;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const p = base.clone();
      if (count > 1) {
        if (at.formation === 'line') {
          p.x += (i - (count - 1) / 2) * spacing;
        } else if (at.formation === 'ring') {
          const radius = Math.max(spacing, (spacing * count) / (2 * Math.PI));
          const angle = (i / count) * Math.PI * 2;
          p.x += Math.cos(angle) * radius;
          p.y += Math.sin(angle) * radius;
        } else {
          // Cluster: a small spiral, so nobody stands inside anyone else
          const angle = i * 2.4;
          const radius = spacing * 0.6 * Math.sqrt(i);
          p.x += Math.cos(angle) * radius;
          p.y += Math.sin(angle) * radius;
        }
      }
      points.push(this.walkable(p));
    }
    return points;
  }

  walkable(p: THREE.Vector3): THREE.Vector3 {
    const area = GameState.module?.area;
    const snapped = area?.getNearestWalkablePoint ? area.getNearestWalkablePoint(p, 0.5).clone() : p.clone();
    snapped.z = GMViewport.getGroundZAt(snapped.x, snapped.y, snapped.z);
    return snapped;
  }

  /** Engine facing (radians) for a plan facing, seen from a point; default: toward the players */
  facingFrom(from: THREE.Vector3, facing: GMPlanFacing | undefined): number {
    let target: THREE.Vector3 | null = null;
    // Degrees clockwise from north (90 = east); the engine's facing turns the other way (a creature at f looks
    // along (-sin f, cos f)), so 90 must be -90 to it
    if (typeof facing === 'number') return -(facing * Math.PI) / 180;
    if (typeof facing === 'string' && facing.startsWith('toward:')) target = this.resolveSpot(facing.slice(7));
    if (!target) target = this.resolveSpot('players');
    if (!target || target.distanceTo(from) < 0.1) return 0;
    return Math.atan2(-(target.x - from.x), target.y - from.y);
  }

  // -------------------------------------------------------------------------------------------------
  // Importing
  // -------------------------------------------------------------------------------------------------

  playerStart: THREE.Vector3 | null = null;

  /** Load a plan: its area, then everything in it. Reports what couldn't be placed in the log. */
  static async import(plan: GMScenePlanData): Promise<GMScenePlan | null> {
    const runner = new GMScenePlan(plan);
    const moduleName = this.areaModuleName(plan);
    GMScenePlan.active = runner;
    GMManager.loadScene(moduleName, { keepCreatures: false, keepTriggers: false, keepPlaceables: false, preserveParty: true });
    if (!(await GMManager.waitForScene(moduleName))) {
      runner.note(`Couldn't load the area ${moduleName}.`);
      GMManager.notifyChange();
      return runner;
    }
    await runner.populate();
    return runner;
  }

  note(text: string) {
    this.log.push(text);
  }

  async populate() {
    const plan = this.plan;
    if (plan.settings?.deathRule) GMPlayers.setDeathRule(plan.settings.deathRule);
    if (typeof plan.settings?.npcAi === 'boolean') GMManager.npcAiEnabled = plan.settings.npcAi;

    // Players first: other spots may be "players"
    const start = this.placementPoints({ ...plan.players.at, formation: undefined }, 1)?.[0];
    if (!start) this.note(`Players' spot "${plan.players.at.spot}" isn't in this area; they start at its entry.`);
    this.playerStart = start || GMPlayers.getRespawnPoint();
    GMManager.sceneStartPoint = this.playerStart ? this.playerStart.clone() : null;

    for (const prop of plan.props || []) await this.placeProp(prop);
    this.footprints = this.propFootprints();
    for (const actor of plan.actors || []) await this.placeActor(actor);
    // Orders last, once everyone they mention exists
    for (const actor of plan.actors || []) {
      if (!actor.order) continue;
      if (actor.hidden) this.pendingOrders.set(actor.id, actor.order);
      else this.giveOrder([actor.id], actor.order);
    }

    this.movePlayers(plan.players.at, plan.players.facing);
    GMManager.setPlayersFrozen(!!plan.players.frozen);
    GMNetworkManager.appendChat('System', `Scene "${plan.title}" is set.${this.log.length ? ` ${this.log.length} thing(s) to check in the plan panel.` : ''}`);
    GMManager.notifyChange();
  }

  /** Where each placed prop can't be walked through: its collision walkmesh's bounds, on the floor plan */
  propFootprints(): { id: string; box: THREE.Box3 }[] {
    const out: { id: string; box: THREE.Box3 }[] = [];
    for (const prop of this.plan.props || []) {
      for (const obj of this.objects.get(prop.id) || []) {
        // The walkmesh's vertices are where the prop stands, turned as it's turned (as in the scene catalog)
        const vertices = obj.collisionManager?.walkmesh?.vertices || [];
        if (!vertices.length) continue;
        const box = new THREE.Box3().setFromPoints(vertices);
        if (box.isEmpty() || box.max.x - box.min.x < 0.05 || box.max.y - box.min.y < 0.05) continue;
        out.push({ id: prop.id, box });
      }
    }
    return out;
  }

  /** The footprint a floor point stands in (with room for an actor), if any; exempt: a seat it's meant to be on */
  footprintAt(p: THREE.Vector3, exempt?: string): { id: string; box: THREE.Box3 } | null {
    const c = GMScenePlan.ACTOR_CLEARANCE;
    return this.footprints.find((f) => f.id !== exempt &&
      p.x > f.box.min.x - c && p.x < f.box.max.x + c && p.y > f.box.min.y - c && p.y < f.box.max.y + c) || null;
  }

  /**
   * An actor's point moved just clear of any prop it stands in: to the nearest side of the prop that's floor
   * and not inside another prop. Null when it's clear already, or there's nowhere close to go.
   */
  clearOfProps(p: THREE.Vector3, exempt?: string): { point: THREE.Vector3; from: string } | null {
    const first = this.footprintAt(p, exempt);
    if (!first) return null;
    const c = GMScenePlan.ACTOR_CLEARANCE + 0.05;
    let best: THREE.Vector3 | null = null;
    let bestDistance = Infinity;
    // The sides of every prop it touches, and a ring of points around it, nearest first
    const candidates: THREE.Vector3[] = [];
    for (const f of this.footprints) {
      const k = GMScenePlan.ACTOR_CLEARANCE;
      if (f.id === exempt || !(p.x > f.box.min.x - k && p.x < f.box.max.x + k && p.y > f.box.min.y - k && p.y < f.box.max.y + k)) continue;
      candidates.push(
        new THREE.Vector3(f.box.min.x - c, p.y, p.z), new THREE.Vector3(f.box.max.x + c, p.y, p.z),
        new THREE.Vector3(p.x, f.box.min.y - c, p.z), new THREE.Vector3(p.x, f.box.max.y + c, p.z),
      );
    }
    for (let r = 0.5; r <= GMScenePlan.MAX_CLEARING_MOVE; r += 0.5) {
      for (let a = 0; a < 12; a++) candidates.push(new THREE.Vector3(p.x + Math.cos((a / 12) * Math.PI * 2) * r, p.y + Math.sin((a / 12) * Math.PI * 2) * r, p.z));
    }
    for (const candidate of candidates) {
      const d = Math.hypot(candidate.x - p.x, candidate.y - p.y);
      if (d >= bestDistance || d > GMScenePlan.MAX_CLEARING_MOVE) continue;
      const onFloor = this.walkable(candidate);
      // Snapping to the floor mustn't carry it far, or back into a prop
      if (Math.hypot(onFloor.x - candidate.x, onFloor.y - candidate.y) > 0.3 || this.footprintAt(onFloor, exempt)) continue;
      best = onFloor;
      bestDistance = d;
    }
    return best ? { point: best, from: first.id } : null;
  }

  async placeActor(actor: GMPlanActor) {
    const count = Math.max(1, Math.min(20, actor.count || 1));
    const points = this.placementPoints(actor.at, count);
    if (!points) { this.note(`Actor "${actor.id}": spot "${actor.at.spot}" isn't in this area.`); return; }
    // Nobody stands inside a table or a crate: a copy that would is moved just clear of it. A seated actor put on
    // a seat prop is meant to be in it
    const seat = this.seatFor(actor);
    const moved: string[] = [];
    let stuck = 0;
    // A sitter with a free seat within reach sits in it (below): it isn't moved clear of that seat's prop first
    const seated = !!actor.stance && GMScenePlan.SEATED_STANCES.includes(actor.stance);
    const seatProps = seated ? [...this.objects.values()].flat().filter((o) => GMObjectKind.isPlaceable(o)) : [];
    for (let i = 0; i < points.length; i++) {
      if (seated && GMSeats.nearestFree(seatProps, points[i], GMScenePlan.SEAT_REACH)) continue;
      if (!this.footprintAt(points[i], seat)) continue;
      const clear = this.clearOfProps(points[i], seat);
      if (clear) {
        moved.push(`${clear.from} (${Math.hypot(clear.point.x - points[i].x, clear.point.y - points[i].y).toFixed(1)} m)`);
        points[i] = clear.point;
      } else {
        stuck++;
      }
    }
    if (moved.length) this.note(`Actor "${actor.id}": ${moved.length} of ${points.length} stood inside a prop (${[...new Set(moved)].join(', ')}); moved just clear of it. Place it beside the prop, not on it.`);
    if (stuck) this.note(`Actor "${actor.id}": ${stuck} of ${points.length} stand inside a prop with no clear floor within ${GMScenePlan.MAX_CLEARING_MOVE} m; left there.`);
    const info = await GMSpawner.describeCreatureTemplate(String(actor.template || ''));
    if (!info) { this.note(`Actor "${actor.id}": no creature template "${actor.template}".`); return; }
    const base = GMSpawner.creatureConfigFromTemplate(info);
    const custom = actor.customize;
    // Level and class rebuild its stats; the rest of customize replaces its look and gear
    const restyled = !!custom && ['appearance', 'hp', 'rightHand', 'leftHand', 'armor'].some((k) => (custom as any)[k] !== undefined);
    let restat: GMCreatureSpawnConfig['restat'];
    if (custom && (custom.level !== undefined || custom.class !== undefined)) {
      const classId = custom.class !== undefined ? GMScenePlan.classIdOf(custom.class) : undefined;
      if (custom.class !== undefined && classId === undefined) this.note(`Actor "${actor.id}": no class "${custom.class}"; it keeps its own.`);
      restat = { level: Number(custom.level) || base.level || 1, classId, hp: custom.hp };
    }
    const config: GMCreatureSpawnConfig = {
      ...base,
      name: actor.name || base.name,
      factionId: GMScenePlan.FACTIONS[actor.faction] ?? base.factionId,
      barkText: actor.bark,
      lootResRefs: actor.loot,
      customized: restyled,
      restat,
      ...(restyled && custom ? {
        appearanceLabel: custom.appearance,
        hp: custom.hp ?? base.hp,
        rightHandResRef: custom.rightHand,
        leftHandResRef: custom.leftHand,
        armorResRef: custom.armor,
      } : {}),
    };
    const placed: ModuleObject[] = [];
    for (let i = 0; i < points.length; i++) {
      const name = count > 1 && actor.name ? `${actor.name} ${i + 1}` : config.name;
      const cre = await GMSpawner.spawnCreature({ ...config, name }, points[i], this.facingFrom(points[i], actor.facing));
      if (!cre) continue;
      // Each model picks its own take on the stance (a droid lies dead differently)
      if (actor.stance && !GMManager.setCreatureStance(cre, actor.stance)) this.note(`Actor "${actor.id}": its model can't take the stance "${actor.stance}".`);
      // Sitting: into the free seat nearest where the plan put it, at the seat's own spot and facing (each chair
      // model faces its own way, and the sitter's hips sit behind its origin)
      if (actor.stance && GMScenePlan.SEATED_STANCES.includes(actor.stance)) {
        const props = [...this.objects.values()].flat().filter((o) => GMObjectKind.isPlaceable(o));
        const spot = GMSeats.nearestFree(props, points[i], GMScenePlan.SEAT_REACH, this.facingFrom(points[i], actor.facing));
        if (spot) GMSeats.sitAt(cre, spot, actor.stance);
        else this.note(`Actor "${actor.id}": ${name} sits with no free seat within ${GMScenePlan.SEAT_REACH} m; give it a chair or bench of its own.`);
      }
      if (actor.hidden) this.setHidden(cre, true);
      placed.push(cre);
    }
    this.objects.set(actor.id, placed);
  }

  async placeProp(prop: GMPlanProp) {
    const count = Math.max(1, Math.min(20, prop.count || 1));
    const points = this.placementPoints(prop.at, count);
    if (!points) { this.note(`Prop "${prop.id}": spot "${prop.at.spot}" isn't in this area.`); return; }
    const skillIndex = prop.skill ? GMScenePlan.SKILLS.indexOf(String(prop.skill.skill).toLowerCase()) : -1;
    const config: GMPlaceableSpawnConfig = {
      name: prop.name || prop.template || prop.appearance || 'Prop',
      templateResRef: prop.template,
      appearanceId: 0,
      appearanceLabel: prop.appearance,
      customized: !prop.template || !!prop.name || prop.container !== undefined || !!prop.locked,
      scale: prop.scale,
      useable: true,
      hasInventory: !!prop.container || !!prop.loot?.length,
      locked: !!prop.locked,
      openLockDC: prop.locked?.dc || 15,
      lootResRefs: prop.loot || [],
      barkText: prop.bark,
      skillGate: skillIndex >= 0 ? { skill: skillIndex, dc: prop.skill!.dc } : undefined,
    };
    const placed: ModuleObject[] = [];
    for (const point of points) {
      const plc = await GMSpawner.spawnPlaceable(config, point, this.facingFrom(point, prop.facing));
      if (!plc) continue;
      if (prop.hidden) this.setHidden(plc, true);
      placed.push(plc);
    }
    if (!placed.length) this.note(`Prop "${prop.id}" couldn't be placed.`);
    this.objects.set(prop.id, placed);
  }

  /** Hidden from players, and an NPC does nothing while hidden */
  setHidden(obj: ModuleObject, hidden: boolean) {
    GMManager.setObjectHidden(obj, hidden);
    if (GMManager.canOrder(obj)) {
      if (hidden) GMNpcOrders.setOrder(obj as ModuleCreature, { kind: 'standDown' });
      else if (GMNpcOrders.getOrder(obj)?.kind === 'standDown') GMNpcOrders.setOrder(obj as ModuleCreature, undefined);
    }
  }

  /** Living objects for some ids */
  objectsFor(ids: string[]): ModuleObject[] {
    return ids.flatMap((id) => this.objects.get(id) || []).filter((o) => o && !o.destroyed);
  }

  giveOrder(ids: string[], order: GMPlanOrder | null) {
    const subjects = this.objectsFor(ids).filter((o) => GMManager.canOrder(o)) as ModuleCreature[];
    subjects.forEach((cre, i) => {
      if (!order) { GMManager.giveOrder(cre, undefined); return; }
      if (order.kind === 'guard') {
        GMManager.giveOrder(cre, { kind: 'guard', point: GMManager.pointOf(cre), radius: order.radius || GMNpcOrders.GUARD_RADIUS });
        return;
      }
      const engineOrder = this.toEngineOrder(order, i);
      if (engineOrder) GMManager.giveOrder(cre, engineOrder);
    });
  }

  /** A plan order as an engine order; groups of targets are shared out among the subjects */
  toEngineOrder(order: GMPlanOrder, index: number): GMNpcOrder | null {
    const point = (p: THREE.Vector3) => ({ x: p.x, y: p.y, z: p.z });
    const targetNetId = (target: string) => {
      const candidates = target === 'players'
        ? GMManager.getPlayerCharacters().filter((c) => !c.isDead())
        : (this.objects.get(target) || []).filter((o) => !o.destroyed && !(o as ModuleCreature).isDead?.());
      const chosen = candidates[index % Math.max(1, candidates.length)];
      return chosen?.gmNetId as string | undefined;
    };
    switch (order.kind) {
      case 'attack':
      case 'follow': {
        const id = targetNetId(order.target);
        return id ? { kind: order.kind, targetNetId: id } : null;
      }
      case 'move': {
        const p = this.placementPoints(order.to, 1)?.[0];
        return p ? { kind: 'move', point: point(p) } : null;
      }
      case 'guard':
        return null; // filled in per creature below
      case 'patrol': {
        const points = order.points.map((p) => this.placementPoints(p, 1)?.[0]).filter(Boolean) as THREE.Vector3[];
        return points.length >= 2 ? { kind: 'patrol', points: points.map(point), index: 0 } : null;
      }
      case 'flee':
        return { kind: 'flee' };
      case 'standDown':
        return { kind: 'standDown' };
    }
    return null;
  }

  movePlayers(at: GMPlanPlacement, facing?: GMPlanFacing) {
    const pcs = GMManager.getPlayerCharacters();
    if (!pcs.length) return;
    const points = this.placementPoints({ ...at, formation: at.formation || 'line' }, pcs.length);
    if (!points) return;
    pcs.forEach((pc, i) => {
      GMManager.teleportObject(pc, points[i]);
      pc.setFacing(this.facingFrom(points[i], facing), true);
    });
  }

  // -------------------------------------------------------------------------------------------------
  // Beats
  // -------------------------------------------------------------------------------------------------

  /** Run a beat: its narration to everyone, then its actions in order */
  runBeat(index: number) {
    const beat = this.plan.beats?.[index];
    if (!beat) return;
    if (beat.narration) this.narrate(beat.narration);
    for (const action of beat.actions || []) this.runAction(action);
    this.beatsRun.add(index);
    GMManager.notifyChange();
  }

  narrate(text: string) {
    if (GMNetworkManager.role === 'host') GMNetworkManager.sendChat('GM', text);
    else GMNetworkManager.appendChat('GM', text);
    GameState.MenuManager?.InGameBark?.barkFromString(text);
  }

  runAction(action: GMPlanAction) {
    switch (action.do) {
      case 'reveal':
        for (const obj of this.objectsFor(action.ids)) this.setHidden(obj, false);
        for (const id of action.ids) {
          const order = this.pendingOrders.get(id);
          if (order) { this.pendingOrders.delete(id); this.giveOrder([id], order); }
        }
        break;
      case 'hide':
        for (const obj of this.objectsFor(action.ids)) this.setHidden(obj, true);
        break;
      case 'order':
        this.giveOrder(action.ids, action.order);
        break;
      case 'faction':
        for (const obj of this.objectsFor(action.ids)) GMManager.assignFaction(obj as ModuleCreature, GMScenePlan.FACTIONS[action.faction]);
        break;
      case 'say': {
        const obj = this.objectsFor([action.id])[0];
        if (obj) GMManager.triggerBarkNow(obj, `${obj.getName()}: ${action.text}`);
        break;
      }
      case 'animate':
        for (const obj of this.objectsFor(action.ids)) {
          if (action.stance !== undefined && !GMManager.setCreatureStance(obj, action.stance)) {
            this.note(`${obj.getName()} can't take the stance "${action.stance}".`);
          }
          if (action.gesture) GMManager.playGesture(obj, action.gesture);
        }
        break;
      case 'narrate':
        this.narrate(action.text);
        break;
      case 'freezePlayers':
        GMManager.setPlayersFrozen(!!action.on);
        break;
      case 'movePlayers':
        this.movePlayers(action.to);
        break;
      case 'check': {
        const check = GMScenePlan.parseCheck(action.check);
        if (check) GMChecks.callCheck(GMManager.getPlayerCharacters(), check, action.dc, !!action.secret);
        break;
      }
    }
  }

  /** "persuade", "awareness", "fortitude", "will"... as a GM check */
  static parseCheck(name: string): GMCheck | null {
    const key = String(name || '').toLowerCase();
    const skill = this.SKILLS.indexOf(key);
    if (skill >= 0) return { kind: 'skill', skill };
    if ((this.SAVES as string[]).includes(key)) return { kind: 'save', save: key as 'fortitude' | 'reflex' | 'will' };
    return null;
  }

}

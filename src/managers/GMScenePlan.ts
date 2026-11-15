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
  customize?: { appearance?: string; hp?: number; rightHand?: string; leftHand?: string; armor?: string };
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
  static FACTIONS: Record<GMPlanFaction, number> = { hostile: GMFaction.HOSTILE, friendly: GMFaction.FRIENDLY, neutral: GMFaction.NEUTRAL };

  /** The plan running now, the objects each of its ids became, and the beats already run */
  static active: GMScenePlan | null = null;
  plan: GMScenePlanData;
  objects: Map<string, ModuleObject[]> = new Map();
  /** Orders actors had when placed hidden, given when they're revealed */
  pendingOrders: Map<string, GMPlanOrder> = new Map();
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
      if (!['attack', 'follow', 'move', 'guard', 'patrol', 'flee', 'standDown'].includes(order.kind)) error(where, `Unknown order "${order.kind}".`);
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
        if (!['reveal', 'hide', 'order', 'faction', 'say', 'animate', 'narrate', 'freezePlayers', 'movePlayers', 'check'].includes(action?.do)) error(where, `Unknown action "${action?.do}".`);
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
    if (typeof facing === 'number') return (facing * Math.PI) / 180;
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

  async placeActor(actor: GMPlanActor) {
    const count = Math.max(1, Math.min(20, actor.count || 1));
    const points = this.placementPoints(actor.at, count);
    if (!points) { this.note(`Actor "${actor.id}": spot "${actor.at.spot}" isn't in this area.`); return; }
    const info = await GMSpawner.describeCreatureTemplate(String(actor.template || ''));
    if (!info) { this.note(`Actor "${actor.id}": no creature template "${actor.template}".`); return; }
    const base = GMSpawner.creatureConfigFromTemplate(info);
    const custom = actor.customize;
    const config: GMCreatureSpawnConfig = {
      ...base,
      name: actor.name || base.name,
      factionId: GMScenePlan.FACTIONS[actor.faction] ?? base.factionId,
      barkText: actor.bark,
      lootResRefs: actor.loot,
      customized: !!custom,
      ...(custom ? {
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
    if (['fortitude', 'reflex', 'will'].includes(key)) return { kind: 'save', save: key as 'fortitude' | 'reflex' | 'will' };
    return null;
  }

}

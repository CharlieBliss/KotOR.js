import * as THREE from "three";
import { ResourceLoader } from "@/loaders/ResourceLoader";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { GFFObject } from "@/resource/GFFObject";
import type { GFFStruct } from "@/resource/GFFStruct";
import type { GFFField } from "@/resource/GFFField";
import { TLKManager } from "@/managers/TLKManager";
import { OdysseyWalkMesh } from "@/odyssey/OdysseyWalkMesh";
import { BinaryReader } from "@/utility/binary/BinaryReader";
import type { OdysseyFace3 } from "@/three/odyssey";
import { Module } from "@/module/Module";
import { AreaSetPiece } from "@/module/AreaSetPiece";
import { OtherGameManager } from "@/managers/OtherGameManager";

/** A room's name: the GM's own, or a best guess from what's in the room, and what the guess was based on */
export interface GMRoomName {
  room: string;
  /** The best guess (the GM's own name is GMRoomNames.roomName) */
  name: string;
  /** What the guess is based on, for a tooltip: its map note, what's in it, its size and shape, its neighbours */
  hints: string[];
  /** Walkable floor (m²) */
  m2: number;
  /** No floor: a backdrop (a sky, space outside a ship) rather than somewhere to stand */
  scenery: boolean;
}

export interface GMAreaNames {
  module: string;
  /** The area's own name (its .are), e.g. "Ebon Hawk" */
  area: string;
  rooms: Record<string, GMRoomName>;
}

/** What a room has in it, gathered from the area's objects */
interface RoomFacts {
  notes: string[];
  things: string[];
  doors: string[];
  people: string[];
  spots: string[];
  tags: string[];
}

/**
 * GMRoomNames class.
 *
 * Names for an area's rooms, which the game files only know by code ("m12aa_01k"). Rooms have no names of their own,
 * but the area's objects do, and each stands in a room:
 * 1. map notes (the player's map labels, written by the designers): "Cargo Hold", "Jedi Council Chamber";
 * 2. what's in the room: a galaxy map, a workbench, a merchant, a crew member's spot ("pebn_bastila"), by keyword;
 * 3. its shape (corridor, small room, hall, open area) and, for corridors, the named rooms it joins.
 * The GM can name rooms and areas themselves; those names are kept in this browser (and with the sets that use them).
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file GMRoomNames.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class GMRoomNames {

  static STORAGE_KEY = 'kotor_gm_room_names_v1';
  /** Rooms this big are open areas: a map note in one marks a spot in it, not the room */
  static OPEN_AREA_M2 = 800;

  static estimates: Map<string, Promise<GMAreaNames | null>> = new Map();
  static ready: Map<string, GMAreaNames> = new Map();
  /** Called when an area's names are known (the panel redraws) */
  static onReady: ((names: GMAreaNames) => void) | null = null;

  /** What a room is, by a word in what's in it: [pattern, name], first match wins within a source */
  static KEYWORDS: [RegExp, string][] = [
    [/galaxy ?map|showmap|holomap|star ?map/i, 'Galaxy Map'],
    [/cockpit|pilot/i, 'Cockpit'],
    [/council/i, 'Council Chamber'],
    [/throne/i, 'Throne Room'],
    [/bridge/i, 'Bridge'],
    [/engine/i, 'Engine Room'],
    [/hangar|swoop|garage/i, 'Hangar'],
    [/cargo/i, 'Cargo Hold'],
    [/med ?bay|medical|kolto|med ?station/i, 'Med Bay'],
    [/lab ?station|laborator/i, 'Lab'],
    [/work ?bench|workshop/i, 'Workshop'],
    [/armou?ry|weapon ?rack/i, 'Armory'],
    [/pazaak/i, 'Pazaak Den'],
    [/cantina|\bbar\b|bartender|drink/i, 'Cantina'],
    [/store|merchant|shop|vendor|mercantile/i, 'Shop'],
    [/prison|cell\b|cage\b|detention/i, 'Cells'],
    [/training|sparring|duel/i, 'Training Room'],
    [/library|archive/i, 'Archives'],
    [/meditat|garden/i, 'Garden'],
    [/ramp/i, 'Boarding Ramp'],
    [/footlocker|bunk|\bbeds?\b|quarters/i, 'Quarters'],
  ];

  /** A crew member's or NPC's spot, from a waypoint tag: pebn_bastila, WP_gspawn_atton, POST_dan13_zhar */
  static SPOT_TAG = /^(?:pebn_|wp_gspawn_|post_[a-z0-9]+_)([a-z][a-z0-9]*[a-z0-9])$/i;
  /** Rooms smaller than this are named by a waypoint's tag; in bigger ones a tag marks a spot, not the room */
  static TAG_ROOM_M2 = 300;

  /** A name from a tag: "bastila" -> "Bastila", "t3m4" -> "T3M4" (a droid's code), "zaalbar2" -> "Zaalbar" */
  static display(word: string): string {
    const w = /^[a-z]+\d+$/i.test(word) && word.length > 5 ? word.replace(/\d+$/, '') : word;
    return /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }

  // -------------------------------------------------------------------------------------------------
  // The GM's own names (this browser)
  // -------------------------------------------------------------------------------------------------

  static custom(): Record<string, { area?: string; rooms?: Record<string, string> }> {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.STORAGE_KEY) : null;
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  /** Name a room (or, with room null, the area) of a module; an empty name goes back to the guess */
  static setCustom(module: string, room: string | null, name: string) {
    const key = String(module || '').toLowerCase();
    const all = this.custom();
    const entry = all[key] || {};
    const clean = String(name || '').trim();
    if (room === null) {
      if (clean) entry.area = clean; else delete entry.area;
    } else {
      entry.rooms = { ...(entry.rooms || {}) };
      if (clean) entry.rooms[room.toLowerCase()] = clean; else delete entry.rooms[room.toLowerCase()];
    }
    all[key] = entry;
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(all)); } catch (e) { /* private window */ }
  }

  /** A room's name: the GM's, else the guess (once worked out), else its code */
  static roomName(module: string, room: string): string {
    const key = String(module || '').toLowerCase(), code = String(room || '').toLowerCase();
    return this.custom()[key]?.rooms?.[code] || this.ready.get(key)?.rooms[code]?.name || code;
  }

  /** An area's name: the GM's, else its own (once read), else the module's */
  static areaName(module: string): string {
    const key = String(module || '').toLowerCase();
    return this.custom()[key]?.area || this.ready.get(key)?.area || key;
  }

  /** The guess and what it rests on, once worked out */
  static about(module: string, room: string): GMRoomName | undefined {
    return this.ready.get(String(module || '').toLowerCase())?.rooms[String(room || '').toLowerCase()];
  }

  // -------------------------------------------------------------------------------------------------
  // Guessing
  // -------------------------------------------------------------------------------------------------

  /** An area's room names, worked out once per module (a module of either game) */
  static estimate(module: string): Promise<GMAreaNames | null> {
    const key = String(module || '').toLowerCase();
    if (!key) return Promise.resolve(null);
    if (!this.estimates.has(key)) {
      const work = this.work(key).catch((e): GMAreaNames | null => { console.warn('[GMRoomNames] failed', key, e); return null; });
      this.estimates.set(key, work);
      work.then((names) => {
        if (!names) { this.estimates.delete(key); return; }
        this.ready.set(key, names);
        this.onReady?.(names);
      });
    }
    return this.estimates.get(key)!;
  }

  private static async work(module: string): Promise<GMAreaNames | null> {
    const foreign = OtherGameManager.isForeignModule(module);
    if (foreign) {
      if (!(await OtherGameManager.mount())) return null;
      await OtherGameManager.loadTalkTable();
    }
    const source = await AreaSetPiece.loadSource(module);
    if (!source) return null;
    let archives: any[] = [];
    try { archives = await Module.GetModuleArchives(module); } catch (e) { archives = []; }

    // Resources: the module's own, then its game's (the other game's for a borrowed area)
    const resource = async (resRef: string, type: number): Promise<Uint8Array | undefined> => {
      const ref = String(resRef || '').toLowerCase();
      if (!ref) return undefined;
      for (const archive of archives) {
        try { if (archive?.hasResource?.(ref, type)) return await archive.getResourceBufferByResRef(ref, type); } catch (e) { /* next */ }
      }
      try {
        return foreign ? await OtherGameManager.getResource(type, ref) : await ResourceLoader.loadResource(type, ref);
      } catch (e) {
        return undefined;
      }
    };
    const gff = async (resRef: string, type: number) => {
      const buffer = await resource(resRef, type);
      try { return buffer?.length ? new GFFObject(buffer) : null; } catch (e) { return null; }
    };
    const text = (field: GFFField | undefined): string => {
      if (!field) return '';
      const loc = field.getCExoLocString?.();
      if (!loc) return String(field.getValue?.() ?? '').trim();
      const own = loc.strings?.[0]?.str;
      if (own) return String(own).trim();
      const ref = Number(loc.RESREF);
      if (!(ref >= 0)) return '';
      return String((foreign ? OtherGameManager.text(ref) : TLKManager.TLKStrings[ref]?.getDisplayText?.()) || '').trim();
    };
    const field = (s: GFFStruct, label: string) => (s.hasField(label) ? s.getFieldByLabel(label) : undefined);
    const num = (s: GFFStruct, ...labels: string[]) => {
      for (const l of labels) { const f = field(s, l); if (f) return Number(f.getValue()); }
      return NaN;
    };
    const str = (s: GFFStruct, label: string) => String(field(s, label)?.getValue() ?? '').trim();

    // Each room's floor, in the source area (room walkmeshes are in its coordinates)
    const floors = new Map<string, OdysseyWalkMesh>();
    for (const r of source.rooms) {
      const buffer = await resource(r.name, ResourceTypes['wok']);
      if (!buffer?.length) continue;
      try { floors.set(r.name, new OdysseyWalkMesh(new BinaryReader(buffer))); } catch (e) { /* no floor */ }
    }
    const roomAt = (x: number, y: number, z?: number): string | null => {
      const p = new THREE.Vector3(x, y, z ?? 0);
      let best: string | null = null, bestDz = Infinity;
      for (const [name, wok] of floors) {
        for (const f of wok.walkableFaces) {
          if (!f.pointInFace2d(p)) continue;
          const dz = z === undefined ? 0 : Math.abs(f.centroid.z - z);
          if (dz < bestDz) { bestDz = dz; best = name; }
        }
      }
      return best;
    };

    const facts = new Map<string, RoomFacts>();
    for (const r of source.rooms) facts.set(r.name, { notes: [], things: [], doors: [], people: [], spots: [], tags: [] });
    const at = (x: number, y: number, z: number | undefined, fill: (f: RoomFacts) => void) => {
      if (isNaN(x) || isNaN(y)) return;
      const room = roomAt(x, y, isNaN(z as number) ? undefined : z);
      if (room) fill(facts.get(room)!);
    };

    const are = await gff(source.areaName, ResourceTypes['are']);
    const areaTitle = are ? text(field(are.RootNode, 'Name')) : '';
    const git = await gff(source.areaName, ResourceTypes['git']);
    const list = (label: string): GFFStruct[] => (git?.RootNode.hasField(label) ? git.RootNode.getFieldByLabel(label).getChildStructs() : []);

    for (const s of list('WaypointList')) {
      const x = num(s, 'XPosition'), y = num(s, 'YPosition'), z = num(s, 'ZPosition');
      const tag = str(s, 'Tag');
      const note = num(s, 'HasMapNote') ? text(field(s, 'MapNote')) : '';
      at(x, y, z, (f) => {
        if (note) f.notes.push(note);
        if (tag) f.tags.push(tag);
        const spot = GMRoomNames.SPOT_TAG.exec(tag);
        if (spot && !/^\d+$/.test(spot[1])) f.spots.push(GMRoomNames.display(spot[1]));
      });
    }
    // Templates are read once each
    const templateNames = new Map<string, Promise<string>>();
    const templateName = (resRef: string, type: number, labels: string[]) => {
      const key = `${type}:${resRef.toLowerCase()}`;
      if (!templateNames.has(key)) {
        templateNames.set(key, gff(resRef, type).then((t) => t ? labels.map((l) => text(field(t.RootNode, l))).filter(Boolean).join(' ') : ''));
      }
      return templateNames.get(key)!;
    };
    for (const s of list('Placeable List')) {
      const name = text(field(s, 'LocName')) || await templateName(str(s, 'TemplateResRef'), ResourceTypes['utp'], ['LocName']);
      at(num(s, 'X'), num(s, 'Y'), num(s, 'Z'), (f) => { if (name) f.things.push(name); f.tags.push(str(s, 'Tag')); });
    }
    for (const s of list('Door List')) {
      const name = text(field(s, 'LocName')) || await templateName(str(s, 'TemplateResRef'), ResourceTypes['utd'], ['LocName']);
      at(num(s, 'X'), num(s, 'Y'), num(s, 'Z'), (f) => { if (name) f.doors.push(name); });
    }
    const creatureNames: { x: number; y: number; z: number; name: string }[] = [];
    for (const s of list('Creature List')) {
      const name = await templateName(str(s, 'TemplateResRef'), ResourceTypes['utc'], ['FirstName', 'LastName']);
      if (name) creatureNames.push({ x: num(s, 'XPosition'), y: num(s, 'YPosition'), z: num(s, 'ZPosition'), name });
    }
    // Names many creatures share ("Jedi", "Gizka") say little about a room
    const counts = new Map<string, number>();
    for (const c of creatureNames) counts.set(c.name, (counts.get(c.name) || 0) + 1);
    for (const c of creatureNames) if ((counts.get(c.name) || 0) <= 2) at(c.x, c.y, c.z, (f) => f.people.push(c.name));

    // Shape, and which rooms each one joins
    const shape = new Map<string, { m2: number; w: number; d: number; rise: number; joins: Set<string> }>();
    for (const r of source.rooms) {
      const wok = floors.get(r.name);
      const faces: OdysseyFace3[] = wok?.walkableFaces || [];
      const box = new THREE.Box3();
      let m2 = 0;
      for (const f of faces) { m2 += f.triangle.getArea(); box.expandByPoint(f.triangle.a).expandByPoint(f.triangle.b).expandByPoint(f.triangle.c); }
      const joins = new Set<string>();
      for (const e of wok?.edges.values() || []) {
        if (e.transition >= 0 && source.rooms[e.transition] && source.rooms[e.transition].name !== r.name) joins.add(source.rooms[e.transition].name);
      }
      const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
      shape.set(r.name, { m2, w: Math.max(size.x, size.y), d: Math.min(size.x, size.y), rise: size.z, joins });
    }

    // First pass: names from map notes and keywords; second: shapes, corridors named by what they join
    const rooms: Record<string, GMRoomName> = {};
    const titled = (s: string) => s.replace(/\s+/g, ' ').trim();
    // Names the map notes give rooms (they win over a keyword elsewhere), and the rooms named for what they are
    const noteNames = new Set<string>();
    for (const r of source.rooms) {
      if (shape.get(r.name)!.m2 >= GMRoomNames.OPEN_AREA_M2) continue;
      for (const n of facts.get(r.name)!.notes) if (!/^to\s/i.test(n)) noteNames.add(titled(n).toLowerCase());
    }
    const strong = new Set<string>();
    for (const r of source.rooms) {
      const f = facts.get(r.name)!, sh = shape.get(r.name)!;
      const hints: string[] = [];
      const open = sh.m2 >= GMRoomNames.OPEN_AREA_M2;
      let name = '';
      const note = f.notes.find((n) => !/^to\s/i.test(n));
      if (note && !open) { name = titled(note); hints.push(`map note "${note}"`); }
      else if (f.notes.length) hints.push(`map note${f.notes.length > 1 ? 's' : ''} ${f.notes.map((n) => `"${n}"`).join(', ')}`);
      if (!name && !open) {
        // A keyword in what's here: things first, then doors, then (in a smaller room) waypoint tags. Not a name a
        // map note gives another room: a cargo door beside the Cargo Hold isn't another one
        const sources: [string[], string][] = [[f.things, 'things'], [f.doors, 'doors']];
        if (sh.m2 < GMRoomNames.TAG_ROOM_M2) sources.push([f.tags, 'tags']);
        for (const [words, label] of sources) {
          const hit = GMRoomNames.KEYWORDS.find(([re, kw]) => !noteNames.has(kw.toLowerCase()) && words.some((w) => re.test(w)));
          if (!hit) continue;
          name = hit[1];
          if (label !== 'things') hints.push(`${label === 'tags' ? 'marked' : 'door'} ${words.find((w) => hit[0].test(w))}`);
          break;
        }
      }
      if (name) strong.add(r.name);
      if (f.things.length) hints.push(`has ${[...new Set(f.things)].slice(0, 4).join(', ')}`);
      if (f.people.length) hints.push(`people: ${[...new Set(f.people)].slice(0, 4).join(', ')}`);
      if (f.spots.length) hints.push(`spots: ${[...new Set(f.spots)].slice(0, 4).join(', ')}`);
      if (sh.m2 > 1) hints.push(`${Math.round(sh.m2)} m², ${Math.round(sh.w)}×${Math.round(sh.d)} m${sh.rise > 1.5 ? `, ${sh.rise.toFixed(1)} m of stairs or ramps` : ''}`);
      rooms[r.name] = { room: r.name, name, hints, m2: Math.round(sh.m2), scenery: sh.m2 < 1 };
    }
    for (const r of source.rooms) {
      const entry = rooms[r.name];
      if (entry.name) continue;
      const f = facts.get(r.name)!, sh = shape.get(r.name)!;
      const kind = entry.scenery ? 'Backdrop'
        : (sh.w >= 3 * Math.max(sh.d, 0.1) && sh.d <= 6) ? 'Corridor'
        : sh.m2 < 40 ? 'Small room' : sh.m2 < 150 ? 'Room' : sh.m2 < 500 ? 'Hall' : 'Open area';
      // Only rooms named for what they are (not ones named after their neighbours in turn)
      const named = [...sh.joins].filter((j) => strong.has(j)).map((j) => rooms[j].name);
      let name = kind;
      if (kind === 'Corridor' && named.length) name = `Corridor to ${[...new Set(named)].slice(0, 2).join(' and ')}`;
      else if (kind === 'Open area' && f.notes.length) name = `Open area by ${f.notes[0]}`;
      else if (f.people.length && kind !== 'Backdrop') name = `${kind} with ${[...new Set(f.people)].slice(0, 2).join(' and ')}`;
      else if (f.spots.length && kind !== 'Backdrop') name = `${kind} (${[...new Set(f.spots)].slice(0, 2).join(', ')})`;
      else if (named.length && kind !== 'Backdrop') name = `${kind} by ${named[0]}`;
      entry.name = name;
      if (sh.joins.size) entry.hints.push(`joins ${[...sh.joins].map((j) => rooms[j]?.name ? `${rooms[j].name} (${j})` : j).slice(0, 4).join(', ')}`);
      if (kind === 'Backdrop') entry.hints.push('no floor: scenery around the area (a sky, space)');
    }
    // Two rooms with one name are told apart by number
    const times = new Map<string, number>();
    for (const r of source.rooms) times.set(rooms[r.name].name, (times.get(rooms[r.name].name) || 0) + 1);
    const seen = new Map<string, number>();
    for (const r of source.rooms) {
      const n = rooms[r.name].name;
      if ((times.get(n) || 0) < 2) continue;
      const i = (seen.get(n) || 0) + 1;
      seen.set(n, i);
      rooms[r.name].name = `${n} ${i}`;
    }
    return { module, area: areaTitle || source.areaName, rooms };
  }
}

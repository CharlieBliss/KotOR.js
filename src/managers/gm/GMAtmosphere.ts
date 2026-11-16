import * as THREE from "three";
import { GameState } from "@/GameState";
import { AudioEngine } from "@/audio/AudioEngine";
import { GFFObject } from "@/resource/GFFObject";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import { GMLog } from "@/managers/gm/GMLog";
import type { GMAtmosphereSettings, GMSoundChoice } from "@/managers/gm/GMTypes";

/** What an area looked and sounded like when it loaded, to go back to */
interface GMAreaOriginal {
  fog: { on: boolean; color: number; near: number; far: number };
  light: number;
  music: number;
  battle: number;
  ambient: number;
  ambientVolume: number;
}

/**
 * A scene's atmosphere, set by the GM: its music, battle music and ambient sound, and its look (fog, the colour
 * behind everything, the light). Any part can be taken from another area of the game, so a space station can sit
 * in Manaan's murky water with Manaan's music. Players get it with the scene; a new scene starts with its own.
 *
 * The game keeps area colours as 0x00BBGGRR. Fog and dense fog's background colour hide an area's own sky,
 * which KotOR builds into its room models rather than keeping separately.
 */
export class GMAtmosphere {
  /** What the GM has changed (unset: the scene's own) */
  static current: GMAtmosphereSettings = {};

  static original: GMAreaOriginal | null = null;

  /** Areas read for "use the atmosphere of…", by module */
  static cache = new Map<string, GMAtmosphereSettings>();

  /** Something received for a scene still loading: applied once it's up */
  static pending: GMAtmosphereSettings | null = null;

  /** KotOR's 0x00BBGGRR as a colour */
  static bgrToColor(bgr: number): THREE.Color {
    const v = Number(bgr) >>> 0;
    return new THREE.Color((v & 0xff) / 255, ((v >> 8) & 0xff) / 255, ((v >> 16) & 0xff) / 255);
  }

  static colorToBgr(color: THREE.Color): number {
    const r = Math.round(color.r * 255), g = Math.round(color.g * 255), b = Math.round(color.b * 255);
    return (b << 16) | (g << 8) | r;
  }

  /** '#rrggbb' for a colour input */
  static bgrToHex(bgr: number): string {
    return `#${this.bgrToColor(bgr).getHexString()}`;
  }

  static hexToBgr(hex: string): number {
    return this.colorToBgr(new THREE.Color(hex));
  }

  /** A new scene loaded: remember how it was, and drop the GM's changes to the last one */
  static onSceneLoaded() {
    const area = GameState.module?.area;
    if (!area) return;
    this.original = {
      fog: { on: !!area.sun.fogOn, color: area.sun.fogColor, near: area.sun.fogNear, far: area.sun.fogFar },
      light: area.dynamicAmbientColor,
      music: area.audio.music.day,
      battle: area.audio.music.battle,
      ambient: area.audio.ambient.day,
      ambientVolume: area.audio.ambient.dayVolume,
    };
    this.current = {};
    // A player's machine told what the GM set while this scene was loading
    const pending = this.pending;
    this.pending = null;
    if (pending && GameState.GMNetworkManager?.role === 'client') void this.receive(pending);
  }

  /** The scene's own value for anything the GM hasn't changed */
  static effective(): Required<Omit<GMAtmosphereSettings, 'source'>> & { source?: string } {
    const o = this.original;
    const c = this.current;
    return {
      source: c.source,
      fog: c.fog || o?.fog || { on: false, color: 0, near: 0, far: 1000 },
      light: c.light ?? o?.light ?? 0x606060,
      music: c.music ?? o?.music ?? -1,
      battle: c.battle ?? o?.battle ?? -1,
      ambient: c.ambient ?? o?.ambient ?? -1,
      ambientVolume: c.ambientVolume ?? o?.ambientVolume ?? 64,
    };
  }

  // --------------------------------------------------------------------------------------------------------
  // Changing it (the GM) — each change is applied here, sent to players, and kept for saving
  // --------------------------------------------------------------------------------------------------------

  static async set(changes: GMAtmosphereSettings, label?: string) {
    const before = this.effective();
    this.current = { ...this.current, ...changes };
    await this.applyChanged(before);
    if (label) GMLog.info('scene', label);
    this.broadcast();
    GameState.GMManager?.notifyChange?.();
  }

  /** Back to the scene's own music, sound and look */
  static async reset() {
    const before = this.effective();
    this.current = {};
    await this.applyChanged(before, true);
    this.broadcast();
    GameState.GMManager?.notifyChange?.();
  }

  static broadcast() {
    if (GMNetworkManager.role === 'host') GMNetworkManager.send('scene.atmosphere', { atmosphere: this.current });
  }

  /** A player's machine: the GM's atmosphere for this scene (with the scene, or when it changes) */
  static async receive(atmosphere: GMAtmosphereSettings | undefined) {
    const next = { ...(atmosphere || {}) };
    if (!GameState.module?.area || GameState.GMManager?.sceneLoading || !this.original) {
      this.pending = next;
      return;
    }
    // The same again (a fresh snapshot): nothing to do, and the music doesn't restart
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    const before = this.effective();
    this.current = next;
    await this.applyChanged(before);
  }

  /** Apply what differs from before (or everything with force), so changing the fog doesn't restart the music */
  static async applyChanged(before: ReturnType<typeof GMAtmosphere.effective>, force = false) {
    const now = this.effective();
    if (force || JSON.stringify(now.fog) !== JSON.stringify(before.fog)) this.applyFog(now.fog);
    if (force || now.light !== before.light) this.applyLight(now.light);
    if (force || now.music !== before.music) await this.applyMusic(now.music);
    if (force || now.battle !== before.battle) await this.applyBattle(now.battle);
    if (force || now.ambient !== before.ambient) await this.applyAmbient(now.ambient, now.ambientVolume);
    else if (now.ambientVolume !== before.ambientVolume) this.applyAmbientVolume(now.ambientVolume);
  }

  static applyFog(fog: { on: boolean; color: number; near: number; far: number }) {
    const area = GameState.module?.area;
    if (!area || !GameState.scene) return;
    const color = this.bgrToColor(fog.color);
    if (fog.on) {
      area.fog = new THREE.Fog(color, Math.max(0, fog.near), Math.max(fog.near + 1, fog.far));
      GameState.scene.fog = area.fog;
    } else {
      area.fog = undefined;
      GameState.scene.fog = null;
    }
    // Past the fog is the colour behind everything
    GameState.renderer?.setClearColor(color);
  }

  static applyLight(bgr: number) {
    const light = GameState.globalLight;
    if (!light) return;
    const c = this.bgrToColor(bgr);
    light.color.setRGB(THREE.MathUtils.clamp(c.r, 0.2, 1), THREE.MathUtils.clamp(c.g, 0.2, 1), THREE.MathUtils.clamp(c.b, 0.2, 1));
  }

  static async applyMusic(row: number) {
    const area = GameState.module?.area;
    const engine = AudioEngine.GetAudioEngine();
    if (!area || !engine) return;
    engine.areaMusicDayAudioEmitter.stop();
    engine.areaMusicLoaded = false;
    if (row < 0 || !this.rowResource('ambientmusic', row)) return;
    await area.musicBackgroundDaySet(row);
    if (engine.areaMusicLoaded) engine.areaMusicDayAudioEmitter.play();
  }

  static async applyBattle(row: number) {
    const area = GameState.module?.area;
    const engine = AudioEngine.GetAudioEngine();
    if (!area || !engine) return;
    engine.battleMusicLoaded = false;
    engine.battleStingerLoaded = false;
    if (row < 0 || !this.rowResource('ambientmusic', row)) return;
    await area.musicBattleSet(row);
  }

  static async applyAmbient(row: number, volume: number) {
    const area = GameState.module?.area;
    const engine = AudioEngine.GetAudioEngine();
    if (!area || !engine) return;
    engine.ambientAudioDayEmitter.stop();
    engine.ambientLoaded = false;
    if (row >= 0 && this.rowResource('ambientsound', row)) await area.ambientSoundDaySet(row);
    this.applyAmbientVolume(volume);
  }

  static applyAmbientVolume(volume: number) {
    const engine = AudioEngine.GetAudioEngine();
    engine?.ambientAudioDayEmitter?.setVolume(Math.max(0, Math.min(127, volume)) / 127);
  }

  // --------------------------------------------------------------------------------------------------------
  // The game's music and sounds, and other areas' atmospheres
  // --------------------------------------------------------------------------------------------------------

  static rowResource(table: 'ambientmusic' | 'ambientsound', row: number): string {
    const rows = GameState.module?.area?.audioTable(table)?.rows || GameState.TwoDAManager?.datatables.get(table)?.rows;
    const res = rows?.[row]?.resource;
    return res && res !== '****' ? String(res) : '';
  }

  /** The music or ambient sounds there are to choose from: the game's table, named by its description */
  static choices(table: 'ambientmusic' | 'ambientsound'): GMSoundChoice[] {
    const rows = GameState.module?.area?.audioTable(table)?.rows || GameState.TwoDAManager?.datatables.get(table)?.rows || {};
    const out: GMSoundChoice[] = [];
    for (const key of Object.keys(rows)) {
      const row = rows[key];
      const resource = row?.resource;
      if (!resource || resource === '****') continue;
      const strref = Number(row.description);
      let name = '';
      if (Number.isFinite(strref) && strref > 0) name = GameState.TLKManager?.GetStringById?.(strref)?.Value || '';
      out.push({ row: Number(key), resource: String(resource), name: name || String(resource) });
    }
    return out;
  }

  /** Read another area's music, sound and look from its module, without loading it */
  static async readModule(moduleResRef: string): Promise<GMAtmosphereSettings | null> {
    const name = String(moduleResRef || '').toLowerCase();
    if (!name) return null;
    if (this.cache.has(name)) return this.cache.get(name)!;
    try {
      const archives = await GameState.Module.GetModuleArchives(name);
      const find = async (resRef: string, type: number): Promise<GFFObject | null> => {
        for (const a of archives) {
          if (a?.hasResource?.(resRef, type)) return new GFFObject(await a.getResourceBufferByResRef(resRef, type));
        }
        return null;
      };
      const ifo = await find('module', ResourceTypes['ifo']);
      const areaName = ifo?.RootNode.hasField('Mod_Entry_Area') ? String(ifo.getFieldByLabel('Mod_Entry_Area').getValue()).toLowerCase() : name;
      const are = await find(areaName, ResourceTypes['are']);
      const git = await find(areaName, ResourceTypes['git']);
      if (!are) return null;
      const num = (gff: GFFObject | null, label: string, fields?: any): number | undefined => {
        try {
          const f = gff?.getFieldByLabel(label, fields);
          return f ? Number(f.getValue()) : undefined;
        } catch (e) { return undefined; }
      };
      const props = git?.getFieldByLabel('AreaProperties')?.getChildStructs()[0]?.getFields();
      const atmosphere: GMAtmosphereSettings = {
        source: name,
        fog: {
          on: !!num(are, 'SunFogOn'),
          color: num(are, 'SunFogColor') ?? 0,
          near: num(are, 'SunFogNear') ?? 0,
          far: num(are, 'SunFogFar') ?? 1000,
        },
        light: num(are, 'DynAmbientColor'),
        music: props ? num(git, 'MusicDay', props) : undefined,
        battle: props ? num(git, 'MusicBattle', props) : undefined,
        ambient: props ? num(git, 'AmbientSndDay', props) : undefined,
        ambientVolume: props ? num(git, 'AmbientSndDayVol', props) : undefined,
      };
      this.cache.set(name, atmosphere);
      return atmosphere;
    } catch (e) {
      GMLog.warn('scene', `Could not read ${name}'s atmosphere`, e);
      return null;
    }
  }

  /** Take another area's sound, look, or both */
  static async useModule(moduleResRef: string, parts: 'look' | 'sound' | 'all' = 'all'): Promise<boolean> {
    const other = await this.readModule(moduleResRef);
    if (!other) return false;
    const look: GMAtmosphereSettings = { fog: other.fog, light: other.light };
    const sound: GMAtmosphereSettings = { music: other.music, battle: other.battle, ambient: other.ambient, ambientVolume: other.ambientVolume };
    const changes = parts === 'look' ? look : parts === 'sound' ? sound : { ...look, ...sound };
    // Parts the other area doesn't say stay as they are
    for (const k of Object.keys(changes) as (keyof GMAtmosphereSettings)[]) if (changes[k] === undefined) delete changes[k];
    await this.set({ ...changes, source: other.source }, `Atmosphere: ${parts === 'all' ? 'sound and look' : parts} of ${other.source}`);
    return true;
  }
}

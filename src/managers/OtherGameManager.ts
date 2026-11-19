import * as path from "path";
import { ApplicationProfile } from "@/utility/ApplicationProfile";
import { ApplicationEnvironment } from "@/enums/ApplicationEnvironment";
import { GameEngineType } from "@/enums/engine/GameEngineType";
import { GameFileSystem } from "@/utility/GameFileSystem";
import { ConfigClient } from "@/utility/ConfigClient";
import { DevGameDirectory } from "@/utility/DevGameDirectory";
import { KEYObject } from "@/resource/KEYObject";
import { BIFObject } from "@/resource/BIFObject";
import { RIMObject } from "@/resource/RIMObject";
import { ERFObject } from "@/resource/ERFObject";
import { TwoDAObject } from "@/resource/TwoDAObject";
import { TLKObject } from "@/resource/TLKObject";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { isUsableDirectoryHandle } from "@/utility/gameDirectoryAccess";
import { ResourceLoader } from "@/loaders/ResourceLoader";
import { TPCLoader } from "@/loaders/TPCLoader";
import { Module } from "@/module/Module";
import { ModuleArea } from "@/module/ModuleArea";
import { AudioLoader } from "@/audio/AudioLoader";

/** Where the other game's files come from */
export type OtherGameKey = 'kotor' | 'tsl';

/**
 * OtherGameManager class.
 *
 * Lets one KotOR game borrow the other's scenes: running KotOR II, a GM can load a KotOR I area (or the other way
 * round). The other game's install is mounted read-only (GameFileSystem's "@othergame/" paths), with its own key
 * file and BIF archives, so:
 * - its modules can be opened as a scene ("kotor:danm13" while running KotOR II), and
 * - anything this game doesn't have (the other game's room models, walkmeshes, layouts, textures, sounds) is
 *   looked up there after this game's own files.
 * Only the area itself crosses over: its creatures, placeables, doors and triggers are defined by the other game's
 * rule tables, so a borrowed scene starts empty and the GM fills it with this game's content.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file OtherGameManager.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class OtherGameManager {

  static mounted: boolean = false;
  static mounting: Promise<boolean> | null = null;
  static key: KEYObject | null = null;
  static bifs: Map<number, BIFObject> = new Map();
  static twoDA: Map<string, TwoDAObject> = new Map();
  static lastError: string = '';
  /** The other game's texture packs (swpc_tex_gui and the full-quality swpc_tex_tpa) */
  static texturePacks: ERFObject[] = [];

  /**
   * Plug into the engine: the resource and texture lookups fall back to the other game, and "<game>:<module>"
   * names open its modules. Hooks rather than imports, so the engine's loaders don't depend on this.
   */
  static registerHooks() {
    ResourceLoader.FallbackSources.push((resId, resRef) => this.getResource(resId, resRef));
    TPCLoader.FallbackSources.push((resRef) => this.getTexture(resRef));
    Module.ArchiveSources.push(async (modName) => {
      const moduleResRef = this.parseForeignModule(modName);
      return moduleResRef ? this.openModuleArchives(moduleResRef) : undefined;
    });
    Module.IsBorrowedModule = (modName) => this.isForeignModule(modName);
    ModuleArea.BorrowedTables = (name) => this.twoDA.get(String(name).toLowerCase());
  }

  /** The other game's talk table (its text by string id), read the first time something of it needs naming */
  static tlk: TLKObject | null = null;
  static tlkLoading: Promise<TLKObject | null> | null = null;

  static loadTalkTable(): Promise<TLKObject | null> {
    if (this.tlk) return Promise.resolve(this.tlk);
    if (!this.tlkLoading) {
      this.tlkLoading = (async () => {
        if (!(await this.mount())) return null;
        try {
          const tlk = new TLKObject();
          tlk.loadFromBuffer(await GameFileSystem.readFile(`${GameFileSystem.OTHER_GAME_PREFIX}/dialog.tlk`));
          this.tlk = tlk;
          return tlk;
        } catch (e) {
          console.warn('[OtherGameManager] dialog.tlk unreadable', e);
          return null;
        } finally {
          this.tlkLoading = null;
        }
      })();
    }
    return this.tlkLoading;
  }

  /** One of the other game's strings by id (loadTalkTable first); '' when unknown */
  static text(strRef: number): string {
    return strRef >= 0 ? (this.tlk?.GetStringById(strRef) || '') : '';
  }

  /** The game that isn't running */
  static otherKey(): OtherGameKey {
    return ApplicationProfile.GameKey === GameEngineType.TSL ? 'kotor' : 'tsl';
  }

  static otherTitle(): string {
    return this.otherKey() === 'kotor' ? 'KotOR' : 'KotOR II';
  }

  // -------------------------------------------------------------------------------------------------
  // Module names: "<game>:<module>" names a module of the other game
  // -------------------------------------------------------------------------------------------------

  static foreignModuleName(moduleResRef: string): string {
    return `${this.otherKey()}:${String(moduleResRef || '').toLowerCase()}`;
  }

  /** "kotor:danm13" -> "danm13", when it names the other game's module; otherwise null */
  static parseForeignModule(name: string): string | null {
    const match = /^(kotor|tsl):(.+)$/i.exec(String(name || ''));
    if (!match) return null;
    return match[1].toLowerCase() === this.otherKey() ? match[2].toLowerCase() : null;
  }

  static isForeignModule(name: string): boolean {
    return this.parseForeignModule(name) !== null;
  }

  // -------------------------------------------------------------------------------------------------
  // Mounting
  // -------------------------------------------------------------------------------------------------

  /** Find the other game's folder: the launcher's profile for it, or the dev server's copy */
  static async locate(): Promise<boolean> {
    const key = this.otherKey();
    if (ApplicationProfile.ENV === ApplicationEnvironment.ELECTRON) {
      const dir = ConfigClient.get(['Profiles', key, 'directory']);
      if (!dir) return false;
      GameFileSystem.otherGameDirectory = dir;
      return true;
    }
    let handle: FileSystemDirectoryHandle | undefined = await DevGameDirectory.open(key);
    if (!handle) {
      const saved = ConfigClient.get(['Profiles', key, 'directory_handle']) as FileSystemDirectoryHandle | undefined;
      if (saved && isUsableDirectoryHandle(saved)) {
        // A saved folder grant needs the user's permission again (call this from a click)
        const anyHandle = saved as any;
        try {
          if (typeof anyHandle.queryPermission === 'function' && (await anyHandle.queryPermission({ mode: 'read' })) !== 'granted') {
            if (typeof anyHandle.requestPermission === 'function') await anyHandle.requestPermission({ mode: 'read' });
          }
        } catch (e) {
          // Permission prompts can fail outside a click; reading will report it
        }
        handle = saved;
      }
    }
    if (!handle) return false;
    GameFileSystem.otherGameDirectoryHandle = handle;
    return true;
  }

  /** Mount the other game: its key file and BIF archives. Safe to call again. */
  static async mount(): Promise<boolean> {
    if (this.mounted) return true;
    if (this.mounting) return this.mounting;
    this.mounting = (async () => {
      try {
        if (!(await this.locate())) {
          this.lastError = `${this.otherTitle()} isn't set up: add its game folder in the launcher.`;
          return false;
        }
        const keyPath = `${GameFileSystem.OTHER_GAME_PREFIX}/chitin.key`;
        if (!(await GameFileSystem.exists(keyPath))) {
          this.lastError = `${this.otherTitle()}'s folder has no chitin.key.`;
          return false;
        }
        const key = new KEYObject();
        await key.loadFile(keyPath);
        const bifs = new Map<number, BIFObject>();
        for (let i = 0; i < key.bifs.length; i++) {
          const bif = new BIFObject(path.join(GameFileSystem.OTHER_GAME_PREFIX, key.bifs[i].filename.replace(/\\/g, '/')));
          await bif.load();
          bifs.set(i, bif);
        }
        this.key = key;
        this.bifs = bifs;
        this.mounted = true;
        // Its texture packs (most textures live there, not in the BIFs)
        this.texturePacks = [];
        for (const pack of ['swpc_tex_tpa', 'swpc_tex_gui']) {
          const packPath = `${GameFileSystem.OTHER_GAME_PREFIX}/TexturePacks/${pack}.erf`;
          if (!(await GameFileSystem.exists(packPath))) continue;
          const erf = new ERFObject(packPath);
          await erf.load();
          this.texturePacks.push(erf);
        }
        // The tables its areas index into by row, and its loose music and sounds
        for (const table of ['ambientmusic', 'ambientsound']) await this.get2DA(table);
        if (!AudioLoader.OtherRoots.includes(GameFileSystem.OTHER_GAME_PREFIX)) AudioLoader.OtherRoots.push(GameFileSystem.OTHER_GAME_PREFIX);
        this.lastError = '';
        return true;
      } catch (e: any) {
        this.lastError = `Couldn't read ${this.otherTitle()}: ${e?.message || e}`;
        console.warn('[OtherGameManager] mount failed', e);
        return false;
      } finally {
        this.mounting = null;
      }
    })();
    return this.mounting;
  }

  // -------------------------------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------------------------------

  /** A resource from the other game's BIF archives, or undefined */
  static async getResource(resType: number, resRef: string): Promise<Uint8Array | undefined> {
    if (!this.mounted || !this.key) return undefined;
    const entry = this.key.getFileKey(String(resRef || '').toLowerCase(), resType);
    if (!entry) return undefined;
    const bif = this.bifs.get(KEYObject.getBIFIndex(entry.resId));
    if (!bif) return undefined;
    const buffer = await bif.getResourceBuffer(bif.getResourceById(entry.resId));
    return buffer?.length ? buffer : undefined;
  }

  /** A texture from the other game's texture packs, then its BIFs */
  static async getTexture(resRef: string): Promise<Uint8Array | undefined> {
    if (!this.mounted) return undefined;
    const name = String(resRef || '').toLowerCase();
    for (const pack of this.texturePacks) {
      const info = pack.getResourceInfo(name, ResourceTypes['tpc']);
      if (info) return await pack.getResourceBuffer(info);
    }
    return this.getResource(ResourceTypes['tpc'], name);
  }

  /** One of the other game's 2DA tables (for lookups its own scenes need, like their music) */
  static async get2DA(name: string): Promise<TwoDAObject | undefined> {
    const key = String(name || '').toLowerCase();
    if (this.twoDA.has(key)) return this.twoDA.get(key);
    const buffer = await this.getResource(ResourceTypes['2da'], key);
    if (!buffer) return undefined;
    const table = new TwoDAObject(buffer);
    this.twoDA.set(key, table);
    return table;
  }

  /** The other game's modules (areas), by name */
  static async listModules(): Promise<string[]> {
    if (!(await this.mount())) return [];
    try {
      const files = await GameFileSystem.readdir(`${GameFileSystem.OTHER_GAME_PREFIX}/modules`);
      const names = new Set<string>();
      for (const file of files) {
        const base = String(file).split(/[\\/]/).pop()?.toLowerCase() || '';
        if (/(_s\.rim|_dlg\.erf|_a\.rim|_adx\.rim)$/.test(base)) continue;
        const match = /^(.+)\.(rim|mod)$/.exec(base);
        if (match) names.add(match[1]);
      }
      return Array.from(names).sort();
    } catch (e) {
      console.warn('[OtherGameManager] listing modules failed', e);
      return [];
    }
  }

  /** Open one of the other game's modules: its .mod, or its .rim and _s.rim (and KotOR II's _dlg.erf) */
  static async openModuleArchives(moduleResRef: string): Promise<(RIMObject | ERFObject)[]> {
    if (!(await this.mount())) return [];
    const dir = `${GameFileSystem.OTHER_GAME_PREFIX}/modules`;
    const archives: (RIMObject | ERFObject)[] = [];
    // The folder's own spelling of each file: names don't match by case (KotOR's cutscene modules are STUNT_00.rim)
    const actual = new Map<string, string>();
    try {
      for (const f of await GameFileSystem.readdir(dir)) {
        const base = String(f).split(/[\\/]/).pop() || '';
        actual.set(base.toLowerCase(), base);
      }
    } catch (e) {
      // Without a listing, try the names as given
    }
    const tryOpen = async (name: string, kind: 'rim' | 'erf') => {
      const file = actual.get(name.toLowerCase()) ?? name;
      const filepath = `${dir}/${file}`;
      if (!(await GameFileSystem.exists(filepath))) return;
      try {
        const archive = kind === 'rim' ? new RIMObject(filepath) : new ERFObject(filepath);
        await archive.load();
        archives.push(archive);
      } catch (e) {
        console.warn('[OtherGameManager] could not open', filepath, e);
      }
    };
    await tryOpen(`${moduleResRef}.mod`, 'erf');
    if (!archives.length) {
      await tryOpen(`${moduleResRef}.rim`, 'rim');
      await tryOpen(`${moduleResRef}_s.rim`, 'rim');
    }
    if (this.otherKey() === 'tsl') await tryOpen(`${moduleResRef}_dlg.erf`, 'erf');
    return archives;
  }

}

OtherGameManager.registerHooks();

import { GameState } from "@/GameState";
import { KEYManager } from "@/managers/KEYManager";
import { ResourceLoader } from "@/loaders";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { GFFObject } from "@/resource/GFFObject";
import { CacheScope } from "@/enums/resource/CacheScope";
import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";
import { WEAPON_OPTIONS, ARMOR_OPTIONS, LOOT_ITEM_OPTIONS } from "@/managers/gm/data/itemOptions";

/** An item template (.uti) the running game has */
export interface GMItemInfo {
  resRef: string;
  name: string;
  /** baseitems.2da label, e.g. "Armor_Class_4" */
  base: string;
  /** Where it can be worn (baseitems.2da equipableslots, ModuleCreatureArmorSlot bits) */
  slots: number;
}

export interface GMItemOption {
  resRef: string;
  label: string;
}

const NO_WEAPON: GMItemOption = { resRef: '', label: 'None (Unarmed)' };
const NO_ARMOR: GMItemOption = { resRef: '', label: 'Default / Creature Skin' };

/**
 * The item templates of the running game, for the GM's gear and loot lists. Each game has its own items (KotOR
 * II lacks most of KotOR's), so the lists come from the game's files: reading them all takes about 0.1 s and
 * happens once, the first time a list is asked for. Until then the lists are the built-in KotOR picks this game
 * has.
 */
export class GMItems {
  static index: GMItemInfo[] | null = null;
  static loading: Promise<GMItemInfo[]> | null = null;
  /** Told when the index has loaded */
  static listeners = new Set<() => void>();

  private static cachedOptions: { weapons: GMItemOption[]; armor: GMItemOption[]; loot: GMItemOption[] } | null = null;

  /** The game's item templates: every .uti in its key file, override and the loaded module */
  static templateNames(): string[] {
    const names = new Set<string>();
    for (const key of KEYManager.Key?.keys || []) {
      if (key.resType === ResourceTypes.uti) names.add(String(key.resRef).toLowerCase());
    }
    for (const scope of [CacheScope.GLOBAL, CacheScope.OVERRIDE, CacheScope.MODULE]) {
      const map = ResourceLoader.CacheScopes[scope]?.get(ResourceTypes.uti);
      if (map) for (const name of map.keys()) names.add(String(name).toLowerCase());
    }
    return [...names].sort();
  }

  /** Read an item template's name, base item and slots */
  static async describe(resRef: string): Promise<GMItemInfo | null> {
    try {
      const buffer = await ResourceLoader.loadResource(ResourceTypes.uti, resRef);
      if (!buffer) return null;
      const root = new GFFObject(buffer).RootNode;
      const baseId = root.hasField('BaseItem') ? Number(root.getFieldByLabel('BaseItem').getValue()) : -1;
      const base = GameState.TwoDAManager?.datatables.get('baseitems')?.rows?.[baseId];
      const raw = root.hasField('LocalizedName') ? root.getFieldByLabel('LocalizedName').getCExoLocString().getValue() : '';
      return { resRef, name: this.cleanName(raw), base: String(base?.label || ''), slots: Number(base?.equipableslots) || 0 };
    } catch (e) {
      return null;
    }
  }

  /**
   * KotOR II's item names can carry developer tags ("{hvy 01}Battle Armor", "Crystal{01_D}") and the game's
   * placeholders ("<FullName> Crystal", filled in with the player's name); the lists show neither
   */
  static cleanName(name: string): string {
    return String(name || '').replace(/\{[^}]*\}|<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  /** Read every item template once; later calls get the same list */
  static async loadIndex(): Promise<GMItemInfo[]> {
    if (this.index) return this.index;
    if (!this.loading) {
      this.loading = (async () => {
        const out: GMItemInfo[] = [];
        for (const resRef of this.templateNames()) {
          const info = await this.describe(resRef);
          if (info && info.name) out.push(info);
        }
        out.sort((a, b) => a.name.localeCompare(b.name) || a.resRef.localeCompare(b.resRef));
        this.index = out;
        this.cachedOptions = null;
        this.listeners.forEach((fn) => { try { fn(); } catch (e) {} });
        return out;
      })().finally(() => { this.loading = null; });
    }
    return this.loading;
  }

  /** Whether the running game has this item template */
  static exists(resRef: string): boolean {
    if (!resRef) return false;
    if (this.index) return this.index.some((i) => i.resRef === resRef);
    try { return !!KEYManager.Key?.getFileKey(resRef, ResourceTypes.uti); } catch (e) { return false; }
  }

  /**
   * The weapons (right or left hand), armour and loot this game has, each list starting with its "none" choice
   * (not loot). Asking starts reading the index; until it's read, the built-in picks this game has.
   */
  static options(): { weapons: GMItemOption[]; armor: GMItemOption[]; loot: GMItemOption[] } {
    if (this.cachedOptions) return this.cachedOptions;
    if (!KEYManager.Key) {
      // The game's files aren't open yet
      return { weapons: WEAPON_OPTIONS, armor: ARMOR_OPTIONS, loot: LOOT_ITEM_OPTIONS };
    }
    if (!this.index) {
      void this.loadIndex();
      const has = (items: GMItemOption[]) => items.filter((i) => !i.resRef || this.exists(i.resRef));
      return { weapons: has(WEAPON_OPTIONS), armor: has(ARMOR_OPTIONS), loot: has(LOOT_ITEM_OPTIONS) };
    }
    const option = (i: GMItemInfo): GMItemOption => ({ resRef: i.resRef, label: `${i.name} (${i.resRef})` });
    const hands = ModuleCreatureArmorSlot.RIGHTHAND | ModuleCreatureArmorSlot.LEFTHAND;
    this.cachedOptions = {
      weapons: [NO_WEAPON, ...this.index.filter((i) => i.slots & hands).map(option)],
      armor: [NO_ARMOR, ...this.index.filter((i) => i.slots & ModuleCreatureArmorSlot.ARMOR).map(option)],
      loot: this.index.map(option),
    };
    return this.cachedOptions;
  }
}

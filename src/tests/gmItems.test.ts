import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: {} }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import { GMItems } from "@/managers/gm/GMItems";
import { KEYManager } from "@/managers/KEYManager";

const SABER = { resRef: 'g_w_lghtsbr01', name: 'Lightsaber', base: 'Lightsaber', slots: 0x30 };
const PISTOL = { resRef: 'g_w_blstrpstl001', name: 'Blaster Pistol', base: 'Blaster_Pistol', slots: 0x30 };
const ARMOUR = { resRef: 'a_heavy_01', name: 'Battle Armor', base: 'Armor_Class_8', slots: 0x2 };
const MEDPAC = { resRef: 'g_i_medeqpmnt01', name: 'Medpac', base: 'Medpac', slots: 0 };

describe('GMItems', () => {
  afterEach(() => {
    GMItems.index = null;
    (GMItems as any).cachedOptions = null;
    (KEYManager as any).Key = undefined;
  });

  test('drops the developer tags and placeholders in KotOR II names', () => {
    expect(GMItems.cleanName('{hvy 01}Battle Armor')).toBe('Battle Armor');
    expect(GMItems.cleanName('{a}{b} Robe ')).toBe('Robe');
    expect(GMItems.cleanName('<FullName> Crystal{01_D}')).toBe('Crystal');
    expect(GMItems.cleanName('Jedi Robe')).toBe('Jedi Robe');
  });

  test('sorts the game\'s items into weapons, armour and loot by where they can be worn', () => {
    (KEYManager as any).Key = { keys: [], getFileKey: (): any => null };
    GMItems.index = [PISTOL, ARMOUR, SABER, MEDPAC];
    const { weapons, armor, loot } = GMItems.options();
    expect(weapons.map((i) => i.resRef)).toEqual(['', 'g_w_blstrpstl001', 'g_w_lghtsbr01']);
    expect(armor.map((i) => i.resRef)).toEqual(['', 'a_heavy_01']);
    expect(loot).toHaveLength(4);
    expect(armor[1].label).toBe('Battle Armor (a_heavy_01)');
  });

  test('before the index is read, offers the built-in picks this game has', () => {
    (KEYManager as any).Key = { keys: [], getFileKey: (resRef: string): any => (resRef === 'g_w_lghtsbr01' ? {} : null) };
    const load = jest.spyOn(GMItems, 'loadIndex').mockResolvedValue([]);
    const { weapons, armor } = GMItems.options();
    expect(weapons.map((i) => i.resRef)).toEqual(['', 'g_w_lghtsbr01']);
    expect(armor.map((i) => i.resRef)).toEqual(['']);
    expect(load).toHaveBeenCalled();
    load.mockRestore();
  });
});

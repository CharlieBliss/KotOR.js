import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: {} }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import { GameState } from "@/GameState";
import { GMCharacters } from "@/managers/gm/GMCharacters";
import type { GMCharacter } from "@/managers/gm/GMTypes";
import { GMPlayers } from "@/managers/gm/GMPlayers";
import { GMNetworkManager } from "@/managers/GMNetworkManager";

/** localStorage as the browser has it */
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => data.clear(),
  };
}

const character = (overrides: Partial<GMCharacter> = {}): GMCharacter => ({
  id: '',
  version: 1,
  game: 'kotor',
  name: 'Revan',
  appearanceLabel: 'P_BastilaBB',
  appearanceId: 4,
  portraitId: 2,
  gender: 1,
  classId: 3,
  level: 4,
  attributes: { str: 14, dex: 14, con: 12, int: 10, wis: 12, cha: 10 },
  feats: [1, 2],
  powers: [5],
  skillRanks: [3, 0, 1],
  gear: { rightHand: 'g_w_lghtsbr01', armor: 'g_a_jedirobe01' },
  updated: 0,
  ...overrides,
});

beforeEach(() => {
  (globalThis as any).localStorage = memoryStorage();
  (GameState as any).GameKey = 1;
  (GameState as any).AppearanceManager = { appearances: new Map<number, any>([[4, { label: 'P_BastilaBB' }], [77, { label: 'Droid_Astromech' }]]) };
});

describe('saved characters', () => {
  test('save, list newest first, replace by id, and remove', () => {
    const a = GMCharacters.save(character({ name: 'A' }));
    const b = GMCharacters.save(character({ name: 'B' }));
    expect(a.id).toMatch(/^chr_/);
    expect(GMCharacters.list().map((c) => c.name)).toEqual(['B', 'A']);

    GMCharacters.save({ ...a, name: 'A again' });
    expect(GMCharacters.list().map((c) => c.name)).toEqual(['A again', 'B']);

    GMCharacters.remove(b.id);
    expect(GMCharacters.list().map((c) => c.name)).toEqual(['A again']);
  });

  test('characters are kept per game', () => {
    GMCharacters.save(character({ name: 'K1', game: 'kotor' }));
    GMCharacters.save(character({ name: 'K2', game: 'tsl' }));
    expect(GMCharacters.list('kotor').map((c) => c.name)).toEqual(['K1']);
    expect(GMCharacters.list('tsl').map((c) => c.name)).toEqual(['K2']);
  });

  test('a broken store reads as empty', () => {
    localStorage.setItem(GMCharacters.storageKey(), '{not json');
    expect(GMCharacters.list()).toEqual([]);
  });
});

describe('character files', () => {
  test('export and import round-trip, with a fresh id', () => {
    const saved = GMCharacters.save(character());
    const { character: back } = GMCharacters.fromFileText(GMCharacters.toFileText(saved));
    expect(back).not.toBeNull();
    expect(back!.id).not.toBe(saved.id);
    expect({ ...back!, id: '', updated: 0 }).toEqual({ ...saved, id: '', updated: 0 });
  });

  test('anything else is turned away with a reason', () => {
    expect(GMCharacters.fromFileText('nope').problem).toMatch(/isn't valid JSON/);
    expect(GMCharacters.fromFileText(JSON.stringify({ format: 'kotorjs-gm-scene' })).problem).toMatch(/isn't a KotOR.js character/);
    expect(GMCharacters.fromFileText(JSON.stringify({ name: 'x', game: 'kotor' })).problem).toMatch(/missing parts/);
  });
});

describe('into a session', () => {
  test('the model is found by label on this machine, else by its saved id', () => {
    expect(GMCharacters.resolveAppearance({ appearanceLabel: 'Droid_Astromech', appearanceId: 1 })).toBe(77);
    expect(GMCharacters.resolveAppearance({ appearanceLabel: 'Not_Here', appearanceId: 12 })).toBe(12);
  });

  test('a character becomes the spawn config a session admits', () => {
    const config = GMCharacters.toSpawnConfig(character());
    expect(config).toMatchObject({
      name: 'Revan', appearanceId: 4, portraitId: 2, gender: 1, classId: 3, level: 4,
      str: 14, dex: 14, con: 12, int: 10, wis: 12, cha: 10,
      rightHandResRef: 'g_w_lghtsbr01', leftHandResRef: '', armorResRef: 'g_a_jedirobe01',
      featIds: [1, 2], spellIds: [5], skillRanks: [3, 0, 1],
    });
  });

  test('a new character starts from a preset, or a level-1 character with base abilities', () => {
    const blank = GMCharacters.blank();
    expect(blank).toMatchObject({ level: 1, attributes: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } });
    const fromPreset = GMCharacters.blank({ name: 'Guardian', appearanceId: 4, portraitId: 1, gender: 0, classId: 3, level: 10, str: 18, dex: 14, con: 15, int: 10, wis: 14, cha: 12, rightHandResRef: 'g_w_lghtsbr01' });
    expect(fromPreset).toMatchObject({ name: 'Guardian', appearanceLabel: 'P_BastilaBB', classId: 3, level: 10, gear: { rightHand: 'g_w_lghtsbr01' } });
  });
});

describe("joining with a made character", () => {
  /** A 2DA table as the engine holds it */
  const table = (rows: Record<string, any>[]) => ({ rows: Object.fromEntries(rows.map((r, i) => [i, { __index: i, ...r }])) });

  beforeEach(() => {
    const tables = new Map<string, any>([
      ["classes", table([
        { label: "Soldier", playerclass: "1", featstable: "SOL", skillstable: "SOL", featgain: "SOL", spellgaintable: "****", hitdie: "10", forcedie: "0", skillpointbase: "2" },
        { label: "Droid", playerclass: "0", featstable: "DRO", skillstable: "DRO", featgain: "DRO", spellgaintable: "****", hitdie: "8", forcedie: "0", skillpointbase: "1" },
        { label: "Scout", playerclass: "1", featstable: "SCO", skillstable: "SCO", featgain: "SCO", spellgaintable: "****", hitdie: "8", forcedie: "0", skillpointbase: "4" },
      ])],
      ["featgain", table([{ sol_reg: "1", sco_reg: "1" }])],
      ["feat", table([
        { label: "PROF", sol_list: "3", sol_granted: "1", sco_list: "3", sco_granted: "1", prereqfeat1: "****", prereqfeat2: "****" },
        { label: "POWER_ATTACK", sol_list: "1", sco_list: "1", prereqfeat1: "****", prereqfeat2: "****" },
        { label: "IMPROVED", sol_list: "1", sco_list: "1", prereqfeat1: "1", prereqfeat2: "****" },
      ])],
      ["skills", table([{ label: "Awareness", sol_class: "1", sol_reco: "1", sco_class: "1", sco_reco: "1" }])],
      ["portraits", table([{ forpc: "1", appearancenumber: "4", appearance_s: "5", appearance_l: "6" }, { forpc: "0", appearancenumber: "77" }])],
    ]);
    (GameState as any).TwoDAManager = { datatables: tables };
    (GameState as any).TLKManager = { GetStringById: (): any => undefined };
    GMPlayers.creationLimits = {};
    jest.spyOn(GMNetworkManager, "appendChat").mockImplementation(() => {});
  });

  const made = (overrides: Partial<GMCharacter> = {}) => character({ classId: 0, level: 3, attributes: { str: 14, dex: 14, con: 12, int: 10, wis: 10, cha: 8 }, feats: [0, 1], powers: undefined, skillRanks: undefined, ...overrides });

  test("a character within the rules comes through as it is", () => {
    const { config, changes } = GMPlayers.admitCharacter(made());
    expect(changes).toEqual([]);
    expect(config).toMatchObject({ classId: 0, level: 3, str: 14, featIds: [0, 1], appearanceId: 4 });
  });

  test("what doesn't fit the session is brought in line, and the GM is told what changed", () => {
    GMPlayers.creationLimits = { level: [1, 2] };
    const { config, changes } = GMPlayers.admitCharacter(made({
      classId: 1,                                   // not a player class
      level: 9,
      attributes: { str: 18, dex: 18, con: 8, int: 8, wis: 8, cha: 8 },  // 38 points
      feats: [0, 2],                                // Improved without Power Attack
    }));
    expect(config.classId).toBe(0);
    expect(config.level).toBe(2);
    expect(config.str + config.dex).toBeLessThan(36);
    expect(config.featIds).toBeUndefined();
    expect(changes.join(" ")).toMatch(/class isn't one a player can take.*Level 9 is now 2.*abilities were brought within.*feats went back/);
  });

  test("models and gear follow the GM's choices", () => {
    const droid = made({ appearanceLabel: "Droid_Astromech", appearanceId: 77 });
    expect(GMPlayers.admitCharacter(droid).config.appearanceId).toBe(77);
    GMPlayers.creationLimits = { anyModel: false, gear: false };
    const { config, changes } = GMPlayers.admitCharacter(droid);
    expect(config.appearanceId).not.toBe(77);
    expect(changes.join(" ")).toMatch(/only allows the player bodies.*chooses gear/);
  });
});

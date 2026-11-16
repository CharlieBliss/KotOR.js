import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: { gmMode: true } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: { OTHER_GAME_PREFIX: "@othergame" } }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import { OtherGameManager } from "@/managers/OtherGameManager";
import { ApplicationProfile } from "@/utility/ApplicationProfile";
import { GameEngineType } from "@/enums/engine/GameEngineType";
import { ResourceLoader } from "@/loaders/ResourceLoader";
import { Module } from "@/module/Module";

afterEach(() => {
  jest.restoreAllMocks();
  ApplicationProfile.GameKey = GameEngineType.KOTOR;
});

describe("borrowing the other game's scenes", () => {
  test("running KotOR II, 'kotor:<module>' names a KotOR I area, and the other way round", () => {
    ApplicationProfile.GameKey = GameEngineType.TSL;
    expect(OtherGameManager.foreignModuleName("DANM13")).toBe("kotor:danm13");
    expect(OtherGameManager.parseForeignModule("kotor:danm13")).toBe("danm13");
    // This game's own modules, and names for the running game, aren't borrowed
    expect(OtherGameManager.isForeignModule("001ebo")).toBe(false);
    expect(OtherGameManager.isForeignModule("tsl:001ebo")).toBe(false);

    ApplicationProfile.GameKey = GameEngineType.KOTOR;
    expect(OtherGameManager.foreignModuleName("001ebo")).toBe("tsl:001ebo");
    expect(OtherGameManager.isForeignModule("tsl:001ebo")).toBe(true);
    expect(OtherGameManager.isForeignModule("kotor:danm13")).toBe(false);
  });

  test("the engine is hooked up: modules, scene checks and resource fallbacks", async () => {
    ApplicationProfile.GameKey = GameEngineType.TSL;
    expect(Module.IsBorrowedModule("kotor:tar_m02aa")).toBe(true);
    expect(Module.IsBorrowedModule("001ebo")).toBe(false);
    expect(ResourceLoader.FallbackSources.length).toBeGreaterThan(0);

    // Its archives come from the other game, for its names only
    const open = jest.spyOn(OtherGameManager, "openModuleArchives").mockResolvedValue(["rim"] as any);
    const source = Module.ArchiveSources[Module.ArchiveSources.length - 1];
    expect(await source("kotor:danm14aa")).toEqual(["rim"]);
    expect(open).toHaveBeenCalledWith("danm14aa");
    expect(await source("001ebo")).toBeUndefined();
  });

  test("a resource comes from the other game only once it's mounted, from the BIF its key points at", async () => {
    OtherGameManager.mounted = false;
    expect(await OtherGameManager.getResource(2002, "m13aa_01a")).toBeUndefined();

    const bif = { getResourceById: jest.fn(() => "res"), getResourceBuffer: jest.fn(async () => new Uint8Array([1, 2, 3])) };
    OtherGameManager.mounted = true;
    OtherGameManager.key = { getFileKey: jest.fn(() => ({ resId: (3 << 20) | 7 })) } as any;
    OtherGameManager.bifs = new Map([[3, bif as any]]);
    expect(await OtherGameManager.getResource(2002, "M13AA_01A")).toEqual(new Uint8Array([1, 2, 3]));
    expect((OtherGameManager.key as any).getFileKey).toHaveBeenCalledWith("m13aa_01a", 2002);
    OtherGameManager.mounted = false;
  });
});

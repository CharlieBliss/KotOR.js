import { describe, expect, jest, test } from "@jest/globals";

// The real GameState pulls in the whole browser engine (WebGL, window, File System Access)
jest.mock("@/GameState", () => ({ GameState: { gmMode: true } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));
jest.mock("@/audio/AudioEngine", () => ({ AudioEngine: { GetAudioEngine: (): any => undefined } }));

import { GMAtmosphere } from "@/managers/gm/GMAtmosphere";
import { GameState } from "@/GameState";

describe("GM atmosphere", () => {
  test("the game's colours are 0x00BBGGRR: Hrakert Station's water is dark teal, not brown", () => {
    expect(GMAtmosphere.bgrToHex(0x493410)).toBe('#103449');
    expect(GMAtmosphere.hexToBgr('#103449')).toBe(0x493410);
  });

  test("anything the GM hasn't set is the scene's own; reset goes back to it all", async () => {
    (GameState as any).module = {
      area: {
        sun: { fogOn: 1, fogColor: 0x051a1f, fogNear: 0, fogFar: 160 },
        dynamicAmbientColor: 0x333333,
        audio: { music: { day: 18, battle: 31 }, ambient: { day: 30, dayVolume: 81 } },
      },
    };
    GMAtmosphere.onSceneLoaded();
    GMAtmosphere.current = { music: 23, fog: { on: true, color: 0x493410, near: 0, far: 120 } };
    const now = GMAtmosphere.effective();
    expect(now.music).toBe(23);
    expect(now.fog.far).toBe(120);
    expect(now.battle).toBe(31);
    expect(now.ambient).toBe(30);
    // A new scene drops the last one's changes
    GMAtmosphere.onSceneLoaded();
    expect(GMAtmosphere.current).toEqual({});
    expect(GMAtmosphere.effective().fog.far).toBe(160);
  });
});

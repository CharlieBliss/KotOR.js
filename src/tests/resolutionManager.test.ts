import { describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: {} }));

// ResolutionManager reads the window as it loads; a plain object stands in for it here
(globalThis as any).window = (globalThis as any).window || { innerWidth: 1280, innerHeight: 800, screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1080 }, devicePixelRatio: 1, addEventListener() {} };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ResolutionManager } = require("@/managers/ResolutionManager");

describe("the GUI's scale", () => {
  test("auto keeps the GUI at 1:1 up to a 1080-pixel-tall view, then grows in quarter steps", () => {
    expect(ResolutionManager.autoUIScale(800)).toBe(1);
    expect(ResolutionManager.autoUIScale(1080)).toBe(1);
    expect(ResolutionManager.autoUIScale(1440)).toBe(1.25);
    expect(ResolutionManager.autoUIScale(1600)).toBe(1.25);
    expect(ResolutionManager.autoUIScale(2160)).toBe(2);
  });

  test("the GUI's screen is the viewport over the scale", () => {
    const width = jest.spyOn(ResolutionManager, "getViewportWidth").mockReturnValue(2560);
    const height = jest.spyOn(ResolutionManager, "getViewportHeight").mockReturnValue(1440);
    ResolutionManager.uiScale = 1.25;
    expect([ResolutionManager.getGUIWidth(), ResolutionManager.getGUIHeight()]).toEqual([2048, 1152]);
    ResolutionManager.uiScale = 1;
    width.mockRestore();
    height.mockRestore();
  });
});

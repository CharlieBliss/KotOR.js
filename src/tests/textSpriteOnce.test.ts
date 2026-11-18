import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: {} }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));

import { TextSprite3D } from "@/engine/TextSprite3D";

afterEach(() => jest.restoreAllMocks());

describe("words said over a creature", () => {
  test("the same word is said once however many things say it at once (a resisted power said it twice)", () => {
    const create = jest.spyOn(TextSprite3D, "CreateOnObject").mockImplementation(() => undefined as any);
    let now = 1000;
    jest.spyOn(performance, "now").mockImplementation(() => now);
    const trooper: any = {}, other: any = {};
    TextSprite3D.CreateOnObjectOnce(trooper, "resisted");
    TextSprite3D.CreateOnObjectOnce(trooper, "resisted");
    TextSprite3D.CreateOnObjectOnce(other, "resisted");
    TextSprite3D.CreateOnObjectOnce(trooper, "miss");
    expect(create).toHaveBeenCalledTimes(3);
    now += 600;
    TextSprite3D.CreateOnObjectOnce(trooper, "resisted");
    expect(create).toHaveBeenCalledTimes(4);
  });
});

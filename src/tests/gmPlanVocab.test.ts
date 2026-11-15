import { describe, expect, jest, test } from "@jest/globals";

// The real GameState pulls in the whole browser engine (WebGL, window, File System Access)
jest.mock("@/GameState", () => ({ GameState: { gmMode: true } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import * as fs from "fs";
import * as path from "path";
import { GMManager } from "@/managers/GMManager";
import { GMScenePlan } from "@/managers/GMScenePlan";

/**
 * The words a scene plan may use, as the game reads them. The kotor-gm-scenes skill's checker
 * (check_plan.py) reads them from vocab.json, so the two can't drift apart.
 * Regenerate after changing them:  UPDATE_GM_VOCAB=1 npx jest src/tests/gmPlanVocab.test.ts
 */
const VOCAB_FILE = path.join(__dirname, "..", "..", "skills", "kotor-gm-scenes", "reference", "catalog", "vocab.json");

function vocab() {
  return {
    note: "Generated from the game's sources by src/tests/gmPlanVocab.test.ts; do not edit by hand.",
    skills: GMScenePlan.SKILLS,
    saves: GMScenePlan.SAVES,
    factions: Object.keys(GMScenePlan.FACTIONS),
    orders: GMScenePlan.ORDERS,
    actions: GMScenePlan.ACTIONS,
    stances: GMManager.STANCES.map((s) => s.id),
    gestures: GMManager.GESTURES.map((g) => g.id),
  };
}

describe("scene plan vocabulary", () => {
  test("the skill's vocab.json matches the game", () => {
    const text = JSON.stringify(vocab(), null, 2) + "\n";
    if (process.env.UPDATE_GM_VOCAB) fs.writeFileSync(VOCAB_FILE, text);
    const onDisk = fs.existsSync(VOCAB_FILE) ? fs.readFileSync(VOCAB_FILE, "utf8").replace(/\r\n/g, "\n") : "";
    expect(onDisk).toBe(text);
  });
});

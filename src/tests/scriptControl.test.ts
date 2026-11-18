import { describe, expect, test } from "@jest/globals";
import { isBehaviourScript } from "@/module/creature/ScriptControl";
import { ModuleObjectScript as S } from "@/enums/module/ModuleObjectScript";

describe("which creature scripts decide its behaviour", () => {
  test('heartbeat, perception, combat rounds and being hit are behaviour', () => {
    for (const slot of [S.CreatureOnHeartbeat, S.CreatureOnNotice, S.CreatureOnEndRound, S.CreatureOnAttacked, S.CreatureOnDamaged, S.CreatureOnBlocked, S.CreatureOnDisturbed, S.CreatureOnSpellAt]) {
      expect(isBehaviourScript(slot)).toBe(true);
    }
  });

  test('spawn, death, dialogue and rest always run', () => {
    for (const slot of [S.CreatureOnSpawn, S.CreatureOnDeath, S.CreatureOnDialog, S.CreatureOnEndDialog, S.CreatureOnRested]) {
      expect(isBehaviourScript(slot)).toBe(false);
    }
  });

  test("the AI's own user-defined events are behaviour; death, dialogue and the story's own events aren't", () => {
    for (const n of [1001, 1002, 1003, 1005, 1006, 1008, 1009, 1010]) expect(isBehaviourScript(S.CreatureOnUserDefined, n)).toBe(true);
    for (const n of [1004, 1007, 1011, 1, 50, 2000, 4000]) expect(isBehaviourScript(S.CreatureOnUserDefined, n)).toBe(false);
  });
});

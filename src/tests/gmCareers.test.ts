import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({
  GameState: {
    gmMode: true,
    GameKey: 'TSL',
    AppearanceManager: { appearances: new Map([[136, { label: 'P_Male_01' }], [236, { label: 'Droid_War_01' }]]) },
  },
}));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import { GameState } from "@/GameState";
import { GameEngineType } from "@/enums/engine/GameEngineType";
import { CombatFeatType } from "@/enums/combat/CombatFeatType";
import { SkillType } from "@/enums/nwscript/SkillType";
import { GMManager } from "@/managers/GMManager";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import { GMPlayers } from "@/managers/gm/GMPlayers";
import { GMSpawner } from "@/managers/gm/GMSpawner";
import {
  BASELINE_CAREER_FEATS,
  CAREERS_LIST,
  CAREERS_SPECIALIZATIONS,
  CAREERS_SPECIES,
  CareersRules,
  GMCareersCharacters,
  toEngineSkillRanks,
} from "@/managers/gm/careers";

function installMemoryLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  return store;
}

beforeEach(() => {
  installMemoryLocalStorage();
  (GameState as any).GameKey = GameEngineType.TSL;
  GMManager.ruleset = 'kotor';
  GMManager.notifyChange = jest.fn();
  GMNetworkManager.role = 'host';
  GMNetworkManager.peers = new Map();
  GMNetworkManager.broadcastSessionRules = jest.fn();
  GMNetworkManager.send = jest.fn() as any;
  GMNetworkManager.appendChat = jest.fn();
  GMNetworkManager.notifyChange = jest.fn();
});

describe('Careers vertical slice data & formulas', () => {
  test('ships the 3 vertical-slice species, 2 careers, and 2 12-node trees', () => {
    expect(CAREERS_SPECIES.map((s) => s.id)).toEqual(['human', 'miraluka', 'droid']);
    expect(CAREERS_LIST.map((c) => c.id)).toEqual(['soldier', 'jedi_guardian']);
    expect(CAREERS_SPECIALIZATIONS.map((s) => s.id)).toEqual(['commando', 'peacekeeper']);
    for (const spec of CAREERS_SPECIALIZATIONS) {
      expect(spec.nodes).toHaveLength(12);
      expect(spec.bonusSkills).toHaveLength(4);
    }
  });

  test('FFG-to-KotOR ability conversion, level-from-XP, and skill rank caps match the design', () => {
    expect([1, 2, 3, 4, 5, 6].map((v) => CareersRules.ffgToKotor(v))).toEqual([8, 10, 12, 14, 16, 18]);
    expect([8, 10, 12, 14, 16, 18].map((s) => CareersRules.abilityMod(s))).toEqual([-1, 0, 1, 2, 3, 4]);

    // Level derives only from post-creation campaign XP spent (50 XP/level, capped at 20)
    expect(CareersRules.levelFromXp(0)).toBe(1);
    expect(CareersRules.levelFromXp(49)).toBe(1);
    expect(CareersRules.levelFromXp(50)).toBe(2);
    expect(CareersRules.levelFromXp(950)).toBe(20);
    expect(CareersRules.levelFromXp(5000)).toBe(20);

    // Level baseline (level - 1) / 3 floored, up to +6
    expect([1, 5, 9, 13, 17, 20].map((l) => CareersRules.levelBaseline(l))).toEqual([0, 1, 2, 4, 5, 6]);

    // Combat & save skill rank caps rise every 4 levels; other skills reach 5 freely (2 at creation)
    expect([1, 4, 5, 8, 9, 13, 17, 20].map((l) => CareersRules.maxSkillRank('lightsaber', l, false))).toEqual([2, 2, 3, 3, 4, 5, 5, 5]);
    expect(CareersRules.maxSkillRank('lightsaber', 17, false, true)).toBe(6);
    expect(CareersRules.maxSkillRank('resilience', 1, false)).toBe(2);
    expect(CareersRules.maxSkillRank('resilience', 13, false)).toBe(5);
    expect(CareersRules.maxSkillRank('computer_use', 1, false)).toBe(5);
    expect(CareersRules.maxSkillRank('computer_use', 1, true)).toBe(2);
  });

  test('engine skills convert at rank * 4 and Persuade uses the best of Charm, Negotiation, Deception', () => {
    const engine = toEngineSkillRanks({
      computer_use: 3,
      treat_injury: 5,
      charm: 1,
      negotiation: 4,
      deception: 2,
    });
    expect(engine[SkillType.COMPUTER_USE]).toBe(12);
    expect(engine[SkillType.TREAT_INJURY]).toBe(20);
    expect(engine[SkillType.PERSUADE]).toBe(16);
    expect(engine[SkillType.STEALTH]).toBe(0);
  });

  test('species rules: Miraluka is Force-sensitive in any career; Droid is never Force-sensitive and starts with 175 XP', () => {
    const miralukaSoldier = GMCareersCharacters.blank('miraluka', 'soldier');
    expect(CareersRules.isForceSensitive(miralukaSoldier)).toBe(true);
    expect(CareersRules.derive(miralukaSoldier).maxFp).toBeGreaterThan(0);

    const droidJedi = GMCareersCharacters.blank('droid', 'jedi_guardian');
    expect(CareersRules.isForceSensitive(droidJedi)).toBe(false);
    expect(CareersRules.derive(droidJedi).maxFp).toBe(0);
    expect(CareersRules.derive(droidJedi).startingXpBudget).toBe(175);
  });
});

describe('XP purchases, tree links, and validation', () => {
  test('tree purchases require links from row 0 and block orphan refunds', () => {
    const c = GMCareersCharacters.blank('human', 'soldier');
    c.name = 'Carth';

    // Row 1 cannot be bought before row 0 link
    expect(CareersRules.canBuyNode(c, 'commando', 'r1c1').ok).toBe(false);
    // Row 0 is open (5 XP)
    expect(CareersRules.canBuyNode(c, 'commando', 'r0c1')).toMatchObject({ ok: true, cost: 5 });
    c.nodes.commando = ['r0c1'];
    // Now row 1 centre (Heavy Armour, 10 XP) is unlocked
    expect(CareersRules.canBuyNode(c, 'commando', 'r1c1')).toMatchObject({ ok: true, cost: 10 });
    c.nodes.commando = ['r0c1', 'r1c1'];

    // Cannot refund r0c1 while r1c1 depends on it; can refund r1c1 first
    expect(CareersRules.canRemoveNode(c, 'commando', 'r0c1')).toBe(false);
    expect(CareersRules.canRemoveNode(c, 'commando', 'r1c1')).toBe(true);

    const d = CareersRules.derive(c);
    expect(d.startingXpUsed).toBe(15);
    expect(d.startingXpRemaining).toBe(95);
    expect(d.featIds).toContain(CombatFeatType.TOUGHNESS);
    expect(d.featIds).toContain(CombatFeatType.ARMOUR_PROF_HEAVY);
    expect(CareersRules.validate(c)).toEqual([]);
  });

  test('leftover starting XP stays starting XP and never raises level; campaign XP spent drives level', () => {
    const droid = GMCareersCharacters.blank('droid', 'soldier');
    droid.name = 'HK-55';
    droid.characteristics.dex = 4; // 20 + 30 + 40 = 90 XP
    const d1 = CareersRules.derive(droid);
    expect(d1.startingXpUsed).toBe(90);
    expect(d1.startingXpRemaining).toBe(85);
    expect(d1.level).toBe(1);

    // Spend 100 campaign XP post-creation -> level 3
    droid.campaignXpEarned = 120;
    droid.campaignXpSpent = 100;
    droid.nodes.commando = ['r0c0', 'r0c1', 'r0c2', 'r1c0', 'r1c1', 'r1c2', 'r2c0', 'r2c1', 'r2c2']; // 15+30+45 = 90 XP (+90 char = 180 total)
    const d2 = CareersRules.derive(droid);
    expect(d2.level).toBe(3);
    expect(d2.startingXpUsed).toBe(80);
    expect(d2.campaignXpRemaining).toBe(20);
  });

  test('validation catches opposite-alignment powers, non-Force powers, broken tree links, and overspending', () => {
    const jedi = GMCareersCharacters.blank('human', 'jedi_guardian');
    jedi.name = 'Bao';
    jedi.alignment = 'light';
    jedi.powers = [24]; // Shock (dark)
    expect(CareersRules.validate(jedi).some((p) => p.includes('dark-side'))).toBe(true);

    const trooper = GMCareersCharacters.blank('human', 'soldier');
    trooper.name = 'Trooper';
    trooper.powers = [27]; // Force Push on non-Force-sensitive
    expect(CareersRules.validate(trooper).some((p) => p.includes('Non-Force-sensitive'))).toBe(true);

    trooper.powers = [];
    trooper.nodes.commando = ['r2c1']; // orphaned node
    expect(CareersRules.validate(trooper).some((p) => p.includes('not linked'))).toBe(true);

    trooper.nodes.commando = [];
    trooper.characteristics = { str: 5, dex: 5, con: 5, int: 2, wis: 2, cha: 2 }; // 360 XP > 110
    expect(CareersRules.validate(trooper).some((p) => p.includes('Overspent starting XP'))).toBe(true);
  });
});

describe('Careers storage, JSON files, and spawn conversion', () => {
  test('saves separately, exports/imports JSON, and rejects classic character files', () => {
    const c = GMCareersCharacters.blank('human', 'jedi_guardian');
    c.name = 'Exile';
    const saved = GMCareersCharacters.save(c);
    expect(GMCareersCharacters.list().map((x) => x.id)).toEqual([saved.id]);

    const json = GMCareersCharacters.toFileText(saved);
    const imported = GMCareersCharacters.fromFileText(json);
    expect(imported.character?.name).toBe('Exile');
    expect(imported.character?.ruleset).toBe('careers');
    expect(imported.character?.id).not.toBe(saved.id);

    const classicText = JSON.stringify({ format: 'kotorjs-gm-character', id: 'c1', name: 'Old', game: 'tsl', classId: 0, level: 1 });
    expect(GMCareersCharacters.fromFileText(classicText).character).toBeNull();
  });

  test('toSpawnConfig + buildPlayerAbilities produce exact careers stats with no automatic class grants', () => {
    const c = GMCareersCharacters.blank('droid', 'soldier');
    c.name = 'HK-Unit';
    c.characteristics = { str: 2, dex: 3, con: 2, int: 2, wis: 2, cha: 1 };
    c.freeCareerSkills = ['ranged_heavy', 'resilience', 'athletics', 'brawl', 'melee', 'survival'];
    c.freeSpecSkills = ['resilience', 'survival'];
    c.nodes.commando = ['r0c2']; // Rapid Shot

    const cfg = GMCareersCharacters.toSpawnConfig(c);
    expect(cfg.ruleset).toBe('careers');
    expect(cfg.race).toBe(5);
    expect(cfg.naturalAC).toBe(0);
    expect(cfg.subraceIndex).toBe(0);
    expect(cfg.str).toBe(10);
    expect(cfg.dex).toBe(12);
    expect(cfg.saves).toEqual({ fortitude: 4, reflex: 0, will: 0 });
    expect(cfg.hp).toBe(16); // hpBase 10 + lv1 * (6 + 0)
    expect(cfg.fp).toBe(0);
    expect(cfg.featIds).toEqual([...BASELINE_CAREER_FEATS, CombatFeatType.RAPID_SHOT].sort((a, b) => a - b));

    // GMSpawner.buildPlayerAbilities respects careers config directly without CharacterBuilder class grants
    const built = GMSpawner.buildPlayerAbilities(cfg);
    expect(built.feats).toEqual(cfg.featIds);
    expect(built.powers).toEqual([]);
    expect(built.maxHp).toBe(16);
    expect(built.maxFp).toBe(0);
  });
});

describe('Session rule-set switch and join validation', () => {
  test('careers ruleset is KotOR II only and broadcasts in sessionRules', () => {
    (GameState as any).GameKey = GameEngineType.KOTOR;
    expect(GMManager.setRuleset('careers')).toBe(false);
    expect(GMManager.ruleset).toBe('kotor');

    (GameState as any).GameKey = GameEngineType.TSL;
    expect(GMManager.setRuleset('careers')).toBe(true);
    expect(GMManager.ruleset).toBe('careers');
    expect(GMManager.sessionRules().ruleset).toBe('careers');
    expect(GMNetworkManager.broadcastSessionRules).toHaveBeenCalled();
  });

  test('host refuses mismatched characters on peer.join and client handles join.refused', async () => {
    const validCareers = GMCareersCharacters.blank('human', 'soldier');
    validCareers.name = 'Mira';

    // Careers session rejects classic join
    GMManager.setRuleset('careers');
    await GMPlayers.onPeerJoin('p_classic', { name: 'Classic', preset: { name: 'Classic', appearanceId: 136, classId: 0 } });
    expect(GMNetworkManager.peers.has('p_classic')).toBe(false);
    expect(GMNetworkManager.send).toHaveBeenCalledWith(
      'join.refused',
      expect.objectContaining({ ruleset: 'careers', reason: expect.stringContaining('Careers rule set') }),
      'p_classic'
    );

    // Classic session rejects careers join
    (GMNetworkManager.send as jest.Mock).mockClear();
    GMManager.setRuleset('kotor');
    await GMPlayers.onPeerJoin('p_careers', {
      name: 'Mira',
      preset: { name: 'Mira', appearanceId: 136, classId: 0, careersCharacter: validCareers },
    });
    expect(GMNetworkManager.peers.has('p_careers')).toBe(false);
    expect(GMNetworkManager.send).toHaveBeenCalledWith(
      'join.refused',
      expect.objectContaining({ ruleset: 'kotor', reason: expect.stringContaining('classic KotOR') }),
      'p_careers'
    );

    // Client receiving join.refused fails the join cleanly with the host's reason
    GMNetworkManager.role = 'client';
    GMNetworkManager.peerId = 'p_me';
    const failSpy = jest.spyOn(GMNetworkManager, 'failJoin').mockImplementation(() => {});
    await GMNetworkManager.onPacketReceived({
      type: 'join.refused',
      senderId: 'host',
      targetPeerId: 'p_me',
      timestamp: 0,
      payload: { reason: 'Wrong rule set.', ruleset: 'careers' },
    });
    expect(failSpy).toHaveBeenCalledWith('Wrong rule set.');
    failSpy.mockRestore();
  });
});

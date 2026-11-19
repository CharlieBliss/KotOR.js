import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({
  GameState: {
    gmMode: true,
    GameKey: 'TSL',
    SWRuleSet: {},
    TwoDAManager: {
      datatables: new Map([
        ['classes', { rows: { 0: { __index: 0, label: 'Soldier', name: 0 }, 3: { __index: 3, label: 'JediGuardian', name: 0 } } }],
      ]),
    },
    hooks: jest.requireActual<typeof import("@/engine/EngineHooks")>("@/engine/EngineHooks").DEFAULT_ENGINE_HOOKS,
  },
}));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));
jest.mock("@/engine/FollowerCamera", () => ({ FollowerCamera: {} }));

import { GameState } from "@/GameState";
import { CombatRound } from "@/combat/CombatRound";
import { CombatFeatType } from "@/enums/combat/CombatFeatType";
import { WeaponWield } from "@/enums/combat/WeaponWield";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { SkillType } from "@/enums/nwscript/SkillType";
import { ModuleCreature } from "@/module/ModuleCreature";
import { TalentFeat } from "@/talents/TalentFeat";
import { TalentSpell } from "@/talents/TalentSpell";
import { GMManager } from "@/managers/GMManager";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import { GMPlayers } from "@/managers/gm/GMPlayers";
import { GMPlayerHud } from "@/managers/gm/GMPlayerHud";
import {
  CareersAdvancement,
  CareersRuntime,
  GMCareersCharacters,
  combatSkillForWeapon,
} from "@/managers/gm/careers";

function makeCreature(fields: Record<string, any> = {}): any {
  const cre = Object.create(ModuleCreature.prototype);
  const skills = Array.from({ length: 8 }, () => ({
    rank: 0,
    setRank(r: number) { this.rank = r; },
  }));
  const cls: any = {
    id: 0,
    level: 1,
    spells: [] as any[],
    setLevel(l: number) { this.level = l; },
    getACBonus: () => 4,
    getBaseAttackBonus: () => 5,
    addSpell(s: any) { this.spells.push(s); },
  };
  Object.assign(cre, {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    gmNetId: 'pc_1',
    firstName: 'Hero',
    str: 14, dex: 14, con: 12, int: 10, wis: 12, cha: 10,
    hitPoints: 30, maxHitPoints: 30, currentHitPoints: 30,
    forcePoints: 20, maxForcePoints: 20, currentForce: 20,
    naturalAC: 0,
    fortitudeSaveThrow: 3, reflexSaveThrow: 4, willSaveThrow: 5,
    fortbonus: 0, refbonus: 0, willbonus: 0,
    movementSpeed: 1,
    effects: [] as any[],
    feats: [] as any[],
    skills,
    classes: [cls],
    equipment: {},
    combatData: { combatState: false },
    getName: () => cre.firstName,
    isDead: () => false,
    isSimpleCreature: () => false,
    getHP: () => cre.currentHitPoints,
    getMaxHP: () => cre.maxHitPoints,
    getFP: () => cre.currentForce,
    getMaxFP: () => cre.maxForcePoints,
    getFeats: () => cre.feats,
    getSpells: () => cre.classes[0]?.spells || [],
    getHasFeat: (id: number) => cre.feats.some((f: any) => f.id === id),
    getBaseAttackBonus: () => cre.classes[0]?.getBaseAttackBonus?.() ?? 0,
    getAttackAbilityModifier: () => 2,
    getEquippedWeaponType: () => 1,
    addEffect(e: any) { this.effects.push(e); },
    ...fields,
  });
  return cre;
}

function makeWeapon(wield: WeaponWield, baseItemId = 1, attackBonus = 0): any {
  return {
    baseItemId,
    getBaseItemId: () => baseItemId,
    getWeaponWield: () => wield,
    getAttackBonus: () => attackBonus,
    possessor: undefined,
  };
}

beforeEach(() => {
  GMManager.ruleset = 'careers';
  GMManager.spawnedPlayers = [];
  GMManager.netIdMap.clear();
  GMManager.notifyChange = jest.fn();
  GMNetworkManager.role = 'host';
  GMNetworkManager.peers = new Map();
  GMNetworkManager.send = jest.fn() as any;
  GMNetworkManager.appendChat = jest.fn();
  GMNetworkManager.notifyChange = jest.fn();
});

describe('Phase 3 engine seams (classic pinned vs careers)', () => {
  test('classic creature without careersRules keeps class BAB, class AC, and raw class saves', () => {
    const classic = makeCreature({ naturalAC: 2 });
    const round = new CombatRound(classic);
    const sword = makeWeapon(WeaponWield.ONE_HANDED_SWORD, 3, 1);

    // Classic attack: BAB(5) + abilityMod(2) + weapon(1) = 8
    expect(round.calculateAttackBonus(classic, sword)).toBe(8);
    // Classic AC: 10 + naturalAC(2) + classBonus(4) + dexMod(2) = 18
    expect(classic.getAC()).toBe(18);
    // Classic saves: raw fortitudeSaveThrow/reflexSaveThrow/willSaveThrow
    expect(classic.getFortitudeSave()).toBe(3);
    expect(classic.getReflexSave()).toBe(4);
    expect(classic.getWillSave()).toBe(5);
  });

  test('careers creature uses combat skill * 2 + level baseline for attack, drops class AC, and uses save skills * 2', () => {
    const sheet = GMCareersCharacters.blank('human', 'jedi_guardian');
    sheet.name = 'Bastila';
    sheet.freeCareerSkills = ['lightsaber', 'discipline', 'resilience', 'athletics'];
    sheet.freeSpecSkills = ['lightsaber', 'discipline']; // lightsaber rank 2, discipline rank 2
    sheet.boughtSkillRanks = { coordination: 1 }; // coordination rank 1
    sheet.campaignXpEarned = 200;
    sheet.campaignXpSpent = 200; // level 5 -> levelBaseline = floor(4/3) = 1

    const cre = makeCreature({ naturalAC: 0, dex: 14 });
    cre.careersRules = new CareersRuntime(sheet, cre);
    const round = new CombatRound(cre);

    const saber = makeWeapon(WeaponWield.ONE_HANDED_SWORD, 8, 1);
    const rifle = makeWeapon(WeaponWield.BLASTER_RIFLE, 15, 0);
    expect(combatSkillForWeapon(saber)).toBe('lightsaber');
    expect(combatSkillForWeapon(rifle)).toBe('ranged_heavy');
    expect(combatSkillForWeapon(undefined)).toBe('brawl');

    // Saber attack: rank(2)*2 + levelBaseline(1) + abilityMod(2) + weapon(1) = 8 (class BAB 5 ignored)
    expect(round.calculateAttackBonus(cre, saber)).toBe(8);
    // Rifle attack (rank 0): 0 + levelBaseline(1) + abilityMod(2) = 3
    expect(round.calculateAttackBonus(cre, rifle)).toBe(3);
    // Deflection base uses Lightsaber rank(2)*2 + levelBaseline(1) = 5
    expect(cre.careersRules.getDeflectionBase()).toBe(5);

    // AC: 10 + naturalAC(0) + levelBaseline(1) + dexMod(2) = 13 (class AC bonus 4 ignored)
    expect(cre.getAC()).toBe(13);

    // Saves: resilience(1)*2 = 2, coordination(1)*2 = 2, discipline(2)*2 = 4 (raw fields 3/4/5 ignored)
    expect(cre.getFortitudeSave()).toBe(2);
    expect(cre.getReflexSave()).toBe(2);
    expect(cre.getWillSave()).toBe(4);
  });
});

describe('Strain, Winded, combat feats paid in Strain, and Force pushing', () => {
  test('TalentFeat.impactCaster spends Strain instead of applying AC/attack penalties on careers characters', () => {
    const feat = new TalentFeat();
    feat.id = CombatFeatType.POWER_ATTACK;

    // Classic character still gets EffectAttackDecrease
    const classic = makeCreature();
    feat.impactCaster(classic);
    expect(classic.effects.some((e: any) => e.type === GameEffectType.EffectAttackDecrease)).toBe(true);

    // Careers character gets NO penalty effects and pays 2 Strain
    const sheet = GMCareersCharacters.blank('human', 'soldier');
    const careersCre = makeCreature();
    const rt = new CareersRuntime(sheet, careersCre);
    careersCre.careersRules = rt;
    feat.impactCaster(careersCre);
    expect(careersCre.effects).toHaveLength(0);
    expect(rt.strain).toBe(2);
  });

  test('exceeding maxStrain triggers winded, slows movement, blocks Strain spending, and drops to half max after winded', () => {
    const sheet = GMCareersCharacters.blank('human', 'soldier'); // strainBase 10 + wisMod 0 = 10
    const cre = makeCreature();
    const rt = new CareersRuntime(sheet, cre);
    cre.careersRules = rt;

    expect(rt.maxStrain).toBe(10);
    expect(rt.spendStrain(9)).toEqual({ ok: true, becameWinded: false });
    expect(rt.isWinded()).toBe(false);
    expect(cre.movementSpeed).toBe(1);

    // Spending 2 more exceeds 10 -> winded!
    expect(rt.spendStrain(2)).toEqual({ ok: true, becameWinded: true });
    expect(rt.isWinded()).toBe(true);
    expect(rt.strain).toBe(10);
    expect(cre.movementSpeed).toBeCloseTo(CareersRuntime.WINDED_SPEED_MULTIPLIER);

    // Cannot spend more Strain while winded
    expect(rt.spendStrain(2)).toEqual({ ok: false, becameWinded: false });

    // Tick through winded duration (6 s) -> drops Strain to half max (5) and restores speed
    rt.tick(6, true);
    expect(rt.isWinded()).toBe(false);
    expect(rt.strain).toBe(5);
    expect(cre.movementSpeed).toBe(1);

    // In combat: refills 1 per 3 s round
    rt.tick(3, true);
    expect(rt.strain).toBe(4);

    // Out of combat: refills completely after 4 s
    rt.tick(4, false);
    expect(rt.strain).toBe(0);
  });

  test('Force pushing pays 2 Strain per missing FP when not winded, and blocks when winded', () => {
    const sheet = GMCareersCharacters.blank('human', 'jedi_guardian');
    const cre = makeCreature();
    const rt = new CareersRuntime(sheet, cre);

    // Cost 10 FP with 7 FP left -> spends 7 FP + 6 Strain
    expect(rt.payForceCost(10, 7)).toEqual({ fpToSpend: 7, ok: true });
    expect(rt.strain).toBe(6);

    // Pushing 3 more missing FP (6 Strain -> 12 > 10) succeeds once and triggers winded
    expect(rt.payForceCost(5, 2)).toEqual({ fpToSpend: 2, ok: true });
    expect(rt.isWinded()).toBe(true);

    // Now winded: cannot push a shortfall, though can still cast if FP covers full cost
    expect(rt.payForceCost(5, 2)).toEqual({ fpToSpend: 0, ok: false });
    expect(rt.payForceCost(5, 5)).toEqual({ fpToSpend: 5, ok: true });
  });

  test('a push can tip Strain over by one point of Force at most, so no Force points is not free powers', () => {
    const rt = new CareersRuntime(GMCareersCharacters.blank('human', 'jedi_guardian'), makeCreature());
    // Max Strain 10: a 40 FP power with 0 FP would need 80 Strain
    expect(rt.strainToPush(40, 0)).toBeNull();
    expect(rt.payForceCost(40, 0)).toEqual({ fpToSpend: 0, ok: false });
    expect(rt.strain).toBe(0);
    // 6 missing FP is 12 Strain: 10 left plus one point's worth (2) is the most a push may take
    expect(rt.strainToPush(6, 0)).toBe(12);
    expect(rt.strainToPush(7, 0)).toBeNull();
    expect(rt.strainToPush(5, 5)).toBe(0);
  });

  test('a feat queued before becoming winded gets KotOR penalties, not a free use', () => {
    const rt = new CareersRuntime(GMCareersCharacters.blank('human', 'soldier'), makeCreature());
    expect(rt.payCombatFeatStrain(CombatFeatType.POWER_ATTACK)).toBe(true);
    rt.spendStrain(20); // winded
    expect(rt.isWinded()).toBe(true);
    expect(rt.payCombatFeatStrain(CombatFeatType.POWER_ATTACK)).toBe(false);
  });
});

describe('Force powers in armour (forbiditemmask — Careers characters only)', () => {
  test('blocks powers with forbiditemmask bit 0 when wearing light/medium/heavy armour, allows robes and unrestricted powers', () => {
    const speed = new TalentSpell(8);
    speed.forbiditemmask = 1;
    const heal = new TalentSpell(28);
    heal.forbiditemmask = 0;

    const lightArmor = { baseItem: { requiredFeat0: CombatFeatType.ARMOUR_PROF_LIGHT, armorCheckPen: true } };
    const jediRobe = { baseItem: { requiredFeat0: -1, armorCheckPen: false } };

    const careers = (cre: any) => {
      const sheet = GMCareersCharacters.blank('human', 'jedi_guardian');
      cre.careersRules = new CareersRuntime(sheet, cre);
      return cre;
    };
    const armored = careers(makeCreature({ equipment: { ARMOR: lightArmor } }));
    const robed = careers(makeCreature({ equipment: { ARMOR: jediRobe } }));
    const unarmored = careers(makeCreature({ equipment: {} }));
    // Classic characters, enemies and KotOR I keep KotOR's own rules
    const classicArmored = makeCreature({ equipment: { ARMOR: lightArmor } });

    expect(speed.isBlockedByArmor(classicArmored)).toBe(false);
    expect(speed.isBlockedByArmor(armored)).toBe(true);
    expect(speed.isBlockedByArmor(robed)).toBe(false);
    expect(speed.isBlockedByArmor(unarmored)).toBe(false);
    expect(heal.isBlockedByArmor(armored)).toBe(false);

    // GMPlayerHud flags it as unusable with clear reason
    armored.classes[0].spells = [Object.assign(speed, { forcefriendly: '2', range: 'P', getForcePointCost: () => 5 })];
    const hudList = GMPlayerHud.abilities(armored);
    const speedEntry = hudList.find((a) => a.key === 'power:8');
    expect(speedEntry?.usable).toBe(false);
    expect(speedEntry?.why).toMatch(/armour/i);
  });
});

describe('Advancement in play (live recomputation, undo, respec, network sync)', () => {
  test('awards XP with reason, blocks spending in combat, applies purchases live, and supports undo/respec', async () => {
    const sheet = GMCareersCharacters.blank('human', 'soldier');
    sheet.name = 'Carth';
    sheet.characteristics.str = 4; // 30 + 40 = 70 starting XP used, 40 starting XP left
    const cre = makeCreature({ gmNetId: 'pc_carth', firstName: 'Carth', currentHitPoints: 10, maxHitPoints: 16 });
    cre.gmPlayerConfig = GMCareersCharacters.toSpawnConfig(sheet);
    CareersAdvancement.syncToCreature(cre, sheet);
    GMManager.spawnedPlayers = [cre];
    (GameState as any).PartyManager = { party: [cre] };
    (GameState as any).module = { area: { creatures: [] } };

    // GM awards 75 campaign XP with a reason
    expect(GMPlayers.giveCareersXP('all', 75, 'Defeated Sith squad')).toBe(1);
    expect(sheet.campaignXpEarned).toBe(75);
    expect(sheet.xpLog?.[0]).toMatchObject({ amount: 75, reason: 'Defeated Sith squad' });

    // Blocked while in combat
    cre.combatData.combatState = true;
    expect(GMPlayers.spendXpOnHost(cre, { kind: 'node', specId: 'commando', nodeId: 'r0c0' })).toBe(false);
    cre.combatData.combatState = false;

    // Spend 40 leftover starting XP + 55 campaign XP across skills/nodes -> level 2 (55 >= 50)
    expect(GMPlayers.spendXpOnHost(cre, { kind: 'skill', skillId: 'melee' })).toBe(true); // 5 XP (starting)
    expect(GMPlayers.spendXpOnHost(cre, { kind: 'skill', skillId: 'melee' })).toBe(true); // 10 XP (starting)
    expect(GMPlayers.spendXpOnHost(cre, { kind: 'node', specId: 'commando', nodeId: 'r0c0' })).toBe(true); // 5 XP (starting)
    expect(GMPlayers.spendXpOnHost(cre, { kind: 'node', specId: 'commando', nodeId: 'r1c0' })).toBe(true); // 10 XP (starting)
    expect(GMPlayers.spendXpOnHost(cre, { kind: 'node', specId: 'commando', nodeId: 'r2c0' })).toBe(true); // 15 XP (10 starting + 5 campaign)
    expect(GMPlayers.spendXpOnHost(cre, { kind: 'node', specId: 'commando', nodeId: 'r3c0' })).toBe(true); // 20 XP (campaign)
    expect(GMPlayers.spendXpOnHost(cre, { kind: 'node', specId: 'commando', nodeId: 'r0c1' })).toBe(true); // 5 XP (campaign)
    expect(GMPlayers.spendXpOnHost(cre, { kind: 'node', specId: 'commando', nodeId: 'r1c1' })).toBe(true); // 10 XP (campaign)
    expect(GMPlayers.spendXpOnHost(cre, { kind: 'node', specId: 'commando', nodeId: 'r2c1' })).toBe(true); // 15 XP (campaign -> total 55 campaign!)

    expect(sheet.campaignXpSpent).toBe(55);
    expect(cre.classes[0].level).toBe(2);
    expect(cre.maxHitPoints).toBe(22); // hpBase 10 + 2 * (6 + 0)
    expect(cre.getHasFeat(CombatFeatType.ARMOUR_PROF_HEAVY)).toBe(true);
    expect(cre.getHasFeat(CombatFeatType.MASTER_POWER_ATTACK)).toBe(true);

    // Network sheet carries live careers state and restores it on a client replica
    (cre.careersRules as CareersRuntime).spendStrain(4);
    const netSheet = GMPlayers.buildPlayerSheet(cre);
    expect(netSheet.careers?.strain).toBe(4);
    expect(netSheet.careers?.character.campaignXpSpent).toBe(55);

    const clientReplica = makeCreature({ gmNetId: 'pc_carth' });
    await GMPlayers.applySheetToCharacter(clientReplica, netSheet);
    expect(clientReplica.careersRules?.getStrainState().strain).toBe(4);
    expect(clientReplica.careersRules?.getAttackBase(makeWeapon(WeaponWield.ONE_HANDED_SWORD, 3))).toBe(4); // melee rank 2 * 2 + lv2 baseline 0

    // Undo last purchase drops campaignXpSpent from 55 -> 40 -> back to level 1
    expect(GMPlayers.undoCareersPurchase(cre)).toBe(true);
    expect(sheet.campaignXpSpent).toBe(40);
    expect(cre.classes[0].level).toBe(1);

    // Full respec refunds everything back to creation state while preserving campaignXpEarned
    const refunded = GMPlayers.respecCareers(cre);
    expect(refunded).toBe(8);
    expect(sheet.campaignXpSpent).toBe(0);
    expect(sheet.campaignXpEarned).toBe(75);
    expect(cre.getHasFeat(CombatFeatType.ARMOUR_PROF_HEAVY)).toBe(false);
    expect(cre.classes[0].level).toBe(1);
  });
});

describe('review fixes: purchases, GM grants, and the player keeping their character', () => {
  test("a purchase request for a skill that doesn't exist is refused and books no XP", () => {
    const sheet = GMCareersCharacters.blank('human', 'soldier');
    sheet.name = 'Mira';
    CareersAdvancement.awardXp(sheet, 50);
    const res = CareersAdvancement.applyPurchase(sheet, { kind: 'skill', skillId: 'jedi_mind_tricks' as any });
    expect(res.ok).toBe(false);
    expect(sheet.campaignXpSpent).toBe(0);
    expect(sheet.boughtSkillRanks).toEqual({});
  });

  test('an award or purchase keeps feats and powers the GM granted by hand, and drops what the sheet no longer has', () => {
    const sheet = GMCareersCharacters.blank('human', 'soldier');
    sheet.name = 'Carth';
    const cre = makeCreature();
    cre.careersRules = new CareersRuntime(sheet, cre);
    CareersAdvancement.syncToCreature(cre, sheet);
    // The GM hands out Sniper Shot through the Inspector
    cre.feats.push(TalentFeat.From2DA({ __index: CombatFeatType.SNIPER_SHOT }));
    CareersAdvancement.awardXp(sheet, 50);
    expect(CareersAdvancement.applyPurchase(sheet, { kind: 'node', specId: 'commando', nodeId: 'r0c0' }).ok).toBe(true);
    CareersAdvancement.syncToCreature(cre, sheet);
    expect(cre.getHasFeat(CombatFeatType.SNIPER_SHOT)).toBe(true);
    expect(cre.getHasFeat(CombatFeatType.POWER_ATTACK)).toBe(true);
    // Undoing the purchase takes away the sheet's feat, not the GM's
    CareersAdvancement.undoLastPurchase(sheet);
    CareersAdvancement.syncToCreature(cre, sheet);
    expect(cre.getHasFeat(CombatFeatType.POWER_ATTACK)).toBe(false);
    expect(cre.getHasFeat(CombatFeatType.SNIPER_SHOT)).toBe(true);
  });

  test("the player's game saves the host's version of its character over the stored one, and never adds others", () => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
    };
    const made = GMCareersCharacters.blank('human', 'soldier');
    made.name = 'Mira';
    const saved = GMCareersCharacters.save(made);
    const fromHost = { ...saved, campaignXpEarned: 75, xpLog: [{ amount: 75, reason: 'the ambush', at: 1 }] };
    expect(GMCareersCharacters.keepFromSession(fromHost)).toBe(true);
    expect(GMCareersCharacters.get(saved.id)?.campaignXpEarned).toBe(75);
    // Nothing changed: no rewrite
    expect(GMCareersCharacters.keepFromSession({ ...fromHost })).toBe(false);
    // Someone else's character isn't added
    expect(GMCareersCharacters.keepFromSession({ ...fromHost, id: 'car_someone_else' })).toBe(false);
    expect(GMCareersCharacters.list()).toHaveLength(1);
  });
});

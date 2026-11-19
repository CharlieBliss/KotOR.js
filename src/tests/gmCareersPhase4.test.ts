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

import { CombatAttackData } from "@/combat/CombatAttackData";
import { CombatRound } from "@/combat/CombatRound";
import { CombatRoundAction } from "@/combat/CombatRoundAction";
import { EffectDamage } from "@/effects/EffectDamage";
import { AttackResult } from "@/enums/combat/AttackResult";
import { DamageType } from "@/enums/combat/DamageType";
import { WeaponWield } from "@/enums/combat/WeaponWield";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { SkillType } from "@/enums/nwscript/SkillType";
import { ModuleCreature } from "@/module/ModuleCreature";
import { TalentSpell } from "@/talents/TalentSpell";
import { Dice } from "@/utility/Dice";
import { GMManager } from "@/managers/GMManager";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import { GMChecks } from "@/managers/gm/GMChecks";
import { GMPlayerHud } from "@/managers/gm/GMPlayerHud";
import { GMPlayers } from "@/managers/gm/GMPlayers";
import {
  CAREERS_SPECIALIZATIONS,
  CAREERS_TALENTS,
  CAREERS_TALENT_BY_ID,
  CareersAdvancement,
  CareersRules,
  CareersRuntime,
  GMCareersCharacters,
} from "@/managers/gm/careers";

function makeCreature(fields: Record<string, any> = {}): any {
  const cre = Object.create(ModuleCreature.prototype);
  const keyAbilities = ['INT', 'INT', 'DEX', 'WIS', 'CHA', 'INT', 'DEX', 'WIS'];
  const skills = Array.from({ length: 8 }, (_, i) => ({
    rank: 0,
    keyAbility: keyAbilities[i],
    setRank(r: number) { this.rank = r; },
  }));
  const cls: any = {
    id: 0,
    level: 1,
    spells: [] as any[],
    setLevel(l: number) { this.level = l; },
    getACBonus: () => 2,
    getBaseAttackBonus: () => 4,
    addSpell(s: any) { this.spells.push(s); },
  };
  Object.assign(cre, {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    gmNetId: 'pc_1',
    firstName: 'Hero',
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    hitPoints: 40, maxHitPoints: 40, currentHitPoints: 40,
    forcePoints: 20, maxForcePoints: 20, currentForce: 20,
    naturalAC: 0,
    goodEvil: 50,
    fortitudeSaveThrow: 2, reflexSaveThrow: 2, willSaveThrow: 2,
    fortbonus: 0, refbonus: 0, willbonus: 0,
    movementSpeed: 1,
    effects: [] as any[],
    feats: [] as any[],
    skills,
    classes: [cls],
    equipment: {},
    combatData: { combatState: false },
    getName: () => cre.firstName,
    isDead: () => cre.currentHitPoints <= 0,
    isSimpleCreature: () => false,
    getHP: () => cre.currentHitPoints,
    getMaxHP: () => cre.maxHitPoints,
    getFP: () => cre.currentForce,
    getMaxFP: () => cre.maxForcePoints,
    getGoodEvil: () => cre.goodEvil,
    getFeats: () => cre.feats,
    getSpells: () => cre.classes[0]?.spells || [],
    getHasFeat: (id: number) => cre.feats.some((f: any) => f.id === id),
    getBaseAttackBonus: () => cre.classes[0]?.getBaseAttackBonus?.() ?? 0,
    getTotalClassLevel: () => cre.classes[0]?.level ?? 1,
    getSpellCasterLevel: () => cre.classes[0]?.level ?? 1,
    getEquippedWeaponType: () => 1,
    subtractHP(amt: number) { this.currentHitPoints -= amt; },
    addHP(amt: number) { this.currentHitPoints = Math.min(this.maxHitPoints, this.currentHitPoints + amt); },
    addEffect(e: any) { this.effects.push(e); },
    clearAllActions: jest.fn(),
    ...fields,
  });
  return cre;
}

function makeWeapon(opts: {
  wield: WeaponWield;
  baseItemId?: number;
  baseDamage?: number;
  isRanged?: boolean;
  critThreat?: number;
  critMult?: number;
}): any {
  const isRanged = opts.isRanged ?? (
    opts.wield === WeaponWield.BLASTER_PISTOL ||
    opts.wield === WeaponWield.BLASTER_RIFLE ||
    opts.wield === WeaponWield.BLASTER_HEAVY
  );
  return {
    baseItemId: opts.baseItemId ?? (isRanged ? 15 : 3),
    baseItem: {
      criticalThreat: opts.critThreat ?? 1,
      criticalHitMultiplier: opts.critMult ?? 2,
    },
    getBaseItemId: () => opts.baseItemId ?? (isRanged ? 15 : 3),
    getWeaponWield: () => opts.wield,
    isRangedWeapon: () => isRanged,
    getAttackBonus: () => 0,
    getBaseDamage: () => opts.baseDamage ?? 6,
    getBaseDamageType: () => (isRanged ? DamageType.ENERGY : DamageType.SLASHING),
    hasDamageBonus: () => false,
    getDamageBonus: () => 0,
    getDamageBonusType: () => DamageType.BASE,
    getCriticalThreatRangeMin: () => 20 - (opts.critThreat ?? 1),
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
  GMNetworkManager.sendIntent = jest.fn() as any;
});

describe('Phase 4 talent registry & specialization tree integrity', () => {
  test('Commando and Peacekeeper trees cover all 5 node kinds and reference valid talents with symmetric links', () => {
    expect(CAREERS_TALENTS.length).toBeGreaterThanOrEqual(12);
    for (const spec of CAREERS_SPECIALIZATIONS) {
      expect(spec.nodes).toHaveLength(12);
      const kinds = new Set(spec.nodes.map((n) => n.kind));
      expect(kinds).toEqual(new Set(['feat', 'talent', 'career_skill', 'characteristic', 'capstone']));
      const byId = new Map(spec.nodes.map((n) => [n.id, n]));
      let combatHookNodes = 0;
      for (const n of spec.nodes) {
        for (const link of n.links) {
          expect(byId.get(link)?.links).toContain(n.id);
        }
        if (n.kind === 'talent') {
          expect(n.talentId).toBeTruthy();
          expect(CAREERS_TALENT_BY_ID.has(n.talentId!)).toBe(true);
          combatHookNodes++;
        } else if (n.kind === 'feat') {
          combatHookNodes++;
        }
      }
      expect(combatHookNodes).toBeGreaterThanOrEqual(5);
    }
  });

  test('talent requirements block Force-only talents for non-Force characters, and allow them for Force-sensitives', () => {
    const soldier = GMCareersCharacters.blank('human', 'soldier');
    soldier.name = 'Carth';
    soldier.specializations = ['commando', 'peacekeeper'];
    soldier.nodes = { commando: [], peacekeeper: ['r0c1', 'r1c1'] };
    // Force Rating (peacekeeper r2c1) requires Force sensitivity
    const blocked = CareersRules.canBuyNode(soldier, 'peacekeeper', 'r2c1');
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toMatch(/Force sensitivity/i);

    const miralukaSoldier = GMCareersCharacters.blank('miraluka', 'soldier');
    miralukaSoldier.name = 'Visas';
    miralukaSoldier.specializations = ['commando', 'peacekeeper'];
    miralukaSoldier.nodes = { commando: [], peacekeeper: ['r0c1', 'r1c1'] };
    expect(CareersRules.canBuyNode(miralukaSoldier, 'peacekeeper', 'r2c1').ok).toBe(true);
  });

  test('ranked talents stack across trees with no per-talent cap', () => {
    const c = GMCareersCharacters.blank('human', 'soldier');
    c.name = 'Veteran';
    const peacekeeper = CAREERS_SPECIALIZATIONS.find((s) => s.id === 'peacekeeper')!;
    const savedNode = peacekeeper.nodes[4];
    // Temporarily mirror toughened onto peacekeeper r1c1 to verify cross-tree stacking
    (peacekeeper.nodes as any)[4] = { ...savedNode, kind: 'talent', talentId: 'toughened' };
    try {
      c.specializations = ['commando', 'peacekeeper'];
      c.nodes = { commando: ['r0c1'], peacekeeper: ['r0c1', 'r1c1'] };
      const d = CareersRules.derive(c);
      expect(d.talentRanks.toughened).toBe(2);
      // hpBase 10 + lv1 * 6 + 2 ranks * 4 = 24
      expect(d.maxHp).toBe(24);
    } finally {
      (peacekeeper.nodes as any)[4] = savedNode;
    }
  });
});

describe('Phase 4 tree node kinds: career_skill, characteristic (Dedication), and capstone', () => {
  test('career_skill adds the skill to careerSkills without invalidating creation freeSpeciesSkills', () => {
    const c = GMCareersCharacters.blank('human', 'soldier');
    c.name = 'Scout';
    // Awareness is NOT a Soldier/Commando career skill at creation -> valid Human freeSpeciesSkills pick
    c.freeSpeciesSkills = ['awareness', 'charm'];
    expect(CareersRules.careerSkillsOf(c).has('awareness')).toBe(false);
    expect(CareersRules.canBuySkillRank(c, 'awareness', false).cost).toBe(15); // non-career rank 2: 5*2 + 5

    // Buying Commando r0c2 -> r1c2 -> r2c2 (Tactical Edge: Awareness becomes a career skill)
    c.nodes.commando = ['r0c2', 'r1c2', 'r2c2'];
    expect(CareersRules.careerSkillsOf(c).has('awareness')).toBe(true);
    expect(CareersRules.canBuySkillRank(c, 'awareness', false).cost).toBe(10); // career rank 2: 5*2
    expect(CareersRules.validate(c)).toEqual([]);
  });

  test('Dedication (characteristic node) raises a chosen stat up to 6, parses safely, syncs live, and undoes cleanly', () => {
    const c = GMCareersCharacters.blank('human', 'soldier');
    c.name = 'Canderous';
    c.characteristics.str = 5; // 30+40+50 = 120 > 110? Let's use str=4 (70 XP) + campaign XP
    c.characteristics.str = 4; // 70 starting XP used, 40 left
    CareersAdvancement.awardXp(c, 150, 'Campaign');
    c.nodes.commando = ['r0c1', 'r1c1', 'r2c1']; // 5 + 10 + 15 = 30 starting XP used (10 starting left)

    // parsePurchase whitelists valid abilities and rejects junk
    expect(CareersAdvancement.parsePurchase({ kind: 'node', specId: 'commando', nodeId: 'r3c1', ability: 'str', extra: 1 }))
      .toEqual({ kind: 'node', specId: 'commando', nodeId: 'r3c1', ability: 'str' });
    expect(CareersAdvancement.parsePurchase({ kind: 'node', specId: 'commando', nodeId: 'r3c1', ability: 'luck' }))
      .toBeNull();

    // Missing ability on Dedication is refused
    expect(CareersAdvancement.applyPurchase(c, { kind: 'node', specId: 'commando', nodeId: 'r3c1' }).ok).toBe(false);

    // Valid Dedication purchase raises STR from 4 -> 5 (KotOR 16, mod +3) for 20 XP only (no double-charge!)
    const res = CareersAdvancement.applyPurchase(c, { kind: 'node', specId: 'commando', nodeId: 'r3c1', ability: 'str' });
    expect(res.ok).toBe(true);
    expect(res.record?.cost).toBe(20);
    expect(c.nodeChoices?.['commando:r3c1']).toBe('str');

    const d = CareersRules.derive(c);
    expect(d.effectiveCharacteristics.str).toBe(5);
    expect(d.kotorAttributes.str).toBe(16);
    expect(d.modifiers.str).toBe(3);
    // Total purchase cost: 70 (str 4) + 30 (3 nodes) + 20 (dedication) = 120 (not double-charged for str 5!)
    expect(d.totalPurchaseCost).toBe(120);
    expect(CareersRules.validate(c, false)).toEqual([]);

    // Sync to creature updates STR live
    const cre = makeCreature();
    CareersAdvancement.syncToCreature(cre, c);
    expect(cre.str).toBe(16);

    // Undo removes node and nodeChoice cleanly
    CareersAdvancement.undoLastPurchase(c);
    expect(c.nodeChoices?.['commando:r3c1']).toBeUndefined();
    expect(CareersRules.derive(c).effectiveCharacteristics.str).toBe(4);
  });

  test('capstone node unlocks rank 6 for Ranged (Heavy) at level 17+', () => {
    const c = GMCareersCharacters.blank('human', 'soldier');
    c.name = 'Heavy';
    c.campaignXpEarned = 900;
    c.campaignXpSpent = 800; // level 17
    c.boughtSkillRanks = { ranged_heavy: 5 };
    expect(CareersRules.canBuySkillRank(c, 'ranged_heavy', false).ok).toBe(false);

    // Unlock Commando r3c2 (Heavy Weapons Mastery capstone)
    c.nodes.commando = ['r0c2', 'r1c2', 'r2c2', 'r3c2'];
    expect(CareersRules.hasCapstone(c, 'ranged_heavy')).toBe(true);
    const check = CareersRules.canBuySkillRank(c, 'ranged_heavy', false);
    expect(check.ok).toBe(true);
    expect(check.nextRank).toBe(6);
  });
});

describe('Phase 4 engine hooks (classic pinned vs Careers talents)', () => {
  test('classic creature without careersRules is completely unaffected by every Phase 4 hook', () => {
    const classic = makeCreature({ str: 14, dex: 12, wis: 14, cha: 12 });
    const sword = makeWeapon({ wield: WeaponWield.ONE_HANDED_SWORD, baseDamage: 8 });
    const round = new CombatRound(classic);

    expect(classic.getTalentAttackBonus(sword)).toBe(0);
    expect(classic.getTalentCritThreatBonus(sword)).toBe(0);
    expect(classic.getTalentDamageBonus({ weapon: sword, isCritical: true })).toBe(0);
    expect(classic.getDefenseBonusVs(true)).toBe(0);
    expect(classic.getTalentDamageReduction()).toBe(0);
    expect(classic.getTalentSkillBonus(SkillType.AWARENESS)).toBe(0);
    expect(classic.getSpellSaveDCBonus()).toBe(0);
    expect(classic.getSpellCostReduction()).toBe(0);
    expect(classic.getSpellDamageBonus()).toBe(0);

    // Classic critical threat (1 -> only 20)
    expect(round.isCritical(19, sword, undefined, classic)).toBe(false);
    expect(round.isCritical(20, sword, undefined, classic)).toBe(true);

    // Classic damage: weapon(8) + strMod(2) = 10
    const atk = new CombatAttackData();
    atk.attackWeapon = sword;
    atk.calculateDamage(classic, false);
    expect(atk.getTotalDamage()).toBe(10);

    // Classic spell DC: 5 + lv1 + wisMod(2) + chaMod(1) = 9
    expect(classic.getSpellSaveDC()).toBe(9);
  });

  test('passive damage, crit threat, crit damage, ranged defence, DR, and Force power hooks apply through ModuleCreature seams', () => {
    const c = GMCareersCharacters.blank('human', 'soldier');
    c.name = 'Commando';
    // Toughened (r0c1), Feral Strength (r1c0), Point Blank (r1c2), Enduring (r2c1), Lethal Blows (r3c0)
    c.nodes.commando = ['r0c0', 'r1c0', 'r2c0', 'r3c0', 'r0c1', 'r1c1', 'r2c1', 'r0c2', 'r1c2'];

    const cre = makeCreature({ str: 10, dex: 10 });
    cre.careersRules = new CareersRuntime(c, cre);
    const round = new CombatRound(cre);

    const sword = makeWeapon({ wield: WeaponWield.ONE_HANDED_SWORD, baseDamage: 6 });
    const rifle = makeWeapon({ wield: WeaponWield.BLASTER_RIFLE, baseDamage: 6 });

    // Feral Strength (+2 melee only)
    const meleeAtk = new CombatAttackData();
    meleeAtk.attackWeapon = sword;
    meleeAtk.calculateDamage(cre, false);
    expect(meleeAtk.getTotalDamage()).toBe(8); // 6 + 2

    // Point Blank (+2 ranged only)
    const rangedAtk = new CombatAttackData();
    rangedAtk.attackWeapon = rifle;
    rangedAtk.calculateDamage(cre, false);
    expect(rangedAtk.getTotalDamage()).toBe(8); // 6 + 2

    // Lethal Blows (+1 crit threat -> 19-20, +4 crit damage)
    expect(round.isCritical(19, sword, undefined, cre)).toBe(true);
    expect(round.isCritical(18, sword, undefined, cre)).toBe(false);
    const critAtk = new CombatAttackData();
    critAtk.attackWeapon = sword;
    critAtk.calculateDamage(cre, true);
    expect(critAtk.getTotalDamage()).toBe(18); // 6*2 + 2 (feral) + 4 (lethal blows)

    // Enduring (-2 incoming damage, min 1)
    const dmgEff = new EffectDamage();
    dmgEff.object = cre;
    dmgEff.setInt(DamageType.ENERGY, 10);
    expect(dmgEff.calculateEffectiveDamage()).toBe(8);
    dmgEff.setInt(DamageType.ENERGY, 2);
    expect(dmgEff.calculateEffectiveDamage()).toBe(1);

    // Peacekeeper: Sidestep (+1 AC, +1 extra vs ranged) and Force Rating (+6 FP, +2 Spell DC, -1 FP cost)
    const jediSheet = GMCareersCharacters.blank('human', 'jedi_guardian');
    jediSheet.name = 'Sentinel';
    jediSheet.nodes.peacekeeper = ['r0c1', 'r1c1', 'r2c1', 'r0c2', 'r1c2'];
    const jedi = makeCreature({ dex: 10, wis: 10, cha: 10 });
    jedi.careersRules = new CareersRuntime(jediSheet, jedi);

    expect(jedi.getAC()).toBe(11); // 10 + sidestep(1)
    expect(jedi.getDefenseBonusVs(true)).toBe(1);
    expect(jedi.getDefenseBonusVs(false)).toBe(0);
    // Spell Save DC: 5 + lv1 + wis(0) + cha(0) + force_rating(2) = 8
    expect(jedi.getSpellSaveDC()).toBe(8);
    // Spell FP cost reduced by 1 (min 1)
    const spell = new TalentSpell(27);
    spell.userType = 1;
    spell.forcepoints = 10;
    expect(spell.getForcePointCost(jedi)).toBe(9);
  });

  test('skill check bonus talents flow into ModuleCreature.getSkillLevel and GMChecks.checkBonus', () => {
    const peacekeeper = CAREERS_SPECIALIZATIONS.find((s) => s.id === 'peacekeeper')!;
    const saved = peacekeeper.nodes[5];
    // Temporarily put keen_eye (+3 Awareness & Survival) on peacekeeper r1c2
    (peacekeeper.nodes as any)[5] = { ...saved, kind: 'talent', talentId: 'keen_eye' };
    try {
      const sheet = GMCareersCharacters.blank('human', 'jedi_guardian');
      sheet.characteristics.wis = 3; // KotOR 12 -> WIS mod +1
      sheet.nodes.peacekeeper = ['r0c2', 'r1c2'];
      const cre = makeCreature();
      CareersAdvancement.syncToCreature(cre, sheet);

      expect(cre.getSkillLevel(SkillType.AWARENESS)).toBe(4); // rank 0 + wis(1) + keen_eye(3)
      expect(GMChecks.checkBonus(cre, { kind: 'skill', skill: SkillType.AWARENESS })).toBe(4);
      expect((cre.careersRules as CareersRuntime).getNarrativeSkillBonus('survival')).toBe(3);
    } finally {
      (peacekeeper.nodes as any)[5] = saved;
    }
  });
});

describe('Phase 4 combat lifecycle hooks & active talents (HUD, host intent, network sync)', () => {
  test('Calm Center triggers on round start and combat end; Relentless triggers on kill and consumes next-attack buff', () => {
    const sheet = GMCareersCharacters.blank('human', 'jedi_guardian');
    sheet.name = 'Guardian';
    sheet.nodes.peacekeeper = ['r0c0', 'r1c0', 'r2c0', 'r3c0']; // Flurry, Battle Focus, Relentless, Calm Center
    const cre = makeCreature({ currentHitPoints: 20, maxHitPoints: 40 });
    const rt = new CareersRuntime(sheet, cre);
    cre.careersRules = rt;
    const round = new CombatRound(cre);

    // Calm Center onRoundStart recovers 1 Strain when combat round begins
    rt.spendStrain(5);
    round.beginCombatRound();
    expect(rt.strain).toBe(4);

    // Calm Center onCombatEnd heals 4 Vitality when combat transitions true -> false
    rt.tick(0.1, true);
    rt.tick(0.1, false);
    expect(cre.currentHitPoints).toBe(24);

    // Relentless onKill recovers 2 Strain and grants +2 next attack bonus, consumed on next attack
    cre.onAttackResolved(true, false, true);
    expect(rt.strain).toBe(2);
    expect(cre.getTalentAttackBonus()).toBe(2);
    cre.onAttackResolved(false, false, false);
    expect(cre.getTalentAttackBonus()).toBe(0);
  });

  test('active talents: Second Wind, Battle Focus, Parry Stance, and Inspiring Command', () => {
    const commandoSheet = GMCareersCharacters.blank('human', 'soldier');
    commandoSheet.name = 'Trooper';
    commandoSheet.nodes.commando = ['r0c0', 'r1c0', 'r2c0']; // Second Wind
    const trooper = makeCreature({ gmNetId: 'pc_trooper', currentHitPoints: 10, maxHitPoints: 30 });
    const trooperRt = new CareersRuntime(commandoSheet, trooper);
    trooper.careersRules = trooperRt;

    // HUD exposes Second Wind with Strain cost and heal category
    const hud = GMPlayerHud.abilities(trooper);
    const sw = hud.find((a) => a.key === 'talent:second_wind');
    expect(sw).toMatchObject({ kind: 'talent', strainCost: 2, aim: 'self', category: 'heal', usable: true });

    // Activate Second Wind: spends 2 Strain, heals 8 HP, goes on 9s cooldown
    const res = trooperRt.activateTalent('second_wind');
    expect(res.ok).toBe(true);
    expect(trooperRt.strain).toBe(2);
    expect(trooper.currentHitPoints).toBe(18);
    expect(trooperRt.activateTalent('second_wind').ok).toBe(false); // on cooldown
    expect(GMPlayerHud.abilities(trooper).find((a) => a.key === 'talent:second_wind')?.usable).toBe(false);

    // Cooldown expires after 9s
    trooperRt.tick(9, true);
    expect(GMPlayerHud.abilities(trooper).find((a) => a.key === 'talent:second_wind')?.usable).toBe(true);

    // Winded blocks activation
    trooperRt.spendStrain(20);
    expect(trooperRt.isWinded()).toBe(true);
    expect(trooperRt.activateTalent('second_wind').ok).toBe(false);

    // Battle Focus & Parry Stance on Jedi Guardian
    const jediSheet = GMCareersCharacters.blank('human', 'jedi_guardian');
    jediSheet.nodes.peacekeeper = ['r0c0', 'r1c0', 'r1c1']; // Battle Focus + Parry Stance
    const jedi = makeCreature({ gmNetId: 'pc_jedi', str: 10, dex: 10 });
    const jediRt = new CareersRuntime(jediSheet, jedi);
    jedi.careersRules = jediRt;
    const saber = makeWeapon({ wield: WeaponWield.ONE_HANDED_SWORD, baseItemId: 8, baseDamage: 6 });

    expect(jediRt.activateTalent('battle_focus').ok).toBe(true);
    expect(jedi.getTalentAttackBonus(saber)).toBe(2);
    expect(jedi.getTalentDamageBonus({ weapon: saber })).toBe(4);
    expect(jedi.getTalentCritThreatBonus(saber)).toBe(1);
    expect(GMPlayerHud.activeEffects(jedi).some((e) => e.label === 'Battle Focus')).toBe(true);

    // CombatRound.calculateWeaponAttack uses Battle Focus and consumes it after the single swing
    const target = makeCreature({ gmNetId: 'npc_1', currentHitPoints: 50, maxHitPoints: 50 });
    const round = new CombatRound(jedi);
    const action = new CombatRoundAction();
    action.target = target;
    const rollSpy = jest.spyOn(Dice, 'roll').mockReturnValue(19);
    try {
      round.calculateWeaponAttack(jedi, saber, ModuleCreatureArmorSlot.RIGHTHAND, action);
    } finally {
      rollSpy.mockRestore();
    }
    expect(action.attackResult).toBe(AttackResult.CRITICAL_HIT); // 19 became crit via +1 threat from Battle Focus
    expect(jedi.getTalentAttackBonus(saber)).toBe(0); // consumed!

    // Parry Stance grants +2 Defence and +3 DR for 3s, then expires
    expect(jediRt.activateTalent('parry_stance').ok).toBe(true);
    expect(jedi.getAC()).toBe(12);
    expect(jedi.getTalentDamageReduction()).toBe(3);
    jediRt.tick(3, true);
    expect(jedi.getAC()).toBe(10);
    expect(jedi.getTalentDamageReduction()).toBe(0);

    // Inspiring Command buffs a classic ally via standard KotOR effects
    const peacekeeper = CAREERS_SPECIALIZATIONS.find((s) => s.id === 'peacekeeper')!;
    const saved = peacekeeper.nodes[5];
    (peacekeeper.nodes as any)[5] = { ...saved, kind: 'talent', talentId: 'inspiring_command' };
    try {
      jediSheet.nodes.peacekeeper.push('r1c2');
      jediRt.refresh(jediSheet);
      const classicAlly = makeCreature({ gmNetId: 'ally_1' });
      expect(jediRt.activateTalent('inspiring_command', classicAlly).ok).toBe(true);
      expect(classicAlly.effects.some((e: any) => e.type === GameEffectType.EffectAttackIncrease)).toBe(true);
      expect(classicAlly.effects.some((e: any) => e.type === GameEffectType.EffectACIncrease)).toBe(true);
    } finally {
      (peacekeeper.nodes as any)[5] = saved;
    }
  });

  test('host handles ability=talent intent without interrupting queued actions, rejects invalid ids, and syncs buffs/cooldowns', async () => {
    const sheet = GMCareersCharacters.blank('human', 'jedi_guardian');
    sheet.name = 'Bastila';
    sheet.nodes.peacekeeper = ['r0c1', 'r1c1']; // Parry Stance
    const actor = makeCreature({ gmNetId: 'pc_b', firstName: 'Bastila', gmOwnerPeerId: 'peer_1' });
    const rt = new CareersRuntime(sheet, actor);
    actor.careersRules = rt;
    GMManager.netIdMap.set('pc_b', actor);
    GMNetworkManager.peers.set('peer_1', { peerId: 'peer_1', name: 'Alice', role: 'client', controlledNetId: 'pc_b', joinedAt: 1 });

    // Valid talent activation via host intent does NOT call clearAllActions
    GMPlayers.applyClientIntentOnHost('peer_1', {
      netId: 'pc_b', kind: 'ability', seq: 1, ability: 'talent', talentId: 'parry_stance',
    });
    await Promise.resolve();
    expect(actor.clearAllActions).not.toHaveBeenCalled();
    expect(rt.strain).toBe(2);
    expect(actor.getAC()).toBe(12);

    // Unowned / bogus talent id is rejected cleanly
    expect(await GMPlayers.useAbilityOnHost(actor, {
      netId: 'pc_b', kind: 'ability', seq: 2, ability: 'talent', talentId: 'god_mode',
    })).toBe(false);

    // Sheet sync replicates activeBuffs & cooldowns to client replica, then clears them when expired
    const sheetActive = GMPlayers.buildPlayerSheet(actor);
    expect(sheetActive.careers?.activeBuffs).toEqual([{ label: 'Parry Stance', secondsLeft: 3 }]);
    expect(sheetActive.careers?.cooldowns).toEqual({ parry_stance: 3 });

    const replica = makeCreature({ gmNetId: 'pc_b' });
    await GMPlayers.applySheetToCharacter(replica, sheetActive);
    expect(GMPlayerHud.activeEffects(replica)).toEqual([{ label: 'Parry Stance', secondsLeft: 3 }]);
    expect(GMPlayerHud.abilities(replica).find((a) => a.key === 'talent:parry_stance')?.usable).toBe(false);

    // Expire on host and resync -> client clears buffs & cooldowns
    rt.tick(3, true);
    const sheetExpired = GMPlayers.buildPlayerSheet(actor);
    expect(sheetExpired.careers?.activeBuffs).toBeUndefined();
    expect(sheetExpired.careers?.cooldowns).toBeUndefined();
    await GMPlayers.applySheetToCharacter(replica, sheetExpired);
    expect(GMPlayerHud.activeEffects(replica)).toEqual([]);
    expect(GMPlayerHud.abilities(replica).find((a) => a.key === 'talent:parry_stance')?.usable).toBe(true);
  });
});

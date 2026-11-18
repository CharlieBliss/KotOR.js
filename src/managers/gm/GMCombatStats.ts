import type { ModuleCreature } from "@/module/ModuleCreature";
import type { ModuleItem } from "@/module/ModuleItem";
import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";
import { WeaponWield } from "@/enums/combat/WeaponWield";
import { GMCombatAI } from "@/managers/gm/GMCombatAI";

/** One attack a creature makes each round */
export interface GMAttackProfile {
  ranged: boolean;
  /** Attack bonus, all in */
  bonus: number;
  /** What's in it besides the base attack bonus and the ability modifier: the weapon's, feats', two-weapon penalties */
  bonusExtra: number;
  /** The ability the attack uses: 'str' or 'dex' */
  ability: 'str' | 'dex';
  /** Average damage per hit, all in */
  damage: number;
  /** What's in it besides Strength: the weapon's dice and bonuses (a claw's monster damage) */
  damageExtra: number;
  /** How much of Strength's modifier the damage gets: 1, 0.5 (off hand), 1.5 (two-handed), 0 (ranged, claws) */
  strFactor: number;
}

/** What a creature brings to a fight: how hard it hits, how hard it is to hit, and what else it can do */
export interface GMCombatProfile {
  level: number;
  /** classes.2da row of its first class */
  classId: number;
  hp: number;
  fp: number;
  ac: number;
  str: number;
  dex: number;
  con: number;
  wis: number;
  attacks: GMAttackProfile[];
  /** Hostile powers (spells.2da labels) with their Force point cost, and whether they hit an area */
  harms: { label: string; cost: number; area: boolean }[];
  /** Healing powers and items */
  heals: number;
  /** Grenades carried (spells.2da labels of what they cast) */
  grenades: string[];
  /** Combat feats it can attack with (Power Attack, Flurry, Rapid Shot...) */
  combatFeats: number;
}

const mod = (score: number) => Math.floor((score - 10) / 2);
const avg = (roll: () => number, samples = 200) => {
  let total = 0;
  for (let i = 0; i < samples; i++) total += Number(roll()) || 0;
  return total / samples;
};

/**
 * GMCombatStats class.
 *
 * Measures a creature for a fight with the engine's own rules: the attacks the combat round makes for it
 * (each hand, claws for simple creatures, unarmed otherwise), their attack bonus and average damage, its AC,
 * vitality, Force points and the powers and items GMCombatAI would use. Works on a creature loaded from a
 * template without being placed (the scene catalog), and on one in the world (the scene check).
 */
export class GMCombatStats {

  static profile(cre: ModuleCreature): GMCombatProfile {
    const kit = GMCombatAI.kitOf(cre);
    const classes = (cre.classes || []) as any[];
    return {
      level: Number(cre.getTotalClassLevel?.()) || 1,
      classId: Number(classes[0]?.id ?? 0),
      hp: Number(cre.getMaxHP?.()) || 0,
      fp: Number(cre.getMaxFP?.()) || 0,
      ac: Number(cre.getAC?.()) || 10,
      str: Number(cre.getSTR?.()) || 10,
      dex: Number(cre.getDEX?.()) || 10,
      con: Number(cre.getCON?.()) || 10,
      wis: Number(cre.getWIS?.()) || 10,
      attacks: this.attacks(cre),
      harms: kit.harms.map((t) => ({ label: t.label, cost: t.cost, area: t.area })),
      heals: kit.heals.length,
      grenades: kit.grenades.map((t) => t.label),
      combatFeats: kit.meleeFeats.length + kit.rangedFeats.length,
    };
  }

  /** The attacks one combat round makes for it (CombatRound.calculateAttackResults) */
  static attacks(cre: ModuleCreature): GMAttackProfile[] {
    const eq: any = cre.equipment || {};
    const out: GMAttackProfile[] = [];
    if (cre.isSimpleCreature?.()) {
      const claws = [eq.CLAW1, eq.CLAW2, eq.CLAW3].filter(Boolean);
      if (!claws.length) {
        if (eq.RIGHTHAND) out.push(this.attack(cre, eq.RIGHTHAND, ModuleCreatureArmorSlot.RIGHTHAND));
        if (eq.LEFTHAND) out.push(this.attack(cre, eq.LEFTHAND, ModuleCreatureArmorSlot.LEFTHAND));
      }
      for (const claw of claws) out.push(this.attack(cre, claw, ModuleCreatureArmorSlot.CLAW1, true));
      return out;
    }
    if (!eq.RIGHTHAND && !eq.LEFTHAND) out.push(this.attack(cre, undefined, ModuleCreatureArmorSlot.RIGHTHAND));
    if (eq.RIGHTHAND) out.push(this.attack(cre, eq.RIGHTHAND, ModuleCreatureArmorSlot.RIGHTHAND));
    if (eq.LEFTHAND) out.push(this.attack(cre, eq.LEFTHAND, ModuleCreatureArmorSlot.LEFTHAND));
    else if (eq.RIGHTHAND && cre.combatRound?.isDoubleWeapon?.(eq.RIGHTHAND)) out.push(this.attack(cre, eq.RIGHTHAND, ModuleCreatureArmorSlot.LEFTHAND));
    return out;
  }

  static attack(cre: ModuleCreature, weapon: ModuleItem | undefined, slot: number, claw = false): GMAttackProfile {
    const round: any = cre.combatRound;
    const ranged = !!weapon?.isRangedWeapon?.();
    const abilityMod = Number(cre.getAttackAbilityModifier?.(weapon)) || 0;
    const ability: 'str' | 'dex' = ranged || (abilityMod === mod(cre.getDEX()) && abilityMod !== mod(cre.getSTR())) ? 'dex' : 'str';
    let bonus = Number(round?.calculateAttackBonus?.(cre, weapon)) || 0;
    const hand = slot === ModuleCreatureArmorSlot.LEFTHAND ? ModuleCreatureArmorSlot.LEFTHAND : ModuleCreatureArmorSlot.RIGHTHAND;
    if (!claw && round?.isDualWielding?.(cre)) bonus -= Number(round.calculateTwoWeaponPenalty?.(cre, hand)) || 0;
    const bab = Number(cre.getBaseAttackBonus?.()) || 0;

    let damageExtra = 0;
    let strFactor = 0;
    if (!weapon) {
      damageExtra = 2.5; // 1d4
      strFactor = 1;
    } else {
      const held = weapon === (cre.equipment as any)?.RIGHTHAND || weapon === (cre.equipment as any)?.LEFTHAND;
      const monster = cre.isSimpleCreature?.() && !held;
      damageExtra = avg(() => monster ? weapon.getMonsterDamage() : weapon.getBaseDamage());
      if (weapon.hasDamageBonus?.()) damageExtra += avg(() => weapon.getDamageBonus());
      if (!ranged) {
        if (slot === ModuleCreatureArmorSlot.LEFTHAND) strFactor = 0.5;
        else if (weapon.getWeaponWield?.() === WeaponWield.TWO_HANDED_SWORD && !(cre.equipment as any)?.LEFTHAND
          && ![3, 10, 56].includes(Number(weapon.baseItemId))) strFactor = 1.5;
        else strFactor = 1;
      }
    }
    // Strength adds to melee damage only when it's a bonus (CombatAttackData: an off hand gets half of it)
    const strMod = mod(cre.getSTR());
    const strDamage = strMod > 0 ? Math.floor(strMod * strFactor) : 0;
    return {
      ranged,
      bonus,
      bonusExtra: bonus - bab - abilityMod,
      ability,
      damage: Math.round((damageExtra + strDamage) * 10) / 10,
      damageExtra: Math.round(damageExtra * 10) / 10,
      strFactor,
    };
  }

  /** A compact line for the catalog: "m+5/9.5", r = ranged, d = uses Dexterity, h/x = half / one and a half Strength, c = no Strength */
  static attackCode(a: GMAttackProfile): string {
    const flags = `${a.ranged ? 'r' : 'm'}${a.ability === 'dex' && !a.ranged ? 'd' : ''}${a.strFactor === 0.5 ? 'h' : a.strFactor === 1.5 ? 'x' : (!a.ranged && a.strFactor === 0) ? 'c' : ''}`;
    return `${flags}${a.bonusExtra >= 0 ? '+' : ''}${a.bonusExtra}/${a.damageExtra}`;
  }
}

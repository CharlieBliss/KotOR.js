import { CombatAttackDamage } from "@/combat/CombatAttackDamage";
import type { ModuleCreature, ModuleItem, ModuleObject } from "@/module";
import { CExoLocString } from "@/resource/CExoLocString";
import { GFFStruct } from "@/resource/GFFStruct";
import { DamageType } from "@/enums/combat/DamageType";
import { EffectDamage, EffectSetState } from "@/effects";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { GameEffectSetStateType } from "@/enums/effects/GameEffectSetStateType";
import { AttackResult } from "@/enums/combat/AttackResult";
import { TalentFeat } from "@/talents";
import { CombatFeatType } from "@/enums/combat/CombatFeatType";
import { WeaponWield } from "@/enums/combat/WeaponWield";
import { Dice } from "@/utility/Dice";
import { DiceType } from "@/enums/combat/DiceType";
import { WeaponType } from "@/enums/combat/WeaponType";
import { BitWise } from "@/utility/BitWise";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";

/**
 * CombatAttackData class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file CombatAttackData.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class CombatAttackData {
  /**
   * The attack group for the attack
   */
  attackGroup: number = 0;

  /**
   * The animation length for the attack
   */
  animationLength: number = 1500;

  /**
   * The missed by object for the attack
   */
  missedBy: ModuleObject = undefined;

  /**
   * The attack result for the attack
   */
  attackResult: AttackResult = AttackResult.MISS;

  /**
   * The reaction object for the attack
   */
  reactObject: ModuleObject = undefined;

  /**
   * The reaction delay for the attack
   */
  reaxnDelay: number = 0;

  /**
   * The reaction animation for the attack
   */
  reaxnAnimation: number = 10001;

  /**
   * The reaction animation length for the attack
   */
  reaxnAnimLength: number = 0;

  /**
   * Whether the attack is concealed
   */
  concealment: boolean = false;

  /**
   * Whether the attack is a type attack
   */
  attackType: boolean = false;

  /**
   * The attack mode for the attack
   */
  attackMode: number = 0;

  /**
   * Whether the attack is a ranged attack
   */
  rangedAttack: boolean = false;

  /**
   * Whether the attack is a sneak attack
   */
  sneakAttack: boolean = false;

  /**
   * The weapon attack type for the attack
   */
  weaponAttackType: number = 0;

  /**
   * The ranged target X coordinate
   */
  rangedTargetX: number = 0;

  /**
   * The ranged target Y coordinate
   */
  rangedTargetY: number = 0;

  /**
   * The ranged target Z coordinate
   */
  rangedTargetZ: number = 0;

  /**
   * The damage list for the attack
   */
  damageList: CombatAttackDamage[] = new Array(16);

  /**
   * The killing blow for the attack
   */
  killingBlow: boolean = false;

  /**
   * The coup de grace for the attack
   */
  coupDeGrace: boolean = false;

  /**
   * The critical threat for the attack
   */
  criticalThreat: number = 0;

  /**
   * The attack deflected for the attack
   */
  attackDeflected: number = 0;

  /**
   * The ammo item that is being used for the attack
   */
  ammoItem: ModuleObject = undefined;

  /**
   * The debug text for the attack
   */
  attackDebugText: CExoLocString;

  /**
   * The debug text for the damage
   */
  DamageDebugText: CExoLocString;

  /**
   * The weapon that is being used for the attack
   */
  attackWeapon: ModuleItem;

  /**
   * Constructor for the CombatAttackData class
   */
  constructor(){
    this.damageList = new Array(16);
    for(let i = 0; i < 16; i++){
      this.damageList[i] = new CombatAttackDamage();
    }
  }

  /**
   * Highest Precise Shot rank (1..5) known by creature, per TSL `feat.2da`.
   */
  static GetPreciseShotRank(creature?: ModuleCreature): number {
    if(!creature?.getHasFeat) return 0;
    if(creature.getHasFeat(CombatFeatType.PRECISE_SHOT_V) || creature.getHasFeat(CombatFeatType.XXXPRECISE_SHOT_V)) return 5;
    if(creature.getHasFeat(CombatFeatType.PRECISE_SHOT_IV) || creature.getHasFeat(CombatFeatType.XXXPRECISE_SHOT_IV)) return 4;
    if(creature.getHasFeat(CombatFeatType.PRECISE_SHOT_III) || creature.getHasFeat(CombatFeatType.XXXPRECISE_SHOT_III)) return 3;
    if(creature.getHasFeat(CombatFeatType.PRECISE_SHOT_II) || creature.getHasFeat(CombatFeatType.XXXPRECISE_SHOT_II)) return 2;
    if(creature.getHasFeat(CombatFeatType.PRECISE_SHOT_I) || creature.getHasFeat(CombatFeatType.XXXPRECISE_SHOT_I)) return 1;
    return 0;
  }

  /**
   * Precise Shot I–V passive ranged damage bonus (+1 / +2 / +4 / +6 / +8).
   */
  static CalculatePreciseShotBonus(creature?: ModuleCreature): number {
    const table = [0, 1, 2, 4, 6, 8];
    return table[this.GetPreciseShotRank(creature)] || 0;
  }

  /**
   * Roll or resolve an NWScript DAMAGE_BONUS_* constant or flat bonus
   */
  static RollDamageBonusValue(bonusConst: number): number {
    if(bonusConst <= 0) return 0;
    switch(bonusConst){
      case 1: return 1;
      case 2: return 2;
      case 3: return 3;
      case 4: return 4;
      case 5: return 5;
      case 6: return Dice.roll(1, DiceType.d4);
      case 7: return Dice.roll(1, DiceType.d6);
      case 8: return Dice.roll(1, DiceType.d8);
      case 9: return Dice.roll(1, DiceType.d10);
      case 10: return Dice.roll(2, DiceType.d6);
      case 11: return Dice.roll(2, DiceType.d8);
      case 12: return Dice.roll(2, DiceType.d4);
      case 13: return Dice.roll(2, DiceType.d10);
      case 14: return Dice.roll(1, DiceType.d12);
      case 15: return Dice.roll(2, DiceType.d12);
      case 16: return 6;
      case 17: return 7;
      case 18: return 8;
      case 19: return 9;
      case 20: return 10;
      default: return bonusConst;
    }
  }

  /**
   * Calculate the Sneak Attack dice count (1..10) for the creature
   */
  calculateSneakAttackDice(creature: ModuleCreature): number {
    if(!creature) return 0;
    const sneakFeats = [
      { id: CombatFeatType.SNEAK_ATTACK_10D6, dice: 10 },
      { id: CombatFeatType.SNEAK_ATTACK_9D6, dice: 9 },
      { id: CombatFeatType.SNEAK_ATTACK_8D6, dice: 8 },
      { id: CombatFeatType.SNEAK_ATTACK_7D6, dice: 7 },
      { id: CombatFeatType.SNEAK_ATTACK_6D6, dice: 6 },
      { id: CombatFeatType.SNEAK_ATTACK_5D6, dice: 5 },
      { id: CombatFeatType.SNEAK_ATTACK_4D6, dice: 4 },
      { id: CombatFeatType.SNEAK_ATTACK_3D6, dice: 3 },
      { id: CombatFeatType.SNEAK_ATTACK_2D6, dice: 2 },
      { id: CombatFeatType.SNEAK_ATTACK_1D6, dice: 1 },
    ];
    for(const entry of sneakFeats){
      if(creature.getHasFeat(entry.id)){
        return entry.dice;
      }
    }
    return 0;
  }

  /**
   * Check whether the target is vulnerable to a Sneak Attack from creature
   */
  canSneakAttack(creature: ModuleCreature, target: ModuleObject): boolean {
    if(!creature || !target) return false;
    if(!BitWise.InstanceOfObject(target, ModuleObjectType.ModuleCreature)) return false;
    const targetCreature = target as ModuleCreature;
    if(this.sneakAttack) return true;
    // The first attack out of stealth
    if((creature as any).sneakAttackFromStealth){
      (creature as any).sneakAttackFromStealth = false;
      return true;
    }
    if(targetCreature.isDebilitated() || targetCreature.isStunned() || targetCreature.isParalyzed()){
      return true;
    }
    // Check flanking / attacking from behind when target is not focused on attacker
    if(targetCreature.combatData?.lastAttackTarget !== creature && targetCreature.position && creature.position){
      const dx = creature.position.x - targetCreature.position.x;
      const dy = creature.position.y - targetCreature.position.y;
      const distSq = dx * dx + dy * dy;
      // Ranged sneak attacks only work within 10 meters
      if(this.attackWeapon?.isRangedWeapon() && distSq > 100){
        return false;
      }
      const angleToAttacker = Math.atan2(dy, dx);
      const targetFacing = targetCreature.getFacing ? targetCreature.getFacing() : 0;
      let diff = Math.abs(angleToAttacker - targetFacing) % (Math.PI * 2);
      if(diff > Math.PI) diff = (Math.PI * 2) - diff;
      if(diff > Math.PI * 0.5){
        return true;
      }
    }
    return false;
  }

  /**
   * Calculate the damage for the combat attack data
   * @param creature - The creature to calculate the damage for
   * @param isCritial - Whether the attack is a critical hit
   * @param feat - The feat that is being used for the attack
   * @param isOffHand - Whether the attack is an off-hand attack
   */
  calculateDamage(creature: ModuleCreature, isCritial: boolean = false, feat?: TalentFeat, isOffHand: boolean = false){
    /**
     * Unarmed Strike
     */
    if(!this.attackWeapon){
      const damageMultiplier = isCritial ? 2.0 : 1.0;
      const strMod = Math.max(0, Math.floor((creature.getSTR() - 10) / 2));
      const nDamage = Dice.roll(1, DiceType.d4) + strMod;
      this.damageList[DamageType.BLUDGEONING].addDamage(nDamage * damageMultiplier);
      this.applyActiveFeatBonusDamage(creature, damageMultiplier, feat, DamageType.BLUDGEONING);
      this.applyEffectDamageModifiers(creature, DamageType.BLUDGEONING);
      this.applySneakAttackDamage(creature, DamageType.BLUDGEONING);
      this.applyTalentDamageModifiers(creature, isCritial, isOffHand, DamageType.BLUDGEONING);
      if(isCritial){
        this.applyCriticalFeatStun(creature, feat);
      }
      if(this.reactObject && this.getTotalDamage() >= this.reactObject.getHP()){
        this.killingBlow = true;
      }
      return;
    }

    const critMult = this.attackWeapon.baseItem?.criticalHitMultiplier || 2.0;
    const damageMultiplier = isCritial ? critMult : 1.0;
    const baseDamageType = this.attackWeapon.getBaseDamageType();

    // Creature weapons (claws, bites) use their monster damage; a held weapon its own, whoever holds it
    const heldWeapon = this.attackWeapon === creature.equipment?.RIGHTHAND || this.attackWeapon === creature.equipment?.LEFTHAND;
    if(!creature.isSimpleCreature() || heldWeapon){
      this.damageList[baseDamageType].addDamage(this.attackWeapon.getBaseDamage() * damageMultiplier);
      if(this.attackWeapon.hasDamageBonus()){
        this.damageList[this.attackWeapon.getDamageBonusType()].addDamage(this.attackWeapon.getDamageBonus() * damageMultiplier);
      }

      this.applyActiveFeatBonusDamage(creature, damageMultiplier, feat, DamageType.BASE);

      const specBonus = this.calculateWeaponSpecBonus(creature, this.attackWeapon);
      if(specBonus > 0){
        this.damageList[DamageType.BASE].addDamage(specBonus * damageMultiplier);
      }

      if(this.attackWeapon.isRangedWeapon()){
        const preciseBonus = CombatAttackData.CalculatePreciseShotBonus(creature);
        if(preciseBonus > 0){
          this.damageList[baseDamageType].addDamage(preciseBonus);
        }
      }
    }else{
      this.damageList[baseDamageType].addDamage(this.attackWeapon.getMonsterDamage() * damageMultiplier);
      if(this.attackWeapon.hasDamageBonus()){
        this.damageList[this.attackWeapon.getDamageBonusType()].addDamage(this.attackWeapon.getDamageBonus() * damageMultiplier);
      }
    }

    // Add Strength modifier to melee weapon damage
    const isRanged = this.attackWeapon.isRangedWeapon();
    if(!isRanged){
      const rawStrMod = Math.floor((creature.getSTR() - 10) / 2);
      let strDamage = rawStrMod;
      if(rawStrMod > 0){
        if(isOffHand){
          strDamage = Math.floor(rawStrMod * 0.5);
        }else if(
          this.attackWeapon.getWeaponWield() === WeaponWield.TWO_HANDED_SWORD &&
          !creature.equipment?.LEFTHAND &&
          this.attackWeapon.baseItemId !== 3 &&
          this.attackWeapon.baseItemId !== 10 &&
          this.attackWeapon.baseItemId !== 56
        ){
          strDamage = Math.floor(rawStrMod * 1.5);
        }
      }
      if(strDamage > 0){
        this.damageList[DamageType.PHYSICAL].addDamage(strDamage * damageMultiplier);
      }
    }

    this.applyEffectDamageModifiers(creature, baseDamageType);
    this.applySneakAttackDamage(creature, baseDamageType);
    this.applyTalentDamageModifiers(creature, isCritial, isOffHand, baseDamageType);

    if(isCritial){
      this.applyCriticalFeatStun(creature, feat);
    }

    if(this.reactObject && this.getTotalDamage() >= this.reactObject.getHP()){
      this.killingBlow = true;
    }
  }

  /**
   * Apply Power Attack / Power Blast bonus damage only when the feat is actively used
   */
  applyActiveFeatBonusDamage(creature: ModuleCreature, damageMultiplier: number, feat?: TalentFeat, damageSlot: number = DamageType.BASE){
    if(!feat) return;
    switch(feat.id){
      case CombatFeatType.POWER_ATTACK:
      case CombatFeatType.POWER_BLAST:
        if(creature.getHasFeat(CombatFeatType.MASTER_POWER_ATTACK) || creature.getHasFeat(CombatFeatType.MASTER_POWER_BLAST)){
          this.damageList[damageSlot].addDamage(10 * damageMultiplier);
        }else if(creature.getHasFeat(CombatFeatType.IMPROVED_POWER_ATTACK) || creature.getHasFeat(CombatFeatType.IMPROVED_POWER_BLAST)){
          this.damageList[damageSlot].addDamage(8 * damageMultiplier);
        }else{
          this.damageList[damageSlot].addDamage(5 * damageMultiplier);
        }
      break;
      case CombatFeatType.IMPROVED_POWER_ATTACK:
      case CombatFeatType.IMPROVED_POWER_BLAST:
        this.damageList[damageSlot].addDamage(8 * damageMultiplier);
      break;
      case CombatFeatType.MASTER_POWER_ATTACK:
      case CombatFeatType.MASTER_POWER_BLAST:
        this.damageList[damageSlot].addDamage(10 * damageMultiplier);
      break;
    }
  }

  /**
   * Apply active EffectDamageIncrease and EffectDamageDecrease effects from the attacker
   */
  applyEffectDamageModifiers(creature: ModuleCreature, defaultDamageType: number = DamageType.BASE){
    if(!creature || !Array.isArray(creature.effects)) return;
    for(const eff of creature.effects){
      if(!eff) continue;
      if(eff.type === GameEffectType.EffectDamageIncrease){
        const bonusVal = CombatAttackData.RollDamageBonusValue(eff.getInt(0));
        const dmgFlag = eff.getInt(1);
        const slot = dmgFlag > 0 ? (Math.log2(dmgFlag) & 0x0F) : defaultDamageType;
        if(bonusVal > 0 && this.damageList[slot]){
          this.damageList[slot].addDamage(bonusVal);
        }
      }else if(eff.type === GameEffectType.EffectDamageDecrease){
        const penaltyVal = CombatAttackData.RollDamageBonusValue(eff.getInt(0));
        if(penaltyVal > 0){
          let remaining = penaltyVal;
          for(let i = 0; i < this.damageList.length && remaining > 0; i++){
            const current = this.damageList[i].damageValue;
            if(current > 0){
              const deduct = Math.min(current, remaining);
              this.damageList[i].damageValue -= deduct;
              remaining -= deduct;
            }
          }
        }
      }
    }
  }

  /**
   * Apply Careers talent damage hooks (passive, critical damage, and active talent buffs); no-op for classic creatures
   */
  applyTalentDamageModifiers(creature: ModuleCreature, isCritical: boolean, isOffHand: boolean, damageSlot: number = DamageType.BASE){
    const bonus = creature.getTalentDamageBonus({ weapon: this.attackWeapon, isCritical, isOffHand });
    if(bonus > 0 && this.damageList[damageSlot]){
      this.damageList[damageSlot].addDamage(bonus);
    }
  }

  /**
   * Apply Sneak Attack bonus damage (not multiplied by critical hits)
   */
  applySneakAttackDamage(creature: ModuleCreature, damageSlot: number = DamageType.BASE){
    const sneakDice = this.calculateSneakAttackDice(creature);
    if(sneakDice > 0 && this.canSneakAttack(creature, this.reactObject)){
      this.sneakAttack = true;
      const sneakDamage = Dice.roll(sneakDice, DiceType.d6);
      this.damageList[damageSlot].addDamage(sneakDamage);
    }
  }

  /**
   * Apply Critical Strike / Sniper Shot stun on critical hit if target fails save
   */
  applyCriticalFeatStun(creature: ModuleCreature, feat?: TalentFeat){
    if(!feat || !this.reactObject) return;
    if(!BitWise.InstanceOfObject(this.reactObject, ModuleObjectType.ModuleCreature)) return;
    const targetCreature = this.reactObject as ModuleCreature;

    const isCriticalStrike = (
      feat.id === CombatFeatType.CRITICAL_STRIKE ||
      feat.id === CombatFeatType.IMPROVED_CRITICAL_STRIKE ||
      feat.id === CombatFeatType.MASTER_CRITICAL_STRIKE
    );
    const isSniperShot = (
      feat.id === CombatFeatType.SNIPER_SHOT ||
      feat.id === CombatFeatType.IMPROVED_SNIPER_SHOT ||
      feat.id === CombatFeatType.MASTER_SNIPER_SHOT
    );

    if(!isCriticalStrike && !isSniperShot) return;

    const levelHalf = Math.floor(creature.getTotalClassLevel() / 2);
    const abilMod = isCriticalStrike
      ? Math.floor((creature.getSTR() - 10) / 2)
      : Math.floor((creature.getINT() - 10) / 2);
    const dc = 10 + levelHalf + abilMod;

    const saved = targetCreature.fortitudeSave(dc, 0, creature);
    if(!saved){
      const stunEffect = new EffectSetState();
      stunEffect.setCreator(creature);
      stunEffect.setInt(0, GameEffectSetStateType.CUT_SCENE_STUNNED);
      stunEffect.setDurationType(GameEffectDurationType.TEMPORARY);
      stunEffect.setDuration(3.0);
      stunEffect.initialize();
      targetCreature.addEffect(stunEffect, GameEffectDurationType.TEMPORARY, 3.0);
    }
  }

  /**
   * Calculate the weapon specialization bonus
   * @param creature - The creature to calculate the weapon specialization bonus for
   * @param weapon - The weapon to calculate the weapon specialization bonus for
   * @returns The weapon specialization bonus
   */
  calculateWeaponSpecBonus(creature: ModuleCreature, weapon: ModuleItem): number {
    let bonus = 0;
    if(!creature || !weapon){ return 0; }
    
    switch(weapon.getWeaponWield()){
      case WeaponWield.BLASTER_PISTOL:
        if(creature.getHasFeat(CombatFeatType.WEAPON_SPEC_BLASTER)){
          bonus += 2;
        }
      break;
      case WeaponWield.BLASTER_RIFLE:
        if(creature.getHasFeat(CombatFeatType.WEAPON_SPEC_BLASTER_RIFLE)){
          bonus += 2;
        }
      break;
      case WeaponWield.BLASTER_HEAVY:
        if(creature.getHasFeat(CombatFeatType.WEAPON_SPEC_HEAVY_WEAPONS)){
          bonus += 2;
        }
      break;
      case WeaponWield.ONE_HANDED_SWORD:
      case WeaponWield.TWO_HANDED_SWORD:
      case WeaponWield.STUN_BATON:
        if(weapon.baseItemId == 8 || weapon.baseItemId == 9 || weapon.baseItemId == 10){
          if(creature.getHasFeat(CombatFeatType.WEAPON_SPEC_LIGHTSABER)){
            bonus += 2;
          }
        }else if(creature.getHasFeat(CombatFeatType.WEAPON_SPEC_MELEE_WEAPONS)){
          bonus += 2;
        }
      break;
    }
    return bonus;
  }

  /**
   * Apply the damage effect to the target creature
   * @param owner - The owner of the damage effect
   * @param target - The target creature to apply the damage effect to
   */
  applyDamageEffectToCreature(owner: ModuleCreature, target: ModuleCreature){
    if(!target) return;
    const damageEffect = new EffectDamage();
    damageEffect.setCreator(owner);

    for(let i = 0; i < 16; i++){
      const damage = this.damageList[i];
      damageEffect.setInt(i, damage ? damage.damageValue : 0);
    }

    const wasAlive = !target.isDead?.();
    target.addEffect(damageEffect, GameEffectDurationType.INSTANT);
    // A kill, after damage reduction and the like have had their say (killingBlow is only a prediction)
    if(wasAlive && target.isDead?.()) owner?.onKill?.();
  }

  /**
   * Get the total damage of the combat attack data
   * @returns The total damage
   */
  getTotalDamage(): number {
    let amount = 0;
    for(let i = 0; i < this.damageList.length; i++){
      const damage = this.damageList[i];
      if(damage && damage.damageValue > 0){
        amount += damage.damageValue;
      }
    }
    return amount;
  }

  /**
   * Reset the combat attack data
   */
  reset(){
    this.killingBlow = false;
    this.sneakAttack = false;
    this.reactObject = undefined;
    this.attackWeapon = undefined;
    this.attackResult = AttackResult.MISS;
    for(let i = 0; i < this.damageList.length; i++){
      this.damageList[i].reset();
    }
  }

  /**
   * Convert the combat attack data to a GFF struct
   * @param structIdx - The index of the struct
   * @returns The GFF struct
   */
  toStruct(structIdx: number = -1){
    const struct = new GFFStruct(structIdx);

    return struct;
  }

}

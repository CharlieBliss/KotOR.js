import { GameEffect } from "@/effects/GameEffect";
import { CombatFeatType } from "@/enums/combat/CombatFeatType";
import { DamageType } from "@/enums/combat/DamageType";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { TextSprite3DType } from "@/enums/engine/TextSprite3DType";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { TextSprite3D } from "@/engine/TextSprite3D";
import { BitWise } from "@/utility/BitWise";
import type { ModuleCreature } from "@/module/ModuleCreature";

/**
 * EffectDamage class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file EffectDamage.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class EffectDamage extends GameEffect {
  constructor(){
    super();
    this.type = GameEffectType.EffectDamage;
    
    this.setNumIntegers(21);
    this.intList.fill(-1, 0, 16);

    //intList[0] : -1 or Bludgeoning Damage Amount
    //intList[1] : -1 or Piercing Damage Amount
    //intList[2] : -1 or Slashing Damage Amount
    //intList[3] : -1 or Universal Damage Amount
    //intList[4] : -1 or Acid Damage Amount
    //intList[5] : -1 or Cold Damage Amount
    //intList[6] : -1 or Lightside Damage Amount
    //intList[7] : -1 or Electrical Damage Amount
    //intList[8] : -1 or Fire Damage Amount
    //intList[9] : -1 or Darkside Damage Amount
    //intList[10] : -1 or Sonic Damage Amount
    //intList[11] : -1 or Ion Damage Amount
    //intList[12] : -1 or Energy Damage Amount
    //intList[13] : -1 or Base Damage Amount
    //intList[14] : -1 or Physical Damage Amount
    //intList[15] : -1 or Extra Physical Damage Amount    
    //intList[16] : 1000
    //intList[17] : Damage Type
    //intList[18] : Damage Power

  }

  onApply(){
    if(this.applied)
      return;
      
    super.onApply();
    
    if(BitWise.InstanceOf(this.object?.objectType, ModuleObjectType.ModuleObject)){
      const damage = this.calculateEffectiveDamage();
      if(damage > 0){
        this.object.subtractHP(damage);
        if(BitWise.InstanceOf(this.object.objectType, ModuleObjectType.ModuleCreature)){
          (this.object as ModuleCreature).onDamageTaken?.(damage);
        }
      }
      if(!this.mirrored && this.getSpellId() >= 0){
        // None of it got through: "resisted", once, however many of the power's effects say so
        if(damage > 0) TextSprite3D.CreateOnObject(this.object, damage.toString(), TextSprite3DType.HOSTILE, 1500);
        else TextSprite3D.CreateOnObjectOnce(this.object, 'resisted', TextSprite3DType.NEUTRAL, 1500);
      }
      if(this.object.combatData){
        this.object.combatData.lastDamager = this.creator;
        this.object.combatData.lastAttacker = this.creator;
      }
    }
  }

  /**
   * Sums all raw positive damage components across indices 0..15.
   */
  getDamageAmount(): number {
    let total = 0;
    for(let i = 0; i < 16; i++){
      const val = this.getInt(i);
      if(val > 0){
        total += val;
      }
    }
    return Math.min(Math.max(total, 1), 10000);
  }

  /**
   * Computes effective damage after applying target's Damage Immunity,
   * Damage Resistance (including Force/Energy Shields), Damage Reduction,
   * and Toughness feats.
   */
  calculateEffectiveDamage(): number {
    if(!this.object){
      return this.getDamageAmount();
    }

    const effects = this.object.effects || [];
    let totalDamage = 0;
    let rawSum = 0;

    for(let i = 0; i < 16; i++){
      let dmg = this.getInt(i);
      if(dmg <= 0) continue;
      rawSum += dmg;

      // Map BASE (13) and PHYSICAL (14, 15) to physical bitmask (Bludgeoning|Piercing|Slashing = 7)
      const typeFlag = (i <= 12) ? (1 << i) : 7;

      // 1. Damage Immunity Increase / Decrease (percentage)
      if(i !== DamageType.UNIVERSAL){
        let immunityPercent = 0;
        for(let eIdx = 0; eIdx < effects.length; eIdx++){
          const eff = effects[eIdx];
          if(!eff) continue;
          if(eff.type === GameEffectType.EffectDamageImmunityIncrease){
            const mask = eff.getInt(0);
            if((mask & typeFlag) || mask === i){
              immunityPercent += (eff.getInt(1) || 0);
            }
          }else if(eff.type === GameEffectType.EffectDamageImmunityDecrease){
            const mask = eff.getInt(0);
            if((mask & typeFlag) || mask === i){
              immunityPercent -= (eff.getInt(1) || 0);
            }
          }
        }
        if(immunityPercent !== 0){
          immunityPercent = Math.max(-100, Math.min(100, immunityPercent));
          dmg = Math.max(0, Math.floor(dmg * (100 - immunityPercent) / 100));
        }
      }

      // 2. Damage Resistance (EffectDamageResistance / EffectForceShield)
      if(dmg > 0 && i !== DamageType.UNIVERSAL){
        for(let eIdx = effects.length - 1; eIdx >= 0; eIdx--){
          const eff = effects[eIdx];
          if(!eff || eff.type !== GameEffectType.EffectDamageResistance) continue;
          const mask = eff.getInt(0);
          if((mask & typeFlag) || mask === i){
            const resistAmount = eff.getInt(1) || 0;
            const limit = eff.getInt(2) || 0;
            const maxAbsorb = limit > 0 ? Math.min(resistAmount, limit) : resistAmount;
            if(maxAbsorb > 0){
              const absorbed = Math.min(dmg, maxAbsorb);
              dmg -= absorbed;
              if(limit > 0){
                const remaining = limit - absorbed;
                eff.setInt(2, remaining);
                if(remaining <= 0){
                  const spellId = eff.getSpellId();
                  this.object.removeEffect(eff);
                  if(spellId >= 0){
                    for(let j = this.object.effects.length - 1; j >= 0; j--){
                      const linked = this.object.effects[j];
                      if(linked && linked.getSpellId() === spellId){
                        this.object.removeEffect(linked);
                      }
                    }
                  }
                }
              }
              if(dmg <= 0) break;
            }
          }
        }
      }

      // 3. Damage Reduction (physical/base weapons)
      const isPhysical = (i === DamageType.BLUDGEONING || i === DamageType.PIERCING || i === DamageType.SLASHING || i >= DamageType.BASE);
      if(dmg > 0 && isPhysical){
        for(let eIdx = effects.length - 1; eIdx >= 0; eIdx--){
          const eff = effects[eIdx];
          if(!eff || eff.type !== GameEffectType.EffectDamageReduction) continue;
          const drAmount = eff.getInt(0) || 0;
          const drLimit = eff.getInt(2) || 0;
          const maxAbsorb = drLimit > 0 ? Math.min(drAmount, drLimit) : drAmount;
          if(maxAbsorb > 0){
            const absorbed = Math.min(dmg, maxAbsorb);
            dmg -= absorbed;
            if(drLimit > 0){
              const remaining = drLimit - absorbed;
              eff.setInt(2, remaining);
              if(remaining <= 0){
                this.object.removeEffect(eff);
              }
            }
            if(dmg <= 0) break;
          }
        }
      }

      totalDamage += Math.max(0, dmg);
    }

    if(rawSum <= 0){
      return 0;
    }

    // Spell damage bonus from Careers talents / Force power upgrades (0 for classic creatures)
    if(this.getSpellId() >= 0 && this.creator && BitWise.InstanceOf(this.creator.objectType, ModuleObjectType.ModuleCreature)){
      const spellBonus = (this.creator as ModuleCreature).getSpellDamageBonus?.() || 0;
      if(spellBonus > 0 && totalDamage > 0){
        totalDamage += spellBonus;
      }
    }

    // 4. Improved Toughness / Master Toughness / Wookiee Toughness (-2 damage, min 1 if > 0) + Careers talent DR
    if(totalDamage > 0 && BitWise.InstanceOf(this.object.objectType, ModuleObjectType.ModuleCreature)){
      const creature = this.object as ModuleCreature;
      if(
        typeof creature.getHasFeat === 'function' && (
          creature.getHasFeat(CombatFeatType.IMPROVED_TOUGHNESS) ||
          creature.getHasFeat(CombatFeatType.WOOKIE_ENDURANCE) ||
          creature.getHasFeat(CombatFeatType.MASTER_TOUGHNESS) ||
          creature.getHasFeat(CombatFeatType.WOOKIEE_TOUGHNESS_II) ||
          creature.getHasFeat(CombatFeatType.WOOKIEE_TOUGHNESS_III)
        )
      ){
        totalDamage = Math.max(1, totalDamage - 2);
      }
      const talentDr = creature.getTalentDamageReduction?.() || 0;
      if(talentDr > 0){
        totalDamage = Math.max(1, totalDamage - talentDr);
      }
    }

    return Math.min(Math.max(totalDamage, 0), 10000);
  }

  getDamageType(){
    return this.getInt(17);
  }

  getDamagePower(){
    return this.getInt(18);
  }

}

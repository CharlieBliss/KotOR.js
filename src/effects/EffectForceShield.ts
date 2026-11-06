import { GameState } from "@/GameState";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { GameEffect } from "@/effects/GameEffect";
// import { TwoDAManager } from "@/managers";

/**
 * EffectForceShield class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file EffectForceShield.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class EffectForceShield extends GameEffect {
  forceShield: any;
  constructor(){
    super();
    this.type = GameEffectType.EffectForceShield;

    //intList[0] : ForceShield 2da id
    
  }

  initialize(){
    super.initialize();

    const forceShield2DA = GameState.TwoDAManager.datatables.get('forceshields');
    if(forceShield2DA){
      this.forceShield = forceShield2DA.rows[this.getInt(0)];
    }

    return this;
  }

  onApply(){
    if(this.applied)
      return;

    super.onApply();
    if(!this.forceShield || !this.object) return;
    
    let eVisualEffect = new GameState.GameEffectFactory.EffectVisualEffect();
    eVisualEffect.setCreator(this.getCreator());
    eVisualEffect.setSpellId(this.getSpellId());
    eVisualEffect.setSubTypeUnMasked(this.getSubTypeUnMasked());
    eVisualEffect.setDuration(this.duration);
    eVisualEffect.setExpireDay(this.expireDay);
    eVisualEffect.setExpireTime(this.expireTime);
    eVisualEffect.setInt(0, parseInt(this.forceShield.visualeffectdef) || 0);
    eVisualEffect.initialize();
    this.object.addEffect(eVisualEffect);
    eVisualEffect.setSkipOnLoad(true);

    let eDamageResistEffect = new GameState.GameEffectFactory.EffectDamageResistance();
    eDamageResistEffect.setCreator(this.getCreator());
    eDamageResistEffect.setSpellId(this.getSpellId());
    eDamageResistEffect.setSubTypeUnMasked(this.getSubTypeUnMasked());
    eDamageResistEffect.setDuration(this.duration);
    eDamageResistEffect.setExpireDay(this.expireDay);
    eDamageResistEffect.setExpireTime(this.expireTime);
    eDamageResistEffect.initialize();
    this.object.addEffect(eDamageResistEffect);
    eDamageResistEffect.setSkipOnLoad(true);

    const amount = parseInt(this.forceShield.amount) || 0;
    const resistance = parseInt(this.forceShield.resistance) || amount;
    eDamageResistEffect.setInt(0, parseInt(this.forceShield.damageflags) || 0);
    eDamageResistEffect.setInt(1, resistance);
    eDamageResistEffect.setInt(2, amount);
    eDamageResistEffect.setInt(3, parseInt(this.forceShield.vulnerflags) || 0);

  }

}

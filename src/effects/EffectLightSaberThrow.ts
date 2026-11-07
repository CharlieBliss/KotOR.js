import { GameEffect } from "@/effects/GameEffect";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { GameState } from "@/GameState";
import { BitWise } from "@/utility/BitWise";
import type { ModuleCreature } from "@/module/ModuleCreature";

/**
 * EffectLightSaberThrow class.
 *
 * Lightsaber Throw (EffectLightsaberThrow): applied to the thrower, it sends the thrower's lightsaber at up to
 * three targets in turn (objects 0-2; one with plain Saber Throw, three with the advanced power). Each target gets
 * an attack roll with the saber, as a melee attack would (d20 + base attack bonus + the better of Strength and
 * Dexterity, a natural 20 always hits), and takes the saber's damage plus Strength on a hit.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file EffectLightSaberThrow.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class EffectLightSaberThrow extends GameEffect {
  constructor(){
    super();
    this.type = GameEffectType.EffectLightSaberThrow;
  }

  onApply(){
    if(this.applied)
      return;

    super.onApply();

    const thrower = this.object as ModuleCreature;
    if(!thrower || !BitWise.InstanceOf(thrower.objectType, ModuleObjectType.ModuleCreature)) return;
    const saber = thrower.equipment?.RIGHTHAND || thrower.equipment?.LEFTHAND;
    if(!saber) return;

    const seen = new Set<any>();
    for(let i = 0; i < 3; i++){
      const target = this.getObject(i) as ModuleCreature;
      if(!target || seen.has(target) || target === thrower) continue;
      seen.add(target);
      if(!BitWise.InstanceOf(target.objectType, ModuleObjectType.ModuleCreature) || target.isDead?.()) continue;
      EffectLightSaberThrow.strike(thrower, target, saber);
    }
  }

  /** One pass of the thrown saber at a target: an attack roll, then the saber's damage on a hit */
  static strike(thrower: ModuleCreature, target: ModuleCreature, saber: any): boolean {
    const mod = (score: number) => Math.floor(((score || 10) - 10) / 2);
    const strMod = mod(thrower.getSTR?.());
    const attackMod = (thrower.getBaseAttackBonus?.() || 0) + Math.max(strMod, mod(thrower.getDEX?.()));
    const roll = 1 + Math.floor(Math.random() * 20);
    const hit = roll === 20 || (roll !== 1 && roll + attackMod >= (target.getAC?.() || 10));
    if(!hit) return false;

    const amount = Math.max(1, (saber.getBaseDamage?.() || 0) + (saber.getDamageBonus?.() || 0) + Math.max(0, strMod));
    const damage = new GameState.GameEffectFactory.EffectDamage();
    damage.setCreator(thrower);
    damage.setSpellId(-1);
    const type = saber.getBaseDamageType?.() ?? 0;
    damage.setInt(type >= 0 && type <= 15 ? type : 14, amount);
    damage.setInt(16, 1000);
    damage.setInt(17, 1 << (type >= 0 && type <= 15 ? type : 14));
    damage.initialize();
    target.addEffect(damage);
    return true;
  }

}

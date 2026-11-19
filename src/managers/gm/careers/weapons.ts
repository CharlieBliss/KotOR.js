import { WeaponWield } from "@/enums/combat/WeaponWield";
import type { CombatSkillId } from "@/managers/gm/careers/types";
import type { TalentAttackScope } from "@/managers/gm/careers/talents";
import type { ModuleItem } from "@/module/ModuleItem";

/** baseitems.2da rows of the lightsabers (single, double and short) */
const LIGHTSABER_BASE_ITEMS = new Set([8, 9, 10]);

/** A lightsaber (by its base item), whatever its wield type says */
export function isLightsaber(weapon?: ModuleItem): boolean {
  if (!weapon) return false;
  return LIGHTSABER_BASE_ITEMS.has(Number(weapon.baseItemId ?? weapon.getBaseItemId?.()));
}

/** A blaster or other ranged weapon */
export function isRangedWeapon(weapon?: ModuleItem): boolean {
  if (!weapon) return false;
  if (weapon.isRangedWeapon?.()) return true;
  const wield = weapon.getWeaponWield?.();
  return wield === WeaponWield.BLASTER_PISTOL || wield === WeaponWield.BLASTER_RIFLE || wield === WeaponWield.BLASTER_HEAVY;
}

/** The Careers combat skill that drives a KotOR weapon's attack bonus (unarmed is Brawl) */
export function combatSkillForWeapon(weapon?: ModuleItem): CombatSkillId {
  if (!weapon) return 'brawl';
  if (isLightsaber(weapon)) return 'lightsaber';
  switch (weapon.getWeaponWield?.()) {
    case WeaponWield.ONE_HANDED_SWORD:
    case WeaponWield.TWO_HANDED_SWORD:
      return 'melee';
    case WeaponWield.BLASTER_PISTOL:
      return 'ranged_light';
    case WeaponWield.BLASTER_RIFLE:
      return 'ranged_heavy';
    case WeaponWield.BLASTER_HEAVY:
      return 'gunnery';
    default:
      // Stun batons and anything unknown
      return 'brawl';
  }
}

/** Whether a weapon (or unarmed) is covered by a talent's attack scope (unarmed counts as melee) */
export function weaponMatchesScope(scope: TalentAttackScope | undefined, weapon?: ModuleItem): boolean {
  if (!scope || scope === 'any') return true;
  if (!weapon) return scope === 'unarmed' || scope === 'melee';
  if (scope === 'lightsaber') return isLightsaber(weapon);
  if (scope === 'ranged') return isRangedWeapon(weapon);
  if (scope === 'melee') return !isRangedWeapon(weapon);
  return false;
}

import { GameState } from "@/GameState";
import { CombatFeatType } from "@/enums/combat/CombatFeatType";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
import type { ModuleItem } from "@/module/ModuleItem";
import type { ModuleObject } from "@/module/ModuleObject";

/**
 * Resolves and triggers KotOR visualeffects.2da combat VFX (sparks, blaster impacts/deflections,
 * and feat-specific weapon particle effects).
 */
export class CombatVisualEffects {
  private static labelCache = new WeakMap<object, Map<string, number>>();

  /**
   * Look up the EffectVisualEffect int ID (numeric `__rowlabel` when present, else row `__index`)
   * for a `visualeffects.2da` label. Cached per 2DA table instance so it works across K1, TSL, and tests.
   */
  static lookupVisualEffectId(label: string): number {
    if (!label) return -1;
    const table = GameState.TwoDAManager?.datatables?.get('visualeffects');
    if (!table?.rows) return -1;

    let map = this.labelCache.get(table);
    if (!map) {
      map = new Map<string, number>();
      for (const key of Object.keys(table.rows)) {
        const row = table.rows[key];
        const rowLabel = String(row?.label || '').trim().toUpperCase();
        if (!rowLabel) continue;
        const numericLabel = Number(row.__rowlabel);
        const numericIdx = Number(row.__index ?? key);
        const resolved = Number.isFinite(numericLabel) ? numericLabel : numericIdx;
        if (Number.isFinite(resolved)) map.set(rowLabel, resolved);
      }
      this.labelCache.set(table, map);
    }

    const id = map.get(label.trim().toUpperCase());
    return id !== undefined ? id : -1;
  }

  /**
   * Resolve the impact model resref (e.g. `v_blaster_imp`, `v_blastdef_imp`, `v_spkb_imp`)
   * for a `visualeffects.2da` label, or return the fallback resref if 2DA isn't loaded.
   */
  static lookupImpactModel(label: string, fallbackResRef: string = ''): string {
    const table = GameState.TwoDAManager?.datatables?.get('visualeffects');
    if (table?.rows) {
      const target = label.trim().toUpperCase();
      for (const key of Object.keys(table.rows)) {
        const row = table.rows[key];
        if (String(row?.label || '').trim().toUpperCase() !== target) continue;
        const node = String(row.imp_impact_node || '').trim().toLowerCase();
        if (node && node !== '****') return node;
      }
    }
    return fallbackResRef;
  }

  static isLightsaberWeapon(weapon?: ModuleItem): boolean {
    if (!weapon) return false;
    const baseId = weapon.baseItemId;
    return baseId === 8 || baseId === 9 || baseId === 10;
  }

  /**
   * Determine the combat feat particle VFX label(s) in priority order for a feat + weapon.
   */
  static getFeatVisualEffectLabels(featId: number | undefined, weapon?: ModuleItem): string[] {
    if (typeof featId !== 'number' || featId < 0) return [];
    const saber = this.isLightsaberWeapon(weapon);
    switch (featId) {
      case CombatFeatType.POWER_ATTACK:
      case CombatFeatType.IMPROVED_POWER_ATTACK:
        return [saber ? 'VFX_COM_POWER_ATTACK_IMPROVED_SABER' : 'VFX_COM_POWER_ATTACK_IMPROVED_STAFF'];
      case CombatFeatType.MASTER_POWER_ATTACK:
        return [saber ? 'VFX_COM_POWER_ATTACK_MASTERY_SABER' : 'VFX_COM_POWER_ATTACK_MASTERY_STAFF'];
      case CombatFeatType.CRITICAL_STRIKE:
      case CombatFeatType.IMPROVED_CRITICAL_STRIKE:
        return [saber ? 'VFX_COM_CRITICAL_STRIKE_IMPROVED_SABER' : 'VFX_COM_CRITICAL_STRIKE_IMPROVED_STAFF'];
      case CombatFeatType.MASTER_CRITICAL_STRIKE:
        return [saber ? 'VFX_COM_CRITICAL_STRIKE_MASTERY_SABER' : 'VFX_COM_CRITICAL_STRIKE_MASTERY_STAFF'];
      case CombatFeatType.FLURRY:
      case CombatFeatType.IMPROVED_FLURRY:
        return [saber ? 'VFX_COM_FLURRY_IMPROVED_SABER' : 'VFX_COM_FLURRY_IMPROVED_STAFF'];
      case CombatFeatType.MASTER_FLURRY:
        return [saber ? 'VFX_COM_WHIRLWIND_STRIKE_SABER' : 'VFX_COM_WHIRLWIND_STRIKE_STAFF'];
      case CombatFeatType.RAPID_SHOT:
      case CombatFeatType.IMPROVED_RAPID_SHOT:
      case CombatFeatType.MASTER_RAPID_SHOT:
        return ['VFX_COM_RAPID_SHOT_IMPROVED'];
      case CombatFeatType.SNIPER_SHOT:
      case CombatFeatType.PRECISE_SHOT_I:
      case CombatFeatType.PRECISE_SHOT_II:
      case CombatFeatType.PRECISE_SHOT_III:
      case CombatFeatType.PRECISE_SHOT_IV:
      case CombatFeatType.PRECISE_SHOT_V:
        return ['VFX_COM_SNIPER_SHOT', 'VFX_COM_SNIPER_SHOT_IMPROVED'];
      case CombatFeatType.IMPROVED_SNIPER_SHOT:
        return ['VFX_COM_SNIPER_SHOT_IMPROVED', 'VFX_COM_SNIPER_SHOT'];
      case CombatFeatType.MASTER_SNIPER_SHOT:
        return ['VFX_COM_SNIPER_SHOT_MASTERY', 'VFX_COM_SNIPER_SHOT_IMPROVED'];
      case CombatFeatType.POWER_BLAST:
      case CombatFeatType.IMPROVED_POWER_BLAST:
        return ['VFX_COM_POWER_BLAST_IMPROVED'];
      case CombatFeatType.MASTER_POWER_BLAST:
        return ['VFX_COM_POWER_BLAST_MASTERY', 'VFX_COM_POWER_BLAST_IMPROVED'];
      default:
        return [];
    }
  }

  /**
   * Choose the spark `visualeffects.2da` label for a melee clash, parry, or weapon hit.
   */
  static getMeleeSparkLabel(
    kind: 'clash' | 'parry' | 'hit',
    attackerWeapon?: ModuleItem,
    defenderWeapon?: ModuleItem
  ): string | undefined {
    if (this.isLightsaberWeapon(attackerWeapon) || this.isLightsaberWeapon(defenderWeapon)) {
      return kind === 'hit' ? 'VFX_COM_SPARKS_LARGE' : 'VFX_COM_SPARKS_LIGHTSABER';
    }
    if (kind === 'clash' || kind === 'parry') {
      return (attackerWeapon || defenderWeapon) ? 'VFX_COM_SPARKS_PARRY_METAL' : undefined;
    }
    if (attackerWeapon && !attackerWeapon.isRangedWeapon?.()) {
      return 'VFX_COM_SPARKS_LARGE';
    }
    return undefined;
  }

  /**
   * Apply the first matching instant `EffectVisualEffect` label onto `target`
   * (automatically replicated in GM multiplayer via `GMReplication.onEffectApplied`).
   */
  static applyFirstVisualEffect(target: ModuleObject | undefined, labels: string[], creator?: ModuleObject): boolean {
    if (!target || typeof target.addEffect !== 'function' || !labels.length) return false;
    const EffectCtor = GameState.GameEffectFactory?.EffectVisualEffect;
    if (!EffectCtor) return false;
    for (const label of labels) {
      const vfxId = this.lookupVisualEffectId(label);
      if (vfxId < 0) continue;
      const effect = new EffectCtor();
      if (creator) effect.setCreator(creator);
      effect.setDurationType(GameEffectDurationType.INSTANT);
      effect.setInt(0, vfxId);
      effect.initialize();
      target.addEffect(effect);
      return true;
    }
    return false;
  }
}

import type { ModuleCreature } from "@/module/ModuleCreature";
import { GameState } from "@/GameState";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
import { GMCombatAI } from "@/managers/gm/GMCombatAI";
import { GMCombatStats } from "@/managers/gm/GMCombatStats";

/** One line of a creature's status for the GM */
export interface GMStatusLine {
  label: string;
  /** What it comes from, or its cost (a power's Force points) */
  detail?: string;
  /** heal, buff, harm, grenade, effect: how the panel colours it */
  kind?: string;
}

/** What the GM sees about a creature mid-scene: its fight numbers, what's on it now, and what it can do */
export interface GMStatus {
  summary: string;
  effects: GMStatusLine[];
  powers: GMStatusLine[];
  items: GMStatusLine[];
  feats: string[];
}

/** Effects that are bookkeeping, not anything the GM needs to see */
const HIDDEN_EFFECTS = new Set<number>([
  GameEffectType.EffectRacialType, GameEffectType.EffectVisualEffect, GameEffectType.EffectBeam, GameEffectType.EffectLink,
  GameEffectType.EffectIcon,
].filter((t) => typeof t === 'number') as number[]);

/** Effects whose number means something to read (a bonus or penalty); others' are internal */
const AMOUNT_EFFECTS = /AC|Attack|Damage|Saving|Skill|Ability|Temporary ?hit/i;

const tlk = (id: any, fallback = '') => {
  const n = Number(id);
  if (!Number.isFinite(n) || n < 0) return fallback;
  const text = GameState.TLKManager?.GetStringById(n)?.Value;
  return text ? String(text).trim() : fallback;
};

/** "EffectACIncrease" -> "AC increase", "EffectMovementSpeedIncrease" -> "Movement speed increase" */
const effectName = (type: number) => {
  const key = String((GameEffectType as any)[type] || `Effect ${type}`).replace(/^Effect/, '');
  const words = key.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-z])([A-Z])/g, '$1 $2').split(' ');
  return words.map((w, i) => (/^[A-Z]{2,}$/.test(w) ? w : i === 0 ? w[0] + w.slice(1).toLowerCase() : w.toLowerCase())).join(' ');
};

/**
 * GMStatus class.
 *
 * Reads a creature for the GM's Inspector: its level, vitality, Force, AC and attacks (GMCombatStats); the effects
 * on it now, named, with the power or item each came from and how long it lasts; the powers it knows (with their
 * cost and what they're for, as GMCombatAI sorts them), its usable items and its feats.
 */
export class GMStatus {
  static of(cre: ModuleCreature): GMStatus {
    const status: GMStatus = { summary: '', effects: [], powers: [], items: [], feats: [] };
    if (!cre) return status;

    try {
      const p = GMCombatStats.profile(cre);
      const attacks = p.attacks.map((a) => `${a.bonus >= 0 ? '+' : ''}${a.bonus} for ${Math.round(a.damage)}`).join(', ') || 'none';
      status.summary = `Level ${p.level} · ${cre.getHP()}/${p.hp} HP${p.fp ? ` · ${cre.getFP?.() ?? 0}/${p.fp} FP` : ''} · AC ${p.ac} · attacks ${attacks}`;
    } catch (e) {
      status.summary = `${cre.getHP()}/${cre.getMaxHP()} HP`;
    }

    const spells = GameState.TwoDAManager?.datatables.get('spells')?.rows || {};
    for (const effect of (cre.effects || []) as any[]) {
      if (!effect || HIDDEN_EFFECTS.has(effect.type)) continue;
      const spellId = effect.getSpellId?.() ?? effect.spellId;
      const spell = spellId >= 0 ? spells[spellId] : undefined;
      const from = spell ? tlk(spell.name, String(spell.label || '').replace(/^FORCE_POWER_/, '').replace(/_/g, ' ').toLowerCase()) : '';
      const name = effectName(effect.type);
      const amount = AMOUNT_EFFECTS.test(name) ? (Number(effect.getInt?.(0)) || Number(effect.getInt?.(1)) || 0) : 0;
      const kind = effect.getDurationType?.();
      const lasting = kind === GameEffectDurationType.PERMANENT ? 'permanent' : kind === GameEffectDurationType.TEMPORARY ? `${Math.round(Number(effect.getDuration?.()) || 0)} s` : '';
      status.effects.push({
        label: `${name}${amount && Math.abs(amount) < 100 ? ` ${amount > 0 ? '+' : ''}${amount}` : ''}`,
        detail: [from, lasting].filter(Boolean).join(' · '),
        kind: 'effect',
      });
    }

    try {
      const kit = GMCombatAI.kitOf(cre);
      const add = (list: any[], kind: string, into: GMStatusLine[]) => {
        for (const t of list) {
          const row = spells[t.spellId];
          const name = row ? tlk(row.name, t.label) : t.label;
          into.push({ label: name, detail: t.item ? (t.item.getName?.() || 'item') : `${t.cost} FP`, kind });
        }
      };
      const powers = kit.heals.concat(kit.buffs, kit.harms).filter((t) => !t.item);
      add(kit.heals.filter((t) => !t.item), 'heal', status.powers);
      add(kit.buffs.filter((t) => !t.item), 'buff', status.powers);
      add(kit.harms.filter((t) => !t.item), 'harm', status.powers);
      if (!powers.length) status.powers = [];
      add(kit.heals.concat(kit.buffs, kit.harms, kit.grenades).filter((t) => t.item), 'item', status.items);
    } catch (e) {}

    const feats = (cre.getFeats?.() || []) as any[];
    status.feats = [...new Set(feats.map((f) => tlk(f.name, String(f.label || '').replace(/_/g, ' ').toLowerCase())).filter(Boolean))].sort();
    return status;
  }
}

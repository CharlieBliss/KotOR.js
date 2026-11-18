import React, { useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { Panel } from "@/apps/game/components/gm-panel/creator/sections";
import { GameImage } from "@/apps/game/components/gm-panel/creator/GameImage";
import { useGMStore } from "@/apps/game/components/gm-panel/gmPanelStore";
import { ABILITY_NAMES } from "@/apps/game/components/gm-panel/creator/creatorData";
import type { GMCheck } from "@/managers/gm/GMTypes";

/** What a sheet section gets: the character, and how to act on it (as a player, or as the GM) */
export interface SheetSectionProps {
  creature: any;
  actions: SheetActions;
}

/** What the sheet can do. A player's go through GMPlayerRequests to the host; the GM's act directly. */
export interface SheetActions {
  roll(check: GMCheck): void;
  levelUp(): void;
  /** Who's acting, for button titles */
  who: 'player' | 'gm';
}

const mod = (score: number) => Math.floor(((Number(score) || 10) - 10) / 2);
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`;
const twoDA = (name: string) => KotOR.GameState.TwoDAManager.datatables.get(name)?.rows || {};
const text = (strref: any, fallback = '') => KotOR.CharacterRules.text(strref, fallback);

// --- Overview: what the game's character screen shows -------------------------------------------------

export const OverviewSection: React.FC<SheetSectionProps> = ({ creature: c }) => {
  const abilities = KotOR.ABILITIES.map((k: string) => {
    const getter = ({ str: 'getSTR', dex: 'getDEX', con: 'getCON', int: 'getINT', wis: 'getWIS', cha: 'getCHA' } as any)[k];
    const score = Number(c[getter]?.()) || 0;
    return { key: k, name: ABILITY_NAMES[k], score, mod: mod(score) };
  });
  const goodEvil = Number(c.getGoodEvil?.() ?? 50);
  return (
    <>
      <Panel title="Vitals">
        <dl className="cc-stats sheet-stats">
          <dt>Vitality</dt><dd>{c.getHP()} / {c.getMaxHP()}</dd>
          <dt>Force</dt><dd>{c.getFP?.() ?? 0} / {c.getMaxFP?.() ?? 0}</dd>
          <dt>Defense</dt><dd>{c.getAC?.() ?? '-'}</dd>
          <dt>Base attack</dt><dd>{signed(Number(c.getBaseAttackBonus?.()) || 0)}</dd>
        </dl>
      </Panel>
      <Panel title="Attributes">
        <div className="cc-abilities">
          {abilities.map((a) => (
            <div key={a.key} className="sheet-ability">
              <span className="cc-ability-name">{a.name}</span>
              <span className="sheet-value">{a.score}</span>
              <span className="cc-ability-mod">{signed(a.mod)}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Alignment" extra={<span className="cc-hint">{goodEvil >= 50 ? 'Light side' : 'Dark side'} · {goodEvil}</span>}>
        <div className="sheet-alignment" aria-label={`Alignment ${goodEvil} of 100`}>
          <div className="sheet-alignment-marker" style={{ left: `${Math.max(0, Math.min(100, goodEvil))}%` }} />
        </div>
      </Panel>
    </>
  );
};

// --- Skills and saves, each a button that rolls it ------------------------------------------------------

const SAVES: { save: 'fortitude' | 'reflex' | 'will'; name: string }[] = [
  { save: 'fortitude', name: 'Fortitude' }, { save: 'reflex', name: 'Reflex' }, { save: 'will', name: 'Will' },
];

/**
 * A skill or save that rolls when clicked. Its latest result shows on it for a few seconds: rolling from the sheet,
 * the roll feed was behind the sheet, and players never saw what they rolled
 */
const RollButton: React.FC<{ name: string; bonus: number; detail?: string; onRoll: () => void; who: 'player' | 'gm'; last?: any }> = ({ name, bonus, detail, onRoll, who, last }) => (
  <button className={`sheet-roll ${last ? 'rolled' : ''}`} onClick={onRoll} title={`Roll ${name}: d20 ${bonus >= 0 ? '+' : '-'} ${Math.abs(bonus)}${who === 'gm' ? ', for this player' : ''}. Everyone sees the result.`}>
    <span className="sheet-roll-name">{name}{detail ? <span className="cc-tag">{detail}</span> : null}</span>
    {last ? (
      <span
        className={`sheet-roll-result ${last.roll === 20 ? 'natural-20' : last.roll === 1 ? 'natural-1' : ''}`}
        title={`d20 ${last.roll} ${last.bonus >= 0 ? '+' : '-'} ${Math.abs(last.bonus)} = ${last.total}`}
      >
        → {last.total}{last.roll === 20 ? ' (20!)' : last.roll === 1 ? ' (1)' : ''}
      </span>
    ) : (
      <span className="sheet-roll-bonus">{signed(bonus)}</span>
    )}
  </button>
);

export const SkillRollGrid: React.FC<{ creature: any; onRoll: (check: GMCheck) => void; who: 'player' | 'gm'; compact?: boolean }> = ({ creature: c, onRoll, who, compact = false }) => {
  useGMStore();
  const bonus = (check: GMCheck) => KotOR.GMChecks.checkBonus(c, check);
  const shown = KotOR.GMChecks.shownRolls().filter((r: any) => r.netId === c?.gmNetId);
  const last = (check: GMCheck) => { const label = KotOR.GMChecks.checkLabel(check); return [...shown].reverse().find((r: any) => r.label === label); };
  return (
    <div className={compact ? 'sheet-quick-rolls' : 'sheet-rolls-wrap'}>
      <div className="sheet-rolls">
        {KotOR.GMChecks.SKILL_NAMES.map((name: string, skill: number) => {
          const ranks = Number(c?.skills?.[skill]?.rank ?? c?.getSkillRanks?.(skill) ?? 0);
          return <RollButton key={name} name={name} bonus={bonus({ kind: 'skill', skill })} detail={compact ? undefined : `${ranks} rank${ranks === 1 ? '' : 's'}`} onRoll={() => onRoll({ kind: 'skill', skill })} who={who} last={last({ kind: 'skill', skill })} />;
        })}
      </div>
      {compact && <div className="sheet-quick-sub">Saving throws</div>}
      <div className={compact ? 'sheet-rolls saves' : 'sheet-rolls saves-spaced'}>
        {SAVES.map((s) => (
          <RollButton key={s.save} name={s.name} bonus={bonus({ kind: 'save', save: s.save })} onRoll={() => onRoll({ kind: 'save', save: s.save })} who={who} last={last({ kind: 'save', save: s.save })} />
        ))}
      </div>
    </div>
  );
};

export const SkillsSection: React.FC<SheetSectionProps> = ({ creature: c, actions }) => (
  <Panel title="Skills & saving throws" extra={<span className="cc-hint">Click to roll · everyone sees it</span>}>
    <SkillRollGrid creature={c} onRoll={(check) => actions.roll(check)} who={actions.who} />
  </Panel>
);

// --- Feats and powers: icon, name, meta badges, description and direct HUD actions --------------------

interface TalentItem {
  id: number;
  name: string;
  description: string;
  icon: string;
  cost?: number;
  aimLabel?: string;
  abilityKey?: string;
  isBestRank?: boolean;
}

const TalentList: React.FC<{
  items: TalentItem[];
  empty: string;
  interactive?: boolean;
  defaultExpanded?: boolean;
}> = ({ items, empty, interactive = false, defaultExpanded = false }) => {
  const [expandedAll, setExpandedAll] = useState(defaultExpanded);
  const pc = interactive ? KotOR.GMPlayerHud?.player?.() : undefined;
  const hudAbilities = interactive && pc ? (KotOR.GMPlayerHud?.abilities?.(pc) || []) : [];
  const byKey = new Map<string, any>(hudAbilities.map((a: any) => [a.key, a]));
  const bar = interactive && pc ? (KotOR.GMPlayerHud?.loadout?.(pc, hudAbilities) || []) : [];

  if (!items.length) return <div className="cc-empty">{empty}</div>;
  return (
    <div className="sheet-talents-wrap">
      <div className="sheet-talent-toolbar">
        <button type="button" className="sheet-mini-btn" onClick={() => setExpandedAll((v) => !v)}>
          {expandedAll ? 'Collapse descriptions' : 'Expand all descriptions'}
        </button>
      </div>
      <div className="sheet-talents">
        {items.map((t) => {
          const ability = t.abilityKey ? byKey.get(t.abilityKey) : undefined;
          const pinnedSlot = t.abilityKey ? bar.indexOf(t.abilityKey) : -1;
          return (
            <details key={`${t.id}-${expandedAll}`} className="sheet-talent" open={expandedAll}>
              <summary>
                <span className="sheet-talent-chevron" aria-hidden="true">▸</span>
                <GameImage texture={t.icon} alt="" className="sheet-talent-icon" />
                <span className="sheet-talent-title">{t.name}</span>
                <span className="sheet-talent-meta">
                  {t.cost != null && t.cost > 0 && <span className="sheet-pill fp">{t.cost} FP</span>}
                  {t.aimLabel && <span className="sheet-pill">{t.aimLabel}</span>}
                  {pinnedSlot >= 0 && <span className="sheet-pill pinned">Slot {pinnedSlot + 1}</span>}
                </span>
              </summary>
              <div className="sheet-talent-body">
                <p className="sheet-talent-text">{t.description || 'No description available.'}</p>
                {ability && (
                  <div className="sheet-talent-actions">
                    <button
                      type="button"
                      className="sheet-mini-btn primary"
                      disabled={!ability.usable}
                      title={ability.why || `Use ${ability.name}`}
                      onClick={() => KotOR.GMPlayerHud?.use?.(ability)}
                    >
                      Cast / Use
                    </button>
                    <span className="sheet-bind-label">Pin to bar:</span>
                    <div className="sheet-bind-row">
                      {Array.from({ length: KotOR.GMPlayerHud?.SLOTS || 8 }, (_, slot) => (
                        <button
                          key={slot}
                          type="button"
                          className={`sheet-slot-chip ${pinnedSlot === slot ? 'on' : ''}`}
                          onClick={() => KotOR.GMPlayerHud?.assignSlot?.(slot, ability.key)}
                        >
                          {slot + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
};

export const FeatsSection: React.FC<SheetSectionProps> = ({ creature: c, actions }) => {
  const rows = twoDA('feat');
  const items: TalentItem[] = (c.feats || []).map((f: any) => {
    const row = rows[f.id] || {};
    return {
      id: f.id,
      name: text(row.name, row.label || `Feat ${f.id}`),
      description: text(row.description),
      icon: String(row.icon || '').toLowerCase(),
      abilityKey: `feat:${f.id}`,
    };
  }).sort((a: TalentItem, b: TalentItem) => a.name.localeCompare(b.name));
  const interactive = actions.who === 'player' && !!KotOR.GMPlayerHud?.active?.();
  return <Panel title={`Feats (${items.length})`}><TalentList items={items} empty="No feats." interactive={interactive} /></Panel>;
};

export const PowersSection: React.FC<SheetSectionProps> = ({ creature: c, actions }) => {
  const [bestOnly, setBestOnly] = useState(true);
  const rows = twoDA('spells');
  const seen = new Set<number>();
  const spells = (c.classes || []).flatMap((cls: any) => cls.spells || []).filter((s: any) => s && !seen.has(s.id) && seen.add(s.id));
  const superseded = new Set<number>();
  for (const s of spells) {
    const prereqs: number[] = Array.isArray(s.prerequisites)
      ? s.prerequisites
      : String(rows[s.id]?.prerequisites || '').split('_').map(Number).filter((n) => Number.isFinite(n) && n >= 0);
    for (const req of prereqs) superseded.add(req);
  }
  const marked = (v: any) => { const n = parseInt(v); return !isNaN(n) && n >= 0; };
  const allItems: TalentItem[] = spells.map((s: any) => {
    const row = rows[s.id] || {};
    const cost = Number(s.getForcePointCost?.(c) ?? row.forcepoints ?? 0) || 0;
    const range = String(s.range ?? row.range ?? '').toUpperCase();
    const hostile = marked(s.forcehostile ?? row.forcehostile);
    return {
      id: s.id,
      name: text(row.name, row.label || `Power ${s.id}`),
      description: text(row.spelldesc),
      icon: String(row.iconresref || '').toLowerCase(),
      cost,
      aimLabel: range === 'P' ? 'Self' : hostile ? 'Enemy' : 'Ally',
      abilityKey: `power:${s.id}`,
      isBestRank: !superseded.has(s.id),
    };
  }).sort((a: TalentItem, b: TalentItem) => a.name.localeCompare(b.name));
  const items = bestOnly ? allItems.filter((it) => it.isBestRank) : allItems;
  const interactive = actions.who === 'player' && !!KotOR.GMPlayerHud?.active?.();
  return (
    <Panel
      title={`Force powers (${items.length}${bestOnly && items.length < allItems.length ? ` of ${allItems.length}` : ''})`}
      extra={
        allItems.some((it) => !it.isBestRank) ? (
          <label className="sheet-inline-check">
            <input type="checkbox" checked={bestOnly} onChange={(e) => setBestOnly(e.target.checked)} />
            Highest rank only
          </label>
        ) : undefined
      }
    >
      <TalentList items={items} empty="No Force powers." interactive={interactive} defaultExpanded />
    </Panel>
  );
};

// --- Effects: what's on the character right now --------------------------------------------------------

export const EffectsSection: React.FC<SheetSectionProps> = ({ creature: c }) => {
  const spells = twoDA('spells');
  const typeName = (type: number) => {
    const raw = (KotOR as any).GameEffectType?.[type];
    return raw ? String(raw).replace(/^EFFECT_?/i, '').replace(/_/g, ' ').toLowerCase() : `effect ${type}`;
  };
  const effects = (c.effects || []).filter((e: any) => e && !e.isVisualEffect?.());
  if (!effects.length) return <Panel title="Effects"><div className="cc-empty">Nothing is affecting this character.</div></Panel>;
  return (
    <Panel title={`Effects (${effects.length})`}>
      <div className="sheet-effects">
        {effects.map((e: any, i: number) => {
          const from = e.spellId >= 0 && spells[e.spellId] ? text(spells[e.spellId].name, '') : '';
          const remaining = Number(e.getDuration?.()) || 0;
          return (
            <div key={i} className="sheet-effect">
              <span className="sheet-effect-name">{typeName(e.type)}</span>
              {from && <span className="cc-hint">from {from}</span>}
              {remaining > 0 && <span className="cc-hint">{Math.ceil(remaining / 1000)} s</span>}
            </div>
          );
        })}
      </div>
    </Panel>
  );
};

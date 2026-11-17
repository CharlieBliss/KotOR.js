import React from "react";
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

export const SkillsSection: React.FC<SheetSectionProps> = ({ creature: c, actions }) => {
  useGMStore();
  const bonus = (check: GMCheck) => KotOR.GMChecks.checkBonus(c, check);
  // This character's rolls still showing, by what was rolled
  const shown = KotOR.GMChecks.shownRolls().filter((r: any) => r.netId === c.gmNetId);
  const last = (check: GMCheck) => { const label = KotOR.GMChecks.checkLabel(check); return [...shown].reverse().find((r: any) => r.label === label); };
  return (
    <>
      <Panel title="Skills" extra={<span className="cc-hint">Click to roll · everyone sees it</span>}>
        <div className="sheet-rolls">
          {KotOR.GMChecks.SKILL_NAMES.map((name: string, skill: number) => {
            const ranks = Number(c.skills?.[skill]?.rank ?? c.getSkillRanks?.(skill) ?? 0);
            return <RollButton key={name} name={name} bonus={bonus({ kind: 'skill', skill })} detail={`${ranks} rank${ranks === 1 ? '' : 's'}`} onRoll={() => actions.roll({ kind: 'skill', skill })} who={actions.who} last={last({ kind: 'skill', skill })} />;
          })}
        </div>
      </Panel>
      <Panel title="Saving throws">
        <div className="sheet-rolls">
          {SAVES.map((s) => (
            <RollButton key={s.save} name={s.name} bonus={bonus({ kind: 'save', save: s.save })} onRoll={() => actions.roll({ kind: 'save', save: s.save })} who={actions.who} last={last({ kind: 'save', save: s.save })} />
          ))}
        </div>
      </Panel>
    </>
  );
};

// --- Feats and powers: icon, name and what they do -------------------------------------------------------

const TalentList: React.FC<{ items: { id: number; name: string; description: string; icon: string }[]; empty: string }> = ({ items, empty }) => {
  if (!items.length) return <div className="cc-empty">{empty}</div>;
  return (
    <div className="sheet-talents">
      {items.map((t) => (
        <details key={t.id} className="sheet-talent">
          <summary>
            <GameImage texture={t.icon} alt="" className="sheet-talent-icon" />
            <span>{t.name}</span>
          </summary>
          <p className="sheet-talent-text">{t.description || 'No description.'}</p>
        </details>
      ))}
    </div>
  );
};

export const FeatsSection: React.FC<SheetSectionProps> = ({ creature: c }) => {
  const rows = twoDA('feat');
  const items = (c.feats || []).map((f: any) => {
    const row = rows[f.id] || {};
    return { id: f.id, name: text(row.name, row.label || `Feat ${f.id}`), description: text(row.description), icon: String(row.icon || '').toLowerCase() };
  }).sort((a: any, b: any) => a.name.localeCompare(b.name));
  return <Panel title={`Feats (${items.length})`}><TalentList items={items} empty="No feats." /></Panel>;
};

export const PowersSection: React.FC<SheetSectionProps> = ({ creature: c }) => {
  const rows = twoDA('spells');
  const seen = new Set<number>();
  const items = (c.classes || []).flatMap((cls: any) => cls.spells || []).filter((s: any) => !seen.has(s.id) && seen.add(s.id)).map((s: any) => {
    const row = rows[s.id] || {};
    return { id: s.id, name: text(row.name, row.label || `Power ${s.id}`), description: text(row.spelldesc), icon: String(row.iconresref || '').toLowerCase() };
  }).sort((a: any, b: any) => a.name.localeCompare(b.name));
  return <Panel title={`Force powers (${items.length})`}><TalentList items={items} empty="No Force powers." /></Panel>;
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

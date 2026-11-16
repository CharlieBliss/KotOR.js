import React, { useEffect, useMemo, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import type { GMCharacter } from "@/managers/gm/GMTypes";
import type { ICharacterLimits } from "@/engine/rules/CharacterRules";
import { ModelList } from "@/apps/game/components/gm-panel/creator/ModelList";
import { GameImage } from "@/apps/game/components/gm-panel/creator/GameImage";
import { ABILITY_NAMES, creatorModels, creatorPortraits, portraitForModel } from "@/apps/game/components/gm-panel/creator/creatorData";

const Rules = KotOR.CharacterRules;

export type Update = (patch: Partial<GMCharacter>) => void;

/** A framed section with its title bar, like the game's panels */
export const Panel: React.FC<{ title: string; extra?: React.ReactNode; children: React.ReactNode }> = ({ title, extra, children }) => (
  <section className="cc-panel">
    <div className="cc-panel-title"><span>{title}</span>{extra}</div>
    <div className="cc-panel-body">{children}</div>
  </section>
);

/** A value with − and + arrows, as the game's ability rows have */
const Stepper: React.FC<{ value: React.ReactNode; onDown?: () => void; onUp?: () => void; label: string }> = ({ value, onDown, onUp, label }) => (
  <div className="cc-stepper">
    <button className="cc-arrow" onClick={onDown} disabled={!onDown} aria-label={`Lower ${label}`}>−</button>
    <span className="cc-stepper-value">{value}</span>
    <button className="cc-arrow" onClick={onUp} disabled={!onUp} aria-label={`Raise ${label}`}>+</button>
  </div>
);

// --- Look --------------------------------------------------------------------------------------

export const LookSection: React.FC<{ c: GMCharacter; update: Update; limits: ICharacterLimits }> = React.memo(({ c, update, limits }) => {
  const portraits = useMemo(() => creatorPortraits(), []);
  const model = useMemo(() => creatorModels().find((m) => m.id === c.appearanceId), [c.appearanceId]);
  const shownPortraits = portraits.filter((p) => p.gender === c.gender);
  return (
    <>
      <Panel title="Name">
        <input className="cc-input cc-name" value={c.name} onChange={(e) => update({ name: e.target.value })} aria-label="Character name" maxLength={40} />
        <div className="cc-toggle" role="radiogroup" aria-label="Gender">
          {[['Male', 0], ['Female', 1]].map(([label, value]) => (
            <button key={label} role="radio" aria-checked={c.gender === value} className={`cc-chip ${c.gender === value ? 'on' : ''}`} onClick={() => update({ gender: value as number })}>{label}</button>
          ))}
        </div>
      </Panel>
      <Panel title="Portrait" extra={<span className="cc-hint">Picks the matching body</span>}>
        <div className="cc-portraits">
          {shownPortraits.map((p) => (
            <button
              key={p.id}
              className={`cc-portrait ${c.portraitId === p.id ? 'on' : ''}`}
              onClick={() => {
                const body = p.appearances[0];
                const label = KotOR.AppearanceManager.appearances.get(body)?.label || '';
                update({ portraitId: p.id, ...(body !== undefined ? { appearanceId: body, appearanceLabel: label } : {}) });
              }}
              aria-label={`Portrait ${p.texture}`}
              aria-pressed={c.portraitId === p.id}
            >
              <GameImage texture={p.texture} alt={p.texture} />
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Model" extra={<span className="cc-hint">{model ? model.label : `#${c.appearanceId}`}</span>}>
        <ModelList
          selected={c.appearanceId}
          playerBodiesOnly={limits.anyModel === false}
          onPick={(id, label) => update({ appearanceId: id, appearanceLabel: label, ...(portraitForModel(id) ? { portraitId: portraitForModel(id)!.id } : {}) })}
        />
        {model && model.notes.length > 0 && (
          <ul className="cc-notes">{model.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        )}
      </Panel>
    </>
  );
});

// --- Class -------------------------------------------------------------------------------------

export const ClassSection: React.FC<{ c: GMCharacter; update: Update; limits: ICharacterLimits }> = React.memo(({ c, update, limits }) => {
  const classes = useMemo(() => Rules.classes(), []);
  const [minLevel, maxLevel] = Rules.levelRange(limits);
  const forceUser = Rules.powerGain(c.classId, Rules.LEVEL_MAX) > 0;
  // Changing class or level resets the choices that depend on them
  const reset: Partial<GMCharacter> = { feats: undefined, powers: undefined, skillRanks: undefined };
  return (
    <>
      <Panel title="Choose your class">
        <div className="cc-classes">
          {classes.map((k) => (
            <button key={k.id} className={`cc-class ${c.classId === k.id ? 'on' : ''}`} onClick={() => update({ classId: k.id, ...reset })} aria-pressed={c.classId === k.id}>
              <span className="cc-class-name">{k.name}</span>
              <span className="cc-class-sub">Hit die d{Rules.classRow(k.id)?.hitdie || '?'}{Number(Rules.classRow(k.id)?.forcedie) > 0 ? ' · Force user' : ''}</span>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Level" extra={minLevel === maxLevel ? <span className="cc-hint">Set by the GM</span> : null}>
        <div className="cc-level">
          <input type="range" min={minLevel} max={maxLevel} value={Math.max(minLevel, Math.min(maxLevel, c.level))} disabled={minLevel === maxLevel}
            onChange={(e) => update({ level: Number(e.target.value), ...reset })} aria-label="Level" />
          <span className="cc-big">{c.level}</span>
        </div>
      </Panel>
      {forceUser && (
        <Panel title="Force path" extra={<span className="cc-hint">Which powers Recommended picks</span>}>
          <div className="cc-toggle" role="radiogroup" aria-label="Force path">
            {(['light', 'dark'] as const).map((side) => (
              <button key={side} role="radio" aria-checked={(c.alignment || 'light') === side} className={`cc-chip ${(c.alignment || 'light') === side ? 'on' : ''}`} onClick={() => update({ alignment: side, powers: undefined })}>
                {side === 'light' ? 'Light side' : 'Dark side'}
              </button>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
});

// --- Attributes --------------------------------------------------------------------------------

export const AttributesSection: React.FC<{ c: GMCharacter; update: Update; limits: ICharacterLimits }> = React.memo(({ c, update, limits }) => {
  const pool = Rules.abilityPool(limits);
  const spent = Rules.abilitiesCost(c.attributes);
  const left = pool - spent;
  return (
    <Panel title="Attributes" extra={<span className={`cc-points ${left < 0 ? 'over' : ''}`}>Remaining points <b>{left}</b></span>}>
      <div className="cc-abilities">
        {KotOR.ABILITIES.map((key: string) => {
          const score: number = (c.attributes as any)[key];
          const next = Rules.raiseCost(score + 1);
          const canRaise = score < Rules.ABILITY_MAX && next <= left;
          const canLower = score > Rules.ABILITY_BASE;
          const set = (value: number) => update({ attributes: { ...c.attributes, [key]: value }, ...(key === 'int' ? { skillRanks: undefined } : {}) });
          const modifier = Rules.abilityModifier(score);
          return (
            <div key={key} className="cc-ability">
              <span className="cc-ability-name">{ABILITY_NAMES[key]}</span>
              <span className="cc-ability-mod" title="Modifier">{modifier >= 0 ? `+${modifier}` : modifier}</span>
              <Stepper label={ABILITY_NAMES[key]} value={score} onDown={canLower ? () => set(score - 1) : undefined} onUp={canRaise ? () => set(score + 1) : undefined} />
              <span className="cc-ability-cost" title="Cost of the next point">{score < Rules.ABILITY_MAX ? `${next} pt` : 'max'}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
});

// --- Feats and powers --------------------------------------------------------------------------

/** Pick lists: what the class gives by itself, what's picked, and what could be picked */
const PickList: React.FC<{
  title: string;
  automatic: number[];
  picked: number[];
  allowed: number;
  table: 'feat' | 'spells';
  options: { id: number; name: string }[];
  recommended: boolean;
  onChange: (picked: number[]) => void;
}> = ({ title, automatic, picked, allowed, table, options, recommended, onChange }) => {
  const name = (id: number) => Rules.text(Rules.row(table, id)?.name, String(Rules.row(table, id)?.label ?? id));
  const left = allowed - picked.length;
  const choosable = options.filter((o) => !picked.includes(o.id) && !automatic.includes(o.id));
  return (
    <Panel title={title} extra={<span className={`cc-points ${left < 0 ? 'over' : ''}`}>{recommended ? 'Recommended · ' : ''}Picks left <b>{left}</b></span>}>
      {automatic.length > 0 && (
        <div className="cc-picks">
          {automatic.map((id) => <span key={id} className="cc-pick locked" title="Given by the class">{name(id)}</span>)}
        </div>
      )}
      <div className="cc-picks">
        {picked.map((id) => (
          <button key={id} className="cc-pick" onClick={() => onChange(picked.filter((p) => p !== id))} title="Remove">{name(id)} <span aria-hidden="true">×</span></button>
        ))}
        {picked.length === 0 && <span className="cc-hint">None picked</span>}
      </div>
      {left > 0 && (
        <select className="cc-input" value="" onChange={(e) => e.target.value && onChange([...picked, Number(e.target.value)])} aria-label={`Add to ${title}`}>
          <option value="">Add…</option>
          {choosable.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
    </Panel>
  );
};

export const FeatsSection: React.FC<{ c: GMCharacter; update: Update; limits: ICharacterLimits; recommendedFeats: number[] }> = React.memo(({ c, update, limits, recommendedFeats }) => {
  const automatic = useMemo(() => Rules.automaticFeats(c.classId, c.level), [c.classId, c.level]);
  const feats = c.feats ?? recommendedFeats;
  const picked = feats.filter((f) => !automatic.includes(f));
  const options = useMemo(() => Rules.featOptions(c.classId, new Set(feats), c.level, limits), [c.classId, c.level, feats, limits]);
  return (
    <PickList
      title="Feats" table="feat" automatic={automatic} picked={picked} allowed={Rules.featGain(c.classId, c.level)} options={options}
      recommended={!c.feats}
      onChange={(next) => update({ feats: [...automatic, ...next] })}
    />
  );
});

export const PowersSection: React.FC<{ c: GMCharacter; update: Update; recommendedPowers: number[] }> = React.memo(({ c, update, recommendedPowers }) => {
  const powers = c.powers ?? recommendedPowers;
  const allowed = Rules.powerGain(c.classId, c.level);
  const options = useMemo(() => Rules.powerOptions(c.classId, new Set(powers), c.level), [c.classId, c.level, powers]);
  if (!allowed) return <Panel title="Force powers"><span className="cc-hint">This class doesn&apos;t use the Force.</span></Panel>;
  return (
    <PickList title="Force powers" table="spells" automatic={[]} picked={powers} allowed={allowed} options={options} recommended={!c.powers} onChange={(next) => update({ powers: next })} />
  );
});

// --- Skills ------------------------------------------------------------------------------------

export const SkillsSection: React.FC<{ c: GMCharacter; update: Update; recommendedSkills: number[] }> = React.memo(({ c, update, recommendedSkills }) => {
  const skills = useMemo(() => Rules.skillOptions(), []);
  const ranks = c.skillRanks ?? recommendedSkills;
  const points = Rules.skillPoints(c.classId, c.level, c.attributes.int);
  const left = points - Rules.skillsCost(c.classId, ranks);
  return (
    <Panel title="Skills" extra={<span className={`cc-points ${left < 0 ? 'over' : ''}`}>{c.skillRanks ? '' : 'Recommended · '}Points left <b>{left}</b></span>}>
      <div className="cc-skills">
        {skills.map((s) => {
          const rank = ranks[s.id] || 0;
          const cost = Rules.skillCost(c.classId, s.id);
          const max = Rules.skillMax(c.classId, s.id, c.level);
          const set = (value: number) => { const next = [...ranks]; while (next.length < skills.length) next.push(0); next[s.id] = value; update({ skillRanks: next }); };
          return (
            <div key={s.id} className="cc-skill">
              <span className="cc-skill-name">{s.name}{cost === 1 ? <span className="cc-tag">class</span> : null}</span>
              <Stepper label={s.name} value={`${rank}/${max}`} onDown={rank > 0 ? () => set(rank - 1) : undefined} onUp={rank < max && cost <= left ? () => set(rank + 1) : undefined} />
            </div>
          );
        })}
      </div>
    </Panel>
  );
});

// --- Gear --------------------------------------------------------------------------------------

export const GearSection: React.FC<{ c: GMCharacter; update: Update; limits: ICharacterLimits }> = React.memo(({ c, update, limits }) => {
  if (limits.gear === false) return <Panel title="Equipment"><span className="cc-hint">The GM chooses starting equipment in this session.</span></Panel>;
  const gear = c.gear || {};
  // The game's own items; the full lists arrive once GMItems has read them
  const [itemsRead, setItemsRead] = useState(0);
  useEffect(() => {
    const done = () => setItemsRead((n) => n + 1);
    KotOR.GMItems.listeners.add(done);
    return () => { KotOR.GMItems.listeners.delete(done); };
  }, []);
  const options = useMemo(() => {
    const all = KotOR.GMItems.options();
    return { weapons: all.weapons.filter((i: any) => i.resRef), armor: all.armor.filter((i: any) => i.resRef) };
  }, [itemsRead]);
  const slot = (key: 'rightHand' | 'leftHand' | 'armor', label: string, items: { resRef: string; label: string }[]) => (
    <label className="cc-field">
      <span>{label}</span>
      <select className="cc-input" value={gear[key] || ''} onChange={(e) => update({ gear: { ...gear, [key]: e.target.value } })}>
        <option value="">None</option>
        {gear[key] && !items.some((i) => i.resRef === gear[key]) && <option value={gear[key]}>{gear[key]}</option>}
        {items.map((i) => <option key={i.resRef} value={i.resRef}>{i.label}</option>)}
      </select>
    </label>
  );
  return (
    <Panel title="Equipment">
      <div className="cc-gear">
        {slot('rightHand', 'Right hand', options.weapons)}
        {slot('leftHand', 'Left hand', options.weapons)}
        {slot('armor', 'Armour', options.armor)}
      </div>
    </Panel>
  );
});

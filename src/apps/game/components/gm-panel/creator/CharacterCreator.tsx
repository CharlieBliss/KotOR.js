import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import type { GMCharacter } from "@/managers/gm/GMTypes";
import type { ICharacterLimits } from "@/engine/rules/CharacterRules";
import { GMManager, GMNetworkManager, GMPlayers } from "@/apps/game/components/gm-panel/gmPanelStore";
import { GameImage } from "@/apps/game/components/gm-panel/creator/GameImage";
import { ModelPreview } from "@/apps/game/components/gm-panel/creator/ModelPreview";
import { ABILITY_NAMES, creatorPortraits, portraitForModel } from "@/apps/game/components/gm-panel/creator/creatorData";
import {
  AttributesSection, ClassSection, FeatsSection, GearSection, LookSection, Panel, PowersSection, SkillsSection,
} from "@/apps/game/components/gm-panel/creator/sections";
import "@/apps/game/components/gm-panel/creator/creator.scss";

const Rules = KotOR.CharacterRules;
const Characters = KotOR.GMCharacters;

const SECTIONS = [
  { id: 'look', label: 'Look' },
  { id: 'class', label: 'Class' },
  { id: 'attributes', label: 'Attributes' },
  { id: 'feats', label: 'Feats' },
  { id: 'powers', label: 'Powers' },
  { id: 'skills', label: 'Skills' },
  { id: 'gear', label: 'Equipment' },
] as const;
type SectionId = typeof SECTIONS[number]['id'];

/** The limits characters are made under: the session's (once connected, or as the host), else the game's rules */
export function currentCreationLimits(): ICharacterLimits {
  if (GMNetworkManager.role === 'host') return GMPlayers.creationLimits || {};
  if (GMNetworkManager.role === 'client') return GMNetworkManager.sessionRules?.creation || {};
  return {};
}

/** A new character, with the portrait that goes with its body */
const newCharacter = (preset?: any): GMCharacter => {
  const c = Characters.blank(preset);
  const portrait = portraitForModel(c.appearanceId);
  return portrait ? { ...c, portraitId: portrait.id } : c;
};

const portraitTexture = (id: number) => creatorPortraits().find((p) => p.id === id)?.texture || '';
const className = (id: number) => Rules.classes().find((k: any) => k.id === id)?.name || `Class ${id}`;

/**
 * The character creator: the player's saved characters, and an editor in the style of the game's own
 * character generation screens. onUse (optional) offers a "Use" button that hands a character back.
 */
export const CharacterCreator: React.FC<{
  onClose: () => void;
  onUse?: (character: GMCharacter) => void;
  useLabel?: string;
  startEditing?: boolean;
}> = React.memo(({ onClose, onUse, useLabel = 'Use', startEditing = false }) => {
  const limits = useMemo(() => currentCreationLimits(), []);
  const game = KotOR.GameState.GameKey === KotOR.GameEngineType.TSL ? 'tsl' : 'kotor';
  const [list, setList] = useState<GMCharacter[]>(() => Characters.list());
  const [draft, setDraft] = useState<GMCharacter | null>(() => (startEditing ? newCharacter() : null));
  const [section, setSection] = useState<SectionId>('look');
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const refresh = () => setList(Characters.list());
    Characters.listeners.add(refresh);
    return () => { Characters.listeners.delete(refresh); };
  }, []);

  // Esc closes the editor (or the creator), without reaching the game's own Esc handling
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (draft) setDraft(null); else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [draft, onClose]);

  const update = useCallback((patch: Partial<GMCharacter>) => setDraft((d) => (d ? { ...d, ...patch } : d)), []);

  // What the rules give the draft: recommended picks, vitality, attack, saves and problems
  const derived = useMemo(() => {
    if (!draft) return null;
    const recommended = Characters.recommended(draft);
    const feats = draft.feats ?? recommended.feats;
    const vitality = KotOR.CharacterBuilder.vitalityWith(draft.classId, draft.level, draft.attributes, feats);
    const problems = Rules.validate({
      classId: draft.classId, level: draft.level, attributes: draft.attributes, appearanceId: draft.appearanceId,
      feats: draft.feats, powers: draft.powers, skillRanks: draft.skillRanks,
    }, limits);
    if (!draft.name.trim()) problems.unshift('Give your character a name.');
    return { recommended, vitality, bab: Rules.baseAttack(draft.classId, draft.level), saves: Rules.saves(draft.classId, draft.level), problems };
  }, [draft, limits]);

  const save = () => {
    if (!draft) return null;
    const saved = Characters.save({ ...draft, game });
    setDraft(saved);
    setMessage(`Saved ${saved.name}.`);
    return saved;
  };

  const importFile = async (file: File) => {
    const { character, problem } = Characters.fromFileText(await file.text());
    if (!character) { setMessage(problem || 'That file couldn\'t be read.'); return; }
    Characters.save({ ...character, game });
    setMessage(`Imported ${character.name}.`);
  };

  // --- The saved characters ----------------------------------------------------------------------
  if (!draft) {
    return (
      <div className="cc-backdrop" data-game={game}>
        <div className="cc-frame" role="dialog" aria-label="Characters">
          <div className="cc-titlebar">Character generation</div>
          <div className="cc-subtitle">Your characters</div>
          <div className="cc-list">
            {list.length === 0 && <div className="cc-empty">No characters yet. Make one, or import one from a file.</div>}
            {list.map((c) => (
              <div key={c.id} className="cc-card">
                <GameImage texture={portraitTexture(c.portraitId)} alt={c.name} className="cc-card-portrait" />
                <div className="cc-card-info">
                  <div className="cc-card-name">{c.name}</div>
                  <div className="cc-card-sub">{className(c.classId)} · level {c.level} · {c.appearanceLabel || `model ${c.appearanceId}`}</div>
                </div>
                <div className="cc-card-actions">
                  {onUse && <button className="cc-button primary" onClick={() => onUse(c)}>{useLabel}</button>}
                  <button className="cc-button" onClick={() => { setDraft({ ...c }); setSection('look'); }}>Edit</button>
                  <button className="cc-button" onClick={() => Characters.save({ ...c, id: '', name: `${c.name} (copy)` })}>Copy</button>
                  <button className="cc-button" onClick={() => Characters.download(c)}>Export</button>
                  <button className="cc-button danger" onClick={() => { if (confirm(`Delete ${c.name}?`)) Characters.remove(c.id); }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
          {message && <div className="cc-message" role="status">{message}</div>}
          <div className="cc-buttons">
            <button className="cc-button" onClick={onClose}>Back</button>
            <button className="cc-button" onClick={() => fileInput.current?.click()}>Import…</button>
            <select className="cc-button" value="" onChange={(e) => {
              if (e.target.value === '') return;
              const preset = e.target.value === 'blank' ? undefined : GMManager.PLAYER_PRESETS[Number(e.target.value)];
              setDraft(newCharacter(preset));
              setSection('look');
            }} aria-label="New character">
              <option value="">New character…</option>
              <option value="blank">Start from scratch</option>
              {GMManager.PLAYER_PRESETS.map((p: any, i: number) => <option key={i} value={i}>From {p.name}</option>)}
            </select>
            <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />
          </div>
        </div>
      </div>
    );
  }

  // --- The editor ------------------------------------------------------------------------------------
  const d = derived!;
  return (
    <div className="cc-backdrop" data-game={game}>
      <div className="cc-frame wide" role="dialog" aria-label="Character generation">
        <div className="cc-titlebar">Character generation</div>
        <nav className="cc-tabs" aria-label="Sections">
          {SECTIONS.map((s) => (
            <button key={s.id} className={`cc-tab ${section === s.id ? 'on' : ''}`} aria-current={section === s.id} onClick={() => setSection(s.id)}>{s.label}</button>
          ))}
        </nav>
        <div className="cc-body">
          <div className="cc-main">
            {section === 'look' && <LookSection c={draft} update={update} limits={limits} />}
            {section === 'class' && <ClassSection c={draft} update={update} limits={limits} />}
            {section === 'attributes' && <AttributesSection c={draft} update={update} limits={limits} />}
            {section === 'feats' && <FeatsSection c={draft} update={update} limits={limits} recommendedFeats={d.recommended.feats} />}
            {section === 'powers' && <PowersSection c={draft} update={update} recommendedPowers={d.recommended.powers} />}
            {section === 'skills' && <SkillsSection c={draft} update={update} recommendedSkills={d.recommended.skillRanks} />}
            {section === 'gear' && <GearSection c={draft} update={update} limits={limits} />}
          </div>
          <aside className="cc-side" aria-label="Summary">
            <ModelPreview character={draft} />
            <Panel title={draft.name || 'Unnamed'}>
              <div className="cc-summary-head">
                <GameImage texture={portraitTexture(draft.portraitId)} alt="Portrait" className="cc-summary-portrait" />
                <div>
                  <div className="cc-big">{className(draft.classId)}</div>
                  <div className="cc-hint">Level {draft.level}</div>
                </div>
              </div>
              <dl className="cc-stats">
                <dt>Vitality</dt><dd>{d.vitality.maxHp}</dd>
                <dt>Force</dt><dd>{d.vitality.maxFp}</dd>
                <dt>Attack</dt><dd>+{d.bab}</dd>
                <dt>Fortitude</dt><dd>{d.saves.fortitude + Rules.abilityModifier(draft.attributes.con)}</dd>
                <dt>Reflex</dt><dd>{d.saves.reflex + Rules.abilityModifier(draft.attributes.dex)}</dd>
                <dt>Will</dt><dd>{d.saves.will + Rules.abilityModifier(draft.attributes.wis)}</dd>
              </dl>
              <dl className="cc-stats">
                {KotOR.ABILITIES.map((k: string) => <React.Fragment key={k}><dt>{ABILITY_NAMES[k]}</dt><dd>{(draft.attributes as any)[k]}</dd></React.Fragment>)}
              </dl>
            </Panel>
            {d.problems.length > 0 && (
              <div className="cc-problems" role="alert">
                {d.problems.map((p: string) => <div key={p}>{p}</div>)}
              </div>
            )}
          </aside>
        </div>
        {message && <div className="cc-message" role="status">{message}</div>}
        <div className="cc-buttons">
          <button className="cc-button" onClick={() => { setDraft(null); setMessage(''); }}>Back</button>
          <button className="cc-button" title="Use the class's recommended feats, powers and skills" onClick={() => update({ feats: undefined, powers: undefined, skillRanks: undefined })}>Recommended</button>
          <button className="cc-button" onClick={save}>Save</button>
          {onUse && (
            <button className="cc-button primary" disabled={d.problems.length > 0} onClick={() => { const saved = save(); if (saved) onUse(saved); }}>
              Save &amp; {useLabel.toLowerCase()}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

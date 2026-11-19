import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import type {
  CareerAbilityKey,
  CareerSkillId,
  GMCareersCharacter,
} from "@/managers/gm/careers/types";
import { GameImage } from "@/apps/game/components/gm-panel/creator/GameImage";
import { ModelPreview } from "@/apps/game/components/gm-panel/creator/ModelPreview";
import { ModelList } from "@/apps/game/components/gm-panel/creator/ModelList";
import { creatorPortraits, portraitForModel } from "@/apps/game/components/gm-panel/creator/creatorData";
import { Panel } from "@/apps/game/components/gm-panel/creator/sections";
import "@/apps/game/components/gm-panel/creator/creator.scss";
import "@/apps/game/components/gm-panel/creator/careers-creator.scss";

const STEPS = [
  { id: 'species', label: '1. Species' },
  { id: 'model', label: '2. Model' },
  { id: 'career', label: '3. Career' },
  { id: 'characteristics', label: '4. Stats' },
  { id: 'free', label: '5. Free ranks' },
  { id: 'spend', label: '6. XP & Tree' },
  { id: 'name', label: '7. Name' },
] as const;
type StepId = typeof STEPS[number]['id'];

const SKILL_GROUPS: { id: string; label: string }[] = [
  { id: 'combat', label: 'Combat skills' },
  { id: 'engine', label: 'Engine skills' },
  { id: 'general', label: 'General & saves' },
  { id: 'social', label: 'Social skills' },
  { id: 'knowledge', label: 'Knowledge skills' },
];

const portraitTexture = (id: number) => creatorPortraits().find((p) => p.id === id)?.texture || '';

/**
 * Separate character creator for the Careers rule set (KotOR II).
 * Follows the 7-step creation flow: Species -> Model -> Career -> Characteristics -> Free ranks -> XP & Tree -> Name.
 */
export const CareersCreator: React.FC<{
  onClose: () => void;
  onUse?: (character: GMCareersCharacter) => void;
  useLabel?: string;
  startEditing?: boolean;
}> = React.memo(({ onClose, onUse, useLabel = 'Use', startEditing = false }) => {
  const Store = KotOR.GMCareersCharacters;
  const Rules = KotOR.CareersRules;

  const [list, setList] = useState<GMCareersCharacter[]>(() => Store.list());
  const [draft, setDraft] = useState<GMCareersCharacter | null>(() => (startEditing ? Store.blank() : null));
  const [step, setStep] = useState<StepId>('species');
  const [spendTab, setSpendTab] = useState<'tree' | 'skills' | 'powers'>('tree');
  const [pickingCharNode, setPickingCharNode] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const refresh = () => setList(Store.list());
    Store.listeners.add(refresh);
    return () => { Store.listeners.delete(refresh); };
  }, [Store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (draft) setDraft(null); else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [draft, onClose]);

  const update = useCallback((patch: Partial<GMCareersCharacter>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }, []);

  const derived = useMemo(() => (draft ? Rules.derive(draft) : null), [draft, Rules]);
  const problems = useMemo(() => (draft ? Rules.validate(draft) : []), [draft, Rules]);

  const save = () => {
    if (!draft) return null;
    const saved = Store.save(draft);
    setDraft(saved);
    setMessage(`Saved ${saved.name || 'character'}.`);
    return saved;
  };

  const importFile = async (file: File) => {
    const { character, problem } = Store.fromFileText(await file.text());
    if (!character) { setMessage(problem || 'That file couldn\'t be read.'); return; }
    Store.save(character);
    setMessage(`Imported ${character.name}.`);
  };

  /** Switching species resets characteristics, free ranks, and default appearance */
  const pickSpecies = (speciesId: string) => {
    if (!draft) return;
    const sp = KotOR.CAREERS_SPECIES_BY_ID.get(speciesId);
    if (!sp) return;
    const label = KotOR.AppearanceManager?.appearances?.get(sp.defaultAppearanceId)?.label || '';
    const forceOk = !sp.forceIneligible && (sp.forceSensitive || KotOR.CAREERS_BY_ID.get(draft.careerId)?.forceSensitive);
    // A species that can't take the current career (a droid Jedi) moves to the first career it can take
    const careerReset = KotOR.CareersRules.careerAllowed(sp.id, draft.careerId) ? {} : (() => {
      const career = KotOR.CAREERS_LIST.find((c) => KotOR.CareersRules.careerAllowed(sp.id, c.id));
      if (!career) return {};
      const startingSpecId = career.specializations[0];
      return {
        careerId: career.id, startingSpecId, specializations: [startingSpecId], nodes: { [startingSpecId]: [] }, nodeChoices: {},
        freeCareerSkills: [], freeSpecSkills: [], gear: KotOR.CareersRules.kitFor(career.id, sp.id),
      };
    })();
    update({
      speciesId: sp.id,
      characteristics: { ...sp.characteristics },
      appearanceId: sp.defaultAppearanceId,
      appearanceLabel: label,
      portraitId: sp.defaultPortraitId,
      freeCareerSkills: draft.freeCareerSkills.slice(0, sp.freeCareerSkills),
      freeSpeciesSkills: sp.freeNonCareerSkills ? draft.freeSpeciesSkills.slice(0, sp.freeNonCareerSkills) : [],
      powers: forceOk ? draft.powers : [],
      // Droids and organics wear different things
      gear: KotOR.CareersRules.kitFor(draft.careerId, sp.id),
      ...careerReset,
    });
  };

  /** Switching career resets starting specialization, tree nodes, free ranks, and starting kit */
  const pickCareer = (careerId: string) => {
    if (!draft) return;
    const career = KotOR.CAREERS_BY_ID.get(careerId);
    if (!career) return;
    const startingSpecId = career.specializations[0];
    const sp = KotOR.CAREERS_SPECIES_BY_ID.get(draft.speciesId);
    const forceOk = !!sp && !sp.forceIneligible && (sp.forceSensitive || career.forceSensitive);
    update({
      careerId: career.id,
      startingSpecId,
      specializations: [startingSpecId],
      freeCareerSkills: [],
      freeSpecSkills: [],
      freeSpeciesSkills: [],
      nodes: { [startingSpecId]: [] },
      nodeChoices: {},
      powers: forceOk ? draft.powers : [],
      gear: KotOR.CareersRules.kitFor(career.id, draft.speciesId),
    });
  };

  // --- Saved Careers characters list -------------------------------------------------------------
  if (!draft) {
    return (
      <div className="cc-backdrop" data-game="tsl">
        <div className="cc-frame" role="dialog" aria-label="Careers characters">
          <div className="cc-titlebar">Careers character generation</div>
          <div className="cc-subtitle">Your Careers characters (KotOR II)</div>
          <div className="cc-list">
            {list.length === 0 && <div className="cc-empty">No Careers characters yet. Make one, or import a .kotorjs-careers.json file.</div>}
            {list.map((c) => {
              const sp = KotOR.CAREERS_SPECIES_BY_ID.get(c.speciesId);
              const car = KotOR.CAREERS_BY_ID.get(c.careerId);
              const spec = KotOR.CAREERS_SPEC_BY_ID.get(c.startingSpecId);
              const d = Rules.derive(c);
              return (
                <div key={c.id} className="cc-card">
                  <GameImage texture={portraitTexture(c.portraitId)} alt={c.name} className="cc-card-portrait" />
                  <div className="cc-card-info">
                    <div className="cc-card-name">{c.name || 'Unnamed'}</div>
                    <div className="cc-card-sub">
                      {sp?.name || c.speciesId} · {car?.name || c.careerId} ({spec?.name || c.startingSpecId}) · Lv.{d.level} · {d.totalXpRemaining} XP left
                    </div>
                  </div>
                  <div className="cc-card-actions">
                    {onUse && <button className="cc-button primary" onClick={() => onUse(c)}>{useLabel}</button>}
                    <button className="cc-button" onClick={() => { setDraft({ ...c }); setStep('species'); }}>Edit</button>
                    <button className="cc-button" onClick={() => Store.save({ ...c, id: '', name: `${c.name} (copy)` })}>Copy</button>
                    <button className="cc-button" onClick={() => Store.download(c)}>Export</button>
                    <button className="cc-button danger" onClick={() => { if (confirm(`Delete ${c.name}?`)) Store.remove(c.id); }}>Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
          {message && <div className="cc-message" role="status">{message}</div>}
          <div className="cc-buttons">
            <button className="cc-button" onClick={onClose}>Back</button>
            <button className="cc-button" onClick={() => fileInput.current?.click()}>Import…</button>
            <button className="cc-button primary" onClick={() => { setDraft(Store.blank()); setStep('species'); }}>New Careers character</button>
            <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />
          </div>
        </div>
      </div>
    );
  }

  // --- 7-step editor -----------------------------------------------------------------------------
  const d = derived!;
  const species = KotOR.CAREERS_SPECIES_BY_ID.get(draft.speciesId)!;
  const career = KotOR.CAREERS_BY_ID.get(draft.careerId)!;
  const spec = KotOR.CAREERS_SPEC_BY_ID.get(draft.startingSpecId)!;
  const freeRanks = Rules.freeRanksOf(draft);

  const toggleFreeSkill = (field: 'freeCareerSkills' | 'freeSpecSkills' | 'freeSpeciesSkills', skillId: CareerSkillId, limit: number) => {
    const cur = draft[field] || [];
    if (cur.includes(skillId)) {
      update({ [field]: cur.filter((s) => s !== skillId) });
    } else if (cur.length < limit) {
      update({ [field]: [...cur, skillId] });
    }
  };

  const adjustCharacteristic = (ability: CareerAbilityKey, delta: 1 | -1) => {
    const base = species.characteristics[ability];
    const cur = draft.characteristics[ability];
    if (delta === -1) {
      if (cur <= base) return;
      update({ characteristics: { ...draft.characteristics, [ability]: cur - 1 } });
      return;
    }
    const check = Rules.canRaiseCharacteristic(draft, ability);
    if (!check.ok) return;
    update({ characteristics: { ...draft.characteristics, [ability]: check.nextValue } });
  };

  const adjustSkill = (skillId: CareerSkillId, delta: 1 | -1) => {
    const bought = draft.boughtSkillRanks[skillId] || 0;
    if (delta === -1) {
      if (bought <= 0) return;
      const next = { ...draft.boughtSkillRanks };
      if (bought - 1 === 0) delete next[skillId];
      else next[skillId] = bought - 1;
      update({ boughtSkillRanks: next });
      return;
    }
    const check = Rules.canBuySkillRank(draft, skillId, draft.campaignXpSpent === 0, true);
    if (!check.ok) return;
    update({ boughtSkillRanks: { ...draft.boughtSkillRanks, [skillId]: bought + 1 } });
  };

  const toggleNode = (nodeId: string, ability?: CareerAbilityKey) => {
    const owned = draft.nodes[spec.id] || [];
    const node = spec.nodes.find((n) => n.id === nodeId);
    if (owned.includes(nodeId)) {
      if (!Rules.canRemoveNode(draft, spec.id, nodeId)) {
        setMessage('Refund lower linked nodes first.');
        return;
      }
      const nextChoices = { ...(draft.nodeChoices || {}) };
      delete nextChoices[Rules.nodeChoiceKey(spec.id, nodeId)];
      setPickingCharNode(null);
      update({ nodes: { ...draft.nodes, [spec.id]: owned.filter((id) => id !== nodeId) }, nodeChoices: nextChoices });
      return;
    }
    if (node?.kind === 'characteristic' && !ability) {
      const check = Rules.canBuyNode(draft, spec.id, nodeId, true);
      if (!check.ok) {
        if (check.reason) setMessage(check.reason);
        return;
      }
      setPickingCharNode(pickingCharNode === nodeId ? null : nodeId);
      return;
    }
    const check = Rules.canBuyNode(draft, spec.id, nodeId, true, ability);
    if (!check.ok) {
      if (check.reason) setMessage(check.reason);
      return;
    }
    setPickingCharNode(null);
    const nextChoices = ability
      ? { ...(draft.nodeChoices || {}), [Rules.nodeChoiceKey(spec.id, nodeId)]: ability }
      : draft.nodeChoices;
    update({
      nodes: { ...draft.nodes, [spec.id]: [...owned, nodeId] },
      ...(nextChoices ? { nodeChoices: nextChoices } : {}),
    });
  };

  const togglePower = (spellId: number) => {
    if (draft.powers.includes(spellId)) {
      update({ powers: draft.powers.filter((id) => id !== spellId) });
      return;
    }
    const check = Rules.canBuyPower(draft, spellId, true);
    if (!check.ok) {
      if (check.reason) setMessage(check.reason);
      return;
    }
    update({ powers: [...draft.powers, spellId] });
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="cc-backdrop" data-game="tsl">
      <div className="cc-frame wide" role="dialog" aria-label="Careers character generation">
        <div className="cc-titlebar">Careers character generation</div>
        <nav className="cc-tabs" aria-label="Creation steps">
          {STEPS.map((s) => (
            <button key={s.id} className={`cc-tab ${step === s.id ? 'on' : ''}`} aria-current={step === s.id} onClick={() => setStep(s.id)}>{s.label}</button>
          ))}
        </nav>

        <div className="cc-body">
          <div className="cc-main">
            <div className="cc-xp-bar">
              <span>Starting XP: <strong>{d.startingXpRemaining}</strong> / {d.startingXpBudget} remaining</span>
              <span>Level {d.level} · {species.name} {career.name} ({spec.name})</span>
            </div>

            {step === 'species' && (
              <div>
                <div className="cc-choice-grid">
                  {KotOR.CAREERS_SPECIES.map((sp) => (
                    <button
                      key={sp.id}
                      className={`cc-choice-card ${draft.speciesId === sp.id ? 'on' : ''}`}
                      onClick={() => pickSpecies(sp.id)}
                    >
                      <div className="cc-choice-title">
                        <span>{sp.name}</span>
                        <span>{sp.startingXp} XP</span>
                      </div>
                      <div className="cc-choice-meta">
                        STR {sp.characteristics.str} · DEX {sp.characteristics.dex} · CON {sp.characteristics.con} · INT {sp.characteristics.int} · WIS {sp.characteristics.wis} · CHA {sp.characteristics.cha}
                      </div>
                      <div className="cc-choice-desc">{sp.description}</div>
                      <div className="cc-choice-meta">{sp.abilitySummary}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 'model' && (
              <div>
                <div className="cc-hint" style={{ marginBottom: 8 }}>
                  Species: <strong>{species.name}</strong> ({species.modelType === 'B' ? 'body + head, visible armour' : 'fixed full model, stats apply'}).
                </div>
                <ModelList
                  selected={draft.appearanceId}
                  playerBodiesOnly={false}
                  onPick={(id, label) => {
                    const p = portraitForModel(id);
                    update({ appearanceId: id, appearanceLabel: label, ...(p ? { portraitId: p.id, gender: p.gender } : {}) });
                  }}
                />
              </div>
            )}

            {step === 'career' && (
              <div className="cc-choice-grid">
                {KotOR.CAREERS_LIST.map((car) => {
                  const startSpec = KotOR.CAREERS_SPEC_BY_ID.get(car.specializations[0]);
                  const allowed = KotOR.CareersRules.careerAllowed(draft.speciesId, car.id);
                  return (
                    <button
                      key={car.id}
                      className={`cc-choice-card ${draft.careerId === car.id ? 'on' : ''}`}
                      onClick={() => pickCareer(car.id)}
                      disabled={!allowed}
                      title={allowed ? undefined : `${KotOR.CAREERS_SPECIES_BY_ID.get(draft.speciesId)?.name || 'This species'} can never use the Force`}
                    >
                      <div className="cc-choice-title">
                        <span>{car.name}</span>
                        <span>{car.forceSensitive ? 'Force-sensitive' : 'Martial'}</span>
                      </div>
                      <div className="cc-choice-meta">Starting spec: {startSpec?.name}</div>
                      <div className="cc-choice-desc">{car.description}</div>
                      <div className="cc-choice-meta">
                        Skills: {car.careerSkills.map((id) => KotOR.CAREER_SKILL_BY_ID.get(id)?.name || id).join(', ')}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {step === 'characteristics' && (
              <div>
                <div className="cc-hint" style={{ marginBottom: 8 }}>
                  Spend starting XP to raise characteristics (cost = 10 × new value, max 5 at creation). KotOR score = 6 + 2 × value.
                </div>
                {KotOR.CAREER_ABILITIES.map((k) => {
                  const base = species.characteristics[k];
                  const val = draft.characteristics[k];
                  const kotor = d.kotorAttributes[k];
                  const mod = d.modifiers[k];
                  const check = Rules.canRaiseCharacteristic(draft, k);
                  const lbl = KotOR.CAREER_ABILITY_LABELS[k];
                  return (
                    <div key={k} className="cc-char-row">
                      <strong>{lbl.kotor} ({lbl.short})</strong>
                      <span>FFG {val} → KotOR {kotor} ({mod >= 0 ? `+${mod}` : mod})</span>
                      <button className="cc-button" disabled={val <= base} onClick={() => adjustCharacteristic(k, -1)}>−</button>
                      <button className="cc-button" disabled={!check.ok} title={check.reason || `Raise to ${check.nextValue} (${check.cost} XP)`} onClick={() => adjustCharacteristic(k, 1)}>
                        +{check.nextValue <= 5 ? ` (${check.cost} XP)` : ''}
                      </button>
                      <span className="cc-hint">base {base}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {step === 'free' && (
              <div>
                <div className="cc-hint">
                  Pick <strong>{species.freeCareerSkills}</strong> free career skills ({draft.freeCareerSkills.length}/{species.freeCareerSkills}):
                </div>
                <div className="cc-free-chips">
                  {career.careerSkills.map((id) => {
                    const on = draft.freeCareerSkills.includes(id);
                    const def = KotOR.CAREER_SKILL_BY_ID.get(id)!;
                    return (
                      <button
                        key={id}
                        className={`cc-chip ${on ? 'on' : ''}`}
                        disabled={!on && draft.freeCareerSkills.length >= species.freeCareerSkills}
                        onClick={() => toggleFreeSkill('freeCareerSkills', id, species.freeCareerSkills)}
                      >
                        {def.name}
                      </button>
                    );
                  })}
                </div>

                <div className="cc-hint">
                  Pick <strong>2</strong> free {spec.name} specialization skills ({draft.freeSpecSkills.length}/2):
                </div>
                <div className="cc-free-chips">
                  {spec.bonusSkills.map((id) => {
                    const on = draft.freeSpecSkills.includes(id);
                    const def = KotOR.CAREER_SKILL_BY_ID.get(id)!;
                    return (
                      <button
                        key={id}
                        className={`cc-chip ${on ? 'on' : ''}`}
                        disabled={!on && draft.freeSpecSkills.length >= 2}
                        onClick={() => toggleFreeSkill('freeSpecSkills', id, 2)}
                      >
                        {def.name}{draft.freeCareerSkills.includes(id) ? ' (→ rank 2)' : ''}
                      </button>
                    );
                  })}
                </div>

                {species.freeNonCareerSkills > 0 && (
                  <>
                    <div className="cc-hint">
                      {species.name} bonus — pick <strong>{species.freeNonCareerSkills}</strong> non-career skills ({draft.freeSpeciesSkills.length}/{species.freeNonCareerSkills}):
                    </div>
                    <div className="cc-free-chips">
                      {KotOR.CAREER_SKILLS.filter((s) => !d.careerSkills.has(s.id)).map((def) => {
                        const on = draft.freeSpeciesSkills.includes(def.id);
                        return (
                          <button
                            key={def.id}
                            className={`cc-chip ${on ? 'on' : ''}`}
                            disabled={!on && draft.freeSpeciesSkills.length >= species.freeNonCareerSkills}
                            onClick={() => toggleFreeSkill('freeSpeciesSkills', def.id, species.freeNonCareerSkills)}
                          >
                            {def.name}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {step === 'spend' && (
              <div>
                <div className="cc-chips" style={{ marginBottom: 10 }}>
                  <button className={`cc-chip ${spendTab === 'tree' ? 'on' : ''}`} onClick={() => setSpendTab('tree')}>{spec.name} tree</button>
                  <button className={`cc-chip ${spendTab === 'skills' ? 'on' : ''}`} onClick={() => setSpendTab('skills')}>Skills</button>
                  {d.forceSensitive && (
                    <button className={`cc-chip ${spendTab === 'powers' ? 'on' : ''}`} onClick={() => setSpendTab('powers')}>Force powers ({draft.powers.length})</button>
                  )}
                </div>

                {spendTab === 'tree' && (
                  <div>
                    <div className="cc-hint">
                      Rows cost 5 / 10 / 15 / 20 XP. Top row is open; lower rows need a link to an owned neighbour.
                    </div>
                    <div className="cc-tree-grid">
                      {spec.nodes.map((node) => {
                        const owned = (draft.nodes[spec.id] || []).includes(node.id);
                        const check = Rules.canBuyNode(draft, spec.id, node.id, true);
                        const cost = Rules.nodeCost(node.row);
                        const cls = owned ? 'owned' : check.ok ? 'available' : 'locked';
                        const talent = node.kind === 'talent' && node.talentId ? KotOR.CAREERS_TALENT_BY_ID.get(node.talentId) : undefined;
                        const chosenAbility = node.kind === 'characteristic' ? draft.nodeChoices?.[Rules.nodeChoiceKey(spec.id, node.id)] : undefined;
                        const tag = node.kind === 'talent'
                          ? (talent?.activation === 'active' ? `Active · ${talent.strainCost || 0} Strain` : 'Passive talent')
                          : node.kind === 'feat' ? 'Feat'
                          : node.kind === 'career_skill' ? 'Career skill'
                          : node.kind === 'characteristic' ? (chosenAbility ? `+1 ${chosenAbility.toUpperCase()}` : '+1 Characteristic')
                          : 'Capstone (Lv.17+)';
                        return (
                          <button
                            key={node.id}
                            className={`cc-tree-node ${cls}`}
                            title={owned ? 'Click to refund' : (check.reason || `Buy for ${cost} XP`)}
                            onClick={() => toggleNode(node.id)}
                          >
                            <div className="cc-node-head">
                              <span>{node.label}</span>
                              <span className="cc-node-cost">{owned ? 'Owned' : `${cost} XP`}</span>
                            </div>
                            <div className="cc-choice-meta">{tag}</div>
                            <div className="cc-node-desc">{node.description}</div>
                          </button>
                        );
                      })}
                    </div>
                    {pickingCharNode && (
                      <div className="cc-free-chips" style={{ marginTop: 8 }}>
                        <span className="cc-hint">Pick +1 characteristic for Dedication:</span>
                        {KotOR.CAREER_ABILITIES.map((ab) => {
                          const cur = d.effectiveCharacteristics[ab];
                          return (
                            <button
                              key={ab}
                              className="cc-chip"
                              disabled={cur >= 6}
                              onClick={() => toggleNode(pickingCharNode, ab)}
                            >
                              {KotOR.CAREER_ABILITY_LABELS[ab].short} ({cur} → {cur + 1})
                            </button>
                          );
                        })}
                        <button className="cc-chip" onClick={() => setPickingCharNode(null)}>Cancel</button>
                      </div>
                    )}
                  </div>
                )}

                {spendTab === 'skills' && (
                  <div>
                    <div className="cc-hint" style={{ marginBottom: 8 }}>
                      Career skills cost 5 × new rank; non-career cost 5 × new rank + 5. Max rank 2 at creation.
                    </div>
                    {SKILL_GROUPS.map((grp) => (
                      <div key={grp.id} className="cc-skill-group">
                        <h4>{grp.label}</h4>
                        {KotOR.CAREER_SKILLS.filter((s) => s.category === grp.id).map((def) => {
                          const isCareer = d.careerSkills.has(def.id);
                          const free = freeRanks[def.id] || 0;
                          const bought = draft.boughtSkillRanks[def.id] || 0;
                          const rank = free + bought;
                          const check = Rules.canBuySkillRank(draft, def.id, draft.campaignXpSpent === 0, true);
                          return (
                            <div key={def.id} className={`cc-skill-row ${isCareer ? 'career' : ''}`}>
                              <span>
                                {def.name} <small>({KotOR.CAREER_ABILITY_LABELS[def.ability].short}{isCareer ? ' · career' : ''})</small>
                              </span>
                              <span>Rank {rank}</span>
                              <button className="cc-button" disabled={bought <= 0} onClick={() => adjustSkill(def.id, -1)}>−</button>
                              <button className="cc-button" disabled={!check.ok} title={check.reason || `Buy rank ${check.nextRank} (${check.cost} XP)`} onClick={() => adjustSkill(def.id, 1)}>
                                +{check.ok ? ` (${check.cost} XP)` : ''}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}

                {spendTab === 'powers' && d.forceSensitive && (
                  <div className="cc-choice-grid">
                    {KotOR.CAREERS_STARTER_POWERS.map((p) => {
                      const owned = draft.powers.includes(p.spellId);
                      const check = Rules.canBuyPower(draft, p.spellId, true);
                      const wrongSide = p.alignment !== 'universal' && p.alignment !== draft.alignment;
                      return (
                        <button
                          key={p.spellId}
                          className={`cc-choice-card ${owned ? 'on' : ''}`}
                          disabled={!owned && !check.ok}
                          title={owned ? 'Click to refund' : (check.reason || `Learn for ${p.xpCost} XP`)}
                          onClick={() => togglePower(p.spellId)}
                        >
                          <div className="cc-choice-title">
                            <span>{p.name}</span>
                            <span>{owned ? 'Known' : `${p.xpCost} XP`}</span>
                          </div>
                          <div className="cc-choice-meta">{p.alignment}{wrongSide ? ` (requires ${p.alignment} alignment)` : ''}</div>
                          <div className="cc-choice-desc">{p.description}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {step === 'name' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label className="cc-field">
                  <span>Character name</span>
                  <input
                    className="cc-input"
                    value={draft.name}
                    placeholder={`${species.name} ${career.name}`}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                </label>
                <div className="cc-field">
                  <span>Alignment (controls which Force powers you can learn)</span>
                  <div className="cc-chips">
                    <button
                      className={`cc-chip ${draft.alignment === 'light' ? 'on' : ''}`}
                      onClick={() => update({
                        alignment: 'light',
                        powers: draft.powers.filter((id) => KotOR.CAREERS_POWER_BY_ID.get(id)?.alignment !== 'dark'),
                      })}
                    >
                      Light side
                    </button>
                    <button
                      className={`cc-chip ${draft.alignment === 'dark' ? 'on' : ''}`}
                      onClick={() => update({
                        alignment: 'dark',
                        powers: draft.powers.filter((id) => KotOR.CAREERS_POWER_BY_ID.get(id)?.alignment !== 'light'),
                      })}
                    >
                      Dark side
                    </button>
                  </div>
                </div>
                <div className="cc-hint">
                  Starting kit: weapon <code>{draft.gear?.rightHand || 'none'}</code>, armour <code>{draft.gear?.armor || 'none'}</code>.
                  Leftover starting XP ({d.startingXpRemaining}) carries over and never counts toward level.
                </div>
              </div>
            )}
          </div>

          <aside className="cc-side" aria-label="Summary">
            <ModelPreview character={draft} />
            <Panel title={draft.name || 'Unnamed'}>
              <div className="cc-summary-head">
                <GameImage texture={portraitTexture(draft.portraitId)} alt="Portrait" className="cc-summary-portrait" />
                <div>
                  <div className="cc-big">{species.name} {career.name}</div>
                  <div className="cc-hint">{spec.name} · Level {d.level}</div>
                </div>
              </div>
              <dl className="cc-stats">
                <dt>Vitality</dt><dd>{d.maxHp}</dd>
                <dt>Strain</dt><dd>{d.maxStrain}</dd>
                <dt>Force</dt><dd>{d.maxFp}</dd>
                <dt>Defence</dt><dd>{d.baseDefense}</dd>
                <dt>Fortitude</dt><dd>{d.saves.fortitude >= 0 ? `+${d.saves.fortitude}` : d.saves.fortitude}</dd>
                <dt>Reflex</dt><dd>{d.saves.reflex >= 0 ? `+${d.saves.reflex}` : d.saves.reflex}</dd>
                <dt>Will</dt><dd>{d.saves.will >= 0 ? `+${d.saves.will}` : d.saves.will}</dd>
              </dl>
              <dl className="cc-stats">
                {KotOR.CAREER_ABILITIES.map((k) => (
                  <React.Fragment key={k}>
                    <dt>{KotOR.CAREER_ABILITY_LABELS[k].short}</dt>
                    <dd>{d.effectiveCharacteristics[k]} ({d.kotorAttributes[k]})</dd>
                  </React.Fragment>
                ))}
              </dl>
            </Panel>
            {problems.length > 0 && (
              <div className="cc-problems" role="alert">
                {problems.map((p) => <div key={p}>{p}</div>)}
              </div>
            )}
          </aside>
        </div>

        {message && <div className="cc-message" role="status">{message}</div>}
        <div className="cc-buttons">
          <button className="cc-button" onClick={() => { setDraft(null); setMessage(''); }}>Back</button>
          {stepIndex > 0 && (
            <button className="cc-button" onClick={() => setStep(STEPS[stepIndex - 1].id)}>Previous</button>
          )}
          {stepIndex < STEPS.length - 1 && (
            <button className="cc-button" onClick={() => setStep(STEPS[stepIndex + 1].id)}>Next</button>
          )}
          <button className="cc-button" onClick={save}>Save</button>
          {onUse && (
            <button className="cc-button primary" disabled={problems.length > 0} onClick={() => { const saved = save(); if (saved) onUse(saved); }}>
              Save &amp; {useLabel.toLowerCase()}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

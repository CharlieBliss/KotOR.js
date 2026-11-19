import React, { useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import type { CareersPurchaseRequest, GMCareersCharacter } from "@/managers/gm/careers/types";
import "@/apps/game/components/gm-panel/creator/careers-creator.scss";

/**
 * In-play Careers advancement & narrative skills tab inside CharacterSheet.
 * Players send 'spend_xp' intents to the host; GMs (or offline hosts) apply purchases directly.
 */
export const CareersSheetSection: React.FC<{
  creature: any;
  gmView: boolean;
}> = ({ creature, gmView }) => {
  const [subTab, setSubTab] = useState<'tree' | 'skills' | 'powers' | 'log'>('tree');
  const [note, setNote] = useState('');

  const runtime = creature?.careersRules;
  const character: GMCareersCharacter | undefined = runtime?.character || creature?.gmPlayerConfig?.careers;
  if (!character) {
    return <div className="cc-hint">No Careers character sheet attached.</div>;
  }

  const Rules = KotOR.CareersRules;
  const derived = Rules.derive(character);
  const strain = runtime?.getStrainState?.() || { strain: 0, maxStrain: derived.maxStrain, windedSeconds: 0 };
  const inCombat = !!creature?.combatData?.combatState;
  const spec = KotOR.CAREERS_SPEC_BY_ID.get(character.startingSpecId);

  const buy = (purchase: CareersPurchaseRequest) => {
    setNote('');
    if (inCombat) {
      setNote('XP can only be spent outside combat.');
      return;
    }
    if (!gmView && KotOR.GMNetworkManager.role === 'client') {
      KotOR.GMNetworkManager.sendIntent('spend_xp', undefined, { purchase });
      setNote('Sent XP purchase to host…');
      return;
    }
    const ok = KotOR.GMPlayers.spendXpOnHost(creature, purchase);
    if (!ok) setNote('Purchase could not be applied.');
  };

  return (
    <div>
      <div className="cc-xp-bar">
        <span>
          Available XP: <strong>{derived.totalXpRemaining}</strong>
          {' '}(starting {derived.startingXpRemaining} · campaign {derived.campaignXpRemaining})
        </span>
        <span>
          Strain: <strong>{Math.round(strain.strain)} / {strain.maxStrain}</strong>
          {strain.windedSeconds > 0 ? ` · WINDED (${Math.ceil(strain.windedSeconds)}s)` : ''}
        </span>
      </div>

      {inCombat && (
        <div className="cc-hint" style={{ marginBottom: 8 }}>
          In combat — XP spending unlocks once the fight ends.
        </div>
      )}

      <div className="cc-chips" style={{ marginBottom: 10 }}>
        <button className={`cc-chip ${subTab === 'tree' ? 'on' : ''}`} onClick={() => setSubTab('tree')}>
          {spec?.name || 'Tree'}
        </button>
        <button className={`cc-chip ${subTab === 'skills' ? 'on' : ''}`} onClick={() => setSubTab('skills')}>
          Skills ({KotOR.CAREER_SKILLS.length})
        </button>
        {derived.forceSensitive && (
          <button className={`cc-chip ${subTab === 'powers' ? 'on' : ''}`} onClick={() => setSubTab('powers')}>
            Force powers ({character.powers.length})
          </button>
        )}
        <button className={`cc-chip ${subTab === 'log' ? 'on' : ''}`} onClick={() => setSubTab('log')}>
          XP log ({character.xpLog?.length || 0})
        </button>
      </div>

      {subTab === 'tree' && spec && (
        <div className="cc-tree-grid">
          {spec.nodes.map((node) => {
            const owned = (character.nodes?.[spec.id] || []).includes(node.id);
            const check = Rules.canBuyNode(character, spec.id, node.id);
            const cost = Rules.nodeCost(node.row);
            const cls = owned ? 'owned' : (!inCombat && check.ok) ? 'available' : 'locked';
            return (
              <button
                key={node.id}
                className={`cc-tree-node ${cls}`}
                disabled={owned || inCombat || !check.ok}
                title={owned ? 'Owned' : (inCombat ? 'Wait until out of combat' : (check.reason || `Buy for ${cost} XP`))}
                onClick={() => buy({ kind: 'node', specId: spec.id, nodeId: node.id })}
              >
                <div className="cc-node-head">
                  <span>{node.label}</span>
                  <span className="cc-node-cost">{owned ? 'Owned' : `${cost} XP`}</span>
                </div>
                <div className="cc-node-desc">{node.description}</div>
              </button>
            );
          })}
        </div>
      )}

      {subTab === 'skills' && (
        <div>
          {KotOR.CAREER_SKILLS.map((def) => {
            const rank = derived.skillRanks[def.id] || 0;
            const isCareer = derived.careerSkills.has(def.id);
            const check = Rules.canBuySkillRank(character, def.id, false);
            return (
              <div key={def.id} className={`cc-skill-row ${isCareer ? 'career' : ''}`}>
                <span>
                  {def.name} <small>({KotOR.CAREER_ABILITY_LABELS[def.ability].short}{isCareer ? ' · career' : ''})</small>
                </span>
                <span>Rank {rank}</span>
                <span className="cc-hint">{def.category}</span>
                <button
                  className="cc-button"
                  disabled={inCombat || !check.ok}
                  title={inCombat ? 'Wait until out of combat' : (check.reason || `Buy rank ${check.nextRank} (${check.cost} XP)`)}
                  onClick={() => buy({ kind: 'skill', skillId: def.id })}
                >
                  +{check.ok ? ` (${check.cost} XP)` : ''}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {subTab === 'powers' && derived.forceSensitive && (
        <div className="cc-choice-grid">
          {KotOR.CAREERS_STARTER_POWERS.map((p) => {
            const owned = character.powers.includes(p.spellId);
            const check = Rules.canBuyPower(character, p.spellId);
            return (
              <button
                key={p.spellId}
                className={`cc-choice-card ${owned ? 'on' : ''}`}
                disabled={owned || inCombat || !check.ok}
                title={owned ? 'Known' : (inCombat ? 'Wait until out of combat' : (check.reason || `Learn for ${p.xpCost} XP`))}
                onClick={() => buy({ kind: 'power', spellId: p.spellId })}
              >
                <div className="cc-choice-title">
                  <span>{p.name}</span>
                  <span>{owned ? 'Known' : `${p.xpCost} XP`}</span>
                </div>
                <div className="cc-choice-meta">{p.alignment}</div>
                <div className="cc-choice-desc">{p.description}</div>
              </button>
            );
          })}
        </div>
      )}

      {subTab === 'log' && (
        <div>
          {(character.xpLog || []).length === 0 ? (
            <div className="cc-hint">No campaign XP awarded yet.</div>
          ) : (
            (character.xpLog || []).slice().reverse().map((e, i) => (
              <div key={i} className="cc-skill-row">
                <strong>+{e.amount} XP</strong>
                <span>{e.reason || 'GM award'}</span>
                <span className="cc-hint">{new Date(e.at).toLocaleTimeString()}</span>
                <span />
              </div>
            ))
          )}
        </div>
      )}

      {note && <div className="cc-message" role="status">{note}</div>}
    </div>
  );
};

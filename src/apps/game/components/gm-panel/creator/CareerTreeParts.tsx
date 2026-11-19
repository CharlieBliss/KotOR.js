import React from "react";
import * as KotOR from "@/apps/game/KotOR";
import type {
  CareerAbilityKey,
  CareerAttributes,
  CareerPowerTreeDef,
  CareerTreeNodeDef,
  GMCareersCharacter,
  GMCareersDerived,
} from "@/managers/gm/careers/types";

/*
 * Pieces of a specialization tree shared by the creator (spending starting XP) and the character sheet
 * (spending campaign XP), so both describe a node the same way.
 */

/** The short line under a node's name: what kind of node it is ("Active · 2 Strain", "+1 DEX", "Feat"...) */
export function careerNodeTag(node: CareerTreeNodeDef, specId: string, character: GMCareersCharacter, derived: GMCareersDerived): string {
  switch (node.kind) {
    case 'talent': {
      const talent = node.talentId ? KotOR.CAREERS_TALENT_BY_ID.get(node.talentId) : undefined;
      const rank = talent ? (derived.talentRanks[talent.id] || 0) : 0;
      const what = talent?.activation === 'active' ? `Active · ${talent.strainCost || 0} Strain` : 'Passive talent';
      return rank > 1 ? `${what} · Rank ${rank}` : what;
    }
    case 'feat':
      return 'Feat';
    case 'career_skill':
      return 'Career skill';
    case 'characteristic': {
      const chosen = character.nodeChoices?.[KotOR.CareersRules.nodeChoiceKey(specId, node.id)];
      return chosen ? `+1 ${chosen.toUpperCase()}` : '+1 Characteristic';
    }
    default:
      return 'Capstone (Lv.17+)';
  }
}

/**
 * A Force power tree as a grid: the power on top, its three branches below. Each node shows what it costs and
 * whether it can be bought; onNode is called with a node to buy (or, where the caller allows it, refund)
 */
export const PowerTreeGrid: React.FC<{
  tree: CareerPowerTreeDef;
  character: GMCareersCharacter;
  /** At creation: only starting XP pays */
  startingOnly?: boolean;
  /** Nothing can be bought now (in combat), with why */
  lockedWhy?: string;
  /** Owned nodes can be clicked to refund them (the creator) */
  canRefund?: boolean;
  onNode: (nodeId: string, owned: boolean) => void;
}> = ({ tree, character, startingOnly, lockedWhy, canRefund, onNode }) => {
  const Rules = KotOR.CareersRules;
  const ownedIds = new Set(character.powerNodes?.[tree.id] || []);
  return (
    <div className="cc-tree-grid" style={{ gridTemplateRows: 'repeat(4, auto)' }}>
      {tree.nodes.map((node) => {
        const owned = ownedIds.has(node.id);
        const check = Rules.canBuyPowerNode(character, tree.id, node.id, !!startingOnly);
        const cls = owned ? 'owned' : (!lockedWhy && check.ok) ? 'available' : 'locked';
        const tag = node.kind === 'root' ? 'Force power' : node.kind === 'variant' ? 'Variant · power wheel' : 'Passive upgrade';
        return (
          <button
            key={node.id}
            className={`cc-tree-node ${cls}`}
            style={{ gridRow: node.row + 1, gridColumn: node.kind === 'root' ? '1 / 4' : node.col + 1 }}
            disabled={owned ? !canRefund : (!!lockedWhy || !check.ok)}
            title={owned ? (canRefund ? 'Click to refund' : 'Owned') : (lockedWhy || check.reason || `Buy for ${node.xpCost} XP`)}
            onClick={() => onNode(node.id, owned)}
          >
            <div className="cc-node-head">
              <span>{node.label}</span>
              <span className="cc-node-cost">{owned ? 'Owned' : `${node.xpCost} XP`}</span>
            </div>
            <div className="cc-choice-meta">{tag}</div>
            <div className="cc-node-desc">{node.description}</div>
          </button>
        );
      })}
    </div>
  );
};

/** Dedication's choice: which characteristic goes up by one (those already at 6 can't) */
export const DedicationPicker: React.FC<{
  values: CareerAttributes;
  disabled?: boolean;
  onPick: (ability: CareerAbilityKey) => void;
  onCancel: () => void;
}> = ({ values, disabled, onPick, onCancel }) => (
  <div className="cc-free-chips" style={{ marginTop: 8 }}>
    <span className="cc-hint">Pick +1 characteristic for Dedication:</span>
    {KotOR.CAREER_ABILITIES.map((ab: CareerAbilityKey) => {
      const cur = values[ab];
      return (
        <button key={ab} className="cc-chip" disabled={disabled || cur >= 6} onClick={() => onPick(ab)}>
          {KotOR.CAREER_ABILITY_LABELS[ab].short} ({cur} → {cur + 1})
        </button>
      );
    })}
    <button className="cc-chip" onClick={onCancel}>Cancel</button>
  </div>
);

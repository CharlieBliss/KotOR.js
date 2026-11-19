import React from "react";
import * as KotOR from "@/apps/game/KotOR";
import type {
  CareerAbilityKey,
  CareerAttributes,
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

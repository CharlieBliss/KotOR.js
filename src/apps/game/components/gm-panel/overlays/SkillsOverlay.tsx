import React, { useEffect, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { GMChecks, useGMStore } from "@/apps/game/components/gm-panel/gmPanelStore";

/**
 * A player's skills, each with its modifier, as buttons: pressing one rolls it (d20 + the modifier) on the GM's
 * machine, and the GM and every player see the result (RollFeed).
 */
export const SkillsOverlay: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useGMStore();
  const [rolling, setRolling] = useState<number | null>(null);
  const pc = KotOR.GameState.getCurrentPlayer();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const roll = (skill: number) => {
    if (rolling !== null) return;
    GMChecks.requestRoll(skill);
    setRolling(skill);
    setTimeout(() => setRolling(null), GMChecks.ROLL_COOLDOWN_SECONDS * 1000);
  };

  return (
    <div className="gm-skills" role="dialog" aria-label="Your skills">
      <div className="gm-skills-header">
        <span>Skills · {pc?.getName() || 'Your character'}</span>
        <button className="gm-btn small" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="gm-skills-list">
        {GMChecks.SKILL_NAMES.map((name: string, skill: number) => {
          const bonus = pc ? Number(pc.getSkillLevel(skill)) || 0 : 0;
          return (
            <button
              key={name}
              className={`gm-btn gm-skill ${rolling === skill ? 'active' : ''}`}
              disabled={!pc || rolling !== null}
              onClick={() => roll(skill)}
              title={`Roll ${name}: d20 ${bonus >= 0 ? '+' : '-'} ${Math.abs(bonus)}. Everyone sees the result.`}
            >
              <span className="gm-skill-name">{name}</span>
              <span className="gm-skill-bonus">{bonus >= 0 ? '+' : ''}{bonus}</span>
            </button>
          );
        })}
      </div>
      <div className="gm-hint">Rolls d20 + the modifier. The GM and everyone else see the result.</div>
    </div>
  );
};

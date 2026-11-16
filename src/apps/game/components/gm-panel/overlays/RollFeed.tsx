import React from "react";
import { GMChecks, useGMStore } from "@/apps/game/components/gm-panel/gmPanelStore";

/** Players' recent skill rolls, on the GM's screen and every player's, for a few seconds each */
export const RollFeed: React.FC = () => {
  useGMStore();
  const rolls = GMChecks.shownRolls();
  if (!rolls.length) return null;
  return (
    <div className="gm-roll-feed" role="log" aria-live="polite" aria-label="Rolls">
      {rolls.map((r: any) => (
        <div key={`${r.netId}-${r.at}`} className={`gm-roll ${r.roll === 20 ? 'natural-20' : r.roll === 1 ? 'natural-1' : ''}`}>
          <div className="gm-roll-who">{r.name} · {r.label}</div>
          <div className="gm-roll-total">{r.total}</div>
          <div className="gm-roll-detail">d20 {r.roll} {r.bonus >= 0 ? '+' : '-'} {Math.abs(r.bonus)}</div>
        </div>
      ))}
    </div>
  );
};

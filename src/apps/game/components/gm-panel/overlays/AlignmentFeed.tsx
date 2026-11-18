import React, { useEffect, useState } from "react";
import { GMPlayers, useGMStore } from "@/apps/game/components/gm-panel/gmPanelStore";

/** Broadcast Light / Dark Side shift alert shown on the GM screen and every connected player's screen */
export const AlignmentFeed: React.FC = () => {
  useGMStore();
  const [, setTick] = useState(0);
  const alerts = GMPlayers.activeAlignmentAlerts?.() || [];
  // Gone when its time is up: nothing else redrew the feed, so the last banner stayed until the next change
  const nextExpiry = alerts.length ? Math.min(...alerts.map((a) => a.at + GMPlayers.ALIGNMENT_ALERT_MS)) : 0;
  useEffect(() => {
    if (!nextExpiry) return;
    const timer = setTimeout(() => setTick((t) => t + 1), Math.max(0, nextExpiry - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [nextExpiry]);
  if (!alerts.length) return null;
  return (
    <div className="gm-align-feed" role="status" aria-live="polite" aria-label="Alignment shifts">
      {alerts.map((a) => (
        <div key={a.id} className={`gm-align-alert ${a.alignment}`}>
          <div className="gm-align-badge" aria-hidden="true">
            {a.alignment === 'light' ? '✦' : '❖'}
          </div>
          <div className="gm-align-body">
            <div className="gm-align-title">
              {a.alignment === 'light' ? 'Light Side Points Gained' : 'Dark Side Points Gained'}
              <span>+{a.points}</span>
            </div>
            <div className="gm-align-text">{a.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

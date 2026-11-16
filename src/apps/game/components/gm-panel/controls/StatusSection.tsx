import React, { useEffect, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";

const COLOURS: Record<string, string> = { heal: '#5fd38a', buff: '#6fb6ff', harm: '#ff7a6b', item: '#e0c070', effect: '#d8d8d8' };

/** A creature's status for the GM: fight numbers, the effects on it now, and the powers, items and feats it has */
export const StatusSection: React.FC<{ creature: KotOR.ModuleCreature }> = ({ creature }) => {
  const [status, setStatus] = useState<KotOR.GMStatus | null>(() => KotOR.GMStatus.of(creature));
  // Effects come and go mid-fight (and HP and FP change): read it again every second while it's open
  useEffect(() => {
    setStatus(KotOR.GMStatus.of(creature));
    const timer = setInterval(() => setStatus(KotOR.GMStatus.of(creature)), 1000);
    return () => clearInterval(timer);
  }, [creature]);
  if (!status) return null;

  const lines = (list: KotOR.GMStatusLine[], empty: string) => list.length ? (
    <ul className="gm-status-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {list.map((l, i) => (
        <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, lineHeight: '18px' }}>
          <span style={{ color: COLOURS[l.kind || 'effect'] }}>{l.label}</span>
          {l.detail && <span style={{ opacity: 0.65, textAlign: 'right' }}>{l.detail}</span>}
        </li>
      ))}
    </ul>
  ) : <div style={{ fontSize: 12, opacity: 0.6 }}>{empty}</div>;

  return (
    <details className="gm-section" open>
      <summary>Status</summary>
      <div style={{ fontSize: 12, marginBottom: 6 }}>{status.summary}</div>
      <div className="gm-field">
        <label>Effects now ({status.effects.length})</label>
        {lines(status.effects, 'None')}
      </div>
      <div className="gm-field">
        <label>Powers ({status.powers.length})</label>
        {lines(status.powers, 'None')}
      </div>
      {status.items.length > 0 && (
        <div className="gm-field">
          <label>Usable items ({status.items.length})</label>
          {lines(status.items, '')}
        </div>
      )}
      <details>
        <summary style={{ fontSize: 12 }}>Feats ({status.feats.length})</summary>
        <div style={{ fontSize: 12, opacity: 0.85 }}>{status.feats.join(', ') || 'None'}</div>
      </details>
    </details>
  );
};

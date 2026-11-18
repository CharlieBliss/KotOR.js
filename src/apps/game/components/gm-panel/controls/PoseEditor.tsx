import React, { useEffect, useMemo, useRef, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { GMManager } from "@/apps/game/components/gm-panel/gmPanelStore";
import { ItemPicker } from "@/apps/game/components/gm-panel/controls/GearEditor";

/**
 * Make a pose: any animation the creature's model has, frozen at a moment, held as its stance ('kneel@2.90'). The
 * slider moves it live, so the GM sees the pose on the creature (and players do: it's a stance like any other).
 * Done keeps it; Cancel puts back the stance it had.
 */
export const PoseEditor: React.FC<{ cre: KotOR.ModuleCreature; onDone: () => void }> = ({ cre, onDone }) => {
  const before = useRef(cre.heldStance || '');
  const start = KotOR.ModuleCreature.parseStance(cre.heldStance || '');
  const [anim, setAnim] = useState(start.holdAt != null ? start.anim : '');
  const [at, setAt] = useState(start.holdAt ?? 0);

  // Every animation its model has, with animations.2da's description and its length
  const options = useMemo(() => {
    const map: Map<string, any> = (cre.model as any)?.odysseyAnimationMap || new Map();
    const rows = KotOR.GameState.TwoDAManager?.datatables.get('animations')?.rows || {};
    const desc = new Map<string, string>();
    for (const k of Object.keys(rows)) { const n = String(rows[k].name || '').toLowerCase(); if (n && !desc.has(n)) desc.set(n, String(rows[k].description || '')); }
    return [...map.entries()]
      .map(([name, a]) => {
        const d = (desc.get(name) || '').replace(/\*+/g, '').replace(/_/g, ' ').trim();
        return { resRef: name, label: `${name}${d ? ` · ${d}` : ''} (${Number(a.length).toFixed(1)} s)`, length: Number(a.length) || 0 };
      })
      .sort((a, b) => a.resRef.localeCompare(b.resRef));
  }, [cre]);
  const length = options.find((o) => o.resRef === anim)?.length || 0;

  // Held on the creature as it moves: at most every 80 ms (each change goes to players)
  const pending = useRef<number | null>(null);
  const apply = (name: string, t: number) => {
    if (!name) return;
    if (pending.current) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      pending.current = null;
      GMManager.setCreatureStance(cre, `${name}@${Math.max(0, t).toFixed(2)}`);
    }, 80);
  };
  useEffect(() => () => { if (pending.current) window.clearTimeout(pending.current); }, []);

  return (
    <div className="gm-pose-editor" title="Pick an animation and move the slider: the creature holds that moment as its stance">
      <div className="gm-field">
        <label>Pose from animation</label>
        <ItemPicker
          items={options}
          value={anim || null}
          listId="pose-anim"
          onPick={(name) => { const len = options.find((o) => o.resRef === name)?.length || 0; const t = Math.min(at, len); setAnim(name); setAt(t); apply(name, t); }}
        />
      </div>
      <div className="gm-field">
        <label>Moment: {at.toFixed(2)} s{length ? ` of ${length.toFixed(2)}` : ''}</label>
        <input
          type="range"
          min={0}
          max={Math.max(0.01, length)}
          step={0.02}
          value={at}
          disabled={!anim}
          onChange={(e) => { const t = Number(e.target.value); setAt(t); apply(anim, t); }}
        />
      </div>
      <div className="gm-row" style={{ justifyContent: 'flex-end', gap: 6 }}>
        <button className="gm-btn small" onClick={() => { GMManager.setCreatureStance(cre, before.current); onDone(); }}>Cancel</button>
        <button className="gm-btn small primary" disabled={!anim} onClick={onDone}>Done</button>
      </div>
    </div>
  );
};

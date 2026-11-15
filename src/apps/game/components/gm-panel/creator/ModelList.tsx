import React, { useMemo, useState } from "react";
import { creatorModels, MODEL_GROUPS } from "@/apps/game/components/gm-panel/creator/creatorData";
import type { ModelGroup } from "@/apps/game/components/gm-panel/creator/creatorData";

const ROW_HEIGHT = 30;
const VISIBLE_ROWS = 10;
const OVERSCAN = 6;

/**
 * Every model a character can take, searchable and filtered by group. Only the rows in view are drawn: there
 * are hundreds of models.
 */
export const ModelList: React.FC<{
  selected: number;
  playerBodiesOnly: boolean;
  onPick: (id: number, label: string) => void;
}> = React.memo(({ selected, playerBodiesOnly, onPick }) => {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<ModelGroup | 'all'>(playerBodiesOnly ? 'player' : 'all');
  const [scrollTop, setScrollTop] = useState(0);

  const all = useMemo(() => creatorModels(), []);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((m) => (playerBodiesOnly ? m.group === 'player' : group === 'all' || m.group === group) && (!q || m.label.toLowerCase().includes(q)));
  }, [all, search, group, playerBodiesOnly]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(shown.length, Math.ceil(scrollTop / ROW_HEIGHT) + VISIBLE_ROWS + OVERSCAN);

  return (
    <div className="cc-models">
      <div className="cc-models-filters">
        <input className="cc-input" placeholder="Search models…" value={search} onChange={(e) => { setSearch(e.target.value); setScrollTop(0); }} aria-label="Search models" />
        {!playerBodiesOnly && (
          <div className="cc-chips" role="tablist" aria-label="Model groups">
            {[{ id: 'all' as const, label: 'All' }, ...MODEL_GROUPS].map((g) => (
              <button key={g.id} role="tab" aria-selected={group === g.id} className={`cc-chip ${group === g.id ? 'on' : ''}`} onClick={() => { setGroup(g.id); setScrollTop(0); }}>{g.label}</button>
            ))}
          </div>
        )}
      </div>
      <div className="cc-models-list" style={{ height: ROW_HEIGHT * VISIBLE_ROWS }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} role="listbox" aria-label="Models">
        <div style={{ height: shown.length * ROW_HEIGHT, position: 'relative' }}>
          {shown.slice(first, last).map((m, i) => (
            <div
              key={m.id}
              role="option"
              aria-selected={m.id === selected}
              className={`cc-model-row ${m.id === selected ? 'on' : ''}`}
              style={{ top: (first + i) * ROW_HEIGHT, height: ROW_HEIGHT }}
              onClick={() => onPick(m.id, m.label)}
            >
              <span className="cc-model-label">{m.label}</span>
              <span className="cc-model-group">{MODEL_GROUPS.find((g) => g.id === m.group)?.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="cc-hint">{shown.length} models</div>
    </div>
  );
});

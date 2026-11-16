import React from "react";
import * as KotOR from "@/apps/game/KotOR";
import { GMManager, GMNpcOrders } from "@/apps/game/components/gm-panel/gmPanelStore";

type Creature = KotOR.ModuleCreature;

/** Every item's value of something when they all share it, '' when they differ */
function shared<T>(list: T[], get: (x: T) => string): string {
  if (!list.length) return '';
  const first = get(list[0]);
  return list.every((x) => get(x) === first) ? first : '';
}

/**
 * The Inspector with several things selected: delete them, or change what they have in common at once
 * (side, how they fight, stance, orders, whether players see them). Players' characters are left out of
 * the edits; those stay one at a time.
 */
export const SelectionGroup: React.FC<{ list: KotOR.ModuleObject[] }> = ({ list }) => {
  const name = (o: KotOR.ModuleObject) => o.getName() || (o as any).firstName || o.getTag() || 'Unnamed';
  const deletable = list.filter((o) => GMManager.isDeletable(o));
  const creatures = list.filter((o) => KotOR.GMObjectKind.isCreature(o)) as Creature[];
  const npcs = creatures.filter((c) => !GMManager.isPlayerCharacter(c));
  const orderable = npcs.filter((c) => GMManager.canOrder(c));
  const hideable = list.filter((o) => !o.gmOwnerPeerId);
  const every = (fn: (c: Creature) => void, who: Creature[] = npcs) => () => { who.forEach(fn); GMManager.notifyChange(); };

  const faction = shared(npcs, (c) => String(c.factionId));
  const style = shared(npcs, (c) => c.gmCombatStyle || 'all');
  const stanceMixed = npcs.length > 1 && !npcs.every((c) => GMManager.stanceOf(c) === GMManager.stanceOf(npcs[0]));
  const stance = stanceMixed ? '__mixed' : GMManager.stanceOf(npcs[0] || ({} as Creature));
  // Stances and gestures any of them can do: each plays it where its model has it
  const choices = (kind: 'stance' | 'gesture') => {
    const seen = new Map<string, { id: string; label: string; group: string }>();
    for (const c of npcs) for (const a of GMManager.availableAnimations(c, kind)) if (!seen.has(a.id)) seen.set(a.id, a);
    return [...seen.values()];
  };
  const stances = choices('stance');
  const gestures = choices('gesture');
  const groups = (l: typeof stances) => [...new Set(l.map((c) => c.group))];
  const hiddenAll = hideable.length > 0 && hideable.every((o) => GMManager.isHiddenFromPlayers(o));

  const sides: [number, string, string][] = [
    [KotOR.GMFaction.HOSTILE, 'Hostile', 'danger'],
    [KotOR.GMFaction.FRIENDLY, 'Friendly', 'success'],
    [KotOR.GMFaction.NEUTRAL, 'Neutral', 'active'],
    [KotOR.GMFaction.PARTY, 'Party', 'active'],
  ];

  return (
    <div className="gm-section">
      <div className="gm-section-title">
        <span>{list.length} selected</span>
        <span className="gm-row">
          <button className="gm-btn small" onClick={() => GMManager.setSelection([])} title="Select nothing">Clear</button>
          <button
            className="gm-btn small danger"
            disabled={!deletable.length}
            onClick={() => GMManager.deleteObjects(deletable)}
            title={deletable.length < list.length ? 'Remove them from the scene (not characters players are playing)' : 'Remove them from the scene'}
          >
            Delete {deletable.length}
          </button>
        </span>
      </div>

      <div className="gm-hint">
        Drag one to move them all; Ctrl + mouse wheel turns them; Delete removes them. Shift + click adds or takes out one, Shift + drag selects with a box.
      </div>

      <div className="gm-row" style={{ flexWrap: 'wrap', gap: 4 }}>
        {list.map((o, i) => (
          <button
            key={o.id || i}
            className="gm-btn small"
            title="Select just this one (Shift + click: take it out)"
            onClick={(e) => GMManager.selectObject(o, e.shiftKey ? 'toggle' : 'only')}
          >
            {name(o)}
          </button>
        ))}
      </div>

      {npcs.length > 0 && (
        <>
          <div className="gm-row">
            <button className="gm-btn small" style={{ flex: 1 }} onClick={every((c) => GMManager.healObject(c), creatures)} title="Full health">
              Heal {creatures.length}
            </button>
            <button className="gm-btn small danger" style={{ flex: 1 }} onClick={every((c) => GMManager.killObject(c), npcs)}>
              Kill {npcs.length}
            </button>
          </div>

          <div className="gm-row" title="Who they fight">
            <span style={{ minWidth: 40, fontSize: 11, color: "#8aa4bd" }}>Side</span>
            {sides.map(([id, label, cls]) => (
              <button
                key={id}
                className={`gm-btn small ${faction === String(id) ? cls : ''}`}
                onClick={every((c) => GMManager.setObjectFaction(c, id))}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="gm-row" title="What they use when they fight on their own or on your orders">
            <span style={{ minWidth: 40, fontSize: 11, color: "#8aa4bd" }}>Fights with</span>
            <div className="gm-segmented" role="group" aria-label="Fights with">
              {KotOR.GMCombatAI.STYLES.map((s: { id: 'all' | 'weapons' | 'attack'; label: string; title: string }) => (
                <button
                  key={s.id}
                  className={`gm-btn small ${style === s.id ? 'active' : ''}`}
                  title={s.title}
                  onClick={every((c) => KotOR.GMCombatAI.setStyle(c, s.id))}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {(stances.length > 0 || gestures.length > 0) && (
            <div className="gm-grid-2" title="Each one that has the animation plays it">
              <div className="gm-field">
                <label>Stance</label>
                <select className="gm-select" value={stance} onChange={(e) => every((c) => { GMManager.setCreatureStance(c, e.target.value); })()}>
                  {stanceMixed && <option value="__mixed" disabled>Mixed</option>}
                  <option value="">Standing</option>
                  {stance && stance !== '__mixed' && !stances.some((c) => c.id === stance) && <option value={stance}>{stance}</option>}
                  {groups(stances).map((g) => (
                    <optgroup key={g} label={g}>
                      {stances.filter((c) => c.group === g).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="gm-field">
                <label>Gesture</label>
                <select className="gm-select" value="" onChange={(e) => { if (e.target.value) every((c) => { GMManager.playGesture(c, e.target.value); })(); }}>
                  <option value="">Play once…</option>
                  {groups(gestures).map((g) => (
                    <optgroup key={g} label={g}>
                      {gestures.filter((c) => c.group === g).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>
          )}

          {orderable.length > 0 && (
            <div className="gm-field">
              <label>Orders ({orderable.length})</label>
              <div className="gm-row" style={{ flexWrap: 'wrap' }}>
                <button className="gm-btn small" onClick={every((c) => GMManager.giveOrder(c, { kind: 'guard', point: GMManager.pointOf(c), radius: GMNpcOrders.GUARD_RADIUS }), orderable)} title="Each guards the spot it stands on">
                  Guard here
                </button>
                <button className="gm-btn small warning" onClick={every((c) => GMManager.giveOrder(c, { kind: 'flee' }), orderable)} title="Run from the nearest enemy">
                  Flee
                </button>
                <button className="gm-btn small warning" onClick={every((c) => GMManager.giveOrder(c, { kind: 'standDown' }), orderable)} title="Stop fighting, even if attacked">
                  Stand down
                </button>
                <button className="gm-btn small" onClick={every((c) => GMManager.giveOrder(c, undefined), orderable)} title="Back to their own judgement">
                  Own judgement
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {hideable.length > 0 && (
        <label className="gm-checkbox" title="Hidden objects stay visible to you but are removed from players' games until revealed">
          <input
            type="checkbox"
            checked={hiddenAll}
            onChange={(e) => { hideable.forEach((o) => GMManager.setObjectHidden(o, e.target.checked)); GMManager.notifyChange(); }}
          />
          Hidden from players
        </label>
      )}
    </div>
  );
};

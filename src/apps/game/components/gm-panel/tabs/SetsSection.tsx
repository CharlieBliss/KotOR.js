import React, { useEffect, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { GMManager, GMSetPieces, GMRoomNames } from "@/apps/game/components/gm-panel/gmPanelStore";

/** Naming a room (or, with room null, the area): an input in place of a dialog (Electron has no prompt()) */
const RenameRow: React.FC<{ label: string; initial: string; onSave: (name: string) => void; onCancel: () => void }> = ({ label, initial, onSave, onCancel }) => {
  const [value, setValue] = useState(initial);
  return (
    <div className="gm-row" style={{ alignItems: 'center', marginTop: 4 }}>
      <span className="gm-hint" style={{ whiteSpace: 'nowrap' }}>{label}</span>
      <input
        className="gm-input"
        style={{ flex: 1 }}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') onSave(value); if (e.key === 'Escape') onCancel(); }}
      />
      <button className="gm-btn small success" onClick={() => onSave(value)}>Save</button>
      <button className="gm-btn small" title="Back to the guessed name" onClick={() => onSave('')}>Reset</button>
      <button className="gm-btn small" onClick={onCancel}>Cancel</button>
    </div>
  );
};

/** The other game's prefix for a module name ("kotor:" while running KotOR II) */
const otherGame = (): 'kotor' | 'tsl' => (KotOR.GameState.GameKey === KotOR.GameEngineType.TSL ? 'kotor' : 'tsl');

/**
 * Place tab: sets. Rooms of another area (this game's or the other's), put in this scene as a set piece to walk
 * around in: the whole area, or the rooms the GM ticks. Placed sets can be nudged, turned, raised and removed.
 */
export const SetsSection: React.FC<{ forceUpdate: () => void }> = ({ forceUpdate }) => {
  const [module, setModule] = useState<string>(GMSetPieces.pending.module);
  const [rooms, setRooms] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(GMSetPieces.pending.rooms || []));
  const [loading, setLoading] = useState<boolean>(false);
  const [step, setStep] = useState<number>(1);
  const [query, setQuery] = useState<string>('');
  const [showScenery, setShowScenery] = useState<boolean>(false);
  /** What's being renamed: a room's code, '' for the area, null for nothing */
  const [renaming, setRenaming] = useState<string | null>(null);
  const key = module.trim().toLowerCase();

  // The area's rooms, to pick from, and their names (guessed in the background; the panel redraws when ready)
  useEffect(() => {
    let live = true;
    setRooms(null);
    setRenaming(null);
    if (!key) return;
    setLoading(true);
    GMSetPieces.listRooms(key).then((list) => {
      if (!live) return;
      setRooms(list);
      setLoading(false);
    });
    void GMRoomNames.estimate(key);
    return () => { live = false; };
  }, [key]);

  const about = (r: string) => GMRoomNames.about(key, r);
  const roomTitle = (r: string) => {
    const guess = about(r);
    const own = GMRoomNames.custom()[key]?.rooms?.[r];
    return [`${r}${own ? ` (your name; guessed: ${guess?.name || r})` : ''}`, ...(guess?.hints || [])].join('\n');
  };
  const q = query.trim().toLowerCase();
  const shown = (rooms || [])
    .filter((r) => showScenery || !about(r)?.scenery || picked.has(r))
    .filter((r) => !q || [r, GMSetPieces.roomLabel(key, r), ...(about(r)?.hints || [])].some((t) => t.toLowerCase().includes(q)));
  const hiddenScenery = (rooms || []).filter((r) => about(r)?.scenery).length;

  const choose = (next: Partial<{ module: string; rooms: string[] }>) => {
    GMSetPieces.pending = {
      module: (next.module ?? module).trim().toLowerCase(),
      rooms: next.rooms ?? (picked.size ? [...picked] : undefined),
    };
    if (GMSetPieces.pending.rooms && !GMSetPieces.pending.rooms.length) GMSetPieces.pending.rooms = undefined;
    forceUpdate();
  };
  const pickModule = (name: string) => {
    setModule(name);
    setPicked(new Set());
    GMSetPieces.pending = { module: name.trim().toLowerCase() };
    forceUpdate();
  };
  const toggleRoom = (name: string) => {
    const next = new Set(picked);
    if (next.has(name)) next.delete(name); else next.add(name);
    setPicked(next);
    choose({ rooms: [...next] });
  };

  const curated = [
    ...GMManager.getCuratedModules().map((m: any) => ({ value: m.resRef, label: `${m.planet}: ${m.title}` })),
    ...GMManager.getCuratedModules(otherGame()).map((m: any) => ({
      value: `${otherGame()}:${m.resRef}`,
      label: `${otherGame() === 'tsl' ? 'KotOR II' : 'KotOR'} · ${m.planet}: ${m.title}`,
    })),
  ];
  const placing = GMManager.activeTool === 'place_set';
  const sets = GMSetPieces.list();
  const selected = GMSetPieces.selected();
  const isClient = KotOR.GMNetworkManager.role === 'client';

  return (
    <>
      <div className="gm-field" title="Rooms of another area, built into this scene to walk around in. Areas of either game work.">
        <label>Area to bring</label>
        <select className="gm-select" value={curated.some((c) => c.value === module) ? module : ''} onChange={(e) => e.target.value && pickModule(e.target.value)}>
          <option value="">Any area (type its module below)…</option>
          {curated.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <input
          className="gm-input"
          value={module}
          placeholder={`module, e.g. ebo_m12aa or ${otherGame()}:…`}
          onChange={(e) => pickModule(e.target.value)}
          title={`A module of this game, or "${otherGame()}:<module>" for the other game's`}
        />
      </div>

      {key && rooms && rooms.length > 0 && (
        <div className="gm-row" style={{ alignItems: 'center' }}>
          <strong style={{ flex: 1 }} title={key}>{GMRoomNames.areaName(key)}</strong>
          {!isClient && <button className="gm-btn small" title="Name this area yourself" onClick={() => setRenaming(renaming === '' ? null : '')}>✎ Name</button>}
        </div>
      )}
      {renaming === '' && (
        <RenameRow
          label="Area name"
          initial={GMRoomNames.areaName(key)}
          onSave={(name) => { GMSetPieces.rename(key, null, name); setRenaming(null); }}
          onCancel={() => setRenaming(null)}
        />
      )}

      <div className="gm-field" title="Leave all unticked to bring the whole area. Names are guessed from the area's map notes and what's in each room (hover for why); ✎ names one yourself.">
        <label>
          Rooms {rooms ? `(${picked.size ? `${picked.size} of ${rooms.length}` : `all ${rooms.length}`})` : ''}
          {picked.size > 0 && <button className="gm-btn small" style={{ marginLeft: 8 }} onClick={() => { setPicked(new Set()); choose({ rooms: [] }); }}>All</button>}
        </label>
        {loading && <div className="gm-hint">Reading its layout…</div>}
        {!loading && rooms && !rooms.length && <div className="gm-hint">No rooms found for "{module}".</div>}
        {!loading && rooms && rooms.length > 0 && (
          <>
            <div className="gm-row" style={{ alignItems: 'center' }}>
              <input
                className="gm-input"
                style={{ flex: 1 }}
                value={query}
                placeholder="Find a room: cargo, cockpit, Vrook, m12aa_01k…"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              {hiddenScenery > 0 && (
                <button className={`gm-btn small ${showScenery ? 'active' : ''}`} title="Rooms with no floor: the sky or space around the area" onClick={() => setShowScenery(!showScenery)}>
                  Backdrops ({hiddenScenery})
                </button>
              )}
            </div>
            <div className="gm-set-rooms" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 170, overflowY: 'auto' }}>
              {shown.map((r) => (
                <span key={r} style={{ display: 'inline-flex' }}>
                  <button className={`gm-btn small ${picked.has(r) ? 'active' : ''}`} title={roomTitle(r)} onClick={() => toggleRoom(r)}>
                    {GMSetPieces.roomLabel(key, r)}
                  </button>
                  {!isClient && <button className="gm-btn small" title={`Name ${r} yourself`} onClick={() => setRenaming(renaming === r ? null : r)}>✎</button>}
                </span>
              ))}
              {!shown.length && <span className="gm-hint">No room matches "{query}".</span>}
            </div>
            {renaming && (
              <RenameRow
                key={renaming}
                label={`Name for ${renaming}`}
                initial={GMSetPieces.roomLabel(key, renaming)}
                onSave={(name) => { GMSetPieces.rename(key, renaming, name); setRenaming(null); }}
                onCancel={() => setRenaming(null)}
              />
            )}
          </>
        )}
      </div>

      <div className="gm-row">
        <button
          className={`gm-btn success ${placing ? 'active' : ''}`}
          style={{ flex: 1 }}
          disabled={isClient || !rooms?.length}
          onClick={() => { choose({}); GMManager.setToolMode(placing ? 'select' : 'place_set'); }}
          title="Click the ground: the middle of the set's floor goes there (R turns it)"
        >
          {placing ? 'Click the ground (Esc to stop)' : `Place ${GMSetPieces.describe(GMSetPieces.pending)}`}
        </button>
      </div>

      <div className="gm-field">
        <label>Sets in this scene ({sets.length})</label>
        {!sets.length && <div className="gm-hint">None yet. A set's floor joins this area's where they meet at about the same height; raise or lower it to line them up.</div>}
        {sets.map((set) => (
          <div
            key={set.id}
            className={`gm-row gm-list-row ${selected === set ? 'active' : ''}`}
            style={{ cursor: 'pointer', alignItems: 'center' }}
            onClick={() => { GMSetPieces.selectedId = set.id; forceUpdate(); }}
            title={`${set.module}: ${set.rooms.length} room(s), ${set.seams.length} walkable join(s) with this area\n` +
              set.rooms.filter((r) => !GMRoomNames.about(set.module, r.roomName)?.scenery).map((r) => `${GMSetPieces.roomLabel(set, r.roomName)} (${r.roomName})`).join('\n')}
          >
            <span style={{ flex: 1 }}>{GMSetPieces.describe(set)} · {Math.round((-set.yaw * 180) / Math.PI + 360) % 360}°</span>
            <span className="gm-hint">{set.seams.length ? `${set.seams.length} joins` : 'no joins'}</span>
          </div>
        ))}
      </div>

      {selected && !isClient && (
        <div className="gm-field" title="Nudge, turn, raise or lower the picked set">
          <label>
            Move {GMSetPieces.describe(selected)}
            <select className="gm-select" style={{ marginLeft: 8, width: 'auto' }} value={step} onChange={(e) => setStep(Number(e.target.value))}>
              <option value={0.25}>0.25 m</option>
              <option value={1}>1 m</option>
              <option value={5}>5 m</option>
            </select>
          </label>
          <div className="gm-row">
            <button className="gm-btn small" title="West" onClick={() => GMSetPieces.move(selected.id, { by: { x: -step } })}>◀ W</button>
            <button className="gm-btn small" title="North" onClick={() => GMSetPieces.move(selected.id, { by: { y: step } })}>▲ N</button>
            <button className="gm-btn small" title="South" onClick={() => GMSetPieces.move(selected.id, { by: { y: -step } })}>▼ S</button>
            <button className="gm-btn small" title="East" onClick={() => GMSetPieces.move(selected.id, { by: { x: step } })}>E ▶</button>
            <button className="gm-btn small" title="Raise" onClick={() => GMSetPieces.move(selected.id, { by: { z: Math.min(step, 1) / 4 } })}>Up</button>
            <button className="gm-btn small" title="Lower" onClick={() => GMSetPieces.move(selected.id, { by: { z: -Math.min(step, 1) / 4 } })}>Down</button>
          </div>
          <div className="gm-row">
            <button className="gm-btn small" onClick={() => GMSetPieces.move(selected.id, { turnBy: Math.PI / 12 })}>⟲ 15°</button>
            <button className="gm-btn small" onClick={() => GMSetPieces.move(selected.id, { turnBy: -Math.PI / 12 })}>⟳ 15°</button>
            <button className="gm-btn small" onClick={() => GMSetPieces.move(selected.id, { turnBy: -Math.PI / 2 })}>⟳ 90°</button>
            <button
              className="gm-btn small"
              title="Fly the camera to it"
              onClick={() => {
                const cam = KotOR.GameState.camera;
                cam.position.set(selected.position.x - 12, selected.position.y - 12, selected.position.z + 14);
                cam.up.set(0, 0, 1);
                cam.lookAt(selected.position);
                cam.updateMatrixWorld();
              }}
            >
              Go to
            </button>
            <button className="gm-btn small danger" onClick={() => GMSetPieces.remove(selected.id)}>Remove</button>
          </div>
        </div>
      )}
    </>
  );
};

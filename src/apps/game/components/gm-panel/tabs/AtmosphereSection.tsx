import React, { useMemo, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { GMManager, GMAtmosphere, useGMStore } from "@/apps/game/components/gm-panel/gmPanelStore";

/**
 * The scene's music, ambience and look (fog, background and light), for every player at once. Any of it can be
 * taken from another area of the game: Hrakert Station's murky water and music around a space station, say.
 */
export const AtmosphereSection: React.FC<{ active: boolean }> = ({ active }) => {
  useGMStore(active);
  const sceneName = KotOR.GameState.module?.filename || '';
  const curated = GMManager.getCuratedModules();
  const [from, setFrom] = useState<string>(() => curated.find((m) => /manm28aa/.test(m.resRef))?.resRef || curated[0]?.resRef || '');
  const [busy, setBusy] = useState<string>('');
  const music = useMemo(() => GMAtmosphere.choices('ambientmusic'), [sceneName]);
  const sounds = useMemo(() => GMAtmosphere.choices('ambientsound'), [sceneName]);
  const now = GMAtmosphere.effective();
  const changed = Object.keys(GMAtmosphere.current).length > 0;
  const fog = now.fog;

  const set = (changes: KotOR.GMAtmosphereSettings, label?: string) => { void GMAtmosphere.set(changes, label); };
  const take = async (parts: 'look' | 'sound' | 'all') => {
    setBusy(`Reading ${from}…`);
    const ok = await GMAtmosphere.useModule(from, parts);
    setBusy(ok ? '' : `Couldn't read ${from}`);
  };
  const soundSelect = (label: string, value: number, list: KotOR.GMSoundChoice[], onPick: (row: number) => void, title: string) => (
    <div className="gm-field" title={title}>
      <label>{label}</label>
      <select className="gm-select" value={String(value)} onChange={(e) => onPick(Number(e.target.value))}>
        <option value="-1">None</option>
        {value >= 0 && !list.some((c) => c.row === value) && <option value={String(value)}>Row {value}</option>}
        {list.map((c) => (
          <option key={c.row} value={String(c.row)}>{c.name === c.resource ? c.resource : `${c.name} (${c.resource})`}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="gm-section">
      <div className="gm-section-title">
        <span>Atmosphere</span>
        <button
          className="gm-btn small"
          disabled={!changed}
          onClick={() => void GMAtmosphere.reset()}
          title="Back to this scene's own music, sound and look"
        >
          Scene's own
        </button>
      </div>
      <div className="gm-hint">
        Music, ambience, fog and light for everyone in the scene.{now.source ? ` Taken from ${now.source}.` : ''} KotOR's skies are part of each
        area's models; thick fog hides them, so another area's fog and colours change where a scene seems to be.
      </div>

      <div className="gm-field" title="Use the music, sound or look of another area of the game">
        <label>Take from another area</label>
        <div className="gm-row">
          <select className="gm-select" style={{ flex: 1 }} value={from} onChange={(e) => setFrom(e.target.value)}>
            {curated.map((m) => <option key={m.resRef} value={m.resRef}>{m.planet}: {m.title}</option>)}
          </select>
        </div>
        <div className="gm-row">
          <button className="gm-btn small" style={{ flex: 1 }} disabled={!from || !!busy} onClick={() => void take('sound')}>Its sound</button>
          <button className="gm-btn small" style={{ flex: 1 }} disabled={!from || !!busy} onClick={() => void take('look')}>Its look</button>
          <button className="gm-btn small active" style={{ flex: 1 }} disabled={!from || !!busy} onClick={() => void take('all')}>Both</button>
        </div>
        {busy && <div className="gm-card-sub">{busy}</div>}
      </div>

      <div className="gm-grid-2">
        {soundSelect('Music', now.music, music, (row) => set({ music: row }, 'Music changed'), 'Plays in the background, looping')}
        {soundSelect('Battle music', now.battle, music, (row) => set({ battle: row }, 'Battle music changed'), 'Plays while a fight is on')}
      </div>
      <div className="gm-grid-2">
        {soundSelect('Ambience', now.ambient, sounds, (row) => set({ ambient: row }, 'Ambience changed'), 'The scene\'s background sound: wind, machinery, water…')}
        <div className="gm-field" title="How loud the ambience is">
          <label>Ambience volume {Math.round((now.ambientVolume / 127) * 100)}%</label>
          <input
            type="range" min={0} max={127} value={now.ambientVolume}
            onChange={(e) => set({ ambientVolume: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="gm-row" title="Fog fades the far distance into its colour; past it is the same colour">
        <label className="gm-checkbox" style={{ flex: 1 }}>
          <input type="checkbox" checked={fog.on} onChange={(e) => set({ fog: { ...fog, on: e.target.checked } }, e.target.checked ? 'Fog on' : 'Fog off')} />
          Fog
        </label>
        <input
          type="color"
          aria-label="Fog colour"
          value={GMAtmosphere.bgrToHex(fog.color)}
          onChange={(e) => set({ fog: { ...fog, color: GMAtmosphere.hexToBgr(e.target.value) } })}
        />
        <label className="gm-checkbox" title="The colour of the light everything is lit by">
          Light
          <input
            type="color"
            aria-label="Light colour"
            value={GMAtmosphere.bgrToHex(now.light)}
            onChange={(e) => set({ light: GMAtmosphere.hexToBgr(e.target.value) })}
          />
        </label>
      </div>
      {fog.on && (
        <div className="gm-grid-2">
          <div className="gm-field" title="Where the fog starts">
            <label>Starts at {Math.round(fog.near)} m</label>
            <input type="range" min={0} max={300} value={Math.min(300, fog.near)} onChange={(e) => set({ fog: { ...fog, near: Number(e.target.value), far: Math.max(fog.far, Number(e.target.value) + 1) } })} />
          </div>
          <div className="gm-field" title="Where nothing can be seen through it any more">
            <label>Thick at {Math.round(fog.far)} m</label>
            <input type="range" min={5} max={2000} value={Math.min(2000, fog.far)} onChange={(e) => set({ fog: { ...fog, far: Math.max(Number(e.target.value), fog.near + 1) } })} />
          </div>
        </div>
      )}
    </div>
  );
};

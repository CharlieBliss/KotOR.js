import React, { useEffect, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { GMManager, GMNetworkManager, useGMStore } from "@/apps/game/components/gm-panel/gmPanelStore";

const { GMCutscene } = KotOR;

/** How tall each bar is for the widescreen frame in this window */
function barHeight(): number {
  const w = window.innerWidth || 1, h = window.innerHeight || 1;
  return Math.max(0, Math.round((h - w / GMCutscene.FRAME_ASPECT) / 2));
}

/**
 * A cutscene on screen: KotOR's widescreen bars and the caption. Players see black bars and the GM's camera. The
 * GM sees see-through bars (to frame the shot) and the director's dock in the bottom bar: the caption, shots 1-9
 * (click: cut, Shift + click: pan, + saves the view), and End.
 */
export const CutsceneOverlay: React.FC = () => {
  useGMStore();
  const isGM = GMManager.isGMUser();
  const [draft, setDraft] = useState(GMCutscene.caption || '');
  const active = GMCutscene.active;
  // A new cutscene starts with its caption box empty
  useEffect(() => { if (active) setDraft(GMCutscene.caption || ''); }, [active]);

  if (!active) return null;
  const bar = barHeight();
  const caption = GMCutscene.caption;

  if (!isGM) {
    return (
      <div className="gm-cutscene watching">
        <div className="gm-cutscene-bar top" style={{ height: bar }} />
        <div className="gm-cutscene-bar bottom" style={{ height: Math.max(bar, caption ? 64 : 0) }}>
          {caption && <div className="gm-cutscene-caption">{caption}</div>}
        </div>
      </div>
    );
  }

  const shots = new Map(GMCutscene.savedShots());
  const send = () => GMCutscene.setCaption(draft.trim());
  const online = GMNetworkManager.role === 'host';
  return (
    <div className="gm-cutscene directing">
      <div className="gm-cutscene-bar top" style={{ height: bar }} />
      <div className="gm-cutscene-bar bottom" style={{ height: bar }}>
        {caption && <div className="gm-cutscene-caption">{caption}</div>}
      </div>
      <div className="gm-cutscene-dock" onPointerDown={(e) => e.stopPropagation()}>
        <span className="gm-cutscene-live" title={online ? 'Players see your camera inside the bars' : 'Not hosting: this only shows you the framing'}>
          {online ? '● Live' : 'Preview'}
        </span>
        <input
          className="gm-input gm-cutscene-input"
          placeholder="Caption under the picture (Enter to show, empty to clear)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } e.stopPropagation(); }}
        />
        <div className="gm-segmented" role="group" aria-label="Shots">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button
              key={n}
              className={`gm-btn small ${shots.has(n) ? 'active' : ''}`}
              disabled={!shots.has(n)}
              title={shots.has(n) ? `Shot ${n}: click or ${n} to cut, Shift + click or Shift+${n} to pan` : `No shot ${n} yet: Ctrl+Shift+${n} saves the view`}
              onClick={(e) => GMCutscene.goToShot(n, e.shiftKey)}
            >
              {n}
            </button>
          ))}
        </div>
        <button className="gm-btn small" title="Save the view as the next free shot (Ctrl+Shift+1–9 picks the number)" onClick={() => GMCutscene.saveShot(GMCutscene.nextFreeShot())}>+ Shot</button>
        <button className="gm-btn small danger" title="End the cutscene: players get their own camera back" onClick={() => GMCutscene.stop()}>End</button>
      </div>
    </div>
  );
};

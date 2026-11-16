import React, { useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { GMManager, GMNetworkManager } from "@/apps/game/components/gm-panel/gmPanelStore";
import { CharacterCreator } from "@/apps/game/components/gm-panel/creator/CharacterCreator";

/** The join form a player fills in, kept by the panel (the Session tab shows it too) */
export interface GMJoinForm {
  joinUrl: string;
  setJoinUrl: (url: string) => void;
  joinPlayerName: string;
  setJoinPlayerName: (name: string) => void;
  joinPresetIdx: number;
  setJoinPresetIdx: (index: number) => void;
  /** A character the player made (GMCharacters id); '' joins with the quick build instead */
  joinCharacterId: string;
  setJoinCharacterId: (id: string) => void;
  startJoin: () => void;
}

/** Joining a GM's game: the form, then the join's progress */
export const JoinCard: React.FC<{ join: GMJoinForm; leaveJoin: () => void }> = ({ join, leaveJoin }) => {
  const { joinUrl, setJoinUrl, joinPlayerName, setJoinPlayerName, joinPresetIdx, setJoinPresetIdx, joinCharacterId, setJoinCharacterId, startJoin } = join;
  const [creatorOpen, setCreatorOpen] = useState(false);
  const characters = KotOR.GMCharacters.list();
  const joinState = GMNetworkManager.joinState;
  const joinInProgress = GMNetworkManager.role === 'client' && joinState !== 'playing' && joinState !== 'idle';
  const joinStatusText: Record<string, [string, string]> = {
    connecting: ['Connecting…', `Reaching ${GMNetworkManager.serverUrl}`],
    'waiting-for-host': ['Waiting for the GM', 'You are connected, but no GM is hosting yet. You will join as soon as they click Host.'],
    joining: ['Joining…', 'The GM is sending you the scene and your character.'],
  };

  return (
    <div className="gm-join" role="dialog" aria-label="Join a GM's game">
      <div className="gm-join-title">Join a GM&apos;s game</div>
      {joinInProgress ? (
        <>
          <div className="gm-join-status">
            <span className="gm-join-spinner" aria-hidden="true" />
            <div>
              <div className="gm-join-status-title">{joinStatusText[joinState]?.[0]}</div>
              <div className="gm-join-status-text">{joinStatusText[joinState]?.[1]}</div>
            </div>
          </div>
          <div className="gm-row" style={{ justifyContent: 'flex-end' }}>
            <button className="gm-btn" onClick={leaveJoin}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          {joinState === 'failed' && <div className="gm-join-error">{GMNetworkManager.joinError}</div>}
          <ol className="gm-join-steps">
            <li>Your GM starts <b>GM Mode</b> and clicks <b>Session → Start Hosting</b>.</li>
            <li>Enter their address below. Playing on this computer? Leave it as it is.</li>
            <li>Name your character, pick a build, and join. You will appear in the GM&apos;s scene.</li>
          </ol>
          <div className="gm-field">
            <label htmlFor="gm-join-url">GM&apos;s address</label>
            <input id="gm-join-url" className="gm-input" value={joinUrl} onChange={e => setJoinUrl(e.target.value)} placeholder="ws://192.168.1.50:7878" />
          </div>
          <div className="gm-grid-2">
            <div className="gm-field">
              <label htmlFor="gm-join-name">Character name</label>
              <input id="gm-join-name" className="gm-input" value={joinPlayerName} onChange={e => setJoinPlayerName(e.target.value)} />
            </div>
            <div className="gm-field">
              <label htmlFor="gm-join-build">Character</label>
              <select
                id="gm-join-build"
                className="gm-select"
                value={joinCharacterId ? `chr:${joinCharacterId}` : `preset:${joinPresetIdx}`}
                onChange={e => {
                  const [kind, value] = e.target.value.split(':');
                  if (kind === 'chr') {
                    setJoinCharacterId(value);
                    const c = characters.find((x) => x.id === value);
                    if (c) setJoinPlayerName(c.name);
                  } else {
                    setJoinCharacterId('');
                    setJoinPresetIdx(Number(value));
                  }
                }}
              >
                {characters.length > 0 && (
                  <optgroup label="Your characters">
                    {characters.map((c) => <option key={c.id} value={`chr:${c.id}`}>{c.name} (Lv.{c.level})</option>)}
                  </optgroup>
                )}
                <optgroup label="Quick builds">
                  {GMManager.PLAYER_PRESETS.map((p, i) => (
                    <option key={i} value={`preset:${i}`}>{p.name} (Lv.{p.level})</option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>
          <div className="gm-row" style={{ justifyContent: 'flex-start' }}>
            <button className="gm-btn" onClick={() => setCreatorOpen(true)}>Make or edit characters…</button>
          </div>
          {creatorOpen && (
            <CharacterCreator
              onClose={() => setCreatorOpen(false)}
              useLabel="Choose"
              onUse={(c) => { setJoinCharacterId(c.id); setJoinPlayerName(c.name); setCreatorOpen(false); }}
              startEditing={characters.length === 0}
            />
          )}
          <div className="gm-row" style={{ justifyContent: 'flex-end' }}>
            <button className="gm-btn" onClick={leaveJoin}>{joinState === 'failed' ? 'Back to menu' : 'Cancel'}</button>
            <button className="gm-btn success" onClick={startJoin} disabled={!joinUrl.trim() || !joinPlayerName.trim()}>
              {joinState === 'failed' ? 'Try again' : 'Join game'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

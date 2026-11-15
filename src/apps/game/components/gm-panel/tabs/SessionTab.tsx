import React, { useRef, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import {
  GMManager, GMNetworkManager, GMPlayers, GMSessions, useGMStore,
} from "@/apps/game/components/gm-panel/gmPanelStore";
import type { DrawerTab } from "@/apps/game/components/gm-panel/gmPanelStore";
import type { GMJoinForm } from "@/apps/game/components/gm-panel/overlays/JoinCard";

/** Session tab: hosting or joining, session rules, saved sessions, and chat */
export const SessionTab: React.FC<{ active: boolean; onOpenTab: (tab: DrawerTab) => void; join: GMJoinForm }> = React.memo(({ active, onOpenTab, join }) => {
  const forceUpdate = useGMStore(active);
  const setDrawerTab = onOpenTab;
  const { joinUrl, setJoinUrl, joinPlayerName, setJoinPlayerName, joinPresetIdx, setJoinPresetIdx, startJoin } = join;
  const defaultWsHost = typeof window !== 'undefined' && window.location?.hostname ? window.location.hostname : 'localhost';
  const [hostPortUrl, setHostPortUrl] = useState<string>(`ws://${defaultWsHost}:7878`);
  const [hostSessionName, setHostSessionName] = useState<string>('Neverwinter Knights - KotOR GM Session');
  const [chatInput, setChatInput] = useState<string>('');
  // Session save & load
  const [sessionName, setSessionName] = useState<string>('');
  const sessionFileRef = useRef<HTMLInputElement | null>(null);
  const currentModuleName = KotOR.GameState.module?.filename || 'Loading...';
  const currentLeader = KotOR.GameState.getCurrentPlayer();
  const isPlayerView = !GMManager.isGMUser();
  const downloadSession = (save: KotOR.GMSessionSave) => {
    const blob = new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${save.name.replace(/[^a-z0-9_-]+/gi, '_') || 'session'}.gmsession.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const onImportSession = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const save = GMSessions.importSessionJSON(await file.text());
    GMNetworkManager.appendChat('System', save ? `Imported session "${save.name}".` : `${file.name} isn't a GM session save.`);
    forceUpdate();
  };
  const deathRule = isPlayerView ? GMNetworkManager.sessionRules.deathRule : GMPlayers.deathRule;

  return (
    <>
      {GMNetworkManager.role === 'offline' ? (
          <div className="gm-section">
            <div className="gm-section-title">Host a game</div>
            <div className="gm-field">
              <label>Name</label>
              <input
                className="gm-input"
                value={hostSessionName}
                onChange={e => setHostSessionName(e.target.value)}
              />
            </div>
            <div className="gm-field" title="The relay starts with npm run dev, or on its own with npm run gm:server. For players outside your network, forward TCP port 7878 (and 8080 for the web client) on your router.">
              <label>Relay address</label>
              <input
                className="gm-input"
                value={hostPortUrl}
                onChange={e => setHostPortUrl(e.target.value)}
              />
            </div>
            <button
              className="gm-btn success"
              onClick={() => GMNetworkManager.hostSession(hostPortUrl, hostSessionName)}
            >
              Start hosting
            </button>
          </div>
      ) : (
        <div className="gm-section">
          <div className="gm-section-title">
            <span>{GMNetworkManager.role === 'host' ? 'Hosting' : 'In a game'}</span>
            {isPlayerView ? (
              // A player who leaves goes back to the main menu; staying in the scene offline would hand them the GM tools
              <button className="gm-btn small danger" onClick={() => KotOR.GameState.ReturnToMainMenu()}>
                Leave game
              </button>
            ) : (
              <button className="gm-btn small danger" onClick={() => GMNetworkManager.disconnect()}>
                Stop hosting
              </button>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: '#9ed2ff' }}>
            Status: <b>{GMNetworkManager.statusMessage}</b>
          </div>
          {GMNetworkManager.role === 'host' && (
            <>
              <div className="gm-row">
                <span className="gm-hint" style={{ flex: 1 }}>
                  {GMNetworkManager.peers.size} connected. <a href="#" onClick={(e) => { e.preventDefault(); setDrawerTab('players'); }}>See them on Players</a>
                </span>
                <button
                  className="gm-btn small"
                  onClick={() => GMNetworkManager.sendWorldSnapshot()}
                  title="If a player's scene looks wrong, send them the whole world again"
                >
                  Resend the world
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="gm-section">
        <div className="gm-section-title">Chat</div>
        <div className="gm-chat-box">
          {GMNetworkManager.chatLog.length === 0 ? (
            <div style={{ color: '#6c8dab' }}>No messages yet.</div>
          ) : (
            GMNetworkManager.chatLog.map((entry, idx) => (
              <div key={idx} className="gm-chat-line">
                <span className="sender">[{entry.sender}]:</span>
                <span>{entry.text}</span>
              </div>
            ))
          )}
        </div>
        <div className="gm-row">
          <input
            className="gm-input"
            style={{ flex: 1 }}
            placeholder="Say something to everyone"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && chatInput.trim()) {
                GMNetworkManager.sendChat(
                  GMNetworkManager.role === 'host' ? 'GM' : (currentLeader?.getName() || joinPlayerName || 'Player'),
                  chatInput.trim()
                );
                setChatInput('');
              }
            }}
          />
          <button
            className="gm-btn small active"
            onClick={() => {
              if (!chatInput.trim()) return;
              GMNetworkManager.sendChat(
                GMNetworkManager.role === 'host' ? 'GM' : (currentLeader?.getName() || joinPlayerName || 'Player'),
                chatInput.trim()
              );
              setChatInput('');
            }}
          >
            Send
          </button>
        </div>
      </div>

      {!isPlayerView && (
        <>
        <div className="gm-section">
          <div className="gm-section-title">When a player falls</div>
          <select className="gm-select" value={GMPlayers.deathRule} onChange={(e) => GMPlayers.setDeathRule(e.target.value as KotOR.GMDeathRule)}>
            <option value="kotor">KotOR rules: they get up with 1 HP once no enemy is near</option>
            <option value="gm">GM decides: they stay down until you revive them</option>
            <option value="respawn">Respawn: after {GMPlayers.RESPAWN_DELAY_SECONDS}s they can respawn at the entrance</option>
          </select>
          <div className="gm-hint">You can always revive them from the Players tab.</div>
        </div>
        <details className="gm-section" open={GMSessions.getSavedSessions().length > 0}>
          <summary>Saved sessions <span className="gm-summary-note">{GMSessions.getSavedSessions().length} saved</span></summary>
          <div className="gm-row">
            <input
              className="gm-input"
              style={{ flex: 1 }}
              value={sessionName}
              onChange={e => setSessionName(e.target.value)}
              placeholder={`${currentModuleName} session`}
            />
            <button className="gm-btn small success" onClick={() => { if (GMSessions.saveSession(sessionName)) setSessionName(''); }}>
              Save
            </button>
            <button className="gm-btn small" onClick={() => sessionFileRef.current?.click()} title="Add a session exported from another browser">
              Import…
            </button>
            <input ref={sessionFileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImportSession} />
          </div>
          <div className="gm-hint">
            Keeps the scene, what you placed, doors and every player character. Players get theirs back by joining under the same name.
          </div>
          <div className="gm-list">
            {GMSessions.getSavedSessions().map(save => (
              <div key={save.id} className="gm-card">
                <div className="gm-card-info">
                  <div className="gm-card-title">{save.name}</div>
                  <div className="gm-card-sub">
                    {save.scene.module} • {save.objects.length} objects • {save.players.length} characters • {new Date(save.savedAt).toLocaleString()}
                  </div>
                </div>
                <div className="gm-row">
                  <button className="gm-btn small active" onClick={() => GMSessions.loadSession(save)}>Load</button>
                  <button className="gm-btn small" onClick={() => downloadSession(save)}>Export</button>
                  <button className="gm-btn small danger" onClick={() => GMSessions.deleteSavedSession(save.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </details>

        </>
      )}
      {GMNetworkManager.role === 'offline' && (
          <details className="gm-section">
            <summary>Join someone else's game <span className="gm-summary-note">as a player</span></summary>
            <div className="gm-field">
              <label>Their address</label>
              <input
                className="gm-input"
                value={joinUrl}
                onChange={e => setJoinUrl(e.target.value)}
                placeholder="ws://192.168.1.50:7878"
              />
            </div>
            <div className="gm-grid-2">
              <div className="gm-field">
                <label>Your name</label>
                <input
                  className="gm-input"
                  value={joinPlayerName}
                  onChange={e => setJoinPlayerName(e.target.value)}
                />
              </div>
              <div className="gm-field">
                <label>Character</label>
                <select
                  className="gm-select"
                  value={joinPresetIdx}
                  onChange={e => setJoinPresetIdx(Number(e.target.value))}
                >
                  {GMManager.PLAYER_PRESETS.map((p, i) => (
                    <option key={i} value={i}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <button className="gm-btn active" onClick={startJoin}>
              Join
            </button>
          </details>
      )}
    </>
  );
});

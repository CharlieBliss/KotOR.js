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
        <div className="gm-section">
          <div className="gm-section-title">Power wheel</div>
          <label className="gm-checkbox" title={`Opening the wheel (Q) pauses everyone for up to ${GMManager.WHEEL_HOLD_SECONDS}s while that player picks`}>
            <input type="checkbox" checked={GMManager.tacticalPause} onChange={(e) => GMManager.setTacticalPause(e.target.checked)} />
            Tactical pause: the world waits while a player chooses
          </label>
          <div className="gm-hint">Good for one or two players or slow fights. Off: the wheel works in real time. Each pause lasts at most {GMManager.WHEEL_HOLD_SECONDS}s.</div>
        </div>
        <div className="gm-section">
          <div className="gm-section-title">Combat pacing</div>
          <label className="gm-field" title="Plan-then-play: the world holds while everyone picks what to do, then one round (3 s) plays">
            <span>World holds</span>
            <select
              className="gm-input"
              value={KotOR.GMPacing.mode}
              onChange={(e) => KotOR.GMPacing.configure({ mode: e.target.value as any })}
            >
              {KotOR.GM_PACING_MODES.map((m) => <option key={m.id} value={m.id} title={m.title}>{m.label}</option>)}
            </select>
          </label>
          <label className="gm-field" title="After this long, the round plays even if someone is still choosing">
            <span>Time to plan</span>
            <select
              className="gm-input"
              value={KotOR.GMPacing.timeLimit}
              onChange={(e) => KotOR.GMPacing.configure({ timeLimit: Number(e.target.value) })}
            >
              <option value={0}>No limit</option>
              <option value={15}>15 seconds</option>
              <option value={30}>30 seconds</option>
              <option value={60}>60 seconds</option>
            </select>
          </label>
          <label className="gm-checkbox" title="Players see what each enemy is about to do while they plan">
            <input type="checkbox" checked={KotOR.GMPacing.showIntents} onChange={(e) => KotOR.GMPacing.configure({ showIntents: e.target.checked })} />
            Show enemy intents
          </label>
          <div className="gm-hint">Only during fights. Players steer their move with the movement keys and press Ready (Space or R3); you can press Go any time. Change it mid-fight to speed up an easy one.</div>
        </div>
        <CreationLimits />
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

/**
 * How far players' own characters may go beyond the game's rules (CharacterRules), sent to players with the
 * session rules; the host holds joining characters to them
 */
const CreationLimits: React.FC = () => {
  const limits = GMPlayers.creationLimits || {};
  const set = (patch: Record<string, any>) => GMPlayers.setCreationLimits({ ...limits, ...patch });
  const range = Array.isArray(limits.level) ? limits.level : typeof limits.level === 'number' ? [limits.level, limits.level] : null;
  return (
    <details className="gm-section">
      <summary>Players&apos; own characters <span className="gm-summary-note">{range ? `level ${range[0]}${range[1] !== range[0] ? `–${range[1]}` : ''}` : 'game rules'}</span></summary>
      <div className="gm-grid-2">
        <div className="gm-field">
          <label>Lowest level</label>
          <input className="gm-input" type="number" min={1} max={20} value={range ? range[0] : 1}
            onChange={(e) => { const lo = Math.max(1, Math.min(20, Number(e.target.value) || 1)); set({ level: [lo, Math.max(lo, range ? range[1] : 20)] }); }} />
        </div>
        <div className="gm-field">
          <label>Highest level</label>
          <input className="gm-input" type="number" min={1} max={20} value={range ? range[1] : 20}
            onChange={(e) => { const hi = Math.max(1, Math.min(20, Number(e.target.value) || 20)); set({ level: [Math.min(hi, range ? range[0] : 1), hi] }); }} />
        </div>
        <div className="gm-field">
          <label>Extra ability points</label>
          <input className="gm-input" type="number" min={0} max={40} value={limits.extraPoints || 0}
            onChange={(e) => set({ extraPoints: Math.max(0, Number(e.target.value) || 0) })} />
        </div>
      </div>
      <label className="gm-checkbox"><input type="checkbox" checked={limits.anyModel !== false} onChange={(e) => set({ anyModel: e.target.checked })} /> Any model (not just the player bodies)</label>
      <label className="gm-checkbox"><input type="checkbox" checked={!!limits.freeFeats} onChange={(e) => set({ freeFeats: e.target.checked })} /> Free feat picks (any feat, not just the class&apos;s)</label>
      <label className="gm-checkbox"><input type="checkbox" checked={limits.gear !== false} onChange={(e) => set({ gear: e.target.checked })} /> Players choose their starting equipment</label>
      <div className="gm-hint">Characters that don&apos;t fit are adjusted when they join, and you&apos;re told what changed.</div>
    </details>
  );
};

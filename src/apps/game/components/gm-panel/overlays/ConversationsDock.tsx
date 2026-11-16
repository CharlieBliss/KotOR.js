import React, { useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { GMNetworkManager, GMConversationManager, GMPlayers, useGMStore } from "@/apps/game/components/gm-panel/gmPanelStore";

const SHOTS: { id: 'close' | 'shoulder' | 'both'; label: string; title: string }[] = [
  { id: 'close', label: 'Close-up', title: 'Head and shoulders, facing them' },
  { id: 'shoulder', label: 'Over shoulder', title: 'Over the shoulder of whoever they face' },
  { id: 'both', label: 'Both', title: 'Both of them, from the side' },
];

/**
 * Directing a conversation: who players' cameras are on (Auto is KotOR's own: the NPC while it speaks, then the
 * player choosing a reply), the shot, and whose eyes the GM watches through.
 */
const ConversationCamera: React.FC<{ conv: any }> = ({ conv }) => {
  const camera = conv.camera || { focus: 'auto', shot: 'close' };
  const set = (patch: Partial<{ focus: string; shot: string }>) => GMConversationManager.setCamera(conv.id, { ...camera, ...patch });
  const people = [...conv.peers].map((peerId: string) => ({
    peerId,
    name: GMNetworkManager.peers.get(peerId)?.name || 'Player',
    netId: GMPlayers.getPeerActor(peerId)?.gmNetId as string | undefined,
  }));
  const watching = GMConversationManager.watching?.convId === conv.id ? GMConversationManager.watching.peerId : null;
  return (
    <div className="gm-conversation-camera">
      <div className="gm-conversation-camera-row">
        <span className="gm-conversation-camera-label">Camera on</span>
        <div className="gm-segmented" role="group" aria-label="Camera on">
          <button className={`gm-btn small ${camera.focus === 'auto' ? 'active' : ''}`} onClick={() => set({ focus: 'auto' })} title="KotOR's own: the NPC while it speaks, then the player choosing a reply">Auto</button>
          <button className={`gm-btn small ${camera.focus === conv.npcNetId ? 'active' : ''}`} onClick={() => set({ focus: conv.npcNetId })}>{conv.npcName}</button>
          {people.filter((p) => p.netId).map((p) => (
            <button key={p.peerId} className={`gm-btn small ${camera.focus === p.netId ? 'active' : ''}`} onClick={() => set({ focus: p.netId })}>{p.name}</button>
          ))}
        </div>
      </div>
      {camera.focus !== 'auto' && (
        <div className="gm-conversation-camera-row">
          <span className="gm-conversation-camera-label">Shot</span>
          <div className="gm-segmented" role="group" aria-label="Shot">
            {SHOTS.map((s) => (
              <button key={s.id} className={`gm-btn small ${camera.shot === s.id ? 'active' : ''}`} title={s.title} onClick={() => set({ shot: s.id })}>{s.label}</button>
            ))}
          </div>
        </div>
      )}
      <div className="gm-conversation-camera-row">
        <span className="gm-conversation-camera-label">You see</span>
        <div className="gm-segmented" role="group" aria-label="Your view">
          <button className={`gm-btn small ${!watching ? 'active' : ''}`} onClick={() => GMConversationManager.setWatching(null)}>GM camera</button>
          {people.map((p) => (
            <button key={p.peerId} className={`gm-btn small ${watching === p.peerId ? 'active' : ''}`} onClick={() => GMConversationManager.setWatching(conv.id, p.peerId)} title={`What ${p.name} sees`}>{p.name}&apos;s view</button>
          ))}
        </div>
      </div>
    </div>
  );
};

/** The GM speaks for NPCs players are talking to: one card per conversation */
export const ConversationsDock: React.FC = () => {
  useGMStore();
  // GM conversation drafts, per conversation: what the NPC says next and the replies offered
  const [talkDrafts, setTalkDrafts] = useState<Record<string, { text: string; replies: string }>>({});
  const conversations = [...GMConversationManager.conversations.values()];

  if (!conversations.length) return null;

  return (
    <div className="gm-conversations">
      {conversations.map(conv => {
        const draft = talkDrafts[conv.id] || { text: '', replies: '' };
        const setDraft = (patch: Partial<{ text: string; replies: string }>) =>
          setTalkDrafts(d => ({ ...d, [conv.id]: { ...draft, ...patch } }));
        const send = () => {
          const replies = draft.replies.split('\n').map(r => r.trim()).filter(Boolean);
          if (GMConversationManager.say(conv.id, draft.text, replies)) setDraft({ text: '' });
        };
        const players = [...conv.peers].map(id => GMNetworkManager.peers.get(id)?.name || 'Player').join(', ');
        return (
          <div key={conv.id} className="gm-conversation" role="region" aria-label={`Conversation as ${conv.npcName}`}>
            <div className="gm-conversation-header">
              <span>Speaking as <b>{conv.npcName}</b> · {players}</span>
              <button className="gm-btn small danger" onClick={() => GMConversationManager.end(conv.id)}>End</button>
            </div>
            <ConversationCamera conv={conv} />
            <div className="gm-conversation-log">
              {conv.transcript.slice(-8).map((t, i) => (
                <div key={i} className={t.npc ? 'npc' : 'player'}>
                  <span className="who">{t.speaker}:</span> {t.text}
                </div>
              ))}
              {conv.lastLine && conv.transcript.length > 0 && conv.transcript[conv.transcript.length - 1].npc && (
                <div className="waiting">Waiting for a reply: {conv.lastLine.replies.join(' / ')}</div>
              )}
            </div>
            <textarea
              className="gm-input"
              rows={2}
              value={draft.text}
              onChange={e => setDraft({ text: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
              placeholder={`What ${conv.npcName} says`}
            />
            <textarea
              className="gm-input"
              rows={2}
              value={draft.replies}
              onChange={e => setDraft({ replies: e.target.value })}
              placeholder="Replies players can pick, one per line (none: [Continue])"
            />
            <div className="gm-row" style={{ justifyContent: 'space-between' }}>
              <span className="gm-conversation-hint">Ctrl+Enter sends · players can always end it</span>
              <button className="gm-btn small success" disabled={!draft.text.trim()} onClick={send}>Say</button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

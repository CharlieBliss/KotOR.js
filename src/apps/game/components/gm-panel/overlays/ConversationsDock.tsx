import React, { useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { GMNetworkManager, GMConversationManager, useGMStore } from "@/apps/game/components/gm-panel/gmPanelStore";

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

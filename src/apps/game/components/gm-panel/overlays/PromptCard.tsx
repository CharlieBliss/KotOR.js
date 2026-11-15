import React from "react";
import * as KotOR from "@/apps/game/KotOR";
import { GMNetworkManager, useGMStore } from "@/apps/game/components/gm-panel/gmPanelStore";

/** A question from the GM, waiting for this player's reply */
export const PromptCard: React.FC = () => {
  useGMStore();

  if (!GMNetworkManager.pendingPrompts.length) return null;

  const prompt = GMNetworkManager.pendingPrompts[0];
  return (
    <div className="gm-prompt" role="dialog" aria-label={`${prompt.speaker} asks`}>
      <div className="gm-prompt-speaker">{prompt.speaker}</div>
      <div className="gm-prompt-text">{prompt.text}</div>
      <div className="gm-prompt-options">
        {prompt.options.map((option, i) => (
          <button key={i} className="gm-btn" onClick={() => GMNetworkManager.answerPrompt(prompt.promptId, i)}>
            {i + 1}. {option}
          </button>
        ))}
      </div>
    </div>
  );
};

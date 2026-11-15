import React, { useRef } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { GMNetworkManager, GMPlayers, useGMStore } from "@/apps/game/components/gm-panel/gmPanelStore";

/** A player's character is down: what happens next, by the session's rule */
export const DownedBanner: React.FC = () => {
  useGMStore();
  // When our own character fell (player view), for the respawn countdown
  const downedSince = useRef<number>(0);
  const myCharacter = KotOR.GameState.getCurrentPlayer();
  const iAmDown = !!myCharacter && myCharacter.isDead();
  if (iAmDown && !downedSince.current) downedSince.current = Date.now();
  if (!iAmDown) downedSince.current = 0;
  const deathRule = GMNetworkManager.sessionRules.deathRule;
  const respawnIn = iAmDown ? Math.max(0, Math.ceil(GMPlayers.RESPAWN_DELAY_SECONDS - (Date.now() - downedSince.current) / 1000)) : 0;
  if (!iAmDown) return null;

  return (
    <div className="gm-prompt gm-downed" role="status">
      <div className="gm-prompt-speaker">You're down</div>
      <div className="gm-prompt-text">
        {deathRule === 'kotor' && 'You will get back up once no enemies are near, or when the GM revives you.'}
        {deathRule === 'gm' && 'The GM will decide what happens to you.'}
        {deathRule === 'respawn' && (respawnIn > 0
          ? `You can respawn at the entrance in ${respawnIn}s, or the GM may revive you.`
          : 'Respawn at the entrance, or wait for the GM to revive you.')}
      </div>
      {deathRule === 'respawn' && (
        <div className="gm-prompt-options">
          <button className="gm-btn success" disabled={respawnIn > 0} onClick={() => GMNetworkManager.requestRespawn()}>
            Respawn at the entrance
          </button>
        </div>
      )}
    </div>
  );
};

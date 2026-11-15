import React, { useRef, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { ItemOptions, PlayerOptions, SkillOptions } from "@/apps/game/components/gm-panel/controls/options";
// Types only: the game bundle must use the engine library's single GM managers via the KotOR external
import type { GMCheck, GMPlayerSpawnConfig } from "@/managers/GMManager";
import {
  GMManager, GMNetworkManager, GMChecks, GMPlayers, GMSpawner, useGMStore,
} from "@/apps/game/components/gm-panel/gmPanelStore";
import type { DrawerTab } from "@/apps/game/components/gm-panel/gmPanelStore";

/** Players tab: the player characters, calling checks, rewards, and adding characters */
export const PlayersTab: React.FC<{ active: boolean; onOpenTab: (tab: DrawerTab) => void }> = React.memo(({ active, onOpenTab }) => {
  const forceUpdate = useGMStore(active);
  const setDrawerTab = onOpenTab;
  // Players tab states
  const [playerCfg, setPlayerCfg] = useState<GMPlayerSpawnConfig>({ ...GMManager.pendingPlayerConfig });
  // A check the GM calls for: who (a player net id, 'all' or 'selected'), what, how hard, and whether players see it
  const [checkWho, setCheckWho] = useState<string>('all');
  const [checkWhat, setCheckWhat] = useState<string>('skill:4');
  const [checkDc, setCheckDc] = useState<number>(15);
  const [checkSecret, setCheckSecret] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // DM tools
  const [rewardXp, setRewardXp] = useState<number>(250);
  const [rewardItem, setRewardItem] = useState<string>('g_i_medeqpmnt01');
  const updatePlayerCfg = (patch: Partial<GMPlayerSpawnConfig>) => {
    const next = { ...playerCfg, ...patch };
    setPlayerCfg(next);
    GMManager.pendingPlayerConfig = next;
  };
  const currentLeader = KotOR.GameState.getCurrentPlayer();
  const selectedObj = GMManager.selectedObject;
  // The selected creature, when there is one
  const selectedCreature = selectedObj && KotOR.GMObjectKind.isCreature(selectedObj)
    ? (selectedObj as KotOR.ModuleCreature)
    : null;
  const connectedPeers = [...GMNetworkManager.peers.values()];
  const handleImportUTCFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ab = await file.arrayBuffer();
    const nameWithoutExt = file.name.replace(/\.utc$/i, '');
    await GMSpawner.importPlayerFromUTCBuffer(new Uint8Array(ab), nameWithoutExt, true);
    e.target.value = '';
  };
  const fallenPlayers = GMManager.getPlayerCharacters().filter((pc) => pc.isDead());

  return (
    <>
      {fallenPlayers.length > 0 && (
        <div className="gm-section">
          <div className="gm-section-title">
            <span>Fallen players ({fallenPlayers.length})</span>
            {fallenPlayers.length > 1 && (
              <button className="gm-btn small success" onClick={() => GMPlayers.reviveAllPlayers()}>Revive everyone</button>
            )}
          </div>
          <div className="gm-list">
            {fallenPlayers.map((pc) => (
              <div key={pc.gmNetId || pc.id} className="gm-card">
                <div className="gm-card-info">
                  <div className="gm-card-title">{pc.getName()}</div>
                  <div className="gm-card-sub">Down for {Math.round((Date.now() - (pc.gmDowned?.since || Date.now())) / 1000)}s</div>
                </div>
                <div className="gm-row">
                  <button className="gm-btn small success" onClick={() => GMPlayers.revivePlayer(pc)} title="Back on their feet with full vitality">Revive</button>
                  <button className="gm-btn small" onClick={() => GMPlayers.respawnPlayer(pc)} title="Back at the scene's entry with half their vitality">Send to entry</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="gm-section">
        <div className="gm-section-title">
          <span>In the scene ({KotOR.GameState.PartyManager.party.length})</span>
          {GMManager.controlMode === 'POSSESS' && (
            <button className="gm-btn small warning" onClick={() => GMManager.enterFreeCamera(true)}>
              Stop playing (free camera)
            </button>
          )}
        </div>

        {KotOR.GameState.PartyManager.party.length === 0 ? (
          <div className="gm-hint">
            No player characters yet. Add one below: a quick build, your own, or one from a save.
          </div>
        ) : (
          <div className="gm-list">
            {KotOR.GameState.PartyManager.party.map((member, i) => {
              const isControlled = GMManager.controlMode === 'POSSESS' && currentLeader === member;
              return (
                <div key={member.id || i} className={`gm-card ${isControlled ? 'selected' : ''}`}>
                  <div className="gm-card-info">
                    <div className="gm-card-title">
                      {member.getName() || member.firstName || 'Player'} {isControlled ? '(Controlling)' : ''}
                    </div>
                    <div className="gm-card-sub">
                      HP {member.getHP()}/{member.getMaxHP()} • FP {member.getFP()}/{member.getMaxFP()}
                    </div>
                  </div>
                  <div className="gm-row">
                    <button
                      className="gm-btn small success"
                      onClick={() => GMManager.possessCharacter(member)}
                    >
                      {isControlled ? 'Playing' : 'Play as'}
                    </button>
                    <button
                      className="gm-btn small"
                      onClick={() => {
                        GMManager.selectObject(member);
                        setDrawerTab('inspector');
                      }}
                    >
                      Inspect
                    </button>
                    <button
                      className="gm-btn small danger"
                      onClick={() => GMManager.deleteObject(member)}
                      title="Remove from the scene"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {GMNetworkManager.role === 'host' && (
        <div className="gm-section">
          <div className="gm-section-title">Connected players ({connectedPeers.length})</div>
          {connectedPeers.length === 0 ? (
            <div className="gm-hint">Nobody has joined yet. Host from the Session tab and share the address.</div>
          ) : (
            <>
              <div className="gm-grid-2">
                <div className="gm-field">
                  <label>XP to give</label>
                  <input className="gm-input" type="number" min={1} value={rewardXp} onChange={e => setRewardXp(Number(e.target.value))} />
                </div>
                <div className="gm-field">
                  <label>Item to give (resref)</label>
                  <input className="gm-input" value={rewardItem} onChange={e => setRewardItem(e.target.value)} />
                </div>
              </div>
              <div className="gm-list">
                {connectedPeers.map(peer => {
                  const pc = GMPlayers.getPeerActor(peer.peerId);
                  return (
                    <div key={peer.peerId} className="gm-card">
                      <div className="gm-card-info">
                        <div className="gm-card-title">{peer.name}</div>
                        <div className="gm-card-sub">
                          {pc ? `${pc.getName()} • Level ${pc.classes?.[0]?.level ?? '?'} • HP ${pc.getHP()}/${pc.getMaxHP()} • XP ${pc.experience || 0}` : 'No character yet'}
                        </div>
                      </div>
                      <div className="gm-row">
                        <button className="gm-btn small" disabled={!pc} onClick={() => GMPlayers.giveXP(peer.peerId, rewardXp)} title={`Give ${peer.name} ${rewardXp} XP`}>
                          + XP
                        </button>
                        <button className="gm-btn small" disabled={!pc || !rewardItem.trim()} onClick={() => GMPlayers.giveItem(peer.peerId, rewardItem)} title={`Give ${peer.name} ${rewardItem}`}>
                          + Item
                        </button>
                        <button className="gm-btn small" disabled={!pc} onClick={() => { if (pc) { GMManager.selectObject(pc); setDrawerTab('inspector'); } }} title="Inspect their character">
                          Inspect
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
      {(() => {
        const players = GMManager.getPlayerCharacters().filter((pc) => !pc.isDead());
        const targets = (): KotOR.ModuleCreature[] => {
          if (checkWho === 'all') return players;
          if (checkWho === 'selected') return selectedCreature ? [selectedCreature] : [];
          const pc = GMManager.netIdMap.get(checkWho);
          return pc ? [pc as KotOR.ModuleCreature] : [];
        };
        const parseCheck = (value: string): GMCheck => {
          const [kind, id] = value.split(':');
          return kind === 'skill' ? { kind: 'skill', skill: Number(id) } : { kind: 'save', save: id as 'fortitude' | 'reflex' | 'will' };
        };
        return (
          <details className="gm-section">
            <summary>Call for a check <span className="gm-summary-note">skill or save, DC {checkDc}</span></summary>
            <div className="gm-grid-2">
              <div className="gm-field">
                <label>Who</label>
                <select className="gm-select" value={checkWho} onChange={e => setCheckWho(e.target.value)}>
                  <option value="all">Every player ({players.length})</option>
                  {selectedCreature && <option value="selected">Selected: {selectedCreature.getName()}</option>}
                  <PlayerOptions players={players} />
                </select>
              </div>
              <div className="gm-field">
                <label>Check</label>
                <select className="gm-select" value={checkWhat} onChange={e => setCheckWhat(e.target.value)}>
                  <optgroup label="Skills">
                    <SkillOptions prefix="skill:" />
                  </optgroup>
                  <optgroup label="Saving throws">
                    <option value="save:fortitude">Fortitude</option>
                    <option value="save:reflex">Reflex</option>
                    <option value="save:will">Will</option>
                  </optgroup>
                </select>
              </div>
              <div className="gm-field">
                <label title="Easy 10, average 15, hard 20, very hard 25">Difficulty (DC)</label>
                <input className="gm-input" type="number" min={1} max={60} value={checkDc} onChange={e => setCheckDc(Number(e.target.value) || 0)} />
              </div>
              <label className="gm-checkbox" title="Only you see the result">
                <input type="checkbox" checked={checkSecret} onChange={e => setCheckSecret(e.target.checked)} />
                Secret roll
              </label>
            </div>
            <button
              className="gm-btn success"
              disabled={!targets().length}
              onClick={() => { GMChecks.callCheck(targets(), parseCheck(checkWhat), checkDc, checkSecret); forceUpdate(); }}
              title="Rolls d20 + the skill (or save) for each, as KotOR does; results go to chat"
            >
              Roll
            </button>
          </details>
        );
      })()}

      <details className="gm-section" open={KotOR.GameState.PartyManager.party.length === 0}>
        <summary>Add a character <span className="gm-summary-note">quick build, your own, or from a save</span></summary>
      <div className="gm-section">
        <div className="gm-section-title">Quick builds</div>
        <div className="gm-list" style={{ maxHeight: 155 }}>
          {GMManager.PLAYER_PRESETS.map((preset, idx) => (
            <div
              key={idx}
              className={`gm-card ${playerCfg.name === preset.name ? 'selected' : ''}`}
              onClick={() => updatePlayerCfg({ ...preset })}
            >
              <div className="gm-card-info">
                <div className="gm-card-title">{preset.name}</div>
                <div className="gm-card-sub">
                  {(() => {
                    const built = GMSpawner.buildPlayerAbilities(preset);
                    return `Lv.${preset.level} • HP ${built.maxHp} • FP ${built.maxFp} • ${built.feats.length} feats, ${built.powers.length} powers`;
                  })()}
                </div>
              </div>
              <button
                className="gm-btn small success"
                onClick={async e => {
                  e.stopPropagation();
                  updatePlayerCfg({ ...preset });
                  await GMSpawner.spawnPlayerCharacter({ ...preset, possessImmediately: true });
                }}
              >
                Add & play
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="gm-section">
        <div className="gm-section-title">Build your own</div>
        <div className="gm-grid-2">
          <div className="gm-field">
            <label>Name</label>
            <input
              className="gm-input"
              value={playerCfg.name}
              onChange={e => updatePlayerCfg({ name: e.target.value })}
            />
          </div>
          <div className="gm-field">
            <label>Class</label>
            <select
              className="gm-select"
              value={playerCfg.classId}
              onChange={e => updatePlayerCfg({ classId: Number(e.target.value) })}
            >
              <option value={0}>Soldier</option>
              <option value={1}>Scout</option>
              <option value={2}>Scoundrel</option>
              <option value={3}>Jedi Guardian</option>
              <option value={4}>Jedi Consular</option>
              <option value={5}>Jedi Sentinel</option>
            </select>
          </div>
        </div>

        <div className="gm-grid-3">
          <div className="gm-field">
            <label>Level</label>
            <input
              type="number"
              className="gm-input"
              value={playerCfg.level}
              onChange={e => updatePlayerCfg({ level: Number(e.target.value) })}
            />
          </div>
          <div className="gm-field">
            <label title="Leave blank to use the class's">HP</label>
            <input
              type="number"
              className="gm-input"
              value={playerCfg.hp ?? ''}
              placeholder={String(GMSpawner.buildPlayerAbilities({ ...playerCfg, hp: undefined }).maxHp)}
              onChange={e => updatePlayerCfg({ hp: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </div>
          <div className="gm-field">
            <label title="Leave blank to use the class's">Force points</label>
            <input
              type="number"
              className="gm-input"
              value={playerCfg.fp ?? ''}
              placeholder={String(GMSpawner.buildPlayerAbilities({ ...playerCfg, fp: undefined }).maxFp)}
              onChange={e => updatePlayerCfg({ fp: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="gm-grid-2">
          <div className="gm-field">
            <label>Weapon</label>
            <select
              className="gm-select"
              value={playerCfg.rightHandResRef || ''}
              onChange={e => updatePlayerCfg({ rightHandResRef: e.target.value })}
            >
              <ItemOptions items={GMManager.WEAPON_OPTIONS} />
            </select>
          </div>
          <div className="gm-field">
            <label>Armor or robes</label>
            <select
              className="gm-select"
              value={playerCfg.armorResRef || ''}
              onChange={e => updatePlayerCfg({ armorResRef: e.target.value })}
            >
              <ItemOptions items={GMManager.ARMOR_OPTIONS} />
            </select>
          </div>
        </div>

        <div className="gm-row">
          <button
            className="gm-btn success"
            style={{ flex: 1 }}
            onClick={() => GMSpawner.spawnPlayerCharacter({ ...playerCfg, possessImmediately: true })}
          >
            Add & play
          </button>
          <button
            className={`gm-btn warning ${GMManager.activeTool === 'place_player' ? 'active' : ''}`}
            onClick={() =>
              GMManager.setToolMode(GMManager.activeTool === 'place_player' ? 'select' : 'place_player')
            }
            title="Click in the scene to put this character there"
          >
            Place in the scene
          </button>
        </div>
      </div>

      <div className="gm-section">
        <div className="gm-section-title">
          <span>From a save ({KotOR.SaveGame.saves.length})</span>
          <button
            className="gm-btn small"
            onClick={async () => {
              await KotOR.SaveGame.GetSaveGames();
              forceUpdate();
            }}
          >
            Find saves
          </button>
        </div>

        {KotOR.SaveGame.saves.length === 0 ? (
          <div className="gm-row">
            <span style={{ fontSize: 11, color: '#8cb0d0' }}>
              "Find saves" lists the characters in your saves folder, or open a .utc file:
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".utc"
              style={{ display: 'none' }}
              onChange={handleImportUTCFile}
            />
            <button className="gm-btn small active" onClick={() => fileInputRef.current?.click()}>
              Open .utc…
            </button>
          </div>
        ) : (
          <>
            <div className="gm-list" style={{ maxHeight: 130 }}>
              {KotOR.SaveGame.saves.map((sg, idx) => (
                <div key={idx} className="gm-card">
                  <div className="gm-card-info">
                    <div className="gm-card-title">{sg.PCNAME || sg.getSaveName() || sg.folderName}</div>
                    <div className="gm-card-sub">{sg.AREANAME || sg.LASTMODULE} ({sg.folderName})</div>
                  </div>
                  <button
                    className="gm-btn small success"
                    onClick={() => GMSpawner.loadPlayerFromSaveGame(sg, true)}
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
            <div className="gm-row">
              <input
                ref={fileInputRef}
                type="file"
                accept=".utc"
                style={{ display: 'none' }}
                onChange={handleImportUTCFile}
              />
              <button className="gm-btn small" onClick={() => fileInputRef.current?.click()}>
                Open .utc…
              </button>
            </div>
          </>
        )}
      </div>
      </details>
    </>
  );
});

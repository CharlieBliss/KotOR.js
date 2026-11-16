import React, { useCallback, useEffect, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import {
  GMManager, GMNetworkManager, GMMines, GMSpawner, GMViewport, GMHistory, GMEditTools,
  useGMStore, possessCandidate as findPossessCandidate, setPanelPolling,
} from "@/apps/game/components/gm-panel/gmPanelStore";
import { editShortcut } from "@/apps/game/components/gm-panel/controls/editShortcuts";
import type { DrawerTab } from "@/apps/game/components/gm-panel/gmPanelStore";
import { JoinCard } from "@/apps/game/components/gm-panel/overlays/JoinCard";
import type { GMJoinForm } from "@/apps/game/components/gm-panel/overlays/JoinCard";
import { ConversationsDock } from "@/apps/game/components/gm-panel/overlays/ConversationsDock";
import { DownedBanner } from "@/apps/game/components/gm-panel/overlays/DownedBanner";
import { PromptCard } from "@/apps/game/components/gm-panel/overlays/PromptCard";
import { CharacterSheet } from "@/apps/game/components/gm-panel/sheet/CharacterSheet";
import type { SheetSectionId } from "@/apps/game/components/gm-panel/sheet/CharacterSheet";
import { RollFeed } from "@/apps/game/components/gm-panel/overlays/RollFeed";
import { installGameCursor } from "@/apps/game/components/gm-panel/gameCursor";
import "@/apps/game/components/gm-panel/gm-cursor.scss";
import { ScenesTab } from "@/apps/game/components/gm-panel/tabs/ScenesTab";
import { ActorsTab } from "@/apps/game/components/gm-panel/tabs/ActorsTab";
import { PlayersTab } from "@/apps/game/components/gm-panel/tabs/PlayersTab";
import { InspectorTab } from "@/apps/game/components/gm-panel/tabs/InspectorTab";
import { SessionTab } from "@/apps/game/components/gm-panel/tabs/SessionTab";
import "@/apps/game/components/gm-panel/gm-panel.scss";

/**
 * The GM panel: the toolbar, the controls strip, overlays (conversations, a downed player, the GM's
 * questions) and the drawer with its tabs. Each tab keeps its own state; a tab stays mounted, hidden,
 * once opened, so what was typed into it survives switching tabs.
 */
export const GMPanel: React.FC = () => {
  const forceUpdate = useGMStore();
  const [drawerTab, setDrawerTabState] = useState<DrawerTab>(null);
  // The character sheet: a player's own (instead of the game's Character and Abilities screens), or the GM's
  // view of a player's (from the Players tab)
  const [sheet, setSheet] = useState<{ creature: KotOR.ModuleCreature | null; section: SheetSectionId; gmView: boolean } | null>(null);
  const [opened, setOpened] = useState<Set<Exclude<DrawerTab, null>>>(() => new Set());
  const [showQuickJoinOnMenu, setShowQuickJoinOnMenu] = useState(false);

  const setDrawerTab = useCallback((tab: DrawerTab) => {
    setDrawerTabState(tab);
    if (tab) setOpened((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, []);

  // The join form (the join card and the Session tab both show it)
  const defaultWsHost = typeof window !== 'undefined' && window.location?.hostname ? window.location.hostname : 'localhost';
  const [joinUrl, setJoinUrl] = useState<string>(`ws://${defaultWsHost}:7878`);
  const [joinPlayerName, setJoinPlayerName] = useState<string>('Padawan Player');
  const [joinPresetIdx, setJoinPresetIdx] = useState<number>(0);
  const [joinCharacterId, setJoinCharacterId] = useState<string>('');

  // The main menu's join card shows the join's progress, so keep redrawing while it's up
  useEffect(() => {
    setPanelPolling(showQuickJoinOnMenu);
    return () => setPanelPolling(false);
  }, [showQuickJoinOnMenu]);

  useEffect(() => {
    const onInspect = () => setDrawerTab('inspector');
    // The game's cursor over the panel's layers, once its images can be read
    void installGameCursor();
    const onOpenJoin = () => setShowQuickJoinOnMenu(true);
    const onOpenSheet = (section: string) => setSheet({ creature: null, section: section === 'abilities' ? 'skills' : 'overview', gmView: false });
    const onOpenPlayerSheet = (creature: KotOR.ModuleCreature) => setSheet({ creature, section: 'overview', gmView: true });
    GMNetworkManager.events.addEventListener('open-character-sheet', onOpenSheet);
    GMManager.events.addEventListener('open-player-sheet', onOpenPlayerSheet);
    GMManager.events.addEventListener('inspect', onInspect);
    GMNetworkManager.events.addEventListener('open-join', onOpenJoin);

    const onKeyDown = (e: KeyboardEvent) => {
      if (!KotOR.GameState.gmMode || !GMManager.isGMUser()) return;
      // Esc puts down a placement or teleport tool, wherever focus is, and does nothing else
      // (this listener runs in the capture phase, before the game's own Esc handling opens Options)
      if (e.key === 'Escape' && GMManager.activeTool !== 'select') {
        GMManager.setToolMode('select');
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (KotOR.IngameControls.isTypingInPageField(e)) return;
      if (editShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        if (GMManager.controlMode === 'POSSESS') {
          GMManager.enterFreeCamera(true);
        } else {
          const target = findPossessCandidate();
          if (target) GMManager.possessCharacter(target);
        }
      } else if (e.code === 'KeyR' && GMViewport.isPlacementTool(GMManager.activeTool)) {
        GMViewport.rotatePlacement(e.shiftKey ? -GMViewport.PLACEMENT_KEY_STEP : GMViewport.PLACEMENT_KEY_STEP);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      GMManager.events.removeEventListener('inspect', onInspect);
      GMNetworkManager.events.removeEventListener('open-join', onOpenJoin);
      GMNetworkManager.events.removeEventListener('open-character-sheet', onOpenSheet);
      GMManager.events.removeEventListener('open-player-sheet', onOpenPlayerSheet);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [setDrawerTab]);

  const isGMMode = !!KotOR.GameState.gmMode;

  const startJoin = () => {
    const p = GMManager.PLAYER_PRESETS[joinPresetIdx] || GMManager.PLAYER_PRESETS[0];
    // A character the player made goes along whole; the host holds it to the session's rules
    const made = joinCharacterId ? KotOR.GMCharacters.get(joinCharacterId) : undefined;
    KotOR.GameState.gmMode = true;
    GMManager.active = true;
    GMNetworkManager.joinSession(joinUrl, joinPlayerName, made ? {
      name: joinPlayerName,
      appearanceId: KotOR.GMCharacters.resolveAppearance(made),
      classId: made.classId,
      rightHandResRef: made.gear?.rightHand,
      armorResRef: made.gear?.armor,
      character: { ...made, name: joinPlayerName || made.name },
    } : {
      name: joinPlayerName,
      appearanceId: p.appearanceId,
      classId: p.classId,
      rightHandResRef: p.rightHandResRef,
      armorResRef: p.armorResRef
    });
    setShowQuickJoinOnMenu(false);
  };
  const join: GMJoinForm = { joinUrl, setJoinUrl, joinPlayerName, setJoinPlayerName, joinPresetIdx, setJoinPresetIdx, joinCharacterId, setJoinCharacterId, startJoin };

  /** Stop joining (or give up after a failed join) and go back to the main menu */
  const leaveJoin = () => {
    GMNetworkManager.disconnect();
    setShowQuickJoinOnMenu(false);
    if (KotOR.GameState.module) {
      KotOR.GameState.ReturnToMainMenu();
    } else {
      KotOR.GameState.gmMode = false;
      GMManager.active = false;
    }
    forceUpdate();
  };
  const joinCard = <JoinCard join={join} leaveJoin={leaveJoin} />;

  // Joining (or a join that failed) takes the whole screen until the player has their character
  const joinState = GMNetworkManager.joinState;
  const joinInProgress = GMNetworkManager.role === 'client' && joinState !== 'playing' && joinState !== 'idle';
  if (joinInProgress || joinState === 'failed') {
    return <div className="gm-panel-root"><div className="gm-join-backdrop">{joinCard}</div></div>;
  }

  // On the main menu: the join form, opened from the menu's Join GM Game entry
  if (!isGMMode) {
    const isTSL = KotOR.GameState.GameKey === KotOR.GameEngineType.TSL;
    return (
      <div className="gm-panel-root">
        {/* TSL's main menu has no Join GM Game entry yet */}
        {isTSL && !showQuickJoinOnMenu && (
          <div className="gm-Menu-Launcher">
            <button className="gm-btn warning" onClick={() => setShowQuickJoinOnMenu(true)}>Join GM Game</button>
          </div>
        )}
        {showQuickJoinOnMenu && <div className="gm-join-backdrop">{joinCard}</div>}
      </div>
    );
  }

  const currentModuleName = KotOR.GameState.module?.filename || 'Loading...';
  const currentLeader = KotOR.GameState.getCurrentPlayer();
  const selectedObj = GMManager.selectedObject;
  const isPlayerView = !GMManager.isGMUser();
  // A player's own sheet: their character, as the host last sent it
  const canOpenSheet = isPlayerView && GMNetworkManager.role === 'client' && !!currentLeader;
  if (isPlayerView && drawerTab && drawerTab !== 'multiplayer') {
    queueMicrotask(() => setDrawerTab(null));
  }

  // Who "Play as" (and F2) would take control of
  const possessCandidate = findPossessCandidate();
  const possessCandidateName = possessCandidate?.getName() || 'new character';

  const drawerTabs: { id: Exclude<DrawerTab, null>; label: string; title: string }[] = isPlayerView
    ? [{ id: 'multiplayer', label: 'Session', title: 'Connection status and chat' }]
    : [
      { id: 'scenes', label: 'Scene', title: 'Load an area, or import a scene plan' },
      { id: 'actors', label: 'Place', title: 'Choose what the Place tool puts down: creatures, objects, mines or whole kits' },
      { id: 'players', label: `Players (${GMManager.spawnedPlayers.length})`, title: 'Player characters, checks, and adding characters' },
      { id: 'inspector', label: GMManager.selection.length > 1 ? `Inspect: ${GMManager.selection.length} selected` : selectedObj ? `Inspect: ${selectedObj.getName() || 'Selected'}` : 'Inspect', title: 'Edit the selected object, or browse everything in the scene' },
      { id: 'multiplayer', label: 'Session', title: 'Hosting, rules, saves and chat' },
    ];

  // Context-sensitive status chip and control hints shown at the bottom of the screen
  const tool = GMManager.activeTool;
  const placingName =
    tool === 'place_creature' ? GMManager.pendingCreatureConfig?.name :
    tool === 'place_placeable' ? GMManager.pendingPlaceableConfig?.name :
    tool === 'place_player' ? GMManager.pendingPlayerConfig?.name :
    tool === 'place_mine' ? `mine: ${GMMines.getMineTypes().find((m) => m.id === GMMines.pendingMineType)?.label || 'mine'}` : '';
  // What the toolbar's Place button puts down (the last kind of thing placed)
  const lastPlace = GMManager.lastPlacementTool;
  const placeButtonName =
    lastPlace === 'place_placeable' ? GMManager.pendingPlaceableConfig?.name || 'object' :
    lastPlace === 'place_player' ? GMManager.pendingPlayerConfig?.name || 'player' :
    lastPlace === 'place_mine' ? 'mine' :
    GMManager.pendingCreatureConfig?.name || 'creature';
  const teleportTarget = GMViewport.getTeleportTarget();
  let statusChip: string | null = null;
  let controlHints: [string, string][] = [];
  if (isPlayerView) {
    controlHints = [['WASD', 'move'], ['Click', 'doors, containers, enemies'], ['Tab', 'next target'], ['Esc', 'options']];
  } else if (GMViewport.isPlacementTool(tool)) {
    statusChip = `Placing: ${placingName || 'object'} · ${GMViewport.placementYawOffset}°`;
    controlHints = [['Click ground', 'place'], ['R / Shift+R or Wheel', 'rotate'], ['Esc / Right-click', 'done']];
  } else if (GMViewport.isOrderTool(tool)) {
    const who = GMViewport.orderSubject?.getName() || 'NPC';
    if (tool === 'order_move') {
      statusChip = `Order ${who}: move here`;
      controlHints = [['Click ground', 'go there, then guard it'], ['Esc / Right-click', 'cancel']];
    } else if (tool === 'order_attack') {
      statusChip = `Order ${who}: attack`;
      controlHints = [['Click a creature', 'attack it'], ['Esc / Right-click', 'cancel']];
    } else if (tool === 'order_follow') {
      statusChip = `Order ${who}: follow`;
      controlHints = [['Click a creature or player', 'follow them'], ['Esc / Right-click', 'cancel']];
    } else {
      const points = Math.max(0, GMViewport.patrolDraft.length - 1);
      statusChip = `Order ${who}: patrol · ${points} point${points === 1 ? '' : 's'}`;
      controlHints = [['Click ground', 'add a point'], ['Esc / Right-click', points ? 'start patrolling' : 'cancel']];
    }
  } else if (tool === 'face') {
    statusChip = `Turn ${GMManager.selection.length} to face…`;
    controlHints = [['Click ground or a creature', 'face it'], ['Esc / Right-click', 'cancel']];
  } else if (tool === 'teleport') {
    statusChip = teleportTarget ? `Teleport: ${teleportTarget.getName() || 'selected object'}` : 'Teleport: select something first';
    controlHints = [['Click ground', 'move it there'], ['Esc / Right-click', 'done']];
  } else if (GMManager.controlMode === 'POSSESS') {
    controlHints = [['WASD', 'move'], ['Click', 'interact'], ['F2', 'back to GM camera']];
  } else {
    controlHints = [
      ['WASD / QE', 'fly'], ['Drag', 'look'], ['Click', 'select'], ['Shift + drag', 'box'], ['Drag it', 'move'],
      ['Shift + wheel', 'turn'], ['Ctrl + Z', 'undo'], ['Double-click', 'inspect (all keys)'], ['F2', `play as ${possessCandidateName}`],
    ];
  }

  const possessCandidateOrSpawn = async () => {
    const target = possessCandidate || await GMSpawner.spawnPlayerCharacter(GMManager.pendingPlayerConfig);
    if (target) GMManager.possessCharacter(target);
  };

  // KotOR's conversation screen uses the top and bottom of the screen; keep the GM bars out of its way
  const inConversation = KotOR.GameState.Mode === KotOR.EngineMode.DIALOG;

  return (
    <div className={`gm-panel-root ${inConversation ? 'in-conversation' : ''}`}>
      {/* GM toolbar: status, drawer tabs, then viewport tools and mode controls */}
      <div className="gm-topbar">
        <div className="gm-topbar-group">
          <span className="gm-badge" title="Active scene module">
            {isPlayerView ? 'Player' : 'GM'} · {currentModuleName}
          </span>
          {GMNetworkManager.role !== 'offline' && (
            <span className={`gm-badge ${GMNetworkManager.role}`}>
              {GMNetworkManager.role === 'host'
                ? `Hosting · ${GMNetworkManager.peers.size} player${GMNetworkManager.peers.size === 1 ? '' : 's'}`
                : (GMNetworkManager.connected ? 'Connected' : 'Connecting…')}
            </span>
          )}

          {drawerTabs.map(tab => (
            <button
              key={tab.id}
              className={`gm-btn ${drawerTab === tab.id ? 'active' : ''}`}
              onClick={() => setDrawerTab(drawerTab === tab.id ? null : tab.id)}
              title={tab.title}
            >
              {tab.label}
            </button>
          ))}
          {canOpenSheet && (
            <button className={`gm-btn ${sheet && !sheet.gmView ? 'active' : ''}`} onClick={() => setSheet(sheet && !sheet.gmView ? null : { creature: null, section: 'overview', gmView: false })} title="Your character sheet: stats, skills to roll, feats, powers (P)">
              Character
            </button>
          )}
        </div>

        {!isPlayerView && (
          <div className="gm-topbar-group">
            <div className="gm-segmented" role="group" aria-label="Viewport tool">
              <button
                className={`gm-btn small ${tool === 'select' ? 'active' : ''}`}
                onClick={() => GMManager.setToolMode('select')}
                title="Click objects to select them"
              >
                Select
              </button>
              <button
                className={`gm-btn small ${GMViewport.isPlacementTool(tool) ? 'active' : ''}`}
                onClick={() => GMManager.setToolMode(GMViewport.isPlacementTool(tool) ? 'select' : GMManager.lastPlacementTool)}
                title={`Click the ground to place it. Choose what in the Place tab.`}
              >
                Place: {placeButtonName}
              </button>
              <button
                className={`gm-btn small ${tool === 'teleport' ? 'active' : ''}`}
                onClick={() => GMManager.setToolMode(tool === 'teleport' ? 'select' : 'teleport')}
                disabled={!teleportTarget && tool !== 'teleport'}
                title={teleportTarget ? `Click the ground to move ${teleportTarget.getName() || 'the selection'}` : 'Select something to teleport first'}
              >
                Teleport
              </button>
            </div>

            <div className="gm-segmented" role="group" aria-label="Undo and redo">
              <button
                className="gm-btn small"
                disabled={!GMHistory.canUndo()}
                onClick={() => void GMHistory.undo()}
                aria-label="Undo"
                title={GMHistory.undoStack.length ? `Undo: ${GMHistory.undoStack[GMHistory.undoStack.length - 1].label} (Ctrl+Z)` : 'Nothing to undo'}
              >
                ↶
              </button>
              <button
                className="gm-btn small"
                disabled={!GMHistory.canRedo()}
                onClick={() => void GMHistory.redo()}
                aria-label="Redo"
                title={GMHistory.redoStack.length ? `Redo: ${GMHistory.redoStack[GMHistory.redoStack.length - 1].label} (Ctrl+Y)` : 'Nothing to redo'}
              >
                ↷
              </button>
            </div>

            <button
              className={`gm-btn small ${GMEditTools.placeHidden ? 'warning' : ''}`}
              onClick={() => { GMEditTools.placeHidden = !GMEditTools.placeHidden; GMManager.notifyChange(); }}
              title={GMEditTools.placeHidden
                ? "New creatures and objects arrive hidden from players. Select them and untick Hidden to reveal them all at once. Click to place them visible again."
                : "Click to place new creatures and objects hidden from players, to reveal together when you're ready"}
            >
              {GMEditTools.placeHidden ? 'Hidden' : 'Visible'}
            </button>

            <div className="gm-segmented" role="group" aria-label="Control mode (F2)">
              <button
                className={`gm-btn small ${GMManager.controlMode === 'FREECAM' ? 'active' : ''}`}
                onClick={() => { if (GMManager.controlMode !== 'FREECAM') GMManager.enterFreeCamera(true); }}
                title="Fly the GM camera (F2)"
              >
                GM Camera
              </button>
              <button
                className={`gm-btn small ${GMManager.controlMode === 'POSSESS' ? 'active' : ''}`}
                onClick={() => { if (GMManager.controlMode !== 'POSSESS') possessCandidateOrSpawn(); }}
                title="Play as a character: walk, fight, open doors and loot (F2)"
              >
                {GMManager.controlMode === 'POSSESS'
                  ? `Playing: ${currentLeader?.getName() || 'character'}`
                  : `Play as ${possessCandidateName}`}
              </button>
            </div>

            <button
              className={`gm-btn small ${GMManager.worldPaused ? 'danger' : ''}`}
              onClick={() => {
                GMManager.worldPaused = !GMManager.worldPaused;
                forceUpdate();
              }}
              title="Freeze movement, combat and effects for everyone"
            >
              {GMManager.worldPaused ? 'Paused' : 'Pause'}
            </button>
            <button
              className={`gm-btn small ${GMManager.npcAiEnabled ? '' : 'warning'}`}
              onClick={() => {
                GMManager.npcAiEnabled = !GMManager.npcAiEnabled;
                forceUpdate();
              }}
              title="Whether hostile NPCs pick fights on their own. Off: they only act when you tell them to."
            >
              {GMManager.npcAiEnabled ? 'NPC AI' : 'NPC AI off'}
            </button>
            <button
              className={`gm-btn small ${GMManager.playersFrozen ? 'warning active' : ''}`}
              onClick={() => GMManager.setPlayersFrozen(!GMManager.playersFrozen)}
              title="Players watch only: they can't move or act, and NPCs leave them alone"
            >
              {GMManager.playersFrozen ? 'Players watching' : 'Watch'}
            </button>
          </div>
        )}
      </div>

      {/* Conversations: the GM speaks for NPCs players are talking to */}
      {!isPlayerView && GMNetworkManager.role === 'host' && <ConversationsDock />}

      {/* Our character is down: what happens next, by the session's rule */}
      {isPlayerView && <DownedBanner />}

      {/* A question from the GM, waiting for this player's reply */}
      {isPlayerView && <PromptCard />}

      {/* The character sheet; and everyone's rolls, for a few seconds */}
      {sheet && (sheet.gmView ? sheet.creature : currentLeader) && (
        <CharacterSheet
          creature={sheet.gmView ? sheet.creature : currentLeader}
          initialSection={sheet.section}
          gmView={sheet.gmView}
          onClose={() => setSheet(null)}
        />
      )}
      {GMNetworkManager.role !== 'offline' && <RollFeed />}

      {/* Bottom controls strip: what the current mode/tool does and its keys */}
      <div className="gm-controls-strip">
        {statusChip && <span className="gm-chip">{statusChip}</span>}
        {controlHints.map(([keys, label]) => (
          <span key={keys} className="gm-control-hint">
            <kbd>{keys}</kbd> {label}
          </span>
        ))}
      </div>

      {/* The drawer: hidden, not unmounted, when closed */}
      {opened.size > 0 && (
        <div className="gm-drawer" style={{ display: drawerTab ? undefined : 'none' }}>
          <div className="gm-drawer-header">
            <span>
              {drawerTab === 'scenes' && 'Scene'}
              {drawerTab === 'actors' && 'Place'}
              {drawerTab === 'players' && 'Players'}
              {drawerTab === 'inspector' && 'Inspect'}
              {drawerTab === 'multiplayer' && 'Session'}
            </span>
            <button className="gm-btn small" onClick={() => setDrawerTab(null)} title="Close the panel (click the tab again to reopen it)">Close</button>
          </div>

          <div className="gm-drawer-body">
            {opened.has('scenes') && (
              <div style={{ display: drawerTab === 'scenes' ? 'contents' : 'none' }}>
                <ScenesTab active={drawerTab === 'scenes'} />
              </div>
            )}

            {opened.has('actors') && (
              <div style={{ display: drawerTab === 'actors' ? 'contents' : 'none' }}>
                <ActorsTab active={drawerTab === 'actors'} />
              </div>
            )}

            {opened.has('players') && (
              <div style={{ display: drawerTab === 'players' ? 'contents' : 'none' }}>
                <PlayersTab active={drawerTab === 'players'} onOpenTab={setDrawerTab} />
              </div>
            )}

            {opened.has('inspector') && (
              <div style={{ display: drawerTab === 'inspector' ? 'contents' : 'none' }}>
                <InspectorTab active={drawerTab === 'inspector'} />
              </div>
            )}

            {opened.has('multiplayer') && (
              <div style={{ display: drawerTab === 'multiplayer' ? 'contents' : 'none' }}>
                <SessionTab active={drawerTab === 'multiplayer'} onOpenTab={setDrawerTab} join={join} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

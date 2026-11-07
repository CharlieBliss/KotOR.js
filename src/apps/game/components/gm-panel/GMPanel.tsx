import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import * as KotOR from "@/apps/game/KotOR";
import { BitWise } from "@/utility/BitWise";
// Types only: the game bundle must use the engine library's single GMManager instance via the KotOR external,
// otherwise webpack bundles a second copy of the whole engine into game.js
import type {
  GMCreatureSpawnConfig,
  GMCreatureTemplateInfo,
  GMCheck,
  GMPlaceableSpawnConfig,
  GMPlaceablePropCategory,
  GMPlayerSpawnConfig,
  GMSceneBlueprint,
  GMToolMode
} from "@/managers/GMManager";

const { GMManager, GMNetworkManager, GMConversationManager, GMNpcOrders } = KotOR;
import "@/apps/game/components/gm-panel/gm-panel.scss";

type DrawerTab = 'scenes' | 'builder' | 'actors' | 'players' | 'inspector' | 'multiplayer' | null;

export const GMPanel: React.FC = () => {
  const [, setTick] = useState(0);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>(null);
  const [showQuickJoinOnMenu, setShowQuickJoinOnMenu] = useState(false);

  // Scene tab states
  const [planetFilter, setPlanetFilter] = useState<string>('All');
  const [sceneSearch, setSceneSearch] = useState<string>('');
  const [customModuleResRef, setCustomModuleResRef] = useState<string>(() => GMManager.defaultSceneModule());
  // The other KotOR game's areas, borrowed as scenes (OtherGameManager)
  const [otherModules, setOtherModules] = useState<string[] | null>(null);
  const [otherStatus, setOtherStatus] = useState<string>('');
  const [otherQuery, setOtherQuery] = useState<string>('');
  // A scene plan to import (from the kotor-gm-scenes skill)
  const [planJson, setPlanJson] = useState<string>('');
  const [planProblems, setPlanProblems] = useState<KotOR.GMPlanProblem[]>([]);
  const [planImporting, setPlanImporting] = useState<boolean>(false);
  const [keepCreatures, setKeepCreatures] = useState<boolean>(GMManager.keepDefaultCreatures);
  const [keepTriggers, setKeepTriggers] = useState<boolean>(GMManager.keepDefaultTriggers);
  const [keepPlaceables, setKeepPlaceables] = useState<boolean>(GMManager.keepDefaultPlaceables);
  const [preserveParty, setPreserveParty] = useState<boolean>(GMManager.preservePartyOnWarp);

  // Scene Builder (Office, Temple, etc.) tab states
  const [blueprintBgModule, setBlueprintBgModule] = useState<string>(() => GMManager.defaultSceneModule());
  const [blueprintSpawnNPCs, setBlueprintSpawnNPCs] = useState<boolean>(true);
  const [blueprintClearExisting, setBlueprintClearExisting] = useState<boolean>(true);
  const [blueprintOriginMode, setBlueprintOriginMode] = useState<'entry' | 'camera'>('entry');
  const [customBlueprintTitle, setCustomBlueprintTitle] = useState<string>('My Custom Office / Temple Scene');
  const [customBlueprintDesc, setCustomBlueprintDesc] = useState<string>('Custom placeable & actor layout');
  const [importBlueprintJson, setImportBlueprintJson] = useState<string>('');
  const [showJsonImportBox, setShowJsonImportBox] = useState<boolean>(false);

  // Actors & Placeables tab states
  const [spawnSubTab, setSpawnSubTab] = useState<'creatures' | 'placeables'>('placeables');
  const [propCategoryFilter, setPropCategoryFilter] = useState<'All' | GMPlaceablePropCategory>('All');
  // The creature preset or template the GM picked; creatureCfg is what gets placed (customized only on request)
  const [creaturePick, setCreaturePick] = useState<GMCreatureSpawnConfig>({ ...GMManager.pendingCreatureConfig });
  const [creatureCfg, setCreatureCfg] = useState<GMCreatureSpawnConfig>({ ...GMManager.pendingCreatureConfig });
  // What the picked template really holds (look, HP, class, gear), read from the game files
  const [creatureTemplateInfo, setCreatureTemplateInfo] = useState<GMCreatureTemplateInfo | null>(null);
  const [creatureSource, setCreatureSource] = useState<'presets' | 'templates'>('presets');
  const [templateQuery, setTemplateQuery] = useState<string>('');
  const [templateIndex, setTemplateIndex] = useState<GMCreatureTemplateInfo[] | null>(null);
  // The preset the GM picked; placeableCfg is what gets placed (a copy of it, customized only on request)
  const [placeablePreset, setPlaceablePreset] = useState<GMPlaceableSpawnConfig>(GMManager.pendingPlaceableConfig);
  const [placeableCfg, setPlaceableCfg] = useState<GMPlaceableSpawnConfig>(() => GMManager.copyPlaceablePreset(GMManager.pendingPlaceableConfig));
  const [customLootResRef, setCustomLootResRef] = useState<string>('g_i_medeqpmnt01');

  // Players tab states
  const [playerCfg, setPlayerCfg] = useState<GMPlayerSpawnConfig>({ ...GMManager.pendingPlayerConfig });
  // A check the GM calls for: who (a player net id, 'all' or 'selected'), what, how hard, and whether players see it
  const [checkWho, setCheckWho] = useState<string>('all');
  const [checkWhat, setCheckWhat] = useState<string>('skill:4');
  const [checkDc, setCheckDc] = useState<number>(15);
  const [checkSecret, setCheckSecret] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Inspector tab states
  const [inspectorFilter, setInspectorFilter] = useState<'all' | 'creatures' | 'placeables' | 'doors'>('all');
  const [inspectorAddItemResRef, setInspectorAddItemResRef] = useState<string>('g_w_lghtsbr01');
  const [inspectorBarkInput, setInspectorBarkInput] = useState<string>('');

  // Multiplayer tab states
  const defaultWsHost = typeof window !== 'undefined' && window.location?.hostname ? window.location.hostname : 'localhost';
  const [hostPortUrl, setHostPortUrl] = useState<string>(`ws://${defaultWsHost}:7878`);
  const [hostSessionName, setHostSessionName] = useState<string>('Neverwinter Knights - KotOR GM Session');
  const [joinUrl, setJoinUrl] = useState<string>(`ws://${defaultWsHost}:7878`);
  const [joinPlayerName, setJoinPlayerName] = useState<string>('Padawan Player');
  const [joinPresetIdx, setJoinPresetIdx] = useState<number>(0);
  const [chatInput, setChatInput] = useState<string>('');

  // DM tools
  const [rewardXp, setRewardXp] = useState<number>(250);
  const [rewardItem, setRewardItem] = useState<string>('g_i_medeqpmnt01');
  const [askText, setAskText] = useState<string>('');
  const [askOptions, setAskOptions] = useState<string>('Yes\nNo');
  const [askTarget, setAskTarget] = useState<string>('');
  // When our own character fell (player view), for the respawn countdown
  const downedSince = useRef<number>(0);
  // GM conversation drafts, per conversation: what the NPC says next and the replies offered
  const [talkDrafts, setTalkDrafts] = useState<Record<string, { text: string; replies: string }>>({});
  const [encounterPreset, setEncounterPreset] = useState<number>(0);
  const [encounterCount, setEncounterCount] = useState<number>(3);
  const [encounterSpread, setEncounterSpread] = useState<number>(2.5);
  const [encounterFaction, setEncounterFaction] = useState<number>(1);

  // Session save & load
  const [sessionName, setSessionName] = useState<string>('');
  const sessionFileRef = useRef<HTMLInputElement | null>(null);

  const forceUpdate = () => setTick(t => t + 1);

  useEffect(() => {
    const onGMChange = () => {
      if (GMManager.selectedObject) {
        setInspectorBarkInput((GMManager.selectedObject as any).gmBarkText || '');
      }
      forceUpdate();
    };
    const onNetChange = () => forceUpdate();
    const onInspect = () => setDrawerTab('inspector');
    const onOpenJoin = () => setShowQuickJoinOnMenu(true);

    GMManager.events.addEventListener('change', onGMChange);
    GMManager.events.addEventListener('inspect', onInspect);
    GMNetworkManager.events.addEventListener('open-join', onOpenJoin);
    GMNetworkManager.events.addEventListener('change', onNetChange);

    const interval = setInterval(() => {
      if (KotOR.GameState.gmMode || showQuickJoinOnMenu) {
        forceUpdate();
      }
    }, 350);

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
      if (e.key === 'F2') {
        e.preventDefault();
        if (GMManager.controlMode === 'POSSESS') {
          GMManager.enterFreeCamera(true);
        } else {
          const target =
            (GMManager.selectedObject && BitWise.InstanceOf(GMManager.selectedObject.objectType, KotOR.ModuleObjectType.ModuleCreature)
              ? (GMManager.selectedObject as KotOR.ModuleCreature)
              : null) ||
            KotOR.GameState.getCurrentPlayer() ||
            GMManager.spawnedPlayers[0];
          if (target) GMManager.possessCharacter(target);
        }
      } else if (e.code === 'KeyR' && GMManager.isPlacementTool(GMManager.activeTool)) {
        GMManager.rotatePlacement(e.shiftKey ? -GMManager.PLACEMENT_KEY_STEP : GMManager.PLACEMENT_KEY_STEP);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      GMManager.events.removeEventListener('change', onGMChange);
      GMManager.events.removeEventListener('inspect', onInspect);
      GMNetworkManager.events.removeEventListener('open-join', onOpenJoin);
      GMNetworkManager.events.removeEventListener('change', onNetChange);
      clearInterval(interval);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [showQuickJoinOnMenu]);

  // Sync pending spawn configs with GMManager for click-to-place in 3D viewport
  const updateCreatureCfg = (patch: Partial<GMCreatureSpawnConfig>) => {
    const next = { ...creatureCfg, ...patch };
    setCreatureCfg(next);
    GMManager.pendingCreatureConfig = next;
  };

  // Read the picked creature's template, for the summary and as the starting point for customizing
  useEffect(() => {
    let live = true;
    setCreatureTemplateInfo(null);
    if (creaturePick.templateResRef) {
      GMManager.describeCreatureTemplate(creaturePick.templateResRef).then((info) => { if (live) setCreatureTemplateInfo(info); });
    }
    return () => { live = false; };
  }, [creaturePick]);

  // The template browser reads every template the first time it opens
  useEffect(() => {
    if (spawnSubTab !== 'creatures' || creatureSource !== 'templates' || templateIndex) return;
    let live = true;
    GMManager.loadCreatureTemplateIndex().then((list) => { if (live) setTemplateIndex(list); });
    return () => { live = false; };
  }, [spawnSubTab, creatureSource, templateIndex]);

  /** Pick a creature preset or template: place exactly it, nothing carried over from the previous pick */
  const selectCreature = (config: GMCreatureSpawnConfig) => {
    const next = { ...config, customized: false };
    setCreaturePick(next);
    setCreatureCfg(next);
    GMManager.pendingCreatureConfig = next;
  };

  /** Customize: every change marks the creature customized (its look, HP and gear then win over the template's) */
  const customizeCreature = (patch: Partial<GMCreatureSpawnConfig>) => updateCreatureCfg({ ...patch, customized: true });

  const setCreatureCustomized = (on: boolean) => {
    if (!on) {
      selectCreature(creaturePick);
      return;
    }
    // Start from what the template really has, so the fields show the creature as it would appear
    const t = creatureTemplateInfo;
    customizeCreature(t ? {
      appearanceId: t.appearanceId,
      appearanceLabel: undefined,
      hp: t.hp,
      rightHandResRef: creatureCfg.rightHandResRef || t.rightHandResRef,
      leftHandResRef: t.leftHandResRef,
      armorResRef: t.armorResRef,
    } : { appearanceId: GMManager.resolveCreatureAppearance(creatureCfg), appearanceLabel: undefined });
  };

  const factionName = (id: number) => id === 1 ? 'Hostile' : id === 2 ? 'Friendly' : id === 0 ? 'Party' : 'Neutral';

  // Only the Customize section edits the object; everything it changes marks it customized
  const updatePlaceableCfg = (patch: Partial<GMPlaceableSpawnConfig>) => {
    const next = { ...placeableCfg, ...patch, customized: true };
    setPlaceableCfg(next);
    GMManager.pendingPlaceableConfig = next;
  };

  /** Pick a preset: place exactly it, with nothing carried over from the previous pick */
  const selectPlaceablePreset = (preset: GMPlaceableSpawnConfig) => {
    const next = GMManager.copyPlaceablePreset(preset);
    setPlaceablePreset(preset);
    setPlaceableCfg(next);
    GMManager.pendingPlaceableConfig = next;
  };

  const setPlaceableCustomized = (on: boolean) => {
    if (!on) {
      selectPlaceablePreset(placeablePreset);
      return;
    }
    // Start customizing from the model the preset really uses, so the Model list shows it
    updatePlaceableCfg({
      appearanceId: GMManager.resolvePlaceableAppearance(placeableCfg),
      appearanceLabel: undefined,
      modelKeywords: undefined,
    });
  };

  const updatePlayerCfg = (patch: Partial<GMPlayerSpawnConfig>) => {
    const next = { ...playerCfg, ...patch };
    setPlayerCfg(next);
    GMManager.pendingPlayerConfig = next;
  };

  const isGMMode = !!KotOR.GameState.gmMode;

  const startJoin = () => {
    const p = GMManager.PLAYER_PRESETS[joinPresetIdx] || GMManager.PLAYER_PRESETS[0];
    KotOR.GameState.gmMode = true;
    GMManager.active = true;
    GMNetworkManager.joinSession(joinUrl, joinPlayerName, {
      name: joinPlayerName,
      appearanceId: p.appearanceId,
      classId: p.classId,
      rightHandResRef: p.rightHandResRef,
      armorResRef: p.armorResRef
    });
    setShowQuickJoinOnMenu(false);
  };

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

  const joinState = GMNetworkManager.joinState;
  const joinInProgress = GMNetworkManager.role === 'client' && joinState !== 'playing' && joinState !== 'idle';
  const joinStatusText: Record<string, [string, string]> = {
    connecting: ['Connecting…', `Reaching ${GMNetworkManager.serverUrl}`],
    'waiting-for-host': ['Waiting for the GM', 'You are connected, but no GM is hosting yet. You will join as soon as they click Host.'],
    joining: ['Joining…', 'The GM is sending you the scene and your character.'],
  };

  const joinCard = (
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
              <label htmlFor="gm-join-build">Build</label>
              <select id="gm-join-build" className="gm-select" value={joinPresetIdx} onChange={e => setJoinPresetIdx(Number(e.target.value))}>
                {GMManager.PLAYER_PRESETS.map((p, i) => (
                  <option key={i} value={i}>{p.name} (Lv.{p.level})</option>
                ))}
              </select>
            </div>
          </div>
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

  // Joining (or a join that failed) takes the whole screen until the player has their character
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
  // Each game has its own curated scenes; the other game's are offered under "Scenes from ..."
  const runningTSL = String(KotOR.ApplicationProfile.GameKey) === 'TSL';
  const curatedModules = GMManager.getCuratedModules();
  const otherCuratedModules = GMManager.getCuratedModules(runningTSL ? 'kotor' : 'tsl');
  const curatedSceneName = (resRef: string) => resRef;
  const otherTitle = KotOR.OtherGameManager.otherTitle();
  const currentArea = KotOR.GameState.module?.area;
  const currentLeader = KotOR.GameState.getCurrentPlayer();
  const selectedObj = GMManager.selectedObject;
  const isPlayerView = !GMManager.isGMUser();
  if (isPlayerView && drawerTab && drawerTab !== 'multiplayer') {
    queueMicrotask(() => setDrawerTab(null));
  }

  // Who "Play as" (and F2) would take control of
  const selectedCreature = selectedObj && BitWise.InstanceOf(selectedObj.objectType, KotOR.ModuleObjectType.ModuleCreature)
    ? (selectedObj as KotOR.ModuleCreature)
    : null;
  const possessCandidate = selectedCreature || currentLeader || GMManager.spawnedPlayers[0] || null;
  const possessCandidateName = possessCandidate?.getName() || 'new character';

  const drawerTabs: { id: Exclude<DrawerTab, null>; label: string; title: string }[] = isPlayerView
    ? [{ id: 'multiplayer', label: 'Session', title: 'Connection status and chat' }]
    : [
      { id: 'scenes', label: 'Scenes', title: 'Load a module as the scene' },
      { id: 'builder', label: 'Build', title: 'Build whole scenes from blueprints (office, temple, ...)' },
      { id: 'actors', label: 'Place', title: 'Choose the creature or prop that Place Actor / Place Object puts down' },
      { id: 'players', label: `Players (${GMManager.spawnedPlayers.length})`, title: 'Player characters and party' },
      { id: 'inspector', label: selectedObj ? `Inspect: ${selectedObj.getName() || 'Selected'}` : 'Inspect', title: 'Edit the selected object, or browse everything in the scene' },
      { id: 'multiplayer', label: 'Session', title: 'Host a session, connected players and chat' },
    ];

  // Context-sensitive status chip and control hints shown at the bottom of the screen
  const tool = GMManager.activeTool;
  const placingName =
    tool === 'place_creature' ? GMManager.pendingCreatureConfig?.name :
    tool === 'place_placeable' ? GMManager.pendingPlaceableConfig?.name :
    tool === 'place_player' ? GMManager.pendingPlayerConfig?.name :
    tool === 'place_mine' ? `mine: ${GMManager.getMineTypes().find((m) => m.id === GMManager.pendingMineType)?.label || 'mine'}` : '';
  const teleportTarget = GMManager.getTeleportTarget();
  let statusChip: string | null = null;
  let controlHints: [string, string][] = [];
  if (isPlayerView) {
    controlHints = [['WASD', 'move'], ['Click', 'doors, containers, enemies'], ['Esc', 'options']];
  } else if (GMManager.isPlacementTool(tool)) {
    statusChip = `Placing: ${placingName || 'object'} · ${GMManager.placementYawOffset}°`;
    controlHints = [['Click ground', 'place'], ['R / Shift+R or Wheel', 'rotate'], ['Esc / Right-click', 'done']];
  } else if (GMManager.isOrderTool(tool)) {
    const who = GMManager.orderSubject?.getName() || 'NPC';
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
      const points = Math.max(0, GMManager.patrolDraft.length - 1);
      statusChip = `Order ${who}: patrol · ${points} point${points === 1 ? '' : 's'}`;
      controlHints = [['Click ground', 'add a point'], ['Esc / Right-click', points ? 'start patrolling' : 'cancel']];
    }
  } else if (tool === 'teleport') {
    statusChip = teleportTarget ? `Teleport: ${teleportTarget.getName() || 'selected object'}` : 'Teleport: select something first';
    controlHints = [['Click ground', 'move it there'], ['Esc / Right-click', 'done']];
  } else if (GMManager.controlMode === 'POSSESS') {
    controlHints = [['WASD', 'move'], ['Click', 'interact'], ['F2', 'back to GM camera']];
  } else {
    controlHints = [
      ['WASD', 'fly'], ['Q / E or Space', 'down / up'], ['Shift', 'faster'], ['Drag', 'look'],
      ['Click', 'select'], ['Double-click', 'inspect'], ['F2', `play as ${possessCandidateName}`],
    ];
  }

  const connectedPeers = [...GMNetworkManager.peers.values()];

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
    const save = GMManager.importSessionJSON(await file.text());
    GMNetworkManager.appendChat('System', save ? `Imported session "${save.name}".` : `${file.name} isn't a GM session save.`);
    forceUpdate();
  };

  const conversations = [...GMConversationManager.conversations.values()];
  // Player death: fallen player characters (GM), and whether our own character is down (player)
  const fallenPlayers = isPlayerView ? [] : GMManager.getPlayerCharacters().filter((pc) => pc.isDead());
  const myCharacter = isPlayerView ? KotOR.GameState.getCurrentPlayer() : null;
  const iAmDown = !!myCharacter && myCharacter.isDead();
  if (iAmDown && !downedSince.current) downedSince.current = Date.now();
  if (!iAmDown) downedSince.current = 0;
  const deathRule = isPlayerView ? GMNetworkManager.sessionRules.deathRule : GMManager.deathRule;
  const respawnIn = iAmDown ? Math.max(0, Math.ceil(GMManager.RESPAWN_DELAY_SECONDS - (Date.now() - downedSince.current) / 1000)) : 0;

  const recentPrompts = [...GMManager.dmPrompts.values()].slice(-3).reverse();

  const possessCandidateOrSpawn = async () => {
    const target = possessCandidate || await GMManager.spawnPlayerCharacter(playerCfg);
    if (target) GMManager.possessCharacter(target);
  };

  const planets = ['All', ...Array.from(new Set(curatedModules.map(m => m.planet)))];
  const filteredCuratedModules = curatedModules.filter(m => {
    if (planetFilter !== 'All' && m.planet !== planetFilter) return false;
    if (!sceneSearch.trim()) return true;
    const q = sceneSearch.toLowerCase();
    return (
      m.resRef.toLowerCase().includes(q) ||
      m.title.toLowerCase().includes(q) ||
      m.planet.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q)
    );
  });

  // Collect all objects in current area for the World Inspector
  const worldObjects: { obj: KotOR.ModuleObject; kind: string; badge: string }[] = [];
  if (currentArea) {
    for (const p of KotOR.GameState.PartyManager.party) {
      if (p) worldObjects.push({ obj: p, kind: 'Player/Party', badge: `HP ${p.getHP()}/${p.getMaxHP()}` });
    }
    if (inspectorFilter === 'all' || inspectorFilter === 'creatures') {
      for (const c of currentArea.creatures) {
        if (c && !KotOR.GameState.PartyManager.party.includes(c)) {
          const fac = c.factionId === 1 ? 'Hostile' : c.factionId === 2 ? 'Friendly' : 'Neutral';
          worldObjects.push({ obj: c, kind: `Creature (${fac})`, badge: `HP ${c.getHP()}/${c.getMaxHP()}` });
        }
      }
    }
    if (inspectorFilter === 'all' || inspectorFilter === 'placeables') {
      for (const plc of currentArea.placeables) {
        if (plc) {
          worldObjects.push({
            obj: plc,
            kind: plc.hasInventory ? 'Container' : 'Placeable',
            badge: plc.isLocked() ? 'Locked' : (plc.hasInventory ? `${plc.inventory.length} items` : 'Useable')
          });
        }
      }
    }
    if (inspectorFilter === 'all' || inspectorFilter === 'doors') {
      for (const d of currentArea.doors) {
        if (d) {
          worldObjects.push({
            obj: d,
            kind: 'Door',
            badge: d.isOpen() ? 'Open' : (d.isLocked() ? 'Locked' : 'Closed')
          });
        }
      }
    }
  }

  const handleImportUTCFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ab = await file.arrayBuffer();
    const nameWithoutExt = file.name.replace(/\.utc$/i, '');
    await GMManager.importPlayerFromUTCBuffer(new Uint8Array(ab), nameWithoutExt, true);
    e.target.value = '';
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
                className={`gm-btn small ${tool === 'place_creature' ? 'active' : ''}`}
                onClick={() => GMManager.setToolMode(tool === 'place_creature' ? 'select' : 'place_creature')}
                title={`Click the ground to place: ${GMManager.pendingCreatureConfig?.name || 'creature'} (change it in Place)`}
              >
                Place Actor
              </button>
              <button
                className={`gm-btn small ${tool === 'place_placeable' ? 'active' : ''}`}
                onClick={() => GMManager.setToolMode(tool === 'place_placeable' ? 'select' : 'place_placeable')}
                title={`Click the ground to place: ${GMManager.pendingPlaceableConfig?.name || 'object'} (change it in Place)`}
              >
                Place Object
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
              {GMManager.worldPaused ? 'World Paused' : 'Pause World'}
            </button>
            <button
              className={`gm-btn small ${GMManager.npcAiEnabled ? '' : 'warning'}`}
              onClick={() => {
                GMManager.npcAiEnabled = !GMManager.npcAiEnabled;
                forceUpdate();
              }}
              title="Whether hostile NPCs pick fights on their own. Off: they only act when you tell them to."
            >
              {GMManager.npcAiEnabled ? 'NPC AI: On' : 'NPC AI: Off'}
            </button>
            <button
              className={`gm-btn small ${GMManager.playersFrozen ? 'warning active' : ''}`}
              onClick={() => GMManager.setPlayersFrozen(!GMManager.playersFrozen)}
              title="Players can only watch: they can't move or act, and NPCs leave them alone"
            >
              {GMManager.playersFrozen ? 'Players: Watching' : 'Players: Free'}
            </button>
          </div>
        )}
      </div>

      {/* Conversations: the GM speaks for NPCs players are talking to */}
      {!isPlayerView && GMNetworkManager.role === 'host' && conversations.length > 0 && (
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
      )}

      {/* Our character is down: what happens next, by the session's rule */}
      {isPlayerView && iAmDown && (
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
      )}

      {/* A question from the GM, waiting for this player's reply */}
      {isPlayerView && GMNetworkManager.pendingPrompts.length > 0 && (() => {
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
      })()}

      {/* Bottom controls strip: what the current mode/tool does and its keys */}
      <div className="gm-controls-strip">
        {statusChip && <span className="gm-chip">{statusChip}</span>}
        {controlHints.map(([keys, label]) => (
          <span key={keys} className="gm-control-hint">
            <kbd>{keys}</kbd> {label}
          </span>
        ))}
      </div>

      {/* Collapsible Drawer Content */}
      {drawerTab && (
        <div className="gm-drawer">
          <div className="gm-drawer-header">
            <span>
              {drawerTab === 'builder' && 'Scene Builder — Office Building, Ancient Temple & Custom Placeable Kits'}
              {drawerTab === 'scenes' && 'Scene & Module Selector'}
              {drawerTab === 'actors' && 'Actor & Categorized Placeable Prop Spawner'}
              {drawerTab === 'players' && 'Player Characters & Party Manager'}
              {drawerTab === 'inspector' && 'Live World Object Inspector & DM Controls'}
              {drawerTab === 'multiplayer' && 'Neverwinter Nights-Style GM Host & Multiplayer'}
            </span>
            <button className="gm-btn small" onClick={() => setDrawerTab(null)}>Minimize ▲</button>
          </div>

          <div className="gm-drawer-body">
            {/* ==================== TAB 0: SCENE BUILDER (OFFICE / TEMPLE / KITS) ==================== */}
            {drawerTab === 'builder' && (
              <>
                <div className="gm-hint">
                  <b>Quick Scene Builder:</b> Set up complete interactive environments—such as an <b>Office Building</b>, an <b>Ancient Jedi / Sith Temple</b>, a <b>Command Center</b>, or a <b>Medical Bay</b>—by arranging placeables inside a clean default scene background (<code>danm14aa</code> or any module) with a single click!
                </div>

                <div className="gm-section">
                  <div className="gm-section-title">Default Background & Stage Setup Options</div>
                  <div className="gm-grid-2">
                    <div className="gm-field">
                      <label>Default Background Module (for &quot;Load Clean Stage &amp; Build&quot;)</label>
                      <select
                        className="gm-select"
                        value={blueprintBgModule}
                        onChange={e => setBlueprintBgModule(e.target.value)}
                      >
                        <option value={GMManager.defaultSceneModule()}>Default open stage ({GMManager.defaultSceneModule()})</option>
                        {curatedModules.map(m => (
                          <option key={m.resRef} value={m.resRef}>{m.planet} — {m.title}</option>
                        ))}
                      </select>
                    </div>
                    <div className="gm-field">
                      <label>Placement Anchor (for &quot;Build in Current Scene&quot;)</label>
                      <select
                        className="gm-select"
                        value={blueprintOriginMode}
                        onChange={e => setBlueprintOriginMode(e.target.value as 'entry' | 'camera')}
                      >
                        <option value="entry">Scene Entry Spawn Point (Default Stage Center)</option>
                        <option value="camera">Current 3D Camera Target Point</option>
                      </select>
                    </div>
                  </div>

                  <div className="gm-row">
                    <label className="gm-checkbox">
                      <input
                        type="checkbox"
                        checked={blueprintSpawnNPCs}
                        onChange={e => setBlueprintSpawnNPCs(e.target.checked)}
                      />
                      Include Thematic NPCs (Receptionist, Temple Guardian, Commander, etc.)
                    </label>
                    <label className="gm-checkbox">
                      <input
                        type="checkbox"
                        checked={blueprintClearExisting}
                        onChange={e => setBlueprintClearExisting(e.target.checked)}
                      />
                      Clear Existing Placeables Before Building
                    </label>
                  </div>

                  <div className="gm-row">
                    <button
                      className="gm-btn small warning"
                      onClick={() => GMManager.clearDefaultAreaPlaceables()}
                      title="Remove default module crates/containers while keeping GM-placed props"
                    >
                      Clear Default Area Placeables
                    </button>
                    <button
                      className="gm-btn small danger"
                      onClick={() => GMManager.clearGMSpawnedPlaceables()}
                      title="Remove all GM-placed placeables from the current scene"
                    >
                      Clear GM-Placed Props ({currentArea?.placeables.length || 0})
                    </button>
                    <button
                      className="gm-btn small"
                      onClick={() => {
                        setSpawnSubTab('placeables');
                        setDrawerTab('actors');
                      }}
                    >
                      Open Individual Prop Palette →
                    </button>
                  </div>
                </div>

                <div className="gm-section">
                  <div className="gm-section-title">
                    <span>Pre-Built Multi-Placeable Scene Blueprints ({GMManager.SCENE_BLUEPRINTS.length})</span>
                  </div>
                  <div className="gm-list" style={{ maxHeight: 265 }}>
                    {GMManager.SCENE_BLUEPRINTS.map(bp => (
                      <div key={bp.id} className="gm-card" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                        <div className="gm-card-info">
                          <div className="gm-card-title">
                            {bp.title} <span className="gm-badge" style={{ marginLeft: 4 }}>{bp.items.length} Placeables</span>
                          </div>
                          <div className="gm-card-sub" style={{ whiteSpace: 'normal', lineHeight: 1.35, marginTop: 3 }}>
                            {bp.description}
                          </div>
                        </div>
                        <div className="gm-row" style={{ flexDirection: 'column', alignItems: 'stretch', minWidth: 165 }}>
                          <button
                            className="gm-btn small success"
                            onClick={() =>
                              GMManager.buildSceneBlueprint(bp, {
                                loadCleanBackgroundFirst: true,
                                backgroundModuleResRef: blueprintBgModule,
                                clearExistingPlaceables: true,
                                spawnNPCs: blueprintSpawnNPCs,
                                useCameraTargetAsOrigin: false
                              })
                            }
                            title={`Load ${blueprintBgModule} with default clutter cleared and build ${bp.title}`}
                          >
                            Load Clean Stage &amp; Build
                          </button>
                          <button
                            className="gm-btn small active"
                            onClick={() =>
                              GMManager.buildSceneBlueprint(bp, {
                                loadCleanBackgroundFirst: false,
                                clearExistingPlaceables: blueprintClearExisting,
                                spawnNPCs: blueprintSpawnNPCs,
                                useCameraTargetAsOrigin: blueprintOriginMode === 'camera'
                              })
                            }
                            title="Stamp this placeable layout directly into the currently loaded scene"
                          >
                            Build Here ({blueprintOriginMode === 'camera' ? 'At Camera' : 'At Entry'})
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="gm-section">
                  <div className="gm-section-title">
                    <span>Save Current Scene Layout / Custom Blueprints ({GMManager.getSavedCustomBlueprints().length})</span>
                    <button
                      className="gm-btn small"
                      onClick={() => setShowJsonImportBox(!showJsonImportBox)}
                    >
                      {showJsonImportBox ? 'Hide JSON Import' : 'Import JSON'}
                    </button>
                  </div>

                  <div className="gm-grid-2">
                    <div className="gm-field">
                      <label>Custom Scene Layout Title</label>
                      <input
                        className="gm-input"
                        value={customBlueprintTitle}
                        onChange={e => setCustomBlueprintTitle(e.target.value)}
                        placeholder="e.g. Coruscant Detective Office"
                      />
                    </div>
                    <div className="gm-field">
                      <label>Description</label>
                      <input
                        className="gm-input"
                        value={customBlueprintDesc}
                        onChange={e => setCustomBlueprintDesc(e.target.value)}
                        placeholder="Notes about this scene setup..."
                      />
                    </div>
                  </div>

                  <div className="gm-row">
                    <button
                      className="gm-btn active"
                      style={{ flex: 1 }}
                      onClick={() => {
                        GMManager.saveCurrentSceneAsBlueprint(customBlueprintTitle, customBlueprintDesc);
                        forceUpdate();
                      }}
                    >
                      Save Current Scene Placeables &amp; Actors as Blueprint
                    </button>
                  </div>

                  {showJsonImportBox && (
                    <div className="gm-field" style={{ marginTop: 6 }}>
                      <label>Paste Exported Scene Blueprint JSON</label>
                      <div className="gm-row">
                        <input
                          className="gm-input"
                          style={{ flex: 1 }}
                          value={importBlueprintJson}
                          onChange={e => setImportBlueprintJson(e.target.value)}
                          placeholder='{"title":"My Scene","items":[...]}'
                        />
                        <button
                          className="gm-btn small success"
                          onClick={() => {
                            if (GMManager.importCustomBlueprintFromJSON(importBlueprintJson)) {
                              setImportBlueprintJson('');
                              setShowJsonImportBox(false);
                              forceUpdate();
                            }
                          }}
                        >
                          Import
                        </button>
                      </div>
                    </div>
                  )}

                  {GMManager.getSavedCustomBlueprints().length > 0 && (
                    <div className="gm-list" style={{ maxHeight: 140, marginTop: 6 }}>
                      {GMManager.getSavedCustomBlueprints().map(cbp => (
                        <div key={cbp.id} className="gm-card">
                          <div className="gm-card-info">
                            <div className="gm-card-title">{cbp.title}</div>
                            <div className="gm-card-sub">{cbp.description}</div>
                          </div>
                          <div className="gm-row">
                            <button
                              className="gm-btn small success"
                              onClick={() =>
                                GMManager.buildSceneBlueprint(cbp, {
                                  loadCleanBackgroundFirst: true,
                                  backgroundModuleResRef: cbp.recommendedModule || blueprintBgModule,
                                  clearExistingPlaceables: true,
                                  spawnNPCs: blueprintSpawnNPCs
                                })
                              }
                            >
                              Load &amp; Build
                            </button>
                            <button
                              className="gm-btn small active"
                              onClick={() =>
                                GMManager.buildSceneBlueprint(cbp, {
                                  loadCleanBackgroundFirst: false,
                                  clearExistingPlaceables: blueprintClearExisting,
                                  spawnNPCs: blueprintSpawnNPCs,
                                  useCameraTargetAsOrigin: blueprintOriginMode === 'camera'
                                })
                              }
                            >
                              Stamp Here
                            </button>
                            <button
                              className="gm-btn small"
                              title="Copy Blueprint JSON to Clipboard"
                              onClick={() => {
                                navigator.clipboard?.writeText(JSON.stringify(cbp));
                              }}
                            >
                              Copy JSON
                            </button>
                            <button
                              className="gm-btn small danger"
                              onClick={() => GMManager.deleteCustomBlueprint(cbp.id)}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ==================== TAB 1: SCENES ==================== */}
            {drawerTab === 'scenes' && (
              <>
                <div className="gm-section">
                  <div className="gm-section-title">
                    <span>Scene plan</span>
                    <label className="gm-btn small" title="A .json scene plan (from the kotor-gm-scenes Claude skill)">
                      Open file…
                      <input
                        type="file"
                        accept=".json,application/json"
                        style={{ display: 'none' }}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (file) setPlanJson(await file.text());
                        }}
                      />
                    </label>
                  </div>
                  <textarea
                    className="gm-input"
                    style={{ minHeight: 70, fontFamily: 'monospace', fontSize: 11 }}
                    placeholder="Paste a scene plan here, or open its file"
                    value={planJson}
                    onChange={(e) => { setPlanJson(e.target.value); setPlanProblems([]); }}
                  />
                  <div className="gm-row">
                    <button
                      className="gm-btn success"
                      style={{ flex: 1 }}
                      disabled={!planJson.trim() || planImporting}
                      onClick={async () => {
                        const { plan, problems } = KotOR.GMScenePlan.parse(planJson);
                        setPlanProblems(problems);
                        if (!plan) return;
                        setPlanImporting(true);
                        try {
                          await KotOR.GMScenePlan.import(plan);
                        } finally {
                          setPlanImporting(false);
                          forceUpdate();
                        }
                      }}
                      title="Loads the plan's area, places its actors and props, and moves the players to their start"
                    >
                      {planImporting ? 'Setting the scene…' : 'Import and set the scene'}
                    </button>
                  </div>
                  {planProblems.map((p, i) => (
                    <div key={i} className="gm-hint" style={{ color: p.level === 'error' ? '#ff8a80' : '#ffd740' }}>
                      {p.level === 'error' ? 'Error' : 'Note'} ({p.where}): {p.message}
                    </div>
                  ))}
                </div>

                {KotOR.GMScenePlan.active && (() => {
                  const runner = KotOR.GMScenePlan.active;
                  const plan = runner.plan;
                  return (
                    <div className="gm-section">
                      <div className="gm-section-title">
                        <span>{plan.title}</span>
                        <button className="gm-btn small" onClick={() => { KotOR.GMScenePlan.active = null; forceUpdate(); }} title="Put the plan away (the scene stays)">Close</button>
                      </div>
                      {plan.summary && <div className="gm-hint">{plan.summary}</div>}
                      {plan.gmNotes && <div className="gm-hint"><b>GM notes:</b> {plan.gmNotes}</div>}
                      {plan.players.note && <div className="gm-hint"><b>Players:</b> {plan.players.note}</div>}
                      {runner.log.map((line, i) => (
                        <div key={i} className="gm-hint" style={{ color: '#ffd740' }}>{line}</div>
                      ))}
                      <div className="gm-list" style={{ maxHeight: 260 }}>
                        {(plan.beats || []).map((beat, i) => (
                          <div key={i} className={`gm-card ${runner.beatsRun.has(i) ? 'selected' : ''}`}>
                            <div className="gm-card-info">
                              <div className="gm-card-title">{i + 1}. {beat.title}{runner.beatsRun.has(i) ? ' ✓' : ''}</div>
                              {beat.narration && <div className="gm-card-sub">“{beat.narration}”</div>}
                              {beat.notes && <div className="gm-card-sub">{beat.notes}</div>}
                            </div>
                            <button className="gm-btn small success" onClick={() => { runner.runBeat(i); forceUpdate(); }} title="Say its narration and do its actions">
                              {runner.beatsRun.has(i) ? 'Again' : 'Run'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div className="gm-section">
                  <div className="gm-section-title">Scene Load Options</div>
                  <label className="gm-checkbox">
                    <input
                      type="checkbox"
                      checked={keepPlaceables}
                      onChange={e => {
                        setKeepPlaceables(e.target.checked);
                        GMManager.keepDefaultPlaceables = e.target.checked;
                      }}
                    />
                    Include Default Module Placeables &amp; Containers (uncheck for clean background stage)
                  </label>
                  <label className="gm-checkbox">
                    <input
                      type="checkbox"
                      checked={keepCreatures}
                      onChange={e => {
                        setKeepCreatures(e.target.checked);
                        GMManager.keepDefaultCreatures = e.target.checked;
                      }}
                    />
                    Include Default Module Creatures &amp; Encounters (uncheck for clean GM stage)
                  </label>
                  <label className="gm-checkbox">
                    <input
                      type="checkbox"
                      checked={keepTriggers}
                      onChange={e => {
                        setKeepTriggers(e.target.checked);
                        GMManager.keepDefaultTriggers = e.target.checked;
                      }}
                    />
                    Include Default Area Transition Triggers
                  </label>
                  <label className="gm-checkbox">
                    <input
                      type="checkbox"
                      checked={preserveParty}
                      onChange={e => {
                        setPreserveParty(e.target.checked);
                        GMManager.preservePartyOnWarp = e.target.checked;
                      }}
                    />
                    Carry Spawned Player Characters Across Scene Warps
                  </label>
                </div>

                <div className="gm-section">
                  <div className="gm-section-title">Browse Planet / Area Modules</div>
                  <div className="gm-grid-2">
                    <div className="gm-field">
                      <label>Planet / Region</label>
                      <select
                        className="gm-select"
                        value={planetFilter}
                        onChange={e => setPlanetFilter(e.target.value)}
                      >
                        {planets.map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                    <div className="gm-field">
                      <label>Search Scene</label>
                      <input
                        className="gm-input"
                        placeholder="e.g. Enclave, Cantina, Tomb..."
                        value={sceneSearch}
                        onChange={e => setSceneSearch(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="gm-list" style={{ maxHeight: 250 }}>
                    {filteredCuratedModules.map(mod => (
                      <div
                        key={mod.resRef}
                        className={`gm-card ${currentModuleName === curatedSceneName(mod.resRef) ? 'selected' : ''}`}
                        onClick={() =>
                          GMManager.loadScene(curatedSceneName(mod.resRef), {
                            keepCreatures,
                            keepTriggers,
                            keepPlaceables,
                            preserveParty
                          })
                        }
                      >
                        <div className="gm-card-info">
                          <div className="gm-card-title">{mod.planet} — {mod.title}</div>
                          <div className="gm-card-sub">{mod.description}</div>
                        </div>
                        <button className="gm-btn small active">Load</button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="gm-section">
                  <div className="gm-section-title">Load Any Module by ResRef ({GMManager.discoveredModules.length} found on disk)</div>
                  <div className="gm-row">
                    {GMManager.discoveredModules.length > 0 ? (
                      <select
                        className="gm-select"
                        style={{ flex: 1 }}
                        value={customModuleResRef}
                        onChange={e => setCustomModuleResRef(e.target.value)}
                      >
                        {GMManager.discoveredModules.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="gm-input"
                        style={{ flex: 1 }}
                        value={customModuleResRef}
                        onChange={e => setCustomModuleResRef(e.target.value)}
                        placeholder="Module name e.g. danm14aa"
                      />
                    )}
                    <button
                      className="gm-btn active"
                      onClick={() =>
                        GMManager.loadScene(customModuleResRef, {
                          keepCreatures,
                          keepTriggers,
                          keepPlaceables,
                          preserveParty
                        })
                      }
                    >
                      Warp to Module
                    </button>
                  </div>
                </div>

                <div className="gm-section">
                  <div className="gm-section-title">
                    <span>Scenes from {otherTitle}</span>
                    {otherModules === null && (
                      <button
                        className="gm-btn small active"
                        onClick={async () => {
                          setOtherStatus(`Opening ${otherTitle}…`);
                          const list = await KotOR.OtherGameManager.listModules();
                          setOtherModules(list);
                          setOtherStatus(list.length ? '' : (KotOR.OtherGameManager.lastError || `No ${otherTitle} areas found.`));
                        }}
                        title={`Borrow an area from ${otherTitle}: its rooms, sky and lighting, without its characters or objects`}
                      >
                        Show
                      </button>
                    )}
                  </div>
                  <div className="gm-hint">
                    The area only (terrain, buildings, sky, music); fill it with this game's characters and objects.
                    Players need {otherTitle} set up in their launcher too.
                  </div>
                  {otherStatus && <div className="gm-hint">{otherStatus}</div>}
                  {otherModules && otherModules.length > 0 && (
                    <>
                      <input
                        className="gm-input"
                        placeholder={`Search ${otherModules.length} areas (e.g. danm, tat_, ebo_)`}
                        value={otherQuery}
                        onChange={e => setOtherQuery(e.target.value)}
                      />
                      <div className="gm-list" style={{ maxHeight: 220 }}>
                        {otherModules.filter(m => !otherQuery.trim() || m.includes(otherQuery.trim().toLowerCase())).map(m => {
                          const name = KotOR.OtherGameManager.foreignModuleName(m);
                          const known = otherCuratedModules.find(c => c.resRef === m);
                          return (
                            <div
                              key={m}
                              className={`gm-card ${currentModuleName === name ? 'selected' : ''}`}
                              onClick={() => GMManager.loadScene(name, { keepCreatures, keepTriggers, keepPlaceables, preserveParty })}
                            >
                              <div className="gm-card-info">
                                <div className="gm-card-title">{known ? `${known.planet} — ${known.title}` : m}</div>
                                <div className="gm-card-sub">{known?.description || `${otherTitle} area`}</div>
                              </div>
                              <button className="gm-btn small active">Load</button>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {/* ==================== TAB 2: ACTORS & PLACEABLES ==================== */}
            {drawerTab === 'actors' && (
              <>
                <div className="gm-row">
                  <button
                    className={`gm-btn ${spawnSubTab === 'creatures' ? 'active' : ''}`}
                    style={{ flex: 1 }}
                    onClick={() => setSpawnSubTab('creatures')}
                  >
                    Creatures & NPCs ({currentArea?.creatures.length || 0})
                  </button>
                  <button
                    className={`gm-btn ${spawnSubTab === 'placeables' ? 'active' : ''}`}
                    style={{ flex: 1 }}
                    onClick={() => setSpawnSubTab('placeables')}
                  >
                    Interactive Placeables & Containers ({currentArea?.placeables.length || 0})
                  </button>
                </div>

                {spawnSubTab === 'creatures' ? (
                  <>
                    <div className="gm-section">
                      <div className="gm-section-title">Encounter</div>
                      <div className="gm-grid-2">
                        <div className="gm-field">
                          <label>Creature</label>
                          <select className="gm-select" value={encounterPreset} onChange={e => setEncounterPreset(Number(e.target.value))}>
                            {GMManager.CREATURE_PRESETS.map((preset, idx) => GMManager.isPresetAvailable(preset) ? <option key={idx} value={idx}>{preset.name}</option> : null)}
                          </select>
                        </div>
                        <div className="gm-field">
                          <label>Faction</label>
                          <select className="gm-select" value={encounterFaction} onChange={e => setEncounterFaction(Number(e.target.value))}>
                            <option value={1}>Hostile</option>
                            <option value={2}>Friendly</option>
                            <option value={5}>Neutral</option>
                          </select>
                        </div>
                        <div className="gm-field">
                          <label>How many</label>
                          <input className="gm-input" type="number" min={1} max={12} value={encounterCount} onChange={e => setEncounterCount(Number(e.target.value))} />
                        </div>
                        <div className="gm-field">
                          <label>Spread (m)</label>
                          <input className="gm-input" type="number" min={0.5} step={0.5} value={encounterSpread} onChange={e => setEncounterSpread(Number(e.target.value))} />
                        </div>
                      </div>
                      <button
                        className="gm-btn success"
                        onClick={() => GMManager.spawnEncounter({ presetIndex: encounterPreset, count: encounterCount, spread: encounterSpread, factionId: encounterFaction })}
                        title="Spawns the group in a ring around where the camera is looking"
                      >
                        Spawn encounter where the camera looks
                      </button>
                    </div>
                    <div className="gm-section">
                      <div className="gm-section-title">
                        <span>Creatures</span>
                        <div className="gm-row">
                          <button className={`gm-btn small ${creatureSource === 'presets' ? 'active' : ''}`} onClick={() => setCreatureSource('presets')}>Presets</button>
                          <button className={`gm-btn small ${creatureSource === 'templates' ? 'active' : ''}`} onClick={() => setCreatureSource('templates')} title="Every creature template (.utc) in the game, with its real stats">All game templates</button>
                        </div>
                      </div>

                      {creatureSource === 'presets' ? (
                        <div className="gm-list" style={{ maxHeight: 200 }}>
                          {GMManager.CREATURE_PRESETS.map((preset, idx) => !GMManager.isPresetAvailable(preset) ? null : (
                            <div
                              key={idx}
                              className={`gm-card ${creaturePick.name === preset.name && creaturePick.templateResRef === preset.templateResRef ? 'selected' : ''}`}
                              onClick={() => selectCreature(preset)}
                            >
                              <div className="gm-card-info">
                                <div className="gm-card-title">{preset.name}</div>
                                <div className="gm-card-sub">
                                  {factionName(preset.factionId)} • Level {preset.level} • HP {preset.hp}
                                </div>
                              </div>
                              <button
                                className="gm-btn small warning"
                                onClick={e => {
                                  e.stopPropagation();
                                  selectCreature(preset);
                                  GMManager.setToolMode('place_creature');
                                }}
                                title="Click the ground to place it"
                              >
                                Place
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <>
                          <input
                            className="gm-input"
                            placeholder="Search templates by name or resref (e.g. trooper, g_darkjedi)"
                            value={templateQuery}
                            onChange={e => setTemplateQuery(e.target.value)}
                          />
                          <div className="gm-list" style={{ maxHeight: 220 }}>
                            {!templateIndex && <div className="gm-hint">Reading the game's creature templates…</div>}
                            {templateIndex && (() => {
                              const q = templateQuery.trim().toLowerCase();
                              const matches = templateIndex.filter(t => !q || t.name.toLowerCase().includes(q) || t.resRef.includes(q));
                              if (!matches.length) return <div className="gm-hint">No templates match.</div>;
                              return (
                                <>
                                  {matches.slice(0, 80).map(t => (
                                    <div
                                      key={t.resRef}
                                      className={`gm-card ${creaturePick.templateResRef === t.resRef ? 'selected' : ''}`}
                                      onClick={() => selectCreature(GMManager.creatureConfigFromTemplate(t))}
                                    >
                                      <div className="gm-card-info">
                                        <div className="gm-card-title">{t.name} <span className="gm-badge" style={{ marginLeft: 4 }}>{t.resRef}</span></div>
                                        <div className="gm-card-sub">{factionName(t.factionId)} • {t.classes || 'No class'} • HP {t.hp}{t.fp ? ` • FP ${t.fp}` : ''}</div>
                                      </div>
                                      <button
                                        className="gm-btn small warning"
                                        onClick={e => {
                                          e.stopPropagation();
                                          selectCreature(GMManager.creatureConfigFromTemplate(t));
                                          GMManager.setToolMode('place_creature');
                                        }}
                                        title="Click the ground to place it"
                                      >
                                        Place
                                      </button>
                                    </div>
                                  ))}
                                  {matches.length > 80 && <div className="gm-hint">{matches.length - 80} more: narrow the search.</div>}
                                </>
                              );
                            })()}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="gm-section">
                      <div className="gm-section-title">
                        <span>{creatureCfg.customized ? 'Placing (customized)' : 'Placing'}: {creatureCfg.name}</span>
                      </div>
                      <div className="gm-hint">
                        {creatureCfg.templateResRef ? (
                          creatureTemplateInfo ? (
                            creatureCfg.customized
                              ? <>From template {creatureTemplateInfo.resRef}, with your changes • {creatureTemplateInfo.classes}</>
                              : <>
                                  Template {creatureTemplateInfo.resRef}: {creatureTemplateInfo.appearanceLabel || `appearance ${creatureTemplateInfo.appearanceId}`}
                                  {' '}• {creatureTemplateInfo.classes} • HP {creatureTemplateInfo.hp}{creatureTemplateInfo.fp ? ` • FP ${creatureTemplateInfo.fp}` : ''}
                                  {' '}• {[creatureTemplateInfo.rightHandResRef || creatureCfg.rightHandResRef, creatureTemplateInfo.leftHandResRef].filter(Boolean).join(', ') || 'no weapon'}
                                </>
                          ) : 'Reading the template…'
                        ) : (
                          <>Built by class: {GMManager.getAvailableAppearanceOptions().find(o => o.id === GMManager.resolveCreatureAppearance(creatureCfg))?.label || `appearance ${creatureCfg.appearanceId}`} • Level {creatureCfg.level} • HP {creatureCfg.hp}</>
                        )}
                      </div>

                      <div className="gm-grid-2">
                        <div className="gm-field">
                          <label>Name</label>
                          <input className="gm-input" value={creatureCfg.name} onChange={e => updateCreatureCfg({ name: e.target.value })} />
                        </div>
                        <div className="gm-field">
                          <label>Faction (AI attitude)</label>
                          <select
                            className="gm-select"
                            value={creatureCfg.factionId}
                            onChange={e => updateCreatureCfg({ factionId: Number(e.target.value) })}
                          >
                            <option value={1}>Hostile (attacks players)</option>
                            <option value={2}>Friendly (ally / talkable)</option>
                            <option value={5}>Neutral (bystander / talkable)</option>
                            <option value={0}>Party faction</option>
                          </select>
                        </div>
                      </div>

                      <div className="gm-row">
                        <button
                          className={`gm-btn warning ${GMManager.activeTool === 'place_creature' ? 'active' : ''}`}
                          style={{ flex: 1 }}
                          onClick={() => GMManager.setToolMode(GMManager.activeTool === 'place_creature' ? 'select' : 'place_creature')}
                        >
                          {GMManager.activeTool === 'place_creature' ? 'Click the ground to place (Esc to stop)' : 'Click to place'}
                        </button>
                        <button
                          className="gm-btn success"
                          style={{ flex: 1 }}
                          onClick={async () => {
                            const c = await GMManager.spawnCreature(creatureCfg);
                            if (c) GMManager.selectObject(c);
                          }}
                        >
                          Place where the camera looks
                        </button>
                      </div>

                      <label className="gm-checkbox">
                        <input type="checkbox" checked={!!creatureCfg.customized} onChange={e => setCreatureCustomized(e.target.checked)} />
                        Customize this creature (look, HP, weapons, armour)
                      </label>
                    </div>

                    {creatureCfg.customized && (
                      <div className="gm-section">
                        <div className="gm-section-title">
                          <span>Customize</span>
                          <button className="gm-btn small" onClick={() => setCreatureCustomized(false)} title="Back to the preset or template as it is">
                            Reset
                          </button>
                        </div>
                        <div className="gm-grid-3">
                          <div className="gm-field">
                            <label>Appearance ID</label>
                            <input
                              type="number"
                              className="gm-input"
                              value={creatureCfg.appearanceId}
                              onChange={e => customizeCreature({ appearanceId: Number(e.target.value), appearanceLabel: undefined })}
                            />
                          </div>
                          <div className="gm-field">
                            <label>Hit points</label>
                            <input type="number" className="gm-input" value={creatureCfg.hp} onChange={e => customizeCreature({ hp: Number(e.target.value) })} />
                          </div>
                          <div className="gm-field">
                            <label title={creatureCfg.templateResRef ? 'A template keeps its own classes and level' : ''}>Level</label>
                            <input
                              type="number"
                              className="gm-input"
                              value={creatureCfg.level}
                              disabled={!!creatureCfg.templateResRef}
                              onChange={e => customizeCreature({ level: Number(e.target.value) })}
                            />
                          </div>
                        </div>

                        <div className="gm-field">
                          <label>Browse appearance (appearance.2da)</label>
                          <select
                            className="gm-select"
                            value={creatureCfg.appearanceId}
                            onChange={e => customizeCreature({ appearanceId: Number(e.target.value), appearanceLabel: undefined })}
                          >
                            {GMManager.getAvailableAppearanceOptions().map(opt => (
                              <option key={opt.id} value={opt.id}>{opt.label}</option>
                            ))}
                          </select>
                        </div>

                        <div className="gm-grid-2">
                          <div className="gm-field">
                            <label>Right-hand weapon</label>
                            <select
                              className="gm-select"
                              value={creatureCfg.rightHandResRef || ''}
                              onChange={e => customizeCreature({ rightHandResRef: e.target.value })}
                            >
                              {!GMManager.WEAPON_OPTIONS.some(w => w.resRef === (creatureCfg.rightHandResRef || '')) && (
                                <option value={creatureCfg.rightHandResRef}>{creatureCfg.rightHandResRef} (template)</option>
                              )}
                              {GMManager.WEAPON_OPTIONS.map(w => (
                                <option key={w.resRef} value={w.resRef}>{w.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="gm-field">
                            <label>Armour / clothing</label>
                            <select
                              className="gm-select"
                              value={creatureCfg.armorResRef || ''}
                              onChange={e => customizeCreature({ armorResRef: e.target.value })}
                            >
                              {!GMManager.ARMOR_OPTIONS.some(a => a.resRef === (creatureCfg.armorResRef || '')) && (
                                <option value={creatureCfg.armorResRef}>{creatureCfg.armorResRef} (template)</option>
                              )}
                              {GMManager.ARMOR_OPTIONS.map(a => (
                                <option key={a.resRef} value={a.resRef}>{a.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="gm-section">
                      <div className="gm-field">
                        <label>Custom Dialogue / Bark Line (spoken when clicked by player)</label>
                        <input
                          className="gm-input"
                          value={creatureCfg.barkText || ''}
                          onChange={e => updateCreatureCfg({ barkText: e.target.value })}
                          placeholder="e.g. Halt! None shall pass!"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="gm-section">
                      <div className="gm-section-title">
                        <span>Objects</span>
                        <button className="gm-btn small" onClick={() => setDrawerTab('builder')}>
                          Scene Blueprints (Office/Temple) →
                        </button>
                      </div>

                      <div className="gm-row" style={{ flexWrap: 'wrap' }}>
                        {(
                          [
                            'All',
                            'Office & Furniture',
                            'Temple & Sacred',
                            'Tech & Consoles',
                            'Medical & Lab',
                            'Storage & Cargo'
                          ] as const
                        ).map(cat => (
                          <button
                            key={cat}
                            className={`gm-btn small ${propCategoryFilter === cat ? 'active' : ''}`}
                            onClick={() => setPropCategoryFilter(cat)}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>

                      <div className="gm-list" style={{ maxHeight: 165 }}>
                        {GMManager.CATEGORIZED_PROPS.filter(
                          p => propCategoryFilter === 'All' || p.category === propCategoryFilter
                        ).map((preset, idx) => (
                          <div
                            key={idx}
                            className={`gm-card ${placeablePreset === preset ? 'selected' : ''}`}
                            onClick={() => selectPlaceablePreset(preset)}
                          >
                            <div className="gm-card-info">
                              <div className="gm-card-title">
                                {preset.name} <span className="gm-badge" style={{ marginLeft: 4 }}>{preset.category}</span>
                              </div>
                              <div className="gm-card-sub">
                                {preset.hasInventory ? `Container (${preset.lootResRefs.length} items)` : 'Prop / Interactive'} • {preset.locked ? `Locked (DC ${preset.openLockDC})` : 'Unlocked'}
                              </div>
                            </div>
                            <button
                              className="gm-btn small warning"
                              onClick={e => {
                                e.stopPropagation();
                                selectPlaceablePreset(preset);
                                GMManager.setToolMode('place_placeable');
                              }}
                              title="Click the ground to place it"
                            >
                              Place
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="gm-section">
                      <div className="gm-section-title">
                        <span>{placeableCfg.customized ? 'Placing (customized)' : 'Placing'}: {placeableCfg.name}</span>
                      </div>
                      <div className="gm-hint">
                        Model: {GMManager.getPlaceableAppearanceLabel(GMManager.resolvePlaceableAppearance(placeableCfg))}
                        {placeableCfg.hasInventory ? ` • Container with ${placeableCfg.lootResRefs.length} item${placeableCfg.lootResRefs.length === 1 ? '' : 's'}` : ''}
                        {placeableCfg.locked ? ` • Locked (DC ${placeableCfg.openLockDC})` : ''}
                      </div>

                      <div className="gm-row">
                        <button
                          className={`gm-btn warning ${GMManager.activeTool === 'place_placeable' ? 'active' : ''}`}
                          style={{ flex: 1 }}
                          onClick={() =>
                            GMManager.setToolMode(GMManager.activeTool === 'place_placeable' ? 'select' : 'place_placeable')
                          }
                        >
                          {GMManager.activeTool === 'place_placeable' ? 'Click the ground to place (Esc to stop)' : 'Click to place'}
                        </button>
                        <button
                          className="gm-btn success"
                          style={{ flex: 1 }}
                          onClick={async () => {
                            const plc = await GMManager.spawnPlaceable(placeableCfg);
                            if (plc) GMManager.selectObject(plc);
                          }}
                        >
                          Place where the camera looks
                        </button>
                      </div>

                      <div className="gm-field" title="A hidden mine, hostile to the players. They can spot it with Awareness, then disarm or recover it with Demolitions.">
                        <label>Mines</label>
                        <div className="gm-row">
                          <select
                            className="gm-select"
                            style={{ flex: 1 }}
                            value={GMManager.pendingMineType}
                            onChange={e => { GMManager.pendingMineType = Number(e.target.value); forceUpdate(); }}
                          >
                            {GMManager.getMineTypes().map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                          </select>
                          <button
                            className={`gm-btn warning ${GMManager.activeTool === 'place_mine' ? 'active' : ''}`}
                            onClick={() => GMManager.setToolMode(GMManager.activeTool === 'place_mine' ? 'select' : 'place_mine')}
                          >
                            {GMManager.activeTool === 'place_mine' ? 'Click the ground (Esc to stop)' : 'Place mine'}
                          </button>
                        </div>
                      </div>

                      <div className="gm-grid-2">
                        <div className="gm-field">
                          <label>Grid snap</label>
                          <select
                            className="gm-select"
                            value={GMManager.gridSnapSize}
                            onChange={e => {
                              GMManager.gridSnapSize = Number(e.target.value);
                              forceUpdate();
                            }}
                          >
                            <option value={0}>Off (Free Placement)</option>
                            <option value={0.5}>0.5m Fine Grid</option>
                            <option value={1}>1.0m Room Grid</option>
                            <option value={2}>2.0m Pillar/Wall Grid</option>
                          </select>
                        </div>
                        <div className="gm-field">
                          <label>Rotation (R / Shift+R or wheel while placing)</label>
                          <select
                            className="gm-select"
                            value={GMManager.placementYawOffset}
                            onChange={e => {
                              GMManager.placementYawOffset = Number(e.target.value);
                              forceUpdate();
                            }}
                          >
                            {Array.from(new Set([0, 45, 90, 135, 180, 225, 270, 315, GMManager.placementYawOffset])).sort((a, b) => a - b).map(deg => (
                              <option key={deg} value={deg}>{deg}°</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <label className="gm-checkbox">
                        <input
                          type="checkbox"
                          checked={!!placeableCfg.customized}
                          onChange={e => setPlaceableCustomized(e.target.checked)}
                        />
                        Customize this object (model, name, loot, lock, size)
                      </label>
                    </div>

                    {placeableCfg.customized && (
                      <div className="gm-section">
                        <div className="gm-section-title">
                          <span>Customize</span>
                          <button className="gm-btn small" onClick={() => setPlaceableCustomized(false)} title="Back to the preset as it is">
                            Reset to preset
                          </button>
                        </div>
                        <div className="gm-grid-2">
                          <div className="gm-field">
                            <label>Name</label>
                            <input
                              className="gm-input"
                              value={placeableCfg.name}
                              onChange={e => updatePlaceableCfg({ name: e.target.value })}
                            />
                          </div>
                          <div className="gm-field">
                            <label>Model (placeables.2da)</label>
                            <select
                              className="gm-select"
                              value={placeableCfg.appearanceId}
                              onChange={e => updatePlaceableCfg({ appearanceId: Number(e.target.value), appearanceLabel: undefined, modelKeywords: undefined })}
                            >
                              {GMManager.getAvailablePlaceableAppearances().map(opt => (
                                <option key={opt.id} value={opt.id}>{opt.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="gm-grid-2">
                          <div className="gm-field">
                            <label>Size</label>
                            <select
                              className="gm-select"
                              value={placeableCfg.scale ?? 1.0}
                              onChange={e => updatePlaceableCfg({ scale: Number(e.target.value) })}
                            >
                              {Array.from(new Set([0.65, 0.85, 1, 1.2, 1.4, 1.75, 2.25, placeableCfg.scale ?? 1])).sort((a, b) => a - b).map(v => (
                                <option key={v} value={v}>{v.toFixed(2)}x</option>
                              ))}
                            </select>
                          </div>
                          <div className="gm-field">
                            <label>Height above ground</label>
                            <select
                              className="gm-select"
                              value={placeableCfg.zOffset ?? 0}
                              onChange={e => updatePlaceableCfg({ zOffset: Number(e.target.value) })}
                            >
                              {Array.from(new Set([0, 0.65, 0.9, 1.15, 2.2, placeableCfg.zOffset ?? 0])).sort((a, b) => a - b).map(v => (
                                <option key={v} value={v}>+{v.toFixed(2)}m</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="gm-row">
                          <label className="gm-checkbox">
                            <input
                              type="checkbox"
                              checked={placeableCfg.useable}
                              onChange={e => updatePlaceableCfg({ useable: e.target.checked })}
                            />
                            Usable
                          </label>
                          <label className="gm-checkbox">
                            <input
                              type="checkbox"
                              checked={placeableCfg.hasInventory}
                              onChange={e => updatePlaceableCfg({ hasInventory: e.target.checked })}
                            />
                            Container
                          </label>
                          <label className="gm-checkbox">
                            <input
                              type="checkbox"
                              checked={placeableCfg.locked}
                              onChange={e => updatePlaceableCfg({ locked: e.target.checked })}
                            />
                            Locked
                          </label>
                          {placeableCfg.locked && (
                            <label className="gm-checkbox">
                              DC
                              <input
                                className="gm-input"
                                style={{ width: 56 }}
                                type="number"
                                min={1}
                                max={60}
                                value={placeableCfg.openLockDC}
                                onChange={e => updatePlaceableCfg({ openLockDC: Number(e.target.value) || 15 })}
                              />
                            </label>
                          )}
                        </div>

                        <div className="gm-row" title="Using it takes a skill check first; passing once opens it for good">
                          <label className="gm-checkbox" style={{ flex: 1 }}>
                            Needs
                            <select
                              className="gm-select"
                              value={placeableCfg.skillGate ? String(placeableCfg.skillGate.skill) : ''}
                              onChange={e => updatePlaceableCfg({ skillGate: e.target.value === '' ? undefined : { skill: Number(e.target.value), dc: placeableCfg.skillGate?.dc || 15 } })}
                            >
                              <option value="">no skill check</option>
                              {GMManager.SKILL_NAMES.map((name, i) => <option key={name} value={i}>{name}</option>)}
                            </select>
                          </label>
                          {placeableCfg.skillGate && (
                            <label className="gm-checkbox">
                              DC
                              <input
                                className="gm-input"
                                style={{ width: 56 }}
                                type="number"
                                min={1}
                                max={60}
                                value={placeableCfg.skillGate.dc}
                                onChange={e => updatePlaceableCfg({ skillGate: { ...placeableCfg.skillGate!, dc: Number(e.target.value) || 15 } })}
                              />
                            </label>
                          )}
                        </div>

                        {placeableCfg.hasInventory && (
                          <div className="gm-field">
                            <label>Loot ({placeableCfg.lootResRefs.join(', ') || 'empty'})</label>
                            <div className="gm-row">
                              <select
                                className="gm-select"
                                style={{ flex: 1 }}
                                value={customLootResRef}
                                onChange={e => setCustomLootResRef(e.target.value)}
                              >
                                {GMManager.LOOT_ITEM_OPTIONS.map(it => (
                                  <option key={it.resRef} value={it.resRef}>{it.label}</option>
                                ))}
                              </select>
                              <button
                                className="gm-btn small"
                                onClick={() => updatePlaceableCfg({ lootResRefs: [...placeableCfg.lootResRefs, customLootResRef] })}
                              >
                                + Add
                              </button>
                              <button className="gm-btn small danger" onClick={() => updatePlaceableCfg({ lootResRefs: [] })}>
                                Clear
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="gm-field">
                          <label>Message when used</label>
                          <input
                            className="gm-input"
                            value={placeableCfg.barkText || ''}
                            onChange={e => updatePlaceableCfg({ barkText: e.target.value })}
                            placeholder="Optional"
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* ==================== TAB 3: PLAYERS & PARTY ==================== */}
            {drawerTab === 'players' && (
              <>
                {fallenPlayers.length > 0 && (
                  <div className="gm-section">
                    <div className="gm-section-title">
                      <span>Fallen players ({fallenPlayers.length})</span>
                      {fallenPlayers.length > 1 && (
                        <button className="gm-btn small success" onClick={() => GMManager.reviveAllPlayers()}>Revive everyone</button>
                      )}
                    </div>
                    <div className="gm-list">
                      {fallenPlayers.map((pc) => (
                        <div key={(pc as any).gmNetId || pc.id} className="gm-card">
                          <div className="gm-card-info">
                            <div className="gm-card-title">{pc.getName()}</div>
                            <div className="gm-card-sub">Down for {Math.round((Date.now() - ((pc as any).gmDowned?.since || Date.now())) / 1000)}s</div>
                          </div>
                          <div className="gm-row">
                            <button className="gm-btn small success" onClick={() => GMManager.revivePlayer(pc)} title="Back on their feet with full vitality">Revive</button>
                            <button className="gm-btn small" onClick={() => GMManager.respawnPlayer(pc)} title="Back at the scene's entry with half their vitality">Send to entry</button>
                          </div>
                        </div>
                      ))}
                    </div>
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
                    <div className="gm-section">
                      <div className="gm-section-title">Call for a check</div>
                      <div className="gm-grid-2">
                        <div className="gm-field">
                          <label>Who</label>
                          <select className="gm-select" value={checkWho} onChange={e => setCheckWho(e.target.value)}>
                            <option value="all">Every player ({players.length})</option>
                            {selectedCreature && <option value="selected">Selected: {selectedCreature.getName()}</option>}
                            {players.map((pc) => (
                              <option key={(pc as any).gmNetId} value={(pc as any).gmNetId}>{pc.getName()}</option>
                            ))}
                          </select>
                        </div>
                        <div className="gm-field">
                          <label>Check</label>
                          <select className="gm-select" value={checkWhat} onChange={e => setCheckWhat(e.target.value)}>
                            <optgroup label="Skills">
                              {GMManager.SKILL_NAMES.map((name, i) => <option key={name} value={`skill:${i}`}>{name}</option>)}
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
                        onClick={() => { GMManager.callCheck(targets(), parseCheck(checkWhat), checkDc, checkSecret); forceUpdate(); }}
                        title="Rolls d20 + the skill (or save) for each, as KotOR does; results go to chat"
                      >
                        Roll
                      </button>
                    </div>
                  );
                })()}

                {GMNetworkManager.role === 'host' && (
                  <div className="gm-section">
                    <div className="gm-section-title">Connected Players ({connectedPeers.length})</div>
                    {connectedPeers.length === 0 ? (
                      <div className="gm-hint">No players have joined yet. Host from the Session tab and share the address.</div>
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
                            const pc = GMManager.getPeerActor(peer.peerId);
                            return (
                              <div key={peer.peerId} className="gm-card">
                                <div className="gm-card-info">
                                  <div className="gm-card-title">{peer.name}</div>
                                  <div className="gm-card-sub">
                                    {pc ? `${pc.getName()} • Level ${pc.classes?.[0]?.level ?? '?'} • HP ${pc.getHP()}/${pc.getMaxHP()} • XP ${pc.experience || 0}` : 'No character yet'}
                                  </div>
                                </div>
                                <div className="gm-row">
                                  <button className="gm-btn small" disabled={!pc} onClick={() => GMManager.giveXP(peer.peerId, rewardXp)} title={`Give ${peer.name} ${rewardXp} XP`}>
                                    + XP
                                  </button>
                                  <button className="gm-btn small" disabled={!pc || !rewardItem.trim()} onClick={() => GMManager.giveItem(peer.peerId, rewardItem)} title={`Give ${peer.name} ${rewardItem}`}>
                                    + Item
                                  </button>
                                  <button className="gm-btn small" disabled={!pc} onClick={() => pc && GMManager.selectObject(pc)} title="Select their character">
                                    Select
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
                <div className="gm-section">
                  <div className="gm-section-title">
                    <span>Loaded Player Characters & Party ({KotOR.GameState.PartyManager.party.length})</span>
                    {GMManager.controlMode === 'POSSESS' && (
                      <button className="gm-btn small warning" onClick={() => GMManager.enterFreeCamera(true)}>
                        Exit Possession (Free Cam)
                      </button>
                    )}
                  </div>

                  {KotOR.GameState.PartyManager.party.length === 0 ? (
                    <div className="gm-hint">
                      No Player Character is in the scene yet. Spawn a Player Preset below, load from a Save Game, or import a <code>.utc</code> file!
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
                                {isControlled ? 'Active' : 'Possess & Play'}
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

                <div className="gm-section">
                  <div className="gm-section-title">
                    <span>Load Player Character from Saved Games ({KotOR.SaveGame.saves.length})</span>
                    <button
                      className="gm-btn small"
                      onClick={async () => {
                        await KotOR.SaveGame.GetSaveGames();
                        forceUpdate();
                      }}
                    >
                      Scan Saves
                    </button>
                  </div>

                  {KotOR.SaveGame.saves.length === 0 ? (
                    <div className="gm-row">
                      <span style={{ fontSize: 11, color: '#8cb0d0' }}>
                        Click &quot;Scan Saves&quot; to list characters from your KotOR Saves folder, or import a .utc file:
                      </span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".utc"
                        style={{ display: 'none' }}
                        onChange={handleImportUTCFile}
                      />
                      <button className="gm-btn small active" onClick={() => fileInputRef.current?.click()}>
                        Import .UTC File
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
                              onClick={() => GMManager.loadPlayerFromSaveGame(sg, true)}
                            >
                              Load PC
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
                          Import Custom .UTC Character File...
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div className="gm-section">
                  <div className="gm-section-title">Quick Player Character Builds (With Feats, Force Powers & Gear)</div>
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
                              const built = GMManager.buildPlayerAbilities(preset);
                              return `Lv.${preset.level} • HP ${built.maxHp} • FP ${built.maxFp} • ${built.feats.length} feats, ${built.powers.length} powers`;
                            })()}
                          </div>
                        </div>
                        <button
                          className="gm-btn small success"
                          onClick={async e => {
                            e.stopPropagation();
                            updatePlayerCfg({ ...preset });
                            await GMManager.spawnPlayerCharacter({ ...preset, possessImmediately: true });
                          }}
                        >
                          Spawn & Play
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="gm-section">
                  <div className="gm-section-title">Custom Player Character Builder</div>
                  <div className="gm-grid-2">
                    <div className="gm-field">
                      <label>Character Name</label>
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
                      <label>HP (blank: from class)</label>
                      <input
                        type="number"
                        className="gm-input"
                        value={playerCfg.hp ?? ''}
                        placeholder={String(GMManager.buildPlayerAbilities({ ...playerCfg, hp: undefined }).maxHp)}
                        onChange={e => updatePlayerCfg({ hp: e.target.value === '' ? undefined : Number(e.target.value) })}
                      />
                    </div>
                    <div className="gm-field">
                      <label>Force Points (blank: from class)</label>
                      <input
                        type="number"
                        className="gm-input"
                        value={playerCfg.fp ?? ''}
                        placeholder={String(GMManager.buildPlayerAbilities({ ...playerCfg, fp: undefined }).maxFp)}
                        onChange={e => updatePlayerCfg({ fp: e.target.value === '' ? undefined : Number(e.target.value) })}
                      />
                    </div>
                  </div>

                  <div className="gm-grid-2">
                    <div className="gm-field">
                      <label>Right-Hand Weapon</label>
                      <select
                        className="gm-select"
                        value={playerCfg.rightHandResRef || ''}
                        onChange={e => updatePlayerCfg({ rightHandResRef: e.target.value })}
                      >
                        {GMManager.WEAPON_OPTIONS.map(w => (
                          <option key={w.resRef} value={w.resRef}>{w.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="gm-field">
                      <label>Armor / Robes</label>
                      <select
                        className="gm-select"
                        value={playerCfg.armorResRef || ''}
                        onChange={e => updatePlayerCfg({ armorResRef: e.target.value })}
                      >
                        {GMManager.ARMOR_OPTIONS.map(a => (
                          <option key={a.resRef} value={a.resRef}>{a.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="gm-row">
                    <button
                      className="gm-btn success"
                      style={{ flex: 1 }}
                      onClick={() => GMManager.spawnPlayerCharacter({ ...playerCfg, possessImmediately: true })}
                    >
                      Spawn & Possess Player
                    </button>
                    <button
                      className={`gm-btn warning ${GMManager.activeTool === 'place_player' ? 'active' : ''}`}
                      onClick={() =>
                        GMManager.setToolMode(GMManager.activeTool === 'place_player' ? 'select' : 'place_player')
                      }
                    >
                      Click-Place in 3D
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* ==================== TAB 4: WORLD INSPECTOR ==================== */}
            {drawerTab === 'inspector' && (
              <>
                <div className="gm-section">
                  <div className="gm-section-title">
                    <span>Selected World Object</span>
                    {selectedObj && (
                      <button className="gm-btn small danger" onClick={() => GMManager.deleteObject(selectedObj)}>
                        Delete Object
                      </button>
                    )}
                  </div>

                  {!selectedObj ? (
                    <div className="gm-hint">
                      Click any Creature, Player, Placeable, or Door in the 3D scene (with <b>Cursor: Select</b> active) or pick one from the World Objects list below.
                    </div>
                  ) : (
                    <>
                      <div className="gm-card selected" style={{ cursor: 'default' }}>
                        <div className="gm-card-info">
                          <div className="gm-card-title">
                            {selectedObj.getName() || (selectedObj as any).firstName || selectedObj.getTag() || 'World Object'}
                          </div>
                          <div className="gm-card-sub">
                            Tag: {selectedObj.getTag() || 'none'} • Pos: ({selectedObj.position.x.toFixed(1)}, {selectedObj.position.y.toFixed(1)}, {selectedObj.position.z.toFixed(1)})
                          </div>
                        </div>
                        <span className="gm-badge">
                          HP {selectedObj.getHP()}/{selectedObj.getMaxHP()}
                        </span>
                      </div>

                      {/* Creature / Player Specific Controls */}
                      {BitWise.InstanceOf(selectedObj.objectType, KotOR.ModuleObjectType.ModuleCreature) && (
                        <>
                          <div className="gm-row">
                            <button
                              className="gm-btn success"
                              style={{ flex: 1 }}
                              onClick={() => GMManager.possessCharacter(selectedObj as KotOR.ModuleCreature)}
                            >
                              Possess & Control Character
                            </button>
                            <button className="gm-btn small" onClick={() => GMManager.healObject(selectedObj)}>
                              Full Heal
                            </button>
                            <button className="gm-btn small danger" onClick={() => GMManager.killObject(selectedObj)}>
                              Kill
                            </button>
                          </div>

                          <div className="gm-field">
                            <label>Faction Attitude</label>
                            <div className="gm-row">
                              <button
                                className={`gm-btn small ${(selectedObj as KotOR.ModuleCreature).factionId === 1 ? 'danger' : ''}`}
                                onClick={() => GMManager.setObjectFaction(selectedObj, 1)}
                              >
                                Hostile (1)
                              </button>
                              <button
                                className={`gm-btn small ${(selectedObj as KotOR.ModuleCreature).factionId === 2 ? 'success' : ''}`}
                                onClick={() => GMManager.setObjectFaction(selectedObj, 2)}
                              >
                                Friendly (2)
                              </button>
                              <button
                                className={`gm-btn small ${(selectedObj as KotOR.ModuleCreature).factionId === 5 ? 'active' : ''}`}
                                onClick={() => GMManager.setObjectFaction(selectedObj, 5)}
                              >
                                Neutral (5)
                              </button>
                              <button
                                className={`gm-btn small ${(selectedObj as KotOR.ModuleCreature).factionId === 0 ? 'active' : ''}`}
                                onClick={() => GMManager.setObjectFaction(selectedObj, 0)}
                              >
                                Party (0)
                              </button>
                            </div>
                          </div>

                          <div className="gm-grid-2">
                            <div className="gm-field">
                              <label>Equip Right-Hand Weapon</label>
                              <select
                                className="gm-select"
                                value={(selectedObj as KotOR.ModuleCreature).equipment?.RIGHTHAND?.getEquippedRes() || ''}
                                onChange={e =>
                                  GMManager.equipWeaponOnCreature(
                                    selectedObj as KotOR.ModuleCreature,
                                    KotOR.ModuleCreatureArmorSlot.RIGHTHAND,
                                    e.target.value
                                  )
                                }
                              >
                                {GMManager.WEAPON_OPTIONS.map(w => (
                                  <option key={w.resRef} value={w.resRef}>{w.label}</option>
                                ))}
                              </select>
                            </div>
                            <div className="gm-field">
                              <label>Equip Armor / Robe</label>
                              <select
                                className="gm-select"
                                value={(selectedObj as KotOR.ModuleCreature).equipment?.ARMOR?.getEquippedRes() || ''}
                                onChange={e =>
                                  GMManager.equipWeaponOnCreature(
                                    selectedObj as KotOR.ModuleCreature,
                                    KotOR.ModuleCreatureArmorSlot.ARMOR,
                                    e.target.value
                                  )
                                }
                              >
                                {GMManager.ARMOR_OPTIONS.map(a => (
                                  <option key={a.resRef} value={a.resRef}>{a.label}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </>
                      )}

                      {/* Door & Placeable Specific Controls */}
                      {(BitWise.InstanceOf(selectedObj.objectType, KotOR.ModuleObjectType.ModuleDoor) ||
                        BitWise.InstanceOf(selectedObj.objectType, KotOR.ModuleObjectType.ModulePlaceable)) && (
                        <>
                          <div className="gm-row">
                            <button
                              className="gm-btn active"
                              style={{ flex: 1 }}
                              onClick={() => GMManager.toggleDoorOrPlaceableOpen(selectedObj)}
                            >
                              {(selectedObj as any).isOpen?.() ? 'Close Door / Object' : 'Open / Activate'}
                            </button>
                            <button
                              className={`gm-btn ${(selectedObj as KotOR.ModuleDoor | KotOR.ModulePlaceable).isLocked() ? 'warning' : ''}`}
                              style={{ flex: 1 }}
                              onClick={() => GMManager.toggleDoorOrPlaceableLock(selectedObj)}
                            >
                              {(selectedObj as KotOR.ModuleDoor | KotOR.ModulePlaceable).isLocked() ? 'Locked (Click to Unlock)' : 'Unlocked (Click to Lock)'}
                            </button>
                          </div>

                          {BitWise.InstanceOf(selectedObj.objectType, KotOR.ModuleObjectType.ModulePlaceable) && (() => {
                            const gate = (selectedObj as any).gmSkillGate as { skill: number; dc: number } | undefined;
                            return (
                              <div className="gm-row" title="Using it takes a skill check first; passing once opens it for good">
                                <label className="gm-checkbox" style={{ flex: 1 }}>
                                  Needs
                                  <select
                                    className="gm-select"
                                    value={gate ? String(gate.skill) : ''}
                                    onChange={e => GMManager.setSkillGate(selectedObj, e.target.value === '' ? undefined : { skill: Number(e.target.value), dc: gate?.dc || 15 })}
                                  >
                                    <option value="">no skill check</option>
                                    {GMManager.SKILL_NAMES.map((name, i) => <option key={name} value={i}>{name}</option>)}
                                  </select>
                                </label>
                                {gate && (
                                  <label className="gm-checkbox">
                                    DC
                                    <input
                                      className="gm-input"
                                      style={{ width: 56 }}
                                      type="number"
                                      min={1}
                                      max={60}
                                      value={gate.dc}
                                      onChange={e => GMManager.setSkillGate(selectedObj, { skill: gate.skill, dc: Number(e.target.value) || 15 })}
                                    />
                                  </label>
                                )}
                                {(selectedObj as any).gmSkillGateSolved && <span className="gm-badge">passed</span>}
                              </div>
                            );
                          })()}

                          {BitWise.InstanceOf(selectedObj.objectType, KotOR.ModuleObjectType.ModulePlaceable) && (
                            <div className="gm-field">
                              <label>
                                Stock Container Loot ({(selectedObj as KotOR.ModulePlaceable).inventory?.length || 0} items inside)
                              </label>
                              <div className="gm-row">
                                <select
                                  className="gm-select"
                                  style={{ flex: 1 }}
                                  value={inspectorAddItemResRef}
                                  onChange={e => setInspectorAddItemResRef(e.target.value)}
                                >
                                  {GMManager.LOOT_ITEM_OPTIONS.map(it => (
                                    <option key={it.resRef} value={it.resRef}>{it.label}</option>
                                  ))}
                                </select>
                                <button
                                  className="gm-btn small success"
                                  onClick={() => GMManager.addItemToObject(selectedObj, inspectorAddItemResRef)}
                                >
                                  + Put Item Inside
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {/* Common Transform, Scale, Duplicate & Bark Controls */}
                      <div className="gm-row">
                        <button
                          className="gm-btn small success"
                          onClick={() => GMManager.duplicateObject(selectedObj)}
                          title="Spawn an exact duplicate of this Placeable or Creature next to it"
                        >
                          Duplicate / Clone
                        </button>
                        <button
                          className="gm-btn small"
                          onClick={() => {
                            const pt = GMManager.getCameraTargetSpawnPoint(3.0);
                            GMManager.teleportObject(selectedObj, pt.position);
                          }}
                        >
                          Move to Camera
                        </button>
                        <button
                          className={`gm-btn small ${GMManager.activeTool === 'teleport' ? 'warning active' : ''}`}
                          onClick={() => GMManager.setToolMode(GMManager.activeTool === 'teleport' ? 'select' : 'teleport')}
                        >
                          Click-Teleport
                        </button>
                        <button className="gm-btn small" onClick={() => GMManager.rotateObject(selectedObj, -Math.PI / 4)}>
                          Rotate -45°
                        </button>
                        <button className="gm-btn small" onClick={() => GMManager.rotateObject(selectedObj, Math.PI / 4)}>
                          Rotate +45°
                        </button>
                      </div>

                      <div className="gm-field">
                        <label>Fine Architectural Nudge (X / Y / Z) &amp; Scale ({((selectedObj as any).gmScale || 1.0).toFixed(2)}x)</label>
                        <div className="gm-row">
                          <button className="gm-btn small" onClick={() => GMManager.nudgeObjectPosition(selectedObj, -0.5, 0, 0)}>X -0.5</button>
                          <button className="gm-btn small" onClick={() => GMManager.nudgeObjectPosition(selectedObj, 0.5, 0, 0)}>X +0.5</button>
                          <button className="gm-btn small" onClick={() => GMManager.nudgeObjectPosition(selectedObj, 0, -0.5, 0)}>Y -0.5</button>
                          <button className="gm-btn small" onClick={() => GMManager.nudgeObjectPosition(selectedObj, 0, 0.5, 0)}>Y +0.5</button>
                          <button className="gm-btn small" onClick={() => GMManager.nudgeObjectPosition(selectedObj, 0, 0, -0.25)}>Z -0.25</button>
                          <button className="gm-btn small" onClick={() => GMManager.nudgeObjectPosition(selectedObj, 0, 0, 0.25)}>Z +0.25</button>
                        </div>
                        <div className="gm-row" style={{ marginTop: 4 }}>
                          {([0.75, 1.0, 1.25, 1.5, 2.0] as const).map(sc => (
                            <button
                              key={sc}
                              className={`gm-btn small ${Math.abs(((selectedObj as any).gmScale || 1.0) - sc) < 0.05 ? 'active' : ''}`}
                              onClick={() => GMManager.setObjectScale(selectedObj, sc)}
                            >
                              Scale {sc}x
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="gm-field">
                        <label>GM Custom Bark / Dialogue Line</label>
                        <div className="gm-row">
                          <input
                            className="gm-input"
                            style={{ flex: 1 }}
                            value={inspectorBarkInput}
                            onChange={e => {
                              setInspectorBarkInput(e.target.value);
                              GMManager.setObjectBark(selectedObj, e.target.value);
                            }}
                            placeholder="Set text spoken when interacted with..."
                          />
                          <button
                            className="gm-btn small active"
                            onClick={() => GMManager.triggerBarkNow(selectedObj, inspectorBarkInput)}
                          >
                            Speak Now
                          </button>
                        </div>
                      </div>

                      {!(selectedObj as any).gmOwnerPeerId && (
                        <label className="gm-checkbox" title="Hidden objects stay visible to you but are removed from players' games until revealed">
                          <input
                            type="checkbox"
                            checked={GMManager.isHiddenFromPlayers(selectedObj)}
                            onChange={e => GMManager.setObjectHidden(selectedObj, e.target.checked)}
                          />
                          Hidden from players
                        </label>
                      )}

                      {GMManager.canOrder(selectedObj) && (() => {
                        const npc = selectedObj as KotOR.ModuleCreature;
                        const order = GMNpcOrders.getOrder(npc);
                        const players = GMManager.getPlayerCharacters().filter((pc) => !pc.isDead());
                        return (
                          <div className="gm-field">
                            <label>Orders: {GMNpcOrders.describe(order)}</label>
                            <div className="gm-row">
                              <button className="gm-btn small" onClick={() => GMManager.startOrderTool('order_move', npc)} title="Click the ground: it walks there, then guards the spot">Move here…</button>
                              <button className="gm-btn small" onClick={() => GMManager.startOrderTool('order_attack', npc)} title="Click a creature: it attacks until that one is dead">Attack…</button>
                              <button className="gm-btn small" onClick={() => GMManager.startOrderTool('order_follow', npc)} title="Click a creature or player: it stays close and fights back if attacked">Follow…</button>
                              <button className="gm-btn small" onClick={() => GMManager.startOrderTool('order_patrol', npc)} title="Click points on the ground, then Esc: it walks the loop and fights what it meets">Patrol…</button>
                            </div>
                            <div className="gm-row">
                              <button className="gm-btn small" onClick={() => GMManager.giveOrder(npc, { kind: 'guard', point: GMManager.pointOf(npc), radius: GMNpcOrders.GUARD_RADIUS })} title={`Holds this spot and fights enemies within ${GMNpcOrders.GUARD_RADIUS}m`}>Guard here</button>
                              <button className="gm-btn small warning" onClick={() => GMManager.giveOrder(npc, { kind: 'flee' })} title="Runs from the nearest enemy and doesn't fight">Flee</button>
                              <button className="gm-btn small warning" onClick={() => GMManager.giveOrder(npc, { kind: 'standDown' })} title="Stops fighting, even if attacked">Stand down</button>
                              <button className="gm-btn small" disabled={!order} onClick={() => GMManager.giveOrder(npc, undefined)} title="Back to its own judgement: fights the nearest enemy">Clear order</button>
                            </div>
                            {players.length > 0 && (
                              <select
                                className="gm-select"
                                value=""
                                onChange={(e) => { if (e.target.value) GMManager.giveOrder(npc, { kind: 'follow', targetNetId: e.target.value }); }}
                              >
                                <option value="">Follow a player…</option>
                                {players.map((pc) => (
                                  <option key={(pc as any).gmNetId} value={(pc as any).gmNetId}>{pc.getName()}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        );
                      })()}

                      {GMNetworkManager.role === 'host' && GMConversationManager.canTalkTo(selectedObj) && (() => {
                        const nearby = GMConversationManager.getNearbyPeers(selectedObj);
                        return (
                          <button
                            className="gm-btn small"
                            disabled={!nearby.length}
                            onClick={() => GMConversationManager.join(selectedObj as KotOR.ModuleCreature, nearby)}
                            title={nearby.length ? 'Open a conversation with the players standing near it' : `No players within ${GMConversationManager.NEARBY_RANGE}m`}
                          >
                            Talk as {selectedObj.getName() || 'this NPC'} to nearby players ({nearby.length})
                          </button>
                        );
                      })()}

                      {GMNetworkManager.role === 'host' && (
                        <div className="gm-field">
                          <label>Ask players, as {selectedObj.getName() || 'this object'}</label>
                          <input className="gm-input" value={askText} onChange={e => setAskText(e.target.value)} placeholder="What do you want, stranger?" />
                          <textarea
                            className="gm-input"
                            rows={3}
                            value={askOptions}
                            onChange={e => setAskOptions(e.target.value)}
                            placeholder="One reply per line"
                          />
                          <div className="gm-row">
                            <select className="gm-select" style={{ flex: 1 }} value={askTarget} onChange={e => setAskTarget(e.target.value)}>
                              <option value="">Everyone</option>
                              {connectedPeers.map(peer => <option key={peer.peerId} value={peer.peerId}>{peer.name}</option>)}
                            </select>
                            <button
                              className="gm-btn small active"
                              disabled={!askText.trim() || !askOptions.trim()}
                              onClick={() => {
                                const id = GMManager.askPlayers(selectedObj, askText, askOptions.split('\n'), askTarget || undefined);
                                if (id) setAskText('');
                              }}
                            >
                              Ask
                            </button>
                          </div>
                          {recentPrompts.map(({ prompt, replies }) => (
                            <div key={prompt.promptId} className="gm-card-sub">
                              "{prompt.text}": {replies.length ? replies.map(r => `${r.name} → ${prompt.options[r.choice]}`).join(', ') : 'waiting for replies'}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="gm-section">
                  <div className="gm-section-title">
                    <span>World Objects in Scene ({worldObjects.length})</span>
                  </div>
                  <div className="gm-row">
                    {(['all', 'creatures', 'placeables', 'doors'] as const).map(f => (
                      <button
                        key={f}
                        className={`gm-btn small ${inspectorFilter === f ? 'active' : ''}`}
                        onClick={() => setInspectorFilter(f)}
                      >
                        {f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <div className="gm-list" style={{ maxHeight: 190 }}>
                    {worldObjects.map((entry, idx) => (
                      <div
                        key={entry.obj.id || idx}
                        className={`gm-card ${selectedObj === entry.obj ? 'selected' : ''}`}
                        onClick={() => {
                          GMManager.selectObject(entry.obj);
                          setInspectorBarkInput((entry.obj as any).gmBarkText || '');
                        }}
                      >
                        <div className="gm-card-info">
                          <div className="gm-card-title">
                            {entry.obj.getName() || (entry.obj as any).firstName || entry.obj.getTag() || 'Unnamed'}
                          </div>
                          <div className="gm-card-sub">{entry.kind} • Tag: {entry.obj.getTag() || 'none'}</div>
                        </div>
                        <div className="gm-row">
                          <span className="gm-badge">{entry.badge}</span>
                          <button
                            className="gm-btn small"
                            title="Jump camera to object"
                            onClick={e => {
                              e.stopPropagation();
                              GMManager.enterFreeCamera(false);
                              KotOR.GameState.camera.position.set(
                                entry.obj.position.x,
                                entry.obj.position.y - 4.0,
                                entry.obj.position.z + 2.5
                              );
                              KotOR.GameState.camera.up.set(0, 0, 1);
                              KotOR.GameState.camera.lookAt(
                                entry.obj.position.x,
                                entry.obj.position.y,
                                entry.obj.position.z + 1.0
                              );
                            }}
                          >
                            Go To
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ==================== TAB 5: MULTIPLAYER (NWN HOST / JOIN) ==================== */}
            {drawerTab === 'multiplayer' && (
              <>
                {!isPlayerView && (
                  <>
                  <div className="gm-section">
                    <div className="gm-section-title">When a player falls</div>
                    <select className="gm-select" value={GMManager.deathRule} onChange={(e) => GMManager.setDeathRule(e.target.value as KotOR.GMDeathRule)}>
                      <option value="kotor">KotOR rules: they get up with 1 HP once no enemy is near</option>
                      <option value="gm">GM decides: they stay down until you revive them</option>
                      <option value="respawn">Respawn: after {GMManager.RESPAWN_DELAY_SECONDS}s they can respawn at the entrance</option>
                    </select>
                    <div className="gm-hint">You can always revive fallen players from the Players tab. Saved with the session.</div>
                  </div>
                  <div className="gm-section">
                    <div className="gm-section-title">Save & Load Session</div>
                    <div className="gm-row">
                      <input
                        className="gm-input"
                        style={{ flex: 1 }}
                        value={sessionName}
                        onChange={e => setSessionName(e.target.value)}
                        placeholder={`${currentModuleName} session`}
                      />
                      <button className="gm-btn small success" onClick={() => { if (GMManager.saveSession(sessionName)) setSessionName(''); }}>
                        Save
                      </button>
                      <button className="gm-btn small" onClick={() => sessionFileRef.current?.click()} title="Add a session exported from another browser">
                        Import…
                      </button>
                      <input ref={sessionFileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImportSession} />
                    </div>
                    <div className="gm-hint">
                      Saves the scene, everything you placed, door states and every player character. Players get their saved character back when they join under the same name.
                    </div>
                    <div className="gm-list">
                      {GMManager.getSavedSessions().map(save => (
                        <div key={save.id} className="gm-card">
                          <div className="gm-card-info">
                            <div className="gm-card-title">{save.name}</div>
                            <div className="gm-card-sub">
                              {save.scene.module} • {save.objects.length} objects • {save.players.length} characters • {new Date(save.savedAt).toLocaleString()}
                            </div>
                          </div>
                          <div className="gm-row">
                            <button className="gm-btn small active" onClick={() => GMManager.loadSession(save)}>Load</button>
                            <button className="gm-btn small" onClick={() => downloadSession(save)}>Export</button>
                            <button className="gm-btn small danger" onClick={() => GMManager.deleteSavedSession(save.id)}>Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  </>
                )}
                <div className="gm-hint">
                  <b>Neverwinter Nights-Style GM Hosting:</b> A Game Master can host a live server on port <code>7878</code> (started automatically with <code>npm run dev</code> or standalone via <code>npm run gm:server</code>). Forward TCP port <code>7878</code> (and <code>8080</code> if hosting the web client) on your router so remote players can connect, spawn their Player Characters, and interact with your world in real time!
                </div>

                {GMNetworkManager.role === 'offline' ? (
                  <>
                    <div className="gm-section">
                      <div className="gm-section-title">Host a Game as GM (Dungeon Master)</div>
                      <div className="gm-field">
                        <label>Session Title</label>
                        <input
                          className="gm-input"
                          value={hostSessionName}
                          onChange={e => setHostSessionName(e.target.value)}
                        />
                      </div>
                      <div className="gm-field">
                        <label>WebSocket Relay Bind URL (Port 7878)</label>
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
                        Start Hosting GM Server
                      </button>
                    </div>

                    <div className="gm-section">
                      <div className="gm-section-title">Join a Hosted GM Game as a Player</div>
                      <div className="gm-field">
                        <label>GM Host Address (ws://IP:7878)</label>
                        <input
                          className="gm-input"
                          value={joinUrl}
                          onChange={e => setJoinUrl(e.target.value)}
                          placeholder="ws://192.168.1.50:7878"
                        />
                      </div>
                      <div className="gm-grid-2">
                        <div className="gm-field">
                          <label>Your Character Name</label>
                          <input
                            className="gm-input"
                            value={joinPlayerName}
                            onChange={e => setJoinPlayerName(e.target.value)}
                          />
                        </div>
                        <div className="gm-field">
                          <label>Character Build</label>
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
                        Connect to GM Host & Spawn Player
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="gm-section">
                    <div className="gm-section-title">
                      <span>Active Session: {GMNetworkManager.role.toUpperCase()}</span>
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
                          <button
                            className="gm-btn small active"
                            onClick={() => GMNetworkManager.sendWorldSnapshot()}
                          >
                            Resync Full World Snapshot to Players
                          </button>
                        </div>
                        <div className="gm-field">
                          <label>Connected Players ({GMNetworkManager.peers.size})</label>
                          <div className="gm-list" style={{ maxHeight: 100 }}>
                            {Array.from(GMNetworkManager.peers.values()).map(peer => (
                              <div key={peer.peerId} className="gm-card">
                                <div className="gm-card-info">
                                  <div className="gm-card-title">{peer.name}</div>
                                  <div className="gm-card-sub">Peer ID: {peer.peerId} • Actor: {peer.controlledNetId || 'Spawning'}</div>
                                </div>
                                {peer.controlledNetId && GMManager.netIdMap.get(peer.controlledNetId) && (
                                  <button
                                    className="gm-btn small"
                                    onClick={() => {
                                      const obj = GMManager.netIdMap.get(peer.controlledNetId!);
                                      if (obj) {
                                        GMManager.selectObject(obj);
                                        setDrawerTab('inspector');
                                      }
                                    }}
                                  >
                                    Inspect PC
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="gm-section">
                  <div className="gm-section-title">Session Chat & DM Broadcast Log</div>
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
                      placeholder="Send message / DM announcement..."
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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

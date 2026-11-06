import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import * as KotOR from "@/apps/game/KotOR";
import { BitWise } from "@/utility/BitWise";
// Types only: the game bundle must use the engine library's single GMManager instance via the KotOR external,
// otherwise webpack bundles a second copy of the whole engine into game.js
import type {
  GMCreatureSpawnConfig,
  GMPlaceableSpawnConfig,
  GMPlaceablePropCategory,
  GMPlayerSpawnConfig,
  GMSceneBlueprint,
  GMToolMode
} from "@/managers/GMManager";

const { GMManager, GMNetworkManager } = KotOR;
import "@/apps/game/components/gm-panel/gm-panel.scss";

type DrawerTab = 'scenes' | 'builder' | 'actors' | 'players' | 'inspector' | 'multiplayer' | null;

export const GMPanel: React.FC = () => {
  const [, setTick] = useState(0);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('builder');
  const [showQuickJoinOnMenu, setShowQuickJoinOnMenu] = useState(false);

  // Scene tab states
  const [planetFilter, setPlanetFilter] = useState<string>('All');
  const [sceneSearch, setSceneSearch] = useState<string>('');
  const [customModuleResRef, setCustomModuleResRef] = useState<string>('danm14aa');
  const [keepCreatures, setKeepCreatures] = useState<boolean>(GMManager.keepDefaultCreatures);
  const [keepTriggers, setKeepTriggers] = useState<boolean>(GMManager.keepDefaultTriggers);
  const [keepPlaceables, setKeepPlaceables] = useState<boolean>(GMManager.keepDefaultPlaceables);
  const [preserveParty, setPreserveParty] = useState<boolean>(GMManager.preservePartyOnWarp);

  // Scene Builder (Office, Temple, etc.) tab states
  const [blueprintBgModule, setBlueprintBgModule] = useState<string>('danm14aa');
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
  const [creatureCfg, setCreatureCfg] = useState<GMCreatureSpawnConfig>({ ...GMManager.pendingCreatureConfig });
  const [placeableCfg, setPlaceableCfg] = useState<GMPlaceableSpawnConfig>({ ...GMManager.pendingPlaceableConfig, scale: 1.0, zOffset: 0 });
  const [customLootResRef, setCustomLootResRef] = useState<string>('g_i_medeqpmnt01');

  // Players tab states
  const [playerCfg, setPlayerCfg] = useState<GMPlayerSpawnConfig>({ ...GMManager.pendingPlayerConfig });
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

  const forceUpdate = () => setTick(t => t + 1);

  useEffect(() => {
    const onGMChange = () => {
      if (GMManager.selectedObject) {
        setInspectorBarkInput((GMManager.selectedObject as any).gmBarkText || '');
      }
      forceUpdate();
    };
    const onNetChange = () => forceUpdate();

    GMManager.events.addEventListener('change', onGMChange);
    GMNetworkManager.events.addEventListener('change', onNetChange);

    const interval = setInterval(() => {
      if (KotOR.GameState.gmMode || showQuickJoinOnMenu) {
        forceUpdate();
      }
    }, 350);

    const onKeyDown = (e: KeyboardEvent) => {
      if (!KotOR.GameState.gmMode) return;
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
      } else if (e.key === 'Escape' && GMManager.activeTool !== 'select') {
        GMManager.setToolMode('select');
      } else if (GMManager.activeTool !== 'select' && (e.key === 'q' || e.key === 'Q')) {
        GMManager.placementYawOffset = (GMManager.placementYawOffset - 45 + 360) % 360;
        forceUpdate();
      } else if (GMManager.activeTool !== 'select' && (e.key === 'e' || e.key === 'E')) {
        GMManager.placementYawOffset = (GMManager.placementYawOffset + 45) % 360;
        forceUpdate();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      GMManager.events.removeEventListener('change', onGMChange);
      GMNetworkManager.events.removeEventListener('change', onNetChange);
      clearInterval(interval);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showQuickJoinOnMenu]);

  // Sync pending spawn configs with GMManager for click-to-place in 3D viewport
  const updateCreatureCfg = (patch: Partial<GMCreatureSpawnConfig>) => {
    const next = { ...creatureCfg, ...patch };
    setCreatureCfg(next);
    GMManager.pendingCreatureConfig = next;
  };

  const updatePlaceableCfg = (patch: Partial<GMPlaceableSpawnConfig>) => {
    const next = { ...placeableCfg, ...patch };
    setPlaceableCfg(next);
    GMManager.pendingPlaceableConfig = next;
  };

  const updatePlayerCfg = (patch: Partial<GMPlayerSpawnConfig>) => {
    const next = { ...playerCfg, ...patch };
    setPlayerCfg(next);
    GMManager.pendingPlayerConfig = next;
  };

  const isGMMode = !!KotOR.GameState.gmMode;

  // Quick launcher shown on Main Menu before GM Mode is entered
  if (!isGMMode) {
    return (
      <div className="gm-panel-root">
        <div className="gm-Menu-Launcher">
          <button
            className="gm-btn active"
            onClick={() => {
              GMManager.loadScene('danm14aa', { keepCreatures: false, keepTriggers: false });
            }}
          >
            Enter GM Mode
          </button>
          <button
            className="gm-btn warning"
            onClick={() => setShowQuickJoinOnMenu(!showQuickJoinOnMenu)}
          >
            Join Multiplayer Server
          </button>
        </div>

        {showQuickJoinOnMenu && (
          <div className="gm-drawer" style={{ position: 'fixed', top: 44, right: 12, margin: 0 }}>
            <div className="gm-drawer-header">
              <span>Join GM Multiplayer Server (NWN Client)</span>
              <button className="gm-btn small" onClick={() => setShowQuickJoinOnMenu(false)}>✕</button>
            </div>
            <div className="gm-drawer-body">
              <div className="gm-hint">
                Connect to a Game Master hosting on your LAN or a port-forwarded machine (default port <code>7878</code>).
                Your client will automatically load the GM&apos;s active scene and spawn your chosen Player Character!
              </div>
              <div className="gm-field">
                <label>GM Server WebSocket URL (or IP:Port)</label>
                <input
                  className="gm-input"
                  value={joinUrl}
                  onChange={e => setJoinUrl(e.target.value)}
                  placeholder="ws://192.168.1.50:7878"
                />
              </div>
              <div className="gm-field">
                <label>Your Player Character Name</label>
                <input
                  className="gm-input"
                  value={joinPlayerName}
                  onChange={e => setJoinPlayerName(e.target.value)}
                />
              </div>
              <div className="gm-field">
                <label>Character Archetype & Loadout</label>
                <select
                  className="gm-select"
                  value={joinPresetIdx}
                  onChange={e => setJoinPresetIdx(Number(e.target.value))}
                >
                  {GMManager.PLAYER_PRESETS.map((p, i) => (
                    <option key={i} value={i}>{p.name} (Lv.{p.level}, HP {p.hp})</option>
                  ))}
                </select>
              </div>
              <button
                className="gm-btn success"
                onClick={() => {
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
                  setDrawerTab('multiplayer');
                }}
              >
                Connect & Enter World
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const currentModuleName = KotOR.GameState.module?.filename || 'Loading...';
  const currentArea = KotOR.GameState.module?.area;
  const currentLeader = KotOR.GameState.getCurrentPlayer();
  const selectedObj = GMManager.selectedObject;

  const planets = ['All', ...Array.from(new Set(GMManager.CURATED_MODULES.map(m => m.planet)))];
  const filteredCuratedModules = GMManager.CURATED_MODULES.filter(m => {
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

  return (
    <div className="gm-panel-root">
      {/* Top NWN-Style Dungeon Master / GM Toolbar */}
      <div className="gm-topbar">
        <div className="gm-topbar-group">
          <span className="gm-badge">GM Mode</span>
          <span className="gm-badge" title="Active Scene Module">
            Scene: {currentModuleName}
          </span>
          {GMNetworkManager.role !== 'offline' && (
            <span className={`gm-badge ${GMNetworkManager.role}`}>
              {GMNetworkManager.role === 'host'
                ? `Hosting (${GMNetworkManager.peers.size} Players)`
                : `Client (${GMNetworkManager.connected ? 'Connected' : 'Connecting'})`}
            </span>
          )}

          {/* Drawer Tab Buttons */}
          <button
            className={`gm-btn ${drawerTab === 'builder' ? 'active' : ''}`}
            onClick={() => setDrawerTab(drawerTab === 'builder' ? null : 'builder')}
          >
            Scene Builder (Office / Temple)
          </button>
          <button
            className={`gm-btn ${drawerTab === 'scenes' ? 'active' : ''}`}
            onClick={() => setDrawerTab(drawerTab === 'scenes' ? null : 'scenes')}
          >
            Scenes
          </button>
          <button
            className={`gm-btn ${drawerTab === 'actors' ? 'active' : ''}`}
            onClick={() => setDrawerTab(drawerTab === 'actors' ? null : 'actors')}
          >
            Place Actors & Props
          </button>
          <button
            className={`gm-btn ${drawerTab === 'players' ? 'active' : ''}`}
            onClick={() => setDrawerTab(drawerTab === 'players' ? null : 'players')}
          >
            Players & Party ({GMManager.spawnedPlayers.length})
          </button>
          <button
            className={`gm-btn ${drawerTab === 'inspector' ? 'active' : ''}`}
            onClick={() => setDrawerTab(drawerTab === 'inspector' ? null : 'inspector')}
          >
            World Inspector {selectedObj ? `[${selectedObj.getName() || 'Selected'}]` : ''}
          </button>
          <button
            className={`gm-btn ${drawerTab === 'multiplayer' ? 'active' : ''}`}
            onClick={() => setDrawerTab(drawerTab === 'multiplayer' ? null : 'multiplayer')}
          >
            Multiplayer (NWN)
          </button>
        </div>

        {/* Viewport Tool & Camera/Possess Mode Controls */}
        <div className="gm-topbar-group">
          <button
            className={`gm-btn small ${GMManager.activeTool === 'select' ? 'active' : ''}`}
            onClick={() => GMManager.setToolMode('select')}
            title="Click objects in 3D scene to inspect; double-click creatures to possess"
          >
            Cursor: Select
          </button>
          <button
            className={`gm-btn small ${GMManager.activeTool === 'place_creature' ? 'warning active' : ''}`}
            onClick={() => GMManager.setToolMode(GMManager.activeTool === 'place_creature' ? 'select' : 'place_creature')}
            title="Click anywhere on the 3D ground to place the current Creature"
          >
            + Click-Place Actor
          </button>
          <button
            className={`gm-btn small ${GMManager.activeTool === 'place_placeable' ? 'warning active' : ''}`}
            onClick={() => GMManager.setToolMode(GMManager.activeTool === 'place_placeable' ? 'select' : 'place_placeable')}
            title="Click anywhere on the 3D ground to place the current Placeable/Container"
          >
            + Click-Place Object
          </button>
          <button
            className={`gm-btn small ${GMManager.activeTool === 'teleport' ? 'warning active' : ''}`}
            onClick={() => GMManager.setToolMode(GMManager.activeTool === 'teleport' ? 'select' : 'teleport')}
            title="Click anywhere on the 3D ground to teleport the selected object or player"
          >
            Click-Teleport
          </button>

          {/* Toggle Free Camera vs Possess Character */}
          {GMManager.controlMode === 'FREECAM' ? (
            <button
              className="gm-btn success"
              onClick={async () => {
                let target =
                  (selectedObj && BitWise.InstanceOf(selectedObj.objectType, KotOR.ModuleObjectType.ModuleCreature)
                    ? (selectedObj as KotOR.ModuleCreature)
                    : null) ||
                  currentLeader ||
                  GMManager.spawnedPlayers[0];
                if (!target) {
                  target = await GMManager.spawnPlayerCharacter(playerCfg);
                }
                if (target) GMManager.possessCharacter(target);
              }}
              title="Possess active Player Character (or selected Creature) to walk, fight, open doors, and loot containers (Hotkey: F2)"
            >
              Possess Character (Play Mode)
            </button>
          ) : (
            <button
              className="gm-btn warning"
              onClick={() => GMManager.enterFreeCamera(true)}
              title="Unpossess character and return to GM Free-Roam Camera (Hotkey: F2)"
            >
              GM Free Camera (Controlling: {currentLeader?.getName() || 'Player'})
            </button>
          )}

          <button
            className={`gm-btn small ${GMManager.worldPaused ? 'danger' : ''}`}
            onClick={() => {
              GMManager.worldPaused = !GMManager.worldPaused;
              forceUpdate();
            }}
          >
            {GMManager.worldPaused ? 'AI Paused' : 'AI Running'}
          </button>
        </div>
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
                        <option value="danm14aa">Dantooine Courtyard — Default Open Stage (danm14aa)</option>
                        {GMManager.CURATED_MODULES.map(m => (
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
                        className={`gm-card ${currentModuleName === mod.resRef ? 'selected' : ''}`}
                        onClick={() =>
                          GMManager.loadScene(mod.resRef, {
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
                      <div className="gm-section-title">Quick Creature / NPC Presets</div>
                      <div className="gm-list" style={{ maxHeight: 165 }}>
                        {GMManager.CREATURE_PRESETS.map((preset, idx) => (
                          <div
                            key={idx}
                            className={`gm-card ${creatureCfg.name === preset.name ? 'selected' : ''}`}
                            onClick={() => updateCreatureCfg({ ...preset })}
                          >
                            <div className="gm-card-info">
                              <div className="gm-card-title">{preset.name}</div>
                              <div className="gm-card-sub">
                                {preset.factionId === 1 ? 'Hostile' : preset.factionId === 2 ? 'Friendly' : 'Neutral'} • HP {preset.hp} • App #{preset.appearanceId}
                              </div>
                            </div>
                            <div className="gm-row">
                              <button
                                className="gm-btn small success"
                                onClick={async e => {
                                  e.stopPropagation();
                                  updateCreatureCfg({ ...preset });
                                  const c = await GMManager.spawnCreature(preset);
                                  if (c) GMManager.selectObject(c);
                                }}
                              >
                                Spawn
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="gm-section">
                      <div className="gm-section-title">Customize Creature Before Spawning</div>
                      <div className="gm-grid-2">
                        <div className="gm-field">
                          <label>Name</label>
                          <input
                            className="gm-input"
                            value={creatureCfg.name}
                            onChange={e => updateCreatureCfg({ name: e.target.value })}
                          />
                        </div>
                        <div className="gm-field">
                          <label>Faction (AI Attitude)</label>
                          <select
                            className="gm-select"
                            value={creatureCfg.factionId}
                            onChange={e => updateCreatureCfg({ factionId: Number(e.target.value) })}
                          >
                            <option value={1}>Hostile (Attacks Players)</option>
                            <option value={2}>Friendly (Ally / Talkable)</option>
                            <option value={5}>Neutral (Bystander / Talkable)</option>
                            <option value={0}>Party Faction</option>
                          </select>
                        </div>
                      </div>

                      <div className="gm-grid-3">
                        <div className="gm-field">
                          <label>Appearance ID</label>
                          <input
                            type="number"
                            className="gm-input"
                            value={creatureCfg.appearanceId}
                            onChange={e => updateCreatureCfg({ appearanceId: Number(e.target.value), templateResRef: '' })}
                          />
                        </div>
                        <div className="gm-field">
                          <label>Hit Points (HP)</label>
                          <input
                            type="number"
                            className="gm-input"
                            value={creatureCfg.hp}
                            onChange={e => updateCreatureCfg({ hp: Number(e.target.value) })}
                          />
                        </div>
                        <div className="gm-field">
                          <label>Level</label>
                          <input
                            type="number"
                            className="gm-input"
                            value={creatureCfg.level}
                            onChange={e => updateCreatureCfg({ level: Number(e.target.value) })}
                          />
                        </div>
                      </div>

                      <div className="gm-field">
                        <label>Browse Appearance (appearance.2da)</label>
                        <select
                          className="gm-select"
                          value={creatureCfg.appearanceId}
                          onChange={e => updateCreatureCfg({ appearanceId: Number(e.target.value), templateResRef: '' })}
                        >
                          {GMManager.getAvailableAppearanceOptions().map(opt => (
                            <option key={opt.id} value={opt.id}>{opt.label}</option>
                          ))}
                        </select>
                      </div>

                      <div className="gm-grid-2">
                        <div className="gm-field">
                          <label>Right-Hand Weapon</label>
                          <select
                            className="gm-select"
                            value={creatureCfg.rightHandResRef || ''}
                            onChange={e => updateCreatureCfg({ rightHandResRef: e.target.value })}
                          >
                            {GMManager.WEAPON_OPTIONS.map(w => (
                              <option key={w.resRef} value={w.resRef}>{w.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="gm-field">
                          <label>Armor / Clothing</label>
                          <select
                            className="gm-select"
                            value={creatureCfg.armorResRef || ''}
                            onChange={e => updateCreatureCfg({ armorResRef: e.target.value })}
                          >
                            {GMManager.ARMOR_OPTIONS.map(a => (
                              <option key={a.resRef} value={a.resRef}>{a.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="gm-field">
                        <label>Custom Dialogue / Bark Line (spoken when clicked by player)</label>
                        <input
                          className="gm-input"
                          value={creatureCfg.barkText || ''}
                          onChange={e => updateCreatureCfg({ barkText: e.target.value })}
                          placeholder="e.g. Halt! None shall pass!"
                        />
                      </div>

                      <div className="gm-row">
                        <button
                          className="gm-btn success"
                          style={{ flex: 1 }}
                          onClick={async () => {
                            const c = await GMManager.spawnCreature(creatureCfg);
                            if (c) GMManager.selectObject(c);
                          }}
                        >
                          Spawn at Camera Target
                        </button>
                        <button
                          className={`gm-btn warning ${GMManager.activeTool === 'place_creature' ? 'active' : ''}`}
                          style={{ flex: 1 }}
                          onClick={() =>
                            GMManager.setToolMode(GMManager.activeTool === 'place_creature' ? 'select' : 'place_creature')
                          }
                        >
                          {GMManager.activeTool === 'place_creature' ? 'Click 3D Ground to Place (Active)' : 'Arm 3D Click-to-Place'}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="gm-section">
                      <div className="gm-section-title">
                        <span>Categorized Architectural &amp; Prop Palette</span>
                        <button
                          className="gm-btn small"
                          onClick={() => setDrawerTab('builder')}
                        >
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
                            className={`gm-card ${placeableCfg.name === preset.name ? 'selected' : ''}`}
                            onClick={() =>
                              updatePlaceableCfg({
                                ...preset,
                                scale: preset.scale ?? 1.0,
                                zOffset: preset.zOffset ?? 0,
                                lootResRefs: [...(preset.lootResRefs || [])]
                              })
                            }
                          >
                            <div className="gm-card-info">
                              <div className="gm-card-title">
                                {preset.name} <span className="gm-badge" style={{ marginLeft: 4 }}>{preset.category}</span>
                              </div>
                              <div className="gm-card-sub">
                                {preset.hasInventory ? `Container (${preset.lootResRefs.length} items)` : 'Prop / Interactive'} • Scale {(preset.scale ?? 1.0).toFixed(2)}x • {preset.locked ? `Locked (DC ${preset.openLockDC})` : 'Unlocked'}
                              </div>
                            </div>
                            <div className="gm-row">
                              <button
                                className="gm-btn small success"
                                onClick={async e => {
                                  e.stopPropagation();
                                  const next = {
                                    ...preset,
                                    scale: preset.scale ?? 1.0,
                                    zOffset: preset.zOffset ?? 0,
                                    lootResRefs: [...(preset.lootResRefs || [])]
                                  };
                                  updatePlaceableCfg(next);
                                  const plc = await GMManager.spawnPlaceable(next);
                                  if (plc) GMManager.selectObject(plc);
                                }}
                              >
                                Spawn
                              </button>
                              <button
                                className="gm-btn small warning"
                                onClick={e => {
                                  e.stopPropagation();
                                  updatePlaceableCfg({
                                    ...preset,
                                    scale: preset.scale ?? 1.0,
                                    zOffset: preset.zOffset ?? 0,
                                    lootResRefs: [...(preset.lootResRefs || [])]
                                  });
                                  GMManager.setToolMode('place_placeable');
                                }}
                              >
                                Click-Place
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="gm-section">
                      <div className="gm-section-title">Architectural Placement Controls (Grid Snap, Rotation, Scale &amp; Elevation)</div>
                      <div className="gm-grid-3">
                        <div className="gm-field">
                          <label>Grid Snap</label>
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
                          <label>Scale ({(placeableCfg.scale ?? 1.0).toFixed(2)}x)</label>
                          <select
                            className="gm-select"
                            value={placeableCfg.scale ?? 1.0}
                            onChange={e => updatePlaceableCfg({ scale: Number(e.target.value) })}
                          >
                            <option value={0.65}>0.65x (Compact / Desktop)</option>
                            <option value={0.85}>0.85x (Small)</option>
                            <option value={1}>1.00x (Standard)</option>
                            <option value={1.2}>1.20x (Large)</option>
                            <option value={1.4}>1.40x (Grand)</option>
                            <option value={1.75}>1.75x (Monumental Pillar/Statue)</option>
                            <option value={2.25}>2.25x (Colossal)</option>
                          </select>
                        </div>
                        <div className="gm-field">
                          <label>Vertical Z-Offset ({(placeableCfg.zOffset ?? 0).toFixed(2)}m)</label>
                          <select
                            className="gm-select"
                            value={placeableCfg.zOffset ?? 0}
                            onChange={e => updatePlaceableCfg({ zOffset: Number(e.target.value) })}
                          >
                            <option value={0}>0.00m (Floor Level)</option>
                            <option value={0.65}>+0.65m (On Desk / Table)</option>
                            <option value={0.9}>+0.90m (On Counter / Altar)</option>
                            <option value={1.15}>+1.15m (Stacked Crate Tier 2)</option>
                            <option value={2.2}>+2.20m (Elevated Wall / Upper Tier)</option>
                          </select>
                        </div>
                      </div>

                      <div className="gm-field">
                        <label>Placement Yaw Rotation Offset: {GMManager.placementYawOffset}° (Hotkeys: Q / E while placing)</label>
                        <div className="gm-row">
                          {([0, 45, 90, 135, 180, 225, 270, 315] as const).map(deg => (
                            <button
                              key={deg}
                              className={`gm-btn small ${GMManager.placementYawOffset === deg ? 'active' : ''}`}
                              onClick={() => {
                                GMManager.placementYawOffset = deg;
                                forceUpdate();
                              }}
                            >
                              {deg}°
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="gm-section">
                      <div className="gm-section-title">Customize Placeable / Container Properties</div>
                      <div className="gm-grid-2">
                        <div className="gm-field">
                          <label>Object Name</label>
                          <input
                            className="gm-input"
                            value={placeableCfg.name}
                            onChange={e => updatePlaceableCfg({ name: e.target.value })}
                          />
                        </div>
                        <div className="gm-field">
                          <label>Placeable Appearance (placeables.2da)</label>
                          <select
                            className="gm-select"
                            value={placeableCfg.appearanceId}
                            onChange={e => updatePlaceableCfg({ appearanceId: Number(e.target.value), modelKeywords: undefined })}
                          >
                            {GMManager.getAvailablePlaceableAppearances().map(opt => (
                              <option key={opt.id} value={opt.id}>{opt.label}</option>
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
                          Interactive (Useable)
                        </label>
                        <label className="gm-checkbox">
                          <input
                            type="checkbox"
                            checked={placeableCfg.hasInventory}
                            onChange={e => updatePlaceableCfg({ hasInventory: e.target.checked })}
                          />
                          Lootable Container
                        </label>
                        <label className="gm-checkbox">
                          <input
                            type="checkbox"
                            checked={placeableCfg.locked}
                            onChange={e => updatePlaceableCfg({ locked: e.target.checked })}
                          />
                          Locked
                        </label>
                      </div>

                      {placeableCfg.hasInventory && (
                        <div className="gm-field">
                          <label>Starter Loot Items ({placeableCfg.lootResRefs.join(', ') || 'Empty'})</label>
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
                              onClick={() =>
                                updatePlaceableCfg({
                                  lootResRefs: [...placeableCfg.lootResRefs, customLootResRef]
                                })
                              }
                            >
                              + Add Item
                            </button>
                            <button
                              className="gm-btn small danger"
                              onClick={() => updatePlaceableCfg({ lootResRefs: [] })}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="gm-field">
                        <label>On-Use Message / Terminal Readout</label>
                        <input
                          className="gm-input"
                          value={placeableCfg.barkText || ''}
                          onChange={e => updatePlaceableCfg({ barkText: e.target.value })}
                          placeholder="Optional message shown when player uses object"
                        />
                      </div>

                      <div className="gm-row">
                        <button
                          className="gm-btn success"
                          style={{ flex: 1 }}
                          onClick={async () => {
                            const plc = await GMManager.spawnPlaceable(placeableCfg);
                            if (plc) GMManager.selectObject(plc);
                          }}
                        >
                          Spawn at Camera Target
                        </button>
                        <button
                          className={`gm-btn warning ${GMManager.activeTool === 'place_placeable' ? 'active' : ''}`}
                          style={{ flex: 1 }}
                          onClick={() =>
                            GMManager.setToolMode(GMManager.activeTool === 'place_placeable' ? 'select' : 'place_placeable')
                          }
                        >
                          {GMManager.activeTool === 'place_placeable' ? 'Click 3D Ground to Place (Active)' : 'Arm 3D Click-to-Place'}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* ==================== TAB 3: PLAYERS & PARTY ==================== */}
            {drawerTab === 'players' && (
              <>
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
                            Lv.{preset.level} • HP {preset.hp} • FP {preset.fp} • STR {preset.str} DEX {preset.dex} WIS {preset.wis}
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
                      <label>HP</label>
                      <input
                        type="number"
                        className="gm-input"
                        value={playerCfg.hp}
                        onChange={e => updatePlayerCfg({ hp: Number(e.target.value) })}
                      />
                    </div>
                    <div className="gm-field">
                      <label>Force Points</label>
                      <input
                        type="number"
                        className="gm-input"
                        value={playerCfg.fp}
                        onChange={e => updatePlayerCfg({ fp: Number(e.target.value) })}
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
                      <button
                        className="gm-btn active"
                        onClick={() => {
                          const p = GMManager.PLAYER_PRESETS[joinPresetIdx] || GMManager.PLAYER_PRESETS[0];
                          GMNetworkManager.joinSession(joinUrl, joinPlayerName, {
                            name: joinPlayerName,
                            appearanceId: p.appearanceId,
                            classId: p.classId,
                            rightHandResRef: p.rightHandResRef,
                            armorResRef: p.armorResRef
                          });
                        }}
                      >
                        Connect to GM Host & Spawn Player
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="gm-section">
                    <div className="gm-section-title">
                      <span>Active Session: {GMNetworkManager.role.toUpperCase()}</span>
                      <button className="gm-btn small danger" onClick={() => GMNetworkManager.disconnect()}>
                        Disconnect
                      </button>
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

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const noopEvents = () => ({ addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn() });

const mockKotOR: any = {
  EngineMode: { INGAME: 1, GUI: 0 },
  GameEngineType: { KOTOR: 1, TSL: 2 },
  GMFaction: { HOSTILE: 1, FRIENDLY: 2, NEUTRAL: 0 },
  ABILITIES: ["str", "dex", "con", "int", "wis", "cha"],
  gmFactionName: (id: number) => (id === 1 ? "Hostile" : id === 2 ? "Friendly" : "Neutral"),
  GMObjectKind: {
    isCreature: (o: any) => !!o?.isCreatureFlag,
    isPlayer: (o: any) => !!o?.isPlayerFlag,
    isPlaceable: (o: any) => !!o?.isPlaceableFlag,
  },
  IngameControls: { isTypingInPageField: () => false },
  GameState: {
    gmMode: false,
    Mode: 1,
    GameKey: 1,
    getCurrentPlayer: jest.fn((): any => null),
    CursorManager: { selectedObject: null as any, hoveredObject: null as any },
    PartyManager: { party: [] as any[] },
    TwoDAManager: { datatables: new Map() },
    module: { filename: "danm14aa", area: { creatures: [] as any[], placeables: [] as any[] } },
  },
  GMManager: {
    active: false,
    ruleset: "kotor",
    setRuleset: jest.fn(),
    controlMode: "FREECAM",
    activeTool: "select",
    lastPlacementTool: "place_creature",
    worldPaused: false,
    npcAiEnabled: true,
    playersFrozen: false,
    selectedObject: null as any,
    selection: [] as any[],
    selectedObjects: jest.fn((): any[] => []),
    spawnedPlayers: [] as any[],
    wheelHolds: new Set<string>(),
    events: noopEvents(),
    isGMUser: jest.fn(() => true),
    isDeletable: jest.fn(() => false),
    isSelected: jest.fn(() => false),
    isPresetAvailable: jest.fn(() => true),
    isPlayerFrozen: jest.fn(() => false),
    attackTargetOf: jest.fn(() => undefined),
    setToolMode: jest.fn(),
    selectObject: jest.fn(),
    setSelection: jest.fn(),
    pointOf: (o: any) => o?.position || { x: 0, y: 0, z: 0 },
    CREATURE_PRESETS: [{ id: "sith", name: "Sith Trooper", label: "Sith Trooper", resref: "n_sithtroop", hp: 30 }],
    PLACEABLE_PRESETS: [{ id: "crate", name: "Crate", label: "Crate", modelName: "plc_crate" }],
    pendingCreatureConfig: { name: "Sith Trooper" },
    pendingPlaceableConfig: { name: "Crate" },
    pendingPlayerConfig: { name: "Padawan" },
    selectedCreaturePreset: { name: "Sith Trooper", label: "Sith Trooper" },
    selectedPlaceablePreset: { label: "Crate" },
    selectedDoorResRef: "",
    selectedTriggerResRef: "",
    selectedEncounterResRef: "",
  },
  GMNetworkManager: {
    role: "offline",
    joinState: "idle",
    joinError: "",
    serverUrl: "ws://localhost:7878",
    peers: new Map(),
    pendingPrompts: [] as any[],
    sessionRules: { deathRule: "kotor", tacticalPause: { enabled: false, holdCount: 0, holders: [] } },
    events: noopEvents(),
    disconnect: jest.fn(),
    answerPrompt: jest.fn(),
    requestRespawn: jest.fn(),
  },
  GMConversationManager: { conversations: new Map(), activeList: jest.fn((): any[] => []), events: noopEvents() },
  GMNpcOrders: { getOrder: jest.fn(() => undefined), describe: jest.fn(() => ""), GUARD_RADIUS: 4 },
  GMChecks: {
    SKILL_NAMES: ["Computer Use", "Demolitions", "Stealth"],
    shownRolls: jest.fn((): any[] => []),
    checkBonus: jest.fn(() => 3),
  },
  GMMines: {},
  GMSetPieces: {},
  GMRoomNames: {},
  GMPlayers: {
    RESPAWN_DELAY_SECONDS: 10,
    creationLimits: {},
    levelUpOnHost: jest.fn(),
  },
  GMPlayerRequests: { roll: jest.fn(), levelUp: jest.fn() },
  GMCharacters: { list: jest.fn((): any[] => []) },
  GMSessions: {},
  GMSpawner: {
    loadCreatureTemplateIndex: jest.fn(async () => []),
    copyCreaturePreset: (p: any) => ({ ...p }),
    copyPlaceablePreset: (p: any) => ({ ...p }),
  },
  GMViewport: {
    isPlacementTool: (t: string) => t.startsWith("place_"),
    isOrderTool: (t: string) => t.startsWith("order_"),
    getTeleportTarget: jest.fn(() => null),
    placementYawOffset: 0,
    patrolDraft: [] as any[],
    orderSubject: null as any,
    placementLabel: () => "",
  },
  GMHistory: { undoStack: [] as any[], redoStack: [] as any[], canUndo: () => false, canRedo: () => false, nameOf: () => "Actor", undo: jest.fn(), redo: jest.fn() },
  GMEditTools: { placeHidden: false, focusCamera: jest.fn() },
  GMAtmosphere: {},
  GMCutscene: {
    active: false,
    caption: "",
    FRAME_ASPECT: 2.39,
    savedShots: jest.fn((): [number, any][] => []),
    nextFreeShot: jest.fn(() => 1),
    toggle: jest.fn(),
  },
  GMPlayerHud: {
    active: jest.fn(() => false),
    player: jest.fn((): any => null),
    abilities: jest.fn((): any[] => []),
    orderForTarget: jest.fn((a: any) => a),
    loadout: jest.fn((): string[] => []),
    landsOn: jest.fn(() => ({ text: "Target", side: "enemy", title: "Lands on target" })),
    relation: jest.fn(() => "enemy"),
    targetActions: jest.fn((): any[] => []),
    queued: jest.fn((): any[] => []),
    heldBy: jest.fn((): string[] => []),
    selected: jest.fn((): any => null),
    target: jest.fn((): any => null),
    currentAction: jest.fn((): any => null),
    stealth: jest.fn(() => ({ can: true, on: false })),
    lastNotice: null as any,
    setWheelOpen: jest.fn(),
    pacing: jest.fn((): any => undefined),
    planning: jest.fn(() => false),
    plannedMove: null as any,
    readySent: false,
    planSecondsLeftNow: jest.fn((): any => undefined),
    setReady: jest.fn(),
  },
  GMPacing: {
    mode: 'off', phase: 'off', round: 0, timeLimit: 0, showIntents: true, planners: [] as string[],
    state: () => ({ mode: 'off', phase: 'off', round: 0, ready: [] as string[], waiting: [] as string[], timeLimit: 0, showIntents: true }),
    configure: jest.fn(), go: jest.fn(),
  },
  GM_PACING_MODES: [{ id: 'off', label: 'Real time', title: '' }],
  GMCareersCharacters: {
    list: jest.fn((): any[] => []),
    get: jest.fn((): any => undefined),
    listeners: new Set(),
  },
  CareersRules: {
    derive: jest.fn(() => ({ level: 1 })),
  },
  careersRuntimeOf: jest.fn((): any => undefined),
};

jest.mock("@/apps/game/KotOR", () => mockKotOR);

import { possessCandidate } from "@/apps/game/components/gm-panel/gmPanelStore";
import { GMPanel } from "@/apps/game/components/gm-panel/GMPanel";
import { PlayerHud } from "@/apps/game/components/gm-panel/overlays/PlayerHud";
import { DownedBanner } from "@/apps/game/components/gm-panel/overlays/DownedBanner";
import { PromptCard } from "@/apps/game/components/gm-panel/overlays/PromptCard";
import { RollFeed } from "@/apps/game/components/gm-panel/overlays/RollFeed";
import { CombatTracker } from "@/apps/game/components/gm-panel/overlays/CombatTracker";
import { CutsceneOverlay } from "@/apps/game/components/gm-panel/overlays/CutsceneOverlay";
import { QuickPalette } from "@/apps/game/components/gm-panel/overlays/QuickPalette";
import { CharacterSheet } from "@/apps/game/components/gm-panel/sheet/CharacterSheet";

function makeMockCreature(name: string, opts: Record<string, any> = {}): any {
  return {
    id: opts.id ?? name.toLowerCase().replace(/\s+/g, "_"),
    isCreatureFlag: true,
    getName: () => name,
    getTag: () => name.toLowerCase(),
    getHP: () => opts.hp ?? 40,
    getMaxHP: () => opts.maxHp ?? 40,
    getFP: () => opts.fp ?? 20,
    getMaxFP: () => opts.maxFp ?? 20,
    getTotalClassLevel: () => opts.level ?? 4,
    getGoodEvil: () => 60,
    getSTR: () => 14, getDEX: () => 14, getCON: () => 12, getINT: () => 10, getWIS: () => 12, getCHA: () => 10,
    str: 14, dex: 14, con: 12, int: 10, wis: 12, cha: 10,
    getAC: () => 15,
    getBaseAttackBonus: () => 4,
    getFortitudeSave: () => 3, getReflexSave: () => 3, getWillSave: () => 2,
    isDead: () => !!opts.dead,
    canLevelUp: () => false,
    classes: [{ level: opts.level ?? 4, getName: () => "Guardian", spells: [] }],
    skills: [],
    feats: [],
    effects: [],
    equipment: {},
    combatData: { combatState: !!opts.fighting },
    combatRound: { action: null, scheduledActionList: [] },
    ...opts,
  };
}

describe("GM Panel React UI & store", () => {
  beforeEach(() => {
    (globalThis as any).window = { innerWidth: 1280, innerHeight: 800, location: { hostname: "localhost" } };
    mockKotOR.GameState.gmMode = false;
    mockKotOR.GameState.Mode = 1;
    mockKotOR.GameState.getCurrentPlayer.mockReturnValue(null);
    mockKotOR.GameState.CursorManager.selectedObject = null;
    mockKotOR.GameState.module.area.creatures = [];
    mockKotOR.GMManager.active = false;
    mockKotOR.GMManager.selectedObject = null;
    mockKotOR.GMManager.selectedObjects.mockReturnValue([]);
    mockKotOR.GMManager.spawnedPlayers = [];
    mockKotOR.GMManager.controlMode = "FREECAM";
    mockKotOR.GMManager.isGMUser.mockReturnValue(true);
    mockKotOR.GMNetworkManager.role = "offline";
    mockKotOR.GMNetworkManager.pendingPrompts = [];
    mockKotOR.GMNetworkManager.sessionRules.deathRule = "kotor";
    mockKotOR.GMChecks.shownRolls.mockReturnValue([]);
    mockKotOR.GMCutscene.active = false;
    mockKotOR.GMCutscene.caption = "";
    mockKotOR.GMPlayerHud.active.mockReturnValue(false);
    mockKotOR.GMPlayerHud.player.mockReturnValue(null);
    mockKotOR.GMPlayerHud.abilities.mockReturnValue([]);
    mockKotOR.GMPlayerHud.loadout.mockReturnValue([]);
    jest.clearAllMocks();
  });

  test("possessCandidate prioritizes selected creature > current player > spawned player", () => {
    const sel = makeMockCreature("Selected");
    const leader = makeMockCreature("Leader");
    const spawned = makeMockCreature("Spawned");

    expect(possessCandidate()).toBeNull();
    mockKotOR.GMManager.spawnedPlayers = [spawned];
    expect(possessCandidate()).toBe(spawned);
    mockKotOR.GameState.getCurrentPlayer.mockReturnValue(leader);
    expect(possessCandidate()).toBe(leader);
    mockKotOR.GMManager.selectedObject = sel;
    expect(possessCandidate()).toBe(sel);
  });

  test("GMPanel renders GM host workspace with toolbar, controls, and RollFeed", () => {
    mockKotOR.GameState.gmMode = true;
    mockKotOR.GMManager.active = true;
    mockKotOR.GMNetworkManager.role = "host";
    mockKotOR.GMChecks.shownRolls.mockReturnValue([
      { netId: "pc_1", at: 1, name: "Bastila", label: "Persuade", roll: 20, bonus: 6, total: 26 },
    ]);

    const html = renderToStaticMarkup(React.createElement(GMPanel));
    expect(html).toContain("gm-topbar");
    expect(html).toContain("Scene");
    expect(html).toContain("Place");
    expect(html).toContain("Players");
    expect(html).toContain("Inspect");
    expect(html).toContain("Session");
    expect(html).toContain("gm-roll-feed");
    expect(html).toContain("Bastila");
    expect(html).toContain("natural-20");
  });

  test("GMPanel in player view renders PlayerHud, DownedBanner, PromptCard, and CutsceneOverlay", () => {
    const hero = makeMockCreature("Carth", { dead: true, hp: 0, maxHp: 50, fp: 0, maxFp: 0, isPlayerFlag: true });
    mockKotOR.GameState.gmMode = true;
    mockKotOR.GMManager.active = true;
    mockKotOR.GMManager.isGMUser.mockReturnValue(false);
    mockKotOR.GMNetworkManager.role = "client";
    mockKotOR.GMNetworkManager.sessionRules.deathRule = "respawn";
    mockKotOR.GMNetworkManager.pendingPrompts = [
      { promptId: "ask_1", speaker: "Jolee", text: "Open the door?", options: ["Yes", "No"] },
    ];
    mockKotOR.GameState.getCurrentPlayer.mockReturnValue(hero);
    mockKotOR.GMPlayerHud.active.mockReturnValue(true);
    mockKotOR.GMPlayerHud.player.mockReturnValue(hero);
    mockKotOR.GMPlayerHud.abilities.mockReturnValue([
      { key: "attack", kind: "attack", name: "Attack", icon: "", aim: "enemy", cost: 0, usable: true, entry: {} },
    ]);
    mockKotOR.GMPlayerHud.loadout.mockReturnValue(["attack"]);

    const html = renderToStaticMarkup(React.createElement(GMPanel));
    expect(html).toContain("gm-player-hud");
    expect(html).toContain("Carth");
    expect(html).toContain("Skills");
    expect(html).toContain("Powers");
    expect(html).toContain("Items");
    expect(html).toContain("Gear");
    expect(html).toContain("Chat");
    expect(html).toContain("Map");
    expect(html).toContain("Options");
    expect(html).not.toContain(">Character</button>");
    expect(html).not.toContain(">Session</button>");
    expect(html).toContain("gm-downed");
    expect(html).toContain("Respawn at the entrance");
    expect(html).toContain("Open the door?");
    expect(html).toContain("1. Yes");

    // Cutscene watching mode renders widescreen caption for players
    mockKotOR.GMCutscene.active = true;
    mockKotOR.GMCutscene.caption = "Meanwhile on Taris...";
    const cutHtml = renderToStaticMarkup(React.createElement(CutsceneOverlay));
    expect(cutHtml).toContain("gm-cutscene watching");
    expect(cutHtml).toContain("Meanwhile on Taris...");
  });

  test("CombatTracker, QuickPalette, and CharacterSheet render without errors", () => {
    mockKotOR.GameState.gmMode = true;
    const foe = makeMockCreature("Dark Jedi", { fighting: true, factionId: 1, hp: 22, maxHp: 60 });
    const ally = makeMockCreature("Mission", { fighting: true, factionId: 2, hp: 30, maxHp: 30 });
    mockKotOR.GameState.module.area.creatures = [foe, ally];

    const trackerHtml = renderToStaticMarkup(
      React.createElement(CombatTracker, { shown: true, onShownChange: jest.fn() })
    );
    expect(trackerHtml).toContain("gm-tracker");
    expect(trackerHtml).toContain("Dark Jedi");
    expect(trackerHtml).toContain("Mission");

    const paletteHtml = renderToStaticMarkup(
      React.createElement(QuickPalette, {
        open: true,
        point: null,
        onClose: jest.fn(),
        onOpenTab: jest.fn(),
        onToggleTracker: jest.fn(),
      })
    );
    expect(paletteHtml).toContain("gm-palette");
    expect(paletteHtml).toContain("Open Scene");

    const sheetHtml = renderToStaticMarkup(
      React.createElement(CharacterSheet, { creature: ally, initialSection: "overview", gmView: true, onClose: jest.fn() })
    );
    expect(sheetHtml).toContain("Character sheet");
    expect(sheetHtml).toContain("Mission");

    // Empty overlays return null cleanly
    mockKotOR.GMNetworkManager.pendingPrompts = [];
    mockKotOR.GameState.getCurrentPlayer.mockReturnValue(null);
    mockKotOR.GMChecks.shownRolls.mockReturnValue([]);
    expect(renderToStaticMarkup(React.createElement(PromptCard))).toBe("");
    expect(renderToStaticMarkup(React.createElement(DownedBanner))).toBe("");
    expect(renderToStaticMarkup(React.createElement(RollFeed))).toBe("");
  });
});

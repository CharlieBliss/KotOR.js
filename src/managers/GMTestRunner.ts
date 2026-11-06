import * as THREE from 'three';
import { GameState } from '../GameState';
import { EngineMode } from '../enums/engine/EngineMode';
import { ModuleCreatureArmorSlot } from '../enums/module/ModuleCreatureArmorSlot';
import { OdysseyModel3D } from '../three/odyssey';
import { GMManager, GMSceneBlueprint } from './GMManager';
import { GMNetworkManager } from './GMNetworkManager';

export interface GMAssertionResult {
  name: string;
  passed: boolean;
  detail?: string;
  failurePoint?: string;
  stack?: string;
}

export interface GMTestSuiteResult {
  id: string;
  title: string;
  status: 'passed' | 'failed' | 'running' | 'skipped';
  durationMs: number;
  assertions: GMAssertionResult[];
  error?: string;
  stack?: string;
}

export interface GMRawRuntimeError {
  timestamp: string;
  source: 'window.onerror' | 'unhandledrejection' | 'console.error' | 'test_runner';
  message: string;
  stack?: string;
  context: {
    gmMode: boolean;
    engineMode: number;
    moduleName: string;
    controlMode: string;
    activeTool: string;
    selectedObjectName: string;
  };
}

export interface GMDiagnosticReport {
  generatedAt: string;
  summary: {
    totalSuites: number;
    passedSuites: number;
    failedSuites: number;
    totalAssertions: number;
    passedAssertions: number;
    failedAssertions: number;
    runtimeErrorCount: number;
    overallStatus: 'PASS' | 'FAIL';
    totalDurationMs: number;
  };
  environment: {
    userAgent: string;
    url: string;
    gmMode: boolean;
    engineMode: number;
    moduleName: string;
    areaName: string;
    roomCount: number;
    creatureCount: number;
    placeableCount: number;
    doorCount: number;
    partyCount: number;
    walkmeshCount: number;
    networkRole: string;
  };
  failurePoints: {
    suiteId: string;
    assertionName: string;
    failurePoint: string;
    detail: string;
    stack?: string;
  }[];
  suites: GMTestSuiteResult[];
  runtimeErrors: GMRawRuntimeError[];
}

type GMTestListener = () => void;

export class GMTestRunner {
  static isRunning: boolean = false;
  static lastReport: GMDiagnosticReport | null = null;
  static lastDiskSyncStatus: 'idle' | 'syncing' | 'synced' | 'error' = 'idle';
  static lastDiskSyncPath: string = 'gm-diagnostics-report.json';
  static runtimeErrors: GMRawRuntimeError[] = [];
  private static listeners: Set<GMTestListener> = new Set();
  private static errorTrapInitialized: boolean = false;
  private static originalConsoleError: (...args: any[]) => void;

  static subscribe(fn: GMTestListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  static notify() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        // ignore listener errors
      }
    });
  }

  static getEngineContext() {
    return {
      gmMode: !!GameState.gmMode,
      engineMode: GameState.Mode,
      moduleName: GameState.module?.filename || 'none',
      controlMode: GMManager.controlMode,
      activeTool: GMManager.activeTool,
      selectedObjectName: GMManager.selectedObject?.getName?.() || 'none'
    };
  }

  /**
   * Initializes global runtime error & unhandled promise rejection trapping,
   * plus checks URL query parameters (?gm_autotest=1) for hands-free E2E test execution.
   */
  static initErrorTrap() {
    if (this.errorTrapInitialized || typeof window === 'undefined') return;
    this.errorTrapInitialized = true;

    // Expose on window for console/Playwright/DevTools inspection
    (window as any).GMTestRunner = GMTestRunner;
    (window as any).GMManager = GMManager;

    window.addEventListener('error', (event: ErrorEvent) => {
      this.recordRuntimeError(
        'window.onerror',
        event.message || String(event.error || 'Unknown Error'),
        event.error?.stack || `${event.filename || ''}:${event.lineno || 0}:${event.colno || 0}`
      );
    });

    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      const reason: any = event.reason;
      this.recordRuntimeError(
        'unhandledrejection',
        reason?.message || String(reason || 'Unhandled Promise Rejection'),
        reason?.stack
      );
    });

    this.originalConsoleError = console.error.bind(console);
    console.error = (...args: any[]) => {
      this.originalConsoleError(...args);
      try {
        const msg = args
          .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'object' ? JSON.stringify(a) : String(a)))
          .join(' ');
        // Ignore benign missing optional walkmesh or cached template warnings during normal operation
        if (
          msg.includes('OdysseyWalkMesh.FromSidecar') ||
          msg.includes('[GMTestRunner]')
        ) {
          return;
        }
        const errObj = args.find((a) => a instanceof Error) as Error | undefined;
        this.recordRuntimeError('console.error', msg.slice(0, 500), errObj?.stack);
      } catch (e) {
        // ignore
      }
    };

    // Check if ?gm_autotest=1 was passed in the URL
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('gm_autotest') === '1') {
        this.scheduleAutoTestFromURL();
      }
    } catch (e) {
      // ignore
    }
  }

  private static scheduleAutoTestFromURL() {
    let enteredGM = false;
    const poll = setInterval(async () => {
      // If we are on the Main Menu and not yet in GM mode, enter GM mode automatically
      if (!GameState.gmMode && !enteredGM && GameState.MenuManager?.MainMenu && GameState.TwoDAManager?.datatables?.size > 0) {
        enteredGM = true;
        GameState.EnterGMMode('danm14aa');
      }
      // Once the GM scene is loaded and ready, run the full E2E self-test suite
      if (
        GameState.gmMode &&
        GameState.module?.area &&
        GameState.module?.readyToProcessEvents &&
        !GameState.loadingTextures &&
        !this.isRunning
      ) {
        clearInterval(poll);
        await this.runAllTests();
      }
    }, 500);
  }

  static recordRuntimeError(
    source: GMRawRuntimeError['source'],
    message: string,
    stack?: string
  ) {
    // Deduplicate identical consecutive errors
    const last = this.runtimeErrors[0];
    if (last && last.message === message && last.source === source) {
      return;
    }

    const entry: GMRawRuntimeError = {
      timestamp: new Date().toISOString(),
      source,
      message,
      stack,
      context: this.getEngineContext()
    };

    this.runtimeErrors.unshift(entry);
    if (this.runtimeErrors.length > 50) {
      this.runtimeErrors.pop();
    }

    if (this.lastReport) {
      this.lastReport.runtimeErrors = [...this.runtimeErrors];
      this.lastReport.summary.runtimeErrorCount = this.runtimeErrors.length;
      this.syncReportToDisk(this.lastReport);
    }
    this.notify();
  }

  static clearRuntimeErrors() {
    this.runtimeErrors = [];
    this.notify();
  }

  /**
   * Sends the diagnostic report JSON to `/gm-diagnostics/report` (handled by webpack devServer
   * and `scripts/gm-server.js`) so it is written directly to `gm-diagnostics-report.json` on disk.
   */
  static async syncReportToDisk(report: GMDiagnosticReport): Promise<boolean> {
    this.lastDiskSyncStatus = 'syncing';
    this.notify();

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('kotor_gm_last_diagnostic_report', JSON.stringify(report));
      }
    } catch (e) {
      // ignore localStorage quota errors
    }

    const endpoints = [
      '/gm-diagnostics/report',
      'http://localhost:8089/gm-diagnostics/report'
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(report, null, 2)
        });
        if (res.ok) {
          this.lastDiskSyncStatus = 'synced';
          this.notify();
          return true;
        }
      } catch (e) {
        // try next endpoint
      }
    }

    this.lastDiskSyncStatus = 'error';
    this.notify();
    return false;
  }

  /**
   * Downloads the latest diagnostic report as a JSON file in the browser
   */
  static downloadReportJSON() {
    if (!this.lastReport) return;
    const blob = new Blob([JSON.stringify(this.lastReport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gm-diagnostics-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Executes all 8 E2E GM Mode & Engine Integration test suites inside the live running game
   * and writes the structured pass/fail + failure-point report to disk (`gm-diagnostics-report.json`).
   */
  static async runAllTests(): Promise<GMDiagnosticReport> {
    if (this.isRunning) {
      return this.lastReport!;
    }
    this.isRunning = true;
    const overallStart = performance.now();
    const suites: GMTestSuiteResult[] = [];
    this.notify();

    const suiteDefinitions: {
      id: string;
      title: string;
      fn: (assert: (name: string, cond: boolean, failurePoint: string, detail?: string) => void) => Promise<void>;
    }[] = [
      {
        id: 'engine_managers',
        title: '1. Core Engine, Area & Manager Readiness',
        fn: (assert) => this.testEngineAndManagers(assert)
      },
      {
        id: 'placeable_2da_resolver',
        title: '2. 2DA Placeable Appearance Resolver & Prop Library (26 Props + 6 Blueprints)',
        fn: (assert) => this.test2DAAndPlaceableAppearanceResolver(assert)
      },
      {
        id: 'placeable_lifecycle',
        title: '3. Placeable Spawning, 3D Model, Container Looting & Transform Tools',
        fn: (assert) => this.testPlaceableLifecycleAndContainerLoot(assert)
      },
      {
        id: 'creature_lifecycle',
        title: '4. Actor/NPC Spawning, Combat HP/MaxHP, Equipment, Faction & Kill/Heal',
        fn: (assert) => this.testCreatureLifecycleCombatStatsAndEquipment(assert)
      },
      {
        id: 'player_lifecycle',
        title: '5. Player Character Spawning, Feats/Powers, Possession & Free Camera',
        fn: (assert) => this.testPlayerCharacterFeatsForcePowersAndPossession(assert)
      },
      {
        id: 'scene_blueprints',
        title: '6. Scene Blueprint Builder (Office / Temple) & Custom Blueprint Persistence',
        fn: (assert) => this.testSceneBlueprintBuilderAndCustomSave(assert)
      },
      {
        id: 'world_doors_interaction',
        title: '7. Area Doors & World Object Lock/Open State Manipulation',
        fn: (assert) => this.testWorldDoorsAndInteractions(assert)
      },
      {
        id: 'multiplayer_serialization',
        title: '8. NWN Multiplayer Actor Serialization & World Snapshot Sync',
        fn: (assert) => this.testMultiplayerSerializationAndSnapshot(assert)
      }
    ];

    for (const def of suiteDefinitions) {
      const suiteStart = performance.now();
      const assertions: GMAssertionResult[] = [];

      const assert = (name: string, cond: boolean, failurePoint: string, detail?: string) => {
        const stack = !cond ? new Error(`Assertion failed at ${failurePoint}`).stack : undefined;
        assertions.push({
          name,
          passed: !!cond,
          failurePoint: !cond ? failurePoint : undefined,
          detail,
          stack
        });
      };

      let suiteError: string | undefined;
      let suiteStack: string | undefined;

      try {
        await def.fn(assert);
      } catch (err: any) {
        suiteError = err?.message || String(err);
        suiteStack = err?.stack;
        assertions.push({
          name: `Uncaught Exception in ${def.title}`,
          passed: false,
          failurePoint: `${def.id}:uncaught_exception`,
          detail: suiteError,
          stack: suiteStack
        });
      }

      const durationMs = Math.round(performance.now() - suiteStart);
      const anyFailed = assertions.some((a) => !a.passed) || !!suiteError;

      suites.push({
        id: def.id,
        title: def.title,
        status: anyFailed ? 'failed' : 'passed',
        durationMs,
        assertions,
        error: suiteError,
        stack: suiteStack
      });
      this.notify();
    }

    const totalDurationMs = Math.round(performance.now() - overallStart);
    const failurePoints: GMDiagnosticReport['failurePoints'] = [];
    let totalAssertions = 0;
    let passedAssertions = 0;

    for (const s of suites) {
      for (const a of s.assertions) {
        totalAssertions++;
        if (a.passed) {
          passedAssertions++;
        } else {
          failurePoints.push({
            suiteId: s.id,
            assertionName: a.name,
            failurePoint: a.failurePoint || s.id,
            detail: a.detail || s.error || 'Assertion evaluated to false',
            stack: a.stack || s.stack
          });
        }
      }
    }

    const failedSuites = suites.filter((s) => s.status === 'failed').length;
    const passedSuites = suites.filter((s) => s.status === 'passed').length;
    const area = GameState.module?.area;

    const report: GMDiagnosticReport = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalSuites: suites.length,
        passedSuites,
        failedSuites,
        totalAssertions,
        passedAssertions,
        failedAssertions: totalAssertions - passedAssertions,
        runtimeErrorCount: this.runtimeErrors.length,
        overallStatus: failedSuites === 0 ? 'PASS' : 'FAIL',
        totalDurationMs
      },
      environment: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        url: typeof window !== 'undefined' ? window.location.href : 'unknown',
        gmMode: !!GameState.gmMode,
        engineMode: GameState.Mode,
        moduleName: GameState.module?.filename || 'none',
        areaName: area?.getName?.() || area?.name || 'none',
        roomCount: area?.rooms?.length || 0,
        creatureCount: area?.creatures?.length || 0,
        placeableCount: area?.placeables?.length || 0,
        doorCount: area?.doors?.length || 0,
        partyCount: GameState.PartyManager?.party?.length || 0,
        walkmeshCount: GameState.walkmeshList?.length || 0,
        networkRole: GMNetworkManager.role
      },
      failurePoints,
      suites,
      runtimeErrors: [...this.runtimeErrors]
    };

    this.lastReport = report;
    this.isRunning = false;
    await this.syncReportToDisk(report);
    this.notify();
    return report;
  }

  // ===========================================================================
  // Individual E2E Test Suite Implementations
  // ===========================================================================

  private static async testEngineAndManagers(
    assert: (name: string, cond: boolean, failurePoint: string, detail?: string) => void
  ) {
    assert(
      'GameState.gmMode is active',
      GameState.gmMode === true,
      'GameState.gmMode',
      `gmMode=${GameState.gmMode}`
    );
    assert(
      'Active Module & ModuleArea are loaded',
      !!GameState.module && !!GameState.module.area,
      'GameState.module.area',
      `module=${GameState.module?.filename || 'null'}`
    );
    assert(
      'Area has loaded 3D rooms',
      (GameState.module?.area?.rooms?.length || 0) > 0,
      'ModuleArea.rooms',
      `rooms=${GameState.module?.area?.rooms?.length || 0}`
    );
    assert(
      'TwoDAManager & placeables.2da / appearance.2da are loaded',
      !!GameState.TwoDAManager?.datatables?.get('placeables') &&
        !!GameState.TwoDAManager?.datatables?.get('appearance'),
      'GameState.TwoDAManager.datatables',
      'placeables.2da and appearance.2da present'
    );
    assert(
      'Active Three.js Camera & Scene groups exist',
      !!GMManager.getActiveThreeCamera() &&
        !!GameState.group?.creatures &&
        !!GameState.group?.placeables &&
        !!GameState.group?.party,
      'GameState.group',
      'Camera and creatures/placeables/party scene groups initialized'
    );
  }

  private static async test2DAAndPlaceableAppearanceResolver(
    assert: (name: string, cond: boolean, failurePoint: string, detail?: string) => void
  ) {
    const allAppearances = GMManager.getAvailablePlaceableAppearances();
    assert(
      'placeables.2da yields valid placeable appearances',
      allAppearances.length > 10,
      'GMManager.getAvailablePlaceableAppearances',
      `count=${allAppearances.length}`
    );

    // Check all 26 CATEGORIZED_PROPS
    let brokenProps: string[] = [];
    for (const prop of GMManager.CATEGORIZED_PROPS) {
      const resolvedId = GMManager.resolvePlaceableAppearanceId(prop.modelKeywords, prop.appearanceId);
      const row = GameState.AppearanceManager?.GetPlaceableAppearanceById(resolvedId);
      const modelName = row?.modelname?.replace(/\0[\s\S]*$/g, '').trim();
      if (!row || !modelName || modelName === '****') {
        brokenProps.push(`${prop.name} (id=${resolvedId})`);
      }
    }
    assert(
      `All ${GMManager.CATEGORIZED_PROPS.length} Categorized Props resolve to valid 3D model names in placeables.2da`,
      brokenProps.length === 0,
      'GMManager.CATEGORIZED_PROPS->resolvePlaceableAppearanceId',
      brokenProps.length === 0 ? 'All props valid' : `Invalid props: ${brokenProps.join(', ')}`
    );

    // Check all 6 SCENE_BLUEPRINTS
    let brokenBlueprintItems: string[] = [];
    for (const bp of GMManager.SCENE_BLUEPRINTS) {
      for (const item of bp.items) {
        const resolvedId = GMManager.resolvePlaceableAppearanceId(item.config.modelKeywords, item.config.appearanceId);
        const row = GameState.AppearanceManager?.GetPlaceableAppearanceById(resolvedId);
        const modelName = row?.modelname?.replace(/\0[\s\S]*$/g, '').trim();
        if (!row || !modelName || modelName === '****') {
          brokenBlueprintItems.push(`${bp.id}:${item.config.name} (id=${resolvedId})`);
        }
      }
    }
    assert(
      `All items across ${GMManager.SCENE_BLUEPRINTS.length} Scene Blueprints (Office, Temple, etc.) resolve to valid 3D models`,
      brokenBlueprintItems.length === 0,
      'GMManager.SCENE_BLUEPRINTS->resolvePlaceableAppearanceId',
      brokenBlueprintItems.length === 0
        ? 'All blueprint items valid'
        : `Invalid blueprint items: ${brokenBlueprintItems.join(', ')}`
    );
  }

  private static async testPlaceableLifecycleAndContainerLoot(
    assert: (name: string, cond: boolean, failurePoint: string, detail?: string) => void
  ) {
    const spawnPos = new THREE.Vector3(
      (GameState.module?.entryX || 0) + 2.0,
      (GameState.module?.entryY || 0) + 2.0,
      GameState.module?.entryZ || 0
    );

    const plc = await GMManager.spawnPlaceable(
      {
        name: 'Diag Test Footlocker',
        appearanceId: 52,
        modelKeywords: ['plc_footlker', 'footlker'],
        scale: 1.0,
        useable: true,
        hasInventory: true,
        locked: true,
        openLockDC: 18,
        lootResRefs: ['g_i_medeqpmnt01', 'g_w_lghtsbr01'],
        barkText: 'Diagnostic Container Bark'
      },
      spawnPos,
      0
    );

    assert(
      'GMManager.spawnPlaceable creates and attaches ModulePlaceable',
      !!plc && GameState.module.area.placeables.includes(plc),
      'GMManager.spawnPlaceable',
      `id=${plc?.id}, name=${plc?.getName()}`
    );

    if (!plc) return;

    try {
      assert(
        'Placeable 3D OdysseyModel3D loaded into container',
        plc.model instanceof OdysseyModel3D && plc.container.children.includes(plc.model),
        'ModulePlaceable.loadModel',
        `model=${plc.model?.name || 'null'}`
      );

      assert(
        'Placeable locked state and DC match config',
        plc.isLocked() === true && plc.openLockDC === 18,
        'ModulePlaceable.isLocked',
        `locked=${plc.isLocked()}, dc=${plc.openLockDC}`
      );

      const inv = plc.getInventory();
      assert(
        'Container inventory populated with 2 ModuleItems',
        inv.length === 2,
        'GMManager.addItemToObjectAsync',
        `inventory.length=${inv.length}`
      );

      const validStacksAndNames = inv.every(
        (item) => item.getStackSize() >= 1 && typeof item.getName() === 'string' && item.getName().length > 0
      );
      assert(
        'Every container ModuleItem has stackSize >= 1 and non-crashing getName()',
        validStacksAndNames,
        'ModuleItem.getStackSize / ModuleItem.getLocalizedName',
        inv.map((i) => `${i.getName()}(x${i.getStackSize()}, baseItem=${i.baseItemId})`).join(', ')
      );

      // Test Lock toggling
      GMManager.toggleDoorOrPlaceableLock(plc);
      assert(
        'GMManager.toggleDoorOrPlaceableLock unlocks locked placeable',
        plc.isLocked() === false,
        'GMManager.toggleDoorOrPlaceableLock (unlock)'
      );
      GMManager.toggleDoorOrPlaceableLock(plc);
      assert(
        'GMManager.toggleDoorOrPlaceableLock re-locks unlocked placeable',
        plc.isLocked() === true,
        'GMManager.toggleDoorOrPlaceableLock (lock)'
      );

      // Test retrieveInventory() transfers items into InventoryManager
      plc.setLocked(false);
      plc.retrieveInventory();
      assert(
        'ModulePlaceable.retrieveInventory() empties container into party inventory without stackSize bug',
        plc.getInventory().length === 0,
        'ModulePlaceable.retrieveInventory',
        `remaining=${plc.getInventory().length}`
      );

      // Test Scale & Nudge
      GMManager.setObjectScale(plc, 1.75);
      assert(
        'GMManager.setObjectScale updates container scale and gmScale metadata',
        Math.abs(plc.container.scale.x - 1.75) < 0.001 && (plc as any).gmScale === 1.75,
        'GMManager.setObjectScale',
        `scale=${plc.container.scale.x}`
      );

      const beforeX = plc.position.x;
      GMManager.nudgeObjectPosition(plc, 1.25, -0.5, 0.5);
      assert(
        'GMManager.nudgeObjectPosition translates object XYZ coordinates',
        Math.abs(plc.position.x - (beforeX + 1.25)) < 0.001,
        'GMManager.nudgeObjectPosition',
        `pos=(${plc.position.x.toFixed(2)}, ${plc.position.y.toFixed(2)}, ${plc.position.z.toFixed(2)})`
      );

      // Test Duplicate
      const cloned = await GMManager.duplicateObject(plc);
      assert(
        'GMManager.duplicateObject clones placeable with scale and offset position',
        !!cloned && cloned !== plc && (cloned as any).gmScale === 1.75,
        'GMManager.duplicateObject (placeable)',
        `clonedId=${cloned?.id}`
      );
      if (cloned) {
        GMManager.deleteObject(cloned);
      }
    } finally {
      GMManager.deleteObject(plc);
      assert(
        'GMManager.deleteObject removes placeable from ModuleArea',
        !GameState.module.area.placeables.includes(plc),
        'GMManager.deleteObject (placeable)'
      );
    }
  }

  private static async testCreatureLifecycleCombatStatsAndEquipment(
    assert: (name: string, cond: boolean, failurePoint: string, detail?: string) => void
  ) {
    const spawnPos = new THREE.Vector3(
      (GameState.module?.entryX || 0) - 2.0,
      (GameState.module?.entryY || 0) + 2.0,
      GameState.module?.entryZ || 0
    );

    const cre = await GMManager.spawnCreature(
      {
        name: 'Diag Sith Trooper',
        templateResRef: 'n_sithtrooper',
        appearanceId: 28,
        factionId: 1,
        hp: 85,
        level: 6,
        classId: 0,
        rightHandResRef: 'g_w_blstrrfl001',
        barkText: 'Halt!'
      },
      spawnPos,
      0
    );

    assert(
      'GMManager.spawnCreature creates and attaches ModuleCreature',
      !!cre && GameState.module.area.creatures.includes(cre),
      'GMManager.spawnCreature',
      `id=${cre?.id}, name=${cre?.getName()}`
    );

    if (!cre) return;

    try {
      assert(
        'Creature custom name, HP, MaxHP, and FactionID are preserved after creature.load()',
        cre.getHP() === 85 && cre.getMaxHP() === 85 && cre.factionId === 1 && cre.getName().includes('Diag Sith Trooper'),
        'GMManager.spawnCreature->setCreatureHP',
        `hp=${cre.getHP()}/${cre.getMaxHP()}, faction=${cre.factionId}, name=${cre.getName()}`
      );

      assert(
        'Creature 3D OdysseyModel3D loaded',
        cre.model instanceof OdysseyModel3D,
        'ModuleCreature.loadModel',
        `model=${cre.model?.name || 'null'}`
      );

      // Test Faction Change
      GMManager.setObjectFaction(cre, 2);
      assert(
        'GMManager.setObjectFaction updates creature factionId to Neutral (2)',
        cre.factionId === 2,
        'GMManager.setObjectFaction',
        `factionId=${cre.factionId}`
      );

      // Test Equip Weapon
      await GMManager.equipWeaponOnCreature(cre, ModuleCreatureArmorSlot.RIGHTHAND, 'g_w_blstrpstl001');
      assert(
        'GMManager.equipWeaponOnCreature equips weapon in RIGHTHAND slot without throwing',
        !!cre.equipment.RIGHTHAND,
        'GMManager.equipWeaponOnCreature',
        `rightHand=${cre.equipment.RIGHTHAND?.getEquippedRes() || 'none'}`
      );

      // Test Kill & Heal
      GMManager.killObject(cre);
      assert(
        'GMManager.killObject sets creature getHP() to 0 and isDead() to true',
        cre.getHP() <= 0 && cre.isDead() === true,
        'GMManager.killObject (creature)',
        `hp=${cre.getHP()}, isDead=${cre.isDead()}`
      );

      GMManager.healObject(cre);
      assert(
        'GMManager.healObject restores creature getHP() to getMaxHP() (85) and revives creature',
        cre.getHP() === 85 && cre.isDead() === false,
        'GMManager.healObject (creature)',
        `hp=${cre.getHP()}/${cre.getMaxHP()}, isDead=${cre.isDead()}`
      );
    } finally {
      GMManager.deleteObject(cre);
      assert(
        'GMManager.deleteObject removes creature from ModuleArea',
        !GameState.module.area.creatures.includes(cre),
        'GMManager.deleteObject (creature)'
      );
    }
  }

  private static async testPlayerCharacterFeatsForcePowersAndPossession(
    assert: (name: string, cond: boolean, failurePoint: string, detail?: string) => void
  ) {
    const priorControlMode = GMManager.controlMode;
    const priorLeader = GameState.PartyManager.party[0];

    const spawnPos = new THREE.Vector3(
      (GameState.module?.entryX || 0) + 1.0,
      (GameState.module?.entryY || 0) - 1.5,
      GameState.module?.entryZ || 0
    );

    const player = await GMManager.spawnPlayerCharacter(
      {
        name: 'Diag Jedi Guardian',
        appearanceId: 136,
        portraitId: 15,
        gender: 0,
        classId: 3,
        level: 10,
        hp: 140,
        fp: 120,
        str: 16,
        dex: 16,
        con: 14,
        int: 14,
        wis: 16,
        cha: 14,
        rightHandResRef: 'g_w_lghtsbr01',
        leftHandResRef: '',
        armorResRef: 'g_a_jedirobe01',
        featIds: [1, 3, 28, 53],
        spellIds: [9, 17, 29],
        possessImmediately: false
      },
      spawnPos,
      0
    );

    assert(
      'GMManager.spawnPlayerCharacter creates ModulePlayer',
      !!player,
      'GMManager.spawnPlayerCharacter',
      `id=${player?.id}, name=${player?.getName()}`
    );

    if (!player) return;

    try {
      assert(
        'Player HP & MaxHP match config (140/140)',
        player.getHP() === 140 && player.getMaxHP() === 140,
        'GMManager.spawnPlayerCharacter->setCreatureHP',
        `hp=${player.getHP()}/${player.getMaxHP()}`
      );

      assert(
        'Player has configured Feats (e.g. Master Flurry feat 28) & Force Powers',
        player.getHasFeat(28) === true && (player.classes?.[0]?.spells?.length || 0) >= 3,
        'GMManager.spawnPlayerCharacter (feats & spells)',
        `hasFeat28=${player.getHasFeat(28)}, spells=${player.classes?.[0]?.spells?.length || 0}`
      );

      // Test Possession
      GMManager.possessCharacter(player);
      assert(
        'GMManager.possessCharacter switches engine to EngineMode.INGAME and sets party leader',
        GMManager.controlMode === 'POSSESS' &&
          GameState.Mode === EngineMode.INGAME &&
          GameState.getCurrentPlayer() === player,
        'GMManager.possessCharacter',
        `controlMode=${GMManager.controlMode}, engineMode=${GameState.Mode}`
      );

      // Test Return to Free Camera
      GMManager.enterFreeCamera(false);
      assert(
        'GMManager.enterFreeCamera switches engine back to EngineMode.FREELOOK',
        GMManager.controlMode === 'FREECAM' && GameState.Mode === EngineMode.FREELOOK,
        'GMManager.enterFreeCamera',
        `controlMode=${GMManager.controlMode}, engineMode=${GameState.Mode}`
      );
    } finally {
      GMManager.deleteObject(player);
      if (priorControlMode === 'POSSESS' && priorLeader && priorLeader !== player) {
        GMManager.possessCharacter(priorLeader);
      } else {
        GMManager.enterFreeCamera(false);
      }
    }
  }

  private static async testSceneBlueprintBuilderAndCustomSave(
    assert: (name: string, cond: boolean, failurePoint: string, detail?: string) => void
  ) {
    const area = GameState.module?.area;
    if (!area) return;

    const beforePlaceableCount = area.placeables.length;
    const beforeCreatureCount = area.creatures.length;

    const miniBlueprint: GMSceneBlueprint = {
      id: 'diag_mini_office',
      title: 'Diag Mini Office',
      category: 'Office / Urban',
      description: 'Diagnostic test blueprint',
      recommendedModule: GameState.module.filename || 'danm14aa',
      items: [
        {
          dx: 3.0,
          dy: 3.0,
          dz: 0,
          yawDeg: 0,
          config: {
            name: 'Diag Executive Desk',
            appearanceId: 65,
            modelKeywords: ['plc_desk', 'desk', 'table'],
            scale: 1.15,
            useable: false,
            hasInventory: false,
            locked: false,
            openLockDC: 15,
            lootResRefs: []
          }
        },
        {
          dx: 4.5,
          dy: 3.0,
          dz: 0,
          yawDeg: 90,
          config: {
            name: 'Diag Office Terminal',
            appearanceId: 58,
            modelKeywords: ['plc_comp', 'comp', 'panel'],
            scale: 1.0,
            useable: true,
            hasInventory: false,
            locked: false,
            openLockDC: 15,
            lootResRefs: [],
            barkText: 'Terminal Online.'
          }
        }
      ],
      creatures: [
        {
          dx: 3.5,
          dy: 4.0,
          dz: 0,
          yawDeg: 180,
          config: {
            name: 'Diag Office Clerk',
            appearanceId: 12,
            factionId: 2,
            hp: 45,
            level: 3,
            classId: 2,
            barkText: 'Welcome!'
          }
        }
      ]
    };

    await GMManager.spawnBlueprintInCurrentArea(miniBlueprint, {
      useCameraTargetAsOrigin: false,
      clearExistingPlaceables: false,
      spawnNPCs: true
    });

    const spawnedPlcs = area.placeables.filter((p) => p.getName()?.startsWith('Diag '));
    const spawnedCres = area.creatures.filter((c) => c.getName()?.startsWith('Diag '));

    assert(
      'GMManager.spawnBlueprintInCurrentArea spawns all blueprint placeables and NPCs',
      spawnedPlcs.length === 2 && spawnedCres.length === 1,
      'GMManager.spawnBlueprintInCurrentArea',
      `spawnedPlcs=${spawnedPlcs.length} (expected 2), spawnedCres=${spawnedCres.length} (expected 1)`
    );

    // Save current scene as custom blueprint
    const savedBp = GMManager.saveCurrentSceneAsBlueprint('Diag Saved Blueprint', 'Diagnostic test save');
    assert(
      'GMManager.saveCurrentSceneAsBlueprint serializes current scene into custom blueprint',
      !!savedBp && savedBp.items.length >= 2,
      'GMManager.saveCurrentSceneAsBlueprint',
      `savedBpId=${savedBp?.id}, items=${savedBp?.items?.length || 0}`
    );

    if (savedBp) {
      const jsonStr = JSON.stringify(savedBp);
      GMManager.deleteCustomBlueprint(savedBp.id);
      const reimported = GMManager.importCustomBlueprintFromJSON(jsonStr);
      assert(
        'GMManager.importCustomBlueprintFromJSON & deleteCustomBlueprint round-trip cleanly',
        !!reimported && reimported.title === 'Diag Saved Blueprint',
        'GMManager.importCustomBlueprintFromJSON'
      );
      if (reimported) {
        GMManager.deleteCustomBlueprint(reimported.id);
      }
    }

    // Cleanup blueprint test entities
    for (const p of spawnedPlcs) GMManager.deleteObject(p);
    for (const c of spawnedCres) GMManager.deleteObject(c);

    assert(
      'Blueprint test entities cleaned up cleanly',
      area.placeables.length === beforePlaceableCount && area.creatures.length === beforeCreatureCount,
      'GMManager.deleteObject (blueprint cleanup)'
    );
  }

  private static async testWorldDoorsAndInteractions(
    assert: (name: string, cond: boolean, failurePoint: string, detail?: string) => void
  ) {
    const doors = GameState.module?.area?.doors || [];
    if (doors.length === 0) {
      assert(
        'Area door check (no doors in current module, skipped cleanly)',
        true,
        'ModuleArea.doors',
        '0 doors in this area'
      );
      return;
    }

    const door = doors[0];
    const origLocked = door.isLocked();
    GMManager.toggleDoorOrPlaceableLock(door);
    const toggledLocked = door.isLocked();
    GMManager.toggleDoorOrPlaceableLock(door);

    assert(
      'GMManager.toggleDoorOrPlaceableLock toggles ModuleDoor lock state and restores cleanly',
      toggledLocked === !origLocked && door.isLocked() === origLocked,
      'GMManager.toggleDoorOrPlaceableLock (door)',
      `door=${door.getName() || door.getTag()}, origLocked=${origLocked}`
    );
  }

  private static async testMultiplayerSerializationAndSnapshot(
    assert: (name: string, cond: boolean, failurePoint: string, detail?: string) => void
  ) {
    const pos = new THREE.Vector3(
      (GameState.module?.entryX || 0) + 1.5,
      (GameState.module?.entryY || 0) + 1.5,
      GameState.module?.entryZ || 0
    );

    const cre = await GMManager.spawnCreature(
      {
        name: 'Diag Net Actor',
        appearanceId: 28,
        factionId: 1,
        hp: 95,
        level: 5,
        classId: 0
      },
      pos,
      0.5
    );

    if (!cre) {
      assert('Spawn actor for serialization test', false, 'GMManager.spawnCreature');
      return;
    }

    try {
      const serialized = GMManager.serializeSingleActor(cre);
      assert(
        'GMManager.serializeSingleActor captures netId, coordinates, HP/MaxHP, and faction',
        !!serialized.netId &&
          serialized.hp === 95 &&
          serialized.maxHp === 95 &&
          serialized.factionId === 1 &&
          Math.abs(serialized.x - pos.x) < 0.01,
        'GMManager.serializeSingleActor',
        `netId=${serialized.netId}, hp=${serialized.hp}/${serialized.maxHp}`
      );

      // Simulate network update via spawnOrUpdateFromSerialized
      serialized.hp = 40;
      serialized.x = pos.x + 2.0;
      await GMManager.spawnOrUpdateFromSerialized(serialized);

      assert(
        'GMManager.spawnOrUpdateFromSerialized updates existing actor HP (40/95) and position accurately',
        cre.getHP() === 40 && cre.getMaxHP() === 95 && Math.abs(cre.position.x - (pos.x + 2.0)) < 0.01,
        'GMManager.spawnOrUpdateFromSerialized',
        `cre.getHP()=${cre.getHP()}, pos.x=${cre.position.x.toFixed(2)}`
      );

      const snapshot = GMManager.buildWorldSnapshot();
      assert(
        'GMManager.buildWorldSnapshot produces valid GMWorldSnapshot with actors and moduleResRef',
        snapshot.moduleResRef === GameState.module.filename &&
          Array.isArray(snapshot.actors) &&
          snapshot.actors.some((a) => a.netId === serialized.netId),
        'GMManager.buildWorldSnapshot',
        `module=${snapshot.moduleResRef}, actors=${snapshot.actors.length}, doors=${snapshot.doors.length}`
      );
    } finally {
      GMManager.deleteObject(cre);
    }
  }
}

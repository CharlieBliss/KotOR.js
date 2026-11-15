import React, { useEffect, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { ItemOptions, SkillOptions } from "@/apps/game/components/gm-panel/controls/options";
// Types only: the game bundle must use the engine library's single GM managers via the KotOR external
import type { GMCreatureSpawnConfig, GMCreatureTemplateInfo, GMPlaceableSpawnConfig, GMPlaceablePropCategory, GMSceneBlueprint } from "@/managers/GMManager";
import {
  GMManager, GMChecks, GMMines, GMSessions, GMSpawner, GMViewport, useGMStore,
} from "@/apps/game/components/gm-panel/gmPanelStore";

/** Place tab: what the Place tool puts down (creatures, objects, mines), kits, and encounters */
export const ActorsTab: React.FC<{ active: boolean }> = React.memo(({ active }) => {
  const forceUpdate = useGMStore(active);
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
  const [spawnSubTab, setSpawnSubTab] = useState<'creatures' | 'placeables' | 'kits'>('placeables');
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
  const [placeableCfg, setPlaceableCfg] = useState<GMPlaceableSpawnConfig>(() => GMSpawner.copyPlaceablePreset(GMManager.pendingPlaceableConfig));
  const [customLootResRef, setCustomLootResRef] = useState<string>('g_i_medeqpmnt01');
  const [encounterPreset, setEncounterPreset] = useState<number>(0);
  const [encounterCount, setEncounterCount] = useState<number>(3);
  const [encounterSpread, setEncounterSpread] = useState<number>(2.5);
  const [encounterFaction, setEncounterFaction] = useState<number>(1);
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
      GMSpawner.describeCreatureTemplate(creaturePick.templateResRef).then((info) => { if (live) setCreatureTemplateInfo(info); });
    }
    return () => { live = false; };
  }, [creaturePick]);
  // The template browser reads every template the first time it opens
  useEffect(() => {
    if (spawnSubTab !== 'creatures' || creatureSource !== 'templates' || templateIndex) return;
    let live = true;
    GMSpawner.loadCreatureTemplateIndex().then((list) => { if (live) setTemplateIndex(list); });
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
    } : { appearanceId: GMSpawner.resolveCreatureAppearance(creatureCfg), appearanceLabel: undefined });
  };
  const factionName = KotOR.gmFactionName;
  // Only the Customize section edits the object; everything it changes marks it customized
  const updatePlaceableCfg = (patch: Partial<GMPlaceableSpawnConfig>) => {
    const next = { ...placeableCfg, ...patch, customized: true };
    setPlaceableCfg(next);
    GMManager.pendingPlaceableConfig = next;
  };
  /** Pick a preset: place exactly it, with nothing carried over from the previous pick */
  const selectPlaceablePreset = (preset: GMPlaceableSpawnConfig) => {
    const next = GMSpawner.copyPlaceablePreset(preset);
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
      appearanceId: GMSpawner.resolvePlaceableAppearance(placeableCfg),
      appearanceLabel: undefined,
      modelKeywords: undefined,
    });
  };
  const curatedModules = GMManager.getCuratedModules();

  return (
    <>
      <div className="gm-row">
        <button
          className={`gm-btn ${spawnSubTab === 'creatures' ? 'active' : ''}`}
          style={{ flex: 1 }}
          onClick={() => setSpawnSubTab('creatures')}
          title="Creatures and NPCs"
        >
          Creatures
        </button>
        <button
          className={`gm-btn ${spawnSubTab === 'placeables' ? 'active' : ''}`}
          style={{ flex: 1 }}
          onClick={() => setSpawnSubTab('placeables')}
          title="Props, containers and mines"
        >
          Objects
        </button>
        <button
          className={`gm-btn ${spawnSubTab === 'kits' ? 'active' : ''}`}
          style={{ flex: 1 }}
          onClick={() => setSpawnSubTab('kits')}
          title="Whole sets placed at once: an office, a temple, a command centre... and your own saved layouts"
        >
          Kits
        </button>
      </div>

      {/* Kits: whole sets of props (and NPCs) placed at once */}
      {spawnSubTab === 'kits' && (() => {
        const savedKits = GMSessions.getSavedCustomBlueprints();
        const kits = [
          ...GMManager.SCENE_BLUEPRINTS.map((bp) => ({ bp, saved: false })),
          ...savedKits.map((bp) => ({ bp, saved: true })),
        ];
        const buildHere = (bp: GMSceneBlueprint) => GMSpawner.buildSceneBlueprint(bp, {
          loadCleanBackgroundFirst: false,
          clearExistingPlaceables: blueprintClearExisting,
          spawnNPCs: blueprintSpawnNPCs,
          useCameraTargetAsOrigin: blueprintOriginMode === 'camera',
        });
        const buildOnNewStage = (bp: GMSceneBlueprint, saved: boolean) => GMSpawner.buildSceneBlueprint(bp, {
          loadCleanBackgroundFirst: true,
          backgroundModuleResRef: saved ? (bp.recommendedModule || blueprintBgModule) : blueprintBgModule,
          clearExistingPlaceables: true,
          spawnNPCs: blueprintSpawnNPCs,
          useCameraTargetAsOrigin: false,
        });
        return (
          <>
            <div className="gm-section">
              <div className="gm-section-title">
                <span>Kits ({kits.length})</span>
              </div>
              <div className="gm-list" style={{ maxHeight: 320 }}>
                {kits.map(({ bp, saved }) => (
                  <div key={bp.id} className="gm-card" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                    <div className="gm-card-info">
                      <div className="gm-card-title">
                        {bp.title} <span className="gm-badge" style={{ marginLeft: 4 }}>{saved ? 'saved' : `${bp.items.length} props`}</span>
                      </div>
                      <div className="gm-card-sub" style={{ whiteSpace: 'normal', lineHeight: 1.35, marginTop: 3 }}>{bp.description}</div>
                    </div>
                    <div className="gm-row" style={{ flexDirection: 'column', alignItems: 'stretch', minWidth: 100 }}>
                      <button
                        className="gm-btn small active"
                        onClick={() => buildHere(bp)}
                        title={`Build it in this scene, ${blueprintOriginMode === 'camera' ? 'where the camera looks' : 'at the scene entry'}`}
                      >
                        Build here
                      </button>
                      <button
                        className="gm-btn small"
                        onClick={() => buildOnNewStage(bp, saved)}
                        title={`Load an empty ${saved ? (bp.recommendedModule || blueprintBgModule) : blueprintBgModule} and build it there`}
                      >
                        New stage
                      </button>
                      {saved && (
                        <div className="gm-row">
                          <button className="gm-btn small" title="Copy this kit as JSON, to share it" onClick={() => navigator.clipboard?.writeText(JSON.stringify(bp))}>Copy</button>
                          <button className="gm-btn small danger" title="Delete this saved kit" onClick={() => { GMSessions.deleteCustomBlueprint(bp.id); forceUpdate(); }}>✕</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <details className="gm-section">
              <summary>Kit options <span className="gm-summary-note">{blueprintOriginMode === 'camera' ? 'at the camera' : 'at the entry'}{blueprintSpawnNPCs ? ', with NPCs' : ''}</span></summary>
              <div className="gm-grid-2">
                <div className="gm-field">
                  <label>"Build here" puts it</label>
                  <select className="gm-select" value={blueprintOriginMode} onChange={e => setBlueprintOriginMode(e.target.value as 'entry' | 'camera')}>
                    <option value="entry">At the scene entry</option>
                    <option value="camera">Where the camera looks</option>
                  </select>
                </div>
                <div className="gm-field">
                  <label>"New stage" loads</label>
                  <select className="gm-select" value={blueprintBgModule} onChange={e => setBlueprintBgModule(e.target.value)}>
                    <option value={GMManager.defaultSceneModule()}>Default open stage ({GMManager.defaultSceneModule()})</option>
                    {curatedModules.map(m => (
                      <option key={m.resRef} value={m.resRef}>{m.planet} — {m.title}</option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="gm-checkbox">
                <input type="checkbox" checked={blueprintSpawnNPCs} onChange={e => setBlueprintSpawnNPCs(e.target.checked)} />
                Include the kit's NPCs (receptionist, guardian, commander...)
              </label>
              <label className="gm-checkbox">
                <input type="checkbox" checked={blueprintClearExisting} onChange={e => setBlueprintClearExisting(e.target.checked)} />
                "Build here" first clears the props already placed
              </label>
              <div className="gm-row">
                <button className="gm-btn small warning" onClick={() => GMManager.clearDefaultAreaPlaceables()} title="Remove the area's own crates and containers, keeping what you placed">
                  Clear the area's props
                </button>
                <button className="gm-btn small danger" onClick={() => GMManager.clearGMSpawnedPlaceables()} title="Remove every prop you placed">
                  Clear my props
                </button>
              </div>
            </details>

            <details className="gm-section" open={showJsonImportBox}>
              <summary>Save this scene as a kit</summary>
              <div className="gm-grid-2">
                <div className="gm-field">
                  <label>Name</label>
                  <input className="gm-input" value={customBlueprintTitle} onChange={e => setCustomBlueprintTitle(e.target.value)} placeholder="e.g. Coruscant detective office" />
                </div>
                <div className="gm-field">
                  <label>Description</label>
                  <input className="gm-input" value={customBlueprintDesc} onChange={e => setCustomBlueprintDesc(e.target.value)} placeholder="What it's for" />
                </div>
              </div>
              <button
                className="gm-btn active"
                onClick={() => { GMSessions.saveCurrentSceneAsBlueprint(customBlueprintTitle, customBlueprintDesc); forceUpdate(); }}
                title="Saves every prop and NPC you placed here as a kit you can build anywhere"
              >
                Save as kit
              </button>
              <div className="gm-field">
                <label>Or import a kit (JSON copied from "Copy")</label>
                <div className="gm-row">
                  <input className="gm-input" style={{ flex: 1 }} value={importBlueprintJson} onChange={e => setImportBlueprintJson(e.target.value)} placeholder='{"title":"My Scene","items":[...]}' />
                  <button
                    className="gm-btn small success"
                    disabled={!importBlueprintJson.trim()}
                    onClick={() => {
                      if (GMSessions.importCustomBlueprintFromJSON(importBlueprintJson)) {
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
            </details>
          </>
        );
      })()}

      {spawnSubTab === 'kits' ? null : spawnSubTab === 'creatures' ? (
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
              onClick={() => GMSpawner.spawnEncounter({ presetIndex: encounterPreset, count: encounterCount, spread: encounterSpread, factionId: encounterFaction })}
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
                            onClick={() => selectCreature(GMSpawner.creatureConfigFromTemplate(t))}
                          >
                            <div className="gm-card-info">
                              <div className="gm-card-title">{t.name} <span className="gm-badge" style={{ marginLeft: 4 }}>{t.resRef}</span></div>
                              <div className="gm-card-sub">{factionName(t.factionId)} • {t.classes || 'No class'} • HP {t.hp}{t.fp ? ` • FP ${t.fp}` : ''}</div>
                            </div>
                            <button
                              className="gm-btn small warning"
                              onClick={e => {
                                e.stopPropagation();
                                selectCreature(GMSpawner.creatureConfigFromTemplate(t));
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
                <>Built by class: {GMManager.getAvailableAppearanceOptions().find(o => o.id === GMSpawner.resolveCreatureAppearance(creatureCfg))?.label || `appearance ${creatureCfg.appearanceId}`} • Level {creatureCfg.level} • HP {creatureCfg.hp}</>
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
                  const c = await GMSpawner.spawnCreature(creatureCfg);
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
                    <ItemOptions items={GMManager.WEAPON_OPTIONS} current={creatureCfg.rightHandResRef} />
                  </select>
                </div>
                <div className="gm-field">
                  <label>Armour / clothing</label>
                  <select
                    className="gm-select"
                    value={creatureCfg.armorResRef || ''}
                    onChange={e => customizeCreature({ armorResRef: e.target.value })}
                  >
                    <ItemOptions items={GMManager.ARMOR_OPTIONS} current={creatureCfg.armorResRef} />
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
              Model: {GMSpawner.getPlaceableAppearanceLabel(GMSpawner.resolvePlaceableAppearance(placeableCfg))}
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
                  const plc = await GMSpawner.spawnPlaceable(placeableCfg);
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
                  value={GMMines.pendingMineType}
                  onChange={e => { GMMines.pendingMineType = Number(e.target.value); forceUpdate(); }}
                >
                  {GMMines.getMineTypes().map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
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
                  value={GMViewport.gridSnapSize}
                  onChange={e => {
                    GMViewport.gridSnapSize = Number(e.target.value);
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
                  value={GMViewport.placementYawOffset}
                  onChange={e => {
                    GMViewport.placementYawOffset = Number(e.target.value);
                    forceUpdate();
                  }}
                >
                  {Array.from(new Set([0, 45, 90, 135, 180, 225, 270, 315, GMViewport.placementYawOffset])).sort((a, b) => a - b).map(deg => (
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
                    <SkillOptions />
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
                      <ItemOptions items={GMManager.LOOT_ITEM_OPTIONS} />
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
  );
});

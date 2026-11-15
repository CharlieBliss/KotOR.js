import React, { useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { GMManager, useGMStore } from "@/apps/game/components/gm-panel/gmPanelStore";

/** Scene tab: load an area (this game's or the other's), import a scene plan, and run its beats */
export const ScenesTab: React.FC<{ active: boolean }> = React.memo(({ active }) => {
  const forceUpdate = useGMStore(active);
  // Scene tab states
  const [planetFilter, setPlanetFilter] = useState<string>('All');
  const [sceneSearch, setSceneSearch] = useState<string>('');
  const [customModuleResRef, setCustomModuleResRef] = useState<string>(() => GMManager.defaultSceneModule());
  // The other KotOR game's areas, borrowed as scenes (OtherGameManager)
  const [otherModules, setOtherModules] = useState<string[] | null>(null);
  const [otherStatus, setOtherStatus] = useState<string>('');
  // Scene tab: this game's areas, or the other game's
  const [areaSource, setAreaSource] = useState<'this' | 'other'>('this');
  // A scene plan to import (from the kotor-gm-scenes skill)
  const [planJson, setPlanJson] = useState<string>('');
  const [planProblems, setPlanProblems] = useState<KotOR.GMPlanProblem[]>([]);
  const [planImporting, setPlanImporting] = useState<boolean>(false);
  const [keepCreatures, setKeepCreatures] = useState<boolean>(GMManager.keepDefaultCreatures);
  const [keepTriggers, setKeepTriggers] = useState<boolean>(GMManager.keepDefaultTriggers);
  const [keepPlaceables, setKeepPlaceables] = useState<boolean>(GMManager.keepDefaultPlaceables);
  const [preserveParty, setPreserveParty] = useState<boolean>(GMManager.preservePartyOnWarp);
  const currentModuleName = KotOR.GameState.module?.filename || 'Loading...';
  // Each game has its own curated scenes; the other game's are offered under "Scenes from ..."
  const runningTSL = String(KotOR.ApplicationProfile.GameKey) === 'TSL';
  const curatedModules = GMManager.getCuratedModules();
  const otherCuratedModules = GMManager.getCuratedModules(runningTSL ? 'kotor' : 'tsl');
  const curatedSceneName = (resRef: string) => resRef;
  const otherTitle = KotOR.OtherGameManager.otherTitle();
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

  const loadOptions = { keepCreatures, keepTriggers, keepPlaceables, preserveParty };
  const q = sceneSearch.trim().toLowerCase();
  const showOther = areaSource === 'other';
  const otherList = (otherModules || [])
    .map((m) => ({ m, known: otherCuratedModules.find((c) => c.resRef === m) }))
    .filter(({ m, known }) => !q || m.includes(q) || (known && `${known.planet} ${known.title} ${known.description}`.toLowerCase().includes(q)));
  const openOther = async () => {
    setAreaSource('other');
    if (otherModules !== null) return;
    setOtherStatus(`Opening ${otherTitle}…`);
    const list = await KotOR.OtherGameManager.listModules();
    setOtherModules(list);
    setOtherStatus(list.length ? '' : (KotOR.OtherGameManager.lastError || `No ${otherTitle} areas found.`));
  };
  return (
    <>
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
        <div className="gm-section-title">
          <span>Areas</span>
          <div className="gm-segmented" role="group" aria-label="Which game's areas">
            <button className={`gm-btn small ${!showOther ? 'active' : ''}`} onClick={() => setAreaSource('this')} title="This game's areas">
              {runningTSL ? 'KotOR II' : 'KotOR'}
            </button>
            <button className={`gm-btn small ${showOther ? 'active' : ''}`} onClick={openOther} title={`Borrow an area from ${otherTitle}: its rooms, sky and lighting, without its characters or objects`}>
              {otherTitle}
            </button>
          </div>
        </div>
        <div className="gm-row">
          {!showOther && (
            <select className="gm-select" style={{ maxWidth: 140 }} value={planetFilter} onChange={e => setPlanetFilter(e.target.value)} title="Planet or region">
              {planets.map(p => <option key={p} value={p}>{p === 'All' ? 'All planets' : p}</option>)}
            </select>
          )}
          <input
            className="gm-input"
            style={{ flex: 1 }}
            placeholder={showOther ? 'Search areas (e.g. enclave, tat_)' : 'Search (e.g. enclave, cantina, tomb)'}
            value={sceneSearch}
            onChange={e => setSceneSearch(e.target.value)}
          />
        </div>
        {showOther && <div className="gm-hint">Only the area comes across: fill it with this game's characters and objects. Players need {otherTitle} set up too.</div>}
        {showOther && otherStatus && <div className="gm-hint">{otherStatus}</div>}
        <div className="gm-list" style={{ maxHeight: 300 }}>
          {!showOther && filteredCuratedModules.map(mod => (
            <div
              key={mod.resRef}
              className={`gm-card ${currentModuleName === curatedSceneName(mod.resRef) ? 'selected' : ''}`}
              onClick={() => GMManager.loadScene(curatedSceneName(mod.resRef), loadOptions)}
            >
              <div className="gm-card-info">
                <div className="gm-card-title">{mod.planet} — {mod.title}</div>
                <div className="gm-card-sub">{mod.description}</div>
              </div>
              <button className="gm-btn small active">Load</button>
            </div>
          ))}
          {showOther && otherList.map(({ m, known }) => {
            const name = KotOR.OtherGameManager.foreignModuleName(m);
            return (
              <div key={m} className={`gm-card ${currentModuleName === name ? 'selected' : ''}`} onClick={() => GMManager.loadScene(name, loadOptions)}>
                <div className="gm-card-info">
                  <div className="gm-card-title">{known ? `${known.planet} — ${known.title}` : m}</div>
                  <div className="gm-card-sub">{known?.description || `${otherTitle} area`}</div>
                </div>
                <button className="gm-btn small active">Load</button>
              </div>
            );
          })}
        </div>
        {!showOther && (
          <div className="gm-row" title="Any area of this game, by its module name">
            <select className="gm-select" style={{ flex: 1 }} value={customModuleResRef} onChange={e => setCustomModuleResRef(e.target.value)}>
              {(GMManager.discoveredModules.length ? GMManager.discoveredModules : [customModuleResRef]).map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <button className="gm-btn" onClick={() => GMManager.loadScene(customModuleResRef, loadOptions)}>Load by name</button>
          </div>
        )}
      </div>

      <details className="gm-section" open={!!planJson || planProblems.length > 0}>
        <summary>Import a scene plan <span className="gm-summary-note">from the Claude skill</span></summary>
        <div className="gm-row">
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
          <span className="gm-hint" style={{ flex: 1 }}>or paste it below</span>
        </div>
        <textarea
          className="gm-input"
          style={{ minHeight: 60, fontFamily: 'monospace', fontSize: 11 }}
          placeholder="Scene plan JSON"
          value={planJson}
          onChange={(e) => { setPlanJson(e.target.value); setPlanProblems([]); }}
        />
        <button
          className="gm-btn success"
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
        {planProblems.map((p, i) => (
          <div key={i} className="gm-hint" style={{ color: p.level === 'error' ? '#ff8a80' : '#ffd740' }}>
            {p.level === 'error' ? 'Error' : 'Note'} ({p.where}): {p.message}
          </div>
        ))}
      </details>

      <details className="gm-section">
        <summary>When loading an area <span className="gm-summary-note">{[keepPlaceables && 'its props', keepCreatures && 'its creatures', keepTriggers && 'its triggers'].filter(Boolean).join(', ') || 'empty stage'}</span></summary>
        <label className="gm-checkbox">
          <input type="checkbox" checked={keepPlaceables} onChange={e => { setKeepPlaceables(e.target.checked); GMManager.keepDefaultPlaceables = e.target.checked; }} />
          Keep the area's own props and containers
        </label>
        <label className="gm-checkbox">
          <input type="checkbox" checked={keepCreatures} onChange={e => { setKeepCreatures(e.target.checked); GMManager.keepDefaultCreatures = e.target.checked; }} />
          Keep the area's own creatures
        </label>
        <label className="gm-checkbox">
          <input type="checkbox" checked={keepTriggers} onChange={e => { setKeepTriggers(e.target.checked); GMManager.keepDefaultTriggers = e.target.checked; }} />
          Keep its area transitions and traps
        </label>
        <label className="gm-checkbox">
          <input type="checkbox" checked={preserveParty} onChange={e => { setPreserveParty(e.target.checked); GMManager.preservePartyOnWarp = e.target.checked; }} />
          Bring the player characters along
        </label>
      </details>
    </>
  );
});

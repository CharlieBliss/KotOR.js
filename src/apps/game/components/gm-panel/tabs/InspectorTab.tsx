import React, { useEffect, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import {
  GMManager, GMNetworkManager, GMConversationManager, GMNpcOrders, GMChecks, GMPlayers, GMSpawner, GMViewport, useGMStore,
} from "@/apps/game/components/gm-panel/gmPanelStore";
import { ItemOptions, PlayerOptions, SkillOptions } from "@/apps/game/components/gm-panel/controls/options";

/** Inspect tab: edit the selected object, or browse everything in the scene */
export const InspectorTab: React.FC<{ active: boolean }> = React.memo(({ active }) => {
  useGMStore(active);
  // Inspector tab states
  const [inspectorFilter, setInspectorFilter] = useState<'all' | 'creatures' | 'placeables' | 'doors'>('all');
  const [inspectorAddItemResRef, setInspectorAddItemResRef] = useState<string>('g_w_lghtsbr01');
  const [inspectorBarkInput, setInspectorBarkInput] = useState<string>('');
  const [askText, setAskText] = useState<string>('');
  const [askOptions, setAskOptions] = useState<string>('Yes\nNo');
  const [askTarget, setAskTarget] = useState<string>('');
  const factionName = KotOR.gmFactionName;
  const currentArea = KotOR.GameState.module?.area;
  const selectedObj = GMManager.selectedObject;
  const connectedPeers = [...GMNetworkManager.peers.values()];
  const recentPrompts = [...GMPlayers.dmPrompts.values()].slice(-3).reverse();
  // Everything in the current area, for the list under the editor
  const worldObjects: { obj: KotOR.ModuleObject; kind: string; badge: string }[] = [];
  if (currentArea) {
    for (const p of KotOR.GameState.PartyManager.party) {
      if (p) worldObjects.push({ obj: p, kind: 'Player/Party', badge: `HP ${p.getHP()}/${p.getMaxHP()}` });
    }
    if (inspectorFilter === 'all' || inspectorFilter === 'creatures') {
      for (const c of currentArea.creatures) {
        if (c && !KotOR.GameState.PartyManager.party.includes(c)) {
          const fac = factionName(c.factionId === KotOR.GMFaction.PARTY ? KotOR.GMFaction.NEUTRAL : c.factionId);
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

  // The bark field shows the selected object's bark whenever the GM's world changes
  useEffect(() => {
    const onChange = () => {
      if (GMManager.selectedObject) setInspectorBarkInput(GMManager.selectedObject.gmBarkText || '');
    };
    GMManager.events.addEventListener('change', onChange);
    return () => GMManager.events.removeEventListener('change', onChange);
  }, []);

  return (
    <>
      <div className="gm-section">
        <div className="gm-section-title">
          <span>Selected</span>
          {selectedObj && (
            <button className="gm-btn small danger" onClick={() => GMManager.deleteObject(selectedObj)} title="Remove it from the scene">
              Delete
            </button>
          )}
        </div>

        {!selectedObj ? (
          <div className="gm-hint">
            Click something in the scene, or pick it from the list below.
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
            {KotOR.GMObjectKind.isCreature(selectedObj) && (
              <>
                <div className="gm-row">
                  <button
                    className="gm-btn success"
                    style={{ flex: 1 }}
                    onClick={() => GMManager.possessCharacter(selectedObj as KotOR.ModuleCreature)}
                    title="Take control of it yourself"
                  >
                    Play as
                  </button>
                  <button className="gm-btn small" onClick={() => GMManager.healObject(selectedObj)} title="Full health">
                    Heal
                  </button>
                  <button className="gm-btn small danger" onClick={() => GMManager.killObject(selectedObj)}>
                    Kill
                  </button>
                </div>

                <div className="gm-row" title="Who it fights">
                  <span style={{ minWidth: 40, fontSize: 11, color: "#8aa4bd" }}>Side</span>
                    <button
                      className={`gm-btn small ${(selectedObj as KotOR.ModuleCreature).factionId === KotOR.GMFaction.HOSTILE ? 'danger' : ''}`}
                      onClick={() => GMManager.setObjectFaction(selectedObj, KotOR.GMFaction.HOSTILE)}
                    >
                      Hostile
                    </button>
                    <button
                      className={`gm-btn small ${(selectedObj as KotOR.ModuleCreature).factionId === KotOR.GMFaction.FRIENDLY ? 'success' : ''}`}
                      onClick={() => GMManager.setObjectFaction(selectedObj, KotOR.GMFaction.FRIENDLY)}
                    >
                      Friendly
                    </button>
                    <button
                      className={`gm-btn small ${(selectedObj as KotOR.ModuleCreature).factionId === KotOR.GMFaction.NEUTRAL ? 'active' : ''}`}
                      onClick={() => GMManager.setObjectFaction(selectedObj, KotOR.GMFaction.NEUTRAL)}
                    >
                      Neutral
                    </button>
                    <button
                      className={`gm-btn small ${(selectedObj as KotOR.ModuleCreature).factionId === KotOR.GMFaction.PARTY ? 'active' : ''}`}
                      onClick={() => GMManager.setObjectFaction(selectedObj, KotOR.GMFaction.PARTY)}
                    >
                      Party
                    </button>
                </div>

                {!selectedObj.gmOwnerPeerId && (() => {
                  const cre = selectedObj as KotOR.ModuleCreature;
                  const stances = GMManager.availableAnimations(cre, 'stance');
                  const gestures = GMManager.availableAnimations(cre, 'gesture');
                  const current = GMManager.stanceOf(cre);
                  const groups = (list: typeof stances) => [...new Set(list.map((c) => c.group))];
                  if (!stances.length && !gestures.length) return null;
                  return (
                    <div className="gm-grid-2" title="A stance holds whenever it would just stand: after walking, after a gesture, and after a fight">
                      <div className="gm-field">
                        <label>Stance</label>
                        <select className="gm-select" value={current} onChange={(e) => GMManager.setCreatureStance(cre, e.target.value)}>
                          <option value="">Standing</option>
                          {current && !stances.some((c) => c.id === current) && <option value={current}>{current}</option>}
                          {groups(stances).map((g) => (
                            <optgroup key={g} label={g}>
                              {stances.filter((c) => c.group === g).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                      <div className="gm-field">
                        <label>Gesture</label>
                        <select className="gm-select" value="" onChange={(e) => { if (e.target.value) GMManager.playGesture(cre, e.target.value); }}>
                          <option value="">Play once…</option>
                          {groups(gestures).map((g) => (
                            <optgroup key={g} label={g}>
                              {gestures.filter((c) => c.group === g).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })()}

                <details className="gm-section">
                  <summary>Gear</summary>
                <div className="gm-grid-2">
                  <div className="gm-field">
                    <label>Weapon</label>
                    <select
                      className="gm-select"
                      value={(selectedObj as KotOR.ModuleCreature).equipment?.RIGHTHAND?.getEquippedRes() || ''}
                      onChange={e =>
                        GMSpawner.equipWeaponOnCreature(
                          selectedObj as KotOR.ModuleCreature,
                          KotOR.ModuleCreatureArmorSlot.RIGHTHAND,
                          e.target.value
                        )
                      }
                    >
                      <ItemOptions items={GMManager.WEAPON_OPTIONS} />
                    </select>
                  </div>
                  <div className="gm-field">
                    <label>Armor or robes</label>
                    <select
                      className="gm-select"
                      value={(selectedObj as KotOR.ModuleCreature).equipment?.ARMOR?.getEquippedRes() || ''}
                      onChange={e =>
                        GMSpawner.equipWeaponOnCreature(
                          selectedObj as KotOR.ModuleCreature,
                          KotOR.ModuleCreatureArmorSlot.ARMOR,
                          e.target.value
                        )
                      }
                    >
                      <ItemOptions items={GMManager.ARMOR_OPTIONS} />
                    </select>
                  </div>
                </div>
                </details>
              </>
            )}

            {/* Door & Placeable Specific Controls */}
            {(KotOR.GMObjectKind.isDoor(selectedObj) ||
              KotOR.GMObjectKind.isPlaceable(selectedObj)) && (
              <>
                <div className="gm-row">
                  <button
                    className="gm-btn active"
                    style={{ flex: 1 }}
                    onClick={() => GMManager.toggleDoorOrPlaceableOpen(selectedObj)}
                  >
                    {(selectedObj as any).isOpen?.() ? 'Close' : 'Open'}
                  </button>
                  <button
                    className={`gm-btn ${(selectedObj as KotOR.ModuleDoor | KotOR.ModulePlaceable).isLocked() ? 'warning' : ''}`}
                    style={{ flex: 1 }}
                    onClick={() => GMManager.toggleDoorOrPlaceableLock(selectedObj)}
                  >
                    {(selectedObj as KotOR.ModuleDoor | KotOR.ModulePlaceable).isLocked() ? 'Unlock' : 'Lock'}
                  </button>
                </div>

                {KotOR.GMObjectKind.isPlaceable(selectedObj) && (() => {
                  const gate = selectedObj.gmSkillGate as { skill: number; dc: number } | undefined;
                  return (
                    <div className="gm-row" title="Using it takes a skill check first; passing once opens it for good">
                      <label className="gm-checkbox" style={{ flex: 1 }}>
                        Needs
                        <select
                          className="gm-select"
                          value={gate ? String(gate.skill) : ''}
                          onChange={e => GMChecks.setSkillGate(selectedObj, e.target.value === '' ? undefined : { skill: Number(e.target.value), dc: gate?.dc || 15 })}
                        >
                          <option value="">no skill check</option>
                          <SkillOptions />
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
                            onChange={e => GMChecks.setSkillGate(selectedObj, { skill: gate.skill, dc: Number(e.target.value) || 15 })}
                          />
                        </label>
                      )}
                      {selectedObj.gmSkillGateSolved && <span className="gm-badge">passed</span>}
                    </div>
                  );
                })()}

                {KotOR.GMObjectKind.isPlaceable(selectedObj) && (
                  <div className="gm-field">
                    <label>
                      Contents ({(selectedObj as KotOR.ModulePlaceable).inventory?.length || 0} items)
                    </label>
                    <div className="gm-row">
                      <select
                        className="gm-select"
                        style={{ flex: 1 }}
                        value={inspectorAddItemResRef}
                        onChange={e => setInspectorAddItemResRef(e.target.value)}
                      >
                        <ItemOptions items={GMManager.LOOT_ITEM_OPTIONS} />
                      </select>
                      <button
                        className="gm-btn small success"
                        onClick={() => GMSpawner.addItemToObject(selectedObj, inspectorAddItemResRef)}
                      >
                        Put inside
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {!selectedObj.gmOwnerPeerId && (
              <label className="gm-checkbox" title="Hidden objects stay visible to you but are removed from players' games until revealed">
                <input
                  type="checkbox"
                  checked={GMManager.isHiddenFromPlayers(selectedObj)}
                  onChange={e => GMManager.setObjectHidden(selectedObj, e.target.checked)}
                />
                Hidden from players
              </label>
            )}

            <details className="gm-section">
              <summary>Position and size <span className="gm-summary-note">{(selectedObj.gmScale || 1.0).toFixed(2)}x</span></summary>
            <div className="gm-row">
              <button
                className="gm-btn small success"
                onClick={() => GMSpawner.duplicateObject(selectedObj)}
                title="Spawn an exact duplicate of this Placeable or Creature next to it"
              >
                Duplicate
              </button>
              <button
                className="gm-btn small"
                onClick={() => {
                  const pt = GMViewport.getCameraTargetSpawnPoint(3.0);
                  GMManager.teleportObject(selectedObj, pt.position);
                }}
                title="Where the camera looks"
              >
                Move to camera
              </button>
              <button
                className={`gm-btn small ${GMManager.activeTool === 'teleport' ? 'warning active' : ''}`}
                onClick={() => GMManager.setToolMode(GMManager.activeTool === 'teleport' ? 'select' : 'teleport')}
                title="Click the ground to move it there"
              >
                Move to click
              </button>
              <button className="gm-btn small" onClick={() => GMManager.rotateObject(selectedObj, -Math.PI / 4)}>
                ⟲ 45°
              </button>
              <button className="gm-btn small" onClick={() => GMManager.rotateObject(selectedObj, Math.PI / 4)}>
                ⟳ 45°
              </button>
            </div>

            <div className="gm-field">
              <label>Nudge</label>
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
                    className={`gm-btn small ${Math.abs((selectedObj.gmScale || 1.0) - sc) < 0.05 ? 'active' : ''}`}
                    onClick={() => GMManager.setObjectScale(selectedObj, sc)}
                  >
                    {sc}x
                  </button>
                ))}
              </div>
            </div>
            </details>

            <div className="gm-field">
              <label title="Said when a player uses it, or now with Say">Line</label>
              <div className="gm-row">
                <input
                  className="gm-input"
                  style={{ flex: 1 }}
                  value={inspectorBarkInput}
                  onChange={e => {
                    setInspectorBarkInput(e.target.value);
                    GMManager.setObjectBark(selectedObj, e.target.value);
                  }}
                  placeholder="What it says when used"
                />
                <button
                  className="gm-btn small active"
                  onClick={() => GMManager.triggerBarkNow(selectedObj, inspectorBarkInput)}
                >
                  Say
                </button>
              </div>
            </div>

            {GMManager.canOrder(selectedObj) && (() => {
              const npc = selectedObj as KotOR.ModuleCreature;
              const order = GMNpcOrders.getOrder(npc);
              const players = GMManager.getPlayerCharacters().filter((pc) => !pc.isDead());
              return (
                <div className="gm-section">
                  <div className="gm-section-title"><span>Orders</span><span className="gm-summary-note">{GMNpcOrders.describe(order)}</span></div>
                  <div className="gm-row">
                    <button className="gm-btn small" onClick={() => GMViewport.startOrderTool('order_move', npc)} title="Click the ground: it walks there, then guards the spot">Move here…</button>
                    <button className="gm-btn small" onClick={() => GMViewport.startOrderTool('order_attack', npc)} title="Click a creature: it attacks until that one is dead">Attack…</button>
                    <button className="gm-btn small" onClick={() => GMViewport.startOrderTool('order_follow', npc)} title="Click a creature or player: it stays close and fights back if attacked">Follow…</button>
                    <button className="gm-btn small" onClick={() => GMViewport.startOrderTool('order_patrol', npc)} title="Click points on the ground, then Esc: it walks the loop and fights what it meets">Patrol…</button>
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
                      <PlayerOptions players={players} />
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
                  Talk to nearby players ({nearby.length})
                </button>
              );
            })()}

            {GMNetworkManager.role === 'host' && (
              <details className="gm-section">
                <summary>Ask the players <span className="gm-summary-note">a question with replies</span></summary>
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
                      const id = GMPlayers.askPlayers(selectedObj, askText, askOptions.split('\n'), askTarget || undefined);
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
              </details>
            )}
          </>
        )}
      </div>

      <div className="gm-section">
        <div className="gm-section-title">
          <span>Everything here ({worldObjects.length})</span>
        </div>
        <div className="gm-row">
          {(['all', 'creatures', 'placeables', 'doors'] as const).map(f => (
            <button
              key={f}
              className={`gm-btn small ${inspectorFilter === f ? 'active' : ''}`}
              onClick={() => setInspectorFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'creatures' ? 'Creatures' : f === 'placeables' ? 'Objects' : 'Doors'}
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
                setInspectorBarkInput(entry.obj.gmBarkText || '');
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
                  Go to
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
});

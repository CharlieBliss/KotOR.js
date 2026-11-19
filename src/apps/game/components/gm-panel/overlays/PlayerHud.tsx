import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import * as KotOR from "@/apps/game/KotOR";
import { GMManager, useGMStore } from "@/apps/game/components/gm-panel/gmPanelStore";
import { GameImage } from "@/apps/game/components/gm-panel/creator/GameImage";
import { gameTextureUrl } from "@/apps/game/components/gm-panel/creator/gameTexture";
import { SkillRollGrid } from "@/apps/game/components/gm-panel/sheet/sections";
import type { GMHudAbility, GMHudCategory, GMHudRelation, GMHudTargetAction } from "@/managers/gm/GMPlayerHud";
import type { SheetSectionId } from "@/apps/game/components/gm-panel/sheet/CharacterSheet";
import { useKotorSkin } from "@/apps/game/components/gm-panel/kotor/kotorSkin";
import { PAD, PadEdges, activate, closePanel, moveFocus, readPad, scrollPanel, setPadFocus, switchTab, wheelIndex } from "@/apps/game/components/gm-panel/controls/padNav";
import "@/apps/game/components/gm-panel/gm-player-hud.scss";
import "@/apps/game/components/gm-panel/gm-kotor-skin.scss";

const { GMPlayerHud } = KotOR;

const RELATION_TEXT: Record<GMHudRelation, string> = {
  enemy: 'Enemy', ally: 'Ally', neutral: 'Neutral', object: 'Object', self: 'You',
};

const CATEGORY_TABS: { id: 'all' | 'offense' | 'help' | 'feat' | 'item'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'offense', label: 'Offensive Powers' },
  { id: 'help', label: 'Buff & Heal' },
  { id: 'feat', label: 'Combat Feats' },
  { id: 'item', label: 'Items' },
];

/** The HUD's own redraw: health and Force move faster than the panel's poll */
function useTicker(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

const isTyping = (e: Event) => {
  const t = e.target as HTMLElement | null;
  if (!t || typeof t.tagName !== 'string') return false;
  const tag = t.tagName.toUpperCase();
  return t.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

const pct = (v: number, max: number) => `${Math.max(0, Math.min(100, max > 0 ? (100 * v) / max : 0))}%`;

function matchesCategoryTab(a: GMHudAbility, tab: typeof CATEGORY_TABS[number]['id']): boolean {
  if (tab === 'all') return true;
  const cat: GMHudCategory | undefined = a.category;
  if (tab === 'offense') return cat === 'offense' || (a.kind === 'power' && a.aim === 'enemy');
  if (tab === 'help') return cat === 'buff' || cat === 'heal' || (a.kind === 'power' && a.aim !== 'enemy');
  if (tab === 'feat') return cat === 'feat' || a.kind === 'feat' || a.kind === 'attack';
  return cat === 'item' || a.kind === 'item';
}

/** An ability's icon over its initials (which show while it loads, or when the game has no icon for it) */
const AbilityIcon: React.FC<{ ability?: GMHudAbility }> = ({ ability }) => {
  const initials = (ability?.name || '?').trim().split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2);
  return (
    <span className="gm-hud-icon-wrap">
      <span className="gm-hud-icon gm-hud-icon-text" aria-hidden="true">{initials || '?'}</span>
      {ability?.icon && <GameImage texture={ability.icon} alt="" className="gm-hud-icon gm-hud-icon-image" />}
    </span>
  );
};

/**
 * A coloured ring on the ground under the target (solid) and under what the mouse is over (faint), drawn every frame
 * from the creature's position: red enemy, green ally, blue anything else.
 */
const TargetRings: React.FC = () => {
  const selRef = useRef<HTMLDivElement>(null);
  const hovRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const v = new THREE.Vector3(), right = new THREE.Vector3(), edge = new THREE.Vector3();
    const place = (el: HTMLDivElement | null, obj: any) => {
      if (!el) return;
      const cam = KotOR.GameState.currentCamera as THREE.PerspectiveCamera;
      const canvas = KotOR.GameState.renderer?.domElement as HTMLCanvasElement | undefined;
      const relation = obj ? GMPlayerHud.relation(obj) : null;
      if (!obj || !cam || !canvas || !obj.position || relation === 'self') { el.style.display = 'none'; return; }
      v.copy(obj.position).project(cam);
      if (v.z > 1 || v.z < -1) { el.style.display = 'none'; return; }
      right.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
      edge.copy(obj.position).addScaledVector(right, 0.65).project(cam);
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + ((v.x + 1) / 2) * rect.width, y = rect.top + ((1 - v.y) / 2) * rect.height;
      const r = Math.max(10, Math.min(160, Math.abs(edge.x - v.x) / 2 * rect.width));
      el.style.display = 'block';
      el.style.left = `${x - r}px`;
      el.style.top = `${y - r * 0.4}px`;
      el.style.width = `${2 * r}px`;
      el.style.height = `${0.8 * r}px`;
      el.dataset.relation = relation || 'object';
    };
    const frame = () => {
      const cursor = KotOR.GameState.CursorManager;
      const sel = cursor?.selectedObject;
      const hov = cursor?.hoveredObject;
      place(selRef.current, sel);
      place(hovRef.current, hov && hov !== sel ? hov : null);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <>
      <div ref={selRef} className="gm-hud-ring selected" aria-hidden="true" />
      <div ref={hovRef} className="gm-hud-ring hovered" aria-hidden="true" />
    </>
  );
};

/**
 * While the world holds to plan a round: the planned move's ring on the ground, a line to it, and what each enemy
 * is about to do over its head, drawn every frame
 */
const PlanMarks: React.FC = () => {
  const ringRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const v = new THREE.Vector3(), w = new THREE.Vector3(), right = new THREE.Vector3(), edge = new THREE.Vector3(), proj = new THREE.Vector3();
    const labels = new Map<any, HTMLDivElement>();
    const toScreen = (p: THREE.Vector3, out: THREE.Vector3, cam: THREE.Camera, rect: DOMRect) => {
      out.copy(p).project(cam);
      if (out.z > 1 || out.z < -1) return false;
      out.set(rect.left + ((out.x + 1) / 2) * rect.width, rect.top + ((1 - out.y) / 2) * rect.height, 0);
      return true;
    };
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const ring = ringRef.current, line = lineRef.current, holder = labelsRef.current;
      if (!ring || !line || !holder) return;
      // Avoid layout reads and per-frame allocations whenever the world isn't in plan phase
      if (!GMPlayerHud.planning()) {
        if (ring.style.display !== 'none') ring.style.display = 'none';
        if (line.style.display !== 'none') line.style.display = 'none';
        if (labels.size) {
          for (const el of labels.values()) el.remove();
          labels.clear();
        }
        return;
      }
      const cam = KotOR.GameState.currentCamera as THREE.PerspectiveCamera;
      const canvas = KotOR.GameState.renderer?.domElement as HTMLCanvasElement | undefined;
      const pc: any = GMPlayerHud.player();
      const rect = canvas?.getBoundingClientRect();
      // The planned move
      const to = GMPlayerHud.plannedMove;
      if (to && pc && cam && rect && toScreen(to, v, cam, rect) && toScreen(pc.position, w, cam, rect)) {
        right.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
        edge.copy(to).addScaledVector(right, 0.5).project(cam);
        proj.copy(to).project(cam);
        const r = Math.max(8, Math.min(80, Math.abs(edge.x - proj.x) / 2 * rect.width));
        ring.style.display = 'block';
        ring.style.left = `${v.x - r}px`;
        ring.style.top = `${v.y - r * 0.4}px`;
        ring.style.width = `${2 * r}px`;
        ring.style.height = `${0.8 * r}px`;
        const dx = v.x - w.x, dy = v.y - w.y;
        line.style.display = 'block';
        line.style.left = `${w.x}px`;
        line.style.top = `${w.y}px`;
        line.style.width = `${Math.hypot(dx, dy)}px`;
        line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      } else {
        ring.style.display = 'none';
        line.style.display = 'none';
      }
      // What each enemy is about to do
      const seen = new Set<any>();
      const creatures: any[] = cam && rect ? (KotOR.GameState.module?.area?.creatures || []) : [];
      for (const c of creatures) {
        if (!c?.gmNetIntent || c === pc || GMPlayerHud.relation(c, pc) !== 'enemy') continue;
        v.copy(c.position);
        v.z += 2.1;
        if (!toScreen(v, v, cam, rect as DOMRect)) continue;
        seen.add(c);
        let el = labels.get(c);
        if (!el) {
          el = document.createElement('div');
          el.className = 'gm-hud-intent';
          holder.appendChild(el);
          labels.set(c, el);
        }
        if (el.textContent !== c.gmNetIntent) el.textContent = c.gmNetIntent;
        el.style.left = `${v.x}px`;
        el.style.top = `${v.y}px`;
      }
      for (const [c, el] of labels) if (!seen.has(c)) { el.remove(); labels.delete(c); }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); for (const el of labels.values()) el.remove(); };
  }, []);
  return (
    <>
      <div ref={lineRef} className="gm-hud-plan-line" aria-hidden="true" />
      <div ref={ringRef} className="gm-hud-ring planned" aria-hidden="true" />
      <div ref={labelsRef} className="gm-hud-intents" aria-hidden="true" />
    </>
  );
};

/** The round being planned (the world holds: pick an action, steer your move, then Ready) or played */
const PlanBanner: React.FC<{ padInUse: boolean }> = ({ padInUse }) => {
  const pacing = GMPlayerHud.pacing();
  if (!pacing || pacing.phase === 'off') return null;
  if (pacing.phase === 'play') return <div className="gm-hud-plan playing">Round {pacing.round} playing</div>;
  const left = GMPlayerHud.planSecondsLeftNow();
  const ready = GMPlayerHud.readySent;
  return (
    <div className="gm-hud-plan" role="status">
      <div className="gm-hud-plan-title">
        Round {pacing.round} · Plan your move{left !== undefined ? <span className="gm-hud-plan-time"> · {left}s</span> : null}
      </div>
      <div className="gm-hud-plan-hint">
        Pick an action, steer where to go with {padInUse ? 'the left stick' : 'W / S and the mouse'}, then Ready.
      </div>
      {(pacing.ready.length > 0 || pacing.waiting.length > 0) && (
        <div className="gm-hud-plan-who">
          {pacing.ready.length > 0 && <span className="ready">Ready: {pacing.ready.join(', ')}</span>}
          {pacing.waiting.length > 0 && <span className="waiting">Choosing: {pacing.waiting.join(', ')}</span>}
        </div>
      )}
      <button className={`gm-hud-plan-ready ${ready ? 'on' : ''}`} onClick={() => GMPlayerHud.setReady(!ready)}>
        {ready ? 'Ready ✓ (undo)' : 'Ready'} <kbd>{padInUse ? 'R3' : 'Space'}</kbd>
      </button>
    </div>
  );
};

function landing(a: GMHudAbility): { text: string; side: string; title: string } {
  const l = GMPlayerHud.landsOn(a);
  const name = (l.who as any)?.getName?.() || '';
  if (l.how === 'self') return { text: 'You', side: 'self', title: 'Lands on you' };
  if (l.how === 'target') {
    const side = GMPlayerHud.relation(l.who) || 'enemy';
    return { text: side === 'ally' ? 'Ally' : 'Target', side, title: `Lands on ${name}, your target` };
  }
  if (l.how === 'nearest') return { text: 'Nearest', side: 'nearest', title: `No enemy targeted: lands on the nearest, ${name}` };
  if (l.wrongKind && a.onlyOn) {
    const who = a.onlyOn === 'droids' ? 'droids' : 'Force users';
    return { text: a.onlyOn === 'droids' ? 'Droids only' : 'Jedi only', side: 'none', title: `Only works on ${who}: none targeted or in reach` };
  }
  return { text: 'No one', side: 'none', title: 'No enemy in reach' };
}

/** Top centre: current target status and primary actions */
const TargetFrame: React.FC<{ onAction: (id: GMHudTargetAction['id']) => void }> = ({ onAction }) => {
  const obj: any = GMPlayerHud.selected();
  const relation = GMPlayerHud.relation(obj);
  if (!obj || !relation || relation === 'self') {
    return (
      <div className="gm-hud-target empty">
        <span className="gm-hud-target-name">No target</span>
        <span className="gm-hud-keys"><kbd>Tab</kbd> enemy <kbd>Shift+Tab</kbd> ally · or click</span>
      </div>
    );
  }
  const creature = KotOR.GMObjectKind.isCreature(obj);
  const hp = creature ? Number(obj.getHP?.() ?? 0) : 0, maxHp = creature ? Number(obj.getMaxHP?.() ?? 0) : 0;
  const dead = creature && obj.isDead?.();
  const actions = GMPlayerHud.targetActions(obj);
  return (
    <div className={`gm-hud-target ${relation}`} data-relation={relation}>
      <div className="gm-hud-target-head">
        <span className="gm-hud-target-side">{dead ? 'Down' : RELATION_TEXT[relation]}</span>
        <span className="gm-hud-target-name">{obj.getName?.() || 'Target'}</span>
        <span className="gm-hud-keys" style={{ marginLeft: 'auto' }}><kbd>Tab</kbd> next</span>
      </div>
      {creature && !dead && maxHp > 0 && (
        <div className="gm-hud-bar hp" title={`${Math.max(0, Math.round(hp))} / ${maxHp} vitality`}>
          <span style={{ width: pct(hp, maxHp) }} />
          <em>{Math.max(0, Math.round(hp))} / {maxHp}</em>
        </div>
      )}
      {actions.length > 0 && (
        <div className="gm-hud-target-actions" role="group" aria-label="What you can do">
          {actions.map((a) => (
            <button
              key={a.id}
              className={`gm-hud-action ${a.primary ? 'primary' : ''}`}
              disabled={!a.usable}
              title={a.usable ? `${a.title}${a.primary ? ' (R, or click it)' : ''}` : `${a.title}`}
              onClick={() => onAction(a.id)}
            >
              {a.primary && <kbd>R</kbd>}{a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** Unified player menu strip above the portrait: Skills, Powers, Character Sheet, Inventory, Gear, Chat, Stealth */
const QuickActions: React.FC<{
  panel: 'none' | 'skills' | 'powers';
  onToggleSkills: () => void;
  onTogglePowers: () => void;
  onOpenSheet: () => void;
  onOpenChat: () => void;
  onStealth: () => void;
}> = ({ panel, onToggleSkills, onTogglePowers, onOpenSheet, onOpenChat, onStealth }) => {
  const stealth = GMPlayerHud.stealth();
  return (
    <div className="gm-hud-quick" role="toolbar" aria-label="Player menus">
      <button className={panel === 'skills' ? 'on' : ''} onClick={onToggleSkills} title="Roll skills & saving throws (K)"><kbd>K</kbd>Skills</button>
      <button className={panel === 'powers' ? 'on' : ''} onClick={onTogglePowers} title="Browse powers, feats & items with descriptions (Q)"><kbd>Q</kbd>Powers</button>
      <button onClick={onOpenSheet} title="Character sheet: stats, feats, powers & effects (P)"><kbd>P</kbd>Sheet</button>
      <button onClick={() => KotOR.GameState.MenuManager?.MenuInventory?.open?.()} title="Inventory & consumables (I)"><kbd>I</kbd>Items</button>
      <button onClick={() => KotOR.GameState.MenuManager?.MenuEquipment?.open?.()} title="Equipped weapons, armor & implants (U)"><kbd>U</kbd>Gear</button>
      <button onClick={onOpenChat} title="Session status & chat with GM and party (Enter)"><kbd>↵</kbd>Chat</button>
      {stealth.can && (
        <button className={`gm-hud-quick-wide ${stealth.on ? 'on' : ''}`} onClick={onStealth} title={stealth.on ? 'Stop sneaking (G)' : 'Sneak (G)'}><kbd>G</kbd>{stealth.on ? 'Stealth On' : 'Sneak'}</button>
      )}
    </div>
  );
};

/** Bottom left: portrait, vitality/Force bars, and active buffs */
const SelfFrame: React.FC<{ onOpenSheet: () => void }> = ({ onOpenSheet }) => {
  const pc: any = GMPlayerHud.player();
  if (!pc) return null;
  const hp = Number(pc.getHP?.() ?? 0), maxHp = Number(pc.getMaxHP?.() ?? 0);
  const fp = Number(pc.getFP?.() ?? 0), maxFp = Number(pc.getMaxFP?.() ?? 0);
  const portrait = String(pc.getPortraitResRef?.() || '').toLowerCase();
  const name = pc.getName?.() || 'You';
  const level = Number(pc.getTotalClassLevel?.() || 0);
  return (
    <button className="gm-hud-self" onClick={onOpenSheet} title="Open character sheet (P)">
      <span className="gm-hud-portrait">
        {portrait ? <GameImage texture={portrait} alt={name} /> : <span className="gm-hud-initials">{name.slice(0, 1)}</span>}
      </span>
      <span className="gm-hud-self-body">
        <span className="gm-hud-self-name">{name}{level ? <small> · Lv {level}</small> : null}</span>
        <span className="gm-hud-bar hp" title="Vitality">
          <span style={{ width: pct(hp, maxHp) }} />
          <em>Vitality {Math.max(0, Math.round(hp))} / {maxHp}</em>
        </span>
        {maxFp > 0 && (
          <span className="gm-hud-bar fp" title="Force points">
            <span style={{ width: pct(fp, maxFp) }} />
            <em>Force {Math.max(0, Math.floor(fp))} / {maxFp}</em>
          </span>
        )}
        {pc.careersRules && (() => {
          const st = pc.careersRules.getStrainState();
          return (
            <span className={`gm-hud-bar strain ${st.windedSeconds > 0 ? 'winded' : ''}`} title={st.windedSeconds > 0 ? `Winded for ${Math.ceil(st.windedSeconds)}s: slowed, Strain abilities locked` : 'Strain (combat feats & pushes)'}>
              <span style={{ width: pct(st.strain, st.maxStrain) }} />
              <em>{st.windedSeconds > 0 ? `WINDED (${Math.ceil(st.windedSeconds)}s)` : `Strain ${Math.round(st.strain)} / ${st.maxStrain}`}</em>
            </span>
          );
        })()}
      </span>
    </button>
  );
};

/** Lightweight non-blocking skill & save check roller anchored above the player menu */
const QuickSkillsPopover: React.FC<{ pc: any; onClose: () => void }> = ({ pc, onClose }) => (
  <div className="gm-hud-popover gm-hud-skills-popover" role="dialog" aria-label="Quick skill & save rolls">
    <div className="gm-hud-popover-head">
      <div>
        <strong>Skills &amp; Saving Throws</strong>
        <span>Click any check to roll</span>
      </div>
      <button type="button" className="gm-hud-mini-close" onClick={onClose}>Close</button>
    </div>
    <div className="gm-hud-popover-body">
      <SkillRollGrid creature={pc} onRoll={(check) => KotOR.GMPlayerRequests.roll(check)} who="player" compact />
    </div>
  </div>
);

/** Categorized, searchable Powers/Feats/Items menu with full spell descriptions, Cast, and Pin to Bar 1–8 */
const AbilitiesDrawer: React.FC<{
  abilities: GMHudAbility[];
  bar: (string | null)[];
  onUse: (a: GMHudAbility) => void;
  onAssign: (slot: number, key: string) => void;
  onClose: () => void;
}> = ({ abilities, bar, onUse, onAssign, onClose }) => {
  const [tab, setTab] = useState<typeof CATEGORY_TABS[number]['id']>('all');
  const [bestOnly, setBestOnly] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string>('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return abilities.filter((a) => {
      if (bestOnly && a.isBestRank === false && !q) return false;
      if (!matchesCategoryTab(a, tab)) return false;
      if (!q) return true;
      return `${a.name} ${a.description || ''}`.toLowerCase().includes(q);
    });
  }, [abilities, tab, bestOnly, query]);

  const selected = filtered.find((a) => a.key === selectedKey) || filtered[0];
  const hasLowerRanks = abilities.some((a) => a.isBestRank === false);
  const selectedSlot = selected ? bar.indexOf(selected.key) : -1;
  const selectedLand = selected ? landing(selected) : undefined;

  return (
    <div className="gm-hud-popover gm-hud-abilities-drawer" role="dialog" aria-label="Powers and abilities">
      <div className="gm-hud-popover-head">
        <div>
          <strong>Powers &amp; Abilities</strong>
          <span>Filter by type, inspect descriptions, cast or pin to slots 1–8</span>
        </div>
        <button type="button" className="gm-hud-mini-close" onClick={onClose}>Close</button>
      </div>

      <div className="gm-hud-abilities-controls">
        <div className="gm-hud-cat-tabs" role="tablist">
          {CATEGORY_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`gm-hud-cat-tab ${tab === t.id ? 'on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="gm-hud-abilities-tools">
          <input
            type="search"
            className="gm-hud-search"
            placeholder="Search spells, feats, items..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {hasLowerRanks && (
            <label className="gm-hud-check" title="Hide superseded lower spell ranks">
              <input type="checkbox" checked={bestOnly} onChange={(e) => setBestOnly(e.target.checked)} />
              Best ranks
            </label>
          )}
        </div>
      </div>

      <div className="gm-hud-abilities-split">
        <div className="gm-hud-abilities-list" role="listbox">
          {filtered.length === 0 ? (
            <div className="gm-hud-empty-msg">No matching powers or abilities.</div>
          ) : (
            filtered.map((a) => {
              const slotIdx = bar.indexOf(a.key);
              return (
                <button
                  key={a.key}
                  type="button"
                  role="option"
                  aria-selected={selected?.key === a.key}
                  className={`gm-hud-ability-row ${selected?.key === a.key ? 'selected' : ''} ${!a.usable ? 'unusable' : ''} aim-${a.aim}`}
                  onClick={() => setSelectedKey(a.key)}
                  onDoubleClick={() => onUse(a)}
                >
                  <span className="gm-hud-ability-icon-sm"><AbilityIcon ability={a} /></span>
                  <span className="gm-hud-ability-row-text">
                    <strong>{a.name}</strong>
                    <small>
                      {a.aim === 'self' ? 'Self' : a.aim === 'ally' ? 'Ally' : 'Enemy'}
                      {a.cost > 0 ? ` · ${a.cost} FP` : ''}
                      {a.strainCost ? ` · ${a.strainCost} Strain` : ''}
                      {a.count != null ? ` · ×${a.count}` : ''}
                    </small>
                  </span>
                  {slotIdx >= 0 && <kbd className="gm-hud-bound-tag">{slotIdx + 1}</kbd>}
                </button>
              );
            })
          )}
        </div>

        <div className="gm-hud-ability-detail">
          {selected ? (
            <>
              <div className="gm-hud-detail-head">
                <span className="gm-hud-detail-icon"><AbilityIcon ability={selected} /></span>
                <div>
                  <div className="gm-hud-detail-title">{selected.name}</div>
                  <div className="gm-hud-detail-pills">
                    <span className={`gm-hud-pill aim-${selected.aim}`}>
                      {selected.aim === 'self' ? 'Self' : selected.aim === 'ally' ? 'Ally' : 'Enemy'}
                    </span>
                    {selected.range && <span className="gm-hud-pill">{selected.range}</span>}
                    {selected.cost > 0 && <span className="gm-hud-pill fp">{selected.cost} Force</span>}
                    {selected.strainCost ? <span className="gm-hud-pill">{selected.strainCost} Strain</span> : null}
                    {selected.count != null && <span className="gm-hud-pill count">{selected.count} left</span>}
                    {selectedLand && (
                      <span className={`gm-hud-pill lands side-${selectedLand.side}`}>→ {selectedLand.text}</span>
                    )}
                  </div>
                </div>
              </div>
              {!selected.usable && selected.why && (
                <div className="gm-hud-detail-warn">{selected.why}</div>
              )}
              <div className="gm-hud-detail-desc">
                {selected.description || 'No description available.'}
              </div>
              <div className="gm-hud-detail-footer">
                <button
                  type="button"
                  className="gm-hud-cast-btn"
                  disabled={!selected.usable}
                  onClick={() => onUse(selected)}
                >
                  {selected.kind === 'attack' ? 'Attack' : selected.kind === 'item' ? 'Use Item' : 'Cast / Use'}
                </button>
                <div className="gm-hud-pin-group">
                  <span>Pin to bar:</span>
                  {Array.from({ length: GMPlayerHud.SLOTS }, (_, slot) => (
                    <button
                      key={slot}
                      type="button"
                      className={`gm-hud-pin-slot ${selectedSlot === slot ? 'on' : ''}`}
                      onClick={() => onAssign(slot, selected.key)}
                    >
                      {slot + 1}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="gm-hud-empty-msg">Select an ability to read its description.</div>
          )}
        </div>
      </div>
    </div>
  );
};

/** Radial quick-cast wheel (Hold Q) with center description snippet */
const PowerWheel: React.FC<{
  abilities: GMHudAbility[];
  hovered: number;
  onHover: (i: number) => void;
  onPick: (i: number) => void;
  onClose: () => void;
  held: string[];
}> = ({ abilities, hovered, onHover, onPick, onClose, held }) => {
  const n = abilities.length;
  const radius = Math.max(125, Math.min(265, n * 16, window.innerHeight / 2 - 120));
  const onMove = (e: React.PointerEvent) => {
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    if (Math.hypot(dx, dy) < 46 || !n) { onHover(-1); return; }
    const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
    onHover(Math.round(angle / (360 / n)) % n);
  };
  const focus = abilities[hovered];
  return (
    <div className="gm-hud-wheel" onPointerMove={onMove} onPointerDown={(e) => { e.stopPropagation(); if (e.button === 2) onClose(); }} onContextMenu={(e) => e.preventDefault()}>
      <div className="gm-hud-wheel-ring" style={{ width: radius * 2 + 80, height: radius * 2 + 80 }}>
        {abilities.map((a, i) => {
          const angle = (i * 360 / n - 90) * Math.PI / 180;
          return (
            <button
              key={a.key}
              className={`gm-hud-wheel-item ${i === hovered ? 'hovered' : ''} ${a.usable ? '' : 'unusable'} aim-${a.aim}`}
              style={{ left: `calc(50% + ${Math.cos(angle) * radius}px)`, top: `calc(50% + ${Math.sin(angle) * radius}px)` }}
              onPointerEnter={() => onHover(i)}
              onClick={() => onPick(i)}
              aria-label={a.name}
            >
              <AbilityIcon ability={a} />
              {a.count != null && <span className="gm-hud-count">{a.count}</span>}
              {a.cost > 0 && <span className="gm-hud-cost">{a.cost}</span>}
            </button>
          );
        })}
        <div className="gm-hud-wheel-centre">
          {focus ? (
            <>
              <strong>{focus.name}</strong>
              <span className={`gm-hud-wheel-lands side-${landing(focus).side}`}>
                → {landing(focus).title.replace(/^Lands on /, '')}{focus.cost > 0 ? ` · ${focus.cost} FP` : ''}{focus.range ? ` · ${focus.range}` : ''}
              </span>
              {focus.description && <p className="gm-hud-wheel-desc">{focus.description}</p>}
              {!focus.usable && <span className="warn">{focus.why}</span>}
              <small>Release Q or click to cast · 1–8 binds slot</small>
            </>
          ) : (
            <>
              <strong>{n ? 'Quick Wheel' : 'Nothing to use'}</strong>
              <small>Point &amp; release Q to cast · Tap Q for searchable Powers menu</small>
              {held.length > 0 && <span className="warn">World paused while choosing</span>}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * A GM session player's combat HUD: target frame and rings, categorized abilities drawer (tap Q),
 * radial quick wheel (hold Q), quick skill roller (K), unified menu strip, and 1–8 hotbar with descriptions.
 */
/** The pad buttons the HUD drives in the world (KotOR's action menu, party and pause had them): the engine leaves them be */
const PAD_WORLD_CLAIMS: readonly string[] = ['button_x', 'button_bumper_l', 'button_bumper_r', 'button_d_up', 'button_d_down', 'button_d_left', 'button_d_right', 'trigger_l', 'trigger_r'];

export const PlayerHud: React.FC<{ onOpenSheet: (section?: SheetSectionId) => void; onOpenChat: () => void }> = ({ onOpenSheet, onOpenChat }) => {
  useGMStore();
  // KotOR's own frames, colours and font, read from the game (kotor/kotorSkin)
  useKotorSkin();
  useTicker(200);
  const [wheel, setWheel] = useState<{ open: boolean; sticky: boolean }>({ open: false, sticky: false });
  const [panel, setPanel] = useState<'none' | 'skills' | 'powers'>('none');
  const [hoveredSlot, setHoveredSlot] = useState<number>(-1);
  const [hovered, setHovered] = useState(-1);
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);
  const qHoldTimer = useRef<number | null>(null);
  const qOpenedWheelOnHold = useRef(false);

  const visible = GMPlayerHud.active() && KotOR.GameState.Mode === KotOR.EngineMode.INGAME && !KotOR.GMCutscene.active;
  const pc: any = GMPlayerHud.player();
  const abilities: GMHudAbility[] = visible ? GMPlayerHud.abilities(pc) : [];
  const wheelAbilities: GMHudAbility[] = visible ? GMPlayerHud.orderForTarget(abilities, pc) : [];
  const bar = visible ? GMPlayerHud.loadout(pc, abilities) : [];
  const byKey = new Map(abilities.map((a) => [a.key, a]));
  const buffs = visible ? (GMPlayerHud.activeEffects?.(pc) || []) : [];

  const live = useRef({ visible, abilities: wheelAbilities, bar, byKey, wheel, hovered, panel });
  live.current = { visible, abilities: wheelAbilities, bar, byKey, wheel, hovered, panel };

  const say = useCallback((text: string) => setToast({ text, at: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const use = useCallback((ability: GMHudAbility | undefined) => {
    if (!ability) return;
    const result = GMPlayerHud.use(ability);
    if (!result.ok) {
      if (result.message) say(result.message);
      return;
    }
    const who = result.target === GMPlayerHud.player() ? 'you' : (result.target as any)?.getName?.() || 'target';
    say(`${ability.name} → ${who}`);
  }, [say]);

  const notice = GMPlayerHud.lastNotice;
  useEffect(() => { if (notice) say(notice.text); }, [notice?.at, say]);

  const act = useCallback((id: GMHudTargetAction['id']) => {
    const result = GMPlayerHud.runTargetAction(id);
    if (!result.ok && result.message) say(result.message);
  }, [say]);

  const sneak = useCallback(() => {
    const result = GMPlayerHud.toggleStealth();
    if (!result.ok && result.message) say(result.message);
  }, [say]);

  const openWheel = useCallback((sticky: boolean) => {
    setPanel('none');
    setHovered(-1);
    setWheel({ open: true, sticky });
    GMPlayerHud.setWheelOpen(true);
  }, []);
  const closeWheel = useCallback(() => {
    setWheel({ open: false, sticky: false });
    setHovered(-1);
    GMPlayerHud.setWheelOpen(false);
  }, []);
  const pick = useCallback((i: number) => {
    const ability = live.current.abilities[i];
    closeWheel();
    use(ability);
  }, [closeWheel, use]);

  // Read every icon ahead, one after another, so the wheel and drawer open with pictures ready
  const iconList = abilities.map((a) => a.icon).filter(Boolean).join(',');
  useEffect(() => {
    let active = true;
    (async () => { for (const icon of iconList.split(',')) { if (!active) return; if (icon) await gameTextureUrl(icon); } })();
    return () => { active = false; };
  }, [iconList]);

  useEffect(() => {
    if (!visible && wheel.open) closeWheel();
    if (!visible && panel !== 'none') setPanel('none');
  }, [visible, wheel.open, panel, closeWheel]);
  useEffect(() => () => {
    if (qHoldTimer.current) window.clearTimeout(qHoldTimer.current);
    GMPlayerHud.setWheelOpen(false);
  }, []);

  useEffect(() => { if (visible) GMPlayerHud.retargetAfterKill(); });

  const onOpenChatRef = useRef(onOpenChat);
  onOpenChatRef.current = onOpenChat;
  const onOpenSheetRef = useRef(onOpenSheet);
  onOpenSheetRef.current = onOpenSheet;

  useEffect(() => {
    const stop = (e: KeyboardEvent) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const onDown = (e: KeyboardEvent) => {
      const s = live.current;
      if (!s.visible || isTyping(e) || e.ctrlKey || e.altKey || e.metaKey) return;
      const digit = /^Digit([1-8])$/.exec(e.code);
      if (digit) {
        stop(e);
        if (e.repeat) return;
        const slot = Number(digit[1]) - 1;
        if (s.wheel.open && s.hovered >= 0) {
          GMPlayerHud.assignSlot(slot, s.abilities[s.hovered]?.key || null);
          say(`${s.abilities[s.hovered]?.name} pinned to ${slot + 1}`);
          return;
        }
        const key = s.bar[slot];
        if (!key) { say(`Slot ${slot + 1} is empty — press Q to pin a power or ability`); return; }
        const ability = s.byKey.get(key);
        if (!ability) { say('None left'); return; }
        use(ability);
        return;
      }
      if (e.code === 'Tab') {
        stop(e);
        if (!GMPlayerHud.cycle(e.shiftKey ? 'ally' : 'enemy')) say(e.shiftKey ? 'No allies nearby' : 'No enemies in sight');
        return;
      }
      if (e.code === 'KeyQ') {
        stop(e);
        if (e.repeat) return;
        if (s.wheel.open) { closeWheel(); return; }
        qOpenedWheelOnHold.current = false;
        if (qHoldTimer.current) window.clearTimeout(qHoldTimer.current);
        qHoldTimer.current = window.setTimeout(() => {
          qHoldTimer.current = null;
          qOpenedWheelOnHold.current = true;
          openWheel(false);
        }, 200);
        return;
      }
      if (e.code === 'KeyK') {
        stop(e);
        if (!e.repeat) setPanel((p) => (p === 'skills' ? 'none' : 'skills'));
        return;
      }
      if (e.code === 'KeyP') {
        stop(e);
        if (!e.repeat) onOpenSheetRef.current('overview');
        return;
      }
      if (e.code === 'KeyI') {
        stop(e);
        if (!e.repeat) KotOR.GameState.MenuManager?.MenuInventory?.open?.();
        return;
      }
      if (e.code === 'KeyU') {
        stop(e);
        if (!e.repeat) KotOR.GameState.MenuManager?.MenuEquipment?.open?.();
        return;
      }
      if (e.code === 'Escape' && (s.wheel.open || s.panel !== 'none')) {
        stop(e);
        if (s.wheel.open) closeWheel();
        else setPanel('none');
        return;
      }
      if (s.wheel.open) return;
      if (e.code === 'KeyR') {
        stop(e);
        if (e.repeat) return;
        const main = GMPlayerHud.targetActions().find((a) => a.primary);
        if (main) act(main.id);
        else say(GMPlayerHud.selected() ? 'Nothing to do with it' : 'No target: Tab picks an enemy');
        return;
      }
      if (e.code === 'KeyG') {
        stop(e);
        if (!e.repeat) sneak();
        return;
      }
      // Planning a round: Space says you're ready (or takes it back)
      if (e.code === 'Space' && GMPlayerHud.planning()) {
        stop(e);
        if (!e.repeat) GMPlayerHud.setReady(!GMPlayerHud.readySent);
        return;
      }
      if (e.code === 'Enter') {
        stop(e);
        onOpenChatRef.current();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const s = live.current;
      if (!s.visible || isTyping(e)) return;
      if (/^Digit[1-8]$/.test(e.code) || e.code === 'Tab') { e.stopImmediatePropagation(); return; }
      if (e.code === 'KeyQ') {
        e.stopImmediatePropagation();
        if (qHoldTimer.current) {
          window.clearTimeout(qHoldTimer.current);
          qHoldTimer.current = null;
        }
        if (qOpenedWheelOnHold.current && s.wheel.open && !s.wheel.sticky) {
          if (s.hovered >= 0) pick(s.hovered);
          else setWheel({ open: true, sticky: true });
        } else if (!qOpenedWheelOnHold.current && !s.wheel.open) {
          setPanel((p) => (p === 'powers' ? 'none' : 'powers'));
        }
      }
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, [openWheel, closeWheel, pick, use, act, sneak, say]);

  // The controller (Xbox layout). KotOR's own pad bindings stay (stick moves, A interacts, B cancels, Y draws the
  // lightsaber, View sneaks, Menu is options); the buttons its hidden action menu had drive this HUD, and while one
  // of its menus is open the pad is that menu's. GMPlayerHud.padClaims tells the engine which it mustn't act on
  const [padSlot, setPadSlot] = useState(-1);
  const [padSeenAt, setPadSeenAt] = useState(0);
  const pad = useRef({ area: 'none' as 'none' | 'quick' | 'target', wheel: false, slot: -1 });
  pad.current.slot = padSlot;
  useEffect(() => {
    const edges = new PadEdges();
    let raf = 0;
    let seen = 0;
    const leaveArea = () => { pad.current.area = 'none'; setPadFocus(null); };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = live.current;
      const frame = readPad();
      const now = performance.now();
      edges.update(frame, now);
      if (!frame || !s.visible) { GMPlayerHud.padClaims = null; return; }
      if (edges.touched && now - seen > 1000) { seen = now; setPadSeenAt(Date.now()); }
      const G = KotOR.GameState;
      // KotOR's own menus (inventory, equipment, a container, a conversation) take the pad as they always have
      const menu = G.MenuManager?.GetCurrentMenu?.();
      if (G.Mode !== KotOR.EngineMode.INGAME || (menu && menu !== G.MenuManager.InGameOverlay)) {
        GMPlayerHud.padClaims = null;
        if (pad.current.area !== 'none') leaveArea();
        return;
      }

      // The wheel, held open by RB: the left stick points, letting go casts
      if (s.wheel.open && pad.current.wheel) {
        GMPlayerHud.padClaims = 'all';
        const i = wheelIndex(frame.axes[0] || 0, frame.axes[1] || 0, s.abilities.length);
        if (i >= 0 && i !== s.hovered) setHovered(i);
        if (edges.pressed.has(PAD.B)) { pad.current.wheel = false; closeWheel(); return; }
        if (edges.released.has(PAD.RB)) {
          pad.current.wheel = false;
          if (s.hovered >= 0) pick(s.hovered); else closeWheel();
        }
        return;
      }

      // A menu that's open: the GM's question or being down, the sheet, Powers or Skills, or a row the d-pad went to
      const area = pad.current.area === 'quick' ? document.querySelector('.gm-player-hud .gm-hud-quick')
        : pad.current.area === 'target' ? document.querySelector('.gm-player-hud .gm-hud-target-actions') : null;
      const container = document.querySelector('.gm-panel-root .gm-prompt')
        || document.querySelector('.gm-panel-root .sheet-frame')
        || document.querySelector('.gm-player-hud .gm-hud-popover')
        || area;
      if (pad.current.area !== 'none' && !area) pad.current.area = 'none';
      if (container) {
        GMPlayerHud.padClaims = 'all';
        const focus = moveFocus(container, edges.dir());
        if (edges.pressed.has(PAD.A)) activate(focus);
        if (edges.pressed.has(PAD.LB)) switchTab(container, -1);
        if (edges.pressed.has(PAD.RB)) switchTab(container, 1);
        const scroll = frame.axes[3] || 0;
        if (scroll) scrollPanel(container, scroll * 16);
        if (edges.pressed.has(PAD.B)) {
          if (container === area) leaveArea();
          // The GM's question and being down are answered, not closed
          // Its own Close: a faked Escape reached KotOR's keyboard too, and opened its Options menu
          else if (!container.matches('.gm-prompt')) {
            setPadFocus(null);
            if (!closePanel(container)) setPanel('none');
          }
        }
        return;
      }
      setPadFocus(null);

      // In the world
      GMPlayerHud.padClaims = PAD_WORLD_CLAIMS;
      if (edges.pressed.has(PAD.RT) && !GMPlayerHud.cycle('enemy')) say('No enemies in sight');
      if (edges.pressed.has(PAD.LT) && !GMPlayerHud.cycle('ally')) say('No allies nearby');
      const slots = s.bar.length;
      const step = edges.pressed.has(PAD.RIGHT) ? 1 : edges.pressed.has(PAD.LEFT) ? -1 : 0;
      if (step) {
        const next = pad.current.slot < 0 ? (step > 0 ? 0 : slots) : (pad.current.slot + step + slots + 1) % (slots + 1);
        setPadSlot(next);
        setHoveredSlot(next < slots ? next : -1);
      }
      if (edges.pressed.has(PAD.X)) {
        const at = pad.current.slot < 0 ? 0 : pad.current.slot;
        if (at >= slots) setPanel((p) => (p === 'powers' ? 'none' : 'powers'));
        else {
          const key = s.bar[at];
          const ability = key ? s.byKey.get(key) : undefined;
          if (!key) say(`Slot ${at + 1} is empty: LB opens Powers to pin one`);
          else if (!ability) say('None left');
          else use(ability);
        }
      }
      if (edges.pressed.has(PAD.LB)) setPanel((p) => (p === 'powers' ? 'none' : 'powers'));
      if (edges.pressed.has(PAD.RB)) { pad.current.wheel = true; openWheel(false); }
      if (edges.pressed.has(PAD.UP)) {
        if (document.querySelector('.gm-player-hud .gm-hud-target-actions button')) pad.current.area = 'target';
        else say(GMPlayerHud.selected() ? 'Nothing to do with it' : 'No target: RT picks an enemy');
      }
      if (edges.pressed.has(PAD.DOWN)) pad.current.area = 'quick';
      // Planning a round: R3 says you're ready (or takes it back)
      if (edges.pressed.has(PAD.R3) && GMPlayerHud.planning()) GMPlayerHud.setReady(!GMPlayerHud.readySent);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); GMPlayerHud.padClaims = null; setPadFocus(null); };
  }, [openWheel, closeWheel, pick, use, say]);
  const padInUse = padSeenAt > 0 && Date.now() - padSeenAt < 60000;

  if (!visible || !pc) return null;

  const queue: string[] = Array.isArray(pc.gmNetQueue) ? pc.gmNetQueue.filter(Boolean).slice(0, 4) : [];
  const held = GMPlayerHud.heldBy();
  const frozen = GMManager.isPlayerFrozen(pc);
  const hoveredKey = hoveredSlot >= 0 ? bar[hoveredSlot] : null;
  const hoveredAbility = hoveredKey ? byKey.get(hoveredKey) : undefined;
  const hoveredLands = hoveredAbility ? landing(hoveredAbility) : undefined;

  return (
    <div className="gm-player-hud">
      <TargetRings />
      <PlanMarks />
      <TargetFrame onAction={act} />
      <PlanBanner padInUse={padInUse} />

      {held.length > 0 && (
        <div className="gm-hud-paused">Paused: {held.join(', ')} {held.length === 1 ? 'is' : 'are'} choosing a power</div>
      )}

      {buffs.length > 0 && (
        <div className="gm-hud-buffs" aria-label="Active effects">
          {buffs.map((b) => (
            <span key={b.label} className="gm-hud-buff">
              {b.label}{b.secondsLeft != null ? ` · ${b.secondsLeft}s` : ''}
            </span>
          ))}
        </div>
      )}

      <QuickActions
        panel={panel}
        onToggleSkills={() => setPanel((p) => (p === 'skills' ? 'none' : 'skills'))}
        onTogglePowers={() => setPanel((p) => (p === 'powers' ? 'none' : 'powers'))}
        onOpenSheet={() => onOpenSheet('overview')}
        onOpenChat={onOpenChat}
        onStealth={sneak}
      />
      <SelfFrame onOpenSheet={() => onOpenSheet('overview')} />

      {panel === 'skills' && (
        <QuickSkillsPopover pc={pc} onClose={() => setPanel('none')} />
      )}

      {panel === 'powers' && (
        <AbilitiesDrawer
          abilities={abilities}
          bar={bar}
          onUse={use}
          onAssign={(slot, key) => GMPlayerHud.assignSlot(slot, key)}
          onClose={() => setPanel('none')}
        />
      )}

      <div className="gm-hud-dock">
        {toast && <div className="gm-hud-toast" key={toast.at}>{toast.text}</div>}
        {hoveredAbility && panel === 'none' && !wheel.open && (
          <div className="gm-hud-hover-card" role="status">
            <div className="gm-hud-hover-head">
              <strong>{hoveredAbility.name}</strong>
              <span className="gm-hud-hover-meta">
                {hoveredLands && <span className={`side-${hoveredLands.side}`}>{hoveredLands.text}</span>}
                {hoveredAbility.cost > 0 && <span>{hoveredAbility.cost} FP</span>}
                {hoveredAbility.range && <span>{hoveredAbility.range}</span>}
                {hoveredAbility.count != null && <span>{hoveredAbility.count} left</span>}
              </span>
            </div>
            {!hoveredAbility.usable && hoveredAbility.why && (
              <div className="gm-hud-hover-warn">{hoveredAbility.why}</div>
            )}
            {hoveredAbility.description && (
              <div className="gm-hud-hover-desc">{hoveredAbility.description}</div>
            )}
          </div>
        )}
        {queue.length > 0 && (
          <div className="gm-hud-queue" aria-label="Combat queue">
            <span className="gm-hud-label">Queue</span>
            {queue.map((icon, i) => (
              <span key={`${i}-${icon}`} className={`gm-hud-queue-item ${i === 0 ? 'now' : ''}`} title={i === 0 ? 'Doing now' : `Next ${i}`}>
                <GameImage texture={icon} alt="" className="gm-hud-icon" />
              </span>
            ))}
            <button className="gm-hud-stop" onClick={() => GMPlayerHud.stop()} title="Stop: drop the queue and stand down">Stop</button>
          </div>
        )}
        {padInUse && (
          <div className="gm-hud-pad-legend" aria-label="Controller">
            {panel !== 'none' || wheel.open ? (
              <>
                <span><b>✚</b> move</span><span><b>A</b> select</span><span><b>B</b> back</span><span><b>LB RB</b> tabs</span><span><b>R</b> scroll</span>
              </>
            ) : (
              <>
                <span><b>RT LT</b> enemy / ally</span><span><b>◀ ▶</b> slot</span><span><b>X</b> use</span><span><b>LB</b> powers</span><span><b>RB</b> hold: wheel</span><span><b>▲</b> target</span><span><b>▼</b> menu</span>
              </>
            )}
          </div>
        )}
        <div className={`gm-hud-bar-slots ${frozen ? 'frozen' : ''}`} role="toolbar" aria-label="Power bar">
          {bar.map((key, i) => {
            const a = key ? byKey.get(key) : undefined;
            const lands = a ? landing(a) : undefined;
            return (
              <button
                key={i}
                className={`gm-hud-slot ${a ? `aim-${a.aim}` : 'empty'} ${a && !a.usable ? 'unusable' : ''} ${lands?.side === 'none' ? 'no-one' : ''} ${padInUse && padSlot === i ? 'pad-slot' : ''}`}
                onMouseEnter={() => setHoveredSlot(i)}
                onMouseLeave={() => setHoveredSlot((s) => (s === i ? -1 : s))}
                onFocus={() => setHoveredSlot(i)}
                onBlur={() => setHoveredSlot((s) => (s === i ? -1 : s))}
                onClick={() => (a ? use(a) : setPanel('powers'))}
                onContextMenu={(e) => { e.preventDefault(); if (key) GMPlayerHud.assignSlot(i, null); }}
                aria-label={a ? `${i + 1}: ${a.name}` : `Empty slot ${i + 1}`}
              >
                {a ? <AbilityIcon ability={a} /> : <span className="gm-hud-slot-empty">+</span>}
                <kbd className="gm-hud-slot-key">{i + 1}</kbd>
                {a && a.cost > 0 && <span className="gm-hud-cost">{a.cost}</span>}
                {a && a.count != null && <span className="gm-hud-count">{a.count}</span>}
                {lands && <span className={`gm-hud-lands side-${lands.side}`}>{lands.text}</span>}
              </button>
            );
          })}
          <button
            className={`gm-hud-slot all ${panel === 'powers' ? 'open' : ''} ${padInUse && padSlot === bar.length ? 'pad-slot' : ''}`}
            title="Powers & Abilities (tap Q for categorized menu, hold Q for quick wheel)"
            onClick={() => setPanel((p) => (p === 'powers' ? 'none' : 'powers'))}
          >
            <span className="gm-hud-slot-empty">✦</span>
            <kbd className="gm-hud-slot-key">Q</kbd>
            <span className="gm-hud-slot-name-static">All</span>
          </button>
        </div>
      </div>

      {wheel.open && (
        <PowerWheel abilities={wheelAbilities} hovered={hovered} onHover={setHovered} onPick={pick} onClose={closeWheel} held={held} />
      )}
    </div>
  );
};

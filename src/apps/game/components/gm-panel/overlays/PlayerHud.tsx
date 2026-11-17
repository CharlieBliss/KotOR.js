import React, { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import * as KotOR from "@/apps/game/KotOR";
import { GMManager, GMNetworkManager, useGMStore } from "@/apps/game/components/gm-panel/gmPanelStore";
import { GameImage } from "@/apps/game/components/gm-panel/creator/GameImage";
import { gameTextureUrl } from "@/apps/game/components/gm-panel/creator/gameTexture";
import type { GMHudAbility, GMHudAim, GMHudRelation } from "@/managers/gm/GMPlayerHud";
import "@/apps/game/components/gm-panel/gm-player-hud.scss";

const { GMPlayerHud } = KotOR;

const AIM_TEXT: Record<GMHudAim, string> = {
  enemy: 'At your enemy target (the nearest enemy if you have none)',
  ally: 'At your selected ally (Shift+Tab), or you',
  self: 'On you',
};

const RELATION_TEXT: Record<GMHudRelation, string> = {
  enemy: 'Enemy', ally: 'Ally', neutral: 'Neutral', object: 'Object', self: 'You',
};

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

/** An ability's icon over its initials (which show while it loads, or when the game has no icon for it) */
const AbilityIcon: React.FC<{ ability?: GMHudAbility }> = ({ ability }) => {
  const initials = (ability?.name || '?').split(/s+/).map((w) => w[0]).join('').slice(0, 2);
  return (
    <span className="gm-hud-icon-wrap">
      <span className="gm-hud-icon gm-hud-icon-text" aria-hidden="true">{initials}</span>
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

/** Top centre: who the target is, which side they're on, their health, and what the keys do with them */
const TargetFrame: React.FC = () => {
  const obj: any = GMPlayerHud.selected();
  const relation = GMPlayerHud.relation(obj);
  if (!obj || !relation || relation === 'self') {
    return (
      <div className="gm-hud-target empty">
        <span className="gm-hud-target-name">No target</span>
        <span className="gm-hud-keys"><kbd>Tab</kbd> enemy <kbd>Shift+Tab</kbd> ally</span>
      </div>
    );
  }
  const creature = KotOR.GMObjectKind.isCreature(obj);
  const hp = creature ? Number(obj.getHP?.() ?? 0) : 0, maxHp = creature ? Number(obj.getMaxHP?.() ?? 0) : 0;
  const dead = creature && obj.isDead?.();
  const hint =
    relation === 'enemy' ? 'Click: attack · powers and grenades go here' :
    relation === 'ally' ? 'Friendly powers go here' :
    dead ? 'Down' : 'Click: use';
  return (
    <div className={`gm-hud-target ${relation}`} data-relation={relation}>
      <div className="gm-hud-target-head">
        <span className="gm-hud-target-side">{dead ? 'Down' : RELATION_TEXT[relation]}</span>
        <span className="gm-hud-target-name">{obj.getName?.() || 'Target'}</span>
      </div>
      {creature && maxHp > 0 && (
        <div className="gm-hud-bar hp" title={`${Math.max(0, Math.round(hp))} / ${maxHp} vitality`}>
          <span style={{ width: pct(hp, maxHp) }} />
          <em>{Math.max(0, Math.round(hp))} / {maxHp}</em>
        </div>
      )}
      <div className="gm-hud-target-hint"><span>{hint}</span><span className="gm-hud-keys"><kbd>Tab</kbd> <kbd>Shift+Tab</kbd></span></div>
    </div>
  );
};

/** Bottom left: you. Portrait, name, vitality and Force with numbers; click for the character sheet (P) */
const SelfFrame: React.FC<{ onOpenSheet: () => void }> = ({ onOpenSheet }) => {
  const pc: any = GMPlayerHud.player();
  if (!pc) return null;
  const hp = Number(pc.getHP?.() ?? 0), maxHp = Number(pc.getMaxHP?.() ?? 0);
  const fp = Number(pc.getFP?.() ?? 0), maxFp = Number(pc.getMaxFP?.() ?? 0);
  const portrait = String(pc.getPortraitResRef?.() || '').toLowerCase();
  const name = pc.getName?.() || 'You';
  const level = Number(pc.getTotalClassLevel?.() || 0);
  return (
    <button className="gm-hud-self" onClick={onOpenSheet} title="Your character sheet (P)">
      <span className="gm-hud-portrait">
        {portrait ? <GameImage texture={portrait} alt={name} /> : <span className="gm-hud-initials">{name.slice(0, 1)}</span>}
      </span>
      <span className="gm-hud-self-body">
        <span className="gm-hud-self-name">{name}{level ? <small> · level {level}</small> : null}</span>
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
      </span>
    </button>
  );
};

/** The radial menu of everything usable. Move the mouse toward one; release Q (or click) to use it; 1–8 puts it on the bar */
const PowerWheel: React.FC<{
  abilities: GMHudAbility[];
  hovered: number;
  onHover: (i: number) => void;
  onPick: (i: number) => void;
  onClose: () => void;
  held: string[];
}> = ({ abilities, hovered, onHover, onPick, onClose, held }) => {
  const n = abilities.length;
  // Big enough for every icon, small enough to stay clear of the target frame and the bar
  const radius = Math.max(120, Math.min(260, n * 16, window.innerHeight / 2 - 120));
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
              <span>{AIM_TEXT[focus.aim]}</span>
              {focus.cost > 0 && <span>{focus.cost} Force</span>}
              {focus.count != null && <span>{focus.count} left</span>}
              {!focus.usable && <span className="warn">{focus.why}</span>}
              <small>Release Q or click to use · 1–8 puts it on the bar</small>
            </>
          ) : (
            <>
              <strong>{n ? 'Powers and items' : 'Nothing to use'}</strong>
              <small>Point at one, then release Q or click · Esc or right-click closes</small>
              {held.length > 0 && <span className="warn">World paused while you choose</span>}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * A GM session player's combat HUD, in place of KotOR's (GMPlayerHud hides that): the target frame and rings,
 * a power bar on 1–8, the power wheel on Q, a readable self frame, and the combat queue.
 */
export const PlayerHud: React.FC<{ onOpenSheet: () => void }> = ({ onOpenSheet }) => {
  useGMStore();
  useTicker(200);
  const [wheel, setWheel] = useState<{ open: boolean; sticky: boolean }>({ open: false, sticky: false });
  const [hovered, setHovered] = useState(-1);
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);

  const visible = GMPlayerHud.active() && KotOR.GameState.Mode === KotOR.EngineMode.INGAME && !KotOR.GMCutscene.active;
  const pc: any = GMPlayerHud.player();
  const abilities: GMHudAbility[] = visible ? GMPlayerHud.abilities(pc) : [];
  const bar = visible ? GMPlayerHud.loadout(pc, abilities) : [];
  const byKey = new Map(abilities.map((a) => [a.key, a]));

  // The latest of everything for the key and mouse handlers, which are attached once
  const live = useRef({ visible, abilities, bar, byKey, wheel, hovered });
  live.current = { visible, abilities, bar, byKey, wheel, hovered };

  const say = useCallback((text: string) => setToast({ text, at: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const use = useCallback((ability: GMHudAbility | undefined) => {
    if (!ability) return;
    const result = GMPlayerHud.use(ability);
    if (!result.ok && result.message) say(result.message);
  }, [say]);

  const openWheel = useCallback((sticky: boolean) => {
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

  // Read every icon ahead, one after another, so the wheel opens with its pictures ready
  const iconList = abilities.map((a) => a.icon).filter(Boolean).join(',');
  useEffect(() => {
    let live = true;
    (async () => { for (const icon of iconList.split(',')) { if (!live) return; if (icon) await gameTextureUrl(icon); } })();
    return () => { live = false; };
  }, [iconList]);

  // The HUD went away (a conversation, a cutscene, a menu): the wheel closes with it
  useEffect(() => { if (!visible && wheel.open) closeWheel(); }, [visible, wheel.open, closeWheel]);
  useEffect(() => () => GMPlayerHud.setWheelOpen(false), []);

  // The enemy we were on fell: on to the next
  useEffect(() => { if (visible) GMPlayerHud.retargetAfterKill(); });

  // Keys: 1–8 the bar, Q the wheel, Tab / Shift+Tab targets. Caught before the game's own handlers, which would
  // otherwise run KotOR's hidden action slots on the same keys
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
          say(`${s.abilities[s.hovered]?.name} is on ${slot + 1}`);
          return;
        }
        const key = s.bar[slot];
        if (!key) { say(`Slot ${slot + 1} is empty: hold Q, point at something and press ${slot + 1}`); return; }
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
        if (s.wheel.open) closeWheel();
        else openWheel(false);
        return;
      }
      if (e.code === 'Escape' && s.wheel.open) {
        stop(e);
        closeWheel();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const s = live.current;
      if (!s.visible || isTyping(e)) return;
      if (/^Digit[1-8]$/.test(e.code) || e.code === 'Tab') { e.stopImmediatePropagation(); return; }
      if (e.code === 'KeyQ') {
        e.stopImmediatePropagation();
        // Released over an entry: use it. A quick tap keeps the wheel open to choose with the mouse
        if (s.wheel.open && !s.wheel.sticky) {
          if (s.hovered >= 0) pick(s.hovered);
          else setWheel({ open: true, sticky: true });
        }
      }
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, [openWheel, closeWheel, pick, use, say]);

  if (!visible || !pc) return null;

  const queue: string[] = Array.isArray(pc.gmNetQueue) ? pc.gmNetQueue.filter(Boolean).slice(0, 4) : [];
  const held = GMPlayerHud.heldBy();
  const frozen = GMManager.isPlayerFrozen(pc);

  return (
    <div className="gm-player-hud">
      <TargetRings />
      <TargetFrame />

      {held.length > 0 && (
        <div className="gm-hud-paused">Paused: {held.join(', ')} {held.length === 1 ? 'is' : 'are'} choosing a power</div>
      )}

      <SelfFrame onOpenSheet={onOpenSheet} />

      <div className="gm-hud-dock">
        {toast && <div className="gm-hud-toast" key={toast.at}>{toast.text}</div>}
        {queue.length > 0 && (
          <div className="gm-hud-queue" aria-label="Combat queue">
            <span className="gm-hud-label">Queue</span>
            {queue.map((icon, i) => (
              <span key={`${i}-${icon}`} className={`gm-hud-queue-item ${i === 0 ? 'now' : ''}`} title={i === 0 ? 'Doing now' : `Next ${i}`}>
                <GameImage texture={icon} alt="" className="gm-hud-icon" />
              </span>
            ))}
            <button className="gm-hud-stop" onClick={() => GMNetworkManager.sendIntent('cancel')} title="Stop: drop the queue and stand down">Stop</button>
          </div>
        )}
        <div className={`gm-hud-bar-slots ${frozen ? 'frozen' : ''}`} role="toolbar" aria-label="Power bar">
          {bar.map((key, i) => {
            const a = key ? byKey.get(key) : undefined;
            const title = a
              ? `${i + 1}: ${a.name}\n${AIM_TEXT[a.aim]}${a.cost ? `\n${a.cost} Force` : ''}${a.count != null ? `\n${a.count} left` : ''}${a.usable ? '' : `\n${a.why}`}\nRight-click to empty`
              : key ? `${i + 1}: none left (right-click to empty)` : `${i + 1}: empty. Hold Q, point at a power and press ${i + 1}`;
            return (
              <button
                key={i}
                className={`gm-hud-slot ${a ? `aim-${a.aim}` : 'empty'} ${a && !a.usable ? 'unusable' : ''}`}
                title={title}
                onClick={() => (a ? use(a) : openWheel(true))}
                onContextMenu={(e) => { e.preventDefault(); if (key) GMPlayerHud.assignSlot(i, null); }}
              >
                {a ? <AbilityIcon ability={a} /> : <span className="gm-hud-slot-empty">+</span>}
                <kbd className="gm-hud-slot-key">{i + 1}</kbd>
                {a && a.cost > 0 && <span className="gm-hud-cost">{a.cost}</span>}
                {a && a.count != null && <span className="gm-hud-count">{a.count}</span>}
                {a && <span className="gm-hud-slot-name">{a.name}</span>}
              </button>
            );
          })}
          <button className="gm-hud-slot all" title="Every power and item (hold Q: point and release to use)" onClick={() => (wheel.open ? closeWheel() : openWheel(true))}>
            <span className="gm-hud-slot-empty">◎</span>
            <kbd className="gm-hud-slot-key">Q</kbd>
            <span className="gm-hud-slot-name">All</span>
          </button>
        </div>
      </div>

      {wheel.open && (
        <PowerWheel abilities={abilities} hovered={hovered} onHover={setHovered} onPick={pick} onClose={closeWheel} held={held} />
      )}
    </div>
  );
};

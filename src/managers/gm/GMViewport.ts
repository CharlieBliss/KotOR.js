import { GMObjectKind } from "@/managers/gm/GMObjectKind";
import { GMFaction } from "@/managers/gm/GMVocab";
import * as THREE from "three";
import { GameState } from "@/GameState";
import { EngineMode } from "@/enums/engine/EngineMode";
import type { GMPoint } from "@/managers/GMNpcOrders";
import { ModuleObject, ModuleCreature } from "@/module";
import { Utility } from "@/utility/Utility";
import type { GMToolMode } from "@/managers/gm/GMTypes";
import { GMManager } from "@/managers/GMManager";
import { GMSpawner } from "@/managers/gm/GMSpawner";
import { GMMines } from "@/managers/gm/GMMines";
import { GMLog } from "@/managers/gm/GMLog";
import { GMHistory, GMHistoryChange } from "@/managers/gm/GMHistory";
import { GMEditTools } from "@/managers/gm/GMEditTools";

/** The GM's viewport: picking, placement and order tools, the selection and placement rings, and where the camera is looking. */
export class GMViewport {
  // Architectural & Scene Builder placement helpers
  static gridSnapSize: number = 0; // 0 = Off, 0.5, 1.0, 2.0

  static placementYawOffset: number = 0; // degrees (0..360)

  // Degrees per placement rotation step: R / Shift+R, and per mouse-wheel notch
  static PLACEMENT_KEY_STEP: number = 45;

  static PLACEMENT_WHEEL_STEP: number = 15;

  /** The NPCs an order tool (order_move, order_attack...) is giving its order to */
  static orderSubjects: ModuleCreature[] = [];

  /** The first of them (the panel names it); setting it gives the order to that one alone */
  static get orderSubject(): ModuleCreature | null {
    return this.orderSubjects[0] || null;
  }

  static set orderSubject(cre: ModuleCreature | null) {
    this.orderSubjects = cre ? [cre] : [];
  }

  /** Patrol points clicked so far with the order_patrol tool */
  static patrolDraft: GMPoint[] = [];

  // 3D viewport visual indicators: a ring under each selected object
  static selectionRing: THREE.Mesh | null = null;

  static selectionRings: THREE.Mesh[] = [];

  /** Degrees each wheel notch turns the selection, with Ctrl held */
  static ROTATE_WHEEL_STEP: number = 15;

  /** Pixels the mouse moves with the button down before a press becomes a drag */
  static DRAG_THRESHOLD: number = 6;

  /** Milliseconds between position updates sent to players while dragging */
  static DRAG_SEND_MS: number = 120;

  /**
   * A press in select mode that may become a drag: on an object, moving the selection (it, if it
   * wasn't selected); with Shift on empty ground, drawing a box to select what's in it
   */
  static press: {
    kind: 'move' | 'box' | 'lift';
    x: number; y: number;
    picked: ModuleObject | null;
    ground: THREE.Vector3 | null;
    started: boolean;
    moving: { obj: ModuleObject; start: THREE.Vector3 }[];
    lastSent: number;
    history?: GMHistoryChange;
  } | null = null;

  /** Metres an Alt + drag raises a placeable per pixel the mouse moves up */
  static LIFT_PER_PIXEL = 0.01;

  static boxElement: HTMLDivElement | null = null;

  /** The ring under what the mouse is over, and the label with its name */
  static hoverRing: THREE.Mesh | null = null;

  static hoverLabel: HTMLDivElement | null = null;

  static hovered: ModuleObject | null = null;

  static lastHoverPick = 0;

  static placementRing: THREE.Mesh | null = null;

  static lastRaycastPoint: THREE.Vector3 = new THREE.Vector3();

  static hasValidRaycastPoint: boolean = false;

  static raycaster: THREE.Raycaster = new THREE.Raycaster();

  static mouseNDC: THREE.Vector2 = new THREE.Vector2();

  static domListenersAttached: boolean = false;

  static pointerDownPos: { x: number; y: number } = { x: 0, y: 0 };

  /** The last viewport click, to recognise a double-click (pointer events don't count clicks) */
  static lastViewportClick: { x: number; y: number; at: number } = { x: 0, y: 0, at: 0 };

  static DOUBLE_CLICK_MS = 400;

  /** A ring under each selected object */
  static updateSelectionRings(selected: ModuleObject[]) {
    if (!this.selectionRing) return;
    const list = selected.filter((o) => o?.position);
    while (this.selectionRings.length < list.length) {
      const ring = this.selectionRing.clone();
      ring.material = (this.selectionRing.material as THREE.Material).clone();
      GameState.scene?.add(ring);
      this.selectionRings.push(ring);
    }
    this.selectionRings.forEach((ring, i) => {
      if (i < list.length) this.updateSelectionRing(list[i], ring);
      else ring.visible = false;
    });
    this.selectionRing.visible = false;
  }

  /** The ring under a selected object, coloured by its side (red hostile, green party, amber others, cyan objects) */
  static updateSelectionRing(selected: ModuleObject | null, ring: THREE.Mesh | null = this.selectionRing) {
    if (!ring) return;
    if (!selected?.position) {
      ring.visible = false;
      return;
    }
    ring.visible = true;
    ring.position.set(selected.position.x, selected.position.y, selected.position.z + 0.08);
    const mat = ring.material as THREE.MeshBasicMaterial;
    if (GMObjectKind.isCreature(selected)) {
      if (selected.factionId === GMFaction.HOSTILE) mat.color.setHex(0xff3333);
      else if (selected.factionId === GMFaction.PARTY || GameState.PartyManager.party.includes(selected)) mat.color.setHex(0x00ff88);
      else mat.color.setHex(0xffcc00);
    } else {
      mat.color.setHex(0x00e5ff);
    }
  }

  static init3DIndicators() {
    if (!GameState.scene) return;

    if (!this.selectionRing) {
      const geo = new THREE.RingGeometry(0.65, 0.82, 32);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffcc00,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
      });
      this.selectionRing = new THREE.Mesh(geo, mat);
      this.selectionRing.visible = false;
      this.selectionRing.renderOrder = 999;
      GameState.scene.add(this.selectionRing);
    }

    if (!this.hoverRing) {
      const geo = new THREE.RingGeometry(0.7, 0.76, 32);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false });
      this.hoverRing = new THREE.Mesh(geo, mat);
      this.hoverRing.visible = false;
      this.hoverRing.renderOrder = 998;
      GameState.scene.add(this.hoverRing);
    }

    if (!this.placementRing) {
      const geo = new THREE.RingGeometry(0.5, 0.72, 32);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
      });
      this.placementRing = new THREE.Mesh(geo, mat);
      this.placementRing.visible = false;
      this.placementRing.renderOrder = 999;
      GameState.scene.add(this.placementRing);
    }
  }

  static attachViewportListeners() {
    if (this.domListenersAttached || typeof window === 'undefined') return;
    this.domListenersAttached = true;

    window.addEventListener('pointerdown', (e: PointerEvent) => {
      if (!GameState.gmMode) return;
      const target = e.target as HTMLElement;
      if (target && target.closest('.gm-panel-root')) return;
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
      if (e.button === 0) this.beginPress(e.clientX, e.clientY, e.shiftKey, e.altKey);
    });

    window.addEventListener('pointermove', (e: PointerEvent) => {
      if (!GameState.gmMode) return;
      if (this.press) {
        this.updatePress(e.clientX, e.clientY);
        return;
      }
      const target = e.target as HTMLElement;
      if (target && target.closest('.gm-panel-root')) {
        if (this.placementRing) this.placementRing.visible = false;
        this.setHovered(null);
        return;
      }
      this.updateMouseRaycast(e.clientX, e.clientY);
      this.updateHover(e.clientX, e.clientY);
    });

    // While placing, the mouse wheel turns what's being placed; in select mode, Ctrl + wheel turns the selection
    window.addEventListener('wheel', (e: WheelEvent) => {
      if (!GameState.gmMode || !GMManager.isGMUser()) return;
      const target = e.target as HTMLElement;
      if (target && target.closest('.gm-panel-root')) return;
      // Shift turns a vertical wheel into a horizontal one in some browsers
      const amount = e.deltaY || e.deltaX;
      if (!amount) return;
      const step = amount > 0 ? 1 : -1;
      if (this.isPlacementTool(GMManager.activeTool)) {
        this.rotatePlacement(step * this.PLACEMENT_WHEEL_STEP);
        return;
      }
      if (e.ctrlKey && GMManager.activeTool === 'select' && GMManager.controlMode !== 'POSSESS') {
        // Ctrl + wheel would zoom the page otherwise
        e.preventDefault();
        const list = this.movableSelection();
        if (!list.length) return;
        const radians = (-step * this.ROTATE_WHEEL_STEP * Math.PI) / 180;
        // With Shift too, the group turns around its middle as one
        if (e.shiftKey && list.length > 1) GMEditTools.rotateAround(list, radians);
        else GMHistory.track(`Turn ${GMHistory.nameOf(list)}`, list, () => GMManager.rotateObjects(list, radians));
      }
    }, { passive: false });

    // A drag let go of outside the window, or the window losing focus mid-drag, still ends it
    window.addEventListener('blur', () => this.endPress(null));

    window.addEventListener('pointerup', (e: PointerEvent) => {
      if (!GameState.gmMode || (e.button !== 0 && e.button !== 2) || !GMManager.isGMUser()) return;
      // Moving or box-selecting: that was the whole gesture
      if (e.button === 0 && this.press) {
        const dragged = this.press.started;
        this.endPress({ x: e.clientX, y: e.clientY });
        if (dragged) return;
      }
      const target = e.target as HTMLElement;
      if (target && target.closest('.gm-panel-root')) return;

      // Ignore drags (camera rotation)
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      if (Math.hypot(dx, dy) > this.DRAG_THRESHOLD) return;

      // A right-click (not a right-drag, which looks around) puts down the placement or teleport tool
      if (e.button === 2) {
        if (GMManager.activeTool !== 'select') GMManager.setToolMode('select');
        return;
      }

      // In POSSESS mode, let standard KotOR IngameControls handle left-clicks unless a placement/teleport tool is explicitly active
      if (GMManager.controlMode === 'POSSESS' && GMManager.activeTool === 'select') {
        return;
      }

      const last = this.lastViewportClick;
      const now = performance.now();
      const isDoubleClick = now - last.at < this.DOUBLE_CLICK_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) <= 6;
      this.lastViewportClick = isDoubleClick ? { x: 0, y: 0, at: 0 } : { x: e.clientX, y: e.clientY, at: now };

      this.handleViewportClick(e.clientX, e.clientY, isDoubleClick, e.shiftKey);
    });
  }

  /** The selected objects that can be moved and turned (doors stay in their frames) */
  static movableSelection(): ModuleObject[] {
    return GMManager.selectedObjects().filter((o) => o?.position && !GMObjectKind.isDoor(o));
  }

  /** What the mouse is over, for the hover ring and label (checked a few times a second, not every move) */
  static updateHover(clientX: number, clientY: number) {
    if (!GMManager.isGMUser() || GMManager.activeTool !== 'select' || GMManager.controlMode === 'POSSESS') {
      this.setHovered(null);
      return;
    }
    const now = performance.now();
    if (now - this.lastHoverPick >= 70) {
      this.lastHoverPick = now;
      this.setHovered(this.pickObjectAtCursor(true));
    }
    if (this.hoverLabel && this.hovered) {
      this.hoverLabel.style.left = `${clientX + 16}px`;
      this.hoverLabel.style.top = `${clientY + 14}px`;
    }
  }

  static setHovered(obj: ModuleObject | null) {
    this.hovered = obj;
    if (this.hoverRing) {
      this.hoverRing.visible = !!obj;
      if (obj) this.hoverRing.position.set(obj.position.x, obj.position.y, obj.position.z + 0.06);
    }
    if (typeof document === 'undefined') return;
    if (!obj) {
      if (this.hoverLabel) this.hoverLabel.style.display = 'none';
      return;
    }
    if (!this.hoverLabel) {
      const el = document.createElement('div');
      el.className = 'gm-hover-label';
      Object.assign(el.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: '60', padding: '2px 7px', borderRadius: '4px',
        font: '12px/1.4 system-ui, sans-serif', color: '#e8f4ff', background: 'rgba(8, 20, 34, 0.85)',
        border: '1px solid rgba(0, 229, 255, 0.4)', whiteSpace: 'nowrap',
      });
      document.body.appendChild(el);
      this.hoverLabel = el;
    }
    const name = obj.getName?.() || (obj as any).firstName || obj.getTag?.() || 'Object';
    const bits = [name];
    if (GMObjectKind.isCreature(obj)) bits.push(`${obj.getHP()}/${obj.getMaxHP()} HP`);
    if (obj.gmHidden) bits.push('hidden');
    if (GMManager.isSelected(obj)) bits.push('selected');
    this.hoverLabel.textContent = bits.join(' · ');
    this.hoverLabel.style.display = 'block';
  }

  /** The left button went down in the viewport: maybe the start of moving or lifting objects, or of a selection box */
  static beginPress(clientX: number, clientY: number, shift: boolean, alt: boolean = false) {
    this.press = null;
    if (!GMManager.isGMUser() || GMManager.activeTool !== 'select' || GMManager.controlMode === 'POSSESS') return;
    this.updateMouseRaycast(clientX, clientY);
    const picked = this.pickObjectAtCursor(true);
    const ground = this.hasValidRaycastPoint ? this.lastRaycastPoint.clone() : null;
    if (picked && alt && GMObjectKind.isPlaceable(picked)) {
      this.press = { kind: 'lift', x: clientX, y: clientY, picked, ground, started: false, moving: [], lastSent: 0 };
    } else if (picked && !shift) {
      if (GMObjectKind.isDoor(picked) || !ground) return;
      this.press = { kind: 'move', x: clientX, y: clientY, picked, ground, started: false, moving: [], lastSent: 0 };
    } else if (!picked && shift) {
      this.press = { kind: 'box', x: clientX, y: clientY, picked: null, ground, started: false, moving: [], lastSent: 0 };
    } else {
      return;
    }
    // The free camera doesn't turn while this press is ours
    GMManager.viewportDragging = true;
  }

  static updatePress(clientX: number, clientY: number) {
    const press = this.press;
    if (!press) return;
    if (!press.started) {
      if (Math.hypot(clientX - press.x, clientY - press.y) <= this.DRAG_THRESHOLD) return;
      press.started = true;
      this.setHovered(null);
      if (press.kind !== 'box' && press.picked) {
        // Dragging something not selected moves it alone; dragging part of the selection moves all of it
        if (!GMManager.isSelected(press.picked)) GMManager.selectObject(press.picked);
        const list = this.movableSelection().filter((o) => press.kind === 'move' || GMObjectKind.isPlaceable(o));
        press.moving = list.map((obj) => ({ obj, start: obj.position.clone() }));
        press.history = GMHistory.begin(`${press.kind === 'lift' ? 'Raise' : 'Move'} ${GMHistory.nameOf(list)}`, list);
      }
    }
    if (press.kind === 'box') {
      this.drawBox(press.x, press.y, clientX, clientY);
      return;
    }
    const now = performance.now();
    if (press.kind === 'lift') {
      const dz = (press.y - clientY) * this.LIFT_PER_PIXEL;
      const sendLift = now - press.lastSent >= this.DRAG_SEND_MS;
      if (sendLift) press.lastSent = now;
      for (const m of press.moving) {
        const pos = m.start.clone();
        pos.z += dz;
        if (sendLift) GMManager.teleportObject(m.obj, pos);
        else GMManager.placeAt(m.obj, pos);
      }
      return;
    }
    this.updateMouseRaycast(clientX, clientY);
    if (!this.hasValidRaycastPoint || !press.ground) return;
    const delta = this.lastRaycastPoint.clone().sub(press.ground);
    // Grid snap puts the one grabbed on the grid, and moves the rest with it
    if (this.gridSnapSize > 0) {
      const lead = press.moving.find((m) => m.obj === press.picked) || press.moving[0];
      if (lead) {
        const snapped = this.snapVectorToGrid(lead.start.clone().add(delta));
        delta.x = snapped.x - lead.start.x;
        delta.y = snapped.y - lead.start.y;
      }
    }
    const send = now - press.lastSent >= this.DRAG_SEND_MS;
    if (send) press.lastSent = now;
    for (const m of press.moving) this.moveTo(m, delta, send);
  }

  /** A dragged object at its start plus how far the mouse has moved over the ground, standing on the ground there */
  static moveTo(m: { obj: ModuleObject; start: THREE.Vector3 }, delta: THREE.Vector3, send: boolean) {
    if (m.obj.destroyed) return;
    const x = m.start.x + delta.x;
    const y = m.start.y + delta.y;
    const pos = new THREE.Vector3(x, y, this.floorBelow(x, y, m.start.z + delta.z));
    if (send) GMManager.teleportObject(m.obj, pos);
    else GMManager.placeAt(m.obj, pos);
  }

  /**
   * The walkable floor under a point, looking down from a little above it (from high up, indoors, the first
   * thing under it would be a roof); the point's own height when there's no floor there
   */
  static floorBelow(x: number, y: number, z: number): number {
    const walkmeshes = GameState.walkmeshList || [];
    if (!walkmeshes.length) return z;
    const ray = new THREE.Raycaster(new THREE.Vector3(x, y, z + 1.5), new THREE.Vector3(0, 0, -1), 0, 20);
    const hit = ray.intersectObjects(walkmeshes, true)[0];
    return hit ? hit.point.z : z;
  }

  /** The button came up (at a point), or the window lost focus (null): finish the move or the box */
  static endPress(at: { x: number; y: number } | null) {
    const press = this.press;
    this.press = null;
    GMManager.viewportDragging = false;
    this.hideBox();
    if (!press?.started) return;
    if (press.kind !== 'box') {
      // Where each one ended up reaches the players
      const moved = press.moving.filter((m) => !m.obj.destroyed);
      for (const m of moved) GMManager.teleportObject(m.obj, m.obj.position.clone());
      press.history?.commit();
      GMLog.info('world', `Moved ${moved.length} object${moved.length === 1 ? '' : 's'}`);
      return;
    }
    if (!at) return;
    GMManager.setSelection([...GMManager.selectedObjects(), ...this.objectsInBox(press.x, press.y, at.x, at.y)]);
  }

  /** Creatures and placeables standing inside a box drawn on the screen */
  static objectsInBox(x0: number, y0: number, x1: number, y1: number): ModuleObject[] {
    const area = GameState.module?.area;
    const canvas = GameState.canvas;
    const cam = this.getActiveThreeCamera();
    if (!area || !canvas || !cam) return [];
    const rect = canvas.getBoundingClientRect();
    const left = Math.min(x0, x1), right = Math.max(x0, x1);
    const top = Math.min(y0, y1), bottom = Math.max(y0, y1);
    const candidates = [...new Set([...GameState.PartyManager.party, ...area.creatures, ...area.placeables])] as ModuleObject[];
    const v = new THREE.Vector3();
    return candidates.filter((obj) => {
      if (!obj?.position || obj.destroyed || obj.gmPinned) return false;
      v.copy(obj.position).project(cam);
      if (v.z < -1 || v.z > 1) return false; // behind the camera
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      return sx >= left && sx <= right && sy >= top && sy <= bottom;
    });
  }

  static drawBox(x0: number, y0: number, x1: number, y1: number) {
    if (typeof document === 'undefined') return;
    if (!this.boxElement) {
      const el = document.createElement('div');
      el.className = 'gm-select-box';
      Object.assign(el.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: '50',
        border: '1px solid #00e5ff', background: 'rgba(0, 229, 255, 0.12)',
      });
      document.body.appendChild(el);
      this.boxElement = el;
    }
    Object.assign(this.boxElement.style, {
      display: 'block',
      left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`,
      width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px`,
    });
  }

  static hideBox() {
    if (this.boxElement) this.boxElement.style.display = 'none';
  }

  static getActiveThreeCamera(): THREE.Camera {
    if (GameState.Mode === EngineMode.INGAME && GameState.followerCamera) {
      return GameState.followerCamera;
    }
    return GameState.currentCamera || GameState.camera;
  }

  static snapVectorToGrid(pt: THREE.Vector3): THREE.Vector3 {
    const out = pt.clone();
    if (this.gridSnapSize > 0) {
      out.x = Math.round(out.x / this.gridSnapSize) * this.gridSnapSize;
      out.y = Math.round(out.y / this.gridSnapSize) * this.gridSnapSize;
    }
    return out;
  }

  static getGroundZAt(x: number, y: number, fallbackZ: number = 0): number {
    const targets: THREE.Object3D[] = [];
    if (GameState.walkmeshList?.length) targets.push(...GameState.walkmeshList);
    if (GameState.group?.rooms) targets.push(GameState.group.rooms);
    if (!targets.length) return fallbackZ;

    const downRay = new THREE.Raycaster(
      new THREE.Vector3(x, y, fallbackZ + 15),
      new THREE.Vector3(0, 0, -1)
    );
    const hits = downRay.intersectObjects(targets, true);
    if (hits.length > 0) {
      return hits[0].point.z;
    }
    return fallbackZ;
  }

  static updateMouseRaycast(clientX: number, clientY: number) {
    const canvas = GameState.canvas;
    if (!canvas || !GameState.module?.area) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    this.mouseNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    const cam = this.getActiveThreeCamera();
    if (!cam) return;

    this.raycaster.setFromCamera(this.mouseNDC, cam);

    // Raycast against walkmeshes and room models
    const targets: THREE.Object3D[] = [];
    if (GameState.walkmeshList?.length) {
      targets.push(...GameState.walkmeshList);
    }
    if (GameState.group?.rooms) {
      targets.push(GameState.group.rooms);
    }

    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length > 0) {
      const snapped = GMManager.activeTool !== 'select' ? this.snapVectorToGrid(hits[0].point) : hits[0].point.clone();
      this.lastRaycastPoint.copy(snapped);
      this.hasValidRaycastPoint = true;
      if (this.placementRing && GMManager.activeTool !== 'select') {
        const zOff = GMManager.activeTool === 'place_placeable' ? (GMManager.pendingPlaceableConfig.zOffset || 0) : 0;
        this.placementRing.position.set(snapped.x, snapped.y, snapped.z + zOff + 0.08);
        this.placementRing.visible = true;
      } else if (this.placementRing) {
        this.placementRing.visible = false;
      }
    } else {
      this.hasValidRaycastPoint = false;
      if (this.placementRing) this.placementRing.visible = false;
    }
  }

  static async handleViewportClick(clientX: number, clientY: number, isDoubleClick: boolean = false, shift: boolean = false) {
    this.updateMouseRaycast(clientX, clientY);

    if (GMManager.activeTool === 'select') {
      const picked = this.pickObjectAtCursor(true);
      // Shift + click adds to the selection, or takes out what's already in it; Shift + click on nothing keeps it
      if (shift) {
        if (picked) GMManager.selectObject(picked, 'toggle');
        return;
      }
      GMManager.selectObject(picked);
      if (isDoubleClick && picked) {
        // The GM panel opens its Inspect tab on this
        GMManager.events.dispatchEvent('inspect', picked);
      }
      return;
    }

    if (this.isOrderTool(GMManager.activeTool)) {
      this.handleOrderClick();
      return;
    }

    if (GMManager.activeTool === 'face') {
      const picked = this.pickObjectAtCursor();
      const point = picked && !GMManager.isSelected(picked) ? picked.position : (this.hasValidRaycastPoint ? this.lastRaycastPoint : null);
      if (point) GMEditTools.faceToward(this.movableSelection(), point.clone());
      GMManager.setToolMode('select');
      return;
    }

    if (!this.hasValidRaycastPoint) return;
    const spawnPos = this.snapVectorToGrid(this.lastRaycastPoint);
    const cam = this.getActiveThreeCamera();
    const baseFacing = cam ? Math.atan2(cam.position.x - spawnPos.x, cam.position.y - spawnPos.y) : 0;
    const yawRad = (this.placementYawOffset * Math.PI) / 180;
    const facing = Utility.NormalizeRadian(baseFacing + yawRad);

    if (GMManager.activeTool === 'place_creature') {
      const creature = await GMSpawner.spawnCreature(GMManager.pendingCreatureConfig, spawnPos, facing);
      if (creature) this.placed(creature);
    } else if (GMManager.activeTool === 'place_placeable') {
      const plc = await GMSpawner.spawnPlaceable(GMManager.pendingPlaceableConfig, spawnPos, facing);
      if (plc) this.placed(plc);
    } else if (GMManager.activeTool === 'place_player') {
      const player = await GMSpawner.spawnPlayerCharacter(GMManager.pendingPlayerConfig, spawnPos, facing);
      if (player) GMManager.selectObject(player);
      GMManager.setToolMode('select');
    } else if (GMManager.activeTool === 'place_mine') {
      GMMines.placeMine(GMMines.pendingMineType, spawnPos);
    } else if (GMManager.activeTool === 'teleport') {
      const target = this.getTeleportTarget();
      if (target) {
        GMManager.teleportObject(target, spawnPos);
      }
    }
  }

  /** Something just placed: hidden if the GM is setting a scene up out of sight, selected, and undoable */
  static placed(obj: ModuleObject) {
    if (GMEditTools.placeHidden) GMManager.setObjectHidden(obj, true);
    GMHistory.created(`Place ${GMHistory.nameOf([obj])}`, [obj]);
    GMManager.selectObject(obj);
  }

  static isPlacementTool(tool: GMToolMode): boolean {
    return tool === 'place_creature' || tool === 'place_placeable' || tool === 'place_player' || tool === 'place_mine';
  }

  static rotatePlacement(degrees: number) {
    this.placementYawOffset = ((this.placementYawOffset + degrees) % 360 + 360) % 360;
    GMManager.notifyChange();
  }

  /**
   * What Teleport will move: the selected object, or while playing as a character, that character.
   * Nothing otherwise, so a stray click can't silently move someone.
   */
  static getTeleportTarget(): ModuleObject | null {
    if (GMManager.selectedObject) return GMManager.selectedObject;
    if (GMManager.controlMode === 'POSSESS') return GameState.getCurrentPlayer() || null;
    return null;
  }

  /** What's under the mouse; with skipPinned, pinned scenery is see-through (selecting and dragging) */
  static pickObjectAtCursor(skipPinned: boolean = false): ModuleObject | null {
    const area = GameState.module?.area;
    if (!area) return null;

    const candidates: ModuleObject[] = [
      ...GameState.PartyManager.party,
      ...area.creatures,
      ...area.placeables,
      ...area.doors
    ].filter((o) => !(skipPinned && o?.gmPinned));

    // First try 3D mesh raycast
    const meshes: THREE.Object3D[] = [];
    for (const obj of candidates) {
      if (obj?.container) meshes.push(obj.container);
    }

    const hits = this.raycaster.intersectObjects(meshes, true);
    for (const hit of hits) {
      let cur: THREE.Object3D | null = hit.object;
      while (cur) {
        if (cur.userData?.moduleObject && candidates.includes(cur.userData.moduleObject)) {
          return cur.userData.moduleObject as ModuleObject;
        }
        const match = candidates.find(c => c.container === cur || c.model === cur);
        if (match) return match;
        cur = cur.parent;
      }
    }

    // Fallback: closest object to walkmesh intersection point within 1.75m
    if (this.hasValidRaycastPoint) {
      let best: ModuleObject | null = null;
      let bestDist = 1.75;
      for (const obj of candidates) {
        if (!obj?.position) continue;
        const d = Math.hypot(obj.position.x - this.lastRaycastPoint.x, obj.position.y - this.lastRaycastPoint.y);
        if (d < bestDist) {
          bestDist = d;
          best = obj;
        }
      }
      return best;
    }

    return null;
  }

  static isOrderTool(tool: GMToolMode): boolean {
    return tool === 'order_move' || tool === 'order_attack' || tool === 'order_follow' || tool === 'order_patrol';
  }

  static getCameraTargetSpawnPoint(distance: number = 3.5): { position: THREE.Vector3; facing: number } {
    if (GMManager.controlMode === 'POSSESS' && GameState.getCurrentPlayer()) {
      const p = GameState.getCurrentPlayer();
      const angle = p.getFacing();
      const pos = new THREE.Vector3(
        p.position.x - Math.sin(angle) * 2.5,
        p.position.y + Math.cos(angle) * 2.5,
        p.position.z
      );
      return { position: pos, facing: Utility.NormalizeRadian(angle + Math.PI) };
    }

    const cam = this.getActiveThreeCamera();
    if (!cam) {
      const area = GameState.module?.area;
      return {
        position: new THREE.Vector3(area?.module?.entryX || 0, area?.module?.entryY || 0, area?.module?.entryZ || 0),
        facing: 0
      };
    }

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const ray = new THREE.Raycaster(cam.position.clone(), forward.clone().normalize());
    const targets: THREE.Object3D[] = [];
    if (GameState.walkmeshList?.length) targets.push(...GameState.walkmeshList);
    if (GameState.group?.rooms) targets.push(GameState.group.rooms);

    const hits = ray.intersectObjects(targets, true);
    if (hits.length > 0 && hits[0].distance < 35) {
      const pt = hits[0].point.clone();
      const facing = Math.atan2(cam.position.x - pt.x, cam.position.y - pt.y);
      return { position: pt, facing };
    }

    // Fallback: project forward and snap Z down onto walkmesh
    const fallbackPos = cam.position.clone().addScaledVector(forward, distance);
    const downRay = new THREE.Raycaster(
      new THREE.Vector3(fallbackPos.x, fallbackPos.y, fallbackPos.z + 10),
      new THREE.Vector3(0, 0, -1)
    );
    const downHits = downRay.intersectObjects(targets, true);
    if (downHits.length > 0) {
      fallbackPos.z = downHits[0].point.z;
    } else if (GameState.module) {
      fallbackPos.z = GameState.module.entryZ || 0;
    }
    const facing = Math.atan2(cam.position.x - fallbackPos.x, cam.position.y - fallbackPos.y);
    return { position: fallbackPos, facing };
  }

  /**
   * Start an order that needs a click in the world (where to go, whom to attack or follow, patrol points),
   * for one NPC or several: a group keeps its layout around where it's sent
   */
  static startOrderTool(tool: GMToolMode, who: ModuleCreature | ModuleCreature[]) {
    const subjects = (Array.isArray(who) ? who : [who]).filter((c) => GMManager.canOrder(c));
    if (!this.isOrderTool(tool) || !subjects.length) return;
    GMManager.setToolMode(tool);
    this.orderSubjects = subjects;
    this.patrolDraft = tool === 'order_patrol' ? [this.groupPoint(subjects)] : [];
    GMManager.notifyChange();
  }

  /** The middle of a group of NPCs (one NPC: where it stands) */
  static groupPoint(list: ModuleCreature[]): GMPoint {
    return GMManager.pointOf({ position: GMEditTools.centreOf(list) });
  }

  /** A point moved by where an NPC stands from the middle of its group, so the group arrives in its layout */
  static offsetPoint(p: GMPoint, cre: ModuleCreature, centre: GMPoint): GMPoint {
    return { x: p.x + cre.position.x - centre.x, y: p.y + cre.position.y - centre.y, z: p.z };
  }

  /** A click in the world with an order tool */
  static handleOrderClick() {
    const subjects = this.orderSubjects.filter((c) => GMManager.canOrder(c));
    if (!subjects.length) {
      GMManager.setToolMode('select');
      return;
    }
    const tool = GMManager.activeTool;
    if (tool === 'order_move' || tool === 'order_patrol') {
      if (!this.hasValidRaycastPoint) return;
      const p = this.lastRaycastPoint;
      if (tool === 'order_move') {
        const centre = this.groupPoint(subjects);
        const target = { x: p.x, y: p.y, z: p.z };
        GMHistory.track(`Send ${GMHistory.nameOf(subjects)}`, subjects, () => {
          for (const cre of subjects) GMManager.giveOrder(cre, { kind: 'move', point: subjects.length > 1 ? this.offsetPoint(target, cre, centre) : target });
        });
        GMManager.setToolMode('select');
      } else {
        this.patrolDraft.push({ x: p.x, y: p.y, z: p.z });
        GMManager.notifyChange();
      }
      return;
    }
    const picked = this.pickObjectAtCursor();
    if (!picked || !GMObjectKind.isCreature(picked)) return;
    const netId = picked.gmNetId as string | undefined;
    const who = subjects.filter((c) => c !== picked);
    if (!netId || !who.length) return;
    const verb = tool === 'order_attack' ? 'attack' : 'follow';
    GMHistory.track(`Order ${GMHistory.nameOf(who)} to ${verb}`, who, () => {
      for (const cre of who) GMManager.giveOrder(cre, tool === 'order_attack' ? { kind: 'attack', targetNetId: netId } : { kind: 'follow', targetNetId: netId });
    });
    GMManager.setToolMode('select');
  }

  /** Putting down the patrol tool: patrol the points clicked (with where it started), if any were */
  static finishPatrolOrder() {
    const subjects = this.orderSubjects.filter((c) => GMManager.canOrder(c));
    const points = this.patrolDraft;
    this.patrolDraft = [];
    if (!subjects.length || points.length < 2) return;
    const centre = points[0];
    GMHistory.track(`Patrol ${GMHistory.nameOf(subjects)}`, subjects, () => {
      for (const cre of subjects) {
        const own = subjects.length > 1 ? points.map((p) => this.offsetPoint(p, cre, centre)) : points;
        GMManager.giveOrder(cre, { kind: 'patrol', points: own, index: 1 });
      }
    });
  }
}

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

/** The GM's viewport: picking, placement and order tools, the selection and placement rings, and where the camera is looking. */
export class GMViewport {
  // Architectural & Scene Builder placement helpers
  static gridSnapSize: number = 0; // 0 = Off, 0.5, 1.0, 2.0

  static placementYawOffset: number = 0; // degrees (0..360)

  // Degrees per placement rotation step: R / Shift+R, and per mouse-wheel notch
  static PLACEMENT_KEY_STEP: number = 45;

  static PLACEMENT_WHEEL_STEP: number = 15;

  /** The NPC an order tool (order_move, order_attack...) is giving its order to */
  static orderSubject: ModuleCreature | null = null;

  /** Patrol points clicked so far with the order_patrol tool */
  static patrolDraft: GMPoint[] = [];

  // 3D viewport visual indicators
  static selectionRing: THREE.Mesh | null = null;

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

  /** The ring under the selected object, coloured by its side (red hostile, green party, amber others, cyan objects) */
  static updateSelectionRing(selected: ModuleObject | null) {
    if (!this.selectionRing) return;
    if (!selected?.position) {
      this.selectionRing.visible = false;
      return;
    }
    this.selectionRing.visible = true;
    this.selectionRing.position.set(selected.position.x, selected.position.y, selected.position.z + 0.08);
    const mat = this.selectionRing.material as THREE.MeshBasicMaterial;
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
    });

    window.addEventListener('pointermove', (e: PointerEvent) => {
      if (!GameState.gmMode) return;
      const target = e.target as HTMLElement;
      if (target && target.closest('.gm-panel-root')) {
        if (this.placementRing) this.placementRing.visible = false;
        return;
      }
      this.updateMouseRaycast(e.clientX, e.clientY);
    });

    // While placing, the mouse wheel turns what's being placed
    window.addEventListener('wheel', (e: WheelEvent) => {
      if (!GameState.gmMode || !this.isPlacementTool(GMManager.activeTool) || !GMManager.isGMUser()) return;
      const target = e.target as HTMLElement;
      if (target && target.closest('.gm-panel-root')) return;
      this.rotatePlacement(e.deltaY > 0 ? this.PLACEMENT_WHEEL_STEP : -this.PLACEMENT_WHEEL_STEP);
    }, { passive: true });

    window.addEventListener('pointerup', (e: PointerEvent) => {
      if (!GameState.gmMode || (e.button !== 0 && e.button !== 2) || !GMManager.isGMUser()) return;
      const target = e.target as HTMLElement;
      if (target && target.closest('.gm-panel-root')) return;

      // Ignore drags (camera rotation)
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      if (Math.hypot(dx, dy) > 6) return;

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

      this.handleViewportClick(e.clientX, e.clientY, isDoubleClick);
    });
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

  static async handleViewportClick(clientX: number, clientY: number, isDoubleClick: boolean = false) {
    this.updateMouseRaycast(clientX, clientY);

    if (GMManager.activeTool === 'select') {
      const picked = this.pickObjectAtCursor();
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

    if (!this.hasValidRaycastPoint) return;
    const spawnPos = this.snapVectorToGrid(this.lastRaycastPoint);
    const cam = this.getActiveThreeCamera();
    const baseFacing = cam ? Math.atan2(cam.position.x - spawnPos.x, cam.position.y - spawnPos.y) : 0;
    const yawRad = (this.placementYawOffset * Math.PI) / 180;
    const facing = Utility.NormalizeRadian(baseFacing + yawRad);

    if (GMManager.activeTool === 'place_creature') {
      const creature = await GMSpawner.spawnCreature(GMManager.pendingCreatureConfig, spawnPos, facing);
      if (creature) GMManager.selectObject(creature);
    } else if (GMManager.activeTool === 'place_placeable') {
      const plc = await GMSpawner.spawnPlaceable(GMManager.pendingPlaceableConfig, spawnPos, facing);
      if (plc) GMManager.selectObject(plc);
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

  static pickObjectAtCursor(): ModuleObject | null {
    const area = GameState.module?.area;
    if (!area) return null;

    const candidates: ModuleObject[] = [
      ...GameState.PartyManager.party,
      ...area.creatures,
      ...area.placeables,
      ...area.doors
    ];

    // First try 3D mesh raycast
    const meshes: THREE.Object3D[] = [];
    for (const obj of candidates) {
      if (obj?.container) meshes.push(obj.container);
    }

    const hits = this.raycaster.intersectObjects(meshes, true);
    for (const hit of hits) {
      let cur: THREE.Object3D | null = hit.object;
      while (cur) {
        if (cur.userData?.moduleObject) {
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

  /** Start an order that needs a click in the world (where to go, whom to attack or follow, patrol points) */
  static startOrderTool(tool: GMToolMode, cre: ModuleCreature) {
    if (!this.isOrderTool(tool) || !GMManager.canOrder(cre)) return;
    GMManager.setToolMode(tool);
    this.orderSubject = cre;
    this.patrolDraft = tool === 'order_patrol' ? [GMManager.pointOf(cre)] : [];
    GMManager.notifyChange();
  }

  /** A click in the world with an order tool */
  static handleOrderClick() {
    const cre = this.orderSubject;
    if (!cre || !GMManager.canOrder(cre)) {
      GMManager.setToolMode('select');
      return;
    }
    const tool = GMManager.activeTool;
    if (tool === 'order_move' || tool === 'order_patrol') {
      if (!this.hasValidRaycastPoint) return;
      const p = this.lastRaycastPoint;
      if (tool === 'order_move') {
        GMManager.giveOrder(cre, { kind: 'move', point: { x: p.x, y: p.y, z: p.z } });
        GMManager.setToolMode('select');
      } else {
        this.patrolDraft.push({ x: p.x, y: p.y, z: p.z });
        GMManager.notifyChange();
      }
      return;
    }
    const picked = this.pickObjectAtCursor();
    if (!picked || picked === cre || !GMObjectKind.isCreature(picked)) return;
    const netId = picked.gmNetId as string | undefined;
    if (!netId) return;
    GMManager.giveOrder(cre, tool === 'order_attack' ? { kind: 'attack', targetNetId: netId } : { kind: 'follow', targetNetId: netId });
    GMManager.setToolMode('select');
  }

  /** Putting down the patrol tool: patrol the points clicked (with where it started), if any were */
  static finishPatrolOrder() {
    const cre = this.orderSubject;
    const points = this.patrolDraft;
    this.patrolDraft = [];
    if (cre && points.length >= 2) GMManager.giveOrder(cre, { kind: 'patrol', points, index: 1 });
  }
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import * as KotOR from "@/apps/game/KotOR";
import type { GMCharacter } from "@/managers/gm/GMTypes";

type Previewed = Pick<GMCharacter, 'appearanceId' | 'appearanceLabel' | 'portraitId' | 'gender' | 'alignment' | 'gear'>;

/** Frames per second the preview draws at while it's on screen */
const FPS = 30;

/** Models face +Y; turned half round, they face the camera */
const FACING_CAMERA = Math.PI;

/** Idle animations, in the order tried: people stand in pause1; droids and creatures name theirs differently */
const IDLE_ANIMATIONS = ['pause1', 'cpause1', 'pause', 'pause2', 'cpause2'];

/**
 * The character's model, turning slowly in its idle pose; drag (or use the arrow keys) to turn it. It has its
 * own small WebGL canvas and scene (the game's LBL_3DView, as the game's character screens use), draws only
 * while it's on screen, and reloads only when the body, head or gear changes.
 */
export const ModelPreview: React.FC<{ character: Previewed }> = React.memo(({ character }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty'>('loading');
  const stage = useRef<{
    renderer: THREE.WebGLRenderer;
    view: any;
    model: any;
    yaw: number;
    dragging: boolean;
    turned: boolean;
  } | null>(null);

  // What changes the model: not the name, class or abilities
  const look = useMemo(() => JSON.stringify({
    a: character.appearanceId, l: character.appearanceLabel, p: character.portraitId, g: character.gender,
    al: character.alignment, gear: character.gear || {},
  }), [character.appearanceId, character.appearanceLabel, character.portraitId, character.gender, character.alignment, character.gear]);

  // The canvas, scene and draw loop, for as long as the preview is open
  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const view = new KotOR.LBL_3DView(canvas.clientWidth || 260, canvas.clientHeight || 240);
    view.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(2, -3, 4);
    view.scene.add(key);
    stage.current = { renderer, view, model: null, yaw: FACING_CAMERA, dragging: false, turned: false };

    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      view.camera.aspect = w / h;
      view.camera.updateProjectionMatrix();
    };
    const resizer = new ResizeObserver(resize);
    resizer.observe(canvas);
    resize();

    // Draw only while on screen and the page is visible
    let onScreen = true;
    const seen = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; });
    seen.observe(canvas);

    let raf = 0, last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (!onScreen || document.hidden || t - last < 1000 / FPS - 2) return;
      const delta = last ? Math.min(0.1, (t - last) / 1000) : 0;
      last = t;
      const s = stage.current!;
      if (s.model) {
        // Turn slowly until the player turns it themselves
        if (!s.turned && !s.dragging) s.yaw += delta * 0.4;
        s.model.rotation.z = s.yaw;
        s.model.update(delta);
      }
      view.frustumMat4.multiplyMatrices(view.camera.projectionMatrix, view.camera.matrixWorldInverse);
      view.viewportFrustum.setFromProjectionMatrix(view.frustumMat4);
      renderer.render(view.scene, view.camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      resizer.disconnect();
      seen.disconnect();
      const s = stage.current;
      if (s?.model) { s.model.removeFromParent(); try { s.model.dispose(); } catch (e) {} }
      renderer.dispose();
      renderer.forceContextLoss();
      stage.current = null;
    };
  }, []);

  // The model: loaded again whenever what it looks like changes
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    (async () => {
      const s = stage.current;
      if (!s) return;
      try {
        const creature = new KotOR.ModuleCreature(KotOR.GMCharacters.previewTemplate(character));
        creature.setContext(s.view);
        creature.load();
        const model = await creature.loadModel();
        await KotOR.TextureLoader.LoadQueue();
        if (cancelled || !stage.current) { try { model?.dispose(); } catch (e) {} return; }
        if (s.model) { s.model.removeFromParent(); try { s.model.dispose(); } catch (e) {} }
        s.model = null;
        if (!model || !model.children.length) { setStatus('empty'); return; }
        model.removeFromParent();
        model.position.set(0, 0, 0);
        model.rotation.set(0, 0, 0);
        s.view.addModel(model);
        playIdle(model);
        model.update(0);
        model.updateMatrixWorld(true);
        frame(s.view.camera, model);
        model.rotation.z = s.yaw;
        s.model = model;
        setStatus('ready');
      } catch (e) {
        console.error('ModelPreview', e);
        if (!cancelled) setStatus('empty');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look]);

  const drag = useRef<{ x: number } | null>(null);
  return (
    <div className="cc-preview">
      <canvas
        ref={canvasRef}
        className="cc-preview-canvas"
        tabIndex={0}
        aria-label="Model preview: drag or use the arrow keys to turn it"
        onPointerDown={(e) => { drag.current = { x: e.clientX }; e.currentTarget.setPointerCapture(e.pointerId); if (stage.current) { stage.current.dragging = true; stage.current.turned = true; } }}
        onPointerMove={(e) => { if (!drag.current || !stage.current) return; stage.current.yaw += (e.clientX - drag.current.x) * 0.012; drag.current.x = e.clientX; }}
        onPointerUp={() => { drag.current = null; if (stage.current) stage.current.dragging = false; }}
        onKeyDown={(e) => {
          if (!stage.current || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
          e.preventDefault();
          stage.current.turned = true;
          stage.current.yaw += e.key === 'ArrowLeft' ? -0.25 : 0.25;
        }}
      />
      {status !== 'ready' && <div className="cc-preview-note">{status === 'loading' ? 'Loading model…' : 'This model can\'t be shown.'}</div>}
    </div>
  );
});

/** The model's idle animation: the first of IDLE_ANIMATIONS it has, else any pause */
function playIdle(model: any) {
  const map: Map<string, any> = model.odysseyAnimationMap || new Map();
  const name = IDLE_ANIMATIONS.find((n) => map.has(n)) || [...map.keys()].find((n) => /pause/.test(n));
  if (name) try { model.playAnimation(name, true); } catch (e) {}
}

/** Point the camera at the model from the front, with all of it in view */
function frame(camera: THREE.PerspectiveCamera, model: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, 0.5, 2));
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const fit = Math.max(size.z, Math.max(size.x, size.y) / Math.max(0.5, camera.aspect)) * 1.15;
  const distance = (fit / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.up.set(0, 0, 1);
  camera.position.set(center.x, center.y - distance, center.z + size.z * 0.05);
  camera.lookAt(center);
  camera.near = Math.max(0.01, distance / 100);
  camera.far = distance * 10;
  camera.updateProjectionMatrix();
}

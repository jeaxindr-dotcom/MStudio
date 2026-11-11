// « Mise en scène » (user wish since E03: « me déplacer en 3D dans la scène et déplacer moi-même les objets sans affecter
// les images clés »). In the live preview only: pick an object (pixel-exact, as the pins), move / turn / scale it with a
// gizmo or the arrow keys, look around with a free camera — and send the offset to Claude, who writes it in the code.
// Nothing here changes the engine nor the keyframes: an offset is applied ON TOP of what Stage.tsx computes, every frame,
// inside its scope (a range of frames), in the parent's space of the object (set-local for a set piece).
//   the object moved: a set flat → its mesh; a prop / float → its keyed <group> (mesh + glow); an actor → its <group>
//   an image of the library dropped on the preview (« Médias ») → a cardboard cutout made here, « @media:… » (addCutout)
import * as THREE from 'three';
import { addEffect, addAfterEffect } from '@react-three/fiber';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { stageModeKey, toParent } from './keys';
import { sceneTargets } from './stage-elements';
import { createGuides } from './stage-guides';
import { fitObject } from './stage-focus';

type V3 = [number, number, number];
export interface Delta { p: V3; r: V3; s: number }          // position (world units), rotation (radians), uniform scale factor
interface Edit { id: string; delta: Delta; from: number; to: number; obj: THREE.Object3D | null; base: { p: THREE.Vector3; r: THREE.Euler; s: THREE.Vector3 } | null; applied: { p: THREE.Vector3; r: THREE.Euler; s: THREE.Vector3 } | null; retryAt?: number }
interface Deps {
  roots: () => any[];                                   // the R3F roots (one per canvas)
  index: (root: any) => void;                           // map THREE objects -> their React fibers
  fiberOf: WeakMap<object, any>;
  reactPath: (o: THREE.Object3D) => string;
  describe: (o: THREE.Object3D) => { type: string; names: string[]; textures: string[] };
  seen: (hit: THREE.Intersection) => boolean;
  frame: () => number;
  noise: RegExp;
  W?: number; H?: number;                               // the frame (1920 × 1080 for an episode; a run's 3D shot: its own size)
}
export const ZERO: Delta = { p: [0, 0, 0], r: [0, 0, 0], s: 1 };
const isZero = (d: Delta) => d.p.every((v) => Math.abs(v) < 1e-6) && d.r.every((v) => Math.abs(v) < 1e-6) && Math.abs(d.s - 1) < 1e-6;

type ViewCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
type CameraView = { p: THREE.Vector3; q: THREE.Quaternion; zoom: number; near: number; far: number; centered: boolean };
type SavedView = { p: number[]; q: number[]; target?: number[]; zoom?: number; near?: number; far?: number; centered?: boolean };
function readView(cam: ViewCamera, centered = false): CameraView {
  return {p: cam.position.clone(), q: cam.quaternion.clone(), zoom: cam.zoom, near: cam.near, far: cam.far, centered};
}
function applyView(cam: ViewCamera, view: CameraView, restoreProjection = false) {
  cam.position.copy(view.p); cam.quaternion.copy(view.q);
  const changed = cam.zoom !== view.zoom || cam.near !== view.near || cam.far !== view.far;
  cam.zoom = view.zoom; cam.near = view.near; cam.far = view.far;
  if (changed || restoreProjection) cam.updateProjectionMatrix();
  // Shot cameras may have an off-centre lens or view offset. While focused,
  // retain the lens scale and put the orbit target at the centre of the preview.
  if (view.centered) {
    const xy = (cam as THREE.PerspectiveCamera).isPerspectiveCamera ? 8 : 12;
    const projection = cam.projectionMatrix;
    if (projection.elements[xy] || projection.elements[xy + 1]) {
      projection.elements[xy] = 0; projection.elements[xy + 1] = 0;
      cam.projectionMatrixInverse.copy(projection).invert();
    }
  }
  cam.updateMatrixWorld();
}
function defaultTarget(view: CameraView) {
  return new THREE.Vector3(0, 0, -8).applyQuaternion(view.q).add(view.p);
}

export function createStage(D: Deps) {
  const edits = new Map<string, Edit>();
  const listeners = new Set<(ev: any) => void>();
  const emit = (ev: any) => { for (const l of listeners) l(ev); };
  let on = false, st: any = null, canvas: HTMLCanvasElement | null = null;
  let tc: TransformControls | null = null, helper: THREE.Object3D | null = null, orbit: OrbitControls | null = null, box: THREE.BoxHelper | null = null;
  let selected: string | null = null, mode: 'translate' | 'rotate' | 'scale' = 'translate';
  let freeCam: CameraView | null = null, scenePose: CameraView | null = null, lastFree: CameraView | null = null;
  let capture: ((url: string) => void) | null = null;
  let guides: ReturnType<typeof createGuides> | null = null, guidesWanted=true;
  const worldTarget = () => {
    if (!orbit) return undefined;
    return st.camera.parent ? st.camera.parent.localToWorld(orbit.target.clone()) : orbit.target;
  };
  const localTarget = (world: THREE.Vector3): THREE.Vector3 => st.camera.parent ? st.camera.parent.worldToLocal(world.clone()) : world;
  const syncGuides=()=>guides?.update(st.camera,worldTarget(),!!freeCam,guidesWanted,!!capture);

  const mainRoot = () => D.roots().find((r) => r?.store?.getState?.().scene) ?? null;
  // the object to move for a hit mesh: the host just below the first keyed component, or a keyed host group itself
  function movable(mesh: THREE.Object3D): THREE.Object3D | null {
    let f: any = null;
    for (let p: THREE.Object3D | null = mesh; p && !f; p = p.parent) f = D.fiberOf.get(p);
    let lastHost: any = null;
    for (; f; f = f.return) {
      if (typeof f.type === 'string') { lastHost = f; if (f.key != null && f.stateNode?.object) return f.stateNode.object; }
      else if (typeof f.type === 'function' && f.key != null) return lastHost?.stateNode?.object ?? null;
    }
    return null;
  }
  // an object id = the React path of its mesh (« Stage › Piece[key="library-4-set_ladder"] »): stable across renders
  function resolve(id: string): THREE.Object3D | null {
    if (cutouts.has(id)) return cutouts.get(id)!.group;
    const root = mainRoot(); if (!root) return null;
    D.index(root);
    if (id.startsWith('@three/')) return sceneTargets(root.store.getState().scene, D.fiberOf, D.reactPath, movable).byId.get(id)?.object ?? null;
    let found: THREE.Object3D | null = null;
    root.store.getState().scene.traverse((o: any) => { if (!found && o.isMesh && D.reactPath(o) === id) found = movable(o); });
    return found;
  }
  const meshOf = (o: THREE.Object3D) => { let m: any = null; o.traverse((c: any) => { if (!m && c.isMesh) m = c; }); return m ?? o; };

  function elements() {
    const root = mainRoot(); if (!root) return [];
    D.index(root);
    const { byId } = sceneTargets(root.store.getState().scene, D.fiberOf, D.reactPath, movable);
    return [...Array.from(byId.values(), ({ id, name, object }) => ({ id, name, kind: object.type })),
      ...Array.from(cutouts, ([id, cut]) => ({ id, name: cut.spec.name, kind: 'cutout' }))];
  }

  // ---- « Médias » (user request, 08/10/2026: « quand je place l'image créée dans le décor, elle se met automatiquement en
  // carton 3D comme Brambleshire »): an image of the library dropped on the preview becomes a cardboard cutout at once,
  // made the way the Theatre's engine makes its flats (src/cardboard/cardboard.ts « layered »: the picture in front, cut
  // by its transparency, then the cardboard's edge layers — #a98159, darker towards the back — and its back #c8a77c;
  // 0.048 thick for a prop, 0.08 for a set piece; its origin at the bottom centre of what is drawn). It stands where it
  // was dropped: on the floor under the pointer, else in front of what is there. Its size: in a Theatre scene, the
  // engine's (a character ≈ 2.0 high), else a part of the view. Preview only: « Ajouter à la file » sends its place to
  // the agent, who adds it to the project; it is then an object of the staging like the others (moved, turned, sized).
  type CutBase = { p: V3; r: V3; h: number };
  type CutSpec = { id?: string; url: string; name: string; category?: string; at?: [number, number] | null; base?: CutBase | null };
  const cutouts = new Map<string, { group: THREE.Group; spec: CutSpec & { id: string; base: CutBase }; h: number; w: number; t: number; theatre: boolean; dispose: () => void }>();
  const THEATRE_H: Record<string, number> = { personnages: 2.0, decors: 2.6, accessoires: 0.8, effets: 1.0 };
  const VIEW_PART: Record<string, number> = { personnages: 0.45, decors: 0.6, accessoires: 0.22, effets: 0.3 };
  const cutoutOf = (o: THREE.Object3D | null) => { for (let p = o; p; p = p.parent) if (p.userData?.cutoutId && cutouts.has(p.userData.cutoutId)) return p.userData.cutoutId as string; return null; };
  const theatreLike = () => {
    const root = mainRoot(); if (!root) return false;
    D.index(root); let yes = false;
    root.store.getState().scene.traverse((o: any) => { if (!yes && o.isMesh && D.fiberOf.get(o) && /Stage › (Actor|Piece)\[/.test(D.reactPath(o) ?? '')) yes = true; });
    return yes;
  };
  const loadImage = (url: string) => new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error('image')); im.src = url; });
  function buildCard(img: HTMLImageElement, visH: number, thick: number) {
    const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
    const cw = Math.max(2, Math.round(img.naturalWidth * k)), ch = Math.max(2, Math.round(img.naturalHeight * k));
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0, cw, ch);
    const px = g.getImageData(0, 0, cw, ch), a = px.data;
    let top = -1, bottom = -1, left = cw, right = -1;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (a[(y * cw + x) * 4 + 3] >= 64) { if (top < 0) top = y; bottom = y; if (x < left) left = x; if (x > right) right = x; }
    if (top < 0) { top = 0; bottom = ch - 1; left = 0; right = cw - 1; }
    const H = visH * ch / (bottom - top + 1), W = H * cw / ch;
    const front = new THREE.CanvasTexture(cv); front.colorSpace = THREE.SRGBColorSpace; front.anisotropy = 4;
    for (let i = 0; i < a.length; i += 4) { a[i] = 255; a[i + 1] = 255; a[i + 2] = 255; }
    const sv = document.createElement('canvas'); sv.width = cw; sv.height = ch; sv.getContext('2d')!.putImageData(px, 0, 0);
    const sil = new THREE.CanvasTexture(sv);
    const geo = new THREE.PlaneGeometry(W, H); geo.translate(0, (bottom + 1) / ch * H - H / 2, 0);   // the origin: bottom centre of what is drawn
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: sil, alphaTest: 0.5 });
    const card = new THREE.Group(), mats: THREE.Material[] = [depth];
    const add = (mat: THREE.Material, z: number, back = false) => {
      const m = new THREE.Mesh(geo, mat); m.position.z = z; if (back) m.rotation.y = Math.PI;
      m.castShadow = true; m.receiveShadow = true; m.customDepthMaterial = depth; card.add(m); mats.push(mat);
    };
    add(new THREE.MeshStandardMaterial({ map: front, roughness: 0.92, alphaTest: 0.5 }), thick / 2);
    const K = Math.max(3, Math.round(thick / 0.003) + 1), edge = new THREE.Color('#a98159');
    for (let i = 1; i < K - 1; i++) {
      const v = 1 - i / (K - 1);   // 1 at the front, 0 at the back
      add(new THREE.MeshStandardMaterial({ map: sil, color: edge.clone().multiplyScalar(0.66 + 0.34 * v), roughness: 0.95, alphaTest: 0.72, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), thick / 2 - i * thick / (K - 1));
    }
    add(new THREE.MeshStandardMaterial({ map: sil, color: new THREE.Color('#c8a77c'), roughness: 0.95, alphaTest: 0.72 }), -thick / 2, true);
    const dispose = () => { geo.dispose(); front.dispose(); sil.dispose(); for (const m of mats) m.dispose(); };
    return { card, visW: W * (right - left + 1) / cw, dispose };   // what is drawn: visH high, visW wide
  }
  // where a drop at (fx, fy) of the frame lands: { p (the cutout's foot), face the camera?, its visible height }
  function landing(at: [number, number] | null, category: string, theatre: boolean) {
    const root = mainRoot()!, S = root.store.getState(), cam = S.camera as THREE.PerspectiveCamera, c = S.gl.domElement as HTMLCanvasElement;
    const FW = D.W ?? 1920, FH = D.H ?? 1080, [fx, fy] = at ?? [FW / 2, FH * 0.62];
    const stageEl = document.getElementById('stage')?.getBoundingClientRect() ?? c.getBoundingClientRect(), k = Math.min(stageEl.width / FW, stageEl.height / FH);
    const cx = stageEl.left + (stageEl.width - FW * k) / 2 + fx * k, cy = stageEl.top + (stageEl.height - FH * k) / 2 + fy * k, r = c.getBoundingClientRect();
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), cam);
    D.index(root);
    const ours = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === helper || p === box) return true; return false; };
    const hit = ray.intersectObjects(S.scene.children, true).find((x) => x.object.visible && !ours(x.object) && (cutoutOf(x.object) || D.seen(x))) ?? null;
    let p: THREE.Vector3 | null = null, floor = false;
    const n = hit?.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
    if (hit && n && n.y > 0.6) { p = hit.point.clone(); floor = true; }
    if (!p) {   // the floor of the scene (y = 0), when it is in front of what the pointer is on
      const t = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
      const dt = t ? t.distanceTo(ray.ray.origin) : Infinity;
      if (t && dt < 80 && (!hit || dt <= hit.distance + 0.01)) { p = t; floor = true; }
    }
    const dist = p ? p.distanceTo(ray.ray.origin) : hit ? Math.max(0.6, hit.distance - 0.3) : 6;
    const viewH = (cam as any).isPerspectiveCamera ? 2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) : ((cam as any).top - (cam as any).bottom) / ((cam as any).zoom || 1);
    const h = theatre ? THEATRE_H[category] ?? 1.0 : viewH * (VIEW_PART[category] ?? 0.3);
    if (!p) { p = ray.ray.at(dist, new THREE.Vector3()); p.y -= h / 2; }   // in front of a wall: centred on the pointer
    const ry = theatre ? 0 : Math.atan2(ray.ray.origin.x - p.x, ray.ray.origin.z - p.z);   // the Theatre's flats all face the stage
    return { p, ry, h, floor };
  }
  async function addCutout(spec: CutSpec) {
    const root = mainRoot(); if (!root) return null;
    const id = spec.id ?? `@media:${Math.random().toString(36).slice(2, 9)}`;
    if (cutouts.has(id)) return info(id);
    let img: HTMLImageElement; try { img = await loadImage(spec.url); } catch { return null; }
    const cat = spec.category ?? '', theatre = theatreLike(), thick = cat === 'decors' ? 0.08 : 0.048;
    let base = spec.base ?? null;
    if (!base) { const L = landing(spec.at ?? null, cat, theatre); base = { p: [L.p.x, L.p.y, L.p.z], r: [0, L.ry, 0], h: L.h }; }
    const made = buildCard(img, base.h, thick);
    const group = new THREE.Group(); group.name = `Carton « ${spec.name} »`; group.userData.cutoutId = id;
    group.add(made.card); group.position.set(...base.p); group.rotation.set(...base.r);
    root.store.getState().scene.add(group); group.updateMatrixWorld(true);
    cutouts.set(id, { group, spec: { ...spec, id, base }, h: base.h, w: made.visW, t: thick, theatre, dispose: made.dispose });
    edits.set(id, { id, delta: { p: [0, 0, 0], r: [0, 0, 0], s: 1 }, from: 0, to: 1e9, obj: group, base: { p: group.position.clone(), r: group.rotation.clone(), s: group.scale.clone() }, applied: null });
    emit({ type: 'cutout', ...info(id) });
    return info(id);
  }
  function removeCutout(id: string) {
    const c = cutouts.get(id); if (!c) return;
    if (selected === id) select(null);
    c.group.parent?.remove(c.group); c.dispose(); cutouts.delete(id); edits.delete(id);
  }

  // ---- every frame, before R3F renders: offsets on top of the engine's transforms, the free camera ----
  addEffect(() => {
    if (!on && !edits.size && !cutouts.size) return;
    const f = D.frame();
    if (cutouts.size) { const sc = mainRoot()?.store.getState().scene; if (sc) for (const c of cutouts.values()) if (c.group.parent !== sc) sc.add(c.group); }
    for (const e of edits.values()) {
      let o = e.obj;
      if (!o || !o.parent) {
        const now = performance.now(); if ((e.retryAt ?? 0) > now) continue;
        e.retryAt = now + 250; o = e.obj = resolve(e.id); e.base = e.applied = null;
      }
      if (!o) continue;
      const a = e.applied;
      // React wrote a new transform since our last frame (or first time): it is the new base
      if (!a || !e.base) e.base = { p: o.position.clone(), r: o.rotation.clone(), s: o.scale.clone() };
      else {
        if (!o.position.equals(a.p)) e.base.p.copy(o.position);
        if (!o.rotation.equals(a.r)) e.base.r.copy(o.rotation);
        if (!o.scale.equals(a.s)) e.base.s.copy(o.scale);
      }
      const b = e.base, inScope = f >= e.from && f <= e.to, d = inScope ? e.delta : ZERO;
      if (cutouts.has(e.id)) o.visible = inScope || (on && selected === e.id);
      o.position.set(b.p.x + d.p[0], b.p.y + d.p[1], b.p.z + d.p[2]);
      o.rotation.set(b.r.x + d.r[0], b.r.y + d.r[1], b.r.z + d.r[2]);
      o.scale.set(b.s.x * d.s, b.s.y * d.s, b.s.z * d.s);
      e.applied = { p: o.position.clone(), r: o.rotation.clone(), s: o.scale.clone() };
    }
    const r = mainRoot(); const cam = r?.store.getState().camera as THREE.PerspectiveCamera | undefined;
    if (cam) {
      // the shot's camera, as the engine set it (anything that is not our free pose)
      if (!lastFree || !scenePose) scenePose = readView(cam);
      else {
        if (!cam.position.equals(lastFree.p)) scenePose.p.copy(cam.position);
        if (!cam.quaternion.equals(lastFree.q)) scenePose.q.copy(cam.quaternion);
        if (cam.zoom !== lastFree.zoom) scenePose.zoom = cam.zoom;
        if (cam.near !== lastFree.near) scenePose.near = cam.near;
        if (cam.far !== lastFree.far) scenePose.far = cam.far;
      }
      const pose = capture ? scenePose : freeCam;
      if (pose) applyView(cam, pose, !!(capture && lastFree?.centered));
      lastFree = capture ? null : freeCam;
    }
    if (helper) helper.visible = !capture && !!selected;
    syncGuides();
    if (box) { box.visible = !capture && !!selected; if (selected) box.update(); }
  });
  addAfterEffect(() => {
    if (!capture || !canvas) return;
    const done = capture; capture = null;
    try { done(canvas.toDataURL('image/jpeg', 0.9)); } catch { done(''); }
    if(on && freeCam) requestAnimationFrame(()=>{if(on)redrawCamera();});
  });

  function delta(e: Edit): Delta {
    const o = e.obj, b = e.base; if (!o || !b) return e.delta;
    return { p: [o.position.x - b.p.x, o.position.y - b.p.y, o.position.z - b.p.z], r: [o.rotation.x - b.r.x, o.rotation.y - b.r.y, o.rotation.z - b.r.z], s: b.s.x ? o.scale.x / b.s.x : 1 };
  }
  const info = (id: string): any => {
    const c = cutouts.get(id);
    if (c) {
      const e = edits.get(id)!, b = c.spec.base, d = e.delta;
      const final = { p: b.p.map((v, i) => v + d.p[i]), r: b.r.map((v, i) => v + d.r[i]), h: c.h * d.s, w: c.w * d.s, t: c.t };
      return { id, kind: 'carton', name: c.spec.name, delta: d, from: e.from, to: e.to, base: { p: [...b.p], r: [...b.r], s: 1 },
        cutout: { url: c.spec.url, name: c.spec.name, category: c.spec.category ?? null, base: b, final, theatre: c.theatre } };
    }
    const e = edits.get(id), o = e?.obj ?? resolve(id);
    const d = o ? D.describe(meshOf(o)) : null, b = e?.base;
    return { id, name: o?.name || undefined, kind: d?.type, delta: e?.delta ?? ZERO, from: e?.from, to: e?.to, base: b ? { p: [b.p.x, b.p.y, b.p.z], r: [b.r.x, b.r.y, b.r.z], s: b.s.x } : o ? { p: [o.position.x, o.position.y, o.position.z], r: [o.rotation.x, o.rotation.y, o.rotation.z], s: o.scale.x } : null };
  };
  function ensure(id: string, from = 0, to = 1e9): Edit {
    let e = edits.get(id);
    if (!e) { e = { id, delta: { ...ZERO, p: [0, 0, 0], r: [0, 0, 0] }, from, to, obj: resolve(id), base: null, applied: null }; edits.set(id, e); }
    return e;
  }
  function select(id: string | null) {
    const prev = selected ? edits.get(selected) : null;
    if (prev && prev.id !== id && !cutouts.has(prev.id) && isZero(prev.delta)) edits.delete(prev.id);
    selected = id;
    if (!tc || !st) return;
    if (!id) { tc.detach(); if (on) redrawCamera(); emit({ type: 'deselect' }); return; }
    const e = ensure(id);
    if (!e.obj || !e.obj.parent) e.obj = resolve(id);
    if (!e.obj) { selected = null; tc.detach(); if (!cutouts.has(id) && isZero(e.delta)) edits.delete(id); emit({ type: 'deselect' }); return; }
    if (!e.base) e.base = { p: e.obj.position.clone(), r: e.obj.rotation.clone(), s: e.obj.scale.clone() };
    tc.attach(e.obj);
    if (box) { st.scene.remove(box); box.dispose?.(); }
    box = new THREE.BoxHelper(e.obj, 0xc9f26b);
    Object.assign(box.material, { transparent: true, depthTest: false, depthWrite: false });
    box.renderOrder = 999; st.scene.add(box);
    redrawCamera();
    emit({ type: 'select', ...info(id) });
  }

  // ---- edit mode: gizmo, free camera, click to choose, keys ----
  function pickAt(clientX: number, clientY: number): string | null {
    if (!st || !canvas) return null;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, st.camera);
    D.index(mainRoot());
    const { byMesh } = sceneTargets(st.scene, D.fiberOf, D.reactPath, movable);
    for (const hit of ray.intersectObjects(st.scene.children, true)) {
      const cut = hit.object.visible ? cutoutOf(hit.object) : null; if (cut) return cut;   // an image dropped from « Médias »
      if (!D.fiberOf.get(hit.object) || !D.seen(hit)) continue;          // gizmo, helpers: no React fiber
      const target = byMesh.get(hit.object);
      if (target && !D.noise.test(D.reactPath(hit.object))) return target.id;
    }
    return null;
  }
  let down: { x: number; y: number } | null = null;
  // Dragging an object moves it straight away, as in 2D: along the floor at its own height (a horizontal plane through
  // it), or up and down with Shift (a vertical plane facing the camera). In free camera mode a middle-button drag
  // orbits even over a selected backdrop. A left click selects and the gizmo's handles still move the selected object.
  // A camera that looks at the floor almost flat (a Short's eye-level camera, 08/10/2026: 24 px of mouse sent Uchu 16 units
  // away) makes the floor useless to drag on: then the object slides sideways, in the plane facing the camera, at its own
  // height (« side »); the depth stays for the arrows (PageUp/PageDown) and the gizmo. A move is never more than twice
  // the camera's distance to the object (near the horizon a floor point runs to infinity).
  let pdrag: { id: string; plane: THREE.Plane; offset: THREE.Vector3; start: THREE.Vector3; how: 'floor' | 'side' | 'height'; reach: number; orbitWas: boolean; live: boolean } | null = null;
  const rayAt = (cx: number, cy: number) => {
    const r = canvas!.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), st.camera);
    return ray;
  };
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY };
    if (freeCam && e.button === 1) e.preventDefault();   // keep Windows middle-button autoscroll out of the canvas
    if (freeCam || e.button !== 0 || (tc as any)?.axis || !st || !canvas) return;
    const id = pickAt(e.clientX, e.clientY); if (!id) return;
    if (id !== selected) select(id);
    const ed = edits.get(id); if (!ed?.obj) return;
    const world = ed.obj.getWorldPosition(new THREE.Vector3()), look = world.clone().sub(st.camera.position), reach = 2 * Math.max(look.length(), 0.5);
    const how = e.shiftKey ? 'height' : Math.abs(look.normalize().y) < 0.34 ? 'side' : 'floor';   // < 20° above the floor: « side »
    const n = how === 'floor' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3().subVectors(st.camera.position, world).setY(0).normalize();
    if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, world), hit = rayAt(e.clientX, e.clientY).ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return;
    pdrag = { id, plane, offset: world.clone().sub(hit), start: world.clone(), how, reach, orbitWas: !!orbit?.enabled, live: false };
    if (orbit) orbit.enabled = false;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* */ }
  };
  const onMove = (e: PointerEvent) => {
    if (!pdrag || !st) return;
    if (!pdrag.live) { if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 4) return; pdrag.live = true; }
    const ed = edits.get(pdrag.id), o = ed?.obj; if (!o || !o.parent || !ed.base) return;
    const hit = rayAt(e.clientX, e.clientY).ray.intersectPlane(pdrag.plane, new THREE.Vector3()); if (!hit) return;
    const world = hit.add(pdrag.offset);
    if (pdrag.how === 'height') { world.x = pdrag.start.x; world.z = pdrag.start.z; }   // Shift: only the height
    else world.y = pdrag.start.y;                                                         // on the floor or sideways: its height kept
    const mv = world.clone().sub(pdrag.start); if (mv.length() > pdrag.reach) world.copy(pdrag.start).add(mv.setLength(pdrag.reach));
    const local = o.parent.worldToLocal(world.clone());
    o.position.copy(local); o.updateMatrixWorld();
    ed.delta = delta(ed); ed.applied = { p: o.position.clone(), r: o.rotation.clone(), s: o.scale.clone() };
    emit({ type: 'change', ...info(ed.id) });
  };
  const onUp = (e: PointerEvent) => {
    if (pdrag) {   // a drag of the object is done; a simple click chose it already (on pointerdown)
      if (orbit) orbit.enabled = pdrag.orbitWas;
      pdrag = null; down = null;
      return;
    }
    if (!down || (tc as any)?.dragging) { down = null; return; }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4; down = null;
    if (moved || e.button !== 0 || (tc as any)?.axis) return;            // an orbit, a pan, or a click on the gizmo
    select(pickAt(e.clientX, e.clientY));
  };
  const onKey = (e: KeyboardEvent) => {
    if (!on) return;
    const m = stageModeKey(e); if (m) { e.preventDefault(); return setMode(m); }
    if (e.key === 'Escape' && selected) { select(null); return; }
    if (selected && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) {
      e.preventDefault();
      const st = e.shiftKey ? 0.25 : e.altKey ? 0.01 : 0.05, dd = edits.get(selected)!.delta;
      const ax = e.key === 'ArrowLeft' ? [-st, 0, 0] : e.key === 'ArrowRight' ? [st, 0, 0] : e.key === 'ArrowUp' ? [0, st, 0] : e.key === 'ArrowDown' ? [0, -st, 0] : e.key === 'PageUp' ? [0, 0, -st] : [0, 0, st];
      setDelta(selected, { ...dd, p: [dd.p[0] + ax[0], dd.p[1] + ax[1], dd.p[2] + ax[2]] }); return;
    }
    // anything else goes to the studio page (play, frames, tools…)
    toParent('keydown', e);
  };
  const onKeyUp = (e: KeyboardEvent) => toParent('keyup', e);
  function setMode(m: typeof mode) { mode = m; tc?.setMode(m); emit({ type: 'mode', mode: m }); }
  function redrawCamera() {
    syncGuides();
    // Paused Remotion compositions may draw on demand or advance their ThreeCanvas manually.
    const state = st.get();
    if (state.frameloop === 'never') state.advance(performance.now());
    else state.invalidate();
  }
  function restoreShotCamera() {
    if (!scenePose) return;
    applyView(st.camera, scenePose, true);
    lastFree = null;
    redrawCamera();
  }
  // OrbitControls calls lookAt(target) in the control camera's own world. A rig
  // camera therefore needs an unparented control camera in rig-local coordinates.
  function syncControlCamera(control: ViewCamera, cam: ViewCamera) {
    if (control === cam) return;
    control.position.copy(cam.position); control.quaternion.copy(cam.quaternion); control.up.copy(cam.up);
    control.zoom = cam.zoom; control.near = cam.near; control.far = cam.far;
    if ('fov' in control && 'fov' in cam) {
      control.fov = cam.fov; control.aspect = cam.aspect;
    } else if ('left' in control && 'left' in cam) {
      control.left = cam.left; control.right = cam.right; control.top = cam.top; control.bottom = cam.bottom;
    }
    control.projectionMatrix.copy(cam.projectionMatrix);
    control.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
    control.updateMatrixWorld();
  }
  function enterFreeView(view: CameraView, target: THREE.Vector3) {
    if (!freeCam) scenePose = readView(st.camera);
    applyView(st.camera, view, !!freeCam?.centered && !view.centered);
    freeCam = view; lastFree = view;
    syncControlCamera(orbit!.object as ViewCamera, st.camera);
    orbit!.target.copy(target); orbit!.enabled = true;
    redrawCamera();
  }
  function focusObject(id: string) {
    if (!on || !orbit || !st || !id) return false;
    const object = resolve(id);
    if (!object) return false;
    const fit = fitObject(st.camera, object);
    if (!fit) return false;
    if (selected !== id) select(id);
    const view = readView(st.camera, true);
    view.p.copy(fit.position); view.zoom = fit.zoom; view.near = fit.near; view.far = fit.far;
    enterFreeView(view, localTarget(fit.target));
    return true;
  }
  function enable(want: boolean) {
    if (want === on) return on;
    const root = mainRoot();
    if (want && !root) return false;
    on = want;
    if (on) {
      st = root.store.getState(); const cv: HTMLCanvasElement = st.gl.domElement; canvas = cv;
      guides=createGuides(st.scene,cv);
      tc = new TransformControls(st.camera, cv); tc.setSize(0.8); tc.setMode(mode);
      helper = (tc as any).getHelper ? (tc as any).getHelper() : (tc as any); st.scene.add(helper);
      // OrbitControls aims the camera at its target as soon as it is created: the shot's pose is put back at once
      const pose0 = { p: st.camera.position.clone(), q: st.camera.quaternion.clone() };
      const control = !st.camera.parent ? st.camera : st.camera.isPerspectiveCamera ? new THREE.PerspectiveCamera() : new THREE.OrthographicCamera();
      syncControlCamera(control, st.camera);
      orbit = new OrbitControls(control, cv); orbit.enableDamping = false;
      orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
      st.camera.position.copy(pose0.p); st.camera.quaternion.copy(pose0.q); st.camera.updateMatrixWorld();
      const target = new THREE.Vector3(0, 0, -1).applyQuaternion(st.camera.quaternion).multiplyScalar(8).add(st.camera.position);
      orbit.target.copy(target); orbit.enabled = false;
      orbit.addEventListener('change', () => {
        if (!orbit!.enabled) return;
        freeCam = readView(control, freeCam?.centered);
        if (control !== st.camera) applyView(st.camera, freeCam);
        lastFree = freeCam;
        redrawCamera();
      });
      tc.addEventListener('dragging-changed', (ev: any) => { if (orbit) orbit.enabled = !ev.value && !!freeCam; });
      tc.addEventListener('objectChange', () => {
        const e = selected ? edits.get(selected) : null; if (!e || !e.obj || !e.base) return;
        if (mode === 'scale') {   // cardboard is never stretched: one factor, the axis moved the most
          const ks = [e.obj.scale.x / e.base.s.x, e.obj.scale.y / e.base.s.y, e.obj.scale.z / e.base.s.z].map((k) => (Number.isFinite(k) ? k : 1));
          const k = ks.reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a), 1);
          e.obj.scale.set(e.base.s.x * k, e.base.s.y * k, e.base.s.z * k);
        }
        e.delta = delta(e); e.applied = { p: e.obj.position.clone(), r: e.obj.rotation.clone(), s: e.obj.scale.clone() };
        emit({ type: 'change', ...info(e.id) });
      });
      cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointerup', onUp); cv.addEventListener('pointermove', onMove);
      window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp);
      cv.style.cursor = 'crosshair'; cv.tabIndex = 0; cv.focus();
      // the bubbles / curtain / titles are HTML layers above the 3D canvas: in this mode only the canvas takes the mouse
      const css = document.createElement('style'); css.id = 'studio-staging'; css.textContent = '#stage * { pointer-events: none !important } #stage canvas { pointer-events: auto !important }'; document.head.appendChild(css);
    } else {
      select(null);
      guides?.dispose();guides=null;
      tc?.detach(); if (helper && st) st.scene.remove(helper); tc?.dispose(); tc = null; helper = null;
      orbit?.dispose(); orbit = null;
      if (freeCam) { freeCam = null; restoreShotCamera(); }
      scenePose = null;
      if (box && st) { st.scene.remove(box); box.dispose?.(); box = null; }
      canvas?.removeEventListener('pointerdown', onDown); canvas?.removeEventListener('pointerup', onUp); canvas?.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp);
      if (canvas) canvas.style.cursor = '';
      document.getElementById('studio-staging')?.remove();
    }
    return on;
  }
  function setDelta(id: string, d: Delta, from?: number, to?: number) {
    const e = ensure(id);
    e.delta = { p: [...d.p] as V3, r: [...d.r] as V3, s: d.s || 1 };
    if (from !== undefined) e.from = from; if (to !== undefined) e.to = to;
    e.applied = null;   // re-apply from the base at the next frame
    if (e.obj && e.base) { e.obj.position.copy(e.base.p); e.obj.rotation.copy(e.base.r); e.obj.scale.copy(e.base.s); }
    emit({ type: 'change', ...info(id) });
  }
  function reset(id: string) {
    if (cutouts.has(id)) { removeCutout(id); return; }
    const e = edits.get(id); if (!e) return;
    if (e.obj && e.base) { e.obj.position.copy(e.base.p); e.obj.rotation.copy(e.base.r); e.obj.scale.copy(e.base.s); }
    edits.delete(id); if (selected === id) select(null);
  }
  return {
    enable, select, focusObject, setMode, setDelta, reset, elements,
    setGuides: (show:boolean) => {guidesWanted=!!show; if(on)redrawCamera(); return guidesWanted;},
    on: (fn: (ev: any) => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    list: () => [...edits.values()].filter((e) => !isZero(e.delta) || cutouts.has(e.id)).map((e) => info(e.id)),
    info, get selected() { return selected; }, get enabled() { return on; },
    // « Médias »: an image as cardboard, where it was dropped (at: a point of the frame), or again at its place (base)
    addCutout, has: (id: string) => cutouts.has(id) || edits.has(id),
    // Restoring the view also restores its pivot for the next middle-button drag.
    freePose: () => (freeCam && orbit ? { p: freeCam.p.toArray(), q: freeCam.q.toArray(), target: worldTarget()!.toArray(),
      zoom: freeCam.zoom, near: freeCam.near, far: freeCam.far, centered: freeCam.centered } : null),
    freeCamera: (want: boolean, pose?: SavedView | null) => {
      if (!orbit || !st) return false;
      if (want) {
        if (!pose && freeCam) return true;
        const view = readView(st.camera, !!pose?.centered);
        if (pose) {
          view.p.fromArray(pose.p); view.q.fromArray(pose.q);
          view.zoom = pose.zoom ?? view.zoom; view.near = pose.near ?? view.near; view.far = pose.far ?? view.far;
        }
        enterFreeView(view, pose?.target ? localTarget(new THREE.Vector3().fromArray(pose.target)) : defaultTarget(view));
      }
      else { freeCam = null; orbit.enabled = false; restoreShotCamera(); }
      return !!freeCam;
    },
    // back to the shot's camera; a free camera stays free, from there (« Réinitialiser la caméra »)
    resetCamera: () => {
      if (!orbit || !st) return false;
      const was = !!freeCam;
      freeCam = null; orbit.enabled = false;
      restoreShotCamera();
      if (was) { const view = readView(st.camera); enterFreeView(view, defaultTarget(view)); }
      return was;
    },
    // the 3D image as the shot's camera sees it, with the offsets, without gizmo (the after image sent to Claude)
    snapshot: () => new Promise<string>((res) => { capture = res; if(on) redrawCamera(); setTimeout(() => { if (capture === res) {capture=null;if(on)redrawCamera();res('');} }, 3000); }),
    // where the object is on the 1920×1080 frame (its centre), to pin the note on it
    screenPos: (id: string) => {
      const e = edits.get(id), o = e?.obj ?? resolve(id), root = mainRoot(); if (!o || !root) return null;
      const cam = root.store.getState().camera as THREE.Camera, c = root.store.getState().gl.domElement as HTMLCanvasElement;
      const b = new THREE.Box3().setFromObject(o), v = b.getCenter(new THREE.Vector3());
      if (scenePose && freeCam) {
        const tmp = (cam as ViewCamera).clone();
        applyView(tmp, scenePose, true);
        if (cam.parent) tmp.matrixWorldInverse.copy(tmp.matrixWorld.premultiply(cam.parent.matrixWorld)).invert();
        v.project(tmp);
      } else v.project(cam);
      const FW = D.W ?? 1920, FH = D.H ?? 1080;
      const stage = document.getElementById('stage')!.getBoundingClientRect(), r = c.getBoundingClientRect(), k = Math.min(stage.width / FW, stage.height / FH);
      const px = r.left + (v.x + 1) / 2 * r.width, py = r.top + (1 - v.y) / 2 * r.height;
      return [Math.round((px - stage.left - (stage.width - FW * k) / 2) / k), Math.round((py - stage.top - (stage.height - FH * k) / 2) / k)];
    },
  };
}

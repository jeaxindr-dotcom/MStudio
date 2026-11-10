// « Mise en scène » for a run of a Remotion pipeline (player/remotion.tsx): the composition is HTML — Uchu-chan's page,
// the React scenes of L'AItelier and Vidéo du monde — so the staging is 2D (user request, 08/10/2026: « il doit apparaître
// pour toutes les vidéos, tous mes projets »). Same API as the Theatre's 3D staging (player/stage.ts), so the studio's
// « Scène » panel and its notes work for both:
//   - click an element of the picture: the deepest visible element under the pointer (an image, a drawing, a text…),
//     named by the nearest data-coulisses block around it (« beat S12.16 › image chibi.png »)
//   - drag it to move it, W / E / R = move / turn / size, the wheel = size (Shift + wheel = turn), the arrow keys = 1 px,
//     Shift = 10 px; Escape lets it go
//   - « Caméra » = the whole frame: drag to reframe, the wheel to zoom
//   - an image of the library dropped on the picture (« Médias »): laid on top of the composition where it fell, then
//     staged like the others (addCutout)
// Nothing changes in the project: the offset is shown on top of the engine with the CSS individual transforms
// (translate / rotate / scale), which compose with the transform the engine animates (GSAP, React styles) without
// touching it, re-applied every frame inside its scope (the engine may rebuild the element), and the camera is a
// wrapper around the composition (#coulisses-camera, preview only). The offset is in pixels of the frame, as seen.
import { stageModeKey, toParent } from './keys';
type V3 = [number, number, number];
export interface Delta { p: V3; r: V3; s: number }   // p: frame pixels (x right, y down); r[2]: turn (radians); s: size factor
interface Edit { id: string; name: string; kind: string; delta: Delta; from: number; to: number; base: number[] | null }
interface Deps { W: number; H: number; frame: () => number; root: () => HTMLElement | null }
export const CAMERA = '@camera';
export const ZERO: Delta = { p: [0, 0, 0], r: [0, 0, 0], s: 1 };
const isZero = (d: Delta) => d.p.every((v) => Math.abs(v) < 1e-6) && d.r.every((v) => Math.abs(v) < 1e-6) && Math.abs(d.s - 1) < 1e-6;
const clone = (d: Delta): Delta => ({ p: [...d.p] as V3, r: [...d.r] as V3, s: d.s || 1 });

export function createStage2d(D: Deps) {
  const edits = new Map<string, Edit>();
  const listeners = new Set<(ev: any) => void>();
  const emit = (ev: any) => { for (const l of listeners) l(ev); };
  let on = false, selected: string | null = null, mode: 'translate' | 'rotate' | 'scale' = 'translate';
  let overlay: HTMLDivElement | null = null, box: HTMLDivElement | null = null, tag: HTMLDivElement | null = null, raf = 0;
  const applied = new Map<Element, string>();   // what was last written on an element (written again only on change)

  const root = () => D.root();                                             // #coulisses-camera
  const k = () => { const r = root(); return r ? r.parentElement!.getBoundingClientRect().width / D.W : 1; };   // screen px per frame px

  // ---------- naming an element: its data-coulisses block, then its path inside the block ----------
  const hint = (el: Element) => {
    const h = el as HTMLElement, t = el.tagName.toLowerCase();
    const src = (h as HTMLImageElement).currentSrc || h.getAttribute?.('src') || h.getAttribute?.('href') || '';
    const bg = /url\(["']?([^"')]+)/.exec(getComputedStyle(h).backgroundImage ?? '')?.[1] ?? '';
    const file = (src || bg).split(/[?#]/)[0].split('/').pop() ?? '';
    const text = !['img', 'svg', 'canvas', 'video'].includes(t) && h.childElementCount === 0 ? (h.textContent ?? '').trim().slice(0, 28) : '';
    return h.getAttribute?.('alt') || h.getAttribute?.('aria-label') || h.getAttribute?.('title') || (file ? decodeURIComponent(file) : '') || (text ? `« ${text} »` : '')
      || (typeof h.className === 'string' && h.className.trim() ? '.' + h.className.trim().split(/\s+/)[0] : '') || t;
  };
  const kindOf = (el: Element) => {
    const t = el.tagName.toLowerCase(), h = el as HTMLElement;
    if (t === 'img' || (getComputedStyle(h).backgroundImage ?? 'none') !== 'none') return 'image';
    if (t === 'svg' || el instanceof SVGElement) return 'dessin';
    if (t === 'video') return 'vidéo';
    if (t === 'canvas') return 'canvas';
    if (h.childElementCount === 0 && (h.textContent ?? '').trim()) return 'texte';
    return 'élément';
  };
  function describe(el: Element): { id: string; name: string; kind: string } {
    const r = root()!;
    if (el === r) return { id: CAMERA, name: 'Caméra', kind: 'cadre' };
    const named = el.closest('[data-coulisses]');
    const base = named && r.contains(named) ? named : r;
    let id = '@root', name = '';
    if (base !== r) {
      const label = (base as HTMLElement).dataset.coulisses ?? '';
      const same = [...r.querySelectorAll(`[data-coulisses="${CSS.escape(label)}"]`)];
      id = `[data-coulisses="${label}"]${same.length > 1 ? `#${same.indexOf(base)}` : ''}`;
      name = label;
    }
    const segs: string[] = [];
    for (let e: Element | null = el; e && e !== base; e = e.parentElement) segs.unshift(`${e.tagName.toLowerCase()}:nth-child(${[...(e.parentElement?.children ?? [])].indexOf(e) + 1})`);
    if (segs.length) id += ' > ' + segs.join(' > ');
    const h = el === base ? '' : hint(el);
    return { id, name: [name, h].filter(Boolean).join(' › ') || hint(el), kind: kindOf(el) };
  }
  function find(id: string): Element | null {
    const r = root(); if (!r) return null;
    if (id === CAMERA) return r;
    const m = /^(@root|\[data-coulisses="(.*?)"\](?:#(\d+))?)(?: > (.*))?$/.exec(id); if (!m) return null;
    let base: Element | null = r;
    if (m[1] !== '@root') { const all = r.querySelectorAll(`[data-coulisses="${CSS.escape(m[2])}"]`); base = all[m[3] ? +m[3] : 0] ?? null; }
    if (!base || !m[4]) return base;
    try { return base.querySelector(':scope > ' + m[4]); } catch { return null; }
  }

  // ---------- picking: the deepest visible element under the point (not a full-frame background, if anything else) ----------
  function pickAt(cx: number, cy: number): string | null {
    const r = root(); if (!r) return null;
    // every element answers the hit test while picking, even one the project keeps out of the mouse (pointer-events: none,
    // as Uchu-chan's rig and transitions); a clip-path still cuts it to what is seen
    if (overlay) overlay.style.pointerEvents = 'none';
    const force = document.createElement('style'); force.textContent = '#coulisses-camera, #coulisses-camera * { pointer-events: auto !important }'; document.head.appendChild(force);
    const els = document.elementsFromPoint(cx, cy).filter((e) => r.contains(e) && e !== r);
    force.remove();
    if (overlay) overlay.style.pointerEvents = 'auto';
    const frame = r.getBoundingClientRect();
    const big = (e: Element) => { const b = e.getBoundingClientRect(); return b.width * b.height >= 0.85 * frame.width * frame.height; };
    const visible = (e: Element) => { const b = e.getBoundingClientRect(), cs = getComputedStyle(e); return b.width > 2 && b.height > 2 && cs.visibility !== 'hidden' && +cs.opacity > 0.02; };
    let el = els.find((e) => visible(e) && !big(e)) ?? els.find(visible) ?? null;
    // a drawing is one thing: a click inside an SVG takes the whole SVG (never one of its rectangles or paths)
    for (let s = el?.closest('svg') ?? null; s; s = s.parentElement?.closest('svg') ?? null) el = s;
    return el ? describe(el).id : null;
  }
  // « Bloc parent »: the element around the one picked (up to the block named data-coulisses, then its own parent…)
  function selectParent() {
    const el = selected && selected !== CAMERA ? find(selected) : null, r = root();
    const up = el?.parentElement;
    if (!el || !up || !r || up === r || !r.contains(up)) return false;
    select(describe(up).id);
    return true;
  }

  // ---------- the offsets, written on the elements every frame inside their scope ----------
  function parentScale(el: Element) {
    const p = el.parentElement as HTMLElement | null;
    if (p && p.offsetWidth > 0) return p.getBoundingClientRect().width / p.offsetWidth;
    return k();
  }
  function write(el: Element, d: Delta | null, camera: boolean) {
    const h = el as HTMLElement;
    if (!d) { if (applied.has(el)) { h.style.translate = ''; h.style.rotate = ''; h.style.scale = ''; if (camera) h.style.transformOrigin = ''; applied.delete(el); } return; }
    const f = camera ? 1 : k() / parentScale(el);   // the camera wrapper is in frame pixels already
    const v = `${(d.p[0] * f).toFixed(2)}px ${(d.p[1] * f).toFixed(2)}px|${(d.r[2] * 180 / Math.PI).toFixed(3)}deg|${d.s.toFixed(4)}`;
    if (applied.get(el) === v) return;
    const [tr, rot, sc] = v.split('|');
    h.style.translate = tr; h.style.rotate = rot; h.style.scale = sc;
    if (camera) h.style.transformOrigin = '50% 50%';
    applied.set(el, v);
  }
  function tick() {
    raf = 0;
    const f = D.frame(), seen = new Set<Element>();
    if (cutouts.size) { const r = root(); if (r) for (const c of cutouts.values()) if (!c.el.isConnected) r.appendChild(c.el); }
    for (const e of edits.values()) {
      const el = find(e.id); if (!el) continue;
      seen.add(el);
      if (cutouts.has(e.id)) (el as HTMLElement).style.visibility = (f >= e.from && f <= e.to) || (on && selected === e.id) ? '' : 'hidden';
      write(el, f >= e.from && f <= e.to && !isZero(e.delta) ? e.delta : null, e.id === CAMERA);
    }
    for (const el of [...applied.keys()]) if (!seen.has(el)) write(el, null, el === root());
    drawBox();
    if (on || cutouts.size || [...edits.values()].some((e) => !isZero(e.delta))) raf = requestAnimationFrame(tick);
  }
  const run = () => { if (!raf) raf = requestAnimationFrame(tick); };

  // ---------- the selection box, the overlay that takes the mouse ----------
  function frameBox(id: string) {   // the element's box on the frame, in frame pixels
    const el = find(id), r = root(); if (!el || !r) return null;
    const b = el.getBoundingClientRect(), fr = r.parentElement!.getBoundingClientRect(), kk = k();
    return [(b.left - fr.left) / kk, (b.top - fr.top) / kk, b.width / kk, b.height / kk];
  }
  function drawBox() {
    if (!box || !tag) return;
    const el = selected ? find(selected) : null;
    if (!on || !el) { box.style.display = 'none'; tag.style.display = 'none'; return; }
    const b = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
    const e = edits.get(selected!);
    tag.textContent = `${e?.name ?? describe(el).name} · ${({ translate: 'déplacer', rotate: 'tourner', scale: 'taille' } as any)[mode]}`;
    // the camera's box is the whole frame: the studio's own badge already names it; an element near the top: its label below it
    if (selected === CAMERA) { tag.style.display = 'none'; return; }
    Object.assign(tag.style, { display: 'block', left: `${Math.max(4, b.left)}px`, top: `${b.top - 24 < 44 ? b.bottom + 4 : b.top - 24}px` });
  }
  function ensure(id: string): Edit {
    let e = edits.get(id);
    if (!e) {
      const el = find(id), d = el ? describe(el) : { name: id, kind: 'élément' };
      e = { id, name: d.name, kind: d.kind, delta: clone(ZERO), from: 0, to: 1e9, base: frameBox(id) };
      edits.set(id, e);
    }
    return e;
  }
  const info = (id: string): any => {
    const e = edits.get(id), el = find(id), d = e ?? (el ? describe(el) : null), c = cutouts.get(id);
    const out: any = { id, name: d?.name ?? id, kind: d?.kind ?? 'élément', delta: e?.delta ?? ZERO, from: e?.from, to: e?.to, base: e?.base ?? frameBox(id), dim: '2d' };
    if (c) {   // where the image ends up: its centre, its size and its turn, in pixels of the frame
      const b = c.spec.box, dd = e?.delta ?? ZERO;
      out.cutout = { url: c.spec.url, name: c.spec.name, category: c.spec.category ?? null, box: [...b], final: { x: b[0] + b[2] / 2 + dd.p[0], y: b[1] + b[3] / 2 + dd.p[1], w: b[2] * dd.s, h: b[3] * dd.s, r: dd.r[2] } };
    }
    return out;
  };

  // ---------- « Médias »: an image of the library dropped on the picture (preview only) ----------
  // It is laid on top of the composition, inside the camera's frame (#coulisses-camera, whose pixels are the frame's),
  // named data-coulisses="<its name>", centred where it was dropped, at a size that suits what it is (a character about
  // half the frame's height…). It is then an element of the staging like the others, and « Ajouter à la file » sends its
  // box to the agent, who adds it to the project.
  type Cut2 = { id?: string; url: string; name: string; category?: string; at?: [number, number] | null; box?: number[] | null };
  const cutouts = new Map<string, { el: HTMLImageElement; spec: Cut2 & { id: string; box: number[] } }>();
  const PART: Record<string, number> = { personnages: 0.5, decors: 0.7, accessoires: 0.25, effets: 0.35 };
  async function addCutout(spec: Cut2) {
    const r = root(); if (!r) return null;
    const im = new Image(); im.src = spec.url;
    try { await im.decode(); } catch { return null; }
    let label = spec.id ? (/^\[data-coulisses="(.*)"\]$/.exec(spec.id)?.[1] ?? spec.name) : spec.name;
    if (!spec.id) { const used = new Set([...r.querySelectorAll('[data-coulisses]')].map((x) => (x as HTMLElement).dataset.coulisses)); for (let n = 2; used.has(label); n++) label = `${spec.name} (${n})`; }
    const id = `[data-coulisses="${label}"]`;
    if (cutouts.has(id)) return info(id);
    let box = spec.box ?? null;
    if (!box) {
      const [cx, cy] = spec.at ?? [D.W / 2, D.H / 2];
      let h = D.H * (PART[spec.category ?? ''] ?? 0.35), w = h * im.naturalWidth / im.naturalHeight;
      if (w > D.W * 0.9) { w = D.W * 0.9; h = w * im.naturalHeight / im.naturalWidth; }
      box = [cx - w / 2, cy - h / 2, w, h];
    }
    Object.assign(im.style, { position: 'absolute', left: `${box[0]}px`, top: `${box[1]}px`, width: `${box[2]}px`, height: `${box[3]}px`, zIndex: '40', pointerEvents: 'none', userSelect: 'none' });
    im.draggable = false; im.alt = spec.name; im.dataset.coulisses = label; im.dataset.coulissesType = 'image';
    r.appendChild(im);
    cutouts.set(id, { el: im, spec: { ...spec, id, box } });
    const e = ensure(id); e.name = label; e.kind = 'image'; e.base = box.slice();
    run(); emit({ type: 'cutout', ...info(id) });
    return info(id);
  }
  function removeCutout(id: string) {
    const c = cutouts.get(id); if (!c) return;
    if (selected === id) select(null);
    c.el.remove(); cutouts.delete(id); edits.delete(id); run();
  }
  function select(id: string | null) {
    selected = id && find(id) ? id : null;
    if (selected) { const e = ensure(selected); if (isZero(e.delta)) e.base = frameBox(selected); emit({ type: 'select', ...info(selected) }); }
    else emit({ type: 'deselect' });
    run();
  }

  let drag: { x: number; y: number; d0: Delta; cx: number; cy: number; a0: number; r0: number } | null = null, moved = false;
  const centre = (id: string) => { const el = find(id)!; const b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
  const onDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault(); overlay!.setPointerCapture(ev.pointerId); moved = false;
    let id = selected;
    const selEl = id ? find(id) : null;
    const inSel = !!selEl && (() => { const b = selEl.getBoundingClientRect(); return ev.clientX >= b.left && ev.clientX <= b.right && ev.clientY >= b.top && ev.clientY <= b.bottom; })();
    if (!inSel && id !== CAMERA) { id = pickAt(ev.clientX, ev.clientY); select(id); }
    if (!id) return;
    const [cx, cy] = centre(id), e = ensure(id);
    drag = { x: ev.clientX, y: ev.clientY, d0: clone(e.delta), cx, cy, a0: Math.atan2(ev.clientY - cy, ev.clientX - cx), r0: Math.hypot(ev.clientX - cx, ev.clientY - cy) || 1 };
  };
  const onMove = (ev: PointerEvent) => {
    if (!drag || !selected) { overlay!.style.cursor = selected === CAMERA ? 'grab' : 'crosshair'; return; }
    const e = ensure(selected), kk = k(), d = clone(drag.d0);
    if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 2) moved = true;
    if (mode === 'translate') { d.p[0] = drag.d0.p[0] + (ev.clientX - drag.x) / kk; d.p[1] = drag.d0.p[1] + (ev.clientY - drag.y) / kk; }
    else if (mode === 'rotate') d.r[2] = drag.d0.r[2] + Math.atan2(ev.clientY - drag.cy, ev.clientX - drag.cx) - drag.a0;
    else d.s = Math.max(0.05, drag.d0.s * Math.hypot(ev.clientX - drag.cx, ev.clientY - drag.cy) / drag.r0);
    e.delta = d; run();
    emit({ type: 'change', ...info(selected) });
  };
  const onUp = () => { drag = null; };
  const onWheel = (ev: WheelEvent) => {
    if (!selected) return;
    ev.preventDefault();
    const e = ensure(selected), d = clone(e.delta), step = ev.deltaY > 0 ? -1 : 1;
    if (ev.shiftKey) d.r[2] += step * (Math.PI / 180) * (ev.altKey ? 0.5 : 3);
    else d.s = Math.max(0.05, d.s * (1 + step * (ev.altKey ? 0.01 : 0.04)));
    e.delta = d; run(); emit({ type: 'change', ...info(selected) });
  };
  const onKey = (ev: KeyboardEvent) => {
    if (!on) return;
    const m = stageModeKey(ev); if (m) { ev.preventDefault(); return setMode(m); }
    if (ev.key === 'Escape' && selected) { select(null); return; }
    if (selected && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) {
      ev.preventDefault();
      const st = ev.shiftKey ? 10 : 1, e = ensure(selected), d = clone(e.delta);
      if (ev.key === 'ArrowLeft') d.p[0] -= st; if (ev.key === 'ArrowRight') d.p[0] += st; if (ev.key === 'ArrowUp') d.p[1] -= st; if (ev.key === 'ArrowDown') d.p[1] += st;
      e.delta = d; run(); emit({ type: 'change', ...info(selected) }); return;
    }
    toParent('keydown', ev);
  };
  const onKeyUp = (ev: KeyboardEvent) => toParent('keyup', ev);
  function setMode(m: typeof mode) { mode = m; emit({ type: 'mode', mode: m }); run(); }

  function enable(want: boolean) {
    if (want === on) return on;
    if (want && !root()) return false;
    on = want;
    if (on) {
      overlay = document.createElement('div');
      Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '50', cursor: 'crosshair', pointerEvents: 'auto' });
      overlay.tabIndex = 0;
      box = document.createElement('div');
      Object.assign(box.style, { position: 'fixed', zIndex: '51', pointerEvents: 'none', border: '2px solid #c9f26b', borderRadius: '4px', boxShadow: '0 0 0 1px rgba(0,0,0,.5)', display: 'none' });
      tag = document.createElement('div');
      Object.assign(tag.style, { position: 'fixed', zIndex: '52', pointerEvents: 'none', padding: '2px 8px', borderRadius: '99px', background: 'rgba(9,11,18,.85)', color: '#c9f26b', font: '600 12px system-ui, sans-serif', whiteSpace: 'nowrap', display: 'none' });
      document.body.append(overlay, box, tag);
      overlay.addEventListener('pointerdown', onDown); overlay.addEventListener('pointermove', onMove); overlay.addEventListener('pointerup', onUp);
      overlay.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp);
      overlay.focus();
    } else {
      select(null);
      overlay?.remove(); box?.remove(); tag?.remove(); overlay = box = tag = null; drag = null;
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp);
    }
    run();
    return on;
  }
  function setDelta(id: string, d: Delta, from?: number, to?: number) {
    const e = ensure(id);
    e.delta = clone(d);
    if (from !== undefined) e.from = from; if (to !== undefined) e.to = to;
    run(); emit({ type: 'change', ...info(id) });
  }
  function reset(id: string) {
    if (cutouts.has(id)) { removeCutout(id); return; }   // the drop is taken back
    const el = find(id); if (el) write(el, null, id === CAMERA);
    edits.delete(id); if (selected === id) select(null); run();
  }
  return {
    kind: '2d', enable, select, selectParent, setMode, setDelta, reset,
    elements: () => Array.from(root()?.querySelectorAll('[data-coulisses]') ?? [], describe),
    on: (fn: (ev: any) => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    list: () => [...edits.values()].filter((e) => !isZero(e.delta) || cutouts.has(e.id)).map((e) => info(e.id)),
    info, get selected() { return selected; }, get enabled() { return on; },
    addCutout, has: (id: string) => cutouts.has(id) || edits.has(id),
    // « Caméra »: the whole frame is the object (drag = reframe, wheel = zoom)
    freeCamera: (want: boolean) => { select(want ? CAMERA : null); return want; },
    freePose: () => null,   // the 2D camera is an offset like the others (it goes over with them)
    resetCamera: () => { const had = edits.has(CAMERA) && !isZero(edits.get(CAMERA)!.delta); reset(CAMERA); return had; },
    snapshot: async () => '',   // the « after » image of a 2D staging is made by the server (/api/stage-shot)
    screenPos: (id: string) => { const b = frameBox(id); return b ? [Math.round(b[0] + b[2] / 2), Math.round(b[1] + b[3] / 2)] : null; },
    // the edits as the server's « after » capture needs them (player.html?stage=…)
    edits: () => [...edits.values()].map((e) => { const c = cutouts.get(e.id); return { id: e.id, delta: e.delta, from: e.from, to: e.to, ...(c ? { cutout: { url: c.spec.url, name: c.spec.name, category: c.spec.category ?? null, box: c.spec.box } } : {}) }; }),
    applyNow: () => tick(),
  };
}

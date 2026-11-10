// The live preview of a HyperFrames project in Coulisses (user request, 09/10/2026): the project's own index.html, served
// by the studio server with the user's HyperFrames runtime at its head (as « hyperframes play » does) and this adapter.
// It gives the studio the same window.StudioPlayer as a Remotion project's preview (player/remotion.tsx), so the review
// page, the picking, the notes and the 2D staging work as they do there:
//   - the composition is shown whole in the frame: its root element, moved into #coulisses-fit > #coulisses-camera (the
//     2D staging's camera), scaled to fit the window — the composition keeps its own pixels (data-width × data-height);
//   - play / pause / seek / the frame shown: the runtime's window.__player (seconds; frames here, at data-fps or 30);
//   - picking: the element under a point of the frame, named by its id, else its clip or composition, else its tag.
// Served as a module (/hf-player.js): /hf-stage2d.js is player/stage2d.ts with its types stripped by the server.
import { createStage2d } from '/hf-stage2d.js';
import { createReady } from '/hf-ready.js';

const C = window.__COULISSES_HF ?? {};
const W = C.width || 1920, H = C.height || 1080, FPS = C.fps || 30;
const root = document.querySelector('[data-composition-id]');
const listeners = new Set();
const P = () => window.__player ?? null;
const frameNow = () => Math.max(0, Math.min(durationInFrames - 1, Math.floor((P()?.getTime?.() ?? 0) * FPS + 1e-6)));
const emit = (type) => { const frame = frameNow(); for (const l of listeners) l({ type, frame }); };
// the frame complete or not (player/ready.ts): « loading » / « loaded » to the studio, which covers an incomplete one
const R = createReady({ root: () => document, playing: () => !!P()?.isPlaying?.(), emit });
let durationInFrames = Math.max(1, Math.round((C.duration || 0) * FPS)) || 1;

// ---------- the composition, whole in the window ----------
const fit = document.createElement('div'), cam = document.createElement('div');
fit.id = 'coulisses-fit'; cam.id = 'coulisses-camera';
Object.assign(fit.style, { position: 'fixed', left: '0', top: '0', width: `${W}px`, height: `${H}px`, transformOrigin: '0 0', overflow: 'hidden', zIndex: '0' });
Object.assign(cam.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
if (root) { root.parentNode.insertBefore(fit, root); fit.appendChild(cam); cam.appendChild(root); }
document.documentElement.style.background = '#000';
const place = () => {
  const s = Math.min(innerWidth / W, innerHeight / H) || 1;
  fit.style.transform = `translate(${(innerWidth - W * s) / 2}px, ${(innerHeight - H * s) / 2}px) scale(${s})`;
};
place(); addEventListener('resize', place);

// ---------- picking: what is under (x, y) of the frame ----------
const toScreen = (x, y) => { const r = fit.getBoundingClientRect(); return [r.left + (x / W) * r.width, r.top + (y / H) * r.height]; };
function nameOf(el) {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (e === fit || e === cam) break;
    const id = e.id, comp = e.getAttribute?.('data-composition-id'), clip = e.hasAttribute?.('data-start');
    if (id || comp || clip) {
      const ref = id ? `#${id}` : comp ? `[data-composition-id="${comp}"]` : `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''}`;
      const text = e.childElementCount === 0 ? (e.textContent ?? '').trim().slice(0, 30) : '';
      return { el: e, ref, label: text ? `${ref} « ${text} »` : ref, kind: comp ? 'composition' : clip ? 'clip' : 'élément' };
    }
  }
  return null;
}
function pickAt(x, y) {
  const [cx, cy] = toScreen(x, y), hits = [];
  for (const el of document.elementsFromPoint(cx, cy)) {
    if (!cam.contains(el) || el === cam) continue;
    const n = nameOf(el); if (!n || hits.some((h) => h.names[0] === n.ref)) continue;
    hits.push({ label: n.label, kind: n.kind, names: [n.ref], textures: [], type: n.el.tagName.toLowerCase(), distance: hits.length, count: 1, file: n.el.closest('[data-composition-src]')?.getAttribute('data-composition-src') ?? C.index ?? 'index.html' });
    if (n.kind === 'composition') break;
  }
  return hits;
}
const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60)))).then(() => R.when());
const seekTo = async (f) => { const p = P(); if (!p) return; const t = Math.max(0, Math.min(durationInFrames - 1, Math.round(f))) / FPS; await (p.seek?.(t) ?? null); emit('seeked'); R.watch(); };

// ---------- the 2D staging (player/stage2d.ts, as in a Remotion run) ----------
const stage2d = createStage2d({ W, H, frame: frameNow, root: () => cam });

// ---------- the player's events: a frame changed, play / pause, the end ----------
let lastF = -1, lastPlaying = false, rate = 1;
(function tick() {
  const p = P();
  if (p) {
    const f = frameNow(), playing = !!p.isPlaying?.();
    if (playing !== lastPlaying) { lastPlaying = playing; emit(playing ? 'play' : 'pause'); if (!playing && f >= durationInFrames - 1) emit('ended'); }
    if (f !== lastF) { lastF = f; emit('frameupdate'); }
  }
  requestAnimationFrame(tick);
})();

let ready = null;
const whenReady = () => ready ??= new Promise((resolve) => {
  const t0 = performance.now();
  (function wait() {
    const p = P();
    if (p && window.__playerReady) {
      const d = +p.getDuration?.(); if (d > 0) durationInFrames = Math.max(1, Math.round(d * FPS));
      document.fonts?.ready.then(() => settle()).then(resolve, resolve); return;
    }
    if (performance.now() - t0 > 30000) { resolve(); return; }
    setTimeout(wait, 50);
  })();
});

const media = () => document.querySelectorAll('audio, video');
window.StudioPlayer = {
  stage: stage2d, generic: true, hyperframes: true,
  objects: () => [], cameraPos: () => null,
  composition: root?.getAttribute('data-composition-id') ?? 'main', fps: FPS, width: W, height: H,
  get durationInFrames() { return durationInFrames; }, ok: !!root,
  whenReady,
  sleep: (on) => on,
  seek: (f) => { seekTo(f); },
  play: () => { const p = P(); if (p && frameNow() >= durationInFrames - 1) p.seek?.(0); p?.play?.(); },
  pause: () => P()?.pause?.(), isPlaying: () => !!P()?.isPlaying?.(),
  frame: frameNow,
  frameReady: () => R.ready(), frameLoading: () => R.isLoading(), whenFrameReady: () => R.when(),
  frameReadiness: () => R.status(),
  setVolume: (v) => { const p = P(); if (p?.setVolume) p.setVolume(v); else for (const m of media()) m.volume = v; },
  mute: () => { const p = P(); if (p?.setMuted) p.setMuted(true); else for (const m of media()) m.muted = true; },
  unmute: () => { const p = P(); if (p?.setMuted) p.setMuted(false); else for (const m of media()) m.muted = false; },
  setRate: (r) => { rate = r; P()?.setPlaybackRate?.(r); },
  on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  pick: async (frame, x, y) => { if (frameNow() !== frame) { P()?.pause?.(); await seekTo(frame); } await settle(); return pickAt(x, y); },
  hover: (frame, x, y) => (frameNow() === frame ? pickAt(x, y)[0] ?? null : undefined),
  pickMany: async (frame, points) => {
    if (frameNow() !== frame) { P()?.pause?.(); await seekTo(frame); }
    await settle();
    const seen = new Map();
    for (const [x, y] of points) { const first = pickAt(x, y)[0]; if (!first) continue; const s = seen.get(first.names[0]) ?? { ...first, count: 0 }; s.count++; seen.set(first.names[0], s); }
    return [...seen.values()].sort((a, b) => b.count - a.count);
  },
};
void rate;

// the first frame asked by the studio (?f=), and the « after » capture of a staging (?stage=…, /api/stage-shot)
whenReady().then(async () => {
  const q = new URLSearchParams(location.search), start = +(q.get('f') ?? 0);
  if (start) await seekTo(start); else await seekTo(0);
  const staged = q.get('stage');
  if (staged) {
    try {
      const list = JSON.parse(decodeURIComponent(escape(atob(staged.replace(/-/g, '+').replace(/_/g, '/')))));
      await Promise.all(list.filter((e) => e.cutout).map((e) => stage2d.addCutout({ ...e.cutout, id: e.id })));
      for (const e of list) stage2d.setDelta(e.id, e.delta, e.from, e.to);
      await settle(); stage2d.applyNow(); await settle();
    } catch (e) { console.error('stage', e); }
    window.__stageShotReady = true;
  }
  emit('ready');
});

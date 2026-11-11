// Live preview of ANY Remotion project opened through a .coulisses file (lib/coulisses-file.mjs) — no export.
// Built by the studio server with the project's own esbuild (lib/player-build.mjs): « @coulisses-module » is the
// project's module (src/coulisses.ts: export const compositions = [{ id, component, fps, width, height,
// durationInFrames, defaultProps }]), __COMPOSITION__ / __PROPS__ the run's composition and input props.
// window.StudioPlayer is the same API as the Brambleshire preview (player/entry.tsx), so the review page works as is.
// Picking: the element under a point that carries data-coulisses="<name>" (the contract asks the project to name the
// visible parts of its motion graphics that way), else nothing.
// « Mise en scène » (player/stage2d.ts): the composition is wrapped in #coulisses-camera (preview only), the frame the 2D
// staging reframes; ?stage=<base64url JSON> applies offsets at load (the server's « after » capture, /api/stage-shot).
import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Player, PlayerRef } from '@remotion/player';
import { createStage2d } from './stage2d';
import { createReady } from './ready';
import { createCrash } from './crash';
import { createSound, SoundContext } from './sound';
import { AssetsWait } from './assets-wait';
import { guardStalls } from './stall';
// @ts-ignore resolved by lib/player-build.mjs: player/three-stage.ts when the project has @react-three/fiber, else player/no3d.ts
import { create3d } from '@coulisses-3d';
// @ts-ignore resolved through esbuild's alias
import * as M from '@coulisses-module';

declare const __COMPOSITION__: string;
declare const __PROPS__: Record<string, unknown>;
const mod: any = (M as any).compositions ? M : (M as any).coulisses ?? (M as any).default ?? {};
const comps: any[] = mod.compositions ?? [];
const comp = comps.find((c) => c.id === __COMPOSITION__);
const props = { ...(comp?.defaultProps ?? {}), ...(__PROPS__ ?? {}) };
const durationInFrames = comp ? Math.max(1, Math.round(typeof comp.durationInFrames === 'function' ? comp.durationInFrames(props) : comp.durationInFrames)) : 1;
const FPS = comp?.fps ?? 30, W = comp?.width ?? 1920, H = comp?.height ?? 1080;
const listeners = new Set<(ev: { type: string; frame: number; [k: string]: unknown }) => void>();
let ref: PlayerRef | null = null;
const emit = (type: string, extra: Record<string, unknown> = {}) => { const frame = ref?.getCurrentFrame() ?? 0; for (const l of listeners) l({ type, frame, ...extra }); };
// the composition failing (player/crash.tsx): its error said, sent to the studio, the Player mounted again on recover()
const C = createCrash({ emit, redraw: () => draw() });
// the sound never lost for good: the Player's own mute after a failed start of its AudioContext taken back (player/sound.ts)
const S = createSound(emit);
// the frame complete or not (player/ready.ts): « loading » / « loaded » to the studio, which covers an incomplete one
const R = createReady({ root: () => document.getElementById('stage'), playing: () => !!ref?.isPlaying(), emit });

// the composition's (x, y) in its own pixels -> the element there; its nearest ancestor named by data-coulisses
function pick(x: number, y: number) {
  const host = document.querySelector('#stage [data-player-container], #stage') as HTMLElement | null;
  const canvas = Array.from(document.querySelectorAll('#stage div')).find((d) => (d as HTMLElement).style.width === `${W}px` && (d as HTMLElement).style.height === `${H}px`) as HTMLElement | undefined;
  const box = (canvas ?? host)?.getBoundingClientRect(); if (!box) return [];
  const cx = box.left + (x / W) * box.width, cy = box.top + (y / H) * box.height;
  const hits: any[] = [];
  for (const el of document.elementsFromPoint(cx, cy)) {
    const named = (el as HTMLElement).closest?.('[data-coulisses]') as HTMLElement | null;
    if (!named) continue;
    const label = named.dataset.coulisses ?? '';
    if (hits.some((h) => h.label === label)) continue;
    hits.push({ label, kind: named.dataset.coulissesType ?? 'élément', names: [label], textures: [], type: named.tagName.toLowerCase(), distance: hits.length, count: 1 });
  }
  return hits;
}
const settle = async () => { if (s3?.hasScene()) await s3.settle(); await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 80)))); await R.when(); };
// what is under the point: the 3D objects of a 3D scene first (named by their React components), then the HTML element
// named data-coulisses
const pickAll = (x: number, y: number) => [...(s3?.hasScene() ? s3.pick(x, y) : []), ...pick(x, y)];
const stage2d = createStage2d({ W, H, frame: () => suspended ? suspendedFrame : ref?.getCurrentFrame() ?? 0, root: () => document.getElementById('coulisses-camera') });
// a 3D scene on screen (a React Three Fiber canvas: a theatre shot, a 3D set): the Theatre's own 3D staging, else the 2D
// one — chosen when the staging starts; each offset goes back to the stage it belongs to (2D ids are @root, @camera or
// [data-coulisses="…"], 3D ids are React paths)
const s3 = create3d({ W, H, frame: () => ref?.getCurrentFrame() ?? 0 });
const is2d = (id: string) => /^(@root|@camera|\[data-coulisses=)/.test(String(id));
let active: any = stage2d;
const by = (id: string) => (is2d(id) || !s3 ? stage2d : s3.stage);
const stage: any = {
  get kind() { return active === stage2d ? '2d' : '3d'; },
  // a 3D scene on screen now (before the staging starts, the panel says how it will go: 3D cardboard or the 2D picture)
  get scene3d() { return !!s3?.hasScene(); },
  get selected() { return active.selected; }, get enabled() { return active.enabled; },
  elements: () => active.elements(),
  enable(want: boolean) {
    if (!want) { const r = active.enable(false); active = stage2d; return r; }
    if (s3 && s3.hasScene() && s3.stage.enable(true)) { active = s3.stage; return true; }
    active = stage2d; return stage2d.enable(true);
  },
  on: (fn: any) => { const a = stage2d.on(fn), b = s3?.stage.on(fn); return () => { a(); b?.(); }; },
  list: () => [...stage2d.list(), ...(s3 ? s3.stage.list() : [])],
  info: (id: string) => by(id).info(id),
  setDelta: (id: string, d: any, from?: number, to?: number) => by(id).setDelta(id, d, from, to),
  reset: (id: string) => by(id).reset(id),
  // « Médias »: an image dropped on the preview — cardboard in a 3D scene, the image itself on a 2D picture
  addCutout: (spec: any) => ((spec?.id ? by(spec.id) : active).addCutout?.(spec) ?? Promise.resolve(null)),
  has: (id: string) => by(id).has?.(id) ?? false,
  select: (id: string | null) => active.select(id),
  selectParent: () => active.selectParent?.() ?? false,
  setMode: (m: any) => active.setMode(m),
  freeCamera: (want: boolean, pose?: any) => active.freeCamera(want, pose),
  focusObject: (id: string) => active.focusObject?.(id) ?? false,
  setGuides: (show: boolean) => active.setGuides?.(show) ?? false,
  freePose: () => active.freePose?.() ?? null,
  resetCamera: () => active.resetCamera?.() ?? false,
  snapshot: () => active.snapshot(),
  screenPos: (id: string) => by(id).screenPos(id),
  edits: () => stage2d.edits(),
  applyNow: () => stage2d.applyNow(),
};
// the composition inside the camera's frame (an AbsoluteFill-like box: the project's own AbsoluteFills fill it as before)
const Framed: React.FC<any> = (p) => React.createElement('div', { id: 'coulisses-camera', style: { position: 'absolute', inset: 0, width: '100%', height: '100%' } }, React.createElement(comp.component, p));

(window as any).StudioPlayer = {
  stage, generic: true,
  objects: () => s3?.objects() ?? [],   // the 3D scene's objects (tests)
  cameraPos: () => s3?.cameraPos() ?? null,   // where the 3D camera is (tests)
  composition: __COMPOSITION__, fps: FPS, width: W, height: H, durationInFrames, ok: !!comp,
  whenReady: () => settle(),
  sleep: (on: boolean) => s3?.sleep?.(on) ?? on,
  seek: (f: number) => { const next = Math.max(0, Math.min(durationInFrames - 1, Math.round(f))); if (suspended) suspendedFrame = next; else ref?.seekTo(next); },
  play: () => ref?.play(), pause: () => ref?.pause(), isPlaying: () => !!ref?.isPlaying(),
  isBuffering: () => !!(ref as (PlayerRef & { isBuffering?: () => boolean }) | null)?.isBuffering?.(),
  unload: async () => { ref?.pause(); suspendedFrame = ref?.getCurrentFrame() ?? suspendedFrame; suspended = true; flushSync(() => root.render(null)); ref = null; R.suspend(); return suspendedFrame; },
  resume: async (f?: number) => { suspended = false; flushSync(() => C.recover(f ?? suspendedFrame)); R.watch(); await settle(); return ref?.getCurrentFrame(); },
  dispose: () => { ref?.pause(); S.dispose(); R.dispose(); root.unmount(); ref = null; },
  frame: () => suspended ? suspendedFrame : ref?.getCurrentFrame() ?? 0,
  frameReady: () => !suspended && R.ready(), frameLoading: () => R.isLoading(), whenFrameReady: () => R.when(),
  frameReadiness: () => suspended ? {state:'unavailable',reason:'suspended',verified:false,displayable:false} : R.status(),
  crashed: () => C.crashed, recover: (f?: number) => C.recover(f ?? ref?.getCurrentFrame() ?? 0),
  __crash: () => { C.crashNext(); const f = ref?.getCurrentFrame() ?? 0; ref?.seekTo(f + 1); ref?.seekTo(f); },
  setVolume: S.setVolume, mute: () => S.mute(), unmute: () => S.unmute(), isMuted: () => !!ref?.isMuted(), restoreSound: () => S.restore(), soundLost: () => S.lost(),
  setRate: (r: number) => { rate = r; draw(); },
  on: (fn: any) => { listeners.add(fn); return () => listeners.delete(fn); },
  pick: async (frame: number, x: number, y: number) => { if (ref && ref.getCurrentFrame() !== frame) { ref.pause(); ref.seekTo(frame); } await settle(); return pickAll(x, y); },
  hover: (frame: number, x: number, y: number) => (ref && ref.getCurrentFrame() === frame ? pickAll(x, y)[0] ?? null : undefined),
  pickMany: async (frame: number, points: [number, number][]) => {
    if (ref && ref.getCurrentFrame() !== frame) { ref.pause(); ref.seekTo(frame); }
    await settle();
    const seen = new Map<string, any>();
    for (const [x, y] of points) { const first = pickAll(x, y)[0]; if (!first) continue; const key = first.label ?? first.textures?.[0] ?? first.names?.[0] ?? first.type; const s = seen.get(key) ?? { ...first, count: 0 }; s.count++; seen.set(key, s); }
    return [...seen.values()].sort((a, b) => b.count - a.count);
  },
};

let rate = 1, suspended = false, suspendedFrame = 0;
// the composition, a test crash first (player/crash.tsx)
// (the playback waits for what the composition waits for: player/assets-wait.tsx — never a black frame played over)
const Comp: React.FC<any> = (p) => { C.check(); return <><SoundContext sound={S} /><AssetsWait /><Framed {...p} /></>; };
const App: React.FC = () => {
  const r = useRef<PlayerRef>(null);
  useEffect(() => {
    ref = r.current; if (!ref) return;
    const evs = ['play', 'pause', 'seeked', 'frameupdate', 'ended'] as const;
    const offs = evs.map((e) => { const h = () => { emit(e); if (e !== 'frameupdate' || !ref?.isPlaying()) R.watch(); }; ref!.addEventListener(e as any, h); return () => ref?.removeEventListener(e as any, h); });
    // the Player's own buffering (a media still loading during the playback)
    const onWait = () => { R.setBuffering(true); emit('waiting'); }, onResume = () => { R.setBuffering(false); emit('resume'); };   // (the page: its review sound waits too)
    (ref as any).addEventListener('waiting', onWait); (ref as any).addEventListener('resume', onResume);
    offs.push(() => { (ref as any)?.removeEventListener('waiting', onWait); (ref as any)?.removeEventListener('resume', onResume); });
    const onErr = (e: any) => C.onError(e, ref?.getCurrentFrame() ?? 0);
    (ref as any).addEventListener('error', onErr); offs.push(() => (ref as any)?.removeEventListener('error', onErr));
    offs.push(S.attach(ref));
    const q = new URLSearchParams(location.search), start = C.takeResume() ?? +(q.get('f') ?? 0);
    if (start) ref.seekTo(start);
    const staged = q.get('stage');
    if (staged) {   // the « after » capture: these offsets, at this frame, then the page says it is ready
      try {
        const list = JSON.parse(decodeURIComponent(escape(atob(staged.replace(/-/g, '+').replace(/_/g, '/')))));
        // an image dropped from « Médias » is laid again first, then every offset
        Promise.all(list.filter((e: any) => e.cutout).map((e: any) => stage.addCutout({ ...e.cutout, id: e.id })))
          .then(() => { for (const e of list) stage.setDelta(e.id, e.delta, e.from, e.to); })
          .then(() => settle()).then(() => { stage.applyNow(); return settle(); }).then(() => { (window as any).__stageShotReady = true; });
      } catch (e) { console.error('stage', e); (window as any).__stageShotReady = true; }
    }
    offs.push(guardStalls(() => ref, (info) => emit('stall', info), { fps: FPS, rate: () => rate }));   // (player/stall.ts: a freeze is never skipped)
    emit('ready'); R.watch();
    return () => offs.forEach((o) => o());
  }, []);
  if (!comp) return <div style={{ color: '#fff', padding: 20, font: '14px sans-serif' }}>Composition « {__COMPOSITION__} » absente de compositions (src/coulisses.ts). Disponibles : {comps.map((c) => c.id).join(', ') || 'aucune'}</div>;
  return (
    <div id="stage" style={{ width: '100vw', height: '100vh' }}>
      <Player ref={r} component={Comp} inputProps={props} errorFallback={C.fallback}
        durationInFrames={durationInFrames} fps={FPS} compositionWidth={W} compositionHeight={H}
        style={{ width: '100%', height: '100%' }} playbackRate={rate} clickToPlay={false} doubleClickToFullscreen={false}
        spaceKeyToPlayOrPause={false} moveToBeginningWhenEnded={false} acknowledgeRemotionLicense numberOfSharedAudioTags={192} />
    </div>
  );
};
const root = createRoot(document.getElementById('root')!);
const draw = () => root.render(suspended ? null : <App key={C.gen} />);
draw();

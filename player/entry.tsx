// Live preview of the CURRENT code of an episode (user choice: « aperçu vivant à côté du MP4 ») — no re-render.
// Built by the studio server with esbuild (lib/player-build.mjs) into one script per episode, loaded in an iframe
// (player.html) so that a rebuild after a code change is a clean reload. Every import resolves from the Remotion
// project (06_Remotion/node_modules): same React, same Remotion, same three as the renders.
// window.StudioPlayer is the iframe's API, used by the review page: seek / play / pause / frame events / pick (the
// 3D object under a point, by ray casting in the React Three Fiber scene — `_roots` is R3F's own registry of canvases).
import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Player, PlayerRef } from '@remotion/player';
import * as R3F from './r3f';
import { createStage } from './stage';
import { createReady } from './ready';
import { createCrash } from './crash';
import { createSound, SoundContext } from './sound';
import { AssetsWait } from './assets-wait';
import { guardStalls } from './stall';
// @ts-ignore resolved through esbuild's alias "@episode-src" -> 06_Remotion/src
import { Episode } from '@episode-src/Episode';
// @ts-ignore
import { EPISODES } from '@episode-src/episodes/registry';

declare const __EPISODE__: string;
const FPS = 30, W = 1920, H = 1080;
const entry = (EPISODES as any[]).find((e) => e.id === __EPISODE__);
const tl = entry ? entry.build() : null;
const durationInFrames = tl ? Math.ceil(tl.duration * FPS) : 1;
const listeners = new Set<(ev: { type: string; frame: number; [k: string]: unknown }) => void>();
let ref: PlayerRef | null = null;
const emit = (type: string, extra: Record<string, unknown> = {}) => { const frame = ref?.getCurrentFrame() ?? 0; for (const l of listeners) l({ type, frame, ...extra }); };
// the composition failing (player/crash.tsx): its error said, sent to the studio, the Player mounted again on recover()
const C = createCrash({ emit, redraw: () => draw() });
// the sound never lost for good: the Player's own mute after a failed start of its AudioContext taken back (player/sound.ts)
const S = createSound(emit);
// the frame complete or not (player/ready.ts): « loading » / « loaded » to the studio, which covers an incomplete one
const R = createReady({ root: () => document.getElementById('stage'), playing: () => !!ref?.isPlaying(), emit });

// ---- 3D picking: what is under (x, y) of the 1920×1080 frame (player/r3f.ts, shared with the runs' 3D scenes) ----
const pick = (x: number, y: number) => R3F.pick(x, y, W, H);
const settle = async () => { await R3F.settle(); await R.when(); };

// « Mise en scène »: move objects in the preview, the offsets go to Claude (player/stage.ts)
const stage = createStage({
  roots: R3F.roots, index: R3F.indexFibers, fiberOf: R3F.fiberOf, reactPath: R3F.reactPath, describe: R3F.describe, seen: R3F.seen, noise: R3F.NOISE,
  frame: () => suspended ? suspendedFrame : ref?.getCurrentFrame() ?? 0, W, H,
});
(window as any).StudioPlayer = {
  stage,
  episode: __EPISODE__, fps: FPS, width: W, height: H, durationInFrames, ok: !!entry,
  // ready to be shown: the stage's canvas there and its meshes loaded (a new version is shown only then: ~20 s for an episode)
  whenReady: () => settle(),
  sleep: (on: boolean) => R3F.sleep(on),
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
  pick: async (frame: number, x: number, y: number) => {
    if (ref && ref.getCurrentFrame() !== frame) { ref.pause(); ref.seekTo(frame); }
    await settle();
    return pick(x, y);
  },
  hover: (frame: number, x: number, y: number) => (ref && ref.getCurrentFrame() === frame ? pick(x, y)[0] ?? null : undefined),
  // several points of one gesture (a pin = 1 point; a drawing = a grid inside it): what is hit most, nearest first
  pickMany: async (frame: number, points: [number, number][]) => {
    if (ref && ref.getCurrentFrame() !== frame) { ref.pause(); ref.seekTo(frame); }
    await settle();
    const seen = new Map<string, any>();
    for (const [x, y] of points) {
      const first = pick(x, y)[0]; if (!first) continue;
      const key = first.textures[0] ?? first.names[0] ?? first.type;
      const s = seen.get(key) ?? { ...first, count: 0 };
      s.count++; s.distance = Math.min(s.distance, first.distance); seen.set(key, s);
    }
    return [...seen.values()].sort((a, b) => b.count - a.count || a.distance - b.distance);
  },
};

let rate = 1, suspended = false, suspendedFrame = 0;
// the episode, a test crash first (player/crash.tsx)
// (the playback waits for what the composition waits for: player/assets-wait.tsx — never a black frame played over)
const Comp: React.FC<any> = (p) => { C.check(); return <><SoundContext sound={S} /><AssetsWait /><Episode {...p} /></>; };
const App: React.FC = () => {
  const r = useRef<PlayerRef>(null);
  useEffect(() => {
    ref = r.current; if (!ref) return;
    const evs = ['play', 'pause', 'seeked', 'frameupdate', 'ended'] as const;
    const offs = evs.map((e) => { const h = () => { emit(e); if (e !== 'frameupdate' || !ref?.isPlaying()) R.watch(); }; ref!.addEventListener(e as any, h); return () => ref?.removeEventListener(e as any, h); });
    const onWait = () => { R.setBuffering(true); emit('waiting'); }, onResume = () => { R.setBuffering(false); emit('resume'); };   // (the page: its review sound waits too)
    (ref as any).addEventListener('waiting', onWait); (ref as any).addEventListener('resume', onResume);
    offs.push(() => { (ref as any)?.removeEventListener('waiting', onWait); (ref as any)?.removeEventListener('resume', onResume); });
    const onErr = (e: any) => C.onError(e, ref?.getCurrentFrame() ?? 0);
    (ref as any).addEventListener('error', onErr); offs.push(() => (ref as any)?.removeEventListener('error', onErr));
    offs.push(S.attach(ref));
    const start = C.takeResume() ?? +(new URLSearchParams(location.search).get('f') ?? 0);
    if (start) ref.seekTo(start);
    offs.push(guardStalls(() => ref, (info) => emit('stall', info), { fps: FPS, rate: () => rate }));   // (player/stall.ts: a freeze is never skipped)
    emit('ready'); R.watch();
    return () => offs.forEach((o) => o());
  }, []);
  if (!entry) return <div style={{ color: '#fff', padding: 20 }}>Épisode {__EPISODE__} introuvable dans src/episodes/registry.ts</div>;
  return (
    <div id="stage" style={{ width: '100vw', height: '100vh' }}>
      <Player ref={r} component={Comp} inputProps={{ tl, assets: entry.assets, scale: entry.scale }} errorFallback={C.fallback}
        durationInFrames={durationInFrames} fps={FPS} compositionWidth={W} compositionHeight={H}
        style={{ width: '100%', height: '100%' }} playbackRate={rate} clickToPlay={false} doubleClickToFullscreen={false}
        spaceKeyToPlayOrPause={false} moveToBeginningWhenEnded={false} acknowledgeRemotionLicense
        numberOfSharedAudioTags={192} /* an episode stacks music, voices and sound effects: the default 5 is not enough, 48 was not either (E11, 17/10/2026: 49 at once, the preview stopped) */ />
    </div>
  );
};
const root = createRoot(document.getElementById('root')!);
const draw = () => root.render(suspended ? null : <App key={C.gen} />);
draw();

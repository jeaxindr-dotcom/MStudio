// Le contexte et les balises enregistrées appartiennent à cette composition.
// Remotion sait quelles séquences peuvent jouer (prémontage, fin de plan, mute).
import { useContext, useEffect } from 'react';
import type { PlayerRef } from '@remotion/player';
import { Internals } from 'remotion';

type ContextBinding = { bindContext: (context: AudioContext | null, wakeTags?: () => void, isBuffering?: () => boolean) => () => void };
type BufferingPlayer = PlayerRef & { isBuffering?: () => boolean };
export function SoundContext({ sound }: { sound: ContextBinding }) {
  const shared = useContext(Internals.SharedAudioContext);
  const { audioAndVideoTags: tags, isBuffering } = useContext(Internals.SetTimelineContext) ?? {};
  useEffect(() => sound.bindContext(shared?.audioContext ?? null, () => {
    tags?.current?.forEach(tag => tag.play('Rétablir le son dans Coulisses'));
  }, isBuffering), [sound, shared?.audioContext, tags, isBuffering]);
  return null;
}

// Le petit MP3 silencieux que Remotion installe dans ses balises de réserve.
// Les vrais sons en data: et les vidéos possédant une piste audio restent admis.
const emptyAudio = 'data:audio/mp3;base64,/+MYxAAJcAV8AAgAABn//////+/gQ5';
function mediaWithSound() {
  // Le pool du SDK est frère du conteneur renvoyé par getContainerNode().
  const media = document.querySelectorAll<HTMLMediaElement>('#stage audio, #stage video');
  return Array.from(media).filter(el => {
    const video = el as HTMLVideoElement & { audioTracks?: { length: number }; webkitAudioDecodedByteCount?: number; mozHasAudio?: boolean };
    return el.currentSrc && !el.currentSrc.startsWith(emptyAudio) && !el.ended &&
      (el.tagName === 'AUDIO' || video.audioTracks?.length || video.webkitAudioDecodedByteCount || video.mozHasAudio);
  });
}

export function createSound(emit: (type: string, extra?: Record<string, unknown>) => void) {
  let cur: BufferingPlayer | null = null, wantedMute = false, volume = 1, buffering = false;
  let context: AudioContext | null = null, releaseContext: (() => void) | null = null, wakeTags: (() => void) | undefined;
  let readBuffering: (() => boolean) | undefined;
  let resuming: Promise<void> | null = null;
  let syncMute = false, wakeMedia = false;
  let lost = false, explicit = false, delay = 1000, fails: number[] = [], deadAt = -Infinity;
  let retry: ReturnType<typeof setTimeout> | null = null, probe: ReturnType<typeof setTimeout> | null = null;
  let since = 0, lastT = -1, lastW = 0, bad = 0, notice = '';
  type TrackSample = { src: string; time: number; at: number; ready: boolean; playing: boolean; retried: boolean };
  type Sample = { at: number; clock: number; positions: Map<HTMLMediaElement, TrackSample> };
  let sample: Sample | null = null;

  const clearRetry = () => { if (retry !== null) clearTimeout(retry); retry = null; };
  const clearProbe = () => { if (probe !== null) clearTimeout(probe); probe = null; sample = null; };
  const resetWatch = () => { since = performance.now(); bad = 0; lastT = -1; };
  const waiting = () => readBuffering?.() ?? cur?.isBuffering?.() ?? buffering;
  const active = () => !!cur?.isPlaying() && !wantedMute && volume > 0 && !document.hidden && !waiting();
  const tell = (state: string, why?: string) => {
    if (notice === state) return;
    notice = state; emit('sound', { state, why });
  };
  const dead = (why: string) => {
    if (explicit) {
      explicit = lost = false; clearRetry(); clearProbe(); tell('failed', why); return;
    }
    const t = performance.now(); if (t - deadAt < 20000) return;
    deadAt = t; bad = 0; fails = []; clearRetry();
    tell('dead', why);
  };
  const wake = () => {
    const c = context;
    if (!active() || cur!.isMuted() || !c || c.state === 'running' || c.state === 'closed' || resuming) return;
    try {
      const attempt = c.resume(); resuming = attempt;
      const done = () => { if (resuming === attempt) resuming = null; };
      attempt.then(done, done);
    } catch { /* la surveillance mesure le résultat même en cas de refus synchrone */ }
  };
  const schedule = (ms: number) => {
    if ((explicit || lost) && probe === null) probe = setTimeout(inspect, ms);
  };
  function inspect() {
    probe = null;
    const r = cur, c = context;
    if (!r || wantedMute || !volume || (!explicit && !lost)) return;
    if (!explicit && r.isMuted()) return;
    if (c?.state === 'closed') { dead('closed'); return; }
    if (!active()) {
      sample = null;
      if (explicit) tell(r.isPlaying() ? 'waiting' : 'armed');
      return; // play, resume ou le contrôle périodique reprendra la mesure.
    }
    const now = performance.now(), clock = c?.currentTime ?? 0;
    if (!sample) sample = { at: now, clock, positions: new Map() };
    if (wakeMedia && !r.isMuted()) { wakeMedia = false; wakeTags?.(); }
    const media = mediaWithSound().filter(el => !el.muted && el.volume > 0);
    let mediaAdvance = 0, retryMedia = false, failedMedia = false, readyTracks = 0;
    for (const el of sample.positions.keys()) if (!media.includes(el)) sample.positions.delete(el);
    for (const el of media) {
      const ready = el.readyState >= 2 && !el.seeking, playing = ready && !el.paused;
      if (ready) readyTracks++;
      const start = sample.positions.get(el);
      if (!start || start.src !== el.currentSrc || start.ready !== ready || start.playing !== playing) {
        sample.positions.set(el, { src: el.currentSrc, time: el.currentTime, at: now, ready, playing, retried: false });
        continue;
      }
      if (playing) mediaAdvance = Math.max(mediaAdvance, el.currentTime - start.time);
      const age = now - start.at;
      if (ready && !playing && !start.retried && age >= 250) { start.retried = true; retryMedia = true; }
      // Une recherche de position ou un nouveau média a son propre départ.
      // Le délai de décodage ne compte pas comme du temps de lecture muette.
      if (el.error || age >= (ready ? 2200 : 30000)) failedMedia = true;
    }
    if (retryMedia && !r.isMuted()) wakeTags?.();
    const elapsed = now - sample.at;
    const clockOK = c?.state === 'running' && clock - sample.clock >= 0.3 * elapsed / 1000;
    if (elapsed >= 100 && clockOK && !r.isMuted() && mediaAdvance > 0.025) {
      const clockAdvance = clock - sample.clock;
      explicit = lost = false; delay = 1000; fails = []; deadAt = -Infinity; clearRetry(); clearProbe(); notice = 'back';
      emit('sound', { state: 'back', context: c.state, clockAdvance, mediaAdvance }); return;
    }
    // Un passage sans piste audible ne justifie jamais de reconstruire toute la scène.
    // Une balise Web Audio peut publier son temps HTML par pas de plus d'une seconde.
    if (explicit && (failedMedia || elapsed >= 2200 && (!clockOK || r.isMuted()))) {
      dead(!clockOK ? 'clock' : 'media'); return;
    }
    if (explicit) tell(media.length ? (readyTracks ? 'checking' : 'waiting') : 'quiet');
    if (elapsed >= 2200) { sample.at = now; sample.clock = clock; }
    schedule(notice === 'quiet' ? 500 : 120);
  }
  const onMute = (e: { detail: { isMuted: boolean } }) => {
    const r = cur; if (!r || wantedMute || !volume) return;
    if (e.detail.isMuted) {
      if (syncMute) { syncMute = false; r.unmute(); return; }
      const t = performance.now(); fails = fails.filter(x => t - x < 20000); fails.push(t);
      if (fails.length >= 4) { dead('refused'); return; }
      lost = true; if (!explicit) tell('lost');
      clearRetry();
      retry = setTimeout(() => { retry = null; if (cur === r && r.isMuted() && !wantedMute) r.unmute(); }, delay);
      delay = Math.min(10000, delay * 2);
    } else { wakeMedia = explicit || lost; wake(); schedule(0); }
  };
  const watch = () => {
    schedule(0);
    if (!active() || cur!.isMuted()) { lastT = -1; bad = 0; return; }
    wake(); // Couvre aussi une suspension tardive ou un événement du SDK manqué.
    const c = context, now = performance.now(); if (!c || now - since < 2500) return;
    if (c.state === 'closed') { dead('closed'); return; }
    const t = c.currentTime;
    const ok = c.state === 'running' && (lastT < 0 || t - lastT >= 0.3 * (now - lastW) / 1000);
    lastT = t; lastW = now; bad = ok ? 0 : bad + 1;
    if (bad >= 5) dead(c.state === 'running' ? 'stalled' : c.state);
  };
  const onPlay = () => { resetWatch(); wakeMedia = explicit || lost; wake(); schedule(0); };
  const onPause = () => { clearProbe(); schedule(0); };
  const onWait = () => { buffering = true; resetWatch(); onPause(); };
  const onGo = () => { buffering = false; onPlay(); };
  return {
    bindContext(c: AudioContext | null, tags?: () => void, isBuffering?: () => boolean) {
      releaseContext?.(); context = c; wakeTags = tags; readBuffering = isBuffering; resuming = null;
      resetWatch(); deadAt = -Infinity;
      (window as any).__coulissesAudio = c ? [c] : [];
      const onError = () => { if (active()) dead('error'); };
      c?.addEventListener('error', onError);
      c?.addEventListener('statechange', wake);
      const release = () => {
        c?.removeEventListener('error', onError); c?.removeEventListener('statechange', wake);
        if (releaseContext !== release) return;
        context = null; wakeTags = readBuffering = undefined; resuming = null; releaseContext = null;
        (window as any).__coulissesAudio = []; clearProbe(); resetWatch();
      };
      releaseContext = release;
      return release;
    },
    attach(r: BufferingPlayer) {
      cur = r; clearRetry(); delay = 1000; lost = explicit = false; notice = ''; fails = []; buffering = !!r.isBuffering?.(); resetWatch();
      r.addEventListener('mutechange', onMute); r.addEventListener('play', onPlay); r.addEventListener('pause', onPause);
      r.addEventListener('waiting', onWait); r.addEventListener('resume', onGo);
      const tick = setInterval(watch, 1000);
      if (r.isMuted() && !wantedMute) r.unmute();
      return () => {
        clearInterval(tick);
        r.removeEventListener('mutechange', onMute); r.removeEventListener('play', onPlay); r.removeEventListener('pause', onPause);
        r.removeEventListener('waiting', onWait); r.removeEventListener('resume', onGo);
        if (cur === r) { cur = null; clearRetry(); clearProbe(); }
      };
    },
    setVolume(x: number) {
      volume = x; cur?.setVolume(x);
      if (!x) { explicit = lost = syncMute = false; clearRetry(); clearProbe(); }
    },
    mute() { wantedMute = true; explicit = lost = syncMute = false; clearRetry(); clearProbe(); cur?.mute(); },
    unmute() { wantedMute = false; clearRetry(); delay = 1000; resetWatch(); cur?.unmute(); },
    async dispose() {
      wantedMute = true; clearRetry(); clearProbe(); cur?.pause(); cur = null;
      const owned = context;
      releaseContext?.();
      if (owned && owned.state !== 'closed') {
        try { await owned.close(); } catch { /* contexte déjà arrêté par le navigateur */ }
      }
    },
    restore() {
      if (!cur) return false;
      wantedMute = false; clearRetry(); clearProbe(); delay = 1000; fails = []; notice = '';
      explicit = wakeMedia = true; resuming = null; resetWatch();
      // Si le Player se croit audible et que toutes ses balises sont muettes,
      // faire réappliquer le mix par Remotion. Chaque piste garde son mute de scène.
      const media = mediaWithSound();
      syncMute = !cur.isMuted() && media.length > 0 && media.every(el => el.muted);
      if (syncMute) cur.mute(); else cur.unmute();
      wake();
      schedule(0); return 'checking'; // demande prise en compte ; seule la mesure émet « back ».
    },
    lost: () => lost,
    contexts: () => context ? [{ state: context.state, t: +context.currentTime.toFixed(2), rate: context.sampleRate }] : [],
  };
}

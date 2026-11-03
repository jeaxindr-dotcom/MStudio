// Après un gel du fil de l'aperçu (une scène lourde qui se monte : 6 s pour un gros plan de 宇宙ちゃん long07, mesuré le
// 03/11/2026), le Player de Remotion rattrape son horloge et SAUTE les images perdues (2758 → 2944). Ici, il reprend à
// l'image où il s'était figé, comme une vidéo qui charge : rien n'est sauté, et le son est recalé par le seek.
// Le Player peut rattraper son horloge avant ou après ce contrôle : un gel arme une fenêtre de 400 ms pendant laquelle
// un bond au-delà de l'image figée (+ la durée écoulée depuis la fin du gel) ramène à l'image figée.
import type { PlayerRef } from '@remotion/player';

export function guardStalls(get: () => PlayerRef | null, onStall: (info: { ms: number; from: number; to: number }) => void = () => {},
  { gapMs = 1000, fps = 30, rate = () => 1 }: { gapMs?: number; fps?: number; rate?: () => number } = {}) {
  let lastT = performance.now(), lastF = -1, raf = 0, stopped = false;
  let armed: { frame: number; at: number; ms: number } | null = null, playingSince = 0, wasHidden = false;
  // (only a real freeze, over a second: the first frames of a playback and a tab hidden by the user are left to the Player —
  // a seek there cut the sound of a playback just started, tests/sound-recovery.mjs)
  const loop = () => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    const ref = get(), now = performance.now(), gap = now - lastT;
    lastT = now;
    if (!ref) { lastF = -1; armed = null; return; }
    const f = ref.getCurrentFrame();
    if (!ref.isPlaying()) { lastF = f; armed = null; playingSince = 0; return; }
    if (!playingSince) playingSince = now;
    const hidden = document.hidden || wasHidden; wasHidden = document.hidden;
    if (gap > gapMs && lastF >= 0 && !hidden && now - gap - playingSince > 1500) armed = { frame: lastF, at: now, ms: Math.round(gap) };
    if (armed) {
      const allowed = armed.frame + 2 + Math.ceil((now - armed.at) / 1000 * fps * Math.max(1, rate()));
      if (f > allowed) { const back = armed.frame + 1; ref.seekTo(back); onStall({ ms: armed.ms, from: back, to: f }); lastF = back; armed = null; return; }
      if (now - armed.at > 400) armed = null;
    }
    lastF = f;
  };
  raf = requestAnimationFrame(loop);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}

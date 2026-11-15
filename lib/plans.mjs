// Notes that follow the video (user request, 19/10/2026: « quand l'agent rallonge ou raccourcit la vidéo, la note doit
// rester collée à la même partie de la vidéo, pas à la même frame »).
// A plan is what a version of the video is made of, as instants with a name — the start and end of every spoken line (by
// its id), of every 3D shot, set and curtain move (an episode of the Theatre); of every clip of a montage plan (by its
// ref, else its file), and the seconds of the source files it shows. Each version's plan is kept (revue/plans/<sig>.json,
// its anchors only); a note remembers the plan it was placed on (lib: its sig) and is placed on another one by the
// instants both share: between two of them, in proportion (the same line, the same shot, the same second of a source).
// Anchors are matched by priority and by agreement with the whole timeline. A reused clip name must not be able to
// pull every following note to the end of the film just because it occurs first in the old timeline.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const r3 = (x) => Math.round(x * 1000) / 1000;
const MEDIA = /\.(mp4|mov|m4v|webm|mkv|avi|mxf|wav|mp3|m4a|aac|ogg|opus|flac)$/i;
// a plan's instants: [name, t (s), priority] and its duration — the Theatre's (says, sets…) or a montage's (tracks)
export function anchorsOf(data) {
  if (!data) return null;
  const out = [], occ = new Map();
  const nth = (k) => { const n = (occ.get(k) ?? 0) + 1; occ.set(k, n); return `${k}#${n}`; };
  const add = (k, t, p) => { if (Number.isFinite(t)) out.push([k, r3(t), p]); };
  let duration = +data.duration || 0;
  if (Array.isArray(data.says) || Array.isArray(data.sets)) {
    for (const s of data.says ?? []) if (s.id) { add(`say:${s.id}:a`, s.t, 0); add(`say:${s.id}:b`, s.t + s.dur, 0); }
    for (const c of data.cutaways ?? []) { const k = nth(`cut:${c.id}`); add(`${k}:a`, c.t, 1); add(`${k}:b`, c.t + c.dur, 1); }
    for (const w of data.sets ?? []) {
      const k = nth(`set:${w.id}`); add(`${k}:in`, w.inT, 2); add(`${k}:in2`, w.inT + w.inDur, 2);
      if (w.outT !== null && w.outT !== undefined) { add(`${k}:out`, w.outT, 2); add(`${k}:out2`, w.outT + w.outDur, 2); }
    }
    for (const c of data.curtain ?? []) { const k = nth(`cur:${c.open ? 'open' : 'shut'}`); add(`${k}:a`, c.t, 3); add(`${k}:b`, c.t + c.dur, 3); }
  }
  if (Array.isArray(data.tracks)) {
    const fps = +data.fps || 30;
    if (!duration && data.frames) duration = data.frames / fps;
    const total = duration || (data.frames ? data.frames / fps : 0) || Math.max(0, ...data.tracks.flatMap((tr) => (tr.clips ?? []).map((c) => c.t1)));
    for (const tr of data.tracks) for (const c of tr.clips ?? []) {
      if (c.off) continue;
      const len = c.t1 - c.t0, media = c.file && MEDIA.test(c.file);
      const base = c.ref ? `ref:${tr.id}:${c.ref}` : c.file ? `file:${tr.id}:${c.file}` : `label:${tr.id}:${c.label}`;
      const k = nth(base);
      // the picture first (a shot by its ref, the seconds of a rush); then a voice cut in sentences; a chapter, a shot
      // known only by its label; a long sound last (a music bed, a voice in one piece: it may stay where it is while the
      // picture moves — never the one that decides)
      const bed = tr.type === 'audio' && (len > 30 || (total > 0 && len > total * 0.4));
      const p = tr.type === 'audio' ? (bed ? 4 : 1) : tr.type === 'band' ? 2 : c.ref || media ? 0 : 2;
      add(`${k}:a`, c.t0, p); add(`${k}:b`, c.t1, p);
      // the same second of a rush, wherever the clip that shows it went (trimmed, moved): exact inside it
      if (media && tr.type !== 'audio' && tr.type !== 'band' && Number.isFinite(+c.from) && len > 1) {
        const s0 = (+c.from) / fps;   // (from: the clip's first frame in its source)
        for (let s = Math.ceil(s0); s < s0 + len; s++) add(`src:${tr.id}:${c.file}@${s}`, c.t0 + (s - s0), 0);
      }
    }
  }
  if (!duration) duration = Math.max(0, ...out.map((a) => a[1]));
  // (a name given twice in one plan — two clips of the same file and second — is no anchor: it cannot be told apart)
  const seen = new Map(); for (const a of out) seen.set(a[0], (seen.get(a[0]) ?? 0) + 1);
  return { duration: r3(duration), fps: +data.fps || 30, keys: out.filter((a) => seen.get(a[0]) === 1) };
}
export const planSig = (A) => crypto.createHash('sha1').update(JSON.stringify([A.duration, A.fps || 30, A.keys])).digest('hex').slice(0, 12);

export const NOTE_MAPPING_VERSION = 2;
const mappingCache = new WeakMap();

// Maximum-consensus monotone chain, including all votes for coincident anchors. Process equal old times together:
// two different destinations for the same instant cannot both belong to a mapping. The Fenwick tree keeps this
// O(n log n), including plans with a source-frame anchor every second for several hours.
function consensus(points) {
  if (!points.length) return [];
  const groups = new Map();
  for (const c of points) {
    const key = `${c[0]}:${c[1]}`;
    const g = groups.get(key);
    if (g) g.members.push(c); else groups.set(key, { o: c[0], n: c[1], members: [c] });
  }
  const sorted = [...groups.values()].sort((a, b) => a.o - b.o || a.n - b.n);
  const values = [...new Set(sorted.map((g) => g.n))].sort((a, b) => a - b);
  const rank = new Map(values.map((v, i) => [v, i + 1]));
  const tree = Array(values.length + 1).fill(null);
  const better = (a, b) => !b || (a && (a.score > b.score || (a.score === b.score && a.cost < b.cost))) ? a : b;
  const query = (i) => { let best = null; for (; i > 0; i -= i & -i) best = better(tree[i], best); return best; };
  const update = (i, g) => { for (; i < tree.length; i += i & -i) tree[i] = better(g, tree[i]); };
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j < sorted.length && sorted[j].o === sorted[i].o) {
      const g = sorted[j++], prev = query(rank.get(g.n));
      g.prev = prev; g.score = (prev?.score ?? 0) + g.members.length;
      g.cost = (prev?.cost ?? 0) + Math.abs(g.n - g.o) * g.members.length;
    }
    for (; i < j; i++) update(rank.get(sorted[i].n), sorted[i]);
  }
  const kept = [];
  for (let g = query(values.length); g; g = g.prev) kept.push(...g.members);
  return kept.reverse();
}

// A numbered occurrence is not a stable content identity: inserting/removing its earlier sibling changes its name.
// Prefer unique dialogue/shot IDs over repeated decorations even when the latter occupy a nominally visual track.
function repeatedIdentities(plan) {
  const seen = new Map();
  for (const [key] of plan.keys) {
    const m = /^(.*)#(\d+):(a|b|in|in2|out|out2)$/.exec(key);
    if (!m) continue;
    if (!seen.has(m[1])) seen.set(m[1], new Set());
    seen.get(m[1]).add(m[2]);
  }
  return new Set([...seen].filter(([, occurrences]) => occurrences.size > 1).map(([base]) => base));
}

// Old time → new time. Higher-priority content is fitted first, but *all* anchors of that priority vote before any
// is accepted. Lower-priority chapter/music anchors may fill gaps, never change the interior of a matched shot.
export function mapper(A, B) {
  let cached = mappingCache.get(A);
  if (cached?.has(B)) return cached.get(B);
  const at = new Map(B.keys.map((k) => [k[0], k[1]]));
  const repeated = new Set([...repeatedIdentities(A), ...repeatedIdentities(B)]);
  const priorityOf = ([key, , p]) => p + (repeated.has(key.replace(/#\d+:(a|b|in|in2|out|out2)$/, '')) ? 3 : 0);
  const cands = A.keys.filter((k) => at.has(k[0])).map((k) => [k[1], at.get(k[0]), priorityOf(k), k[0]])
    .filter(([o, n]) => Number.isFinite(o) && Number.isFinite(n) && o >= 0 && n >= 0 && o <= A.duration && n <= B.duration);
  cands.sort((x, y) => x[2] - y[2] || x[0] - y[0]);
  const ok = [];   // real anchors first; synthetic film boundaries only fill otherwise unanchored edges
  const fits = (i, o, n) => (i === 0 || (ok[i - 1][0] < o && ok[i - 1][1] <= n)) && (i === ok.length || (ok[i][0] > o && ok[i][1] >= n));
  const index = (o) => { let lo = 0, hi = ok.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ok[m][0] < o) lo = m + 1; else hi = m; } return lo; };
  const compatible = (o, n) => { const i = index(o); return ok[i]?.[0] === o ? ok[i][1] === n : fits(i, o, n); };
  const place = (o, n) => { const i = index(o); if (ok[i]?.[0] === o) return ok[i][1] === n; if (!fits(i, o, n)) return false; ok.splice(i, 0, [o, n]); return true; };
  // a shot, a spoken line, a set's arrival: one piece — once both its ends are kept, nothing of a lower priority cuts it
  // (a chapter that did not move inside a shot that did); the seconds of a rush, of the same priority, still may (exact)
  const ends = new Map(), solid = [];
  const pairOf = (key) => /:(a|b|in|in2|out|out2)$/.test(key) ? key.replace(/:(a|b)$/, '').replace(/:(in|in2)$/, ':in').replace(/:(out|out2)$/, ':out') : null;
  let considered = 0, agreed = 0;
  for (const priority of [...new Set(cands.map((c) => c[2]))]) {
    const eligible = cands.filter(([o, , p]) => p === priority && !solid.some((s) => s.p < p && s.o0 < o && o < s.o1));
    const kept = consensus(eligible.filter(([o, n]) => compatible(o, n)));
    considered += eligible.length; agreed += kept.length;
    for (const [o, n, p, key] of kept) {
      if (!place(o, n)) continue;
      const base = pairOf(key); if (!base) continue;
      const e = ends.get(base); if (e === undefined) { ends.set(base, o); continue; }
      solid.push({ o0: Math.min(e, o), o1: Math.max(e, o), p });
    }
  }
  const realInstants = ok.length;
  if (!ok.length || ok[0][0] > 0) ok.unshift([0, 0]);
  if (ok.at(-1)[0] < A.duration) ok.push([A.duration, B.duration]);
  const map = (t) => {
    if (t <= 0) return ok[0][1];
    let lo = 0, hi = ok.length - 1;
    if (t >= ok[hi][0]) return Math.min(B.duration, ok[hi][1] + (t - ok[hi][0]));
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ok[m][0] <= t) lo = m; else hi = m; }
    const [o0, n0] = ok[lo], [o1, n1] = ok[hi];
    return n0 + (n1 - n0) * (o1 > o0 ? (t - o0) / (o1 - o0) : 0);
  };
  const assess = (t0, t1 = t0) => {
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || A.duration <= 0 || B.duration <= 0) return { safe: false, reason: 'invalid-position' };
    if (agreed < 2 || realInstants < 2) return { safe: false, reason: 'insufficient-anchors' };
    if (agreed <= considered / 2) return { safe: false, reason: 'conflicting-anchors' };
    const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
    for (let i = 1; i < ok.length; i++) {
      const [o0, n0] = ok[i - 1], [o1, n1] = ok[i];
      if (o1 > lo && o0 <= hi && n1 === n0 && o1 > o0) return { safe: false, reason: 'removed-interval' };
      // Extreme local compression can be a real edit, but cannot safely identify the same reviewed moment without
      // confirmation. Do not silently squash a many-second note range into a few frames of unrelated content.
      if (o1 > lo && o0 <= hi && o1 - o0 >= 1 && (n1 - n0) / (o1 - o0) < 1 / 32) return { safe: false, reason: 'compressed-interval' };
    }
    return { safe: true, reason: null };
  };
  const result = { map, assess, anchors: ok.length, shared: cands.length, agreed };
  if (!cached) { cached = new WeakMap(); mappingCache.set(A, cached); }
  cached.set(B, result);
  return result;
}
export function assessFrameMapping(A, B, frame, end) {
  const fps = A.fps || B.fps || 30;
  return mapper(A, B).assess((frame + 0.5) / fps, ((end ?? frame) + 0.5) / fps);
}
// a note's frames on another plan (its first frame and its last, at their middles: the frame that shows that moment)
export function mapFrames(A, B, frame, end, fps = B.fps || 30) {
  const M = mapper(A, B), last = Math.max(0, Math.round(B.duration * fps) - 1);
  const f = (x) => Math.max(0, Math.min(last, Math.floor(M.map((x + 0.5) / (A.fps || fps)) * fps)));
  const nf = f(frame), ne = end === null || end === undefined ? null : Math.min(last, Math.max(nf + 1, f(end)));
  return { frame: nf, end: ne === nf ? null : ne };
}

// the plans of a review folder (revue/plans/): each version's anchors by its sig, and which plan each video is
export function planStore(dir) {
  const memo = new Map();
  const file = (sig) => path.join(dir, `${sig}.json`);
  const videosFile = path.join(dir, 'videos.json');
  const prune = () => {   // (the 300 newest kept)
    try {
      const fs0 = fs.readdirSync(dir).filter((f) => /^[0-9a-f]{12}\.json$/.test(f)).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
      for (const x of fs0.slice(300)) fs.rmSync(path.join(dir, x.f), { force: true });
    } catch { /* */ }
  };
  return {
    // a plan seen: kept (once), its sig
    save(data) {
      const A = anchorsOf(data); if (!A || !A.keys.length) return null;
      const sig = planSig(A);
      if (!memo.has(sig)) {
        memo.set(sig, A);
        try { if (!fs.existsSync(file(sig))) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file(sig), JSON.stringify(A)); prune(); } else fs.utimesSync(file(sig), new Date(), new Date()); } catch { /* read-only: in memory */ }
      }
      return sig;
    },
    load(sig) {
      if (!/^[0-9a-f]{12}$/.test(String(sig))) return null;
      if (memo.has(sig)) return memo.get(sig);
      try { const A = JSON.parse(fs.readFileSync(file(sig), 'utf8')); memo.set(sig, A); return A; } catch { return null; }
    },
    // the plan of a video (its size and date): set when Coulisses knows it (an export of the code as it is)
    videoPlan(stamp) { if (!stamp) return null; try { return JSON.parse(fs.readFileSync(videosFile, 'utf8'))[`${stamp.size}:${stamp.mtime}`] ?? null; } catch { return null; } },
    setVideoPlan(stamp, sig) {
      if (!stamp || !sig) return;
      let j = {}; try { j = JSON.parse(fs.readFileSync(videosFile, 'utf8')); } catch { /* new */ }
      const k = `${stamp.size}:${stamp.mtime}`; if (j[k] === sig) return;
      j[k] = sig; const keys = Object.keys(j); for (const x of keys.slice(0, Math.max(0, keys.length - 100))) delete j[x];
      try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(videosFile + '.tmp', JSON.stringify(j, null, 1)); fs.renameSync(videosFile + '.tmp', videosFile); } catch { /* */ }
    },
  };
}

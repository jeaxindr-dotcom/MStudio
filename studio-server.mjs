// Studio de revue Remotion — Brambleshire Theatre (évolution de 06_Remotion/review/review-server.mjs, dans l'esprit de
// HyperFrames Studio : annoter sur l'image, file de modifications envoyées à Claude, « yeux », annulation par lot).
// Everything the review tool did is kept, with the same files (revue/notes.json written by the page only,
// revue/replies.json written by Claude only). New:
//   - live preview of the CURRENT code (Remotion Player, rebuilt by esbuild on every save) next to the MP4
//   - /api/frame : an image at a frame, from the MP4 or from the code (renderStill)
//   - /api/send  : the pending edits become a batch revue/lots/NNN.{json,md} (+ images); the page shows the line to paste
//                  in the Claude session (or the session watching with `studio-cli.mjs wait` picks it up by itself)
//   - /api/undo  : « Annuler / Rétablir cette correction » from the snapshots Claude took (revue/runs/NNN/)
//   - /api/render: « Lancer le rendu » = a render request for the Claude session (lot of kind 'render'); its progress is
//                  revue/render.json, written by `studio-cli.mjs render`; /api/hold and /api/unhold let go of the video
//                  while finish-render.sh replaces it; /api/compare = the before / after of each corrected note
//   - /api/export : « Exporter » a run of a Remotion pipeline (.coulisses) with the project's own export script, on the
//                  user's order (lib/export.mjs); /api/export/stop, /api/export/log
// usage: node studio-server.mjs E03 [--port N] [--no-open] [--theatre <dir>] [--episodes <dir>] [--remotion <dir>]
//        node studio-server.mjs --project "<project folder or its revue folder>" [--port N] [--no-open]
//        (an imported project, lib/projects.mjs: an AItelier run or any video; no live preview, staging nor render)
// Port: 4173 for the copy installed in the pipeline (06_Remotion\review\studio), 4174 in the Dev workshop.
// Local only (127.0.0.1). Close the window (or Ctrl+C) to stop it.
import http from 'node:http';
import fs from 'node:fs';
import { syncUserReplies, userReplyReceipts } from './lib/reply-delivery.mjs';
import path from 'node:path';
import { exec, spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { optionsFrom, episode, pickVideo, stamp, proxyFresh, stillSource, readJson, writeJson, updateJson, nowIso } from './lib/episode.mjs';
import { videoFrame, codeFrame, codeSignature, sweepStaleTemp } from './lib/frames.mjs';
import { parseThumbnailRequest, thumbnailSource, createTimelineThumbnails } from './lib/timeline-thumbnails.mjs';
import crypto from 'node:crypto';
import { createLot, resumeLotCaptures, readLot, lotNumbers, saveLotUpdates, lotsSummary, signalLot, connectLine, MAX_EDITS, createRenderLot, withdrawRenderLot, compareItems, CLI as CLI_FILE } from './lib/lots.mjs';
import { speedState, startSpeedCopy, stopSpeedCopy, speedLog } from './lib/speed-copy.mjs';
import { renderState, renderFiles } from './lib/render.mjs';
import { exportAvailable, exportState, startExport, stopExport, exportLog, exportOptions, exportOptionsReady, downloadableExport } from './lib/export.mjs';
import { shotTargets, shotState, startShot, stopShot, undoShot, shotLog } from './lib/shot-render.mjs';
import { listRuns, step } from './lib/runs.mjs';
import { playerBuilder } from './lib/player-build.mjs';
import { timelineBuilder } from './lib/timeline-live.mjs';
import { reviewSound } from './lib/review-sound.mjs';
import { createCodePlayback } from './lib/code-playback.mjs';
import { renderCodeRange } from './lib/code-playback-render.mjs';
import { codePlaybackSources } from './lib/code-playback-sources.mjs';
import { timelineCodeThumbnails } from './lib/timeline-code-thumbnails.mjs';
import { peaksOf } from './lib/peaks.mjs';
import { CACHE, DEFAULT_PORT, INSTALLED } from './lib/place.mjs';
import { MSTUDIO, LAST_PORT, processIdentity, isOwnStudio, assertReviewAvailable } from './lib/app-profile.mjs';
import { project, tracksOf, shotsUsedIn } from './lib/projects.mjs';
import { genericTimelineBuilder, normalizeTimeline } from './lib/remotion-module.mjs';
import { hfPlayerBuilder, hfTimelineBuilder, hfFor, hfComposition, injectHead } from './lib/hyperframes.mjs';
import { stripTypeScriptTypes } from 'node:module';
import { Worker } from 'node:worker_threads';
import { updatesLine, updatesOk, updatesMarkdown } from './lib/updates.mjs';
import { docText, about, reveal, openOnline, logRing, coulissesOf } from './lib/menu.mjs';
import { agentById, detectAgent } from './lib/agent.mjs';
import { t, lang, langSource, setLang, LANGS, renderPage, writeSettings, readSettings } from './lib/i18n.mjs';
import {appearance, patchAppearance} from './lib/workspace-appearance.mjs';
import { gpuEncoder, gpuOff } from './lib/gpu.mjs';
import { fromApp, refuse } from './lib/guard.mjs';
import { publicUrl, viaTailnet } from './lib/remote.mjs';
import { getShortcuts, setShortcuts } from './lib/shortcuts.mjs';
import { library, librarySummary, listMedias, findMedia, peekMedia, mediaFile, miniature, importBytes, updateMedia, removeMedia, recordUse, slug } from './lib/medias.mjs';
import { stageShot, b64url } from './lib/stage-shot.mjs';
import { dictation } from './lib/dictate.mjs';
import { planStore, mapFrames } from './lib/plans.mjs';
import { chatAvailable, imageModel, readChat, sendChat, stopJob, sortInbox, autoSort, jobOf, busy, newChat } from './lib/image-chat.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const epArg = args.find((a) => /^E\d+$/i.test(a)), projArg = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;
if (!epArg && !projArg) { console.error(t('srv.usage')); process.exit(1); }
const P = projArg ? project(projArg) : episode(epArg, optionsFrom(args));
const B = P.kind === 'brambleshire';   // an episode: live preview of the code, staging, render; a project: the video only
const G = P.kind === 'remotion';       // a run of a Remotion pipeline (.coulisses): its code played live, before any export
const HFP = P.kind === 'hyperframes';   // a HyperFrames project (.coulisses moteur hyperframes): its HTML composition played live
const CODE = B || G || HFP;
const XP = G || HFP;                    // a project exported from the studio (its export script, or « hyperframes render »)
const { ep, folder, EP, REVUE, NOTES, REPLIES, SNAP, IMAGES, PROXY, PROXY_INFO } = P;
const LOCK = path.join(REVUE, 'studio.lock.json');
const ownStudiosOnly = MSTUDIO || process.env.COULISSES_V2_OWN_STUDIOS === '1';
// An isolated hub may import an existing review. Check before making its media
// folders or starting the preview workers, then check again before listening.
if (ownStudiosOnly) {
  assertReviewAvailable(REVUE);
  await handOffIfOpen();
}
if (MSTUDIO) {
  // Reserve the shared review before starting proxy or preview work. Competing
  // launches must not both see an unclaimed review while their bundlers start.
  fs.mkdirSync(REVUE, {recursive: true});
  updateJson(LOCK, null, current => {
    if (current?.pid) {
      let alive = true;
      try { process.kill(current.pid, 0); } catch (error) { alive = error.code !== 'ESRCH'; }
      if (alive) throw new Error('Cette revue est déjà ouverte ou en cours de démarrage.');
    }
    return {...processIdentity(), since: nowIso()};
  });
  process.on('exit', releaseStudioLock);
}
const WORK_AREA = path.join(REVUE, 'work-area.json');
fs.mkdirSync(IMAGES, { recursive: true });
fs.mkdirSync(path.dirname(PROXY), { recursive: true });
const IMG_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' };
const MIME = { ...Object.fromEntries(Object.entries(IMG_TYPES).map(([m, e]) => [e, m])), mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  json: 'application/json', js: 'text/javascript', mp4: 'video/mp4', webm: 'video/webm', svg: 'image/svg+xml', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', glb: 'model/gltf-binary' };
const time = () => new Date().toLocaleTimeString();
const ring = logRing();   // Tools › Log in the menu bar
const log = (m) => { ring.push(`${time()}  ${m}`); console.log(`  ${time()}  ${m}`); };
// the dictation (F2 or the microphone of the rail: page/studio/17-dictate.js): Whisper on this PC, OpenWhispr's (lib/dictate.mjs)
const DICT = dictation({ log });

// ---- review copy of the video (unchanged from the review tool: a keyframe every 6 images, smooth stepping back) ----
let proxyState = 'missing', proxyFailed = null, proxyChild = null;
function buildProxy() {
  const src = pickVideo(P); if (!src || held) return;
  if (proxyFresh(P)) { proxyState = 'ready'; return; }
  proxyState = 'building';
  const tmp = PROXY.replace(/\.mp4$/, '.tmp.mp4'), t0 = Date.now(), from = stamp(src);
  log(t('srv.proxyStart'));
  const run = (vcodec, next) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-y', '-i', src, '-map', '0:v:0', '-map', '0:a?', ...vcodec, '-g', '6', '-bf', '0',
      '-c:a', 'copy', '-fps_mode', 'passthrough', '-movflags', '+faststart', tmp], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    proxyChild = p;
    let err = '', ended = false; const end = (x) => { if (!ended) { ended = true; next(x); } };   // (no ffmpeg: « error » then « close »)
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => end(e.message));
    p.on('close', (code) => end(code === 0 ? null : (err.trim().split('\n').pop() || `ffmpeg ${code}`)));
  };
  const done = (err) => {
    proxyChild = null;
    if (held) { proxyState = 'missing'; fs.rmSync(tmp, { force: true }); return; }   // stopped by a hold: built again after it
    if (err) { proxyState = 'error'; proxyFailed = stamp(src); log(t('srv.proxyFail', { err })); return; }
    const now = stamp(src);
    if (now.size !== from.size || now.mtime !== from.mtime) { proxyState = 'missing'; fs.rmSync(tmp, { force: true }); return; }   // (the video changed meanwhile: made again from the new one)
    try { fs.renameSync(tmp, PROXY); } catch (e) { proxyState = 'error'; proxyFailed = from; fs.rmSync(tmp, { force: true }); log(t('srv.proxyFail', { err: e.message })); return; }
    fs.writeFileSync(PROXY_INFO, JSON.stringify({ source: from, gop: 6, built: new Date().toISOString() }, null, 1));
    proxyState = 'ready'; log(t('srv.proxyReady', { s: Math.round((Date.now() - t0) / 1000) }));
  };
  run(['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '20', '-b:v', '0'], (err) => (err && !held ? run(['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'], done) : done(err)));   // (stopped by a hold: no CPU try, the video is being replaced)
}
function refreshProxy() {
  if (held || proxyState === 'building' || proxyFresh(P)) return;
  const src = pickVideo(P); if (!src) return;
  const st = stamp(src);
  if (Date.now() - Date.parse(st.mtime) < 15000) return;
  if (proxyFailed && proxyFailed.size === st.size && proxyFailed.mtime === st.mtime) return;
  buildProxy();
}

// ---- live preview of the code ----
// the multi-track timeline (camera, music, sound effects, voices…) as the current code builds it: rebuilt with the preview
// a project: the tracks of its montage plan (AItelier), read again when the plan changes; no code to preview
const planTimeline = () => { const d = tracksOf(P); const v = d ? Date.parse(d.mtime) : 0; return { state: { version: v, status: 'ready', error: null, data: d ? { tracks: d.tracks, fps: d.fps, frames: d.frames, plan: d.file } : null } }; };
const timeline = B ? timelineBuilder({ remotionDir: P.remotionDir, episode: ep, log }) : G ? genericTimelineBuilder(P.remotion, { log })
  : HFP ? hfTimelineBuilder(P, { log, normalize: (raw) => normalizeTimeline(raw, raw.fps) })
  : { get state() { return planTimeline().state; }, build: () => {} };
// the review sound of a Remotion project (lib/review-sound.mjs): its timeline's audio tracks mixed once — the page's clock
// (off: settings.json « reviewSound »: false, or COULISSES_REVIEW_SOUND=0 — the tests of the preview's own sound)
const rsWanted = () => { if (process.env.COULISSES_REVIEW_SOUND === '0') return false; try { return readSettings().reviewSound !== false; } catch { return true; } };
const RSND = G && P.remotionDir && rsWanted() ? reviewSound({ cacheDir: path.join(CACHE, 'revue-son'), publicDir: path.join(P.remotionDir, 'public'), masterOnly: process.env.COULISSES_REVIEW_SOUND !== 'legacy', log }) : null;
let timelineCodeVersion = null, timelineChain = Promise.resolve(), timelineRequest = 0;
const syncTimeline = (state) => {
  const version = state?.version, request = ++timelineRequest;
  timelineCodeVersion = null;
  timelineChain = timelineChain.catch(() => {}).then(async () => {
    await timeline.build();
    if (request === timelineRequest && player.state.status === 'ready' && version === player.state.version && timeline.state.status === 'ready') timelineCodeVersion = version;
  });
  return timelineChain;
};
const rsNow = () => { if (!RSND) return null; const valid = player.state.status === 'ready' && timelineCodeVersion === player.state.version;
  const s = RSND.update(valid ? timeline.state.data : null, timeline.state.version); return { state: s.state, sig: s.sig, why: s.why, clips: s.clips, codeVersion: valid ? timelineCodeVersion : null }; };
const player = HFP ? hfPlayerBuilder(P, { log, onBuilt: () => timeline.build() }) : CODE ? playerBuilder({ remotionDir: P.remotionDir, episode: ep, log, onBuilt: syncTimeline, watchAlso: G ? P.EP : null,
  generic: G ? { module: P.remotion.module, composition: P.remotion.composition, props: P.remotion.props, tag: P.id } : null })
  : { state: { status: 'none', version: 0, error: null, builtAt: null }, build: async () => {}, watch: () => {} };
const CODE_PLAYBACK = (B || G) ? createCodePlayback({
  cacheDir: path.join(CACHE, 'lecture-code', crypto.createHash('sha256').update(P.EP).digest('hex').slice(0, 16)),
  render: renderCodeRange, fingerprint: () => codePlaybackSources(P),
}) : null;
const playbackOwners = new Map();
async function releasePlaybackOwner(entry) {
  if (!entry?.id) return;
  const shared = [...playbackOwners.values()].some((other) => other !== entry && !other.cancelled && (other.id === entry.id || other.requestKey === entry.requestKey));
  if (shared) await CODE_PLAYBACK.waitForIdle(entry.id); else await CODE_PLAYBACK.cancelAndWait(entry.id);
}
async function playbackGeneration(dimensions = {}, sourceOptions) {
  // Une source enregistrée juste avant la demande peut précéder le debounce du
  // constructeur. L'empreinte seule ne permet pas de lui attribuer l'ancien hash.
  const before = await codePlaybackSources(P, sourceOptions);
  sourceOptions?.signal?.throwIfAborted();
  await player.build(); await timelineChain;
  sourceOptions?.signal?.throwIfAborted();
  if (!CODE_PLAYBACK || player.state.status !== 'ready' || timeline.state.status !== 'ready' || timelineCodeVersion !== player.state.version) throw new Error('Le code et sa frise doivent être prêts pour la même version.');
  const hash = player.state.hash, version = player.state.version, data = timeline.state.data;
  const fps = data.fps || 30, durationInFrames = data.frames || Math.ceil(data.duration * fps);
  const mediaSignature = await codePlaybackSources(P, sourceOptions);
  if (mediaSignature !== before || player.state.hash !== hash || player.state.status !== 'ready' || timelineCodeVersion !== version || (dimensions.version !== undefined && dimensions.version !== version)) throw new Error('Le code a changé pendant la demande.');
  const width = Number(dimensions.width) || 1920, height = Number(dimensions.height) || 1080;
  if (![width, height].every((v) => Number.isInteger(v) && v > 0 && v <= 16384)) throw new Error('Dimensions de composition invalides.');
  return { project: P, hash, version, fps, durationInFrames, mediaSignature, width, height };
}
// ---- the plans of the versions (lib/plans.mjs; user request, 19/10/2026: « quand l'agent rallonge la vidéo, la note doit
// rester collée à la même partie de la vidéo, pas à la même frame »): every version of the code's plan and of the video's is
// kept (revue/plans/), the page asks where its notes' moments are in the version it shows (POST /api/remap)
const PLANS = planStore(path.join(REVUE, 'plans'));
let codePlanMemo = { v: null, sig: null };
function codePlan() {   // the code as it is now (the live timeline) — or, a project without code, its montage plan
  const s = timeline.state;
  if (s?.data && s.status !== 'error' && codePlanMemo.v !== s.version) codePlanMemo = { v: s.version, sig: PLANS.save(s.data) };
  return codePlanMemo.sig;
}
// the newest change of the code's files (the video exported after it shows the code as it is)
function codeChangedAt() {
  const roots = B ? [path.join(P.remotionDir, 'src')] : G ? [path.join(P.remotionDir, 'src'), P.EP] : HFP ? [P.hf.projet] : [];
  const SKIP = /^(node_modules|revue|\.git|\.cache|07-renders|renders?|exports?|out)$/i, CODEF = /\.(tsx?|jsx?|mjs|cjs|json|css|html?)$/i;
  let newest = 0, n = 0;
  const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { if (++n > 20000) return; const p = path.join(d, e.name); if (e.isDirectory()) { if (!SKIP.test(e.name)) walk(p); } else if (CODEF.test(e.name)) { try { newest = Math.max(newest, fs.statSync(p).mtimeMs); } catch { /* */ } } } };
  for (const r of roots) walk(r);
  return newest;
}
let exportFrom = null;   // the code's plan when an export of this studio started: the plan of the video it makes
let videoPlanMemo = { key: null, sig: null };
function videoPlan() {   // the plan of the video shown (null: not known — its notes stay on their frames)
  const video = pickVideo(P), st = video ? stamp(video) : null; if (!st) return null;
  let snapT = 0; if (B) try { snapT = fs.statSync(SNAP).mtimeMs; } catch { /* none */ }
  const key = `${st.size}:${st.mtime}:${timeline.state.version}:${snapT}:${exportFrom ?? ''}`;
  if (videoPlanMemo.key === key) return videoPlanMemo.sig;
  let sig = null;
  if (B) { const snap = readJson(SNAP, null); if (snap?.video && snap.video.size === st.size) sig = PLANS.save(snap); }   // (an episode: revue/timeline.json, exported with its video by finish-render.sh)
  if (!sig) sig = PLANS.videoPlan(st);
  if (!sig && !CODE) sig = codePlan();   // (a project's montage plan describes its video)
  if (!sig && XP && exportFrom) { let x = null; try { x = exportState(P); } catch { /* */ } if (x?.state === 'done' && x.file && path.resolve(x.file).toLowerCase() === path.resolve(video).toLowerCase()) sig = exportFrom; }
  if (!sig && CODE) { const cp = codePlan(); if (cp && codeChangedAt() < Date.parse(st.mtime)) sig = cp; }   // (made after the last change of the code: the code's plan)
  if (sig) PLANS.setVideoPlan(st, sig);
  videoPlanMemo = { key, sig };
  return sig;
}
const plansNow = () => ({ code: CODE ? codePlan() : null, video: videoPlan() });
// size and frame rate of a project's video (a Short is 1080×1920), measured once per file — by ffprobe in the background
// (code review, 08/10/2026: never a synchronous ffprobe inside a request: it froze every request until it answered).
// The first one is measured before the server listens; a new export is measured on the next request, the previous size
// answering meanwhile.
const probed = new Map(), probing = new Map();
let lastProbe = null;
function probeNow(video, key) {
  if (!probing.has(key)) probing.set(key, new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', video], { encoding: 'utf8', windowsHide: true, timeout: 30000 }, (err, out) => {
      let w = 1920, h = 1080, fps = 30;
      try { const v = JSON.parse(out).streams[0]; w = v.width; h = v.height; const [a, b2] = v.r_frame_rate.split('/').map(Number); fps = b2 ? Math.round((a / b2) * 1000) / 1000 : a; } catch { /* defaults */ }
      probed.set(key, lastProbe = { size: [w, h], fps }); probing.delete(key); resolve();
    });
  }));
  return probing.get(key);
}
const probeKey = (video) => { const st = stamp(video); return `${video}|${st.size}:${st.mtime}`; };
function probe(video) {
  if (B || !video) return { size: [1920, 1080], fps: null };
  const key = probeKey(video);
  if (probed.has(key)) return probed.get(key);
  probeNow(video, key);
  return lastProbe ?? { size: [1920, 1080], fps: 30 };
}

// a Claude session watching the tool (studio-cli.mjs wait) beats every few seconds in revue/studio-agent.json
function agentState() {
  const a = readJson(P.AGENT, null);
  if (!a) return { watching: false };
  const age = Date.now() - Date.parse(a.beat);
  return { watching: a.waiting && age < 20000, since: a.since, beat: a.beat, lastLot: a.lastLot ?? null, agent: a.agent ?? null };
}

// Les dimensions d'un lot ne nécessitent ni détection GPU ni inspection d'export.
function reviewFormat() {
  const video = pickVideo(P);
  const snapshot = B ? readJson(SNAP, null) : null;
  const pr0 = probe(video);
  const hc = HFP ? hfComposition(P.hf.projet, P.hf.index) : null;   // a HyperFrames project: its root composition's size and rate
  const pr = HFP && hc && !video ? { size: [hc.width, hc.height], fps: hc.fps } : pr0;
  return { video, snapshot, hc, size: pr.size, fps: B ? snapshot?.fps ?? 30 : pr.fps ?? timeline.state.data?.fps ?? 30 };
}
function meta() {
  refreshProxy();
  const {video, snapshot, hc, size, fps} = reviewFormat();
  const render = video ? stamp(video) : null;
  const XA = XP ? exportAvailable(P) : { ok: false, why: null };   // (asked once: it reads the export's folder)
  return {
    kind: P.kind, format: P.project?.format ?? null, features: { code: CODE, staging: CODE, render: B, plan: !!timeline.state.data, video: !!video, export: XP && XA.ok }, exportWhy: XP ? XA.why : null, gpu: XP || B ? { ...gpuEncoder(), off: gpuOff() } : null, exportOptions: XP && XA.ok ? exportOptions(P) : [],
    composition: G ? P.remotion.composition : HFP ? hc?.id ?? null : null, engine: B || G ? 'remotion' : HFP ? 'hyperframes' : null, hfVersion: HFP ? hfFor(P.hf.projet)?.version ?? null : null, channel: P.channel ?? null, coulisses: P.coulisses ?? null, exportDir: P.exportRule?.dossier ?? null,
    size, root: P.EP, videoPath: video ?? null, exportEntry: G ? P.remotion.entree : HFP ? P.hf.index : null,
    episode: ep, title: B ? folder.replace(/^E\d+ - /, '') : P.title, folder, fps, render, snapshot,
    snapshotMatches: !!(snapshot?.video && render && snapshot.video.size === render.size),
    proxy: proxyState === 'ready' && !proxyFresh(P) ? 'stale' : proxyState,
    notesFile: NOTES, maxEdits: MAX_EDITS, plans: plansNow(), workArea: readJson(WORK_AREA, null),
    code: { status: player.state.status, version: player.state.version, hash: player.state.hash, error: player.state.error, builtAt: player.state.builtAt },
    agent: agentState(), connectLine: connectLine(P),
    hub: args.includes('--hub') ? args[args.indexOf('--hub') + 1] : null, held,
    lang: lang(), langSource: langSource(), coulissesFile: coulissesOf(P),
    // the 3D shots this run shows as media (« Ouvrir la scène 3D » on their clip), and where this run's render is used
    shots3d: G && P.coulisses ? shotsUsedIn(P.coulisses) : [], usedIn: G ? (P.uses ?? []) : [],
    // « Rendre ce plan »: where this shot's render goes (the Short, the file), for its card
    shotTargets: G && P.uses?.length ? shotTargets(P) : [],
    newProject: G && P.coulisses ? readJson(P.coulisses, null)?.origine === 'coulisses' : false,
    reverse: G && P.coulisses && fs.existsSync(path.join(P.EP,'reverse.json')) && readJson(P.coulisses,null)?.reverse === 1,
  };
}
// ---- hold: a new render is replacing the video (studio-cli.mjs render, around finish-render.sh) ----
// Windows cannot replace a file that is open: every stream of the video is closed, the review copy stops being built,
// and nothing reads the video until /api/unhold. The page shows « Remplacement de la vidéo… » and reloads afterwards.
let held = false;
const timelineThumbnails = createTimelineThumbnails();
const videoStreams = new Set();
async function hold() {
  held = true;
  for (const st of videoStreams) { try { st.destroy(); } catch { /* closed */ } }
  videoStreams.clear();
  if (proxyChild) { try { proxyChild.kill(); } catch { /* gone */ } }
  await Promise.all([timelineThumbnails.interrupt(), new Promise((r) => setTimeout(r, 1200))]);   // release all thumbnail decoders before replacing the media
  log(t('srv.held'));
}
function unhold() { held = false; log(t('srv.unheld')); refreshProxy(); }
// an export about to replace the very video under review (COULISSES REMPLACE, lib/export.mjs): let go of it, take it back after
// (every second while an export runs, every 4 s otherwise: an export can also be started without this studio)
let exportHolds = false;
function watchExport() {
  let x = null; try { x = exportState(P); } catch { /* none */ }
  if (x?.state === 'running' && x.remplace && !exportHolds) {
    const v = pickVideo(P);
    if (!v || path.resolve(v).toLowerCase() === path.resolve(x.remplace).toLowerCase()) { exportHolds = true; hold().then(() => log(t('srv.exportHolds', { name: path.basename(x.remplace) }))); }
  }
  if (x && x.state !== 'running' && exportHolds) { exportHolds = false; unhold(); }
  setTimeout(watchExport, x?.state === 'running' ? 1000 : 4000).unref();
}
if (XP) watchExport();
let lotChain = Promise.resolve();
const oneLotAtATime = (fn) => { const p = lotChain.then(fn); lotChain = p.catch(() => {}); return p; };
let fpsMemo = { t: 0, v: 30 };
const fpsNow = () => (Date.now() - fpsMemo.t < 10000 ? fpsMemo.v : (fpsMemo = { t: Date.now(), v: meta().fps || 30 }).v);   // (meta() for each frame asked, before)
function status() {   // what changes often: polled by the page every 3 s with the replies
  const replies = readJson(REPLIES, { notes: {} }), video = pickVideo(P);
  refreshProxy();
  return { code: { status: player.state.status, version: player.state.version, hash: player.state.hash, error: player.state.error, builtAt: player.state.builtAt }, agent: agentState(), lots: lotsSummary(P, replies, listRuns(P)), timeline: { version: timeline.state.version, status: timeline.state.status, error: timeline.state.error },
    render: B ? renderState(P) : null, export: XP ? exportState(P) : null, shot: G && P.uses?.length ? shotState(P) : null, shotTargets: G && P.uses?.length ? shotTargets(P) : null, held, video: video ? stamp(video) : null, compare: compareItems(P).map((x) => x.id), proxy: proxyState, speed: speedState(P), plans: plansNow(), reviewSound: rsNow() };
}
// The user's notes (revue/notes.json), the page's file. Code review 18/10/2026: an unreadable notes.json (cut short by
// another tool, a BOM, an edit by hand) was read as « no notes », the page showed 0, its next save wrote that over the
// file — and notes.bak.json, made again at every save, lost the original at the second one. Now:
//   - a file there but unreadable is an error (503): the page shows it and saves nothing; if something writes anyway,
//     the unreadable file is kept first (notes.illisible-<date>.json);
//   - its revision (size + time) goes with it: a save made on an older one (a second tab of the same studio) is refused
//     (409) with the notes as they are now, the page merges and saves again;
//   - notes.bak.json is the state of at least 10 minutes ago (no longer of 0.4 s ago), and a save that drops 3 notes or
//     more at once keeps the notes before it (revue/sauvegardes/, the 20 newest);
//   - written as every JSON of Coulisses (lib/episode.mjs writeJson: tried again while another process reads it).
const notesRev = () => { try { const s = fs.statSync(NOTES); return `${s.size}-${Math.round(s.mtimeMs)}`; } catch { return '0'; } };
function readNotes() {
  let txt = null;
  for (let i = 0; i < 20; i++) {
    try { txt = fs.readFileSync(NOTES, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { episode: ep, notes: [], rev: '0' }; txt = null; }
    if (txt !== null) try { const d = JSON.parse(txt.replace(/^\uFEFF/, '')); if (Array.isArray(d?.notes)) return { ...d, rev: notesRev() }; } catch { /* being written: again */ }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  return null;   // there, but not readable
}
const stampNow = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };   // (the user's time)
function writeNotes(data, before) {
  // Garder les réponses avant toute suppression/remplacement de leur note.
  // Un échec de cette écriture refuse la sauvegarde, sans annoncer un envoi réussi.
  if (before) syncUserReplies(P, before);
  syncUserReplies(P, data);
  if (fs.existsSync(NOTES) && !before) {   // unreadable: kept as it is before anything replaces it
    try { fs.copyFileSync(NOTES, NOTES.replace(/\.json$/, `.illisible-${stampNow()}.json`)); } catch { /* */ }
  }
  const bak = NOTES.replace(/\.json$/, '.bak.json');
  try { if (before && (!fs.existsSync(bak) || Date.now() - fs.statSync(bak).mtimeMs > 10 * 60e3)) fs.copyFileSync(NOTES, bak); } catch { /* next time */ }
  if (before && before.notes.length - data.notes.length >= 3) {
    try {
      const dir = path.join(REVUE, 'sauvegardes'); fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(NOTES, path.join(dir, `notes-${stampNow()}-avant-${before.notes.length - data.notes.length}-en-moins.json`));
      const all = fs.readdirSync(dir).filter((f) => /^notes-.*\.json$/.test(f)).sort();
      for (const f of all.slice(0, Math.max(0, all.length - 20))) fs.rmSync(path.join(dir, f), { force: true });
    } catch { /* the save itself still goes */ }
  }
  const { rev, ...rest } = data; void rev;
  writeJson(NOTES, rest);
}

// the studio page's script: the parts of page/studio/ (00-base.js … 10-start.js), in their order, inside one function as
// the inline script was (they share its names); a banner names each part, for the browser's tools
function studioScript() {
  const dir = path.join(HERE, 'page', 'studio');
  const parts = fs.readdirSync(dir).filter((f) => /^\d\d-[\w-]+\.js$/.test(f)).sort();
  return '(() => {\n' + parts.map((f) => `// ===== page/studio/${f} =====\n${fs.readFileSync(path.join(dir, f), 'utf8')}`).join('\n') + '})();\n//# sourceURL=studio.js\n';
}
const RANGE_MAX = 8 * 1024 * 1024;   // a range answer's largest part (sendFile)
function sendFile(req, res, file, type, track) {
  const st = file && fs.existsSync(file) ? fs.statSync(file) : null;
  if (!st || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
  const size = st.size, range = req.headers.range;
  type ??= MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
  // the browser keeps what it got and asks « changed? » (no-cache): an unchanged file is not sent again — the live
  // preview of an episode loads ~260 MB of textures, at every load and every rebuild (user report, 09/10/2026: « met du
  // temps à charger »)
  const etag = `"${size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`, modified = st.mtime.toUTCString();
  const inm = req.headers['if-none-match'];
  if (!range && (inm ? inm.split(/\s*,\s*/).includes(etag) : req.headers['if-modified-since'] === modified)) {
    res.writeHead(304, { ETag: etag, 'Last-Modified': modified, 'Cache-Control': 'no-cache' }); return res.end();
  }
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? +m[1] : 0, end = m && m[2] ? +m[2] : size - 1;
    if (m && !m[1] && m[2]) { start = size - +m[2]; end = size - 1; }
    end = Math.min(end, size - 1);
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    // at most RANGE_MAX bytes per answer, read then the file CLOSED before sending (14/10/2026: a <video> of the preview
    // asks « bytes=0- », reads a little and stops; the stream stayed paused with the file open as long as the preview
    // existed, and Windows refused to replace it: the 4K paper-3D of an export failed one after the other). The browser
    // asks the next part by itself; a file is open only for the few milliseconds of a read.
    end = Math.min(end, start + RANGE_MAX - 1);
    const len = end - start + 1;
    fs.open(file, 'r', (e, fd) => {
      if (e) { res.writeHead(404); return res.end('not found'); }
      const buf = Buffer.allocUnsafe(len);
      const readAll = (off) => fs.read(fd, buf, off, len - off, start + off, (er, n) => {
        if (!er && n > 0 && off + n < len) return readAll(off + n);
        fs.close(fd, () => {});
        if (er || off + n < len) { res.writeHead(500); return res.end(); }
        if (res.destroyed) return;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': len, 'Content-Type': type, 'Cache-Control': 'no-cache', ETag: etag, 'Last-Modified': modified });
        res.end(buf);
      });
      readAll(0);
    });
  } else {
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ETag: etag, 'Last-Modified': modified });
    pipeOut(fs.createReadStream(file), res, track);
  }
}
function pipeOut(stream, res, track) {
  if (track) { videoStreams.add(stream); stream.on('close', () => videoStreams.delete(stream)); }
  res.on('close', () => stream.destroy());
  stream.on('error', () => res.destroy()).pipe(res);
}
let videoSeen = false, lastCount = -1;
function sendVideo(req, res, which) {
  const video = which === 'delivery' ? downloadableExport(P, exportState(P))
    : which === 'revue' && proxyState === 'ready' && proxyFresh(P) ? PROXY : pickVideo(P);
  if (!videoSeen) { videoSeen = true; log(t('srv.reading', { name: path.basename(video ?? '?') })); }
  if (!video) { res.writeHead(404); return res.end('no video'); }
  if (held) { res.writeHead(503, { 'Retry-After': '5' }); return res.end('video being replaced'); }
  if (which === 'download' || which === 'delivery') {
    const name = path.basename(video), fallback = name.replace(/[^A-Za-z0-9_. -]/g, '_');
    const encoded = encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    res.setHeader('Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`);
    const type = {'.mp4':'video/mp4', '.mov':'video/quicktime', '.m4v':'video/mp4', '.mkv':'video/x-matroska', '.webm':'video/webm'}[path.extname(name).toLowerCase()];
    return sendFile(req, res, video, type || 'application/octet-stream', true);
  }
  sendFile(req, res, video, 'video/mp4', true);
}
const json = (res, data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(JSON.stringify(data)); };
const body = (req, max = 60e6) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > max) { reject(new Error(t('srv.tooBig'))); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
// inside(root, rel) -> absolute path under root, or null (no ../ escape)
const inside = (root, rel) => { const f = path.resolve(root, '.' + path.sep + rel); return f.toLowerCase().startsWith(root.toLowerCase() + path.sep) ? f : null; };

process.on('uncaughtException', (e) => console.error(`  ${time()}  ${t('srv.ignored', { msg: e.message })}`));
// the agent the batch goes to: the one watching the tool (studio-cli wait says who it is), else the one chosen in the
// page (« Connecter à l'agent »); then what may need updating on its side (lib/updates.mjs), in at most 9 s
function updatesAgent(chosen) {
  const a = agentState();
  return (a.watching && a.agent?.id ? agentById(a.agent.id) : null) ?? agentById(chosen) ?? detectAgent() ?? agentById('claude');
}
// Une seule écriture à la fois dans le cache de vérification du studio. Deux
// envois simultanés au même agent partagent aussi la lecture de ses dossiers.
const activeChecks = new Map();
let updatesQueue = Promise.resolve();
function requestUpdates(agent, fresh = false, language = lang()) {
  const key = JSON.stringify([agent.id, fresh, language]);
  if (activeChecks.has(key)) return activeChecks.get(key);
  const job = updatesQueue.then(() => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./lib/lot-updates-worker.mjs', import.meta.url), {
      env: { ...process.env, COULISSES_LANG: language },
      workerData: { project: { kind: P.kind, remotionDir: P.remotionDir }, agent, fresh },
    });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`Vérification interrompue (${code}).`)));
  })).finally(() => activeChecks.delete(key));
  activeChecks.set(key, job);
  updatesQueue = job.catch(() => {});
  return job;
}
async function updatesFor(chosen, fresh = false) {
  const ag = updatesAgent(chosen);
  let updates = null;
  try { updates = await Promise.race([requestUpdates(ag, fresh), new Promise((r) => setTimeout(() => r(null), 9000))]); } catch (e) { log(t('srv.updFail', { msg: e.message })); }
  if (updates) log(updatesLine(updates));
  return { agent: { id: ag.id, name: ag.name }, updates, line: updates ? updatesLine(updates) : t('upd.line.unavailable'), ok: updatesOk(updates) };
}
const checkingLots = new Set();
function scheduleLotUpdates(lot) {
  const id = lot?.captureState?.id;
  if (!lot?.updatesPending || !id || checkingLots.has(id)) return;
  checkingLots.add(id);
  const agent = agentById(lot.agent.id);
  requestUpdates(agent, false, lot.language).catch((err) => {
    log(t('srv.updFail', {msg: err.message}));
    return null;
  }).then((updates) => saveLotUpdates(P, lot.lot, id, updates))
    .catch((err) => log(err.message)).finally(() => checkingLots.delete(id));
}
function resumeLotUpdates() {
  for (const n of lotNumbers(P)) scheduleLotUpdates(readLot(P, n));
}
process.on('unhandledRejection', (e) => console.error(`  ${time()}  ${t('srv.ignored', { msg: e?.message ?? e })}`));

const FRAME_CACHE = path.join(CACHE, 'frames', ep);
const demoEngine = path.join(CACHE, 'atelier-v2', '06_Remotion');
const thumbnailSources = ownStudiosOnly && B && path.resolve(P.remotionDir).toLowerCase() === demoEngine.toLowerCase()
  ? {sharedPublicRoot: path.resolve(process.env.COULISSES_PREVIEW_ENGINE || optionsFrom([]).remotionDir, 'public')} : undefined;
const codeSheet = (B || G) ? timelineCodeThumbnails({
  project: P,
  current: (version, hash) => player.state.status === 'ready' && player.state.version === version && (!hash || player.state.hash === hash),
  generation: (version,signal) => playbackGeneration({version}, {...thumbnailSources,signal}),
  fingerprint: signal => codePlaybackSources(P, {...thumbnailSources,signal}),
}) : null;
// the frames kept (/api/frame): the newest `max`
function keepFew(dir, max) { try { const l = fs.readdirSync(dir).map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t); for (const x of l.slice(max)) fs.rmSync(path.join(dir, x.n), { force: true }); } catch { /* gone */ } }
// Remotion's stale temp folders (lib/frames.mjs): a while after the start, then every hour (one Coulisses process a time)
{ const sweep = () => { const n = sweepStaleTemp(path.join(CACHE, 'temp-sweep.txt')); if (n) log(t('srv.tempSwept', { n })); };
  setTimeout(sweep, 20000).unref(); setInterval(sweep, 3600e3).unref(); }
// the « Médias » tab: the library of the project's channel (lib/medias.mjs), made on first use
// a Theatre episode: the channel its own .coulisses names (the user's), else « Theatre »
const episodeChannel = () => { try { const f = fs.readdirSync(P.EP).find((x) => x.toLowerCase().endsWith('.coulisses')); return (f && readJson(path.join(P.EP, f), null)?.chaine) || 'Theatre'; } catch { return 'Theatre'; } };   // a folder name: the same in both languages
const CHANNEL = P.channel ?? (B ? episodeChannel() : P.kind === 'aitelier' ? "L'AItelier" : null);
let LIB = null;
const lib = () => (LIB ??= library(CHANNEL));
const projTitle = () => (B ? folder.replace(/^E\d+ - /, '') : P.title);
const server = http.createServer(async (req, res) => {
  if (!fromApp(req)) return refuse(res);   // only Coulisses itself (lib/guard.mjs)
  const url = new URL(req.url, 'http://x');
  let pn; try { pn = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end('bad address'); }
  try {
    if (pn === '/api/ping') return json(res, { studio: true, pid: process.pid, notesFile: NOTES, ...(MSTUDIO ? processIdentity() : {}) });
    if (pn === '/' || pn === '/index.html') {   // in the user's language (lib/i18n.mjs: {{key}} and window.T)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      const html = renderPage(fs.readFileSync(path.join(HERE, 'studio.html'), 'utf8'), { prefixes: ['st.', 'common.', 'menu.'] });
      const prefs = JSON.stringify(appearance()).replace(/</g, '\\u003c');
      return res.end(html.replace('</head>', () => '<script>window.__studioAppearance=' + prefs + '</script></head>'));
    }
    if (pn === '/api/workspace-appearance' && req.method === 'GET') return json(res, appearance());
    if (pn === '/api/workspace-appearance' && req.method === 'PATCH') {
      let delta;
      try { delta = JSON.parse(await body(req, 8192)); } catch { return json(res, {ok:false},400); }
      const ok = patchAppearance(delta); return json(res, {ok}, ok ? 200 : 400);
    }
    // « Langue · Language »: the choice is the user's, for the whole app (%LOCALAPPDATA%\Coulisses\settings.json)
    if (pn === '/api/lang' && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString('utf8') || '{}');
      if (!LANGS.includes(b.lang)) return json(res, { ok: false, why: t('srv.langBad') }, 400);
      const now = setLang(b.lang);
      return json(res, { ok: true, lang: now, forced: langSource() === 'env' });
    }
    if (pn === '/api/lang') return json(res, { lang: lang(), source: langSource(), langs: LANGS });
    // ---- the menu bar (menubar.js): documents, About, the Explorer on a path this server knows, its log, `projet verifier` ----
    if (pn === '/menubar.js') return sendFile(req, res, path.join(HERE, 'menubar.js'), 'text/javascript; charset=utf-8');
    // the page's styles and script (code review, 08/10/2026: one file of 3 000 lines): page/studio.css, and the parts of
    // page/studio/ joined in their order inside one function — the browser gets the one script it always had
    if (pn === '/studio.css') return sendFile(req, res, path.join(HERE, 'page', 'studio.css'), 'text/css; charset=utf-8');
    if (pn === '/studio-tools.css') {
      const sheets = ['composition.css', 'timeline-workrange.css', 'studio-tools.css', 'project-output.css'];
      const style = sheets.map(name => fs.readFileSync(path.join(HERE, 'page', name), 'utf8')).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(style);
    }
    if (pn === '/studio.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(studioScript()); }
    // « Raccourcis clavier » (shortcuts.js): the user's keys, the same for the home screen and every studio (settings.json)
    if (pn === '/shortcuts.js') return sendFile(req, res, path.join(HERE, 'shortcuts.js'), 'text/javascript; charset=utf-8');
    if (pn === '/api/shortcuts' && req.method === 'PUT') {
      let b = {}; try { b = JSON.parse((await body(req, 1e6)).toString('utf8') || '{}'); } catch { return json(res, { ok: false, why: 'json' }, 400); }
      return json(res, { ok: true, shortcuts: setShortcuts(b.shortcuts) });
    }
    if (pn === '/api/shortcuts') return json(res, { shortcuts: getShortcuts() });
    if (pn === '/api/doc') { const d = docText(url.searchParams.get('name')); if (!d) { res.writeHead(404); return res.end('not found'); } res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(d.text); }
    if (pn === '/api/about') return json(res, about());
    if (pn === '/api/log') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(ring.text()); }
    if (pn === '/api/reveal' && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString('utf8') || '{}');
      try {
        if (b.what === 'folder') reveal(P.EP);
        else if (b.what === 'coulisses') reveal(coulissesOf(P), { select: true });
        // the video file (user request, 09/10/2026: « un bouton pour ouvrir le fichier dans l'Explorateur »): the one under
        // review — an episode's render, a run's export —, or the file the last export made
        else if (b.what === 'video') reveal(pickVideo(P), { select: true });
        else if (b.what === 'export') reveal(exportState(P)?.file, { select: true });
        else if (b.what === 'speed') reveal(speedState(P)?.file, { select: true });
        else if (b.what === 'online') openOnline();
        else return json(res, { ok: false, why: String(b.what) }, 400);
        return json(res, { ok: true });
      } catch (e) { return json(res, { ok: false, why: e.message }); }
    }
    if (pn === '/api/verify' && req.method === 'POST') {   // Tools › Check the project: `projet verifier --rapide` on its .coulisses
      const file = coulissesOf(P);
      if (!file) return json(res, { ok: false, why: 'no .coulisses' });
      const r = await new Promise((resolve) => {
        const c = spawn(process.execPath, [CLI_FILE, 'projet', 'verifier', file, '--rapide'], { cwd: HERE, windowsHide: true, env: process.env });
        let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
        const timer = setTimeout(() => { try { c.kill(); } catch { /* gone */ } }, 180000);
        c.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
        c.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: e.message }); });
      });
      return json(res, { ok: r.code === 0, code: r.code, out: r.out.trim(), file });
    }
    if (pn === '/favicon.png') return sendFile(req, res, path.join(HERE, 'favicon.png'), 'image/png');
    // ---- the « after » image of a 2D staging (a run): its own preview with the offsets, photographed (lib/stage-shot.mjs) ----
    if (pn === '/api/stage-shot' && req.method === 'POST') {
      if (!G && !HFP) return json(res, { ok: false, why: t('srv.noCode') }, 400);
      const b = JSON.parse((await body(req)).toString('utf8') || '{}');
      const w = Math.round(+b.w || 0), h = Math.round(+b.h || 0), f = Math.max(0, Math.round(+b.frame || 0));
      if (!(w > 0 && h > 0 && w <= 8192 && h <= 8192) || !Array.isArray(b.edits)) return json(res, { ok: false, why: 'w, h, edits' }, 400);
      try {
        const jpg = await stageShot(`http://127.0.0.1:${port}/player.html?f=${f}&stage=${b64url(b.edits)}`, w, h);
        log(t('srv.stageShot', { frame: f, n: b.edits.length }));
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache' }); return res.end(jpg);
      } catch (e) { log(t('srv.stageShotFail', { msg: e.message })); return json(res, { ok: false, why: e.message }, 500); }
    }
    // ---- « Médias »: the channel's library and its image chat (lib/medias.mjs, lib/image-chat.mjs) ----
    if (pn === '/medias.js') return sendFile(req, res, path.join(HERE, 'medias.js'), 'text/javascript; charset=utf-8');
    if (pn === '/api/medias') {
      const L = lib();
      return json(res, { ...librarySummary(L), chat: readChat(L).messages.slice(-80), job: jobOf(L), available: chatAvailable(), model: imageModel() });
    }
    if (pn.startsWith('/medias/file/') || pn.startsWith('/medias/mini/')) {
      const L = lib(), it = peekMedia(L, pn.split('/')[3] ?? '');
      if (!it) { res.writeHead(404); return res.end('not found'); }
      return sendFile(req, res, pn.startsWith('/medias/mini/') ? await miniature(L, it) : mediaFile(L, it));
    }
    if (pn === '/api/medias/import' && req.method === 'POST') {   // an image dropped or pasted in the tab: « à ranger », then sorted
      const L = lib();
      let buf; try { buf = await body(req, 60e6); } catch (e) { return json(res, { ok: false, why: e.message }, 413); }
      let name = 'image'; try { name = decodeURIComponent(String(req.headers['x-name'] ?? 'image')); } catch { /* raw */ }
      try {
        const item = importBytes(L, buf, { type: (req.headers['content-type'] || '').split(';')[0].trim(), name });
        log(t('srv.mdImported', { name: item.fichier, channel: L.channel }));
        let sorting = false;
        if (autoSort()) { try { sorting = sortInbox(L, { log }).ok; } catch { /* sorted later (the ✓ button) */ } }
        return json(res, { ok: true, item, sorting });
      } catch (e) { return json(res, { ok: false, why: e.message }); }
    }
    if (pn.startsWith('/api/medias/') && req.method === 'POST') {
      const L = lib(), what = pn.slice('/api/medias/'.length);
      let b = {}; try { b = JSON.parse((await body(req)).toString('utf8') || '{}'); } catch { /* empty */ }
      try {
        if (what === 'update') return json(res, { ok: true, item: updateMedia(L, b.id, { nom: b.nom, categorie: b.categorie, tags: b.tags, description: b.description }) });
        if (what === 'delete') { const r = removeMedia(L, b.id); log(t('srv.mdDeleted', { file: r.trash })); return json(res, { ok: true, ...r }); }
        if (what === 'reveal') {
          const it = b.id ? findMedia(L, b.id) : null;
          if (!it) listMedias(L);   // the folders exist before the Explorer opens them
          reveal(it ? mediaFile(L, it) : L.dir, { select: !!it });
          return json(res, { ok: true });
        }
        if (what === 'chat') {
          const m = meta();
          const job = sendChat(L, { text: b.text, refs: Array.isArray(b.refs) ? b.refs : [], transparent: !!b.transparent,
            project: { title: projTitle(), format: P.formatName ?? (m.size ? `${m.size[0]}×${m.size[1]}` : null) } }, { log });
          return json(res, { ok: true, job });
        }
        if (what === 'stop') return json(res, stopJob(L));
        if (what === 'sort') return json(res, sortInbox(L, { log, ids: Array.isArray(b.ids) ? b.ids : null }));
        if (what === 'new-chat') { if (busy(L)) throw new Error(t('md.err.busy')); newChat(L); return json(res, { ok: true }); }
        if (what === 'place') {   // « Placer » / dropped on the picture: a copy goes with the edit (revue/images), the library notes where
          const it = findMedia(L, b.id);
          if (!it) throw new Error(t('md.err.gone'));
          const src = mediaFile(L, it), name = `media-${slug(it.nom) || 'image'}-${Date.now().toString(36)}${path.extname(src).toLowerCase()}`;
          fs.copyFileSync(src, path.join(IMAGES, name));
          recordUse(L, it.id, { titre: projTitle(), projet: coulissesOf(P) ?? P.EP, image: Number.isFinite(+b.frame) ? Math.round(+b.frame) : null });
          log(t('srv.mdPlaced', { name: it.nom, frame: b.frame ?? '?' }));
          return json(res, { ok: true, file: `images/${name}`, media: { id: it.id, nom: it.nom, categorie: it.categorie, transparent: !!it.transparent, largeur: it.largeur ?? null,
            hauteur: it.hauteur ?? null, description: it.description ?? '', bibliotheque: src, chaine: L.channel, file: `images/${name}` } });
        }
        return json(res, { ok: false, why: what }, 404);
      } catch (e) { return json(res, { ok: false, why: e.message }); }
    }
    if (pn === '/video' || pn === '/video/original') return sendVideo(req, res, 'original');
    if (pn === '/video/download' && req.method === 'GET') return sendVideo(req, res, url.searchParams.get('export') === '1' ? 'delivery' : 'download');
    if (pn === '/video/revue') return sendVideo(req, res, 'revue');
    if (pn === '/api/meta') {   // (from the iPad, through Tailscale: the hub's address as it reaches it — lib/remote.mjs)
      const m = meta(); if (m.hub) m.hub = publicUrl(req, m.hub); m.remote = viaTailnet(req);
      return json(res, m);
    }
    if (pn === '/api/status') return json(res, status());
    if (pn === '/api/work-area' && req.method === 'PATCH') {
      let data;
      try { data = JSON.parse((await body(req, 2048)).toString('utf8')); } catch { return json(res, { error: 'invalid-work-area' }, 400); }
      const { edge, frame, fps } = data ?? {};
      if (!['start', 'end', 'clear'].includes(edge) || !(Number.isFinite(fps) && fps > 0) ||
          (edge !== 'clear' && !(Number.isSafeInteger(frame) && frame >= 0))) return json(res, { error: 'invalid-work-area' }, 400);
      // Only the requested edge changes. Two clients marking opposite ends keep
      // both gestures, even if their tabs were opened with different ranges.
      const result = updateJson(WORK_AREA, {}, (area) => {
        let start = null, end = null;
        if (edge !== 'clear') {
          const scale = fps / area.fps;
          if (Number.isFinite(scale) && scale > 0) {
            if (Number.isSafeInteger(area.start)) start = Math.max(0, Math.round(area.start * scale));
            if (Number.isSafeInteger(area.end)) end = Math.max(0, Math.round((area.end + 1) * scale) - 1);
          }
          if (edge === 'start') { start = frame; if (end !== null && start > end) end = null; }
          else { end = frame; if (start !== null && start > end) start = null; }
        }
        return { start, end, fps };
      });
      return json(res, result);
    }
    if (pn === '/api/notes' && req.method === 'GET') {
      const d = readNotes();
      if (!d) return json(res, { error: 'unreadable', file: NOTES }, 503);
      return json(res, d);
    }
    if (pn === '/api/replies') {
      let replies = { notes: {} };
      try { replies = JSON.parse(fs.readFileSync(REPLIES, 'utf8').replace(/^\uFEFF/, '')); } catch (e) {
        if (e.code !== 'ENOENT') return json(res, { error: 'unreadable', file: REPLIES }, 503);
      }
      try { replies.userReplies = userReplyReceipts(P); } catch {
        return json(res, { error: 'unreadable', file: path.join(REVUE, 'user-replies.json') }, 503);
      }
      const txt = JSON.stringify(replies);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(txt);
    }
    if (pn === '/api/image' && req.method === 'POST') {
      const ext = IMG_TYPES[(req.headers['content-type'] || '').split(';')[0].trim()];
      if (!ext) { res.writeHead(415, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(t('srv.imgType')); }
      let buf; try { buf = await body(req, 40e6); } catch { res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(t('srv.imgBig')); }
      const id = String(req.headers['x-note'] || 'note').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'note';
      const name = `${id}-${Date.now().toString(36)}.${ext}`;
      fs.writeFileSync(path.join(IMAGES, name), buf);
      log(t('srv.imgAdded', { name }));
      return json(res, { file: `images/${name}` });
    }
    // where the notes' moments are in a plan (the version shown): each note from the plan it was placed on (lib/plans.mjs)
    if (pn === '/api/remap' && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString('utf8') || '{}'), to = PLANS.load(b.to);
      if (!to) return json(res, { ok: false, why: 'plan' });
      const out = [], unknown = [];
      for (const n of Array.isArray(b.notes) ? b.notes : []) {
        const from = n.plan === b.to ? to : PLANS.load(n.plan);
        if (!from || !Number.isFinite(+n.frame)) { unknown.push(n.id); continue; }
        out.push({ id: n.id, ...mapFrames(from, to, +n.frame, n.end === null || n.end === undefined ? null : +n.end) });
      }
      return json(res, { ok: true, to: b.to, notes: out, unknown });
    }
    // the dictation: the recording of the page (webm), its words (lib/dictate.mjs); /warm: the engine ready while one speaks
    if (pn === '/api/dictate/warm' && req.method === 'POST') return json(res, { ok: await DICT.warm().catch(() => false) });
    if (pn === '/api/dictate' && req.method === 'POST') {
      let buf; try { buf = await body(req, 30e6); } catch { return json(res, { ok: false, why: t('srv.dictBig') }); }
      if (buf.length < 600) return json(res, { ok: true, text: '' });
      let prompt = ''; try { prompt = decodeURIComponent(String(req.headers['x-prompt'] ?? '')).slice(0, 400); } catch { /* none */ }
      try {
        const r = await DICT.transcribe(buf, { language: lang(), prompt });
        if (!r.ok) return json(res, { ok: false, why: r.why === 'engine' ? t('srv.dictNoEngine') : t('srv.dictFailed', { detail: r.detail ?? '' }) });
        log(t('srv.dictDone', { n: r.text.length, ms: r.ms, by: r.engine }));
        return json(res, r);
      } catch (e) { return json(res, { ok: false, why: t('srv.dictFailed', { detail: e.message }) }); }
    }
    if (pn.startsWith('/images/')) return sendFile(req, res, path.join(IMAGES, path.basename(pn.slice(8))));
    if (pn.startsWith('/lots/')) return sendFile(req, res, inside(P.LOTS, pn.slice(6)));   // captures of a sent batch
    if (pn === '/api/notes' && req.method === 'PUT') {
      const data = JSON.parse((await body(req)).toString('utf8'));
      if (!Array.isArray(data.notes)) throw new Error('notes must be an array');
      const before = fs.existsSync(NOTES) ? readNotes() : { notes: [], rev: '0' };
      // saved on an older revision than the file's (another tab saved since): refused, with the notes as they are now
      // (a save without revision — the tests, an older page — goes through as before)
      if (data.rev !== undefined && before && data.rev !== before.rev) return json(res, { ok: false, conflict: true, current: before }, 409);
      writeNotes(data, before);
      if (data.notes.length !== lastCount) { lastCount = data.notes.length; log(t('srv.notes', { n: lastCount })); }
      return json(res, { ok: true, rev: notesRev() });
    }
    // ---- live preview ----
    if (pn === '/player.html' && HFP) {
      const comp = hfComposition(P.hf.projet, P.hf.index), hf = hfFor(P.hf.projet);
      if (!hf?.runtime || !comp) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(t(hf ? 'hf.noComp' : 'hf.none')); }
      const html = fs.readFileSync(path.join(P.hf.projet, P.hf.index), 'utf8');
      const cfg = { ...comp, index: P.hf.index, version: hf.version };
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(injectHead(html, `<base href="/hf/"><script>window.__COULISSES_HF = ${JSON.stringify(cfg).replace(/</g, '\\u003c')};</script><script src="/hf-runtime.js?v=${encodeURIComponent(hf.version)}"></script><script src="/shortcuts.js"></script><script src="/player-bridge.js"></script><script type="module" src="/hf-player.js?v=${player.state.version}"></script>`));
    }
    if (HFP && pn === '/hf-runtime.js') return sendFile(req, res, hfFor(P.hf.projet)?.runtime ?? null, 'text/javascript; charset=utf-8');
    if (HFP && pn === '/hf-player.js') return sendFile(req, res, path.join(HERE, 'player', 'hf-player.js'), 'text/javascript; charset=utf-8');
    if (HFP && (pn === '/hf-stage2d.js' || pn === '/hf-keys.js' || pn === '/hf-ready.js')) {   // the 2D staging of the Remotion runs, the frame-ready watch: their types stripped (no build)
      const src = fs.readFileSync(path.join(HERE, 'player', { '/hf-keys.js': 'keys.ts', '/hf-ready.js': 'ready.ts' }[pn] ?? 'stage2d.ts'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(stripTypeScriptTypes(src, { mode: 'strip' }).replace(/from '\.\/keys'/g, "from '/hf-keys.js'"));
    }
    if (HFP && pn.startsWith('/hf/')) return sendFile(req, res, inside(P.hf.projet, pn.slice(4)));
    if (pn === '/player.html') {
      const release = player.getRelease?.(url.searchParams.get('v') ?? player.state.version);
      if (!release) return json(res, { error: 'Cette version de l’aperçu n’est plus disponible.' }, 410);
      player.retain(release.hash, `bootstrap-${release.hash}`, 60000);
      const cfg = JSON.stringify({ version: release.version, hash: release.hash }).replace(/</g, '\\u003c');
      const base = `/player-assets/${release.hash}/`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(fs.readFileSync(path.join(HERE, 'player', 'player.html'), 'utf8')
        .replace('__RELEASE__', cfg).replace('__SCRIPT__', base + release.entry)
        .replace('__STYLE__', release.css ? `<link rel="stylesheet" href="${base}${release.css}">` : ''));
    }
    if (pn === '/player.js') return sendFile(req, res, player.getRelease?.(url.searchParams.get('v') ?? player.state.version)?.file, 'text/javascript; charset=utf-8');
    if (pn.startsWith('/player-assets/')) {
      const [, , hash, ...parts] = pn.split('/'), file = player.asset?.(hash, parts.join('/'));
      if (!file) return json(res, { error: 'Ressource de cette version introuvable.' }, 404);
      return sendFile(req, res, file, parts.at(-1)?.endsWith('.css') ? 'text/css; charset=utf-8' : undefined);
    }
    if (pn === '/api/preview-lease' && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString('utf8') || '{}');
      if (typeof b.owner !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(b.owner)) return json(res, { ok: false }, 400);
      if (b.release) { player.release?.(b.owner); return json(res, { ok: true }); }
      return json(res, { ok: !!player.retain?.(b.hash, b.owner) });
    }
    if (pn === '/api/code-playback' && CODE_PLAYBACK && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString('utf8') || '{}');
      if (typeof b.owner !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(b.owner)) return json(res, { error: 'Propriétaire de préparation invalide.' }, 400);
      let entry = playbackOwners.get(b.owner);
      if (entry?.cancelled) return json(res, { error: 'Cette préparation a été annulée.' }, 409);
      if (!entry) {
        if (playbackOwners.size >= 1000) return json(res, { error: 'Trop de demandes dans cette session.' }, 429);
        entry = { id: null, promise: null, requestKey: JSON.stringify([b.version, b.from, b.to, b.width, b.height]) };
        playbackOwners.set(b.owner, entry);
        entry.promise = (async () => {
          if (b.version !== player.state.version) throw new Error('La version demandée a changé.');
          const generation = await playbackGeneration(b);
          if (entry.cancelled) throw new Error('Préparation annulée avant le calcul.');
          CODE_PLAYBACK.update(generation);
          const state = await CODE_PLAYBACK.request({ from: b.from, to: b.to }); entry.id = state.id;
          if (entry.cancelled) { await releasePlaybackOwner(entry); throw new Error('Préparation annulée.'); }
          return state;
        })();
      }
      try { return json(res, await entry.promise); }
      catch (e) { return json(res, { error: e.message }, 409); }
    }
    if (pn === '/api/code-playback/cancel' && CODE_PLAYBACK && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString('utf8') || '{}');
      if (typeof b.owner !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(b.owner)) return json(res, { error: 'Propriétaire invalide.' }, 400);
      let entry = playbackOwners.get(b.owner);
      if (!entry) { entry = { cancelled: true, id: null, promise: Promise.resolve() }; playbackOwners.set(b.owner, entry); }
      entry.cancelled = true;
      await entry.promise.catch(() => {});
      await releasePlaybackOwner(entry);
      return json(res, { ok: true });
    }
    if (pn === '/api/code-playback' && CODE_PLAYBACK && req.method === 'GET') {
      const id = url.searchParams.get('id'), state = CODE_PLAYBACK.status(id);
      if (!state) return json(res, { error: 'Plage inconnue.' }, 404);
      const source = state.status === 'ready' ? await codePlaybackSources(P) : state.mediaSignature;
      if (state.hash && (state.hash !== player.state.hash || state.mediaSignature !== source)) {
        await CODE_PLAYBACK.cancelAndWait(id); return json(res, CODE_PLAYBACK.status(id));
      }
      return json(res, CODE_PLAYBACK.status(id));
    }
    if (pn.startsWith('/api/code-playback/') && pn.endsWith('.mp4') && CODE_PLAYBACK && req.method === 'GET') {
      const id = pn.slice('/api/code-playback/'.length, -4), state = CODE_PLAYBACK.status(id);
      const source = await codePlaybackSources(P);
      const f = state?.hash === player.state.hash && player.state.status === 'ready' && state.mediaSignature === source ? CODE_PLAYBACK.file(id) : null;
      if (!f) return json(res, { error: 'Plage périmée ou indisponible.' }, 410);
      return sendFile(req, res, f, 'video/mp4');
    }
    // the preview's messages with the page (player/bridge.js): the preview is shown from another site, in its own process
    if (pn === '/player-bridge.js') return sendFile(req, res, path.join(HERE, 'player', 'bridge.js'), 'text/javascript; charset=utf-8');
    // the review sound (lib/review-sound.mjs): only the current mix, by its signature
    if (pn.startsWith('/api/review-sound/') && RSND) { const f = RSND.file(pn.slice('/api/review-sound/'.length).replace(/\.m4a$/, '')); return f ? sendFile(req, res, f, 'audio/mp4') : (res.writeHead(404), res.end('not found')); }
    if (pn.startsWith('/public/') && P.remotionDir) return sendFile(req, res, inside(path.join(P.remotionDir, 'public'), pn.slice(8)));
    // ---- multi-track timeline + waveforms ----
    if (pn === '/api/timeline') return json(res, { version: timeline.state.version, status: timeline.state.status, error: timeline.state.error, data: timeline.state.data });
    if (pn === '/api/timeline-thumbnails') {
      if (req.method !== 'GET') return json(res, {error:'method-not-allowed'}, 405);
      if (held) return json(res, {error:'video-being-replaced'}, 503);
      const client = new AbortController(), abandon = () => client.abort();
      res.once('close', abandon);
      try {
        const request = parseThumbnailRequest(url.searchParams);
        const data = request.track !== null ? timeline.state.data : null;
        const src = thumbnailSource(P, request, data, request.track === null ? stillSource(P) : null,
          request.fps ?? data?.fps ?? reviewFormat().fps);
        const bytes = await timelineThumbnails.sheet(src, client.signal);
        if (res.destroyed) return;
        res.writeHead(200, {'Content-Type':'image/jpeg', 'Content-Length':bytes.length, 'Cache-Control':'no-store'});
        return res.end(bytes);
      } catch (e) {
        if (!res.destroyed) return json(res, {error:e.message}, e.status ?? 500);
        return;
      } finally { res.off('close', abandon); }
    }
    if (pn === '/api/peaks') {   // ?src=<path in 06_Remotion/public> | @mix (the rendered MP4's sound)
      const src = url.searchParams.get('src') ?? '';
      if (src === '@mix' && held) { res.writeHead(503); return res.end('video being replaced'); }
      const file = src === '@mix' ? pickVideo(P) : inside(CODE && P.remotionDir ? path.join(P.remotionDir, 'public') : P.hf?.projet ?? P.EP, src);   // a project: its own files
      if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end('no audio'); }
      const st = fs.statSync(file), tag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
      if (req.headers['if-none-match'] === tag) { res.writeHead(304, { ETag: tag, 'Cache-Control': 'no-cache' }); return res.end(); }
      const pk = await peaksOf(file);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ETag: tag });
      return res.end(JSON.stringify(pk));
    }
    // ---- « les yeux » : GET /api/frame?f=123&source=video|code[&w=960] -> JPEG ----
    // the composition failed in the live preview (player/crash.tsx): kept for the agent and for later
    if (pn === '/api/preview-error' && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString('utf8') || '{}');
      const line = `${nowIso()} · image ${b.frame} · code v${b.version ?? '?'} · ${String(b.message ?? '').slice(0, 500)}${b.where ? ` · ${b.where}` : ''}\n${String(b.stack ?? '').slice(0, 3000)}\n\n`;
      try { fs.mkdirSync(REVUE, { recursive: true }); fs.appendFileSync(path.join(REVUE, 'preview-errors.log'), line); } catch { /* read-only */ }
      log(t('srv.previewError', { f: b.frame, msg: String(b.message ?? '').slice(0, 160) }));
      return json(res, { ok: true });
    }
    if (pn === '/api/timeline-code-thumbnails' && req.method === 'GET') {
      if (!codeSheet) return json(res, {error:'Aucune composition Remotion.'}, 404);
      const client = new AbortController(), abandon = () => client.abort();
      res.once('close',abandon);
      try {
        const data = await codeSheet(url.searchParams, client.signal);
        if (!res.destroyed) {
          res.writeHead(200, {'Content-Type':'image/jpeg', 'Cache-Control':'no-store', 'X-Source':'code'});
          res.end(data);
        }
        return;
      } catch (err) {
        if (!res.destroyed) {
          const status = err.status || (/La version|Le code a changé|même version/.test(err.message) ? 409 : 503);
          return json(res, {error:err.message}, status);
        }
        return;
      } finally { res.off('close',abandon); }
    }
    if (pn === '/api/frame') {
      const f = Math.max(0, Math.round(+(url.searchParams.get('f') ?? 0))), source = url.searchParams.get('source') === 'code' ? 'code' : 'video';
      const w = Math.min(1920, +(url.searchParams.get('w') ?? 0) || 0);
      const out = path.join(FRAME_CACHE, `${source}-${f}-${w || 'full'}-${Date.now().toString(36)}.jpg`);
      // the same frame of the same code (or video) asked again within a few minutes: the one already made (09/10/2026:
      // every frame of the code is a render; the grading page's scopes and scenes asked them again and again)
      const sig = source === 'code' ? (P.kind === 'hyperframes' ? null : codeSignature(P)) : (() => { try { const s = fs.statSync(stillSource(P)); return `${s.size}-${Math.round(s.mtimeMs)}`; } catch { return null; } })();
      const kept = sig ? path.join(FRAME_CACHE, 'kept', `${crypto.createHash('sha1').update(`${source}|${f}|${w}|${sig}`).digest('hex').slice(0, 24)}.jpg`) : null;
      if (kept) { try { if (Date.now() - fs.statSync(kept).mtimeMs < (source === 'code' ? 600e3 : 3600e3)) { res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache', 'X-Frame': String(f), 'X-Source': source, 'X-Kept': '1' }); return pipeOut(fs.createReadStream(kept), res); } } catch { /* not kept */ } }
      if (source === 'code' && !CODE) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(t('srv.noCode')); }
      if (source === 'code') {
        await codeFrame(P, f, out, { log });
        if (w) { const s = out.replace(/\.jpg$/, '-s.jpg'); await videoFrame(out, 0, 30, s, { width: w }).catch(() => {}); if (fs.existsSync(s)) fs.renameSync(s, out); }
      } else {
        if (held) { res.writeHead(503); return res.end('video being replaced'); }
        await videoFrame(stillSource(P), f, fpsNow(), out, { width: w || undefined });
      }
      if (kept) { try { fs.mkdirSync(path.dirname(kept), { recursive: true }); fs.copyFileSync(out, kept); keepFew(path.dirname(kept), 300); } catch { /* not kept */ } }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache', 'X-Frame': String(f), 'X-Source': source });
      if (!fs.existsSync(out)) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('no frame'); }
      const rs = fs.createReadStream(out).on('close', () => fs.rm(out, { force: true }, () => {}));
      return pipeOut(rs, res);
    }
    // ---- the pending edits -> a batch for Claude ----
    if (pn === '/api/lots/resignal' && req.method === 'POST') {
      const b = JSON.parse((await body(req, 2048)).toString('utf8') || '{}');
      if (!Number.isSafeInteger(b.lot) || b.lot < 1) return json(res, {error:'invalid-lot'}, 400);
      try { return json(res, {ok:true, lot:b.lot, at:signalLot(P, b.lot)}); }
      catch (e) { return json(res, {error:e.message}, e.status ?? 500); }
    }
    if (pn === '/api/send' && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString('utf8'));
      const m = b.fps && Array.isArray(b.size) ? null : reviewFormat();
      const watcher = agentState();
      const a = updatesAgent(b.agent);
      const r = await oneLotAtATime(() => createLot(P, b, { fps: b.fps || m.fps, size: Array.isArray(b.size) ? b.size : m.size, log, deferred: true, updatesPending: true, agent: {id: a.id, name: a.name} }));
      const lot = readLot(P, r.lot), pending = !!lot?.updatesPending;
      json(res, { ok: true, ...r, agent: watcher, updates: pending ? t('upd.line.pending') : updatesLine(lot?.updates) || t('upd.line.unavailable'),
        updatesOk: pending || updatesOk(lot?.updates), pendingUpdatesId: pending ? lot.captureState.id : null });
      scheduleLotUpdates(lot);
      return;
    }
    if (pn === '/api/updates') { const u = await updatesFor(url.searchParams.get('agent'), url.searchParams.has('fresh')); return json(res, { line: u.line, ok: u.ok, md: u.updates ? updatesMarkdown(u.updates, { cli: `node "${CLI_FILE}"`, target: P.target }).join('\n') : '', ...u.updates }); }
    // ---- « Exporter » a run of a Remotion pipeline: the project's script, started here, on the user's order ----
    if (pn === '/api/export' && req.method === 'POST') {
      if (!XP) return json(res, { ok: false, why: t('srv.exportOnly') });
      const b = JSON.parse((await body(req)).toString('utf8') || '{}');
      exportFrom = codePlan();   // (the plan of the video this export makes: the code's now)
      try { return json(res, { ok: true, ...startExport(P, { qualite: b.qualite ?? null, vitesse: b.vitesse ?? 1, log }) }); } catch (e) { return json(res, { ok: false, why: e.message }); }
    }
    // « Encoder avec le GPU » (lib/gpu.mjs, user request 14/10/2026: the GPU by default): settings.json exportGpu
    if (pn === '/api/gpu' && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString('utf8') || '{}');
      writeSettings({ exportGpu: b.on !== false });
      return json(res, { ok: true, gpu: { ...gpuEncoder({ fresh: true }), off: gpuOff() } });
    }
    // « Créer la copie ×1,3 » (« Envois », any project): the current video at the speed of the dial, next to it
    if (pn === '/api/speed/copy' && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString('utf8') || '{}');
      try { return json(res, { ok: true, ...startSpeedCopy(P, pickVideo(P), b.vitesse, { log }) }); } catch (e) { return json(res, { ok: false, why: e.message }); }
    }
    if (pn === '/api/speed/stop' && req.method === 'POST') { try { return json(res, { ok: true, ...stopSpeedCopy(P, { log }) }); } catch (e) { return json(res, { ok: false, why: e.message }); } }
    if (pn === '/api/speed/log') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(speedLog(P)); }
    if (pn === '/api/export/stop' && req.method === 'POST') {
      try { return json(res, { ok: true, ...stopExport(P, { log }) }); } catch (e) { return json(res, { ok: false, why: e.message }); }
    }
    if (pn === '/api/export/log') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(XP ? exportLog(P) : ''); }
    // ---- the full re-render (asked here, run by Claude: studio-cli.mjs render) ----
    if (pn.startsWith('/api/render') && pn !== '/api/render/log' && !B) return json(res, { ok: false, why: t('lot.err.noRender') });
    if (pn === '/api/render' && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString('utf8') || '{}');
      if (renderState(P)?.state === 'running') return json(res, { ok: false, why: t('lot.err.renderRunning') });
      const u = await updatesFor(b.agent);
      let r; try { r = await oneLotAtATime(() => createRenderLot(P, b, { updates: u.updates, agent: u.agent })); } catch (e) { return json(res, { ok: false, why: e.message }); }
      log(t('srv.renderSent', { lot: r.lot, md: r.md }));
      return json(res, { ok: true, ...r, agent: agentState(), updates: u.line, updatesOk: u.ok });
    }
    if (pn === '/api/render/withdraw' && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString('utf8'));
      try { withdrawRenderLot(P, +b.lot); log(t('srv.renderWithdrawn', { lot: b.lot })); return json(res, { ok: true }); } catch (e) { return json(res, { ok: false, why: e.message }); }
    }
    if (pn === '/api/render/stop' && req.method === 'POST') {
      const running = renderState(P);
      if (running?.state !== 'running') return json(res, { ok: false, why: t('srv.noRender') });
      if (MSTUDIO && !isOwnStudio(running)) return json(res, {ok: false, why: 'Ce rendu appartient à une autre instance.'}, 409);
      fs.writeFileSync(renderFiles(P).STOP, nowIso());
      log(t('srv.stopAsked'));
      return json(res, { ok: true });
    }
    if (pn === '/api/render/log') {
      let txt = ''; try { txt = fs.readFileSync(renderFiles(P).LOG, 'utf8'); } catch { /* no render yet */ }
      const NOISE = /X4000|^Copying public dir|^Bundling \d|^Rendered \d|^Encoded \d/;
      const lines = txt.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n|\r/).filter((l) => l.trim() && !NOISE.test(l));
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(lines.slice(-160).join('\n'));
    }
    if (pn === '/api/compare') { const v = pickVideo(P); return json(res, { video: v ? stamp(v) : null, items: compareItems(P) }); }
    if (pn === '/api/hold' && req.method === 'POST') { await hold(); return json(res, { ok: true }); }
    // « Rendre ce plan » (lib/shot-render.mjs): the video of this 3D shot made again and put back in the Short that shows it
    if (pn.startsWith('/api/shot/') && req.method === 'POST') {
      if (!G || !P.uses?.length) return json(res, { ok: false, why: t('shot.noUse') }, 400);
      const b = JSON.parse((await body(req)).toString('utf8') || '{}'), what = pn.slice('/api/shot/'.length);
      try {
        if (what === 'render') return json(res, { ok: true, state: startShot(P, +(b.use ?? 0), { log }) });
        if (what === 'stop') return json(res, { ok: true, state: stopShot(P, { log }) });
        if (what === 'undo') return json(res, { ok: true, ...(await undoShot(P, +(b.use ?? 0), { log })) });
        if (what === 'reveal') { const u = shotTargets(P)[+(b.use ?? 0)]; reveal(u?.target, { select: true }); return json(res, { ok: true }); }
        return json(res, { ok: false, why: what }, 404);
      } catch (e) { return json(res, { ok: false, why: e.message }); }
    }
    if (pn === '/api/shot/log') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(G ? shotLog(P) : ''); }
    // a clip this project shows was made again elsewhere (a 3D shot rendered by « Rendre ce plan »): the live preview is
    // built again, and the page takes the new version as after a code change
    if (pn === '/api/rebuild' && req.method === 'POST') { if (CODE) player.build(); log(t('shot.rebuilt')); return json(res, { ok: true }); }
    if (pn === '/api/unhold' && req.method === 'POST') { unhold(); return json(res, { ok: true }); }
    if (pn === '/api/undo' && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString('utf8'));
      const r = step(P, +b.lot, b.verb === 'redo' ? 'redo' : 'undo', t('srv.youTool'));
      log(t('srv.undoLog', { lot: b.lot, verb: t(b.verb === 'redo' ? 'srv.redone' : 'srv.undone'), res: r.ok ? '✓ ' + r.files.join(', ') : '✗ ' + r.why }));
      return json(res, r);
    }
    res.writeHead(404); res.end('not found');
  } catch (e) { if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); } res.end(String(e.message || e)); }
});

let port = +(args[args.indexOf('--port') + 1] || 0) || DEFAULT_PORT;
// a taken port: the next one, up to 4199 (where lib/render.mjs looks for the studios of an episode)
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && MSTUDIO && port >= DEFAULT_PORT && port < LAST_PORT) server.listen(++port, '127.0.0.1');
  else if (e.code === 'EADDRINUSE' && !MSTUDIO && args.includes('--fallback-auto-port') && port > 4199) server.listen(0, '127.0.0.1');
  else if (e.code === 'EADDRINUSE' && port < 4199) { port++; server.listen(port, '127.0.0.1'); }
  else if (MSTUDIO) { console.error(e.message); process.exit(1); }
  else throw e;
});
server.on('listening', async () => {
  port = server.address().port;
  resumeLotUpdates();
  const url = `http://127.0.0.1:${port}/`;   // the home screen's address too: one site for the browser (lib/guard.mjs)
  const dev = INSTALLED ? '' : t('srv.dev');
  console.log(B ? t('srv.titleEp', { ep, folder, dev }) : t('srv.titleProj', { title: P.title, dir: P.EP, dev }));
  console.log(t('srv.open', { url }));   // « Ouvre : <url> » / « Open: <url> »: the home screen reads it (hub-server.mjs)
  console.log(t('srv.notesIn', { file: NOTES }));
  console.log(t('srv.close'));
  if (!args.includes('--no-open')) exec(process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`);
  buildProxy();
  await player.build(); player.watch();
});
// One studio per project (code review, 08/10/2026): the page of a studio is the only writer of revue/notes.json, so two
// studios on one project (a home screen restarted while its studio still runs, a studio started by hand) would
// overwrite each other's notes. revue/studio.lock.json says which one is open; a second one hands over to it: it says
// where it is (« Ouvre : <its address> », which the home screen reads), opens it, and stops. A lock whose studio is gone
// (closed by force, the PC restarted) is taken over.
function foreignStudio() {
  if (MSTUDIO) {
    console.error(lang() === 'fr' ? 'Cette revue est déjà ouverte ou verrouillée par une autre instance.' : 'Another application is using this review.');
    process.exit(1);
  }
  console.error(lang() === 'fr'
    ? 'Cette revue est déjà ouverte ou verrouillée par une autre instance de Coulisses. Fermez le studio qui la détient, puis ouvrez ce projet dans la V2.'
    : 'This review is already open or locked by another Coulisses instance. Close the studio that owns it, then open this project in V2.');
  process.exit(1);
}
async function openElsewhere() {
  const l = readJson(LOCK, null);
  if (!l?.pid || l.pid === process.pid) return null;
  try { process.kill(l.pid, 0); } catch (e) { if (ownStudiosOnly && e.code !== 'ESRCH') foreignStudio(); return null; }
  if (ownStudiosOnly) {
    try {
      const url = new URL(l.url);
      if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password) return foreignStudio();
      const get = async route => {
        const res = await fetch(new URL(route, url.origin), {signal: AbortSignal.timeout(2000), redirect:'error'});
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      };
      const [ping, about] = await Promise.all([get('/api/ping'), get('/api/about')]);
      const matches = (a, b) => typeof a === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
      if (!ping.studio || ping.pid !== l.pid || !matches(ping.notesFile, NOTES) || !matches(about.folder, HERE) || (MSTUDIO && !isOwnStudio(ping))) return foreignStudio();
      return url.origin + '/';
    } catch { return foreignStudio(); }   // A live owner of unknown identity cannot be replaced.
  }
  if (!l.url) return null;
  try { const j = await (await fetch(new URL('api/ping', l.url), { signal: AbortSignal.timeout(2000) })).json(); return j?.studio && path.resolve(j.notesFile ?? '') === path.resolve(NOTES) ? l.url : null; }
  catch { return null; }
}
async function handOffIfOpen() {
  const other = await openElsewhere();
  if (!other) return;
  console.log(t('srv.already', { url: other }));
  console.log(t('srv.open', { url: other }));
  if (!args.includes('--no-open')) exec(process.platform === 'win32' ? `start "" "${other}"` : `open "${other}"`);
  process.exit(0);
}
await handOffIfOpen();
server.prependOnceListener('listening', () => {
  port = server.address().port;
  const address = {pid:process.pid, port, url:`http://127.0.0.1:${port}/`, since:nowIso()};
  if (MSTUDIO) {
    try {
      updateJson(LOCK, null, current => {
        if (current?.pid !== process.pid || !isOwnStudio(current)) throw new Error('La revue a été ouverte par une autre instance.');
        return {...address, ...processIdentity()};
      });
    } catch (error) { console.error(error.message); process.exit(1); }
  } else {
    try { writeJson(LOCK, address); } catch { /* a read-only revue: no lock */ }
  }
});
server.on('listening', () => {
  resumeLotCaptures(P, log);
});
function releaseStudioLock() {
  try { if (readJson(LOCK, null)?.pid === process.pid) fs.rmSync(LOCK, { force: true }); } catch { /* already removed */ }
}
if (!MSTUDIO) process.on('exit', releaseStudioLock);
let closing = false;
async function shutdown() {
  if (closing) return; closing = true; server.close(); RSND?.stop();
  await Promise.allSettled([player.dispose?.(), CODE_PLAYBACK?.dispose()]); process.exit(0);
}
for (const s of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(s, shutdown);
const first = [];
if (!B) { const v = pickVideo(P); if (v) first.push(probeNow(v, probeKey(v))); }
if (XP && exportAvailable(P).ok) first.push(exportOptionsReady(P));
Promise.all(first).catch(() => {}).finally(() => server.listen(port, '127.0.0.1'));

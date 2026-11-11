// Coulisses (formerly « Brambleshire Studio ») — the home screen of the app (« Coulisses.exe »): lists the episodes, opens the review
// studio of one of them (a studio-server.mjs child process per episode), pauses / resumes a studio around a render.
// Started by the launcher (hidden, no console); also usable by hand: node hub-server.mjs [--episode E03] [--port N]
//   GET  /                 the home screen (hub.html)
//   GET  /go/E03           starts (or reuses) the studio of E03, then redirects the window to it
//   GET  /api/episodes     the episodes (title, render, thumbnail, notes, batches) and the imported projects
//   POST /api/import {path} imports a project (lib/projects.mjs: an AItelier run, a folder of videos, a video file)
//   POST /api/import/pick {what: 'folder'|'video'}  the Windows file dialog (« Coulisses.exe --pick »)
//   POST /api/remove?ep=P…  removes an imported project from the list (nothing is deleted)
//   GET  /import?path=…    import then open (a folder or a video dropped on the app's icon)
//   GET  /api/ping         { hub: true, studios }
//   POST /api/open?ep=E03  { url }      POST /api/pause?ep=E03 (stops its server: the video can be replaced by a render)
//   POST /api/resume?ep=E03             POST /api/quit (stops everything)
// Port: 4170 (installed in the pipeline) or 4171 (Dev workshop), the next one if taken. --lock <file> = where the launcher
// waits for { pid, port } (written once listening). The Dev workshop lists its sandbox episodes, not the real ones.
import http from 'node:http';
import {createHash} from 'node:crypto';
import {promisify} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { optionsFrom, episode, readJson, stamp } from './lib/episode.mjs';
import { STUDIO, INSTALLED, CACHE, DATA } from './lib/place.mjs';
import { APP_NAME, APP_VERSION, MSTUDIO, ENGINE_DIR, HUB_PORT, LAST_HUB_PORT, processIdentity, assertReviewAvailable } from './lib/app-profile.mjs';
import { createAppUpdates } from './lib/app-updates.mjs';
import { installationStatus, scheduleAppUpdate } from './lib/app-update-install.mjs';
import { createUpdateController, installedUpdateTarget, updateAction, updateRequestStatus } from './lib/app-update-api.mjs';
import { ffmpeg, sweepStaleTemp } from './lib/frames.mjs';
import { renderState } from './lib/render.mjs';
import { registry, importProject, removeProject, project, revueOf, folderOf, setFolder, renameFolder } from './lib/projects.mjs';
import { drives, startScan, scanState, stopScan } from './lib/scan.mjs';
import { workspace, startInstall, installState, createProject, projectsRoot, documentsProjectsRoot, FORMATS } from './lib/new-project.mjs';
import {createReverseJobs} from './lib/reverse-jobs.mjs';
import {createReconstructionJobs} from './lib/reconstruct-jobs.mjs';
import { hfFor } from './lib/hyperframes.mjs';
import { homeUpdates, runHomeUpdate, homeUpdateState } from './lib/updates.mjs';
import { t, lang, langSource, setLang, LANGS, renderPage } from './lib/i18n.mjs';
import { fromApp, refuse } from './lib/guard.mjs';
import { browserAccessWanted, setBrowserAccess, tailnet, viaTailnet, publicUrl, serve, unserve, servedPorts, unserveAll } from './lib/remote.mjs';
import { getShortcuts, setShortcuts } from './lib/shortcuts.mjs';
import { docText, about, openOnline, logRing } from './lib/menu.mjs';
import os from 'node:os';

let args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const SANDBOX = path.join(STUDIO, 'sandbox', '07_Episodes');
if (!INSTALLED && !args.includes('--episodes') && fs.existsSync(SANDBOX)) args = [...args, '--episodes', SANDBOX];
const O = optionsFrom(args);
const PASS = ['--theatre', '--episodes', '--remotion'].flatMap((k) => (opt(k) ? [k, opt(k)] : []));   // given to every studio
const LOGS = path.join(CACHE, 'logs'); fs.mkdirSync(LOGS, { recursive: true });
const logFile = fs.createWriteStream(path.join(LOGS, 'hub.log'), { flags: 'a' });
const ring = logRing();   // Tools › Log in the menu bar
const log = (m) => { const line = `${new Date().toLocaleString()}  ${m}`; logFile.write(line + '\n'); ring.push(line); console.log(line); };
process.on('uncaughtException', (e) => log(t('hubsrv.ignored', { msg: e.stack || e.message })));
// Remotion's stale temp folders left by any render (lib/frames.mjs; 09/10/2026: 1.2 TB, the disk full): a while after the
// start, then every hour while Coulisses is open (one Coulisses process at a time: the stamp)
{ const sweep = () => { const n = sweepStaleTemp(path.join(CACHE, 'temp-sweep.txt')); if (n) log(t('srv.tempSwept', { n }).trim()); };
  setTimeout(sweep, 30000).unref(); setInterval(sweep, 3600e3).unref(); }

// ---------- episodes and imported projects ----------
// ids: E03 (an episode), P1a2b3c4d (an imported project, lib/projects.mjs)
const normId = (x) => { const v = String(x ?? '').trim(); return /^E\d+$/i.test(v) ? v.toUpperCase() : /^P[0-9a-f]{8}$/i.test(v) ? 'P' + v.slice(1).toLowerCase() : null; };
function reviewStats(revue) {
  const lotsDir = path.join(revue, 'lots');
  const key = ['notes.json','replies.json','lots'].map(name => {
    const st = fs.statSync(path.join(revue,name), {throwIfNoEntry:false});
    return st ? st.mtimeMs + '/' + st.size + '/' + st.ino : '';
  }).join('|');
  const old = statsMemo.get(revue);
  if (old?.key === key) return old.value;
  const notes = readJson(path.join(revue, 'notes.json'), { notes: [] }).notes ?? [];
  const replies = readJson(path.join(revue, 'replies.json'), { notes: {} }).notes ?? {};
  const done = (n) => { const r = replies[n.id], ut = Date.parse(n.statusAt || 0) || 0, ct = Date.parse(r?.statusAt || 0) || 0; return ['done', 'verified'].includes(r?.status && ct > ut ? r.status : n.status); };   // (fixed, or validated by the user)
  const lots = fs.existsSync(lotsDir) ? fs.readdirSync(lotsDir).filter(f => /^\d{3}\.json$/.test(f)).length : 0;
  const value = { notes: notes.length, open: notes.filter(n => !done(n)).length, drafts: notes.filter(n => n.draft).length, lots,
    reviewed: notes.reduce((last,n) => {const at = n.updated || n.created; return at && (!last || at > last) ? at : last;}, null) };
  statsMemo.set(revue, {key,value});
  return value;
}
const statsMemo = new Map();
// A big library must not launch one ffprobe or ffmpeg per visible project at once.
function limited(concurrency) {
  let active = 0; const waiting = [];
  return async function run(task) {
    if (active < concurrency) active++; else await new Promise(resolve => waiting.push(resolve));
    try { return await task(); }
    finally { if (waiting.length) waiting.shift()(); else active--; }
  };
}
const probeQueue = limited(2), thumbnailQueue = limited(2), execProbe = promisify(execFile);
// a video's duration, by ffprobe in the background (never inside the request: the list is asked every 5 s); unknown
// until it answers, then shown on the next refresh
const durations = new Map(), measuring = new Set();
function durationOf(file, st) {
  const key = `${file}|${st.size}|${st.mtime}`;
  if (!durations.has(key) && !measuring.has(key)) {
    measuring.add(key);
    probeQueue(() => execProbe('ffprobe', ['-v','error','-show_entries','format=duration','-of','csv=p=0',file],
      {encoding:'utf8',windowsHide:true,timeout:30000})).then(({stdout}) => durations.set(key,Number(stdout.trim()) || null),
      () => durations.set(key,null)).finally(() => measuring.delete(key));
  }
  return durations.get(key) ?? null;
}
function projects() {
  const reg = registry();
  return reg.projects.map(({ id, revue }) => {
    const st = studios.get(id), live = st && (st.paused || (st.proc.exitCode === null && st.url)) ? { url: st.url, paused: !!st.paused } : null;
    try {
      const p = project(revue), v = p.summary.video;
      const engine = p.kind === 'remotion' ? 'remotion' : p.kind === 'hyperframes' ? 'hyperframes' : null;   // the home screen's tag (09/10/2026)
      const reverse = p.kind === 'remotion' && fs.existsSync(path.join(p.EP,'reverse.json')) && readJson(p.coulisses,{})?.reverse === 1;
      return { id, project: true, reverse, kind: p.kind, engine, channel: p.summary.channel ?? null, folder: folderOf(id, p.summary.channel ?? null, reg), coulisses: p.coulisses ?? null, format: p.summary.format, title: p.title, root: p.EP, revue, video: v, thumb: !!v || reverse,
        duration: v ? durationOf(p.summary.videoPath, v) : null, ...reviewStats(revue), studio: live };
    } catch (e) { return { id, project: true, missing: true, revue, folder: folderOf(id, null, reg), title: path.basename(path.dirname(revue)), why: e.message, studio: live }; }
  });
}
// the Theatre section of the home screen: its name is the channel its episodes' .coulisses give (the user's own), else
// « Théâtre »; it exists only when the episodes' folder is on this PC
function theatreInfo() {
  const exists = fs.existsSync(O.episodesDir);
  let name = null;
  if (exists) for (const d of fs.readdirSync(O.episodesDir).filter((x) => /^E\d+ - /i.test(x))) {
    const f = fs.readdirSync(path.join(O.episodesDir, d)).find((x) => x.toLowerCase().endsWith('.coulisses'));
    const c = f ? readJson(path.join(O.episodesDir, d, f), null) : null;
    if (c?.chaine) { name = c.chaine; break; }
  }
  return { exists, name };
}
// the channel of the theatre's episodes (their .coulisses), else « Theatre » (a folder name: the same in both languages)
let theatreMemo = { at: 0, v: null };
function theatreChannel() { if (Date.now() - theatreMemo.at > 5000) theatreMemo = { at: Date.now(), v: theatreInfo().name ?? 'Theatre' }; return theatreMemo.v; }
function episodes() {
  if (!fs.existsSync(O.episodesDir)) return [];
  const reg = registry();
  return fs.readdirSync(O.episodesDir).filter((d) => /^E\d+ - /i.test(d)).sort().map((folder) => {
    const id = folder.split(' - ')[0].toUpperCase(), dir = path.join(O.episodesDir, folder), revue = path.join(dir, 'revue');
    const mp4 = path.join(dir, `${folder}.mp4`), video = fs.existsSync(mp4) ? stamp(mp4) : null;
    const snap = readJson(path.join(revue, 'timeline.json'), null);
    const poster = fs.statSync(path.join(dir,'thumbnail.jpg'),{throwIfNoEntry:false});
    const st = studios.get(id), R = renderState({ REVUE: revue });   // a re-render asked from the studio (lib/render.mjs)
    const render = R && (R.state === 'running' || ((R.state === 'rendered' || R.state === 'blocked' || R.state === 'failed') && Date.now() - Date.parse(R.updatedAt) < 3 * 86400e3))
      ? { state: R.state, phase: R.phase, pct: R.render?.stage === 'frames' ? Math.floor(R.render.pct) : null } : null;
    return {
      render, engine: 'remotion', channel: theatreChannel(), folder: folderOf(id, theatreChannel(), reg), dir: folder,
      id, title: folder.replace(/^E\d+ - /i, ''), video, duration: snap ? snap.frames / (snap.fps || 30) : null,
      ...reviewStats(revue), thumb: !!poster || !!video, thumbVersion: poster ? String(poster.mtimeMs) : video?.mtime,
      studio: st && (st.paused || (st.proc.exitCode === null && st.url)) ? { url: st.url, paused: !!st.paused } : null,
    };
  });
}
// A short snapshot serves simultaneous visitors and their thumbnail lookups. Revisit
// disk changes on the next poll; explicit library mutations invalidate immediately.
let catalogCache = null;
function catalog() {
  if (catalogCache && Date.now() - catalogCache.at < 1400) return catalogCache;
  const eps = episodes(), imported = projects();
  catalogCache = {at:Date.now(), episodes:eps, projects:imported,
    index:new Map([...eps,...imported].map(item => [item.id,item]))};
  return catalogCache;
}
const thumbJobs = new Map();
async function thumb(id) {
  if (!id) return null;
  const item = (catalogCache || catalog()).index.get(id);
  if (!item?.thumb) return null;
  let src;
  if (item.project) src = project(item.revue).summary.videoPath || (item.reverse && path.join(item.root,'public','media','source.mp4'));
  else {
    const dir = path.join(O.episodesDir,item.dir), poster = path.join(dir,'thumbnail.jpg');
    src = fs.existsSync(poster) ? poster : path.join(dir,item.dir + '.mp4');
  }
  if (!src) return null;
  const st = fs.statSync(src,{throwIfNoEntry:false});
  if (!st?.isFile()) return null;
  const dir = path.join(CACHE,'hub'), sig = createHash('sha256').update([src,st.mtimeMs,st.size].join('|')).digest('hex').slice(0,16);
  const out = path.join(dir,'thumb-' + id + '-' + sig + '.jpg');
  if (fs.existsSync(out)) return out;
  if (!thumbJobs.has(out)) {
    const job = thumbnailQueue(async () => {
      fs.mkdirSync(dir,{recursive:true});
      const temp = out + '.' + process.pid + '.jpg';
      try {
        const at = Math.min(20,(item.duration || 0) * .1);
        await ffmpeg([...(at && !/\.jpe?g$/i.test(src) ? ['-ss',String(at)] : []),'-i',src,'-frames:v','1','-vf','scale=720:-2','-q:v','3',temp]);
        fs.renameSync(temp,out);
        return out;
      } finally { fs.rmSync(temp,{force:true}); }
    }).finally(() => thumbJobs.delete(out));
    thumbJobs.set(out,job);
  }
  return thumbJobs.get(out);
}

// ---------- studios (one child process per episode) ----------
const studios = new Map();   // id -> { proc, url, ready, paused }
let hubUrl = '';
function open(id) {
  const cur = studios.get(id);
  if (cur && !cur.paused && cur.proc.exitCode === null) return cur.ready;
  if (id.startsWith('P') && !revueOf(id)) return Promise.reject(new Error(t('hubsrv.gone')));
  // after a pause (render), the studio comes back on ITS port: the window, still open on it, finds it again
  const studioPort = cur?.url ? new URL(cur.url).port : opt('--studio-port');
  const again = studioPort ? ['--port', studioPort, ...(opt('--studio-port') ? ['--fallback-auto-port'] : [])] : [];
  const st = { proc: null, url: null, paused: false };
  const out = fs.createWriteStream(path.join(LOGS, `${id}.log`), { flags: 'a' });
  const proj = id.startsWith('P'), target = proj ? ['--project', revueOf(id) ?? ''] : [id];
  st.proc = spawn(process.execPath, [path.join(STUDIO, 'studio-server.mjs'), ...target, '--no-open', '--hub', hubUrl, ...again, ...(proj ? [] : PASS)], { cwd: STUDIO, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  st.ready = new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => { reject(new Error(t('hubsrv.noAnswer', { log: path.join(LOGS, `${id}.log`) }))); if (studios.get(id) === st) studios.delete(id); killTree(st.proc.pid); }, 60000);
    st.proc.stdout.on('data', (d) => {
      out.write(d); buf = st.url ? '' : (buf + d).slice(-8000);
      const m = /(?:Ouvre :|Open:) (http:\/\/(?:localhost|127\.0\.0\.1):\d+\/)/.exec(buf);   // the studio's language (studio-server.mjs)
      if (m && !st.url) { st.url = m[1]; clearTimeout(timer); resolve(st.url); if (browserAccessWanted()) serveLogged(+new URL(st.url).port); }
    });
    st.proc.stderr.on('data', (d) => { out.write(d); buf = (buf + d).slice(-8000); });
    st.proc.on('exit', (c) => { clearTimeout(timer); out.end(); if (!st.url) reject(new Error(buf.trim().split('\n').slice(-3).join(' ') || t('hubsrv.exit', { code: c }))); });
  });
  studios.set(id, st);
  log(t('hubsrv.starting', { id }));
  st.ready.then((u) => log(t('hubsrv.studio', { id, msg: u })), (e) => log(t('hubsrv.studio', { id, msg: e.message })));
  return st.ready;
}
// the whole process tree (the studio's ffmpeg, its headless Chrome for the eyes…)
const killTree = (pid) => new Promise((r) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => r()));
async function pause(id) {
  const st = studios.get(id); if (!st) return false;
  st.paused = true;
  if (st.proc.exitCode === null && st.proc.signalCode === null) await killTree(st.proc.pid);
  log(t('hubsrv.paused', { id })); return true;
}
async function quit() {
  await Promise.allSettled([reverseJobs.close(), reconstructionJobs.close()]);
  for (const st of studios.values()) if (st.proc.exitCode === null) await killTree(st.proc.pid);
  if (mine.size) await Promise.race([Promise.all([...mine].map((p) => unserve(p))), new Promise((r) => setTimeout(r, 4000))]);   // (the ports it brought to the tailnet, taken back)
  log(t('hubsrv.quit')); process.exit(0);
}
// « Accès depuis l'iPad »: this hub's port and each studio's, brought to the tailnet (lib/remote.mjs)
const mine = new Set();   // the ports this hub brought to the tailnet (its quit takes back these only: never another hub's)
const serveLogged = (p) => serve(p).then((r) => { if (r.ok) mine.add(p); else log(`tailscale serve ${p} : ${r.err}`); return r; });
async function browserAccess(on) {
  setBrowserAccess(on);
  if (on) { await serveLogged(port); for (const st of studios.values()) if (st.url && st.proc.exitCode === null) await serveLogged(+new URL(st.url).port); }
  else { await unserveAll(); mine.clear(); }   // (closed by the user: every port of Coulisses)
  log(on ? 'accès depuis l\'iPad : ouvert (Tailscale)' : 'accès depuis l\'iPad : fermé');
}
async function browserAccessState(fresh = false) {
  const T = tailnet({ fresh }), served = T.ok ? await servedPorts() : [];
  return { on: browserAccessWanted(), tailscale: { ok: T.ok, why: T.why ?? null, https: !!T.https, dns: T.dns ?? null }, url: T.ok ? `https://${T.dns}:${port}/` : null, served, here: null };
}
for (const s of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(s, quit);

// ---------- « Importer un projet… » ----------
const APP_EXE = (MSTUDIO ? process.env.MSTUDIO_PICKER_EXE : process.env.COULISSES_PICKER_EXE) || path.join(STUDIO, APP_NAME + '.exe');
const startDir = () => [path.join(os.homedir(), 'Desktop', 'Youtube', 'AItelier', 'long'), path.join(os.homedir(), 'Desktop', 'Youtube'), path.join(os.homedir(), 'Desktop')].find((d) => fs.existsSync(d)) ?? os.homedir();
let picking = null;
function pick(what) {
  if (picking) return picking;
  if (!fs.existsSync(APP_EXE)) return Promise.reject(new Error(t('hubsrv.noExe')));
  const out = path.join(CACHE, 'hub', `pick-${Date.now()}.txt`); fs.mkdirSync(path.dirname(out), { recursive: true });
  picking = new Promise((resolve) => {
    // folder | video | project (a .coulisses file, or a video: File › Open a project… in the menu bar)
    execFile(APP_EXE, ['--pick', ['video', 'project'].includes(what) ? what : 'folder', out, startDir()], { windowsHide: false }, () => {
      let p = ''; try { p = fs.readFileSync(out, 'utf8').trim(); fs.rmSync(out, { force: true }); } catch { /* cancelled */ }
      picking = null; resolve(p || null);
    });
  });
  return picking;
}
const readBody = (req, strict = false) => new Promise((resolve,reject) => {
  const chunks = []; let bytes = 0;
  req.on('error',reject);
  req.on('aborted',() => reject(new Error('Request aborted')));
  req.on('data',chunk => {
    bytes += chunk.length;
    if (bytes <= 16 * 1024 * 1024) chunks.push(chunk);
    else { chunks.length = 0; reject(Object.assign(new Error('Request too large'),{status:413})); }
  });
  req.on('end',() => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (strict && (!body || typeof body !== 'object' || Array.isArray(body))) throw Error();
      resolve(body);
    } catch { if (strict) reject(Object.assign(new Error('Invalid JSON object'),{status:400})); else resolve({}); }
  });
});
function doImport(p) {
  const r = importProject(p, { episodesDir: O.episodesDir });
  log(r.episode ? t('hubsrv.episodeOpened', { id: r.id }) : t('hubsrv.imported', { title: r.title, kind: r.kind, revue: r.revue }));
  return r;
}

// ---------- http ----------
const send = (res, code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); res.end(body); };
const json = (res, data, code = 200) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(data));
const reverseOptions = {
  french:() => lang() === 'fr',root:() => MSTUDIO ? projectsRoot() : process.env.COULISSES_REVERSE_ROOT || (process.env.COULISSES_REVERSE_DOCUMENTS === '1' ? documentsProjectsRoot() : projectsRoot()),
  modules:() => {
    const roots = MSTUDIO ? [projectsRoot(), ENGINE_DIR] : [process.env.COULISSES_REVERSE_ROOT, projectsRoot(), process.env.COULISSES_REVERSE_ENGINE, O.remotionDir];
    for (const root of roots.filter(Boolean)) {
      const engine = workspace(root);
      if (engine.ready) return path.join(engine.modulesRoot || root, 'node_modules');
    }
  },
  register:file => {
    const p = importProject(file);
    catalogCache = null;
    return p.id;
  },
  locate:id => {
    if (!/^P[0-9a-f]{8}$/i.test(id || '')) return null;
    const review = revueOf(normId(id));
    if (!review) return null;
    assertReviewAvailable(review);
    const p = project(review);
    return p.kind === 'remotion' && p.coulisses && readJson(p.coulisses,{})?.reverse === 1
      ? {id:p.ep,dir:p.EP,file:p.coulisses} : null;
  },
};
const reverseJobs = createReverseJobs(reverseOptions);
const reconstructionJobs = createReconstructionJobs(reverseOptions);
async function checkUpdateIdle() {
  const blocked = () => Object.assign(new Error(t('common.appUpdate.busyWork')), {status:409});
  if (reverseJobs.hasActiveWork() || reconstructionJobs.hasActiveWork() ||
      [scanState(), installState(), homeUpdateState()].some(job => job?.state === 'running')) throw blocked();
  await Promise.all([...studios].map(async ([id, studio]) => {
    if (studio.paused || studio.proc.exitCode !== null || studio.proc.signalCode !== null) {
      const review = id.startsWith('P') ? revueOf(id) : episode(id, O).REVUE;
      if (review && renderState({REVUE:review})?.state === 'running') throw blocked();
      return;
    }
    if (!studio.url) throw blocked();
    try {
      const res = await fetch(new URL('/api/app-update/activity', studio.url), {redirect:'error', signal:AbortSignal.timeout(3500)});
      if (!res.ok || (await res.json()).busy !== false) throw blocked();
    } catch { throw blocked(); }
  }));
}
const appUpdates = MSTUDIO && installedUpdateTarget(STUDIO) ? createUpdateController({
  updates:createAppUpdates({version:APP_VERSION, dir:path.join(DATA, 'updates')}),
  installation:() => installationStatus(DATA),
  schedule:(file, projectId) => scheduleAppUpdate({
    installerPath:file.path, sha256:file.sha256, version:file.version,
    appDir:STUDIO, dataDir:DATA, projectId, language:lang(),
  }),
  checkIdle:checkUpdateIdle,
}) : null;
async function reverseRequest(pn,url,req,res) {
  const post = req.method === 'POST', get = req.method === 'GET';
  try {
    if (pn === '/api/reverse/reconstruct' && post) return json(res,reconstructionJobs.start(await readBody(req,true)),202);
    const reconstruction=/^\/api\/reverse\/reconstruction\/([a-f0-9-]{36})(?:\/(cancel|retry|verify))?$/.exec(pn);
    if (reconstruction) {
      const [,id,action]=reconstruction;
      if (!action && get) return json(res,reconstructionJobs.status(id));
      if (action === 'cancel' && post) return json(res,await reconstructionJobs.cancel(id));
      if ((action==='retry'||action==='verify') && post) return json(res,reconstructionJobs.resume(id,action),202);
      return json(res,{ok:false,why:'Method not allowed'},405);
    }
    if (pn === '/api/reverse/analyze' && post) return json(res,reverseJobs.analyze(await readBody(req,true)),202);
    if (pn === '/api/reverse/edit' && post) return json(res,reverseJobs.edit((await readBody(req,true)).id));
    const match = /^\/api\/reverse\/jobs\/([a-f0-9-]{36})(?:\/(frame|text|create|cancel))?$/.exec(pn);
    if (!match) return json(res,{ok:false,why:'Unknown Reverse route'},404);
    const [,id,action] = match;
    if (!action && get) return json(res,reverseJobs.status(id));
    if (action === 'create' && post) return json(res,reverseJobs.create(id,await readBody(req,true)),202);
    if (action === 'cancel' && post) return json(res,reverseJobs.cancel(id));
    if ((action === 'frame' || action === 'text') && get) {
      const raw = url.searchParams.get('frame');
      const client = new AbortController();
      res.once('close', () => client.abort());
      const ocr = action === 'text';
      const result = await reverseJobs.image(id,/^\d+$/.test(raw ?? '') ? Number(raw) : NaN,client.signal,ocr,url.searchParams.get('view') === '1');
      return ocr ? json(res,result) : send(res,200,'image/jpeg',result);
    }
    return json(res,{ok:false,why:'Method not allowed'},405);
  } catch (error) {
    if (!res.destroyed && !res.headersSent) json(res,{ok:false,why:error.message,needInstall:!!error.needInstall},error.status || 400);
  }
}
const escH = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const page = (title0, msg0) => { const title = escH(title0), msg = escH(msg0); return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="background:#090b12;color:#f4f5fa;font:15px 'Segoe UI';display:grid;place-items:center;height:100vh;margin:0"><div style="max-width:640px;text-align:center"><h2 style="font-weight:600">${title}</h2><p style="color:#aeb2c4;white-space:pre-wrap">${msg}</p><p><a style="color:#c9f26b" href="/">${t('hubsrv.back')}</a></p></div>`; };
const server = http.createServer(async (req, res) => {
  if (!fromApp(req)) return refuse(res);   // only Coulisses itself (lib/guard.mjs)
  const url = new URL(req.url, 'http://x'), ep = normId(url.searchParams.get('ep')) ?? '';
  let pn; try { pn = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'text/plain; charset=utf-8', 'bad address'); }
  if (req.method === 'POST' || pn.startsWith('/go/') || pn === '/import') res.on('finish', () => { catalogCache = null; });
  try {
    // the home screen, in the user's language (lib/i18n.mjs: {{key}} and window.T)
    if (pn === '/' || pn === '/index.html') return send(res, 200, 'text/html; charset=utf-8', renderPage(fs.readFileSync(path.join(STUDIO, 'hub.html'), 'utf8'), { prefixes: ['hub.', 'common.', 'menu.', 'hf.noneShort'] }));
    // « Langue · Language »: the user's choice for the whole app (%LOCALAPPDATA%\Coulisses\settings.json)
    if (pn === '/api/lang' && req.method === 'POST') {
      const b = await readBody(req);
      if (!LANGS.includes(b.lang)) return json(res, { ok: false, why: t('srv.langBad') }, 400);
      const now = setLang(b.lang); log(`lang: ${now} (${langSource()})`);
      return json(res, { ok: true, lang: now, forced: langSource() === 'env' });
    }
    if (pn === '/api/lang') return json(res, { lang: lang(), source: langSource(), langs: LANGS });
    const operation = updateAction(pn);
    if (operation) {
      if (!appUpdates) return json(res, {error:'unavailable'}, 404);
      const code = updateRequestStatus(req, operation);
      if (code !== 200) return json(res, {error:'invalid-request'}, code);
      try {
        const projectId = ep && studios.has(ep) ? ep : null;
        return json(res, await appUpdates.run(operation, projectId));
      } catch (error) { return json(res, {error:error.message}, error.status || 409); }
    }
    // the menu bar (menubar.js): documents, About, the online documentation, the home screen's log
    if (pn === '/hub-library.css') return send(res, 200, 'text/css; charset=utf-8', fs.readFileSync(path.join(STUDIO, 'page', 'hub-library.css')));
    if (['/reverse-ui.js','/reconstruct-ui.js','/reverse.css','/app-update-ui.js','/app-update.css'].includes(pn)) return send(res,200,pn.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8',fs.readFileSync(path.join(STUDIO,'page',pn.slice(1))));
    if (pn.startsWith('/api/reverse/')) return reverseRequest(pn,url,req,res);
    if (pn === '/menubar.js') return send(res, 200, 'text/javascript; charset=utf-8', fs.readFileSync(path.join(STUDIO, 'menubar.js')));
    // « Raccourcis clavier » (shortcuts.js): the user's keys, the same here and in every studio (settings.json)
    if (pn === '/shortcuts.js') return send(res, 200, 'text/javascript; charset=utf-8', fs.readFileSync(path.join(STUDIO, 'shortcuts.js')));
    if (pn === '/api/shortcuts' && req.method === 'PUT') { const b = await readBody(req); return json(res, { ok: true, shortcuts: setShortcuts(b.shortcuts) }); }
    if (pn === '/api/shortcuts') return json(res, { shortcuts: getShortcuts() });
    if (pn === '/api/doc') { const d = docText(url.searchParams.get('name')); return d ? send(res, 200, 'text/plain; charset=utf-8', d.text) : send(res, 404, 'text/plain', 'not found'); }
    if (pn === '/api/about') return json(res, about());
    if (pn === '/api/log') return send(res, 200, 'text/plain; charset=utf-8', ring.text());
    if (req.method === 'POST' && pn === '/api/reveal') { const b = await readBody(req); if (b.what !== 'online') return json(res, { ok: false, why: String(b.what) }, 400); openOnline(); return json(res, { ok: true }); }
    if (pn === '/favicon.png') return send(res, 200, 'image/png', fs.readFileSync(path.join(STUDIO, 'favicon.png')));
    if (pn === '/api/ping') return json(res, { hub: true, ...(MSTUDIO ? processIdentity() : {}), installed: INSTALLED, episodesDir: O.episodesDir, studios: Object.fromEntries([...studios].map(([k, s]) => [k, { url: s.url, paused: s.paused }])) });
    // ---- « Nouveau projet »: an empty 3D scene, built live with the agent (lib/new-project.mjs) ----
    // ---- « Mises à jour » (Remotion and HyperFrames): checked once a day by the page, updated on the user's click ----
    if (pn === '/api/home-updates' && req.method !== 'POST') {
      const dirs = [{ label: theatreChannel(), dir: O.remotionDir }, { label: t('upd.home.newProjects'), dir: projectsRoot() },
        ...registry().projects.map(({ revue }) => { try { const p = project(revue); return p.kind === 'remotion' && p.remotionDir ? { label: p.title, dir: p.remotionDir } : null; } catch { return null; } }).filter(Boolean)];
      return json(res, { ...(await homeUpdates({ fresh: url.searchParams.has('fresh'), remotionDirs: dirs })), job: homeUpdateState() });
    }
    if (pn === '/api/home-updates/run' && req.method === 'POST') {
      const b = await readBody(req);
      try { return json(res, { ok: true, job: runHomeUpdate(String(b.what ?? ''), Array.isArray(b.names) ? b.names.map(String) : [], { log }) }); } catch (e) { return json(res, { ok: false, why: e.message }); }
    }
    if (pn === '/api/home-updates/job') return json(res, homeUpdateState() ?? { state: 'idle' });
    if (req.method !== 'POST' && pn === '/api/new') return json(res, { workspace: workspace(), hf: hfFor(null)?.version ?? null, formats: Object.keys(FORMATS), channels: [...new Set([...projects().map((x) => x.channel), theatreInfo().name].filter(Boolean))].sort() });
    if (req.method === 'POST' && pn === '/api/new/install') return json(res, { ok: true, ...startInstall(projectsRoot(), { log }) });
    if (pn === '/api/new/install') return json(res, installState() ?? { state: 'idle' });
    if (req.method === 'POST' && pn === '/api/new') {
      const b = await readBody(req), ws = workspace(), hf = b.engine === 'hyperframes';
      if (!hf && !ws.ready) return json(res, { ok: false, needInstall: true, root: ws.root, missing: ws.missing });   // HyperFrames: nothing to install
      try {
        const { file } = createProject({ nom: b.nom, chaine: b.chaine || null, format: b.format, duree: b.duree, fps: b.fps, engine: hf ? 'hyperframes' : 'remotion' });
        const p = importProject(file);
        log(t('hubsrv.newProject', { title: p.title, file }));
        return json(res, { ok: true, id: p.id, file });
      } catch (e) { return json(res, { ok: false, why: e.message }); }
    }
    // ---- the folders of the home screen ----
    if (req.method === 'POST' && pn === '/api/folder') {   // { ids, folder }: a name, '' = none, null = its channel's
      const b = await readBody(req);
      if (!Array.isArray(b.ids) || !b.ids.every((x) => normId(x))) return json(res, { ok: false, why: 'ids' }, 400);
      setFolder(b.ids.map(normId), b.folder === undefined ? null : b.folder); log(t('hubsrv.folder', { n: b.ids.length, folder: b.folder ?? '—' }));
      return json(res, { ok: true });
    }
    if (req.method === 'POST' && pn === '/api/folder/rename') {   // { from (null = none), to }
      const b = await readBody(req);
      const members = [...episodes(), ...projects()].filter((x) => (x.folder ?? null) === (b.from ?? null)).map((x) => ({ id: x.id, channel: x.folder === null ? null : x.channel ?? null }));
      renameFolder(b.from ?? null, b.to, members); log(t('hubsrv.folderRenamed', { from: b.from ?? '—', to: b.to }));
      return json(res, { ok: true, n: members.length });
    }
    // ---- « Chercher les .coulisses »: the whole PC, or one folder; then import what the user ticks ----
    if (req.method === 'POST' && pn === '/api/scan') {
      const b = await readBody(req);
      const roots = b.where === 'pc' ? drives() : b.path ? [path.resolve(String(b.path))] : [];
      if (!roots.length || !roots.every((r) => fs.existsSync(r))) return json(res, { ok: false, why: t('hubsrv.scanWhere') }, 400);
      // what the home screen lists already: its projects' .coulisses, and the theatre's own episodes
      const known = new Set(projects().map((x) => x.coulisses).filter(Boolean).map((f) => f.toLowerCase()));
      const epDir = O.episodesDir.toLowerCase();
      try {
        const st = startScan(roots, { skip: [STUDIO, CACHE, DATA], describe: (file, c) => {
          const f = file.toLowerCase(), inTheatre = f.startsWith(epDir + path.sep);
          if (c.moteur === 'brambleshire') return inTheatre ? { imported: true, episode: true } : { importable: false, episode: true };
          return { imported: known.has(f), importable: !c.errors?.length };
        } });
        log(t('hubsrv.scanStart', { roots: roots.join(', ') }));
        return json(res, { ok: true, ...st });
      } catch { return json(res, { ok: false, why: t('hubsrv.scanBusy') }); }
    }
    if (pn === '/api/scan') return json(res, scanState() ?? { state: 'idle' });
    if (req.method === 'POST' && pn === '/api/scan/stop') return json(res, { ok: stopScan() });
    if (req.method === 'POST' && pn === '/api/import/many') {   // { files: [.coulisses…], folder? }
      const b = await readBody(req), out = [];
      for (const f of Array.isArray(b.files) ? b.files.slice(0, 500) : []) {
        try { const p = importProject(String(f)); out.push({ file: f, ok: true, id: p.id }); } catch (e) { out.push({ file: f, ok: false, why: e.message }); }
      }
      if (b.folder) setFolder(out.filter((x) => x.ok && x.id?.startsWith('P')).map((x) => x.id), b.folder);
      log(t('hubsrv.importMany', { ok: out.filter((x) => x.ok).length, n: out.length }));
      return json(res, { ok: true, results: out });
    }
    if (pn === '/api/episodes') {
      const fix = (x) => (x.studio?.url ? { ...x, studio: { ...x.studio, url: publicUrl(req, x.studio.url) } } : x);
      const data = catalog(), body = JSON.stringify({installed:INSTALLED, episodesDir:O.episodesDir,
        episodes:data.episodes.map(fix),projects:data.projects.map(fix),remote:viaTailnet(req)});
      const tag = '"' + createHash('sha256').update(body).digest('hex').slice(0,24) + '"';
      res.setHeader('ETag',tag);
      if (req.headers['if-none-match'] === tag) { res.writeHead(304,{'Cache-Control':'no-cache'}); return res.end(); }
      return send(res,200,'application/json; charset=utf-8',body);
    }
    if (pn === '/api/browser-access' && req.method !== 'POST') return json(res, { ...(await browserAccessState(url.searchParams.has('fresh'))), here: viaTailnet(req) });
    if (pn === '/api/browser-access' && req.method === 'POST') {
      if (viaTailnet(req)) return json(res, { ok: false, why: 'from the PC only' }, 403);   // (opened or closed from the PC itself)
      const b = await readBody(req); await browserAccess(!!b.on);
      return json(res, { ok: true, ...(await browserAccessState(true)) });
    }
    if (pn.startsWith('/thumb/')) { const f = await thumb(normId(pn.slice(7)) ?? ''); if (!f) return send(res, 404, 'text/plain', 'no thumbnail'); res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=3600' }); return fs.createReadStream(f).pipe(res); }
    const go = /^\/go\/(E\d+|P[0-9a-f]{8})$/i.exec(pn);
    if (go) {
      const id = normId(go[1]);
      try { const u = await open(id); res.writeHead(302, { Location: publicUrl(req, u) }); return res.end(); }
      catch (e) { return send(res, 500, 'text/html; charset=utf-8', page(t('hubsrv.noStart', { id }), e.message)); }
    }
    if (pn === '/import') {   // a folder or a video dropped on the app's icon: import, then open it
      try { const r = doImport(url.searchParams.get('path') ?? ''); res.writeHead(302, { Location: r.video || r.episode || r.kind === 'remotion' || r.kind === 'hyperframes' ? `/go/${r.id}` : '/' }); return res.end(); }
      catch (e) { return send(res, 400, 'text/html; charset=utf-8', page(t('hubsrv.importFail'), e.message)); }
    }
    if (req.method === 'POST' && pn === '/api/import/pick' && viaTailnet(req)) return json(res, { ok: false, remote: true, why: t('hub.ipad.noPicker') });
    if (req.method === 'POST' && pn === '/api/import/pick') { const b = await readBody(req); const p = await pick(b.what); return json(res, p ? { ok: true, path: p } : { ok: false, cancelled: true }); }
    if (req.method === 'POST' && pn === '/api/import') {
      const b = await readBody(req);
      try { return json(res, { ok: true, project: doImport(b.path) }); } catch (e) { return json(res, { ok: false, why: e.message }); }
    }
    if (req.method === 'POST' && pn === '/api/remove') {
      if (!ep.startsWith('P')) return json(res, { ok: false, why: t('hubsrv.onlyProjects') }, 400);
      const st = studios.get(ep); if (st && st.proc.exitCode === null) await killTree(st.proc.pid);
      studios.delete(ep);
      const ok = removeProject(ep); log(t('hubsrv.removed', { ep }));
      return json(res, { ok });
    }
    if (req.method === 'POST' && pn === '/api/open') { if (!ep) return json(res, { ok: false, why: t('hubsrv.which') }, 400); return json(res, { ok: true, url: publicUrl(req, await open(ep)) }); }
    if (req.method === 'POST' && pn === '/api/pause') return json(res, { ok: await pause(ep) });
    if (req.method === 'POST' && pn === '/api/resume') { const st = studios.get(ep); if (!st) return json(res, { ok: false, why: t('hubsrv.noStudio', { ep }) }); return json(res, { ok: true, url: publicUrl(req, await open(ep)) }); }
    if (req.method === 'POST' && pn === '/api/quit') { json(res, { ok: true }); return setTimeout(quit, 100); }
    send(res, 404, 'text/plain', 'not found');
  } catch (e) { json(res, { ok: false, why: e.message }, 500); }
});
let port = +(opt('--port') ?? 0) || (INSTALLED ? HUB_PORT : 4171);
server.on('error', (e) => { if (e.code === 'EADDRINUSE' && port < LAST_HUB_PORT) { port++; server.listen(port, '127.0.0.1'); } else { log(t('hubsrv.listen', { msg: e.message })); process.exit(1); } });
server.on('listening', () => {
  hubUrl = `http://127.0.0.1:${port}/`;
  log(t('hubsrv.ready', { url: hubUrl, dir: O.episodesDir }));
  if (opt('--lock')) fs.writeFileSync(opt('--lock'), JSON.stringify({ pid: process.pid, port, url: hubUrl, studio: STUDIO }));
  console.log(`HUB_READY ${hubUrl}`);
  if (browserAccessWanted()) serveLogged(port);
  if (opt('--episode')) open(opt('--episode').toUpperCase()).catch(() => {});
  if (opt('--import')) { try { const r = doImport(opt('--import')); if (r.video || r.episode || r.kind === 'remotion' || r.kind === 'hyperframes') open(r.id).catch(() => {}); } catch (e) { log(t('hubsrv.importLog', { msg: e.message })); } }
});
server.listen(port, '127.0.0.1');

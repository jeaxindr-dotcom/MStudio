// Imported projects (« Importer un projet… » on the home screen, like DaVinci Resolve's Project Manager): besides the
// Brambleshire episodes, any video project can be reviewed. A project is
//   - an AItelier run (Desktop\Youtube\AItelier\long|short\<date>_<slug>\: run.json, 08-montage\plan-montage.json):
//     the video is the newest export in 07-renders\ (or the delivered one), the timeline shows the Resolve tracks of
//     the montage plan (chapters, V1 plans, V2 presenter, V3 overlays, A1 voice, A2 music, A3 sfx);
//   - any folder holding videos: its newest video;
//   - a single video file;
//   - a .coulisses file (lib/coulisses-file.mjs): a run of a Remotion pipeline, played live from its code before any
//     export (kind 'remotion'); its revue\ folder is the one the file names;
//   - a HyperFrames .coulisses file (moteur: hyperframes): its HTML composition played live (kind 'hyperframes');
//   - a « vidéo » .coulisses file (moteur: video): a run not yet in Remotion, reviewed on its export once there is one,
//     with its montage plan as timeline (kind 'run'). The file is read again each time: when the pipeline moves to
//     Remotion, the same project becomes a 'remotion' one, with the same notes.
// Its review files live IN the project, under revue\ (user choice), with revue\projet.json describing it: the server
// and studio-cli.mjs reach a project from that path alone. The list of imported projects (projets.json, PROJECTS_FILE)
// is only the home screen's index: removing a project from it deletes nothing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readJson, writeJson, nowIso, stamp, episode, pickVideo, readJsonStrict, updateJson } from './episode.mjs';
import { CACHE, PROJECTS_FILE } from './place.mjs';
import { MSTUDIO, assertReviewAvailable } from './app-profile.mjs';
import { readCoulisses, isCoulissesFile, EXT } from './coulisses-file.mjs';
import { normalizeTimeline } from './remotion-module.mjs';
import { t } from './i18n.mjs';
import { SPED } from './speed.mjs';   // a copy at another speed (« -x1.3.mp4 »): never the reviewed video

export const VIDEO = /\.(mp4|mov|m4v|mkv|webm)$/i;
const SKIP_VIDEO = /sans-audio|\.tmp\.|video-revue/i;   // silent copies, files being written, the studio's own copies
export const projectId = (revue) => 'P' + crypto.createHash('sha1').update(path.resolve(revue).toLowerCase()).digest('hex').slice(0, 8);
export const isProjectArg = (a) => !!a && !/^E\d+$/i.test(a) && (/[\\/:]/.test(a) || fs.existsSync(a));

// the title of an AItelier run: the first heading of its script (« # 02-script — Sonnet 5.5 contre Opus 5.5 : … »)
function aitelierTitle(root, run) {
  try {
    const h = /^#\s+(.+)$/m.exec(fs.readFileSync(path.join(root, '02-script.md'), 'utf8'))?.[1] ?? '';
    const t = h.replace(/^(script( fr)?|02-script)\s*[—–-]\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (t) return t;
  } catch { /* no script */ }
  const slug = run?.slug ?? path.basename(root).replace(/^\d{4}-\d{2}-\d{2}_/, '');
  return slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
const videosIn = (dir, depth = 0) => {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isFile() && VIDEO.test(e.name) && !SKIP_VIDEO.test(e.name)) out.push(f);
    else if (e.isDirectory() && depth > 0 && !/^(revue|node_modules|\.)/i.test(e.name)) out.push(...videosIn(f, depth - 1));
  }
  return out;
};

// what a path the user picked is: { kind, root, title, video, plan?, format? } (throws with a sentence for the user)
export function detect(input, { episodesDir, remotionDir } = {}) {
  const raw = String(input ?? '').trim().replace(/^"(.*)"$/, '$1');
  if (!raw) throw new Error(t('prj.give'));
  const abs = path.resolve(raw);
  if (!fs.existsSync(abs)) throw new Error(t('prj.notFound', { path: abs }));
  const st = fs.statSync(abs);
  if (st.isFile() && isCoulissesFile(abs)) {
    const c = readCoulisses(abs);
    if (c.errors.length) throw new Error(t('prj.incomplete', { ext: EXT, errors: c.errors.join(' ; ') }));
    if (c.moteur === 'brambleshire') {
      const defaultEngine = episodesDir ? path.join(path.dirname(path.resolve(episodesDir)), '06_Remotion') : null;
      if (samePath(episodesDir, c.native.episodesDir) && samePath(remotionDir ?? defaultEngine, c.native.remotionDir)) {
        return { kind: 'episode', episode: c.episode, title: c.title };
      }
      return { kind: 'brambleshire', root: c.dir, title: c.title, format: c.format, coulisses: c.file, revue: c.revue };
    }
    if (c.moteur === 'video') return { kind: 'run', root: c.dir, title: c.title, format: c.format, coulisses: abs, revue: c.revue };
    if (c.moteur === 'hyperframes') return { kind: 'hyperframes', root: c.dir, title: c.title, format: c.format, coulisses: abs, revue: c.revue };
    return { kind: 'remotion', root: c.dir, title: c.title, format: c.format, coulisses: abs, revue: c.revue };
  }
  if (st.isDirectory()) {   // a run folder with its .coulisses file: that file
    const own = fs.readdirSync(abs).filter((f) => isCoulissesFile(f));
    if (own.length === 1) return detect(path.join(abs, own[0]), { episodesDir, remotionDir });
  }
  if (st.isFile()) {
    if (!VIDEO.test(abs)) throw new Error(t('prj.pick'));
    return { kind: 'video', root: path.dirname(abs), title: path.basename(abs).replace(/\.[^.]+$/, ''), video: { file: path.basename(abs) } };
  }
  if (fs.existsSync(path.join(abs, 'projet.json'))) return { existing: abs };   // the revue folder of a project
  if (fs.existsSync(path.join(abs, 'revue', 'projet.json'))) return { existing: path.join(abs, 'revue') };
  if (registry().projects.some((entry) => entry.kind === 'brambleshire' && hasReview(entry, abs))) return { existing: abs };
  if (path.basename(abs).toLowerCase() === 'revue') {
    const parent = path.dirname(abs), sources = fs.readdirSync(parent).filter(isCoulissesFile);
    if (sources.length === 1) {
      const source = path.join(parent, sources[0]), c = readCoulisses(source);
      if (c.moteur === 'brambleshire' && samePath(c.revue, abs)) return detect(source, { episodesDir, remotionDir });
    }
  }
  if (/^E\d+ - /i.test(path.basename(abs)) && (episodesDir ? path.resolve(path.dirname(abs)).toLowerCase() === path.resolve(episodesDir).toLowerCase() : fs.existsSync(path.join(abs, 'revue', 'notes.json')))) {
    throw new Error(t('prj.episode'));
  }
  const run = readJson(path.join(abs, 'run.json'), null);
  if (run?.slug || fs.existsSync(path.join(abs, '08-montage', 'plan-montage.json'))) {
    return { kind: 'aitelier', root: abs, title: aitelierTitle(abs, run), format: run?.format ?? null, video: { auto: 'aitelier' }, plan: '08-montage/plan-montage.json' };
  }
  if (!videosIn(abs, 1).length) throw new Error(t('prj.noVideo'));
  return { kind: 'folder', root: abs, title: path.basename(abs), video: { auto: 'folder' } };
}

// where its review files go: <root>\revue\ (a second video of the same folder: revue-<name>\)
function revueFor(d) {
  const base = path.join(d.root, 'revue');
  // Windows accepts a pasted path with different letter case. Resolve the
  // spelling of this directory entry (also works for video-file symlinks).
  const names = process.platform === 'win32' && d.video.file ? fs.readdirSync(d.root) : null;
  const videoKey = (video) => {
    if (!names || !video?.file || names.includes(video.file)) return JSON.stringify(video);
    const actual = names.find((name) => name.toLowerCase() === video.file.toLowerCase());
    return JSON.stringify({ ...video, file: actual ?? video.file });
  };
  const identity = videoKey(d.video);
  const own = readJson(path.join(base, 'projet.json'), null);
  if (!fs.existsSync(base) || (own && videoKey(own.video) === identity)) return base;
  if (!own && !fs.readdirSync(base).length) return base;
  const name = (d.video.file ?? 'studio').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').slice(0, 40);
  const original = path.join(d.root, `revue-${name}`);
  const suffix = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 10);
  for (let i = 0; ; i++) {
    const candidate = i === 0 ? original : original + '-' + suffix + (i > 1 ? '-' + i : '');
    if (!fs.existsSync(candidate)) return candidate;
    const desc = readJson(path.join(candidate, 'projet.json'), null);
    if (desc && videoKey(desc.video) === identity) return candidate;
  }
}

export function importProject(input, opts = {}) {
  const d = detect(input, opts);
  if (d.kind === 'episode') return { id: d.episode, kind: 'episode', title: d.title, episode: true };   // nothing to import: it is listed
  if (d.kind === 'brambleshire') {
    assertReviewAvailable(d.revue);
    const entry = registry().projects.find((entry) => samePath(entry.coulisses, d.coulisses) || hasReview(entry, d.revue));
    const metadata = readJsonStrict(path.join(d.revue, 'projet.json'), null);
    if ((entry?.coulisses && !samePath(entry.coulisses, d.coulisses)) ||
        (metadata && !samePath(sourceOf(d.revue, metadata), d.coulisses))) {
      throw new Error('Ce dossier de revue appartient déjà à un autre projet.');
    }
    const p = nativeProject(readCoulisses(d.coulisses), entry?.id ?? projectId(d.revue));
    const saved = rememberProject(p, { register: true });
    return { id: saved.id, revue: p.REVUE, ...p.summary };
  }
  let revue = d.existing;
  if (!revue && (d.kind === 'remotion' || d.kind === 'run' || d.kind === 'hyperframes')) {   // the .coulisses file says where its review files go
    revue = d.revue;
    assertReviewAvailable(revue);
    fs.mkdirSync(revue, { recursive: true });
    const metadata = path.join(revue, 'projet.json');
    if (MSTUDIO && fs.existsSync(metadata)) {
      // Register the existing document without rewriting Coulisses' review
      // metadata. Multiple descriptors that share a review need distinct folders.
      const existing = readJsonStrict(metadata, null);
      if (!existing?.coulisses || path.resolve(revue, existing.coulisses).toLowerCase() !== path.resolve(d.coulisses).toLowerCase()) {
        throw new Error('Ce dossier de revue appartient déjà à un autre projet.');
      }
    } else {
      writeJson(metadata, { studio: 'Coulisses', kind: d.kind, title: d.title, root: path.relative(revue, d.root) || '.', coulisses: path.relative(revue, d.coulisses), format: d.format ?? null, imported: readJson(metadata, null)?.imported ?? nowIso() });
    }
  }
  if (!revue) {
    revue = revueFor(d);
    assertReviewAvailable(revue);
    fs.mkdirSync(revue, { recursive: true });
    const desc = { studio: 'Coulisses', kind: d.kind, title: d.title, root: path.relative(revue, d.root) || '.', video: d.video, plan: d.plan ?? null, format: d.format ?? null, imported: nowIso() };
    if (!fs.existsSync(path.join(revue, 'projet.json'))) writeJson(path.join(revue, 'projet.json'), desc);
  }
  assertReviewAvailable(revue);
  const p = project(revue);
  const entry = rememberProject(p, { register: true });
  return { id: entry.id, revue: p.REVUE, ...p.summary };
}
// the imported runs whose render a run shows as a media (their .coulisses says « utilise » this one): the 3D shots of a
// Short, each with the file it becomes in the Short — { id, title, coulisses, fichier }; cached a few seconds
const usedMemo = new Map();
export function shotsUsedIn(coulissesFile) {
  const key = path.resolve(coulissesFile).toLowerCase(), m = usedMemo.get(key);
  if (m && Date.now() - m.at < 8000) return m.v;
  const out = [];
  for (const x of registry().projects) {
    let p; try { p = project(x.revue); } catch { continue; }
    for (const u of p.uses ?? []) if (path.resolve(u.coulisses).toLowerCase() === key) out.push({ id: p.id, title: p.title, coulisses: p.coulisses, fichier: u.fichier });
  }
  usedMemo.set(key, { at: Date.now(), v: out });
  return out;
}
export const registry = () => { const r = readJson(PROJECTS_FILE, null) ?? {}; r.projects ??= []; return r; };
// Imports, the hub and agent CLI can all update this file. Lock the complete
// read/change/write, not only the rename, so none can erase another's folders.
function changeRegistry(fn) {
  fs.mkdirSync(path.dirname(PROJECTS_FILE), { recursive: true });
  return updateJson(PROJECTS_FILE, {}, (data) => { const r = data ?? {}; r.projects ??= []; fn(r); return r; });
}
const pathKey = (p) => p ? path.resolve(p).toLowerCase() : null;
const samePath = (a, b) => !!a && !!b && pathKey(a) === pathKey(b);
const hasReview = (entry, revue) => samePath(entry.revue, revue) || (entry.previousRevues ?? []).some((p) => samePath(p, revue));
const sourceOf = (revue, d) => d?.coulisses ? path.resolve(revue, d.coulisses) : null;
function registeredProject(reg, revue, d) {
  const source = sourceOf(revue, d);
  return reg.projects.find((entry) => hasReview(entry, revue))
    ?? reg.projects.find((entry) => samePath(entry.coulisses, source))
    // Opening/reimporting the new location first must also preserve a legacy
    // row's ID. Only the same bounded, unambiguous redirect can establish it.
    ?? (source ? reg.projects.find((entry) => !entry.coulisses
      && samePath(path.dirname(entry.revue), path.dirname(source))
      && !fs.existsSync(path.join(entry.revue, 'projet.json'))
      && samePath(relocatedReview(entry, reg)?.revue, revue)) : null);
}

// Keep only library metadata, not a backup of the project's code/notes. A
// disconnected drive or an archive must not lose its title, channel or folder.
export function rememberProject(p, { register = false } = {}) {
  const values = { revue: p.REVUE, title: p.title, channel: p.summary.channel, kind: p.kind,
    root: p.EP, format: p.summary.format, coulisses: p.coulisses ?? null,
    ...(p.kind === 'brambleshire' ? { episode: p.ep, theatre: p.theatre, episodesDir: p.episodesDir, remotionDir: p.remotionDir } : {}) };
  const current = registry();
  const before = current.projects.find((entry) => entry.id === p.id) ?? registeredProject(current, p.REVUE, p.project);
  if (!before && !register) return null;
  if (before && Object.entries(values).every(([key, value]) => before[key] === value)) return before;
  let saved;
  changeRegistry((reg) => {
    const entry = reg.projects.find((x) => x.id === p.id) ?? registeredProject(reg, p.REVUE, p.project);
    if (!entry && !register) return; // it was removed while the project was loading
    const targetOwner = reg.projects.find((x) => x !== entry && samePath(x.revue, p.REVUE));
    if (targetOwner) throw new Error('Ce dossier de revue appartient déjà à un autre projet de la bibliothèque.');
    saved = entry ?? { id: p.id, added: nowIso() };
    if (entry && !samePath(entry.revue, p.REVUE)) {
      saved.previousRevues = [...new Set([...(entry.previousRevues ?? []), entry.revue])];
    }
    Object.assign(saved, values);
    if (!entry) reg.projects.push(saved);
  });
  return saved ?? null;
}

// A descriptor can explicitly redirect its review after moving a project.
// For older indexes, inspect only the old review's immediate parent, never a
// disk-wide search. Ambiguous, invalid and incomplete archives stay missing.
function relocatedReview(entry, reg) {
  let sources = entry.coulisses ? [entry.coulisses] : [];
  if (!sources.length) {
    try { sources = fs.readdirSync(path.dirname(entry.revue), { withFileTypes: true })
      .filter((f) => f.isFile() && isCoulissesFile(f.name)).map((f) => path.join(path.dirname(entry.revue), f.name)); }
    catch { return null; }
  }
  const found = [];
  for (const file of sources) {
    const c = readCoulisses(file);
    if (c.errors.length || c.moteur === 'brambleshire' || samePath(c.revue, entry.revue)) continue;
    const d = readJson(path.join(c.revue, 'projet.json'), null);
    if (!d || !samePath(sourceOf(c.revue, d), c.file)) continue;
    if (reg.projects.some((other) => other.id !== entry.id && samePath(other.revue, c.revue))) continue;
    found.push({ revue: c.revue, d });
  }
  return found.length === 1 ? found[0] : null;
}
export function removeProject(id) {
  let removed = false;
  changeRegistry((reg) => {
    const n = reg.projects.length;
    reg.projects = reg.projects.filter((x) => x.id !== id);
    if (reg.folders) delete reg.folders[id];
    removed = n !== reg.projects.length;
  });
  return removed;
}
// ---------- the folders of the home screen (user request, 08/10/2026: « ranger les .coulisses par dossier ») ----------
// Every project and episode of the home screen sits in a folder: by default the channel it belongs to (« L'AItelier »,
// « 宇宙ちゃん »…), else none (« Sans dossier »). The user may move one (folders[id] = a name, or '' for none) and rename a
// folder (a channel's folder: aliases[channel], so that the channel's next projects go there too). In the list's file.
export function folderOf(id, channel, reg = registry()) {
  const own = reg.folders?.[id];
  if (own !== undefined) return own || null;
  channel ??= reg.projects?.find((entry) => entry.id === id)?.channel;
  return channel ? reg.aliases?.[channel] ?? channel : null;
}
// name: a folder; '' = no folder; null = back to its channel's folder
export function setFolder(ids, name) {
  changeRegistry((reg) => {
    reg.folders ??= {};
    for (const id of ids) { if (name === null || name === undefined) delete reg.folders[id]; else reg.folders[id] = String(name).trim().slice(0, 80); }
  });
}
// members: what the folder « from » shows now ({ id, channel }); from = null: « Sans dossier »
export function renameFolder(from, to, members) {
  to = String(to ?? '').trim().slice(0, 80); if (!to) return;
  changeRegistry((reg) => {
    reg.folders ??= {}; reg.aliases ??= {};
    for (const m of members) {
      const channel = m.channel ?? reg.projects.find((entry) => entry.id === m.id)?.channel;
      if (reg.folders[m.id] !== undefined || !channel) reg.folders[m.id] = to;   // moved by hand, or no channel
      else reg.aliases[channel] = to;                                          // the channel's folder: its next projects too
    }
  });
}
export function revueOf(id) {
  const entry = registry().projects.find((x) => x.id === id);
  if (!entry) return null;
  if (fs.existsSync(path.join(entry.revue, 'projet.json'))) return entry.revue;
  try { return project(entry.revue).REVUE; } catch { return entry.revue; }
}

// Native episodes keep their own engine contract and review files. The library
// ID is distinct from ep: two theatres may both contain an E19.
function nativeProject(c, id) {
  if (c.errors.length || c.moteur !== 'brambleshire') throw new Error(`${c.file} : ${c.errors.join(' ; ') || 'Le projet natif est introuvable.'}`);
  const candidates = fs.readdirSync(c.native.episodesDir, {withFileTypes:true})
    .filter(item => item.isDirectory() && item.name.toUpperCase().startsWith(c.episode + ' - '));
  if (candidates.length !== 1) throw new Error('Plusieurs dossiers correspondent à cet épisode : le projet natif est ambigu.');
  const p = episode(c.episode, c.native);
  if (!samePath(p.EP, c.dir) || !samePath(p.REVUE, c.revue)) throw new Error('Plusieurs dossiers correspondent à cet épisode : le projet natif est ambigu.');
  Object.assign(p, { id, coulisses: c.file, title: c.title, channel: c.channel, formatName: c.format });
  const video = pickVideo(p);
  p.summary = { kind: p.kind, channel: p.channel, title: p.title, root: p.EP, format: c.format, video: video ? stamp(video) : null, videoPath: video };
  return p;
}

// the paths of a project, the same shape as episode() for a Brambleshire episode (lib/episode.mjs)
export function project(arg) {
  let revue = path.resolve(String(arg).replace(/^"(.*)"$/, '$1'));
  if (!fs.existsSync(path.join(revue, 'projet.json')) && fs.existsSync(path.join(revue, 'revue', 'projet.json'))) revue = path.join(revue, 'revue');
  let d = readJson(path.join(revue, 'projet.json'), null);
  const reg = registry(), entry = registeredProject(reg, revue, d);
  if (entry?.kind === 'brambleshire') {
    const p = nativeProject(readCoulisses(entry.coulisses), entry.id);
    rememberProject(p);
    return p;
  }
  if (entry && !d && !fs.existsSync(path.join(revue, 'projet.json'))) {
    // A historical command may still use the old path after a successful relink.
    if (!samePath(entry.revue, revue)) {
      revue = entry.revue;
      d = readJson(path.join(revue, 'projet.json'), null);
    }
    if (!d) { const moved = relocatedReview(entry, reg); if (moved) ({ revue, d } = moved); }
  }
  if (!d) throw new Error(t('prj.none', { revue }));
  const root = path.resolve(revue, d.root ?? '..'), id = entry?.id ?? projectId(revue);
  const p = {
    ep: id, id, kind: d.kind, project: d, folder: path.basename(root), title: d.title, EP: root, REVUE: revue,
    NOTES: path.join(revue, 'notes.json'), REPLIES: path.join(revue, 'replies.json'), SNAP: path.join(revue, 'timeline.json'),
    IMAGES: path.join(revue, 'images'), LOTS: path.join(revue, 'lots'), RUNS: path.join(revue, 'runs'), AGENT: path.join(revue, 'studio-agent.json'),
    // the fast-scrub copy is a cache: outside the project
    PROXY: path.join(CACHE, 'proxies', `${id}.mp4`), PROXY_INFO: path.join(CACHE, 'proxies', `${id}.json`),
    theatre: null, episodesDir: null, remotionDir: null,
  };
  if (d.coulisses) {   // a run with its .coulisses file, read again each time: it may have moved to Remotion since
    const c = readCoulisses(path.resolve(revue, d.coulisses));
    if (c.errors.length) throw new Error(`${c.file} : ${c.errors.join(' ; ')}`);
    p.coulisses = c.file; p.title = c.title; p.exportRule = c.export; p.channel = c.channel; p.formatName = c.format; p.uses = c.uses ?? [];
    if (c.moteur === 'video') { p.kind = 'run'; p.plan = c.plan; }   // its export is the video, its plan (if any) the timeline
    else if (c.moteur === 'hyperframes') { p.kind = 'hyperframes'; p.hf = c.hyperframes; }   // its HTML composition is the preview (lib/hyperframes.mjs)
    else { p.kind = 'remotion'; p.remotion = c.remotion; p.remotionDir = c.remotion.projet; }   // its code is the preview
  }
  p.target = `"${revue}"`;   // how studio-cli.mjs is told which project (the lots' commands)
  p.pickVideo = () => pickProjectVideo(p);
  const v = p.pickVideo();
  p.summary = { kind: p.kind, channel: p.channel ?? null, title: p.title ?? d.title, root, format: p.formatName ?? d.format ?? null, video: v ? stamp(v) : null, videoPath: v };
  rememberProject(p);
  return p;
}

// the video under review: fixed (a single file), else the newest of the candidates — skipping a file written in the
// last 20 s (an export in progress) as long as an older one exists
function pickProjectVideo(p) {
  if (p.kind === 'remotion' || p.kind === 'run' || p.kind === 'hyperframes') {   // the export, once there is one (before: the code, or nothing yet)
    const R = p.exportRule ?? (p.kind === 'run' ? { dossiers: [p.EP], motif: VIDEO, profondeur: 0 } : null);
    if (!R) return null;
    // a sped-up copy of an export (« -x1.25.mp4 », lib/export-run.mjs) is a file to deliver, never the one under review:
    // its frames are not the code's, nor the notes'
    const c = (R.dossiers ?? [R.dossier]).flatMap((d) => videosIn(d, R.profondeur ?? 0)).filter((f) => R.motif.test(path.basename(f)) && !SPED.test(path.basename(f)));
    const withTime = c.map((f) => ({ f, t: fs.statSync(f).mtimeMs })).sort((a, b) => b.t - a.t);
    return withTime.filter((x) => Date.now() - x.t > 20000)[0]?.f ?? null;   // never a file still being written
  }
  const v = p.project.video ?? {};
  if (v.file) { const f = path.join(p.EP, v.file); return fs.existsSync(f) ? f : null; }
  let c = [];
  const notCopy = (f) => !SPED.test(path.basename(f));
  if (v.auto === 'aitelier') {
    c = videosIn(path.join(p.EP, '07-renders'));
    const m = /^(\d{2})(\d{2})-(\d{2})-(\d{2})_(.+)$/.exec(p.folder);   // the delivery folder: ..\<yymmdd>_<slug>\
    if (m) c.push(...videosIn(path.join(path.dirname(p.EP), `${m[2]}${m[3]}${m[4]}_${m[5]}`)));
  } else c = videosIn(p.EP, 1);
  const withTime = c.filter(notCopy).map((f) => ({ f, t: fs.statSync(f).mtimeMs })).sort((a, b) => b.t - a.t);
  const settled = withTime.filter((x) => Date.now() - x.t > 20000);
  return (settled[0] ?? withTime[0])?.f ?? null;
}

// the timeline of an AItelier run: the Resolve tracks of its montage plan (08-montage\plan-montage.json)
const NAME = (k) => t(`prj.${k}`);   // V1 plans, V2 présentateur, V3 calques, A1 voix, A2 musique, A3 bruitages (lib/i18n-*.mjs)
// (a « vidéo » run: the plan its .coulisses names — the same AItelier format, or the Coulisses timeline format in frames)
export function tracksOf(p) {
  const file = p.kind === 'aitelier' ? path.join(p.EP, p.project.plan ?? '08-montage/plan-montage.json') : p.kind === 'run' ? p.plan : null;
  if (!file) return null;
  const plan = readJson(file, null);
  if (!plan) return null;
  if (Array.isArray(plan.pistes)) {   // { fps, durationInFrames, pistes: [{ id, nom, type, clips: [{ de, a, label, … }] }] }
    const tk = normalizeTimeline(plan, plan.fps ?? 30);
    return { fps: tk.fps, frames: tk.frames, file, mtime: fs.statSync(file).mtime.toISOString(), tracks: tk.tracks };
  }
  const fps = plan.fps ?? 30, T = (f) => +(f / fps).toFixed(4), end = plan.total_images ?? 0;
  const tracks = [];
  if (plan.chapitres?.length) {
    tracks.push({ id: 'chap', name: t('prj.chapters'), type: 'band', clips: plan.chapitres.map((c, i, a) => ({ t0: T(c.record_debut ?? 0), t1: T(a[i + 1]?.record_debut ?? end), label: c.chapitre })) });
  }
  for (const k of ['V1', 'V2', 'V3', 'A1', 'A2', 'A3']) {
    const arr = plan[k]; if (!Array.isArray(arr) || !arr.length) continue;
    tracks.push({ id: k, name: NAME(k), type: k[0] === 'A' ? 'audio' : 'video', clips: arr.map((c) => ({
      t0: T(c.record ?? 0), t1: T((c.record ?? 0) + (c.images ?? 0)), from: c.debut_media ?? 0, file: c.fichier ?? null,
      label: c.role ?? (c.fichier ? path.basename(c.fichier) : k), off: c.desactiver === true,
    })) });
  }
  return { fps, frames: end, file, mtime: fs.statSync(file).mtime.toISOString(), tracks };
}

// studio-cli.mjs / studio-server.mjs: E03 = a Brambleshire episode; a path = an imported project
export const resolveTarget = (arg, o) => (isProjectArg(arg) ? project(arg) : episode(arg, o));

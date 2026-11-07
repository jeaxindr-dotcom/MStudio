// A batch (« lot ») = the pending edits the user sends to Claude in one go (HyperFrames' « Pending video edits »; as many
// as the user wants since 09/10/2026, no longer 10 at most). Written by the studio server when the user clicks « Envoyer à Claude », published before its captures, then enriched as each image is ready:
//   revue/lots/NNN.json   the data (notes as they were sent, marks, 3D picks, image paths)
//   revue/lots/NNN.md     the same as a request Claude reads (what, where, when, images), with every path absolute
//   revue/lots/NNN/       the images of each edit: k-image.jpg (the frame), k-marque.jpg (with the drawing / pin),
//                         k-zoom.jpg (crop around the mark), k-fin.jpg (last frame of a range)
// Claude's progress on a batch goes to replies.json › lots (studio-cli.mjs take / done), never here.
import fs from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pad3, readJson, writeJson, nowIso, fmtTime, writeText, readJsonStrict, stamp, pickVideo } from './episode.mjs';
import { prepareCaptures, captureLot } from './lot-captures.mjs';
import { claimCaptureWorkspace, releaseCaptureWorkspace, sweepCaptureWorkspaces } from './lot-capture-workspace.mjs';
import { markWords, targetWords } from './describe.mjs';
import { readCoulisses } from './coulisses-file.mjs';
import { renderState } from './render.mjs';
import { speedOf } from './speed.mjs';
import { updatesMarkdown, updatesLine, updatesOk } from './updates.mjs';
import { t, lang, tr, dateTime, agentDocName } from './i18n.mjs';
const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// the most edits in one batch: 0 = no limit (user request, 09/10/2026: « je veux pouvoir mettre autant de notes que je veux »)
export const MAX_EDITS = 0;
export const CLI = path.join(STUDIO, 'studio-cli.mjs');
// the agent's protocol in the user's language (AGENT.md, or AGENT.en.md in English)
export const agentDoc = (l = lang()) => path.join(STUDIO, agentDocName(l));

export function lotNumbers(p) {
  if (!fs.existsSync(p.LOTS)) return [];
  return fs.readdirSync(p.LOTS).map((f) => /^(\d{3})\.json$/.exec(f)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
}
export const lotFile = (p, n, ext = 'json') => path.join(p.LOTS, `${pad3(n)}.${ext}`);
export const readLot = (p, n) => readJson(lotFile(p, n), null);

const who = (p) => (p.kind === 'brambleshire' ? `Coulisses · ${p.ep}` : `Coulisses · ${p.title}`);
// the lines the user pastes in the agent's session: the same structure in both languages
// (« Coulisses · E03 · lot 3 (4 modifs) → lis "…" et corrige » / « Coulisses · E03 · batch 3 (4 edits) → read "…" and fix »)
export const pasteLine = (p, lot, count, l = lang()) =>
  t('lot.paste', { who: who(p), lot, n: count, md: lotFile(p, lot, 'md'), doc: agentDoc(l) }, l);
export const renderLine = (p, lot, l = lang()) =>
  t('lot.renderLine', { ep: p.ep, lot, md: lotFile(p, lot, 'md'), doc: agentDoc(l) }, l);
export const connectLine = (p, l = lang()) =>
  t('lot.connect', { who: who(p), doc: agentDoc(l), cli: CLI, target: p.target }, l);

// a batch set aside (a copy of another one that nobody took): out of revue/lots, kept in revue/lots-annules
function setAside(p, n) {
  const to = path.join(path.dirname(p.LOTS), 'lots-annules', `${pad3(n)}-${Date.now().toString(36)}`);
  fs.mkdirSync(to, { recursive: true });
  for (const f of [lotFile(p, n), lotFile(p, n, 'md'), path.join(p.LOTS, pad3(n))]) if (fs.existsSync(f)) fs.renameSync(f, path.join(to, path.basename(f)));
}

// body = { ids: [note ids in queue order], words: text typed under the queue, marks: { <id>: PNG data URL of the marks } }
export async function createLot(p, body, { fps = 30, size = [1920, 1080], log = () => {}, updates = null, agent = null, deferred = false, updatesPending = false } = {}) {
  const notes = readJson(p.NOTES, { notes: [] }).notes ?? [];
  const ids = [...new Set(body.ids ?? [])];
  if (!ids.length) throw new Error(t('lot.err.none'));
  if (MAX_EDITS && ids.length > MAX_EDITS) throw new Error(t('lot.err.max', { max: MAX_EDITS }));
  const items = ids.map((id) => notes.find((n) => n.id === id));
  if (items.some((n) => !n)) throw new Error(t('lot.err.gone'));
  // the same notes sent again (user bug 17/10/2026, E11: the batch was written, then its request failed — « Envoi
  // impossible » — the agent took it anyway, and the page kept the notes as drafts): the answer to that send was lost, so
  // it is that batch again, its images made again; the other copies of it that nobody took are set aside
  const idKey = (xs) => JSON.stringify([...xs].sort()), rep = readJsonStrict(p.REPLIES, { notes: {} }), taken = (L) => !!rep.lots?.[L.lot];
  // … but only while its notes are as they were sent: « Renvoyer » on a note the agent already did changes it (n.updated)
  // — a new request, a new batch (code review 18/10/2026: it was answered « déjà traitée, rien de renvoyé »); the same
  // notes untouched since are still that lost send (done meanwhile: said so)
  const latest = (n) => Math.max(Date.parse(n.updated ?? n.created ?? 0) || 0, ...(n.thread ?? []).map((m) => Date.parse(m.at ?? 0) || 0));
  const untouched = (L) => items.every((n) => latest(n) <= Date.parse(L.sentAt ?? 0) + 2000);   // (sentAt is to the second)
  const same = lotNumbers(p).map((m) => { const L = readLot(p, m); return L ? { ...L, lot: m } : null; }).filter((L) => L && L.kind !== 'render' && Array.isArray(L.edits) && Date.now() - Date.parse(L.sentAt ?? 0) < 48 * 3600e3 && idKey(L.edits.map((e) => e.id)) === idKey(ids) && untouched(L));
  const again = same.find(taken) ?? same[0] ?? null;
  for (const L of same) if (L !== again && !taken(L)) { setAside(p, L.lot); log(t('lot.log.aside', { lot: L.lot, again: again.lot })); }
  const lot = again ? again.lot : (lotNumbers(p).at(-1) ?? 0) + 1, dir = path.join(p.LOTS, pad3(lot));
  const response = { lot, count: items.length, md: lotFile(p, lot, 'md'), line: pasteLine(p, lot, items.length),
    again: again ? rep.lots?.[lot]?.status ?? 'open' : false };
  const digest = createHash('sha256').update(JSON.stringify([items, body.words, body.marks, size, fps])).digest('hex');
  if (again?.captureState?.status !== 'error' && again?.captureState?.request === digest) {
    if (again.captureState.status === 'pending' && !deferred) await queueCaptures(p, again, log);
    return response;
  }
  const id = randomUUID(), output = again ? path.join(dir, id) : dir;
  fs.mkdirSync(output, {recursive: true});
  const video = pickVideo(p), render = video ? stamp(video) : null;
  const edits = [];
  for (const [k0, n] of items.entries()) {
    const k = k0 + 1, source = n.source === 'code' && (p.kind === 'brambleshire' || p.kind === 'remotion' || p.kind === 'hyperframes') ? 'code' : 'video';
    // a grade of the « Étalonnage » page: its exact SVG filter, as a file of the lot (k-etalonnage.svg)
    let grade = null;
    if (n.grade && typeof n.grade === 'object') {
      const { svg, ...g } = n.grade, svgFile = path.join(output, `${k}-etalonnage.svg`);
      try { fs.writeFileSync(svgFile, String(svg ?? '')); grade = { ...g, svgFile }; } catch { grade = { ...g, svgFile: null }; }
    }
    edits.push({
      k, id: n.id, frame: n.frame, end: n.end ?? null, time: +(n.frame / fps).toFixed(3), endTime: n.end != null ? +((n.end + 1) / fps).toFixed(3) : null,
      text: n.text ?? '', thread: n.thread ?? [], context: n.context ?? null, mark: n.mark ?? null, target: n.target ?? null,
      source, kind: n.kind ?? null, placedOn: n.render ?? null, staleRender: !!(n.render && render && n.render.size !== render.size),
      images: (n.images ?? []).map((im) => ({ file: path.join(p.REVUE, im.file), label: im.label ?? null })), captures: {}, stage: n.stage ?? null,
      // an image of the library placed here (« Médias » tab): its copy in revue/images, and what the library knows of it
      media: n.media ? { ...n.media, file: n.media.file ? path.join(p.REVUE, n.media.file) : null } : null,
      grade,
    });
  }
  const data = { lot, episode: p.ep, kind: p.kind, title: p.title, sentAt: nowIso(), words: (body.words ?? '').trim(), fps, size,
    language: lang(), captureState: {id, request: digest, status: 'pending', done: 0, total: edits.length},
    ...(updatesPending ? {updatesPending: true} : {}),
    render, remotionDir: p.remotionDir, project: p.kind === 'brambleshire' ? null : p.EP, agent, updates, edits,
    ...(again ? { firstSent: again.firstSent ?? again.sentAt, resent: true } : {}) };
  try { await prepareCaptures(p, data, body.marks); }
  catch (err) { data.captureState.status = 'error'; data.captureState.error = String(err.message); }
  publishLot(p, data);
  log(t('lot.log.sent', { lot, n: edits.length, md: response.md }));
  if (data.captureState.status === 'pending') {
    const images = queueCaptures(p, data, log);
    if (!deferred) await images;
  }
  return response;
}

function publishLot(p, lot) {
  writeText(lotFile(p, lot.lot, 'md'), lotMarkdown(p, lot, lot.language));
  writeJson(lotFile(p, lot.lot), lot);
}

// Un renvoi peut arriver pendant un rendu. Chaque génération possède ses fichiers.
let captureQueue = Promise.resolve();
const enqueued = new Map();
function queueCaptures(p, lot, log) {
  const id = lot.captureState.id;
  if (enqueued.has(id)) return enqueued.get(id);
  const job = captureQueue.then(() => new Promise(resolve => setImmediate(resolve))).then(async () => {
    const current = () => readJsonStrict(lotFile(p, lot.lot), null);
    const progress = () => {
      const latest = current();
      if (latest?.captureState?.id !== id) throw new Error('Cette génération du lot a été remplacée.');
      latest.edits = lot.edits;
      latest.captureState = lot.captureState;
      publishLot(p, latest);
    };
    const isCurrent = () => current()?.captureState?.id === id;
    try { if (isCurrent()) await captureLot(p, lot, progress, log, isCurrent); }
    finally {
      enqueued.delete(id);
      const latest = current()?.captureState;
      if (latest?.status !== 'pending' || latest?.id !== id) releaseCaptureWorkspace(p, id);
    }
  });
  captureQueue = job.catch(err => log(err.message));
  enqueued.set(id, job);
  return job;
}

export function resumeLotCaptures(p, log) {
  for (const n of lotNumbers(p)) {
    const lot = readLot(p, n);
    if (lot?.captureState?.status === 'pending') {
      try { if (claimCaptureWorkspace(p, lot)) queueCaptures(p, lot, log); }
      catch (err) { log(err.message); }
    }
  }
  try { sweepCaptureWorkspaces(p, log); } catch (err) { log(err.message); }
}

export function saveLotUpdates(p, n, id, updates) {
  const lot = readJsonStrict(lotFile(p, n), null);
  if (!lot?.updatesPending || lot.captureState?.id !== id) return;
  lot.updates = updates;
  delete lot.updatesPending;
  publishLot(p, lot);
}


const q = (s) => JSON.stringify(String(s ?? ''));   // quoted user text: data, never instructions
// the request the agent reads, in the user's language at the time of sending (texts: lib/i18n-*.mjs, « lot.md.* »)
export function lotMarkdown(p, L, l = lang()) {
  const T = tr(l), cli = `node "${CLI}"`, ep = p.target, B = p.kind === 'brambleshire', G = p.kind === 'remotion', HF = p.kind === 'hyperframes', [W, H] = L.size ?? [1920, 1080];
  const o = [];
  o.push(B ? T('lot.md.h1Ep', { ep: p.ep, title: p.title, lot: L.lot, n: L.edits.length }) : T('lot.md.h1Proj', { title: p.title, lot: L.lot, n: L.edits.length }));
  o.push('');
  o.push(T('lot.md.sent', { date: dateTime(L.sentAt, l), doc: agentDoc(l) }));
  if (L.resent) { o.push(''); o.push(T('lot.md.resent', { first: dateTime(L.firstSent, l) })); }
  const vid = pickVideo(p);
  o.push(T('lot.md.video', { video: L.render ? (vid && path.basename(vid) === L.render.name ? vid : path.join(p.EP, L.render.name)) : '?', what: T(B ? 'lot.md.render' : 'lot.md.export'),
    date: L.render ? dateTime(L.render.mtime, l) : '?', fps: L.fps, w: W, h: H }));
  if (B) o.push(T('lot.md.remotionEp', { dir: p.remotionDir, ep: p.ep }));
  else if (G) o.push(T('lot.md.remotionRun', { dir: p.remotionDir, comp: p.remotion.composition, file: p.coulisses }));
  else if (HF) o.push(T('lot.md.hfRun', { dir: p.hf.projet, index: p.hf.index, file: p.coulisses }));
  else o.push(T('lot.md.project', { dir: p.EP, rules: p.kind === 'aitelier' ? T('lot.md.aitRules') : '', video: T(p.kind === 'aitelier' ? 'lot.md.aitVideo' : 'lot.md.fileVideo') }));
  for (const [i, u] of (G ? p.uses ?? [] : []).entries()) {   // a 3D shot shown inside another run (a Short): its render must go there again
    let host = null; try { host = readCoulisses(u.coulisses); } catch { /* moved */ }
    const target = host?.remotion?.projet ? path.join(host.remotion.projet, ...u.fichier.split('/')) : u.fichier;
    // the same render as the studio's « Rendre ce plan » button (lib/shot-render-run.mjs): the clip's format, the old one kept
    const cmd = `node "${path.join(STUDIO, 'lib', 'shot-render-run.mjs')}" "${p.REVUE}" ${i}`;
    o.push(T('lot.md.usedIn', { title: host?.title ?? path.basename(u.coulisses), file: target, comp: p.remotion.composition, coulisses: u.coulisses, cmd }));
  }
  o.push('');
  o.push(T('lot.md.data'));
  if (L.words) { o.push(''); o.push(T('lot.md.words', { words: q(L.words) })); }
  if (L.updatesPending) o.push('', T('upd.line.pending'));
  if (L.captureState?.status === 'pending') o.push('', T('lot.md.imagesPending', {cmd: cli + ' images ' + ep + ' ' + L.lot}));
  if (L.captureState?.status === 'error') o.push('', T('lot.md.imagesFailed', {detail: L.captureState.error ?? ''}));
  if (L.updates) { o.push(''); o.push(...updatesMarkdown(L.updates, { cli, target: ep, l })); }
  o.push('');
  o.push(T('lot.md.todo'));
  o.push(T('lot.md.take', { cli, ep, lot: L.lot }));
  o.push(T('lot.md.snapshot', { cli, ep, lot: L.lot, rel: T(B ? 'lot.md.relRemotion' : 'lot.md.relProject') }));
  if (B || G || HF) {
    o.push(T('lot.md.fixCode', { cli, ep }));
    o.push(T('lot.md.replyCode', { cli, ep }));
    o.push(T('lot.md.doneCode', { cli, ep, lot: L.lot, extra: G || HF ? T('lot.md.doneCodeRun') : '' }));
  } else {
    o.push(T('lot.md.fixVideo', { cli, ep, extra: p.kind === 'aitelier' ? T('lot.md.fixVideoAit') : '' }));
    o.push(T('lot.md.replyVideo', { cli, ep }));
    o.push(T('lot.md.doneVideo', { cli, ep, lot: L.lot, rule: T(p.kind === 'aitelier' ? 'lot.md.ruleAit' : 'lot.md.ruleVideo') }));
  }
  for (const e of L.edits) {
    o.push('');
    const when = e.end !== null ? T('lot.md.whenRange', { a: e.frame, b: e.end, ta: fmtTime(e.time), tb: fmtTime(e.endTime), n: e.end - e.frame + 1 }) : T('lot.md.whenAt', { a: e.frame, ta: fmtTime(e.time) });
    if (e.kind === 'prompt') {   // a request of the Agent tab: not an edit of one frame (a project built live)
      o.push(T('lot.md.promptEdit', { k: e.k, id: e.id, when }));
      o.push(T('lot.md.promptAsk', { text: q(e.text || T('lot.md.noText')) }));
      const g = p.remotionDir ? ['CLAUDE.md', 'AGENTS.md'].map((x) => path.join(p.remotionDir, x)).find((x) => fs.existsSync(x)) : null;
      if (g) o.push(T('lot.md.promptGuide', { file: g }));
      o.push(T('lot.md.promptHow'));
    } else {
      o.push(T('lot.md.edit', { k: e.k, id: e.id, when }));
      o.push(T('lot.md.ask', { text: q(e.text || T('lot.md.noText')) }));
    }
    for (const m of e.thread ?? []) {
      o.push(T('lot.md.then', { text: q(m.text) }));
      for (const im of m.images ?? []) {
        const file = typeof im === 'string' ? im : im?.file;
        if (file) o.push(T('lot.md.attached', { label: '', file: path.resolve(p.REVUE, file) }));
      }
    }
    if (e.context?.scene) o.push(T('lot.md.scene', { scene: q(e.context.scene) }));
    if (e.context?.lines?.length) o.push(T('lot.md.lines', { lines: e.context.lines.map(q).join(' · ') }));
    if (e.context?.clips?.length) { o.push(T('lot.md.clips')); for (const c of e.context.clips) o.push(`  - ${c}`); }
    const mw = markWords(e.mark, W, H, l); if (mw) o.push(T('lot.md.gesture', { words: mw }));
    const tw = targetWords(e.target, l); if (tw) o.push(T('lot.md.target', { words: tw }));
    if (B || G || HF) o.push(T('lot.md.view', { view: T(e.source === 'code' ? 'lot.md.viewCode' : 'lot.md.viewVideo') }));
    if (e.end !== null) o.push(T('lot.md.range'));
    if (e.staleRender) o.push(T('lot.md.stale', { what: T(B ? 'lot.md.staleRender' : 'lot.md.staleExport') }));
    const c = e.captures;
    if (c.error) o.push(`- ${c.error}`);
    if (c.image) o.push(T('lot.md.image', { file: c.image }));
    if (c.marque) o.push(T('lot.md.marked', { file: c.marque }));
    if (c.zoom && c.zoomRect) o.push(T('lot.md.zoom', { file: c.zoom, x: c.zoomRect.x, y: c.zoomRect.y, w: c.zoomRect.width, h: c.zoomRect.height }));
    if (c.fin) o.push(T('lot.md.last', { file: c.fin }));
    if (e.stage?.cutout && e.stage.dim === '2d') {   // an image of the library laid on the picture by the user (« Médias »)
      const s = e.stage, c = s.cutout.final, [sw, sh] = s.size ?? [W, H], r0 = (v) => Math.round(v);
      o.push(T('lot.md.cutout2d', { name: q(s.cutout.name) }));
      o.push(T('lot.md.cutout2dAt', { W: sw, H: sh, x: r0(c.x), y: r0(c.y), w: r0(c.w), h: r0(c.h), r: (c.r * 180 / Math.PI).toFixed(1) }));
      o.push(T('lot.md.stageScope', { label: s.scope.label, from: s.scope.from, to: s.scope.to }));
      o.push(T('lot.md.cutout2dHow'));
    } else if (e.stage?.cutout) {   // an image of the library stood in the 3D scene by the user, as cardboard (« Médias »)
      const s = e.stage, c = s.cutout.final, f3 = (v) => (+v).toFixed(3), deg = (r) => (r * 180 / Math.PI).toFixed(1);
      o.push(T('lot.md.cutout', { name: q(s.cutout.name) }));
      o.push(T(B || s.cutout.theatre ? 'lot.md.cutoutAt' : 'lot.md.cutoutAtRun', { x: f3(c.p[0]), y: f3(c.p[1]), z: f3(c.p[2]), rx: deg(c.r[0]), ry: deg(c.r[1]), rz: deg(c.r[2]), h: f3(c.h), w: f3(c.w), t: f3(c.t) }));
      o.push(T('lot.md.stageScope', { label: s.scope.label, from: s.scope.from, to: s.scope.to }));
      o.push(T('lot.md.cutoutHow'));
    } else if (e.stage?.dim === '2d') {   // a run's 2D staging (player/stage2d.ts): pixels of the frame, as seen
      const s = e.stage, d = s.delta, px = (v) => (v >= 0 ? '+' : '') + Math.round(v), deg = (r) => (r * 180 / Math.PI).toFixed(1), [sw, sh] = s.size ?? [W, H];
      o.push(T(s.id === '@camera' ? 'lot.md.stage2dCam' : 'lot.md.stage2d', { id: s.id, name: s.name, kind: s.kind ?? '' }));
      o.push(T(s.id === '@camera' ? 'lot.md.stage2dCamDelta' : 'lot.md.stage2dDelta', { x: px(d.p[0]), y: px(d.p[1]), r: deg(d.r[2]), s: (+d.s).toFixed(3), w: sw, h: sh }));
      if (s.base && s.id !== '@camera') o.push(T('lot.md.stage2dBase', { frame: s.frame, x: Math.round(s.base[0]), y: Math.round(s.base[1]), w: Math.round(s.base[2]), h: Math.round(s.base[3]) }));
      o.push(T('lot.md.stageScope', { label: s.scope.label, from: s.scope.from, to: s.scope.to }));
      o.push(T(s.id === '@camera' ? 'lot.md.stage2dCamHow' : 'lot.md.stage2dHow'));
    } else if (e.stage) {
      const s = e.stage, f3 = (v) => (+v).toFixed(3), d = s.delta, deg = (r) => (r * 180 / Math.PI).toFixed(1);
      o.push(T('lot.md.stage', { id: s.id, name: s.name, kind: s.kind ?? '' }));
      o.push(T(B ? 'lot.md.stageDelta' : 'lot.md.stageDeltaRun', { x: f3(d.p[0]), y: f3(d.p[1]), z: f3(d.p[2]), rx: deg(d.r[0]), ry: deg(d.r[1]), rz: deg(d.r[2]), s: (+d.s).toFixed(3) }));
      if (s.base) o.push(T('lot.md.stageBase', { frame: s.frame, p: s.base.p.map(f3).join(', '), r: s.base.r.map(deg).join('°, '), s: (+s.base.s).toFixed(3) }));
      o.push(T('lot.md.stageScope', { label: s.scope.label, from: s.scope.from, to: s.scope.to }));
      o.push(T('lot.md.stageHow'));
    }
    if (e.grade) {   // a grade of the « Étalonnage » page (page/studio/11-grade.js): the filter as a file, the values as data
      const g = e.grade, E = g.eff ?? {}, r3 = (v) => Math.round(+v * 1000) / 1000;
      const wh = (w) => (w ? { rgb: (w.rgb ?? []).map(r3), master: r3(w.m ?? 0) } : null);
      const values = { exposure: r3(E.exposure ?? 0), temperature: r3(E.temperature ?? 0), tint: r3(E.tint ?? 0), lift: wh(E.lift), gamma: wh(E.gamma), gain: wh(E.gain), offset: wh(E.offset),
        contrast: r3(E.contrast ?? 1), pivot: r3(E.pivot ?? 0.435), saturation: r3(E.saturation ?? 1), shadows: E.sh ? { hue: Math.round(E.sh.h), amount: r3(E.sh.s) } : null,
        highlights: E.hi ? { hue: Math.round(E.hi.h), amount: r3(E.hi.s) } : null, glow: r3(E.halo ?? 0), vignette: r3(E.vignette ?? 0), grain: r3(E.grain ?? 0),
        // the bars of DaVinci's Primaries (09/10/2026): tone curves, the masters' share on the luma, hue, vibrance, local contrast
        toneShadows: r3(E.shadows ?? 0), toneHighlights: r3(E.highlights ?? 0), lumMix: r3(E.lumMix ?? 1), hueDegrees: r3((E.hue ?? 0) * 180), colorBoost: r3(E.boost ?? 0), midDetail: r3(E.midDetail ?? 0) };
      // the curves (Y on R, G, B together, then R, G, B; monotone cubic through the points, each at its intensity), when changed
      const C = E.curves, flat = (p) => !p || (p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 1 && p[1][1] === 1);
      if (C && ['y', 'r', 'g', 'b'].some((k) => !flat(C[k]))) values.curves = Object.fromEntries(['y', 'r', 'g', 'b'].map((k) => [k, { points: (C[k] ?? []).map((p) => p.map(r3)), intensity: r3(C['i' + k] ?? 1) }]));
      o.push(T('lot.md.grade', { scene: q(g.scene), from: g.from, to: g.to,
        look: g.lookName ? T(g.own === false ? 'lot.md.gradeLookOnly' : 'lot.md.gradeLook', { name: q(g.lookName), emo: g.emotion ?? '', pct: Math.round((g.amount ?? 1) * 100) }) : T('lot.md.gradeNoLook') }));
      if (g.svgFile) o.push(T('lot.md.gradeFilter', { file: g.svgFile, id: g.filterId, W: g.size?.[0] ?? W, H: g.size?.[1] ?? H }));
      if (g.vignette) o.push(T('lot.md.gradeVignette', { css: g.vignette }));
      if (g.grain) o.push(T('lot.md.gradeGrain', { o: (Math.min(0.5, g.grain * 0.45)).toFixed(2) }));
      o.push(T('lot.md.gradeValues', { json: JSON.stringify(values) }));
      o.push(T('lot.md.gradeHow', { id: g.filterId }));
      if (B) o.push(T('lot.md.gradeHowTheatre'));
    }
    for (const im of e.images) o.push(T('lot.md.attached', { label: im.label ? ` (${im.label})` : '', file: im.file }));
    if (e.media) {
      const m = e.media;
      o.push(T('lot.md.media', { name: q(m.nom), cat: m.categorie ?? '?', alpha: m.transparent ? T('lot.md.mediaAlpha') : '', size: m.largeur ? `, ${m.largeur} × ${m.hauteur} px` : '',
        file: m.file ?? m.bibliotheque, lib: m.bibliotheque ?? '?', channel: m.chaine ?? '?' }));
      if (m.description) o.push(T('lot.md.mediaDesc', { desc: q(m.description) }));
      o.push(T(B ? 'lot.md.mediaTheatre' : 'lot.md.mediaHow'));
    }
  }
  o.push('');
  return o.join('\n');
}

// « Lancer le rendu » in the studio: a batch of kind 'render' (no edits), delivered to Claude like the others (pasted
// line or `wait`). It lists what was corrected since the video being reviewed, so Claude knows what the render carries.
const ENGINE = /^(src\/(engine|cardboard)\/|.*Episode\.tsx$)/;   // a change here: the three non-regression tests first
export function createRenderLot(p, body = {}, { updates = null, agent = null } = {}) {
  if (p.kind !== 'brambleshire') throw new Error(t('lot.err.noRender'));
  const r = readJson(p.REPLIES, { notes: {} }); r.lots ??= {};
  const run = renderState(p);
  if (run?.state === 'running') throw new Error(t('lot.err.renderRunning'));
  for (const n of lotNumbers(p)) {
    const L = readLot(p, n);
    if (L?.kind !== 'render') continue;
    if (!r.lots[n]) throw new Error(t('lot.err.renderWaiting', { n }));
    // taken: refused while Claude prepares or runs it; a run that ended badly (stopped, failed, interrupted) frees it
    const ended = run && Date.parse(run.startedAt) >= Date.parse(L.sentAt) && ['blocked', 'failed', 'interrupted', 'cancelled'].includes(run.state);
    if (r.lots[n].status === 'taken' && !ended) throw new Error(t('lot.err.renderTaken', { n }));
  }
  const video = pickVideo(p), render = video ? stamp(video) : null;
  const since = lotNumbers(p).map((n) => readLot(p, n)).filter((L) => L && L.kind !== 'render' && L.render?.size === render?.size)
    .map((L) => ({ lot: L.lot, edits: L.edits.length, status: r.lots[L.lot]?.status ?? null, message: r.lots[L.lot]?.message ?? '', files: r.lots[L.lot]?.files ?? [] }));
  const engine = [...new Set(since.flatMap((x) => x.files))].filter((f) => ENGINE.test(f.split('\\').join('/')));
  const lot = (lotNumbers(p).at(-1) ?? 0) + 1;
  // the speed of the dial (« Envois »): at another one, the render makes its copy at the end (lib/render.mjs)
  const vitesse = speedOf(body.vitesse ?? 1);
  if (vitesse === null) throw new Error(t('exp.speed', { v: body.vitesse }));
  // the quality chosen in « Envois » (1080p | 4K, the same choice in every project): 4K = 3840×2160 (lib/render.mjs)
  const qualite = body.qualite === '4k' ? '4k' : '1080p';
  const data = { lot, kind: 'render', episode: p.ep, title: p.title, sentAt: nowIso(), words: (body.words ?? '').trim(), render, remotionDir: p.remotionDir, since, engine, agent, updates, edits: [], ...(vitesse !== 1 ? { vitesse } : {}), ...(qualite === '4k' ? { qualite } : {}) };
  fs.mkdirSync(p.LOTS, { recursive: true });
  fs.writeFileSync(lotFile(p, lot, 'md'), renderMarkdown(p, data));   // (the request first: the .json makes it a batch that `wait` reads)
  writeJson(lotFile(p, lot), data);
  return { lot, md: lotFile(p, lot, 'md'), line: renderLine(p, lot) };
}
// a render request Claude has not taken yet can be withdrawn from the studio (nothing was done with it)
export function withdrawRenderLot(p, lot) {
  const L = readLot(p, lot), r = readJson(p.REPLIES, { notes: {} });
  if (L?.kind !== 'render') throw new Error(t('lot.err.notRender', { lot }));
  if (r.lots?.[lot]) throw new Error(t('lot.err.alreadyTaken'));
  fs.rmSync(lotFile(p, lot), { force: true }); fs.rmSync(lotFile(p, lot, 'md'), { force: true });
}
export function renderMarkdown(p, L, l = lang()) {
  const T = tr(l), cli = `node "${CLI}"`, ep = p.target, o = [];
  const st = (x) => T(x.status === 'done' ? 'lot.rmd.stDone' : x.status === 'declined' ? 'lot.rmd.stDeclined' : x.status === 'taken' ? 'lot.rmd.stTaken' : 'lot.rmd.stOpen');
  o.push(T('lot.rmd.h1', { ep: p.ep, title: p.title, lot: L.lot }));
  o.push('');
  o.push(T('lot.rmd.sent', { date: dateTime(L.sentAt, l), doc: agentDoc(l) }));
  o.push(T('lot.rmd.ask', { video: path.join(p.EP, L.render?.name ?? '?'), date: L.render ? dateTime(L.render.mtime, l) : '?' }));
  o.push(T('lot.rmd.remotion', { dir: p.remotionDir }));
  if (L.qualite === '4k') o.push(T('lot.rmd.k4'));
  if (L.vitesse && L.vitesse !== 1) o.push(T('lot.rmd.speed', { s: String(L.vitesse).replace('.', l === 'fr' ? ',' : '.'), n: String(L.vitesse) }));
  if (L.words) { o.push(''); o.push(T('lot.rmd.words', { words: q(L.words) })); }
  if (L.updates) { o.push(''); o.push(...updatesMarkdown(L.updates, { cli, target: ep, l })); if (L.updates.remotion?.outdated) o.push(T('lot.rmd.noUpgrade')); }
  o.push('');
  o.push(T('lot.rmd.carries'));
  if (!L.since.length) o.push(T('lot.rmd.none'));
  for (const x of L.since) o.push(T('lot.rmd.lot', { lot: x.lot, n: x.edits, state: st(x), msg: x.message ? ` — ${q(x.message)}` : '', files: x.files.length ? T('lot.rmd.files', { files: x.files.join(', ') }) : '' }));
  if (L.engine.length) o.push(T('lot.rmd.engine', { files: L.engine.join(', ') }));
  o.push('');
  o.push(T('lot.md.todo'));
  o.push(T('lot.rmd.take', { cli, ep, lot: L.lot }));
  o.push(T('lot.rmd.open2'));
  o.push(T('lot.rmd.run', { cli, ep, lot: L.lot }));
  o.push(T('lot.rmd.watch'));
  o.push(T('lot.rmd.done', { cli, ep, lot: L.lot }));
  o.push('');
  return o.join('\n');
}

// « Comparer avant / après »: each note corrected in a batch sent on an OLDER video. Before = the frame captured when
// the batch was sent (revue/lots/NNN/k-image.jpg); after = the same moment in the current video (the note's place once
// moved onto it by remap-notes.mjs). The latest batch of a note wins.
export function compareItems(p) {
  const video = pickVideo(p); if (!video) return [];
  const cur = stamp(video), r = readJson(p.REPLIES, { notes: {} });
  const notes = new Map((readJson(p.NOTES, { notes: [] }).notes ?? []).map((n) => [n.id, n]));
  const out = new Map();
  for (const n of lotNumbers(p)) {
    const L = readLot(p, n);
    if (!L || L.kind === 'render' || !L.render || L.render.size === cur.size || r.lots?.[n]?.status !== 'done') continue;
    for (const e of L.edits) {
      const note = notes.get(e.id), img = e.captures?.image;
      if (!note || !img || !fs.existsSync(img)) continue;
      const m = r.notes?.[e.id]?.remap, onCur = note.render?.size === cur.size;
      const frame = onCur ? note.frame : m?.render?.size === cur.size ? m.frame : e.frame;
      const reply = (r.notes?.[e.id]?.messages ?? []).at(-1)?.text ?? '';
      out.set(e.id, { id: e.id, lot: n, k: e.k, text: e.text, frame, beforeFrame: e.frame, beforeSource: e.source, beforeRender: L.render,
        before: '/lots/' + path.relative(p.LOTS, img).split(path.sep).join('/'), status: r.notes?.[e.id]?.status ?? note.status ?? null, reply, moved: !onCur && !m });
    }
  }
  return [...out.values()].sort((a, b) => a.frame - b.frame);
}

// what the page shows about the batches: number, edits, Claude's progress (replies.json › lots), undo state
export function lotsSummary(p, replies, runs) {
  return lotNumbers(p).map((n) => {
    const L = readLot(p, n); if (!L) return null;
    return { lot: n, kind: L.kind ?? 'edits', sentAt: L.sentAt, ids: L.edits.map((e) => e.id), render: L.render ?? null, ...(L.qualite ? { qualite: L.qualite } : {}),
      captureState: L.captureState ? {id: L.captureState.id, status: L.captureState.status, done: L.captureState.done, total: L.captureState.total, error: L.captureState.error} : null,
      updatesPending: !!L.updatesPending,
      updatesLine: L.updates ? updatesLine(L.updates) : t(L.updatesPending ? 'upd.line.pending' : 'upd.line.unavailable'),
      updatesOk: updatesOk(L.updates),
      line: L.kind === 'render' ? renderLine(p, n) : pasteLine(p, n, L.edits.length),
      claude: replies?.lots?.[n] ?? null, run: runs[n] ?? null };
  }).filter(Boolean);
}

// « Les yeux » : an image of the episode at a frame, either
//   - from the rendered video (ffmpeg, the review copy when fresh: fast), or
//   - from the CURRENT code (Remotion renderStill: bundle of 06_Remotion/src, reused while the code is unchanged,
//     Chrome with --gl=angle as every Brambleshire render), so a correction can be checked without re-rendering.
// Used by the studio server (/api/frame, captures of a sent batch) and by studio-cli.mjs (control images).
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { chromePath } from './tools.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compositionId } from './episode.mjs';
import { CACHE, cacheReadme } from './place.mjs';
import { t } from './i18n.mjs';
import { hfFor, hfComposition, hfEnv, cmpVersion } from './hyperframes.mjs';
import { remotionGpu } from './gpu.mjs';
import os from 'node:os';

// a HyperFrames project (user request, 09/10/2026): « hyperframes snapshot --at <s,…> » of the user's CLI (its own
// headless Chrome, the exact instants), into the files asked for (JPEG through ffmpeg, PNG as is)
const execFileAsync = promisify(execFile);
const hfConfig = (p) => hfComposition(p.hf.projet, p.hf.index) ?? { fps: 30, duration: 0, width: 1920, height: 1080 };
async function hfStills(p, frames, outs, onOutput) {
  const hf = hfFor(p.hf.projet); if (!hf) throw new Error(t('hf.none'));
  const comp = hfConfig(p);
  const total = Math.max(1, Math.round(comp.duration * comp.fps));
  frames = frames.map((x) => Math.max(0, Math.min(total - 1, Math.round(x))));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coulisses-hf-'));
  try {
    const at = frames.map((x) => (x / comp.fps).toFixed(4)).join(',');
    const r = await execFileAsync(process.execPath, [hf.cli, 'snapshot', '.', '-o', tmp, '--at', at, '--no-end'], { cwd: p.hf.projet, env: hfEnv(), encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
    const pngs = fs.readdirSync(tmp).filter((x) => /^frame-\d+-at-.*\.png$/i.test(x)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    if (pngs.length !== frames.length) throw new Error(String(r.stderr || r.stdout || 'hyperframes snapshot').trim().split('\n').slice(-3).join(' '));
    for (const [i, out] of outs.entries()) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      if (/\.png$/i.test(out)) fs.copyFileSync(path.join(tmp, pngs[i]), out);
      else await ffmpeg(['-i', path.join(tmp, pngs[i]), '-q:v', '3', out]);
      if (onOutput) await onOutput(frames[i], out);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return { frames, durationInFrames: total, fps: comp.fps, width: comp.width, height: comp.height };
}

export const CHROME = chromePath();   // lib/tools.mjs: settings.json, else where Chrome usually is

export function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = ''; p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `ffmpeg ${c}`))));
  });
}
// crop = { x, y, width, height } in frame pixels; width = output width (keeps the ratio)
export async function videoFrame(src, frame, fps, out, { crop, width, overlay } = {}) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const t = Math.max(0, (frame - 0.5) / fps);   // the first image whose time is >= t is `frame`
  const chain = [];
  if (crop) chain.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`);
  if (width) chain.push(`scale=${width}:-2`);
  const q = /\.jpe?g$/i.test(out) ? ['-q:v', '2'] : [];
  if (overlay) {   // a transparent PNG of the marks (same size as the frame) drawn over the image
    const fc = `[0:v][1:v]overlay=0:0${chain.length ? ',' + chain.join(',') : ''}`;
    return ffmpeg(['-ss', t.toFixed(4), '-i', src, '-i', overlay, '-filter_complex', fc, '-frames:v', '1', ...q, out]);
  }
  return ffmpeg(['-ss', t.toFixed(4), '-i', src, '-frames:v', '1', ...(chain.length ? ['-vf', chain.join(',')] : []), ...q, out]);
}
// several images side by side (a strip: before / after of a range)
// labels[i] (optional) is written on image i (its frame number)
export async function tile(files, out, { cols = 4, width = 480, labels = [] } = {}) {
  const h = Math.round(width * 9 / 16 / 2) * 2, FONT = 'C\\:/Windows/Fonts/arial.ttf';
  const cell = (i) => `[${i}:v]scale=${width}:${h}${labels[i] !== undefined ? `,drawtext=fontfile='${FONT}':text='${labels[i]}':x=6:y=6:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.6` : ''}[s${i}]`;
  if (files.length === 1) return ffmpeg(['-i', files[0], '-filter_complex', cell(0).replace('[s0]', ''), '-frames:v', '1', '-q:v', '3', out]);
  const fc = files.map((_, i) => cell(i)).join(';') + ';' + files.map((_, i) => `[s${i}]`).join('') +
    `xstack=inputs=${files.length}:layout=${files.map((_, i) => `${(i % cols) * width}_${Math.floor(i / cols) * h}`).join('|')}:fill=black`;
  return ffmpeg([...files.flatMap((f) => ['-i', f]), '-filter_complex', fc, '-frames:v', '1', '-q:v', '3', out]);
}

// ---------- Remotion's temporary folders ----------
// A render of the code copies the composition's videos into a folder of the system's temp (remotion-v<version>-assets…,
// ≈ 260 MB for a long Uchu-chan video). On Windows, the browser kept between two renders still holds those files when
// Remotion deletes the folder, and it stays: 09/10/2026, 5,300 of them, 1.2 TB, the disk full. So this process notes
// the temp folders that Remotion and its Chrome make IN THIS PROCESS (never another program's: a render or an export
// running elsewhere keeps its own) and removes them once a render is done — again every few seconds while the browser
// lets go —, Chrome's profile once the browser is closed, and what is left when the process ends.
const SYS_TMP = path.resolve(os.tmpdir());
const OUR_TMP = /^(remotion-v[\d.]+-assets|remotion-assets|puppeteer_dev_chrome_profile-)/;
const STALE_TMP = /^(remotion-v[\d.]+-assets|remotion-assets|puppeteer_dev_chrome_profile-|coulisses-shot-|coulisses-hf-|coulisses-paroles-)/;   // (old ones only: the sweep below)
const ownTmp = new Set();
{
  const note = (p) => { try { const d = path.resolve(String(p)); if (OUR_TMP.test(path.basename(d)) && path.dirname(d).toLowerCase() === SYS_TMP.toLowerCase()) ownTmp.add(d); } catch { /* not a path */ } };
  const mk = fs.mkdirSync; fs.mkdirSync = function mkdirSync(p, ...a) { const r = mk.call(this, p, ...a); note(p); return r; };
  const mts = fs.mkdtempSync; fs.mkdtempSync = function mkdtempSync(...a) { const r = mts.apply(this, a); note(r); return r; };
  const mt = fs.mkdtemp; fs.mkdtemp = function mkdtemp(prefix, ...a) { const cb = a.pop(); return mt.call(this, prefix, ...a, (e, dir) => { if (!e) note(dir); cb(e, dir); }); };
  const pmt = fs.promises.mkdtemp; fs.promises.mkdtemp = async function mkdtemp(...a) { const r = await pmt.apply(this, a); note(r); return r; };
}
// a folder holding a link (a junction to an art folder…) is never deleted (only what it holds would be lost)
function hasLink(d) {
  try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isSymbolicLink()) return true; if (e.isDirectory() && hasLink(path.join(d, e.name))) return true; } } catch { /* gone */ }
  return false;
}
let sweepT = null, jobsNow = 0;
function sweepOwn({ profiles = false, tries = 40 } = {}) {
  clearTimeout(sweepT);
  if (jobsNow > 0) { sweepT = setTimeout(() => sweepOwn({ profiles, tries }), 3000); sweepT.unref?.(); return; }   // (a job runs: its folders are in use)
  let held = 0;
  for (const d of [...ownTmp]) {
    const profile = path.basename(d).startsWith('puppeteer_');
    if (profile && !profiles) continue;   // the browser kept for the next render uses it
    if (!fs.existsSync(d) || hasLink(d)) { ownTmp.delete(d); continue; }
    try { fs.rmSync(d, { recursive: true, force: true }); ownTmp.delete(d); } catch { held++; }
  }
  if (held && tries > 0) { sweepT = setTimeout(() => sweepOwn({ profiles, tries: tries - 1 }), 3000); sweepT.unref?.(); }
}
process.once('exit', () => { for (const d of ownTmp) { try { if (!hasLink(d)) fs.rmSync(d, { recursive: true, force: true }); } catch { /* held */ } } });
// the stale ones of any program (other renders leave them too: 09/10/2026, a channel's own frame scans, four Remotion
// stills at a time, ≈ 10 GB a minute): Remotion's folders and Chrome's profiles untouched for 3 hours, at most once an
// hour. A folder still in use is never touched: it is first renamed, which Windows refuses while a file in it is open
// (a running render, a running Chrome); then the renamed one is deleted. Returns how many were removed.
const STALE_MS = 3 * 3600e3;
const newest = (d) => { let t = 0; try { t = fs.statSync(d).mtimeMs; for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) t = Math.max(t, fs.statSync(path.join(d, e.name)).mtimeMs); } catch { /* gone */ } return t; };
export function sweepStaleTemp(stampFile, { force = false } = {}) {
  try { if (!force && Date.now() - fs.statSync(stampFile).mtimeMs < 3600e3) return 0; } catch { /* first time */ }
  try { fs.mkdirSync(path.dirname(stampFile), { recursive: true }); fs.writeFileSync(stampFile, new Date().toISOString()); } catch { /* read-only */ }
  const old = Date.now() - STALE_MS; let n = sweepCacheTemp();
  let list = []; try { list = fs.readdirSync(SYS_TMP, { withFileTypes: true }); } catch { return 0; }
  for (const e of list) {
    if (!e.isDirectory() || !STALE_TMP.test(e.name) || ownTmp.has(path.join(SYS_TMP, e.name))) continue;
    const d = path.join(SYS_TMP, e.name);
    try {
      if (newest(d) > old || hasLink(d)) continue;
      const gone = `${d}.coulisses-del`;
      try { fs.renameSync(d, gone); } catch { continue; }   // in use: left alone
      fs.rmSync(gone, { recursive: true, force: true }); n++;
    } catch { /* held: next time */ }
  }
  for (const e of list) if (e.isDirectory() && e.name.endsWith('.coulisses-del')) { try { fs.rmSync(path.join(SYS_TMP, e.name), { recursive: true, force: true }); } catch { /* next time */ } }
  return n;
}
// what a process killed before its `finally` (the hub stopping a studio for a render, a quit) leaves in the cache, named
// with its pid: a timeline's or a check's bundle (timeline-<ep>-<pid>-<t>.cjs, coulisses-timeline-…, coulisses-comps-…,
// coulisses-check-player-<pid>.js): gone once its process is, or after an hour
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function sweepCacheTemp() {
  let n = 0, list = []; try { list = fs.readdirSync(CACHE); } catch { return 0; }
  for (const name of list) {
    const m = /^(?:timeline-.+?|coulisses-timeline-.+?|coulisses-comps|coulisses-check-player)-(\d+)(?:-\d+)?\.(?:cjs|js|css|map)$/.exec(name);
    if (!m) continue;
    const file = path.join(CACHE, name);
    try { if (+m[1] !== process.pid && (!alive(+m[1]) || Date.now() - fs.statSync(file).mtimeMs > 3600e3)) { fs.rmSync(file, { force: true }); n++; } } catch { /* held: next time */ }
  }
  return n;
}
// the code's signature (its newest file, its count of files): a frame of the code made from it stays right while it holds
export const codeSignature = (p) => { try { return p?.remotionDir ? srcSignature(p.remotionDir) : null; } catch { return null; } };

// ---------- current code: Remotion renderStill ----------
const touch = (f) => { try { const n = new Date(); fs.utimesSync(f, n, n); } catch { /* */ } };
// the older versions of a project's bundle (and the layout of before: one folder replaced in place, its temp copies):
// gone once unused for 6 hours (1 hour for an abandoned temp copy); one in use cannot be renamed, and stays
function sweepBundles(base, keep) {
  const name = path.basename(base);
  let list = []; try { list = fs.readdirSync(CACHE); } catch { return; }
  for (const n of list) {
    const d = path.join(CACHE, n);
    // this project's only: its old folder, its versions (-v<8 hex>), its abandoned temp copies (-<pid>-<time>)
    const mine = n === name || new RegExp(`^${name}-v[0-9a-f]{8}$`).test(n) || new RegExp(`^${name}-\\d+-\\d+$`).test(n);
    if (d === keep || !mine) continue;
    try {
      const sigF = path.join(d, 'studio-signature.txt'), used = fs.existsSync(sigF) ? fs.statSync(sigF).mtimeMs : fs.statSync(d).mtimeMs;
      if (Date.now() - used < (/-\d+-\d+$/.test(n) ? 3600e3 : 6 * 3600e3)) continue;
      const gone = `${d}.del`; fs.renameSync(d, gone); fs.rmSync(gone, { recursive: true, force: true });
    } catch { /* in use: next time */ }
  }
}
const codeState = new Map();   // remotionDir -> { sig, serveUrl, browser, comps: Map }
function srcSignature(dir) {   // newest file time + file count of src/: changes on every save
  let newest = 0, count = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else { count++; newest = Math.max(newest, fs.statSync(f).mtimeMs); } } };
  walk(path.join(dir, 'src'));
  return `${Math.round(newest)}-${count}`;
}
async function remotionApis(dir) {
  const req = createRequire(path.join(dir, 'package.json'));
  const imp = (m) => import(pathToFileURL(req.resolve(m)).href);
  const [bundler, renderer] = await Promise.all([imp('@remotion/bundler'), imp('@remotion/renderer')]);
  let rendererVersion;
  try { rendererVersion = req('@remotion/renderer/package.json').version; } catch { /* les anciens moteurs gardent le rendu unitaire */ }
  return { bundle: bundler.bundle ?? bundler.default?.bundle, r: renderer.default ?? renderer, rendererVersion };
}
let chain = Promise.resolve();   // one code render at a time (one bundle, one browser)
const counted = async (fn) => { jobsNow++; try { return await fn(); } finally { jobsNow--; } };
export function codeFrame(p, frame, out, opts = {}) {
  return queueCodeRender(() => codeFrameNow(p, frame, out, opts));
}
function queueCodeRender(run) {
  const job = chain.then(() => counted(run));
  chain = job.catch(() => {}).then(() => sweepOwn());
  return job;
}
// Une page pour les seules images utiles. Une image hors des bornes retrouve son
// numéro de demande, même quand plusieurs demandes désignent le même JPEG.
export function codeFrameList(p, frames, { onFrame, log = () => {}, cacheKey = null } = {}) {
  return queueCodeRender(async () => {
    if (!frames.length) return;
    const hf = p.kind === 'hyperframes';
    try {
        const engine = hf ? null : await prepare(p, log, { cacheKey, bundleRoot: p.lotBundleRoot });
      const h = hf ? hfConfig(p) : null;
      const duration = hf ? Math.max(1, Math.round(h.duration * h.fps)) : engine.comp.durationInFrames;
      const byFrame = new Map();
      for (const requested of new Set(frames)) {
        if (!Number.isFinite(Number(requested))) throw new Error(`Numéro d’image invalide : ${requested}`);
        const frame = Math.max(0, Math.min(duration - 1, Math.round(requested)));
        if (!byFrame.has(frame)) byFrame.set(frame, []);
        byFrame.get(frame).push(requested);
      }
      const selected = [...byFrame.keys()].sort((a, b) => a - b);
      const publish = async (buffer, frame) => {
        if (!byFrame.has(frame) || !buffer?.length) throw new Error(`Image inattendue ou vide : ${frame}`);
        for (const requested of byFrame.get(frame)) await onFrame(requested, buffer, frame);
        byFrame.delete(frame);
      };
      if (hf) {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coulisses-hf-'));
        try {
          // La longueur d’une ligne de commande est limitée sous Windows.
          for (let i = 0; i < selected.length; i += 200) {
            const group = selected.slice(i, i + 200);
            await hfStills(p, group, group.map((f) => path.join(tmp, f + '.jpg')), (frame, file) => publish(fs.readFileSync(file), frame));
          }
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      } else {
        const { r, st, comp, chromiumOptions, rendererVersion } = engine;
        const options = { composition: comp, serveUrl: st.serveUrl, inputProps: p.remotion?.props ?? {}, imageFormat: 'jpeg', jpegQuality: 90,
          browserExecutable: CHROME, chromiumOptions, puppeteerInstance: st.browser, timeoutInMilliseconds: 600000, logLevel: 'error', onBrowserLog: () => {} };
        // « frames » date de 4.0.502. L’attente du rappel asynchrone date de
        // 4.0.515. Un ancien SDK ignore l’option « frames » et rendrait tout le film.
        if (rendererVersion && cmpVersion(rendererVersion, '4.0.515') >= 0) {
          await r.renderFrames({ ...options, frames: selected, outputDir: null, concurrency: 1, onFrameBuffer: publish, onFrameUpdate: () => {},
            onStart: ({ frameCount }) => { if (frameCount !== selected.length) throw new Error('Le moteur a ignoré la sélection des images.'); } });
        } else {
          for (const frame of selected) {
            const { buffer } = await r.renderStill({ ...options, frame });
            await publish(buffer, frame);
          }
        }
      }
      if (byFrame.size) throw new Error(`Captures manquantes : ${[...byFrame.keys()].join(', ')}`);
    } finally {
      // La copie figée appartient au lot. Ne pas accumuler un Chrome par envoi.
      if (!hf && cacheKey !== null) {
        const st = codeState.get(p.remotionDir);
        codeState.delete(p.remotionDir);
        await st?.browser?.close({ silent: true });
      }
    }
  });
}
async function codeFrameNow(p, frame, out, { log = () => {}, scale = 1 } = {}) {
  if (p.kind === 'hyperframes') { const h = await hfStills(p, [frame], [out]); return { out, frame: h.frames[0], durationInFrames: h.durationInFrames, fps: h.fps, width: h.width, height: h.height }; }
  const { r, st, comp, chromiumOptions } = await prepare(p, log);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  frame = Math.max(0, Math.min(comp.durationInFrames - 1, Math.round(frame)));
  await r.renderStill({ composition: comp, serveUrl: st.serveUrl, output: out, frame, inputProps: p.remotion?.props ?? {}, imageFormat: /\.png$/i.test(out) ? 'png' : 'jpeg', jpegQuality: 90,
    browserExecutable: CHROME, chromiumOptions, puppeteerInstance: st.browser, overwrite: true, scale, timeoutInMilliseconds: 600000, logLevel: 'error', onBrowserLog: () => {} });
  return { out, frame, durationInFrames: comp.durationInFrames, fps: comp.fps, width: comp.width, height: comp.height };
}
// several frames of the code in ONE page load (the episode's textures load once): frames first, first+step, … ≤ last
export function codeFrames(p, first, last, step, outDir, opts = {}) {
  const job = chain.then(() => counted(() => codeFramesNow(p, first, last, step, outDir, opts)));
  chain = job.catch(() => {}).then(() => sweepOwn());
  return job;
}
async function codeFramesNow(p, first, last, step, outDir, { log = () => {} } = {}) {
  if (p.kind === 'hyperframes') {
    fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
    const list = []; for (let x = Math.max(0, Math.round(first)); x <= Math.round(last); x += Math.max(1, step)) list.push(x);
    const outs = list.map((x, i) => path.join(outDir, `element-${String(i).padStart(4, '0')}.jpeg`));
    await hfStills(p, list, outs); return outs;
  }
  const { r, st, comp, chromiumOptions } = await prepare(p, log);
  const a = Math.max(0, Math.round(first)), b = Math.min(comp.durationInFrames - 1, Math.round(last));
  fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
  // everyNthFrame counts from frame 0 of the range: the range starts at `a`, so the frames are a, a+step, …
  await r.renderFrames({ composition: comp, serveUrl: st.serveUrl, outputDir: outDir, inputProps: p.remotion?.props ?? {}, imageFormat: 'jpeg', jpegQuality: 85,
    frameRange: [a, b], everyNthFrame: Math.max(1, step), concurrency: 1, onStart: () => {}, onFrameUpdate: () => {},
    browserExecutable: CHROME, chromiumOptions, puppeteerInstance: st.browser, timeoutInMilliseconds: 600000, logLevel: 'error', onBrowserLog: () => {} });
  return fs.readdirSync(outDir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort().map((f) => path.join(outDir, f));
}
// the whole video of a composition (« Rendre ce plan », lib/shot-render-run.mjs): the same bundle and browser as the
// stills, H.264; scale (2 for a 4K clip of a 1080 composition), muted when the clip it replaces has no sound
export function renderVideo(p, out, opts = {}) {
  const job = chain.then(() => counted(() => renderVideoNow(p, out, opts)));
  chain = job.catch(() => {}).then(() => sweepOwn());
  return job;
}
async function renderVideoNow(p, out, { scale = 1, muted = true, frameRange = null, onProgress = () => {}, log = () => {}, concurrency = null, cacheKey = null } = {}) {
  const { r, st, comp, chromiumOptions } = await prepare(p, log, { cacheKey });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // the GPU encoder when there is one (lib/gpu.mjs: a bitrate, a hardware encoder has no crf), else x264 crf 16; a render
  // that fails on the GPU is made again on the CPU
  const gpu = remotionGpu(Math.round(comp.width * scale), Math.round(comp.height * scale));
  let renderConcurrency = concurrency;
  const job = (enc) => r.renderMedia({ composition: comp, serveUrl: st.serveUrl, codec: 'h264', outputLocation: out, inputProps: p.remotion?.props ?? {}, scale, muted, frameRange,
    ...enc, pixelFormat: 'yuv420p', imageFormat: 'jpeg', jpegQuality: 92, overwrite: true, concurrency: renderConcurrency,
    browserExecutable: CHROME, chromiumOptions, puppeteerInstance: st.browser, timeoutInMilliseconds: 600000, logLevel: 'error', onBrowserLog: () => {},
    onProgress: (x) => onProgress(x.progress ?? 0, x.renderedFrames ?? 0, x.encodedFrames ?? 0, x.stitchStage ?? null) });
  const attempt = async () => {
    if (!gpu) await job({ crf: 16 });
    else {
      try { await job(gpu); } catch (e) {
        if (/cancel/i.test(String(e?.message)) || !/nvenc|nvcuda|cuda|hardware|encoder|encod|OpenEncodeSession|No capable devices|ffmpeg|compositor/i.test(String(e?.stack ?? e?.message ?? e))) throw e;   // only an encoder's failure
        log(t('gpu.fallback', { msg: String(e?.message ?? e).split('\n')[0].slice(0, 160) }));
        await job({ crf: 16 });
      }
    }
  };
  try { await attempt(); } catch (e) {
    // Remotion peut recevoir null de page.goto à l'ouverture des pages parallèles.
    // Il ne réessaie pas cette erreur, contrairement à ECONNRESET. Repartir une
    // seule fois avec notre navigateur neuf, sur le même bundle et la même plage.
    // Aucune erreur du projet, annulation, erreur distante ou délai générique
    // ne doit déclencher une seconde exécution.
    if (!/^Visited "http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\/index\.html" but got no response\.$/.test(String(e?.message))) throw e;
    log('Navigation du rendu local sans réponse : reprise unique avec une page dans un nouveau navigateur.');
    const failed = st.browser;
    await failed?.close({ silent: true });
    st.browser = null;
    fs.rmSync(out, { force: true });
    renderConcurrency = 1;
    st.browser = await r.openBrowser('chrome', { browserExecutable: CHROME, chromiumOptions, logLevel: 'error' });
    await attempt();
  }
  return { out, durationInFrames: comp.durationInFrames, fps: comp.fps, width: Math.round(comp.width * scale), height: Math.round(comp.height * scale) };
}
// the size of a composition (« Rendre ce plan »: the scale of the clip it becomes)
export async function compositionOf(p, log = () => {}, { cacheKey = null } = {}) {
  const job = chain.then(async () => { const { comp } = await prepare(p, log, { cacheKey }); return { width: comp.width, height: comp.height, fps: comp.fps, durationInFrames: comp.durationInFrames }; });
  chain = job.catch(() => {});
  return job;
}
async function prepare(p, log, { cacheKey = null, bundleRoot = null } = {}) {
  const dir = p.remotionDir, G = p.remotion ?? null;   // G: a generic Remotion project (.coulisses), else a Brambleshire episode
  const { bundle, r, rendererVersion } = await remotionApis(dir);
  let st = codeState.get(dir);
  if (!st) { st = { sig: null, serveUrl: null, browser: null, comps: new Map() }; codeState.set(dir, st); }
  // Une plage de relecture est liée au contenu publié et à ses médias, pas au seul fichier src/ le plus récent.
  const sig = cacheKey === null ? srcSignature(dir) : `code-playback:${String(cacheKey)}`;
  const base = bundleRoot ? path.join(bundleRoot, 'bundle') : G ? path.join(CACHE, `bundle-${crypto.createHash('sha1').update(dir.toLowerCase()).digest('hex').slice(0, 8)}`) : path.join(CACHE, 'bundle');
  const bundleDir = `${base}-v${crypto.createHash('sha1').update(sig).digest('hex').slice(0, 8)}`;
  const sigFile = path.join(bundleDir, 'studio-signature.txt');
  if (st.sig !== sig) {
    if (fs.existsSync(sigFile) && fs.readFileSync(sigFile, 'utf8') === sig) { st.serveUrl = bundleDir; touch(sigFile); }   // made by another process
    else {
      log(t('frm.bundling'));
      const t0 = Date.now();
      const tmp = `${bundleDir}-${process.pid}-${Date.now()}`;
      // public/ (≈ 3 GB of art) is NOT copied into the bundle: Remotion's own symlink needs Windows developer mode and
      // falls back to a full copy. The bundle is made with an empty public dir, then public/ is a JUNCTION to the real
      // folder (no admin right needed). Deleting a bundle removes the junction only, never the art it points to.
      const empty = path.join(CACHE, 'empty-public'); fs.mkdirSync(empty, { recursive: true });
      try {
        await bundle({ entryPoint: G?.entree ?? path.join(dir, 'src', 'index.ts'), outDir: tmp, enableCaching: cacheKey === null, symlinkPublicDir: false, publicDir: empty, onProgress: () => {} });
        const pub = path.join(tmp, 'public');
        fs.rmSync(pub, { recursive: true, force: true });   // the empty copy
        if (fs.existsSync(path.join(dir, 'public'))) fs.symlinkSync(path.join(dir, 'public'), pub, 'junction'); else fs.mkdirSync(pub);
        fs.writeFileSync(path.join(tmp, 'studio-signature.txt'), sig);   // (inside before it appears: a folder there is complete)
      } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e; }   // (a junction is removed, never followed)
      cacheReadme();
      try { fs.renameSync(tmp, bundleDir); }
      catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); if (!fs.existsSync(sigFile)) throw e; }   // (the same version made meanwhile by another process: that one)
      st.serveUrl = bundleDir;
      if (!bundleRoot) sweepBundles(base, bundleDir);
      log(t('frm.bundled', { s: Math.round((Date.now() - t0) / 1000) }));
    }
    st.sig = sig; st.comps.clear();
  }
  if (st.serveUrl) touch(path.join(st.serveUrl, 'studio-signature.txt'));
  const chromiumOptions = { gl: 'angle' };
  if (!st.browser) st.browser = await r.openBrowser('chrome', { browserExecutable: CHROME, chromiumOptions, logLevel: 'error' });
  const id = G?.composition ?? compositionId(p), inputProps = G?.props ?? {};
  let comp = st.comps.get(id);
  if (!comp) {
    comp = await r.selectComposition({ serveUrl: st.serveUrl, id, inputProps, browserExecutable: CHROME, chromiumOptions, puppeteerInstance: st.browser, timeoutInMilliseconds: 600000, logLevel: 'error', onBrowserLog: () => {} });
    st.comps.set(id, comp);
  }
  return { r, st, comp, chromiumOptions, rendererVersion };
}
export async function closeCode() {
  for (const st of codeState.values()) { try { await st.browser?.close({ silent: true }); } catch { /* already closed */ } st.browser = null; }
  sweepOwn({ profiles: true });   // the browser gone: its profile too
}
// crop box around a mark (frame pixels): padded by 24 px, at least 320×180, kept inside the frame (as HyperFrames)
export function cropAround(points, W = 1920, H = 1080) {
  if (!points?.length) return null;
  const xs = points.map((q) => q[0]), ys = points.map((q) => q[1]);
  const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  const width = Math.min(W, Math.max(480, box.width + 48)), height = Math.min(H, Math.max(270, box.height + 48));
  const even = (n) => Math.max(0, Math.round(n / 2) * 2);
  const x = Math.min(Math.max(0, box.x + box.width / 2 - width / 2), W - width);
  const y = Math.min(Math.max(0, box.y + box.height / 2 - height / 2), H - height);
  return { x: even(x), y: even(y), width: even(width), height: even(height) };
}

// width, height and frame rate of a video (an imported project's video can be 9:16, 25 or 60 fps)
export function probeVideo(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', file], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  try { const v = JSON.parse(r.stdout).streams[0]; const [a, b] = v.r_frame_rate.split('/').map(Number); return { size: [v.width, v.height], fps: b ? Math.round((a / b) * 1000) / 1000 : a }; }
  catch { return null; }   // (unknown: the caller keeps what it knows — a Short is not 1920×1080)
}

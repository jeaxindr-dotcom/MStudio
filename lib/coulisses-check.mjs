// « studio-cli.mjs projet verifier <fichier.coulisses> »: what a pipeline's agent runs to check that its run can be
// opened in Coulisses (the contract: docs\FICHE-COULISSES-REMOTION.md). In order:
//   1. the file itself (paths, composition id);
//   2. the timeline module, run under Node: its tracks and clips (frames);
//   3. the compositions module, under Node: the run's composition, its fps, size and duration;
//   4. the live preview, compiled like Coulisses does (the browser bundle of the module);
//   5. unless --rapide: a real still of the code by Remotion (the project's entry, registerRoot) — the same composition
//      as the export, and the proof image to look at.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCoulisses } from './coulisses-file.mjs';
import { loadTimeline, loadCompositions, esbuildOf } from './remotion-module.mjs';
import { codeFrame, closeCode } from './frames.mjs';
import { CACHE } from './place.mjs';
import { lang, tr } from './i18n.mjs';
import { stage3dModule } from './player-build.mjs';
import {exportEntryCheck} from './export-context.mjs';
import {SCRIPT as exportScript} from './export.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mmss = (f, fps) => { const s = f / fps; return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`; };

export async function checkProject(file, { quick = false, frames = null, log = () => {}, l = lang() } = {}) {
  const T = tr(l), ok = [], errors = [], warnings = [];
  const c = readCoulisses(file);
  if (c.errors.length) return { ok, errors: c.errors, warnings, file: c.file };
  const channel = c.channel ? T('chk.channel', { channel: c.channel }) : '';
  if (c.moteur === 'video') {   // a run not (yet) in Remotion: the file, where its export will land, its plan
    ok.push(T('chk.videoFile', { title: c.title, channel }));
    const dirs = c.export.dossiers.map((d) => `"${d}"${fs.existsSync(d) ? '' : T('chk.notYet')}`).join(', ');
    ok.push(T('chk.exportWhere', { dirs, motif: c.export.motif.source, depth: c.export.profondeur ? T('chk.depth', { n: c.export.profondeur }) : '' }));
    const found = c.export.dossiers.flatMap((d) => { try { return fs.readdirSync(d).filter((f) => c.export.motif.test(f)); } catch { return []; } });
    if (found.length) ok.push(T('chk.exportThere', { list: `${found.slice(0, 3).join(', ')}${found.length > 3 ? '…' : ''}` }));
    if (c.plan && !fs.existsSync(c.plan)) warnings.push(T('chk.planMissing', { plan: c.plan }));
    else if (c.plan) {
      try {
        const { tracksOf } = await import('./projects.mjs');
        const tk = tracksOf({ kind: 'run', plan: c.plan });
        if (!tk || !tk.tracks.length) errors.push(T('chk.planBad', { plan: c.plan }));
        else ok.push(T('chk.planTracks', { n: tk.tracks.length, file: path.basename(c.plan), list: tk.tracks.map((x) => `${x.name} ${x.clips.length}`).join(', ') }));
      } catch (e) { errors.push(T('chk.planErr', { msg: e.message })); }
    } else warnings.push(T('chk.noPlan'));
    return { ok, errors, warnings, file: c.file, video: true };
  }
  if (c.moteur === 'brambleshire') { ok.push(T('chk.episode', { ep: c.episode })); return { ok, errors, warnings, file: c.file }; }
  if (c.moteur === 'hyperframes') {
    const H = c.hyperframes ?? {}, index = path.join(H.projet ?? c.dir, H.index ?? 'index.html');
    if (!fs.existsSync(index)) errors.push(`HyperFrames : ${index} introuvable`);
    else ok.push(`HyperFrames : ${path.basename(index)} (${H.projet})`);
    return { ok, errors, warnings, file: c.file, video: true };
  }
  const R = c.remotion;
  const exportEntry = exportEntryCheck(R, path.join(R.projet,exportScript), l);
  if (exportEntry.error) errors.push(exportEntry.error);
  if (exportEntry.warning) warnings.push(exportEntry.warning);
  ok.push(T('chk.remotionFile', { title: c.title, channel, dir: R.projet, comp: R.composition }));
  // 2. the timeline
  let tl = null;
  try {
    tl = await loadTimeline(R);
    const n = tl.tracks.reduce((a, x) => a + x.clips.length, 0);
    if (!tl.tracks.length) errors.push(T('chk.noTrack'));
    else ok.push(T('chk.tracks', { n: tl.tracks.length, m: n, list: tl.tracks.map((x) => `${x.name} ${x.clips.length}`).join(', ') }));
    for (const p of tl.problems) errors.push(T('chk.timeline', { msg: p }));
  } catch (e) { errors.push(T('chk.timeline', { msg: e.message })); }
  // 3. the compositions module under Node
  let meta = null;
  try {
    const list = await loadCompositions(R);
    meta = list.find((x) => x.id === R.composition) ?? null;
    if (!meta) errors.push(T('chk.noComp', { comp: R.composition, list: list.map((x) => x.id).join(', ') || T('chk.none') }));
    else {
      for (const k of ['fps', 'width', 'height', 'durationInFrames']) if (!Number.isFinite(meta[k]) || meta[k] <= 0) errors.push(T('chk.positive', { comp: R.composition, k, v: meta[k] }));
      if (!meta.component) errors.push(T('chk.noComponent', { comp: R.composition }));
      if (!errors.length) ok.push(T('chk.comp', { w: meta.width, h: meta.height, fps: meta.fps, n: meta.durationInFrames, mmss: mmss(meta.durationInFrames, meta.fps) }));
      if (tl && tl.frames > meta.durationInFrames) warnings.push(T('chk.tooLong', { f: tl.frames, n: meta.durationInFrames }));
    }
  } catch (e) { warnings.push(T('chk.nodeLoad', { module:path.relative(R.projet,R.module), entry:path.relative(R.projet,R.entree), msg:e.message.split('\n')[0] })); }
  // 4. the live preview bundle
  const out = path.join(CACHE, `coulisses-check-player-${process.pid}.js`);
  try {
    fs.mkdirSync(CACHE, { recursive: true });
    const esbuild = await esbuildOf(R.projet);
    await esbuild.build({
      entryPoints: [path.join(STUDIO, 'player', 'remotion.tsx')], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', outfile: out, write: false,
      logLevel: 'silent', jsx: 'automatic', nodePaths: [path.join(R.projet, 'node_modules')], alias: { '@coulisses-module': R.module, '@coulisses-3d': stage3dModule(R.projet) },
      define: { __COMPOSITION__: JSON.stringify(R.composition), __PROPS__: JSON.stringify(R.props ?? {}), 'process.env.NODE_ENV': '"development"' },
      loader: { '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.webp': 'file', '.svg': 'file', '.glsl': 'text', '.css': 'css' },
    });
    ok.push(T('chk.preview'));
  } catch (e) {
    const m = (e.errors ?? []).slice(0, 3).map((x) => `${x.location ? path.basename(x.location.file) + ':' + x.location.line + ' ' : ''}${x.text}`).join(' ; ') || e.message;
    errors.push(T('chk.previewErr', { msg: m, hint: /@remotion\/player/.test(m) ? T('chk.previewHint') : '' }));
  } finally { fs.rmSync(out, { force: true }); for (const f of fs.readdirSync(CACHE).filter((x) => x.startsWith(`coulisses-check-player-${process.pid}`))) fs.rmSync(path.join(CACHE, f), { force: true }); }
  // 5. a real still by Remotion (the project's entry): the same composition as the export
  // the middle frame by default; --images 1700,8000 for chosen ones (a middle frame inside a full-frame 3D video shows
  // neither the paper nor the chapter layer: asked by the Vidéo du monde session, 07/10/2026)
  let image = null; const images = [];
  if (!quick && !errors.length) {
    const want = (frames?.length ? frames : [Math.floor((meta?.durationInFrames ?? 2) / 2)]).map((f) => Math.max(0, Math.floor(+f)));
    try {
      for (const f of want) {
        const out = path.join(c.revue, 'images', frames?.length ? `coulisses-verification-${f}.jpg` : 'coulisses-verification.jpg');
        const r = await codeFrame({ remotionDir: R.projet, remotion: R }, f, out, { log });
        images.push(out);
        ok.push(T('chk.still', { f, mid: frames?.length ? '' : T('chk.middle'), w: r.width, h: r.height, fps: r.fps, n: r.durationInFrames, out }));
        if (meta && (r.width !== meta.width || r.height !== meta.height || r.fps !== meta.fps || r.durationInFrames !== meta.durationInFrames)) {
          errors.push(T('chk.differ', { r: T('chk.dims', { w: r.width, h: r.height, fps: r.fps, n: r.durationInFrames }), m: T('chk.dims', { w: meta.width, h: meta.height, fps: meta.fps, n: meta.durationInFrames }) }));
          break;
        }
        if (meta && f >= meta.durationInFrames) { warnings.push(T('chk.beyond', { f, n: meta.durationInFrames })); }
      }
      image = images[0] ?? null;
    } catch (e) { errors.push(T('chk.stillErr', { entry: path.relative(R.projet, R.entree), comp: R.composition, msg: e.message.split('\n')[0] })); image = null; }
    finally { await closeCode(); }
  }
  return { ok, errors, warnings, image, images, file: c.file };
}

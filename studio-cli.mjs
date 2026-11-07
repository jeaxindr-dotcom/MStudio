#!/usr/bin/env node
// What the Claude session uses to work the studio's batches (protocol: AGENT.md). Writes only revue/replies.json
// (Claude's file) and revue/runs/ (snapshots); never revue/notes.json (the page's file).
//   wait     <ep>                      attend un lot ou une réponse utilisateur, les imprime et sort (en arrière-plan :
//                                      its exit wakes the session); while waiting, the tool shows « Claude surveille »
//   take     <ep> <lot>                the tool shows « l'agent corrige » on the batch and its notes
//   images   <ep> <lot> [--timeout s]  suit les captures de ce lot jusqu'à leur livraison
//   snapshot <ep> <lot> <file…>        copy the files BEFORE changing them (« Annuler cette correction »)
//   frame    <ep> <frame> [--source code|video] [--out f.jpg] [--width w]   one image (the eyes)
//   sheet    <ep> <note id> [--before video|code] [--after code|video]      strips before / after
//                                      -> revue/images/claude-<id>-avant.jpg / -apres.jpg (attached by reply)
//   reply    <ep> <note id> "<text>" [--status done|open|working] [--image f]… [--no-images]
//   done     <ep> <lot> "<summary>" [--declined]      (on a render request: I have watched the new video)
//   render   <ep> [<lot>] [--only checks,render,finish] [--frames a-b] [--out f.mp4]
//                                      the full re-render asked from the tool (run in the background): the five checks,
//                                      npx remotion render, finish-render.sh; progress in revue/render.json (lib/render.mjs)
//   undo     <ep> <lot> [--redo]
//   updates  <ep> [--agent claude|codex]   what may need updating on the agent's side (Remotion, skills): checked
//                                      at every batch sent from the tool; this re-checks now (lib/updates.mjs)
//   status   <ep>
//   medias   <chaîne | fichier .coulisses> liste [--categorie c] [--json]      the channel's media library (lib/medias.mjs)
//   medias   <chaîne | fichier .coulisses> ajouter <image> [--nom n] [--categorie c] [--tags a,b] [--description d]
//                                      [--prompt p]   an image the agent made for the channel, into its library
//   medias   <chaîne | fichier .coulisses> dossier                             the library's folder
// Common flags: --theatre / --episodes / --remotion (the sandbox), as for studio-server.mjs.
// <ep> = a Brambleshire episode (E03), or the folder of an imported project (or its revue folder, lib/projects.mjs):
// there, no live preview (frame / sheet use the video), no staging, and no render from the studio.
import fs from 'node:fs';
import path from 'node:path';
import { optionsFrom, readJson, readJsonStrict, writeJson, updateJson, nowIso, stillSource, pad3, flagsOf } from './lib/episode.mjs';
import { syncUserReplies, pendingUserReplies, prepareUserReplyDelivery, acknowledgeUserReplyDelivery, writeDelivered } from './lib/reply-delivery.mjs';
import { videoFrame, codeFrame, codeFrames, tile, closeCode, probeVideo } from './lib/frames.mjs';
import { lotNumbers, readLot, lotFile, lotMarkdown, renderMarkdown } from './lib/lots.mjs';
import { resolveTarget } from './lib/projects.mjs';
import { snapshot, finish, step, listRuns } from './lib/runs.mjs';
import { runRender, markReviewed, PHASES } from './lib/render.mjs';
import { checkUpdates, updatesLine, updatesMarkdown } from './lib/updates.mjs';
import { detectAgent, agentById } from './lib/agent.mjs';
import { t, hhmm } from './lib/i18n.mjs';
// Machine markers, the same in both languages (agents and pipelines may look for them): « PROJET CONFORME »,
// « PROJET NON CONFORME », « LOT N REÇU », « DEMANDE DE RENDU (lot N) REÇUE », « RENDU TERMINÉ », « RENDU ARRÊTÉ »,
// « RENDU NON LANCÉ », « RENDU EN ÉCHEC », « CONTRÔLES PASSÉS », « RENDU FAIT (sans finition) ». English adds a gloss after them.

const argv = process.argv.slice(2);
const FLAGS_WITH_VALUE = new Set(['--categorie', '--tags', '--description', '--prompt', '--theatre', '--episodes', '--remotion', '--source', '--out', '--width', '--status', '--image', '--before', '--after', '--timeout', '--only', '--frames', '--agent', '--depuis', '--dossier', '--titre', '--chaine', '--format', '--projet', '--entree', '--module', '--timeline', '--composition', '--props', '--export', '--motif', '--nom', '--moteur', '--plan', '--profondeur', '--images']);
const pos = []; const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { if (FLAGS_WITH_VALUE.has(a)) { (flags[a] ??= []).push(argv[++i]); } else flags[a] = [true]; }
  else pos.push(a);
}
const flag = (k, d) => flags[k]?.[0] ?? d;
const [cmd, epArg, ...rest] = pos;
const die = (m) => { console.error(m); process.exit(1); };

// « projet creer » / « projet verifier »: the .coulisses file of a run (docs\FICHE-COULISSES-REMOTION.md), before any episode
if (cmd === 'projet') {
  const { createCoulisses } = await import('./lib/coulisses-file.mjs');
  const { checkProject } = await import('./lib/coulisses-check.mjs');
  if (epArg === 'creer') {
    // the values, from a JSON file (--depuis, recommended: no French text through the shell) and / or flags
    const spec = flag('--depuis') ? readJson(path.resolve(flag('--depuis')), null) : {};
    if (flag('--depuis') && !spec) die(t('cli.badSpec', { file: flag('--depuis') }));
    const v = (k) => flag(`--${k}`) ?? spec?.[k];
    let props = spec?.props ?? {};
    if (flag('--props')) { props = readJson(path.resolve(flag('--props')), null); if (!props) die(t('cli.badProps')); }
    try {
      const file = createCoulisses({ dossier: v('dossier') && path.resolve(v('dossier')), titre: v('titre'), chaine: v('chaine'), format: v('format'), projet: v('projet') && path.resolve(v('projet')),
        entree: v('entree'), module: v('module'), timeline: v('timeline'), composition: v('composition'), props, exportDossier: v('export'), exportMotif: v('motif'), exportProfondeur: v('profondeur'), plan: v('plan'), nom: v('nom'), moteur: v('moteur'), utilise: spec?.utilise });
      console.log(file);
    } catch (e) { die(e.message); }
    process.exit(0);
  }
  if (epArg === 'verifier') {
    const file = rest[0]; if (!file) die(t('cli.usageCheck'));
    const frames = flag('--images') ? String(flag('--images')).split(/[,; ]+/).filter(Boolean).map(Number) : null;
    if (frames && frames.some((f) => !Number.isFinite(f) || f < 0)) die(t('cli.badImages'));
    const r = await checkProject(file, { quick: !!flags['--rapide'], frames, log: (m) => console.error(`… ${m}`) });
    for (const x of r.ok) console.log(t('cli.ok', { x }));
    for (const x of r.warnings) console.log(t('cli.warn', { x }));
    for (const x of r.errors) console.log(t('cli.fail', { x }));
    console.log(r.errors.length ? t('cli.notConform', { n: r.errors.length }) : r.video ? t('cli.conformVideo')
      : t('cli.conform', { images: r.images?.length > 1 ? t('cli.lookImages', { list: r.images.map((x) => `"${x}"`).join(', ') }) : r.image ? t('cli.lookImage', { file: r.image }) : '' }));
    process.exit(r.errors.length ? 1 : 0);
  }
  die(t('cli.usageProjet'));
}
// « medias »: the media library of a channel (the studio's « Médias » tab), for the agent of a pipeline
if (cmd === 'medias') {
  const { library, listMedias, addMedia, ALL_CATS, CATEGORIES } = await import('./lib/medias.mjs');
  const { isCoulissesFile, readCoulisses } = await import('./lib/coulisses-file.mjs');
  if (!epArg) die(t('cli.usageMedias'));
  const chaine = isCoulissesFile(epArg) && fs.existsSync(epArg) ? readCoulisses(path.resolve(epArg)).channel : epArg;
  const L = library(chaine), what = rest[0] ?? 'liste';
  if (what === 'dossier') { listMedias(L); console.log(L.dir); process.exit(0); }
  if (what === 'liste') {
    const cat = flag('--categorie'), items = listMedias(L).filter((it) => !cat || it.categorie === cat);
    if (flags['--json']) { console.log(JSON.stringify(items.map((it) => ({ ...it, chemin: path.join(L.dir, ...it.fichier.split('/')) })), null, 1)); process.exit(0); }
    console.log(t('cli.mdHead', { channel: L.channel, dir: L.dir, n: items.length }));
    for (const it of items) console.log(t('cli.mdLine', { cat: it.categorie, name: it.nom, file: path.join(L.dir, ...it.fichier.split('/')), tags: it.tags?.length ? ` [${it.tags.join(', ')}]` : '' }));
    process.exit(0);
  }
  if (what === 'ajouter') {
    const file = rest[1]; if (!file || !fs.existsSync(file)) die(t('cli.usageMedias'));
    const cat = flag('--categorie', 'a-ranger');
    if (!ALL_CATS.includes(cat)) die(t('cli.mdBadCat', { cat, cats: ALL_CATS.join(', ') }));
    try {
      const it = addMedia(L, path.resolve(file), { nom: flag('--nom'), categorie: cat, tags: flag('--tags', ''), description: flag('--description', ''), prompt: flag('--prompt') ?? null, source: 'agent' });
      console.log(path.join(L.dir, ...it.fichier.split('/')));
    } catch (e) { die(e.message); }
    process.exit(0);
  }
  die(t('cli.usageMedias'));
}
if (!cmd || !epArg) die(t('cli.usage'));
const P = resolveTarget(epArg, optionsFrom(argv));
const B = P.kind === 'brambleshire', CODE = B || P.kind === 'remotion' || P.kind === 'hyperframes';   // CODE: a live preview of the code exists
// the video's frame rate, asked only by the commands that cut frames (frame, sheet): an ffprobe for every take / reply /
// done / wait was not needed (code review 18/10/2026)
let fpsMemo = null;
const fpsNow = () => (fpsMemo ??= B ? readJson(P.SNAP, {})?.fps ?? 30 : (stillSource(P) ? probeVideo(stillSource(P))?.fps ?? 30 : 30));   // a Remotion run with no export yet: frames are the code's
const replies = () => { const r = readJson(P.REPLIES, { notes: {} }); r.notes ??= {}; r.lots ??= {}; return r; };
// the agent's answers changed under a lock, from a strict read (lib/episode.mjs updateJson): two commands run at once
// (the agent runs several shells together), or one during finish-render's remap, no longer lose one another's answer
const changeReplies = (fn) => updateJson(P.REPLIES, { notes: {} }, (r) => { r.notes ??= {}; r.lots ??= {}; fn(r); });
const notesById = () => Object.fromEntries((readJson(P.NOTES, { notes: [] }).notes ?? []).map((n) => [n.id, n]));
const rel = (f) => path.relative(P.REVUE, f).split(path.sep).join('/');
const log = (m) => console.error(`… ${m}`);
const AG = agentById(flag('--agent')) ?? detectAgent();   // who runs these commands: shown in the tool

async function followLotImages(n, seconds) {
  if (!Number.isSafeInteger(n) || n < 1 || !Number.isFinite(seconds) || seconds < 0) throw new Error(t('cli.imagesUsage'));
  const deadline = seconds ? Date.now() + seconds * 1000 : Infinity;
  const published = new Set();
  for (;;) {
    const lot = readJsonStrict(lotFile(P, n), null);
    if (!lot) throw new Error(t('cli.noLot', { n }));
    const state = lot.captureState, lines = [];
    let incomplete = false;
    const report = (line) => {
      if (!published.has(line)) { published.add(line); lines.push(line); }
    };
    for (const edit of lot.edits) {
      const c = edit.captures ?? {}, prefix = `#${edit.k} (${edit.id}) · `;
      for (const [field, label] of [['image', 'lot.md.image'], ['marque', 'lot.md.marked'], ['zoom', 'lot.md.zoom'], ['fin', 'lot.md.last']]) {
        const file = c[field];
        if (!file) continue;
        if (fs.existsSync(file)) {
          const rect = c.zoomRect ?? {};
          report(prefix + t(label, { file, x: rect.x, y: rect.y, w: rect.width, h: rect.height }));
        } else { incomplete = true; report(prefix + t('cli.imagesMissing', { file })); }
      }
      if (c.error) { incomplete = true; report(prefix + c.error); }
    }
    if (lines.length) await writeDelivered(process.stdout, lines.join('\n') + '\n');
    // Les anciens lots ont été publiés après leurs captures et n'ont aucun état de préparation.
    if (!state || state.status !== 'pending') {
      if (incomplete || (state && state.status !== 'ready')) throw new Error(t('cli.imagesFailed', { n, detail: state?.error || lotFile(P, n, 'md') }));
      await writeDelivered(process.stdout, t('cli.imagesReady', { n, md: lotFile(P, n, 'md') }) + '\n');
      return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(t('cli.imagesTimeout', { n, done: state.done, total: state.total }));
    await new Promise((resolve) => setTimeout(resolve, Math.min(400, remaining)));
  }
}

async function main() {
  switch (cmd) {
    case 'images':
      return followLotImages(Number(rest[0]), Number(flag('--timeout', flags['--timeout'] ? NaN : 0)));
    case 'wait': {
      const beat = (waiting, lastLot) => writeJson(P.AGENT, { pid: process.pid, since, beat: nowIso(), waiting, lastLot: lastLot ?? null, agent: AG ? { id: AG.id, name: AG.name } : null });
      const since = nowIso(), limit = +(flag('--timeout', 0)) * 1000, t0 = Date.now();
      const pendingLot = () => { const r = replies(); return lotNumbers(P).find((n) => !r.lots[n]); };
      const again = () => t('cli.waitAgain', { cmd: `node "${process.argv[1]}" wait ${argv.slice(1).filter((a) => a !== 'wait').map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}` });
      let last = 0;
      const stop = () => { try { beat(false); } catch { /* ignore */ } process.exit(0); };
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
      for (;;) {
        syncUserReplies(P, readJsonStrict(P.NOTES, { notes: [] }));
        const messages = pendingUserReplies(P);
        const n = pendingLot();
        if (messages.length || n) {
          const delivery = messages.length ? prepareUserReplyDelivery(P, messages, { cli: process.argv[1] }) : null;
          const output = delivery ? [delivery.output] : [];
          if (n) {
            const render = readLot(P, n)?.kind === 'render';   // the marker never changes with the language
            output.push(t('cli.waitGot', { marker: render ? `DEMANDE DE RENDU (lot ${n}) REÇUE` : `LOT ${n} REÇU`, gloss: render ? `render request ${n} received` : `batch ${n} received`, ep: P.ep, md: lotFile(P, n, 'md') }));
            // (a batch written by an older Coulisses whose request failed: its request made now from the batch)
            if (!fs.existsSync(lotFile(P, n, 'md'))) { try { const L = readLot(P, n); fs.writeFileSync(lotFile(P, n, 'md'), L?.kind === 'render' ? renderMarkdown(P, L) : lotMarkdown(P, L)); } catch (e) { output.push(e.message); } }
            const content = fs.existsSync(lotFile(P, n, 'md')) ? fs.readFileSync(lotFile(P, n, 'md'), 'utf8') : lotFile(P, n);
            output.push(delivery && content.length > 1500 ? `Lire la demande complète du lot : ${lotFile(P, n, 'md')}` : content);
          }
          output.push(again());
          try {
            const text = output.join('\n') + '\n';
            await writeDelivered(process.stdout, delivery && text.length > 12000 ? text.slice(0, 11800) + '\n[Sortie abrégée : lire les fichiers complets indiqués en tête avant tout accusé.]\n' : text);
          } finally { beat(false, n); }
          return;
        }
        if (limit && Date.now() - t0 > limit) { beat(false); console.log(t('cli.waitNone')); return; }
        if (Date.now() - last > 5000) { beat(true); last = Date.now(); }
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    case 'ack-replies': {
      const count = acknowledgeUserReplyDelivery(P, rest[0], AG);
      console.log(`LECTURE DES RÉPONSES CONFIRMÉE : ${count} réponse${count > 1 ? 's' : ''} · livraison ${rest[0]}`);
      return;
    }
    case 'take': {
      const n = +rest[0], L = readLot(P, n); if (!L) die(t('cli.noLot', { n }));
      let already = null;
      changeReplies((r) => {
        if (r.lots[n] && r.lots[n].status !== 'open') { already = r.lots[n]; return; }
        const at = nowIso();
        r.lots[n] = { status: 'taken', at };
        for (const e of L.edits) { const x = (r.notes[e.id] ??= {}); x.status = 'working'; x.statusAt = at; }
      });
      if (already) die(t('cli.already', { n, status: already.status, at: already.at }));
      console.log(L.kind === 'render' ? t('cli.takenRender', { n }) : t('cli.taken', { n, k: L.edits.length }));
      return;
    }
    case 'snapshot': {
      const n = +rest[0], files = rest.slice(1); if (!n || !files.length) die(t('cli.usageSnapshot'));
      const { added, manifest } = snapshot(P, n, files);
      console.log(t('cli.snapshot', { n, a: added.length, m: manifest.files.length }));
      return;
    }
    case 'frame': {
      const f = +rest[0], source = flag('--source', CODE ? 'code' : 'video');
      if (source === 'code' && !CODE) die(t('cli.noCodeFrame'));
      const out = path.resolve(flag('--out', path.join(P.IMAGES, `claude-${source}-${f}.jpg`)));
      if (source === 'code') await codeFrame(P, f, out, { log }); else await videoFrame(stillSource(P), f, fpsNow(), out);
      const w = +flag('--width', 0);
      if (w) { const s = out.replace(/(\.\w+)$/, '-w$1'); await videoFrame(out, 0, fpsNow(), s, { width: w }); fs.renameSync(s, out); }
      console.log(out);
      return;
    }
    case 'sheet': {
      const id = rest[0], n = notesById()[id]; if (!n) die(t('cli.noNote', { id }));
      const b = flag('--before', CODE && !stillSource(P) ? 'code' : 'video'), a = flag('--after', CODE ? 'code' : 'none');
      if (!CODE && (a === 'code' || b === 'code')) die(t('cli.noCodeSheet'));
      // frames shown: a point note = 8 images around it (every 2nd), a range = up to ~16 across it (as note-sheets.py)
      let first, step, count;
      if (n.end == null || n.end <= n.frame) { first = Math.max(0, n.frame - 6); step = 2; count = 8; }
      else { step = Math.max(1, Math.ceil((n.end - n.frame + 1) / 12)); first = Math.max(0, n.frame - 2 * step); count = Math.floor((n.end + 2 * step - first) / step) + 1; }
      const frames = Array.from({ length: count }, (_, i) => first + i * step);
      const tmp = path.join(P.REVUE, 'lots', '.sheet-tmp');
      const side = async (source, tag) => {
        const dir = path.join(tmp, tag); let files;
        if (source === 'code') files = await codeFrames(P, frames[0], frames.at(-1), step, dir, { log });
        else { fs.rmSync(dir, { recursive: true, force: true }); files = []; for (const f of frames) { const o = path.join(dir, `${pad3(files.length)}.jpg`); await videoFrame(stillSource(P), f, fpsNow(), o, { width: 480 }); files.push(o); } }
        const out = path.join(P.IMAGES, `claude-${id}-${tag}.jpg`);   // « avant » / « apres »: file names, the same in both languages
        await tile(files, out, { cols: 4, width: 480, labels: frames.map((f) => `${f}${source === 'code' ? ' code' : ''}`) });
        return out;
      };
      const before = await side(b, 'avant'), after = a === 'none' ? null : await side(a, 'apres');
      fs.rmSync(tmp, { recursive: true, force: true });
      console.log(`${t('cli.before', { b, file: before })}${after ? t('cli.after', { a, file: after }) : t('cli.afterNone')}`);
      return;
    }
    case 'reply': {
      const [id, text] = rest; if (!id || text === undefined) die(t('cli.usageReply'));
      if (!notesById()[id]) die(t('cli.noNoteFile', { id }));
      const status = flag('--status', 'done'); if (!['done', 'open', 'working'].includes(status)) die('--status done|open|working');
      const imgs = [];
      for (const f of flags['--image'] ?? []) {
        let abs = path.resolve(P.REVUE, f);
        if (!fs.existsSync(abs)) die(t('cli.noImage', { file: abs }));
        if (!abs.toLowerCase().startsWith(P.REVUE.toLowerCase() + path.sep)) { const c = path.join(P.IMAGES, `claude-${id}-${Date.now().toString(36)}${path.extname(abs)}`); fs.copyFileSync(abs, c); abs = c; }
        imgs.push(rel(abs));
      }
      if (!flags['--no-images']) for (const tag of ['avant', 'apres']) { const f = path.join(P.IMAGES, `claude-${id}-${tag}.jpg`); if (fs.existsSync(f) && !imgs.includes(rel(f))) imgs.push(rel(f)); }
      let e = null;
      changeReplies((r) => {
        const at = nowIso(); e = (r.notes[id] ??= {});
        let msg = text; const m = e.remap; if (m) msg += t('cli.remap', { frame: m.frame, end: m.end != null ? ` → ${m.end}` : '' });
        e.messages = [...(e.messages ?? []), { text: msg, images: imgs.map((file) => ({ file, at })), at, ...(AG ? { by: AG.name } : {}) }];
        e.status = status; e.statusAt = at;
      });
      console.log(t('cli.replied', { id, status, n: imgs.length, m: e.messages.length }));
      return;
    }
    case 'done': {
      const n = +rest[0], L = readLot(P, n); if (!L) die(t('cli.noLot', { n }));
      const mf = finish(P, n);
      const r = changeReplies((r) => {
        const at = nowIso();
        r.lots[n] = { status: flags['--declined'] ? 'declined' : 'done', at, message: rest[1] ?? '', files: mf ? mf.files.filter((x) => x.changed).map((x) => x.rel) : [] };
        for (const e of L.edits) { const x = r.notes[e.id]; if (x?.status === 'working') { x.status = 'open'; x.statusAt = at; } }   // never left « en cours »
      });
      if (L.kind === 'render') { markReviewed(P, rest[1] ?? ''); console.log(t('cli.doneRender', { n })); return; }
      console.log(t('cli.done', { n, status: r.lots[n].status, extra: mf ? t('cli.doneFiles', { k: r.lots[n].files.length }) : t('cli.doneNoSnap') }));
      return;
    }
    case 'render': {
      if (!B) die(t('cli.noRender'));
      const n = rest[0] ? +rest[0] : null, L = n ? readLot(P, n) : null;
      if (n && !L) die(t('cli.noLot', { n }));
      const only = String(flag('--only', PHASES.join(','))).split(',').map((x) => x.trim()).filter((x) => PHASES.includes(x));
      if (!only.length) die(`--only : ${PHASES.join(', ')}`);
      if (n) changeReplies((r) => { if (!r.lots[n]) r.lots[n] = { status: 'taken', at: nowIso() }; });
      const again = `node "${process.argv[1]}" ${argv.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`;
      const S = await runRender(P, { lot: n, only, frames: flag('--frames'), out: flag('--out'), log });
      const hm = (iso) => (iso ? hhmm(iso) : '?');
      for (const c of S.checks) console.log(t('cli.check', { st: c.status === 'ok' ? t('cli.chkOk') : c.status === 'fail' ? t('cli.chkFail') : '…    ', label: c.label, detail: c.detail, judge: c.toJudge ? t('cli.judge', { n: c.toJudge }) : '' }));
      if (S.render?.stage === 'done') console.log(t('cli.rendered', { n: S.render.total, a: hm(S.render.startedAt), b: hm(S.render.endedAt), out: S.render.output ? ` → "${S.render.output}"` : '' }));
      for (const x of S.finish?.steps ?? []) console.log(`  ${x.label}`);
      if (S.state === 'rendered') {
        const lu = S.finish?.loudness ?? {};
        console.log(t('cli.renderDone', { extra: `${S.video ? t('cli.renderVideo', { name: S.video.name }) : ''}${S.finish?.duration ? ` · ${S.finish.duration.toFixed(1)} s` : ''}${lu.I != null ? ` · Integrated ${lu.I} LUFS` : ''}${lu.peak != null ? ` · True peak ${lu.peak} dBTP` : ''}${S.finish?.remapped != null ? t('cli.remapped', { n: S.finish.remapped }) : ''}` }));
        console.log(t('cli.renderNext', { next: n ? `node "${process.argv[1]}" done ${P.ep}${flagsOf(P) ? ' ' + flagsOf(P) : ''} ${n} "${t('cli.sawIt')}"` : t('cli.tellUser') }));
        return;
      }
      if (S.state === 'checked' || S.state === 'rendered-raw') { console.log(t(S.state === 'checked' ? 'cli.checksPassed' : 'cli.rawDone')); return; }
      console.log(t(S.state === 'blocked' ? 'cli.blocked' : S.state === 'cancelled' ? 'cli.cancelled' : 'cli.failed', { error: S.error }));
      if (S.tail.length) console.log(t('cli.lastLines') + S.tail.slice(-8).map((l) => '    ' + l).join('\n'));
      console.log(t('cli.fullLog', { file: path.join(P.REVUE, 'render.log'), extra: S.state === 'cancelled' ? t('cli.byUser') : t('cli.rerun', { cmd: again }) }));
      await closeCode(); process.exit(1);
    }
    case 'undo': {
      const res = step(P, +rest[0], flags['--redo'] ? 'redo' : 'undo', AG?.name ?? t('cli.theAgent'));
      if (!res.ok) die(res.why);
      console.log(t('cli.undo', { n: rest[0], verb: t(flags['--redo'] ? 'cli.redone' : 'cli.undone'), files: res.files.join(', ') }));
      return;
    }
    case 'updates': {
      const u = await checkUpdates(P, { agent: AG ?? agentById('claude'), fresh: true });
      console.log(updatesLine(u)); console.log(''); console.log(updatesMarkdown(u, { cli: `node "${process.argv[1]}"`, target: P.target }).join('\n'));
      return;
    }
    case 'status': {
      const r = replies(), runs = listRuns(P), a = readJson(P.AGENT, null);
      console.log(`${P.ep} · ${P.EP}`);
      console.log(t('cli.watching', { yn: t(a?.waiting && Date.now() - Date.parse(a.beat) < 20000 ? 'cli.yes' : 'cli.no') }));
      for (const n of lotNumbers(P)) {
        const L = readLot(P, n);
        console.log(t('cli.lotLine', { n, k: L.edits.length, at: L.sentAt, status: r.lots[n]?.status ?? t('cli.notTaken'), snap: runs[n] ? t('cli.snap', { state: runs[n].state }) : '' }));
      }
      const drafts = Object.values(notesById()).filter((x) => x.draft).length;
      console.log(t('cli.drafts', { n: drafts }));
      return;
    }
    default: die(t('cli.unknown', { cmd }));
  }
}
main().then(() => closeCode()).then(() => process.exit(0)).catch(async (e) => { await closeCode(); die(t('cli.error', { msg: e.message })); });

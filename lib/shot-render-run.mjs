// « Rendre ce plan » (user request, 09/10/2026): the video of a 3D shot made again from its current code and put back where
// a Short uses it — the shot's .coulisses says it (« utilise »: that Short, that file). Run DETACHED by lib/shot-render.mjs
// (closing the studio does not stop it); its output is revue\shot-render.log, read back for the progress:
//   COULISSES PROGRES <0-100> <step>   ·   COULISSES REMPLACE "<file>"   ·   COULISSES FIN "<file>"
// Never a half-made clip in the Short: the new one is rendered next to it under another name, checked, the old one is
// copied into the shot's revue\shot-backups\ (« Remettre la version d'avant »), and only then renamed onto it. The new
// clip is made like the one it replaces: its size (a 4K clip of a 1080 × 1920 composition: scale 2), its frame rate,
// sound only if it had some. The Short's studio, when open, is asked to refresh its live preview.
// usage: node lib/shot-render-run.mjs <revue of the shot> <use> [--images a-b]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { project } from './projects.mjs';
import { MSTUDIO, isOwnStudio, assertReviewAvailable } from './app-profile.mjs';
import { readCoulisses } from './coulisses-file.mjs';
import { readJson } from './episode.mjs';
import { renderVideo, compositionOf, closeCode } from './frames.mjs';

const [revueArg, useArg] = process.argv.slice(2);
const at = process.argv.indexOf('--images'), range = at > 0 ? process.argv[at + 1].split('-').map(Number) : null;
const say = (pct, step) => console.log(`COULISSES PROGRES ${Math.max(0, Math.min(100, Math.round(pct)))} ${step}`);
const die = (m) => { console.error(`Error: ${m}`); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const probe = (f) => {
  try {
    const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', f], { encoding: 'utf8', windowsHide: true }));
    const v = (j.streams ?? []).find((s) => s.codec_type === 'video'), [a, b] = String(v?.r_frame_rate ?? '0/1').split('/').map(Number);
    return { w: v?.width ?? 0, h: v?.height ?? 0, fps: b ? a / b : 0, audio: (j.streams ?? []).some((s) => s.codec_type === 'audio'), duration: +(j.format?.duration ?? 0) };
  } catch { return null; }
};

const P = project(revueArg), use = (P.uses ?? [])[+useArg];
if (!use) die(`no « utilise » #${useArg} in ${P.coulisses}`);
let host; try { host = readCoulisses(use.coulisses); } catch (e) { die(`${use.coulisses}: ${e.message}`); }
if (!host?.remotion?.projet) die(`${use.coulisses}: no Remotion project`);
assertReviewAvailable(host.revue);
const target = path.join(host.remotion.projet, ...use.fichier.split('/'));
console.log(`plan ${P.title} (${P.remotion.composition}) -> ${target}`);
say(1, 'préparation');
let comp;
try { comp = await compositionOf(P, (m) => console.log(m)); }
catch (e) { await closeCode(); throw e; }
// made like the clip it replaces (else as the composition is, without sound)
const before = fs.existsSync(target) ? probe(target) : null;
const scale = before?.h ? Math.round((before.h / comp.height) * 1000) / 1000 : 1;
const muted = !before?.audio;
console.log(`composition ${comp.width} x ${comp.height}, ${comp.fps} fps, ${comp.durationInFrames} images; clip ${before ? `${before.w} x ${before.h}${before.audio ? ', avec son' : ', muet'}` : 'absent'} -> échelle ${scale}`);
if (before?.fps && Math.abs(before.fps - comp.fps) > 0.01) console.log(`note: the clip was ${before.fps} fps, the composition is ${comp.fps} fps`);
const tmp = target.replace(/\.mp4$/i, '') + '.coulisses-tmp.mp4';
let last = -1;
try {
  try {
    fs.rmSync(tmp, { force: true });
    say(3, 'rendu');
    await renderVideo(P, tmp, {
      scale, muted, frameRange: range, log: (m) => console.log(m),
      onProgress: (p, rendered, encoded) => { const pct = 3 + p * 92; if (Math.floor(pct) !== last) { last = Math.floor(pct); say(pct, `images ${rendered} / ${range ? range[1] - range[0] + 1 : comp.durationInFrames}`); } },
    });
  } finally { await closeCode(); }
} catch (e) {
  fs.rmSync(tmp, { force: true });
  throw e;
}
const made = probe(tmp);
const want = range ? range[1] - range[0] + 1 : comp.durationInFrames;
if (!made || !made.w || Math.abs(made.duration * comp.fps - want) > 2) { fs.rmSync(tmp, { force: true }); die(`the new clip is not right (${made ? `${made.duration}s` : 'unreadable'}), the old one is kept`); }
// the old clip kept, then the new one in its place (a reader may hold the file for an instant: tries for 20 s)
let backup = null;
if (fs.existsSync(target)) {
  const dir = path.join(P.REVUE, 'shot-backups'); fs.mkdirSync(dir, { recursive: true });
  backup = path.join(dir, `${path.basename(target, path.extname(target))}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}${path.extname(target)}`);
  fs.copyFileSync(target, backup);
  console.log(`l'ancien plan gardé : ${backup}`);
}
say(97, 'remplacement');
assertReviewAvailable(host.revue);
console.log(`COULISSES REMPLACE "${target}"`);
fs.mkdirSync(path.dirname(target), { recursive: true });
for (let i = 0; ; i++) {
  try { fs.renameSync(tmp, target); break; } catch (e) {
    if (i >= 40) { fs.rmSync(tmp, { force: true }); die(`${target} stays in use (${e.code}): the old clip is kept`); }
    await sleep(500);
  }
}
// the Short's studio, when open: its live preview refreshed (its lock names it, lib/../studio-server.mjs)
const lock = readJson(path.join(host.revue, 'studio.lock.json'), null);
if (lock?.url && (!MSTUDIO || isOwnStudio(lock))) { try { await fetch(new URL('api/rebuild', lock.url), { method: 'POST', signal: AbortSignal.timeout(5000) }); console.log(`aperçu du Short rafraîchi (${lock.url})`); } catch { /* not open */ } }
say(100, 'fini');
console.log(`COULISSES FIN "${target}"`);
process.exit(0);

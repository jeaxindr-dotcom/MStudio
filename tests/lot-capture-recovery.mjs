// Coupe le premier studio juste après la publication. Un second processus doit
// retrouver les mêmes notes, le film d'origine et le calque après un redémarrage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { waitForRenderIdle } from '../lib/render-activity.mjs';
import { createLot, resumeLotCaptures, readLot, lotNumbers } from '../lib/lots.mjs';

const test = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(test), '..', '.cache', 'reprise-envoi');
fs.mkdirSync(root, {recursive: true});
const run = process.argv[2] ?? fs.mkdtempSync(path.join(root, 'essai-'));
Object.assign(process.env, {COULISSES_LANG: 'fr', COULISSES_SETTINGS: path.join(run, 'settings.json')});
const video = path.join(run, 'source.mp4'), png = path.join(run, 'repere.png');
const p = {kind: 'video', title: 'Reprise', ep: 'Reprise', project: run, target: run, EP: run, REVUE: run,
  LOTS: path.join(run, 'lots'), NOTES: path.join(run, 'notes.json'), REPLIES: path.join(run, 'replies.json'), pickVideo: () => video};
const ids = ['point', 'intervalle'];
const send = () => createLot(p, {ids, marks: {point: 'data:image/png;base64,' + fs.readFileSync(png).toString('base64')}},
  {deferred: true, fps: 25, size: [128, 72]});
if (process.argv[2]) {
  await send();
  process.exit(0);
}
await waitForRenderIdle();
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], {windowsHide: true});
const film = (file, color) => ffmpeg('-f','lavfi','-i', 'color=c='+color+':s=128x72:r=25:d=1','-c:v','libx264',file);
film(video, 'blue');
ffmpeg('-f','lavfi','-i','color=c=yellow:s=128x72','-frames:v','1',png);
fs.writeFileSync(p.NOTES, JSON.stringify({notes: [{id: ids[0], frame: 4, text: 'Point',
  mark: {kind: 'pin', points: [[60, 40]]}, images: [{file:'repere.png'}], thread: [{text:'Précision'}]},
  {id: ids[1], frame: 4, end: 8, text: 'Intervalle'}]}));
const sendAndStop = () => execFileSync(process.execPath, [test, run], {windowsHide: true});
sendAndStop();
const initial = readLot(p, 1);
assert.equal(initial.captureState.status, 'pending');
assert.match(fs.readFileSync(path.join(p.LOTS, '001.md'), 'utf8'), / images .* 1/);
assert.deepEqual(initial.edits[0].captures, {});
assert.equal(initial.edits[0].thread[0].text, 'Précision');
assert.equal(initial.edits[0].images[0].file, png);
sendAndStop();
assert.deepEqual(lotNumbers(p), [1]);
assert.equal(readLot(p, 1).captureState.id, initial.captureState.id);
film(path.join(run,'remplacement.mp4'), 'red');
fs.renameSync(path.join(run,'remplacement.mp4'), video);
fs.writeFileSync(p.NOTES, '{"notes":[]}');
fs.rmSync(png);
resumeLotCaptures(p, () => {});
let final;
for (let i = 0; i < 200; i++) {
  final = readLot(p, 1);
  if (final.captureState.status !== 'pending') break;
  await sleep(100);
}
assert.equal(final.captureState.status, 'ready', JSON.stringify(final.captureState));
assert.equal(final.captureState.done, 2);
for (const e of final.edits) {
  const pixel = ffmpeg('-i',e.captures.image,'-vf','scale=1:1','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-');
  assert.ok(pixel[2] > 200 && pixel[0] < 30, 'Image du film bleu envoyé');
}
for (const f of [final.edits[0].captures.marque, final.edits[0].captures.zoom, final.edits[1].captures.fin]) assert.ok(fs.statSync(f).size > 0);
assert.deepEqual(fs.readFileSync(final.edits[0].captures.image), fs.readFileSync(final.edits[1].captures.image));
assert.equal(fs.readFileSync(path.join(p.LOTS, '001.md'), 'utf8').includes('images sont en préparation'), false);

// Au-delà de la fin, ffmpeg peut retourner 0 sans créer de JPEG.
// Cette note ne doit pas recevoir l'image valide de la note précédente.
fs.writeFileSync(p.NOTES, JSON.stringify({notes: [
  {id:'valide', frame:1, text:'Première'}, {id:'hors-film', frame:2000, text:'Après la fin'},
]}));
await createLot(p, {ids:['valide','hors-film']}, {fps:25, size:[128,72]});
const incomplete = readLot(p, 2);
assert.equal(incomplete.captureState.status, 'error');
assert.ok(fs.existsSync(incomplete.edits[0].captures.image));
assert.ok(incomplete.edits[1].captures.error);
assert.equal(incomplete.edits[1].captures.image, undefined);
console.log('2 ok, 0 ko');

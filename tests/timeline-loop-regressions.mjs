// Régression N1 : --baseline exécute la boucle réelle de 10633a9 et doit échouer.
// Dépendances simulées dans une VM ; aucun navigateur, média ou rendu.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cible = 'page/studio/08-timeline.js', baseline = process.argv.includes('--baseline');
const source = baseline ? execFileSync('git', ['show', `10633a9:${cible}`], { cwd: base, encoding: 'utf8' }) : fs.readFileSync(path.join(base, cible), 'utf8');
const debut = source.indexOf('(function tick() {');
if (debut < 0) throw new Error('Boucle de la frise introuvable');
const code = source.slice(debut);
const resultats = [];
let ok = 0, ko = 0;

function verifier(faute, imageFixe) {
  const file = [], trace = [];
  let levee = false, dessins = 0;
  const ctx = {
    shuttleBackStep() {}, M: { paused: true, currentTime: 0 }, shuttle: 0,
    curFrame: () => 1, view: { a: 0, b: 10 }, lastView: imageFixe ? 'ancienne vue' : '',
    lastF: imageFixe ? 1 : -1, pickPt: null, hideHover() {}, drag: null,
    DUR: 10, FPS: 30, rangeStart:null, movePlayhead() {}, window: { __cgReady: true },
    requestAnimationFrame: (f) => file.push(f),
  };
  for (const nom of ['updateHud', 'draw', 'drawOv', 'showShot', 'cgTick']) {
    ctx[nom] = () => {
      if (nom === faute && !levee) { levee = true; throw new RangeError(`erreur simulée : ${nom}`); }
      if (nom === 'draw') dessins++;
    };
  }
  const capture = (f) => { try { f(); } catch (e) { trace.push(e.message); } };
  capture(() => vm.runInNewContext(code, ctx));
  const prochain = file.length;
  if (file.length) capture(file.shift());
  const reussi = prochain === 1 && file.length === 1 && dessins >= 1 && trace.length === 1;
  reussi ? ok++ : ko++;
  console.log(`  ${reussi ? '✓' : '✗'} ${faute}, ${imageFixe ? 'image arrêtée' : 'image changée'} : reprise unique et dessin réussi`);
  resultats.push({ faute, imageFixe, prochain, dessins, demandesApresReprise: file.length, trace, reussi });
}
for (const faute of ['updateHud', 'draw', 'drawOv', 'showShot', 'cgTick']) for (const imageFixe of [false, true]) verifier(faute, imageFixe);
const dossier = path.join(base, '.cache', 'timeline-loop-regressions');
fs.mkdirSync(dossier, { recursive: true });
fs.writeFileSync(path.join(dossier, baseline ? 'reference.json' : 'corrige.json'), JSON.stringify({ reference: baseline ? '10633a9' : 'worktree', ok, ko, resultats }, null, 2));
console.log(`${ok} ok, ${ko} ko`);
process.exitCode = ko ? 1 : 0;

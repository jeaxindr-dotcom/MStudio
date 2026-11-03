// Régressions G12/G13 : la même suite échoue avec --baseline (10633a9) et passe avec le constructeur corrigé.
// Le vrai esbuild construit un petit module JSX/CSS/SVG. Aucun navigateur, installation ou projet réel modifié.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { remotionModules, skip } from './where.mjs';
import { renderActivity } from '../lib/render-activity.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv.includes('--baseline'), label = baseline ? 'reference' : 'corrige';
const SCR = path.join(STUDIO, '.cache', 'player-build-regressions', label);
const MODULES = remotionModules(); if (!MODULES) skip('dépendances Remotion absentes', 'COULISSES_TEST_REMOTION');
const PROJECT = path.join(SCR, 'projet'), RUNTIME = path.join(SCR, 'runtime');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ok = 0, ko = 0;
const checks = [], guards = [];
function check(value, name, detail = null) { value ? ok++ : ko++; checks.push({ reussi: !!value, nom: name, detail }); console.log(`  ${value ? '✓' : '✗'} ${name}`); }
async function guard() {
  for (;;) {
    const running = (await renderActivity()).map((item) => item.port);
    guards.push({ date: new Date().toISOString(), actifs: running });
    if (!running.length) return;
    console.log(`  Attente : rendu ou export actif sur ${running.join(', ')}.`); await sleep(5000);
  }
}
const write = (file, body) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
const component = (text = 'une') => `import React from 'react'; import './style.css'; import image from './image.svg';
export const compositions = [{id:'ESSAI', component:()=> <div className="image"><img src={image}/>Version ${text}</div>,fps:30,width:320,height:180,durationInFrames:30}];`;
const main = path.join(PROJECT, 'src', 'coulisses.tsx');
const css = path.join(PROJECT, 'src', 'style.css'), svg = path.join(PROJECT, 'src', 'image.svg');
// Suppression limitée au dossier exact de cette suite ; la jonction est retirée séparément.
if (!path.resolve(SCR).startsWith(path.join(STUDIO, '.cache') + path.sep)) throw new Error('Bac à sable incorrect');
const nm = path.join(PROJECT, 'node_modules');
if (fs.existsSync(nm)) fs.rmSync(nm);
fs.rmSync(SCR, { recursive: true, force: true });
write(path.join(PROJECT, 'package.json'), '{"private":true}'); fs.symlinkSync(MODULES, nm, 'junction');
write(main, component()); write(css, '.image{color:red;background-image:url("./image.svg")}');
write(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><path fill="red" d="M0 0h2v2H0z"/></svg>');
// L'entrée de test évite que les modifications parallèles du Player changent le contenu du scénario.
write(path.join(RUNTIME, 'player', 'remotion.tsx'), "import {compositions} from '@coulisses-module'; (window as any).__essai = compositions;\n");
let source = baseline ? execFileSync('git', ['show', '10633a9:lib/player-build.mjs'], { cwd: STUDIO, encoding: 'utf8' }) : fs.readFileSync(path.join(STUDIO, 'lib', 'player-build.mjs'), 'utf8');
source = source.replace("const STUDIO = path.resolve(HERE, '..');", `const STUDIO = ${JSON.stringify(RUNTIME)};`)
  .replace("'./place.mjs'", JSON.stringify(pathToFileURL(path.join(STUDIO, 'lib', 'place.mjs')).href))
  .replace("'./i18n.mjs'", JSON.stringify(pathToFileURL(path.join(STUDIO, 'lib', 'i18n.mjs')).href))
  .replace("'./require-context.mjs'", JSON.stringify(pathToFileURL(path.join(STUDIO, 'lib', 'require-context.mjs')).href));
const modulePath = path.join(SCR, 'constructeur.mjs'); write(modulePath, source);
const { playerBuilder } = await import(pathToFileURL(modulePath).href);
let notifications = 0;
const options = { remotionDir: PROJECT, log: () => {}, generic: { module: main, composition: 'ESSAI', tag: `regressions-${label}` } };
const builder = playerBuilder({ ...options, onBuilt: () => { notifications++; } });
const build = async () => { await guard(); await builder.build(); if (builder.state.status !== 'ready') throw new Error(builder.state.error ?? 'Construction non prête'); };
const initialSource = component();
let interrupted;
try {
  await build();
  const initial = { ...builder.state }, firstFile = initial.file, firstBytes = fs.readFileSync(firstFile);
  check(initial.version === 1, 'Première publication numérotée');
  const release1 = builder.getRelease?.(1);
  check(!!release1?.hash && release1.css === 'player.css', 'JS et CSS appartiennent à une génération publiée');
  builder.retain?.(1, 'fenetre-test');

  write(path.join(PROJECT, 'src', 'hors-graphe.ts'), 'export const invisible = 12;'); await build();
  check(builder.state.version === initial.version, 'Un fichier hors graphe ne change pas la version');
  write(main, initialSource + '\n// Commentaire sans effet visuel\n'); await build();
  check(builder.state.version === initial.version, 'Un commentaire ne change pas la version');
  check(notifications === 3, 'La frise reçoit encore les trois notifications de construction');

  const beforeCss = builder.state.version;
  write(css, '.image{color:blue;background-image:url("./image.svg")}'); await build();
  check(builder.state.version === beforeCss + 1, 'Une modification CSS publie une nouvelle génération');
  check(fs.existsSync(firstFile) && fs.readFileSync(firstFile).equals(firstBytes), 'Le premier JS reste identique après la nouvelle publication');
  const release2 = builder.getRelease?.();
  const text2 = fs.readFileSync(builder.state.file, 'utf8');
  const assetPaths = [...text2.matchAll(/\/player-assets\/([a-f0-9]{64})\/([^"'\s]+\.svg)/g)];
  check(assetPaths.length > 0 && assetPaths.every((m) => m[1] === release2?.hash && !!builder.asset?.(m[1], m[2])), 'Les URL des images pointent vers cette même génération');
  check(!!release2 && /color:\s*blue/.test(fs.readFileSync(builder.asset(release2.hash, release2.css), 'utf8')), 'La feuille CSS publiée correspond au code demandé');
  check(builder.asset?.(release2?.hash, '../player.js') === null && builder.asset?.(release2?.hash, 'inconnu.js') === null, 'Seuls les fichiers publiés sont accessibles');

  const beforeAsset = builder.state.version;
  const fixedTime = new Date('2020-01-02T03:04:05Z');
  write(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><path fill="green" d="M0 0h2v2H0z"/></svg>'); fs.utimesSync(svg, fixedTime, fixedTime); await build();
  check(builder.state.version === beforeAsset + 1, 'Une modification du contenu d’une image crée une génération');
  const beforePreservedAsset = { ...builder.state };
  write(svg, fs.readFileSync(svg, 'utf8').replace('green', 'black')); fs.utimesSync(svg, fixedTime, fixedTime); await build();
  const assetJs = fs.readFileSync(builder.state.file, 'utf8'), assetUrl = /\/player-assets\/([a-f0-9]{64})\/([^"'\s]+\.svg)/.exec(assetJs);
  const updatedAsset = assetUrl && builder.asset?.(assetUrl[1], assetUrl[2]);
  check(builder.state.hash !== beforePreservedAsset.hash && updatedAsset && fs.readFileSync(updatedAsset, 'utf8').includes('black'), 'Une image modifiée à taille et date constantes est réellement relue');
  const beforeJs = builder.state.version;
  write(main, component('deux')); fs.utimesSync(main, fixedTime, fixedTime); await build();
  check(builder.state.version === beforeJs + 1, 'Une modification JSX crée une génération');
  const beforePreservedJs = { ...builder.state };
  write(main, component('troi')); fs.utimesSync(main, fixedTime, fixedTime); await build();
  check(builder.state.hash !== beforePreservedJs.hash && fs.readFileSync(builder.state.file, 'utf8').includes('Version troi'), 'Le JSX modifié à taille et date constantes est réellement recompilé');
  check(fs.existsSync(firstFile) && fs.readFileSync(firstFile).equals(firstBytes), 'Le code de la première génération ne change pas quand le JSX suivant change');
  check(!!builder.getRelease?.(1) && fs.existsSync(firstFile), 'Une ancienne génération retenue survit au-delà des trois dernières');

  const good = { ...builder.state }, goodBytes = fs.readFileSync(builder.state.file);
  write(main, 'export const compositions = <invalide'); await guard(); await builder.build();
  check(builder.state.status === 'error' && builder.state.version === good.version && fs.existsSync(good.file) && fs.readFileSync(good.file).equals(goodBytes), 'Une erreur de compilation conserve la publication précédente');
  check(!!builder.getRelease?.(good.version) && builder.getRelease?.(999999) === null, 'Les versions connues restent accessibles, les inconnues sont refusées');
  builder.release?.('fenetre-test'); builder.collect?.();
  check(builder.getRelease?.(1) === null && !fs.existsSync(firstFile), 'La génération ancienne libérée est collectée, sans rétention illimitée');
  check(!!builder.getRelease?.(good.version), 'La collecte conserve la génération courante');

  write(main, component('trois'));
  const watchersBefore = process._getActiveHandles().filter((h) => h.constructor.name === 'FSWatcher').length;
  builder.watch(); builder.watch();
  await builder.dispose(); await sleep(20);
  const watchersAfter = process._getActiveHandles().filter((h) => h.constructor.name === 'FSWatcher').length;
  check(watchersAfter <= watchersBefore, 'Arrêter le constructeur ferme ses surveillances de fichiers');
  const notified = notifications; write(main, component('quatre')); await sleep(400);
  check(builder.state.status === 'disposed' && notifications === notified, 'Aucune reconstruction ni notification après l’arrêt');

  interrupted = playerBuilder({ ...options, generic: { ...options.generic, tag: `interruption-${label}` }, onBuilt: () => { notifications++; } });
  await guard();
  const beforeInterrupted = notifications, pending = interrupted.build();
  await interrupted.dispose(); await pending;
  check(interrupted.state.version === 0 && notifications === beforeInterrupted, 'Une construction arrêtée avant publication ne devient pas visible');
} catch (error) { check(false, 'Exécution des régressions', error.stack); console.error(error.stack); }
finally {
  await builder.dispose(); await interrupted?.dispose();
  write(path.join(SCR, 'resultat.json'), JSON.stringify({ reference: baseline ? '10633a9' : 'branche courante', checks, guards, ok, ko }, null, 2));
}
console.log(`\n${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);

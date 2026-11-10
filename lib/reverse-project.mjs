import fs from 'node:fs';
import { assertReviewAvailable } from './app-profile.mjs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {readJsonStrict, updateJson, writeJson} from './episode.mjs';
import {createCoulisses} from './coulisses-file.mjs';
import {DEPS, exportScript, projectsRoot, slugOf, workspace} from './new-project.mjs';
import {lang, t} from './i18n.mjs';
import {prepareReverseMedia} from './reverse-analysis.mjs';
import {validateReverseShots} from './reverse-template/model.mjs';
export {validateReverseShots} from './reverse-template/model.mjs';

const template = fileURLToPath(new URL('./reverse-template/', import.meta.url));
const WORK_MEDIA = 'media/source.mp4';
const invalid = (message, status = 400) => Object.assign(new Error(message), {status});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function checkFormat(analysis) {
  if (!analysis || !['width','height','fpsNumerator','fpsDenominator','frames'].every(k =>
    Number.isSafeInteger(analysis[k]) && analysis[k] > 0) ||
    typeof analysis.hasAudio !== 'boolean' || !/^[a-f0-9]{64}$/i.test(analysis.sha256))
    throw invalid('L’analyse vidéo est incomplète.');
}

export function defaultReverseShots(analysis) {
  const ends = [0, ...analysis.cuts, analysis.frames];
  return validateReverseShots(ends.slice(1).map((end,i) => ({
    id:'plan-' + (i + 1), label:'Plan ' + (i + 1), sourceIn:ends[i], sourceOut:end,
  })), analysis);
}

function dependencyVersions(modules) {
  const ws = workspace(path.dirname(modules));
  if (path.basename(modules) !== 'node_modules' || !ws.ready) {
    throw invalid(t('np.err.notInstalled', {list:ws.missing.join(', ')}), 422);
  }
  // Pin the runtime that the project actually uses. Removing the junction and
  // installing package.json later reproduces that runtime on another computer.
  return Object.fromEntries(Object.keys(DEPS).map(pkg => {
    const meta = readJsonStrict(path.join(modules, pkg, 'package.json'), null);
    if (!meta?.version) throw invalid(t('np.err.notInstalled', {list:pkg}), 422);
    return [pkg, meta.version];
  }));
}

function publish(staging, root, basename) {
  for (let i = 1; ; i++) {
    const finalDir = path.join(root, i === 1 ? basename : basename + '-' + i);
    if (fs.lstatSync(finalDir, {throwIfNoEntry:false})) continue;
    try { fs.renameSync(staging, finalDir); return finalDir; }
    catch (e) { if (!fs.lstatSync(finalDir, {throwIfNoEntry:false})) throw e; }
  }
}

function projectGuide(fr) {
  return fr ? `# Montage Reverse

Édite les plans dans \`src/montage.json\`. L’ordre du tableau fixe l’ordre de lecture. Les bornes sourceIn et sourceOut sont exprimées en images sur la cadence du projet. La première est incluse, la dernière exclue. La composition recalcule la durée du montage et recale le son après chaque coupe.

Chaque plan conserve les pixels de la référence. Modifie x, y et zoom pour le recadrer. Le champ title ajoute un texte React indépendant à ce plan. titleX, titleY, titleWidth et titleSize sont en pixels de composition. Un cartouche titleBackground opaque peut couvrir un texte déjà incrusté si sa position et sa taille correspondent. Le calque facultatif inset extrait un rectangle animé du plan. Règle sourceX, sourceY, width et height pour choisir les pixels, puis x, y et scale pour placer la copie. mask permet de couvrir l’emplacement d’origine avec une couleur unie. Les pixels cachés derrière le sujet restent inconnus.

La composition est dans \`src/Scene.tsx\`, la timeline Coulisses dans \`src/coulisses-timeline.ts\` et la provenance du média dans \`reverse.json\`. Dans Coulisses, ouvre le fichier .coulisses et choisis **Code actuel** pour voir tes modifications. En ligne de commande, \`npm run studio\` ouvre Remotion Studio et \`npm run render\` exporte le montage vers out/. Pour déplacer le projet sur un autre poste, copie ses fichiers et ses médias, puis installe ses dépendances dans le nouveau dossier avec npm install.
` : `# Reverse edit

Edit the shots in \`src/montage.json\`. Array order is playback order. sourceIn is inclusive and sourceOut exclusive, in project frames. Shot durations and the sound edit follow those values. x, y and zoom reframe the clip. title creates an independent React text layer. titleX, titleY, titleSize and titleWidth use composition pixels. An opaque titleBackground can cover a burned-in title when aligned to its location. An optional inset layer extracts an animated rectangle using sourceX, sourceY, width and height. x, y and scale position the result, and mask can cover the original rectangle with a solid color. The pixels behind a subject are unknown.

The React composition is in \`src/Scene.tsx\`, the Coulisses timeline in \`src/coulisses-timeline.ts\` and source provenance in \`reverse.json\`. Open the .coulisses file and choose **Current code** to review edits. Use \`npm run studio\` to open Remotion Studio or \`npm run render\` to export to out/. To move the project to another machine, copy its files and media, then install its dependencies there with npm install.
`;
}

export async function createReverseProject({name, analysis, shots, sourcePath, root = projectsRoot(), modules, signal, onProgress = () => {}}) {
  if (typeof name !== 'string' || !name.trim() || name.length > 120) throw invalid('Donne un nom au projet (120 caractères maximum).');
  checkFormat(analysis);
  const edit = shots == null ? defaultReverseShots(analysis) : validateReverseShots(shots, analysis);
  const title = name.trim();
  const basename = 'reverse-' + slugOf(title);
  root = path.resolve(root);
  modules = path.resolve(modules ?? path.join(root, 'node_modules'));
  const dependencies = dependencyVersions(modules);
  const original = path.resolve(sourcePath ?? analysis.sourcePath);
  const ext = path.extname(original).toLowerCase();
  if (!/^\.[a-z0-9]{1,10}$/.test(ext)) throw invalid('Extension de fichier vidéo incorrecte.');
  signal?.throwIfAborted();
  fs.mkdirSync(root, {recursive:true});
  const staging = fs.mkdtempSync(path.join(root, '.reverse-stage-'));
  const link = path.join(staging, 'node_modules');
  let published = false;
  try {
    const media = path.join(staging, 'public', WORK_MEDIA);
    fs.mkdirSync(path.dirname(media), {recursive:true});
    const reference = analysis.needsNormalization ? 'reference/original' + ext : 'public/' + WORK_MEDIA;
    const sourceInProject = path.join(staging, reference);
    let input = original;
    if (analysis.needsNormalization) {
      fs.mkdirSync(path.dirname(sourceInProject), {recursive:true});
      await pipeline(fs.createReadStream(original), fs.createWriteStream(sourceInProject, {flags:'wx'}), {signal});
      input = sourceInProject;
    }
    await prepareReverseMedia(input, analysis, media, {signal, onProgress});
    signal?.throwIfAborted();
    fs.cpSync(template, path.join(staging, 'src'), {recursive:true});
    fs.symlinkSync(modules, link, 'junction');
    const fmt = {width:analysis.width, height:analysis.height, fpsNumerator:analysis.fpsNumerator,
      fpsDenominator:analysis.fpsDenominator, frames:analysis.frames, hasAudio:analysis.hasAudio};
    writeJson(path.join(staging, 'src', 'montage.json'), {version:1, ...fmt, media:WORK_MEDIA, language:lang(), shots:edit});
    const {sourcePath:unused, ...details} = analysis;
    writeJson(path.join(staging, 'reverse.json'), {kind:'coulisses-reverse', version:1, name:title,
      originalName:path.basename(original), reference, workingMedia:'public/' + WORK_MEDIA, analysis:details});
    writeJson(path.join(staging, 'package.json'), {name:'coulisses-reverse', private:true, version:'1.0.0',
      scripts:{studio:'remotion studio src/index.ts', render:'node scripts/coulisses-rendu.mjs --composition Reverse --dossier out --qualite final'}, dependencies});
    fs.mkdirSync(path.join(staging, 'scripts'));
    fs.writeFileSync(path.join(staging, 'scripts', 'coulisses-rendu.mjs'), exportScript(basename, lang()));
    const guide = projectGuide(lang() === 'fr');
    for (const filename of ['AGENTS.md','CLAUDE.md']) fs.writeFileSync(path.join(staging, filename), guide);
    const descriptor = createCoulisses({dossier:staging, nom:basename, titre:title, projet:staging, composition:'Reverse',
      format:fmt.width + '×' + fmt.height, exportDossier:'out', exportMotif:'\\.mp4$'});
    const metadata = readJsonStrict(descriptor, null);
    writeJson(descriptor, {...metadata, origine:'coulisses', reverse:1});
    signal?.throwIfAborted();
    const dir = publish(staging, root, basename);
    published = true;
    return {dir, file:path.join(dir, path.basename(descriptor))};
  } finally {
    if (!published) {
      if (fs.lstatSync(link, {throwIfNoEntry:false})?.isSymbolicLink()) fs.unlinkSync(link);
      fs.rmSync(staging, {recursive:true, force:true, maxRetries:4, retryDelay:150});
    }
  }
}

function ownedFile(root, relative) {
  const file = fs.realpathSync(path.resolve(root, relative));
  const rel = path.relative(root, file);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) || !fs.statSync(file).isFile())
    throw invalid('Fichier hors du projet Reverse.');
  return file;
}

function readState(dir) {
  const root = fs.realpathSync(dir);
  const manifest = readJsonStrict(ownedFile(root, 'reverse.json'), null);
  if (manifest?.kind !== 'coulisses-reverse' || manifest.version !== 1 ||
    !(manifest.reference === 'public/' + WORK_MEDIA || /^reference\/original\.[a-z0-9]{1,10}$/.test(manifest.reference)))
    throw invalid('Manifeste Reverse incorrect.');
  checkFormat(manifest.analysis);
  return {manifest, sourcePath:ownedFile(root, manifest.reference), file:ownedFile(root, 'src/montage.json')};
}

export function readReverseProject(dir) {
  const {manifest, file, sourcePath} = readState(dir);
  const raw = fs.readFileSync(file), data = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
  return {name:manifest.name, analysis:{...manifest.analysis, sourcePath}, sourcePath,
    shots:validateReverseShots(data.shots, manifest.analysis), revision:sha(raw)};
}

export function updateReverseProject(dir, {shots, revision}) {
  assertReviewAvailable(path.join(dir, 'revue'));
  const {manifest, file} = readState(dir);
  const edit = validateReverseShots(shots, manifest.analysis);
  updateJson(file, null, current => {
    if (!current || revision !== sha(fs.readFileSync(file)))
      throw invalid('Le montage a changé. Recharge la version actuelle avant d’enregistrer.', 409);
    const originals = new Map(current.shots.map(s => [s.id, s]));
    return {...current, shots:edit.map(s => ({...originals.get(s.id), ...s}))};
  });
  return readReverseProject(dir);
}

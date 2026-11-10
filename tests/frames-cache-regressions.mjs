// Signature du bundle, puis vérification des pixels de deux registres d'une même fixture.
// --baseline emploie uniquement le prepare() simulé de 10633a9.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { remotionModules } from './where.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), baseline = process.argv.includes('--baseline');
const source = baseline ? execFileSync('git', ['show', '10633a9:lib/frames.mjs'], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(path.join(root, 'lib', 'frames.mjs'), 'utf8');
const code = source.slice(source.indexOf('async function prepare('), source.indexOf('export async function closeCode()'));
fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
const cache = fs.mkdtempSync(path.join(root, '.cache', 'frames-signature-'));
const builds = [], states = new Map();
let ok = 0, ko = 0;
const check = (v, nom) => { v ? ok++ : ko++; console.log(`  ${v ? '✓' : '✗'} ${nom}`); };
const context = {
  fs, path, crypto, CACHE: cache, codeState: states, CHROME: 'aucun-navigateur', process,
  srcSignature: () => 'date-identique-compte-identique', touch() {}, sweepBundles() {}, cacheReadme() {}, t: (x) => x,
  remotionApis: async () => ({
    bundle: async (opts) => { builds.push(opts); fs.mkdirSync(path.join(opts.outDir, 'public'), { recursive: true }); },
    r: { openBrowser: async () => ({}), selectComposition: async () => ({ id: 'TEST' }) },
  }),
};
vm.runInNewContext(code + '\nglobalThis.prepareTest = prepare;', context);
const project = { remotionDir: path.join(cache, 'projet'), remotion: { entree: path.join(cache, 'src', 'index.ts'), composition: 'TEST' } };

async function checkRenderedEntries(modules) {
  // Les dépendances restent partagées en lecture. Les bundles et le cache Webpack
  // de cette fixture ont leur propre répertoire, même lorsque ce test est lancé seul.
  const { webpackTestCacheDir } = await import('./isolation-runtime.mjs');
  const { codeFrame, codeFrames, tile, closeCode } = await import('../lib/frames.mjs');
  const dir = path.join(cache, 'moteur'), link = path.join(dir, 'node_modules');
  const defaultEntry = path.join(dir, 'src', 'index.tsx'), runEntry = path.join(dir, 'src', 'long08', 'index.tsx');
  fs.mkdirSync(path.dirname(runEntry), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name: 'fixture-registres', private: true}));
  const registry = (id, backgroundColor) => `import React from 'react';
import { AbsoluteFill, Composition, registerRoot } from 'remotion';
const Scene = () => <AbsoluteFill style={{backgroundColor: ${JSON.stringify(backgroundColor)}}} />;
registerRoot(() => <Composition id=${JSON.stringify(id)} component={Scene} durationInFrames={2} fps={25} width={64} height={36} />);`;
  fs.writeFileSync(defaultEntry, registry('Default', 'red'));
  fs.writeFileSync(runEntry, registry('Long08', 'blue'));
  fs.symlinkSync(modules, link, 'junction');
  const from = (entree, composition) => ({kind: 'remotion', remotionDir: dir, remotion: {entree, composition}});
  const rgb = (image, x = 0) => execFileSync('ffmpeg', ['-v', 'error', '-i', image, '-vf', `crop=2:2:${x}:0`, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']).subarray(0, 3);
  const still = path.join(cache, 'image.jpg'), sheet = path.join(cache, 'planche.jpg');
  try {
    await codeFrame(from(defaultEntry, 'Default'), 0, still);
    const red = rgb(still);
    check(red[0] > 235 && red[1] < 10 && red[2] < 10, 'La capture réelle du registre principal est rouge');
    const clips = await codeFrames(from(runEntry, 'Long08'), 0, 1, 1, path.join(cache, 'images'));
    await tile(clips, sheet, {cols: 2, width: 64});
    check(clips.length === 2 && [0, 64].every(x => {
      const blue = rgb(sheet, x);
      return blue[2] > 235 && blue[0] < 10 && blue[1] < 10;
    }), 'Les deux cellules de la planche réelle utilisent la composition bleue du registre imbriqué');
  } finally {
    await closeCode();
    fs.unlinkSync(link);
    fs.rmSync(webpackTestCacheDir(dir), {recursive: true, force: true});
    const engineHash = crypto.createHash('sha1').update(dir.toLowerCase()).digest('hex').slice(0, 8);
    const bundles = new RegExp('^bundle-' + engineHash + '-v[0-9a-f]{8}$');
    for (const name of fs.readdirSync(path.join(root, '.cache')).filter(n => bundles.test(n))) {
      const bundle = path.join(root, '.cache', name);
      const signature = JSON.parse(fs.readFileSync(path.join(bundle, 'studio-signature.txt'), 'utf8'));
      if ([defaultEntry, runEntry].includes(signature[0])) fs.rmSync(bundle, {recursive: true, force: true});
    }
  }
}
try {
  await context.prepareTest(project, () => {}, { cacheKey: 'hash-a:media-a' });
  const initial = states.get(project.remotionDir).serveUrl;
  await context.prepareTest(project, () => {}, { cacheKey: 'hash-a:media-a' });
  check(builds.length === 1, 'La même signature réutilise son bundle');
  await context.prepareTest(project, () => {}, { cacheKey: 'hash-b:media-a' });
  check(builds.length === 2 && states.get(project.remotionDir).serveUrl !== initial, 'Un nouveau hash recompile malgré des dates et comptes de fichiers identiques');
  await context.prepareTest(project, () => {}, { cacheKey: 'hash-b:media-b' });
  check(builds.length === 3, 'Une modification des médias invalide aussi le bundle');
  check(builds.every((x) => x.enableCaching === false), 'Aucun cache de compilation n’est écrit dans le projet pour les plages');
  check(states.get(project.remotionDir).sig.includes('code-playback:hash-b:media-b'), 'La signature complète est conservée avec le bundle');
  const other = {...project, remotion:{...project.remotion, entree:path.join(cache,'src','long08','index.ts')}};
  const before = states.get(project.remotionDir).serveUrl;
  await context.prepareTest(other, () => {}, {cacheKey:'hash-b:media-b'});
  check(builds.length === 4 && states.get(project.remotionDir).serveUrl !== before && builds.at(-1).entryPoint === other.remotion.entree, 'Deux entrées du même projet utilisent leurs propres registres');
  if (!baseline) {
    const modules = remotionModules();
    if (modules) await checkRenderedEntries(modules);
    else console.log('  (rendu réel sauté : COULISSES_TEST_REMOTION pour indiquer le moteur)');
  }
} finally {
  const resolved = path.resolve(cache), parent = path.resolve(root, '.cache');
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('frames-signature-')) throw new Error('Nettoyage hors du bac à sable refusé');
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`${ok} ok, ${ko} ko`); process.exitCode = ko ? 1 : 0;

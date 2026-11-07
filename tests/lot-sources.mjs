import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { freezeLotSources, captureProject, checkLotSources } from '../lib/lot-sources.mjs';

const cache = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.cache/tests-lot-sources');
fs.mkdirSync(cache, { recursive: true });
function fixture() {
  const base = fs.mkdtempSync(path.join(cache, 'cas-')), root = path.join(base, 'projet');
  function file(rel, value = '') {
    const name = path.join(root, rel);
    fs.mkdirSync(path.dirname(name), { recursive: true }); fs.writeFileSync(name, value); return name;
  }
  const entry = file('src/index.ts', 'version A'), props = { couleur: 'bleu' };
  file('package.json', '{}'); file('node_modules/module/package.json', '{}');
  const p = { kind: 'remotion', remotionDir: root, remotion: { projet: root, entree: entry, composition: 'Test', props }, EP: root, REVUE: path.join(root, 'revue'), pickVideo: () => null };
  return { p, base, root, dir: path.join(base, 'prive'), file, entry, props };
}

test('le code, les imports hors de src, les props et les données Brambleshire restent ceux de l’envoi après reprise', async () => {
  for (const kind of ['remotion', 'brambleshire']) {
    const { p, dir, file, entry, props } = fixture(); p.kind = kind;
    if (kind === 'brambleshire') delete p.remotion;
    const importFile = kind === 'remotion' ? 'assets/commun/couleurs.ts' : 'episodes/e29.config.json';
    file(importFile, 'original'); file('revue/lots/001.json', 'ancien');
    const sources = await freezeLotSources(p, { code: true, dir });
    fs.writeFileSync(entry, 'version B'); file(importFile, 'modifié'); props.couleur = 'rouge';
    const frozen = captureProject(p, JSON.parse(JSON.stringify(sources)));
    assert.equal(fs.readFileSync(path.join(frozen.remotionDir, 'src/index.ts'), 'utf8'), 'version A');
    assert.equal(fs.readFileSync(path.join(frozen.remotionDir, importFile), 'utf8'), 'original');
    assert.ok(!fs.existsSync(path.join(frozen.remotionDir, 'revue/lots/001.json')));
    if (p.remotion) {
      assert.equal(frozen.remotion.entree, path.join(frozen.remotionDir, 'src/index.ts'));
      assert.equal(frozen.remotion.props.couleur, 'bleu');
    }
    await checkLotSources(sources, 'code');
  }
});

test('un média public modifié à taille et date conservées invalide la capture après reprise', async () => {
  const { p, file, dir } = fixture(), media = file('public/images/chat.jpg', 'abc');
  const time = new Date('2026-01-01T00:00:00Z'); fs.utimesSync(media, time, time);
  const sources = await freezeLotSources(p, { code: true, dir });
  await new Promise((r) => setTimeout(r, 30));
  fs.writeFileSync(media, 'xyz'); fs.utimesSync(media, time, time);
  await assert.rejects(() => checkLotSources(JSON.parse(JSON.stringify(sources)), 'code'), /média/i);
});

test('le MP4 est encore celui de l’envoi après remplacement, une réécriture en place est détectée', async () => {
  const { p, file, dir } = fixture(), video = file('film.mp4', 'un film'); p.pickVideo = () => video;
  const sources = await freezeLotSources(p, { video: true, dir });
  fs.renameSync(file('nouveau.mp4', 'autre film'), video);
  assert.equal(fs.readFileSync(sources.video, 'utf8'), 'un film');
  await checkLotSources(sources, 'video');
  fs.writeFileSync(sources.video, 'altéré');
  await assert.rejects(() => checkLotSources(sources, 'video'), /vidéo/i);
  await checkLotSources(sources, 'code');
});

test('le projet HyperFrames retrouve sa page et ses imports au même chemin relatif', async () => {
  const { p, root, file, dir } = fixture();
  p.kind = 'hyperframes'; p.hf = { projet: root, index: 'index.html' };
  file('index.html', '<script src="scripts/piste.js"></script>'); file('scripts/piste.js', 'avant');
  const sources = await freezeLotSources(p, { code: true, dir });
  file('scripts/piste.js', 'après');
  const frozen = captureProject(p, JSON.parse(JSON.stringify(sources)));
  assert.equal(fs.readFileSync(path.join(frozen.hf.projet, 'scripts/piste.js'), 'utf8'), 'avant');
  assert.ok(fs.existsSync(path.join(frozen.hf.projet, frozen.hf.index)));
});

test('sur deux volumes, un MP4 remplacé est refusé dès la vérification', async () => {
  const { p, file, dir } = fixture(), original = file('film.mp4', 'avant');
  p.pickVideo = () => original;
  const realLink = fs.linkSync;
  fs.linkSync = () => { throw Object.assign(new Error('volumes distincts'), { code: 'EXDEV' }); };
  let sources;
  try { sources = await freezeLotSources(p, { video: true, dir }); }
  finally { fs.linkSync = realLink; }
  assert.equal(sources.video, original);
  fs.renameSync(file('nouveau.mp4', 'après'), original);
  await assert.rejects(() => checkLotSources(sources, 'video'), /vidéo/i);
});

test('une édition en cours de copie refuse un assemblage de révisions', async () => {
  const { p, dir, entry } = fixture(), realCopy = fs.copyFileSync;
  let changed = false;
  fs.copyFileSync = function(from, to, ...options) {
    realCopy(from, to, ...options);
    if (from === entry) { fs.writeFileSync(entry, 'version B'); changed = true; }
  };
  try { await assert.rejects(() => freezeLotSources(p, { code: true, dir }), /modifiée pendant la copie/); }
  finally { fs.copyFileSync = realCopy; }
  assert.ok(changed);
});

test('le grand inventaire repère le remplacement d’une dépendance et ignore le cache de compilation', async () => {
  const { p, dir, file } = fixture();
  for (let i = 0; i < 170; i++) file('node_modules/module/f-' + i + '.js', 'aaaa');
  const dependency = file('node_modules/module/moteur.js', 'AAAA');
  const time = new Date('2026-01-01T00:00:00Z'); fs.utimesSync(dependency, time, time);
  const sources = await freezeLotSources(p, { code: true, dir });
  file('node_modules/.cache/webpack/index', 'cache de compilation');
  await checkLotSources(sources, 'code');
  fs.writeFileSync(dependency, 'BBBB'); fs.utimesSync(dependency, time, time);
  await assert.rejects(() => checkLotSources(sources, 'code'), /média/i);
});

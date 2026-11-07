import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { freezeLotSources, captureProject, checkLotSources } from '../lib/lot-sources.mjs';
import { codeFrameList } from '../lib/frames.mjs';
import { createLot, readLot } from '../lib/lots.mjs';

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

test('une entrée déclarée via une jonction retrouve la copie privée du même fichier', async () => {
  const { p, entry, base, dir } = fixture();
  const alias = path.join(base, 'autre');
  fs.symlinkSync(path.dirname(entry), alias, 'junction');
  p.remotion.entree = path.join(alias, path.basename(entry));
  const sources = await freezeLotSources(p, {code: true, dir});
  const frozen = captureProject(p, sources);
  assert.equal(frozen.remotion.entree, path.join(dir, 'projet', 'src', 'index.ts'));
  fs.writeFileSync(entry, 'nouveau');
  assert.equal(fs.readFileSync(frozen.remotion.entree, 'utf8'), 'version A');
  assert.equal(frozen.lotPrebuiltBundle, undefined);
});

function externalProject() {
  const f = fixture(), outside = path.join(f.base, 'exterieur');
  fs.mkdirSync(outside);
  f.p.remotion.entree = path.join(outside, 'entree.js');
  fs.writeFileSync(f.entry, 'import "./couleurs.js"');
  fs.linkSync(f.entry, f.p.remotion.entree);
  f.file('src/couleurs.js', 'rouge');
  fs.writeFileSync(path.join(outside, 'couleurs.js'), 'bleu');
  // Une copie récursive de cet ancêtre échouerait sur le cycle.
  fs.symlinkSync(outside, path.join(outside, 'cycle'), 'junction');
  f.file('node_modules/@remotion/bundler/package.json', '{"main":"index.cjs"}');
  f.file('node_modules/@remotion/bundler/index.cjs', `
    const fs = require('node:fs'), path = require('node:path');
    exports.bundle = async (o) => {
      if (o.enableCaching || o.symlinkPublicDir || fs.readdirSync(o.publicDir).length) throw Error('Cache ou public non isolé.');
      const graph = fs.readFileSync(path.join(path.dirname(o.entryPoint), 'couleurs.js'), 'utf8');
      fs.mkdirSync(o.outDir, {recursive: true});
      fs.writeFileSync(path.join(o.outDir, 'index.html'), graph, {flag:'wx'});
    };`);
  f.file('node_modules/@remotion/renderer/package.json', '{"main":"index.cjs","version":"4.0.535"}');
  f.file('node_modules/@remotion/renderer/index.cjs', `
    const fs = require('node:fs'), path = require('node:path');
    exports.openBrowser = async () => ({close: async () => {}});
    exports.selectComposition = async () => ({id:'Test', durationInFrames:2});
    exports.renderFrames = async o => {
      const page = fs.readFileSync(path.join(o.serveUrl, 'index.html'), 'utf8');
      const publicFile = fs.readFileSync(path.join(o.serveUrl, 'public', 'mot.txt'), 'utf8');
      await o.onFrameBuffer(Buffer.from(page + ' ' + publicFile), o.frames[0]);
    };`);
  f.file('public/mot.txt', 'initial');
  return { ...f, outside };
}
test('la compilation d’une vraie entrée externe et de ses imports précède le rendu et résiste à leur suppression', async () => {
  const {p, dir, outside, file} = externalProject();
  const sources = await freezeLotSources(p, {code: true, dir});
  fs.unlinkSync(p.remotion.entree); fs.unlinkSync(path.join(outside, 'couleurs.js')); file('public/mot.txt', 'modifié');
  const captures = [];
  const frozen = captureProject(p, JSON.parse(JSON.stringify(sources)));
  await codeFrameList(frozen, [1], {cacheKey: 'lot-externe', onFrame: (_n, b) => captures.push(b.toString())});
  assert.deepEqual(captures, ['bleu initial']);
});
test('un échec de compilation externe livre les notes et le diagnostic', async () => {
  const {p, root, outside} = externalProject();
  Object.assign(p, {title:'Essai', ep:'Essai', target:root, NOTES:path.join(p.REVUE, 'notes.json'), LOTS:path.join(p.REVUE, 'lots'), REPLIES:path.join(p.REVUE, 'replies.json')});
  fs.mkdirSync(p.REVUE, {recursive: true});
  fs.writeFileSync(p.NOTES, JSON.stringify({notes:[{id:'n', frame:1, text:'À corriger', source:'code'}]}));
  fs.unlinkSync(path.join(outside, 'couleurs.js'));
  const r = await createLot(p, {ids:['n']});
  const L = readLot(p, r.lot);
  assert.equal(L.edits[0].text, 'À corriger'); assert.equal(L.captureState.status, 'error');
  assert.match(L.captureState.error, /couleurs\.js/);
});

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

test('le module du Player et sa timeline hors projet ne bloquent pas une entrée Remotion interne', async () => {
  const { p, base, dir } = fixture();
  p.remotion.module = path.join(base, 'player-externe.ts');
  p.remotion.timeline = path.join(base, 'timeline-externe.ts');
  const frozen = captureProject(p, await freezeLotSources(p, { code: true, dir }));
  assert.equal(fs.readFileSync(frozen.remotion.entree, 'utf8'), 'version A');
  assert.ok(!frozen.remotion.module && !frozen.remotion.timeline);
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

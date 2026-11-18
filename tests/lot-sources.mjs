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
      if (o.webpackOverride) {
        const plugin = o.webpackOverride({plugins:[]}).plugins[0];
        plugin.apply({hooks:{done:{tap:(_name, fn) => fn({compilation:{
          fileDependencies:new Set([o.entryPoint,path.join(path.dirname(o.entryPoint),'couleurs.js')]),
          contextDependencies:new Set()
        }})}}});
      }
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

const tick = () => new Promise(resolve => setTimeout(resolve, 30));
test('la préparation différée refuse les modifications antérieures à la copie, même à date d’écriture rétablie', async () => {
  for (const rel of ['src/index.ts', 'public/files/photo.jpg', 'node_modules/module/moteur.js']) {
    const {p, file, dir} = fixture();
    const target = file(rel, 'AAAA');
    if (rel.startsWith('node_modules')) for (let i=0; i<170; i++) file('node_modules/module/entree-' + i + '.js');
    const time = fs.statSync(target).mtime;
    const sentAt = new Date().toISOString();
    await tick(); fs.writeFileSync(target, 'BBBB'); fs.utimesSync(target, time, time);
    await assert.rejects(() => freezeLotSources(p, {code:true, dir, sentAt}), /depuis l’envoi/);
  }
});

test('les builds Remotion et profils Chromium restent hors des sources, y compris à travers les jonctions du public', async () => {
  for (const kind of ['brambleshire','remotion']) {
    const {p, file, root, dir} = fixture(); p.kind = kind;
    const build = path.dirname(file('build-preview/index.html')); file('build-preview/bundle.js');
    const profile = path.dirname(file('profile-preview/Local State'));
    file('profile-preview/Default/Network/Cookies','fixture'); file('public/picture.jpg','picture');
    fs.symlinkSync(build, path.join(root, 'public', 'cached'), 'junction');
    fs.symlinkSync(profile, path.join(root, 'public', 'browser'), 'junction');
    fs.symlinkSync(path.join(profile, 'Default', 'Network'), path.join(root, 'public', 'network'), 'junction');
    await tick();
    const s = await freezeLotSources(p, {code:true, dir, sentAt:new Date().toISOString()});
    const pub = path.join(s.remotionDir, 'public');
    assert.deepEqual(fs.readdirSync(pub), ['picture.jpg']);
    assert.ok(!fs.existsSync(path.join(s.remotionDir,'build-preview')));
    assert.ok(!fs.existsSync(path.join(s.remotionDir,'profile-preview')));
    await checkLotSources(s,'code');
  }
});

test('une entrée déclarée parmi des fichiers de même nom qu’un build reste disponible', async () => {
  const {p, file, dir} = fixture(); p.remotion.entree = file('livre/main.js','source');
  file('livre/index.html'); file('livre/bundle.js');
  await tick();
  const s = await freezeLotSources(p, {code:true, dir, sentAt:new Date().toISOString()});
  assert.equal(fs.readFileSync(s.remotion.entree,'utf8'), 'source');
});

test('deux lots peuvent utiliser les mêmes médias de l’épisode montés sous public et ignorer ses dossiers de revue', async () => {
  const {p, root, base, file} = fixture(), episode = path.join(base, 'episode-media');
  const review = path.join(episode,'revue'), another = path.join(episode,'revue-alternative');
  fs.mkdirSync(review,{recursive:true}); fs.mkdirSync(another);
  fs.writeFileSync(path.join(review,'notes.json'),'{}');
  fs.writeFileSync(path.join(another,'projet.json'),'{}'); fs.writeFileSync(path.join(another,'studio.lock.json'),'{}');
  const media = path.join(episode,'photo.jpg'); fs.writeFileSync(media,'image');
  fs.writeFileSync(path.join(episode,'cadre.json'),'{}');
  file('public/menu.json','{}');
  for (const alias of ['episode-media','episode']) fs.symlinkSync(episode,path.join(root,'public',alias),'junction');
  p.exportRule = {dossiers:[root,episode]}; p.REVUE = review;
  await tick();
  const before = fs.statSync(media,{bigint:true}).ctimeNs, sentAt = new Date().toISOString(); await tick();
  fs.writeFileSync(path.join(review,'notes.json'),'{"notes":[]}');
  const jobs = await Promise.all(['prive1','prive2'].map(d=>freezeLotSources(p,{code:true,dir:path.join(base,d),sentAt})));
  assert.equal(fs.statSync(media,{bigint:true}).ctimeNs,before);
  for (const job of jobs) {
    for (const alias of ['episode-media','episode']) assert.deepEqual(fs.readdirSync(path.join(job.remotionDir,'public',alias)).sort(),['cadre.json','photo.jpg']);
    await checkLotSources(job,'code');
  }
});

test('la capture différée valide les imports réellement compilés depuis une entrée externe', async () => {
  const {p,dir,base,outside} = externalProject();
  await tick();
  let sentAt = new Date().toISOString();
  const sources = await freezeLotSources(p, {code:true, dir, sentAt});
  assert.equal(fs.readFileSync(path.join(sources.lotPrebuiltBundle, 'index.html'), 'utf8'), 'bleu');
  sentAt = new Date().toISOString(); await tick();
  fs.writeFileSync(path.join(outside,'couleurs.js'), 'rouge');
  await assert.rejects(() => freezeLotSources(p, {code:true, dir:path.join(base,'prive2'), sentAt}), /depuis l’envoi.*couleurs/);
});

test('deux lots sur un gros média isolé utilisent un lien dur certifié et refusent toute autre version', async () => {
  const {p, dir, base, file} = fixture(), media = file('film.mp4', 'fixture');
  const realStat = fs.statSync, realLink = fs.symlinkSync, realHardLink = fs.linkSync, inode = realStat(media,{bigint:true}).ino;
  try {
    fs.statSync = function(name,...args) {
      const result = realStat(name,...args);
      if (result.ino === inode && args[0]?.bigint) result.size = 513n * 1024n * 1024n;
      return result;
    };
    fs.symlinkSync = function(source,dest,type) {
      if (type === 'file') throw Object.assign(new Error('indisponible'), {code:'EPERM'});
      realLink(source,dest,type);
    };
    await tick();
    const sentAt = new Date().toISOString();
    fs.linkSync = () => { throw Object.assign(new Error('autre volume'), {code:'EXDEV'}); };
    await assert.rejects(() => freezeLotSources(p, {code:true, dir, sentAt}), /lien dur \(EXDEV\)/);
    fs.linkSync = realHardLink; await tick();
    const lots = await Promise.all(['a','b'].map(name => freezeLotSources(p,{code:true,dir:path.join(base,name),sentAt})));
    for (const source of lots) {
      assert.equal(realStat(path.join(source.remotionDir,'film.mp4'),{bigint:true}).ino,inode);
      await checkLotSources(source,'code');
    }
    const time = realStat(media).mtime;
    await tick(); fs.writeFileSync(media,'changed'); fs.utimesSync(media,time,time);
    for (const source of lots) await assert.rejects(() => checkLotSources(source,'code'), /média/);
    await assert.rejects(() => freezeLotSources(p,{code:true,dir:path.join(base,'c'),sentAt}), /depuis l’envoi/);
  } finally { fs.statSync = realStat; fs.symlinkSync = realLink; fs.linkSync = realHardLink; }
});

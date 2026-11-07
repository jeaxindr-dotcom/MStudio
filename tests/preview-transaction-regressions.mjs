// Régressions déterministes : exécute les fonctions livrées, sans serveur ni navigateur.
// --baseline lit 10633a9 et doit échouer sur les mêmes assertions.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const root = new URL('../', import.meta.url);
const baseline = process.argv.includes('--baseline');
const read = (file) => baseline ? execFileSync('git', ['show', `10633a9:${file}`], {cwd: root, encoding: 'utf8'}) : fs.readFileSync(new URL(file, root), 'utf8');
const source = read('page/studio/01-preview.js');
const load = source.slice(source.indexOf('  function loadCode('), source.indexOf("  // the preview's events"));
const defer = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return {promise, resolve, reject}; };
const later = () => new Promise((r) => setImmediate(r));
function fixture({staging = false, readiness = null, failure = false} = {}) {
  const trace = [], remotes = [], timers = [], poses = [];
  let n = 0;
  const frame = (name) => ({name, contentWindow: {name}, title: '', hasAttribute: () => false, after() {}, remove() {trace.push(['retire', name]);}, set src(url) {this.url = url;}});
  function player(name) {
    const p = {name, at: 0, playing: false, disposed: false, durationInFrames: 300,
      frame: () => p.at, isPlaying: () => p.playing, isBuffering: () => false, frameReady: () => true,
      pause() {p.playing = false;}, play() {p.playing = true;}, seek(f) {p.at = f; trace.push(['seek', name, f]);},
      whenReady() {trace.push(['prêt', name, p.at]); return failure ? Promise.reject(new Error('texture absente')) : readiness?.promise ?? Promise.resolve();},
      async prepare(f) {p.seek(f); await p.whenReady(); trace.push(['validé', name, f]); return {frame: f, ready: true};},
      dispose() {p.disposed = true; trace.push(['détruit', name]);}, setVolume() {}, setRate() {},
      stage: {scene3d: false, list: () => [], on: () => () => {}, setMode() {}, select() {}, enable: async () => true,
        freePose() {if (poses.length >= 2) return Promise.resolve(null); const d = defer(); poses.push(d); return d.promise;}}};
    return p;
  }
  const c = {console, Promise, performance, Date, Set, String, JSON, Error,
    SP: player('ancienne'), codeVer: 1, codeLoad: null, codeLoading: null, codeFailedVer: null, preparedCode: null,
    STATUS: {code: {version: 2}}, META: {render: true}, codeEl: frame('ancienne'),
    document: {createElement: () => frame(`nouvelle-${++n}`)}, window: {}, staging, stSel: null, stUnsub: null,
    stMode: 'translate', freeCamOn: false, vol: 1, rate: 1, RS: {el: null, wait: true}, crash: null,
    codeErrEl: {classList: {remove() {}}}, mode: 'code', modeWant: null, FRAMES: 300, stageSynced: null,
    curFrame: () => c.SP.at, previewUrl: (q) => `http://localhost:4999/player.html?${q}`,
    remotePlayer(win) {const p = player(win.name), d = defer(); const r = {api: p, hello: d.promise, resolve: () => d.resolve(p)}; remotes.push(r); return r;},
    plain: (x) => x, drafts: () => [], watchPlayer() {}, rsStatus() {}, onStageEvent() {}, renderScene() {},
    showCodeNote() {}, setSave(t) {trace.push(['message', t]);}, codeWait() {}, showCodeStatus() {},
    T: (s) => s, TN: (s) => s, $: () => ({textContent: ''}),
    setInterval: () => 0, clearInterval() {}, clearTimeout(id) {if (timers[id - 1]) timers[id - 1].cancelled = true;},
    setTimeout(fn, delay) {timers.push({fn, delay, cancelled: false}); return timers.length;},
  };
  vm.createContext(c); vm.runInContext(load, c);
  return {c, trace, remotes, timers, poses};
}
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
test('G4 : valider l’image finale avant de détruire l’ancienne', async () => {
  const f = fixture(); f.c.SP.at = 80;
  const done = f.c.loadCode(); f.remotes[0].resolve(); await done;
  const proof = f.trace.findIndex((x) => x[0] === 'validé' && x[2] === 80);
  const removed = f.trace.findIndex((x) => x[0] === 'détruit' && x[1] === 'ancienne');
  assert.ok(proof >= 0 && proof < removed, JSON.stringify(f.trace));
  assert.equal(f.c.SP.at, 80);
});
test('G4 : le hash initial est préparé sans détruire le Player adopté', async () => {
  const f = fixture(); f.c.SP = null; f.c.FRAMES = 0; f.c.META.render = null; f.c.hashFrame = () => 270; f.c.curFrame = () => 0;
  f.c.adoptCode = (sp) => {assert.equal(f.c.codeLoad, null, 'La transaction doit être close avant adoptCode'); if (sp.frame() !== 270) f.c.cancelCodePreparation?.(); sp.seek(270);};
  const done = f.c.loadCode(); f.remotes[0].resolve(); await done;
  assert.equal(f.c.SP.disposed, false); assert.equal(f.c.SP.frame(), 270);
  assert.ok(f.trace.some((x) => x[0] === 'validé' && x[2] === 270));
  assert.equal(f.c.codeLoad, null);
});
test('G5 : une erreur de préparation conserve l’ancienne', async () => {
  const f = fixture({failure: true}), old = f.c.SP;
  const done = f.c.loadCode(); f.remotes[0].resolve(); await done;
  assert.equal(f.c.SP, old); assert.equal(old.disposed, false);
  assert.equal(f.c.codeFailedVer, 2); assert.ok(f.trace.some((x) => x[0] === 'message' && x[1].includes('texture absente')));
});
test('G5 : un délai de préparation conserve l’ancienne', async () => {
  const f = fixture({readiness: defer()}), old = f.c.SP;
  const done = f.c.loadCode(); f.remotes[0].resolve(); await later();
  const timeout = f.timers.find((t) => !t.cancelled && (t.delay === 95000 || t.delay === 90000));
  assert.ok(timeout); timeout.fn(); await done;
  assert.equal(f.c.SP, old); assert.equal(old.disposed, false);
});
test('G4 : déplacer l’image pendant la préparation annule l’échange', async () => {
  const ready = defer(), f = fixture({readiness: ready}), old = f.c.SP; old.at = 15;
  const done = f.c.loadCode(); f.remotes[0].resolve(); await later(); old.at = 180;
  ready.resolve(); await done;
  assert.equal(f.c.SP, old); assert.equal(old.disposed, false);
});
test('Restauration du son : préparer la nouvelle image sur la même candidate', async () => {
  const ready = defer(), f = fixture({readiness: ready}), old = f.c.SP; old.at = 15;
  const done = f.c.loadCode({fresh: true, repair: {}}); f.remotes[0].resolve(); await later();
  old.at = 180; ready.resolve();
  assert.equal((await done).frame(), 180); assert.equal(f.remotes.length, 1);
  assert.deepEqual(f.trace.filter(x => x[0] === 'validé').map(x => x[2]), [15, 180]);
});
test('Restauration du son : un changement de mise en scène réclame une nouvelle tentative', async () => {
  const ready = defer(), f = fixture({readiness: ready}), old = f.c.SP, repair = {};
  const done = f.c.loadCode({fresh: true, repair}); f.remotes[0].resolve(); await later();
  old.stage.list = () => [{id: 'décor', delta: {s: 2}}]; ready.resolve();
  assert.equal(await done, old); assert.equal(old.disposed, false); assert.equal(repair.retry, true);
});
test('G4 : une réponse freePose tardive ne remplace jamais une génération plus récente', async () => {
  const f = fixture({staging: true});
  const a = f.c.loadCode(); f.remotes[0].resolve(); await later();
  f.c.STATUS.code.version = 3;
  const b = f.c.loadCode(); f.remotes[1].resolve(); await later();
  assert.equal(f.poses.length, 2); f.poses[1].resolve(null); await b;
  f.poses[0].resolve(null); await a;
  assert.equal(f.c.codeVer, 3); assert.equal(f.c.SP.name, 'nouvelle-2');
});
test('G6 : aucune candidate créée pendant la lecture', async () => {
  const f = fixture(); f.c.SP.playing = true; f.c.loadCode();
  assert.equal(f.remotes.length, 0);
});
test('G4 : déplacer la caméra libre pendant la préparation conserve l’ancienne', async () => {
  const ready = defer(), f = fixture({staging: true, readiness: ready}), old = f.c.SP;
  let pose = {p: [0, 0, 0], q: [0, 0, 0, 1]}; old.stage.freePose = async () => pose;
  const done = f.c.loadCode(); f.remotes[0].resolve(); await later();
  pose = {p: [10, 0, 0], q: [0, 0, 0, 1]}; ready.resolve(); await done;
  assert.equal(f.c.SP, old); assert.equal(old.disposed, false);
});
test('G6 : une lecture commencée pendant la préparation empêche l’échange', async () => {
  const ready = defer(), f = fixture({readiness: ready}), old = f.c.SP;
  const done = f.c.loadCode(); f.remotes[0].resolve(); await later(); old.playing = true;
  ready.resolve(); await done;
  assert.equal(f.c.SP, old); assert.equal(old.disposed, false);
});
test('G8 : l’attente audio de l’ancienne génération est réinitialisée', async () => {
  const f = fixture(); const done = f.c.loadCode(); f.remotes[0].resolve(); await done;
  assert.equal(f.c.RS.wait, false);
});
test('G6 : une mise à jour en mode MP4 ne prépare aucun Player caché', () => {
  const s = read('page/studio/02-notes.js'), a = s.indexOf('  function onStatus()'), b = s.indexOf('  // ---------- notes that follow', a);
  let loads = 0;
  const element = {classList: {toggle() {}}, querySelector: () => ({})};
  const c = {STATUS: {code: {version: 2, status: 'ready'}}, SP: {}, codeVer: 1, codeLoad: null, codeLoading: null, codeFailedVer: null,
    mode: 'video', modeWant: null, liveVer: 0, $: () => element, rsStatus() {}, followPlans() {}, T: (x) => x, hhmm() {},
    loadCode() {loads++;}, showCodeStatus() {}, renderPill() {}, onHeld() {}, markGo() {}};
  vm.runInNewContext(`${s.slice(a, b)};onStatus();`, c);
  assert.equal(loads, 0);
});
function audioFixture() {
  const a = source.indexOf('  const RS ='), b = source.indexOf('  let codeLoad', a);
  const intervals = [], seeks = [], messages = [];
  class Audio {constructor() {this.currentTime = 10; this.paused = false; this.readyState = 4;} play() {return Promise.resolve();} pause() {this.paused = true;} removeAttribute() {} load() {}}
  const c = {mode: 'code', SP: {frame: () => 0, isBuffering: () => false, seek: (f) => seeks.push(f), mute() {}, unmute() {}, setVolume() {}},
    STATUS: {code: {version: 2, status: 'ready'}, reviewSound: {state: 'ready', sig: 'son', codeVersion: 2}}, META: {}, codeVer: 2,
    M: {paused: false, currentTime: 0}, FPS: 30, FRAMES: 300, vol: 1, rate: 1, Audio, window: {}, performance: {now: () => 9000},
    setInterval(fn, ms) {intervals.push({fn, ms});}, setSave: (text) => messages.push(text), TN: (s) => s};
  vm.createContext(c); vm.runInContext(source.slice(a, b), c);
  vm.runInContext('rsStatus(); RS.el.currentTime = 10;', c);
  return {c, intervals, seeks, messages};
}
test('G14 : aucun seek du Player pour suivre une seconde horloge', () => {
  const f = audioFixture(); for (const t of f.intervals) if (t.ms === 200) t.fn();
  assert.deepEqual(f.seeks, []);
});
test('G13 : aucun master d’une autre génération', () => {
  const f = audioFixture(); f.c.STATUS.code.version = 3; vm.runInContext('rsStatus();', f.c);
  assert.equal(vm.runInContext('RS.el', f.c), null);
});
test('G13 : un master encore issu de l’ancienne frise est refusé', () => {
  const f = audioFixture(); f.c.STATUS.reviewSound.codeVersion = 1; vm.runInContext('rsStatus();', f.c);
  assert.equal(vm.runInContext('RS.el', f.c), null);
});
test('G13 : un nouveau calcul de code retire le master externe', () => {
  const f = audioFixture(); f.c.STATUS.code.status = 'building'; vm.runInContext('rsStatus();', f.c);
  assert.equal(vm.runInContext('RS.el', f.c), null);
});
test('G8 : le master ne démarre pas pendant une attente du Player', async () => {
  const f = audioFixture(); let calls = 0;
  f.c.audioPlay = () => {calls++; return Promise.resolve();};
  vm.runInContext('RS.el.play = audioPlay; RS.wait = true; rsPlay();', f.c);
  assert.equal(calls, 0);
});
test('G14 : un refus de lecture audio est visible', async () => {
  const f = audioFixture(); f.c.audioPlay = () => Promise.reject(new Error('NotAllowedError'));
  vm.runInContext('RS.el.play = audioPlay; rsPlay();', f.c); await later();
  assert.ok(f.messages.some((x) => x.includes('NotAllowedError')));
});
let ok = 0, ko = 0;
for (const [name, fn] of cases) {try {await fn(); console.log(`✓ ${name}`); ok++;} catch (e) {console.error(`✗ ${name}\n  ${e.message}`); ko++;}}
console.log(`${ok} ok, ${ko} ko`); process.exitCode = ko ? 1 : 0;

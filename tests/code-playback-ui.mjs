// Ordonnancement de la plage préparée : vrai module de page, médias et réseau simulés.
// --reference <fichier> permet de rejouer le premier prototype pour constater ses courses.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const arg = process.argv.indexOf('--reference');
const source = fs.readFileSync(arg >= 0 ? process.argv[arg + 1] : new URL('../page/studio/18-code-playback.js', import.meta.url), 'utf8');
const later = () => new Promise((r) => setImmediate(r));
const defer = () => {let resolve, reject; const promise = new Promise((r, j) => {resolve = r; reject = j;}); return {promise, resolve, reject};};
function fixture({unload = null, creation = null, cancellation = null, polling = null, createError = false, cancelError = false} = {}) {
  const elements = [], trace = [], intervals = [], events = [];
  class Element {
    constructor(tag) {this.tag = tag; this.handlers = {}; this.children = []; this.hidden = false; this.paused = true; this.currentTime = 0; this.readyState = 0; this.attrs = {}; elements.push(this);}
    append(...xs) {this.children.push(...xs);} after(...xs) {trace.push(['après', this.id, ...xs.map((x) => x.id)]);}
    addEventListener(name, fn) {(this.handlers[name] ??= []).push(fn);}
    emit(name) {if (name === 'loadeddata') this.readyState = 4; for (const fn of this.handlers[name] ?? []) fn();}
    set src(v) {this.attrs.src = v; trace.push(['src', v]);} get src() {return this.attrs.src;}
    getAttribute(k) {return this.attrs[k] ?? null;} removeAttribute(k) {delete this.attrs[k];}
    load() {trace.push(['recharge', this.id]); this.readyState = 0; this.currentTime = 0;} pause() {this.paused = true;} play() {this.paused = false; this.emit('play'); return Promise.resolve();}
  }
  const stagewrap = new Element('div');
  const c = {document: {createElement: (tag) => new Element(tag)}, $: selector => selector === '#stagewrap' ? stagewrap : null, media: new Element('div'), window: {},
    mode: 'code', META: {engine: 'remotion'}, STATUS: {code: {version: 1, hash: 'hash1', status: 'ready'}}, codeVer: 1,
    rate: 1, vol: 1, FPS: 30, CW: 1920, CH: 1080, staging: false, codeLoading: null, preparedCode: null,
    v: {volume: 1, playbackRate: 1}, RS: {wait: false, el: {pause: () => trace.push(['son-pause'])}},
    crypto: {randomUUID: () => 'proprietaire-ui'},
    codeWait: (on) => trace.push(['attente', on]), setSave: (message) => trace.push(['message', message]), fire: (name) => events.push(name),
    rsStatus() {}, cancelCodePreparation() {}, setInterval(fn) {intervals.push(fn);}, restoreSound: () => trace.push(['son-direct']),
    setMode: async (m) => {c.mode = m;}, setStaging: async (on) => {c.staging = on;},
    loadCode: async () => {trace.push(['nouvelle-version']); c.codeVer = c.STATUS.code.version;},
    fetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null; trace.push(['requête', url, body]);
      let value;
      if (url.endsWith('/cancel')) {if (cancelError) throw new Error('Annulation non confirmée'); await cancellation?.promise; value = {status: 'cancelled', ok: true};}
      else if (options.method === 'POST') {if (createError) throw new Error('Réponse création perdue'); value = creation ? await creation.promise : {id: 'travail1', from: 300, to: 1200, fps: 30, hash: 'hash1', status: 'preparing', current: true};}
      else value = polling ? await polling.promise : {id: 'travail1', from: 300, to: 1200, fps: 30, hash: 'hash1', status: 'ready', current: true};
      return {ok: true, json: async () => value};
    }};
  let at = 300;
  c.codeEl = new Element('iframe'); c.codeEl.id = 'code';
  c.SP = {durationInFrames: 3000, width: 640, height: 360, frame: () => at, isBuffering: () => false,
    async unload() {trace.push(['démontage-début']); await unload?.promise; trace.push(['démontage-fin']);},
    async resume(f) {trace.push(['reprise', f]); at = f;}, async prepare(f) {trace.push(['image-prête', f]); at = f;},
    seek(f) {trace.push(['seek-direct', f]); at = f;}, setRate(r) {trace.push(['vitesse-direct', r]);}, setVolume(v) {trace.push(['volume-direct', v]);}, mute() {trace.push(['muet-direct']);}};
  c.M = {get currentTime() {return at / c.FPS;}, set currentTime(t) {at = Math.floor(t * c.FPS);},
    get paused() {return true;}, get seeking() {return false;},
    get playbackRate() {return c.rate;}, set playbackRate(r) {c.rate = r; c.SP.setRate(r);},
    set volume(v) {c.vol = v; c.SP.setVolume(v);}, play() {trace.push(['lecture-direct']);}, pause() {trace.push(['pause-direct']);}};
  c.curFrame = () => Math.floor(c.M.currentTime * c.FPS);
  vm.createContext(c); vm.runInContext(source, c);
  const el = (id) => elements.find((e) => e.id === id), click = () => el('prepareCodeRange').onclick();
  const tick = () => intervals[0]();
  const ready = async () => {await click(); await tick(); el('codeRangeVideo').emit('loadeddata');};
  return {c, trace, events, el, click, tick, ready};
}
const cases = [], test = (name, fn) => cases.push([name, fn]);
test('Retour pendant démontage : attendre sa fin avant reprise', async () => {
  const unload = defer(), f = fixture({unload}); const start = f.click();
  const leaving = f.c.preparedCode.leave(); await later(); const early = f.trace.some((x) => x[0] === 'reprise');
  unload.resolve(); await start; await leaving; assert.equal(early, false);
});
test('Retour pendant création : attendre le travail puis son annulation', async () => {
  const creation = defer(), f = fixture({creation}); const start = f.click(); await later();
  const leaving = f.c.preparedCode.leave(); await later(); const early = f.trace.some((x) => x[0] === 'reprise');
  creation.resolve({id: 'travail1', from: 300, to: 1200, fps: 30, hash: 'hash1', status: 'preparing'}); await start; await leaving;
  assert.equal(early, false);
  assert.ok(f.trace.findIndex((x) => x[0] === 'requête' && x[1].endsWith('/cancel')) < f.trace.findIndex((x) => x[0] === 'reprise'));
});
test('Un échec d’annulation interdit de relancer le Player lourd', async () => {
  const f = fixture({cancelError: true}); await f.click(); await f.c.preparedCode.leave().catch(() => {});
  assert.equal(f.trace.some((x) => x[0] === 'reprise'), false); assert.equal(f.c.preparedCode.active(), true);
});
test('Une réponse perdue de création reste annulable par propriétaire', async () => {
  const f = fixture({createError: true}); await f.click(); await f.c.preparedCode.leave();
  assert.ok(f.trace.some((x) => x[0] === 'requête' && x[1].endsWith('/cancel') && x[2].owner === 'proprietaire-ui'));
});
test('Une réponse prête tardive ne sert pas un code devenu périmé', async () => {
  const polling = defer(), f = fixture({polling}); await f.click(); const poll = f.tick();
  f.c.STATUS.code.version = 2; f.c.STATUS.code.hash = 'hash2';
  polling.resolve({id: 'travail1', from: 300, to: 1200, fps: 30, hash: 'hash1', status: 'ready'}); await poll; await later();
  assert.equal(f.trace.some((x) => x[0] === 'src'), false);
});
test('Un état d’un autre contenu est refusé', async () => {
  const polling = defer(), f = fixture({polling}); await f.click();
  polling.resolve({id: 'travail1', from: 300, to: 1200, fps: 30, hash: 'autre', status: 'ready', current: false}); await f.tick();
  assert.equal(f.el('codeRangeVideo').hidden, true); assert.equal(f.trace.some((x) => x[0] === 'src'), false);
});
test('Le dernier déplacement demandé pendant annulation est conservé', async () => {
  const cancellation = defer(), f = fixture({cancellation}); await f.ready();
  const a = f.c.preparedCode.leave(1500); await later(); const b = f.c.preparedCode.leave(2100); cancellation.resolve(); await a; await b;
  assert.equal(f.trace.findLast((x) => x[0] === 'reprise')?.[1], 2100);
});
test('Changer volume et vitesse ne réveille pas le Player suspendu', async () => {
  const f = fixture(); await f.ready(); f.c.M.volume = 0.4; f.c.M.playbackRate = 1.5;
  assert.equal(f.trace.some((x) => ['vitesse-direct', 'volume-direct'].includes(x[0])), false);
  assert.equal(f.el('codeRangeVideo').volume, 0.4); assert.equal(f.el('codeRangeVideo').playbackRate, 1.5);
});
test('Attendre la première image décodée avant d’exposer la plage', async () => {
  const f = fixture(); await f.click(); await f.tick(); assert.equal(f.el('codeRangeVideo').hidden, true);
  f.el('codeRangeVideo').emit('loadeddata'); assert.equal(f.el('codeRangeVideo').hidden, false);
});
test('Aucune création pour une version affichée déjà dépassée', async () => {
  const f = fixture(); f.c.STATUS.code.version = 2; await f.click();
  assert.equal(f.trace.some((x) => x[0] === 'démontage-début'), false);
});
test('La plage garde le mode Code et sa seule horloge média', async () => {
  const f = fixture(); await f.ready(); f.el('codeRangeVideo').currentTime = 2; f.c.M.play();
  assert.equal(f.c.mode, 'code'); assert.equal(f.c.M.currentTime, 12); assert.equal(f.c.M.paused, false);
  assert.equal(f.trace.some((x) => x[0] === 'lecture-direct' || x[0] === 'seek-direct'), false);
});
test('La préparation emploie les dimensions réelles du Player', async () => {
  const f = fixture(); await f.click(); const creation = f.trace.find((x) => x[0] === 'requête' && x[1] === '/api/code-playback');
  assert.equal(creation?.[2].width, 640); assert.equal(creation?.[2].height, 360);
});
test('Les dimensions de la composition servent de repli contrôlé', async () => {
  const f = fixture(); f.c.SP.width = undefined; f.c.SP.height = 0; await f.click();
  const creation = f.trace.find((x) => x[0] === 'requête' && x[1] === '/api/code-playback');
  assert.equal(creation?.[2].width, 1920); assert.equal(creation?.[2].height, 1080);
});
test('La fin de plage avertit le transport de sa pause', async () => {
  const f = fixture(); await f.ready(); f.events.length = 0; f.el('codeRangeVideo').emit('ended');
  assert.ok(f.events.includes('pause'));
});
test('La mise en scène attend le retour au direct', async () => {
  const f = fixture(); await f.ready(); await f.c.setStaging(true);
  assert.equal(f.c.preparedCode.active(), false); assert.equal(f.c.staging, true); assert.ok(f.trace.some((x) => x[0] === 'reprise'));
});
test('Rétablir le son recharge la plage à la même position et reste en pause', async () => {
  const f = fixture(); await f.ready(); const film = f.el('codeRangeVideo'); film.currentTime = 3.375; f.c.M.play();
  await f.c.restoreSound(); assert.equal(film.paused, true); assert.equal(f.trace.some((x) => x[0] === 'son-direct'), false);
  film.emit('loadedmetadata'); film.emit('loadeddata');
  assert.equal(film.currentTime, 3.375); assert.equal(film.paused, true); assert.equal(film.hidden, false);
  assert.ok(f.el('codeRangeTools').children.at(-1).textContent.includes('Lecture'));
});
test('Rétablir le son pendant préparation ne touche pas au Player suspendu', async () => {
  const f = fixture(); await f.click(); await f.c.restoreSound();
  assert.equal(f.trace.some((x) => x[0] === 'son-direct'), false);
  assert.ok(f.el('codeRangeTools').children.at(-1).textContent.includes('préparation'));
});
test('Hors plage préparée, rétablir le son conserve le transport normal', async () => {
  const f = fixture(); await f.c.restoreSound(); assert.ok(f.trace.some((x) => x[0] === 'son-direct'));
});
test('La vidéo est insérée après le Player, avant les annotations', () => {
  const f = fixture(); assert.ok(f.trace.some((x) => x[0] === 'après' && x[1] === 'code' && x[2] === 'codeRangeVideo'));
});
test('Passer au MP4 annule la préparation sans remonter la scène cachée', async () => {
  const f = fixture(); await f.ready(); await f.c.setMode('video');
  assert.equal(f.c.mode, 'video'); assert.equal(f.trace.some((x) => x[0] === 'reprise'), false);
  assert.equal(f.c.preparedCode.parked?.(), true);
});
test('Revenir au code remonte l’iframe conservée à l’image choisie', async () => {
  const f = fixture(); await f.ready(); await f.c.setMode('video'); f.c.M.currentTime = 20; await f.c.setMode('code');
  assert.equal(f.c.mode, 'code'); assert.equal(f.trace.findLast((x) => x[0] === 'reprise')?.[1], 600);
  assert.equal(f.c.preparedCode.parked?.(), false);
});
let ok = 0, ko = 0;
for (const [name, fn] of cases) {try {await fn(); console.log(`✓ ${name}`); ok++;} catch (e) {console.error(`✗ ${name}\n  ${e.message}`); ko++;}}
console.log(`${ok} ok, ${ko} ko`); process.exitCode = ko ? 1 : 0;

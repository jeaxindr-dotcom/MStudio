// Protocole réel exécuté dans deux contextes simulés : aucune charge média ou GPU.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const root = new URL('../', import.meta.url), baseline = process.argv.includes('--baseline');
const read = (file) => baseline ? execFileSync('git', ['show', `10633a9:${file}`], {cwd: root, encoding: 'utf8'}) : fs.readFileSync(new URL(file, root), 'utf8');
const later = () => new Promise((r) => setImmediate(r));
const cases = [], test = (name, fn) => cases.push([name, fn]);
function remote() {
  const handlers = {}, timers = [], intervals = [], sent = [];
  let now = 0;
  const win = {postMessage: (d) => sent.push(d)};
  const c = {location: {hostname: '127.0.0.1', origin: 'http://127.0.0.1:4999', protocol: 'http:', port: '4999', search: ''},
    window: {addEventListener: (n, fn) => {handlers[n] = fn;}, dispatchEvent() {}}, document: {hidden: false},
    performance: {now: () => now}, plain: (x) => x, win,
    setTimeout(fn, ms) {const t = {fn, ms}; timers.push(t); return t;}, clearTimeout(t) {if (t) t.cleared = true;},
    setInterval(fn, ms) {const t = {fn, ms}; intervals.push(t); return t;}, clearInterval(t) {if (t) t.cleared = true;}};
  vm.createContext(c); vm.runInContext(`${read('page/studio/00-remote.js')}\nglobalThis.remote = remotePlayer(win, '2');`, c);
  const receive = (data) => handlers.message({origin: 'http://localhost:4999', source: win, data: {coulissesPreview: 1, v: '2', ...data}});
  receive({hello: {v: '2', durationInFrames: 300}, state: {seen: 0, frame: 12, ready: true, buffering: true}});
  return {c, api: c.remote.api, receive, sent, timers, intervals, advance: (ms) => {now += ms;}};
}
test('G5 : whenReady et whenFrameReady ont chacun un délai borné', async () => {
  const f = remote();
  const a = f.api.whenReady().catch((e) => e), b = f.api.whenFrameReady().catch((e) => e);
  assert.equal(f.timers.length, 2);
  for (const timer of f.timers) {assert.ok(timer.ms <= 95000); timer.fn();}
  assert.match((await a).message, /sans réponse/); assert.match((await b).message, /sans réponse/);
});
test('G8 : le premier hello transmet une attente déjà active', () => {
  const f = remote(); assert.equal(f.api.isBuffering?.(), true);
});
test('G4 : l’état est appliqué avant de résoudre une réponse RPC', async () => {
  const f = remote(), pending = f.api.whenReady().then(() => f.api.frame()), id = f.sent.at(-1).id;
  f.receive({re: id, ok: true, state: {seen: id, frame: 80, ready: true}});
  assert.equal(await pending, 80);
});
test('G4 : les événements d’une autre génération sont ignorés', () => {
  const f = remote(); f.receive({v: '1', ev: {type: 'frame', frame: 250, seen: 999}});
  assert.equal(f.api.frame(), 12);
});
test('G14 : trente secondes de silence produisent un seul diagnostic', () => {
  const f = remote(), events = []; f.api.on((e) => events.push(e));
  for (let n = 0; n < 33; n++) { f.advance(1000); for (const t of f.intervals) t.fn(); }
  assert.ok(f.sent.some(d => d.probe)); assert.equal(f.sent.at(-1).call, 'seek');
  assert.equal(events.length, 1); assert.equal(events[0].error.kind, 'transport'); assert.equal(f.api.crashed(), true);
  f.receive({probe: true});
  const state = {seen: f.sent.at(-1).id, frame: 12, ready: true, readiness: {frame: 12, verified: false}};
  f.receive({heartbeat: true, state}); assert.equal(events.length, 1);
  state.readiness.verified = true;
  f.receive({heartbeat: true, state}); f.receive({heartbeat: true, state});
  assert.equal(events.length, 2); assert.equal(events.at(-1).type, 'transport-restored');
});
test('Après une veille du PC, le lecteur répond au sondage avant toute alerte', () => {
  const f = remote(), events = []; f.api.on(e => events.push(e));
  f.advance(90000); f.intervals[0].fn(); assert.ok(f.sent.at(-1).probe);
  f.receive({probe: true}); f.advance(1000); f.intervals[0].fn();
  assert.equal(events.length, 0); assert.equal(f.api.crashed(), false);
});
test('Le lecteur suspendu pour la plage préparée ne signale aucune panne', () => {
  const f = remote(), events = []; f.api.on(e => events.push(e)); void f.api.unload();
  for (let n = 0; n < 45; n++) { f.advance(1000); f.intervals[0].fn(); }
  assert.equal(events.length, 0); assert.equal(f.sent.some(d => d.probe), false);
});
test('Un onglet caché ne produit pas de faux diagnostic de silence', () => {
  const f = remote(), events = []; f.api.on((e) => events.push(e)); f.c.document.hidden = true; f.advance(90000);
  for (const t of f.intervals) t.fn(); assert.equal(events.length, 0);
});
test('G14 : un refus de play est remonté au demandeur', async () => {
  const f = remote();
  const result = f.api.play();
  if (!result?.catch) {f.receive({re: f.sent.at(-1).id, ok: false, error: 'NotAllowedError'}); await later(); assert.fail('Le refus est avalé par send');}
  const pending = result.catch((e) => e);
  f.receive({re: f.sent.at(-1).id, ok: false, error: 'NotAllowedError', state: {seen: 1, frame: 12, playing: false}});
  assert.match((await pending).message, /NotAllowedError/); assert.equal(f.api.isPlaying(), false);
});
function bridge({buffering = false, readyFailure = false, withoutCrypto = false, leaseValid = true} = {}) {
  const handlers = {}, sent = [], intervals = [], requests = [];
  const parent = {postMessage: (d) => sent.push(d)};
  const p = {at: 3, durationInFrames: 300, fps: 30, frame() {return this.at;}, isPlaying: () => false,
    isBuffering: () => buffering, frameReady: () => true, frameLoading: () => false, crashed: () => false,
    pause() {}, seek(f) {this.at = f;}, whenReady: () => readyFailure ? Promise.reject(new Error('texture absente')) : Promise.resolve(), on() {}};
  const c = {URL, URLSearchParams, location: {port: '4999', origin: 'http://localhost:4999', search: '?v=1', ancestorOrigins: ['http://127.0.0.1:4999']},
    document: {}, window: {parent, StudioPlayer: p, __COULISSES_PREVIEW_RELEASE__: {version: 2, hash: 'hash-version-2'}, addEventListener: (n, fn) => {handlers[n] = fn;}},
    crypto: withoutCrypto ? undefined : {randomUUID: () => 'proprietaire-test'}, fetch: (url, opts) => {requests.push({url, ...opts, payload: JSON.parse(opts.body)}); return Promise.resolve({ok: true, json: async () => ({ok: leaseValid})});},
    setTimeout() {}, clearInterval(t) {if (t) t.cleared = true;}, setInterval(fn, ms) {const t = {fn, ms}; intervals.push(t); return t;}};
  vm.runInNewContext(read('player/bridge.js'), c);
  const call = async (name, args = []) => {await handlers.message({source: parent, origin: 'http://127.0.0.1:4999', data: {coulissesPreview: 1, call: name, args, id: 20}}); return sent.findLast((d) => d.re === 20);};
  return {c, p, handlers, sent, intervals, requests, call};
}
test('G4 : prepare renvoie une preuve correspondant à l’image demandée', async () => {
  const f = bridge(), response = await f.call('prepare', [75]);
  assert.equal(response.ok, true); assert.equal(response.value?.frame, 75); assert.equal(response.value.ready, true); assert.equal(response.state.frame, 75);
});
test('Une Lecture interrompue conserve AbortError à travers les deux côtés du pont', async () => {
  const b = bridge(), f = remote();
  b.p.play = () => Promise.reject(new DOMException('Lecture annulée', 'AbortError'));
  const erreur = f.api.play().catch(e => e);
  const rep = await b.call('play'); f.receive({...rep, re: f.sent.at(-1).id});
  const e = await erreur;
  assert.equal(e.name, 'AbortError');
  const filtre = read('page/studio/01-preview.js').split('\n').find(l => l.includes('const aborted ='));
  assert.equal(vm.runInNewContext(filtre + '\naborted(e)', {e}), true);
});
test('G5/G8 : prepare refuse une image encore en attente', async () => {
  const f = bridge({buffering: true}), response = await f.call('prepare', [75]);
  assert.equal(response.ok, false); assert.match(response.error, /pas prête/);
});
test('G5 : prepare conserve le motif exact d’échec', async () => {
  const f = bridge({readyFailure: true}), response = await f.call('prepare', [75]);
  assert.equal(response.ok, false); assert.equal(response.error, 'texture absente');
});
test('G13 : hello annonce la version du bundle réellement servi', () => {
  const f = bridge(), hello = f.sent.find((d) => d.hello);
  assert.equal(hello.hello.v, 2); assert.equal(hello.hello.hash, 'hash-version-2');
});
test('G14 : une perte WebGL remonte un diagnostic sans rechargement', () => {
  const f = bridge(); f.handlers.webglcontextlost?.({target: {isConnected: true}});
  const error = f.sent.find((d) => d.ev?.error?.kind === 'webgl');
  assert.ok(error); assert.equal(error.ev.frame, 3);
});
test('G13 : le bail de la version est renouvelé puis libéré', () => {
  const f = bridge(); for (const t of f.intervals) if (t.ms === 20000) t.fn(); f.handlers.pagehide?.();
  assert.equal(f.requests.length, 3);
  for (const req of f.requests) {assert.equal(req.url, '/api/preview-lease'); assert.equal(req.payload.hash, 'hash-version-2'); assert.equal(req.payload.owner, 'proprietaire-test');}
  assert.equal(f.requests.at(-1).payload.release, true); assert.equal(f.requests.at(-1).keepalive, true);
});
test('G13 : le propriétaire de secours reste accepté par le serveur', () => {
  const f = bridge({withoutCrypto: true}); assert.match(f.requests[0]?.payload.owner ?? '', /^[a-zA-Z0-9_-]{1,100}$/);
});
test('G13 : revenir sur la page renouvelle immédiatement son bail', () => {
  const f = bridge(); const before = f.requests.length; f.handlers.pageshow?.();
  assert.equal(f.requests.length, before + 1);
});
test('Restaurer la page depuis le cache réarme le signal de vie et répond sans inspecter le contenu', async () => {
  const f = bridge(); f.handlers.pagehide(); f.handlers.pageshow({persisted: true});
  assert.equal(f.intervals.filter(t => t.ms === 1000 && !t.cleared).length, 1);
  assert.ok(f.sent.some(d => d.heartbeat));
  f.p.frame = () => {throw new Error('inspection indisponible');};
  await f.handlers.message({source: f.c.window.parent, origin: 'http://127.0.0.1:4999', data: {coulissesPreview: 1, probe: true}});
  assert.ok(f.sent.at(-1).probe);
});
test('G14 : une ancienne génération expirée est signalée sans substitution', async () => {
  const f = bridge({leaseValid: false}); await later();
  assert.ok(f.sent.some((d) => d.ev?.error?.message?.includes('expiré')));
});
test('G8 : le pont transmet le tampon initial réel du Player', () => {
  const f = bridge({buffering: true}); assert.equal(f.sent.find((d) => d.hello).state.buffering, true);
});
let ok = 0, ko = 0;
for (const [name, fn] of cases) {try {await fn(); console.log(`✓ ${name}`); ok++;} catch (e) {console.error(`✗ ${name}\n  ${e.message}`); ko++;}}
console.log(`${ok} ok, ${ko} ko`); process.exitCode = ko ? 1 : 0;

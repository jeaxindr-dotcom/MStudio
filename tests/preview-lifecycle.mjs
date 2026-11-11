// Régressions sans navigateur : vrai réconciliateur React, modules de production,
// horloge et API Remotion contrôlées. --reference 10633a9 vérifie le défaut ancien.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { remotionModules, skip } from './where.mjs';

const atelier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modules = remotionModules();
if (!modules) skip('les dépendances Remotion', 'COULISSES_TEST_REMOTION');
const req = createRequire(path.join(modules, '..', 'package.json'));
const React = req('react'), Reconciler = req('react-reconciler'), esbuild = req('esbuild');
const reference = process.argv.includes('--reference') ? process.argv[process.argv.indexOf('--reference') + 1] : null;
const source = f => reference ? execFileSync('git', ['show', `${reference}:${f}`], { cwd: atelier, encoding: 'utf8' }) : fs.readFileSync(path.join(atelier, f), 'utf8');
const noop = () => {};
let ok = 0, ko = 0;
const test = async (titre, fn) => { try { await fn(); ok++; console.log(`  ✓ ${titre}`); } catch (e) { ko++; console.log(`  ✗ ${titre} : ${e.message}`); } };

function horloge() {
  let now = 0, id = 0;
  const tasks = new Map();
  const schedule = (fn, delay, interval = 0) => { const n = ++id; tasks.set(n, { fn, at: now + delay, interval }); return n; };
  return {
    api: { performance: { now: () => now }, requestAnimationFrame: fn => schedule(fn, 16), cancelAnimationFrame: n => tasks.delete(n),
      setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: n => tasks.delete(n),
      setInterval: (fn, ms) => schedule(fn, ms, ms), clearInterval: n => tasks.delete(n) },
    advance(ms) {
      const end = now + ms;
      for (let safe = 0; safe < 100000; safe++) {
        const next = [...tasks].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [n, t] = next; tasks.delete(n); now = t.at;
        if (t.interval) tasks.set(n, { ...t, at: now + t.interval }); t.fn();
      }
      now = end;
    },
  };
}
function contexte(extra = {}) {
  const events = new Map(), clock = horloge();
  const window = { remotion_delayRenderHandles: [],
    addEventListener: (n, f) => { if (!events.has(n)) events.set(n, new Set()); events.get(n).add(f); },
    removeEventListener: (n, f) => events.get(n)?.delete(f), dispatchEvent: e => { for (const f of events.get(e.type) ?? []) f(e); } };
  const ctx = vm.createContext({ console, ...clock.api, window, CustomEvent: class { constructor(type) { this.type = type; } }, ...extra });
  return { ctx, window, clock };
}
function moduleDans(ctx, fichier, imports) {
  const result = esbuild.transformSync(source(fichier), { loader: fichier.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', target: 'es2022' }).code;
  const module = { exports: {} }, importer = n => n === 'react' ? React : imports[n] ?? req(n);
  vm.runInContext(`(function(module, exports, require) {\n${result}\n})`, ctx, { filename: fichier })(module, module.exports, importer);
  return module.exports;
}
function reactRoot() {
  const config = {
    now: Date.now, getRootHostContext: () => ({}), getChildHostContext: () => ({}), prepareForCommit: () => null,
    resetAfterCommit: noop, shouldSetTextContent: () => false, createInstance: () => ({}), createTextInstance: () => ({}),
    appendInitialChild: noop, finalizeInitialChildren: () => false, commitUpdate: noop, appendChild: noop, appendChildToContainer: noop,
    removeChild: noop, removeChildFromContainer: noop, clearContainer: noop, supportsMutation: true, isPrimaryRenderer: true,
    supportsPersistence: false, supportsHydration: false, getPublicInstance: x => x, getCurrentUpdatePriority: () => 32,
    setCurrentUpdatePriority: noop, resolveUpdatePriority: () => 32, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null, NotPendingTransition: null,
    HostTransitionContext: React.createContext(null), scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
    supportsMicrotasks: true, scheduleMicrotask: queueMicrotask, resetFormInstance: noop, requestPostPaintCallback: noop, detachDeletedInstance: noop,
  };
  const reconciler = Reconciler(config), errors = [];
  const root = reconciler.createContainer({}, 0, null, false, null, '', e => errors.push(e), e => errors.push(e), e => errors.push(e), null);
  return node => { reconciler.updateContainerSync(node, root, null, null); reconciler.flushSyncWork(); reconciler.flushPassiveEffects(); if (errors.length) throw errors.shift(); };
}
await test('L’enveloppe du projet reste stable sur 60 images, ses props, son état et ses contextes restent réactifs', () => {
  const frameContext = React.createContext(0), themeContext = React.createContext('jour');
  const useCurrentFrame = () => React.useContext(frameContext);
  let rootRenders = 0, last = null, updateLocal;
  function Shot({title, local, theme}) {
    last = [title, local, theme, useCurrentFrame()]; return null;
  }
  function Project({title}) {
    const [local, setLocal] = React.useState(0); updateLocal = setLocal;
    const theme = React.useContext(themeContext); rootRenders++;
    return React.createElement(Shot, {title, local, theme});
  }
  const src = source('player/remotion.tsx');
  const framed = src.slice(src.indexOf('const Framed'), src.indexOf('(window as any).StudioPlayer ='));
  const js = esbuild.transformSync(framed, {loader:'tsx', target:'es2022'}).code;
  const Framed = vm.runInNewContext(js + '\nFramed', {React, comp:{component:Project}});
  const render = reactRoot();
  const draw = (frame, title = 'Plan A', theme = 'jour') => render(React.createElement(frameContext.Provider, {value:frame},
    React.createElement(themeContext.Provider, {value:theme}, React.createElement(Framed, {title}))));
  try {
    for (let n = 0; n < 60; n++) { draw(n); assert.equal(last[3], n); }
    assert.equal(rootRenders, 1, 'L’enveloppe coûteuse est reconstruite alors que ses props sont identiques');
    draw(60, 'Plan B'); assert.deepEqual(last, ['Plan B', 0, 'jour', 60]);
    draw(61, 'Plan B', 'nuit'); assert.deepEqual(last, ['Plan B', 0, 'nuit', 61]);
    updateLocal(7); draw(62, 'Plan B', 'nuit'); assert.deepEqual(last, ['Plan B', 7, 'nuit', 62]);
  } finally { render(null); }
});
function montage() {
  const c = contexte(), seq = React.createContext(null);
  let serial = 0, frame = 130;
  const active = new Set(), continuations = [], sequences = [], handles = c.window.remotion_delayRenderHandles;
  const nativeBuffer = { delayPlayback() { const id = ++serial; active.add(id); return { unblock() { active.delete(id); } }; } };
  const nativeRender = {
    delayRender() { const h = ++serial; handles.push(h); return h; },
    continueRender(h) { continuations.push(h); const n = handles.indexOf(h); if (n >= 0) handles.splice(n, 1); }, cancelRender(e) { throw e; },
  };
  const remotion = { Internals: { SequenceContext: seq }, Sequence: props => { sequences.push(props); return props.children; }, useCurrentFrame: () => frame, useVideoConfig: () => ({ fps: 30 }),
    useBufferState: () => nativeBuffer, useDelayRender: () => nativeRender };
  const shim = moduleDans(c.ctx, 'player/sequence-window.tsx', { '@coulisses-remotion': remotion });
  const { AssetsWait } = moduleDans(c.ctx, 'player/assets-wait.tsx', { remotion: shim });
  const render = reactRoot(), finish = new Map();
  const Producer = ({ id, playback = false }) => {
    const r = shim.useDelayRender(), b = shim.useBufferState();
    const [h] = React.useState(() => playback ? null : r.delayRender(id));
    React.useEffect(() => { const lease = playback ? b.delayPlayback() : null; finish.set(id, () => playback ? lease.unblock() : r.continueRender(h)); }, []);
    return null;
  };
  const draw = (items, waiting = true) => render(React.createElement(React.Fragment, null,
    ...items.map(([id, hidden = false, playback = false]) => React.createElement(seq.Provider, { key: id, value: { premounting: hidden } }, React.createElement(Producer, { id, playback }))),
    waiting ? React.createElement(AssetsWait) : null));
  return { ...c, active, handles, finish, draw, dispose: () => render(null), frame: n => { frame = n; }, shim, nativeRender, continuations,
    renderSequence: props => { render(React.createElement(shim.Sequence, props)); return sequences.at(-1); } };
}

await test('B1 : une attente visible reste bloquante pendant un autre prémontage', () => {
  const m = montage();
  try {
    m.window.__coulissesPremounting = new Map([[{}, 210]]); m.window.__coulissesActiveMountAt = 0; m.clock.advance(2000);
    m.draw([['visible']]); m.clock.advance(100);
    assert.equal(m.active.size, 1, 'la scène visible doit posséder son attente');
    m.clock.advance(25000); assert.equal(m.active.size, 1, 'aucune libération automatique au bout de 20 s');
    m.finish.get('visible')(); assert.equal(m.active.size, 0);
  } finally { m.dispose(); }
});
await test('B2 : quitter une scène libère poignée et bail même sans cleanup producteur', () => {
  const m = montage();
  try { m.draw([['oubli']]); m.clock.advance(60); m.draw([]); m.clock.advance(60); assert.equal(m.active.size, 0); assert.equal(m.handles.length, 0, 'la poignée de la scène quittée doit disparaître'); }
  finally { m.dispose(); }
});
await test('B1 : le prémontage explicite ne bloque pas puis devient bloquant à son entrée', () => {
  const m = montage();
  try {
    m.draw([['future', true]], false); assert.equal(m.active.size, 0);
    m.draw([['future', false]], false); assert.equal(m.active.size, 1);
    m.draw([['future', true]], false); assert.equal(m.active.size, 0);
    m.draw([['future', false]], false); assert.equal(m.active.size, 1);
    m.finish.get('future')(); assert.equal(m.active.size, 0);
  } finally { m.dispose(); }
});
await test('B2 : cleanup de useBufferState et indépendance des deux propriétaires', () => {
  const m = montage();
  try {
    m.draw([['a', false, true], ['b', false, true]], false); assert.equal(m.active.size, 2);
    m.draw([['b', false, true]], false); assert.equal(m.active.size, 1);
    m.finish.get('a')(); assert.equal(m.active.size, 1, 'une ancienne libération ne touche pas une autre scène');
    m.draw([], false); assert.equal(m.active.size, 0);
  } finally { m.dispose(); }
});
await test('B1 : un ancien handle global ne suspend jamais une autre scène', () => {
  const m = montage();
  try { m.nativeRender.delayRender('ancien'); m.draw([]); m.clock.advance(100); assert.equal(m.active.size, 0); }
  finally { m.dispose(); }
});
await test('G1 : aucune durée de prémontage visuel injectée implicitement', () => {
  const m = montage();
  try {
    const element = m.renderSequence({ from: 300, durationInFrames: 30 });
    assert.equal(element.premountFor ?? 0, 0);
    const explicit = m.renderSequence({ from: 300, durationInFrames: 30, premountFor: 12 });
    assert.equal(explicit.premountFor, 12);
  } finally { m.dispose(); }
});

function disponibilite() {
  const images = [], videos = [], events = [], scene = { pendingDraw: 0, lost: false };
  const root = { querySelectorAll: type => type === 'img' ? images : videos };
  const c = contexte({ document: { fonts: { status: 'loaded' } }, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) });
  c.window.__coulissesSceneReadiness = () => scene;
  const { createReady } = moduleDans(c.ctx, 'player/ready.ts', {});
  const ready = createReady({ root: () => root, playing: () => false, emit: (type, extra) => events.push({ type, extra }) });
  return { ...c, images, videos, events, scene, ready };
}
await test('G6 : 30 s d’attente produisent un rejet, jamais loaded', async () => {
  const c = disponibilite(); let result = 'attente';
  c.ready.setBuffering(true); c.ready.when().then(() => { result = 'succès'; }, () => { result = 'rejet'; });
  c.clock.advance(31000); await Promise.resolve();
  assert.equal(result, 'rejet'); assert.equal(c.events.some(e => e.type === 'loaded'), false); assert.equal(c.events.some(e => e.type === 'ready-error'), true);
  c.ready.dispose?.();
});
await test('G6 : une image cassée rejette la préparation', async () => {
  const c = disponibilite(); let result = 'attente';
  c.images.push({ complete: true, naturalWidth: 0, currentSrc: 'image-absente.png', getClientRects: () => [1], parentElement: null });
  c.ready.when().then(() => { result = 'succès'; }, () => { result = 'rejet'; }); c.clock.advance(100); await Promise.resolve();
  assert.equal(c.ready.ready(), false); assert.equal(result, 'rejet'); c.ready.dispose?.();
});
await test('G6 : une scène 3D sans premier dessin puis un contexte perdu ne sont pas prêts', () => {
  const c = disponibilite(); c.scene.pendingDraw = 1; assert.equal(c.ready.ready(), false);
  c.scene.pendingDraw = 0; assert.equal(c.ready.ready(), true);
  c.scene.lost = true; assert.equal(c.ready.ready(), false); c.ready.dispose?.();
});
await test('G6 : une attente globale sans propriétaire reste explicitement non vérifiée', () => {
  const c = disponibilite(); c.window.__coulissesReadiness = { snapshot: () => ({ activePending: 0, legacyPending: [42] }) };
  assert.equal(c.ready.ready(), false); assert.equal(c.ready.status?.().state, 'unverified'); c.ready.dispose?.();
});
await test('31/10 : une attente sans propriétaire jamais rendue ne masque plus l’image ni ne fait planter l’aperçu', async () => {
  const c = disponibilite(); c.window.__coulissesReadiness = { snapshot: () => ({ activePending: 0, legacyPending: [42] }) };
  let result = 'attente';
  c.ready.watch(); c.ready.when().then(() => { result = 'succès'; }, () => { result = 'rejet'; });
  assert.equal(c.ready.ready(), false);
  c.clock.advance(11000); await Promise.resolve();
  assert.equal(c.ready.ready(), true, 'orpheline depuis plus de 6 s : l’image est montrée');
  assert.equal(c.ready.status().verified, false);
  assert.equal(c.ready.status().reason, 'stale-unowned-render-handles');
  c.clock.advance(25000); await Promise.resolve();
  assert.equal(result, 'succès'); assert.equal(c.events.some(e => e.type === 'ready-error'), false, 'aucun « aperçu planté »');
  c.ready.dispose?.();
});
await test('03/11 : l’aperçu mis en sommeil (« Préparer 30 s ») ne déclare jamais « préparation expirée (root) »', async () => {
  const c = disponibilite(); c.ready.watch(); c.ready.setBuffering(true);
  c.ready.suspend(); c.clock.advance(31000); await Promise.resolve();
  assert.equal(c.events.some(e => e.type === 'ready-error'), false, 'aucun faux plantage pendant le sommeil');
  c.ready.watch(); c.clock.advance(100); await Promise.resolve();
  assert.equal(c.ready.ready(), true, 'au réveil, la surveillance reprend'); c.ready.dispose?.();
});
await test('G11 : toutes les racines retrouvent leur boucle après un réveil sur une autre scène', () => {
  const text = source('player/r3f.ts');
  const part = text.slice(text.indexOf('const shownCanvas'), text.indexOf('export const isAsleep')).replaceAll('export ', '');
  const a = { visible: true, parentElement: null, getClientRects: () => [1] }, b = { visible: false, parentElement: null, getClientRects: () => [1] };
  const mk = () => { const state = { frameloop: 'always', setFrameloop(value) { this.frameloop = value; } }; return { store: { getState: () => state, subscribe: () => noop } }; };
  const roots = new Map([[a, mk()], [b, mk()]]);
  const ctx = vm.createContext({ document: { querySelectorAll: () => [a, b] }, getComputedStyle: el => ({ display: 'block', visibility: 'visible', opacity: el.visible ? '1' : '0' }), _roots: roots, setInterval: () => 1, clearInterval: noop });
  vm.runInContext(stripTypeScriptTypes(part) + '\nsleep(true);', ctx);
  assert.deepEqual([...roots.values()].map(r => r.store.getState().frameloop), ['never', 'never']);
  a.visible = false; b.visible = true; vm.runInContext('sleep(false);', ctx);
  assert.deepEqual([...roots.values()].map(r => r.store.getState().frameloop), ['always', 'always']);
});
await test('G6 : le premier dessin attendu appartient uniquement aux canvas visibles', () => {
  const text = source('player/r3f.ts');
  const part = text.slice(text.indexOf('const shownCanvas'), text.indexOf('export const settle')).replaceAll('export ', '');
  const a = { visible: true, parentElement: null, getClientRects: () => [1] }, b = { visible: false, parentElement: null, getClientRects: () => [1] };
  const stateA = { gl: { info: { render: { frame: 1 } }, getContext: () => ({ isContextLost: () => false }) } };
  const stateB = { gl: { info: { render: { frame: 0 } }, getContext: () => ({ isContextLost: () => false }) } };
  const roots = new Map([[a, { store: { getState: () => stateA } }], [b, { store: { getState: () => stateB } }]]);
  const window = {}, ctx = vm.createContext({ window, document: { querySelectorAll: () => [a, b] }, getComputedStyle: el => ({ display: 'block', visibility: 'visible', opacity: el.visible ? '1' : '0' }), _roots: roots });
  vm.runInContext(stripTypeScriptTypes(part), ctx);
  assert.equal(typeof window.__coulissesSceneReadiness, 'function');
  assert.equal(window.__coulissesSceneReadiness().pendingDraw, 0);
  a.visible = false; assert.equal(window.__coulissesSceneReadiness().pendingDraw, 0, 'aucun canvas visible : une scène future ne bloque pas une scène 2D');
  b.visible = true; assert.equal(window.__coulissesSceneReadiness().pendingDraw, 1);
  stateB.gl.info.render.frame = 1; assert.equal(window.__coulissesSceneReadiness().pendingDraw, 0);
});

console.log(`\n${ok} ok, ${ko} ko${reference ? ` · référence ${reference}` : ''}`);
process.exitCode = ko ? 1 : 0;

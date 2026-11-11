// Contrats du calcul de plages et de son annulation ; processus, navigateur et rendu simulés.
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createCodeRangeRenderer } from '../lib/code-playback-render.mjs';
import { runCodeRange, watchParentDisconnect } from '../lib/code-playback-worker.mjs';

const generation = { project: { remotionDir: path.resolve('.cache', 'calcul-simule') }, hash: 'code-a', mediaSignature: 'media-a', width: 1920, height: 1080, durationInFrames: 300, fps: 30 };
const request = { generation, from: 30, to: 60, fps: 30, output: path.resolve('.cache', 'calcul-simule', 'plage.mp4') };
const job = { ...request, project: generation.project };
const withComposition = (deps, composition = generation) => ({ compositionOf: async () => composition, ...deps });
let ok = 0, ko = 0;
async function check(nom, fn) { try { await fn(); ok++; console.log(`  ✓ ${nom}`); } catch (e) { ko++; console.log(`  ✗ ${nom} : ${e.message}`); } }
function simulated() {
  const calls = [], child = new EventEmitter(), killer = new EventEmitter();
  child.pid = 87654; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdin.end = (data) => { child.input = JSON.parse(data); };
  const renderer = createCodeRangeRenderer({ platform: 'win32', spawnProcess: (...args) => { calls.push(args); return args[0] === 'taskkill' ? killer : child; } });
  return { renderer, child, killer, calls };
}

await check('La plage a du son, une borne exclusive, une concurrence de 1 et une signature complète', async () => {
  let options, close = 0; const reports = [];
  let selectedKey;
  const result = await runCodeRange(job, withComposition({ compositionOf: async (_p, _log, opts) => { selectedKey = opts.cacheKey; return generation; },
    renderVideo: async (p, out, opts) => { options = opts; opts.onProgress(0.4, 12, 4, 'encoding'); return { out }; }, closeCode: async () => close++ }), (x) => reports.push(x));
  assert.equal(options.muted, false); assert.equal(options.concurrency, 1); assert.deepEqual(options.frameRange, [30, 59]);
  assert.equal(options.cacheKey, 'code-a:media-a'); assert.equal(selectedKey, options.cacheKey); assert.equal(close, 1); assert.equal(result.generation, 'code-a');
  assert.equal(reports[0].progress, 0.4);
});
await check('La définition reste sous 1280×720, paysage comme portrait, sans agrandissement', async () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920], [7680, 4320], [320, 180]]) {
    let scale;
    await runCodeRange(job, withComposition({ renderVideo: async (_p, _o, opts) => { scale = opts.scale; return {}; }, closeCode: async () => {} }, { ...generation, width, height }));
    assert.ok(width * scale <= 1280 && height * scale <= 720 && scale <= 1);
  }
});
await check('Les quatre résolutions utilisent la taille native de la composition et gardent la piste audio', async () => {
  for (const requested of [1, 0.75, 0.5, 0.25]) {
    let options;
    await runCodeRange({...job, scale: requested}, withComposition({renderVideo: async (_p, _o, opts) => {options = opts; return {};}, closeCode: async () => {}}, {...generation, width: 1920, height: 1080}));
    assert.equal(options.scale, requested); assert.equal(options.muted, false);
  }
});
await check('Une erreur de calcul ferme aussi le navigateur', async () => {
  let close = 0;
  await assert.rejects(runCodeRange(job, withComposition({ renderVideo: async () => { throw new Error('échec simulé'); }, closeCode: async () => close++ })), /échec simulé/);
  assert.equal(close, 1);
});
await check('Une composition dont la cadence ou la durée diffère n’est jamais rendue', async () => {
  let rendered = 0, closed = 0;
  for (const change of [{ fps: 24 }, { durationInFrames: 301 }]) {
    await assert.rejects(runCodeRange(job, withComposition({ renderVideo: async () => rendered++, closeCode: async () => closed++ }, { ...generation, ...change })), /durée ou la cadence/);
  }
  assert.equal(rendered, 0); assert.equal(closed, 2);
});
await check('Une plage ou une cadence invalide est refusée avant toute compilation', async () => {
  let count = 0; const dependencies = { renderVideo: async () => count++, closeCode: async () => count++ };
  for (const change of [{ from: -1 }, { to: 30 }, { to: 301 }, { fps: 29 }, { output: 'relatif.mp4' }]) await assert.rejects(runCodeRange({ ...job, ...change }, dependencies));
  assert.equal(count, 0);
});
await check('Le processus reste caché, reçoit la demande par stdin et renvoie la progression', async () => {
  const { renderer, child, calls } = simulated(), progress = [];
  const pending = renderer({ ...request, onProgress: (...args) => progress.push(args) });
  assert.equal(calls[0][2].windowsHide, true); assert.deepEqual(calls[0][2].stdio, ['pipe', 'pipe', 'pipe', 'ipc']);
  assert.deepEqual(child.input, job);
  child.emit('message', { type: 'progress', progress: 0.5, renderedFrames: 15, encodedFrames: 8, stage: 'encoding' });
  child.emit('message', { type: 'result', result: { out: request.output } }); child.emit('close', 0);
  assert.equal((await pending).out, request.output); assert.equal(progress[0][0], 0.5);
});
await check('Le résultat attend la fermeture réelle du processus', async () => {
  const { renderer, child } = simulated(); let settled = false;
  const pending = renderer(request).finally(() => { settled = true; });
  child.emit('message', { type: 'result', result: { out: request.output } });
  await Promise.resolve(); assert.equal(settled, false); child.emit('close', 0); await pending;
});
await check('Une annulation ne vise que le PID propre et attend sa fermeture', async () => {
  const { renderer, child, calls } = simulated(), controller = new AbortController(); let settled = false;
  const pending = renderer({ ...request, signal: controller.signal }).catch((e) => { settled = true; return e; });
  controller.abort();
  assert.deepEqual(calls[1].slice(0, 2), ['taskkill', ['/PID', '87654', '/T', '/F']]); assert.equal(calls[1][2].windowsHide, true);
  await Promise.resolve(); assert.equal(settled, false);
  child.emit('message', { type: 'result', result: {} }); child.emit('close', 1);
  assert.equal((await pending).name, 'AbortError'); assert.equal(calls.length, 2);
});
await check('Une annulation préalable ne lance aucun processus', async () => {
  const { renderer, calls } = simulated(), controller = new AbortController(); controller.abort();
  await assert.rejects(renderer({ ...request, signal: controller.signal }), { name: 'AbortError' }); assert.equal(calls.length, 0);
});
await check('Les journaux sont bornés et un résultat partiel suivi d’un échec est rejeté', async () => {
  const { renderer, child } = simulated(); const pending = renderer(request).catch((e) => e);
  child.stderr.emit('data', 'x'.repeat(100000)); child.emit('message', { type: 'result', result: {} }); child.emit('close', 1);
  const error = await pending; assert.ok(error instanceof Error); assert.ok(error.logs.length <= 32768);
});
await check('Une fermeture sans résultat n’est pas une réussite', async () => {
  const { renderer, child } = simulated(); const pending = renderer(request); child.emit('close', 0); await assert.rejects(pending);
});
await check('Une erreur de suivi ne tue pas le processus de calcul', async () => {
  const { renderer, child } = simulated(); const pending = renderer({ ...request, onProgress: () => { throw new Error('interface interrompue'); } });
  child.emit('message', { type: 'progress', progress: 0.3 }); child.emit('message', { type: 'result', result: {} }); child.emit('close', 0); await pending;
});
await check('Le PID du worker est inscrit avant l’envoi du travail', async () => {
  const { renderer, child } = simulated(); let pid = null;
  const pending = renderer({ ...request, onWorkerPid: (value) => { pid = value; assert.equal(child.input, undefined); } });
  assert.equal(pid, 87654); assert.ok(child.input); child.emit('message', { type: 'result', result: {} }); child.emit('close', 0); await pending;
});
await check('Un verrou impossible à inscrire empêche tout lancement de rendu', async () => {
  const { renderer, child, calls } = simulated(); const pending = renderer({ ...request, onWorkerPid: () => { throw new Error('verrou inaccessible'); } });
  assert.equal(child.input, undefined); assert.equal(calls[1][0], 'taskkill'); child.emit('close', 1); await assert.rejects(pending, /verrou inaccessible/);
});
await check('La disparition du parent ferme le navigateur avant d’arrêter le worker', async () => {
  const channel = new EventEmitter(), events = []; let release;
  const closed = new Promise((resolve) => { release = resolve; });
  const watch = watchParentDisconnect({ channel, cleanup: async () => { events.push('fermeture'); await closed; events.push('fermé'); }, finish: () => events.push('arrêt') });
  channel.emit('disconnect'); await Promise.resolve(); assert.deepEqual(events, ['fermeture']);
  release(); await watch.completion; assert.deepEqual(events, ['fermeture', 'fermé', 'arrêt']);
});
await check('Une fermeture normale ne déclenche pas le traitement des processus orphelins', async () => {
  const channel = new EventEmitter(); let count = 0;
  const watch = watchParentDisconnect({ channel, cleanup: async () => count++, finish: () => count++ });
  watch.stop(); channel.emit('disconnect'); await Promise.resolve(); assert.equal(count, 0);
});
await check('Un navigateur bloqué est arrêté au délai de garde, une seule fois', async () => {
  const channel = new EventEmitter(); let deadline, count = 0;
  const watch = watchParentDisconnect({ channel, cleanup: () => new Promise(() => {}), finish: () => count++,
    schedule: (fn) => { deadline = fn; return 1; }, unschedule() {} });
  channel.emit('disconnect'); await Promise.resolve(); deadline(); deadline(); assert.equal(count, 1); assert.ok(watch.completion);
});
console.log(`${ok} ok, ${ko} ko`); process.exitCode = ko ? 1 : 0;

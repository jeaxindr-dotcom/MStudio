// Ordonnanceur et cache seuls : aucun navigateur, réseau, ffmpeg ou rendu réel.
// Rouge attendu : node tests/code-playback-regressions.mjs --revision 10633a9
// Vert attendu : node tests/code-playback-regressions.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let ok = 0, ko = 0;
const check = (value, label) => { value ? ok++ : ko++; console.log(`  ${value ? '✓' : '✗'} ${label}`); };
const revAt = process.argv.indexOf('--revision');
let moduleUrl = pathToFileURL(path.join(ROOT, 'lib/code-playback.mjs')).href;
if (revAt >= 0) {
  try {
    const source = execFileSync('git', ['show', `${process.argv[revAt + 1]}:lib/code-playback.mjs`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const fixed = source.replace(/'\.\/(render-activity|code-playback-scale)\.mjs'/g, (_match, name) => JSON.stringify(pathToFileURL(path.join(ROOT, 'lib', name + '.mjs')).href));
    moduleUrl = `data:text/javascript;base64,${Buffer.from(fixed).toString('base64')}`;
  } catch {
    check(false, 'la version de référence fournit une file bornée de préparation des plages du code');
    console.log(`\n${ok} ok, ${ko} ko (module absent de la référence ${process.argv[revAt + 1]})`);
    process.exit(1);
  }
}
const { createCodePlayback } = await import(moduleUrl);
const cacheRoot = path.join(ROOT, '.cache'); fs.mkdirSync(cacheRoot, { recursive: true });
const temp = fs.mkdtempSync(path.join(cacheRoot, 'code-playback-tests-'));
const instances = [], generation = (hash = 'code-a', mediaSignature = 'medias-a') => ({ hash, mediaSignature, fps: 30, durationInFrames: 3000 });
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const rejected = async (fn) => { try { await fn(); return false; } catch { return true; } };
let serial = 0;
function setup(options = {}) {
  const own = path.join(temp, `cas-${++serial}`), tasks = new Map(), calls = [], pending = [];
  fs.mkdirSync(own, { recursive: true });
  let busy = false, clock = 100, nextTimer = 0, guardCalls = 0, signature = 'medias-a';
  const times = [];
  const timers = { setTimeout: (fn, ms) => { times.push(ms); const id = ++nextTimer; tasks.set(id, fn); return id; }, clearTimeout: (id) => tasks.delete(id) };
  const args = { cacheDir: path.join(own, 'cache'), lockFile: path.join(own, 'lecture.lock'), timers,
    now: () => ++clock, guard: async () => { guardCalls++; return busy ? [{ port: 4173, running: ['export'] }] : []; },
    fingerprint: async () => signature,
    render: (request) => {
      calls.push(request);
      return new Promise((resolve, reject) => pending.push({ request, resolve, reject }));
    }, ...options };
  const api = createCodePlayback(args); instances.push(api);
  const finish = async (at = calls.length - 1, bytes = 4) => {
    const item = pending[at]; fs.writeFileSync(item.request.output, Buffer.alloc(bytes)); item.resolve(); await flush();
  };
  const fail = async (at = calls.length - 1) => { pending[at].reject(new Error('Échec de préparation injecté.')); await flush(); };
  const tick = async () => { const batch = [...tasks.values()]; tasks.clear(); for (const fn of batch) fn(); await flush(); };
  return { api, args, calls, finish, fail, tick, times, get guardCalls() { return guardCalls; },
    busy: (value) => { busy = value; }, signature: (value) => { signature = value; } };
}

try {
  {
    const s = setup();
    check(await rejected(() => s.api.request({ from: 0, to: 30 })), 'une plage ne peut pas être demandée sans version de code');
    s.api.update(generation());
    for (const range of [{ from: -1, to: 30 }, { from: 0, to: 0 }, { from: 0, to: 901 }, { from: 2999, to: 3001 }, { from: 0.5, to: 30 }]) {
      check(await rejected(() => s.api.request(range)), `plage invalide refusée : ${JSON.stringify(range)}`);
    }
    check(s.calls.length === 0, 'les demandes invalides ne démarrent aucun travail');
    for (const scale of [null, 0, 0.125, '0.5', 2]) check(await rejected(() => s.api.request({from: 0, to: 30, scale})), `résolution non proposée refusée : ${scale}`);
    const c = s.api.status().cache;
    check(c.maxBytes === 512 * 1024 ** 2 && c.maxEntries === 6 && c.maxSeconds === 30, 'budgets par défaut : 512 Mio, six plages et trente secondes');
    s.api.dispose();
  }
  {
    const s = setup(); s.busy(true); s.api.update(generation());
    const a = await s.api.request({ from: 0, to: 30 }); await flush();
    check(s.api.status(a.id).status === 'queued' && !s.calls.length, 'un export actif garde la demande en attente');
    s.busy(false); await s.tick();
    check(s.api.status(a.id).status === 'preparing' && s.calls.length === 1 && s.guardCalls >= 3, 'la garde est relue avant puis après l’obtention du verrou');
    check(a.renderedFrames === 0, 'la plage en attente démarre à zéro image calculée');
    s.calls[0].onProgress(0.4, 17);
    check(s.api.status(a.id).progress === 0.4, 'la progression est attribuée à sa tâche');
    check(s.api.status(a.id).renderedFrames === 17, 'le compteur expose le nombre exact d’images du moteur indépendamment du pourcentage');
    s.calls[0].onProgress(0.42);
    check(s.api.status(a.id).renderedFrames === 17, 'une mise à jour sans compteur conserve le nombre d’images calculées');
    const duplicate = await s.api.request({ from: 0, to: 30 });
    check(duplicate.id === a.id && s.calls.length === 1, 'une même plage en cours ne démarre pas un second travail');
    const b = await s.api.request({ from: 30, to: 60 }); await flush();
    check(s.api.status(b.id).status === 'queued' && s.calls.length === 1, 'une seule tâche locale fonctionne à la fois');
    await s.finish(0); await s.tick();
    check(s.api.status(a.id).status === 'ready' && !!s.api.file(a.id) && s.calls.length === 2, 'la fin d’une tâche publie sa plage et libère la suivante');
    check(s.api.status(a.id).renderedFrames === 30, 'une plage publiée contient toutes ses images calculées');
    await s.finish(1);
    check(s.times.every((ms) => ms === 2000), 'la surveillance utilise un intervalle de deux secondes');
    const half = await s.api.request({from: 0, to: 30, scale: 0.5}); await flush();
    check(half.key !== a.key && s.calls[2].scale === 0.5 && half.scale === 0.5, 'une plage à 50 % a sa propre clé et transporte son échelle au worker');
    await s.finish(2);
    const reopened = setup({cacheDir: s.args.cacheDir, lockFile: s.args.lockFile}); reopened.api.update(generation());
    const halfAgain=await reopened.api.request({from:0,to:30,scale:0.5}), automatic=await reopened.api.request({from:0,to:30});
    check(halfAgain.status==='ready' && automatic.status==='ready' && halfAgain.key===half.key && automatic.key===a.key && !reopened.calls.length, 'le cache persistant relit indépendamment le profil 50 % et le profil automatique historique');
    check(halfAgain.renderedFrames === 30 && automatic.renderedFrames === 30, 'une plage restaurée du cache connaît son nombre d’images');
    s.api.dispose();
  }
  {
    const s = setup(); s.api.update(generation());
    const a = await s.api.request({ from: 0, to: 30 }); await flush();
    const b = await s.api.request({ from: 30, to: 60 }); await flush();
    let cancelled = false;
    const cancellation = s.api.cancelAndWait(a.id).then(() => { cancelled = true; }); await s.tick();
    check(s.calls[0].signal.aborted && s.calls.length === 1, 'annuler demande l’arrêt mais attend la fermeture effective du moteur');
    check(!cancelled, 'cancelAndWait reste en attente tant que le moteur n’a pas confirmé sa fin');
    await s.finish(0); await cancellation; await s.tick();
    check(cancelled, 'cancelAndWait répond après la fermeture du moteur');
    check(s.api.status(a.id).status === 'cancelled' && s.api.file(a.id) === null && !fs.existsSync(s.calls[0].output), 'une fin tardive après annulation ne publie rien et nettoie son temporaire');
    check(s.calls.length === 2 && s.api.status(b.id).status === 'preparing', 'la tâche suivante commence seulement après la fin effective de la précédente');
    await s.finish(1); s.api.dispose();
  }
  {
    const s = setup(); s.api.update(generation());
    const a = await s.api.request({ from: 0, to: 30 }); await flush();
    let idle = false;
    const waiting = s.api.waitForIdle(a.id).then(() => { idle = true; }); await flush();
    check(!idle && !s.calls[0].signal.aborted, 'waitForIdle attend le travail partagé sans l’annuler');
    await s.finish(); await waiting;
    check(idle && s.api.status(a.id).status === 'ready', 'waitForIdle conserve le résultat d’une préparation partagée');
    s.api.dispose();
  }
  {
    const s = setup(); s.busy(true); s.api.update(generation());
    const a = await s.api.request({ from: 0, to: 30 }); await flush();
    let idle = false;
    const waiting = s.api.waitForIdle(a.id).then(() => { idle = true; }); await flush();
    check(!idle && !s.calls.length, 'waitForIdle attend aussi une tâche partagée encore en file');
    s.busy(false); await s.tick(); await s.finish(); await waiting;
    check(idle && s.api.status(a.id).status === 'ready', 'l’attente d’une tâche en file se termine après sa préparation effective');
    s.api.dispose();
  }
  {
    const s = setup(); s.api.update(generation());
    const ready = await s.api.request({ from: 0, to: 30 }); await flush(); await s.finish();
    const active = await s.api.request({ from: 30, to: 60 }); await flush();
    const queued = await s.api.request({ from: 60, to: 90 });
    s.api.update(generation('code-b'));
    check([ready, active, queued].every((item) => s.api.status(item.id).status === 'cancelled' && !s.api.status(item.id).current), 'changer le code invalide ensemble les plages prêtes, actives et en attente');
    check(s.calls[1].signal.aborted && s.api.file(ready.id) === null, 'l’ancienne plage cesse immédiatement d’être servie comme courante');
    await s.finish(1); const next = await s.api.request({ from: 0, to: 30 }); await flush();
    check(next.key !== ready.key && s.calls.length === 3, 'le nouveau code produit une clé distincte pour la même plage');
    await s.finish(2); s.api.dispose();
  }
  {
    const s = setup(); s.api.update(generation()); s.signature('medias-b');
    check(await rejected(() => s.api.request({ from: 0, to: 30 })) && !s.calls.length, 'une source modifiée avant la compilation interdit la préparation sous l’ancien hash');
    check(s.api.status().generation.stale && s.api.status().generation.mediaSignature === 'medias-a', 'une empreinte différente n’est jamais adoptée sous la génération ancienne');
    s.api.update(generation('code-b', 'medias-b'));
    const next = await s.api.request({ from: 0, to: 30 }); await flush(); await s.finish();
    check(s.api.file(next.id) !== null, 'une nouvelle génération déclarée avec la bonne empreinte peut être préparée');
    s.api.dispose();
  }
  {
    const s = setup(); s.api.update(generation());
    const a = await s.api.request({ from: 0, to: 30 }); await flush();
    s.signature('medias-b'); await s.tick();
    check(s.calls[0].signal.aborted && s.api.status(a.id).status === 'cancelled', 'la surveillance interrompt une préparation dont les sources changent');
    await s.finish();
    check(s.api.file(a.id) === null && s.api.status().cache.entries === 0, 'aucune plage périmée ne rejoint le cache après cette annulation');
    s.api.dispose();
  }
  {
    const s = setup(); s.api.update(generation());
    const a = await s.api.request({ from: 0, to: 30 }); await flush();
    s.signature('medias-b'); await s.finish();
    check(s.api.file(a.id) === null && s.api.status(a.id).status === 'cancelled', 'l’empreinte est également contrôlée juste avant publication, entre deux surveillances');
    s.api.dispose();
  }
  {
    const s = setup(); s.api.update(generation());
    const a = await s.api.request({ from: 0, to: 30 }); await flush();
    const b = await s.api.request({ from: 30, to: 60 }); await flush();
    s.busy(true); await s.tick();
    check(s.calls[0].signal.aborted && s.api.status(a.id).reason.includes('export'), 'un export utilisateur apparu après le début interrompt notre seul moteur');
    await s.finish(0); await s.tick();
    check(s.calls.length === 1 && s.api.status(b.id).status === 'queued', 'aucune autre plage ne démarre pendant cet export');
    s.busy(false); await s.tick(); await s.finish(1); s.api.dispose();
  }
  {
    const s = setup({ maxBytes: 10, maxEntries: 2 }); s.api.update(generation());
    const items = [];
    for (let i = 0; i < 3; i++) { items.push(await s.api.request({ from: 30 * i, to: 30 * (i + 1) })); await flush(); await s.finish(i); }
    const c = s.api.status().cache;
    check(c.entries === 2 && c.bytes === 8 && s.api.file(items[0].id) === null, 'la purge retire les plages anciennes pour respecter le nombre et le volume du cache');
    const last = items.at(-1), cachedPath = s.api.file(last.id);
    s.api.dispose();
    const again = setup({ cacheDir: s.args.cacheDir, lockFile: s.args.lockFile, maxBytes: 10, maxEntries: 2 }); again.api.update(generation());
    const same = await again.api.request({ from: 60, to: 90 }); await flush();
    check(same.status === 'ready' && !again.calls.length && again.api.file(same.id) === cachedPath, 'une plage complète reste réutilisable après recréation du service');
    again.api.update(generation('code-a', 'medias-b')); again.signature('medias-b');
    const changed = await again.api.request({ from: 60, to: 90 }); await flush();
    check(changed.key !== same.key && again.calls.length === 1, 'la signature des médias change la clé même lorsque le hash du code reste égal');
    await again.finish(); again.api.dispose();
  }
  {
    const s = setup({ maxBytes: 10 }); s.api.update(generation());
    const large = await s.api.request({ from: 0, to: 30 }); await flush(); await s.finish(0, 11);
    check(s.api.status(large.id).status === 'error' && s.api.file(large.id) === null, 'une plage plus grande que le budget produit une erreur et aucun fichier servi');
    const retry = await s.api.request({ from: 0, to: 30 }); await flush(); await s.fail(1);
    check(retry.id !== large.id && s.api.status(retry.id).status === 'error', 'une erreur est explicite et peut être retentée sans réutiliser l’ancienne tâche');
    s.api.dispose();
  }
  {
    const s = setup(); s.api.update({ ...generation(), width: 1920, height: 1080 });
    const a = await s.api.request({ from: 0, to: 30 }); await flush(); await s.finish();
    s.api.update({ ...generation(), width: 1080, height: 1920 });
    const b = await s.api.request({ from: 0, to: 30 }); await flush();
    check(a.key !== b.key && !s.api.file(a.id) && s.calls.length === 2, 'les dimensions de rendu font partie de l’identité du cache');
    await s.finish(1); s.api.dispose();
  }
  {
    const s = setup({ maxBytes: 10 }); s.api.update(generation());
    const a = await s.api.request({ from: 0, to: 30 }); await flush();
    fs.writeFileSync(s.calls[0].output, Buffer.alloc(11)); await s.tick();
    check(s.calls[0].signal.aborted && s.api.status(a.id).status === 'cancelled', 'le volume du temporaire est aussi surveillé pendant la préparation');
    await s.finish(); s.api.dispose();
  }
  {
    const s = setup({ guard: async () => { throw new Error('Statut indisponible.'); } }); s.api.update(generation());
    const a = await s.api.request({ from: 0, to: 30 }); await flush();
    check(!s.calls.length && s.api.status(a.id).status === 'queued', 'une erreur de la garde ne donne jamais l’autorisation de lancer un travail');
    s.api.dispose();
  }
  {
    const common = path.join(temp, 'commun.lock'), a = setup({ lockFile: common }), b = setup({ lockFile: common });
    a.api.update(generation()); b.api.update(generation('code-b'));
    const first = await a.api.request({ from: 0, to: 30 }); await flush();
    const second = await b.api.request({ from: 0, to: 30 }); await flush();
    check(a.calls.length === 1 && !b.calls.length && b.api.status(second.id).status === 'queued', 'le verrou commun empêche deux studios de préparer simultanément');
    a.api.cancel(first.id); await b.tick();
    check(!b.calls.length && fs.existsSync(common), 'un moteur annulé conserve le verrou jusqu’à sa fermeture effective');
    await a.finish(); await b.tick();
    check(b.calls.length === 1 && b.api.status(second.id).status === 'preparing', 'le second studio commence quand le premier a libéré son verrou');
    await b.finish(); a.api.dispose(); b.api.dispose();
  }
  {
    const s = setup();
    fs.writeFileSync(s.args.lockFile, JSON.stringify({ pid: 2147483647, token: 'processus-absent' }));
    s.api.update(generation()); const job = await s.api.request({ from: 0, to: 30 }); await flush();
    check(s.calls.length === 1 && s.api.status(job.id).status === 'preparing', 'un verrou de rendu dont le processus est mort peut être repris');
    await s.finish(); s.api.dispose();
  }
  {
    const s = setup();
    fs.writeFileSync(s.args.lockFile, JSON.stringify({ pid: 2147483647, workerPid: process.pid, token: 'worker-encore-vivant' }));
    s.api.update(generation()); const job = await s.api.request({ from: 0, to: 30 }); await flush();
    check(!s.calls.length && s.api.status(job.id).status === 'queued', 'un worker vivant conserve le verrou même si son serveur parent est mort');
    s.api.dispose();
  }
  {
    const s = setup(); s.api.update(generation());
    await s.api.request({ from: 0, to: 30 }); await flush(); s.calls[0].onWorkerPid(process.pid);
    check(JSON.parse(fs.readFileSync(s.args.lockFile, 'utf8')).workerPid === process.pid, 'le moteur peut enregistrer son propre PID dans le verrou');
    await s.finish(); s.api.dispose();
  }
  {
    const s = setup(); fs.writeFileSync(`${s.args.lockFile}.claim`, JSON.stringify({ pid: 2147483647, token: 'reprise-abandonnee' }));
    s.api.update(generation()); const job = await s.api.request({ from: 0, to: 30 }); await flush();
    check(!s.calls.length && s.api.status(job.id).status === 'queued', 'une acquisition de verrou abandonnée reste bloquante plutôt que d’autoriser des travaux concurrents');
    s.api.dispose();
  }
  {
    const s = setup(); s.api.update(generation());
    const a = await s.api.request({ from: 0, to: 30 }); await flush();
    let stopped = false;
    const stopping = s.api.dispose().then(() => { stopped = true; }); await flush();
    check(!stopped, 'dispose attend la fermeture effective du moteur');
    await s.finish(); await stopping;
    check(s.calls[0].signal.aborted && s.api.file(a.id) === null && !fs.existsSync(s.args.lockFile), 'l’arrêt annule la préparation et sa fin tardive libère le verrou sans publication');
    check(await rejected(() => s.api.request({ from: 0, to: 30 })), 'un service arrêté refuse les nouvelles demandes');
  }
} catch (error) {
  check(false, `exception inattendue : ${error.stack ?? error}`);
} finally {
  for (const api of instances) api.dispose();
  // Dossier unique créé par cette suite, strictement sous son propre .cache.
  const resolved = path.resolve(temp);
  if (resolved.startsWith(path.resolve(cacheRoot) + path.sep) && path.basename(resolved).startsWith('code-playback-tests-')) fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`\n${ok} ok, ${ko} ko`);
process.exitCode = ko ? 1 : 0;

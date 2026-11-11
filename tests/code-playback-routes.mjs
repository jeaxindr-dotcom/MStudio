// Exécute les vrais helpers et routes extraits de studio-server.mjs dans une VM.
// Seuls empreintes, constructeur, ordonnanceur et réponses HTTP sont simulés.
// Aucun studio, navigateur, processus de rendu ou serveur HTTP n'est démarré.
// --mutant <nom> retire en mémoire UNE protection : la même suite doit alors échouer.
// Ces mutations sont des contrôles de sensibilité, pas une prétendue référence 10633a9.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { validPlaybackScale } from '../lib/code-playback-scale.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'studio-server.mjs'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Section réelle du serveur introuvable : ${start}`);
  return source.slice(a, b);
}
let helpers = section('const playbackOwners = new Map();', '// ---- the plans of the versions');
let routes = section("    if ((pn === '/api/code-playback' || pn === '/api/code-playback/prepare')", "    // the preview's messages with the page");
const mutation = process.argv.indexOf('--mutant'), mutant = mutation < 0 ? null : process.argv[mutation + 1];
const replace = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`Protection à muter introuvable : ${from}`);
  return text.replace(from, to);
};
switch (mutant) {
  case null: break;
  case 'tombstone':
    routes = replace(routes, "      if (entry?.cancelled) return json(res, { error: 'Cette préparation a été annulée.' }, 409);", ''); break;
  case 'annulation-empreinte':
    routes = replace(routes, "          if (entry.cancelled) throw new Error('Préparation annulée avant le calcul.');", ''); break;
  case 'annulation-partage':
    helpers = replace(helpers, 'if (shared) await CODE_PLAYBACK.waitForIdle(entry.id); else await CODE_PLAYBACK.cancelAndWait(entry.id);', 'await CODE_PLAYBACK.cancelAndWait(entry.id);'); break;
  case 'proprietaire-pendant':
    helpers = replace(helpers, '(other.id === entry.id || other.requestKey === entry.requestKey)', '(other.id === entry.id)'); break;
  case 'validation-get':
    routes = replace(routes, "      const source = state.status === 'ready' ? await codePlaybackSources(P) : state.mediaSignature;", "      const oldHash = player.state.hash;\n      const source = state.status === 'ready' ? await codePlaybackSources(P) : state.mediaSignature;");
    routes = replace(routes, 'state.hash !== player.state.hash || state.mediaSignature !== source', 'state.hash !== oldHash || state.mediaSignature !== source');
    routes = replace(routes, '      const source = await codePlaybackSources(P);', "      const oldHash = player.state.hash, oldStatus = player.state.status;\n      const source = await codePlaybackSources(P);");
    routes = replace(routes, "state?.hash === player.state.hash && player.state.status === 'ready'", "state?.hash === oldHash && oldStatus === 'ready'"); break;
  case 'frise-perimee':
    helpers = replace(helpers, ' || timelineCodeVersion !== player.state.version', '');
    helpers = replace(helpers, ' || timelineCodeVersion !== version', ''); break;
  case 'empreintes-differentes':
    helpers = replace(helpers, 'mediaSignature !== before || ', ''); break;
  case 'construction-omise':
    helpers = replace(helpers, 'await player.build(); await timelineChain;', 'await timelineChain;'); break;
  default: throw new Error(`Mutation inconnue : ${mutant}`);
}

let ok = 0, ko = 0;
const check = (value, label) => { value ? ok++ : ko++; console.log(`  ${value ? '✓' : '✗'} ${label}`); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const input = (owner, extra = {}) => ({ owner, version: 1, from: 0, to: 30, width: 1920, height: 1080, ...extra });

function setup() {
  const jobs = new Map(), byKey = new Map(), updates = [], requests = [], cancellations = [], waits = [], files = [];
  let nextJob = 0, builds = 0, sourceCalls = 0, fileCalls = 0, currentGeneration = null;
  let sourceHook = async () => 'sources-a', buildHook = async () => {}, requestHook = async () => {};
  const player = { state: { status: 'ready', hash: 'code-a', version: 1 }, build: async () => { builds++; await buildHook(); } };
  const timeline = { state: { status: 'ready', data: { fps: 30, frames: 300 } } };
  const snapshot = (job) => job ? { id: job.id, key: job.key, hash: job.hash, status: job.status, mediaSignature: job.mediaSignature } : null;
  const api = {
    update(generation) { currentGeneration = generation; updates.push(generation); },
    async request(range) {
      const key = JSON.stringify([currentGeneration.hash, currentGeneration.mediaSignature, range.from, range.to, range.scale]);
      let job = byKey.get(key);
      if (!job || job.status === 'cancelled') {
        job = { id: `job-${++nextJob}`, key, hash: currentGeneration.hash, mediaSignature: currentGeneration.mediaSignature, status: 'preparing', done: deferred() };
        jobs.set(job.id, job); byKey.set(key, job);
      }
      requests.push({ ...range, id: job.id });
      await requestHook(requests.length, job);
      return snapshot(job);
    },
    status: (id) => snapshot(jobs.get(id)),
    file(id) { fileCalls++; return jobs.get(id)?.status === 'ready' ? `C:/test/${id}.mp4` : null; },
    async cancelAndWait(id) { cancellations.push(id); const job = jobs.get(id); if (!job) return null;
      const running = job.status === 'preparing'; job.status = 'cancelled'; if (running) await job.done.promise; return snapshot(job); },
    async waitForIdle(id) { waits.push(id); const job = jobs.get(id); if (job?.status === 'preparing') await job.done.promise; return snapshot(job); },
  };
  const context = { CODE_PLAYBACK: api, player, timeline, timelineCodeVersion: 1, timelineChain: Promise.resolve(), P: { id: 'projet-de-test' },
    codePlaybackSources: async () => sourceHook(++sourceCalls), validPlaybackScale, URL,
    body: async (req) => Buffer.from(JSON.stringify(req.payload ?? {})),
    json: (_res, data, status = 200) => ({ kind: 'json', status, data }),
    sendFile: (_req, _res, file, type) => { files.push(file); return { kind: 'file', status: 200, file, type }; },
  };
  vm.createContext(context);
  vm.runInContext(`${helpers}\nasync function dispatch(req) { const url = new URL(req.url, 'http://test.local'), pn = url.pathname, res = {};\n${routes}\nreturn {status:404}; }\nglobalThis.harness = {dispatch, owners:playbackOwners, playbackGeneration};`, context);
  const call = (url, method = 'GET', payload) => context.harness.dispatch({ url, method, payload });
  const finish = (id) => { const job = jobs.get(id); if (!job) return; if (job.status === 'preparing') job.status = 'ready'; job.done.resolve(); };
  const finishAll = async () => { for (const id of jobs.keys()) finish(id); await flush(); };
  return { context, api, player, jobs, updates, requests, cancellations, waits, files, call, finish, finishAll,
    post: (data) => call('/api/code-playback', 'POST', data), cancel: (owner) => call('/api/code-playback/cancel', 'POST', { owner }),
    source: (fn) => { sourceHook = fn; }, build: (fn) => { buildHook = fn; }, request: (fn) => { requestHook = fn; },
    get builds() { return builds; }, get sourceCalls() { return sourceCalls; }, get fileCalls() { return fileCalls; } };
}

try {
  {
    const s = setup();
    const invalid = await s.call('/api/code-playback/prepare', 'POST', input('profil', {scale: '0.25'}));
    check(invalid.status === 400 && !s.builds, 'le serveur refuse une résolution invalide avant de lire ou rendre le projet');
    const quarter = await s.call('/api/code-playback/prepare', 'POST', input('profil', {scale: 0.25}));
    const reuse = await s.post(input('profil', {scale: 0.25}));
    const conflict = await s.post(input('profil', {scale: 1}));
    const other = await s.post(input('autre-profil', {scale: 1}));
    check(quarter.status === 200 && reuse.data.id === quarter.data.id && s.requests[0].scale === 0.25, 'les deux routes conservent le même job pour le même propriétaire et la même résolution');
    check(conflict.status === 409 && other.data.id !== quarter.data.id, 'une ancienne demande du même propriétaire ne réutilise pas une plage de résolution différente');
    await s.finishAll();
  }
  {
    const s = setup(), cancel = await s.cancel('avant-post'), post = await s.post(input('avant-post'));
    check(cancel.status === 200 && post.status === 409, 'une annulation arrivée avant POST laisse une interdiction persistante');
    check(s.requests.length === 0 && s.builds === 0, 'une demande annulée à l’avance ne prépare ni code ni plage');
  }
  {
    const s = setup(), gate = deferred(); s.source((n) => n === 1 ? gate.promise : 'sources-a');
    const post = s.post(input('pendant-empreinte')); await flush();
    let returned = false;
    const cancel = s.cancel('pendant-empreinte').then((value) => { returned = true; return value; }); await flush();
    check(!returned && s.requests.length === 0, 'annuler pendant l’empreinte attend la demande déjà engagée sans démarrer de tâche');
    gate.resolve('sources-a'); await flush(); await s.finishAll();
    const result = await post; await cancel;
    check(result.status === 409 && s.requests.length === 0, 'après l’empreinte, le POST annulé refuse de créer un travail');
  }
  {
    const s = setup(), a = await s.post(input('onglet-a')), b = await s.post(input('onglet-b'));
    check(a.data.id === b.data.id, 'deux propriétaires peuvent partager la même plage');
    let returned = false;
    const cancelled = s.cancel('onglet-a').then((value) => { returned = true; return value; }); await flush();
    check(!returned && s.waits.length === 1 && s.cancellations.length === 0, 'annuler un propriétaire partagé attend sans annuler le travail de l’autre');
    await s.finishAll(); await cancelled;
    const file = await s.call(`/api/code-playback/${b.data.id}.mp4`);
    check(file.kind === 'file' && s.cancellations.length === 0, 'l’autre onglet garde accès au résultat de la plage partagée');
  }
  {
    const s = setup(), a = await s.post(input('deja-cree')), gate = deferred();
    s.source((n) => n === 3 ? gate.promise : 'sources-a');
    const b = s.post(input('encore-en-empreinte')); await flush();
    const cancelled = s.cancel('deja-cree'); await flush();
    check(s.context.harness.owners.get('encore-en-empreinte').id === null && s.waits.length === 1 && !s.cancellations.length,
      'un propriétaire encore sans identifiant réserve déjà son droit sur la même plage');
    await s.finishAll(); await cancelled;
    gate.resolve('sources-a'); const result = await b;
    check(result.status === 200 && result.data.id === a.data.id && result.data.status === 'ready', 'la réservation conserve la plage pour le POST encore en cours');
    await s.finishAll();
  }
  {
    const s = setup(), gate = deferred(); s.request((n) => n === 1 ? gate.promise : undefined);
    const a = s.post(input('retour-differe')); await flush();
    const b = await s.post(input('autre-proprietaire'));
    const cancelled = s.cancel('retour-differe'); await flush();
    gate.resolve(); await flush();
    check(s.waits.length >= 1 && !s.cancellations.length, 'une annulation reçue pendant request respecte aussi les autres propriétaires');
    await s.finishAll(); const result = await a; await cancelled;
    check(result.status === 409 && s.api.status(b.data.id).status === 'ready', 'le POST annulé échoue sans détruire le résultat partagé');
  }
  {
    const s = setup(), a = await s.post(input('fichier')); await s.finishAll();
    const gate = deferred(); s.source(() => gate.promise);
    const getting = s.call(`/api/code-playback/${a.data.id}.mp4`); await flush();
    s.player.state.hash = 'code-b'; s.player.state.version = 2;
    gate.resolve('sources-a'); const result = await getting;
    check(result.status === 410 && !s.files.length && s.fileCalls === 0, 'un hash changé pendant le GET de validation interdit l’ancien fichier');
  }
  {
    const s = setup(), a = await s.post(input('etat')); await s.finishAll();
    const gate = deferred(); s.source(() => gate.promise);
    const getting = s.call(`/api/code-playback?id=${a.data.id}`); await flush();
    s.player.state.hash = 'code-b'; s.player.state.version = 2;
    gate.resolve('sources-a'); const result = await getting;
    check(result.data.status === 'cancelled' && s.cancellations.length === 1, 'le GET d’état recontrôle aussi le hash après l’empreinte');
  }
  {
    const s = setup(), a = await s.post(input('medias')); await s.finishAll(); s.source(() => 'sources-b');
    const result = await s.call(`/api/code-playback/${a.data.id}.mp4`);
    check(result.status === 410 && !s.files.length, 'des médias modifiés rendent la plage indisponible même si le hash du code reste égal');
  }
  {
    const s = setup(); s.context.timelineCodeVersion = 0;
    const result = await s.post(input('frise-ancienne'));
    check(result.status === 409 && s.requests.length === 0, 'une frise prête mais liée à une version précédente est refusée');
  }
  {
    const s = setup(), gate = deferred(); s.source((n) => n === 2 ? gate.promise : 'sources-a');
    const post = s.post(input('frise-pendant-empreinte')); await flush();
    s.context.timelineCodeVersion = 0; gate.resolve('sources-a');
    const result = await post;
    check(result.status === 409 && s.requests.length === 0, 'la génération de frise est revérifiée après la seconde empreinte');
  }
  {
    const s = setup(); s.source((n) => n === 1 ? 'sources-a' : 'sources-b');
    const result = await s.post(input('sources-modifiees'));
    check(result.status === 409 && s.requests.length === 0, 'une modification des sources pendant la construction interdit la plage');
  }
  {
    const s = setup(); s.build(async () => {
      s.player.state.hash = 'code-b'; s.player.state.version = 2; s.context.timelineCodeVersion = 2;
    });
    const result = await s.post(input('version-avant-debounce'));
    check(s.builds === 1 && result.status === 409 && !s.requests.length, 'la construction forcée détecte une version que le debounce n’avait pas encore publiée');
  }
  {
    const s = setup(); const result = await s.post(input('version-ancienne', { version: 0 }));
    check(result.status === 409 && !s.builds && !s.requests.length, 'une version déjà périmée est refusée avant empreinte et construction');
  }
  {
    const s = setup(); const result = await s.post(input('dimensions', { width: 20000 }));
    check(result.status === 409 && !s.requests.length, 'des dimensions invalides ne créent pas de travail');
  }
} catch (error) {
  check(false, `exception inattendue : ${error.stack ?? error}`);
}
console.log(`\n${ok} ok, ${ko} ko${mutant ? ` (mutation ${mutant}, échec attendu)` : ''}`);
process.exitCode = ko ? 1 : 0;

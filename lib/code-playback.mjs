// Préparation bornée de plages du code pour la lecture dans l'éditeur.
// Le moteur de rendu est injecté : il écrit output et doit attendre la fermeture de son processus
// après signal.abort. Le verrou n'est libéré qu'après le règlement de cette promesse.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { renderActivity } from './render-activity.mjs';
import { validPlaybackScale } from './code-playback-scale.mjs';

const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const message = (error) => String(error?.message ?? error);
const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};

export function createCodePlayback({ cacheDir, render, guard = renderActivity,
  fingerprint = async (generation) => generation.mediaSignature ?? '',
  lockFile = path.join(os.tmpdir(), 'coulisses-code-playback.lock'), pollMs = 2000,
  maxBytes = 512 * 1024 ** 2, maxEntries = 6, maxSeconds = 30,
  timers = { setTimeout, clearTimeout }, now = Date.now } = {}) {
  if (!cacheDir || typeof render !== 'function') throw new Error('Cache et moteur de préparation requis.');
  if (![maxBytes, maxEntries, maxSeconds, pollMs].every((n) => Number.isFinite(n) && n > 0)) throw new Error('Limites de préparation invalides.');
  cacheDir = path.resolve(cacheDir); lockFile = path.resolve(lockFile);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const jobs = new Map(), cache = new Map();
  let generation = null, epoch = 0, generationStale = false, running = null, timer = null, checking = false, disposed = false;
  const mediaPath = (key) => path.join(cacheDir, `code-${key}.mp4`);
  const metaPath = (key) => path.join(cacheDir, `code-${key}.json`);
  const identity = (g) => JSON.stringify([g.hash, g.fps, g.durationInFrames, g.mediaSignature ?? '', g.width ?? null, g.height ?? null]);
  function keyOf(g, from, to, scale) {
    const parts = [2, g.hash, from, to, g.fps, g.mediaSignature ?? '', g.width ?? null, g.height ?? null];
    if (scale !== undefined) parts.push(scale);
    return digest(parts);
  }
  const remove = (file) => { try { fs.rmSync(file, { force: true }); return !fs.existsSync(file); } catch { return false; } };
  function evict(entry) {
    if (!remove(mediaPath(entry.key))) return false;
    remove(metaPath(entry.key)); cache.delete(entry.key);
    for (const job of jobs.values()) if (job.key === entry.key && job.status === 'ready') {
      job.status = 'cancelled'; job.reason = 'Plage retirée du cache pour respecter le budget.';
    }
    return true;
  }
  function prune(reservedBytes = 0, reservedEntries = 0) {
    const entries = [...cache.values()].sort((a, b) => a.used - b.used);
    let bytes = entries.reduce((sum, item) => sum + item.bytes, 0), count = entries.length;
    for (const item of entries) {
      if (count + reservedEntries <= maxEntries && bytes + reservedBytes <= maxBytes) break;
      if (evict(item)) { bytes -= item.bytes; count--; }
    }
    return count + reservedEntries <= maxEntries && bytes + reservedBytes <= maxBytes;
  }
  for (const name of fs.readdirSync(cacheDir)) {
    if (!/^code-[a-f0-9]{64}\.json$/.test(name)) continue;
    try {
      const item = JSON.parse(fs.readFileSync(path.join(cacheDir, name), 'utf8'));
      if (!validPlaybackScale(item.scale) || name !== `code-${item.key}.json` || item.key !== keyOf(item, item.from, item.to, item.scale)) continue;
      const st = fs.statSync(mediaPath(item.key));
      if (!st.isFile() || !st.size) continue;
      cache.set(item.key, { ...item, bytes: st.size, used: Number(item.used) || st.mtimeMs });
    } catch { /* une entrée incomplète n'est jamais proposée à la lecture */ }
  }
  for (const name of fs.readdirSync(cacheDir)) {
    if (/^code-[a-f0-9]{64}\.mp4$/.test(name) && !cache.has(name.slice(5, -4))) remove(path.join(cacheDir, name));
  }
  prune();
  const current = (job) => !!generation && !generationStale && job.epoch === epoch && job.hash === generation.hash;
  const snapshot = (job) => job ? {
    id: job.id, key: job.key, status: job.status, hash: job.hash, from: job.from, to: job.to,
    fps: job.fps, scale: job.scale ?? null, mediaSignature: job.mediaSignature, current: current(job), progress: job.progress,
    renderedFrames: job.renderedFrames, reason: job.reason, createdAt: job.createdAt, updatedAt: job.updatedAt, bytes: job.bytes ?? null,
  } : null;
  function settleJob(job) {
    if (!job || running === job || ['queued', 'preparing'].includes(job.status)) return;
    for (const resolve of job.waiters ?? []) resolve(snapshot(job));
    job.waiters?.clear();
  }
  function waitForJob(job) {
    if (!job || (running !== job && !['queued', 'preparing'].includes(job.status))) return Promise.resolve(snapshot(job));
    return new Promise((resolve) => { (job.waiters ??= new Set()).add(resolve); });
  }
  function cancelJob(job, reason) {
    if (!job || !['queued', 'preparing', 'ready'].includes(job.status)) return;
    job.status = 'cancelled'; job.reason = reason; job.updatedAt = now();
    job.controller?.abort(new Error(reason));
    settleJob(job);
  }
  function update(next) {
    if (disposed) throw new Error('Préparation arrêtée.');
    if (!next || typeof next.hash !== 'string' || !next.hash || !Number.isFinite(next.fps) || next.fps <= 0 ||
      !Number.isInteger(next.durationInFrames) || next.durationInFrames <= 0) throw new Error('Génération de code invalide.');
    const nextGeneration = Object.freeze({ ...next, mediaSignature: String(next.mediaSignature ?? '') });
    if (!generation || generationStale || identity(nextGeneration) !== identity(generation)) {
      epoch++;
      for (const job of jobs.values()) cancelJob(job, 'La version du code ou de ses médias a changé.');
    }
    generation = nextGeneration; generationStale = false;
    return { ...generation };
  }
  function unlock(token) {
    try {
      const owner = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      if (owner.token === token && owner.pid === process.pid) remove(lockFile);
    } catch { /* un verrou absent ou différent ne nous appartient pas */ }
  }
  function lock() {
    // Sérialiser aussi la reprise d'un verrou dont le processus est mort. Un verrou de reprise
    // abandonné reste bloquant : mieux vaut une erreur visible que deux rendus lourds simultanés.
    const claim = `${lockFile}.claim`, token = crypto.randomUUID();
    let fd;
    try { fd = fs.openSync(claim, 'wx'); } catch (error) {
      if (error.code === 'EEXIST') return { reason: 'Une autre préparation acquiert le verrou commun.' };
      throw error;
    }
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
      if (fs.existsSync(lockFile)) {
        let owner;
        try { owner = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch {
          return { reason: 'Verrou commun illisible ; vérifier son propriétaire avant de le retirer.' };
        }
        if (alive(owner.pid) || alive(owner.workerPid)) return { reason: 'Une autre préparation du code est en cours.' };
        fs.unlinkSync(lockFile);
      }
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, token, createdAt: now() }), { flag: 'wx' });
      return { token };
    } finally { fs.closeSync(fd); remove(claim); }
  }
  function workerOwner(token, workerPid) {
    if (!Number.isInteger(workerPid) || workerPid <= 0) return;
    const owner = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    if (owner.token !== token || owner.pid !== process.pid) throw new Error('Le verrou de préparation a changé de propriétaire.');
    fs.writeFileSync(lockFile, JSON.stringify({ ...owner, workerPid }));
  }
  function arm() {
    if (disposed || timer || (!running && ![...jobs.values()].some((job) => job.status === 'queued'))) return;
    timer = timers.setTimeout(() => { timer = null; void pump(); }, pollMs);
    timer?.unref?.();
  }
  async function isBusy() {
    try {
      const activity = await guard();
      return Array.isArray(activity) ? activity.length > 0 : !!activity;
    } catch { return true; }   // une garde en erreur ne signifie pas que la machine est libre
  }
  async function refreshMedia(expectedEpoch) {
    if (!generation || generationStale || expectedEpoch !== epoch) return false;
    const captured = generation, signature = String(await fingerprint(captured));
    if (expectedEpoch !== epoch || disposed) return false;
    if (signature !== captured.mediaSignature) {
      generationStale = true;
      for (const job of jobs.values()) cancelJob(job, 'Les sources ont changé ; attendre la nouvelle version du code.');
      return false;
    }
    return true;
  }
  async function run(job, token) {
    running = job; job.controller = new AbortController(); job.status = 'preparing'; job.reason = null; job.updatedAt = now();
    const output = path.join(cacheDir, `code-${job.key}-${job.id}.tmp.mp4`);
    job.output = output;
    arm();
    try {
      if (!prune(0, 1)) throw new Error('Le cache ne peut pas libérer de place pour cette préparation.');
      await render({ generation: job.generation, from: job.from, to: job.to, fps: job.fps, scale: job.scale, output,
        signal: job.controller.signal, onWorkerPid: (pid) => workerOwner(token, pid), onProgress: (value, renderedFrames) => {
          if (!current(job) || job.status !== 'preparing') return;
          job.progress = Math.max(0, Math.min(1, Number(value) || 0));
          if (Number.isInteger(renderedFrames)) {
            job.renderedFrames = Math.max(job.renderedFrames, Math.min(job.to - job.from, renderedFrames));
          }
          job.updatedAt = now();
        } });
      if (disposed || job.controller.signal.aborted || !current(job) || !(await refreshMedia(job.epoch))) return;
      const st = fs.statSync(output);
      if (!st.isFile() || !st.size) throw new Error('La préparation n’a produit aucune vidéo.');
      if (st.size > maxBytes) throw new Error('Cette plage dépasse le budget du cache de lecture.');
      const item = { key: job.key, hash: job.hash, from: job.from, to: job.to, fps: job.fps,
        width: job.generation.width ?? null, height: job.generation.height ?? null, scale: job.scale,
        mediaSignature: job.mediaSignature, bytes: st.size, used: now() };
      // Les entrées sont publiées une fois le fichier fermé par le moteur de rendu.
      fs.renameSync(output, mediaPath(job.key));
      try { fs.writeFileSync(metaPath(job.key), JSON.stringify(item)); } catch (error) {
        remove(mediaPath(job.key)); remove(metaPath(job.key)); throw error;
      }
      cache.set(job.key, item);
      job.status = 'ready'; job.progress = 1; job.renderedFrames = job.to - job.from; job.bytes = item.bytes; job.updatedAt = now();
      prune();
    } catch (error) {
      if (job.status !== 'cancelled') { job.status = 'error'; job.reason = message(error); job.updatedAt = now(); }
    } finally {
      remove(output); unlock(token); job.controller = null;
      if (running === job) running = null;
      settleJob(job);
      void pump();
    }
  }
  async function pump() {
    if (checking || disposed) return;
    checking = true;
    try {
      const checkedEpoch = epoch, busy = await isBusy();
      if (disposed || checkedEpoch !== epoch) return;
      if (running) {
        if (busy) cancelJob(running, 'Préparation interrompue : priorité au rendu ou à l’export utilisateur.');
        else { try { await refreshMedia(checkedEpoch); } catch { cancelJob(running, 'Impossible de vérifier les médias de cette version.'); } }
        if (running?.output && fs.existsSync(running.output)) {
          const bytes = fs.statSync(running.output).size;
          if (!prune(bytes, 1)) cancelJob(running, 'La plage en préparation dépasse le budget disponible du cache.');
        }
        return;
      }
      const job = [...jobs.values()].find((item) => item.status === 'queued' && current(item));
      if (!job) return;
      if (busy) { job.reason = 'En attente de la fin du rendu ou de l’export utilisateur.'; return; }
      if (!(await refreshMedia(checkedEpoch)) || disposed || job.status !== 'queued') return;
      const owned = lock();
      if (!owned.token) { job.reason = owned.reason; return; }
      // Vérifier encore après l'obtention du verrou : un autre studio peut lancer un export entre les deux contrôles.
      if (await isBusy() || disposed || !current(job) || job.status !== 'queued') { unlock(owned.token); return; }
      job.completion = run(job, owned.token);
    } catch (error) {
      const job = [...jobs.values()].find((item) => item.status === 'queued' && current(item));
      if (job) { job.status = 'error'; job.reason = message(error); job.updatedAt = now(); settleJob(job); }
    } finally { checking = false; arm(); }
  }
  async function request({ from, to, scale }) {
    if (!validPlaybackScale(scale)) throw new Error('Résolution de lecture invalide.');
    if (disposed || !generation) throw new Error('Aucune génération de code disponible.');
    const capturedEpoch = epoch;
    const fresh = await refreshMedia(capturedEpoch);
    if (!fresh || disposed || capturedEpoch !== epoch) throw new Error('La génération a changé ; redemander la plage courante.');
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > generation.durationInFrames ||
      (to - from) / generation.fps > maxSeconds) throw new Error(`La plage doit être comprise dans la composition et durer au plus ${maxSeconds} secondes.`);
    const key = keyOf(generation, from, to, scale);
    const existing = [...jobs.values()].find((job) => job.key === key && current(job) && ['queued', 'preparing', 'ready'].includes(job.status));
    if (existing) return snapshot(existing);
    const job = { id: crypto.randomUUID(), key, from, to, scale, hash: generation.hash, fps: generation.fps,
      mediaSignature: generation.mediaSignature, generation, epoch, status: 'queued', reason: null,
      progress: 0, renderedFrames: 0, createdAt: now(), updatedAt: now(), controller: null };
    jobs.set(job.id, job);
    const item = cache.get(key);
    if (item && fs.existsSync(mediaPath(key))) {
      item.used = now(); job.status = 'ready'; job.progress = 1; job.renderedFrames = to - from; job.bytes = item.bytes;
      fs.writeFileSync(metaPath(key), JSON.stringify(item));
    } else { if (item) evict(item); void pump(); }
    // Historique d'états borné ; les tâches actives ne sont jamais retirées.
    if (jobs.size > 100) for (const [id, old] of jobs) {
      if (jobs.size <= 100) break;
      if (old !== running && ['cancelled', 'error'].includes(old.status)) jobs.delete(id);
    }
    return snapshot(job);
  }
  return {
    update, request,
    status: (id) => id ? snapshot(jobs.get(id)) : { generation: generation ? { hash: generation.hash, fps: generation.fps,
      durationInFrames: generation.durationInFrames, mediaSignature: generation.mediaSignature, stale: generationStale } : null,
      active: running?.id ?? null, jobs: [...jobs.values()].map(snapshot),
      cache: { bytes: [...cache.values()].reduce((sum, item) => sum + item.bytes, 0), entries: cache.size, maxBytes, maxEntries, maxSeconds } },
    file(id) {
      const job = jobs.get(id);
      return job && current(job) && job.status === 'ready' && fs.existsSync(mediaPath(job.key)) ? mediaPath(job.key) : null;
    },
    cancel(id) { cancelJob(jobs.get(id), 'Préparation annulée.'); return snapshot(jobs.get(id)); },
    async cancelAndWait(id) {
      const job = jobs.get(id);
      cancelJob(job, 'Préparation annulée.');
      await waitForJob(job);
      return snapshot(job);
    },
    async waitForIdle(id) {
      const job = jobs.get(id);
      return waitForJob(job);
    },
    async dispose() {
      disposed = true;
      if (timer) timers.clearTimeout(timer); timer = null;
      for (const job of jobs.values()) cancelJob(job, 'Préparation arrêtée.');
      await waitForJob(running);
    },
  };
}

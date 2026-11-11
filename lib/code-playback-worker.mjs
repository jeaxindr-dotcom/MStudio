// Processus propre à UNE plage de relecture. Les médias calculés conservent leur son ;
// le Chrome de Remotion est lancé avec --mute-audio et ne joue rien sur les haut-parleurs.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { validPlaybackScale } from './code-playback-scale.mjs';

function terminateOwnWorker() {
  // Après disparition du parent, supprimer aussi les éventuels décodeurs/encodeurs restants.
  // Le PID est toujours celui du présent worker, jamais celui d'un studio ou d'un autre rendu.
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(process.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.once('error', () => process.exit(1)); killer.once('close', () => process.exit(1));
  } else {
    try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(1); }
  }
}

export function watchParentDisconnect({ channel = process,
  cleanup = async () => { const { closeCode } = await import('./frames.mjs'); await closeCode(); },
  finish = terminateOwnWorker, timeout = 3000, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let completion = null, timer = null, stopped = false, finished = false;
  const end = () => { if (finished) return; finished = true; unschedule(timer); finish(); };
  const disconnect = () => {
    if (stopped || completion) return;
    // Un Chrome bloqué ne doit pas laisser un rendu orphelin indéfiniment.
    timer = schedule(end, timeout); timer?.unref?.();
    completion = Promise.resolve().then(cleanup).catch(() => {}).finally(end);
  };
  channel.once('disconnect', disconnect);
  return { get completion() { return completion; }, stop() { stopped = true; channel.removeListener('disconnect', disconnect); if (!completion) unschedule(timer); } };
}

export function validateCodeRange(job) {
  const { project, generation, from, to, fps, output } = job ?? {};
  if (!validPlaybackScale(job?.scale)) throw new Error('Résolution de lecture invalide.');
  if (!project?.remotionDir || project.kind === 'hyperframes') throw new Error('La relecture calculée demande un projet Remotion');
  if (!generation || typeof generation.hash !== 'string' || !generation.hash || typeof generation.mediaSignature !== 'string' || !generation.mediaSignature) throw new Error('La génération et la signature des médias sont requises');
  if (!Number.isInteger(from) || from < 0 || !Number.isInteger(to) || to <= from || !Number.isInteger(generation.durationInFrames) || to > generation.durationInFrames) throw new Error('Plage de relecture invalide');
  if (!Number.isFinite(fps) || fps <= 0 || fps !== generation.fps) throw new Error('Cadence de relecture invalide');
  if (![generation.width, generation.height].every((n) => Number.isInteger(n) && n >= 2)) throw new Error('Dimensions de relecture invalides');
  if (typeof output !== 'string' || !path.isAbsolute(output)) throw new Error('Le fichier de relecture doit être un chemin absolu');
  return job;
}

// Les dépendances injectables permettent de vérifier le contrat sans lancer Chrome ni un rendu.
export async function runCodeRange(job, dependencies = null, report = () => {}) {
  const { project, generation, from, to, output } = validateCodeRange(job);
  const { renderVideo, closeCode, compositionOf } = dependencies ?? await import('./frames.mjs');
  const cacheKey = `${generation.hash}:${generation.mediaSignature}`;
  const log = (text) => report({ type: 'log', text: String(text).slice(-4096) });
  try {
    // Le budget repose sur la composition calculée par Remotion, jamais sur les dimensions déclarées par l'interface.
    const composition = await compositionOf(project, log, { cacheKey });
    if (composition.fps !== generation.fps || composition.durationInFrames !== generation.durationInFrames) throw new Error('La durée ou la cadence de la composition a changé ; redemander la plage');
    if (![composition.width, composition.height].every((n) => Number.isInteger(n) && n >= 2)) throw new Error('Dimensions réelles de la composition invalides');
    // Remotion scales the actual composition and rounds each H.264 dimension to an even number.
    const scale = job.scale ?? Math.min(1, 1280 / composition.width, 720 / composition.height);
    if (Math.round(composition.width * scale) < 2 || Math.round(composition.height * scale) < 2) throw new Error('Cette résolution est trop petite pour une vidéo H.264.');
    const result = await renderVideo(project, output, {
      cacheKey,
      muted: false, scale, concurrency: 1, frameRange: [from, to - 1],
      onProgress: (progress, renderedFrames, encodedFrames, stage) => report({ type: 'progress', progress, renderedFrames, encodedFrames, stage }),
      log,
    });
    return { ...result, from, to, generation: generation.hash, mediaSignature: generation.mediaSignature };
  } finally { await closeCode(); }
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 1024 * 1024) throw new Error('Demande de relecture trop volumineuse');
  }
  const report = (message) => { if (process.connected) process.send(message); };
  const result = await runCodeRange(JSON.parse(input), null, report);
  if (process.connected) await new Promise((resolve, reject) => process.send({ type: 'result', result }, (e) => e ? reject(e) : resolve()));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const parent = watchParentDisconnect();
  try { await main(); }
  catch (error) {
    const message = String(error?.stack ?? error).slice(-16384);
    if (process.connected) await new Promise((resolve) => process.send({ type: 'failure', error: message }, resolve));
    else process.stderr.write(message + '\n');
    process.exitCode = 1;
  } finally {
    if (parent.completion) await parent.completion;
    else { parent.stop(); if (process.connected) process.disconnect(); }
  }
}

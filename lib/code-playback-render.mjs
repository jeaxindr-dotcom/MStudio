// Le processus de calcul n'appartient qu'à cette demande : son annulation n'arrête aucun studio.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateCodeRange } from './code-playback-worker.mjs';

const WORKER = fileURLToPath(new URL('./code-playback-worker.mjs', import.meta.url));
const LOG_LIMIT = 32768;
const abortError = () => Object.assign(new Error('Calcul de la relecture annulé'), { name: 'AbortError' });

export function createCodeRangeRenderer({ spawnProcess = spawn, platform = process.platform, killProcess = process.kill.bind(process) } = {}) {
  return function renderCodeRange({ generation, from, to, fps, scale, output, signal, onProgress = () => {}, onWorkerPid = () => {} }) {
    if (signal?.aborted) return Promise.reject(abortError());
    const job = { project: generation?.project, generation, from, to, fps, scale, output };
    try { validateCodeRange(job); } catch (e) { return Promise.reject(e); }
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnProcess(process.execPath, [WORKER], {
          windowsHide: true, detached: platform !== 'win32',
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          env: { ...process.env, COULISSES_CODE_PLAYBACK: '1' },
        });
      } catch (e) { reject(e); return; }
      let result = null, failure = null, startupFailure = null, logs = '', aborted = false, closed = false, killTimer = null;
      const append = (text) => { logs = (logs + String(text)).slice(-LOG_LIMIT); };
      const terminate = () => {
        if (closed || aborted) return;
        aborted = true;
        if (!Number.isInteger(child.pid) || child.pid <= 0) return;
        if (platform === 'win32') {
          // /T cible seulement l'arbre du processus enfant créé ci-dessus ; jamais un nom de programme.
          try {
            const killer = spawnProcess('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            killer.on('error', (e) => append(`\nArrêt du calcul : ${e.message}`));
            killer.on('close', (code) => { if (code) append(`\nArrêt du calcul : taskkill ${code}`); });
          } catch (e) { append(`\nArrêt du calcul : ${e.message}`); }
        } else {
          try { killProcess(-child.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') append(`\nArrêt du calcul : ${e.message}`); }
          killTimer = setTimeout(() => { if (!closed) try { killProcess(-child.pid, 'SIGKILL'); } catch { /* déjà arrêté */ } }, 3000);
          killTimer.unref?.();
        }
      };
      child.stdout?.on('data', append); child.stderr?.on('data', append);
      child.stdin?.on('error', (e) => { failure ??= e; });
      child.on('error', (e) => { failure = e; });
      child.on('message', (message) => {
        if (!message || typeof message !== 'object' || closed) return;
        if (message.type === 'result') result = message.result;
        else if (message.type === 'failure') failure = new Error(String(message.error).slice(-LOG_LIMIT));
        else if (message.type === 'log') append(message.text + '\n');
        else if (message.type === 'progress' && !aborted) {
          try { onProgress(Math.max(0, Math.min(1, Number(message.progress) || 0)), message.renderedFrames, message.encodedFrames, message.stage); }
          catch (e) { append(`\nSuivi du calcul : ${e.message}`); }
        }
      });
      child.once('close', (code) => {
        closed = true; clearTimeout(killTimer); signal?.removeEventListener('abort', terminate);
        if (aborted) { reject(startupFailure ?? abortError()); return; }
        if (code !== 0 || failure || !result) {
          const error = failure ?? new Error(`Le calcul de la relecture a échoué (${code ?? 'interrompu'})`);
          error.logs = logs; reject(error); return;
        }
        resolve(result);
      });
      signal?.addEventListener('abort', terminate, { once: true });
      if (signal?.aborted) terminate();
      // Le verrou commun connaît le PID avant que le worker puisse lancer Chrome.
      if (!aborted) try { onWorkerPid(child.pid); } catch (e) { startupFailure = e; terminate(); }
      if (!aborted) child.stdin.end(JSON.stringify(job));
    });
  };
}

export const renderCodeRange = createCodeRangeRenderer();

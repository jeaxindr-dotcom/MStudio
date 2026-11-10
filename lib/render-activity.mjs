// Priorité aux rendus/exportations déjà lancés par l'utilisateur.
import http from 'node:http';
import { HUB_PORT, LAST_PORT } from './app-profile.mjs';

// fetch applique la liste de ports interdits aux navigateurs, dont 4190 : il
// échoue avant le réseau. Le contrôle local doit réellement interroger ce port.
function statusGet(url, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { signal, agent: false }, (response) => {
      const chunks = []; let size = 0;
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('Réponse de statut interrompue.')));
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          const error = new Error('Réponse de statut trop volumineuse.');
          response.destroy(error); request.destroy(error); reject(error); return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const text = Buffer.concat(chunks, size).toString('utf8'), status = response.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text) });
      });
    });
    request.on('error', reject);
  });
}

export async function renderActivity({ fetcher = statusGet, ports = Array.from({length: LAST_PORT - HUB_PORT + 1}, (_, i) => HUB_PORT + i), timeout = 1500 } = {}) {
  const replies = await Promise.all(ports.map(async (port) => {
    try {
      const r = await fetcher(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(timeout) });
      if (!r.ok) {
        if (r.status === 404) {
          // Le hub de Coulisses occupe aussi un port de cette plage, mais ne lance
          // pas les rendus d'un studio. Identifier ce seul cas par un second GET.
          const ping = await fetcher(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(timeout) });
          if (ping.ok && (await ping.json())?.hub === true) return null;
        }
        return { port, running: [`statut indisponible (HTTP ${r.status})`] };
      }
      const s = await r.json();
      const running = ['render', 'export', 'shot'].filter((k) => s[k]?.state === 'running');
      return running.length ? { port, running } : null;
    } catch (e) {
      // Seul un refus explicite de connexion prouve que ce port est fermé.
      // Délai dépassé, connexion réinitialisée ou JSON invalide ne prouvent jamais
      // l'absence de travail ; la prochaine vérification doit attendre.
      const code = e?.cause?.code ?? e?.code;
      return code === 'ECONNREFUSED' ? null : { port, running: ['statut indisponible'] };
    }
  }));
  return replies.filter(Boolean);
}

export async function waitForRenderIdle({ onWait = console.log, signal, interval = 5000, ...opts } = {}) {
  for (;;) {
    signal?.throwIfAborted();
    const busy = await renderActivity(opts);
    signal?.throwIfAborted();
    if (!busy.length) return;
    onWait(`Attente : rendu/export ou statut indisponible sur ${busy.map((s) => s.port).join(', ')}.`);
    await new Promise((resolve, reject) => {
      const end = () => { signal?.removeEventListener('abort', cancel); resolve(); };
      const timer = setTimeout(end, interval);
      const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(signal.reason); };
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }
}

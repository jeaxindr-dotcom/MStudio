import fs from 'node:fs/promises';
import path from 'node:path';

const samePath = (a, b) => typeof a === 'string' && typeof b === 'string'
  && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// Discover only this installation's library. A service merely occupying the
// usual port, another profile or legacy Coulisses must never become our hub.
export function createDesktopHubResolver({appDir, dataDir, fetchImpl = fetch, now = Date.now, retryMs = 3000}) {
  let checked = -Infinity, cached = null, pending;
  async function read() {
    try {
      const record = JSON.parse(await fs.readFile(path.join(dataDir, 'hub.json'), 'utf8'));
      if (!Number.isSafeInteger(record.pid) || record.pid < 1 || !samePath(record.studio, appDir)
        || !Number.isSafeInteger(record.port) || record.port < 1 || record.port > 65535) return null;
      const url = new URL(record.url);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password
        || url.pathname !== '/' || url.search || url.hash || Number(url.port) !== record.port) return null;
      const response = await fetchImpl(new URL('/api/ping', url), {redirect:'error', signal:AbortSignal.timeout(1500)});
      if (!response.ok) return null;
      const ping = await response.json();
      if (ping.hub !== true || ping.app !== 'MStudio' || ping.pid !== record.pid
        || !samePath(ping.studioDir, appDir) || !samePath(ping.dataDir, dataDir)) return null;
      return url.href;
    } catch { return null; }
  }
  return {
    async find(force = false) {
      if (pending) return pending;
      if (!force && now() - checked < retryMs) return cached;
      pending = read().then(value => { cached = value; checked = now(); return value; }).finally(() => { pending = null; });
      return pending;
    },
  };
}

// What the code review of 08/10/2026 found, checked on the sample project of tests/coulisses-fixture.mjs (nothing real is
// touched):
//   1. only Coulisses itself may call its servers (lib/guard.mjs): another site's page (Origin, a rebinding Host, a
//      cross-site request without a Coulisses page behind it) is refused, the studio's own calls and the tools pass;
//   2. one studio per project: a second studio on the same project hands over to the first (its address, then it
//      stops); a lock whose studio is gone is taken over;
//   3. the home screen refuses another site too.
// usage: node tests/guard.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePort } from './where.mjs';
import { requireSandbox } from './cdp.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCR = path.join(STUDIO, '.cache', 'guard-test');
fs.rmSync(SCR, { recursive: true, force: true }); fs.mkdirSync(SCR, { recursive: true });
process.env.COULISSES_LANG = 'fr';
process.env.STUDIO_PROJECTS = path.join(SCR, 'projets.json');
process.env.COULISSES_SETTINGS = path.join(SCR, 'settings.json');
process.env.COULISSES_MEDIAS = path.join(SCR, 'medias');
const { makeFixture } = await import('./coulisses-fixture.mjs');
const { importProject } = await import('../lib/projects.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));   // COULISSES_TEST_SLOW=2: a slower PC
let ok = 0, ko = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };
const kill = (c) => { if (c) try { execFileSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
function start(script, args) {
  const c = spawn(process.execPath, [path.join(STUDIO, script), ...args], { cwd: STUDIO, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  c.out = ''; c.stdout.on('data', (d) => { c.out += d; }); c.stderr.on('data', (d) => { c.out += d; });
  c.done = new Promise((r) => c.on('exit', (code) => r(code)));
  return c;
}
const until = async (f, ms = 40000) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) return false; await sleep(200); } return true; };
// a raw request: any Host, Origin, Sec-Fetch-Site, Referer (what a browser would send)
const ask = (port, p, headers = {}, method = 'GET') => new Promise((resolve) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ code: res.statusCode, body: b })); });
  r.on('error', (e) => resolve({ code: 0, body: e.message })); r.end(method === 'POST' ? '{}' : undefined);
});
let a = null, b = null, c = null, hub = null;
try {
  const file = makeFixture(), imp = importProject(file);
  const firstPort = await freePort(4240), otherPort = await freePort(firstPort + 1);
  a = start('studio-server.mjs', ['--project', imp.revue, '--no-open', '--port', String(firstPort)]);
  await until(() => /Ouvre : http/.test(a.out));
  const port = +/Ouvre : http:\/\/127\.0\.0\.1:(\d+)\//.exec(a.out)?.[1];
  await requireSandbox(`http://127.0.0.1:${port}/`, path.join(STUDIO, '.cache'));
  check(port === firstPort, `the studio announces 127.0.0.1, the home screen's address (port ${port})`);
  // ---------- 1. who may call it ----------
  console.log('qui peut appeler le studio');
  check((await ask(port, '/api/meta')).code === 200, 'a tool (no Origin, no Sec-Fetch-Site): allowed');
  check((await ask(port, '/api/meta', { origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' })).code === 200, 'the studio\'s own page: allowed');
  check((await ask(port, '/api/meta', { origin: 'http://127.0.0.1:4173', 'sec-fetch-site': 'same-site' })).code === 200, 'the home screen (another port of 127.0.0.1): allowed');
  check((await ask(port, '/', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', referer: 'http://localhost:4173/' })).code === 200, 'a page of Coulisses opened as localhost: allowed');
  const evil = await ask(port, '/api/notes', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, 'POST');
  check(evil.code === 403 && /refused/.test(evil.body), 'another site\'s page (Origin https://evil.example): refused (403)');
  check((await ask(port, '/api/meta', { host: `evil.example:${port}` })).code === 403, 'a DNS-rebinding name (Host evil.example): refused');
  // The listening socket is ready before the first Remotion bundle. Until it
  // exists even an ordinary localhost request for player.html returns 410.
  if (!await until(async () => (await ask(port, '/player.html')).code === 200)) throw new Error('The sandbox preview did not build');
  check((await ask(port, '/player.html', { host: `pmhd3k2x.localhost:${port}` })).code === 200, 'the name of the replacement of a frozen preview (Host p….localhost, 31/10/2026): allowed');
  check((await ask(port, '/api/meta', { host: `evil.localhost.example:${port}` })).code === 403 && (await ask(port, '/api/meta', { host: `evil-site.localhost:${port}` })).code === 403, 'any other *.localhost-like name: refused');
  check((await ask(port, '/api/meta', { 'sec-fetch-site': 'cross-site' })).code === 403, 'an <img> or a link of another site (cross-site, no Coulisses page behind): refused');
  check((await ask(port, '/api/meta', { origin: 'null' })).code === 403, 'a sandboxed frame or a file (Origin null): refused');
  // ---------- 2. one studio per project ----------
  console.log('un seul studio par projet');
  const lock = JSON.parse(fs.readFileSync(path.join(imp.revue, 'studio.lock.json'), 'utf8'));
  check(lock.pid === a.pid && lock.port === port, `revue/studio.lock.json names it (pid ${lock.pid}, port ${lock.port})`);
  b = start('studio-server.mjs', ['--project', imp.revue, '--no-open', '--port', String(otherPort)]);
  const code = await Promise.race([b.done, sleep(30000).then(() => 'timeout')]);
  check(code === 0 && /déjà ouvert dans un autre studio/.test(b.out) && new RegExp(`Ouvre : http://127\\.0\\.0\\.1:${port}/`).test(b.out), `a second studio on the same project hands over to the first and stops (« ${b.out.trim().split('\n')[0].trim().slice(0, 90)}… »)`);
  check((await ask(otherPort, '/api/meta')).code === 0, '… it never listened (no second writer of the notes)');
  kill(a); a = null; await sleep(800);
  c = start('studio-server.mjs', ['--project', imp.revue, '--no-open', '--port', String(firstPort)]);
  check(await until(() => /Ouvre : http/.test(c.out)) && !/déjà ouvert/.test(c.out), 'its studio gone (closed by force), the lock is taken over: a new studio opens');
  check(JSON.parse(fs.readFileSync(path.join(imp.revue, 'studio.lock.json'), 'utf8')).pid === c.pid, '… and the lock names the new one');
  // ---------- 3. the home screen ----------
  console.log("l'accueil");
  const hp = await freePort(firstPort + 2);   // Port libre, hors des ports réservés aux studios de l'utilisateur.
  hub = start('hub-server.mjs', ['--port', String(hp)]);
  await until(() => hub.out.includes('HUB_READY') || hub.out.includes(`127.0.0.1:${hp}`), 30000); await sleep(500);
  check((await ask(hp, '/api/episodes')).code === 200, 'the home screen: a tool is allowed');
  const scan = await ask(hp, '/api/scan', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' }, 'POST');
  check(scan.code === 403, 'another site cannot start a scan of the disk (403)');
} catch (e) {
  check(false, `erreur : ${e.stack ?? e.message}`);
} finally {
  kill(a); kill(b); kill(c); kill(hub);
}
console.log(`\n${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);

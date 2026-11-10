// Test of the Windows app (« Brambleshire Studio.exe » of the Dev workshop: its sandbox episodes): the window opens on
// the home screen, lists the episodes, opens the studio of E03, the logo goes back to the episodes; when the window
// is closed, the launcher stops the home screen and the studio. The window is the real one, made invisible
// (BRAMBLESHIRE_STUDIO_TEST_PORT = headless + DevTools port).   usage: node tests/app.mjs
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CACHE } from '../lib/place.mjs';
import { freePort } from './where.mjs';
import { requireSandbox } from './cdp.mjs';
import { waitForRenderIdle } from '../lib/render-activity.mjs';

process.env.COULISSES_LANG = 'fr';   // the window, the home screen and the studio in French (lib/i18n.mjs)
const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXE = path.join(STUDIO, 'Coulisses.exe');
const DT = await freePort(9361);
const SCR = path.join(STUDIO, '.cache', 'app-test'); fs.mkdirSync(SCR, { recursive: true });
// Les réglages du lanceur testé sont toujours ceux du test, même hors de run-all.
process.env.COULISSES_SETTINGS ??= path.join(SCR, 'settings.json');
process.env.COULISSES_MEDIAS ??= path.join(SCR, 'medias');
process.env.COULISSES_HISTORY_DIR ??= path.join(SCR, 'historique');
process.env.STUDIO_PROJECTS ??= path.join(SCR, 'projets.json');
const preload = pathToFileURL(path.join(STUDIO, 'tests', 'isolation-runtime.mjs')).href;
if (!(process.env.NODE_OPTIONS ?? '').includes(preload)) process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--import=${preload}`].filter(Boolean).join(' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));   // COULISSES_TEST_SLOW=2: a slower PC
let ok = 0, ko = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };
const procs = (needle) => execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '${('*' + needle + '*').replace(/'/g, "''")}' -and $_.Name -eq 'node.exe' } | Select-Object -ExpandProperty ProcessId`], { encoding: 'utf8', windowsHide: true }).split(/\s+/).filter((id) => /^\d+$/.test(id));
// only THIS workshop's home screen and studios: never those of the installed app, which may be open meanwhile
// (the launcher quotes the script: « …\hub-server.mjs" --lock … »; the home screen starts « …\studio-server.mjs E03 --no-open --hub … »)
const HUB_PROC = `${STUDIO}\\hub-server.mjs*--lock`, STUDIO_PROC = `${STUDIO}\\studio-server.mjs*--hub http://127.0.0.1:`;
const settle = async (ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms && (procs(HUB_PROC).length || procs(STUDIO_PROC).length)) await sleep(500); };

await waitForRenderIdle();
if (procs(HUB_PROC).length || procs(STUDIO_PROC).length) throw new Error('Un accueil ou studio de ce worktree tourne déjà : le test refuse de le réutiliser ou de l’arrêter.');
// Le binaire copié expose déjà cette voie de test : conserver ce binaire et
// compléter ses arguments de Chrome, sans compiler ni toucher à l'installation.
const launcher = spawn(EXE, [], { env: { ...process.env, BRAMBLESHIRE_STUDIO_TEST_PORT: `${DT} --mute-audio --enable-automation` }, detached: false, stdio: 'ignore', windowsHide: true });
const launcherExit = new Promise((r) => launcher.on('exit', r));
let ws, id = 0; const wait = new Map();
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; wait.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
try {
  // the window's DevTools
  let targets = [];
  for (let i = 0; i < 80 && !targets.some((t) => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url)); i++) { await sleep(250); try { targets = await (await fetch(`http://127.0.0.1:${DT}/json/list`)).json(); } catch { /* not yet */ } }
  const page = targets.find((t) => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url));
  check(!!page, `the app window opens on the home screen (${page?.url})`);
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { const { res, rej } = wait.get(d.id); wait.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); } });
  await send('Runtime.enable'); await send('Page.enable');
  const chromeArguments = (await send('Browser.getBrowserCommandLine')).arguments;
  check(chromeArguments.includes('--mute-audio'), 'le navigateur lancé par le binaire de test est explicitement muet');
  check(chromeArguments.includes('--coulisses-role=interactive-preview'), 'le processus du navigateur interactif est identifiable par la file GPU');
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })).result.value;
  const until = async (expr, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(`return !!(${expr})`)) return true; } catch { /* navigating */ } await sleep(300); } return false; };
  await until(`document.querySelectorAll('.card').length > 0`);
  const cards = await ev(`return [...document.querySelectorAll('.card .title > span:first-child')].map((e) => e.textContent)`);   // the title, without the engine's tag (09/10/2026)
  check(cards.includes('The Secret Garden'), `episodes listed: ${cards.join(', ')}`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  const shot = async (f) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(path.join(CACHE, 'shots'), { recursive: true }); fs.writeFileSync(path.join(CACHE, 'shots', f), Buffer.from(data, 'base64')); };
  await sleep(1500); await shot('app-1-home.png');
  // open E03
  await ev(`[...document.querySelectorAll('.card')].find((c) => c.querySelector('.title > span:first-child')?.textContent === 'The Secret Garden').click(); return 1`);
  const inStudio = await until(`location.port !== '' && document.querySelector('#v') && document.querySelector('#v').readyState >= 2`, 90000);
  await requireSandbox(await ev('return location.origin'), path.join(STUDIO, 'sandbox', '07_Episodes'));
  check(inStudio, `the studio of E03 opens in the same window (${await ev('return location.href')})`);
  await sleep(2000); await shot('app-2-studio.png');
  check((await ev(`return document.querySelector('#logo').getAttribute('href') || ''`)).startsWith(new URL(page.url).origin), 'the logo leads back to the episodes');
  check(procs(`${STUDIO}\\studio-server.mjs E03 --no-open --hub`).length >= 1, 'a studio server runs for E03, started by the home screen');
  // close the window (as the user would): the launcher stops everything
  const bws = new WebSocket((await (await fetch(`http://127.0.0.1:${DT}/json/version`)).json()).webSocketDebuggerUrl);
  await new Promise((r) => bws.addEventListener('open', r, { once: true }));
  bws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
  const code = await Promise.race([launcherExit, sleep(20000).then(() => 'timeout')]);
  check(code !== 'timeout', `the launcher ends when the window is closed (${code})`);
  await settle();
  check(procs(HUB_PROC).length === 0 && procs(STUDIO_PROC).length === 0, 'home screen and studio stopped with it');
} catch (e) {
  check(false, `erreur : ${e.stack ?? e.message}`);
} finally {
  try { ws?.close(); } catch { /* */ }
  if (launcher.exitCode === null) try { execFileSync('taskkill', ['/PID', String(launcher.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* Ce lanceur de test est déjà fermé. */ }
  for (const pid of [...procs(HUB_PROC), ...procs(STUDIO_PROC)]) try { execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* gone */ }
  console.log(`\n${ok} ok, ${ko} échec(s)`);
  process.exit(ko ? 1 : 0);
}

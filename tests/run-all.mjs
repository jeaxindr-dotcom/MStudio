// Toutes les suites, l'une après l'autre, avec leurs réglages et médias propres.
// Les studios du bac E03 et de sa copie de rendu utilisent des ports libres >= 4240.
// La copie de rendu est restaurée après le test. Les ressources absentes sont
// signalées explicitement par les suites concernées (tests/where.mjs).
// usage: node tests/run-all.mjs [--only a,b] [--skip a,b] [--quick]   (--quick: without the slowest: app, render, staging3d-run)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { waitForRenderIdle } from '../lib/render-activity.mjs';
import { engineCopyFlags, freePort } from './where.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? String(process.argv[i + 1] ?? '').split(',').filter(Boolean) : null; };
const only = arg('--only'), skip = new Set(arg('--skip') ?? []), quick = process.argv.includes('--quick');
const SCR = path.join(STUDIO, '.cache', 'run-all'); fs.mkdirSync(SCR, { recursive: true });
const TEST_TEMP = path.join(SCR, 'temp'); fs.mkdirSync(TEST_TEMP, { recursive: true });
// the servers this runner starts: the tests' own settings and media, the French texts the suites check
const ENV = { ...process.env, TEMP: TEST_TEMP, TMP: TEST_TEMP, COULISSES_LANG: 'fr', COULISSES_SETTINGS: path.join(SCR, 'settings.json'), COULISSES_MEDIAS: path.join(SCR, 'medias'), COULISSES_HISTORY_DIR: path.join(SCR, 'historique') };
ENV.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--import=${pathToFileURL(path.join(STUDIO, 'tests', 'isolation-runtime.mjs')).href}`].filter(Boolean).join(' ');
fs.writeFileSync(ENV.COULISSES_SETTINGS, JSON.stringify({ mediasAutoSort: false }));
// Point de départ de la recherche d'un port libre pour le studio du bac.
const BOX_PORT = +(process.env.COULISSES_TEST_SANDBOX_PORT ?? 4240) || 4240;
if (BOX_PORT < 4240 || BOX_PORT > 65535) throw new Error('Le port du bac de test doit être compris entre 4240 et 65535.');
const SANDBOX = path.resolve(process.env.STUDIO_SANDBOX ?? path.join(STUDIO, 'sandbox', '07_Episodes')), RENDER_BOX = path.join(STUDIO, '.cache', 'sandbox-test', '07_Episodes');
const RENDER_SOURCE = path.join(SANDBOX, 'E03 - The Secret Garden', 'E03 - The Secret Garden.mp4');
// [suite, besoin] : self crée ses serveurs ; sandbox utilise E03 ; render utilise sa copie.
const SUITES = [
  ['isolation-runtime-test', 'self'],
  ['playback-resolution-browser', 'self'],
  ['workspace-studio-v2', 'self'], ['composition-browser-v2', 'self'], ['timeline-studio-v2', 'self'],
  ['navigation-studio-v2', 'self'], ['review-integrity-v2', 'self'], ['preview-launch-v2', 'self'],
  ['timeline-thumbnails-api','self'], ['timeline-filmstrip-browser','self'],
  ['reverse-analysis','self'], ['reverse-project','self'], ['reverse-jobs','self'], ['reverse-browser','self'],
  ['reconstruct-agent','self'], ['reconstruct-project','self'], ['reconstruct-jobs','self'], ['reconstruct-browser','self'],
  ['timeline-code-thumbnails','self'], ['hub-library-v3','self'], ['scene-parallax-request','self'], ['lot-receipts-v2','self'], ['agent-presence','self'],
  ['project-output-parity','self'], ['shared-appearance','self'], ['long08-review-guidance','self'],
  ['export-contract-long08','self'], ['preview-note-readiness','self'],
  ['lot-capture-ui', 'self'], ['lot-frame-list', 'self'], ['lot-images-cli', 'self'], ['lot-sources', 'self'],
  ['lot-updates', 'self'], ['lot-capture-recovery', 'self'], ['lot-capture-workspace', 'self'], ['envoi-performance', 'self'],
  ['shot-render-regressions', 'self'],
  ['initial-publication-regressions', 'self'],
  ['reply-delivery', 'self'], ['reply-delivery-ui', 'self'], ['reply-images', 'self'], ['reply-delivery-browser', 'self'],
  ['code-playback-i18n', 'self'],
  ['audio-regressions', 'self'], ['player-build-regressions', 'self'], ['require-context', 'self'], ['preview-transaction-regressions', 'self'], ['initial-code-mode', 'self'], ['preview-protocol-regressions', 'self'], ['preview-lifecycle', 'self'], ['preview-server-regressions', 'self'], ['project-patches', 'self'], ['project-patches-e15', 'self'], ['timeline-loop-regressions', 'self'], ['code-playback-regressions', 'self'], ['code-playback-render-regressions', 'self'], ['frames-cache-regressions', 'self'], ['code-playback-sources', 'self'], ['code-playback-ui', 'self'], ['code-playback-routes', 'self'], ['render-activity', 'self'], ['code-playback-browser', 'self'],
  ['typecheck', 'self'], ['guard', 'self'], ['temp-sweep', 'self'], ['file-release', 'self'], ['export-speed', 'self'], ['speed-envois', 'self'], ['send-lots', 'self'], ['notes-safety', 'self'], ['note-states', 'self'], ['note-follow', 'self'], ['dictate', 'self'], ['browser-access', 'self'], ['preview-memory', 'self'], ['preview-speed', 'self'], ['coulisses', 'self'], ['coulisses-video', 'self'], ['coulisses-export', 'self'], ['projects', 'self'],
  ['hub-folders', 'self'], ['new-project', 'self'], ['medias', 'self'], ['shortcuts', 'self'], ['staging2d', 'self'], ['menu', 'self'], ['i18n', 'self'],
  ['hyperframes', 'self'], ['ipad-layout', 'self'], ['e2e', 'sandbox'], ['staging', 'sandbox'], ['grade', 'sandbox'], ['e2e-agent', 'self'], ['sound-recovery', 'sandbox'], ['sound-watch', 'self'], ['sound-tab', 'self'], ['review-sound', 'self'], ['preview-wait', 'self'], ['timeline-draw', 'self'], ['preview-premount', 'self'], ['staging3d-run', 'self'], ['shot-render', 'self'], ['app', 'self'], ['render', 'render'],
].filter(([n]) => (only ? only.includes(n) : !skip.has(n) && !(quick && ['app', 'render', 'staging3d-run', 'code-playback-browser'].includes(n))));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));   // COULISSES_TEST_SLOW=2: a slower PC
const kill = (c) => { if (c?.pid) try { execFileSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
async function studioOn(episodes, port, log) {
  const c = spawn(process.execPath, [path.join(STUDIO, 'studio-server.mjs'), 'E03', '--no-open', '--episodes', episodes, ...engineCopyFlags(), '--port', String(port)], { cwd: STUDIO, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 240 && !/Ouvre : http/.test(out); i++) await sleep(250);
  fs.writeFileSync(path.join(SCR, log), out);
  if (!/Ouvre : http/.test(out)) { kill(c); throw new Error(`le studio du bac à sable ne démarre pas (${path.join(SCR, log)})`); }
  // (the port it took: the next one free when the one asked is busy — 19/10/2026, the user's E12 was on 4174)
  c.port = +(/Ouvre : http:\/\/127\.0\.0\.1:(\d+)/.exec(out)?.[1] ?? port);
  return c;
}
function run(name, env) {
  return new Promise((resolve) => {
    const t0 = Date.now(), c = spawn(process.execPath, [path.join(STUDIO, 'tests', `${name}.mjs`)], { cwd: STUDIO, env: { ...ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { out += '\n(arrêté : plus de 15 min)'; kill(c); }, 15 * 60000);
    c.on('exit', (code) => {
      clearTimeout(timer);
      fs.writeFileSync(path.join(SCR, `${name}.log`), out);
      const m = /(\d+) ok, (\d+) (?:ko|échec)/.exec(out.split(/\r?\n/).reverse().find((l) => /\d+ ok, \d+ (ko|échec)/.test(l)) ?? '');
      const passes = /^(?:ℹ |# )pass (\d+)$/m.exec(out), failures = /^(?:ℹ |# )fail (\d+)$/m.exec(out);
      const okN = m ? +m[1] : Number(passes?.[1] ?? 0), ko = m ? +m[2] : Number(failures?.[1] ?? 1);
      const skipped = /\(sauté/.test(out) && okN === 0 && ko === 0;
      resolve({ name, ok: okN, ko: code && !ko ? 1 : ko, skipped, s: Math.round((Date.now() - t0) / 1000), failed: out.split(/\r?\n/).filter((l) => /✗|ERREUR|erreur :/.test(l)).slice(0, 6) });
    });
  });
}

const results = [];
let box = null, rbox = null;
try {
  for (const [name, need] of SUITES) {
    await waitForRenderIdle();
    let env = {};
    // the sandbox studio stops once its suites are done: one studio per project — the app's own studio of E03 (tests/app.mjs)
    // would otherwise hand over to it (studio-server.mjs, revue/studio.lock.json)
    if (need !== 'sandbox' && box) { kill(box); box = null; await sleep(1000); }
    if (need === 'sandbox') {
      if (!fs.existsSync(path.join(SANDBOX, 'E03 - The Secret Garden'))) { results.push({ name, ok: 0, ko: 0, skipped: true, s: 0, failed: [] }); continue; }
      box ??= await studioOn(SANDBOX, await freePort(BOX_PORT), 'sandbox-server.log');
      env = { STUDIO_PORT: String(box.port), STUDIO_SANDBOX: SANDBOX };
    }
    if (need === 'render') {
      if (!fs.existsSync(path.join(RENDER_BOX, 'E03 - The Secret Garden'))) { results.push({ name, ok: 0, ko: 0, skipped: true, s: 0, failed: [] }); continue; }
      rbox = await studioOn(RENDER_BOX, await freePort(4240), 'render-server.log');
      env = { STUDIO_PORT: String(rbox.port), STUDIO_SANDBOX: RENDER_BOX, COULISSES_TEST_E03: RENDER_SOURCE };
    }
    process.stdout.write(`${name.padEnd(16)} `);
    const r = await run(name, env);
    if (need === 'render') {   // the render test's copy put back once its studio is stopped (nothing may hold its files)
      kill(rbox); rbox = null; await sleep(1500);
      try { execFileSync(process.execPath, [path.join(STUDIO, 'tests', 'render.mjs'), '--restore'], { cwd: STUDIO, env: { ...ENV, STUDIO_SANDBOX: RENDER_BOX, COULISSES_TEST_E03: RENDER_SOURCE }, stdio: 'ignore' }); } catch { r.ko++; r.failed.push('render --restore a échoué'); }
    }
    results.push(r);
    console.log(r.skipped ? 'sauté' : `${r.ko ? '✗' : '✓'} ${r.ok} ok, ${r.ko} ko  (${r.s} s)`);
    for (const f of r.failed) console.log(`                   ${f.trim().slice(0, 150)}`);
  }
} catch (e) {
  console.log(`\n✗ ${e.message}`);
  results.push({ name: 'run-all', ok: 0, ko: 1, skipped: false, s: 0, failed: [e.message] });
} finally {
  kill(box); kill(rbox);
}
const tot = results.reduce((a, r) => ({ ok: a.ok + r.ok, ko: a.ko + r.ko, s: a.s + r.s }), { ok: 0, ko: 0, s: 0 });
const bad = results.filter((r) => r.ko), skipped = results.filter((r) => r.skipped);
console.log(`\n${results.length - skipped.length} suite(s), ${tot.ok} ok, ${tot.ko} ko, ${Math.round(tot.s / 60)} min${skipped.length ? ` · sautée(s) : ${skipped.map((r) => r.name).join(', ')}` : ''}${bad.length ? ` · en échec : ${bad.map((r) => r.name).join(', ')} (journaux : ${SCR})` : ''}`);
process.exit(bad.length ? 1 : 0);

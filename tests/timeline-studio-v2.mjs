// Parcours utilisateur sur une vidéo à cadence fractionnaire et un projet isolé.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { launch, requireSandbox } from './cdp.mjs';
import { freePort, remotionModules } from './where.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const cache = path.join(root, '.cache', 'timeline-studio-v2');
fs.mkdirSync(cache, { recursive: true });
const temp = fs.mkdtempSync(path.join(cache, 'run-'));
process.env.STUDIO_PROJECTS = path.join(temp, 'projects.json');
process.env.COULISSES_SETTINGS = path.join(temp, 'settings.json');
process.env.COULISSES_HISTORY_DIR = path.join(temp, 'history');
process.env.COULISSES_MEDIAS = path.join(temp, 'media');
process.env.COULISSES_LANG = 'fr';
const { importProject } = await import('../lib/projects.mjs');
const { createCoulisses } = await import('../lib/coulisses-file.mjs');
const modulesLink = path.join(temp, 'remotion', 'node_modules');
let server, page, base, ok = 0;
const pass = (label) => { console.log('  ✓ ' + label); ok++; };
async function stop() {
  if (!server || server.exitCode !== null || server.signalCode) return;
  const done = once(server, 'exit'); server.kill(); await done;
}
async function openStudio(revue, port, code = false) {
  server = spawn(process.execPath, ['studio-server.mjs', '--port', String(port), '--project', revue, '--no-open'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => log += d); server.stderr.on('data', d => log += d);
  for (let i = 0; i < 200 && !log.includes('Ouvre : http') && server.exitCode === null; i++) await sleep(100);
  assert.ok(log.includes('Ouvre : http://127.0.0.1:' + port + '/'), log);
  base = 'http://127.0.0.1:' + port;
  await requireSandbox(base, temp);
  await page.goto(base);
  const ready = code ? 'window.__preview?.frameReady()' : 'document.querySelector("#v").readyState >= 2';
  await page.until('window.__studio && !document.querySelector("#workIn").disabled && ' + ready, 60000);
}
const click = (id) => page.eval('document.getElementById(' + JSON.stringify(id) + ').click()');
const frame = async (f) => {
  await page.eval('location.hash = "f=' + f + '"');
  await page.until('__studio.state().frame === ' + f);
};
const meta = async () => (await fetch(base + '/api/meta')).json();
async function stored(start, end) {
  for (let i = 0; i < 60; i++) {
    const area = (await meta()).workArea;
    if (area?.start === start && area?.end === end) return area;
    await sleep(100);
  }
  assert.fail('Bornes enregistrées attendues ' + [start, end] + ', trouvé ' + JSON.stringify((await meta()).workArea));
}
try {
  const video = path.join(temp, 'studio-test.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24000/1001', '-frames:v', '72', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '6', video], { windowsHide: true });
  const project = importProject(video);
  const port = await freePort(4350);
  page = await launch({ port: await freePort(9470) });
  await openStudio(project.revue, port);
  const { fps } = await meta(); assert.ok(fps > 23 && fps < 24);
  assert.equal(await page.eval('return workLoop.disabled && workNote.disabled'), true);
  pass('Aucune borne ni lecture au démarrage à 23,976 images/s');

  // Le serveur reçoit la première opération mais sa réponse revient après
  // le deuxième clic. L'écran garde le geste récent pendant cet aller-retour.
  await page.eval("const orig = window.fetch; window.fetch = async (...args) => { const r = await orig(...args); if (args[0] === '/api/work-area') { window.fetch = orig; await new Promise(resolve => window.releaseMark = resolve); } return r; }");
  await frame(12); await click('workIn'); await page.until('typeof releaseMark === "function"');
  await frame(26); await click('workOut'); assert.equal(await page.eval('return workRangeSummary.textContent'), '12 – 26');
  await page.eval('releaseMark()'); await stored(12, 26);
  pass('Deux gestes rapides conservent les points d’entrée et de sortie');
  await click('workOptions'); assert.equal(await page.eval('return workRangeActions.matches(":popover-open")'), true);
  await click('workGoIn'); await page.until('__studio.state().frame === 12');
  await click('workGoOut'); await page.until('__studio.state().frame === 26');
  await click('workFit');
  const view = await page.eval('return __studio.state().view');
  assert.ok(Math.abs(view.a * fps - 12) < 1e-6 && Math.abs(view.b * fps - 27) < 1e-6);
  pass('Navigation aux deux bornes et cadrage incluant la dernière image');
  await click('workNote'); await click('workNote');
  await page.until('__studio.state().drafts === 1');
  let savedNotes = [];
  for (let i = 0; i < 40 && !savedNotes.length; i++) {
    savedNotes = (await (await fetch(base + '/api/notes')).json()).notes; await sleep(75);
  }
  assert.deepEqual(savedNotes.map(n => [n.frame, n.end]), [[12, 26]]);
  pass('Annoter deux fois réutilise exactement la même note');
  await frame(71); await click('workOut'); await stored(12, 71);
  await page.eval("window.ends = 0; document.querySelector('#v').addEventListener('ended', () => window.ends++)");
  await click('workLoop');
  await page.until('window.ends > 0 && !document.querySelector("#v").paused && __studio.state().frame < 61', 18000);
  await click('bPlay'); await page.until('document.querySelector("#v").paused');
  pass('À la fin réelle du MP4, la boucle repart à l’entrée ; Pause reste effective');

  await stop(); await openStudio(project.revue, await freePort(port + 1));
  assert.equal(await page.eval('return workRangeSummary.textContent'), '12 – 71');
  assert.equal(await page.eval('return workLoop.getAttribute("aria-pressed")'), 'false');
  pass('Un autre port restaure les bornes du projet avec une boucle désarmée');
  await frame(7); await click('workOut'); await stored(null, 7);
  assert.equal(await page.eval('return workIn.disabled || !workLoop.disabled'), false);
  await click('workClear'); await stored(null, null);
  pass('Bornes croisées et effacement explicite restent cohérents');
  const patch = (data) => fetch(base + '/api/work-area', { method: 'PATCH', body: JSON.stringify(data) });
  assert.equal((await patch({ edge: 'end', frame: -1, fps })).status, 400);
  const changes = await Promise.all([patch({ edge: 'start', frame: 5, fps }), patch({ edge: 'end', frame: 17, fps })]);
  assert.ok(changes.every(r => r.ok)); await stored(5, 17);
  pass('Le serveur refuse les images invalides et conserve les gestes de deux clients');
  const modules = remotionModules();
  if (modules) {
    await stop();
    const engine = path.dirname(modulesLink), src = path.join(engine, 'src');
    fs.mkdirSync(src, { recursive: true }); fs.mkdirSync(path.join(engine, 'public'));
    fs.symlinkSync(modules, modulesLink, 'junction');
    fs.writeFileSync(path.join(engine, 'package.json'), JSON.stringify({ name: 'timeline-studio-v2-test', private: true }));
    fs.writeFileSync(path.join(src, 'coulisses.ts'), [
      "import {createElement} from 'react'; import {useCurrentFrame} from 'remotion';",
      "const Frame = () => createElement('div', null, String(useCurrentFrame()));",
      "export const compositions = [{id:'Boucle', component:Frame, fps:24, durationInFrames:60, width:320, height:180}];",
    ].join('\n'));
    fs.writeFileSync(path.join(src, 'coulisses-timeline.ts'), 'export const timeline = () => ({fps:24, durationInFrames:60, pistes:[]});');
    fs.writeFileSync(path.join(src, 'index.ts'), "import {createElement} from 'react'; import {registerRoot,Composition} from 'remotion'; import {compositions} from './coulisses'; registerRoot(() => createElement(Composition, compositions[0]));");
    const file = createCoulisses({ dossier: path.join(temp, 'film'), titre: 'Boucle Remotion', projet: engine, composition: 'Boucle' });
    await openStudio(importProject(file).revue, await freePort(port + 2), true);
    assert.equal(await page.eval('return workRangeSummary.hidden'), true);
    await frame(23); await click('workIn'); await frame(59); await click('workOut');
    await page.eval("window.ends = 0; __preview.on(e => { if (e.type === 'ended') window.ends++; })");
    await click('workLoop');
    await page.until('window.ends > 0 && __preview.isPlaying() && __studio.state().frame >= 23 && __studio.state().frame < 53', 18000);
    await click('bPlay'); await page.until('!__preview.isPlaying()');
    pass('Le Player Remotion à 24 i/s boucle jusqu’à sa dernière image et revient au point d’entrée');
  } else console.log('  (Player Remotion non exercé, SDK de projet indisponible)');
  console.log(ok + ' ok, 0 ko');
} catch (error) {
  console.error(error, page?.logs.slice(-6)); console.log(ok + ' ok, 1 ko'); process.exitCode = 1;
} finally {
  if (page) await page.close();
  await stop();
  if (fs.lstatSync(modulesLink, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(modulesLink);
  if (path.dirname(temp) === cache) fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
}

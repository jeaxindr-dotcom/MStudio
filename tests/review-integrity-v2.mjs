// Trois imports par l'accueil et deux fenêtres de revue indépendantes sur des fichiers de test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { launch, requireSandbox } from './cdp.mjs';
import { freePort } from './where.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = path.join(root, '.cache', 'review-integrity-v2');
fs.mkdirSync(cache, { recursive: true });
const sandbox = fs.mkdtempSync(path.join(cache, 'project-'));
const env = { ...process.env, COULISSES_LANG: 'fr', COULISSES_SETTINGS: path.join(sandbox, 'settings.json'),
  COULISSES_MEDIAS: path.join(sandbox, 'media'), STUDIO_PROJECTS: path.join(sandbox, 'projects.json'),
  COULISSES_HISTORY_DIR: path.join(sandbox, 'history') };
const servers = [], browsers = [];
let base, ok = 0;
const pass = label => { ok++; console.log('  ✓ ' + label); };
async function serve(script, args, port, ready) {
  const child = spawn(process.execPath, [script, ...args, '--port', String(port)], { cwd: root, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(child); let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  for (let i = 0; i < 150 && !log.includes(ready) && child.exitCode === null; i++) await sleep(100);
  assert.ok(log.includes(ready), log);
  return 'http://127.0.0.1:' + port;
}
async function openWindow(fromPort) {
  const p = await launch({ port: await freePort(fromPort) }); browsers.push(p);
  await p.goto(base);
  await p.until('window.__studio && document.querySelector("#v").readyState >= 2');
  p.onEvent(e => {
    if (e.method === 'Network.responseReceived' && e.params.response.url === base + '/api/notes' && e.params.response.status === 409) p.conflicts++;
  });
  p.conflicts = 0; await p.send('Network.enable'); return p;
}
async function atFrame(p, f) {
  await p.eval('location.hash = "f=' + f + '"'); await p.until('__studio.state().frame === ' + f);
}
async function add(p, frame) {
  await atFrame(p, frame); await p.eval('document.querySelector("#bNote").click()');
}
async function history(p, redo = false) {
  await p.eval('document.activeElement?.blur()'); await p.key(redo ? 'y' : 'z', redo ? 'KeyY' : 'KeyZ', undefined, 2);
}
async function expectNotes(expected) {
  let got = [];
  for (let i = 0; i < 80; i++) {
    const data = await (await fetch(base + '/api/notes')).json();
    got = data.notes.map(n => [n.frame, n.text]).sort((a, b) => a[0] - b[0]);
    if (JSON.stringify(got) === JSON.stringify(expected)) return data.notes;
    await sleep(100);
  }
  assert.deepEqual(got, expected);
}
try {
  const clip = path.join(sandbox, 'intro.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=240x160:r=25', '-frames:v', '48', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '6', clip], { windowsHide: true });
  for (const filename of ['plan.mov', 'plan.mp4']) fs.copyFileSync(clip, path.join(sandbox, filename));
  const episodes = path.join(sandbox, 'episodes'); fs.mkdirSync(episodes);
  const port = await freePort(4380);
  const hub = await serve('hub-server.mjs', ['--episodes', episodes], port, 'HUB_READY');
  async function importFile(name) {
    const r = await fetch(hub + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({path: path.join(sandbox, name)}) });
    const data = await r.json(); assert.equal(data.ok, true, data.why); return data.project;
  }
  const intro = await importFile('intro.mp4'), mov = await importFile('plan.mov'), mp4 = await importFile('plan.mp4');
  assert.equal(new Set([intro.id, mov.id, mp4.id]).size, 3);
  assert.equal(new Set([intro.revue, mov.revue, mp4.revue]).size, 3);
  assert.deepEqual([intro, mov, mp4].map(p => path.basename(p.videoPath)), ['intro.mp4', 'plan.mov', 'plan.mp4']);
  pass('L’accueil associe chaque import à son propre film et à son dossier de revue');
  const sentinel = path.join(mov.revue, 'notes.json');
  const sentinelText = JSON.stringify({ notes: [{ id: 'mov', frame: 2, text: 'Note du MOV' }] });
  fs.writeFileSync(sentinel, sentinelText);
  assert.equal((await importFile('plan.mov')).id, mov.id); assert.equal((await importFile('plan.mp4')).id, mp4.id);
  pass('Réimporter retrouve les deux projets et leurs identifiants');

  base = await serve('studio-server.mjs', ['--project', mp4.revue, '--no-open'], await freePort(port + 1), 'Ouvre : http');
  await requireSandbox(base, sandbox);
  const [a, b] = [await openWindow(9510), await openWindow(9520)];
  await add(b, 5); const [theirs] = await expectNotes([[5, '']]);
  await add(a, 17); await expectNotes([[5, ''], [17, '']]); assert.ok(a.conflicts >= 1);
  pass('Le serveur refuse la révision périmée, puis enregistre la fusion des deux fenêtres');
  await history(a); await expectNotes([[5, '']]);
  await history(a, true); await expectNotes([[5, ''], [17, '']]);
  pass('Ctrl+Z et Ctrl+Y annulent et restaurent uniquement la note du premier onglet');

  await b.eval('const card = document.querySelector(' + JSON.stringify('.card[data-id="' + theirs.id + '"] textarea.main') + '); card.value="Texte B"; card.dispatchEvent(new Event("input", {bubbles:true}));');
  await expectNotes([[5, 'Texte B'], [17, '']]);
  await add(a, 29); await expectNotes([[5, 'Texte B'], [17, ''], [29, '']]); assert.ok(a.conflicts >= 2);
  await history(a); await expectNotes([[5, 'Texte B'], [17, '']]);
  await history(a); await expectNotes([[5, 'Texte B']]);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), sentinelText);
  pass('Deux annulations préservent aussi le texte distant et le fichier de notes de l’autre vidéo');
  if (process.platform === 'win32') {
    assert.equal((await importFile('PLAN.MP4')).id, mp4.id);
    pass('Sous Windows, une autre casse du nom retrouve la même revue');
  }
  console.log(ok + ' ok, 0 ko');
} catch (e) {
  console.error(e, browsers.map(p => p.logs.slice(-3))); console.log(ok + ' ok, 1 ko'); process.exitCode = 1;
} finally {
  for (const p of browsers) await p.close();
  for (const child of servers.reverse()) if (child.exitCode === null && !child.signalCode) {
    const done = once(child, 'exit'); child.kill(); await done;
  }
  if (path.dirname(sandbox) === cache) fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

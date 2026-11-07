import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { makeFixture } from './coulisses-fixture.mjs';
import { freePort } from './where.mjs';
import { waitForRenderIdle } from '../lib/render-activity.mjs';

// Même parcours HTTP et mêmes vingt notes avant/après. --reference désactive
// seulement les assertions de délai pour chronométrer l'ancien serveur.
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = path.join(root, '.cache', 'mesure-envoi');
fs.mkdirSync(scratch, {recursive: true});
const run = fs.mkdtempSync(path.join(scratch, 'essai-'));
Object.assign(process.env, {TEMP: run, TMP: run, COULISSES_SETTINGS: path.join(run, 'settings.json'),
  COULISSES_HISTORY_DIR: run, COULISSES_LANG: 'fr', STUDIO_PROJECTS: path.join(run, 'projets.json'),
  COULISSES_MEDIAS: path.join(run, 'medias'), COULISSES_REVIEW_SOUND: '0'});
fs.writeFileSync(process.env.COULISSES_SETTINGS, '{"mediasAutoSort":false}');
process.env.NODE_OPTIONS = '--import=' + pathToFileURL(path.join(root, 'tests', 'isolation-runtime.mjs')).href;
await waitForRenderIdle();
const {importProject} = await import('../lib/projects.mjs');
const {revue} = importProject(makeFixture({slowScene: 200}));
const notes = Array.from({length: 20}, (_, k) => ({
  id: 'mesure-' + k, text: 'Demande ' + k, source: 'code', frame: 90 + (k % 16) * 6,
  end: k % 5 === 0 ? 192 : null, draft: true, images: [], thread: [],
}));
fs.writeFileSync(path.join(revue, 'notes.json'), JSON.stringify({notes}));
const port = await freePort(4340);
const base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, [path.join(root, 'studio-server.mjs'), '--project', revue, '--no-open', '--port', String(port)],
  {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
let log = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {log += chunk;});
try {
  for (let i = 0; i < 600 && !log.includes('Ouvre : http'); i++) await sleep(100);
  assert.ok(log.includes('Ouvre : http'), log);
  const ping = await (await fetch(base + '/api/ping')).json();
  assert.equal(path.resolve(ping.notesFile), path.join(revue, 'notes.json'));
  const start = performance.now();
  const response = await (await fetch(base + '/api/send', {method: 'POST', body: JSON.stringify({ids: notes.map(n => n.id), agent: 'claude'})})).json();
  const envoiMs = Math.round(performance.now() - start);
  assert.equal(response.ok, true, JSON.stringify(response));
  const json = response.md.replace(/\.md$/, '.json');
  let lot, derniereImageMs;
  do {
    lot = JSON.parse(fs.readFileSync(json));
    if (lot.edits.every(e => e.captures.image && (e.end === null || e.captures.fin))) {
      derniereImageMs ??= Math.round(performance.now() - start);
    }
    if (lot.captureState?.status !== 'pending') break;
    assert.ok(performance.now() - start < 240000, 'Les captures ne se terminent pas');
    await sleep(50);
  } while (true);
  const finMs = Math.round(performance.now() - start);
  assert.equal(lot.edits.length, 20);
  for (const e of lot.edits) {
    assert.ok(!e.captures.error, e.captures.error);
    assert.ok(fs.statSync(e.captures.image).size > 0);
    if (e.end !== null) assert.ok(fs.statSync(e.captures.fin).size > 0);
  }
  assert.ok(derniereImageMs !== undefined);
  const mesures = {envoiMs, derniereImageMs, finMs, notes: 20, capturesDemandees: 24, imagesDistinctes: 17};
  console.log(JSON.stringify(mesures));
  fs.writeFileSync(path.join(run, 'mesures.json'), JSON.stringify(mesures));
  if (!process.argv.includes('--reference')) {
    assert.ok(envoiMs < 3000, 'Envoi HTTP au-delà de trois secondes');
    assert.ok(envoiMs < derniereImageMs, 'Les captures ont bloqué la livraison');
  }
  console.log('1 ok, 0 ko');
} finally {
  fs.writeFileSync(path.join(run, 'studio.log'), log);
  if (child.exitCode === null) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore', windowsHide: true});
}

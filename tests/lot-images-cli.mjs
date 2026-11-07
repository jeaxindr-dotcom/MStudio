// Livraison des images sans serveur ni navigateur. Chaque cas utilise le vrai CLI et un lot sous .cache.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { writeJson } from '../lib/episode.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.cache', 'tests-images-cli');
fs.mkdirSync(cache, { recursive: true });

function fixture() {
  const revue = fs.mkdtempSync(path.join(cache, 'revue-'));
  writeJson(path.join(revue, 'projet.json'), { kind: 'folder', title: 'Images du lot', root: '.' });
  const save = (edits, captureState) => writeJson(path.join(revue, 'lots', '001.json'), { lot: 1, edits, captureState });
  const file = (name) => {
    const target = path.join(revue, name);
    fs.writeFileSync(target, 'image publiée');
    return target;
  };
  const run = (...flags) => {
    const child = spawn(process.execPath, [path.join(root, 'studio-cli.mjs'), 'images', revue, '1', ...flags], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000,
      env: { ...process.env, COULISSES_LANG: 'fr', COULISSES_SETTINGS: path.join(revue, 'settings.json') },
    });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stdout, stderr }));
    });
    return { child, done, output: () => stdout };
  };
  return { revue, save, file, run };
}
const edit = (k, captures) => ({ k, id: `note-${k}`, frame: k, captures });
const state = (status, done) => ({ status, done, total: 2 });

test('les chemins arrivent avant la fin, une fois chacun, même si le lot est déjà pris', async () => {
  const { revue, save, file, run } = fixture();
  const first = file('premiere.jpg'), zoom = file('zoom.jpg'), last = file('derniere.jpg');
  const replies = { notes: {}, lots: { 1: { status: 'taken' } } };
  const repliesFile = path.join(revue, 'replies.json');
  writeJson(repliesFile, replies);
  save([edit(1, { image: first }), edit(2, {})], state('pending', 1));
  const listener = run('--timeout', '5');
  try {
    for (let i = 0; i < 100 && listener.child.exitCode === null && !listener.output().includes(first); i++) await sleep(35);
    assert.ok(listener.output().includes(first), 'première image livrée pendant la préparation');
    assert.equal(listener.child.exitCode, null);
    save([edit(1, { image: first, zoom, zoomRect: { x: 20, y: 40, width: 100, height: 80 } }), edit(2, { fin: last })], state('ready', 2));
    const result = await listener.done;
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.split(first).length, 2);
    for (const value of [zoom, last, 'note-1', 'note-2', '001.md']) assert.ok(result.stdout.includes(value), value);
    assert.deepEqual(JSON.parse(fs.readFileSync(repliesFile)), replies);
    assert.ok(!fs.existsSync(path.join(revue, 'user-replies.json')));
  } finally { if (listener.child.exitCode === null) listener.child.kill(); }
});

test('un ancien lot livre immédiatement ses images', async () => {
  const { save, file, run } = fixture();
  const image = file('ancien.jpg');
  save([edit(1, { image })]);
  const result = await run('--timeout', '0.05').done;
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes(image));
});

test('un échec conserve les chemins livrés et indique la note et le motif', async () => {
  const { save, file, run } = fixture();
  const image = file('valide.jpg');
  save([edit(1, { image }), edit(2, { error: 'texture absente' })], { ...state('error', 2), error: 'rendu interrompu' });
  const result = await run().done;
  assert.equal(result.code, 1);
  assert.ok(result.stdout.includes(image));
  assert.match(result.stdout + result.stderr, /note-2.*texture absente/);
  assert.match(result.stderr, /rendu interrompu/);
});

test('une expiration est explicite et conserve le travail en attente', async () => {
  const { save, run } = fixture();
  save([edit(1, {})], { status: 'pending', done: 0, total: 1 });
  const result = await run('--timeout', '0.1').done;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /délai|expir/i);
});

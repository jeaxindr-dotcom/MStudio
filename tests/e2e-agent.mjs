// The « connexion » mode and the eyes, on the SANDBOX: `studio-cli wait` running (the page shows « Claude surveille »),
// a batch sent from the page wakes it (prints the request), `frame --source code`, `sheet` (before = MP4, after =
// code), and the live preview reloading by itself when the code changes. Each run owns its server, mailbox and Player.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, requireFrench, requireSandbox } from './cdp.mjs';
import { waitForRenderIdle } from '../lib/render-activity.mjs';
import { engineCopyFlags, freePort, skip } from './where.mjs';

process.env.COULISSES_LANG = 'fr';   // the suite checks the French texts (lib/i18n.mjs): the CLI below, and the studio started by hand
process.env.STUDIO_AGENT = 'claude'; // Identité testée explicitement, indépendante de la session qui lance les tests.
const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const episode = 'E03 - The Secret Garden';
const source = path.join(process.env.STUDIO_SANDBOX ?? path.join(STUDIO, 'sandbox', '07_Episodes'), episode);
if (!fs.existsSync(path.join(source, episode + '.mp4'))) skip('la vidéo E03 du bac à sable', 'STUDIO_SANDBOX');
const cache = path.join(STUDIO, '.cache', 'e2e-agent');
fs.mkdirSync(cache, {recursive: true});
const runtime = fs.mkdtempSync(path.join(cache, 'run-'));
const SANDBOX = path.join(runtime, 'sandbox', '07_Episodes');
const project = path.join(SANDBOX, episode);
const REVUE = path.join(project, 'revue');
const PORT = await freePort(4750);
const CLI = path.join(runtime, 'studio-cli.mjs');
const env = {...process.env, COULISSES_SETTINGS: path.join(runtime, 'settings.json'), STUDIO_PROJECTS: path.join(runtime, 'projects.json'),
  COULISSES_MEDIAS: path.join(runtime, 'medias'), COULISSES_HISTORY_DIR: path.join(runtime, 'history')};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));   // COULISSES_TEST_SLOW=2: a slower PC
const episodeFlags = ['--episodes', SANDBOX, ...engineCopyFlags()];
const cli = (...a) => execFileSync(process.execPath, [CLI, a[0], 'E03', ...a.slice(1), ...episodeFlags], { encoding: 'utf8', cwd: runtime, env, windowsHide: true }).trim();
let ok = 0, ko = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };

// Borrow only immutable episode inputs. Chats, notes, acknowledgements and queues all start empty.
const entry = path.join(runtime, 'player', 'entry.tsx');
let server, w, p;
try {
  for (const name of ['page', 'lib', 'player', 'studio-server.mjs', 'studio-cli.mjs', 'studio.html', 'shortcuts.js', 'menubar.js', 'medias.js', 'favicon.png', 'AGENT.md', 'AGENT.en.md']) {
    fs.cpSync(path.join(STUDIO, name), path.join(runtime, name), {recursive: true});
  }
  fs.mkdirSync(REVUE, {recursive: true});
  for (const name of [episode + '.mp4', 'revue/video-revue.mp4', 'revue/video-revue.json', 'revue/timeline.json']) {
    const from = path.join(source, name), to = path.join(project, name);
    if (!fs.existsSync(from)) continue;
    if (name.endsWith('.mp4')) {
      try { fs.linkSync(from, to); continue; } catch (err) { if (err.code !== 'EXDEV') throw err; }
    }
    fs.copyFileSync(from, to);
  }
  const base = 'http://127.0.0.1:' + PORT + '/';
  server = spawn(process.execPath, ['studio-server.mjs', 'E03', '--no-open', '--port', String(PORT), ...episodeFlags],
    {cwd: runtime, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  let log = '';
  server.stdout.on('data', d => {log += d;}); server.stderr.on('data', d => {log += d;});
  for (let i = 0; i < 200 && !log.includes(base) && server.exitCode === null; i++) await sleep(100);
  assert.ok(log.includes(base), 'Studio du bac non démarré : ' + log.slice(-1000));
  await requireSandbox(base, SANDBOX);
  await requireFrench(base);
  const status = async () => (await fetch(base + 'api/status')).json();
  assert.deepEqual((await status()).lots, [], 'La file privée doit démarrer vide');
  w = spawn(process.execPath, [CLI, 'wait', 'E03', ...episodeFlags], {cwd: runtime, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  let out = ''; w.stdout.on('data', d => {out += d;});
  let watcherError = ''; w.stderr.on('data', d => {watcherError += d;});
  const exited = new Promise(resolve => w.once('close', resolve));
  p = await launch({port: await freePort(9333)});
  await p.goto(base);
  await p.until(`document.querySelector('#v').readyState >= 2`);
  await p.until(`document.querySelector('#agent').textContent.includes('Agent connecté')`, 15000).catch(() => {});
  const btn = await p.eval(`return document.querySelector('#agent').textContent`);
  check(/^Agent connecté · Claude Code$/.test(btn.trim()), `the button names the agent that connected itself (« ${btn.trim()} »)`);
  // 2) one note with N, text, send
  await p.eval(`document.querySelector('#v').currentTime = 3000.5/30; return 1`); await sleep(800);
  await p.key('n', 'KeyN', 'n'); await sleep(300);
  await p.type('Test connexion : la lanterne clignote'); await sleep(600);
  await p.eval(`document.activeElement.blur(); document.querySelector('#qsend').click(); return 1`);
  await p.until(`document.querySelector('#modal').style.display === 'flex'`, 60000);
  // A heartbeat or wait printing a batch is not the agent's explicit take.
  const mo = await p.eval(`const m = document.querySelector('#modal'); return { p1: document.querySelector('#mP1').textContent, folded: m.classList.contains('received') && getComputedStyle(document.querySelector('#mLine')).display === 'none' && getComputedStyle(document.querySelector('#mShowLine')).display !== 'none', main: document.querySelector('#mClose').className }`);
  check(/en attente de prise en charge/.test(mo.p1) && !mo.folded, `Le lot attend un accusé explicite même quand wait surveille la file (${mo.p1})`);
  const upd = await p.eval(`return document.querySelector('#mUpd').textContent`);
  check(!upd || /^Mises à jour : /.test(upd), 'the update check is localised when shown');
  const line = await p.eval("return document.querySelector('#mLine').textContent");
  const lot = Number(/\blot (\d+)/i.exec(line)?.[1]);
  assert.ok(lot > 0, 'Numéro de lot absent dans la commande du dialogue : ' + line);
  const exitCode = await Promise.race([exited, sleep(30000).then(() => 'timeout')]);
  assert.equal(exitCode, 0, watcherError || 'wait ne s’est pas terminé');
  assert.equal(Number(/LOT (\d+) REÇU/.exec(out)?.[1]), lot, 'wait doit remettre le lot du dialogue');
  assert.match(out, /Test connexion : la lanterne clignote/);
  check(true, `wait a remis la demande visible (lot ${lot})`);
  const sent = (await status()).lots;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].lot, lot);
  assert.ok(!sent[0].claude || sent[0].claude.status === 'open');
  assert.equal(await p.eval("return document.querySelector('#modal').classList.contains('received')"), false);
  check(true, 'La remise par wait laisse le lot en attente dans le dialogue et la file');
  console.log('   ' + cli('take', String(lot)));
  await p.until("document.querySelector('#modal').classList.contains('received')", 15000);
  assert.equal((await status()).lots.find(item => item.lot === lot).claude.status, 'taken');
  const receipt = await p.eval("return document.querySelector('#mP1').textContent");
  assert.equal(receipt, "L'agent corrige… · lot " + lot);
  check(true, `Le take effectif confirme ce lot dans le dialogue (« ${receipt} »)`);
  // 3) the eyes on the code, and a before / after strip
  await waitForRenderIdle();
  const t0 = Date.now();
  const f = cli('frame', '3000', '--source', 'code', '--out', path.join(runtime, 'agent-eyes-code-3000.jpg'));
  check(fs.existsSync(f), `frame --source code (${Math.round((Date.now() - t0) / 1000)} s)`);
  const L = JSON.parse(fs.readFileSync(path.join(REVUE, 'lots', String(lot).padStart(3, '0') + '.json'), 'utf8')), id = L.edits[0].id;
  const lmd = fs.readFileSync(path.join(REVUE, 'lots', String(lot).padStart(3, '0') + '.md'), 'utf8');
  const updateSection = /## Mises à jour \(vérifiées à l'envoi\)/.test(lmd);
  check(L.agent?.name === 'Claude Code' && (L.updatesRepeated ? !updateSection : updateSection && /Remotion : installé \d/.test(lmd)), 'the batch identifies its agent and only repeats a changed update checklist');
  await waitForRenderIdle();
  const t1 = Date.now();
  console.log('   ' + cli('sheet', id).split('\n').join('\n   '));
  check(fs.existsSync(path.join(REVUE, 'images', `claude-${id}-apres.jpg`)), `sheet: before (MP4) / after (code) strips (${Math.round((Date.now() - t1) / 1000)} s)`);
  console.log('   ' + cli('reply', id, 'Test : bandes avant / après jointes', '--status', 'done'));
  console.log('   ' + cli('done', String(lot), 'test connexion'));
  const rmsg = JSON.parse(fs.readFileSync(path.join(REVUE, 'replies.json'), 'utf8')).notes[id].messages.at(-1);
  check(rmsg.by === 'Claude Code', `the reply is signed by the agent (${rmsg.by})`);
  const cx = cli('updates', '--agent', 'codex');
  check(/^Mises à jour : /.test(cx) && /brambleshire-theatre/.test(cx) && /Codex/.test(cx), 'updates --agent codex: the check for another agent (its own skills, the project\'s skill)');
  await p.eval(`document.querySelector('#mClose').click(); return 1`);
  // 4) live preview: the code changes -> the preview reloads by itself at the same frame
  await p.eval(`document.querySelector('#srcCode').click(); return 1`);
  await p.until(`__studio.state().mode === 'code'`, 60000); await sleep(1500);
  const v0 = await p.eval(`return document.querySelector('#codeStatus').textContent`);
  const iframeBefore = await p.eval(`return document.querySelector('#code').src`);
  // Une espace n'altère plus la sortie esbuild : tester une vraie révision.
  const entryBefore = fs.readFileSync(entry, 'utf8');
  const entryChanged = entryBefore.replace('<div id="stage"', '<div data-coulisses-test="revision-agent" id="stage"');
  if (entryChanged === entryBefore) throw new Error('Point de variation du Player introuvable');
  fs.writeFileSync(entry, entryChanged);
  await p.until(`document.querySelector('#code').src !== ${JSON.stringify(iframeBefore)} && /code v/i.test(document.querySelector('#codeStatus').textContent)`, 60000);
  const v1 = await p.eval(`return document.querySelector('#codeStatus').textContent`);
  check(v1 !== v0, `preview rebuilt and reloaded (${v0} → ${v1})`);
  check((await p.eval('return __studio.state().frame')) === 3000, 'still on the same frame after the reload');
} catch (e) {
  ko++; console.error(e.stack ?? e);
} finally {
  w?.kill(); await p?.close();
  if (server && server.exitCode === null && !server.signalCode) {
    const closed = new Promise(resolve => server.once('close', resolve));
    server.kill(); await closed;
  }
  if (ko) console.error('Bac conservé : ' + runtime);
  else fs.rmSync(runtime, {recursive: true, force: true, maxRetries: 3, retryDelay: 200});
  console.log(`\n${ok} ok, ${ko} échec(s)`);
  process.exit(ko ? 1 : 0);
}

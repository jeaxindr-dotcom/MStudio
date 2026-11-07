// The « connexion » mode and the eyes, on the SANDBOX: `studio-cli wait` running (the page shows « Claude surveille »),
// a batch sent from the page wakes it (prints the request), `frame --source code`, `sheet` (before = MP4, after =
// code), and the live preview reloading by itself when the code changes. Same server as tests/e2e.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, requireFrench, requireSandbox } from './cdp.mjs';
import { CACHE } from '../lib/place.mjs';
import { waitForRenderIdle } from '../lib/render-activity.mjs';
import { engineCopyFlags, freePort } from './where.mjs';
import { removeTestNotes, closeTestLots, AGENT_TEXTS, SANDBOX_TEXTS } from './sandbox-clean.mjs';

process.env.COULISSES_LANG = 'fr';   // the suite checks the French texts (lib/i18n.mjs): the CLI below, and the studio started by hand
process.env.STUDIO_AGENT = 'claude'; // Identité testée explicitement, indépendante de la session qui lance les tests.
const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX = process.env.STUDIO_SANDBOX ?? path.join(STUDIO, 'sandbox', '07_Episodes');   // tests can run on their own copy
const PORT = +(process.env.STUDIO_PORT ?? 4174);
const REVUE = path.join(SANDBOX, 'E03 - The Secret Garden', 'revue');
const CLI = path.join(STUDIO, 'studio-cli.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));   // COULISSES_TEST_SLOW=2: a slower PC
const episodeFlags = ['--episodes', SANDBOX, ...engineCopyFlags()];
const cli = (...a) => execFileSync('node', [CLI, a[0], 'E03', ...a.slice(1), ...episodeFlags], { encoding: 'utf8' }).trim();
let ok = 0, ko = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };

// what earlier runs of the sandbox tests left behind (their own notes and open batches only: tests/sandbox-clean.mjs)
const TEST_TEXTS = AGENT_TEXTS;   // (tests/sandbox-clean.mjs: the texts of every suite of the sandbox)
await requireFrench(`http://localhost:${PORT}/`); await requireSandbox(`http://localhost:${PORT}/`, SANDBOX);   // (never a real episode's studio)
closeTestLots(REVUE, cli, SANDBOX_TEXTS);
await removeTestNotes(PORT, SANDBOX_TEXTS);

// 1) the session starts watching
const w = spawn('node', [CLI, 'wait', 'E03', ...episodeFlags], { stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; w.stdout.on('data', (d) => { out += d; });
const exited = new Promise((r) => w.on('close', r));
const p = await launch({ port: await freePort(9333) });
const entry = path.join(STUDIO, 'player', 'entry.tsx');
let entryBefore = null, entryChanged = null;
try {
  await p.goto(`http://localhost:${PORT}/`);
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
  // nothing to paste: the line folded away (« Afficher la ligne »), « Fermer » the main button (user report 14/10/2026:
  // « pourquoi ça me donne un code à coller alors que ça commence automatiquement ? »)
  const mo = await p.eval(`const m = document.querySelector('#modal'); return { p1: document.querySelector('#mP1').textContent, folded: m.classList.contains('received') && getComputedStyle(document.querySelector('#mLine')).display === 'none' && getComputedStyle(document.querySelector('#mShowLine')).display !== 'none', main: document.querySelector('#mClose').className }`);
  check(/Claude Code a reçu ce lot : il s'en occupe tout seul, rien à coller/.test(mo.p1) && mo.folded && mo.main === 'primary', `modal: the watching agent already has it, the line folded away, « Fermer » first (${mo.p1})`);
  const upd = await p.eval(`return document.querySelector('#mUpd').textContent`);
  check(/^Mises à jour : /.test(upd) && await p.eval(`return document.querySelector('#mUpd').classList.contains('on')`), `the update check, in the send window (« ${upd.slice(0, 90)}… »)`);
  await Promise.race([exited, sleep(15000)]);
  check(/LOT \d+ REÇU/.test(out) && /Test connexion : la lanterne clignote/.test(out), 'wait woke up and printed the request');
  const lot = +(/LOT (\d+) REÇU/.exec(out)?.[1] ?? 0);
  // 3) the eyes on the code, and a before / after strip
  await waitForRenderIdle();
  const t0 = Date.now();
  const f = cli('frame', '3000', '--source', 'code', '--out', path.join(STUDIO, '.cache', 'shots', 'agent-eyes-code-3000.jpg'));
  check(fs.existsSync(f), `frame --source code (${Math.round((Date.now() - t0) / 1000)} s)`);
  const L = JSON.parse(fs.readFileSync(path.join(REVUE, 'lots', String(lot).padStart(3, '0') + '.json'), 'utf8')), id = L.edits[0].id;
  const lmd = fs.readFileSync(path.join(REVUE, 'lots', String(lot).padStart(3, '0') + '.md'), 'utf8');
  check(L.agent?.name === 'Claude Code' && /## Mises à jour \(vérifiées à l'envoi\)/.test(lmd) && /Remotion : installé \d/.test(lmd) && lmd.indexOf('Mises à jour') < lmd.indexOf('## À faire'), 'the batch: its agent, and « Mises à jour » before « À faire »');
  await waitForRenderIdle();
  const t1 = Date.now();
  console.log('   ' + cli('sheet', id).split('\n').join('\n   '));
  check(fs.existsSync(path.join(REVUE, 'images', `claude-${id}-apres.jpg`)), `sheet: before (MP4) / after (code) strips (${Math.round((Date.now() - t1) / 1000)} s)`);
  console.log('   ' + cli('take', String(lot)));
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
  entryBefore = fs.readFileSync(entry, 'utf8');
  entryChanged = entryBefore.replace('<div id="stage"', '<div data-coulisses-test="revision-agent" id="stage"');
  if (entryChanged === entryBefore) throw new Error('Point de variation du Player introuvable');
  fs.writeFileSync(entry, entryChanged);
  await p.until(`document.querySelector('#code').src !== ${JSON.stringify(iframeBefore)} && /code v/i.test(document.querySelector('#codeStatus').textContent)`, 60000);
  const v1 = await p.eval(`return document.querySelector('#codeStatus').textContent`);
  check(v1 !== v0, `preview rebuilt and reloaded (${v0} → ${v1})`);
  check((await p.eval('return __studio.state().frame')) === 3000, 'still on the same frame after the reload');
} catch (e) {
  ko++; console.error(e.stack ?? e);
} finally {
  if (entryBefore !== null && fs.readFileSync(entry, 'utf8') === entryChanged) fs.writeFileSync(entry, entryBefore);
  w.kill(); await p.close();
  console.log(`\n${ok} ok, ${ko} échec(s)`);
  process.exit(ko ? 1 : 0);
}

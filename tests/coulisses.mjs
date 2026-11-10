// A run of a Remotion pipeline opened through its .coulisses file, reviewed BEFORE any export (user request: « importer
// le fichier avant que l'export soit fait »), on the sample project of tests/coulisses-fixture.mjs:
// `projet verifier`, import from the home screen, the studio on the CODE with no MP4 (duration, fps and pixels from the
// composition), the tracks of the project's timeline module, a pin on a title named by data-coulisses, a batch whose
// request says it is the code, the agent's commands (frame from the code), then an export arriving: loaded by itself.
// usage: node tests/coulisses.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';
import { makeFixture, RUN, PROJET } from './coulisses-fixture.mjs';
import { freePort } from './where.mjs';

process.env.COULISSES_LANG = 'fr';   // the suite checks the French texts (lib/i18n.mjs)
const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HUB_PORT = await freePort(4288), CLI = path.join(STUDIO, 'studio-cli.mjs'), shots = path.join(STUDIO, '.cache', 'shots'), REG = path.join(STUDIO, '.cache', 'coulisses-test-projets.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));   // COULISSES_TEST_SLOW=2: a slower PC
let ok = 0, ko = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };
const cli = (...a) => execFileSync(process.execPath, [CLI, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const FILE = makeFixture();
fs.rmSync(REG, { force: true }); fs.mkdirSync(shots, { recursive: true });
check(fs.existsSync(FILE) && FILE.endsWith('Essai de Coulisses.coulisses'), `projet creer: the run's file (${path.basename(FILE)})`);
const ver = spawnSync(process.execPath, [CLI, 'projet', 'verifier', FILE, '--rapide'], { encoding: 'utf8' });
check(ver.status === 0 && /PROJET CONFORME/.test(ver.stdout) && /3 piste\(s\), 6 clip\(s\)/.test(ver.stdout), 'projet verifier --rapide: conforming (tracks, composition, live preview)');

const hub = spawn(process.execPath, [path.join(STUDIO, 'hub-server.mjs'), '--port', String(HUB_PORT)], { cwd: STUDIO, env: { ...process.env, STUDIO_PROJECTS: REG }, stdio: ['ignore', 'pipe', 'pipe'] });
let hubOut = ''; hub.stdout.on('data', (d) => { hubOut += d; }); hub.stderr.on('data', (d) => { hubOut += d; });
const H = `http://127.0.0.1:${HUB_PORT}`;
const post = async (u, b) => (await fetch(H + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) })).json();
for (let i = 0; i < 60 && !/HUB_READY/.test(hubOut); i++) await sleep(250);
const p = await launch({ port: await freePort(9349) });
const until = async (expr, ms = 30000) => { const t0 = Date.now(); for (;;) { try { if (await p.eval(`return !!(${expr})`)) return true; } catch { /* navigating */ } if (Date.now() - t0 > ms) throw new Error(`timeout: ${expr}`); await sleep(150); } };
const ev = (e) => p.eval(e).catch(() => null);
try {
  // 1) import: the .coulisses file itself, or its run folder
  const imp = await post('/api/import', { path: RUN });
  check(imp.ok && imp.project.kind === 'remotion' && imp.project.title === 'Essai de Coulisses', `import of the run folder finds its .coulisses (${imp.project?.kind}, « ${imp.project?.title} »)`);
  const list = await (await fetch(H + '/api/episodes')).json();
  const pr = list.projects.find((x) => x.id === imp.project.id);
  check(pr && !pr.video, 'listed, with no video yet');
  await p.goto(H + '/'); await until(`document.querySelector('.card[data-id="${pr.id}"] button.open:not([disabled])')`, 20000);
  check(true, 'home screen: « Ouvrir le studio » is offered before any export');

  // 2) the studio on the code
  await p.eval(`document.querySelector('.card[data-id="${pr.id}"]').click(); return 1`);
  await until(`location.port !== '${HUB_PORT}' && window.__studio && __studio.state().mode === 'code' && window.__preview?.durationInFrames > 1`, 120000);
  await until(`__studio.state().lanes.length >= 3`, 30000).catch(() => {}); await sleep(500);
  const st = await ev(`return __studio.state()`);
  check(st.size.join('×') === '1920×1080' && st.lanes.join('|') === 'Chapitres|Plans|Voix', `the code is the video: 1920×1080, tracks ${st.lanes.join(', ')}`);
  check(await ev(`return document.body.classList.contains('novideo') && /code en direct/.test(document.querySelector('#kindTag').textContent)`), 'header: « Atelier Coulisses · code en direct », no MP4 switch');
  // a pin on the title of plan s02 (frame 150), named by data-coulisses
  await p.eval(`document.querySelector('#v').currentTime = 0; __studio && 0; return 1`);
  await p.eval(`window.__preview.seek(150); return 1`); await sleep(900);
  const r = await ev(`const r = document.querySelector('#media').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]`);
  await p.key('c', 'KeyC', 'c'); await sleep(200);
  await p.mouse('mousePressed', r[0] + r[2] * 0.5, r[1] + r[3] * 0.5); await p.mouse('mouseReleased', r[0] + r[2] * 0.5, r[1] + r[3] * 0.5);
  await until(`document.querySelector('#pop').style.display === 'block'`, 10000); await sleep(1500);
  await p.type('Le titre arrive trop vite'); await p.key('Enter', 'Enter'); await sleep(800);
  await p.eval(`document.activeElement?.blur?.(); document.querySelector('button[data-tab=insp]').click(); return 1`); await sleep(500);
  const insp = await ev(`return document.querySelector('#insp').innerText`);
  check(/titre s02/.test(insp), 'the pin names what it points at (« titre s02 », from data-coulisses)');
  check(/Plans\s+plan s02 · Trois chiffres/.test(insp) && /image 60 du clip/.test(insp), 'Inspector: the clip of the project\'s timeline and its own frame');
  await p.shot(path.join(shots, 'coulisses-1-code.png'));
  // 3) send: a batch on the code
  await p.eval(`document.querySelector('button[data-tab=queue]').click(); return 1`); await sleep(300);
  await p.eval(`document.querySelector('#qsend').click(); return 1`);
  await until(`document.querySelector('#modal').style.display === 'flex'`, 120000);
  const REVUE = path.join(RUN, 'revue'), md = fs.readFileSync(path.join(REVUE, 'lots', '001.md'), 'utf8');
  check(/composition ESSAI-2026-10-07/.test(md) && /relit le CODE en direct/.test(md) && /aperçu vivant du CODE/.test(md), 'the request: the composition, reviewed from the code');
  check(/Objet 3D sous le geste : |titre s02/.test(md) && /Plans : plan s02 · Trois chiffres · src\/Video\.tsx, image 60 du clip/.test(md), 'it names the element and the clip (src/Video.tsx, image 60 of the clip)');
  // Sending publishes the receipt first. Wait for the same delivery the agent gets.
  const images = cli('images', REVUE, '1', '--timeout', '120');
  const lot = JSON.parse(fs.readFileSync(path.join(REVUE, 'lots', '001.json'), 'utf8'));
  const edit = lot.edits[0], image = edit.captures.image;
  // Plan s02 paints #14532d in this corner. Read pixels from the published JPEG.
  const rgb = execFileSync('ffmpeg', ['-v', 'error', '-i', image, '-vf', 'crop=2:2:20:20', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
  check(lot.captureState.status === 'ready' && images.includes(image) && edit.source === 'code' && edit.frame === 150
    && [20, 83, 45].every((v, i) => Math.abs(rgb[i] - v) <= 5), 'its delivered image shows the code at frame 150 (no MP4)');
  await p.eval(`document.querySelector('#mClose').click(); return 1`);
  // 4) the agent: the code's frame
  const fr = cli('frame', REVUE, '150');
  check(fs.existsSync(fr) && /claude-code-150/.test(fr), 'frame: from the code by default (no export yet)');
  // 5) an export arrives: loaded by itself, next to the code
  const before = await ev(`return __studio.state().video`);
  const mp4 = path.join(RUN, '07-renders', 'essai.mp4');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=10', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', mp4]);
  const t = (Date.now() - 40000) / 1000; fs.utimesSync(mp4, t, t);
  await until(`window.__studio && __studio.state().video && __studio.state().video !== ${JSON.stringify(before)}`, 40000);
  await until(`window.__studio && document.querySelector('#v').readyState >= 2`, 60000);
  check(!(await ev(`return document.body.classList.contains('novideo')`)) && (await ev(`return getComputedStyle(document.querySelector('#srcVideo')).display !== 'none'`)), 'the export arrived: reloaded, MP4 ⇄ code offered');
  await sleep(800); await p.shot(path.join(shots, 'coulisses-2-export.png'));
} catch (e) {
  ko++; console.log('  ✗ ERREUR', e.message);
  // Conserver l'état avant la fermeture : un délai dépassé ne dit pas si la
  // navigation, le démarrage du studio ou l'adoption du Player a échoué.
  const diagnostic = await ev(`return {
    url: location.href,
    studio: window.__studio?.state?.() ?? null,
    preview: window.__preview ? {durationInFrames: __preview.durationInFrames, frame: __preview.frame?.(), ready: __preview.frameReady?.()} : null,
    codeStatus: document.querySelector('#codeStatus')?.textContent ?? null,
    save: document.querySelector('#save')?.textContent ?? null,
    erreur: document.querySelector('#codeErr')?.textContent ?? null,
    accueil: [...document.querySelectorAll('.card .err')].map(e => e.textContent).filter(Boolean),
    iframes: [...document.querySelectorAll('#media iframe')].map(e => ({url: e.src, classe: e.className})),
    code: await fetch('/api/status').then(r => r.ok ? r.json() : null).then(s => s?.code ?? null).catch(() => null)
  }`);
  console.log('État au moment de l’échec :', JSON.stringify(diagnostic));
  console.log('Dernière sortie de l’accueil :\n' + hubOut.slice(-8000));
  if (p.logs.length) console.log('Derniers messages de la page :\n' + p.logs.slice(-15).join('\n'));
} finally {
  const errs = p.logs.filter((l) => /exception|\[error\]/.test(l) && !/WebGL|X4000|503|404|Failed to load resource/.test(l));
  if (errs.length) console.log('page errors:\n' + errs.slice(0, 6).join('\n'));
  await p.close();
  await post('/api/quit').catch(() => {}); await sleep(800); try { hub.kill(); } catch { /* gone */ }
  fs.rmSync(REG, { force: true });
  console.log(`\n${ok} ok, ${ko} échec(s)`);
  process.exit(ko ? 1 : 0);
}

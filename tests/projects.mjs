// Imported projects end to end, on FAKE projects generated in .cache\projects-test\ (nothing real is touched):
// an AItelier run (run.json, 02-script.md, 08-montage\plan-montage.json, an export in 07-renders\), a Short (9:16) and a
// single video (1280×720, 25 fps). Starts its own home screen (hub) with its own list of projects (STUDIO_PROJECTS),
// imports them through the API, opens the run's studio from the home screen, checks the montage tracks, a note → a batch
// whose request names the clips under it, Claude's commands with the project's path, a new export reloading the page,
// « Comparer avant / après », the Short's portrait frame, removing a project from the list, the Windows dialog.
// usage: node tests/projects.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';

process.env.COULISSES_LANG = 'fr';   // the suite checks the French texts (lib/i18n.mjs)
const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(STUDIO, '.cache', 'projects-test'), REG = path.join(FIX, 'projets.json');
const RUN = path.join(FIX, 'long', '2026-10-01_test-run'), SHORT = path.join(FIX, 'short', '2026-10-02_test-short'), VIDS = path.join(FIX, 'videos');
const SANDBOX_EP = path.join(STUDIO, 'sandbox', '07_Episodes', 'E03 - The Secret Garden');
const HUB_PORT = 4186, CLI = path.join(STUDIO, 'studio-cli.mjs'), shots = path.join(STUDIO, '.cache', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));   // COULISSES_TEST_SLOW=2: a slower PC
let ok = 0, ko = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };
const ff = (...a) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: 'inherit' }); if (r.status) throw new Error('ffmpeg ' + a.join(' ')); };
const old = (f, s = 90) => { const t = (Date.now() - s * 1000) / 1000; fs.utimesSync(f, t, t); };
const cli = (...a) => execFileSync(process.execPath, [CLI, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// ---- the fake projects ----
fs.rmSync(FIX, { recursive: true, force: true });
for (const d of [path.join(RUN, '07-renders'), path.join(RUN, '08-montage'), path.join(SHORT, '07-renders'), VIDS]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(RUN, 'run.json'), JSON.stringify({ slug: 'test-run', format: 'long', date: '2026-10-01' }));
fs.writeFileSync(path.join(RUN, '02-script.md'), '# 02-script — Run d\'essai du studio (v1, à valider)\n\nTexte.\n');
fs.writeFileSync(path.join(RUN, '08-montage', 'plan-montage.json'), JSON.stringify({
  fps: 30, total_images: 300,
  chapitres: [{ chapitre: 'acte0-hook', record_debut: 0 }, { chapitre: 'acte1-sujet', record_debut: 150 }],
  V1: [{ fichier: '07-rendus/s00-01.mp4', debut_media: 0, images: 150, record: 0, role: 'plan s00-01' }, { fichier: '07-rendus/s01-01-v2.mp4', debut_media: 12, images: 150, record: 150, role: 'plan s01-01' }],
  V2: [{ fichier: '06-metahuman/test-acte0-face.mp4', debut_media: 0, images: 150, record: 0, role: 'présentateur acte0', desactiver: false }, { fichier: '06-metahuman/test-acte1-face.mp4', debut_media: 0, images: 150, record: 150, role: 'présentateur acte1', desactiver: true }],
  A1: [{ fichier: '08-montage/voix.wav', debut_media: 0, images: 300, record: 0, role: 'voix du film' }],
}, null, 1));
const v1 = path.join(RUN, '07-renders', 'master-test-run-v1.mp4');
ff('-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', v1);
ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', '-ac', '1', path.join(RUN, '08-montage', 'voix.wav'));
fs.writeFileSync(path.join(SHORT, 'run.json'), JSON.stringify({ slug: 'test-short', format: 'short' }));
ff('-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(SHORT, '07-renders', 'master.mp4'));
ff('-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=25:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(VIDS, 'clip.mp4'));
for (const f of [v1, path.join(SHORT, '07-renders', 'master.mp4'), path.join(VIDS, 'clip.mp4')]) old(f);

// ---- its own home screen ----
const hub = spawn(process.execPath, [path.join(STUDIO, 'hub-server.mjs'), '--port', String(HUB_PORT)], { cwd: STUDIO, env: { ...process.env, STUDIO_PROJECTS: REG }, stdio: ['ignore', 'pipe', 'pipe'] });
let hubOut = ''; hub.stdout.on('data', (d) => { hubOut += d; }); hub.stderr.on('data', (d) => { hubOut += d; });
const H = `http://127.0.0.1:${HUB_PORT}`;
const post = async (u, b) => (await fetch(H + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) })).json();
for (let i = 0; i < 60 && !/HUB_READY/.test(hubOut); i++) await sleep(250);
const p = await launch({ port: 9345 });
const until = async (expr, ms = 30000) => { const t0 = Date.now(); for (;;) { try { if (await p.eval(`return !!(${expr})`)) return true; } catch { /* navigating */ } if (Date.now() - t0 > ms) throw new Error(`timeout: ${expr}`); await sleep(150); } };
const ev = (e) => p.eval(e).catch(() => null);
try {
  // 1) import through the API (the home screen's « coller un chemin » / the Windows dialog end there)
  const a = await post('/api/import', { path: RUN }), s = await post('/api/import', { path: SHORT }), v = await post('/api/import', { path: path.join(VIDS, 'clip.mp4') });
  check(a.ok && a.project.kind === 'aitelier' && a.project.title === 'Run d\'essai du studio', `the AItelier run is recognised (« ${a.project?.title} »)`);
  check(s.ok && s.project.kind === 'aitelier' && s.project.format === 'short' && v.ok && v.project.kind === 'video', 'the Short and the single video too');
  check(fs.existsSync(path.join(RUN, 'revue', 'projet.json')) && fs.existsSync(path.join(VIDS, 'revue', 'projet.json')), 'their notes go in the project, under revue\\ (projet.json)');
  const again = await post('/api/import', { path: path.join(RUN, 'revue') });
  const ep = await post('/api/import', { path: SANDBOX_EP }), bad = await post('/api/import', { path: path.join(FIX, 'nope') });
  const list = await (await fetch(H + '/api/episodes')).json();
  check(again.ok && list.projects.length === 3, 'importing the same project again does not duplicate it');
  check(!ep.ok && /épisode du Théâtre/.test(ep.why) && !bad.ok && /introuvable/.test(bad.why), `refused: a Brambleshire episode (« ${ep.why} »), a missing path`);
  let run = list.projects.find((x) => x.kind === 'aitelier' && x.format === 'long');
  // the duration is measured in the background (never inside the request): known at a next refresh of the list
  for (let i = 0; i < 40 && !run?.duration; i++) { await new Promise((r) => setTimeout(r, 250)); run = (await (await fetch(H + '/api/episodes')).json()).projects.find((x) => x.kind === 'aitelier' && x.format === 'long'); }
  check(run.video?.name === 'master-test-run-v1.mp4' && Math.abs(run.duration - 10) < 0.2, `the run's video is its export (${run.video?.name}, ${run.duration?.toFixed(1)} s)`);

  // 2) the home screen
  await p.goto(H + '/');
  await until(`document.querySelectorAll('#folders .card[data-id]').length >= 3 && document.querySelector('#pgrid .imp')`, 20000);
  await sleep(1500); await p.shot(path.join(shots, 'projects-1-home.png'));
  check(await ev(`return document.querySelector('.card[data-id="${run.id}"] .kind').textContent === 'AItelier · long'`), 'home screen: « Projets importés », the run with « AItelier · long », and « Importer un projet »');

  // 3) open the run's studio from the home screen
  await p.eval(`document.querySelector('.card[data-id="${run.id}"]').click(); return 1`);
  await until(`location.port !== '${HUB_PORT}' && window.__studio && document.querySelector('#v').readyState >= 2`, 90000);
  const st = await ev(`return __studio.state()`);
  check(st.proj && st.size[0] === 1920 && st.lanes.join('|') === 'Chapitres|V1 plans|V2 présentateur|A1 voix|Son', `studio: the montage tracks (${st.lanes.join(', ')})`);
  check(await ev(`return !document.querySelector('#bStage').classList.contains('off') && document.querySelector('#bSrc').classList.contains('off') && document.querySelector('#kindTag').textContent.includes('AItelier')`), 'video-only project: Scene can request adaptation while switching to live code is unavailable');
  await p.eval(`document.querySelector('#v').currentTime = 200.5 / 30; return 1`); await sleep(800);
  await p.eval(`document.querySelector('button[data-tab=queue]').click(); return 1`); await sleep(300);
  await p.key('n', 'KeyN', 'n'); await sleep(300);
  await p.type('Le plan s01-01 arrive trop tôt'); await sleep(700);
  await p.eval(`document.activeElement.blur(); document.querySelector('button[data-tab=insp]').click(); return 1`); await sleep(400);
  check(/s01-01-v2\.mp4/.test(await ev(`return document.querySelector('#insp').innerText`)) && /image 62 du clip/.test(await ev(`return document.querySelector('#insp').innerText`)), 'Inspector: the clip under the playhead and its own frame (image 62 du clip)');
  await sleep(1200); await p.shot(path.join(shots, 'projects-2-studio.png'));
  await p.eval(`document.querySelector('button[data-tab=queue]').click(); document.querySelector('#qsend').click(); return 1`);
  await until(`document.querySelector('#modal').style.display === 'flex'`, 60000);
  const line = await ev(`return document.querySelector('#mLine').textContent`);
  check(/^Coulisses · Run d'essai du studio · lot 1/.test(line), `the line to paste names the project (${line.slice(0, 52)}…)`);
  const REVUE = path.join(RUN, 'revue'), md = fs.readFileSync(path.join(REVUE, 'lots', '001.md'), 'utf8');
  check(/Dans le montage, sous la note/.test(md) && /V1 plans : plan s01-01 · 07-rendus\/s01-01-v2\.mp4, image 62 du clip/.test(md) && /V2 présentateur : présentateur acte1 .*\(désactivé\)/.test(md), 'the request lists the clips under the note, with the clip\'s own frame');
  check(/Ne jamais exporter/.test(md) && md.includes(`take "${REVUE}" 1`) && !/composition|06_Remotion/.test(md), 'and the AItelier rules, the commands with the project\'s path, nothing of Remotion');
  await p.eval(`document.querySelector('#mClose').click(); return 1`);

  // 4) Claude's side, with the project's path
  cli('take', REVUE, '1');
  const shot = cli('frame', REVUE, '200');
  check(fs.existsSync(shot) && /claude-video-200/.test(shot), 'frame: an image of the reviewed video (no code)');
  check(/1 fichier/.test(cli('snapshot', REVUE, '1', '08-montage/plan-montage.json')), 'snapshot: a file of the project, relative to its folder');
  const id = JSON.parse(fs.readFileSync(path.join(REVUE, 'lots', '001.json'), 'utf8')).edits[0].id;
  cli('reply', REVUE, id, 'Plan s01-01 décalé de 6 images', '--status', 'done', '--image', shot); cli('done', REVUE, '1', 'plan décalé');
  let render = '';
  try { cli('render', REVUE); } catch (e) { render = String(e.stderr); }
  check(/ne se rend pas depuis le studio/.test(render), 'render: refused (the user exports from Resolve)');

  // 5) a new export: the page loads it by itself; « Comparer avant / après »
  const before = await ev(`return __studio.state().video`);
  const v2 = path.join(RUN, '07-renders', 'master-test-run-v2.mp4');
  ff('-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=10', '-vf', 'hue=h=140', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', v2);
  old(v2, 30);
  await until(`window.__studio && __studio.state().video && __studio.state().video !== ${before}`, 40000);
  check(true, 'a new export in 07-renders: the page reloads it by itself');
  await until(`window.__studio && document.querySelector('#v').readyState >= 2`, 60000);
  await p.eval(`document.querySelector('button[data-tab=lots]').click(); return 1`);
  await until(`document.querySelector('#rcCmp')`, 15000);
  check(/master-test-run-v2\.mp4/.test(await ev(`return document.querySelector('#renderCard').innerText`)) && await ev(`return document.querySelector('#rcGo')?.disabled === true`), '« Envois »: the reviewed export; « Lancer le rendu » there but greyed (the pipeline exports it), as in every project');
  await p.eval(`document.querySelector('#rcCmp').click(); return 1`);
  await until(`__studio.state().cmp && document.querySelector('#cmpA').naturalWidth > 0 && document.querySelector('#cmpB').naturalWidth > 0`, 30000);
  check(/Avant · export du/.test(await ev(`return document.querySelector('#cmpLA').textContent`)) && /nouvel export/.test(await ev(`return document.querySelector('#cmpLB').textContent`)), 'Comparer avant / après: the old export against the new one');
  await sleep(500); await p.shot(path.join(shots, 'projects-3-compare.png'));
  await p.key('Escape', 'Escape');

  // 6) the Short: a portrait frame
  await p.goto(`${H}/go/${s.project.id}`);
  await until(`location.port !== '${HUB_PORT}' && window.__studio && document.querySelector('#v').readyState >= 2`, 90000);
  const sz = await ev(`const v = document.querySelector('#v'); return [__studio.state().size, parseFloat(v.style.width), parseFloat(v.style.height)]`);
  check(sz[0][0] === 1080 && sz[0][1] === 1920 && sz[2] > sz[1] * 1.5, `the Short: 1080×1920, shown upright (${Math.round(sz[1])}×${Math.round(sz[2])} px)`);
  await sleep(800); await p.shot(path.join(shots, 'projects-4-short.png'));

  // 7) remove from the list: nothing is deleted
  const rm = await post(`/api/remove?ep=${v.project.id}`);
  const list2 = await (await fetch(H + '/api/episodes')).json();
  check(rm.ok && list2.projects.length === 2 && fs.existsSync(path.join(VIDS, 'revue', 'projet.json')) && fs.existsSync(path.join(VIDS, 'clip.mp4')), 'Retirer: gone from the list, its files untouched');

  // 8) the Windows dialog of the app (created, not shown)
  const out = path.join(FIX, 'pick.txt');
  const r = spawnSync(path.join(STUDIO, 'Coulisses.exe'), ['--pick', 'check', out], { timeout: 20000 });
  check(r.status === 0 && fs.readFileSync(out, 'utf8') === 'ok', 'Coulisses.exe --pick: the Windows dialog is available');
} catch (e) { ko++; console.log('  ✗ ERREUR', e.message); } finally {
  const errs = p.logs.filter((l) => /exception|\[error\]/.test(l) && !/WebGL|X4000|503|Failed to load resource/.test(l));
  if (errs.length) console.log('page errors:\n' + errs.slice(0, 5).join('\n'));
  await p.close();
  await post('/api/quit').catch(() => {}); await sleep(800); try { hub.kill(); } catch { /* gone */ }
  console.log(`\n${ok} ok, ${ko} échec(s)`);
  process.exit(ko ? 1 : 0);
}

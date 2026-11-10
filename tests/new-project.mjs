// « Nouveau projet » and the Agent tab (user request, 08/10/2026: « créer un projet depuis zéro qu'on crée en temps réel en
// promptant l'agent ; le viewer est une scène 3D, fond noir avec le quadrillage qui montre le point 0 »), with a stand-in
// for npm (tests/fake-npm.mjs: node_modules = a junction to the Brambleshire project's modules; nothing is downloaded):
//   1. the home screen: the shared modules missing -> asked, installed once; the project created, imported, in its folder;
//   2. the project: a .coulisses (its own folder, « . »), an empty 3D scene, the guide of the agent, an export script;
//      « projet verifier » says PROJET CONFORME;
//   3. the studio: opens on the Agent tab; a black scene with the floor grid and the axes (editor aids); a request typed
//      there becomes a batch at once (the paste line when no agent watches); the agent's answer shows in the tab; a change
//      of the scene's code shows in the preview by itself.
// usage: node tests/new-project.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCR = path.join(STUDIO, '.cache', 'new-project-test'), ROOT = path.join(SCR, 'Projets');
// junctions first (never followed by a recursive delete), then the folder
const unjunction = () => { if (!fs.existsSync(ROOT)) return; for (const d of fs.readdirSync(ROOT)) { const nm = path.join(ROOT, d, 'node_modules'); try { if (fs.lstatSync(nm).isSymbolicLink()) fs.rmSync(nm); } catch { /* none */ } } try { if (fs.lstatSync(path.join(ROOT, 'node_modules')).isSymbolicLink()) fs.rmSync(path.join(ROOT, 'node_modules')); } catch { /* none */ } };
unjunction(); fs.rmSync(SCR, { recursive: true, force: true }); fs.mkdirSync(SCR, { recursive: true });
process.env.COULISSES_LANG = 'fr';
process.env.STUDIO_PROJECTS = path.join(SCR, 'projets.json');
process.env.COULISSES_SETTINGS = path.join(SCR, 'settings.json');
process.env.COULISSES_MEDIAS = path.join(SCR, 'medias');
process.env.COULISSES_PROJECTS_ROOT = ROOT;
process.env.COULISSES_NPM = path.join(STUDIO, 'tests', 'fake-npm.mjs');
const PORT = 4201, H = `http://127.0.0.1:${PORT}`, CLI = path.join(STUDIO, 'studio-cli.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));   // COULISSES_TEST_SLOW=2: a slower PC
let ok = 0, ko = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };
const get = async (u) => (await fetch(H + u, { cache: 'no-store' })).json();
const post = async (u, b = {}) => (await fetch(H + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
const cli = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8', env: process.env });
let hub = null, p = null;
try {
  hub = spawn(process.execPath, [path.join(STUDIO, 'hub-server.mjs'), '--port', String(PORT)], { cwd: STUDIO, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; hub.stdout.on('data', (d) => { out += d; }); hub.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 80 && !/HUB_READY/.test(out); i++) await sleep(250);

  // ---------- 1. the home screen ----------
  console.log('l\'accueil');
  let info = await get('/api/new');
  check(!info.workspace.ready && info.workspace.root === ROOT && info.formats.join() === '16:9,9:16,1:1', 'the shared modules are not there yet; three formats');
  let r = await post('/api/new', { nom: 'La planète bleue', chaine: 'Essais', format: '9:16', duree: 6 });
  check(!r.ok && r.needInstall && r.root === ROOT, 'creating asks for the modules first (nothing installed without the user)');
  r = await post('/api/new/install');
  let st; for (let i = 0; i < 60; i++) { await sleep(300); st = await get('/api/new/install'); if (st.state !== 'running') break; }
  check(st.state === 'done' && st.log.some((l) => /added/.test(l)) && fs.existsSync(path.join(ROOT, 'package.json')) && fs.existsSync(path.join(ROOT, 'LISEZMOI.txt')), `the modules installed once (${st.log.at(-1)})`);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  check(pkg.dependencies.remotion === '4.0.533' && pkg.dependencies['@react-three/fiber'] === '9.3.0' && pkg.dependencies['@remotion/three'], 'the versions Coulisses is tested with');
  r = await post('/api/new', { nom: 'La planète bleue', chaine: 'Essais', format: '9:16', duree: 6 });
  check(r.ok && r.id && fs.existsSync(r.file), `the project is created (${r.file})`);
  const list = await get('/api/episodes'), pr = list.projects.find((x) => x.id === r.id);
  check(pr?.folder === 'Essais' && pr.kind === 'remotion' && pr.title === 'La planète bleue', 'imported, in its folder (its channel)');

  // ---------- 2. the project ----------
  console.log('le projet');
  const DIR = path.dirname(r.file), c = JSON.parse(fs.readFileSync(r.file, 'utf8'));
  check(c.remotion.projet === '.' && c.remotion.composition === 'SCENE' && c.origine === 'coulisses' && c.export?.dossier === 'out' && c.format === '9:16', 'its .coulisses: its own folder, the composition, the export folder');
  check(fs.lstatSync(path.join(DIR, 'node_modules')).isSymbolicLink(), 'node_modules: a junction to the shared modules');
  const scene = fs.readFileSync(path.join(DIR, 'src', 'Scene.tsx'), 'utf8'), editor = fs.readFileSync(path.join(DIR, 'src', 'editor.tsx'), 'utf8');
  check(/ThreeCanvas/.test(scene) && /<EditorAids \/>/.test(scene) && /gridHelper/.test(editor) && /axesHelper/.test(editor) && /isPlayer/.test(editor) && /width: 1080, height: 1920, duree: 6/.test(fs.readFileSync(path.join(DIR, 'src', 'projet.ts'), 'utf8')),
    'an empty 3D scene; the grid and the axes for the editor only; 1080 × 1920, 6 s');
  check(/La planète bleue — un projet créé dans Coulisses/.test(fs.readFileSync(path.join(DIR, 'CLAUDE.md'), 'utf8')) && fs.existsSync(path.join(DIR, 'AGENTS.md')), 'the guide of the agent (CLAUDE.md, AGENTS.md)');
  const opts = spawnSync(process.execPath, [path.join(DIR, 'scripts', 'coulisses-rendu.mjs'), '--options'], { cwd: DIR, encoding: 'utf8' });
  check(JSON.parse(opts.stdout).some(o=>o.id==='final' && o.scope==='full') && JSON.parse(opts.stdout).some(o=>o.id==='test' && o.scope==='excerpt' && /2 s/.test(o.label)), 'its export script distinguishes full film and two-second excerpt');
  const v = cli('projet', 'verifier', r.file, '--rapide');
  check(/PROJET CONFORME/.test(v.stdout), `projet verifier: ${(/PROJET (NON )?CONFORME[^\n]*/.exec(v.stdout) ?? [v.stdout.slice(-200)])[0]}`);

  // ---------- 3. the studio ----------
  console.log('le studio');
  p = await launch({ port: 9382 });
  await p.goto(`${H}/go/${r.id}`);
  await p.until(`location.port !== '${PORT}' && window.__studio && window.__preview?.durationInFrames > 1`, 120000);
  await sleep(2500);
  const s0 = await p.eval(`const sp = window.__preview; return { tab: __studio.state().tab, intro: document.querySelector('#agentList').innerText, d: sp.durationInFrames, w: sp.width, h: sp.height }`);
  check(s0.tab === 'agent' && /Ta scène est vide/.test(s0.intro), 'the studio opens on the Agent tab: « Ta scène est vide… »');
  check(s0.d === 180 && s0.w === 1080 && s0.h === 1920, `the scene plays live (${s0.d} frames, ${s0.w}×${s0.h})`);
  // (asked again when the preview was rebuilt meanwhile: a call on the version before ends « preview gone »)
  let objs = []; for (let i = 0; i < 20; i++) { try { objs = await p.eval(`return (await window.__preview.objects()).map((o) => o.type)`); break; } catch { await sleep(500); } }
  check(objs.includes('GridHelper') && objs.includes('AxesHelper') && objs.includes('DirectionalLight'), `a black 3D scene with the floor grid and the axes at the origin (${[...new Set(objs)].join(', ')})`);
  await p.key('m', 'KeyM', 'm'); await p.until(`__studio.state().staging`, 30000); await sleep(800);
  check(await p.eval(`return window.__preview.stage.kind`) === '3d', 'M: the 3D staging (a free camera to look around the scene)');
  await p.key('m', 'KeyM', 'm'); await sleep(400);
  await p.eval(`document.querySelector('button[data-tab="agent"]').click(); return 1`); await sleep(300);
  await p.shot(path.join(SCR, 'new-project-empty.png'));
  // a request: a batch at once
  await p.eval(`const ta = document.querySelector('#agentText'); ta.value = 'Une planète bleue au centre, qui tourne lentement'; document.querySelector('#agentSend').click(); return 1`);
  const revue = pr.revue, lot1 = path.join(revue, 'lots', '001.md');
  for (let i = 0; i < 120 && !fs.existsSync(lot1); i++) await sleep(250);
  await sleep(800);
  const md = fs.existsSync(lot1) ? fs.readFileSync(lot1, 'utf8') : '';
  check(/Demande 1 .* le projet se construit en direct/.test(md) && /Une planète bleue au centre/.test(md) && md.includes(path.join(DIR, 'CLAUDE.md')), 'a request typed in the Agent tab is a batch at once, with the project\'s guide');
  check(await p.eval(`return document.querySelector('#modal')?.style.display === 'flex' && /lot 1/i.test(document.querySelector('#modal').innerText)`), 'no agent watching: the line to paste is shown');
  await p.eval(`document.querySelector('#mClose')?.click(); return 1`);
  const notes = JSON.parse(fs.readFileSync(path.join(revue, 'notes.json'), 'utf8')).notes;
  const n = notes.find((x) => x.kind === 'prompt');
  check(n && !n.draft && n.lot === 1, 'the request is kept as a note of kind « prompt », sent in batch 1');
  check(await p.eval(`return !document.querySelector('#draftList').innerText.includes('planète') && !document.querySelector('#list').innerText.includes('planète')`), 'it lives in the Agent tab, not in Modifs nor Notes');
  // the agent: takes the batch, writes the scene, answers
  cli('take', revue, '1');
  fs.writeFileSync(path.join(DIR, 'src', 'Scene.tsx'), fs.readFileSync(path.join(DIR, 'src', 'Scene.tsx'), 'utf8').replace(`{/* la scène : vide pour l'instant */}`,
    `<mesh name="planete" position={[0, 1.2, 0]} rotation={[0, frame * 0.01, 0]}><sphereGeometry args={[1, 48, 32]} /><meshStandardMaterial color="#3b7bff" /></mesh>`).replace('void frame;', ''));
  cli('reply', revue, n.id, "J'ai posé une planète bleue au centre, qui tourne lentement.", '--status', 'done');
  cli('done', revue, '1', 'Planète bleue au centre.');
  await p.until(`/J'ai posé une planète bleue/.test(document.querySelector('#agentList').innerText)`, 20000);
  check(/fait/.test(await p.eval(`return document.querySelector('#agentList').innerText`)), 'the agent\'s answer shows in the Agent tab, the request « fait »');
  await p.until(`(document.querySelector('#codeStatus').textContent || '').includes('v2')`, 60000).catch(() => {});
  await sleep(2500);
  let names = []; for (let i = 0; i < 40 && !names.includes('planete'); i++) { await sleep(500); names = await p.eval(`return (await window.__preview?.objects?.())?.map((o) => o.name) ?? []`).catch(() => []); }
  check(names.includes('planete'), 'the scene code changed: the preview rebuilt by itself, the planet is in the 3D scene');
  await p.shot(path.join(SCR, 'new-project-planet.png'));
} catch (e) {
  check(false, `erreur : ${e.stack ?? e.message}`);
} finally {
  if (p) await p.close();
  if (hub) { try { execFileSync('taskkill', ['/PID', String(hub.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
}
console.log(`\n${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);

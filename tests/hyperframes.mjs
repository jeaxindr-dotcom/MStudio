// HyperFrames, a second engine of Coulisses (user request, 09/10/2026: « une compatibilité HyperFrames au studio : dans la
// liste des projets, Remotion ou HyperFrames à côté des projets ; au nouveau projet, le choix ; dans l'accueil, un bouton
// pour les mises à jour de Remotion et de HyperFrames »), on the user's own HyperFrames CLI (npx's cache; nothing is
// installed nor shipped) and projects made here (.cache\hyperframes-test):
//   1. « Nouveau projet » › HyperFrames: « hyperframes init », the asked length and title, the guide of the agent, its
//      .coulisses (moteur hyperframes, its own folder, renders\); nothing to install;
//   2. the home screen: « HyperFrames » next to its title, « Remotion » next to a Remotion run's;
//   3. the studio: the composition played live (its size, its length), seek / play, a pin names the element (#title),
//      the timeline from « hyperframes timeline », the 2D staging; a note sent: its batch says « Projet HyperFrames »;
//      « frame --source code » (hyperframes snapshot); a change of the composition reloads the preview;
//   4. « Exporter » (a quick draft): « hyperframes render » through lib/hf-render-run.mjs, the file in renders\, then
//      reviewed by the studio;
//   5. « Mises à jour »: Remotion and HyperFrames, their versions and their skills; an update runs only on a click (a
//      stand-in program is given the command: npx skills update -g -y <names>).
// Skipped when HyperFrames is not on this PC.   usage: node tests/hyperframes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, requireSandbox } from './cdp.mjs';
import { freePort } from './where.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { hfInstalls } = await import('../lib/hyperframes.mjs');
if (!hfInstalls().length) { console.log("  (sauté : HyperFrames n'est pas sur ce PC — « npx hyperframes --version » une fois)\n\n0 ok, 0 ko"); process.exit(0); }
const SCR = path.join(STUDIO, '.cache', 'hyperframes-test'), ROOT = path.join(SCR, 'Projets');
fs.rmSync(SCR, { recursive: true, force: true }); fs.mkdirSync(SCR, { recursive: true });
process.env.COULISSES_LANG = 'fr';
process.env.STUDIO_PROJECTS = path.join(SCR, 'projets.json');
process.env.COULISSES_SETTINGS = path.join(SCR, 'settings.json');
process.env.COULISSES_MEDIAS = path.join(SCR, 'medias');
process.env.COULISSES_PROJECTS_ROOT = ROOT;
const FAKE = path.join(SCR, 'fake-update.mjs'), FAKE_LOG = path.join(SCR, 'fake-update.log');
fs.writeFileSync(FAKE, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(FAKE_LOG)}, process.argv.slice(2).join(' ')); console.log('updated');\n`);
process.env.COULISSES_UPDATE_CMD = FAKE;
fs.writeFileSync(process.env.COULISSES_SETTINGS, JSON.stringify({ mediasAutoSort: false }));
const PORT = await freePort(4202), H = `http://127.0.0.1:${PORT}`, CLI = path.join(STUDIO, 'studio-cli.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));
let ok = 0, ko = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };
const get = async (u, base = H) => (await fetch(base + u, { cache: 'no-store' })).json();
const post = async (u, b = {}, base = H) => (await fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
const cli = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8', env: process.env, timeout: 300000 });
const probe = (f) => { try { const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', f], { encoding: 'utf8' })); return { w: j.streams[0]?.width, h: j.streams[0]?.height, d: +j.format.duration }; } catch { return null; } };
let hub = null, p = null;
try {
  // a Remotion run next to it (the sample project of tests/coulisses-fixture.mjs), for the « Remotion » tag
  const { makeFixture } = await import('./coulisses-fixture.mjs');
  const { importProject } = await import('../lib/projects.mjs');
  const rem = importProject(makeFixture());
  hub = spawn(process.execPath, [path.join(STUDIO, 'hub-server.mjs'), '--port', String(PORT)], { cwd: STUDIO, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; hub.stdout.on('data', (d) => { out += d; }); hub.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 80 && !/HUB_READY/.test(out); i++) await sleep(250);
  if (!/HUB_READY/.test(out)) throw new Error('Le hub de test n’a pas démarré : ' + out.slice(-400));

  // ---------- 1. « Nouveau projet » › HyperFrames ----------
  console.log('nouveau projet HyperFrames');
  const info = await get('/api/new');
  check(!!info.hf && !info.workspace.ready, `HyperFrames ${info.hf} is offered, though Remotion's shared modules are not installed`);
  const r = await post('/api/new', { nom: 'Le titre qui monte', chaine: 'Essais HF', format: '16:9', duree: 4, engine: 'hyperframes' });
  check(r.ok && r.id && fs.existsSync(r.file), `created, nothing to install (${r.file})`);
  const DIR = path.dirname(r.file), c = JSON.parse(fs.readFileSync(r.file, 'utf8'));
  check(c.moteur === 'hyperframes' && c.hyperframes?.projet === '.' && c.hyperframes.index === 'index.html' && c.export?.dossier === 'renders' && c.origine === 'coulisses', 'its .coulisses: moteur hyperframes, its own folder, renders\\');
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  check(/data-composition-id="main"/.test(html) && /data-duration="4"/.test(html) && /Le titre qui monte<\/h1>/.test(html) && fs.existsSync(path.join(DIR, 'hyperframes.json')), 'hyperframes init: a blank composition, 4 s, its title');
  const guide = fs.readFileSync(path.join(DIR, 'CLAUDE.md'), 'utf8');
  check(/Le titre qui monte — un projet HyperFrames créé dans Coulisses/.test(guide) && /HyperFrames Composition Project/.test(guide) && fs.existsSync(path.join(DIR, 'AGENTS.md')), "the agent's guide: Coulisses' part, then HyperFrames' own");

  // ---------- 2. the home screen: the engine next to the title ----------
  console.log("l'accueil");
  const list = await get('/api/episodes'), hp = list.projects.find((x) => x.id === r.id), rp = list.projects.find((x) => x.id === rem.id);
  check(hp?.engine === 'hyperframes' && hp.kind === 'hyperframes' && rp?.engine === 'remotion', 'the list knows the engine of each project');
  p = await launch({ port: await freePort(9462) });
  await p.goto(H + '/');
  await p.until(`document.querySelector('.card[data-id="${r.id}"] .eng')`, 30000);
  const tags = await p.eval(`const t = (id) => document.querySelector('.card[data-id="' + id + '"] .eng')?.textContent ?? ''; return [t(${JSON.stringify(r.id)}), t(${JSON.stringify(rem.id)})]`);
  check(tags[0] === 'HyperFrames' && tags[1] === 'Remotion', `« ${tags[0]} » and « ${tags[1]} » next to the titles`);
  // the New project window: the choice
  await p.eval(`document.querySelector('#newBtn').click(); return 1`); await sleep(800);
  const eng = await p.eval(`return [...document.querySelectorAll('#npEng button')].map((b) => b.textContent + (b.disabled ? ' (off)' : ''))`);
  check(eng.join('|') === 'Remotion|HyperFrames', `« Nouveau projet »: the choice ${eng.join(' / ')}`);
  await p.eval(`document.querySelector('#npEng button[data-e=hyperframes]').click(); return 1`); await sleep(200);
  check(/composition HTML vide/.test(await p.eval(`return document.querySelector('#npIntro').textContent`)), 'HyperFrames chosen: the window says what it makes');
  await p.shot(path.join(SCR, 'hf-new.png'));
  await p.key('Escape', 'Escape'); await sleep(300);

  // ---------- 3. the studio ----------
  console.log('le studio');
  await p.goto(`${H}/go/${r.id}`);
  await p.until(`location.port !== '${PORT}' && window.__studio && window.__preview?.ok`, 120000);
  await sleep(2500);
  const U = await p.eval(`return location.origin`);
  await requireSandbox(U, SCR);
  const m = await get('/api/meta', U);
  check(m.kind === 'hyperframes' && m.engine === 'hyperframes' && m.features.code && m.features.export && m.size.join('x') === '1920x1080' && m.fps === 30, `the studio: HyperFrames ${m.hfVersion}, 1920×1080 at 30 fps, live code, export`);
  const sp = `window.__preview`;
  const pl = await p.eval(`const s = ${sp}; return { d: s.durationInFrames, w: s.width, h: s.height, hf: !!s.hyperframes }`);
  check(pl.d === 120 && pl.w === 1920 && pl.h === 1080 && pl.hf, `the composition, live: ${pl.d} frames (4 s)`);
  await p.eval(`${sp}.seek(60); return 1`); await sleep(800);
  check(await p.eval(`return ${sp}.frame()`) === 60 && (await p.eval(`return __studio.state().frame`)) === 60, 'seek: frame 60 in the preview and in the studio');
  const hits = await p.eval(`return (await ${sp}.pick(60, 960, 540)).map((h) => h.names[0])`);
  check(hits[0] === '#title', `a pin on the title names it (${hits.join(', ')})`);
  await p.eval(`document.querySelector('#bPlay').click(); return 1`); await sleep(1200);
  const f2 = await p.eval(`return __studio.state().frame`);
  await p.eval(`document.querySelector('#bPlay').click(); return 1`);
  check(f2 > 60, `play: the frame runs (${f2})`);
  const tl = await get('/api/timeline', U);
  check(tl.status === 'ready' && tl.data.tracks.some((t) => t.clips.some((x) => x.label === 'title' && x.t0 === 0 && Math.abs(x.t1 - 4) < 0.05)), `the timeline from « hyperframes timeline »: ${tl.data?.tracks?.map((t) => t.name).join(' · ')}`);
  // A flat HTML composition can keep its own editable stage or request a Remotion version.
  await p.key('m', 'KeyM', 'm');
  await p.until(`document.querySelector('#sceneRequestKeep') && document.querySelector('#sceneRequestSend')`, 30000);
  check(await p.eval(`return !__studio.state().staging && /composition Remotion/.test(document.querySelector('#scene').innerText) && /HyperFrames original/.test(document.querySelector('#scene').innerText)`),
    'HTML plat : la proposition nomme la nouvelle composition Remotion et conserve l’original HyperFrames');
  await p.eval(`document.querySelector('#sceneRequestKeep').click(); return 1`);
  await p.until(`__studio.state().staging && ${sp}.stage.kind === '2d'`, 30000);
  const activeFrame = await p.eval(`return document.querySelector('#code').src`);
  const origin = await p.eval(`const rect = document.querySelector('#code').getBoundingClientRect(); return [rect.left, rect.top]`);
  const title = await p.frameEval(activeFrame, `const rect = document.querySelector('#title').getBoundingClientRect(); return [rect.left + rect.width / 2, rect.top + rect.height / 2]`);
  await p.mouse('mousePressed', origin[0] + title[0], origin[1] + title[1]);
  await p.mouse('mouseReleased', origin[0] + title[0], origin[1] + title[1]);
  await p.until(`!!__studio.state().stage`, 5000);
  // The bridge publishes the selected delta before the next paint of the isolated Player.
  // Measure the title in composition pixels so the viewer's fit/layout scale cannot change the oracle.
  const titleX = `const fit = document.querySelector('#coulisses-fit'), bounds = fit.getBoundingClientRect();
    return (document.querySelector('#title').getBoundingClientRect().left - bounds.left) * fit.offsetWidth / bounds.width`;
  const before = await p.frameEval(activeFrame, titleX);
  await p.key('ArrowRight', 'ArrowRight');
  await p.until(`${sp}.stage.info(__studio.state().stage).delta.p[0] === 1`, 5000);
  let dx = 0;
  for (let i = 0; i < 60 && Math.abs(dx - 1) > 0.08; i++) {
    await sleep(50);
    dx = (await p.frameEval(activeFrame, titleX)) - before;
  }
  const lotsAfterDecline = (await get('/api/status', U)).lots.length;
  check(lotsAfterDecline === 0 && Math.abs(dx - 1) <= 0.08,
    `Rester en 2D déplace le titre dans le lecteur HTML (Δx ${dx.toFixed(3)} px) et conserve ${lotsAfterDecline} lot`);
  await p.key('m', 'KeyM', 'm'); await sleep(400);
  // a note, sent: the batch is a HyperFrames one
  await p.eval(`document.querySelector('#ltabs button[data-tab=queue]').click(); return 1`);
  await p.key('n', 'KeyN', 'n'); await sleep(500); await p.type('Le titre doit monter plus lentement'); await p.key('Enter', 'Enter', '\r'); await sleep(500);
  await p.eval(`document.querySelector('#qsend').click(); return 1`);
  await p.until(`document.querySelector('#modal').style.display === 'flex'`, 60000);
  const md = fs.readFileSync(path.join(DIR, 'revue', 'lots', '001.md'), 'utf8');
  check(/Projet HyperFrames/.test(md) && /Le titre doit monter plus lentement/.test(md) && /--source code/.test(md), 'the batch: « Projet HyperFrames », the request, the code to look at');
  await p.eval(`document.querySelector('#mClose').click(); return 1`);
  // the agent's eyes: a frame of the code
  const fr = cli('frame', r.file.replace(/[^\\/]+$/, 'revue'), '30', '--source', 'code');
  const img = fr.stdout.trim().split('\n').pop();
  check(fr.status === 0 && fs.existsSync(img) && probe(img)?.w === 1920, `frame --source code: hyperframes snapshot (${path.basename(img ?? '')})`);
  // a change of the composition: the preview reloads by itself
  const v0 = await p.eval(`return document.querySelector('#codeStatus').textContent`);
  fs.writeFileSync(path.join(DIR, 'index.html'), fs.readFileSync(path.join(DIR, 'index.html'), 'utf8').split('Le titre qui monte</h1>').join('Le titre a changé</h1>'));
  await p.until(`document.querySelector('#codeStatus').textContent !== ${JSON.stringify(v0)}`, 30000).catch(() => {});
  for (let i = 0; i < 60 && !/Le titre a changé/.test(await p.frameEval('player.html', `return document.body?.innerText ?? ''`) ?? ''); i++) await sleep(500);   // (the preview: its own process)
  check(/Le titre a changé/.test(await p.frameEval('player.html', `return document.body?.innerText ?? ''`) ?? ''), 'a change of index.html: the preview shows it by itself');
  await p.shot(path.join(SCR, 'hf-studio.png'));

  // ---------- 4. « Lancer le rendu » in 1080p (the same two qualities as every project: 1080p, 4K) ----------
  console.log("l'export");
  const ex = await post('/api/export', { qualite: '1080p' }, U);
  let X = null; for (let i = 0; i < 240; i++) { await sleep(1000); X = (await get('/api/status', U)).export; if (X && X.state !== 'running') break; }
  const fin = X?.file && fs.existsSync(X.file) ? X.file : null, pv = fin ? probe(fin) : null;
  check(ex.ok && X?.state === 'done' && fin && path.dirname(fin) === path.join(DIR, 'renders') && pv?.w === 1920 && Math.abs(pv.d - 4) < 0.3, `hyperframes render (1080p): ${fin ? path.basename(fin) : X?.state} · ${pv?.w}×${pv?.h} · ${pv?.d?.toFixed(2)} s`);
  check(fs.readdirSync(path.join(DIR, 'renders')).every((f) => !/\.tmp\./.test(f)), 'no .tmp file left');

  // ---------- 5. « Mises à jour » ----------
  console.log('les mises à jour');
  const up = await get('/api/home-updates');
  check(up.remotion && up.hyperframes && 'latest' in up.remotion && up.hyperframes.installed && Array.isArray(up.remotion.skills.updates) && Array.isArray(up.hyperframes.skills.updates) && Number.isInteger(up.count),
    `Remotion (latest ${up.remotion.latest ?? '?'}, ${up.remotion.skills.installed} skills) and HyperFrames (${up.hyperframes.installed} here, latest ${up.hyperframes.latest ?? '?'}, ${up.hyperframes.skills.installed} skills): ${up.count} to update`);
  const ru = await post('/api/home-updates/run', { what: 'skills-hyperframes', names: ['hyperframes-cli', 'media-use'] });
  let J = null; for (let i = 0; i < 40; i++) { await sleep(250); J = await get('/api/home-updates/job'); if (J.state !== 'running') break; }
  check(ru.ok && J.state === 'done' && fs.readFileSync(FAKE_LOG, 'utf8') === 'npx --yes skills update -g -y hyperframes-cli media-use', 'an update runs only on a click: npx skills update -g -y <names>');
  const bad = await post('/api/home-updates/run', { what: 'skills-remotion', names: ['a; del *'] });
  check(!bad.ok, 'a name that is not a skill\'s is refused');
  await p.goto(H + '/'); await sleep(1500);
  await p.eval(`document.querySelector('#updBtn').click(); return 1`);
  await p.until(`/Remotion/.test(document.querySelector('.upd')?.innerText ?? '') && /HyperFrames/.test(document.querySelector('.upd')?.innerText ?? '')`, 30000);
  check(/Skills remotion-dev\/skills/.test(await p.eval(`return document.querySelector('.upd').innerText`)) && /Outil HyperFrames sur ce PC/.test(await p.eval(`return document.querySelector('.upd').innerText`)), 'the window: Remotion and HyperFrames, their versions and their skills');
  await p.shot(path.join(SCR, 'hf-updates.png'));
} catch (e) {
  check(false, `erreur : ${e.stack ?? e.message}`);
} finally {
  if (p) await p.close();
  if (hub) { try { execFileSync('taskkill', ['/PID', String(hub.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
}
console.log(`\n${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);

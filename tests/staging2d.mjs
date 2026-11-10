// « Mise en scène » in a run of a Remotion pipeline (player/stage2d.ts), on the sample project of tests/coulisses-fixture.mjs
// (nothing real is touched), and the same tools in every project (user request, 08/10/2026: « il doit apparaître pour
// toutes les vidéos » · « je n'ai pas les mêmes menus en fonction de la vidéo » · « le mot scène disparaît »):
//   1. the rail, the tabs and the menu bar: every tool is there, greyed with its reason when it does not apply; the six
//      tabs keep their whole names;
//   2. M: the 2D staging; a click picks the title, a drag moves it, the arrows nudge it, the wheel resizes it — on top of
//      the engine (CSS translate / scale), in frame pixels;
//   3. « Ajouter »: a pinned edit with the offset, the « after » image photographed by the server at the frame's size,
//      and the batch's request in 2D words; the camera (the whole frame) reframes;
//   4. a rendered video opens the parallax request from each entry point. Staying in 2D explains why editing needs code.
// usage: node tests/staging2d.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, requireSandbox } from './cdp.mjs';
import { freePort } from './where.mjs';
import { waitForRenderIdle } from '../lib/render-activity.mjs';
import { stageRebuild } from './staging-rebuild.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCR = path.join(STUDIO, '.cache', 'staging2d-test');
fs.rmSync(SCR, { recursive: true, force: true }); fs.mkdirSync(SCR, { recursive: true });
process.env.COULISSES_LANG = 'fr';
process.env.STUDIO_PROJECTS = path.join(SCR, 'projets.json');
process.env.COULISSES_SETTINGS = path.join(SCR, 'settings.json');
process.env.COULISSES_MEDIAS = path.join(SCR, 'medias');
fs.writeFileSync(process.env.COULISSES_SETTINGS, JSON.stringify({ mediasAutoSort: false }));   // an image imported here is not sent to Codex
const { makeFixture } = await import('./coulisses-fixture.mjs');
const { importProject } = await import('../lib/projects.mjs');
const { lotMarkdown } = await import('../lib/lots.mjs');
const PORT = await freePort(4240); let U;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));   // COULISSES_TEST_SLOW=2: a slower PC
let ok = 0, ko = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };
const kill = (c) => { if (c) try { execFileSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
async function studioOn(revue, port) {
  const c = spawn(process.execPath, [path.join(STUDIO, 'studio-server.mjs'), '--project', revue, '--no-open', '--port', String(port)], { cwd: STUDIO, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 160 && !/Ouvre : http/.test(out); i++) await sleep(250);
  if (!/Ouvre : http/.test(out)) { kill(c); throw new Error('le studio ne démarre pas : ' + out.slice(-300)); }
  c.url = /Ouvre : (http:\/\/127\.0\.0\.1:\d+)/.exec(out)?.[1];
  await requireSandbox(c.url, path.join(STUDIO, '.cache'));
  c.log = () => out;
  return c;
}
const TOOLS = ['connect', 'send', 'staging', 'source', 'export', 'stopExport', 'compare', 'updates', 'verify', 'log'];
async function menuIds(p, select) {   // Outils: its entries, and the reason of each greyed one
  const [x, y] = await p.eval(`const r = document.querySelector('#menubar > button[data-menu=tools]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]`);
  await p.mouse('mousePressed', x, y); await p.mouse('mouseReleased', x, y); await sleep(300);
  const r = await p.eval(`const m = document.querySelector('.mb-menu'); const items = m ? [...m.querySelectorAll(':scope > .mb-item')] : [];
    return { ids: items.map((r) => r.dataset.id), off: Object.fromEntries(items.map((r) => [r.dataset.id, r.classList.contains('off') ? r.title : ''])) }`);
  if (select) await p.eval(`document.querySelector('.mb-menu .mb-item[data-id="${select}"]').click(); return 1`);
  else await p.key('Escape', 'Escape');
  await sleep(100);
  return r;
}

let st = null, st2 = null, p = null, rebuild = null;
try {
  await waitForRenderIdle();
  const file = makeFixture(), imp = importProject(file);
  st = await studioOn(imp.revue, PORT);
  U = st.url;
  p = await launch({ port: await freePort(9372) });
  await p.goto(U + '/');
  await p.until(`window.__preview?.durationInFrames`, 60000);
  await sleep(1500);

  // ---------- 1. the same tools everywhere ----------
  console.log('les mêmes outils partout');
  const rail = await p.eval(`return [...document.querySelectorAll('#rail button, #ctlbar button[data-tool]')].map((b) => ({ id: b.id || b.dataset.tool, shown: getComputedStyle(b).display !== 'none', off: b.classList.contains('off'), why: b.querySelector('.why')?.textContent ?? '' }))`);
  check('bHome,bNote,bRange,bMic,bStage,bSrc,bPrefs,select,draw,comment'.split(',').every(id => rail.some(b => b.id === id && b.shown)), `the rail and the tools under the image: ${rail.map((b) => b.id).join(' · ')}`);
  const src = rail.find((b) => b.id === 'bSrc'), stg = rail.find((b) => b.id === 'bStage');
  check(src.off && /Pas encore de vidéo/.test(src.why) && !stg.off, `« MP4 ⇄ code » greyed here (« ${src.why} »), « Mise en scène » ready`);
  // the two tab bars (user request, 09/10/2026): the agent's column on the left, the media and notes on the right
  const tabs = await p.eval(`return [...document.querySelectorAll('.tabbar')].map((bar) => { const r = bar.getBoundingClientRect(), bs = [...bar.querySelectorAll('button')];
      return { names: bs.map((b) => {const c=b.cloneNode(true); c.querySelector('.n')?.remove(); return c.textContent.trim();}).join('|'), cut: bs.filter((b) => b.scrollWidth > b.clientWidth + 1).length,
        fits: bar.scrollWidth <= bar.clientWidth + 1, last: bs.at(-1).getBoundingClientRect().right <= r.right + 1 }; })`);
  check(tabs.map((t) => t.names).join(' / ') === 'Agent|Modifs|Envois / Calques|Médias|Notes|Scène|Inspecteur' && tabs.every((t) => !t.cut && t.fits && t.last), `two tab bars, none cut, the last whole (${tabs.map((t) => t.names.replaceAll('|', ' · ')).join(' / ')})`);
  const m1 = await menuIds(p);
  check(TOOLS.every((id) => m1.ids.includes(id)) && !m1.ids.includes('render') && !m1.off.staging && /Pas encore de vidéo/.test(m1.off.source), `Outils: ${m1.ids.filter(Boolean).join(' · ')}`);

  // ---------- 2. the 2D staging ----------
  console.log('la mise en scène 2D');
  await p.eval(`window.__preview.seek(45); return 1`); await sleep(900);
  await p.key('m', 'KeyM', 'm');
  await p.until("document.querySelector('#sceneRequestKeep')", 20000);
  await p.eval("document.querySelector('#sceneRequestKeep').click()");
  await p.until(`__studio.state().staging`, 20000);
  check(await p.eval(`return __studio.state().tab === 'scene' && window.__preview.stage.kind === '2d'`), 'M: the 2D staging, panel « Scène »');
  const fr0 = await p.eval(`const r = document.querySelector('#code').getBoundingClientRect(); return [r.left, r.top]`);
  const el0 = await p.frameEval('player.html', `const r = document.querySelector('[data-coulisses="titre s01"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width]`);
  const at = [fr0[0] + el0[0], fr0[1] + el0[1], el0[2]];
  await p.mouse('mousePressed', at[0], at[1]);
  for (let i = 1; i <= 5; i++) { await p.eval(`return 1`); await sleepMove(p, at[0] + i * 20, at[1] + i * 8); }
  await p.mouse('mouseReleased', at[0] + 100, at[1] + 40);
  await sleep(500);
  const sel = await p.eval(`return __studio.state().stage`);
  check(sel === '[data-coulisses="titre s01"]', `a click picks the title, by its data-coulisses name (${sel})`);
  const k = await p.frameEval('player.html', `const f = document.getElementById('coulisses-camera').parentElement; return f.getBoundingClientRect().width / 1920`);
  let info = await p.eval(`return window.__preview.stage.info(${JSON.stringify(sel)})`);
  check(Math.abs(info.delta.p[0] - 100 / k) < 3 && Math.abs(info.delta.p[1] - 40 / k) < 3, `a drag moves it, in frame pixels (Δx ${info.delta.p[0].toFixed(0)}, Δy ${info.delta.p[1].toFixed(0)}; ${(100 / k).toFixed(0)} × ${(40 / k).toFixed(0)} expected)`);
  const css = await p.frameEval('player.html', `return document.querySelector('[data-coulisses="titre s01"]').style.translate`);
  check(/px/.test(css) && await p.frameEval('player.html', `return /scale\\(/.test(document.querySelector('[data-coulisses="titre s01"]').style.transform)`), `shown on top of the engine: translate ${css}, its own transform untouched`);
  for (let i = 0; i < 3; i++) { await p.key('ArrowRight', 'ArrowRight'); await sleep(60); }
  await p.wheel(at[0] + 100, at[1] + 40, -120); await sleep(400);
  const info2 = await p.eval(`return window.__preview.stage.info(${JSON.stringify(sel)})`);
  check(Math.abs(info2.delta.p[0] - info.delta.p[0] - 3) < 0.01 && info2.delta.s > 1.03, `→ ×3 = +3 px, the wheel = size ×${info2.delta.s.toFixed(2)}`);
  check(await p.eval(`return document.querySelector('#sc-x').value`) === String(Math.round(info2.delta.p[0])), 'the panel shows the offset in pixels');
  // ---------- 3. into the queue: offset, pin, « after » image ----------
  console.log('dans la file');
  await p.eval(`document.querySelector('#sc-add').click(); return 1`);
  await p.until(`__studio.state().drafts === 1`, 60000); await sleep(3500);
  const notes = (await (await fetch(U + '/api/notes')).json()).notes;
  const n = notes.find((x) => x.stage);
  check(n?.stage?.dim === '2d' && n.stage.id === sel && n.stage.size?.join('x') === '1920x1080' && n.mark?.kind === 'pin' && /titre s01/.test(n.text), `a pinned edit with the 2D offset (« ${n?.text?.slice(0, 80)}… »)`);
  const after = n?.images?.find((im) => /après|after/i.test(im.label ?? ''));
  const afterFile = after ? path.join(imp.revue, after.file) : null;
  const dims = afterFile && fs.existsSync(afterFile) ? execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', afterFile], { encoding: 'utf8' }).trim() : '';
  check(dims === '1920,1080', `the « after » image, photographed by the server at the frame's size (${dims || 'none'})`);
  if (afterFile && fs.existsSync(afterFile)) fs.copyFileSync(afterFile, path.join(SCR, 'apres.jpg'));
  const md = lotMarkdown({ kind: 'remotion', target: 'x', title: 'Essai', remotionDir: SCR, remotion: { composition: 'C' }, coulisses: file, EP: SCR, REVUE: imp.revue },
    { lot: 1, sentAt: new Date().toISOString(), fps: 30, size: [1920, 1080], render: null, edits: [{ k: 1, id: n.id, frame: n.frame, end: null, time: 1.5, text: n.text, thread: [], context: null, mark: n.mark, target: null, source: 'code', images: [], captures: {}, stage: n.stage }] });
  check(/Mise en scène proposée par l'utilisateur/.test(md) && /Δx \+\d+ px \(vers la droite\)/.test(md) && /Boîte de l'élément/.test(md) && /là où le projet place cet élément/.test(md), 'the batch tells the agent the offset in pixels, the element\'s box, where to write it');
  // the camera: the whole frame
  await p.eval(`document.querySelector('#sc-cam').click(); return 1`); await sleep(300);
  check(await p.eval(`return __studio.state().stage === '@camera'`), '« Caméra » picks the whole frame');
  const mid = await p.eval(`const r = document.querySelector('#code').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]`);
  await p.wheel(mid[0], mid[1], -120); await p.wheel(mid[0], mid[1], -120); await sleep(400);
  const cam = await p.eval(`return window.__preview.stage.info('@camera')`);
  const camCss = await p.frameEval('player.html', `return document.getElementById('coulisses-camera').style.scale`);
  check(cam.delta.s > 1.07 && +camCss > 1.07, `the wheel zooms the frame (×${cam.delta.s.toFixed(2)}, the preview's frame scale ${camCss})`);
  const camMd = lotMarkdown({ kind: 'remotion', target: 'x', title: 'Essai', remotionDir: SCR, remotion: { composition: 'C' }, coulisses: file, EP: SCR, REVUE: imp.revue },
    { lot: 1, sentAt: new Date().toISOString(), fps: 30, size: [1920, 1080], render: null, edits: [{ k: 1, id: 'c', frame: 45, end: null, time: 1.5, text: '', thread: [], context: null, mark: null, target: null, source: 'code', images: [], captures: {}, stage: { id: '@camera', name: 'Caméra', kind: 'cadre entier', delta: cam.delta, base: null, scope: { label: 'tout', from: 0, to: 299 }, frame: 45, dim: '2d', size: [1920, 1080] } }] });
  check(/Cadrage proposé par l'utilisateur/.test(camMd) && /mouvement de caméra/.test(camMd), 'a reframing goes to the agent as a camera move');
  // a rebuild of the preview while an offset is in progress (here the frame, not queued): the new version takes over, the offset with it
  { const KEYS = path.join(STUDIO, 'player', 'keys.ts');
    await p.eval(`window.__preview.stage.setDelta('@camera', { p: [33, 0, 0], r: [0, 0, 0], s: 1 }, 0, 1e9); return 1`); await sleep(300);
    const f0 = await p.eval(`return __studio.state().frame`);
    const staged = () => p.eval(`const s = window.__preview.stage; return {selected: __studio.state().stage, list: s.list().map(({id, delta, from, to}) => ({id, delta, from, to})).sort((a, b) => a.id.localeCompare(b.id)), camera: s.info('@camera').delta}`);
    const before = await staged();
    rebuild = await stageRebuild(p, KEYS);
    const transition = await rebuild.adopted(); await sleep(500);
    check(transition.preparedBehind && transition.adopted && transition.oldSrc !== transition.newSrc && transition.markerMatches && transition.frames === 1,
      'une vraie révision 2D est préparée derrière l’ancienne iframe, puis devient seule active avec son nouveau code');
    const dx = await p.eval(`return window.__preview.stage.info('@camera').delta.p[0]`);
    const after = await staged();
    fs.writeFileSync(path.join(SCR, 'rebuild-proof.json'), JSON.stringify({transition, before, after, frame: f0}, null, 2));
    check(dx === 33 && (await p.eval(`return __studio.state().frame`)) === f0 && JSON.stringify(after) === JSON.stringify(before), `la nouvelle version conserve sélection, décalages et caméra (Δx ${dx}) à la même image (${f0})`);
    await p.eval(`window.__preview.stage.reset('@camera'); return 1`);
  }
  // « Médias » on a 2D picture: the image itself, laid where it was dropped, staged, queued with its box
  await p.eval(`document.querySelector('#sc-cam0').click(); return 1`); await sleep(300);
  const item = await p.eval(`const c = document.createElement('canvas'); c.width = 300; c.height = 600; const g = c.getContext('2d');
    g.fillStyle = '#e8402a'; g.beginPath(); g.ellipse(150, 330, 110, 210, 0, 0, Math.PI * 2); g.fill();
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const it = (await (await fetch('/api/medias/import', { method: 'POST', headers: { 'Content-Type': 'image/png', 'x-name': 'lanterne.png' }, body: blob })).json()).item;
    await fetch('/api/medias/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id, nom: 'lanterne', categorie: 'accessoires' }) });
    return it`);
  await p.eval(`await window.Studio.dropMedia(${JSON.stringify(item.id)}, [1400, 300]); return 1`); await sleep(600);
  const c2 = await p.eval(`const s = window.__preview.stage; return s.list().find((x) => x.cutout) ?? null`);
  const sc2 = await p.eval(`return document.querySelector('#scene').innerText`);
  check(c2?.id === '[data-coulisses="lanterne"]' && await p.eval(`return __studio.state().stage`) === c2.id && !!(await p.frameEval('player.html', `return document.querySelector('#coulisses-camera > img[data-coulisses="lanterne"]') ? 1 : 0`))
    && /image \(nouvelle\)/.test(sc2) && /Retirer l'image/.test(sc2) && Math.abs(c2.cutout.final.x - 1400) < 1 && Math.abs(c2.cutout.final.y - 300) < 1 && Math.abs(c2.cutout.final.h - 270) < 1,
    `a library image dropped on the 2D picture is laid there at once, chosen (${c2?.id}, centre ${c2?.cutout?.final.x}, ${c2?.cutout?.final.y}, ${c2?.cutout?.final.w?.toFixed(0)} × ${c2?.cutout?.final.h?.toFixed(0)} px)`);
  const lf = await p.eval(`const f = document.querySelector('#code').getBoundingClientRect(); return [f.left, f.top]`);
  const lr = await p.frameEval('player.html', `const r = document.querySelector('img[data-coulisses="lanterne"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]`);
  const lp = [lf[0] + lr[0], lf[1] + lr[1]];
  await p.wheel(lp[0], lp[1], -120); await sleep(300);
  await p.eval(`document.querySelector('#sc-add').click(); return 1`);
  await p.until(`__studio.state().drafts === 2`, 60000); await sleep(3500);
  const n2 = (await (await fetch(U + '/api/notes')).json()).notes.find((x) => x.stage?.cutout);
  const after2 = n2?.images?.find((im) => /après|after/i.test(im.label ?? '')), af2 = after2 ? path.join(imp.revue, after2.file) : null;
  // the « after » image, photographed by the server: the image is there (red around 1400, 300)
  const rgb = af2 && fs.existsSync(af2) ? [...execFileSync('ffmpeg', ['-v', 'error', '-i', af2, '-vf', 'crop=20:20:1390:290,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])] : [];
  check(n2 && /^Ajouter l'image « lanterne » à l'endroit/.test(n2.text) && n2.stage.cutout.final.h > 280 && n2.media?.nom === 'lanterne' && rgb[0] > 180 && rgb[1] < 110,
    `« Ajouter à la file »: « ${n2?.text?.slice(0, 60)}… », its box (bigger by the wheel: ${n2?.stage?.cutout?.final.h?.toFixed(0)} px high), the « after » image shows it (rgb ${rgb.join(',')})`);
  const md2 = lotMarkdown({ kind: 'remotion', target: 'x', title: 'Essai', remotionDir: SCR, remotion: { composition: 'C' }, coulisses: file, EP: SCR, REVUE: imp.revue },
    { lot: 1, sentAt: new Date().toISOString(), fps: 30, size: [1920, 1080], render: null, edits: [{ k: 1, id: n2.id, frame: n2.frame, end: null, time: 1.5, text: n2.text, thread: [], context: null, mark: n2.mark, target: null, source: 'code', images: [], captures: {}, stage: n2.stage, media: n2.media }] });
  check(/Nouvelle image à ajouter/.test(md2) && /Boîte voulue, en pixels de l'image \(1920 × 1080\) : centre x 1400, y 300/.test(md2) && /Média de la bibliothèque à placer/.test(md2) && /data-coulisses/.test(md2), 'the batch: « Nouvelle image à ajouter », its box in pixels, the media');
  await p.shot(path.join(SCR, 'staging2d.png'));
  await p.key('m', 'KeyM', 'm'); await sleep(500);
  check(!(await p.eval(`return __studio.state().staging`)), 'M again: staging off');
  await p.close(); p = null;

  // ---------- 4. a project with only its video ----------
  console.log('un projet vidéo seule');
  await waitForRenderIdle();
  const vdir = path.join(SCR, 'video-seule'); fs.mkdirSync(vdir, { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-t', '2', '-pix_fmt', 'yuv420p', path.join(vdir, 'essai.mp4')]);
  const vimp = importProject(vdir);
  st2 = await studioOn(vimp.revue, await freePort(PORT + 1));
  p = await launch({ port: await freePort(9373) });
  await p.goto(st2.url + '/');
  await p.until(`document.querySelector('#v').readyState >= 1`, 30000); await sleep(1200);
  const r2 = await p.eval(`return [...document.querySelectorAll('#rail button, #ctlbar button[data-tool]')].map((b) => ({ id: b.id || b.dataset.tool, shown: getComputedStyle(b).display !== 'none', off: b.classList.contains('off'), why: b.querySelector('.why')?.textContent ?? '' }))`);
  check(r2.map((b) => b.id).join() === rail.map((b) => b.id).join() && r2.every((b) => b.shown), 'the same rail for a video');
  const s2 = r2.find((b) => b.id === 'bStage');
  const offer = `__studio.state().tab === 'scene' && !__studio.state().staging && !!document.querySelector('#sceneRequestSend') && !!document.querySelector('#sceneRequestKeep')`;
  await p.eval(`document.querySelector('#bStage').click(); return 1`);
  check(!s2.off && await p.eval(`return ${offer}`), 'Le rail ouvre la proposition de parallaxe pour un simple fichier vidéo');
  await p.eval(`document.querySelector('button[data-tab="notes"]').click(); return 1`);
  const m2 = await menuIds(p, 'staging');
  check(JSON.stringify(m2.ids.filter(Boolean)) === JSON.stringify(m1.ids.filter(Boolean)) && !m2.off.staging && /propre logiciel/.test(m2.off.export)
    && await p.eval(`return ${offer}`), 'Le menu ouvre Scène sur le MP4 ; l’export externe garde son explication');
  await p.eval(`document.querySelector('button[data-tab="notes"]').click(); document.querySelector('button[data-tab="scene"]').click(); return 1`);
  check(await p.eval(`return (${offer}) && /vidéo est un rendu/.test(document.querySelector('#scene').innerText)`), 'Scène présente la possibilité de recréer la composition depuis les sources');
  await p.eval(`document.querySelector('#sceneRequestKeep').click(); return 1`);
  check(await p.eval(`return !__studio.state().staging && !document.querySelector('#sc-on') && /que sa vidéo/.test(document.querySelector('#scene').innerText)
    && document.querySelector('#sceneParallaxReopen').offsetWidth > 0`), 'Rester en 2D conserve la lecture du MP4, explique l’absence de calques éditables et permet de rouvrir la proposition');
} catch (e) {
  check(false, `erreur : ${e.stack ?? e.message}`);
} finally {
  if (p) await p.close();
  kill(st); kill(st2);
  try { rebuild?.restore(); } catch (e) { check(false, e.message); }
}
async function sleepMove(page, x, y) { await page.mouse('mouseMoved', x, y); await sleep(40); }
console.log(`\n${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);

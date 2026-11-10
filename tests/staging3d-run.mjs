// « Mise en scène » in 3D in a run of a Remotion pipeline (player/three-stage.ts): a 3D shot of Uchu-chan's theatre
// (S12-CH1, the first chibi shot of Short 12) opened live through a .coulisses written in the workshop's cache — the
// theatre is only read (its revue goes to the cache). And « Ouvrir la scène 3D » in the Short 12 studio on that clip
// (read only: no note is written). Skipped when the theatre is not on this PC.
// usage: node tests/staging3d-run.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, requireSandbox } from './cdp.mjs';
import { waitForRenderIdle } from '../lib/render-activity.mjs';
import { stageRebuild } from './staging-rebuild.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { uchuTheatre, short12, skip, freePort } = await import('./where.mjs');
const THEATRE = uchuTheatre(), SHORT = short12();   // tests/where.mjs (COULISSES_TEST_UCHU, COULISSES_TEST_SHORT12)
if (!THEATRE || !SHORT) skip("le théâtre d'Uchu-chan ou son Short 12", 'COULISSES_TEST_UCHU / COULISSES_TEST_SHORT12');
const SCR = path.join(STUDIO, '.cache', 'staging3d-run-test');
fs.rmSync(SCR, { recursive: true, force: true }); fs.mkdirSync(SCR, { recursive: true });
process.env.COULISSES_LANG = 'fr';
process.env.STUDIO_PROJECTS = path.join(SCR, 'projets.json');
process.env.COULISSES_SETTINGS = path.join(SCR, 'settings.json');
process.env.COULISSES_MEDIAS = path.join(SCR, 'medias');
fs.writeFileSync(process.env.COULISSES_SETTINGS, JSON.stringify({ mediasAutoSort: false }));   // an image imported here is not sent to Codex
const P = await import('../lib/projects.mjs');
const { lotMarkdown } = await import('../lib/lots.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));   // COULISSES_TEST_SLOW=2: a slower PC
let ok = 0, ko = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };
const kill = (c) => { if (c) try { execFileSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
async function studioOn(revue, port) {
  const c = spawn(process.execPath, [path.join(STUDIO, 'studio-server.mjs'), '--project', revue, '--no-open', '--port', String(port)], { cwd: STUDIO, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 240 && !/Ouvre : http/.test(out); i++) await sleep(250);
  c.url = /Ouvre : (http:\/\/127\.0\.0\.1:\d+)/.exec(out)?.[1];
  if (!c.url) { kill(c); throw new Error('Le studio d’essai ne démarre pas : ' + out.slice(-1000)); }
  await requireSandbox(c.url, SCR);
  return c;
}
let a = null, b = null, p = null, rebuild = null;
try {
  await waitForRenderIdle();
  // Le moteur et l’export existant sont lus, mais tous les fichiers de revue et
  // le verrou du studio vivent dans notre copie ; aucun studio réel n’est ouvert.
  const shortData = JSON.parse(fs.readFileSync(SHORT, 'utf8')), shortBase = path.dirname(SHORT);
  shortData.remotion.projet = path.resolve(shortBase, shortData.remotion.projet);
  if (shortData.export?.dossier) shortData.export.dossier = Array.isArray(shortData.export.dossier)
    ? shortData.export.dossier.map((d) => path.resolve(shortBase, d)) : path.resolve(shortBase, shortData.export.dossier);
  if (shortData.plan) shortData.plan = path.resolve(shortBase, shortData.plan);
  shortData.revue = 'revue';
  const shortCopy = path.join(SCR, 'Short12', 'short12.coulisses');
  fs.mkdirSync(path.dirname(shortCopy), {recursive: true}); fs.writeFileSync(shortCopy, JSON.stringify(shortData, null, 2));
  const spec = path.join(SCR, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ dossier: path.join(SCR, 'CH1'), titre: 'S12 · plan chibi 1', nom: 'S12-CH1 plan 3D', chaine: '宇宙ちゃん', format: '9:16', projet: THEATRE, composition: 'S12-CH1',
    utilise: [{ coulisses: shortCopy, fichier: 'public/short12_yottsu_no_chikara/mg/chibi1.mp4' }] }));
  const file = spawnSync(process.execPath, [path.join(STUDIO, 'studio-cli.mjs'), 'projet', 'creer', '--depuis', spec], { encoding: 'utf8', env: process.env }).stdout.trim();
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  check(data.utilise?.[0]?.fichier === 'public/short12_yottsu_no_chikara/mg/chibi1.mp4' &&
    typeof data.utilise[0].coulisses === 'string' && path.resolve(path.dirname(file), data.utilise[0].coulisses) === shortCopy,
    '« utilise » désigne la copie du Short et le fichier cible, par un chemin relatif ou absolu');
  const shot = P.importProject(file);
  // 1) the shot, live, in 3D
  const port = await freePort(4245);
  a = await studioOn(shot.revue, port);
  p = await launch({ port: await freePort(9378) });
  await p.goto(a.url + '/');
  await p.until(`window.__preview?.durationInFrames > 1`, 180000);
  const info = await p.eval(`const sp = window.__preview; return { d: sp.durationInFrames, w: sp.width, h: sp.height }`);
  check(info.d === 261 && info.w === 1080 && info.h === 1920, `the theatre's shot plays live (${info.d} frames, ${info.w}×${info.h})`);
  await p.eval(`window.__preview.seek(120); return 1`); await sleep(5000);
  const hits = await p.eval(`return (await window.__preview.pick(120, 540, 1500)).map((h) => h.names?.[0] ?? h.label)`);
  check(/^Stage › Piece\[key="cockpit-/.test(hits[0] ?? ''), `a pin names the 3D object under it, pixel-exact (${hits[0]})`);
  await p.key('m', 'KeyM', 'm');
  await p.until(`__studio.state().staging`, 60000); await sleep(1500);
  check(await p.eval(`return window.__preview.stage.kind`) === '3d', 'M: the 3D staging (a React Three Fiber scene on screen)');
  const at = await p.eval(`const r = document.querySelector('#media').getBoundingClientRect(); const k = Math.min(r.width / 1080, r.height / 1920); return [r.left + (r.width - 1080 * k) / 2 + 540 * k, r.top + (r.height - 1920 * k) / 2 + 1500 * k]`);
  await p.mouse('mousePressed', at[0], at[1]); await p.mouse('mouseReleased', at[0], at[1]); await sleep(1500);
  const sel = await p.eval(`return __studio.state().stage`);
  for (let i = 0; i < 4; i++) { await p.key('ArrowRight', 'ArrowRight'); await sleep(60); }
  await sleep(700);
  const d = sel ? await p.eval(`return window.__preview.stage.info(${JSON.stringify(sel)}).delta`) : null;
  check(/^Stage › Piece/.test(sel ?? '') && Math.abs((d?.p?.[0] ?? 0) - 0.2) < 1e-6, `a click picks the object, the arrows move it in 3D units (${sel} · Δx ${d?.p?.[0]})`);
  // dragging the object itself: along the floor (its height kept), then up with Shift (only its height)
  const sp3 = `window.__preview.stage`;
  const d0 = await p.eval(`return ${sp3}.info(${JSON.stringify(sel)}).delta.p`);
  await p.mouse('mousePressed', at[0], at[1]);
  for (let i = 1; i <= 6; i++) { await p.mouse('mouseMoved', at[0] + i * 12, at[1] - i * 4); await sleep(40); }
  await p.mouse('mouseReleased', at[0] + 72, at[1] - 24); await sleep(500);
  const d1 = await p.eval(`return ${sp3}.info(${JSON.stringify(sel)}).delta.p`);
  check(Math.hypot(d1[0] - d0[0], d1[2] - d0[2]) > 0.05 && Math.abs(d1[1] - d0[1]) < 1e-6 && await p.eval(`return __studio.state().stage`) === sel, `a drag on the object moves it along the floor, its height kept (Δ ${d1.map((x) => x.toFixed(2)).join(', ')})`);
  const fr3 = await p.eval(`const f = document.querySelector('#code').getBoundingClientRect(); return [f.left, f.top]`);
  await p.frameEval('player.html', `const c = document.querySelector('canvas'), r = c.getBoundingClientRect();
    const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, shiftKey: true, button: 0, buttons: t === 'pointerup' ? 0 : 1, pointerId: 7 }));
    const x = ${at[0] + 72 - fr3[0]}, y = ${at[1] - fr3[1]};   // where the object is now (an eye-level camera: it slid sideways, under the pointer's x)
    ev('pointerdown', x, y); for (let i = 1; i <= 5; i++) ev('pointermove', x, y - i * 10); ev('pointerup', x, y - 50); return 1`); await sleep(400);
  const d2 = await p.eval(`return ${sp3}.info(${JSON.stringify(sel)}).delta.p`);
  check(d2[1] - d1[1] > 0.02 && Math.abs(d2[0] - d1[0]) < 1e-6 && Math.abs(d2[2] - d1[2]) < 1e-6, `Shift + drag: only its height (Δy ${(d2[1] - d1[1]).toFixed(2)})`);
  // « Réinitialiser la caméra »
  check(await p.eval(`return /Réinitialiser la caméra/.test(document.querySelector('#scene').innerText)`), '« Réinitialiser la caméra » is in the panel');
  await p.eval(`document.querySelector('#sc-cam').click(); return 1`); await sleep(400);
  check(/Caméra libre active/.test(await p.eval(`return document.querySelector('#scene').innerText`)) && !/Oliver/.test(await p.eval(`return document.querySelector('#scene').innerText`)), 'the free camera; the units are the scene\'s (no Brambleshire scale)');
  // turn the free camera (a drag on empty sky), then reset it: the shot's view again
  const shotView = await p.frameEval('player.html', `return document.querySelector('canvas').toDataURL('image/jpeg', 0.5).length`);
  const sky = await p.eval(`const r = document.querySelector('#media').getBoundingClientRect(); const k = Math.min(r.width / 1080, r.height / 1920); return [r.left + (r.width - 1080 * k) / 2 + 540 * k, r.top + (r.height - 1920 * k) / 2 + 60 * k]`);
  await p.mouse('mousePressed', sky[0], sky[1], 'middle'); for (let i = 1; i <= 8; i++) { await p.mouse('mouseMoved', sky[0] + i * 25, sky[1], 'middle'); await sleep(40); } await p.mouse('mouseReleased', sky[0] + 200, sky[1], 'middle'); await sleep(600);
  const camPos = () => p.eval(`const sp = window.__preview; return sp.cameraPos ? await sp.cameraPos() : null`);
  // free camera: a middle-button drag that starts on another object (a backdrop, a floor…) turns the camera, nothing moves
  const other = await p.eval(`const sp = window.__preview; for (const [x, y] of [[540, 900], [300, 1200], [800, 1200], [540, 400], [200, 700], [900, 700], [540, 1750]]) { const n = (await sp.pick(120, x, y))[0]?.names?.[0] ?? ''; if (/^Stage › Piece/.test(n) && n !== ${JSON.stringify(sel)}) return [x, y, n]; } return null`);
  if (other) {
    const listed = () => p.eval(`return JSON.stringify(${sp3}.list().map((x) => [x.id, x.delta.p]))`);
    const c0 = await camPos(), l0 = await listed();
    const o = await p.eval(`const r = document.querySelector('#media').getBoundingClientRect(); const k = Math.min(r.width / 1080, r.height / 1920); return [r.left + (r.width - 1080 * k) / 2 + ${other[0]} * k, r.top + (r.height - 1920 * k) / 2 + ${other[1]} * k]`);
    await p.mouse('mousePressed', o[0], o[1], 'middle'); for (let i = 1; i <= 6; i++) { await p.mouse('mouseMoved', o[0] + i * 15, o[1], 'middle'); await sleep(40); } await p.mouse('mouseReleased', o[0] + 90, o[1], 'middle'); await sleep(500);
    const c1 = await camPos();
    check(c0 && c1 && Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]) > 0.01 && await listed() === l0 && await p.eval(`return __studio.state().stage`) === sel, `free camera: a middle-button drag that starts on another object turns the camera, nothing moves (${other[2]})`);
  } else console.log('  (no other object under the probe points: the free-camera drag check is skipped)');
  const moved = await camPos();
  await p.eval(`document.querySelector('#sc-cam0').click(); return 1`); await sleep(600);
  const back = await camPos();
  void shotView;
  check(moved && back && Math.hypot(moved[0] - back[0], moved[1] - back[1], moved[2] - back[2]) > 0.05 && /Caméra libre active/.test(await p.eval(`return document.querySelector('#scene').innerText`)), `« Réinitialiser la caméra »: the shot's camera again, the free camera still on (${moved?.map((x) => x.toFixed(1)).join(',')} → ${back?.map((x) => x.toFixed(1)).join(',')})`);
  // a rebuild of the preview (as after each edit of the agent; 08/10/2026 « des fois la vidéo déconnecte »): the new
  // version is prepared behind, the old one stays on screen, then the new one takes over with the staging in progress
  { const KEYS = path.join(STUDIO, 'player', 'keys.ts');
    const look = () => p.eval(`const sp = window.__preview; return { ver: document.querySelector('#codeStatus').textContent, frames: document.querySelectorAll('#media iframe').length,
      cam: (await Promise.resolve(sp.stage.freePose?.()).catch(() => null))?.p ?? null, sel: sp.stage.selected, list: sp.stage.list().map((x) => x.id + '|' + x.delta.p.map((v) => v.toFixed(3)).join(',')).sort().join(';'), sp: !!sp }`);
    const b0 = await look(), f0 = await p.eval(`return __studio.state().frame`);
    rebuild = await stageRebuild(p, KEYS);
    const transition = await rebuild.adopted();
    await sleep(500); const l = await look();
    fs.writeFileSync(path.join(SCR, 'rebuild-proof.json'), JSON.stringify({transition, before: b0, after: l, frame: f0}, null, 2));
    const same = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
    check(transition.preparedBehind && transition.adopted && transition.oldSrc !== transition.newSrc && transition.markerMatches && l.frames === 1, `une vraie révision 3D est préparée derrière l’ancienne, puis adoptée (« ${b0.ver} » → « ${l.ver} »)`);
    check(same(l.cam, b0.cam) && l.sel === b0.sel && l.list === b0.list && (await p.eval(`return __studio.state().frame`)) === f0 && /Caméra libre active/.test(await p.eval(`return document.querySelector('#scene').innerText`)),
      'the staging survives it: the free camera where it was, the object chosen, its offset not queued yet'
      + (same(l.cam, b0.cam) && l.sel === b0.sel && l.list === b0.list ? '' : ` (${JSON.stringify(b0)} → ${JSON.stringify(l)})`));
  }
  // « Médias » → 3D cardboard: an image of the library (a lantern drawn here, transparent around it) dropped on the
  // preview stands there as cardboard at once, is staged like the others, goes to the queue with its place
  await p.eval(`document.querySelector('#sc-cam').click(); return 1`); await sleep(300);   // the shot's camera again
  const item = await p.eval(`const c = document.createElement('canvas'); c.width = 300; c.height = 600; const g = c.getContext('2d');
    g.fillStyle = '#f2c14e'; g.beginPath(); g.ellipse(150, 330, 110, 210, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#7a3b10'; g.fillRect(120, 40, 60, 90);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const it = (await (await fetch('/api/medias/import', { method: 'POST', headers: { 'Content-Type': 'image/png', 'x-name': 'lanterne.png' }, body: blob })).json()).item;
    await fetch('/api/medias/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id, nom: 'lanterne', categorie: 'accessoires' }) });
    return it`);
  const objs0 = (await p.eval(`return (await window.__preview.objects()).length`));
  await p.eval(`await window.Studio.dropMedia(${JSON.stringify(item.id)}, [540, 1450]); return 1`); await sleep(800);
  const cut = await p.eval(`const s = window.__preview.stage; return s.list().find((x) => x.cutout) ?? null`);
  const scTxt = await p.eval(`return document.querySelector('#scene').innerText`);
  check(!!cut && /^@media:/.test(cut.id) && await p.eval(`return __studio.state().stage`) === cut.id && /lanterne/.test(scTxt) && /carton \(nouveau\)/.test(scTxt) && /Retirer l'image/.test(scTxt)
    && (await p.eval(`return (await window.__preview.objects()).some((o) => o.name === 'Carton « lanterne »')`)),
    `a library image dropped on the 3D preview stands there as cardboard at once, chosen (${cut?.id}, foot at ${cut?.cutout?.final.p.map((x) => x.toFixed(2)).join(', ')}, ${cut?.cutout?.final.h.toFixed(2)} high)`);
  check(cut && Math.abs(cut.cutout.final.h - 0.8) < 1e-6 && Math.abs(cut.cutout.final.p[1]) < 0.05 && Math.abs(cut.cutout.final.r[1]) < 1e-9, 'in a Theatre scene: the engine\'s size (a prop 0.8 high), its foot on the floor (y = 0), facing the stage like the other flats');
  const cutPx = await p.eval(`return window.__preview.stage.screenPos(${JSON.stringify(cut?.id)})`);
  check(cutPx && Math.abs(cutPx[0] - 540) < 120 && cutPx[1] < 1450 && cutPx[1] > 1000, `it stands where it was dropped (its centre at ${cutPx?.join(', ')} px on the frame, dropped at 540, 1450)`);
  fs.mkdirSync(path.join(STUDIO, '.cache', 'shots'), { recursive: true });
  await p.shot(path.join(STUDIO, '.cache', 'shots', 'cutout-3d.png'));
  { // the cardboard as the shot's camera sees it (no handles), and up close from the side (the edge, the back)
    const shot3 = await p.eval(`return await window.__preview.stage.snapshot()`);
    if (shot3) fs.writeFileSync(path.join(STUDIO, '.cache', 'shots', 'cutout-3d-after.jpg'), Buffer.from(shot3.split(',')[1], 'base64'));
  }
  void objs0;
  // Ctrl+Z takes the drop back, Ctrl+Y lays it again
  const hasCut = () => p.eval(`return window.__preview.stage.list().some((x) => x.cutout)`);
  await p.key('z', 'KeyZ', undefined, 2); await sleep(500);
  const gone = !(await hasCut());
  await p.key('y', 'KeyY', undefined, 2); await sleep(1200);
  check(gone && await hasCut(), 'Ctrl+Z takes the image away, Ctrl+Y lays it again');
  // moved like the others, then « Ajouter à la file »
  await p.eval(`window.__preview.stage.select(${JSON.stringify(cut?.id)}); return 1`); await sleep(300);
  for (let i = 0; i < 2; i++) { await p.frameEval('player.html', `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); return 1`); await sleep(80); }
  await sleep(500);
  await p.eval(`document.querySelector('#sc-add').click(); return 1`);
  await p.until(`__studio.state().drafts === 1`, 20000); await sleep(1500);
  const note = JSON.parse(fs.readFileSync(path.join(shot.revue, 'notes.json'), 'utf8')).notes.find((n) => n.stage?.cutout);
  check(note && /^Ajouter l'image « lanterne » en carton 3D/.test(note.text) && Math.abs(note.stage.cutout.final.p[0] - cut.cutout.final.p[0] - 0.1) < 1e-6 && note.media?.nom === 'lanterne' && /^images\/media-lanterne/.test(note.media.file) && (note.images ?? []).some((im) => /après/.test(im.label ?? '')),
    `« Ajouter à la file »: « ${note?.text?.slice(0, 70)}… », its place (+0.10 in x), the media and the « after » image`);
  // the batch: the agent is told what to add, where
  await p.eval(`document.querySelector('#qsend').click(); return 1`);
  await p.until(`document.querySelector('#modal').style.display === 'flex'`, 120000);
  const lotMd = fs.readFileSync(path.join(shot.revue, 'lots', '001.md'), 'utf8');
  check(/Nouvel élément à ajouter/.test(lotMd) && /pied du carton/.test(lotMd) && /hauteur visible 0\.800/.test(lotMd) && /Média de la bibliothèque à placer : "lanterne"/.test(lotMd) && /un carton comme les autres éléments du décor/.test(lotMd) && /le sol est à y = 0, un personnage mesure environ 2,0/.test(lotMd),
    'the batch: « Nouvel élément à ajouter », the cardboard\'s foot and size, the media and how to add it');
  console.log(lotMd.split('\n').filter((l) => /Nouvel élément|pied du carton|Média de la bibliothèque/.test(l)).map((l) => '     ' + l.slice(0, 220)).join('\n'));
  await p.eval(`document.querySelector('#mClose').click(); return 1`); await sleep(800);
  check(!(await hasCut()), 'once sent, the preview no longer shows it (the agent adds it to the code)');
  const md = lotMarkdown({ kind: 'remotion', target: 'x', title: 'S12', remotionDir: THEATRE, remotion: { composition: 'S12-CH1' }, coulisses: file, EP: SCR, REVUE: shot.revue, uses: P.project(shot.revue).uses },
    { lot: 1, sentAt: new Date().toISOString(), fps: 30, size: [1080, 1920], render: null, edits: [] });
  check(/Ce plan 3D est utilisé dans « 宇宙を動かす/.test(md) && md.includes('06_remotion\\public\\short12_yottsu_no_chikara\\mg\\chibi1.mp4') && /refaire le rendu de la composition `S12-CH1`/.test(md), 'the batch tells the agent to render the shot again into the Short\'s file');
  await p.close(); p = null; kill(a); a = null;
  // 2) the Short 12 studio: « Ouvrir la scène 3D » on the chibi clip
  const shortImp = P.importProject(shortCopy);
  b = await studioOn(shortImp.revue, await freePort(4246));
  const meta = await (await fetch(b.url + '/api/meta')).json();
  check(meta.shots3d?.length === 1 && meta.shots3d[0].id === shot.id && meta.shots3d[0].fichier.endsWith('chibi1.mp4'), 'the Short knows its 3D shot (the shot says it is used there)');
  p = await launch({ port: await freePort(9379) });
  await p.goto(b.url + '/');
  await p.until(`window.__studio && (__studio.state().mode === 'code' ? window.__preview?.durationInFrames > 1 : document.querySelector('#v').readyState >= 1)`, 180000);
  await p.until(`(await (await fetch('/api/timeline')).json()).status === 'ready'`, 30000);
  const { data: timeline } = await (await fetch(b.url + '/api/timeline')).json();
  const clips = timeline.tracks.filter(track => track.type === 'video').flatMap(track => track.clips);
  const clip = clips.find(c => path.basename(c.file ?? '') === 'chibi1.mp4');
  if (!clip) throw new Error('Le média chibi1.mp4 est introuvable dans les pistes vidéo du Short');
  const target = meta.shots3d.find(s => s.id === shot.id);
  check(target && path.resolve(shortData.remotion.projet, target.fichier) === path.resolve(shortData.remotion.projet, clip.file),
    `la piste vidéo et le plan 3D désignent le même fichier (${clip.file})`);
  const from = Math.round(clip.t0 * timeline.fps), end = Math.round(clip.t1 * timeline.fps);
  if (from >= end || end >= timeline.frames) throw new Error(`Le montage ne permet pas de tester la fin de ce clip : [${from}, ${end}[ sur ${timeline.frames}`);
  const jump = async (frame) => {
    await p.eval(`document.querySelector('#studioCommands').click(); return 1`);
    await p.until(`document.activeElement.id === 'commandQuery'`);
    await p.type('#' + frame);
    await p.key('Enter', 'Enter', '\r');
    await p.until(`!document.querySelector('#commandPalette').open && __studio.state().frame === ${frame}`, 30000);
  };
  const visible = `getComputedStyle(document.querySelector('#open3d')).display !== 'none'`;
  await jump(end - 1);
  await p.until(visible);
  const label = await p.eval(`return document.querySelector('#open3d').textContent`);
  await jump(end);
  await p.until('!(' + visible + ')');
  check(label.includes('Ouvrir la scène 3D · ' + target.title), `« ${label} » à l’image ${end - 1}, masqué dès la coupe à ${end}`);
} catch (e) {
  check(false, `erreur : ${e.stack ?? e.message}`);
} finally {
  if (p) await p.close();
  kill(a); kill(b);
  try { rebuild?.restore(); } catch (e) { check(false, e.message); }
}
console.log(`\n${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);

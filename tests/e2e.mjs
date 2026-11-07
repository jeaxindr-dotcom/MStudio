// End-to-end test of the studio on the SANDBOX (never the real episode): gestures on the image, queue, send, the
// Claude side (take / snapshot / reply / done), « Envois », undo / redo, the live preview of the code.
// usage: start `node studio-server.mjs E03 --no-open --episodes <sandbox>\07_Episodes --port 4174`, then
//        node tests/e2e.mjs   (screenshots in .cache/shots/)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, requireFrench, requireSandbox } from './cdp.mjs';
import { CACHE } from '../lib/place.mjs';
import { engineCopyFlags, freePort } from './where.mjs';
import { removeTestNotes, closeTestLots, E2E_TEXTS, SANDBOX_TEXTS } from './sandbox-clean.mjs';

process.env.COULISSES_LANG = 'fr';   // the suite checks the French texts (lib/i18n.mjs): the CLI below, and the studio started by hand
const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX = process.env.STUDIO_SANDBOX ?? path.join(STUDIO, 'sandbox', '07_Episodes');   // tests can run on their own copy
const PORT = +(process.env.STUDIO_PORT ?? 4174);
const EP = path.join(SANDBOX, 'E03 - The Secret Garden'), REVUE = path.join(EP, 'revue');
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));   // COULISSES_TEST_SLOW=2: a slower PC
const cli = (...a) => execFileSync('node', [path.join(STUDIO, 'studio-cli.mjs'), ...a.slice(0, 1), 'E03', ...a.slice(1), '--episodes', SANDBOX, ...engineCopyFlags()], { encoding: 'utf8' }).trim();
const shots = path.join(CACHE, 'shots'); fs.mkdirSync(shots, { recursive: true });
let ok = 0, ko = 0;
const check = (cond, what) => { if (cond) { ok++; console.log(`  ✓ ${what}`); } else { ko++; console.log(`  ✗ ${what}`); } };

// what earlier runs of the sandbox tests left behind (their own notes and open batches only: tests/sandbox-clean.mjs)
const TEST_TEXTS = E2E_TEXTS;   // (tests/sandbox-clean.mjs: the texts of every suite of the sandbox)
await requireFrench(URL); await requireSandbox(URL, SANDBOX);   // (never a real episode's studio)
closeTestLots(REVUE, cli, SANDBOX_TEXTS); await removeTestNotes(PORT, SANDBOX_TEXTS);   // (what every suite of the sandbox left: each starts clean)
const p = await launch({ port: await freePort(9333) });
try {
  await p.goto(URL);
  await p.until(`document.querySelector('#v').readyState >= 2`);
  await p.eval(`document.querySelector('#v').currentTime = 1200.5/30; return 1`); await sleep(1500);
  const before = await p.eval('return __studio.state().drafts');
  console.log('gestures');
  // C on Hazel's face
  await p.key('c', 'KeyC', 'c');
  const hz = await p.eval(`const r = document.querySelector('#ov').getBoundingClientRect(); return [r.left + 560 / 1920 * r.width, r.top + 620 / 1080 * r.height]`);   // Hazel's face in the frame
  await p.mouse('mousePressed', hz[0], hz[1]); await p.mouse('mouseReleased', hz[0], hz[1]);
  await p.until(`document.querySelector('#pop').style.display === 'block'`);
  await p.type('Hazel devrait cligner des yeux ici');
  await p.until(`document.querySelector('#popTg').dataset.state === 'done'`, 90000).catch(() => {});
  const tgC = await p.eval(`return document.querySelector('#popTg').textContent`);
  check(/hazel/i.test(tgC), `comment: 3D pick finds Hazel (${tgC})`);
  await p.shot(path.join(shots, 'e2e-1-comment.png'));
  await p.key('Enter', 'Enter', '\r'); await sleep(300);
  // D: two strokes = one drawing (around the gate)
  await p.key('d', 'KeyD', 'd');
  const circle = async (cx, cy, r) => { await p.mouse('mousePressed', cx + r, cy); for (let a = 0; a <= 6.3; a += 0.3) await p.mouse('mouseMoved', cx + r * Math.cos(a), cy + r * Math.sin(a)); await p.mouse('mouseReleased', cx + r, cy); };
  await circle(690, 330, 90); await circle(560, 470, 45);
  await p.until(`document.querySelector('#pop').style.display === 'block'`);
  check((await p.eval('return __studio.state().drawing?.strokes.length')) === 2, 'draw: two strokes in one drawing');
  await p.type('Le portail : plus de lumière');
  await p.until(`document.querySelector('#popTg').dataset.state === 'done'`, 60000).catch(() => {});
  const tgD = await p.eval(`return document.querySelector('#popTg').textContent`);
  check(/flower arch|décor/i.test(tgD), `draw: 3D pick inside the drawing (${tgD})`);
  await p.shot(path.join(shots, 'e2e-2-draw.png'));
  await p.key('Enter', 'Enter', '\r'); await sleep(300);
  // V then A
  await p.key('v', 'KeyV', 'v');
  await p.mouse('mousePressed', 1000, 300); await p.mouse('mouseReleased', 1000, 300);
  check(await p.eval(`return document.querySelector('#pickBtn').style.display !== 'none'`), 'select: « Demander une modif » appears at the pick');
  await p.key('a', 'KeyA', 'a');
  await p.until(`document.querySelector('#pop').style.display === 'block'`);
  await p.type('La glycine de droite bouge trop'); await sleep(2500);
  await p.key('Enter', 'Enter', '\r'); await sleep(800);
  const q = await p.eval(`return { n: __studio.state().drafts, rows: [...document.querySelectorAll('#draftList .card textarea.main')].map(e=>e.value) }`);
  check(q.n === before + 3, `queue: ${q.n} pending edits (${q.rows.join(' | ')})`);
  await p.shot(path.join(shots, 'e2e-3-queue.png'));

  console.log('send');
  await p.eval(`document.querySelector('#qwords').value = 'Test du studio'; return 1`);
  await p.eval(`document.querySelector('#qsend').click(); return 1`);
  await p.until(`document.querySelector('#modal').style.display === 'flex'`, 120000);
  const line = await p.eval(`return document.querySelector('#mLine').textContent`);
  const lot = +/lot (\d+)/.exec(line)[1];
  check(/Coulisses · E03 · lot \d+ \(\d+ modifs?\) → lis ".*\.md" et corrige/.test(line), `paste line: ${line}`);
  await p.shot(path.join(shots, 'e2e-4-sent.png'));
  const md = fs.readFileSync(path.join(REVUE, 'lots', String(lot).padStart(3, '0') + '.md'), 'utf8');
  check(/a entouré \(dessin en 2 traits\)/.test(md) && /a pointé \(/.test(md), 'lot .md: gestures in words');
  // esbuild peut renommer Actor en Actor2 selon les composants présents dans le moteur.
  check(/^- Objet 3D sous le geste : .*\bActor\d*\[key="hazel"/m.test(md), 'lot .md: Hazel named');
  await p.until(`document.querySelector('#lots [data-lot="${lot}"] [data-capture-status="ready"]')`, 120000);
  const dir = path.join(REVUE, 'lots', String(lot).padStart(3, '0'));
  check(fs.existsSync(path.join(dir, '1-marque.jpg')) && fs.existsSync(path.join(dir, '1-zoom.jpg')), 'lot images: frame + marks + zoom');
  await p.eval(`document.querySelector('#mClose').click(); return 1`);
  check((await p.eval('return __studio.state().drafts')) === 0, 'queue emptied after send');

  console.log('Claude side');
  const L = JSON.parse(fs.readFileSync(path.join(REVUE, 'lots', String(lot).padStart(3, '0') + '.json'), 'utf8'));
  console.log('   ' + cli('take', String(lot)));
  await sleep(3500);
  check(await p.eval(`return document.body.innerText.includes("L'agent corrige")`), 'page shows « L\'agent corrige »');
  const dummy = path.join(EP, 'studio-test-file.txt');
  fs.writeFileSync(dummy, 'avant\n');
  console.log('   ' + cli('snapshot', String(lot), dummy));
  fs.writeFileSync(dummy, 'après la correction\n');
  console.log('   ' + cli('frame', '1200', '--source', 'video', '--out', path.join(STUDIO, '.cache', 'shots', 'e2e-eyes-video.jpg')));
  for (const e of L.edits) console.log('   ' + cli('reply', e.id, `Test : modif ${e.k} traitée`, '--status', 'done'));
  console.log('   ' + cli('done', String(lot), 'Lot de test traité'));
  await sleep(3500);
  await p.eval(`document.querySelector('button[data-tab=lots]').click(); return 1`); await sleep(300);
  const lotsTxt = await p.eval(`return document.querySelector('#lots').innerText`);
  check(/corrigé par l'agent/i.test(lotsTxt) && /Annuler cette correction/.test(lotsTxt), '« Envois »: lot done, undo offered');
  check(await p.eval(`return /Afficher dans l'Explorateur/.test(document.querySelector('#renderCard')?.innerText ?? '') && !!document.querySelector('#rcReveal')`), '« Envois » › Rendu: « Afficher dans l\'Explorateur » (the video, selected in its folder)');
  await p.shot(path.join(shots, 'e2e-5-lots.png'));
  // undo from the page (confirm() auto-accepted)
  const card = `#lots [data-lot="${lot}"]`;
  await p.until(`document.querySelector('${card} .un')`);
  await p.eval(`window.confirm = () => true; document.querySelector('${card} .un').click(); return 1`);
  // Le bouton suivant apparaît après la réponse du serveur et le rafraîchissement de la carte.
  await p.until(`document.querySelector('${card} .re')`);
  check(fs.readFileSync(dummy, 'utf8') === 'avant\n', 'undo: the file is back to its state before the batch');
  await p.eval(`document.querySelector('${card} .re').click(); return 1`);
  await p.until(`document.querySelector('${card} .un')`);
  check(fs.readFileSync(dummy, 'utf8') === 'après la correction\n', 'redo: the correction is back');
  fs.writeFileSync(dummy, 'modifié à la main\n');
  await p.eval(`document.querySelector('${card} .un').click(); return 1`);
  await p.until(`/modifié depuis la correction/.test(document.querySelector('${card} .res').textContent)`);
  check(fs.readFileSync(dummy, 'utf8') === 'modifié à la main\n' && /modifié depuis la correction/.test(await p.eval(`return document.querySelector('#lots').innerText`)), 'undo refused when the file changed since');
  fs.rmSync(dummy, { force: true });

  console.log('studio layout');
  const st = await p.eval('return __studio.state()');
  check(['Caméra', 'Lumière', 'Narrateur', 'Hazel', 'Musique', 'Ambiance', 'Bruitages', 'Mix'].every((x) => st.lanes.includes(x)), `timeline tracks: ${st.lanes.join(', ')}`);
  const pk = await (await fetch(`http://localhost:${PORT}/api/peaks?src=%40mix`)).json();
  check(pk.peaks.length > 40000, `waveform of the MP4 mix (${pk.peaks.length} peaks)`);
  await p.eval(`document.querySelector('button[data-tab=insp]').click(); return 1`); await sleep(400);
  check(/Caméra/.test(await p.eval(`return document.querySelector('#insp').innerText`)) && /Musique/.test(await p.eval(`return document.querySelector('#insp').innerText`)), 'inspector: camera, music… at this frame');
  console.log('timeline wheel (DaVinci Resolve style)');
  const r = await p.eval(`const r = document.querySelector('#tl').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]`);
  const wx = r[0] + 300, wy = r[1] + r[3] - 40, s0 = await p.eval('return __studio.state()');
  await p.wheel(wx, wy, 300); await sleep(150);
  const s1 = await p.eval('return __studio.state()');
  check(s1.vscroll > s0.vscroll && s1.view.a === s0.view.a && s1.vzoom === s0.vzoom, `wheel = tracks down (scroll ${s0.vscroll} → ${s1.vscroll})`);
  await p.wheel(wx, wy, -400, 1); await sleep(150);   // Alt
  const s2 = await p.eval('return __studio.state()');
  check(s2.view.b - s2.view.a < s1.view.b - s1.view.a, `Alt+wheel = horizontal zoom (${(s1.view.b - s1.view.a).toFixed(1)} s → ${(s2.view.b - s2.view.a).toFixed(1)} s)`);
  await p.wheel(wx, wy, 300, 2); await sleep(150);    // Ctrl
  const s3 = await p.eval('return __studio.state()');
  check(s3.view.a > s2.view.a && Math.abs((s3.view.b - s3.view.a) - (s2.view.b - s2.view.a)) < 1e-6, `Ctrl+wheel = move in time (${s2.view.a.toFixed(1)} → ${s3.view.a.toFixed(1)} s)`);
  await p.wheel(wx, wy, -300, 8); await sleep(150);   // Shift
  const s4 = await p.eval('return __studio.state()');
  check(s4.vzoom > s3.vzoom, `Shift+wheel = track height (×${s3.vzoom.toFixed(2)} → ×${s4.vzoom.toFixed(2)})`);
  await p.wheel(wx, wy, 300, 8); await sleep(100);
  console.log('pixel-exact targeting (the ladder behind Penelope, image 9050)');
  await p.eval(`document.querySelector('#v').currentTime = 9050.5/30; return 1`); await sleep(1500);
  await p.key('c', 'KeyC', 'c');
  const at = async (x, y, txt) => {
    const q = await p.eval(`const r = document.querySelector('#ov').getBoundingClientRect(); return [r.left + (${x} + 0.5) / 1920 * r.width, r.top + (${y} + 0.5) / 1080 * r.height]`);
    await p.mouse('mousePressed', q[0], q[1]); await p.mouse('mouseReleased', q[0], q[1]);
    await p.until(`document.querySelector('#popTg').dataset.state === 'done'`, 60000).catch(() => {});
    const got = await p.eval(`return document.querySelector('#popTg').textContent`);
    await p.key('Escape', 'Escape'); await sleep(200);
    return got;
  };
  const rung = await at(483, 503); check(/ladder/i.test(rung), `a rung of the ladder → ${rung}`);
  const gap = await at(483, 482); check(!/ladder|penelope/i.test(gap), `between two rungs (transparent) → ${gap}`);
  const hat = await at(470, 600); check(/penelope/i.test(hat), `Penelope's hat → ${hat}`);
  const above = await at(520, 548); check(!/penelope/i.test(above), `just above the hat (transparent around Penelope) → ${above}`);
  await p.shot(path.join(shots, 'e2e-7-library.png'));
  await p.eval(`document.querySelector('#v').currentTime = 1200.5/30; return 1`); await sleep(1200);
  console.log('live preview of the code');
  await p.eval(`document.querySelector('#srcCode').click(); return 1`);
  await p.until(`__studio.state().mode === 'code'`, 60000);
  await sleep(6000);
  await p.shot(path.join(shots, 'e2e-6-code.png'));
  check((await p.eval('return __studio.state().frame')) === 1200, 'code view opens on the same frame');
  await p.key('ArrowRight', 'ArrowRight'); await sleep(600);
  check((await p.eval('return __studio.state().frame')) === 1201, 'stepping works on the code view');
  // a frame not complete is covered and said (fiche du 10/10/2026: long04's chapter junctions showed a grey board the
  // render never has): a video of the frame that is not loaded yet — the preview waits, the veil shows, then goes
  await p.frameEval('player.html', `const d = document, v = d.createElement('video');
    v.id = 'testNotReady'; v.style.cssText = 'position:absolute;left:0;top:0;width:200px;height:120px'; d.getElementById('stage').appendChild(v); return 1`);
  await p.key('ArrowRight', 'ArrowRight'); await sleep(700);
  const w1 = await p.eval(`const e = document.querySelector('#codeWait'); return { on: e.classList.contains('on') || e.classList.contains('pend'), op: +getComputedStyle(e).opacity, txt: e.innerText.trim(), ready: window.__preview.frameReady() }`);
  await p.frameEval('player.html', `document.getElementById('testNotReady').remove(); return 1`); await sleep(900);
  const w2 = await p.eval(`const e = document.querySelector('#codeWait'); return { on: e.classList.contains('on') || e.classList.contains('pend'), op: +getComputedStyle(e).opacity }`);
  check(w1.on && w1.op > 0.9 && !w1.ready && /Image en cours de chargement/.test(w1.txt) && !w2.on && w2.op < 0.05, `a frame whose video is still loading: covered (« ${w1.txt.split('\n')[0]} »), then shown once complete`);
  await p.key('ArrowLeft', 'ArrowLeft'); await sleep(600);
  // the arrow held (fast rewind ×2): the frames go by, no veil — even with a video of the frame not loaded (user report
  // 15/10/2026: « ça s'affiche quand je fais avance rapide ou retour rapide… je ne peux pas juger de façon fluide »);
  // released, the frame where it stops is covered while not complete
  await p.frameEval('player.html', `const d = document, v = d.createElement('video');
    v.id = 'testNotReady'; v.style.cssText = 'position:absolute;left:0;top:0;width:200px;height:120px'; d.getElementById('stage').appendChild(v); return 1`);
  const veilOp = () => p.eval(`return +getComputedStyle(document.querySelector('#codeWait')).opacity`);
  const f0 = await p.eval('return __studio.state().frame');
  await p.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', bubbles: true })); return 1`);
  const seen = []; for (let i = 0; i < 10; i++) { await sleep(150); seen.push(await veilOp()); }
  await p.eval(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', code: 'ArrowLeft', bubbles: true })); return 1`);
  const f1 = await p.eval('return __studio.state().frame');
  await sleep(700);
  const atStop = await veilOp();
  await p.frameEval('player.html', `document.getElementById('testNotReady').remove(); return 1`); await sleep(900);
  const after = await veilOp();
  check(f0 - f1 > 20 && seen.slice(3).every((o) => o < 0.05) && atStop > 0.9 && after < 0.05, `the arrow held: ${f0 - f1} frames back with no veil (${seen.map((o) => o.toFixed(1)).join(' ')}); released on a frame still loading: covered, then shown`);
  // and forward (fast forward ×2: the preview plays), the same
  await p.frameEval('player.html', `const d = document, v = d.createElement('video');
    v.id = 'testNotReady'; v.style.cssText = 'position:absolute;left:0;top:0;width:200px;height:120px'; d.getElementById('stage').appendChild(v); return 1`);
  const g0 = await p.eval('return __studio.state().frame');
  await p.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true })); return 1`);
  const seenF = []; for (let i = 0; i < 10; i++) { await sleep(150); seenF.push(await veilOp()); }
  await p.eval(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true })); return 1`);
  const g1 = await p.eval('return __studio.state().frame');
  await p.frameEval('player.html', `document.getElementById('testNotReady').remove(); return 1`); await sleep(900);
  check(g1 - g0 > 20 && seenF.slice(3).every((o) => o < 0.05) && (await veilOp()) < 0.05, `the arrow held forward: ${g1 - g0} frames with no veil (${seenF.map((o) => o.toFixed(1)).join(' ')})`);
  // the composition failing in the preview (user report 16/10/2026: E10 all black with a lone « ⚠ », stuck): the error
  // said over the picture, kept in revue\preview-errors.log, a note for the agent; the next move mounts the Player again
  const logF = path.join(REVUE, 'preview-errors.log'), log0 = fs.existsSync(logF) ? fs.statSync(logF).size : 0;
  await p.eval(`window.__preview.__crash(); return 1`);
  await p.until(`document.querySelector('#codeCrash').classList.contains('on')`, 15000).catch(() => {});
  const ce = await p.eval(`const e = document.querySelector('#codeCrash'); return { on: getComputedStyle(e).display !== 'none', txt: e.innerText, crashed: !!window.__preview.crashed() }`);
  await sleep(800);
  const logged = fs.existsSync(logF) && fs.statSync(logF).size > log0 && /plantage volontaire/.test(fs.readFileSync(logF, 'utf8'));
  check(ce.on && ce.crashed && /L'aperçu du code a planté à l'image \d+/.test(ce.txt) && /plantage volontaire/.test(ce.txt) && /Réessayer/.test(ce.txt) && logged,
    `an error of the composition: said over the picture (« ${ce.txt.split('\n')[0]} »), written to revue\\preview-errors.log`);
  await p.shot(path.join(shots, 'e2e-7-crash.png'));
  const nb = await p.eval('return __studio.state().drafts');
  await p.eval(`document.querySelector('#ceNote').click(); return 1`); await sleep(400);
  const noteTxt = await p.eval(`const c = [...document.querySelectorAll('#draftList .card textarea.main')].map((t) => t.value).find((v) => /aperçu du code plante/.test(v)); return c ?? ''`);
  check((await p.eval('return __studio.state().drafts')) === nb + 1 && /plantage volontaire/.test(noteTxt), `« Créer une note pour l'agent »: a note at that frame (${noteTxt.slice(0, 70)}…)`);
  await p.key('ArrowRight', 'ArrowRight'); await sleep(600);
  await p.until(`!window.__preview.crashed() && window.__preview.frameReady()`, 120000).catch(() => {});
  for (let i = 0; i < 240 && !(await p.frameEval('player.html', `return !!document.querySelector('canvas')`)); i++) await sleep(500);   // (the preview: its own process)
  await sleep(1500);
  const back = { ...(await p.eval(`return { on: document.querySelector('#codeCrash').classList.contains('on'), crashed: !!window.__preview.crashed() }`)),
    ...(await p.frameEval('player.html', `return { canvas: !!document.querySelector('canvas'), fallback: /⚠/.test(document.getElementById('root').innerText) }`)) };
  check(!back.on && !back.crashed && back.canvas && !back.fallback, `the next move: the Player mounted again, the scene drawn (no « ⚠ » left) ${JSON.stringify(back)}`);
  // a heavy scene mounting FREEZES the preview while it plays (03/11/2026, 宇宙ちゃん long07: 6 s, then 2758 → 2944): it goes
  // on from the frame it froze at, nothing skipped; and a pause asked during a freeze stops on the frame that was shown
  {
    // Le garde protège une lecture établie. Un délai après play pouvait expirer
    // encore à l'image 300, pendant le chargement de la scène.
    await p.eval('await window.__preview.prepare(300); await window.__preview.play()');
    await p.until('__preview.isPlaying() && __preview.frame() >= 360 && !__preview.isBuffering()');
    const before = await p.frameEval('player.html', `const f = StudioPlayer.frame(); setTimeout(() => { const t = performance.now(); while (performance.now() - t < 2500) {} }, 0); return f`);
    await sleep(3200);
    const after = await p.eval('return window.__preview.frame()');
    check(after > before && after - before < 45, `a freeze of 2.5 s while playing: the playback goes on where it froze (${before} → ${after}, no 75 frames skipped)`);
    await p.frameEval('player.html', `setTimeout(() => { const t = performance.now(); while (performance.now() - t < 2500) {} }, 0); return 1`);
    await sleep(400);
    const shown = await p.eval('return window.__preview.frame()');
    await p.eval(`window.__preview.pause(); return 1`);
    await sleep(3500);
    const stopped = await p.eval('return { f: window.__preview.frame(), playing: window.__preview.isPlaying() }');
    check(!stopped.playing && Math.abs(stopped.f - shown) <= 3, `a pause asked during a freeze: stopped on the frame shown (${shown} → ${JSON.stringify(stopped)})`);
  }
  // the preview FROZEN (user report 31/10/2026, Lesson 1: « L'aperçu ne répond plus depuis 30 secondes », and « Réessayer »
  // did nothing — the new preview was prepared behind the frozen one, in the same renderer process, frozen with it)
  const fBefore = await p.eval('return __studio.state().frame');
  const oldOrigin = await p.eval('return new URL(document.querySelector("#code").src).origin');
  await p.frameEval('player.html', `setTimeout(() => { for (;;) {} }, 50); return 1`);
  await p.until(`document.querySelector('#codeCrash').classList.contains('on') && /ne répond plus/.test(document.querySelector('#codeCrash').innerText)`, 60000).catch(() => {});
  const frozen = await p.eval(`return /ne répond plus/.test(document.querySelector('#codeCrash').innerText) && document.querySelector('#codeCrash').classList.contains('on')`);
  await p.eval(`document.querySelector('#ceRetry').click(); return 1`);
  await p.until(`window.__preview && !window.__preview.crashed() && window.__preview.frameReady()`, 150000).catch(() => {});
  await sleep(1500);
  const revived = await p.eval(`return { on: document.querySelector('#codeCrash').classList.contains('on'), ok: !!window.__preview && !window.__preview.crashed() && window.__preview.frameReady(), frame: __studio.state().frame, frames: document.querySelectorAll('iframe[src*="player.html"]').length }`);
  const newOrigin = await p.eval('return new URL(document.querySelector("#code").src).origin');
  check(frozen && !revived.on && revived.ok && Math.abs(revived.frame - fBefore) <= 2 && revived.frames === 1 && newOrigin !== oldOrigin,
    `a frozen preview: « ne répond plus » said, then « Réessayer » destroys it and loads a new one at the same image ${JSON.stringify({ frozen, ...revived, fBefore })}`);
  await p.eval(`document.querySelector('#srcVideo').click(); return 1`); await sleep(500);
  check((await p.eval('return __studio.state().mode')) === 'video', 'back to the MP4');
  // the preview stopped by an error while the MP4 is shown (user bug 17/10/2026, E11: « le pointeur ne détecte plus les
  // éléments » — the hidden preview had stopped at a frame with 49 sounds at once, and nothing said it): the pointer moved
  // over the image mounts it again, and it names what is under it again
  await p.key('v', 'KeyV', 'v'); await sleep(200);
  await p.eval(`window.__preview.__crash(); return 1`);
  await p.until(`window.__preview.crashed()`, 15000).catch(() => {});
  const crashedBehind = await p.eval(`return !!window.__preview.crashed()`);
  const ovr = await p.eval(`const r = document.querySelector('#ov').getBoundingClientRect(); return [r.left + r.width * 0.5, r.top + r.height * 0.6]`);
  let named = '';
  for (let i = 0; i < 60 && !named; i++) {
    await p.mouse('mouseMoved', ovr[0] + (i % 7) * 6, ovr[1] + (i % 4) * 5); await sleep(500);
    named = await p.eval(`const t = document.querySelector('#hoverTag'); return t.style.display === 'block' && !window.__preview.crashed() ? t.textContent : ''`);
  }
  check(crashedBehind && !!named, `the preview stopped behind the MP4: the pointer mounts it again, and names again (« ${named} »)`);
  // ↑ / ↓: the previous / next edit point, exactly on the cut (as DaVinci; 10/10/2026: « je n'arrive pas à placer la tête
  // de lecture pile poil sur cette jonction de clip »); the playhead drawn at the start of its frame, where the cut is
  await p.eval(`document.querySelector('#v').currentTime = 9050.5/30; return 1`); await sleep(800);
  // the cuts of the plan (the sets' arrivals and leavings, the 3D shots), as the page reads them
  const cuts = await p.eval(`const r = await (await fetch('/api/meta')).json(), S = r.snapshot, F = r.fps || 30, s = new Set(), add = (t) => { if (Number.isFinite(t)) s.add(Math.round(t * F)); };
    for (const w of S.sets) { add(w.inT); add(w.inT + (w.inDur ?? 0)); if (w.outT !== null && w.outT !== undefined) { add(w.outT); add(w.outT + (w.outDur ?? 0)); } }
    for (const c of S.cutaways ?? []) { add(c.t); add(c.t + c.dur); } return [...s].sort((a, b) => a - b)`);
  await p.key('ArrowDown', 'ArrowDown'); await sleep(500);
  const nx = await p.eval('return __studio.state().frame');
  await p.key('ArrowUp', 'ArrowUp'); await sleep(500);
  const pv = await p.eval('return __studio.state().frame');
  const wantN = cuts.find((x) => x > 9050), wantP = [...cuts].reverse().find((x) => x < wantN);
  check(nx === wantN && pv === wantP, `↓ from frame 9050: exactly on the next cut (${nx}); ↑: on the cut before (${pv})`);
} catch (e) {
  ko++; console.error(e.stack ?? e);
} finally {
  const errs = p.logs.filter((l) => /exception|\[error\]/.test(l) && !/WebGL|X4000/.test(l));
  if (errs.length) console.log('page errors:\n' + errs.slice(0, 5).join('\n'));
  await p.close();
  console.log(`\n${ok} ok, ${ko} échec(s)`);
  process.exit(ko ? 1 : 0);
}

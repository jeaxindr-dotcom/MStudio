// The studio opened in a TAB of a normal Chrome (user report 24/10/2026: « quand j'appuie sur lecture, la lecture ne se
// lance pas », « le son ne marche plus », « Rétablir le son ne fonctionne pas »): there, unlike the Coulisses window
// (app/Launcher.cs: --autoplay-policy=no-user-gesture-required), the live preview — a frame of another origin (its own
// process) — may start its sound only if the page lends it its click (<iframe allow="autoplay">); without it, Remotion's
// Player waits for its sound to start and the video does not move, or it mutes itself. On the sample project of
// tests/coulisses-fixture.mjs, a Chrome with Chrome's own rule (silent: tests/cdp.mjs), REAL clicks of the mouse:
//   1. « Lecture »: the video moves, with its sound;
//   2. a new version of the code (a new frame: the agent's fix), « Lecture » again: the same;
//   3. « Rétablir le son » à l'arrêt, puis Lecture : reprise vérifiée sur place avec les règles d'autoplay d'un onglet.
// usage: node tests/sound-tab.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, requireSandbox } from './cdp.mjs';
import { makeFixture, RUN, PROJET } from './coulisses-fixture.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCR = path.join(STUDIO, '.cache', 'sound-tab');
const PORT = 4189, URL = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));
let ok = 0, ko = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };

fs.rmSync(SCR, { recursive: true, force: true }); fs.mkdirSync(SCR, { recursive: true });
fs.writeFileSync(path.join(SCR, 'settings.json'), JSON.stringify({ lang: 'fr' }));
makeFixture();
process.env.STUDIO_PROJECTS = path.join(SCR, 'projets.json'); process.env.COULISSES_SETTINGS = path.join(SCR, 'settings.json'); process.env.COULISSES_LANG = 'fr';
process.env.COULISSES_REVIEW_SOUND = '0';   // (the preview's OWN sound tested here: the review sound off — tests/review-sound.mjs)
const { importProject } = await import('../lib/projects.mjs');
const IMP = importProject(RUN);
const st = spawn(process.execPath, [path.join(STUDIO, 'studio-server.mjs'), '--project', IMP.revue, '--no-open', '--port', String(PORT)], { cwd: STUDIO, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; st.stdout.on('data', (d) => { out += d; }); st.stderr.on('data', (d) => { out += d; });
for (let i = 0; i < 160 && !/http:\/\/127/.test(out); i++) await sleep(250);
await requireSandbox(URL, path.join(STUDIO, '.cache'));
const p = await launch({ port: 9367, autoplay: 'tab' });
const ev = (e) => p.eval(e).catch(() => null);
const until = async (expr, ms = 60000) => { const t0 = Date.now(); for (;;) { if (await ev(`return !!(${expr})`)) return true; if (Date.now() - t0 > ms) return false; await sleep(250); } };
const shown = () => ev(`const f = document.querySelector('#code'); return f && f.src && !document.querySelector('iframe.code-next') ? new URL(f.src).search : null`);
// a click of the mouse, as the user's (a click() from a script is not one: Chrome lends nothing to it)
const click = async (sel) => {
  const r = await ev(`const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]`);
  await p.mouse('mouseMoved', r[0], r[1]); await p.mouse('mousePressed', r[0], r[1]); await p.mouse('mouseReleased', r[0], r[1]);
};
async function sound() {
  const s = await shown(); if (!s) return null;
  return p.frameEval(s, `const P = window.StudioPlayer, C = window.__coulissesAudio ?? [], c = C[C.length - 1], au = [...document.querySelectorAll('audio')];
    const t0 = au.map((a) => a.currentTime), c0 = c?.currentTime ?? 0, f0 = P.frame(), w0 = performance.now();
    const going = () => au.filter((a, i) => a.src && !a.paused && !a.muted && a.volume > 0 && Math.abs(a.currentTime - t0[i]) > 0.05).length;
    while (performance.now() - w0 < 2500 && (performance.now() - w0 < 1000 || !going())) await new Promise((r) => setTimeout(r, 100));
    const s = (performance.now() - w0) / 1000;
    return { playing: P.isPlaying(), muted: P.isMuted(), moved: P.frame() - f0, ctx: c?.state ?? null, clock: +(((c?.currentTime ?? 0) - c0) / s).toFixed(2), going: going() }`).catch(() => null);
}
const good = (s) => !!s && s.playing && !s.muted && s.moved > 10 && s.ctx === 'running' && s.clock > 0.5 && s.going > 0;
const pauseAt = async (f) => { if (await ev('return window.__preview.isPlaying()')) { await click('#bPlay'); await sleep(400); } await ev(`window.__preview.seek(${f}); return 1`); await sleep(700); };
try {
  await p.goto(URL);
  check(await until(`window.__studio && __studio.state().mode === 'code' && window.__preview?.durationInFrames > 1`, 120000), 'the studio on the live code, in a tab of a normal Chrome');
  await sleep(2500);
  // ---------- 1. « Lecture » ----------
  await pauseAt(20); await click('#bPlay'); await sleep(1500);
  const s1 = await sound();
  check(good(s1), `« Lecture »: the video moves, with its sound (${JSON.stringify(s1)})`);
  // ---------- 2. a new version of the code ----------
  await pauseAt(20);
  const v0 = await shown(), runTs = path.join(PROJET, 'src', 'runs', 'essai.ts');
  fs.writeFileSync(runTs, fs.readFileSync(runTs, 'utf8').replace("titre: 'Le sujet'", "titre: 'Le sujet (corrigé)'"));
  let v1 = v0; for (let i = 0; i < 120 && (!v1 || v1 === v0); i++) { await sleep(500); v1 = await shown(); }
  await sleep(1500);
  await pauseAt(20); await click('#bPlay'); await sleep(1500);
  const s2 = await sound();
  check(v1 !== v0 && good(s2), `a new version of the code (a new frame), « Lecture »: the same (${JSON.stringify(s2)})`);
  // ---------- 3. « Rétablir le son » ----------
  await pauseAt(20);
  await click('#bSound');
  await p.until('/lecture/i.test(document.querySelector("#save").textContent)');
  await click('#bPlay');
  await p.until('/rétabli/i.test(document.querySelector("#save").textContent)');
  const s3 = await sound();
  check(await shown() === v1 && good(s3), `« Rétablir le son » puis Lecture dans le même aperçu (${JSON.stringify(s3)})`);
  // En onglet soumis à la règle d'autoplay, exercer aussi le vrai repli à l'arrêt.
  await pauseAt(20);
  await p.frameEval(v1, 'await __coulissesAudio[0].close()');
  await click('#bSound');
  await p.until('new URL(document.querySelector("#code").src).search !== ' + JSON.stringify(v1) + ' && /lecture/i.test(document.querySelector("#save").textContent)');
  check(await ev('return __preview.frame() === 20 && !__preview.isPlaying() && !/rétabli/i.test(document.querySelector("#save").textContent)'),
    'Contexte fermé, aperçu neuf à l’image 20 et aucune annonce anticipée');
  await click('#bPlay'); await p.until('/rétabli/i.test(document.querySelector("#save").textContent)');
  check(good(await sound()), 'Le clic de Lecture autorise et confirme le son de la nouvelle iframe en onglet');
  await click('#bPlay');
} catch (e) { ko++; console.log('  ✗ ERREUR', e.stack); } finally {
  await p.close(); st.kill();
  if (ko) console.log(p.logs.filter((x) => /audio|AudioContext|autoplay|gesture|mute/i.test(x)).slice(-6).join('\n'));
}
console.log(`\n${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);

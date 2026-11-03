// A smooth playback of the live preview (user request 25/10/2026: « il y a pas moyen d'avoir une lecture fluide dès le
// début ? »): every visual sequence premounted ahead (player/sequence-window.tsx) — its assets loaded while the scene
// before plays —, the wait (player/assets-wait.tsx) for a premount's load only at its scene's start. On the sample project
// of tests/coulisses-fixture.mjs, its scene s02 (frames 90-210) slow to mount, premounted 1.5 s ahead (COULISSES_PREMOUNT:
// from frame 45, while s01 plays), a Chrome with Chrome's own rule on sound, silent, a real click on « Lecture » from 0:
//   1. s02 loading in 1 s: the whole playback smooth — never a wait, never s02 without its scene;
//   2. s02 loading in 2.5 s: the scene before never waits for it; the wait (if any) at s02's start, then on, never black.
// usage: node tests/preview-premount.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, requireSandbox } from './cdp.mjs';
import { makeFixture, RUN } from './coulisses-fixture.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCR = path.join(STUDIO, '.cache', 'preview-premount');
const PORT = 4189, URL = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));
let ok = 0, ko = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };
process.env.COULISSES_LANG = 'fr'; process.env.COULISSES_PREMOUNT = '1.5';

// one studio on the sample, its s02 loading in `slow` ms; a playback from 0 sampled every 50 ms in the preview
async function run(slow, steps = null) {
  fs.rmSync(SCR, { recursive: true, force: true }); fs.mkdirSync(SCR, { recursive: true });
  fs.writeFileSync(path.join(SCR, 'settings.json'), JSON.stringify({ lang: 'fr' }));
  makeFixture({ slowScene: slow, premount: 45, master: true });
  process.env.STUDIO_PROJECTS = path.join(SCR, 'projets.json'); process.env.COULISSES_SETTINGS = path.join(SCR, 'settings.json');
  const { importProject } = await import('../lib/projects.mjs');
  const IMP = importProject(RUN);
  const st = spawn(process.execPath, [path.join(STUDIO, 'studio-server.mjs'), '--project', IMP.revue, '--no-open', '--port', String(PORT)], { cwd: STUDIO, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; st.stdout.on('data', (d) => { out += d; }); st.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 160 && !/http:\/\/127/.test(out); i++) await sleep(250);
  await requireSandbox(URL, path.join(STUDIO, '.cache'));
const p = await launch({ port: 9381, autoplay: 'tab' });
  const ev = (e) => p.eval(e).catch(() => null);
  const until = async (expr, ms = 60000) => { const t0 = Date.now(); for (;;) { if (await ev(`return !!(${expr})`)) return true; if (Date.now() - t0 > ms) return false; await sleep(250); } };
  const shown = () => ev(`const f = document.querySelector('#code'); return f && f.src && !document.querySelector('iframe.code-next') ? new URL(f.src).search : null`);
  const click = async (sel) => { const r = await ev(`const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]`); await p.mouse('mouseMoved', r[0], r[1]); await p.mouse('mousePressed', r[0], r[1]); await p.mouse('mouseReleased', r[0], r[1]); };
  try {
    await p.goto(URL);
    if (!(await until(`window.__studio && __studio.state().mode === 'code' && window.__preview?.durationInFrames > 1`, 120000))) { console.log('   (studio :', out.split(String.fromCharCode(10)).filter(Boolean).slice(-4).join(' | ').slice(0, 600), '| page :', JSON.stringify(p.logs.filter((l) => /error|erreur|Error/i.test(l)).slice(-4)).slice(0, 900), ')'); return null; }
    await sleep(2500);
    const s = await shown();
    if (steps) return await steps({ p, ev, s, until });
    await ev('window.__preview.seek(0); return 1'); await sleep(1200);
    await p.frameEval(s, `window.__smp = []; const t0 = performance.now(); window.__tk = setInterval(() => { const P = window.StudioPlayer; window.__smp.push({ t: Math.round(performance.now() - t0), f: P.frame(), scene: !!document.querySelector('[data-coulisses="titre s02"]') }); }, 50); return 1`);
    await click('#bPlay');
    await sleep(6500);
    const smp = await p.frameEval(s, 'clearInterval(window.__tk); return window.__smp');
    await click('#bPlay');
    return smp;
  } finally { await p.close(); st.kill(); await sleep(800); }
}
// the longest time the picture stood still while playing, in a range of frames
const stall = (smp, a, b) => { let best = 0, run = 0; for (let i = 1; i < smp.length; i++) { const x = smp[i]; if (x.f < a || x.f > b) { run = 0; continue; } run = x.f === smp[i - 1].f ? run + 50 : 0; best = Math.max(best, run); } return best; };
try {
  console.log('s02 chargée en 1 s (préchargée dès l\'image 45)');
  const A = await run(1000);
  check(!!A && A.length > 60, 'the playback sampled');
  if (A) {
    const blackA = A.filter((x) => x.f >= 93 && x.f < 205 && !x.scene).length;
    check(stall(A, 2, 200) < 300 && blackA === 0 && A.at(-1).f > 180, `the whole playback smooth: never stood still more than ${stall(A, 2, 200)} ms, s02 never without its scene (${blackA}), at frame ${A.at(-1).f}`);
  }
  console.log('s02 chargée en 2,5 s');
  const B = await run(2500);
  if (B) {
    const blackB = B.filter((x) => x.f >= 93 && x.f < 205 && !x.scene).length;
    check(stall(B, 2, 85) < 300, `the scene before never waits for the next one's premount (stood still at most ${stall(B, 2, 85)} ms in s01)`);
    check(blackB === 0 && B.at(-1).f > 120, `then the wait at s02's start (${stall(B, 86, 95)} ms there), never black (${blackB}), on to frame ${B.at(-1).f}`);
  } else check(false, 'the second playback sampled');
  // a scene LEFT stays mounted (player/sequence-window.tsx KEEP_S, 03/11/2026: « quand je fais demi-tour pour voir ce que
  // j'ai loupé, ça bug encore »): back into s02 after s03, its scene is there at once, not prepared again (2.5 s)
  console.log('retour en arrière sur s02 (2,5 s de préparation) après s03');
  const back = await run(2500, async ({ p, ev, s, until }) => {
    const has = () => p.frameEval(s, `return !!document.querySelector('[data-coulisses="titre s02"]')`);
    await ev('window.__preview.seek(150); return 1');
    for (let i = 0; i < 60 && !(await has()); i++) await sleep(250);
    const first = await has();
    await ev('window.__preview.seek(260); return 1'); await sleep(1500);
    await ev('window.__preview.seek(150); return 1');
    const t0 = Date.now(); let ms = null;
    for (let i = 0; i < 80; i++) { if (await p.frameEval(s, `const e = document.querySelector('[data-coulisses="titre s02"]'); return !!e && getComputedStyle(e.closest('div')).opacity !== '0' && window.StudioPlayer.frame() === 150`)) { ms = Date.now() - t0; break; } await sleep(50); }
    return { first, ms };
  });
  check(!!back?.first && back.ms !== null && back.ms < 1200, `back into a scene already seen: there at once (${back?.ms} ms, not 2.5 s again)`);
} catch (e) { ko++; console.log('  ✗ ERREUR', e.stack); }
console.log(`\n${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);

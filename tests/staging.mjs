// « Mise en scène » end to end (SANDBOX): M, click the ladder in the live preview, nudge it with the arrows, add it to
// the queue (offset + after image + pin), free camera, send: the batch tells Claude the exact offset.
// usage: start a studio server on a sandbox (STUDIO_PORT / STUDIO_SANDBOX as tests/e2e.mjs), then node tests/staging.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { launch, requireFrench, requireSandbox } from './cdp.mjs';
import { CACHE } from '../lib/place.mjs';
import { removeTestNotes, closeTestLots, STAGING_TEXTS, SANDBOX_TEXTS } from './sandbox-clean.mjs';
process.env.COULISSES_LANG = 'fr';   // the suite checks the French texts (lib/i18n.mjs) of the studio started by hand
const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX = process.env.STUDIO_SANDBOX ?? path.join(STUDIO, 'sandbox', '07_Episodes');
const PORT = +(process.env.STUDIO_PORT ?? 4174);
const REVUE = path.join(SANDBOX, 'E03 - The Secret Garden', 'revue');
const shots = path.join(CACHE, 'shots'); fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));   // COULISSES_TEST_SLOW=2: a slower PC
let ok = 0, ko = 0; const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };
await requireFrench(`http://localhost:${PORT}/`); await requireSandbox(`http://localhost:${PORT}/`, SANDBOX);   // (never a real episode's studio)
// what earlier runs left behind (08/10/2026: the ladder's « Mise en scène » note of the previous run, still a draft, put
// its +0.20 back in the preview before the arrows, so the next run read +0.40): its own notes and open batches only
const cli = (...a) => execFileSync('node', [path.join(STUDIO, 'studio-cli.mjs'), ...a.slice(0, 1), 'E03', ...a.slice(1), '--episodes', SANDBOX], { encoding: 'utf8' }).trim();
const TEST_TEXTS = STAGING_TEXTS;   // (tests/sandbox-clean.mjs: the texts of every suite of the sandbox)
closeTestLots(REVUE, cli, SANDBOX_TEXTS); await removeTestNotes(PORT, SANDBOX_TEXTS);   // (what every suite of the sandbox left: each starts clean)
const p = await launch({ port: 9370 });
try {
  await p.goto(`http://localhost:${PORT}/`);
  await p.until(`document.querySelector('#v').readyState >= 2`);
  await p.eval(`document.querySelector('#v').currentTime = 9050.5/30; return 1`); await sleep(1200);
  await p.key('m', 'KeyM', 'm');
  await p.until(`__studio.state().staging`, 90000);
  check(await p.eval(`return __studio.state().staging && __studio.state().mode === 'code' && __studio.state().tab === 'scene'`), 'M: staging on, in the live preview, panel « Scène »');
  await sleep(4000);
  const at = await p.eval(`const r = document.querySelector('#media').getBoundingClientRect(); return [r.left + 483.5 / 1920 * r.width, r.top + 503.5 / 1080 * r.height]`);
  await p.mouse('mousePressed', at[0], at[1]); await p.mouse('mouseReleased', at[0], at[1]);
  await p.until(`__studio.state().stage`, 20000);
  const sel = await p.eval(`return __studio.state().stage`);
  check(/set_ladder/.test(sel ?? ''), `click on the ladder selects it (${sel})`);
  const before = await p.eval(`return window.__preview.stage.screenPos(${JSON.stringify(sel)})`);
  for (let i = 0; i < 4; i++) { await p.key('ArrowRight', 'ArrowRight'); await sleep(80); }
  await sleep(600);
  const list = await p.eval(`return window.__preview.stage.list()`);
  const dx = list.find((x) => x.id === sel)?.delta.p[0];
  check(Math.abs(dx - 0.2) < 1e-6, `→ ×4 moves it by +0.20 in x (${dx})`);
  const after = await p.eval(`return window.__preview.stage.screenPos(${JSON.stringify(sel)})`);
  check(after[0] > before[0] + 5, `the ladder moved right on the image (${before[0]} → ${after[0]} px)`);
  check(await p.eval(`return document.querySelector('#sc-x').value`) === '0.200', 'the panel shows Δx 0.200');
  await p.shot(path.join(shots, 'staging-1-moved.png'));
  // the same keys with the focus on the panel, outside the preview
  const f0 = await p.eval(`return __studio.state().frame`);
  await p.eval(`const s = document.querySelector('#scene'); s.setAttribute('tabindex', '-1'); window.focus(); s.focus(); return document.activeElement === s`);
  await p.key('ArrowUp', 'ArrowUp'); await sleep(400);
  const dy = (await p.eval(`return window.__preview.stage.list()`)).find((x) => x.id === sel)?.delta.p[1];
  check(Math.abs(dy - 0.05) < 1e-6 && (await p.eval(`return __studio.state().frame`)) === f0, `↑ with the focus on the panel nudges the object, not the frame (Δy ${dy})`);
  await p.key('ArrowDown', 'ArrowDown'); await sleep(400);
  // add to the queue
  const d0 = await p.eval(`return __studio.state().drafts`);   // (another suite's drafts may be there)
  await p.eval(`document.querySelector('#sc-add').click(); return 1`);
  await p.until(`__studio.state().drafts > ${d0}`, 20000); await sleep(1500);
  const draft = await p.eval(`const r = await (await fetch('/api/notes')).json(); return r.notes.find((n) => n.draft && n.stage)`);
  check(!!draft && Math.abs(draft.stage.delta.p[0] - 0.2) < 1e-6 && draft.stage.scope.kind === 'scene', `the queue holds the offset (${draft?.text})`);
  check((draft?.images ?? []).some((im) => im.label?.startsWith('après')) && draft?.mark?.kind === 'pin', 'with the after image and a pin on the object');
  // free camera
  await p.eval(`document.querySelector('#sc-cam').click(); return 1`); await sleep(300);
  await p.mouse('mousePressed', at[0] + 200, at[1] - 100, 'middle');
  for (let i = 1; i <= 12; i++) await p.mouse('mouseMoved', at[0] + 200 + i * 12, at[1] - 100 + i * 2, 'middle');
  await p.mouse('mouseReleased', at[0] + 344, at[1] - 76, 'middle');
  await sleep(800); await p.shot(path.join(shots, 'staging-2-freecam.png'));
  await p.eval(`document.querySelector('#sc-cam0')?.click(); return 1`); await sleep(400);
  await p.key('m', 'KeyM', 'm'); await sleep(500);
  check(!(await p.eval(`return __studio.state().staging`)), 'M again: staging off');
  // send
  await p.eval(`document.querySelector('button[data-tab=queue]').click(); return 1`);
  await p.eval(`document.querySelector('#qsend').click(); return 1`);
  await p.until(`document.querySelector('#modal').style.display === 'flex'`, 120000);
  const lot = +/lot (\d+)/.exec(await p.eval(`return document.querySelector('#mLine').textContent`))[1];
  const md = fs.readFileSync(path.join(REVUE, 'lots', String(lot).padStart(3, '0') + '.md'), 'utf8');
  check(/Mise en scène proposée/.test(md) && /Δx 0\.200/.test(md) && /set_ladder/.test(md), 'the batch tells Claude the exact offset (Δx 0.200, the ladder)');
  console.log(md.split('\n').filter((l) => /Mise en scène|Décalage|Transformation|Portée|après le déplacement/.test(l)).map((l) => '     ' + l.slice(0, 200)).join('\n'));
  // the live preview asleep behind the MP4, awake when shown (09/10/2026: « met du temps à charger »: it is preloaded
  // behind the MP4, and must cost nothing there); a texture the browser already has is not sent again (304)
  await p.eval(`document.querySelector('#modal').style.display = 'none'; document.querySelector('#srcVideo').click(); return 1`); await sleep(800);
  const draws = () => p.frameEval('player.html', `const c = document.querySelector('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
    let n = 0; const o = gl.drawElements.bind(gl); gl.drawElements = (...x) => { n++; return o(...x); }; await new Promise((r) => setTimeout(r, 1000)); gl.drawElements = o; return n`);
  const asleep = await draws();
  await p.eval(`document.querySelector('#srcCode').click(); return 1`); await sleep(800);
  const awake = await draws();
  check(asleep === 0 && awake > 50, `the live preview draws nothing behind the MP4 (${asleep} draw calls in 1 s), and again once shown (${awake})`);
  const png = await p.frameEval('player.html', `return performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\\/public\\/.+\\.png/.test(n))`);
  const r1 = png ? await fetch(png) : null, etag = r1?.headers.get('etag');
  const r2 = etag ? await fetch(png, { headers: { 'If-None-Match': etag } }) : null;
  check(!!etag && r2?.status === 304, `a texture already received is not sent again (ETag ${etag}, then 304)`);
} catch (e) { ko++; console.log('  ✗ ERREUR', e.message); } finally {
  const errs = p.logs.filter((l) => /exception|\[error\]/.test(l) && !/WebGL|X4000/.test(l));
  if (errs.length) console.log('page errors:\n' + errs.slice(0, 5).join('\n'));
  await p.close(); console.log(`\n${ok} ok, ${ko} échec(s)`); process.exit(ko ? 1 : 0);
}

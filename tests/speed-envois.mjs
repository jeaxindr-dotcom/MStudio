// « Vitesse » in « Envois », for any project (user request 14/10/2026: « dans l'onglet d'envoi, peu importe le projet »):
// on a plain imported video (nothing real is touched): the dial at the bottom of the card, turned with the wheel; « Créer
// la copie ×2 » makes « <nom>-x2.mp4 » next to the video, half as long, its progress and its end in the card; the studio
// keeps reviewing the ×1 video; the dial survives the card being drawn again while the copy is made.
// usage: node tests/speed-envois.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, requireSandbox } from './cdp.mjs';
import { freePort } from './where.mjs';
import { waitForRenderIdle } from '../lib/render-activity.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCR = path.join(STUDIO, '.cache', 'speed-envois-test');
fs.rmSync(SCR, { recursive: true, force: true }); fs.mkdirSync(path.join(SCR, 'Film'), { recursive: true });
process.env.COULISSES_LANG = 'fr';
process.env.STUDIO_PROJECTS = path.join(SCR, 'projets.json');
process.env.COULISSES_SETTINGS = path.join(SCR, 'settings.json');
process.env.COULISSES_MEDIAS = path.join(SCR, 'medias');
const { importProject } = await import('../lib/projects.mjs');
const PORT = await freePort(4240);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));
let ok = 0, ko = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };
const dur = (f) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim();
const VIDEO = path.join(SCR, 'Film', 'Film.mp4');
await waitForRenderIdle();
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=8', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', VIDEO]);
const t = new Date(Date.now() - 60000); fs.utimesSync(VIDEO, t, t);   // older than 20 s: the reviewed video

let st = null, p = null;
try {
  const imp = importProject(VIDEO);
  check(!!imp.revue, `a plain video imported (${imp.kind})`);
  st = spawn(process.execPath, [path.join(STUDIO, 'studio-server.mjs'), '--project', imp.revue, '--no-open', '--port', String(PORT)], { cwd: STUDIO, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; st.stdout.on('data', (d) => { out += d; }); st.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 160 && !/Ouvre : http/.test(out); i++) await sleep(250);
  const opened = /Ouvre : (http:\/\/127\.0\.0\.1:(\d+))/.exec(out);
  if (!opened || Number(opened[2]) < 4240) throw new Error('le studio de test ne démarre pas : ' + out.slice(-300));
  const U = opened[1];
  await requireSandbox(U + '/', imp.revue);
  p = await launch({ port: await freePort(9378) });
  await p.size(1500, 950);
  await p.goto(U + '/');
  await p.until(`window.__studio && document.querySelector('#v').readyState >= 2`, 60000);
  await p.eval(`window.confirm = () => true; document.querySelector('button[data-tab=lots]').click(); return 1`);
  await p.until(`!!document.querySelector('#renderCard .spBlock #exSpeed')`, 15000);
  check(true, 'the dial « Vitesse » at the bottom of the « Envois » card, for a plain video');
  check(!(await p.eval(`return !!document.querySelector('#spGo')`)), 'at ×1, nothing to make');
  // ten notches up with the wheel: ×2
  await p.eval(`document.querySelector('#exSpeed').scrollIntoView({ block: 'center' }); return 1`); await sleep(300);
  const d = await p.eval(`const r = document.querySelector('#exSpeed').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]`);
  for (let i = 0; i < 12; i++) { await p.wheel(d[0], d[1], -120); await sleep(60); }
  const lab = await p.eval(`return [document.querySelector('#exSpeedVal').textContent, document.querySelector('#spGo')?.textContent ?? '', document.querySelector('#exSpeedWhat').textContent]`);
  check(lab[0] === '×2' && /Créer la copie ×2 de la vidéo actuelle/.test(lab[1]) && /relue reste celle à ×1/.test(lab[2]), `twelve notches of the wheel stop at ×2: « ${lab[1]} »`);
  await p.shot(path.join(SCR, 'speed-1-dial.png'));
  // « Créer la copie ×2 »
  await p.eval(`document.querySelector('#spGo').click(); return 1`);
  await p.until(`/Copie ×2 de Film\\.mp4 en cours/.test(document.querySelector('#spJob').innerText)`, 15000).catch(() => {});
  const running = await p.eval(`return document.querySelector('#spJob').innerText`);
  // the dial is still there (the card drawn again by the status)
  await sleep(2500);
  const still = await p.eval(`return document.querySelector('#exSpeedVal')?.textContent`);
  await p.until(`/Copie ×2 faite/.test(document.querySelector('#spJob').innerText)`, 120000);
  const copy = path.join(SCR, 'Film', 'Film-x2.mp4');
  check(/en cours|Copie ×2 faite/.test(running) && still === '×2', `the copy being made, then made (the dial still at ${still})`);
  check(fs.existsSync(copy) && Math.abs(dur(copy) - dur(VIDEO) / 2) < 0.2, `Film-x2.mp4 next to the video, ${fs.existsSync(copy) ? dur(copy).toFixed(2) : '?'} s for ${dur(VIDEO).toFixed(2)} s`);
  await p.shot(path.join(SCR, 'speed-2-done.png'));
  await sleep(1500);
  const S = await (await fetch(U + '/api/status')).json();
  check(S.video?.name === 'Film.mp4' && S.speed?.state === 'done', `the studio still reviews Film.mp4 (the copy is never the reviewed video)`);
  const again = await (await fetch(U + '/api/speed/copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vitesse: 1 }) })).json();
  check(!again.ok && /autre que ×1/.test(again.why ?? ''), `×1 is refused (${again.why})`);
} catch (e) { ko++; console.log('  ✗ ' + e.message); } finally {
  if (p) await p.close().catch(() => {});
  if (st) try { execFileSync('taskkill', ['/PID', String(st.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
}
console.log(`\n${ok} ok, ${ko} échec(s)`); process.exit(ko ? 1 : 0);

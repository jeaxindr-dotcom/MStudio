// Sending the queue (lib/lots.mjs createLot), on a test project only (nothing real is touched) — user bug 17/10/2026, E11:
// « Envoi impossible : Cannot read properties of undefined (reading 'x') », the agent having taken the batch anyway, the
// notes left as drafts in the page:
//   1. a video smaller than the composition (a 1280×720 render of a 1920×1080 episode): the marks laid at the frame's size,
//      where they were drawn; each zoom cut inside the frame, even for a drawing as wide as the picture; the request
//      written, before the batch itself (a session watching never finds a batch without its request);
//   2. the same notes sent again (the answer to the first send lost): that batch again, not a new one, its images made
//      again, its request saying so; another copy of it that nobody took set aside (revue/lots-annules);
//   3. `studio-cli wait` on a batch written without its request (an older Coulisses): the request made, then shown.
// usage: node tests/send-lots.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.COULISSES_LANG = 'fr';
const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCR = path.join(STUDIO, '.cache', 'send-lots-test');
fs.rmSync(SCR, { recursive: true, force: true }); fs.mkdirSync(path.join(SCR, 'Petit'), { recursive: true });
process.env.STUDIO_PROJECTS = path.join(SCR, 'projets.json');
process.env.COULISSES_SETTINGS = path.join(SCR, 'settings.json');
const { importProject, project } = await import('../lib/projects.mjs');
const { createLot, readLot, lotFile, lotNumbers, lotMarkdown } = await import('../lib/lots.mjs');
let ok = 0, ko = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };
const size = (f) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim().split(',').map(Number);
// the colour of a pixel of a JPEG (x, y in its own pixels)
const px = (f, x, y) => { const b = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-vf', `format=rgb24,crop=2:2:${x - (x % 2)}:${y - (y % 2)}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 }); return [...b.subarray(0, 3)]; };

try {
  // a 1280×720 video (grey), reviewed as a 1920×1080 composition
  const VID = path.join(SCR, 'Petit', 'Petit.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x808080:s=1280x720:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', VID]);
  const t0 = new Date(Date.now() - 120000); fs.utimesSync(VID, t0, t0);
  const P = project(importProject(VID).revue);
  // the marks as the page draws them: a 1920×1080 PNG, a filled red square around each gesture
  const marksPng = (x, y, w, h) => {
    const f = path.join(SCR, 'm.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=1920x1080,format=rgba', '-vf', `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=red@1:t=fill:replace=1`, '-frames:v', '1', f]);
    return 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  };
  const notes = [
    { id: 'n1', frame: 30, end: null, text: 'La lumière ici', draft: true, mark: { kind: 'circle', points: [[900, 700], [1000, 700], [1000, 800], [900, 800]], strokes: [[[900, 700], [1000, 700], [1000, 800], [900, 800]]] } },
    // as wide as the picture, low in it (E11 no 25: 454 → 1865 × 417 → 938)
    { id: 'n2', frame: 60, end: 90, text: 'Toute la rangée', draft: true, mark: { kind: 'circle', points: [[454, 417], [1865, 417], [1865, 938], [454, 938]], strokes: [[[454, 417], [1865, 417], [1865, 938], [454, 938]]] } },
    // tall (E11 no 11: 928 → 1100 × 319 → 996)
    { id: 'n3', frame: 90, end: null, text: 'Le tronc', draft: true, mark: { kind: 'circle', points: [[928, 319], [1100, 319], [1100, 996], [928, 996]], strokes: [[[928, 319], [1100, 319], [1100, 996], [928, 996]]] } },
  ];
  fs.writeFileSync(P.NOTES, JSON.stringify({ episode: P.ep, notes }));
  const marks = { n1: marksPng(900, 700, 100, 100), n2: marksPng(454, 417, 1411, 521), n3: marksPng(928, 319, 172, 677) };
  const body = { ids: ['n1', 'n2', 'n3'], marks, words: '' };
  const logs = [], log = (m) => logs.push(m);

  // ---------- 1. a frame smaller than the composition ----------
  console.log('une vidéo plus petite que la composition');
  const r1 = await createLot(P, body, { fps: 30, size: [1920, 1080], log });
  const L1 = readLot(P, r1.lot);
  check(r1.lot === 1 && !r1.again && fs.existsSync(r1.md) && L1.edits.length === 3, `the batch and its request (lot ${r1.lot}, ${L1?.edits.length} edits)`);
  check(r1.sentAt === L1.sentAt && /\.\d{3}Z$/.test(r1.sentAt), 'the receipt identifies the saved request with millisecond precision');
  const c1 = L1.edits[0].captures;
  check(size(c1.marque).join('×') === '1280×720', `the marked frame at the video's size (${size(c1.marque).join('×')})`);
  // the square drawn at 900–1000 × 700–800 of the composition is at 600–667 × 467–533 of the frame
  const inside = px(c1.marque, 633, 500), outside = px(c1.marque, 950, 750);
  check(inside[0] > 200 && inside[1] < 80 && outside[0] < 160 && Math.abs(outside[0] - outside[1]) < 20, `the mark where it was drawn (red at 633,500: ${inside}; grey at 950,750: ${outside})`);
  const zooms = L1.edits.map((e) => e.captures);
  check(zooms.every((c) => c.zoom && fs.existsSync(c.zoom) && c.zoomRect && !c.error), `a zoom for every gesture, the wide and the tall ones too (${zooms.map((c) => c.zoom ? size(c.zoom).join('×') : c.error).join(', ')})`);
  check(zooms.every((c) => { const [w, h] = size(c.zoom); return w <= 1280 && h <= 720; }) && zooms[1].zoomRect.width > 1280, 'each zoom inside the frame; its rectangle said in the composition\'s pixels');
  check(/Zoom sur le geste/.test(fs.readFileSync(r1.md, 'utf8')), 'the request names the zooms');

  // ---------- 2. the same notes sent again ----------
  console.log("le même envoi à nouveau (la réponse d'avant perdue)");
  // a copy of lot 1 written by an older Coulisses (its request missing), that nobody took
  fs.writeFileSync(lotFile(P, 2), JSON.stringify({ ...readLot(P, 1), lot: 2 }));
  fs.writeFileSync(P.REPLIES, JSON.stringify({ notes: {}, lots: { 1: { status: 'taken', at: new Date().toISOString() } } }));
  notes[0].text = 'La lumière ici, plus douce'; fs.writeFileSync(P.NOTES, JSON.stringify({ episode: P.ep, notes }));
  const r2 = await createLot(P, body, { fps: 30, size: [1920, 1080], log });
  const L2 = readLot(P, 1), md2 = fs.readFileSync(lotFile(P, 1, 'md'), 'utf8');
  check(r2.lot === 1 && r2.again && L2.resent && L2.firstSent && L2.edits[0].text === 'La lumière ici, plus douce', `the batch the agent took, again (lot ${r2.lot}), with the notes as they are now`);
  check(r2.sentAt === L2.sentAt, 'a repeated send returns the timestamp of the published batch');
  check(/Lot renvoyé/.test(md2) && /plus douce/.test(md2), 'its request says it was sent again');
  const aside = fs.existsSync(path.join(P.REVUE, 'lots-annules')) ? fs.readdirSync(path.join(P.REVUE, 'lots-annules')) : [];
  check(lotNumbers(P).join() === '1' && aside.some((d) => d.startsWith('002-')) && logs.some((l) => /lot 2 mis de côté/.test(l)), `the copy nobody took set aside (${aside.join(', ')})`);

  // the agent had already handled it: said so (no window, nothing for the agent)
  fs.writeFileSync(P.REPLIES, JSON.stringify({ notes: {}, lots: { 1: { status: 'done', at: new Date().toISOString() } } }));
  const r3 = await createLot(P, body, { fps: 30, size: [1920, 1080], log });
  check(r3.lot === 1 && r3.again === 'done' && lotNumbers(P).join() === '1', `already handled by the agent: that batch, said « done » (${r3.again})`);
  // « Renvoyer » on that note, done by the agent (code review 18/10/2026: it was answered « déjà traitée »): the note
  // changed since (the page stamps it) — a new request, a new batch
  notes[0].draft = true; notes[0].lot = 1;
  notes[0].updated = notes[0].draftQueuedAt = readLot(P, 1).sentAt;
  fs.writeFileSync(P.NOTES, JSON.stringify({ episode: P.ep, notes }));
  const r4 = await createLot(P, body, { fps: 30, size: [1920, 1080], log });
  check(r4.lot === 2 && !r4.again && lotNumbers(P).join() === '1,2', `« Renvoyer » even in the same millisecond: a new batch (lot ${r4.lot})`);
  check(r2.again === 'taken', `taken by the agent before: said « taken » (${r2.again})`);

  // ---------- 3. studio-cli wait on a batch without its request ----------
  console.log('wait sur un lot sans sa demande');
  fs.rmSync(lotFile(P, 1, 'md'));
  fs.writeFileSync(P.REPLIES, JSON.stringify({ notes: {}, lots: {} }));
  const w = spawnSync(process.execPath, [path.join(STUDIO, 'studio-cli.mjs'), 'wait', P.REVUE, '--timeout', '5'], { encoding: 'utf8', env: process.env, timeout: 30000 });
  check(w.status === 0 && /LOT 1 REÇU/.test(w.stdout) && fs.existsSync(lotFile(P, 1, 'md')) && /Lot renvoyé/.test(w.stdout), `wait: the request made from the batch, then shown (code ${w.status}${w.status ? ' — ' + (w.stderr || '').trim().split('\n').pop() : ''})`);
  void lotMarkdown;
} catch (e) { ko++; console.log('  ✗ ERREUR', e.stack); }
console.log(`\n${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);

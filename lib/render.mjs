// The full re-render the user asks for from the studio (« Lancer le rendu »), run by Claude with
// `studio-cli.mjs render <ep> <lot>` in the background. Same steps as the skill (steps 4 and 6), in order:
//   checks  the five automatic checks (depth, hidden faces, floating landscapes, music, jumps); one failing stops it all
//   render  npx remotion render src/index.ts <ENN-Slug> out/<enn>-raw.mp4 (Chrome, --gl=angle, concurrency 6)
//   finish  bash scripts/finish-render.sh <ENN>: final mix into the episode folder, plan of this render, notes moved
//           onto the new video, YouTube chapters
// Files (Claude's side, like replies.json): revue/render.json = the progress, read by the studio every 3 s;
// revue/render.log = the whole output. The studio asks to stop by creating revue/render-stop.
// During « finish » the studios showing this episode let go of the video (POST /api/hold, then /api/unhold): Windows
// cannot replace a file that is being read. The app's studio is also paused by finish-render.sh itself.
import fs from 'node:fs';
import { MSTUDIO, STUDIO_PORT, LAST_PORT, isOwnStudio, processIdentity, assertReviewAvailable } from './app-profile.mjs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readJson, writeJson, nowIso, compositionId, flagsOf, pickVideo, stamp } from './episode.mjs';
import { t } from './i18n.mjs';
import { chromePath, pythonPath } from './tools.mjs';
import { gpuEncoder, gpuBitrate } from './gpu.mjs';
import { speedUp, speedOf } from './speed.mjs';

export const PY = pythonPath(), CHROME = chromePath();   // lib/tools.mjs: settings.json, else the usual places
// Git's bash, never C:\Windows\System32\bash.exe (WSL), which comes first in some PATHs
const BASH = ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files (x86)/Git/bin/bash.exe'].find((f) => fs.existsSync(f)) ?? 'bash';
export const PHASES = ['checks', 'render', 'finish'];
export const renderFiles = (p) => ({ STATE: path.join(p.REVUE, 'render.json'), LOG: path.join(p.REVUE, 'render.log'), STOP: path.join(p.REVUE, 'render-stop'),
  FAILED: path.join(p.REVUE, 'render-failed.log') });   // the log of the last render that failed (a new one starts its own render.log)

// What went wrong, from a failed command's whole output (user report, 08/10/2026: the card said « le rendu Remotion a
// échoué (code 1) : at performWorkUntilDeadline (node_modules/…/scheduler.production.js:150) » — the last line of a
// stack, not the error). The error's own line (the last line that reads as one, never a line of a stack or of a code
// frame), with its header when it has one (« An error occurred while rendering frame 12: »), then the first place of
// the project's own code in its stack.
export function errorOf(out) {
  const lines = String(out ?? '').split(/\r\n|\r|\n/).map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(Boolean);
  const stacky = (l) => /^at\s/.test(l) || /^>?\s*\d+\s*\|/.test(l) || /^[|^~\s-]+$/.test(l) || /^Rendered \d+\/\d+/.test(l) || /^Bundling \d+%/.test(l);
  const erry = (l) => /(\b\w*Error\b|\bError:|An error occurred|Cannot |is not defined|is not a function|undefined|failed|ENOENT|EPERM|EBUSY|Timeout|timed out)/i.test(l);
  let i = -1;
  for (let k = lines.length - 1; k >= 0; k--) if (!stacky(lines[k]) && erry(lines[k])) { i = k; break; }
  if (i < 0) return lines.filter((l) => !stacky(l)).at(-1) ?? lines.at(-1) ?? '';
  let msg = lines[i];
  const head = i > 0 && /:\s*$/.test(lines[i - 1]) && !stacky(lines[i - 1]) ? lines[i - 1] : null;   // « An error occurred while rendering frame 12: »
  if (head && head !== msg) msg = `${head} ${msg}`;
  const where = lines.slice(i + 1).find((l) => /^at\s/.test(l) && /\.(tsx?|jsx?|mjs|cjs)\b/.test(l) && !/node_modules|node:internal|bundle\.js|webpack|remotion-cli/.test(l));
  return (msg + (where ? ` — ${where.replace(/^at\s+/, '')}` : '')).slice(0, 600);
}

// what each step runs: [command, ...args, { stdout: file }?], from 06_Remotion. Tests swap it (STUDIO_RENDER_RECIPE).
export function recipe(p, { frames, out, qualite = '1080p' } = {}) {
  const k4 = qualite === '4k';   // 4K: the 1920×1080 composition drawn at scale 2 (3840×2160); its bitrate
  const EP = p.ep, e = EP.toLowerCase(), occl = `out/occlusion-${EP}.json`;
  return {
    checks: [
      { key: 'depth', label: t('rnd.check.depth'), run: [['npx', 'tsx', 'scripts/depth-check.ts', EP]], ok: /(^|\n)0 conflict/ },
      { key: 'faces', label: t('rnd.check.faces'), run: [['npx', 'tsx', 'scripts/occlusion-dump.ts', EP, { stdout: occl }], [PY, 'scripts/occlusion-check.py', `public/${e}/assets.json`, occl]], ok: /no hidden face/ },
      { key: 'backdrop', label: t('rnd.check.backdrop'), run: [[PY, 'scripts/backdrop-check.py', `public/${e}/assets.json`]], ok: /no floating landscape/ },
      { key: 'music', label: t('rnd.check.music'), run: [['npx', 'tsx', 'scripts/music-check.ts', EP]], ok: /music OK/ },
      { key: 'motion', label: t('rnd.check.motion'), run: [['npx', 'tsx', 'scripts/motion-check.ts', EP]], ok: /: 0 jump/ },
    ],
    // the GPU encoder when there is one (lib/gpu.mjs: user request 14/10/2026), with a bitrate (a hardware encoder has no crf)
    render: { run: [['npx', 'remotion', 'render', 'src/index.ts', compositionId(p), out ?? `out/${e}-raw.mp4`, `--browser-executable=${CHROME}`, '--gl=angle', '--concurrency=6', '--timeout=900000', ...(frames ? [`--frames=${frames}`] : []), ...(k4 ? ['--scale=2'] : []),
      ...(gpuEncoder().mode === 'cpu' ? [] : ['--hardware-acceleration=required', `--video-bitrate=${k4 ? gpuBitrate(3840, 2160) : gpuBitrate(1920, 1080)}`])]] },
    finish: { run: [[BASH, 'scripts/finish-render.sh', EP]] },
  };
}

const quote = (a) => (/[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);   // for the log, and the shell of last resort
// a command of the recipe, run without a shell (code review, 08/10/2026: a command line built by hand is an injection
// waiting to happen): `npx <tool>` becomes node + the tool's own script in 06_Remotion\node_modules (its package's
// « bin »); any other program is run as is, its arguments one by one. Only a tool not found there goes through npx.
const BINS = { tsx: 'tsx', remotion: '@remotion/cli' };
function direct(argv, dir) {
  if (argv[0] !== 'npx') return argv;
  const pkg = BINS[argv[1]]; if (!pkg) return null;
  try {
    const root = path.join(dir, 'node_modules', pkg), pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const rel = typeof pj.bin === 'string' ? pj.bin : pj.bin?.[argv[1]];
    if (rel && fs.existsSync(path.join(root, rel))) return [process.execPath, path.join(root, rel), ...argv.slice(2)];
  } catch { /* not installed there */ }
  return null;
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function renderState(p) {   // what the studio shows (a « running » render whose process is gone was interrupted)
  const s = readJson(renderFiles(p).STATE, null);
  if (s && s.state === 'running' && !alive(s.pid)) { s.state = 'interrupted'; s.error ??= t('rnd.interrupted'); }
  return s;
}
const killTree = (pid) => { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }); else try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } };

// the studios showing this episode: the one its revue/studio.lock.json names, else any on the ports 4173-4199 (matched by
// their notes file, through their light /api/ping): let go of the video / take it back
async function studiosOf(p) {
  const found = new Set();
  const mine = async (port) => {
    try {
      let r = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1500) });
      if (r.status === 404) r = await fetch(`http://127.0.0.1:${port}/api/meta`, { signal: AbortSignal.timeout(3000) });   // a studio of before 1.1.0
      const m = await r.json();
      if ((!MSTUDIO || isOwnStudio(m)) && m?.notesFile && path.resolve(m.notesFile).toLowerCase() === path.resolve(p.NOTES).toLowerCase()) found.add(port);
    } catch { /* nothing there */ }
  };
  const lock = readJson(path.join(p.REVUE, 'studio.lock.json'), null);
  if (lock?.port && (!MSTUDIO || isOwnStudio(lock))) await mine(+lock.port);
  if (!found.size) await Promise.all(Array.from({length: LAST_PORT - STUDIO_PORT + 1}, (_, i) => STUDIO_PORT + i).map(mine));
  return [...found];
}
const post = (port, what) => fetch(`http://127.0.0.1:${port}/api/${what}`, { method: 'POST', signal: AbortSignal.timeout(15000) }).then((r) => r.json()).catch(() => null);

// one run of the steps; resolves to the final state ('rendered' | 'checked' | 'blocked' | 'failed' | 'cancelled')
export async function runRender(p, { lot = null, only = PHASES, frames, out, log = () => {} } = {}) {
  assertReviewAvailable(p.REVUE);
  const F = renderFiles(p);
  const prev = renderState(p);
  if (prev?.state === 'running') throw new Error(t('rnd.running', { at: prev.startedAt, pid: prev.pid }));
  const real = !flagsOf(p), fake = process.env.STUDIO_RENDER_RECIPE;
  if (!real && !fake) {   // a sandbox: never replace the real video, never write the real out/<enn>-raw.mp4
    if (only.includes('finish')) throw new Error(t('rnd.finishReal'));
    if (only.includes('render') && !out) throw new Error(t('rnd.needOut'));
  }
  // the request's quality (1080p | 4k: « Envois »)
  let qualite = '1080p'; try { if (lot != null && JSON.parse(fs.readFileSync(path.join(p.LOTS, `${String(lot).padStart(3, '0')}.json`), 'utf8')).qualite === '4k') qualite = '4k'; } catch { /* no request */ }
  const R = fake ? (await import(pathToFileURL(path.resolve(fake)).href)).default(p, { frames, out, qualite }) : recipe(p, { frames, out, qualite });
  fs.rmSync(F.STOP, { force: true });
  fs.mkdirSync(p.REVUE, { recursive: true });
  const logf = fs.openSync(F.LOG, 'w');
  const S = {
    lot, episode: p.ep, pid: process.pid, ...(MSTUDIO ? processIdentity() : {}), startedAt: nowIso(), updatedAt: nowIso(), state: 'running', phase: only[0], only, qualite,
    before: (() => { const v = pickVideo(p); return v ? stamp(v) : null; })(),
    checks: only.includes('checks') ? R.checks.map((c) => ({ key: c.key, label: c.label, status: 'wait', detail: '' })) : [],
    render: only.includes('render') ? { stage: 'wait', pct: 0, frame: 0, total: 0, remaining: null, encoded: 0 } : null,
    finish: only.includes('finish') ? { steps: [], loudness: {}, duration: null } : null,
    error: null, tail: [],
  };
  let lastWrite = 0;
  const save = (force) => { if (!force && Date.now() - lastWrite < 1000) return; lastWrite = Date.now(); S.updatedAt = nowIso(); writeJson(F.STATE, S); };
  save(true);
  let child = null, stopped = false;
  const stopWatch = setInterval(() => { if (!stopped && fs.existsSync(F.STOP)) { stopped = true; log(t('rnd.log.stop')); if (child) killTree(child.pid); } }, 800);
  const onSignal = () => { stopped = true; if (child) killTree(child.pid); };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);

  // run one command from 06_Remotion, every output line to onLine (both \n and \r count: progress lines)
  const exec = (cmd, onLine) => new Promise((resolve) => {
    const opts = typeof cmd.at(-1) === 'object' ? cmd.at(-1) : {}, argv = cmd.filter((a) => typeof a === 'string');
    const line = argv.map(quote).join(' ');
    fs.writeSync(logf, `\n$ ${line}\n`);
    const dv = direct(argv, p.remotionDir), env = { ...process.env, FORCE_COLOR: '0' };
    child = dv ? spawn(dv[0], dv.slice(1), { cwd: p.remotionDir, windowsHide: true, env }) : spawn(line, { cwd: p.remotionDir, shell: true, windowsHide: true, env });
    let all = '', buf = '';
    const sink = opts.stdout ? fs.createWriteStream(path.resolve(p.remotionDir, opts.stdout)) : null;
    const eat = (d, toSink) => {
      if (toSink) { sink.write(d); return; }
      const s = d.toString('utf8'); fs.writeSync(logf, s); all += s; if (all.length > 400000) all = all.slice(-200000);
      buf += s; const parts = buf.split(/\r\n|\r|\n/); buf = parts.pop();
      for (const l of parts) { const t = l.replace(/\x1b\[[0-9;]*m/g, '').trimEnd(); if (t) onLine?.(t); }
    };
    child.stdout.on('data', (d) => eat(d, !!sink));
    child.stderr.on('data', (d) => eat(d, false));
    child.on('error', (e) => { all += e.message; });
    child.on('close', (code) => { if (buf) onLine?.(buf); sink?.end(); child = null; resolve({ code, out: all }); });
  });
  const keepTail = (t) => { if (/X4000|Copying public dir|^Bundling|^Rendered |^Encoded /.test(t)) return; S.tail.push(t); if (S.tail.length > 14) S.tail.shift(); };
  const finishWith = async (state, error) => {
    clearInterval(stopWatch); process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    S.state = state; S.error = error ?? null; S.endedAt = nowIso();
    if (state === 'rendered') { const v = pickVideo(p); S.video = v ? stamp(v) : null; S.phase = 'review'; }
    save(true); fs.closeSync(logf); fs.rmSync(F.STOP, { force: true });
    if (state === 'failed' || state === 'blocked') { try { fs.copyFileSync(F.LOG, F.FAILED); } catch { /* the log stays where it is */ } }
    return S;
  };

  // ---- 1. the five checks ----
  if (only.includes('checks')) {
    S.phase = 'checks'; save(true);
    for (const [i, c] of R.checks.entries()) {
      const st = S.checks[i]; st.status = 'run'; save(true); const t0 = Date.now();
      let out2 = '', code = 0;
      for (const cmd of c.run) { const r = await exec(cmd, keepTail); out2 += r.out; code = r.code; if (code !== 0 || stopped) break; }
      if (stopped) { st.status = 'wait'; return finishWith('cancelled', t('rnd.stoppedChecks')); }
      const lines = out2.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      st.detail = lines.at(-1) ?? ''; st.ms = Date.now() - t0;
      const judge = /(\d+) appear \/ vanish/.exec(out2); if (judge) st.toJudge = +judge[1];   // appearances in view: Claude judges them
      st.status = c.ok.test(out2) && code === 0 ? 'ok' : 'fail';
      save(true);
      if (st.status === 'fail') return finishWith('blocked', t('rnd.checkFailed', { label: c.label, detail: st.detail }));
    }
  }
  // ---- 2. the render ----
  if (only.includes('render')) {
    S.phase = 'render'; S.render.stage = 'bundle'; S.render.startedAt = nowIso(); save(true);
    const rd = S.render;
    const r = await exec(R.render.run[0], (t) => {
      let m;
      if ((m = /^Bundling (\d+)%/.exec(t))) { rd.stage = 'bundle'; rd.pct = +m[1]; }
      else if ((m = /^Copying public dir ([\d.]+ [KMGT]?B)/.exec(t))) { rd.stage = 'copy'; rd.copied = m[1]; }
      else if (/^Getting composition/.test(t)) rd.stage = 'compose';
      else if ((m = /^Rendered (\d+)\/(\d+)(?:, time remaining: (.+))?/.exec(t))) { rd.stage = 'frames'; rd.frame = +m[1]; rd.total = +m[2]; rd.remaining = m[3] ?? rd.remaining; rd.pct = rd.total ? Math.round((rd.frame / rd.total) * 1000) / 10 : 0; }
      else if ((m = /^Encoded (\d+)\/(\d+)/.exec(t))) { rd.stage = 'encode'; rd.encoded = +m[1]; rd.total = +m[2]; rd.remaining = null; }
      else if ((m = /^\+\s+(.+\.mp4)\s+([\d.]+ [KMGT]?B)$/.exec(t))) { rd.output = m[1]; rd.size = m[2]; }
      keepTail(t); save(false);
    });
    if (stopped) return finishWith('cancelled', t('rnd.stopped'));
    if (r.code !== 0) return finishWith('failed', t('rnd.failed', { code: r.code, tail: errorOf(r.out) || S.tail.at(-1) || '' }));
    rd.stage = 'done'; rd.pct = 100; rd.endedAt = nowIso(); save(true);
  }
  // ---- 3. the finish (the studios let go of the video meanwhile) ----
  if (only.includes('finish')) {
    S.phase = 'finish'; save(true);
    const held = await studiosOf(p);
    for (const port of held) { const r = await post(port, 'hold'); log(t('rnd.log.held', { port, noAnswer: r?.ok ? '' : t('rnd.noAnswer') })); }
    const fin = S.finish;
    const r = await exec(R.finish.run[0], (t) => {
      let m;
      if ((m = /^== (.+)/.exec(t))) fin.steps.push({ label: m[1], at: nowIso() });
      else if ((m = /^\s*I:\s+(-?[\d.]+) LUFS/.exec(t))) fin.loudness.I = +m[1];
      else if ((m = /^\s*Peak:\s+(-?[\d.]+) dBFS/.exec(t))) fin.loudness.peak = +m[1];
      else if ((m = /duration ([\d.]+) s, (\d+) images/.exec(t))) { fin.duration = +m[1]; fin.frames = +m[2]; }
      else if ((m = /(\d+) note\(s\) recalée/.exec(t))) fin.remapped = +m[1];
      keepTail(t); save(false);
    });
    for (const port of held) await post(port, 'unhold');
    if (stopped) return finishWith('cancelled', t('rnd.finishStopped'));
    if (r.code !== 0) return finishWith('failed', t('rnd.finishFailed', { code: r.code, tail: errorOf(r.out) || S.tail.at(-1) || '' }));
    // the speed of the request (the dial of « Envois »): the copy of the new video, next to it; a failed copy leaves the
    // render as it is (it is fine), and says why
    let want = null; try { want = speedOf(JSON.parse(fs.readFileSync(path.join(p.LOTS, `${String(lot).padStart(3, '0')}.json`), 'utf8')).vitesse ?? 1); } catch { /* no request */ }
    const v = lot != null && want && want !== 1 ? pickVideo(p) : null;
    if (v) {
      fin.steps.push({ label: t('rnd.speedStep', { s: String(want).replace('.', ',') }), at: nowIso() }); save(true);
      fs.writeSync(logf, `\n$ copie à ${want} : ${v}\n`);
      try { const out = await speedUp(v, want, { log: (l) => { fs.writeSync(logf, l + '\n'); keepTail(l); }, onChild: (c) => { child = c; if (c && stopped) killTree(c.pid); }, onProgress: (x) => { fin.speedPct = Math.round(x * 100); save(false); } }); S.speedCopy = path.basename(out); }
      catch (e) { if (stopped) return finishWith('cancelled', t('rnd.finishStopped')); S.speedError = e.message; fs.writeSync(logf, `copie à ${want} : ${e.message}\n`); }
      child = null; save(true);
    }
  }
  return finishWith(only.includes('finish') ? 'rendered' : only.includes('render') ? 'rendered-raw' : 'checked');
}

// `studio-cli.mjs done` on a render request: Claude has watched the new video
export function markReviewed(p, message) {
  const F = renderFiles(p), s = readJson(F.STATE, null);
  if (!s) return null;
  s.state = 'reviewed'; s.phase = 'done'; s.reviewedAt = nowIso(); s.message = message ?? '';
  writeJson(F.STATE, s);
  return s;
}

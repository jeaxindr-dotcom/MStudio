// Where an episode's files are, shared by the studio server and the command line used by Claude (studio-cli.mjs).
// Defaults = the Brambleshire Theatre project; --theatre / --episodes / --remotion override them (the sandbox used to
// test the studio without touching the real notes passes --episodes).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { INSTALLED_THEATRE } from './place.mjs';
import { APP_DATA, MSTUDIO } from './app-profile.mjs';
import { t } from './i18n.mjs';

// installed in the pipeline: the Théatre folder above 06_Remotion\review\studio; in the Dev workshop: the real project
export const DEFAULT_THEATRE = MSTUDIO ? path.join(APP_DATA, 'theatre') : INSTALLED_THEATRE ?? path.join(os.homedir(),'Desktop','Youtube','music','Brambleshire','Théatre');

export function optionsFrom(args) {
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const theatre = path.resolve(opt('--theatre') ?? DEFAULT_THEATRE);
  return {
    theatre,
    episodesDir: path.resolve(opt('--episodes') ?? path.join(theatre, '07_Episodes')),
    remotionDir: path.resolve(opt('--remotion') ?? path.join(theatre, '06_Remotion')),
  };
}
// the flags to repeat in a command line so that it reaches the same files (empty for the real project)
export function flagsOf(o) {
  if (o.project) return '';   // an imported project is reached by its path (o.target)
  const d = optionsFrom([]); const f = [];
  if (o.theatre !== d.theatre) f.push('--theatre', `"${o.theatre}"`);
  if (o.episodesDir !== path.join(o.theatre, '07_Episodes')) f.push('--episodes', `"${o.episodesDir}"`);
  if (o.remotionDir !== path.join(o.theatre, '06_Remotion')) f.push('--remotion', `"${o.remotionDir}"`);
  return f.join(' ');
}

export function episode(ep, o) {
  ep = String(ep ?? '').toUpperCase();
  if (!/^E\d+$/.test(ep)) throw new Error(t('ep.expected'));
  const folder = fs.readdirSync(o.episodesDir).find((d) => d.toUpperCase().startsWith(ep + ' - '));
  if (!folder) throw new Error(t('ep.noFolder', { ep, dir: o.episodesDir }));
  const EP = path.join(o.episodesDir, folder), REVUE = path.join(EP, 'revue');
  const p = {
    kind: 'brambleshire', ep, folder, title: folder.replace(/^E\d+ - /, ''), EP, REVUE, ...o,
    NOTES: path.join(REVUE, 'notes.json'),          // written by the page only
    REPLIES: path.join(REVUE, 'replies.json'),      // written by Claude only (studio-cli.mjs, reply.py)
    SNAP: path.join(REVUE, 'timeline.json'),
    IMAGES: path.join(REVUE, 'images'),
    PROXY: path.join(REVUE, 'video-revue.mp4'),
    PROXY_INFO: path.join(REVUE, 'video-revue.json'),
    LOTS: path.join(REVUE, 'lots'),                 // written by the studio server when the user sends the queue
    RUNS: path.join(REVUE, 'runs'),                 // snapshots taken by Claude before a correction (undo)
    AGENT: path.join(REVUE, 'studio-agent.json'),   // heartbeat of a Claude session watching the tool
  };
  p.target = `${ep}${flagsOf(p) ? ' ' + flagsOf(p) : ''}`;   // how studio-cli.mjs is told which episode
  return p;
}

export const pickVideo = (p) => {
  if (p.pickVideo) return p.pickVideo();   // an imported project (lib/projects.mjs)
  const own = path.join(p.EP, `${p.folder}.mp4`);
  if (fs.existsSync(own)) return own;
  // (never a copy at another speed, « -x1.3.mp4 »: lib/speed.mjs)
  const any = fs.readdirSync(p.EP).filter((f) => f.toLowerCase().endsWith('.mp4') && !/-x\d+(?:[.,]\d+)?\.mp4$/i.test(f)).map((f) => path.join(p.EP, f));
  return any.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
};
export const stamp = (file) => { const st = fs.statSync(file); return { name: path.basename(file), size: st.size, mtime: st.mtime.toISOString() }; };
export function proxyFresh(p) {
  try {
    const info = JSON.parse(fs.readFileSync(p.PROXY_INFO, 'utf8')), src = pickVideo(p);
    return !!src && fs.existsSync(p.PROXY) && info.source.size === stamp(src).size && info.source.mtime === stamp(src).mtime;
  } catch { return false; }
}
// the file to cut stills from: the review copy when it is the same video (fast seeking), else the delivered MP4
export const stillSource = (p) => (proxyFresh(p) ? p.PROXY : pickVideo(p));

export const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return d; } };
// read by a writer: the default only when the file is not there; there but unreadable (another process writing it, an
// antivirus, a tool that added a BOM is accepted) → tried again for ~1 s, then an error — never written back over from
// a failed read (code review 18/10/2026: one bad read of replies.json and the next `reply` wrote back an empty file)
export function readJsonStrict(f, d) {
  for (let i = 0; ; i++) {
    let txt;
    try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return d; if (i >= 40) throw e; Atomics.wait(PAUSE, 0, 0, 25); continue; }
    try { return JSON.parse(txt.replace(/^\uFEFF/, '')); } catch (e) { if (i >= 40) throw new Error(`${f} : illisible (${e.message}) — rien n'est écrit`); Atomics.wait(PAUSE, 0, 0, 25); }
  }
}
// a read-change-write of one JSON file that two processes cannot interleave (two `reply` run at once by the agent, a
// `reply` during finish-render's remap): a lock file beside it, taken for the time of fn; a lock older than 30 s is a
// dead process's. fn changes the data in place (or returns new data); an error in fn leaves the file as it was.
export function updateJson(f, d, fn) {
  const lock = `${f}.lock`;
  const transient = e => process.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(e.code);
  for (let i = 0; ; i++) {
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); break; } catch (e) {
      // Windows reports a lock which another process has just unlinked as
      // access denied until its final handle closes. The lock is still exclusive.
      if (transient(e) && i < 400) { Atomics.wait(PAUSE, 0, 0, 25); continue; }
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 30000) { fs.rmSync(lock, { force: true }); continue; } } catch { continue; }
      if (i >= 400) throw new Error(`${lock} : verrou tenu`);
      Atomics.wait(PAUSE, 0, 0, 25);
    }
  }
  try { const data = readJsonStrict(f, d), out = fn(data) ?? data; writeJson(f, out); return out; }
  finally {
    for (let i = 0; ; i++) {
      try { fs.unlinkSync(lock); break; }
      catch (e) {
        if (e.code === 'ENOENT') break;
        if (i >= 40 || !transient(e)) throw e;
        Atomics.wait(PAUSE, 0, 0, 15);
      }
    }
  }
}
// written whole then renamed over the file; Windows refuses the rename while another process reads it at that very
// moment (EPERM / EBUSY / EACCES): tried again for ~0.6 s (15/10/2026: a test render stopped on its first check, its
// render.json left as .tmp — a real 30-minute render would have stopped the same way)
const PAUSE = new Int32Array(new SharedArrayBuffer(4));
export function writeJson(f, data) {
  writeText(f, JSON.stringify(data, null, 1));
}
export function writeText(f, text) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, f); return; } catch (e) {
      if (i >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { try { fs.rmSync(tmp, { force: true }); } catch { /* */ } throw e; }
      Atomics.wait(PAUSE, 0, 0, 15);
    }
  }
}
export const sha = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch { return null; } };
export const pad3 = (n) => String(n).padStart(3, '0');
export const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

// composition id of an episode, read from src/episodes/registry.ts ({ id: 'E03', slug: 'SecretGarden', … })
export function compositionId(p) {
  const reg = fs.readFileSync(path.join(p.remotionDir, 'src', 'episodes', 'registry.ts'), 'utf8');
  const m = new RegExp(`id:\\s*'${p.ep}',\\s*slug:\\s*'([^']+)'`).exec(reg);
  if (!m) throw new Error(t('ep.notInRegistry', { ep: p.ep }));
  return `${p.ep}-${m[1]}`;
}

export const fmtTime = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, '0')}`; };

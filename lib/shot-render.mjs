// « Rendre ce plan » in the studio of a 3D shot (user request, 09/10/2026): the shot's .coulisses says which Short shows
// its render, as which file (« utilise »); this module starts lib/shot-render-run.mjs detached (it outlives the studio),
// reads its progress back, stops it, and puts the previous clip back (« Remettre la version d'avant »).
//   revue\shot-render.json   { state: running | done | failed | stopped, pid, use, target, started, ended, file, error }
//   revue\shot-render.log    the run's output (COULISSES PROGRES / REMPLACE / FIN)
//   revue\shot-backups\ the clips it replaced, newest last
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, nowIso } from './episode.mjs';
import { readCoulisses } from './coulisses-file.mjs';
import { MSTUDIO, isOwnStudio, processIdentity, assertReviewAvailable } from './app-profile.mjs';
import { launchDetached } from './export.mjs';
import { errorOf } from './render.mjs';
import { t } from './i18n.mjs';

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shot-render-run.mjs');
export const shotFiles = (p) => ({ STATE: path.join(p.REVUE, 'shot-render.json'), LOG: path.join(p.REVUE, 'shot-render.log'), OLD: path.join(p.REVUE, 'shot-backups') });
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// where each use of this shot goes: [{ i, title, coulisses, fichier, target, exists, previous }]
export function shotTargets(p) {
  return (p.uses ?? []).map((u, i) => {
    let host = null; try { host = readCoulisses(u.coulisses); } catch { /* moved */ }
    const target = host?.remotion?.projet ? path.join(host.remotion.projet, ...u.fichier.split('/')) : null;
    return { i, title: host?.title ?? path.basename(u.coulisses, '.coulisses'), coulisses: u.coulisses, fichier: u.fichier, target, exists: !!target && fs.existsSync(target), previous: previousOf(p, target).length };
  });
}
function previousOf(p, target) {
  if (!target) return [];
  const dir = shotFiles(p).OLD, base = path.basename(target, path.extname(target));
  try { return fs.readdirSync(dir).filter((f) => f.startsWith(base + '-') && f.endsWith(path.extname(target))).sort().map((f) => path.join(dir, f)); } catch { return []; }
}

const clean = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n|\r/).map((l) => l.trimEnd()).filter((l) => l.trim());
export function shotLog(p, n = 160) { let s = ''; try { s = fs.readFileSync(shotFiles(p).LOG, 'utf8'); } catch { /* none */ } return clean(s).filter((l) => !/^COULISSES PROGRES/.test(l)).slice(-n).join('\n'); }
// { state, pct, etape, use, target, file, started, ended, error } or null (never rendered here)
export function shotState(p) {
  const F = shotFiles(p), s = readJson(F.STATE, null);
  if (!s) return null;
  let txt = ''; try { txt = fs.readFileSync(F.LOG, 'utf8'); } catch { /* not started yet */ }
  let pct = null, etape = null, fin = null;
  for (const l of clean(txt)) {
    let m = /^COULISSES PROGRES\s+(\d+)\s*(.*)$/.exec(l.trim()); if (m) { pct = +m[1]; etape = m[2] || etape; continue; }
    m = /^COULISSES FIN\s+"?(.+?)"?\s*$/.exec(l.trim()); if (m) fin = m[1];
  }
  if (s.state === 'running' && !alive(s.pid)) {   // the run ended since the last look (the studio may have been closed meanwhile)
    if (fin) Object.assign(s, { state: 'done', ended: nowIso(), file: fin });
    else Object.assign(s, { state: 'failed', ended: nowIso(), error: errorOf(txt) || t('shot.failed') });
    writeJson(F.STATE, s);
  }
  return { ...s, pct: s.state === 'done' ? 100 : pct, etape };
}

export function startShot(p, i, { log = () => {}, images = null } = {}) {
  const use = shotTargets(p)[i];
  if (!use) throw new Error(t('shot.noUse'));
  if (!use.target) throw new Error(t('shot.noHost', { file: use.coulisses }));
  assertReviewAvailable(readCoulisses(use.coulisses).revue);
  if (shotState(p)?.state === 'running') throw new Error(t('shot.running'));
  const F = shotFiles(p);
  fs.mkdirSync(p.REVUE, { recursive: true });
  const pid = launchDetached(F.LOG, p.remotion.projet, [process.execPath, RUNNER, p.REVUE, String(i), ...(images ? ['--images', images] : [])]);
  const s = { state: 'running', pid, ...(MSTUDIO ? processIdentity(pid) : {}), use: i, target: use.target, title: use.title, started: nowIso() };
  writeJson(F.STATE, s);
  log(t('shot.log.started', { pid, target: use.target }));
  return s;
}
export function stopShot(p, { log = () => {} } = {}) {
  const F = shotFiles(p), s = readJson(F.STATE, null);
  if (!s || s.state !== 'running') throw new Error(t('shot.none'));
  if (MSTUDIO && !isOwnStudio(s)) throw new Error('Ce rendu appartient à une autre instance.');
  spawnSync('taskkill', ['/PID', String(s.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  const tmp = String(s.target ?? '').replace(/\.mp4$/i, '') + '.coulisses-tmp.mp4';
  try { fs.rmSync(tmp, { force: true }); } catch { /* still held: removed by the next run */ }
  Object.assign(s, { state: 'stopped', ended: nowIso() }); writeJson(F.STATE, s);
  log(t('shot.log.stopped', { pid: s.pid }));
  return s;
}
// « Remettre la version d'avant »: the newest kept clip back in the Short (the replaced one kept in turn)
export async function undoShot(p, i, { log = () => {} } = {}) {
  if (shotState(p)?.state === 'running') throw new Error(t('shot.running'));
  const use = shotTargets(p)[i]; if (!use?.target) throw new Error(t('shot.noUse'));
  assertReviewAvailable(readCoulisses(use.coulisses).revue);
  const prev = previousOf(p, use.target); if (!prev.length) throw new Error(t('shot.noPrevious'));
  const back = prev.at(-1), tmp = use.target.replace(/\.mp4$/i, '') + '.coulisses-tmp.mp4';
  fs.copyFileSync(back, tmp);
  for (let k = 0; ; k++) {
    try { fs.renameSync(tmp, use.target); break; } catch (e) { if (k >= 40) { fs.rmSync(tmp, { force: true }); throw new Error(t('shot.inUse', { file: use.target })); } await new Promise((r) => setTimeout(r, 500)); }
  }
  fs.rmSync(back);   // it is the clip again: no longer a kept one
  const F = shotFiles(p), s = readJson(F.STATE, null) ?? {};
  writeJson(F.STATE, { ...s, state: 'undone', ended: nowIso(), file: use.target, use: i, target: use.target });
  log(t('shot.log.undone', { file: use.target, from: back }));
  return { file: use.target, from: back };
}

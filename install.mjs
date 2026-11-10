#!/usr/bin/env node
// Installs this workshop's Coulisses (formerly « Brambleshire Studio ») where the app lives (user choice: « atelier Dev +
// copie » — development happens here, with the sandbox and the tests; the app only receives validated versions).
//   node install.mjs [--to <dir>] [--dry] [--force] [--where]
// Default target: C:\Users\owner\AppData\Local\Programs\Coulisses (user choice: an app for every channel, outside every
// pipeline). Copies the code (server, page, CLI, AGENT.md, README, lib\, player\, tests\, docs\) — never the sandbox nor
// the cache. Writes installed.json (date, source, sha256 of every file): a file changed in the installed copy since the
// last install is not overwritten without --force.
// Moving from the old place (<Théatre>\06_Remotion\review\studio): the files installed there that nobody changed are
// removed, and a forwarding studio-cli.mjs stays, so the commands written in older batches and docs keep working.
// The list of imported projects moves from %LOCALAPPDATA%\BrambleshireStudio to %LOCALAPPDATA%\Coulisses.
// A running Coulisses keeps its old code until it is restarted (the page itself is re-read on F5).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_THEATRE } from './lib/episode.mjs';
import { t } from './lib/i18n.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const LOCAL = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
const TO = path.resolve(opt('--to') ?? path.join(LOCAL, 'Programs', 'Coulisses'));
const OLD = path.join(DEFAULT_THEATRE, '06_Remotion', 'review', 'studio');
const DRY = args.includes('--dry'), FORCE = args.includes('--force');
if (args.includes('--where')) { console.log(TO); process.exit(0); }   // for « Coulisses Setup.exe »
// the app: « Coulisses.exe » (built by app\build.ps1) + its home screen (hub-server.mjs, hub.html) and icon
const FILES = ['studio-server.mjs', 'studio.html', 'studio-cli.mjs', 'hub-server.mjs', 'hub.html', 'menubar.js', 'shortcuts.js', 'medias.js', 'favicon.png', 'Coulisses.exe', 'AGENT.md', 'AGENT.en.md', 'README.md', 'README.fr.md'];
const DIRS = ['lib', 'lib/reverse-template', 'player', 'page', 'page/studio', 'tests', 'docs'];
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const list = [...FILES];
for (const d of DIRS) for (const f of fs.readdirSync(path.join(HERE, d))) if (fs.statSync(path.join(HERE, d, f)).isFile()) list.push(path.join(d, f));
const manifestFile = path.join(TO, 'installed.json');
const before = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null;
// files changed in the installed copy since the last install
const touched = before ? Object.entries(before.files).filter(([f, h]) => { const dst = path.join(TO, f), src = path.join(HERE, f); if (!fs.existsSync(dst)) return false; const now = sha(dst); return now !== h && !(fs.existsSync(src) && sha(src) === now); }).map(([f]) => f) : [];
if (touched.length && !FORCE) {
  console.error(t('inst.touched', { to: TO, files: touched.join(', ') }));
  process.exit(3);   // « Coulisses Setup.exe » offers to overwrite them (exit code 3, whatever the language)
}
const files = {}, done = {};
let changed = 0, complete = false;
try {
  for (const f of list) {
    const src = path.join(HERE, f), dst = path.join(TO, f), h = sha(src), key = f.split(path.sep).join('/');
    files[key] = h;
    if (fs.existsSync(dst) && sha(dst) === h) { done[key] = h; continue; }
    changed++;
    console.log(`${t(fs.existsSync(dst) ? 'inst.updated' : 'inst.added')}  ${f}`);
    if (!DRY) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
    done[key] = h;
  }
  // files of an earlier install that this version no longer has
  for (const f of Object.keys(before?.files ?? {})) if (!files[f] && fs.existsSync(path.join(TO, f))) { console.log(`${t('inst.removed')}${f}`); if (!DRY) fs.rmSync(path.join(TO, f)); }
  complete = true;
} finally {
  // (cut short: the files copied so far with their new print, the others with the one they had)
  if (!DRY) fs.writeFileSync(manifestFile, JSON.stringify({ installed: new Date().toISOString(), from: HERE, app: 'Coulisses', ...(complete ? {} : { partial: true }), files: complete ? files : { ...(before?.files ?? {}), ...done } }, null, 1));
}
console.log(t('inst.copied', { dry: DRY ? t('inst.dry') : '', n: changed, to: TO, extra: t(changed ? 'inst.restart' : 'inst.upToDate') }));

// ---- moving from the old place, inside the Brambleshire pipeline ----
const oldManifest = path.join(OLD, 'installed.json');
if (path.resolve(OLD).toLowerCase() !== TO.toLowerCase() && fs.existsSync(oldManifest)) {
  const m = JSON.parse(fs.readFileSync(oldManifest, 'utf8'));
  const kept = [];
  for (const [f, h] of Object.entries(m.files ?? {})) {
    const abs = path.join(OLD, f); if (!fs.existsSync(abs)) continue;
    if (sha(abs) !== h) { kept.push(f); continue; }   // changed there by someone: left in place
    if (!DRY) try { fs.rmSync(abs); } catch { kept.push(t('inst.inUse', { file: f })); }
  }
  if (!DRY) {
    for (const d of DIRS) { const dir = path.join(OLD, d); try { if (fs.existsSync(dir) && !fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch { /* not empty */ } }
    fs.rmSync(oldManifest);
    // the commands of older batches and docs point here: forward them to the installed Coulisses
    fs.writeFileSync(path.join(OLD, 'studio-cli.mjs'), [
      '#!/usr/bin/env node',
      `// Coulisses (formerly « Brambleshire Studio ») now lives in ${TO}.`,
      '// This file only forwards the commands written in older batches and docs to the installed studio-cli.mjs.',
      "import { spawnSync } from 'node:child_process';",
      `const r = spawnSync(process.execPath, [${JSON.stringify(path.join(TO, 'studio-cli.mjs'))}, ...process.argv.slice(2)], { stdio: 'inherit' });`,
      'process.exit(r.status ?? 1);', '',
    ].join('\n'));
    fs.writeFileSync(path.join(OLD, 'LISEZMOI.txt'), [`Coulisses (anciennement « Brambleshire Studio ») est installé dans :`, TO, '',
      'Ce dossier ne garde qu\'un studio-cli.mjs de renvoi, pour les commandes écrites dans les anciens lots.', ''].join('\r\n'));
  }
  console.log(t('inst.old', { dry: DRY ? t('inst.dry') : '', old: OLD, kept: kept.length ? t('inst.kept', { list: kept.join(', ') }) : '' }));
}
// ---- the list of imported projects follows the app ----
const oldReg = path.join(LOCAL, 'BrambleshireStudio', 'projets.json'), newReg = path.join(LOCAL, 'Coulisses', 'projets.json');
if (fs.existsSync(oldReg) && !fs.existsSync(newReg)) {
  if (!DRY) { fs.mkdirSync(path.dirname(newReg), { recursive: true }); fs.copyFileSync(oldReg, newReg); }
  console.log(t('inst.registry', { dry: DRY ? t('inst.dry') : '', file: newReg }));
}

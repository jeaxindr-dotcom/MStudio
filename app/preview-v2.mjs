// Run the worktree's studio with a private E03 review. No installed server or project is restarted.
// By default the developer launcher opens an empty local library. Set
// COULISSES_PREVIEW_ENGINE to a compatible E03 Remotion engine directory to
// seed the optional demo from a matching sandbox in one of this repo's worktrees.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workshop = path.join(root, '.cache', 'atelier-v2'), episodes = path.join(workshop, '07_Episodes');
const engine = path.join(workshop, '06_Remotion'), folder = 'E03 - The Secret Garden';
const example = path.join(episodes, folder), video = folder + '.mp4';
const lock = path.join(workshop, 'hub.json');
const same = (a, b) => typeof a === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const exists = fs.existsSync;

function demoSource() {
  const candidates = [root];
  try {
    const trees = execFileSync('git', ['worktree', 'list', '--porcelain', '-z'], {cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','ignore']});
    for (const field of trees.split('\0')) if (field.startsWith('worktree ')) candidates.push(field.slice(9));
  } catch { /* A standalone checkout may still have its own sandbox. */ }
  return candidates.map(p => path.join(p, 'sandbox', '07_Episodes', folder)).find(p => exists(path.join(p, video)) && exists(path.join(p, 'revue', 'timeline.json')));
}

// Seed into a temporary sibling first. A failed preparation can be retried without
// mistaking a partial tree for the user's copy or overwriting a subsequent edit.
function seed(dir, populate) {
  if (exists(dir)) return;
  const temp = fs.mkdtempSync(path.join(path.dirname(dir), '.seed-'));
  try { populate(temp); fs.renameSync(temp, dir); }
  finally { fs.rmSync(temp, {recursive: true, force: true}); }
}
function linkMedia(source, target) {
  try { fs.linkSync(source, target); }
  catch (err) {
    if (err.code !== 'EXDEV') throw err;
    // A source on another volume cannot share a hard link.
    fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE);
  }
}
function prepareDemo() {
  if (!process.env.COULISSES_PREVIEW_ENGINE) return false;
  const original = path.resolve(process.env.COULISSES_PREVIEW_ENGINE);
  const source = demoSource();
  if (!exists(example) && (!source || !exists(path.join(original, 'src', 'episodes', 'e03.ts')) || !exists(path.join(original, 'node_modules', 'remotion')))) return false;
  seed(engine, dir => {
    for (const name of ['src','episodes','scripts','package.json','package-lock.json','remotion.config.ts','tsconfig.json']) {
      if (exists(path.join(original, name))) fs.cpSync(path.join(original, name), path.join(dir, name), {recursive: true});
    }
    const remap = path.join(original, 'review', 'remap-notes.mjs');
    if (exists(remap)) {
      fs.mkdirSync(path.join(dir, 'review'));
      fs.copyFileSync(remap, path.join(dir, 'review', 'remap-notes.mjs'));
    }
    // The episode's delivery helper normally looks for the installed app on these
    // ports. Its copy here works on private files and must not pause a real studio.
    const finish = path.join(dir, 'scripts', 'finish-render.sh');
    if (exists(finish)) fs.writeFileSync(finish, fs.readFileSync(finish, 'utf8')
      .replace('for HP in 4170 4171 4172; do', 'for HP in; do')
      .replace('for PORT in 4173 4174 4175 4176; do', 'for PORT in; do'));
    // The actual node_modules folder and its Webpack cache are private. Existing
    // packages are shared, so no dependency download or SDK edits are needed.
    const modules = path.join(dir, 'node_modules');
    fs.mkdirSync(modules);
    for (const pkg of fs.readdirSync(path.join(original, 'node_modules'), {withFileTypes: true})) {
      if (pkg.name === '.cache' || pkg.name === '.package-lock.json') continue;
      const from = path.join(original, 'node_modules', pkg.name), to = path.join(modules, pkg.name);
      if (fs.statSync(from).isDirectory()) fs.symlinkSync(from, to, 'junction');
      else fs.copyFileSync(from, to);
    }
    // Keep the asset manifests editable in the workshop. The heavy art, voice and
    // sound directories are shared inputs used by the media server and renderer.
    const pub = path.join(original, 'public'), local = path.join(dir, 'public'); fs.mkdirSync(local);
    for (const entry of fs.readdirSync(pub, {withFileTypes: true})) {
      const from = path.join(pub, entry.name), to = path.join(local, entry.name);
      if (!entry.isDirectory()) { fs.copyFileSync(from, to); continue; }
      fs.mkdirSync(to);
      for (const asset of fs.readdirSync(from, {withFileTypes: true})) {
        const a = path.join(from, asset.name), b = path.join(to, asset.name);
        if (asset.isDirectory()) fs.symlinkSync(a, b, 'junction');
        else if (/\.json$/i.test(asset.name)) fs.copyFileSync(a, b);
        else linkMedia(a, b);
      }
    }
    fs.mkdirSync(path.join(dir, 'out'));
  });
  const engineGuide = path.join(engine, 'AGENTS.md');
  if (!exists(engineGuide)) {
    fs.writeFileSync(engineGuide, [
      '# Atelier Coulisses V2',
      'Modifie la mise en scène dans src/, episodes/ ou les manifestes JSON copiés dans public/e03/.',
      'Les bibliothèques de node_modules et les sous-dossiers de médias de public/ sont des entrées partagées en lecture.',
      'Pour créer ou modifier un média, enregistre une nouvelle copie dans un dossier privé de cet atelier et référence-la depuis les sources locales.',
      'La revue et les sorties de cet épisode se trouvent dans ../07_Episodes/E03 - The Secret Garden/.',
    ].join('\n') + '\n');
  }
  seed(example, dir => {
    fs.mkdirSync(path.join(dir, 'revue'));
    linkMedia(path.join(source, video), path.join(dir, video));
    fs.copyFileSync(path.join(source, 'revue', 'timeline.json'), path.join(dir, 'revue', 'timeline.json'));
    if (exists(path.join(source, 'revue', 'video-revue.mp4')) && exists(path.join(source, 'revue', 'video-revue.json'))) {
      linkMedia(path.join(source, 'revue', 'video-revue.mp4'), path.join(dir, 'revue', 'video-revue.mp4'));
      fs.copyFileSync(path.join(source, 'revue', 'video-revue.json'), path.join(dir, 'revue', 'video-revue.json'));
    }
    fs.writeFileSync(path.join(dir, 'revue', 'notes.json'), JSON.stringify({episode:'E03', notes:[]}));
  });
  return true;
}

async function json(url, options = {}) {
  const res = await fetch(url, {signal: AbortSignal.timeout(1800), ...options});
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
async function currentHub() {
  try {
    const saved = JSON.parse(fs.readFileSync(lock, 'utf8'));
    if (!same(saved.studio, root) || !Number.isInteger(saved.port) || saved.port < 4380 || saved.port > 4399) return null;
    const url = 'http://127.0.0.1:' + saved.port;
    const [ping, about] = await Promise.all([json(url + '/api/ping'), json(url + '/api/about')]);
    if (ping.hub === true && !ping.installed && same(ping.episodesDir, episodes) && same(about.folder, root)) return url;
  } catch { /* Stale lock or closed hub. */ }
  return null;
}
async function freeHubPort() {
  for (let port = 4380; port < 4400; port++) {
    const available = await new Promise(resolve => {
      const socket = net.createServer();
      socket.once('error', () => resolve(false));
      socket.listen(port, '127.0.0.1', () => socket.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error('Les ports privés 4380–4399 sont tous occupés.');
}
async function startHub() {
  const env = {...process.env, COULISSES_V2_OWN_STUDIOS: '1', COULISSES_REVERSE_DOCUMENTS: '1',
    COULISSES_REVERSE_ENGINE: process.env.COULISSES_PREVIEW_ENGINE || engine,
    COULISSES_SETTINGS: path.join(workshop, 'settings.json'), COULISSES_MEDIAS: path.join(workshop, 'medias'),
    STUDIO_PROJECTS: path.join(workshop, 'projets.json'), COULISSES_PROJECTS_ROOT: path.join(workshop, 'projets'),
    TMP: path.join(workshop, 'temp'), TEMP: path.join(workshop, 'temp')};
  fs.mkdirSync(env.TEMP, {recursive:true});
  if (!exists(env.COULISSES_SETTINGS)) fs.writeFileSync(env.COULISSES_SETTINGS, JSON.stringify({lang:'fr'}));
  const picker = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Coulisses', 'Coulisses.exe');
  if (exists(picker)) env.COULISSES_PICKER_EXE = picker;
  const log = path.join(workshop, 'lancement.log'), fd = fs.openSync(log, 'a');
  let proc;
  try {
    proc = spawn(process.execPath, ['hub-server.mjs', '--port', String(await freeHubPort()), '--studio-port', '4400',
      '--lock', lock, '--theatre', workshop, '--episodes', episodes, '--remotion', engine],
      {cwd: root, env, detached: true, windowsHide: true, stdio:['ignore',fd,fd]});
  } finally { fs.closeSync(fd); }
  proc.unref();
  for (let i = 0; i < 100; i++) {
    const url = await currentHub(); if (url) return url;
    if (proc.exitCode != null) break;
    await delay(100);
  }
  throw new Error('Le démarrage a échoué. Journal : ' + log);
}

// A named pipe is released by Windows even if the preparer is killed. Two
// simultaneous double-clicks share the one verified hub and episode.
async function launchLock() {
  const name = 'coulisses-v2-' + crypto.createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0,16);
  const address = process.platform === 'win32' ? '\\\\.\\pipe\\' + name : path.join(os.tmpdir(), name + '.sock');
  for (let n = 0; n < 600; n++) {
    const guard = net.createServer(s => s.end());
    const acquired = await new Promise((resolve, reject) => {
      guard.once('error', err => err.code === 'EADDRINUSE' ? resolve(false) : reject(err));
      guard.listen(address, () => resolve(true));
    });
    if (acquired) return guard;
    await delay(150);
  }
  throw new Error('Une autre ouverture de Coulisses V2 est encore en cours.');
}
async function run() {
  fs.mkdirSync(episodes, {recursive:true});
  const guard = await launchLock();
  try {
    const existing = await currentHub();
    if (process.argv.includes('--stop')) {
      if (existing) {
        await json(existing + '/api/quit', {method:'POST'});
        for (let i = 0; i < 100 && await currentHub(); i++) await delay(150);
        if (await currentHub()) throw new Error('Le studio V2 est encore en cours de fermeture.');
      }
      return;
    }
    const demo = prepareDemo(), hub = existing || await startHub();
    let url = hub + '/';
    if (demo) {
      const opened = await json(hub + '/api/open?ep=E03', {method:'POST', signal:AbortSignal.timeout(70000)});
      if (!opened.ok || !opened.url) throw new Error(opened.why || 'Ouverture du studio impossible.');
      const u = new URL(opened.url);
      if (u.hostname !== '127.0.0.1' || Number(u.port) <= 4199) throw new Error('Adresse de studio inattendue.');
      const ping = await json(u.origin + '/api/ping');
      if (!ping.studio || !same(ping.notesFile, path.join(example, 'revue', 'notes.json'))) throw new Error('Le studio ouvert ne correspond pas au bac V2.');
      url = u.href;
    }
    console.log('Accueil Coulisses V2 : ' + hub + '/\n' + (demo ? 'Studio E03 : ' + url : 'Accueil prêt pour importer un projet.'));
    if (!process.argv.includes('--no-open')) {
      const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {detached:true, windowsHide:true, stdio:'ignore'});
      browser.unref();
    }
  } finally { guard.close(); }
}
run().catch(err => { console.error(err.message); process.exitCode = 1; });

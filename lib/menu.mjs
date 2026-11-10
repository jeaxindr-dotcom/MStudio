// What the menu bar (menubar.js, in the home screen and the studio) asks the servers for: the app's documents in the
// user's language (Help › The agent's protocol, Pipeline contract), « About Coulisses », opening the Explorer on a path
// the SERVER knows (never a path sent by the page), the online documentation in the default browser, and the last lines
// of the server's own log (Tools › Log). Local only, like everything else (127.0.0.1).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { STUDIO, INSTALLED } from './place.mjs';
import { APP_NAME, APP_VERSION } from './app-profile.mjs';
import { lang, agentDocName, contractDocName } from './i18n.mjs';

export const VERSION = APP_VERSION;
export const LICENSE = 'MIT';
export const REPO_URL = 'https://github.com/jeaxindr-dotcom/MStudio';

// agent | contract | readme: the file in the user's language (French when the English one is missing)
export function docFile(name, l = lang()) {
  const f = name === 'agent' ? agentDocName(l) : name === 'contract' ? path.join('docs', contractDocName(l)) : name === 'readme' ? (l === 'fr' ? 'README.fr.md' : 'README.md') : null;
  if (!f) return null;
  const abs = path.join(STUDIO, f);
  return fs.existsSync(abs) ? abs : name === 'readme' ? path.join(STUDIO, 'README.md') : path.join(STUDIO, name === 'agent' ? agentDocName('fr') : path.join('docs', contractDocName('fr')));
}
export function docText(name, l = lang()) {
  const file = docFile(name, l);
  try { return { file, text: fs.readFileSync(file, 'utf8') }; } catch { return null; }
}

// « About »: the version, where this copy lives, the date it was installed, the git commit of the workshop
export function about() {
  let installed = null, commit = null, branch = null;
  try { installed = JSON.parse(fs.readFileSync(path.join(STUDIO, 'installed.json'), 'utf8')).installed ?? null; } catch { /* the workshop */ }
  try {
    const head = fs.readFileSync(path.join(STUDIO, '.git', 'HEAD'), 'utf8').trim(), ref = /^ref: (.+)$/.exec(head)?.[1];
    branch = ref ? ref.replace(/^refs\/heads\//, '') : null;
    let sha = ref && fs.existsSync(path.join(STUDIO, '.git', ref)) ? fs.readFileSync(path.join(STUDIO, '.git', ref), 'utf8').trim() : ref ? null : head;
    if (!sha && ref) sha = new RegExp(`^([0-9a-f]{40}) ${ref.replace(/[/]/g, '\\/')}$`, 'm').exec(fs.readFileSync(path.join(STUDIO, '.git', 'packed-refs'), 'utf8'))?.[1] ?? null;
    commit = sha ? sha.slice(0, 7) : null;
  } catch { /* not a git folder (the installed copy) */ }
  return { name: APP_NAME, version: VERSION, installed, commit, branch, license: LICENSE, url: REPO_URL, folder: STUDIO, place: INSTALLED ? 'installed' : 'workshop', node: process.version };
}

// the Windows Explorer on a folder, or on a file selected in its folder; the default browser on the online documentation
const explorer = (arg) => {
  if (process.env.COULISSES_EXPLORER_LOG) { fs.appendFileSync(process.env.COULISSES_EXPLORER_LOG, arg + '\n'); return; }   // the tests: no window
  const c = spawn('explorer.exe', [arg], { detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true });
  c.on('error', () => {}); c.unref();
};
export function reveal(target, { select = false } = {}) {
  if (!target || !fs.existsSync(target)) throw new Error(target ? `${target} ?` : '—');
  explorer(select ? `/select,"${path.resolve(target)}"` : `"${path.resolve(target)}"`);
}
export const openOnline = () => explorer(`"${REPO_URL}"`);

// the last lines a server wrote (Tools › Log)
export function logRing(max = 400) {
  const lines = [];
  return { push: (l) => { for (const x of String(l).split('\n')) { lines.push(x); if (lines.length > max) lines.shift(); } }, text: () => lines.join('\n') };
}
// the .coulisses file of a project: the run's own, or the one of an episode's folder (new-episode.mjs writes it)
export function coulissesOf(P) {
  if (P.coulisses) return P.coulisses;
  try { const f = fs.readdirSync(P.EP).find((x) => x.toLowerCase().endsWith('.coulisses')); return f ? path.join(P.EP, f) : null; } catch { return null; }
}

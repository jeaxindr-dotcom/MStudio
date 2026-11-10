// Where this copy of Coulisses (formerly « Brambleshire Studio ») lives, and what follows from it.
//   - the Dev workshop (…\Dev\remotion-studio): sandbox, tests, port 4174, cache in .cache\
//   - the installed app (%LOCALAPPDATA%\Programs\Coulisses\, by install.mjs, which writes
//     installed.json there): the real episodes and projects, port 4173 (the review tool's port: finish-render.sh's check
//     stays valid), and its data OUTSIDE every project, in %LOCALAPPDATA%\Coulisses\ — the cache holds a junction to
//     06_Remotion\public (≈ 3 GB of art), which must never sit inside a folder that someone may clean recursively.
//   - an old install inside the Brambleshire pipeline (…\06_Remotion\review\studio) is still recognised.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { t, lang } from './i18n.mjs';
import { MSTUDIO, APP_NAME, APP_DATA, STUDIO_PORT } from './app-profile.mjs';

export const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD_PLACE = path.basename(path.resolve(STUDIO, '..', '..')).toLowerCase() === '06_remotion';
export const INSTALLED = MSTUDIO || OLD_PLACE || fs.existsSync(path.join(STUDIO, 'installed.json'));
export const INSTALLED_THEATRE = OLD_PLACE ? path.resolve(STUDIO, '..', '..', '..') : null;
export const DEFAULT_PORT = INSTALLED ? STUDIO_PORT : 4174;
export { APP_NAME };
export const DATA = APP_DATA;
const tag = crypto.createHash('sha1').update(STUDIO.toLowerCase()).digest('hex').slice(0, 8);
export const CACHE = INSTALLED ? path.join(DATA, `cache-${tag}`) : path.join(STUDIO, '.cache');
// the list of imported projects (lib/projects.mjs): one per copy, so the Dev workshop's tests never touch the user's
// list. STUDIO_PROJECTS overrides it (tests).
export const PROJECTS_FILE = MSTUDIO ? path.join(DATA, 'projets.json') : process.env.STUDIO_PROJECTS ?? path.join(INSTALLED ? DATA : CACHE, 'projets.json');

// a note left in the cache, next to the junction (LISEZMOI.txt in French, README.txt in English)
export function cacheReadme() {
  const l = lang(), f = path.join(CACHE, l === 'fr' ? 'LISEZMOI.txt' : 'README.txt');
  if (fs.existsSync(path.join(CACHE, 'LISEZMOI.txt')) || fs.existsSync(path.join(CACHE, 'README.txt'))) return;
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, t('place.readme', { studio: STUDIO }, l).split('\n').join('\r\n'));
}

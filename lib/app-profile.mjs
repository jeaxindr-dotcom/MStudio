import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const APP_DIR = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');
const marker = path.join(APP_DIR, 'mstudio.json');
export const MSTUDIO = process.env.MSTUDIO_APP === '1' || fs.existsSync(marker);
export const APP_NAME = MSTUDIO ? 'MStudio' : 'Coulisses';
let desktopVersion;
if (MSTUDIO && fs.existsSync(marker)) desktopVersion = JSON.parse(fs.readFileSync(marker, 'utf8')).version;
export const APP_VERSION = MSTUDIO ? (desktopVersion || '0.2.0') : '1.2.0';
export const APP_DATA = MSTUDIO && process.env.MSTUDIO_DATA_DIR
  ? path.resolve(process.env.MSTUDIO_DATA_DIR)
  : path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), APP_NAME);
export const ENGINE_DIR = MSTUDIO ? path.resolve(process.env.MSTUDIO_ENGINE_DIR || path.join(APP_DIR, 'engine')) : null;
export const HUB_PORT = MSTUDIO ? 4510 : 4170;
export const STUDIO_PORT = MSTUDIO ? 4520 : 4173;
export const LAST_PORT = MSTUDIO ? 4549 : 4199;
export const LAST_HUB_PORT = MSTUDIO ? 4519 : LAST_PORT;

if (MSTUDIO) {
  // FFmpeg, Remotion, their Chromium and the startup sweep all use this directory.
  const temp = path.join(APP_DATA, 'temp');
  fs.mkdirSync(temp, {recursive: true});
  process.env.TEMP = temp;
  process.env.TMP = temp;
  if (process.platform !== 'win32') process.env.TMPDIR = temp;
}

export function isOwnStudio(record) {
  return record?.app === APP_NAME && samePath(record.studioDir, APP_DIR) && samePath(record.dataDir, APP_DATA);
}

function samePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const compare = s => process.platform === 'win32' ? path.resolve(s).toLowerCase() : path.resolve(s);
  return compare(a) === compare(b);
}

export function processIdentity(pid = process.pid) {
  return {app: APP_NAME, pid, studioDir: APP_DIR, dataDir: APP_DATA};
}

// Shared project documents carry the editor's live lock. Older Coulisses versions
// have no product field and are foreign owners from MStudio's perspective.
export function assertReviewAvailable(reviewDir) {
  if (!MSTUDIO) return;
  const file = path.join(reviewDir, 'studio.lock.json');
  let owner;
  try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return;
    throw new Error("Le verrou de cette revue est illisible. MStudio ne peut pas l'ouvrir.");
  }
  if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1) throw new Error('Verrou de revue invalide.');
  if (isOwnStudio(owner)) return;
  try { process.kill(owner.pid, 0); }
  catch (error) { if (error.code === 'ESRCH') return; }
  throw new Error('Cette revue est ouverte dans une autre instance. Pour la modifier dans MStudio, utilise une copie ou ferme d’abord le studio qui la détient.');
}

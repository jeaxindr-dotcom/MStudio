// Les lots de plusieurs studios partagent le même cache de Coulisses.
import fs from 'node:fs';
import path from 'node:path';
import { CACHE } from './place.mjs';
import { pad3, readJsonStrict, updateJson, writeJson } from './episode.mjs';

const root = path.resolve(CACHE, 'lot-captures');
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const marker = 'proprietaire.json';
const canonical = (s) => process.platform === 'win32' ? s.toLowerCase() : s;
const literal = (p) => canonical(fs.realpathSync.native(p)) === canonical(path.resolve(p));
const project = (p) => canonical(fs.realpathSync.native(p.REVUE));
function directory(p) {
  const stat = fs.lstatSync(p);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !literal(p)) throw new Error(`Dossier de captures redirigé : ${p}`);
}
export function captureWorkspace(id) {
  if (!uuid.test(id)) throw new Error('Identifiant de capture invalide');
  return path.join(root, id);
}
export function createCaptureWorkspace(p, data) {
  fs.mkdirSync(CACHE, {recursive: true});
  directory(CACHE);
  fs.mkdirSync(root, {recursive: true});
  directory(root);
  const id = data.captureState.id, dir = captureWorkspace(id);
  fs.mkdirSync(dir);   // exclusif : cette création ne réutilise jamais un ancien dossier
  writeJson(path.join(dir, marker), {id, lot: data.lot, revue: project(p), pid: process.pid});
  return dir;
}
function ownerOf(p, id) {
  directory(root);
  const dir = captureWorkspace(id); directory(dir);
  const file = path.join(dir, marker);
  if (!fs.lstatSync(file).isFile() || !literal(file)) return null;
  const o = readJsonStrict(file, null);
  return o?.id === id && o.revue === project(p) && Number.isSafeInteger(o.lot) && o.lot > 0 && Number.isSafeInteger(o.pid) && o.pid > 0 ? o : null;
}
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code !== 'ESRCH'; }
}
// Deux studios peuvent rouvrir le même projet au même instant après un arrêt brutal.
// Relire le PID sous le verrou évite qu'ils reprennent tous deux le même rendu.
export function claimCaptureWorkspace(p, lot) {
  const id = lot.captureState.id, dir = captureWorkspace(id);
  if (!fs.existsSync(dir)) return true; // le travail signalera le manifeste manquant sur la carte
  const owner = ownerOf(p, id);
  if (!owner || owner.lot !== lot.lot) throw new Error('Propriétaire des captures inconnu.');
  if (alive(owner.pid)) return owner.pid === process.pid;
  let mine = false;
  updateJson(path.join(dir, marker), null, (current) => {
    if (current?.id !== id || current.revue !== owner.revue || current.lot !== lot.lot) throw new Error('Propriétaire des captures modifié.');
    if (current.pid !== process.pid && alive(current.pid)) return;
    mine = true; current.pid = process.pid;
  });
  return mine;
}

// Chaque jonction (public, node_modules, etc.) est détachée comme un lien.
// Le marqueur est effacé en dernier pour permettre la reprise du nettoyage.
function unlinkChildren(dir, keepMarker = false) {
  directory(dir);
  for (const name of fs.readdirSync(dir)) {
    if (keepMarker && name === marker) continue;
    const file = path.join(dir, name), info = fs.lstatSync(file);
    if (info.isDirectory() && !info.isSymbolicLink()) { unlinkChildren(file); fs.rmdirSync(file); }
    else fs.unlinkSync(file);
  }
}
function removeOwned(id) {
  const dir = captureWorkspace(id);
  unlinkChildren(dir, true);
  fs.unlinkSync(path.join(dir, marker));
  fs.rmdirSync(dir);
}
export function releaseCaptureWorkspace(p, id) {
  if (fs.existsSync(captureWorkspace(id)) && ownerOf(p, id)?.pid === process.pid) removeOwned(id);
}
export function sweepCaptureWorkspaces(p, log) {
  if (!fs.existsSync(root)) return;
  directory(root);
  for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !uuid.test(entry.name)) continue;
    try {
      const owner = ownerOf(p, entry.name);
      if (!owner || alive(owner.pid)) continue;
      const lot = readJsonStrict(path.join(p.LOTS, pad3(owner.lot) + '.json'), null);
      if (lot?.captureState?.id === owner.id && lot.captureState.status === 'pending') continue;
      removeOwned(entry.name);
    } catch (e) {
      // Un ancien cache sans marqueur ou un fichier verrouillé reste en place.
      if (e.code !== 'ENOENT') log(e.message);
    }
  }
}

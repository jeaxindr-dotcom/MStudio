// The media library of a channel (the studio's « Médias » tab): the images made by the image chat (lib/image-chat.mjs),
// the ones the user drops in, and the ones a pipeline's agent adds (studio-cli.mjs medias), sorted by category. One
// library per channel (user's choice, 08/10/2026): every episode of a channel shares its characters, sets and props.
//
//   <root>\<channel>\                 root = Documents\Coulisses\Médias (installed app; chosen once, kept in settings.json
//     bibliotheque.json                 as mediasRoot), .cache\medias in the Dev workshop, COULISSES_MEDIAS for the tests
//     personnages\ decors\ accessoires\ effets\ divers\    the images, by category (the folder IS the category)
//     a-ranger\                        dropped in, not sorted yet: the agent sorts them (lib/image-chat.mjs classify)
//     _coulisses\                      Coulisses' own files: miniatures\, corbeille\ (deleted images), chat.json, travaux\
//
// bibliotheque.json is written by Coulisses only (this file); the images may be moved or added by hand in the Explorer:
// a file that appears is indexed (its folder gives its category), a file that disappears leaves the index, and a file
// moved to another folder keeps its record (same name and size).
// Placing an image in a project never points at the library: the image goes with the edit, and the agent copies it into
// the project (lib/lots.mjs, « Média de la bibliothèque »).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';   // spawnSync: the Documents folder (reg query)
import { CACHE, INSTALLED } from './place.mjs';
import { APP_NAME, MSTUDIO } from './app-profile.mjs';
import { t, lang, readSettings, writeSettings } from './i18n.mjs';

export const CATEGORIES = ['personnages', 'decors', 'accessoires', 'effets', 'divers'];
export const INBOX = 'a-ranger';
export const ALL_CATS = [...CATEGORIES, INBOX];
export const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
export const TYPE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const INDEX = 'bibliotheque.json', SYS = '_coulisses';
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const extOf = (f) => path.extname(f).slice(1).toLowerCase();
const mkdir = (d) => fs.mkdirSync(d, { recursive: true });
const readdir = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };
const norm = (rel) => rel.replace(/\\/g, '/').toLowerCase();

// ---------- where ----------
// the user's Documents folder (it may be elsewhere than C:\Users\<name>\Documents: OneDrive, another drive)
function documentsDir() {
  if (process.platform === 'win32') {
    try {
      const r = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders', '/v', 'Personal'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
      const m = /Personal\s+REG_\w+\s+(.+)/.exec(r.stdout ?? '');
      if (m && fs.existsSync(m[1].trim())) return m[1].trim();
    } catch { /* the default below */ }
  }
  return path.join(os.homedir(), 'Documents');
}
// the folder of every library; its name is chosen once, in the user's language at that time, and then kept
export function mediasRoot() {
  const override = MSTUDIO ? process.env.MSTUDIO_MEDIAS_ROOT : process.env.COULISSES_MEDIAS;
  if (override) return path.resolve(override);
  const s = readSettings().mediasRoot;
  if (s) return s;
  if (!INSTALLED) return path.join(CACHE, 'medias');
  const root = path.join(documentsDir(), APP_NAME, lang() === 'fr' ? 'Médias' : 'Media');
  try { writeSettings({ mediasRoot: root }); } catch { /* chosen again next time */ }
  return root;
}
export const channelName = (c) => String(c ?? '').trim() || 'Divers';
const safeName = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').slice(0, 80) || 'Divers';
// the library of one channel: its folders and files
export function library(channel, root = mediasRoot()) {
  const name = channelName(channel), dir = path.join(root, safeName(name)), sys = path.join(dir, SYS);
  return { channel: name, root, dir, index: path.join(dir, INDEX), sys, minis: path.join(sys, 'miniatures'), trash: path.join(sys, 'corbeille'),
    chat: path.join(sys, 'chat.json'), jobs: path.join(sys, 'travaux') };
}
export function ensureLibrary(L) {
  for (const c of ALL_CATS) mkdir(path.join(L.dir, c));
  mkdir(L.minis);
  const readme = path.join(L.dir, lang() === 'fr' ? 'LISEZMOI.txt' : 'README.txt');
  if (!fs.existsSync(path.join(L.dir, 'LISEZMOI.txt')) && !fs.existsSync(path.join(L.dir, 'README.txt')))
    fs.writeFileSync(readme, t('md.readme', { channel: L.channel, index: INDEX, inbox: INBOX, cats: CATEGORIES.join(', ') }).split('\n').join('\r\n'));
  return L;
}

// ---------- names ----------
// a file name from a display name: lower case, words joined by « - », accents of Latin letters dropped (« décor » ->
// « decor »), any other script kept as it is (宇宙ちゃん stays 宇宙ちゃん)
export function slug(s) {
  return String(s ?? '').normalize('NFD').replace(/([A-Za-z])\p{M}+/gu, '$1').normalize('NFC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}
// a display name from a file name: « uchu-chan_salut-2.png » -> « uchu chan salut 2 »
export const humanize = (f) => path.basename(f, path.extname(f)).replace(/[-_]+/g, ' ').trim() || 'image';
// never overwrite: « pomme.png », then « pomme-2.png », « pomme-3.png »…
function freeName(dir, base, ext) {
  for (let i = 1; ; i++) {
    const f = path.join(dir, `${base}${i > 1 ? `-${i}` : ''}.${ext}`);
    if (!fs.existsSync(f)) return f;
  }
}

// ---------- what an image is: its size, and whether it can be transparent (read from its header) ----------
export function imageInfo(file) {
  let b; try { const fd = fs.openSync(file, 'r'); b = Buffer.alloc(65536); const n = fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd); b = b.subarray(0, n); } catch { return { w: null, h: null, alpha: null }; }
  try {
    if (b.length > 26 && b.readUInt32BE(0) === 0x89504e47) {   // PNG: IHDR, then a tRNS chunk before IDAT
      const w = b.readUInt32BE(16), h = b.readUInt32BE(20), ct = b[25];
      let alpha = ct === 4 || ct === 6;
      for (let o = 8; !alpha && o + 8 <= b.length;) { const len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8); if (type === 'tRNS') alpha = true; if (type === 'IDAT') break; o += 12 + len; }
      return { w, h, alpha };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {   // JPEG: the first SOF marker
      for (let o = 2; o + 9 < b.length;) {
        if (b[o] !== 0xff) { o++; continue; }
        const m = b[o + 1], len = b.readUInt16BE(o + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(o + 7), h: b.readUInt16BE(o + 5), alpha: false };
        o += 2 + len;
      }
      return { w: null, h: null, alpha: false };
    }
    if (b.toString('latin1', 0, 4) === 'GIF8') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8), alpha: null };
    if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
      const c = b.toString('latin1', 12, 16);
      if (c === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), alpha: !!(b[20] & 0x10) };
      if (c === 'VP8L') { const b0 = b[21], b1 = b[22], b2 = b[23], b3 = b[24]; return { w: 1 + (b0 | ((b1 & 0x3f) << 8)), h: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)), alpha: !!(b3 & 0x10) }; }
      if (c === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, alpha: false };
    }
  } catch { /* a damaged header */ }
  return { w: null, h: null, alpha: null };
}

// ---------- the index ----------
function readIndex(L, { strict = false } = {}) {
  const empty = () => ({ 'coulisses-medias': 1, chaine: L.channel, items: [] });
  for (let i = 0; ; i++) {
    let txt; try { txt = fs.readFileSync(L.index, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return empty(); txt = null; }
    if (txt !== null) try { const j = JSON.parse(txt.replace(/^\uFEFF/, '')); if (j && Array.isArray(j.items)) return j; } catch { /* being written: again */ }
    if (!strict) return empty();   // (a reader: as before)
    if (i >= 20) throw new Error(`${L.index} : illisible — rien n'est écrit`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
}
function writeIndex(L, j) {
  mkdir(L.dir);
  j['coulisses-medias'] = 1; j.chaine = L.channel; j.modifie = nowIso();
  const tmp = `${L.index}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(j, null, 1));
  // Windows: a reader (another studio, an antivirus) may hold the file for an instant. A few short tries, then a copy
  // over it — never a long synchronous wait (code review, 08/10/2026: 20 × 50 ms froze the whole server up to 1 s)
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, L.index); return; } catch (e) {
      if (i < 30 && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); continue; }
      fs.rmSync(tmp, { force: true }); throw e;
    }
  }
}
// read-modify-write of the index (several studios of the same channel may be open: each change re-reads it first)
function change(L, fn) { const j = readIndex(L, { strict: true }); const r = fn(j); writeIndex(L, j); return r; }

const newId = () => 'm' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
function record(L, file, extra = {}) {
  const rel = path.relative(L.dir, file).split(path.sep).join('/'), info = imageInfo(file), st = fs.statSync(file);
  const top = rel.includes('/') ? rel.split('/')[0] : INBOX;
  return { id: newId(), fichier: rel, nom: extra.nom || humanize(file), categorie: ALL_CATS.includes(top) ? top : INBOX, tags: [], description: '',
    prompt: null, source: 'dossier', transparent: info.alpha, largeur: info.w, hauteur: info.h, taille: st.size, cree: nowIso(), utilisations: [],
    ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) };
}
const isImage = (f) => !!IMAGE_TYPES[extOf(f)];
// the images on disk, at the root (not sorted) and in each category folder
function filesOnDisk(L) {
  const out = [];
  for (const d of readdir(L.dir)) if (d.isFile() && isImage(d.name)) out.push(d.name);
  for (const c of ALL_CATS) for (const d of readdir(path.join(L.dir, c))) if (d.isFile() && isImage(d.name)) out.push(`${c}/${d.name}`);
  return out;
}

// the library as it is on disk (the index follows the Explorer: files added, removed or moved by hand)
export function listMedias(L) {
  ensureLibrary(L);
  const j = readIndex(L), disk = filesOnDisk(L), onDisk = new Set(disk.map(norm));
  const gone = j.items.filter((it) => !onDisk.has(norm(it.fichier)));
  const known = new Set(j.items.filter((it) => onDisk.has(norm(it.fichier))).map((it) => norm(it.fichier)));
  const fresh = disk.filter((rel) => !known.has(norm(rel)));
  if (!gone.length && !fresh.length) return j.items;
  return change(L, (k) => {
    const keep = k.items.filter((it) => onDisk.has(norm(it.fichier)));
    const lost = k.items.filter((it) => !onDisk.has(norm(it.fichier)));
    const have = new Set(keep.map((it) => norm(it.fichier)));
    for (const rel of disk.filter((r) => !have.has(norm(r)))) {
      const file = path.join(L.dir, rel), size = fs.statSync(file).size, name = path.basename(rel).toLowerCase();
      const i = lost.findIndex((it) => path.basename(it.fichier).toLowerCase() === name && it.taille === size);
      if (i >= 0) {   // moved by hand: the same record, in its new folder
        const it = lost.splice(i, 1)[0], top = rel.includes('/') ? rel.split('/')[0] : INBOX;
        keep.push({ ...it, fichier: rel, categorie: ALL_CATS.includes(top) ? top : INBOX, modifie: nowIso() });
      } else keep.push(record(L, file));
    }
    k.items = keep;
    return keep;
  });
}
export const findMedia = (L, id) => listMedias(L).find((it) => it.id === id) ?? null;
export const peekMedia = (L, id) => readIndex(L).items.find((it) => it.id === id) ?? null;   // no scan of the folders (thumbnails)
export const mediaFile = (L, it) => path.join(L.dir, ...it.fichier.split('/'));

// a new image in the library: copied (or moved) into its category folder, under a name made from its display name
export function addMedia(L, src, { nom, categorie = INBOX, tags = [], description = '', prompt = null, source = 'import', parent = null, session = null, transparent, move = false, ext } = {}) {
  ensureLibrary(L);
  const e = (ext ?? extOf(src)).replace(/^jpeg$/, 'jpg');
  if (!IMAGE_TYPES[e]) throw new Error(t('md.err.type', { ext: e || '?' }));
  const cat = ALL_CATS.includes(categorie) ? categorie : 'divers';
  const base = slug(nom || humanize(src)) || 'image';
  const file = freeName(path.join(L.dir, cat), base, e);
  if (move) { try { fs.renameSync(src, file); } catch { fs.copyFileSync(src, file); fs.rmSync(src, { force: true }); } } else fs.copyFileSync(src, file);
  const it = record(L, file, { nom: String(nom || humanize(src)).trim().slice(0, 120), categorie: cat, tags: cleanTags(tags), description: String(description ?? '').trim().slice(0, 500),
    prompt, source, parent, session, transparent: transparent ?? undefined });
  if (it.transparent === undefined) it.transparent = imageInfo(file).alpha;
  change(L, (j) => { j.items.push(it); });
  return it;
}
// bytes received by the server (an image dropped on the tab): into « à ranger »
export function importBytes(L, buf, { type, name } = {}) {
  const e = TYPE_EXT[type] ?? extOf(name ?? '');
  if (!IMAGE_TYPES[e]) throw new Error(t('md.err.type', { ext: e || type || '?' }));
  mkdir(L.sys);
  const tmp = path.join(L.sys, `import-${Date.now().toString(36)}.${e}`);
  fs.writeFileSync(tmp, buf);
  return addMedia(L, tmp, { nom: name ? humanize(name) : 'image', categorie: INBOX, source: 'import', move: true, ext: e });
}
const cleanTags = (tags) => [...new Set((Array.isArray(tags) ? tags : String(tags ?? '').split(','))
  .map((x) => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, 16);

// a change of name, category, tags or description; a new name or category moves the file (same rule as addMedia)
export function updateMedia(L, id, patch = {}) {
  listMedias(L);
  return change(L, (j) => {
    const it = j.items.find((x) => x.id === id);
    if (!it) throw new Error(t('md.err.gone'));
    const cat = patch.categorie !== undefined ? (ALL_CATS.includes(patch.categorie) ? patch.categorie : it.categorie) : it.categorie;
    const nom = patch.nom !== undefined ? String(patch.nom).trim().slice(0, 120) || it.nom : it.nom;
    if (cat !== it.categorie || slug(nom) !== slug(it.nom) || (patch.nom !== undefined && !it.fichier.includes('/'))) {
      const from = mediaFile(L, it), to = freeName(path.join(L.dir, cat), slug(nom) || 'image', extOf(from));
      if (path.resolve(from).toLowerCase() !== path.resolve(to).toLowerCase()) {
        mkdir(path.dirname(to)); fs.renameSync(from, to);
        it.fichier = path.relative(L.dir, to).split(path.sep).join('/');
        fs.rmSync(path.join(L.minis, `${it.id}.png`), { force: true });
      }
    }
    it.nom = nom; it.categorie = cat;
    if (patch.tags !== undefined) it.tags = cleanTags(patch.tags);
    if (patch.description !== undefined) it.description = String(patch.description ?? '').trim().slice(0, 500);
    if (patch.transparent !== undefined) it.transparent = !!patch.transparent;
    if (patch.trie !== undefined) it.trie = patch.trie;
    it.modifie = nowIso();
    return { ...it };
  });
}
// deleting puts the image in _coulisses\corbeille (never lost by a wrong click)
export function removeMedia(L, id) {
  listMedias(L);
  return change(L, (j) => {
    const i = j.items.findIndex((x) => x.id === id);
    if (i < 0) throw new Error(t('md.err.gone'));
    const it = j.items[i], from = mediaFile(L, it);
    mkdir(L.trash);
    const to = path.join(L.trash, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${path.basename(from)}`);
    try { fs.renameSync(from, to); } catch (e) { if (fs.existsSync(from)) throw e; }
    fs.rmSync(path.join(L.minis, `${it.id}.png`), { force: true });
    j.items.splice(i, 1);
    return { id, trash: to };
  });
}
// where an image was placed (« Placer dans le projet »), shown in its card
export function recordUse(L, id, use) {
  return change(L, (j) => {
    const it = j.items.find((x) => x.id === id);
    if (!it) return null;
    it.utilisations = [...(it.utilisations ?? []), { ...use, date: nowIso() }].slice(-50);
    return it;
  });
}

// ---------- small copies for the grid (ffmpeg, kept in _coulisses\miniatures, transparency kept) ----------
const making = new Map();
// at most 4 ffmpeg at once (a big library opened for the first time asks for every thumbnail together)
let busyMakers = 0; const waiting = [];
const slotFree = () => new Promise((r) => { if (busyMakers < 4) { busyMakers++; r(); } else waiting.push(r); });
const slotDone = () => { const n = waiting.shift(); if (n) n(); else busyMakers--; };
export function miniature(L, it, size = 360) {
  const src = mediaFile(L, it), out = path.join(L.minis, `${it.id}.png`);
  try { if (fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) return Promise.resolve(out); } catch { /* to make */ }
  if (making.has(out)) return making.get(out);
  mkdir(L.minis);
  const tmp = out.replace(/\.png$/, `.${process.pid}.tmp.png`);
  const p = slotFree().then(() => new Promise((resolve) => {
    const c = spawn('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `scale=w=${size}:h=${size}:force_original_aspect_ratio=decrease`, '-frames:v', '1', tmp], { windowsHide: true, stdio: 'ignore' });
    c.on('error', () => resolve(src));
    c.on('close', (code) => {
      if (code === 0 && fs.existsSync(tmp)) { try { fs.renameSync(tmp, out); return resolve(out); } catch { /* another studio made it */ } }
      fs.rmSync(tmp, { force: true });
      resolve(fs.existsSync(out) ? out : src);   // the image itself if ffmpeg cannot
    });
  })).finally(() => { slotDone(); making.delete(out); });
  making.set(out, p);
  return p;
}

// the library as the page shows it
export function librarySummary(L) {
  const items = listMedias(L);
  const counts = Object.fromEntries(ALL_CATS.map((c) => [c, items.filter((it) => it.categorie === c).length]));
  return { channel: L.channel, dir: L.dir, root: L.root, categories: ALL_CATS, counts, items: [...items].sort((a, b) => (b.cree ?? '').localeCompare(a.cree ?? '')) };
}

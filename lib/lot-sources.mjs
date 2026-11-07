import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { stillSource, writeJson, readJsonStrict } from './episode.mjs';
import { CACHE } from './place.mjs';
import { bundleExternalLotEntry } from './frames.mjs';

const run = promisify(execFile);
const helper = fileURLToPath(new URL('./lot-media-stamps.cs', import.meta.url));
const binaryMedia = /\.(mp4|mkv|mov|webm|mp3|wav|m4a|flac|ogg|png|jpe?g|webp|avif|gif|tiff?|glb|fbx|woff2?|ttf|otf)$/i;
const canon = (s) => process.platform === 'win32' ? s.toLowerCase() : s;
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const stat = (file) => fs.statSync(file, { bigint: true });
const stamp = (s) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].map(String).join(':');

function nodeFingerprint(roots, limit = Infinity) {
  const hash = crypto.createHash('sha256'), visited = new Set(); let files = 0;
  function walk(dir, label) {
    const real = fs.realpathSync.native(dir), key = canon(real);
    hash.update(JSON.stringify([label, real]));
    if (visited.has(key)) return;   // Chaque alias est décrit, mais le même contenu n'est parcouru qu'une fois.
    visited.add(key);
    for (const name of fs.readdirSync(real).sort()) {
      if (name === '.cache' && path.basename(real) === 'node_modules') continue;
      const f = path.join(real, name), s = stat(f), rel = path.join(label, name);
      if (s.isDirectory()) walk(f, rel);
      else {
        if (++files > limit) throw new RangeError('Énumération groupée nécessaire.');
        hash.update(JSON.stringify([rel, stamp(s)]));
      }
    }
  }
  for (const dir of roots) walk(dir, dir);
  return files + ':' + hash.digest('base64');
}

let nativeHelper;
async function compileHelper() {
  const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(helper)).digest('hex');
  const dir = path.join(CACHE, 'outils-captures'), exe = path.join(dir, 'medias-' + sourceHash + '.exe');
  fs.mkdirSync(dir, { recursive: true });
  // Le projet ne choisit ni le compilateur, ni son source, ni le dossier de l'exécutable.
  if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('Dossier des outils de capture redirigé.');
  const existing = () => {
    if (!fs.existsSync(exe)) return false;
    if (!fs.lstatSync(exe).isFile()) throw new Error('Outil de capture redirigé.');
    return true;
  };
  if (existing()) return exe;
  const framework = path.join(process.env.SystemRoot, 'Microsoft.NET');
  const csc = ['Framework64', 'Framework'].map(f => path.join(framework, f, 'v4.0.30319', 'csc.exe')).find(f => fs.existsSync(f));
  if (!csc) throw new Error('Compilateur du Framework Windows indisponible.');
  const temp = path.join(dir, crypto.randomUUID() + '.exe');
  try {
    await run(csc, ['/nologo', '/noconfig', '/reference:System.dll', '/optimize+', '/target:exe', '/out:' + temp, helper], { cwd: dir, windowsHide: true, timeout: 30000, env: { ...process.env, TEMP: dir, TMP: dir } });
    // Création exclusive du nom final à partir du fichier complet, même entre serveurs.
    try { fs.linkSync(temp, exe); } catch (e) { if (e.code !== 'EEXIST' || !existing()) throw e; }
  } finally { fs.rmSync(temp, { force: true }); }
  return exe;
}

async function directoryFingerprint(roots, mode) {
  if (mode !== 'windows') {
    try { return { mode: 'node', signature: nodeFingerprint(roots, !mode && process.platform === 'win32' ? 160 : Infinity) }; }
    catch (e) { if (!(e instanceof RangeError)) throw e; }
  }
  try {
    const exe = await (nativeHelper ??= compileHelper().catch(e => { nativeHelper = null; throw e; }));
    const { stdout } = await run(exe, roots, { cwd: path.dirname(exe), windowsHide: true, timeout: 120000 });
    const signature = stdout.trim();
    if (!/^\d+:[A-Za-z0-9+/]+=*$/.test(signature)) throw new Error('Empreinte Windows illisible.');
    return { mode: 'windows', signature };
  } catch (e) {
    // Système de fichiers sans FILE_ID_BOTH_DIR_INFO, lien imbriqué ou PowerShell indisponible.
    if (mode === 'windows') throw e;
    return { mode: 'node', signature: nodeFingerprint(roots) };
  }
}

function freezeCode(p, dir, mediaDirs, mediaFiles, copied) {
  const hf = p.kind === 'hyperframes', brambleshire = p.kind === 'brambleshire';
  const original = path.resolve(hf ? p.hf.projet : p.remotionDir), target = path.join(dir, 'projet');
  const entry = p.remotion?.entree && path.resolve(original, p.remotion.entree);
  const external = entry && !inside(canon(original), canon(entry)) ? canon(fs.realpathSync.native(entry)) : null;
  let privateEntry = null;
  const privateDir = canon(fs.realpathSync.native(dir));
  const skip = new Set([p.REVUE, ...(p.exportRule?.dossiers ?? [])].filter(Boolean).map((f) => canon(path.resolve(f))));
  const visiting = new Set();
  function copy(from, to, atRoot = false) {
    const real = fs.realpathSync.native(from), key = canon(real), info = stat(real);
    if (inside(privateDir, key)) return;
    if (external && key === external && info.isFile()) privateEntry = to;
    if (info.isDirectory()) {
      if (visiting.has(key)) throw new Error(`Cycle dans les sources : ${from}`);
      const entries = fs.readdirSync(real, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      // Les bibliothèques de médias sont souvent sur un autre volume. Une jonction suffit
      // pour une feuille uniquement binaire ; un fichier de code voisin est toujours copié.
      if (!atRoot && entries.length && entries.every(e => e.isFile() && binaryMedia.test(e.name))) {
        fs.symlinkSync(real, to, 'junction'); mediaDirs.add(real); return;
      }
      copied.set(from, stamp(info));
      visiting.add(key); fs.mkdirSync(to, { recursive: true });
      for (const { name } of entries) {
        const file = path.join(from, name), dest = path.join(to, name);
        if (name === '.git' || name === '.cache' || skip.has(canon(file))) continue;
        if (atRoot && brambleshire && !/^(src|episodes|public|node_modules|[^/]+\.json)$/.test(name)) continue;
        if (name === 'node_modules') { const deps = fs.realpathSync.native(file); fs.symlinkSync(deps, dest, 'junction'); mediaDirs.add(deps); continue; }
        if (atRoot && /^(revue|renders?|exports?|out|07-renders)$/i.test(name) && fs.statSync(file).isDirectory()) continue;
        if (atRoot && brambleshire && name === 'public') {
          const source = fs.realpathSync.native(file);
          fs.symlinkSync(source, dest, 'junction'); mediaDirs.add(source); continue;
        }
        copy(file, dest);
      }
      visiting.delete(key);
    } else if (binaryMedia.test(from) || info.size > 16 * 1024 * 1024) {
      try { fs.linkSync(real, to); }
      catch (e) {
        // Un prêt de fichier entre volumes utilise un lien si possible. Pour un média volumineux,
        // l'échec est explicite plutôt que de retarder l'envoi par une copie de plusieurs Go.
        try { fs.symlinkSync(real, to, 'file'); }
        catch { if (info.size > 16 * 1024 * 1024) throw new Error(`Média impossible à figer : ${from} (${e.code})`); fs.copyFileSync(real, to); return; }
      }
      mediaFiles.push({ file: to, original: real });
    } else if (info.isFile()) { copied.set(from, stamp(info)); fs.copyFileSync(real, to); }
    else throw new Error(`Source non prise en charge : ${from}`);
  }
  copy(original, target, true);
  const mapped = (file) => {
    if (!file) return file;
    const absolute = path.resolve(original, file);
    if (!inside(canon(original), canon(absolute))) throw new Error(`Source hors du projet : ${absolute}`);
    return path.join(target, path.relative(original, absolute));
  };
  if (hf) { mapped(p.hf.index); return { hf: { ...p.hf, projet: target } }; }
  if (!p.remotion) return { remotionDir: target };
  const remotion = { ...structuredClone(p.remotion), projet: target };
  // Le rendu utilise l'entrée Remotion. Le module du Player et sa timeline optionnelle
  // appartiennent à l'aperçu interactif et peuvent se trouver dans un autre dossier.
  delete remotion.module;
  delete remotion.timeline;
  if (remotion.public) remotion.public = mapped(remotion.public);
  if (external && !privateEntry) {
    // Un lien dur dans un autre répertoire peut avoir des imports relatifs différents.
    // Compiler depuis l’entrée déclarée préserve cette résolution.
    copied.set(entry, stamp(stat(entry)));
    delete remotion.entree;
    return {remotionDir: target, remotion, externalEntry: entry};
  }
  if (entry) remotion.entree = privateEntry ?? mapped(entry);
  return { remotionDir: target, remotion };
}

function heldFile(file, original) { return { file, original, signature: stamp(stat(file)) }; }
function unchanged(held) {
  const current = stat(held.file), signature = stamp(current);
  if (signature === held.signature) return true;
  // Le remplacement atomique à la source peut modifier ChangeTime de l'ancien inode (un lien en moins).
  // Le fichier privé garde son inode, ses octets, sa taille et sa date d'écriture dans ce cas.
  if (signature.split(':').slice(0, 4).join(':') !== held.signature.split(':').slice(0, 4).join(':')) return false;
  try { const live = stat(held.original); return live.dev !== current.dev || live.ino !== current.ino; }
  catch (e) { if (e.code === 'ENOENT') return true; throw e; }
}

export async function freezeLotSources(p, { code = false, video = false, dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const mediaDirs = new Set(), files = [], copied = new Map();
  const sources = code ? freezeCode(p, dir, mediaDirs, files, copied) : {};
  if (video) {
    const source = stillSource(p);
    if (!source) throw new Error('Vidéo source absente.');
    const original = fs.realpathSync.native(source), file = path.join(dir, 'video' + path.extname(original));
    try { fs.linkSync(original, file); sources.video = file; }
    catch (e) {
      if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EACCES'].includes(e.code)) throw e;
      sources.video = original;
    }
    sources.videoFile = heldFile(sources.video, original);
  }
  if (mediaDirs.size || files.length) {
    const roots = [...mediaDirs].sort(), fingerprint = await directoryFingerprint(roots);
    const frozenFiles = files.map(({ file, original }) => heldFile(file, original));
    sources.mediaCount = Number(fingerprint.signature.split(':')[0]) + frozenFiles.length;
    sources.manifest = path.join(dir, 'medias.json');
    writeJson(sources.manifest, { roots, ...fingerprint, files: frozenFiles });
  }
  if (sources.externalEntry) {
    const bundleDir = path.join(dir, 'entree-compilee');
    await bundleExternalLotEntry(p.remotionDir, sources.externalEntry, sources.remotionDir, bundleDir);
    delete sources.externalEntry;
    sources.lotPrebuiltBundle = bundleDir;
    await checkLotSources(sources, 'code');
  }
  for (const [original, expected] of copied) {
    if (stamp(stat(original)) !== expected) throw new Error(`Source modifiée pendant la copie du lot : ${original}`);
  }
  return sources;
}

export function captureProject(p, sources) {
  return { ...p, ...(sources.hf ? { hf: sources.hf } : {}), ...(sources.remotionDir ? { remotionDir: sources.remotionDir, remotion: sources.remotion } : {}),
    ...(sources.lotPrebuiltBundle ? {lotPrebuiltBundle: sources.lotPrebuiltBundle} : {}) };
}

export async function checkLotSources(sources, type) {
  if (type === 'video' && sources.videoFile && !unchanged(sources.videoFile)) throw new Error('La vidéo a changé depuis l’envoi des notes.');
  if (type === 'code' && sources.manifest) {
    const saved = readJsonStrict(sources.manifest, null);
    if (!saved) throw new Error('Inventaire des médias du lot absent.');
    const { signature } = await directoryFingerprint(saved.roots, saved.mode);
    if (signature !== saved.signature || !saved.files.every(unchanged)) throw new Error('Un média ou une dépendance du projet a changé depuis l’envoi des notes.');
  }
}

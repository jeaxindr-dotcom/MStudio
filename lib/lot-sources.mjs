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
function assertAtSend(file, info, cutoff) {
  if (cutoff !== null && (info.mtimeMs > BigInt(cutoff) || info.ctimeMs > BigInt(cutoff))) {
    throw new Error(`Source modifiée depuis l’envoi des notes : ${file}`);
  }
}
// Only for isolated media too large to copy when Windows denies file symlinks.
// Every NTFS hard link updates ctime, so certify the bytes before making the link.
function digestFile(file) {
  const fd = fs.openSync(file, 'r'), bytes = Buffer.allocUnsafe(1024 * 1024), hash = crypto.createHash('sha256');
  try {
    let count;
    while ((count = fs.readSync(fd, bytes)) > 0) hash.update(bytes.subarray(0, count));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
function linkProofPath(file, info) {
  const identity = info.ino ? `${info.dev}:${info.ino}` : canon(file);
  const name = crypto.createHash('sha256').update(identity).digest('hex') + '.json';
  return path.join(CACHE, 'empreintes-liens-medias', name);
}
function previousLinkProof(file, info, cutoff) {
  if (info.mtimeMs <= BigInt(cutoff) && info.ctimeMs <= BigInt(cutoff)) return null;
  if (info.nlink > 1n && info.mtimeMs <= BigInt(cutoff)) {
    // Another worker publishes its receipt immediately after linkSync.
    const receipt = linkProofPath(file, info);
    for (let i = 0; i < 5; i++) {
      const proof = readJsonStrict(receipt, null);
      if (proof?.signature === stamp(info) && proof.since <= cutoff && /^[a-f0-9]{64}$/.test(proof.digest)) return proof;
      if (i < 4) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  assertAtSend(file, info, cutoff);
}
function certifyHardLink(file, to, info, cutoff, previous) {
  const digest = previous?.digest ?? digestFile(file);
  const before = stat(file);
  if (stamp(before) !== stamp(info)) {
    const concurrent = previousLinkProof(file, before, cutoff);
    if (concurrent?.digest !== digest) throw new Error(`Source modifiée pendant la copie du lot : ${file}`);
    previous = concurrent;
  }
  try { fs.linkSync(file, to); }
  catch (e) { throw new Error(`Média impossible à figer par lien dur (${e.code}) : ${file}`); }
  const linked = stat(to);
  if (['dev','ino','size','mtimeNs'].some(k => linked[k] !== before[k])) throw new Error(`Source remplacée pendant la copie du lot : ${file}`);
  const receipt = linkProofPath(file, linked);
  fs.mkdirSync(path.dirname(receipt), {recursive:true});
  writeJson(receipt, {signature:stamp(linked), since:previous?.since ?? Math.max(Number(info.mtimeMs), Number(info.ctimeMs)), digest});
  return digest;
}
const verifiedDigests = new Map();
function matchesDigest(held, info) {
  const signature = stamp(info);
  const cached = verifiedDigests.get(held.file);
  if (cached?.signature === signature) return cached.digest === held.digest;
  const digest = digestFile(held.file);
  if (digest !== held.digest) return false;
  const after = stat(held.file), verifiedSignature = stamp(after);
  if (verifiedSignature !== signature) {
    const concurrent = readJsonStrict(linkProofPath(held.original ?? held.file, after), null);
    if (concurrent?.signature !== verifiedSignature || concurrent.digest !== digest) return false;
  }
  if (verifiedDigests.size >= 64) verifiedDigests.delete(verifiedDigests.keys().next().value);
  verifiedDigests.set(held.file, {signature:verifiedSignature, digest});
  return true;
}

function nodeFingerprint(roots, limit = Infinity, cutoff = null) {
  const hash = crypto.createHash('sha256'), visited = new Set(); let files = 0;
  function walk(dir, label) {
    const real = fs.realpathSync.native(dir), key = canon(real);
    assertAtSend(dir, stat(real), cutoff);
    hash.update(JSON.stringify([label, real]));
    if (visited.has(key)) return;   // Chaque alias est décrit, mais le même contenu n'est parcouru qu'une fois.
    visited.add(key);
    for (const name of fs.readdirSync(real).sort()) {
      if (name === '.cache' && path.basename(real) === 'node_modules') continue;
      const f = path.join(real, name), s = stat(f), rel = path.join(label, name);
      if (cutoff !== null) {
        assertAtSend(f, s, cutoff);
        const link = fs.lstatSync(f, {bigint:true});
        if (link.isSymbolicLink()) assertAtSend(f, link, cutoff);
      }
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

async function directoryFingerprint(roots, mode, cutoff = null) {
  if (mode !== 'windows') {
    try { return { mode: 'node', signature: nodeFingerprint(roots, !mode && process.platform === 'win32' ? 160 : Infinity, cutoff) }; }
    catch (e) { if (!(e instanceof RangeError)) throw e; }
  }
  try {
    const exe = await (nativeHelper ??= compileHelper().catch(e => { nativeHelper = null; throw e; }));
    if (cutoff !== null) for (const root of roots) assertAtSend(root, stat(root), cutoff);
    const args = cutoff === null ? roots : ['--since=' + cutoff, ...roots];
    const { stdout } = await run(exe, args, { cwd: path.dirname(exe), windowsHide: true, timeout: 120000 });
    const signature = stdout.trim();
    if (!/^\d+:[A-Za-z0-9+/]+=*$/.test(signature)) throw new Error('Empreinte Windows illisible.');
    return { mode: 'windows', signature };
  } catch (e) {
    // Système de fichiers sans FILE_ID_BOTH_DIR_INFO, lien imbriqué ou PowerShell indisponible.
    if (e.code === 2 && e.stderr) throw new Error(e.stderr.trim());
    if (mode === 'windows') throw e;
    return { mode: 'node', signature: nodeFingerprint(roots, Infinity, cutoff) };
  }
}

function freezeCode(p, dir, mediaDirs, mediaFiles, copied, cutoff) {
  const hf = p.kind === 'hyperframes', brambleshire = p.kind === 'brambleshire';
  const original = path.resolve(hf ? p.hf.projet : p.remotionDir), target = path.join(dir, 'projet');
  const entry = p.remotion?.entree && path.resolve(original, p.remotion.entree);
  const external = entry && !inside(canon(original), canon(entry)) ? canon(fs.realpathSync.native(entry)) : null;
  const rootKey = canon(fs.realpathSync.native(original));
  const entryPath = entry || (hf && p.hf.index && path.resolve(original, p.hf.index));
  const entryKey = entryPath && canon(fs.realpathSync.native(entryPath));
  let privateEntry = null;
  const privateDir = canon(fs.realpathSync.native(dir));
  const review = p.REVUE && canon(fs.existsSync(p.REVUE) ? fs.realpathSync.native(p.REVUE) : path.resolve(p.REVUE));
  const exports = new Set((p.exportRule?.dossiers ?? []).map(f => canon(path.resolve(f))));
  const publicDir = canon(path.resolve(original, p.remotion?.public || 'public'));
  const visiting = new Set();
  const privateMedia = new Map();
  let copiedMediaBytes = 0n;
  const runtimeKinds = new Map();
  function runtimeKind(folder) {
    if (!runtimeKinds.has(folder)) {
      const present = name => fs.existsSync(path.join(folder, name));
      const profile = present('Local State') && present('Default');
      const declared = inside(folder, rootKey) || (entryKey && inside(folder, entryKey));
      const generated = !declared && present('bundle.js') && present('index.html');
      const reviewData = !declared && (folder === review || (present('projet.json') && (present('studio.lock.json') || present('notes.json') || present('lots'))));
      runtimeKinds.set(folder, profile ? 'profile' : generated ? 'bundle' : reviewData ? 'review' : null);
    }
    return runtimeKinds.get(folder);
  }
  function excluded(key, isDir, linked) {
    let folder = isDir ? key : path.dirname(key);
    for (;;) {
      const kind = runtimeKind(folder);
      if (kind) {
        if (kind === 'profile' && (inside(folder, rootKey) || (entryKey && inside(folder, entryKey)))) {
          throw new Error('L’entrée du projet se trouve dans un profil de navigateur.');
        }
        return true;
      }
      const parent = path.dirname(folder);
      if (!linked || parent === folder) return false;
      folder = parent;
    }
  }
  function copy(from, to, atRoot = false, linked = false) {
    const real = fs.realpathSync.native(from), key = canon(real), info = stat(real);
    if (inside(privateDir, key) || excluded(key, info.isDirectory(), linked || atRoot)) return;
    const mediaFile = info.isFile() && (binaryMedia.test(from) || info.size > 16 * 1024 * 1024);
    const previous = mediaFile && cutoff !== null ? previousLinkProof(real, info, cutoff) : null;
    if (!previous) assertAtSend(from, info, cutoff);
    if (linked && cutoff !== null) {
      const link = fs.lstatSync(from, {bigint:true});
      assertAtSend(from, link, cutoff);
      copied.set(from, stamp(info));
    }
    if (external && key === external && info.isFile()) privateEntry = to;
    if (info.isDirectory()) {
      if (visiting.has(key)) throw new Error(`Cycle dans les sources : ${from}`);
      const entries = fs.readdirSync(real, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      // Les bibliothèques de médias sont souvent sur un autre volume. Une jonction suffit
      // pour une feuille uniquement binaire ; un fichier de code voisin est toujours copié.
      const publicMedia = cutoff !== null && inside(publicDir, canon(from)) && entries.some(e => binaryMedia.test(e.name));
      if (!atRoot && entries.length && entries.every(e => e.isFile() && (binaryMedia.test(e.name) ||
          (publicMedia && /\.(json|txt|md|csv|svg|srt|vtt|xml)$/i.test(e.name))))) {
        fs.symlinkSync(real, to, 'junction'); mediaDirs.add(real); return;
      }
      copied.set(from, stamp(info));
      visiting.add(key); fs.mkdirSync(to, { recursive: true });
      for (const item of entries) {
        const name = item.name;
        const file = path.join(from, name), dest = path.join(to, name);
        const local = canon(file);
        if (name === '.git' || name === '.cache') continue;
        // An episode directory can be both an export destination and the media library mounted under public/.
        if (exports.has(local) && !inside(publicDir, local) && !(entry && inside(local, canon(entry)))) continue;
        if (atRoot && brambleshire && !/^(src|episodes|public|node_modules|[^/]+\.json)$/.test(name)) continue;
        if (name === 'node_modules' && atRoot) {
          const deps = fs.realpathSync.native(file);
          if (excluded(canon(deps), true, item.isSymbolicLink())) continue;
          if (item.isSymbolicLink()) assertAtSend(file, fs.lstatSync(file, {bigint:true}), cutoff);
          fs.symlinkSync(deps, dest, 'junction'); mediaDirs.add(deps); continue;
        }
        if (atRoot && /^(revue|renders?|exports?|out|07-renders)$/i.test(name) && fs.statSync(file).isDirectory()) continue;
        copy(file, dest, false, item.isSymbolicLink());
      }
      visiting.delete(key);
    } else if (mediaFile) {
      if (cutoff !== null) {
        if (previous && !matchesDigest({file:real, digest:previous.digest}, info)) throw new Error(`Média modifié depuis l’envoi : ${from}`);
        copied.set(from, stamp(info));
        try { fs.symlinkSync(real, to, 'file'); }
        catch {
          const id = info.ino ? stamp(info) : canon(real), existing = privateMedia.get(id);
          if (existing) fs.linkSync(existing, to);
          else {
            if (copiedMediaBytes + info.size > 512n * 1024n * 1024n) {
              const digest = certifyHardLink(real, to, info, cutoff, previous);
              copied.delete(from);
              mediaFiles.push({file:to, original:real, digest});
              return;
            }
            copiedMediaBytes += info.size;
            fs.copyFileSync(real, to, fs.constants.COPYFILE_FICLONE);
            privateMedia.set(id, to);
          }
          return;
        }
        mediaFiles.push({file: to, original: real});
        return;
      }
      try { fs.linkSync(real, to); }
      catch (e) {
        // Un prêt de fichier entre volumes utilise un lien si possible. Pour un média volumineux,
        // l'échec est explicite plutôt que de retarder l'envoi par une copie de plusieurs Go.
        try { fs.symlinkSync(real, to, 'file'); }
        catch { if (info.size > 16 * 1024 * 1024) throw new Error(`Média impossible à figer : ${from} (${e.code})`); copied.set(from, stamp(info)); fs.copyFileSync(real, to); return; }
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
    const info = stat(entry);
    assertAtSend(entry, info, cutoff);
    copied.set(entry, stamp(info));
    delete remotion.entree;
    return {remotionDir: target, remotion, externalEntry: entry};
  }
  if (entry) remotion.entree = privateEntry ?? mapped(entry);
  return { remotionDir: target, remotion };
}

function heldFile(file, original) { return { file, original, signature: stamp(stat(file)) }; }
function unchanged(held) {
  const current = stat(held.file), signature = stamp(current);
  if (held.digest) return matchesDigest(held, current);
  if (signature === held.signature) return true;
  // Le remplacement atomique à la source peut modifier ChangeTime de l'ancien inode (un lien en moins).
  // Le fichier privé garde son inode, ses octets, sa taille et sa date d'écriture dans ce cas.
  if (signature.split(':').slice(0, 4).join(':') !== held.signature.split(':').slice(0, 4).join(':')) return false;
  try { const live = stat(held.original); return live.dev !== current.dev || live.ino !== current.ino; }
  catch (e) { if (e.code === 'ENOENT') return true; throw e; }
}

export async function freezeLotSources(p, { code = false, video = false, dir, sentAt }) {
  const cutoff = sentAt === undefined ? null : Date.parse(sentAt);
  if (cutoff !== null && !Number.isFinite(cutoff)) throw new Error('Date d’envoi des notes invalide.');
  fs.mkdirSync(dir, { recursive: true });
  const mediaDirs = new Set(), files = [], copied = new Map();
  const sources = code ? freezeCode(p, dir, mediaDirs, files, copied, cutoff) : {};
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
    const roots = [...mediaDirs].sort(), fingerprint = await directoryFingerprint(roots, undefined, cutoff);
    const frozenFiles = files.map(({ file, original, digest }) => ({...heldFile(file, original), ...(digest ? {digest} : {})}));
    if (frozenFiles.some(f => f.digest && !unchanged(f))) throw new Error('Un média a changé pendant la préparation de la capture.');
    sources.mediaCount = Number(fingerprint.signature.split(':')[0]) + frozenFiles.length;
    sources.manifest = path.join(dir, 'medias.json');
    writeJson(sources.manifest, { roots, ...fingerprint, files: frozenFiles });
  }
  if (sources.externalEntry) {
    const bundleDir = path.join(dir, 'entree-compilee');
    let dependencies;
    await bundleExternalLotEntry(p.remotionDir, sources.externalEntry, sources.remotionDir, bundleDir, cutoff === null ? undefined : compilation => {
      // Webpack also lists ancestor directories used for ordinary module resolution.
      // A context dependency, in contrast, selects modules by listing that directory.
      dependencies = {files: [...compilation.fileDependencies], contexts: [...compilation.contextDependencies]};
    });
    if (cutoff !== null) {
      if (!dependencies?.files.length) throw new Error('Le compilateur ne fournit pas les dépendances de l’entrée externe pour vérifier leur date.');
      for (const file of dependencies.files) {
        const info = stat(file);
        if (info.isFile()) assertAtSend(file, info, cutoff);
      }
      for (const folder of dependencies.contexts) assertAtSend(folder, stat(folder), cutoff);
    }
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

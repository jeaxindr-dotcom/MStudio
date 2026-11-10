// Empreinte conservatrice : contenus du code et des données, métadonnées des médias.
// Un média modifié en conservant volontairement taille ET date reste indétectable.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const TEXT = /\.(json|tsx?|jsx?|mjs|cjs|css|html?|csv|ya?ml|toml|txt|md|glsl|vert|frag|wgsl|svg)$/i;
const ignored = /^(node_modules|revue|\.git|\.cache|renders?|exports?|out|07-renders)$/i;
const normalize = (file) => process.platform === 'win32' ? file.toLowerCase() : file;
export async function codePlaybackSources(project, { limit = 50000, maxFileBytes = 16 * 1024 * 1024, maxContentBytes = 128 * 1024 * 1024, sharedPublicRoot = null, signal } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || ![maxFileBytes, maxContentBytes].every((n) => Number.isSafeInteger(n) && n > 0)) throw new Error('Limites de certification des sources invalides.');
  const hash = crypto.createHash('sha256'), visited = new Set(); let count = 0, bytes = 0;
  hash.update(JSON.stringify({ composition: project.remotion?.composition ?? null, props: project.remotion?.props ?? {}, episode: project.episode ?? null }));
  const inputs = [path.join(project.remotionDir, 'public'), path.join(project.remotionDir, 'src'), project.EP,
    project.remotion?.module, project.remotion?.entree, path.join(project.remotionDir, 'package.json')].filter(Boolean).map((file) => path.resolve(file));
  // Les cibles des racines déclarées peuvent être des jonctions. Une jonction
  // imbriquée qui sort de ces racines est refusée au lieu de certifier à l'aveugle.
  const boundaries = [];
  for (const file of [project.remotionDir, ...inputs]) {
    try { const real = await fs.realpath(file); boundaries.push({ real: normalize(real), directory: (await fs.stat(real)).isDirectory() }); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  const allowed = (file) => boundaries.some((b) => file === b.real || (b.directory && file.startsWith(b.real + path.sep)));
  // The V2 demo links known media folders under public/ to the original engine.
  // This opt-in accepts only the configured public folder, only through public/.
  const shared = sharedPublicRoot ? normalize(await fs.realpath(sharedPublicRoot)) : null;
  const publicDir = normalize(path.join(project.remotionDir, 'public'));
  async function walk(file) {
    signal?.throwIfAborted();
    if (++count > limit) throw new Error('Trop de fichiers pour certifier cette plage de code.');
    let real, stat;
    try { real = await fs.realpath(file); stat = await fs.stat(real); }
    catch (e) { if (e.code === 'ENOENT') { hash.update(`absent:${file}`); return; } throw e; }
    const canonical = normalize(real);
    const sharedAsset = shared && normalize(file).startsWith(publicDir + path.sep)
      && (canonical === shared || canonical.startsWith(shared + path.sep));
    if (!allowed(canonical) && !sharedAsset) throw new Error(`Jonction hors des sources déclarées : ${file}`);
    // Le chemin d'accès compte aussi : permuter deux alias change leur sens même
    // quand les mêmes deux fichiers physiques figurent déjà dans l'empreinte.
    hash.update(JSON.stringify([path.resolve(file), real]));
    if (visited.has(canonical)) return;
    visited.add(canonical);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(real)).sort()) {
        if (ignored.test(name)) continue;
        await walk(path.join(file, name));
      }
    } else if (stat.isFile()) {
      hash.update(real); hash.update(`${stat.size}:${stat.mtimeMs}`);
      if (TEXT.test(real)) {
        bytes += stat.size;
        if (stat.size > maxFileBytes || bytes > maxContentBytes) throw new Error('Données de code trop volumineuses pour certifier cette plage.');
        hash.update(await fs.readFile(real));
      }
    }
  }
  for (const file of inputs) await walk(file);
  return hash.digest('hex');
}

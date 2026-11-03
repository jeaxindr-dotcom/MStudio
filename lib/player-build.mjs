// Construction atomique des aperçus : aucune écriture dans le projet Remotion.
import { expandRequireContext } from './require-context.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CACHE } from './place.mjs';
import { t } from './i18n.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUDIO = path.resolve(HERE, '..');
const ASSET_MARKER = '/player-assets/__COULISSES_RELEASE__/';
const PREMOUNT = String(Number.isFinite(+process.env.COULISSES_PREMOUNT) && process.env.COULISSES_PREMOUNT !== '' ? +process.env.COULISSES_PREMOUNT : 0);
const KEEP = 3, LEASE_MS = 120000;
export const stage3dModule = (projet) => path.join(STUDIO, 'player', fs.existsSync(path.join(projet, 'node_modules', '@react-three', 'fiber')) ? 'three-stage.ts' : 'no3d.ts');

export function playerBuilder({ remotionDir, episode, log = console.log, onBuilt = () => {}, generic = null, watchAlso = null }) {
  const key = crypto.createHash('sha256').update(path.resolve(remotionDir).toLowerCase() + '\0' + (generic?.tag ?? episode)).digest('hex').slice(0, 20);
  // Une instance possède son répertoire : jamais de nettoyage des générations d'un autre serveur.
  const store = path.join(CACHE, 'player-releases', key, crypto.randomUUID());
  const out = path.join(store, '_memory', 'player.js');
  const src = path.join(remotionDir, 'src');
  const state = { status: 'idle', version: 0, hash: null, error: null, builtAt: null, ms: 0, file: null };
  const releases = new Map(), versions = new Map(), leases = new Map(), watchers = new Set();
  let ctx = null, contextPromise = null, pending = null, queued = false, timer = null, disposed = false, watching = false, disposal = null, swept = false;

  const removeOwned = (dir) => {
    const absolute = path.resolve(dir), base = path.resolve(store);
    if (absolute !== base && !absolute.startsWith(base + path.sep)) throw new Error('Suppression hors du cache des aperçus');
    fs.rmSync(absolute, { recursive: true, force: true });
  };
  function collectAbandoned() {
    if (swept) return; swept = true;
    const bucket = path.dirname(store);
    if (!fs.existsSync(bucket)) return;
    for (const item of fs.readdirSync(bucket, { withFileTypes: true })) {
      if (!item.isDirectory() || !/^[0-9a-f-]{36}$/i.test(item.name)) continue;
      const candidate = path.resolve(bucket, item.name);
      if (!candidate.startsWith(path.resolve(bucket) + path.sep) || candidate === path.resolve(store)) continue;
      try {
        const owner = JSON.parse(fs.readFileSync(path.join(candidate, 'owner.json'), 'utf8'));
        if (owner.format !== 'coulisses-preview-v1' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) continue;
        let alive = true;
        try { process.kill(owner.pid, 0); } catch (error) { alive = error.code !== 'ESRCH'; }
        if (!alive) fs.rmSync(candidate, { recursive: true, force: true });
      } catch { /* Dossier sans propriétaire connu ou encore utilisé : conservé. */ }
    }
  }
  function collect() {
    const now = Date.now();
    for (const [owner, lease] of leases) if (lease.until <= now) leases.delete(owner);
    const protectedHashes = new Set([...leases.values()].map((x) => x.hash));
    for (const release of [...releases.values()].sort((a, b) => b.version - a.version).slice(0, KEEP)) protectedHashes.add(release.hash);
    for (const [hash, release] of releases) if (!protectedHashes.has(hash)) {
      try { removeOwned(release.dir); releases.delete(hash); } catch { /* fichier servi encore ouvert : prochain passage */ }
    }
    // Alias bornés ; une génération retenue explicitement garde aussi son numéro.
    const retainedVersions = new Set([...leases.values()].map((x) => x.version));
    for (const [version, hash] of versions) if (!releases.has(hash) || (version < state.version - 63 && !retainedVersions.has(version))) versions.delete(version);
  }
  const sweep = setInterval(collect, 10000); sweep.unref?.();
  function getRelease(version = state.version) {
    if (disposed) return null;
    const asVersion = !releases.has(String(version)) && /^\d+$/.test(String(version)) ? Number(version) : null;
    const hash = asVersion !== null ? versions.get(asVersion) : String(version);
    const release = releases.get(hash); if (!release) return null;
    return Object.freeze({ version: asVersion ?? release.version, hash, file: path.join(release.dir, 'player.js'), entry: 'player.js', css: release.files.has('player.css') ? 'player.css' : null });
  }
  function asset(hash, name) {
    if (disposed || typeof name !== 'string' || name.includes('\\') || name.includes('\0') || name.split('/').some((x) => x === '..' || x === '.')) return null;
    const release = releases.get(String(hash));
    return release?.files.has(name) ? path.join(release.dir, ...name.split('/')) : null;
  }
  function retain(versionOrHash, owner, ttlMs = LEASE_MS) {
    const release = getRelease(versionOrHash);
    if (!release || typeof owner !== 'string' || !owner || owner.length > 200) return false;
    leases.set(owner, { hash: release.hash, version: release.version, until: Date.now() + Math.max(1000, Math.min(LEASE_MS, Number(ttlMs) || LEASE_MS)) });
    return true;
  }
  function release(owner) { leases.delete(owner); collect(); }

  async function context() {
    if (ctx) return ctx;
    if (contextPromise) return contextPromise;
    contextPromise = (async () => {
      const req = createRequire(path.join(remotionDir, 'package.json'));
      const esbuild = await import(pathToFileURL(req.resolve('esbuild')).href);
      if (disposed) throw new Error('Construction de l’aperçu arrêtée');
      const REAL = path.join(path.dirname(req.resolve('remotion/package.json')), 'dist', 'esm', 'index.mjs'), SHIM = path.join(STUDIO, 'player', 'sequence-window.tsx');
      const windowed = fs.existsSync(REAL) && !process.env.COULISSES_PREVIEW_ALL_SEQUENCES ? [{ name: 'coulisses-sequence-window', setup(b) {
        b.onResolve({ filter: /^remotion$/ }, () => ({ path: SHIM }));
        b.onResolve({ filter: /^@coulisses-remotion$/ }, () => ({ path: REAL }));
      } }] : [];
      const loaders = { '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'jsx', '.ts': 'ts', '.mts': 'ts', '.cts': 'ts', '.tsx': 'tsx',
        '.json': 'json', '.css': 'css', '.glsl': 'text', '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.webp': 'file', '.svg': 'file' };
      // Le cache de fichiers d'esbuild peut conserver l'ancien contenu quand un outil
      // restaure taille ET date. Relire uniquement les imports hors node_modules :
      // esbuild garde son cache de parsing, mais le compare au vrai contenu reçu.
      const currentSources = { name: 'coulisses-current-sources', setup(b) {
        b.onLoad({ filter: /\.(?:[cm]?[jt]sx?|json|css|glsl|png|jpe?g|webp|svg)$/, namespace: 'file' }, async ({ path: file }) => {
          if (/[\\/]node_modules[\\/]/i.test(file)) return;
          const loader = loaders[path.extname(file).toLowerCase()]; if (!loader) return;
          const contents = await fs.promises.readFile(file);
          // (require.context de webpack, inconnu d'esbuild : lib/require-context.mjs)
          if (/^(js|jsx|ts|tsx)$/.test(loader)) {
            const x = expandRequireContext(contents.toString('utf8'), file);
            if (x) return { contents: x.contents, loader, resolveDir: path.dirname(file), watchFiles: [file], watchDirs: x.watchDirs };
          }
          return { contents, loader, resolveDir: path.dirname(file), watchFiles: [file] };
        });
      } };
      const created = await esbuild.context({
        entryPoints: [path.join(STUDIO, 'player', generic ? 'remotion.tsx' : 'entry.tsx')],
        bundle: true, format: 'iife', platform: 'browser', target: 'es2022', outfile: out,
        write: false, sourcemap: 'linked', metafile: true, logLevel: 'silent', jsx: 'automatic',
        assetNames: 'assets/[name]-[hash]', publicPath: ASSET_MARKER.slice(0, -1),
        nodePaths: [path.join(remotionDir, 'node_modules')],
        alias: generic ? { '@coulisses-module': generic.module, '@coulisses-3d': stage3dModule(remotionDir) } : { '@episode-src': src },
        define: generic ? { __COMPOSITION__: JSON.stringify(generic.composition), __PROPS__: JSON.stringify(generic.props ?? {}), __COULISSES_PREMOUNT__: PREMOUNT, 'process.env.NODE_ENV': '"production"' }
          : { __EPISODE__: JSON.stringify(episode), __COULISSES_PREMOUNT__: PREMOUNT, 'process.env.NODE_ENV': '"production"' },
        loader: { '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.webp': 'file', '.svg': 'file', '.glsl': 'text', '.css': 'css' },
        plugins: [...windowed, currentSources],
      });
      if (disposed) { await created.dispose(); throw new Error('Construction de l’aperçu arrêtée'); }
      ctx = created; return created;
    })();
    try { return await contextPromise; } finally { contextPromise = null; }
  }

  function publish(result) {
    const outputs = result.outputFiles.map((file) => {
      const name = path.relative(path.dirname(out), file.path).split(path.sep).join('/');
      if (path.isAbsolute(name) || name.startsWith('../')) throw new Error('Sortie esbuild hors du dossier de publication');
      return { name, contents: Buffer.from(file.contents) };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const digest = crypto.createHash('sha256');
    for (const output of outputs) if (!output.name.endsWith('.map')) digest.update(output.name).update('\0').update(output.contents).update('\0');
    const hash = digest.digest('hex');
    if (hash === state.hash) return;
    const nextVersion = state.version + 1;
    let published = releases.get(hash);
    if (!published) {
      const target = path.join(store, hash), temp = path.join(store, `.publication-${crypto.randomUUID()}`);
      try {
        collectAbandoned();
        fs.mkdirSync(store, { recursive: true });
        if (!fs.existsSync(path.join(store, 'owner.json'))) fs.writeFileSync(path.join(store, 'owner.json'), JSON.stringify({ format: 'coulisses-preview-v1', pid: process.pid }));
        fs.mkdirSync(temp, { recursive: true });
        for (const output of outputs) {
          const destination = path.join(temp, ...output.name.split('/'));
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          const body = /\.(?:js|css)$/.test(output.name) ? Buffer.from(output.contents.toString('utf8').replaceAll(ASSET_MARKER, `/player-assets/${hash}/`)) : output.contents;
          fs.writeFileSync(destination, body);
        }
        // Aucun lecteur ne connaît le dossier temporaire. Le renommage publie tous les fichiers ensemble.
        fs.renameSync(temp, target);
      } catch (error) { try { removeOwned(temp); } catch { /* diagnostic original conservé */ } throw error; }
      published = { hash, dir: target, files: new Set(outputs.map((x) => x.name)), version: nextVersion };
      releases.set(hash, published);
    }
    published.version = nextVersion; versions.set(nextVersion, hash);
    state.version = nextVersion; state.hash = hash; state.file = path.join(published.dir, 'player.js'); state.builtAt = new Date().toISOString();
    collect();
  }

  async function rebuild() {
    const t0 = Date.now(); state.status = 'building';
    try {
      const c = await context(); if (disposed) return;
      const result = await c.rebuild(); if (disposed) return;
      publish(result);
      state.status = 'ready'; state.error = null; state.ms = Date.now() - t0;
      log(t('pb.built', { name: generic ? generic.composition : episode, ms: state.ms, v: state.version }));
      // La frise peut avoir changé sans modifier les sorties visuelles : toujours la notifier.
      onBuilt(state);
    } catch (e) {
      if (disposed) return;
      state.status = 'error';
      state.error = (e.errors ?? []).slice(0, 3).map((x) => `${x.location ? path.basename(x.location.file) + ':' + x.location.line + ' ' : ''}${x.text}`).join('\n') || String(e.message || e);
      log(t('pb.error', { err: state.error }));
    }
  }
  function build() {
    if (disposed) return Promise.resolve(state);
    if (pending) { queued = true; return pending; }
    pending = (async () => { do { queued = false; await rebuild(); } while (queued && !disposed); return state; })().finally(() => { pending = null; });
    return pending;
  }
  const schedule = () => { if (disposed) return; clearTimeout(timer); timer = setTimeout(() => { timer = null; void build(); }, 250); };
  function watch() {
    if (disposed || watching) return; watching = true;
    const add = (dir, recursive, accept) => {
      try { watchers.add(fs.watch(dir, { recursive }, (_ev, file) => { if (file && accept(String(file))) schedule(); })); }
      catch (e) { log(t('pb.noWatch', { msg: e.message })); }
    };
    add(src, true, (f) => /\.(m?[jt]sx?|json|glsl|css|png|jpe?g|webp|svg)$/i.test(f));
    if (watchAlso) add(watchAlso, true, (f) => !/(^|[\\/])(revue|node_modules|\.git)([\\/]|$)/i.test(f) && /\.(json|tsx?)$/i.test(f));
    add(path.join(STUDIO, 'player'), false, (f) => /\.(tsx?|html)$/.test(f));
  }
  function dispose() {
    if (disposal) return disposal;
    disposed = true; queued = false; clearTimeout(timer); clearInterval(sweep);
    for (const watcher of watchers) watcher.close(); watchers.clear(); leases.clear();
    disposal = (async () => {
      await ctx?.cancel?.(); await pending?.catch(() => {}); await contextPromise?.catch(() => {}); await ctx?.dispose();
      ctx = null; state.status = 'disposed'; releases.clear(); versions.clear();
      try { removeOwned(store); } catch { /* Windows peut retenir brièvement une réponse HTTP en cours */ }
    })();
    return disposal;
  }
  return { state, build, watch, dispose, getRelease, asset, retain, release, collect };
}

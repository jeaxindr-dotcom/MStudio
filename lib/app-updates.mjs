import {createHash, randomUUID} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {lstat, mkdir, readdir, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {cmpVersion} from './hyperframes.mjs';

const repository = 'jeaxindr-dotcom/MStudio';
const latestApi = `https://api.github.com/repos/${repository}/releases/latest`;
const web = `https://github.com/${repository}/releases`;
const stableVersion = /^(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})$/;
const assetHosts = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const headers = {'User-Agent': 'MStudio-Updater', 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'};

class UpdateError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function releaseInfo(data, currentVersion) {
  const tag = data?.tag_name;
  const version = typeof tag === 'string' && tag.startsWith('mstudio-v') ? tag.slice(9) : '';
  if (!stableVersion.test(version) || data.draft !== false || data.prerelease !== false) {
    throw new UpdateError('La publication GitHub ne correspond pas à une version stable de MStudio.', 'release');
  }
  const releaseUrl = `${web}/tag/${tag}`;
  if (cmpVersion(version, currentVersion) <= 0) return {version, releaseUrl};
  const name = `MStudio-Setup-${version}-win-x64.exe`;
  const url = `${web}/download/${tag}/${name}`;
  const matches = Array.isArray(data.assets) ? data.assets.filter(asset => asset?.name === name) : [];
  const asset = matches[0];
  if (matches.length !== 1 || asset.state !== 'uploaded' || asset.browser_download_url !== url ||
      !Number.isSafeInteger(asset.size) || asset.size <= 0 || !/^sha256:[a-fA-F0-9]{64}$/.test(asset.digest)) {
    throw new UpdateError('GitHub ne fournit pas un installeur Windows complet avec une empreinte SHA-256 vérifiable.', 'metadata');
  }
  return {version, releaseUrl, name, url, size: asset.size, sha256: asset.digest.slice(7).toLowerCase()};
}

async function fetchAsset(release, fetchImpl, signal) {
  let url = new URL(release.url);
  for (let n = 0; n <= 5; n++) {
    if (url.href !== release.url && (url.protocol !== 'https:' || url.username || url.password || url.port || !assetHosts.has(url.hostname))) {
      throw new UpdateError('La redirection de téléchargement ne provient pas du service de fichiers GitHub.', 'redirect');
    }
    const response = await fetchImpl(url.href, {redirect: 'manual', signal, headers: {'User-Agent': headers['User-Agent'], Accept: 'application/octet-stream'}});
    if (response.status === 200 && response.body) return response;
    await response.body?.cancel();
    if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.get('location')) {
      throw new UpdateError(`Téléchargement GitHub indisponible (HTTP ${response.status}).`, 'http');
    }
    url = new URL(response.headers.get('location'), url);
  }
  throw new UpdateError('Le téléchargement GitHub comporte trop de redirections.', 'redirect');
}

async function validFile(file, release) {
  let stat;
  try { stat = await lstat(file); }
  catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  if (!stat.isFile() || stat.size !== release.size) return false;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex') === release.sha256;
}

// Node fetch does not apply the Internet zone to downloads as a Windows browser does.
async function markDownload(file, source) {
  if (process.platform === 'win32') await writeFile(`${file}:Zone.Identifier`, `[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=${source}\r\n`);
}

// This cache also contains the handoff receipt. Only remove our own installers
// from previous updates and our abandoned, day-old download fragments.
async function pruneDownloads(dir, version) {
  const entries = await readdir(dir, {withFileTypes: true});
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parts = /^MStudio-Setup-(\d+\.\d+\.\d+)-win-x64\.exe(?:\.([a-f\d-]{36})\.part)?$/.exec(entry.name);
    if (!parts || !stableVersion.test(parts[1])) continue;
    const file = path.join(dir, entry.name);
    if (parts[2] ? (await lstat(file)).mtimeMs < Date.now() - 86400000 : cmpVersion(parts[1], version) < 0) {
      await rm(file, {force: true}).catch(() => {}); // An installer may still be open in another process.
    }
  }
}

export function createAppUpdates({version, dir, fetchImpl = fetch}) {
  if (!stableVersion.test(version) || !path.isAbsolute(dir)) throw new Error('Configuration de mise à jour invalide.');
  let release = null, checking = null;
  const progress = {status: 'idle', currentVersion: version, latestVersion: null, releaseUrl: null, downloadedBytes: 0, totalBytes: 0, error: null, errorCode: null};
  const state = () => ({...progress});
  function fail(e, code, fallback) {
    progress.status = 'error';
    progress.errorCode = e instanceof UpdateError ? e.code : e.code === 'ENOSPC' ? 'space' : code;
    progress.error = e instanceof UpdateError ? e.message : e.code === 'ENOSPC' ? 'Espace disque insuffisant pour télécharger la mise à jour.' : fallback;
    return state();
  }

  async function findLatest() {
    release = null;
    Object.assign(progress, {status: 'checking', error: null, errorCode: null, latestVersion: null, releaseUrl: null, downloadedBytes: 0, totalBytes: 0});
    try {
      const response = await fetchImpl(latestApi, {headers, redirect: 'error', signal: AbortSignal.timeout(20000)});
      if (!response.ok) {
        await response.body?.cancel();
        throw new UpdateError(`Vérification GitHub indisponible (HTTP ${response.status}). Réessaie plus tard.`, 'http');
      }
      const latest = releaseInfo(await response.json(), version);
      Object.assign(progress, {latestVersion: latest.version, releaseUrl: latest.releaseUrl, totalBytes: latest.size ?? 0});
      if (!latest.name) {
        progress.status = 'current';
      } else {
        release = latest;
        const cached = await validFile(path.join(dir, release.name), release);
        progress.status = cached ? 'ready' : 'available';
        progress.downloadedBytes = cached ? release.size : 0;
      }
      return state();
    } catch (e) { return fail(e, 'check', 'Impossible de vérifier la mise à jour. Vérifie ta connexion puis réessaie.'); }
  }

  function check() {
    if (progress.status === 'downloading') return Promise.resolve(state());
    checking ??= findLatest().finally(() => { checking = null; });
    return checking;
  }

  async function saveInstaller(asset) {
    const target = path.join(dir, asset.name);
    const temp = path.join(dir, `${asset.name}.${randomUUID()}.part`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    timeout.unref();
    try {
      await mkdir(dir, {recursive: true});
      await pruneDownloads(dir, asset.version).catch(() => {});
      const response = await fetchAsset(asset, fetchImpl, controller.signal);
      const hash = createHash('sha256');
      const monitor = new Transform({transform(chunk, encoding, done) {
        timeout.refresh();
        progress.downloadedBytes += chunk.length;
        if (progress.downloadedBytes > asset.size) return done(new UpdateError('La taille de l’installeur dépasse celle annoncée par GitHub.', 'integrity'));
        hash.update(chunk);
        done(null, chunk);
      }});
      await pipeline(Readable.fromWeb(response.body), monitor, createWriteStream(temp, {flags: 'wx', mode: 0o600}), {signal: controller.signal});
      if (progress.downloadedBytes !== asset.size || hash.digest('hex') !== asset.sha256) {
        throw new UpdateError('Le fichier reçu ne correspond pas à l’empreinte ou à la taille publiée sur GitHub. Relance le téléchargement.', 'integrity');
      }
      await markDownload(temp, asset.url);
      await rename(temp, target);
      progress.status = 'ready';
    } catch (e) { fail(e, 'transfer', 'Téléchargement interrompu. Vérifie ta connexion et ton espace disque puis réessaie.'); }
    finally { clearTimeout(timeout); await rm(temp, {force: true}).catch(() => {}); }
  }

  function download() {
    if (progress.status === 'downloading' || progress.status === 'ready') return state();
    if (!release || !['available', 'error'].includes(progress.status)) throw new UpdateError('Vérifie la disponibilité d’une mise à jour avant le téléchargement.');
    Object.assign(progress, {status: 'downloading', downloadedBytes: 0, error: null, errorCode: null});
    void saveInstaller(release);
    return state();
  }

  async function verifiedInstaller() {
    const asset = release;
    if (!asset || progress.status !== 'ready') throw new UpdateError('L’installeur vérifié n’est pas disponible.');
    const file = path.join(dir, asset.name);
    try {
      if (!await validFile(file, asset)) throw new UpdateError('L’installeur enregistré a changé. Relance le téléchargement.', 'integrity');
      await markDownload(file, asset.url);
    } catch (e) {
      if (asset === release && progress.status === 'ready') fail(e, 'file', 'Impossible de vérifier l’installeur enregistré. Relance le téléchargement.');
      throw new UpdateError(progress.error || 'Impossible de vérifier l’installeur enregistré.');
    }
    if (asset !== release || progress.status !== 'ready') throw new UpdateError('La version sélectionnée a changé. Vérifie la mise à jour.');
    return {path: file, version: asset.version, sha256: asset.sha256};
  }

  return {state, check, download, verifiedInstaller};
}

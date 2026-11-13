import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {APP_DIR} from './app-profile.mjs';
import {optionsFrom, readJson} from './episode.mjs';
import {lang} from './i18n.mjs';

const text = (fr,en) => lang() === 'fr' ? fr : en;
const unquote = value => String(value ?? '').trim().replace(/^"(.*)"$/, '$1');
const samePath = (a,b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const fileExists = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };

function nativeDescriptor(dir, episode) {
  const files = fs.readdirSync(dir,{withFileTypes:true}).filter(entry => entry.isFile() && /\.coulisses$/i.test(entry.name))
    .map(entry => ({file:path.join(dir,entry.name), data:readJson(path.join(dir,entry.name),null)}))
    .filter(({data}) => data?.coulisses === 1 && data.moteur === 'brambleshire' && String(data.episode).toUpperCase() === episode);
  if (files.length !== 1) throw new Error(text(
    `Il faut un fichier .coulisses natif unique pour ${episode} dans ${dir} (${files.length} trouvé(s)). Ouvre le fichier voulu par son chemin.`,
    `Expected one native .coulisses file for ${episode} in ${dir} (${files.length} found). Open the intended file by its path.`));
  return files[0];
}

function verifyRemotion(file, data, requested, defaultTheatre, cwd) {
  if (!requested) return;
  const configured = data?.remotion?.projet
    ? path.resolve(path.dirname(file),data.remotion.projet)
    : data?.moteur === 'brambleshire' ? path.join(defaultTheatre,'06_Remotion') : null;
  if (!configured || !samePath(configured,path.resolve(cwd,requested))) throw new Error(text(
    `Le moteur --remotion ne correspond pas au projet ${file}. Utilise son moteur déclaré${configured ? ' : ' + configured : ''} ; aucun chemin du projet n’a été modifié.`,
    `The --remotion engine does not match ${file}. Use the project's declared engine${configured ? ': ' + configured : ''}; no project paths were changed.`));
}

// Resolve only the desktop argument. This never imports a project, creates a
// review, checks an editor lock, starts a server, or opens a browser.
export function resolveOpenTarget(target, options = {}) {
  const {home = false, cwd = process.cwd()} = options;
  const raw = unquote(target), theatre = options.theatre;
  const episodes = options.episodes ?? options.episodesDir;
  const remotion = options.remotion ?? options.remotionDir;
  if (home) {
    if (raw || theatre || episodes || remotion) throw new Error(text('Utilise open --home sans projet ni contexte de théâtre.', 'Use open --home without a project or theatre context.'));
    return '--home';
  }
  if (!raw) throw new Error(text('Usage : open <projet|E19|P1234abcd> [--theatre dossier] ou open --home.', 'Usage: open <project|E19|P1234abcd> [--theatre folder] or open --home.'));
  if (/^P[0-9a-f]{8}$/i.test(raw)) {
    if (theatre || episodes || remotion) throw new Error(text('Un projet de la bibliothèque utilise son contexte enregistré. Ouvre son chemin pour vérifier un autre moteur.', 'A library project uses its saved context. Open its path to verify another engine.'));
    return 'P' + raw.slice(1).toLowerCase();
  }
  if (/^E\d+$/i.test(raw)) {
    const id = raw.toUpperCase();
    // Without explicit paths, the native application's library resolves its ID.
    if (!theatre && !episodes && !remotion) return id;
    const defaults = optionsFrom([]);
    const theatreDir = theatre ? path.resolve(cwd,theatre) : episodes ? path.dirname(path.resolve(cwd,episodes)) : defaults.theatre;
    const episodesDir = episodes ? path.resolve(cwd,episodes) : path.join(theatreDir,'07_Episodes');
    let matching;
    try { matching = fs.readdirSync(episodesDir,{withFileTypes:true}).filter(entry => entry.isDirectory() && entry.name.toUpperCase().startsWith(id + ' - ')); }
    catch { throw new Error(text(`Dossier des épisodes introuvable : ${episodesDir}`, `Episodes folder not found: ${episodesDir}`)); }
    if (matching.length !== 1) throw new Error(text(`Épisode ${id} introuvable ou ambigu dans ${episodesDir}.`, `Episode ${id} is missing or ambiguous in ${episodesDir}.`));
    const {file,data} = nativeDescriptor(path.join(episodesDir,matching[0].name),id);
    verifyRemotion(file,data,remotion,theatreDir,cwd);
    return file;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.startsWith('--')) throw new Error(text('Ouvre un chemin de projet local, pas une URL ni une option.', 'Open a local project path, not a URL or an option.'));
  const absolute = path.resolve(cwd,raw);
  if (!fs.existsSync(absolute)) throw new Error(text(`Projet introuvable : ${absolute}`, `Project not found: ${absolute}`));
  if (remotion) {
    if (!fileExists(absolute) || !/\.coulisses$/i.test(absolute)) throw new Error(text('Avec --remotion, indique le fichier .coulisses exact ou un identifiant d’épisode.', 'With --remotion, provide the exact .coulisses file or an episode ID.'));
    const inferredTheatre = theatre ? path.resolve(cwd,theatre) : path.resolve(path.dirname(absolute),'..','..');
    verifyRemotion(absolute,readJson(absolute,null),remotion,inferredTheatre,cwd);
  }
  return absolute;
}

export function desktopExecutable({env = process.env, appDir = APP_DIR, cwd = process.cwd(), executable} = {}) {
  const explicit = executable ?? env.MSTUDIO_EXE;
  if (explicit) {
    const file = path.resolve(cwd,unquote(explicit));
    if (!fileExists(file)) throw new Error(text(`MStudio.exe introuvable : ${file}`, `MStudio.exe not found: ${file}`));
    return file;
  }
  const picker = env.MSTUDIO_PICKER_EXE && path.basename(unquote(env.MSTUDIO_PICKER_EXE)).toLowerCase() === 'mstudio.exe' ? unquote(env.MSTUDIO_PICKER_EXE) : null;
  const candidates = [picker, path.join(appDir,'MStudio.exe'), env.LOCALAPPDATA && path.join(env.LOCALAPPDATA,'Programs','MStudio','MStudio.exe')].filter(Boolean);
  const found = candidates.find(fileExists);
  if (found) return path.resolve(found);
  throw new Error(text('MStudio.exe est introuvable. Installe MStudio ou indique son exécutable avec MSTUDIO_EXE.', 'MStudio.exe was not found. Install MStudio or set MSTUDIO_EXE to its executable.'));
}

export async function openDesktop(target, options = {}) {
  const resolved = resolveOpenTarget(target,options);
  if ((options.platform ?? process.platform) !== 'win32') throw new Error(text('Cette commande ouvre l’application Windows MStudio.', 'This command opens the MStudio Windows application.'));
  const executable = desktopExecutable(options), launch = options.spawn ?? spawn;
  const args = [resolved];
  const child = launch(executable,args,{cwd:path.dirname(executable),env:options.env ?? process.env,detached:true,windowsHide:false,stdio:'ignore',shell:false});
  await new Promise((resolve,reject) => { child.once('spawn',resolve); child.once('error',reject); });
  child.unref();
  return {executable,args,target:resolved,pid:child.pid};
}

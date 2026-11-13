// The « .coulisses » project file (user decision: « un fichier style DRP, créé à chaque début de run ») — what a
// pipeline writes at the start of a run so that Coulisses can open the run BEFORE any export: it points to the run's
// Remotion composition, which Coulisses plays live (no MP4), and to the module that describes its timeline.
// Format (JSON, UTF-8), paths absolute or relative to the .coulisses file:
//   {
//     "coulisses": 1,
//     "titre": "Récap IA de la semaine", "chaine": "L'AItelier",
//     "remotion": {
//       "projet": "<folder of the Remotion project: package.json + node_modules>",
//       "entree": "src/index.ts",                 (registerRoot: renders and stills, relative to projet)
//       "module": "src/coulisses.ts",             (export const compositions = [...], relative to projet)
//       "timeline": "src/coulisses-timeline.ts",  (export function timeline(id, props), relative to projet)
//       "composition": "<id>", "props": { … }     (the run's composition and its input props)
//     },
//     "revue": "revue",                           (notes, batches, images: relative to the .coulisses file)
//     "export": { "dossier": "07-renders", "motif": "\\.mp4$" }   (where the final export lands, optional)
//   }
// The full contract (what the Remotion project must provide) is in docs\FICHE-COULISSES-REMOTION.md.
// A run that is NOT (yet) in Remotion (HyperFrames, Resolve, Unreal…) has the « vidéo » variant (user choice, 07/10/2026:
// « un .coulisses dès maintenant ») — created at the start of the run too, opened on the run's export once there is one:
//   { "coulisses": 1, "moteur": "video", "titre": "…", "chaine": "…", "format": "16:9", "revue": "revue",
//     "export": { "dossier": "renders" | ["…", "…"], "motif": "_final\\.mp4$", "profondeur": 0 },
//     "plan": "08-montage/plan-montage.json" }      (optional: the timeline — an AItelier montage plan, or the Coulisses
//                                                    timeline format { fps, durationInFrames, pistes: [...] } in frames)
// When the pipeline moves to Remotion, « projet creer » with --projet / --composition turns the same file into a
// Remotion run (the notes stay: same revue folder).
// A HyperFrames project (user request, 09/10/2026: « une compatibilité HyperFrames ») — its HTML composition played live:
//   { "coulisses": 1, "moteur": "hyperframes", "titre": "…", "chaine": "…", "format": "16:9", "revue": "revue",
//     "hyperframes": { "projet": ".", "index": "index.html" },   (the project folder: index.html, hyperframes.json…)
//     "export": { "dossier": "renders", "motif": "\\.mp4$" } }     (« hyperframes render » writes there; lib/hyperframes.mjs)
// A Brambleshire Theatre episode has its own: { "coulisses": 1, "moteur": "brambleshire", "episode": "E03", … } — it opens
// the episode with Coulisses' built-in engine (3D picking, staging, render), the remotion block being informative only.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, nowIso } from './episode.mjs';
import { t } from './i18n.mjs';

export const EXT = '.coulisses';
export const isCoulissesFile = (f) => typeof f === 'string' && f.toLowerCase().endsWith(EXT);
const abs = (base, p) => (p ? path.resolve(base, p) : null);

// where the run's export lands: one folder or several, a file pattern, how deep to look (0 = the folder itself)
function exportRule(dir, E, errors) {
  let motif = /\.(mp4|mov|mkv|webm)$/i;
  try { if (E.motif) motif = new RegExp(E.motif, 'i'); } catch (e) { errors.push(t('cf.motif', { msg: e.message })); }
  const dossiers = [].concat(E.dossier ?? '.').map((d) => abs(dir, d));
  return { dossier: dossiers[0], dossiers, motif, profondeur: Number.isInteger(E.profondeur) && E.profondeur >= 0 ? E.profondeur : 0 };
}

// { file, dir, data, title, channel, revue, remotion: { projet, entree, module, timeline, composition, props, public }, export, errors }
export function readCoulisses(file) {
  const f = path.resolve(String(file).replace(/^"(.*)"$/, '$1'));
  const data = readJson(f, null), errors = [];
  if (!data) return { file: f, errors: [t('cf.unreadable', { file: f })] };
  const dir = path.dirname(f), R = data.remotion ?? {};
  if (data.coulisses !== 1) errors.push(t('cf.version'));
  if (data.moteur === 'brambleshire') {   // an episode of Brambleshire Theatre: the built-in engine
    if (!/^E\d+$/i.test(data.episode ?? '')) errors.push(t('cf.episode'));
    const episode = String(data.episode ?? '').toUpperCase(), revue = abs(dir, data.revue ?? 'revue');
    const episodesDir = path.dirname(dir), theatre = path.dirname(episodesDir);
    // The native engine resolves an episode inside this theatre and keeps its
    // review in <episode>/revue. Never silently redirect it to another project.
    if (!path.basename(dir).toUpperCase().startsWith(episode + ' - ')) errors.push('Le dossier ne correspond pas au numéro de cet épisode.');
    if (revue?.toLowerCase() !== path.join(dir, 'revue').toLowerCase()) errors.push('Un épisode natif conserve sa revue dans le sous-dossier « revue ».');
    const native = { theatre, episodesDir, remotionDir: abs(dir, R.projet) ?? path.join(theatre, '06_Remotion') };
    return { file: f, dir, data, moteur: 'brambleshire', episode, title: data.titre ?? data.episode, channel: data.chaine ?? 'Theatre', format: data.format ?? null, revue, native, remotion: null, export: null, errors };
  }
  if (data.moteur === 'video') {   // a run not (yet) in Remotion: its export is the video, its montage plan (if any) the timeline
    if (!data.titre) errors.push(t('cf.title'));
    const exp = exportRule(dir, data.export ?? {}, errors);
    const plan = data.plan ? abs(dir, data.plan) : null;   // may not exist yet: the pipeline writes it later in the run
    return { file: f, dir, data, moteur: 'video', title: data.titre, channel: data.chaine ?? null, format: data.format ?? null, revue: abs(dir, data.revue ?? 'revue'), remotion: null, export: exp, plan, errors };
  }
  if (data.moteur === 'hyperframes') {   // a HyperFrames project: its composition is the preview, « hyperframes render » the export
    if (!data.titre) errors.push(t('cf.title'));
    const H = data.hyperframes ?? {}, projet = abs(dir, H.projet ?? '.'), index = String(H.index ?? 'index.html');
    if (!fs.existsSync(path.join(projet, index))) errors.push(t('cf.hfIndex', { file: path.join(projet, index) }));
    const exp = exportRule(dir, data.export ?? { dossier: path.join(H.projet ?? '.', 'renders'), motif: '\\.mp4$' }, errors);
    return { file: f, dir, data, moteur: 'hyperframes', title: data.titre, channel: data.chaine ?? null, format: data.format ?? null, revue: abs(dir, data.revue ?? 'revue'), remotion: null, hyperframes: { projet, index }, export: exp, uses: [], errors };
  }
  if (data.moteur) errors.push(t('cf.engine', { m: data.moteur }));
  if (!data.titre) errors.push(t('cf.title'));
  const projet = abs(dir, R.projet);
  if (!projet) errors.push(t('cf.projet'));
  else if (!fs.existsSync(path.join(projet, 'package.json'))) errors.push(t('cf.package', { dir: projet }));
  else if (!fs.existsSync(path.join(projet, 'node_modules', 'remotion'))) errors.push(t('cf.remotion', { dir: projet }));
  const at = (k, d) => (projet ? abs(projet, R[k] ?? d) : null);
  const remotion = { projet, entree: at('entree', 'src/index.ts'), module: at('module', 'src/coulisses.ts'), timeline: at('timeline', 'src/coulisses-timeline.ts'),
    composition: R.composition ?? null, props: R.props ?? {}, public: projet ? path.join(projet, 'public') : null };
  if (projet) for (const k of ['entree', 'module']) if (!fs.existsSync(remotion[k])) errors.push(t('cf.missingFile', { k, file: remotion[k] }));
  if (projet && !fs.existsSync(remotion.timeline)) remotion.timeline = null;   // optional: then the module's own timeline()
  if (!remotion.composition) errors.push(t('cf.composition'));
  const exp = data.export ? exportRule(dir, data.export, errors) : null;
  // « utilise »: the runs that show this one's render as a media (a 3D shot of the theatre inside a Short): their .coulisses
  // and the file of theirs this render becomes — the Short's studio offers « Ouvrir la scène 3D » on that clip
  const uses = (Array.isArray(data.utilise) ? data.utilise : []).filter((u) => u?.coulisses && u?.fichier).map((u) => ({ coulisses: abs(dir, u.coulisses), fichier: String(u.fichier) }));
  return { file: f, dir, data, title: data.titre, channel: data.chaine ?? null, format: data.format ?? null, revue: abs(dir, data.revue ?? 'revue'), remotion, export: exp, uses, errors };
}

// what a pipeline calls at the start of a run (studio-cli.mjs projet creer …): writes <dossier>\<titre>.coulisses
// --moteur video (or no --projet / --composition): the « vidéo » variant. Run again on the same run, it keeps the date
// of creation and the review folder; with --projet / --composition it turns a « vidéo » run into a Remotion one.
export function createCoulisses({ dossier, titre, chaine, format, projet, entree, module, timeline, composition, props, exportDossier, exportMotif, exportProfondeur, plan, nom, moteur, utilise }) {
  if (!dossier || !titre) throw new Error(t('cf.need'));
  if (moteur && moteur !== 'video' && moteur !== 'hyperframes') throw new Error(t('cf.badEngine', { m: moteur }));
  const hyper = moteur === 'hyperframes';
  if (hyper && !projet) throw new Error(t('cf.needHf'));
  const video = !hyper && (moteur === 'video' || (!projet && !composition));
  if (!video && !hyper && (!projet || !composition)) throw new Error(t('cf.needRemotion'));
  fs.mkdirSync(dossier, { recursive: true });
  const safe = (nom ?? titre).replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || t('cf.defaultName');
  const file = path.join(dossier, safe + EXT);
  // relative to the run when it is close (inside it, or at most two folders up: the run moves with its neighbours),
  // absolute otherwise (another drive, far away)
  const rel = (p) => { const r = path.relative(dossier, path.resolve(p)); const up = r.split(/[\\/]/).filter((x) => x === '..').length; return r === '' ? '.' : !path.isAbsolute(r) && up <= 2 ? r : path.resolve(p); };
  const before = readJson(file, null);
  if (before?.moteur === 'brambleshire') throw new Error(t('cf.isEpisode', { file }));
  if (before && !before.moteur && video) throw new Error(t('cf.isRemotion', { file }));
  const dirs = [].concat(exportDossier ?? []).flatMap((x) => String(x).split('|')).filter(Boolean);
  const exp = dirs.length ? { export: { dossier: dirs.length > 1 ? dirs.map((x) => rel(path.resolve(dossier, x))) : rel(path.resolve(dossier, dirs[0])), motif: exportMotif ?? '\\.mp4$', ...(exportProfondeur ? { profondeur: +exportProfondeur } : {}) } }
    : before?.export ? { export: before.export } : {};
  const common = { coulisses: 1, ...(video ? { moteur: 'video' } : hyper ? { moteur: 'hyperframes' } : {}), titre, chaine: chaine ?? before?.chaine ?? null, format: format ?? before?.format ?? null, cree: before?.cree ?? nowIso(), ...(before ? { modifie: nowIso() } : {}) };
  const here = (p) => (path.resolve(p) === path.resolve(dossier) ? '.' : rel(p));   // the project's own folder: « . » (it may move)
  const data = hyper
    ? { ...common, hyperframes: { projet: here(projet), index: entree ?? 'index.html' }, revue: before?.revue ?? 'revue',
      ...(dirs.length || before?.export ? exp : { export: { dossier: rel(path.join(path.resolve(projet), 'renders')), motif: exportMotif ?? '\\.mp4$' } }) }
    : video
    ? { ...common, revue: before?.revue ?? 'revue', ...exp, ...(plan ? { plan: rel(path.resolve(dossier, plan)) } : before?.plan ? { plan: before.plan } : {}) }
    : { ...common, remotion: { projet: rel(projet), entree: entree ?? 'src/index.ts', module: module ?? 'src/coulisses.ts', timeline: timeline ?? 'src/coulisses-timeline.ts', composition, props: props ?? {} },
      revue: before?.revue ?? 'revue', ...exp,
      ...(Array.isArray(utilise) && utilise.length ? { utilise: utilise.map((u) => ({ coulisses: rel(path.resolve(dossier, u.coulisses)), fichier: u.fichier })) } : before?.utilise ? { utilise: before.utilise } : {}) };
  writeJson(file, data);
  return file;
}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {readCoulisses} from './coulisses-file.mjs';
import {lang} from './i18n.mjs';

export function flag(args, key) {
  const index = args.indexOf(key);
  return index < 0 ? null : args[index + 1];
}

const samePath = (a, b) => typeof a === 'string' && typeof b === 'string'
  && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const local = (fr, en) => lang() === 'fr' ? fr : en;

// The old command line contains only the output folder and composition. Attach
// its progress to a review only after identifying the matching project as well.
export function directExportProject(cwd, args, explicit) {
  const folder = flag(args, '--dossier');
  const composition = flag(args, '--composition');
  if (!folder || !composition) {
    if (explicit) throw new Error(local('Le suivi de cet export requiert --dossier et --composition.',
      'Tracking this export requires --dossier and --composition.'));
    return null;
  }
  const destination = path.resolve(cwd, folder);
  const pipelineScript = samePath(path.resolve(cwd, args[0]), path.join(cwd, 'scripts', 'coulisses-rendu.mjs'));

  function match(file) {
    const descriptor = readCoulisses(file);
    if (!pipelineScript || descriptor.errors.length || !samePath(descriptor.remotion?.projet, cwd)) return null;
    if (descriptor.remotion.composition !== composition) return null;
    return descriptor.export?.dossiers.some(dir => samePath(dir, destination)) ? descriptor : null;
  }
  if (explicit) {
    const result = match(path.resolve(explicit));
    if (!result) throw new Error(local('Le .coulisses ne correspond pas au moteur, au script, à la composition ou au dossier de sortie.',
      'The .coulisses file does not match the engine, script, composition or output folder.'));
    return result;
  }

  const found = [];
  let dir = destination;
  for (let depth = 0; depth < 5; depth++) {
    for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, {withFileTypes:true}) : []) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.coulisses')) continue;
      try {
        const descriptor = match(path.join(dir, entry.name));
        if (descriptor) found.push(descriptor);
      } catch { /* An unrelated descriptor may be incomplete. */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (found.length > 1) throw new Error(local('Plusieurs revues correspondent. Indique --project <fichier.coulisses> à export-run.mjs.',
    'Several reviews match. Pass --project <file.coulisses> to export-run.mjs.'));
  return found[0] || null;
}

// Every exporter receives the contract in its environment. Scripts advertising
// the corresponding CLI flags get those too; older strict parsers keep working.
export function exportContract(remotion, args, scriptText) {
  const env = {
    COULISSES_ENTREE: remotion.entree,
    COULISSES_MODULE: remotion.module,
    COULISSES_TIMELINE: remotion.timeline || remotion.module,
    COULISSES_COMPOSITION: remotion.composition,
  };
  const argv = [...args];
  for (const [name, setting] of [['--entree','COULISSES_ENTREE'], ['--module','COULISSES_MODULE'], ['--timeline','COULISSES_TIMELINE']]) {
    const index = argv.indexOf(name);
    if (index < 0) {
      if (scriptText.includes(name)) argv.push(name, env[setting]);
    } else if (!samePath(path.resolve(remotion.projet, argv[index + 1] || ''), env[setting])) {
      throw new Error(name + local(' ne correspond pas au .coulisses.', ' does not match the .coulisses file.'));
    }
  }
  return {argv, env};
}

// The Long08 legacy exporter was inspected at this digest. Both its official
// variants use the entire composition, unless the caller passes --images.
const verifiedFullExport = 'c9eef8a570039cfa9875cc75a09edc859ffd61f8b1f2de9eda72e56256d07c89';
export function knownFullExport(script) {
  return crypto.createHash('sha256').update(fs.readFileSync(script)).digest('hex') === verifiedFullExport;
}

export function exportVariant(option, verified, language) {
  const original = String(option.label ?? option.id);
  const declared = ['full','excerpt'].includes(option.scope);
  const scope = declared ? option.scope : verified ? 'full' : undefined;
  const resolution = option.resolution === '1080p' || /\b1080p\b/i.test(original) ? '1080p'
    : option.resolution === '4K' || /\b4k\b/i.test(original) ? '4K' : null;
  const statedDuration = /\b\d+(?:[.,]\d+)?\s*(?:s|sec(?:onde)?s?|seconds?|min(?:utes?)?|images?|frames?)\b/i.test(original);
  let label = original;
  if (scope === 'full' && resolution) label = (language === 'fr' ? 'Film complet' : 'Full film') + ' · ' + resolution;
  if (!scope && /^(test|essai)$/i.test(option.id) && resolution && !statedDuration) {
    label = resolution + ' · ' + (language === 'fr' ? 'durée définie par le script' : 'duration set by the script');
  }
  return {id: option.id.trim(), label, ...(scope ? {scope} : {}), ...(resolution ? {resolution} : {}),
    ...(label !== original ? {scriptLabel:original} : {})};
}

// Reject a single unambiguous literal entry differing from the declared entry.
// A third-party script that computes it dynamically can only be checked at runtime.
export function exportEntryCheck(remotion, script, language) {
  if (!fs.existsSync(script)) return {};
  const source = fs.readFileSync(script, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).filter(line => !/^\s*\/\//.test(line)).join('\n');
  const literal = /\bentryPoint\s*:\s*(?:path\.resolve\(\s*)?(['"])([^'"\n]+)\1\s*[),}]/.exec(source);
  const entryCount = [...source.matchAll(/\bentryPoint\s*:/g)].length;
  if (literal && entryCount === 1) {
    const actual = path.resolve(remotion.projet, literal[2]);
    if (!samePath(actual, remotion.entree)) return {error: language === 'fr'
      ? 'Le script d’export compile ' + actual + ' en dur. La composition ' + remotion.composition + ' déclare ' + remotion.entree + '. Utiliser --entree ou COULISSES_ENTREE.'
      : 'The export script hardcodes ' + actual + '. Composition ' + remotion.composition + ' declares ' + remotion.entree + '. Use --entree or COULISSES_ENTREE.'};
  }
  if (!samePath(path.join(remotion.projet,'src','index.ts'), remotion.entree)
    && !source.includes('--entree') && !source.includes('COULISSES_ENTREE')) {
    return {warning: language === 'fr' ? 'Le script tiers choisit son entrée au lancement. Vérifie qu’il utilise le chemin déclaré.'
      : 'This third-party exporter selects its entry at runtime. Verify it uses the declared entry.'};
  }
  return {};
}

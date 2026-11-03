// require.context(dossier, sousDossiers, /motif/) : une fonction de webpack (le bundler des rendus Remotion), inconnue
// d'esbuild qui construit l'aperçu de Coulisses. Un projet qui l'utilise rendait bien, mais son aperçu plantait au
// chargement (« __require.context is not a function », 03/11/2026, 宇宙ちゃん long07 : grosplans/holoK/index.js charge
// tous ses écrans pPPP.js ainsi). Ici, chaque appel est remplacé à la construction par la liste figée des fichiers du
// dossier qui correspondent, importés statiquement : même API que webpack (ctx(clé), ctx.keys(), ctx.resolve(clé)),
// mêmes clés (« ./p001.js »). Un fichier ajouté au dossier est vu à la construction suivante (watchDirs).
import fs from 'node:fs';
import path from 'node:path';

const CALL = /require\.context\(\s*(['"`])([^'"`]+)\1\s*(?:,\s*(true|false)\s*)?(?:,\s*\/((?:\\.|[^/\\\n])+)\/([a-z]*)\s*)?(?:,\s*(['"])[^'"]*\6\s*)?\)/g;
const SKIP = /^(node_modules|\.git)$/i;

function list(dir, deep, base = dir, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (deep && !SKIP.test(e.name)) list(abs, deep, base, out); }
    else if (e.isFile()) out.push('./' + path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}

// code : le source d'un module ; file : son chemin. Rend null quand il n'y a rien à remplacer.
export function expandRequireContext(code, file) {
  if (typeof code !== 'string' || !code.includes('require.context(')) return null;
  const here = path.dirname(file), imports = [], dirs = [];
  let n = 0, changed = false;
  const body = code.replace(CALL, (all, q, rel, recursive, source, flags) => {
    const dir = path.resolve(here, rel), deep = recursive !== 'false';
    let re;
    try { re = source !== undefined ? new RegExp(source, (flags ?? '').replace(/g/g, '')) : /^\.\/.*$/; } catch { return all; }
    const keys = list(dir, deep).filter((k) => re.test(k) && path.resolve(dir, k) !== path.resolve(file));
    const id = n++, entries = [];
    keys.forEach((k, i) => {
      const target = path.relative(here, path.resolve(dir, k)).split(path.sep).join('/');
      const spec = target.startsWith('.') ? target : './' + target;
      imports.push(`import * as __coulissesCtx${id}_${i} from ${JSON.stringify(spec)};`);
      entries.push(`${JSON.stringify(k)}: __coulissesCtx${id}_${i}`);
    });
    dirs.push(dir); changed = true;
    return `__coulissesRequireContext({ ${entries.join(', ')} }, ${JSON.stringify(rel)})`;
  });
  if (!changed) return null;
  const helper = 'const __coulissesRequireContext = (m, from) => { const f = (k) => { if (!Object.prototype.hasOwnProperty.call(m, k)) throw new Error(`Cannot find module \'${k}\' (require.context ${from})`); return m[k]; }; f.keys = () => Object.keys(m); f.resolve = (k) => k; f.id = from; return f; };';
  return { contents: `${imports.join('\n')}\n${helper}\n${body}`, watchDirs: [...new Set(dirs)] };
}

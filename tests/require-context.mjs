// require.context (webpack) dans l'aperçu (lib/require-context.mjs ; 03/11/2026, 宇宙ちゃん long07 : « Version 1 non
// adoptée : l'aperçu ne démarre pas », l'aperçu plantait sur « __require.context is not a function »). Le vrai esbuild
// assemble un petit module qui charge ses écrans pPPP.js comme holoK/index.js ; le résultat est exécuté. Aucun projet réel.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { remotionModules, skip } from './where.mjs';
import { expandRequireContext } from '../lib/require-context.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = remotionModules(); if (!MODULES) skip('dépendances Remotion absentes', 'COULISSES_TEST_REMOTION');
const esbuild = await import(pathToFileURL(createRequire(path.join(MODULES, '..', 'package.json')).resolve('esbuild')).href);
const DIR = path.join(STUDIO, '.cache', 'require-context');
let ok = 0, ko = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };
const w = (f, s) => { fs.mkdirSync(path.dirname(path.join(DIR, f)), { recursive: true }); fs.writeFileSync(path.join(DIR, f), s); };
fs.rmSync(DIR, { recursive: true, force: true });
w('holoK/index.js', `// Chargement AUTOMATIQUE (webpack require.context)
const ctx = require.context('./', false, /^\\.\\/p\\d{3}\\.js$/);
export const HOLO_K = Object.fromEntries(ctx.keys().map((k) => [k.slice(2, 6).toUpperCase(), ctx(k).default]));
const all = require.context('./sub', true);
export const DEEP = all.keys();`);
w('holoK/p001.js', `export default { id: 'P001', titre: 'un' };`);
w('holoK/p016.js', `export default { id: 'P016', titre: 'seize' };`);
w('holoK/notes.js', `export default 'pas un écran';`);
w('holoK/sub/a.js', `export default 1;`);
w('holoK/sub/deep/b.js', `export default 2;`);
w('main.js', `import { HOLO_K, DEEP } from './holoK/index.js'; globalThis.__out = { HOLO_K, DEEP };`);

const build = async () => {
  const plugin = { name: 'rc', setup(b) { b.onLoad({ filter: /\.js$/ }, async ({ path: file }) => {
    const code = await fs.promises.readFile(file, 'utf8'), x = expandRequireContext(code, file);
    return x ? { contents: x.contents, loader: 'js', resolveDir: path.dirname(file), watchDirs: x.watchDirs } : { contents: code, loader: 'js' };
  }); } };
  const r = await esbuild.build({ entryPoints: [path.join(DIR, 'main.js')], bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent', plugins: [plugin] });
  const ctx = { globalThis: {} }; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(r.outputFiles[0].text, ctx);
  return ctx.__out;
};
try {
  const sans = await esbuild.build({ entryPoints: [path.join(DIR, 'main.js')], bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent' });
  let failed = null; try { const c = {}; c.globalThis = c; vm.createContext(c); vm.runInContext(sans.outputFiles[0].text, c); } catch (e) { failed = e.message; }
  check(/require\.context is not a function|require is not defined/.test(String(failed)), `sans Coulisses : l'aperçu plante comme chez l'utilisateur (« ${failed} »)`);
  const out = await build();
  check(JSON.stringify(Object.keys(out.HOLO_K)) === '["P001","P016"]' && out.HOLO_K.P016.titre === 'seize', `les écrans pPPP.js du dossier, et eux seuls (${JSON.stringify(out.HOLO_K)})`);
  check(JSON.stringify(out.DEEP) === '["./a.js","./deep/b.js"]', `sous-dossiers et motif par défaut, clés de webpack (${JSON.stringify(out.DEEP)})`);
  w('holoK/p017.js', `export default { id: 'P017', titre: 'dix-sept' };`);
  const again = await build();
  check(Object.keys(again.HOLO_K).includes('P017'), 'un écran ajouté au dossier est vu à la construction suivante');
  check(expandRequireContext('const a = 1;', path.join(DIR, 'x.js')) === null, 'un module sans require.context est laissé tel quel');
} catch (e) { ko++; console.log('  ✗ ERREUR', e.stack); }
console.log(`\n${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);

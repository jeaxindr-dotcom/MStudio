// Test léger du préchargement : ne démarre aucun serveur ni navigateur.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {isolateServerPort, webpackTestCacheDir, redirectWebpackCache, WEBPACK_CACHE_ROOT} from './isolation-runtime.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineCache = process.argv.includes('--baseline-cache'); // Reproduire seulement sur le faux moteur créé ci-dessous.
let ok = 0, ko = 0;
for (const [name, run] of [
  ['Studio de ce worktree sans port : attribution d’un port de test', async () => {
    const argv = ['node', path.join(root, 'studio-server.mjs'), '--no-open'];
    assert.equal(await isolateServerPort(argv, {root, installed: false, choosePort: async () => 4247}), true);
    assert.deepEqual(argv.slice(-2), ['--port', '4247']);
  }],
  ['Accueil de ce worktree sans port : même isolation, héritée par ses enfants', async () => {
    const argv = ['node', path.join(root, 'hub-server.mjs')];
    assert.equal(await isolateServerPort(argv, {root, installed: false, choosePort: async () => 4248}), true);
    assert.deepEqual(argv.slice(-2), ['--port', '4248']);
  }],
  ['Port déjà choisi par le test : aucun remplacement', async () => {
    for (const suffix of [['--port', '4255'], ['--port=4255']]) {
      const argv = ['node', path.join(root, 'studio-server.mjs'), ...suffix], before = [...argv];
      assert.equal(await isolateServerPort(argv, {root, installed: false, choosePort: async () => {throw new Error('Ne doit pas être appelé');}}), false);
      assert.deepEqual(argv, before);
    }
  }],
  ['Autre copie, script ou commande : aucun argument ajouté', async () => {
    for (const script of [path.join(root, '.cache', 'other-copy', 'studio-server.mjs'), path.join(root, 'studio-cli.mjs'), path.join(root, 'tests/app.mjs'), null]) {
      const argv = script ? ['node', script] : ['node'], before = [...argv];
      assert.equal(await isolateServerPort(argv, {root, installed: false}), false);
      assert.deepEqual(argv, before);
    }
  }],
  ['Copie installée : le préchargement ne modifie jamais ses arguments', async () => {
    const argv = ['node', path.join(root, 'studio-server.mjs')];
    assert.equal(await isolateServerPort(argv, {root, installed: true}), false);
    assert.equal(argv.length, 2);
  }],
  ['Une allocation hors plage est refusée', async () => {
    const argv = ['node', path.join(root, 'studio-server.mjs')];
    await assert.rejects(isolateServerPort(argv, {root, installed: false, choosePort: async () => 4173}), /Port de test invalide/);
    assert.equal(argv.length, 2);
  }],
  ['NODE_OPTIONS précharge réellement l’isolation dans un processus enfant', async () => {
    const preload = pathToFileURL(path.join(root, 'tests', 'isolation-runtime.mjs')).href;
    const out = execFileSync(process.execPath, ['--input-type=module', '--eval', 'console.log(JSON.stringify(process.argv))', path.join(root, 'studio-server.mjs'), '--no-open'], {
      env: {...process.env, NODE_OPTIONS: `--import=${preload}`}, encoding: 'utf8', windowsHide: true,
    });
    const argv = JSON.parse(out);
    assert.equal(argv.at(-2), '--port'); assert.ok(+argv.at(-1) >= 4240);
    assert.ok(argv.includes('--no-open'));
  }],
  ['Le cache Webpack est stable par projet et séparé entre projets', async () => {
    const a = path.join(root, '.cache', 'projet-a'), b = path.join(root, '.cache', 'projet-b');
    assert.equal(webpackTestCacheDir(a), webpackTestCacheDir(path.join(a, '.')));
    assert.notEqual(webpackTestCacheDir(a), webpackTestCacheDir(b));
    assert.ok(webpackTestCacheDir(a).startsWith(WEBPACK_CACHE_ROOT + path.sep));
  }],
  ['Seuls les deux modules connus du SDK sont adaptés, une forme inconnue est refusée', async () => {
    assert.equal(redirectWebpackCache('file:///autre/webpack-cache.js', 'aucun changement'), null);
    assert.throws(() => redirectWebpackCache('file:///moteur/node_modules/@remotion/bundler/dist/webpack-cache.js', 'module.exports = {};'), /forme du SDK inconnue/);
    assert.throws(() => redirectWebpackCache('file:///moteur/node_modules/@remotion/bundler/dist/shared-bundler-config.js', "type: 'filesystem',"), /configuration du SDK inconnue/);
  }],
  ['Le vrai préchargement CJS écrit et nettoie le cache isolé sans toucher au cache ni au SDK sources', async () => {
    const parent = path.join(root, '.cache', 'isolation-webpack-test'); fs.mkdirSync(parent, {recursive: true});
    const project = fs.mkdtempSync(path.join(parent, 'projet-'));
    const sdk = path.join(project, 'node_modules', '@remotion', 'bundler', 'dist'); fs.mkdirSync(sdk, {recursive: true});
    const original = path.join(project, 'node_modules', '.cache', 'webpack', 'remotion-production', 'h'); fs.mkdirSync(original, {recursive: true});
    const sentinel = path.join(original, 'temoin.txt'); fs.writeFileSync(sentinel, 'cache du moteur à préserver');
    const cacheSource = `const fs = require('node:fs'), path = require('node:path');
const getWebpackCacheDir = (remotionRoot) => {
  return path.join(remotionRoot, 'node_modules', '.cache', 'webpack');
};
exports.getWebpackCacheName = (environment, hash) => 'remotion-' + environment + '/' + hash;
exports.cacheExists = (root, environment, hash) => fs.existsSync(path.join(getWebpackCacheDir(root), exports.getWebpackCacheName(environment, hash)));
exports.clearCache = (root, environment) => fs.promises.rm(path.join(getWebpackCacheDir(root), 'remotion-' + environment), {recursive: true});
`;
    const configSource = `const webpack_cache = require('./webpack-cache');
const computeHashAndFinalConfig = (conf, options) => {
  return ['h', {...conf, cache: options.enableCaching ? {
    type: 'filesystem',
    name: webpack_cache.getWebpackCacheName(options.environment, 'h'), version: 'h'
  } : false, context: options.remotionRoot}];
};
exports.computeHashAndFinalConfig = computeHashAndFinalConfig;
`;
    const cacheFile = path.join(sdk, 'webpack-cache.js'), configFile = path.join(sdk, 'shared-bundler-config.js');
    fs.writeFileSync(cacheFile, cacheSource); fs.writeFileSync(configFile, configSource);
    const source = `(async () => {
      const fs = require('node:fs'), path = require('node:path');
      const config = require(${JSON.stringify(configFile)}), cache = require(${JSON.stringify(cacheFile)});
      const options = {remotionRoot: ${JSON.stringify(project)}, environment: 'production', enableCaching: true};
      const result = config.computeHashAndFinalConfig({output: {}}, options)[1];
      const directory = result.cache.cacheDirectory ?? path.join(options.remotionRoot, 'node_modules', '.cache', 'webpack');
      const generated = path.join(directory, result.cache.name);
      fs.mkdirSync(generated, {recursive: true}); fs.writeFileSync(path.join(generated, 'essai.txt'), 'cache de test');
      const before = cache.cacheExists(options.remotionRoot, options.environment, 'h');
      await cache.clearCache(options.remotionRoot, options.environment);
      console.log(JSON.stringify({before, after: fs.existsSync(generated), cache: result.cache,
        disabled: config.computeHashAndFinalConfig({}, {...options, enableCaching: false})[1].cache,
        original: fs.readFileSync(${JSON.stringify(sentinel)}, 'utf8')}));
    })().catch((e) => {console.error(e); process.exitCode = 1;});`;
    const preload = pathToFileURL(path.join(root, 'tests', 'isolation-runtime.mjs')).href;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=commonjs', '--eval', source], {env: {...process.env, NODE_OPTIONS: baselineCache ? '' : `--import=${preload}`}, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']}));
    assert.equal(result.before, true); assert.equal(result.after, false);
    assert.equal(result.cache.cacheDirectory, webpackTestCacheDir(project));
    assert.equal(result.cache.type, 'filesystem'); assert.equal(result.cache.name, 'remotion-production/h');
    assert.equal(result.cache.version, 'h'); assert.equal(result.disabled, false);
    assert.equal(result.original, 'cache du moteur à préserver');
    assert.equal(fs.readFileSync(cacheFile, 'utf8'), cacheSource); assert.equal(fs.readFileSync(configFile, 'utf8'), configSource);
  }],
]) {try {await run(); console.log(`✓ ${name}`); ok++;} catch (e) {console.log(`✗ ${name} : ${e.message}`); ko++;}}
console.log(`${ok} ok, ${ko} ko`); process.exitCode = ko ? 1 : 0;

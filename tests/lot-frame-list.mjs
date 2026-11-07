// Le moteur factice compte les pages et encode le numéro source dans chaque tampon.
// Les appels passent par la préparation du bundle et la file réellement utilisées par le serveur.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as framesApi from '../lib/frames.mjs';

const cache = fileURLToPath(new URL('../.cache/', import.meta.url));
fs.mkdirSync(cache, { recursive: true });
function fixture(t, version) {
  const dir = fs.mkdtempSync(path.join(cache, 'test-liste-images-'));
  const remove = (p) => {
    const target = path.resolve(p);
    assert.equal(path.dirname(target), path.resolve(cache));
    fs.rmSync(target, { recursive: true, force: true });
  };
  t.after(() => remove(dir));
  function module(name, source) {
    const target = path.join(dir, 'node_modules', '@remotion', name);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ version, main: 'index.cjs' }));
    fs.writeFileSync(path.join(target, 'index.cjs'), source);
  }
  module('bundler', 'exports.bundle = async ({outDir}) => require("fs").mkdirSync(outDir, {recursive:true});');
  module('renderer', 'module.exports = globalThis.moteurTestListeImages');
  const pages = [], delivered = [], closed = [];
  globalThis.moteurTestListeImages = {
    async openBrowser() { return { close: async () => closed.push(1) }; },
    async selectComposition({ serveUrl }) {
      t.after(() => remove(serveUrl));
      return { id: 'Essai', durationInFrames: 42488 };
    },
    async renderFrames(opts) {
      assert.equal(opts.concurrency, 1);
      assert.equal(opts.jpegQuality, 90);
      assert.equal(opts.outputDir, null);
      assert.equal(opts.frameRange, undefined);
      assert.deepEqual(opts.frames, [0, 724, 42487]);
      pages.push(opts.frames);
      for (const frame of opts.frames) await opts.onFrameBuffer(Buffer.from(String(frame)), frame);
    },
    async renderStill({ frame, jpegQuality }) {
      assert.equal(jpegQuality, 90); pages.push([frame]);
      return { buffer: Buffer.from(String(frame)) };
    },
  };
  t.after(() => { delete globalThis.moteurTestListeImages; });
  const p = { kind: 'remotion', remotionDir: dir, remotion: { entree: path.join(dir, 'src.ts'), composition: 'Essai' } };
  const run = () => framesApi.codeFrameList(p, [42488, 724, 0, -2, 724, 42487], {
    cacheKey: 'version-de-test', onFrame: async (requested, bytes, actual) => {
      await new Promise((r) => setImmediate(r));
      delivered.push([requested, +bytes.toString(), actual]);
    },
  });
  return { run, pages, delivered, closed };
}

for (const [version, pages] of [['4.0.535', [[0, 724, 42487]]], ['4.0.514', [[0], [724], [42487]]], ['4.0.501', [[0], [724], [42487]]]]) {
  test(`Le moteur ${version} reçoit exactement les numéros demandés, bornés et distincts`, async (t) => {
    const f = fixture(t, version);
    await f.run();
    assert.deepEqual(f.pages, pages);
    assert.deepEqual(f.delivered.sort((a, b) => a[0] - b[0]), [
      [-2, 0, 0], [0, 0, 0], [724, 724, 724], [42487, 42487, 42487], [42488, 42487, 42487],
    ]);
    assert.equal(f.closed.length, 1);
  });
}

test('Un moteur incomplet ou qui envoie un mauvais numéro ne peut publier les autres images à sa place', async (t) => {
  const f = fixture(t, '4.0.535');
  globalThis.moteurTestListeImages.renderFrames = ({ onFrameBuffer }) => onFrameBuffer(Buffer.from('724'), 724);
  await assert.rejects(f.run(), /Captures manquantes/);
  assert.deepEqual(f.delivered, [[724, 724, 724]]);
  globalThis.moteurTestListeImages.renderFrames = ({ onFrameBuffer }) => onFrameBuffer(Buffer.from('1'), 1);
  await assert.rejects(f.run(), /Image inattendue/);
  assert.equal(f.closed.length, 2);
});

test('HyperFrames laisse le serveur répondre et associe chaque numéro au bon fichier', async (t) => {
  const source = fs.readFileSync(new URL('../lib/frames.mjs', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('async function hfStills('), source.indexOf('export const CHROME'));
  const dir = fs.mkdtempSync(path.join(cache, 'test-liste-hf-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(cache));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let release;
  const gate = new Promise((r) => { release = r; });
  const c = { path, fs, process, os: { tmpdir: () => dir }, hfFor: () => ({ cli: 'simulé' }), hfConfig: () => ({ fps: 30, duration: 10 }), hfEnv: () => ({}),
    execFileAsync: async (_exe, args) => {
      await gate;
      const tmp = args[args.indexOf('-o') + 1];
      for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(tmp, `frame-${i}-at-test.png`), String(i));
      return { stderr: '', stdout: '' };
    },
    ffmpeg: async (args) => fs.copyFileSync(args[1], args.at(-1)),
  };
  vm.runInNewContext(code, c);
  const frames = Array.from({ length: 12 }, (_, i) => i);
  const outs = frames.map((n) => path.join(dir, n + '.jpg'));
  const delivered = [];
  const pending = c.hfStills({ hf: { projet: dir } }, frames, outs, (frame, file) => delivered.push([frame, Number(fs.readFileSync(file))]));
  assert.deepEqual(delivered, []);
  release();
  await pending;
  assert.deepEqual(delivered, frames.map((n) => [n, n]));
});

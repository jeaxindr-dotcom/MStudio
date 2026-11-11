// Mesure le tampon WebGL et le cadre du moniteur dans une vraie composition Remotion.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {launch, requireSandbox} from './cdp.mjs';
import {freePort, remotionModules, skip} from './where.mjs';
import {createCoulisses} from '../lib/coulisses-file.mjs';

const modules = remotionModules();
if (!modules || !fs.existsSync(path.join(modules, '@remotion/three/package.json'))) skip('SDK Remotion 3D', 'COULISSES_TEST_REMOTION');
const studio = fileURLToPath(new URL('../', import.meta.url)), cache = path.join(studio, '.cache', 'playback-resolution');
fs.mkdirSync(cache, {recursive:true});
const dir = fs.mkdtempSync(path.join(cache, 'run-')), engine = path.join(dir, 'engine'), src = path.join(engine, 'src'), link = path.join(engine, 'node_modules');
Object.assign(process.env, {STUDIO_PROJECTS:path.join(dir, 'projects.json'), COULISSES_SETTINGS:path.join(dir, 'settings.json'),
  COULISSES_MEDIAS:path.join(dir, 'medias'), COULISSES_HISTORY_DIR:path.join(dir, 'history'), COULISSES_LANG:'fr'});
const {importProject} = await import('../lib/projects.mjs');
let page, server, passed = 0, log = '';
const pass = message => { ++passed; console.log('✓ ' + message); };
async function until(read, label, timeout = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { const result = await read(); if (result) return result; await delay(120); }
  throw Error('Délai dépassé : ' + label);
}
const choose = value => page.eval(`const s=document.getElementById('playbackResolution'); s.value=${JSON.stringify(value)}; s.dispatchEvent(new Event('change',{bubbles:true}));`);
async function picture(value, factor) {
  return until(async () => {
    const selected = await page.eval(`return document.querySelector('#playbackResolution')?.value===${JSON.stringify(value)} &&
      !document.querySelector('#codeRangeTools')?.hidden && document.querySelector('#previewReadiness')?.hidden &&
      !!window.__preview?.frameReadiness()?.verified && __preview.frame()===37 && !document.querySelector('iframe.code-next')`);
    if (!selected) return;
    const image = await page.frameEval('player.html', `const c=document.querySelector('canvas'), gl=c?.getContext('webgl2');
      if (!gl || gl.isContextLost()) return;
      const r=c.getBoundingClientRect(), shot=document.querySelector('#coulisses-camera').getBoundingClientRect(), rgb=new Uint8Array(4);
      gl.readPixels(gl.drawingBufferWidth/2,gl.drawingBufferHeight/2,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgb);
      return {buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],
        rect:[(r.left-shot.left)/shot.width,(r.top-shot.top)/shot.height,r.width/shot.width,r.height/shot.height], pixel:[...rgb]};`);
    if (image?.buffer[0] === 640*factor && image.buffer[1] === 360*factor && image.pixel[0] > 100 && image.pixel[0] > image.pixel[1]*2) return image;
  }, `surface 3D ${value} à l’image 37`);
}
try {
  fs.mkdirSync(src, {recursive:true}); fs.mkdirSync(path.join(engine, 'public')); fs.symlinkSync(modules, link, 'junction');
  fs.writeFileSync(path.join(engine, 'package.json'), '{"name":"mstudio-resolution-test","private":true}');
  fs.writeFileSync(path.join(src, 'scene.tsx'), `import React from 'react';
    import {ThreeCanvas} from '@remotion/three';
    const Scene=()=> <ThreeCanvas width={640} height={360} dpr={1.5} gl={{preserveDrawingBuffer:true}}>
      <mesh><boxGeometry args={[2,2,2]}/><meshBasicMaterial color="#ee2020"/></mesh>
    </ThreeCanvas>;
    export const compositions=[{id:'Resolution',component:Scene,width:640,height:360,fps:30,durationInFrames:120}];`);
  fs.writeFileSync(path.join(src, 'coulisses.ts'), "export {compositions} from './scene';");
  fs.writeFileSync(path.join(src, 'coulisses-timeline.ts'), 'export const timeline=()=>({fps:30,durationInFrames:120,pistes:[]});');
  fs.writeFileSync(path.join(src, 'index.ts'), "import React from 'react';import {Composition,registerRoot} from 'remotion';import {compositions} from './coulisses';registerRoot(()=>React.createElement(Composition,compositions[0]));");
  const file = createCoulisses({dossier:path.join(dir, 'film'), titre:'Resolution', projet:engine, composition:'Resolution'});
  const revue = importProject(file).revue, port = await freePort(4690), base = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, ['studio-server.mjs', '--project', revue, '--port', String(port), '--no-open'],
    {cwd:studio, windowsHide:true, stdio:['ignore','pipe','pipe']});
  server.stdout.on('data', b => log += b); server.stderr.on('data', b => log += b);
  await until(() => log.includes('Ouvre : ' + base), 'ouverture du studio de test');
  await requireSandbox(base, dir); page = await launch({port:await freePort(9602)});
  const url = base + '/#f=37'; await page.goto(url);
  await page.until("!document.getElementById('playbackResolutionControl').hidden && window.__preview?.frameReady()", 90000);
  const reference = await picture('auto', 1.5);
  for (const value of ['1', '0.75', '0.5', '0.25']) {
    await choose(value); const current = await picture(value, Number(value));
    assert.deepEqual(current.rect, reference.rect);
    pass(value + ' × donne un tampon ' + current.buffer.join(' × ') + ', cube visible et même cadre à l’image 37.');
  }
  await page.goto('about:blank'); await page.goto(url);
  assert.deepEqual((await picture('0.25', 0.25)).rect, reference.rect);
  pass('Le quart de résolution persiste après réouverture du projet.');
  await choose('auto'); assert.deepEqual((await picture('auto', 1.5)).rect, reference.rect);
  pass('Auto rétablit la densité prévue par la composition.');
  console.log(passed + ' ok, 0 ko');
} catch (e) {
  console.error(e, log.slice(-1300), page?.logs.slice(-6)); console.log(passed + ' ok, 1 ko'); process.exitCode = 1;
} finally {
  await page?.close();
  if (server && server.exitCode === null && !server.signalCode) { const stopped = once(server, 'exit'); server.kill(); await stopped; }
  if (fs.existsSync(link)) fs.unlinkSync(link);
  if (path.dirname(dir) === cache) fs.rmSync(dir, {recursive:true, force:true, maxRetries:4, retryDelay:150});
}

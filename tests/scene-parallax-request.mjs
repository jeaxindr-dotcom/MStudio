// Scene → parallax tested against disposable projects and the actual mailbox CLI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {launch, requireSandbox} from './cdp.mjs';
import {freePort,remotionModules} from './where.mjs';

const studio = fileURLToPath(new URL('../',import.meta.url)), cache = path.join(studio,'.cache','parallax-test');
fs.mkdirSync(cache,{recursive:true});
const root = fs.mkdtempSync(path.join(cache,'run-')), engine = path.join(root,'engine'), links = path.join(engine,'node_modules');
Object.assign(process.env,{STUDIO_PROJECTS:path.join(root,'projects.json'),COULISSES_SETTINGS:path.join(root,'settings.json'),
  COULISSES_MEDIAS:path.join(root,'medias'),COULISSES_HISTORY_DIR:path.join(root,'history'),COULISSES_LANG:'fr'});
const {importProject}=await import('../lib/projects.mjs'), {createCoulisses}=await import('../lib/coulisses-file.mjs');
let page, server, base, ok=0;
const pass=label=>{ok++;console.log('✓ '+label);};
async function stop() {
  if (server && server.exitCode===null && !server.signalCode) {const end=once(server,'exit'); server.kill(); await end;}
}
async function open(revue,ready,lang='fr') {
  await stop();
  const port=await freePort(4885);base='http://127.0.0.1:'+port;
  server=spawn(process.execPath,['studio-server.mjs','--no-open','--port',String(port),'--project',revue],
    {cwd:studio,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,COULISSES_LANG:lang}});
  let log='';server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
  for(let i=0;i<160&&!log.includes(base)&&server.exitCode===null;i++) await sleep(100);
  assert.ok(log.includes(base),log);
  await requireSandbox(base,root);
  await page.goto(base);
  await page.until(ready,90000);
}
const click=selector=>page.eval('document.querySelector('+JSON.stringify(selector)+').click()');
const val=selector=>page.eval('return document.querySelector('+JSON.stringify(selector)+').value');
const lots=revue=>fs.readdirSync(path.join(revue,'lots')).filter(n=>/^\d+\.json$/.test(n));
try {
  page=await launch({port:await freePort(9541)});
  const file=path.join(root,'clip.mp4');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=s=320x180:r=24:d=3','-c:v','libx264','-pix_fmt','yuv420p',file],{windowsHide:true});
  const video=importProject(file);
  await open(video.revue,"window.__studio && document.querySelector('#v').readyState>=2");
  await click('[data-tab="scene"]');
  await page.until("document.querySelector('#sceneRequestSend') && /vidéo est un rendu/.test(document.querySelector('#scene').innerText)");
  await click('#sceneRequestKeep');
  assert.ok(!await page.eval("return !!document.querySelector('#sceneRequestSend')"));
  assert.deepEqual((await (await fetch(base+'/api/status')).json()).lots,[]);
  pass('Un MP4 propose la création à partir des sources. Rester en 2D ne publie aucun lot');
  await click('#sceneParallaxReopen');
  await page.eval("document.querySelector('#agentText').value='Brouillon personnel'; document.querySelector('#agentText').dispatchEvent(new Event('input'))");
  await click('#bNote');
  await page.until("document.querySelector('#draftList textarea.main')");
  await page.eval("const x=document.querySelector('#draftList textarea.main'); x.value='Annotation à conserver'; x.dispatchEvent(new Event('input',{bubbles:true})); x.blur()");
  // Lose only the HTTP response: the server really publishes the request.
  await page.eval(`window.sendCount=0; const real=window.fetch; window.fetch=async (...args)=>{
    const response=await real(...args);
    if(args[0]==='/api/send' && ++window.sendCount===1) throw Error('test : réponse perdue');
    return response;
  };`);
  await page.eval("const b=document.querySelector('#sceneRequestSend'); b.click(); b.click()");
  await page.until("window.sendCount===1",30000);
  await page.goto(base);
  await page.until("document.querySelector('#scene').textContent.includes('en attente de prise en charge') && __studio.state().tabR==='scene'",30000);
  assert.ok(!await page.eval("return !!document.querySelector('#sceneRequestSend')"));
  assert.equal(lots(video.revue).length,1);
  const lot=JSON.parse(fs.readFileSync(path.join(video.revue,'lots','001.json'),'utf8'));
  assert.deepEqual(lot.edits.map(e=>e.id),['scene-parallax-v1']);
  assert.match(lot.edits[0].text,/clip\.mp4/);assert.match(lot.edits[0].text,/premier plan/);
  assert.equal(await val('#agentText'),'Brouillon personnel');
  assert.ok((await (await fetch(base+'/api/notes')).json()).notes.some(n=>n.text==='Annotation à conserver'&&n.draft));
  pass('Le vrai lot ne contient que la demande de parallaxe. Double clic, réponse perdue et F5 conservent un seul envoi et les brouillons');
  const retry=await fetch(base+'/api/send',{method:'POST',body:JSON.stringify({ids:['scene-parallax-v1'],fps:24,size:[320,180]})});
  assert.equal((await retry.json()).lot,1);assert.equal(lots(video.revue).length,1);
  await click('#sceneRequestAgent');
  await page.until("document.querySelector('#agentList').innerText.includes('Demande de mise en scène 3D')");
  await click('[data-tab="lots"]');
  await page.until("document.querySelector('#lots [data-lot=\"1\"]')");
  await click('#sceneRequestConnect');
  await page.until("document.querySelector('#modal').style.display==='flex'");await click('#mClose');
  execFileSync(process.execPath,['studio-cli.mjs','take',video.revue,'1','--agent','codex'],{cwd:studio,windowsHide:true,stdio:'ignore'});
  await page.until("document.querySelector('#scene').textContent.includes('prise en charge par l’agent')",12000);
  assert.equal((await (await fetch(base+'/api/replies')).json()).lots['1'].status,'taken');
  pass('Agent et Envois affichent la demande hors ligne. Le contrôle de connexion est utilisable et la CLI confirme sa prise en charge');
  const modules=remotionModules();
  if (!modules) throw Error('Le projet Remotion de test nécessite un SDK existant');
  fs.mkdirSync(path.join(engine,'src'),{recursive:true});fs.mkdirSync(path.join(engine,'public'));fs.symlinkSync(modules,links,'junction');
  fs.writeFileSync(path.join(engine,'package.json'),'{"name":"parallax-test","private":true}');
  fs.writeFileSync(path.join(engine,'src','coulisses.tsx'),`import React from 'react';
    import { Canvas } from '@react-three/fiber';
    const Flat=()=> <div data-coulisses="title">Titre</div>;
    const Deep=()=> <Canvas><mesh><boxGeometry/><meshBasicMaterial color="red"/></mesh></Canvas>;
    export const compositions=[{id:'Flat',component:Flat},{id:'Deep',component:Deep}].map(c=>({...c,fps:24,width:320,height:180,durationInFrames:72}));`);
  fs.writeFileSync(path.join(engine,'src','coulisses.ts'),"export {compositions} from './coulisses.tsx';");
  fs.writeFileSync(path.join(engine,'src','coulisses-timeline.ts'),'export const timeline=()=>({fps:24,durationInFrames:72,pistes:[]});');
  fs.writeFileSync(path.join(engine,'src','index.ts'),"import {registerRoot,Composition} from 'remotion'; import React from 'react'; import {compositions} from './coulisses'; registerRoot(()=>React.createElement(React.Fragment,null,...compositions.map(c=>React.createElement(Composition,c))));");
  const project=id=>importProject(createCoulisses({dossier:path.join(root,id),titre:id,projet:engine,composition:id})).revue;
  await open(project('Flat'),"window.__preview?.frameReady() && __studio.state().mode==='code'",'en');
  await page.key('m','KeyM','m');
  await page.until("document.querySelector('#sceneRequestSend')?.textContent.includes('Yes, ask')");
  await click('#sceneRequestKeep');await page.until("__studio.state().staging && __preview.stage.kind==='2d'");
  pass('Sur un vrai Player 2D, M propose le parallaxe en anglais puis ouvre la scène 2D au refus');
  await open(project('Deep'),"window.__preview?.frameReady() && __preview.stage.scene3d");
  await click('[data-tab="scene"]');
  assert.equal(await page.eval("return !!document.querySelector('#sceneRequestSend')"),false);
  await click('#bStage');await page.until("__studio.state().staging && __preview.stage.kind==='3d'");
  pass('Une composition Remotion générique avec Canvas 3D ouvre sa scène native sans proposition');
  console.log(ok+' ok, 0 ko');
} catch(e) {console.error(e,page?.logs.slice(-4));console.log(ok+' ok, 1 ko');process.exitCode=1;}
finally {
  await page?.close();await stop();
  if(fs.lstatSync(links,{throwIfNoEntry:false})?.isSymbolicLink())fs.unlinkSync(links);
  if(path.dirname(root)===cache)fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:250});
}

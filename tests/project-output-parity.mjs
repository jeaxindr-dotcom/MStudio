import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as wait} from 'node:timers/promises';
import {freePort,remotionModules} from './where.mjs';
import {launch,requireSandbox} from './cdp.mjs';
import {createCoulisses} from '../lib/coulisses-file.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)), cache=path.join(root,'.cache','output-v2');
fs.mkdirSync(cache,{recursive:true});
const tmp=fs.mkdtempSync(path.join(cache,'project-')), modules=path.join(tmp,'engine','node_modules');
process.env.COULISSES_LANG='fr';process.env.STUDIO_PROJECTS=path.join(tmp,'projets.json');
const {importProject}=await import('../lib/projects.mjs');
let browser, child, base, count=0;
const pass=msg=>{count++;console.log('✓ '+msg);};
const makeDir=d=>fs.mkdirSync(d,{recursive:true});
const click=selector=>browser.eval('document.querySelector('+JSON.stringify(selector)+').click()');
const read=s=>browser.eval('return '+s);
function stop(){if(child?.pid&&child.exitCode===null){try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{/* closed */}} child=null;}
async function open(args, language, extras={}) {
  stop(); const port=await freePort(4581);base='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['studio-server.mjs','--no-open','--port',String(port),...args],{cwd:root,windowsHide:true,stdio:'ignore',
    env:{...process.env,COULISSES_LANG:language, COULISSES_MEDIAS:path.join(tmp,'medias'),COULISSES_SETTINGS:path.join(tmp,language+'.json'),...extras}});
  for(let i=0;i<140;i++){if(await fetch(base+'/api/ping').then(r=>r.ok).catch(()=>false))break;await wait(100);}
  await requireSandbox(base,tmp);await browser.goto(base);
  await browser.until("window.CoulissesOutput && __studio.state().title !== null && document.querySelector('#hdrGo').title && document.querySelector('#title').textContent !== 'Studio'");
  const shown=await read("['hdrGo','hdrExport','srcVideo','srcCode'].every(id=>document.getElementById(id).getBoundingClientRect().width>0)");
  assert.ok(shown,'All four entry points visible');
  // Capture the final command after the existing confirmation. This test never
  // dispatches a render or export to a real agent or GPU.
  await browser.eval(`const real=window.fetch; window.requests=[]; window.confirms=[];window.confirm=s=>{window.confirms.push(s);return true;};
    window.fetch=async (url,opts)=>{if(opts?.method==='POST' && ['/api/render','/api/export'].includes(String(url))){requests.push({url:String(url),data:JSON.parse(opts.body)});return new Response(JSON.stringify({ok:false,why:'test'}));}return real(url,opts);};`);
}
try {
  const file=path.join(tmp,'Rivière.mov');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=gray:s=256x144:r=24:d=1','-c:v','libx264','-pix_fmt','yuv420p',file],{windowsHide:true});
  browser=await launch({port:await freePort(9650)});
  await open(['--project',importProject(file).revue],'en');await click('#hdrGo');
  await browser.until("document.querySelector('#outputDialog').open");
  assert.ok(await read("document.querySelector('#outputRender').disabled && /coulisses/.test(document.querySelector('#outputWhy').textContent)"));
  assert.equal(await read("document.querySelector('#srcCode').getAttribute('aria-disabled')"),'true');
  assert.equal(await read("document.querySelector('#srcVideo').textContent.trim()"),'Imported video');
  const dl=await fetch(base+'/video/download?path=unrelated');
  assert.match(dl.headers.get('content-disposition'),/filename\*=UTF-8''Rivi%C3%A8re\.mov/);
  assert.ok(Buffer.from(await dl.arrayBuffer()).equals(fs.readFileSync(file)));
  assert.equal(await read('requests.length'),0);pass('Une vidéo importée explique le rendu indisponible et livre le fichier original exact, avec son nom Unicode');
  const ep=path.join(tmp,'episodes','E03 - Exemple');makeDir(path.join(ep,'revue'));fs.copyFileSync(file,path.join(ep,'E03 - Exemple.mp4'));
  await open(['E03','--theatre',tmp,'--episodes',path.dirname(ep)],'fr');await click('#hdrExport');
  assert.match(await read("document.querySelector('#outputWhy').textContent"),/agent/);
  assert.ok(await read("document.querySelector('#outputDownload').hasAttribute('href')"));
  await click('#outputRender');await browser.until("requests.some(x=>x.url==='/api/render')");
  assert.equal(await read("requests[0].data.qualite"),'1080p');pass('Épisode Brambleshire : export du fichier disponible et demande de rendu au service de l’agent sur action explicite');
  const engine=path.dirname(modules), src=path.join(engine,'src');
  for(const d of [src,path.join(engine,'scripts'),path.join(engine,'public')])makeDir(d);
  if(remotionModules()){
    fs.symlinkSync(remotionModules(),modules,'junction');fs.writeFileSync(path.join(engine,'package.json'),'{"private":true}');
    fs.writeFileSync(path.join(src,'coulisses.ts'), "import {createElement} from 'react';export const compositions=[{id:'Parite',width:320,height:180,fps:24,durationInFrames:24,component:()=>createElement('div',null,'film')}]; export const timeline=()=>({fps:24,durationInFrames:24,pistes:[]});");
    fs.writeFileSync(path.join(src,'index.ts'),"import {createElement} from 'react';import {registerRoot,Composition} from 'remotion';import {compositions} from './coulisses';registerRoot(()=>createElement(Composition,compositions[0]));");
    fs.writeFileSync(path.join(engine,'scripts/coulisses-rendu.mjs'), "if(process.argv.includes('--options'))console.log(JSON.stringify([{id:'1080p',label:'1080p',scope:'full'}]));else throw new Error('unexpected render');");
    const f=createCoulisses({dossier:path.join(tmp,'run'),titre:'Parité',projet:engine,composition:'Parite',exportDossier:'renders'});
    await open(['--project',importProject(f).revue],'fr');await click('#hdrExport');
    assert.equal(await read("document.querySelector('#outputDownload').hasAttribute('href')"),false);
    assert.match(await read("document.querySelector('#outputPaths').innerText"),/Parite[\s\S]*index.ts[\s\S]*renders/);
    assert.equal(await read("document.querySelector('#srcVideo').getAttribute('aria-disabled')"),'true');
    await click('#outputRender');await browser.until("requests.some(x=>x.url==='/api/export')");
    assert.equal(await read("requests[0].data.qualite"),'1080p');pass('Remotion sans MP4 : qualité du projet, composition, entrée et dossier déclarés, commande d’export existante');
  }
  const hf=path.join(tmp,'hf'), out=path.join(hf,'renders');makeDir(out);fs.copyFileSync(file,path.join(out,'film.mp4'));
  const closedFileTime=new Date(Date.now()-60000); fs.utimesSync(path.join(out,'film.mp4'),closedFileTime,closedFileTime);
  fs.writeFileSync(path.join(hf,'index.html'),'<html><body><div data-composition-id="short" data-width="256" data-height="144" data-duration="1" data-fps="24">Film</div></body></html>');
  const fakeLocal=path.join(tmp,'appdata'), sdk=path.join(fakeLocal,'npm-cache','_npx','test','node_modules','hyperframes');makeDir(path.join(sdk,'bin'));
  fs.writeFileSync(path.join(sdk,'package.json'),'{"name":"hyperframes","version":"0.9.0"}');fs.writeFileSync(path.join(sdk,'bin/hyperframes.mjs'),"console.log('[]')");
  const hfFile=createCoulisses({dossier:hf,titre:'HTML',projet:hf,moteur:'hyperframes',exportDossier:'renders'});
  await open(['--project',importProject(hfFile).revue],'en',{LOCALAPPDATA:fakeLocal});await click('#hdrExport');
  assert.match(await read("document.querySelector('#outputWhy').textContent"),/HyperFrames/);
  assert.ok(await read("document.querySelector('#outputDownload').hasAttribute('href')"));
  await click('#outputRender');await browser.until("requests.some(x=>x.url==='/api/export')");
  pass('HyperFrames : mêmes commandes, rendu avec le moteur du projet, diffusion de la vidéo déjà exportée');
  console.log(count+' ok, 0 ko');
} catch(e){console.error(e);console.log(count+' ok, 1 ko');process.exitCode=1;}
finally{await browser?.close();stop();if(fs.existsSync(modules))fs.unlinkSync(modules);if(path.dirname(tmp)===cache)fs.rmSync(tmp,{recursive:true,force:true,maxRetries:3,retryDelay:300});}

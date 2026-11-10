import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {launch} from './cdp.mjs';
import {freePort} from './where.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const cache = path.join(root,'.cache','shared-layout-test');
fs.mkdirSync(cache,{recursive:true}); const temp = fs.mkdtempSync(path.join(cache,'run-'));
Object.assign(process.env,{STUDIO_PROJECTS:path.join(temp,'registry.json'),COULISSES_SETTINGS:path.join(temp,'settings.json'),COULISSES_MEDIAS:path.join(temp,'medias'),COULISSES_LANG:'fr'});
const {importProject} = await import('../lib/projects.mjs');
const children = []; let page, passed = 0;
function pass(label){passed++; console.log('✓ '+label);}
async function serve(args,from) {
  const port = await freePort(from), base = 'http://127.0.0.1:'+port;
  const child = spawn(process.execPath,['studio-server.mjs',...args,'--port',String(port),'--no-open'],{cwd:root,env:process.env,windowsHide:true,stdio:'ignore'});children.push(child);
  for(let n=0;n<100;n++){if(await fetch(base+'/api/ping').then(r=>r.ok).catch(()=>false)) return base;await delay(100);}
  throw new Error('Unreachable '+base);
}
const patch=(base,data)=>fetch(base+'/api/workspace-appearance',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
try {
  const episode='E03 - Layout', dir=path.join(temp,'07_Episodes',episode);fs.mkdirSync(path.join(dir,'revue'),{recursive:true});
  const movie=path.join(temp,'Montage.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=teal:s=160x90:d=1:r=30','-c:v','libx264',movie],{windowsHide:true});
  fs.copyFileSync(movie,path.join(dir,episode+'.mp4'));
  fs.writeFileSync(path.join(dir,'revue','timeline.json'),JSON.stringify({fps:30,frames:30,sets:[],says:[],cutaways:[],curtain:[]}));
  const a=await serve(['E03','--theatre',temp,'--episodes',path.join(temp,'07_Episodes')],4530);
  const b=await serve(['--project',importProject(movie).revue],4532);
  page=await launch({port:await freePort(9570)});
  const visibleControls=()=>page.eval(`return [...document.querySelectorAll('#rail button,#ltabs [data-tab],#tabs [data-tab],#pageSeg button,#viewbar .seg button,#workspaceButton,#studioCommands,#hdrGo,#hdrExport')].filter(b=>b.getClientRects().length).map(b=>b.id || b.dataset.tab || b.dataset.page)`);
  const open=async url=>{await page.goto(url);await page.until("window.__studio && document.querySelector('#v').readyState>=2");};
  await open(a);const expected=await visibleControls();
  await open(b);assert.deepEqual(await visibleControls(),expected);
  assert.ok(expected.includes('srcCode') && expected.includes('hdrGo') && expected.includes('hdrExport'));
  pass('Deux projets de types différents présentent les mêmes commandes et onglets dans le même ordre');
  await page.eval("document.querySelector('#bChatAgent').click()");
  await page.until("document.activeElement.id==='agentText' && document.activeElement.getClientRects().length");
  pass('Le champ Agent est accessible directement depuis le même rail');
  await page.eval("CoulissesWorkspace.setMode('edit');document.querySelector('#guideSafe').click();document.querySelector('#timelineThumbnails').click()");
  await page.until("(await (await fetch('/api/workspace-appearance')).json()).timelineThumbnails===false");
  await open(a);
  assert.ok(await page.eval("return document.body.dataset.workspace==='edit' && document.querySelector('#guideSafe').getAttribute('aria-pressed')==='true' && document.querySelector('#timelineThumbnails').getAttribute('aria-pressed')==='false'"));
  pass('Un projet ouvert sur un autre port retrouve le mode, les guides et la préférence de vignettes');
  const both=await Promise.all([patch(a,{lside:318}),patch(b,{side:349})]);
  assert.ok(both.every(r=>r.ok));const saved=await(await fetch(a+'/api/workspace-appearance')).json();assert.equal(saved.lside,318);assert.equal(saved.side,349);
  assert.equal((await patch(b,{'notes':'discard'})).status,400);
  pass('Les écritures de deux processus sont fusionnées et les données de projet sont refusées');
  console.log(passed+' ok, 0 ko');
} catch(e){console.error(e,page?.logs.slice(-4));console.log(passed+' ok, 1 ko');process.exitCode=1;}
finally{await page?.close();for(const c of children)if(c.exitCode===null)try{execFileSync('taskkill',['/PID',String(c.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{} if(path.dirname(temp)===cache)fs.rmSync(temp,{recursive:true,force:true,maxRetries:4,retryDelay:250});}

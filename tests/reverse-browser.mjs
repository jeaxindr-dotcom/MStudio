import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as wait} from 'node:timers/promises';
import {launch} from './cdp.mjs';
import {freePort,remotionModules,skip} from './where.mjs';

const studio=fileURLToPath(new URL('../',import.meta.url));
const modules=remotionModules();
if(!modules) skip('Remotion','COULISSES_TEST_REMOTION');
const cache=path.join(studio,'.cache','reverse-browser');
fs.mkdirSync(cache,{recursive:true});
const runtime=fs.mkdtempSync(path.join(cache,'case-'));
const projects=path.join(runtime,'projects'), episodes=path.join(runtime,'episodes');
const movie=path.join(runtime,'Two cuts.mp4');
const port=await freePort(4786), base='http://127.0.0.1:'+port;
let server, page, passed=0, serverLog='';
const pass=t=>{console.log('✓ '+t);passed++;};
const click=s=>page.eval('document.querySelector('+JSON.stringify(s)+').click()');
const value=(s,v)=>page.eval('const e=document.querySelector('+JSON.stringify(s)+'); e.value='+JSON.stringify(String(v))+'; e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));');
const read=expression=>page.eval('return '+expression);

try {
  fs.mkdirSync(episodes);
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=320x180:r=24:d=1',
    '-f','lavfi','-i','color=c=blue:s=320x180:r=24:d=1','-f','lavfi','-i','sine=frequency=660:duration=2',
    '-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-map','2:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',movie],{windowsHide:true});
  server=spawn(process.execPath,['hub-server.mjs','--port',String(port),'--studio-port',String(await freePort(4832)),'--episodes',episodes,'--remotion',path.dirname(modules),'--theatre',runtime],{
    cwd:studio,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,COULISSES_LANG:'fr',COULISSES_SETTINGS:path.join(runtime,'settings.json'),COULISSES_PROJECTS_ROOT:projects,
      COULISSES_MEDIAS:path.join(runtime,'medias'),STUDIO_PROJECTS:path.join(runtime,'registry.json'),COULISSES_V2_OWN_STUDIOS:'1'}
  });
  server.stderr.on('data',data=>serverLog+=data);server.stdout.on('data',data=>serverLog+=data);
  for(let i=0;i<120;i++) {
    if(server.exitCode!==null) throw Error(serverLog);
    if(await fetch(base+'/api/ping').then(r=>r.ok).catch(()=>false)) break;
    await wait(100);
  }
  page=await launch({port:await freePort(9715)});
  await page.goto(base); await page.until('document.querySelector("#reverseOpen")?.textContent === "Découper en plans"'); await click('#reverseOpen');
  await value('#rvPath',movie);await value('#rvName','Épreuve Reverse');await click('#rvAnalyze');
  await page.until('document.querySelectorAll("#rvShots .rv-shot").length===2 && document.querySelector("#rvImage").naturalWidth>0',60000);
  assert.equal(await read('document.querySelector("#rv-sourceOut").value'), '24');
  pass('Un MP4 analysé depuis la bibliothèque affiche sa vraie coupe et ses images de référence.');
  await value('#rv-label','Intro'); await value('#rv-title','Titre éditable');await click('#rvBackgroundOn');
  await value('#rv-titleAlign','center'); await value('#rv-titleFont','serif');
  assert.equal(await read('getComputedStyle(document.querySelector("#rvLayer")).textAlign'),'center');
  assert.match(await read('getComputedStyle(document.querySelector("#rvLayer")).fontFamily'),/serif$/);
  await value('#rvFrame',8);await click('#rvSplit');await click('#rvLater');
  await value('#rv-zoom',1.25);await click('#rvSetArea');await value('#rv-inset-width',67);await value('#rv-inset-x',43);
  assert.equal(await read('document.querySelector("#rvCount").textContent'),'3');
  await page.goto(base);await page.until('document.querySelector("#reverseDialog").open && document.querySelectorAll("#rvShots .rv-shot").length===3');
  await click('#rvShots [data-shot="2"]');assert.equal(await read('document.querySelector("#rv-inset-x").value'),'43');
  pass('Les coupes, leur ordre, le titre, le recadrage et le calque extrait survivent au rechargement.');
  await page.size(390,844);
  assert.equal(await read('document.querySelector("#reverseDialog").scrollWidth <= document.querySelector("#reverseDialog").clientWidth+1'),true);
  assert.equal(await read('document.querySelector(".rv-body").scrollWidth <= document.querySelector(".rv-body").clientWidth+1'),true);
  await click('#rvCreate'); await page.until('document.querySelector("#rvOpenStudio") || document.querySelector(".rv-error:not([hidden])")',90000);
  assert.ok(await read('!!document.querySelector("#rvOpenStudio")'), await read('document.querySelector(".rv-error").textContent'));
  await click('#rvReveal');
  const folder=fs.readdirSync(projects,{withFileTypes:true}).find(e=>e.isDirectory() && fs.existsSync(path.join(projects,e.name,'src','montage.json')));
  assert.ok(folder);
  const manifest=path.join(projects,folder.name,'src','montage.json'), baseline=JSON.parse(fs.readFileSync(manifest,'utf8'));
  assert.deepEqual(baseline.shots.map(s=>[s.sourceIn,s.sourceOut]),[[0,8],[24,48],[8,24]]);
  assert.equal(baseline.shots[2].inset.width,67);assert.equal(baseline.shots[2].zoom,1.25);
  assert.equal(baseline.shots[0].title,'Titre éditable');assert.notEqual(baseline.shots[0].titleBackground,'transparent');
  assert.equal(baseline.shots[0].titleAlign,'center');assert.equal(baseline.shots[0].titleFont,'serif');
  pass('La validation sur un écran étroit crée un projet avec les véritables plans et calques demandés.');
  await page.until('!document.querySelector("#featureReverse").hidden'); await click('#featureReverse');
  await page.until('document.querySelector("#rvCreate")?.textContent.includes("Enregistrer")');
  await value('#rv-title','Deuxième version'); await click('#rvCreate');await page.until('document.querySelector("#rvOpenStudio")',30000);
  assert.equal(JSON.parse(fs.readFileSync(manifest,'utf8')).shots[0].title,'Deuxième version');
  pass('La fiche de bibliothèque rouvre le même projet et la nouvelle version du titre est écrite sur disque.');
  await click('#rvOpenStudio');await page.until('location.port!=='+JSON.stringify(String(port))+' && window.__preview?.durationInFrames===48',90000);
  pass('Ouvrir le studio lance la composition Remotion générée et ses 48 images.');
  console.log(passed+' ok, 0 ko');
} catch(e) {
  console.error(e);console.error(serverLog.slice(-1800));console.error(page?.logs?.slice(-4));console.log(passed+' ok, 1 ko');process.exitCode=1;
} finally {
  await page?.close();
  if(server?.pid && server.exitCode===null) try{execFileSync('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}
  if(path.dirname(runtime)===cache)fs.rmSync(runtime,{recursive:true,force:true,maxRetries:4,retryDelay:300});
}

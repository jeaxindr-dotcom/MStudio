// Run the shipped library UI in Chrome against a private HTTP fixture. The native
// picker, agent and renderer are simulated so failures do not consume credits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {launch} from './cdp.mjs';
import {freePort} from './where.mjs';
import {renderPage} from '../lib/i18n.mjs';

const file=name=>fs.readFileSync(new URL('../'+name,import.meta.url));
const assets=new Map(['menubar.js','shortcuts.js','page/reverse-ui.js','page/reconstruct-ui.js','page/reverse.css','page/hub-library.css'].map(name=>['/'+name.split('/').at(-1),name]));
const source='C:\\Images & films\\Étoiles de 東京.mp4';
const project={title:'Soleil & lune',dir:'C:\\Projets\\soleil',id:'P12345678',kind:'remotion',engine:'remotion',project:true};
const state={starts:[],actions:[],projects:[],jobs:new Map(),accepted:new Map(),verified:false,dropNext:false};
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  const send=(status,type,data)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(data);};
  const json=(data,status=200)=>send(status,'application/json; charset=utf-8',JSON.stringify(data));
  let raw='';for await(const part of req)raw+=part;
  const b=raw?JSON.parse(raw):{};
  if(u.pathname==='/')return send(200,'text/html; charset=utf-8',renderPage(file('hub.html').toString(),{l:u.searchParams.get('lang')||'fr',prefixes:['hub.','common.','menu.','hf.noneShort']}));
  if(assets.has(u.pathname))return send(200,u.pathname.endsWith('.js')?'application/javascript':'text/css',file(assets.get(u.pathname)));
  if(u.pathname==='/api/episodes')return json({episodes:[],projects:state.projects});
  if(u.pathname==='/api/import/pick'&&req.method==='POST'&&b.what==='video')return json({ok:true,path:source});
  if(u.pathname==='/api/reverse/reconstruct'&&req.method==='POST'){
    state.starts.push(b);
    if(b.path!==source)return json({ok:false,why:'Choisis un fichier vidéo local existant.'},400);
    const accepted=state.accepted.get(b.requestId);
    if(accepted){if(state.startGate)await state.startGate;return json(accepted);}
    const j={ok:true,job:randomUUID(),state:'analyzing',progress:12,name:b.name,message:'Analyse des images'};
    if(b.agent==='handoff')Object.assign(j,{state:'awaiting-agent',handoff:{brief:'C:\\Dossier avec espaces\\brief.md',layers:'C:\\Dossier avec espaces\\src\\layers.json'}});
    state.jobs.set(j.job,j);state.accepted.set(b.requestId,j);state.last=j;
    if(state.startGate) await state.startGate;
    if(state.unreadable){state.unreadable=false;return send(200,'application/json','{');}
    return json(j,202);
  }
  const m=/^\/api\/reverse\/reconstruction\/([\da-f-]+)(?:\/(cancel|retry|verify))?$/.exec(u.pathname);
  if(m){
    const j=state.jobs.get(m[1]);
    if(!j)return json({ok:false,why:'Session expirée'},404);
    if(!m[2]&&req.method==='GET'){
      if(state.dropNext){state.dropNext=false;return json({ok:false,why:'Connexion momentanément interrompue.'},503);}
      return json(j);
    }
    if(m[2]&&req.method==='POST'){
      state.actions.push([j.job,m[2]]);
      if(m[2]==='cancel')j.state='cancelled';
      if(m[2]==='retry')Object.assign(j,{state:'authoring',progress:36,message:'Building layers'});
      if(m[2]==='verify'){
        if(!state.verified)return json({ok:false,why:'Save layers.json before rendering'},409);
        Object.assign(j,{state:'done',project,progress:100,report:{layerCount:6,sceneCount:2,visualScore:.892,approximate:true,approximations:['Some letterforms are approximate.']}});state.projects=[project];
      }
      return json(j);
    }
  }
  if(u.pathname==='/api/open'&&u.searchParams.get('ep')===project.id&&req.method==='POST')return json({ok:true,url:'http://127.0.0.1:'+server.address().port+'/studio-fixture'});
  if(u.pathname==='/studio-fixture')return send(200,'text/html','<title>Studio ouvert</title>');
  if(u.pathname.startsWith('/api/'))return json({ok:true});
  send(404,'text/plain','Not found');
});

let page,passes=0;
const pass=message=>{console.log('✓ '+message);passes++;};
const read=expr=>page.eval('return '+expr);
const visible=sel=>page.until('document.querySelector('+JSON.stringify(sel)+')?.getClientRects().length > 0',6500);
const val=id=>read('document.getElementById('+JSON.stringify(id)+').value');
const txt=id=>read('document.getElementById('+JSON.stringify(id)+').textContent');
const set=(id,v)=>page.eval('const f=document.getElementById('+JSON.stringify(id)+');f.value='+JSON.stringify(v)+';f.dispatchEvent(new Event("input",{bubbles:true}));f.dispatchEvent(new Event("change",{bubbles:true}));');
async function click(id){
  const point=await page.eval('const e=document.getElementById('+JSON.stringify(id)+');e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:e.contains(document.elementFromPoint(x,y)),disabled:e.disabled};');
  assert.ok(point.hit&&!point.disabled,'Must receive pointer input: #'+id);
  await page.mouse('mousePressed',point.x,point.y);await page.mouse('mouseReleased',point.x,point.y);
}
async function fits(){
  assert.ok(await read('["#reconstructDialog",".rc-content"].every(s=>{const e=document.querySelector(s);return e.scrollWidth<=e.clientWidth+1;})'),'Dialog fits narrow screen');
}
async function closePanel(){
  await page.eval('window.reconstructClosed = new Promise(resolve=>document.querySelector("#reconstructDialog").addEventListener("close",resolve,{once:true}));');
  await click('rcClose');await page.eval('await window.reconstructClosed;');
}
try{
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const base='http://127.0.0.1:'+server.address().port;
  page=await launch({port:await freePort(9755)});await page.goto(base);
  assert.equal(await txt('reverseOpen'),'Découper en plans');assert.equal(await txt('reconstructOpen'),'Reconstruire en Remotion');
  await click('reverseOpen'); await visible('#rvAnalyze'); assert.equal(await read('document.getElementById("reconstructDialog").open'),false);
  await click('rvClose');await click('reconstructOpen');await visible('#rcPath');assert.equal(await read('document.getElementById("reverseDialog").open'),false);
  pass('Découper et reconstruire ouvrent deux parcours distincts.');

  await click('rcStart');assert.equal(state.starts.length,0);
  await set('rcPath','introuvable');await click('rcStart');await visible('#reconstructDialog [role=alert]:not([hidden])');
  await click('rcBrowse');await page.until('document.getElementById("rcPath").value === '+JSON.stringify(source),5000);
  assert.equal(await val('rcPath'),source);await set('rcName',project.title);assert.equal(await val('rcMode'),'cli');
  let release;
  state.startGate=new Promise(resolve=>{release=resolve;});
  await click('rcStart');
  try {
    await click('rcClose');await click('reconstructOpen');
    const pending=await read('(()=>{const b=document.querySelector("#rcStart");return !b||b.disabled;})()');
    assert.ok(pending,'Reopening while a paid agent request is being accepted must not offer a second submission');
    await page.goto(base);
    await page.until('document.querySelector("#reconstructDialog").open',3000);
    assert.equal(state.starts.length,3);
    assert.equal(state.starts[1].requestId,state.starts[2].requestId);
    assert.equal(state.accepted.size,1,'A reload before acknowledgment reattaches to the one submission');
  } finally { state.startGate=null;release(); }
  await visible('#rcProgress');assert.equal(await val('rcProgress'),12);
  const {requestId,...payload}=state.starts.at(-1);
  assert.match(requestId,/^[0-9a-f-]{36}$/i);assert.deepEqual(payload,{path:source,name:project.title,agent:'cli'});
  pass('Après une erreur, le sélecteur accepte le chemin Unicode et lance le mode automatique.');

  const first=state.last.job;await page.goto(base);await visible('#rcProgress');assert.equal(state.starts.length,3);
  await closePanel();state.dropNext=true;await click('reconstructOpen');await visible('#rcReconnect');
  assert.match(await read('document.querySelector("#reconstructDialog [role=alert]").textContent'),/interrompue/);
  await click('rcReconnect');await visible('#rcCancel');await click('rcCancel');await visible('#rcRestart');
  assert.deepEqual(state.actions.at(-1),[first,'cancel']);await click('rcRestart');await visible('#rcPath');
  pass('Rechargement, reconnexion et annulation retrouvent la session initiale.');

  await closePanel();await page.goto(base+'/?lang=en');await page.size(390,844);
  assert.equal(await txt('reverseOpen'),'Split into shots');assert.equal(await txt('reconstructOpen'),'Rebuild in Remotion');
  await click('reconstructOpen');await visible('#rcMode');await fits();await set('rcMode','handoff');
  assert.match(await read('document.querySelector("#reconstructDialog").innerText'),/chat you choose/);
  await set('rcName',project.title);await set('rcPath',source);await click('rcStart');await visible('#rcCopy');
  assert.equal(state.starts.at(-1).agent,'handoff');assert.equal(await txt('rcTitle'),'Continue with an agent');
  assert.match(await read('document.querySelector("#reconstructDialog pre").textContent'),/Dossier avec espaces\\src\\layers\.json/);
  await fits();await click('rcVerify');await visible('#reconstructDialog [role=alert]:not([hidden])');
  const second=state.last;assert.equal(await txt('rcVerify'),'Verify and render');await click('rcRetry');await visible('#rcProgress');
  assert.deepEqual(state.actions.at(-1),[second.job,'retry']);assert.equal(await val('rcProgress'),36);
  Object.assign(second,{state:'awaiting-agent',error:'Agent unavailable'});
  await visible('#rcVerify');assert.match(await read('document.querySelector("#reconstructDialog [role=alert]").textContent'),/Agent unavailable/);
  pass('Sur 390 px, la remise à un agent fournit la consigne et les chemins. Un échec permet de réessayer.');

  state.verified=true;await click('rcVerify');await visible('#rcOpenStudio');
  assert.deepEqual(state.actions.at(-1),[second.job,'verify']);assert.equal(await txt('rcTitle'),'Rebuilt project');
  const report=await read('document.querySelector("#reconstructDialog .rc-content").innerText');
  assert.match(report,/6 editable layer/);assert.match(report,/2 scene/);assert.match(report,/89 %/);assert.match(report,/Some letterforms are approximate/);
  await click('rcOpenStudio');await page.until('location.pathname === "/studio-fixture"',6000);
  pass('La vérification réussie ouvre le projet attendu dans le studio.');
  await page.goto(base);await click('reconstructOpen');await visible('#rcPath');
  state.unreadable=true;await set('rcPath',source);await click('rcStart');await visible('#rcForget');
  assert.equal(await txt('rcReconnect'),'Retrouver la demande');
  await click('rcForget');await visible('#rcPath');
  assert.equal(await read('sessionStorage.getItem("hub.reconstruction.v1")'),null);
  pass('Un accusé de réception illisible offre une récupération et la demande peut être retirée.');
  assert.ok(!page.logs.some(s=>s.startsWith('[exception]')),page.logs.join('\n'));console.log(passes+' ok, 0 ko');
}catch(e){console.error(e);if(page)console.error(await read('document.querySelector("#reconstructDialog")?.innerText'),page.logs.slice(-5));console.log(passes+' ok, 1 ko');process.exitCode=1;}
finally{await page?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}

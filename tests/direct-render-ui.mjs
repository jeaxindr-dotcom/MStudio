// Real studio page, in-memory API: no project, agent or GPU is touched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {launch} from './cdp.mjs';
import {freePort} from './where.mjs';

process.env.COULISSES_LANG='fr';
const {renderPage}=await import('../lib/i18n.mjs');
const root=new URL('../',import.meta.url), read=f=>fs.readFileSync(new URL(f,root),'utf8');
const parts=fs.readdirSync(new URL('page/studio/',root)).filter(f=>/^\d\d-[\w-]+\.js$/.test(f)).sort();
const script='(()=>{\n'+parts.map(f=>read('page/studio/'+f)).join('\n')+`
window.__renderProbe={view:renderView,busy:goBusy,launch:launchRender,
 update:(r)=>{STATUS.render=r;refreshRenderUI();},
 open:()=>setTab('lots')};})();`;
let project=false, failStart=false, state=null, exported=null, page;
const requests=[], code={status:'building',version:0}, timeline={status:'idle',version:0,error:null};
const oldLot={lot:7,kind:'render',sentAt:'2026-01-01T00:00:00Z',ids:[],claude:{status:'taken'},line:'old agent command'};
const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const send=(value,type='application/json')=>{res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(type==='application/json'?JSON.stringify(value):value);};
  if(pathname==='/')return send(renderPage(read('studio.html'),{prefixes:['st.','common.','menu.']}).replace(/<link[^>]+https:\/\/fonts\.[^>]+>/g,''),'text/html');
  if(pathname==='/studio.js')return send(script,'text/javascript');
  if(pathname==='/studio.css')return send(read('page/studio.css'),'text/css');
  if(pathname==='/studio-tools.css')return send(['composition.css','timeline-workrange.css','studio-tools.css','project-output.css'].map(f=>read('page/'+f)).join('\n'),'text/css');
  if(['/menubar.js','/shortcuts.js','/medias.js'].includes(pathname))return send(read(pathname.slice(1)),'text/javascript');
  if(pathname==='/app-update-ui.js')return send(read('page/app-update-ui.js'),'text/javascript');
  if(pathname==='/app-update.css')return send(read('page/app-update.css'),'text/css');
  if(pathname==='/api/meta')return send({kind:project?'remotion':'brambleshire',title:'Direct render fixture',episode:'E03',notesFile:'/fixture/notes.json',
    features:{code:true,plan:true,render:!project,export:project},exportOptions:[{id:'1080p',label:'1080p',scope:'full'},{id:'4k',label:'4K',scope:'full'}],
    engine:'remotion',render:null,snapshot:{frames:3600},size:[1920,1080],fps:30,code,plans:{},agent:{},proxy:'none'});
  if(pathname==='/api/status')return send({code,timeline,plans:{},agent:{},held:false,reviewSound:{state:'missing'},lots:[oldLot],render:state,export:exported});
  if(pathname==='/api/timeline')return send({...timeline,data:null});
  if(pathname==='/api/replies')return send({notes:{}});
  if(pathname==='/api/notes')return send({notes:[],rev:'1'});
  if(req.method==='POST') {
    let body='';for await(const part of req)body+=part;
    requests.push({path:pathname,data:JSON.parse(body||'{}')});
    if(pathname==='/api/render'||pathname==='/api/export') {
      await new Promise(r=>setTimeout(r,150));
      if(failStart)return send({ok:false,why:'Échec du lancement de test'});
      const data=requests.at(-1).data;
      if(pathname==='/api/render') {
        state={state:'running',phase:'checks',producer:'studio-render',runId:'test-run',startedAt:new Date().toISOString(),...data};
        return send({ok:true,state});
      }
      exported={state:'running',started:new Date().toISOString(),...data};return send({ok:true,...exported});
    }
    if(pathname==='/api/render/stop') {state={...state,state:'cancelled',endedAt:new Date().toISOString()};return send({ok:true});}
  }
  return send({});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
let passed=0;const pass=s=>{passed++;console.log('✓ '+s);};
const view=()=>page.eval('return document.querySelector("#renderCard").innerText');
async function update(value) {state=value;await page.eval('window.__renderProbe.update('+JSON.stringify(value)+')');}
async function open() {
  await page.goto(base);await page.until('window.__renderProbe && document.querySelector("#title").textContent.includes("Direct render fixture")',10000);
  await page.eval('window.confirmations=[];window.confirm=s=>{confirmations.push(s);return true;};window.__renderProbe.open();');
  await page.until('document.querySelector("#rcGo")',5000);
}
try {
  page=await launch({port:await freePort(9665)});await open();
  assert.equal(await page.eval('return __renderProbe.busy()'),null);
  assert.doesNotMatch(await view(),/agent prépare|Copier la ligne|Retirer la demande/);
  assert.match(await page.eval('return document.querySelector("#lots").innerText'),/Historique du rendu/);
  pass('An old taken render request does not block or impersonate a running render');

  await page.eval(`document.querySelector('#rcQ [data-q="4k"]').click();__renderProbe.launch();__renderProbe.launch();`);
  await page.until('document.querySelector("#rcStop")',5000);
  assert.equal(requests.filter(x=>x.path==='/api/render').length,1);
  assert.deepEqual(requests.find(x=>x.path==='/api/render').data,{vitesse:1,qualite:'4k'});
  assert.equal(await page.eval('return confirmations.length'),0);
  assert.notEqual(await page.eval('return document.querySelector("#modal").style.display'),'flex');
  assert.equal(await page.eval(`return document.querySelector('#rcQ [data-q="4k"]').disabled`),true);
  assert.match(await view(),/Contrôles automatiques/);assert.doesNotMatch(await view(),/Vérification par l.agent/);
  pass('One click starts a native render directly, preserving quality and rejecting duplicate clicks');

  await update({...state,phase:'render',render:{stage:'frames',frame:300,total:600,pct:50}});
  assert.match(await view(),/300.*600/);
  assert.equal(await page.eval('return document.querySelector("#rcBar").style.width'),'50%');
  await update({...state,phase:'finish',finish:{steps:[{label:'final mix'}]}});
  assert.equal(await page.eval('return !!document.querySelector("#rcStop")'),true);
  await page.eval('document.querySelector("#rcStop").click()');
  await page.until('document.querySelector("#rcGo")',6000);
  assert.equal(requests.filter(x=>x.path==='/api/render/stop').length,1);
  pass('Actual frame progress, finishing and user cancellation stay available in the studio');

  await update({...state,state:'rendered',phase:'done',finish:{duration:20,loudness:{I:-16,peak:-1.2}}});
  assert.match(await view(),/Nouvelle vidéo prête/);assert.doesNotMatch(await view(),/agent/);
  assert.equal(await page.eval('return __renderProbe.busy()'),null);
  assert.equal(await page.eval('return !!document.querySelector("#rcGo")'),true);
  pass('A completed render is ready for user review and another render without agent validation');

  await update({...state,state:'blocked',phase:'checks',error:'Profondeur : contrôle échoué'});
  assert.match(await view(),/Profondeur : contrôle échoué/);
  assert.equal(await page.eval('return document.querySelector("#rcGo").disabled'),false);
  failStart=true;await page.eval('document.querySelector("#rcGo").click()');
  await page.until('document.querySelector("#save").textContent.includes("Échec du lancement de test")',5000);
  assert.equal(await page.eval('return !!document.querySelector("#rcGo")'),true);
  pass('Failed checks and launch errors explain the failure and leave retry under user control');

  project=true;state=null;failStart=false;await open();
  const before=requests.length;await page.eval('document.querySelector("#rcGo").click()');
  await page.until('document.querySelector("#rcStop")',5000);
  assert.equal(requests.slice(before).filter(x=>x.path==='/api/export').length,1);
  assert.equal(await page.eval('return confirmations.length'),0);
  assert.doesNotMatch(await view(),/agent/);
  assert.equal(requests.filter(x=>x.path==='/api/send').length,0);
  assert.ok(!page.logs.some(s=>s.includes('[exception]')),page.logs.join('\n'));
  pass('Generic Remotion exports use the same direct click, progress and stop behavior');
} finally {await page?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
console.log(passed+' ok, 0 ko');

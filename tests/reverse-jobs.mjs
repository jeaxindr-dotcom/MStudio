// Exercise the local HTTP API against private storage. Corrupt only this test's
// catalogue to separate a successful project publication from failed registration.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as wait} from 'node:timers/promises';
import {freePort,remotionModules,skip} from './where.mjs';

const studio=fileURLToPath(new URL('../',import.meta.url)), modules=remotionModules();
if (!modules) skip('les dépendances de Remotion','COULISSES_TEST_REMOTION');
const scratch=path.join(studio,'.cache','reverse-jobs-test');
fs.mkdirSync(scratch,{recursive:true});
const temp=fs.mkdtempSync(path.join(scratch,'case-')), projects=path.join(temp,'projects');
const registry=path.join(temp,'registry.json'), source=path.join(temp,'référence.mp4');
const env={...process.env,STUDIO_PROJECTS:registry, COULISSES_LANG:'fr', COULISSES_SETTINGS:path.join(temp,'settings.json'),
  COULISSES_PROJECTS_ROOT:projects, COULISSES_REVERSE_ROOT:projects, COULISSES_REVERSE_ENGINE:path.dirname(modules),
  COULISSES_MEDIAS:path.join(temp,'media'), COULISSES_HISTORY_DIR:path.join(temp,'history')};
const lock=path.join(temp,'hub.json'), episodes=path.join(temp,'episodes');
fs.mkdirSync(episodes);
let hub,base,exit,log='',ok=0;
const pass=label=>{ok++;console.log('  ✓ '+label);};
const diskShots=dir=>JSON.parse(fs.readFileSync(path.join(dir,'src','montage.json'),'utf8')).shots;
async function post(route,body,status=200) {
  const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();
  assert.equal(response.status,status,JSON.stringify(result));return result;
}
// Force TCP writes on opposite sides of one UTF-8 character in the edited title.
async function postSplitTitle(route,body) {
  const bytes=Buffer.from(JSON.stringify(body));
  const at=bytes.indexOf(Buffer.from('熱'))+1; assert.ok(at>0);
  return new Promise((resolve,reject)=>{
    const req=http.request(base+route,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':bytes.length}},res=>{
      let data='';res.setEncoding('utf8');res.on('data',s=>data+=s);
      res.on('error',reject);
      res.on('end',()=>{try{assert.equal(res.statusCode,202,data);resolve(JSON.parse(data));}catch(e){reject(e);}});
    });
    req.on('error',reject);
    req.write(bytes.subarray(0,at),()=>setTimeout(()=>req.end(bytes.subarray(at)),25));
  });
}
const job = id=>'/api/reverse/jobs/'+id;
async function finished(id) {
  const end=Date.now()+30000;
  for (;;) {
    const res=await fetch(base+job(id)); assert.ok(res.ok);
    const data=await res.json();
    if (!['analyzing','creating'].includes(data.state)) return data;
    if (Date.now()>=end) throw Error('Le travail reste en cours : '+JSON.stringify(data));
    await wait(60);
  }
}
async function image(route) {
  const res=await fetch(base+route);assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/image\/jpeg/);
  const jpeg=Buffer.from(await res.arrayBuffer());
  const probe=execFileSync('ffprobe',['-v','error','-i','pipe:0','-select_streams','v:0','-show_entries','stream=width,height','-of','json'],
    {input:jpeg,windowsHide:true,encoding:'utf8'});
  return {jpeg,...JSON.parse(probe).streams[0]};
}
try {
  execFileSync('ffmpeg',['-v','error','-nostdin','-f','lavfi','-i','testsrc2=s=1000x600:r=8','-frames:v','8','-c:v','libx264','-pix_fmt','yuv420p',source],{windowsHide:true});
  hub=spawn(process.execPath,['hub-server.mjs','--port',String(await freePort(4980)),'--lock',lock,'--episodes',episodes,'--theatre',temp],
    {cwd:studio,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  exit=new Promise(resolve=>hub.once('exit',resolve));
  hub.stdout.on('data',s=>log+=s);hub.stderr.on('data',s=>log+=s);
  const until=Date.now()+15000;
  while(!fs.existsSync(lock)) {if(hub.exitCode!==null || Date.now()>=until) throw Error('Hub indisponible : '+log);await wait(50);}
  const server=JSON.parse(fs.readFileSync(lock));assert.equal(server.pid,hub.pid);base=new URL(server.url).origin;
  const initial=await post('/api/reverse/analyze',{path:source,name:'Test API'},202);
  const review=await finished(initial.job);
  assert.equal(review.state,'review',review.error);assert.equal(review.analysis.frames,8);
  const frame=job(initial.job)+'/frame?frame=2';
  const thumb=await image(frame), monitor=await image(frame+'&view=1'), thumbAgain=await image(frame);
  assert.deepEqual([thumb.width,thumb.height],[360,216]);
  assert.deepEqual([monitor.width,monitor.height],[960,576]);assert.deepEqual(thumb.jpeg,thumbAgain.jpeg);
  pass('Une même image possède une vignette de 360 px et un moniteur de 960 px dans des caches indépendants');

  fs.writeFileSync(registry,'{registre incomplet');
  await post(job(initial.job)+'/create',{shots:review.shots,name:review.name},202);
  const failed=await finished(initial.job);
  assert.equal(failed.state,'review');assert.match(failed.error,/\.coulisses/);
  const folders=()=>fs.readdirSync(projects,{withFileTypes:true}).filter(f=>f.isDirectory()).map(f=>path.join(projects,f.name));
  assert.equal(folders().length,1);const dir=folders()[0];
  assert.equal(diskShots(dir)[0].title,'');
  await post(job(initial.job)+'/create',{shots:review.shots,name:'Autre nom'},409);
  fs.writeFileSync(registry,'{"projects":[]}');
  const newShots=review.shots.map((s,i)=>i===0?{...s,title:'熱 et lumière'}:s);
  await postSplitTitle(job(initial.job)+'/create',{name:review.name,shots:newShots});
  const created=await finished(initial.job);assert.equal(created.state,'done',created.error);
  assert.equal(created.project.dir,dir);assert.deepEqual(folders(),[dir]);
  const reg=JSON.parse(fs.readFileSync(registry));assert.deepEqual(reg.projects.map(p=>p.id),[created.project.id]);
  assert.equal(diskShots(dir)[0].title,'熱 et lumière');
  const replay=await post(job(initial.job)+'/create',{name:review.name,shots:newShots},202);assert.equal(replay.project.id,created.project.id);
  pass('Après un échec réel du registre, la relance conserve un seul projet et enregistre le nouveau titre UTF-8');

  const edit=()=>post('/api/reverse/edit',{id:created.project.id});
  const first=await edit(), other=await edit();assert.equal(first.revision,other.revision);
  const change=(session,title)=>({revision:session.revision,shots:session.shots.map((s,i)=>i===0?{...s,title}:s)});
  await post(job(first.job)+'/create',change(first,'Version conservée'),202);
  assert.equal((await finished(first.job)).state,'done');
  await post(job(other.job)+'/create',{...change(other,'Version périmée'),revision:'inexacte'},409);
  const stale=await fetch(base+job(other.job)+'/create',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(change(other,'Version périmée'))});
  if (stale.status===202) {
    const rejected=await finished(other.job);assert.equal(rejected.state,'review');assert.match(rejected.error,/chang|version|conflit/i);
  } else assert.equal(stale.status,409);
  assert.equal(diskShots(dir)[0].title,'Version conservée');
  const current=await edit();assert.notEqual(current.revision,other.revision);assert.equal(current.shots[0].title,'Version conservée');
  pass('Deux fenêtres ouvertes sur la même révision protègent la modification du premier enregistrement');
  console.log(ok+' ok, 0 ko');
} finally {
  if(hub && hub.exitCode===null) {
    if(base) await fetch(base+'/api/quit',{method:'POST'}).catch(()=>{});
    if(!base || await Promise.race([exit.then(()=>false),wait(3000).then(()=>true)])) {hub.kill();await exit;}
  }
  if(fs.existsSync(projects)) for(const dir of fs.readdirSync(projects)){
    const link=path.join(projects,dir,'node_modules');
    if(fs.lstatSync(link,{throwIfNoEntry:false})?.isSymbolicLink())fs.unlinkSync(link);
  }
  if(path.dirname(temp)===scratch)fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:150});
}

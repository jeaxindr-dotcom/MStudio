import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {timelineCodeThumbnails} from '../lib/timeline-code-thumbnails.mjs';
import {codePlaybackSources} from '../lib/code-playback-sources.mjs';
import {remotionModules, freePort} from './where.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = path.join(root, '.cache', 'test-filmstrip-code');
fs.mkdirSync(cache,{recursive:true});
const qs = frames => new URLSearchParams({frames, version:'2'});
const jpeg = execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=red:s=32x18','-frames:v','1','-c:v','mjpeg','-f','image2pipe','pipe:1'],{windowsHide:true});
const current = n => n === 2;
const generation = async () => ({hash:'build', mediaSignature:'media', durationInFrames:10});

test('Déduplique les requêtes et images, conserve les pixels en cache et rejette la saturation',async () => {
  let release;
  const gate = new Promise(r=>{ release=r; });
  const renders=[];
  const get = timelineCodeThumbnails({project:{}, current, generation, fingerprint:async ()=>'media',
    render:async (_,frames,opts) => {
      assert.deepEqual(opts.fitTo,{width:128,height:72});
      renders.push(frames);
      await gate; for (const f of frames) opts.onFrame(f,jpeg,f);
    }});
  const first = get(qs('4,7,4'));
  assert.equal(first, get(qs('4,7,4')));
  assert.throws(()=>get(qs('1')),e=>e.status===429);
  release(); const sheet=await first;
  assert.ok(sheet.length>200);
  await get(qs('7,3'));
  assert.deepEqual(renders,[[4,7],[3]]);
  for (const f of ['', '-1', '2,x', '1,2,3,4,5,6,7,8,9']) assert.throws(()=>get(qs(f)),e=>e.status===400);
  await assert.rejects(get(qs('10')),e=>e.status===400);
});

test('Un changement de média rejette les pixels déjà rendus',async () => {
  const get = timelineCodeThumbnails({project:{}, current, generation, fingerprint:async ()=>'media-b',
    render:async (_,frames,opts)=>{ for(const f of frames) opts.onFrame(f,jpeg,f); }});
  await assert.rejects(get(qs('0')),e=>e.status===409);
});

test('Deux clients partagent le calcul ; seul le départ du dernier le coupe', async () => {
  let renders = 0, rendering, abandon;
  const started = new Promise(resolve => {rendering = resolve;});
  const stopped = new Promise(resolve => {abandon = resolve;});
  const get = timelineCodeThumbnails({project:{},current,generation,fingerprint:async ()=>'media',
    render:async (_,frames,{signal,onFrame}) => {
      renders++;
      if(renders > 1) { for(const f of frames) onFrame(f,jpeg,f); return; }
      rendering(signal);
      await new Promise((_,reject)=>signal.addEventListener('abort',()=>{abandon();reject(signal.reason);},{once:true}));
    }});
  const one = new AbortController(), two = new AbortController();
  const first = get(qs('3,4'),one.signal), second = get(qs('3,4'),two.signal);
  const rendererSignal = await started;
  one.abort();
  await assert.rejects(first,e=>e.name==='AbortError');
  assert.equal(rendererSignal.aborted,false);
  assert.throws(()=>get(qs('8')),e=>e.status===429);
  two.abort();
  await Promise.all([assert.rejects(second,e=>e.name==='AbortError'),stopped]);
  assert.equal(rendererSignal.aborted,true); await sleep(0);
  assert.equal(renders,1);
  const alreadyGone = new AbortController(); alreadyGone.abort();
  assert.throws(()=>get(qs('2'),alreadyGone.signal),e=>e.name==='AbortError');
  const next = await get(qs('3,4')); assert.ok(next.length>100); assert.equal(renders,2);
  assert.throws(()=>get(new URLSearchParams({version:'1',frames:'0'})),e=>e.status===409);
});

test('La limite de temps libère la requête HTTP et conserve une seule place de rendu',async () => {
  let cancelSeen=false, release;
  const gate=new Promise(r=>{release=r;});
  const get=timelineCodeThumbnails({project:{},current,generation,fingerprint:async ()=>'media',timeout:20,
    render:async (_,__,{signal})=>{ signal.addEventListener('abort',()=>{cancelSeen=true;}); await gate; }});
  // An HTTP connection normally keeps the process alive while the timed build is pending.
  const keep = setTimeout(()=>{},1000);
  try {
    await assert.rejects(get(qs('0')),e=>e.status===504);
    assert.ok(cancelSeen); assert.throws(()=>get(qs('1')),e=>e.status===429);
  } finally {release();clearTimeout(keep);}
});

test('Les jonctions du bac E03 sont empreintées seulement dans le public déclaré',async t=>{
  const tmp=fs.mkdtempSync(path.join(cache,'public-'));
  t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
  const engine=path.join(tmp,'engine'), pub=path.join(engine,'public'), real=path.join(tmp,'shared');
  for(const d of [pub,real,path.join(engine,'src')]) fs.mkdirSync(d,{recursive:true});
  fs.symlinkSync(real,path.join(pub,'art'),'junction');
  const p={remotionDir:engine,EP:engine}, config={sharedPublicRoot:real};
  await assert.rejects(codePlaybackSources(p),/Jonction/);
  const before=await codePlaybackSources(p,config);
  fs.writeFileSync(path.join(real,'art.jpg'),'pixels');
  assert.notEqual(await codePlaybackSources(p,config),before);
  fs.symlinkSync(real,path.join(engine,'src','untrusted'),'junction');
  await assert.rejects(codePlaybackSources(p,config),/Jonction/);
});

test('Le serveur rend les images du vrai code portrait sans MP4, dans l’ordre demandé',{timeout:130000,skip:!remotionModules()}, async t=>{
  const tmp=fs.mkdtempSync(path.join(cache,'route-'));
  const engine=path.join(tmp,'engine'), src=path.join(engine,'src'), review=path.join(tmp,'film','revue');
  fs.mkdirSync(src,{recursive:true}); fs.mkdirSync(review,{recursive:true}); fs.mkdirSync(path.join(engine,'public'));
  const modules=path.join(engine,'node_modules');
  t.after(()=>{if(fs.existsSync(modules))fs.unlinkSync(modules); if(path.dirname(tmp)===cache)fs.rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:250});});
  fs.symlinkSync(remotionModules(),modules,'junction');
  fs.writeFileSync(path.join(engine,'package.json'),'{"name":"timeline-thumbnail-test","private":true}');
  fs.writeFileSync(path.join(src,'coulisses.tsx'),`
    import React from 'react'; import {AbsoluteFill,useCurrentFrame} from 'remotion';
    const Film=()=> <AbsoluteFill style={{backgroundColor:useCurrentFrame()<6?'#ff0000':'#0000ff'}}/>;
    export const compositions=[{id:'CodeThumbs',component:Film,width:240,height:360,fps:24,durationInFrames:12}];
    export const timeline=()=>({fps:24,durationInFrames:12,pistes:[{id:'V1',nom:'Plans',type:'video',clips:[{de:0,a:12,label:'Couleurs'}]}]});`);
  fs.writeFileSync(path.join(src,'index.tsx'),`
    import React from 'react'; import {registerRoot, Composition} from 'remotion'; import {compositions} from './coulisses';
    registerRoot(()=> <Composition {...compositions[0]}/>);`);
  // Production episodes carry large geometry datasets. Certified playback can
  // reject these, but a decorative strip must still render its requested frames.
  fs.writeFileSync(path.join(engine,'public','large-scene.json'), ' '.repeat(17*1024*1024));
  const spec=path.join(tmp,'film','film.coulisses');
  fs.writeFileSync(spec,JSON.stringify({coulisses:1,titre:'Code seul',chaine:'Test',remotion:{projet:'../engine',entree:'src/index.tsx',module:'src/coulisses.tsx',composition:'CodeThumbs',props:{}},revue:'revue',export:{dossier:'07-renders'}}));
  fs.writeFileSync(path.join(review,'projet.json'),JSON.stringify({studio:'Coulisses',kind:'remotion',root:'..',coulisses:'../film.coulisses',title:'Code seul'}));
  const port=await freePort(4570), url='http://127.0.0.1:'+port;
  const env={...process.env, COULISSES_LANG:'fr',COULISSES_SETTINGS:path.join(tmp,'settings.json'), STUDIO_PROJECTS:path.join(tmp,'projects.json'),COULISSES_MEDIAS:path.join(tmp,'medias'),COULISSES_REVIEW_SOUND:'0'};
  const child=spawn(process.execPath,['studio-server.mjs','--no-open','--port',String(port),'--project',review],{env,cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',d=>{log=(log+d).slice(-3000);});child.stderr.on('data',d=>{log=(log+d).slice(-3000);});
  try {
    let status;
    for(let n=0;n<150;n++) { status=await fetch(url+'/api/status').then(r=>r.json()).catch(()=>null); if(status?.code?.status==='ready' && status.timeline?.status==='ready')break; await sleep(100); }
    assert.equal(status?.code?.status,'ready',log);
    const request=(version,frames)=>fetch(url+'/api/timeline-code-thumbnails?'+new URLSearchParams({frames,version}));
    assert.equal((await request(status.code.version+1,'0')).status,409);
    const response=await request(status.code.version,'8,1,8');
    const data=Buffer.from(await response.arrayBuffer()); assert.equal(response.status,200,data.toString('utf8').slice(0,300)+' '+log);
    assert.match(response.headers.get('content-type'),/image\/jpeg/); assert.equal(response.headers.get('x-source'),'code');
    const pixels=execFileSync('ffmpeg',['-v','error','-i','pipe:0','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{input:data,windowsHide:true});
    assert.equal(pixels.length,3*128*72*3);
    const pixel=x=>[...pixels.subarray((36*384+x)*3,(36*384+x)*3+3)];
    assert.ok(pixel(64)[2]>200 && pixel(64)[0]<20); assert.ok(pixel(192)[0]>200 && pixel(192)[2]<20); assert.ok(pixel(320)[2]>200);
    assert.ok(pixel(2).every(n=>n<12),'portrait has black side padding');
  } finally {
    if(child.exitCode===null){try {execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});} catch{/* process already closed */}}
  }
});

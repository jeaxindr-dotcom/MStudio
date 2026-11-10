// Local, opt-in A/B profile. Inputs are read-only, each server has private media links,
// review files, cache and settings. Run with node tests/playback-profile.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import {launch,requireSandbox} from './cdp.mjs';
import {freePort} from './where.mjs';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url))), cache=path.join(root,'.cache','playback-profile');
const arg=(key,fallback)=>{const i=process.argv.indexOf('--'+key);return i<0?fallback:process.argv[i+1];};
const revision=arg('base','8f1821b'), episode='E03 - The Secret Garden';
const input=path.resolve(arg('episodes',path.join(root,'.cache','audit-complet','sandbox','07_Episodes')));
const engine=path.resolve(arg('engine',path.join(root,'.cache','audit-complet','.cache','test-engine')));
const start=Number(arg('frame','1410')), duration=Number(arg('ms','10000'));
fs.mkdirSync(cache,{recursive:true});const directory=fs.mkdtempSync(path.join(cache,'profile-'));
const result=path.join(directory,'mesures.json'), journal={revision,source:input,engine,start,duration,created:new Date().toISOString(),samples:[]};
console.log(result);
const write=()=>fs.writeFileSync(result,JSON.stringify(journal,null,2));
const servers=[];let page;
async function prepare(label,base) {
  const runtime=path.join(directory,label), episodes=path.join(runtime,'sandbox','07_Episodes'), scene=path.join(episodes,episode), revue=path.join(scene,'revue');
  fs.mkdirSync(runtime,{recursive:true});
  if(base){
    const archive=path.join(directory,'base.tar');
    execFileSync('git',['archive','--format=tar','--output',archive,revision],{cwd:root,windowsHide:true});
    execFileSync('tar',['-xf',archive,'-C',runtime],{windowsHide:true});fs.unlinkSync(archive);
  }else{
    for(const name of ['page','player','lib','studio-server.mjs','studio-cli.mjs','studio.html','shortcuts.js','menubar.js','medias.js','favicon.png','AGENT.md','AGENT.en.md']){
      fs.cpSync(path.join(root,name),path.join(runtime,name),{recursive:true});
    }
  }
  fs.mkdirSync(revue,{recursive:true});
  for(const rel of [episode+'.mp4','revue/video-revue.mp4'])fs.linkSync(path.join(input,episode,rel),path.join(scene,rel));
  for(const name of ['video-revue.json','timeline.json'])fs.copyFileSync(path.join(input,episode,'revue',name),path.join(revue,name));
  const port=await freePort(4910);
  const server=spawn(process.execPath,['studio-server.mjs','E03','--episodes',episodes,'--remotion',engine,'--theatre',path.dirname(engine),'--no-open','--port',String(port)],{
    cwd:runtime,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,COULISSES_LANG:'fr',COULISSES_SETTINGS:path.join(runtime,'settings.json'),COULISSES_HISTORY_DIR:path.join(runtime,'history'),COULISSES_MEDIAS:path.join(runtime,'medias'),STUDIO_PROJECTS:path.join(runtime,'projects.json')}
  });
  servers.push(server);let log='';server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
  const url='http://127.0.0.1:'+port;
  for(let i=0;i<300&&!log.includes(url)&&server.exitCode===null;i++)await sleep(100);
  assert.ok(log.includes(url),log.slice(-700));await requireSandbox(url,episodes);
  const plan=JSON.parse(fs.readFileSync(path.join(revue,'timeline.json')));
  journal.fps=plan.fps;journal.cuts=plan.sets.flatMap(s=>[s.inT,s.outT]).filter(s=>s!=null).map(s=>Math.round(s*plan.fps)).filter(f=>f>=start&&f<=start+(duration/1000+1)*plan.fps);
  return url;
}
const metric=async()=>Object.fromEntries((await page.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
const iframe=()=>page.eval("return document.querySelector('#code').src");
const basic=`const key='__profileCurrent', rec={t:performance.now(), intervals:[], frames:[], events:[], resets:0,clears:0}; window[key]=rec;
 const poll=(time)=>{ if(window[key]!==rec) return;
   if(rec.previous !== undefined) rec.intervals.push(time-rec.previous); rec.previous=time;
   const f=frame(); if(rec.frames.at(-1)?.[1]!==f) rec.frames.push([Math.round(time-rec.t),f]); requestAnimationFrame(poll); };
 rec.frames.push([0,frame()]); requestAnimationFrame(poll);`;
const resultScript=`const r=window.__profileCurrent, ms=performance.now()-r.t; window.__profileCurrent=null;
 if(r.cleanup)r.cleanup();const last=frame(), first=r.frames[0][1];
 const arr=r.intervals.sort((a,b)=>a-b), q=p=>arr[Math.min(arr.length-1,Math.floor(arr.length*p))];
 return {ms:Math.round(ms),start:first,end:last,framesAdvanced:last-first,rafMedianMs:q(.5),rafP95Ms:q(.95),rafMaxMs:q(1),distinctFrames:r.frames.length,
   events:r.events, timelineResets:r.resets,timelineClears:r.clears,video:r.videoQuality?.(),videoFrames:r.videoFrames??null};`;
async function sample(label,url,mode,repeat) {
  await page.goto(url+'/#f='+start);await page.until("window.__studio && document.querySelector('#v').readyState>=2",90000);
  await sleep(800);
  const code=mode==='code';
  if(code){await page.eval("document.querySelector('#srcCode').click()");await page.until("__studio.state().mode==='code' && window.__preview?.frameReady()",120000); await page.eval('await __preview.prepare('+start+')');}
  else {await page.eval('document.querySelector("#v").currentTime='+((start+.5)/journal.fps));await page.until("!document.querySelector('#v').seeking && document.querySelector('#v').readyState>=2");}
  await sleep(950);
  const frameParent=code?'Math.round(window.__preview.frame())':'Math.floor(v.currentTime*'+journal.fps+'+0.0001)';
  const frameDef='const v=document.querySelector("#v"),frame=()=>'+frameParent+';';
  await page.eval(frameDef+basic+`
    const proto=CanvasRenderingContext2D.prototype;const old={reset:proto.reset,clearRect:proto.clearRect};
    for(const k of ['reset','clearRect']) if(old[k])proto[k]=function(...a){if(this.canvas.id==='tl') {if(k==='reset')rec.resets++;else rec.clears++;}return old[k].apply(this,a);};
    const evt=e=>rec.events.push([Math.round(performance.now()-rec.t),e.type]);for(const n of ['play','playing','waiting','stalled','pause'])v.addEventListener(n,evt);
    const before=v.getVideoPlaybackQuality();rec.videoQuality=()=>{const q=v.getVideoPlaybackQuality();return {decoded:q.totalVideoFrames-before.totalVideoFrames,dropped:q.droppedVideoFrames-before.droppedVideoFrames};};
    rec.videoFrames=0;let cb=0;const count=()=>{rec.videoFrames++;cb=v.requestVideoFrameCallback(count);};if(v.requestVideoFrameCallback)cb=v.requestVideoFrameCallback(count);
    rec.cleanup=()=>{if(cb)v.cancelVideoFrameCallback(cb);Object.assign(proto,old);for(const n of ['play','playing','waiting','stalled','pause'])v.removeEventListener(n,evt);};
  `);
  const src=code?await iframe():null;
  if(code)await page.frameEval(src,'const frame=()=>StudioPlayer.frame();'+basic+`rec.cleanup=StudioPlayer.on(e=>{if(['waiting','resume','play','pause','ended'].includes(e.type))rec.events.push([Math.round(performance.now()-rec.t),e.type]);});`);
  const pre=await metric();await page.eval("document.querySelector('#bPlay').click()");await sleep(duration);
  const parent=await page.eval(frameDef+resultScript);
  const player=code?await page.frameEval(src,'const frame=()=>StudioPlayer.frame();'+resultScript):null;
  const post=await metric();
  await page.eval("if((window.__studio.state().mode==='code'&&__preview.isPlaying()) || (__studio.state().mode==='video'&&!document.querySelector('#v').paused))document.querySelector('#bPlay').click()");
  const actual=player||parent;
  const s={label,mode,repeat,parent,player,progressRatio:actual.framesAdvanced*1000/(actual.ms*journal.fps),cutsCrossed:journal.cuts.filter(f=>actual.start<f&&actual.end>=f),
    mainTargetTaskMs:Math.round((post.TaskDuration-pre.TaskDuration)*1000),mainTargetScriptMs:Math.round((post.ScriptDuration-pre.ScriptDuration)*1000)};
  journal.samples.push(s);write();
  console.log([label,mode,repeat,s.progressRatio.toFixed(3),'canvas='+parent.timelineClears,'cuts='+s.cutsCrossed,'p95='+actual.rafP95Ms.toFixed(1),'events='+JSON.stringify(actual.events)].join(' '));
}
try{
  const a=await prepare('base',true),b=await prepare('candidate',false);
  page=await launch({port:await freePort(9556)});await page.size(1440,900);await page.send('Performance.enable');
  journal.browser=(await page.send('Browser.getVersion')).product;write();
  for(const [mode,order] of [['video',[['base',a],['candidate',b],['candidate',b],['base',a]]],['code',[['candidate',b],['base',a],['base',a],['candidate',b]]]]){
    const rounds={base:0,candidate:0};for(const [label,url] of order) await sample(label,url,mode,++rounds[label]);
  }
  console.log('8 ok, 0 ko');
} catch(e){journal.error=String(e);write();console.error(e,page?.logs.slice(-4));process.exitCode=1;}
finally{
  await page?.close();for(const s of servers)if(s.exitCode===null&&!s.signalCode){const done=once(s,'exit');s.kill();await done;}
}

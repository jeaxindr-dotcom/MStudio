// Opt in with: node tests/mstudio-installed.mjs "C:\...\MStudio.exe" [local-video]
// Run this with the installed MStudio closed. All projects and the watch session belong to this test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';

const exe = path.resolve(process.argv[2] || '');
assert.equal(path.basename(exe), 'MStudio.exe');
const install = path.dirname(exe), bin = name => path.join(install,'runtime',name+'.exe');
const marker = JSON.parse(fs.readFileSync(path.join(install,'mstudio.json'),'utf8'));
assert.equal(marker.name,'MStudio');
const run = fs.mkdtempSync(path.join(os.tmpdir(),'MStudio-test-'));
const profile = path.join(run,'profil'), projects = path.join(run,'projets');
const source = path.join(run,'film.mp4');
fs.mkdirSync(profile);
fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({lang:'fr'}));
const socket = net.createServer();
await new Promise(resolve => socket.listen(0,'127.0.0.1',resolve));
const debugPort = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const system = process.env.SystemRoot;
const env = {...process.env,MSTUDIO_DATA_DIR:profile,MSTUDIO_PROJECTS_ROOT:projects,MSTUDIO_MEDIAS_ROOT:path.join(run,'media'),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port='+debugPort+' --remote-debugging-address=127.0.0.1 --mute-audio',
  PATH:[path.join(system,'System32'), system, path.join(system,'System32','WindowsPowerShell','v1.0')].join(';')};
const primary = process.argv[3] ? ['-i', path.resolve(process.argv[3])] :
  ['-f','lavfi','-i','testsrc2=s=320x180:r=24','-f','lavfi','-i','sine=f=650:r=48000'];
execFileSync(bin('ffmpeg'),['-v','error','-nostdin',...primary,'-t','1','-vf','scale=320:180,fps=24','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac',source],{env,windowsHide:true});
async function until(fn,timeout=45000) {
  const end=Date.now()+timeout; let last;
  while(Date.now()<end) {try {const x=await fn();if(x)return x;} catch(e){last=e;}await delay(180);}
  throw Error('Timed out: '+fn.toString().slice(0,140)+' '+(last?.message||''));
}
const json=async (url,body) => {const r=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json();};
let watcher, ws;
const app=spawn(exe,[],{cwd:install,env,stdio:'ignore'});
const closed=once(app,'exit');
try {
  const lock=await until(()=>JSON.parse(fs.readFileSync(path.join(profile,'hub.json'),'utf8')));
  const base='http://127.0.0.1:'+lock.port;
  const identity=await json(base+'/api/ping');
  assert.equal(identity.app,'MStudio');assert.equal(path.resolve(identity.dataDir),profile);assert.equal(path.resolve(identity.studioDir),install);
  const about=await json(base+'/api/about');assert.equal(about.name,'MStudio');assert.equal(about.version,marker.version);
  const embedded=await until(async()=> (await json('http://127.0.0.1:'+debugPort+'/json/list')).find(t=>t.type==='page'&&t.url.startsWith(base)));
  ws=new WebSocket(embedded.webSocketDebuggerUrl); await once(ws,'open');
  let id=0;const map=new Map();
  ws.onmessage=({data})=>{const msg=JSON.parse(data);if(map.has(msg.id)){map.get(msg.id)(msg);map.delete(msg.id);}};
  const evaluate=async expression=>{const n=++id,reply=new Promise(resolve=>map.set(n,resolve));ws.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));const r=await reply;if(r.result?.exceptionDetails||r.error)throw Error(JSON.stringify(r));return r.result.result.value;};
  await until(()=>evaluate("document.title==='MStudio' && document.querySelector('#reverseOpen')"));
  await evaluate("document.querySelector('#reverseOpen').click()");
  await until(()=>evaluate("!!document.querySelector('#rvPath')"));
  await evaluate("document.querySelector('#rvPath').value="+JSON.stringify(source)+"; document.querySelector('#rvName').value='Atelier Windows'; document.querySelector('#rvAnalyze').click()");
  await until(()=>evaluate("!!document.querySelector('#rvCreate') && document.querySelector('#rvImage')?.naturalWidth>0"));
  await evaluate("const input=document.querySelector('#rv-title');input.value='Essai MStudio';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#rvCreate').click()");
  await until(()=>evaluate("!!document.querySelector('#rvOpenStudio')"));
  const [p]=(await json(base+'/api/episodes')).projects;
  assert.equal(p.reverse,true);assert.equal(path.dirname(p.root),projects);
  assert.equal(JSON.parse(fs.readFileSync(path.join(p.root,'src','montage.json'))).shots[0].title,'Essai MStudio');
  await evaluate("document.querySelector('#rvOpenStudio').click()");
  await until(()=>evaluate("document.title.includes('MStudio') && window.__preview?.durationInFrames===24"),75000);
  const url=await evaluate("location.origin"),meta=await json(url+'/api/meta');
  assert.ok(meta.reverse);assert.ok(meta.connectLine.includes(bin('node')));assert.ok(meta.connectLine.includes('PowerShell'));
  watcher=spawn(bin('node'),[path.join(install,'studio-cli.mjs'),'wait',p.revue,'--agent','codex','--timeout','45'],{cwd:install,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let transcript='';watcher.stdout.on('data',b=>transcript+=b);watcher.stderr.on('data',b=>transcript+=b);
  const received=once(watcher,'exit');
  await until(async()=> (await json(url+'/api/status')).agent?.watching);
  await evaluate("const ta=document.querySelector('#agentText');ta.value='Recette MStudio locale';document.querySelector('#agentSend').click()");
  await received;
  assert.equal(watcher.exitCode,0);assert.match(transcript,/LOT 1 REÇU|BATCH 1 RECEIVED/i);
  assert.ok(fs.readFileSync(path.join(p.revue,'lots','001.md'),'utf8').includes('Recette MStudio locale'));
  assert.equal((await json(url+'/api/export',{qualite:'final'})).ok,true);
  const result=await until(async()=>{const j=(await json(url+'/api/status')).export;return j&&j.state!=='running'?j:null;},180000);
  assert.equal(result.state,'done',JSON.stringify(result));
  const media=JSON.parse(execFileSync(bin('ffprobe'),['-v','error','-show_streams','-of','json',result.file],{env,encoding:'utf8',windowsHide:true}));
  const video=media.streams.find(s=>s.codec_type==='video');
  assert.deepEqual([video.width,video.height,Number(video.nb_frames)],[320,180,24]);
  assert.ok(media.streams.some(s=>s.codec_type==='audio'));
  console.log(JSON.stringify({app:exe,version:about.version,webviewTitle:await evaluate('document.title'),agent:'lot 1 reçu',export:result.file,frames:24,audio:true},null,2));
} finally {
  ws?.close();if(watcher?.exitCode===null)watcher.kill();
  if(app.exitCode===null) {
    const ps=path.join(system,'System32','WindowsPowerShell','v1.0','powershell.exe');
    execFileSync(ps,['-NoProfile','-NonInteractive','-Command','(Get-Process -Id '+app.pid+').CloseMainWindow()'],{windowsHide:true});
    await until(()=>app.exitCode!==null,30000);await closed;
  }
}

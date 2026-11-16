// Real detached worker, isolated files, fake checks/renderer. Never touches a project.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
const root=path.resolve(import.meta.dirname,'..');
fs.mkdirSync(path.join(root,'.cache'),{recursive:true});
const box=fs.mkdtempSync(path.join(root,'.cache','direct-render-'));
process.env.MSTUDIO_APP='1'; process.env.MSTUDIO_DATA_DIR=path.join(box,'profile');
process.env.COULISSES_SETTINGS=path.join(box,'settings.json');
process.env.COULISSES_MEDIAS=path.join(box,'medias');
process.env.COULISSES_HISTORY_DIR=path.join(box,'history');
process.env.COULISSES_GPU='cpu'; process.env.COULISSES_LANG='fr'; process.env.DRY='1';
const fake=path.join(box,'recipe.mjs');
process.env.STUDIO_RENDER_RECIPE=fake;
const {episode,optionsFrom,readJson,writeJson,flagsOf}=await import('../lib/episode.mjs');
const {startRender}=await import('../lib/render-launch.mjs');
const {runRender,renderState,renderFiles,markReviewed,isNativeRenderProject}=await import('../lib/render.mjs');
let checks=0;
const pass=s=>console.log('ok '+(++checks)+' - '+s);
function fixture(name) {
  const theatre=path.join(box,name),dir=path.join(theatre,'07_Episodes','E01 - Fixture');
  fs.mkdirSync(path.join(dir,'revue','lots'),{recursive:true});
  fs.mkdirSync(path.join(theatre,'06_Remotion','src','episodes'),{recursive:true});
  fs.writeFileSync(path.join(theatre,'06_Remotion','src','episodes','registry.ts'),"{id: 'E01', slug: 'Fixture'}");
  const p=episode('E01',optionsFrom(['--theatre',theatre]));
  writeJson(p.NOTES,{notes:[{id:'note',frame:123,text:'Garder ma note'}]});
  writeJson(p.REPLIES,{notes:{note:{status:'done',messages:[{text:'Réponse à conserver'}]}},lots:{7:{status:'taken',at:'2026-01-01T00:00:00Z'}}});
  writeJson(path.join(p.LOTS,'007.json'),{lot:7,kind:'render',edits:[],sentAt:'2026-01-01T00:00:00Z'});
  fs.writeFileSync(path.join(p.EP,p.folder+'.mp4'),'old video');
  return p;
}
function recipe({fail=false,slow=250,renderFail=false,noOutput=false}={}) {
  const js=[
    "import fs from 'node:fs';import path from 'node:path';",
    "export default (p,options)=>{",
    "fs.writeFileSync(path.join(p.REVUE,'received.json'),JSON.stringify({options,gpu:process.env.COULISSES_GPU,isolated:process.env.BRAMBLES_MSTUDIO_EXPORT,dry:process.env.DRY}));",
    "const node=(code)=>[process.execPath,'-e',code];",
    "return {checks:[{key:'check',label:'Fixture',run:[node("+JSON.stringify(fail?"console.log('FAILED');process.exit(1)":"console.log('PASS')")+")],ok:/PASS/},",
    "{key:'flush',label:'Saved JSON',run:[[...node('process.stdout.write(JSON.stringify({value:\"x\".repeat(1048576)}))'),{stdout:'out/dump.json'}],node('if(JSON.parse(require(\"node:fs\").readFileSync(\"out/dump.json\",\"utf8\")).value.length!==1048576)process.exit(1);console.log(\"PASS\")')],ok:/PASS/}],",
    "render:{run:[node("+JSON.stringify(renderFail?"console.error('TypeError: fixture render failed');process.exit(1)":"console.log('Rendered 1/2, time remaining: 1s');setTimeout(()=>console.log('Rendered 2/2'),"+slow+")")+")]}," ,
    noOutput ? "finish:{run:[node('console.log(\"== Finished\")')]}};" : "finish:{run:[node('require(\"node:fs\").writeFileSync('+JSON.stringify(path.join(p.EP,p.folder+'.mp4'))+',\"rendered fixture\");console.log(\"== Finished\");')]}};",
    "};"
  ].join('\n');
  fs.writeFileSync(fake,js);
}
async function ended(p) {
  for(let n=0;n<160;n++){const s=renderState(p);if(s?.state!=='running')return s;await delay(100);}
  throw new Error('Worker did not finish: '+JSON.stringify(renderState(p)));
}
recipe({slow:1100});
const native=fixture('native-path-check');
delete process.env.STUDIO_RENDER_RECIPE;
assert.match(flagsOf(native),/--theatre/);
assert.equal(isNativeRenderProject(native),true);
assert.equal(isNativeRenderProject({...native,remotionDir:path.join(box,'some-other-engine')}),false);
assert.equal(isNativeRenderProject({...native,episodesDir:path.join(box,'copied-episodes')}),false);
const sandboxEP=path.join(box,'copied-episodes','E01 - Fixture');
const sandbox={...native,EP:sandboxEP,REVUE:path.join(sandboxEP,'revue'),episodesDir:path.dirname(sandboxEP)};
assert.equal(isNativeRenderProject(sandbox),false);
assert.throws(()=>startRender(sandbox),/dossier natif/);
const customTheatre=path.join(box,'custom-native'),customEP=path.join(customTheatre,'Episodes personnalisés','E01 - Fixture');
const custom={...native,theatre:customTheatre,EP:customEP,REVUE:path.join(customEP,'revue'),episodesDir:path.dirname(customEP),
  remotionDir:path.join(customTheatre,'Moteur personnalisé'),coulisses:path.join(customEP,'Fixture.coulisses')};
writeJson(custom.coulisses,{coulisses:1,moteur:'brambleshire',episode:'E01',revue:'revue',remotion:{projet:path.relative(customEP,custom.remotionDir)}});
assert.equal(isNativeRenderProject(custom),true);
assert.equal(isNativeRenderProject({...custom,remotionDir:native.remotionDir}),false);
writeJson(custom.coulisses,{coulisses:1,moteur:'brambleshire',episode:'E02',revue:'revue',remotion:{projet:path.relative(customEP,custom.remotionDir)}});
assert.equal(isNativeRenderProject(custom),false);
process.env.STUDIO_RENDER_RECIPE=fake;
pass('explicit native theatres and validated custom documents are accepted; sandbox overrides are refused without a fake recipe');
const p=fixture('success'); const notes=fs.readFileSync(p.NOTES), replies=readJson(p.REPLIES,{}).notes;
const started=startRender(p,{qualite:'4k',vitesse:1});
assert.equal(started.state,'running'); assert.equal(started.producer,'studio-render'); assert.ok(started.pid>0); assert.notEqual(started.pid,process.pid);
assert.equal(started.qualite,'4k'); assert.equal(started.lot,null);
assert.throws(()=>startRender(p),/déjà en cours/);
await assert.rejects(runRender(p),/déjà/);
pass('direct worker starts immediately, locks duplicate clicks and legacy CLI while running');
assert.equal(readJson(p.REPLIES,{}).lots[7].status,'superseded');
assert.deepEqual(readJson(p.REPLIES,{}).notes,replies); assert.deepEqual(fs.readFileSync(p.NOTES),notes);
assert.deepEqual(fs.readdirSync(p.LOTS),['007.json']);
pass('old agent request retired without new batch or changes to notes and replies');
const result=await ended(p);
assert.equal(result.state,'rendered',JSON.stringify(result)); assert.equal(result.phase,'done'); assert.equal(result.render.total,2); assert.equal(result.runId,started.runId);
assert.ok(result.video?.size>0);
const received=readJson(path.join(p.REVUE,'received.json'),null);
assert.equal(received.options.qualite,'4k'); assert.equal(received.gpu,'cpu'); assert.equal(received.isolated,'1'); assert.equal(received.dry,undefined);
pass('checks, full render and finish complete with selected quality and isolated environment');
const before=fs.readFileSync(renderFiles(p).STATE); assert.equal(markReviewed(p,'legacy agent done'),null); assert.deepEqual(fs.readFileSync(renderFiles(p).STATE),before);
const done=spawnSync(process.execPath,['studio-cli.mjs','done','E01','--theatre',p.theatre,'7','Old agent done'],{cwd:root,env:process.env,encoding:'utf8',windowsHide:true,timeout:15000});
assert.notEqual(done.status,0);assert.equal(readJson(p.REPLIES,{}).lots[7].managedBy,'studio-render');
const cli=spawnSync(process.execPath,['studio-cli.mjs','render','E01','--theatre',p.theatre,'7'],{cwd:root,env:process.env,encoding:'utf8',windowsHide:true,timeout:15000});
assert.notEqual(cli.status,0); assert.match(cli.stdout+cli.stderr,/MStudio|remplac|pilot/i); assert.deepEqual(fs.readFileSync(renderFiles(p).STATE),before);
await assert.rejects(runRender(p,{lot:7}),/remplacée/);assert.deepEqual(fs.readFileSync(renderFiles(p).STATE),before);
pass('legacy render and agent completion cannot replace a user-owned render');
recipe({fail:true}); const blocked=fixture('blocked');
startRender(blocked,{qualite:'1080p',vitesse:1.1});
const fail=await ended(blocked);assert.equal(fail.state,'blocked');assert.match(fail.error,/Fixture/);assert.equal(fail.vitesse,1.1);assert.equal(fail.render.stage,'wait');
assert.equal(fs.readFileSync(path.join(blocked.EP,blocked.folder+'.mp4'),'utf8'),'old video');
pass('failed automatic check is reported locally and preserves the previous film');
recipe({slow:6000});const cancelled=fixture('cancelled');startRender(cancelled);writeJson(renderFiles(cancelled).STOP,{});
assert.equal((await ended(cancelled)).state,'cancelled');
assert.equal(fs.readFileSync(path.join(cancelled.EP,cancelled.folder+'.mp4'),'utf8'),'old video');
pass('stop requested during startup is preserved by the worker, keeping the previous film');
const occupied=fixture('occupied');writeJson(path.join(occupied.remotionDir,'out','e01-mstudio-render.json'),{pid:process.pid});
assert.throws(()=>startRender(occupied),/export est déjà/);assert.throws(()=>startRender(fixture('bad-quality'),{qualite:'test'}),/Qualité/);
const bad=fixture('worker-failure');fs.writeFileSync(fake,'throw new Error("fixture startup failed");');startRender(bad);
const failed=await ended(bad);assert.equal(failed.state,'failed');assert.match(failed.error,/fixture startup failed/);
pass('native exporter exclusion and worker startup failures are explicit');
recipe({renderFail:true});const renderFailed=fixture('render-failure');startRender(renderFailed);
const error=await ended(renderFailed);assert.equal(error.state,'failed');assert.match(error.error,/fixture render failed/);
assert.equal(fs.readFileSync(path.join(renderFailed.EP,renderFailed.folder+'.mp4'),'utf8'),'old video');
pass('render errors retain their message and preserve the previous film');
recipe({noOutput:true});const emptyFinish=fixture('empty-finish');startRender(emptyFinish);
const empty=await ended(emptyFinish);assert.equal(empty.state,'failed');assert.match(empty.error,/sans livrer/);
assert.equal(fs.readFileSync(path.join(emptyFinish.EP,emptyFinish.folder+'.mp4'),'utf8'),'old video');
pass('successful exit without a new output file cannot report a completed render');
recipe({slow:1400});const apiProject=fixture('http');
const port=await new Promise(resolve=>{const s=http.createServer();s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>resolve(n));});});
const origin='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['studio-server.mjs','E01','--theatre',apiProject.theatre,'--no-open','--port',String(port)],{cwd:root,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='';server.stdout.on('data',d=>output+=d);server.stderr.on('data',d=>output+=d);
const post=async(route,data={})=>(await fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(data),signal:AbortSignal.timeout(10000)})).json();
try {
  let ready=false;
  for(let n=0;n<100;n++) {try {if((await fetch(origin+'/api/ping')).ok){ready=true;break;}}catch{} if(server.exitCode!==null)break;await delay(100);}
  assert.ok(ready,output);
  const res=await post('/api/render',{qualite:'1080p'});assert.equal(res.ok,true,JSON.stringify(res));assert.equal(res.state.producer,'studio-render');
  assert.equal((await post('/api/export')).ok,false);
  assert.equal((await ended(apiProject)).state,'rendered');
  assert.deepEqual(fs.readdirSync(apiProject.LOTS),['007.json']);
  pass('actual HTTP render route starts work without an agent, updates check or new lot');
  assert.equal((await post('/api/export',{qualite:'4k'})).ok,true);
  assert.equal((await post('/api/export/stop')).ok,true);
  assert.equal((await ended(apiProject)).state,'cancelled');
  assert.equal((await fetch(origin+'/api/export/log')).status,200);
  pass('native export API alias supports direct start, stop and log');
  assert.equal((await post('/api/render')).ok,true);server.kill();
  assert.equal((await ended(apiProject)).state,'rendered');
  pass('detached render completes even when its studio server closes');
} finally {if(server.exitCode===null)server.kill();}
console.log(checks+' checks passed');

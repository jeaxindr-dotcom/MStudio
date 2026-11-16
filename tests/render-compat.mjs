// Legacy CLI integration against a synthetic film and an isolated review server.
// Exercises actual speed encoding and hold/release without touching a real project.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile, execFileSync} from 'node:child_process';
import {promisify} from 'node:util';

const root=path.resolve(import.meta.dirname,'..');
fs.mkdirSync(path.join(root,'.cache'),{recursive:true});
const box=fs.mkdtempSync(path.join(root,'.cache','render-compat-'));
process.env.MSTUDIO_APP='1'; process.env.MSTUDIO_DATA_DIR=path.join(box,'profile');
process.env.COULISSES_GPU='cpu'; process.env.COULISSES_LANG='fr';
process.env.COULISSES_SETTINGS=path.join(box,'settings.json');
const {episode,optionsFrom,writeJson,readJson}=await import('../lib/episode.mjs');
const {processIdentity}=await import('../lib/app-profile.mjs');
const run=promisify(execFile), hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let passed=0;
const pass=message=>console.log('ok '+(++passed)+' - '+message);

const theatre=path.join(box,'theatre'), epDir=path.join(theatre,'07_Episodes','E01 - Synthetic');
fs.mkdirSync(path.join(epDir,'revue','lots'),{recursive:true});
fs.mkdirSync(path.join(theatre,'06_Remotion','src','episodes'),{recursive:true});
fs.writeFileSync(path.join(theatre,'06_Remotion','src','episodes','registry.ts'),"{id:'E01',slug:'Synthetic'}");
const p=episode('E01',optionsFrom(['--theatre',theatre]));
const film=path.join(p.EP,p.folder+'.mp4'), newFilm=path.join(box,'new-film.mp4');
for (const [out,color] of [[film,'red'],[newFilm,'blue']]) {
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i',`color=c=${color}:s=160x90:r=30:d=2.4`,
    '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2.4','-c:v','libx264','-preset','ultrafast',
    '-pix_fmt','yuv420p','-c:a','aac','-shortest',out],{windowsHide:true,timeout:20000,stdio:'pipe'});
}
const oldHash=hash(film), newHash=hash(newFilm);
writeJson(p.NOTES,{notes:[{id:'note',frame:24,text:'Conserver ma note'}]});
writeJson(p.REPLIES,{notes:{note:{status:'done',messages:[{text:'Réponse conservée'}]}},lots:{}});
writeJson(path.join(p.LOTS,'001.json'),{lot:1,kind:'render',edits:[],qualite:'4k',vitesse:1.5,sentAt:new Date().toISOString()});
const notesBefore=fs.readFileSync(p.NOTES), repliesBefore=readJson(p.REPLIES,{}).notes;
const recipe=path.join(box,'recipe.mjs');
fs.writeFileSync(recipe,`import fs from 'node:fs';import path from 'node:path';
export default(p,options)=>{
  fs.writeFileSync(path.join(p.REVUE,'recipe-options.json'),JSON.stringify(options));
  const node=code=>[process.execPath,'-e',code];
  return {checks:[{key:'synthetic',label:'Synthetic check',run:[node('console.log("PASS")')],ok:/PASS/}],
    render:{run:[node('console.log("Rendered 72/72");console.log("Encoded 72/72")')]},
    finish:{run:[node('const fs=require("node:fs");const out='+JSON.stringify(path.join(p.EP,p.folder+'.mp4'))+';fs.copyFileSync('+JSON.stringify(${JSON.stringify(newFilm)})+',out+".new");fs.renameSync(out+".new",out);console.log("== finished synthetic film");')]}};
};`);
const events=[];
const server=http.createServer((req,res)=>{
  req.resume(); res.setHeader('Content-Type','application/json');
  if (req.url==='/api/ping') return res.end(JSON.stringify({...processIdentity(),notesFile:p.NOTES}));
  if (req.url==='/api/hold' || req.url==='/api/unhold') {
    events.push({path:req.url,hash:hash(film)}); return res.end('{"ok":true}');
  }
  res.statusCode=404;res.end('{}');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
writeJson(path.join(p.REVUE,'studio.lock.json'),{...processIdentity(),port:server.address().port});
const env={...process.env,STUDIO_RENDER_RECIPE:recipe};
const args=['studio-cli.mjs','render','E01','--theatre',theatre,'1'];
try {
  await run(process.execPath,args,{cwd:root,env,windowsHide:true,timeout:30000,maxBuffer:1024*1024});
  const state=readJson(path.join(p.REVUE,'render.json'),{});
  assert.equal(state.state,'rendered');assert.equal(state.phase,'review');assert.equal(state.lot,1);
  assert.equal(state.checks[0].status,'ok');assert.equal(state.render.total,72);
  assert.equal(readJson(path.join(p.REVUE,'recipe-options.json'),{}).qualite,'4k');
  assert.equal(hash(film),newHash);assert.notEqual(hash(film),oldHash);
  assert.deepEqual(fs.readFileSync(p.NOTES),notesBefore);assert.deepEqual(readJson(p.REPLIES,{}).notes,repliesBefore);
  pass('legacy CLI completes checks, render and film replacement while preserving review content');
  assert.deepEqual(events,[{path:'/api/hold',hash:oldHash},{path:'/api/unhold',hash:newHash}]);
  pass('review is held before replacement and released after the new film is present');
  const speedFile=path.join(p.EP,p.folder+'-x1.5.mp4');
  assert.equal(state.speedCopy,path.basename(speedFile));assert.equal(state.vitesse,1.5);
  const probe=file=>JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_type,duration,r_frame_rate:format=duration','-of','json',file],{encoding:'utf8',windowsHide:true}));
  const normal=probe(film), fast=probe(speedFile);
  assert.ok(Math.abs(Number(fast.format.duration)-Number(normal.format.duration)/1.5)<0.12);
  assert.ok(fast.streams.some(s=>s.codec_type==='audio'));
  assert.equal(fast.streams.find(s=>s.codec_type==='video').r_frame_rate,'45/1');
  assert.equal(hash(film),newHash);
  pass('requested speed creates a real audio/video copy at 1.5x without altering the normal film');
  await run(process.execPath,['studio-cli.mjs','done','E01','--theatre',theatre,'1','Synthetic film checked'],{cwd:root,env,windowsHide:true,timeout:15000});
  assert.equal(readJson(path.join(p.REVUE,'render.json'),{}).state,'reviewed');
  pass('legacy CLI review completion remains supported');
  const noFake={...env};delete noFake.STUDIO_RENDER_RECIPE;
  let refused;
  try { await run(process.execPath,args,{cwd:root,env:noFake,windowsHide:true,timeout:15000}); }
  catch(error) { refused=error; }
  assert.ok(refused,'real render outside the native default theatre must be refused');
  assert.match(String(refused.stdout)+String(refused.stderr),/seulement sur le vrai projet|only.*real/i);
  assert.equal(hash(film),newHash);assert.deepEqual(fs.readFileSync(p.NOTES),notesBefore);
  pass('legacy sandbox guard rejects real finish without changing the film or notes');
} finally {
  await new Promise(resolve=>server.close(resolve));
}
console.log(passed+' checks passed');

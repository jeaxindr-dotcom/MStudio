import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {analyzeVideo} from '../lib/reverse-analysis.mjs';
import {createReverseProject, readReverseProject, updateReverseProject} from '../lib/reverse-project.mjs';
import {readCoulisses} from '../lib/coulisses-file.mjs';
import {loadTimeline} from '../lib/remotion-module.mjs';
import {remotionModules, skip} from './where.mjs';

const modules = remotionModules();
if (!modules) skip('les dépendances de Remotion', 'COULISSES_TEST_REMOTION');
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = path.join(root,'.cache','reverse-project-test');
fs.mkdirSync(cache,{recursive:true});
const temp = fs.mkdtempSync(path.join(cache,'run-')), library = path.join(temp,'projects');
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const ff = args => execFileSync('ffmpeg',['-nostdin','-loglevel','error',...args],{windowsHide:true,maxBuffer:64*1024*1024});
let passed = 0;
function pass(label) { passed++; console.log('  ✓ '+label); }

try {
  const source = path.join(temp,'master original.mp4');
  ff(['-f','lavfi','-i',"color=c=red:s=160x90:r=30000/1001,drawbox=color=green:t=fill:enable='between(n,15,29)',drawbox=color=blue:t=fill:enable='gte(n,30)',drawbox=x=12:y=54:w=12:h=12:color=yellow:t=fill",
    '-f','lavfi','-i',"aevalsrc='0.2*sin(2*PI*t*if(lt(t,1),300,1300))':s=48000",'-t','1.5015','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',source]);
  const analysis = await analyzeVideo(source);
  const initialHash = sha(source);
  assert.deepEqual(analysis.cuts,[15,30]);
  const args = {name:'Montage de contrôle', analysis, sourcePath:source, root:library, modules};
  const [first, second] = await Promise.all([createReverseProject(args), createReverseProject(args)]);
  assert.notEqual(first.dir,second.dir);
  assert.deepEqual(fs.readdirSync(library).sort(),[path.basename(first.dir),path.basename(second.dir)].sort());
  const state = readReverseProject(first.dir);
  assert.equal(sha(state.sourcePath),initialHash);
  assert.equal(sha(source),initialHash);
  const input = path.join(first.dir,'src','montage.json');
  const model = JSON.parse(fs.readFileSync(input));
  assert.deepEqual(model.shots.map(s=>[s.sourceIn,s.sourceOut]), [[0,15],[15,30],[30,45]]);
  assert.equal(state.shots[0].titleAlign,'left');
  assert.equal(state.shots[0].titleFont,'sans');
  const descriptor = readCoulisses(first.file);
  assert.deepEqual(descriptor.errors, []);
  assert.equal(descriptor.remotion.projet,first.dir);
  const originalTimeline = await loadTimeline(descriptor.remotion);
  assert.equal(originalTimeline.tracks.find(t=>t.type==='video').clips.length,3);
  assert.equal(originalTimeline.tracks.find(t=>t.type==='audio').clips.length,1);
  pass('Deux imports simultanés produisent chacun un projet, une source autonome intacte et une timeline fidèle');
  await assert.rejects(createReverseProject({...args, signal:AbortSignal.abort()}));
  await assert.rejects(createReverseProject({...args, analysis:{...analysis, sha256:'0'.repeat(64)}}));
  assert.deepEqual(fs.readdirSync(library).sort(),[path.basename(first.dir),path.basename(second.dir)].sort());
  pass('Annuler ou remplacer la référence après analyse laisse uniquement les deux projets achevés');
  fs.unlinkSync(source);
  const edits = [{...state.shots[2],title:'T',titleX:3,titleY:4,titleWidth:62,titleSize:20,titleAlign:'center',titleFont:'serif',titleBackground:'#ffffff',titleColor:'#000000',
    inset:{sourceX:12,sourceY:54,width:12,height:12,x:82,y:42,scale:2,mask:'#000000'}},
    {...state.shots[0],sourceIn:1,sourceOut:11}];
  const updated = updateReverseProject(first.dir,{revision:state.revision,shots:edits});
  assert.notEqual(updated.revision,state.revision);
  assert.throws(()=>updateReverseProject(first.dir,{revision:state.revision,shots:state.shots}),e=>e.status===409);
  assert.throws(()=>updateReverseProject(first.dir,{revision:updated.revision,shots:[{...edits[0],sourceOut:1000}]}),e=>e.status===400);
  for (const invalid of [{titleAlign:'justify'},{titleFont:'Georgia'},{titleFont:null}])
    assert.throws(()=>updateReverseProject(first.dir,{revision:updated.revision,shots:[{...edits[0],...invalid}]}),e=>e.status===400);
  const tl = await loadTimeline(descriptor.remotion);
  assert.equal(tl.frames,25);
  assert.equal(tl.fps,30000/1001);
  assert.deepEqual(tl.tracks.find(t=>t.type==='audio').clips.map(c=>c.from),[30,1]);
  assert.deepEqual(tl.tracks.find(t=>t.id==='titles').clips.map(c=>c.label),['T']);
  assert.equal(tl.tracks.find(t=>t.id==='elements').clips.length,1);
  assert.throws(()=>updateReverseProject(first.dir,{revision:updated.revision,shots:[{...edits[0],inset:{...edits[0].inset,width:161}}]}),e=>e.status===400);
  const manual = JSON.parse(fs.readFileSync(input));
  manual.shots[0].agentAnnotation = 'Autre champ édité dans le code.';
  fs.writeFileSync(input,JSON.stringify(manual,null,2));
  const afterManual = readReverseProject(first.dir);
  assert.throws(()=>updateReverseProject(first.dir,{revision:updated.revision,shots:edits}),e=>e.status===409);
  updateReverseProject(first.dir,{revision:afterManual.revision,shots:edits});
  assert.equal(JSON.parse(fs.readFileSync(input)).shots[0].agentAnnotation,manual.shots[0].agentAnnotation);
  pass('Coupe, ordre, titre et son suivent le même JSON. Un enregistrement périmé préserve la révision courante');

  const out = path.join(first.dir,'out');
  const preload = '--import='+pathToFileURL(path.join(root,'tests','isolation-runtime.mjs')).href;
  const env = {...process.env,NODE_OPTIONS:[process.env.NODE_OPTIONS,preload].filter(Boolean).join(' ')};
  const log = execFileSync(process.execPath,['scripts/coulisses-rendu.mjs','--composition','Reverse','--dossier',out,'--qualite','test'],
    {cwd:first.dir,env,encoding:'utf8',windowsHide:true,timeout:150000});
  assert.match(log,/COULISSES FIN/);
  const exported = path.join(out,fs.readdirSync(out).find(n=>n.endsWith('.mp4')));
  const {streams} = JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-show_streams','-of','json',exported],{encoding:'utf8',windowsHide:true}));
  const video = streams.find(s=>s.codec_type==='video');
  assert.equal(Number(video.nb_read_frames),25); assert.equal(video.width,160);assert.equal(video.height,90);
  const [num,den] = video.avg_frame_rate.split('/').map(Number); assert.ok(Math.abs(num/den-tl.fps)<.001);
  const pixels = ff(['-i',exported,'-map','0:v:0','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
  const rgb = (f,x,y) => {const i=(f*160*90+y*160+x)*3;return [...pixels.subarray(i,i+3)];};
  assert.ok(rgb(7,125,60)[2]>215); assert.ok(rgb(20,125,60)[0]>215);
  assert.ok(rgb(7,55,15).every(n=>n>210)); assert.ok(rgb(20,55,15)[2]<30);
  const ink=[];
  for (let x=9;x<59;x++) for(let y=9;y<29;y++) if (rgb(7,x,y).every(n=>n<85)) ink.push(x);
  const paintedCenter=(Math.min(...ink)+Math.max(...ink))/2;
  assert.ok(Math.abs(paintedCenter-34)<4,'Le T est centré dans son cartouche dans le MP4 exporté : '+paintedCenter);
  assert.ok(rgb(7,18,60).every(n=>n<28));
  const moved = rgb(7,91,52); assert.ok(moved[0]>210 && moved[1]>210 && moved[2]<35);
  const pcm=ff(['-i',exported,'-map','0:a:0','-ac','1','-ar','48000','-f','s16le','pipe:1']);
  function frequency(at) {
    const start=Math.round(at*48000), n=4800;let crossings=0, power=0;
    for(let i=start+1;i<start+n;i++) {
      const cur=pcm.readInt16LE(i*2);
      if (pcm.readInt16LE((i-1)*2)<=0 && cur>0) crossings++;
      power+=cur*cur;
    }
    // 0.2 full-scale sine; a second copy on the excerpt's video would quadruple its power.
    assert.ok(power/n>6e6 && power/n<36e6);
    return crossings*10;
  }
  assert.ok(Math.abs(frequency(.12)-1300)<30);
  assert.ok(Math.abs(frequency(.62)-300)<30);
  pass('Export natif de 25 images : coupe bleu→rouge, cartouche édité, élément jaune déplacé et agrandi, ancien emplacement masqué et audio unique dans le nouvel ordre');
  console.log(passed+' ok, 0 ko');
} finally {
  for(const entry of fs.existsSync(library) ? fs.readdirSync(library,{withFileTypes:true}) : []) {
    const nm=path.join(library,entry.name,'node_modules');
    if(fs.lstatSync(nm,{throwIfNoEntry:false})?.isSymbolicLink())fs.unlinkSync(nm);
  }
  if(path.dirname(temp)===cache)fs.rmSync(temp,{recursive:true,force:true,maxRetries:4,retryDelay:300});
}

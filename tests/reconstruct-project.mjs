import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {analyzeVideo} from '../lib/reverse-analysis.mjs';
import {prepareReconstruction,finishReconstruction,discardReconstruction} from '../lib/reconstruct-project.mjs';
import {validateReconstructionLayers} from '../lib/reconstruct-layers.mjs';
import {loadTimeline} from '../lib/remotion-module.mjs';
import {readCoulisses} from '../lib/coulisses-file.mjs';
import {remotionModules,skip} from './where.mjs';

const modules=remotionModules();
if(!modules)skip('le moteur Remotion','COULISSES_TEST_REMOTION');
const preload=pathToFileURL(fileURLToPath(new URL('./isolation-runtime.mjs',import.meta.url))).href;
process.env.NODE_OPTIONS=[process.env.NODE_OPTIONS,'--import='+preload].filter(Boolean).join(' ');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mstudio-reconstruction-test-'));
const root=path.join(temp,'library'),source=path.join(temp,'only-source.mp4');
const layer=(color='#ffff00')=>({version:1,limitations:[],scenes:[{id:'intro',label:'Carton',from:0,to:15,
  background:'#0000ff',layers:[{id:'square',label:'Carré',type:'rect',x:30,y:18,width:60,height:34,fill:color}]}]});
const setModel=(p,m)=>fs.writeFileSync(path.join(p.projectDir,'src','layers.json'),JSON.stringify(m));
const cmd=(tool,args,cwd=temp)=>execFileSync(tool,args,{cwd,windowsHide:true,maxBuffer:8*1024*1024});
const ff=(args,cwd)=>cmd('ffmpeg',['-nostdin','-v','error',...args],cwd);
let p;
try {
  ff(['-f','lavfi','-i','color=c=blue:s=160x90:r=30000/1001,trim=end_frame=15,drawbox=x=30:y=18:w=60:h=34:color=yellow:t=fill',
    '-f','lavfi','-i','sine=frequency=400:duration=0.5005:sample_rate=48000','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',source]);
  const analysis=await analyzeVideo(source);
  const args={name:'Scène test',root,modules,analysis,sourcePath:source};
  p=await prepareReconstruction(args);
  fs.renameSync(source,path.join(temp,'removed-master'));
  assert.ok(!fs.existsSync(root));
  assert.ok(p.contactSheets.every(f=>fs.statSync(f).size>1000));
  assert.ok(!fs.readFileSync(p.indexPath,'utf8').includes(temp));
  assert.ok(!fs.existsSync(path.join(p.projectDir,'node_modules')));
  await assert.rejects(finishReconstruction({prepared:p}),/layers.json/);
  assert.ok(!fs.existsSync(root));
  const bad=layer();
  bad.scenes[0].layers[0].type='video';
  assert.throws(()=>validateReconstructionLayers(bad,analysis),/type/);
  const linked=layer();
  linked.scenes[0].layers[0].fill='url(file:///old-movie.jpg)';
  assert.throws(()=>validateReconstructionLayers(linked,analysis),/fill/);
  const moving=layer();
  moving.scenes[0].layers[0].keyframes=[{frame:0,x:15},{frame:8,x:60}];
  moving.scenes[0].layers[0].clip={x:5,y:10,width:100,height:48};
  validateReconstructionLayers(moving,analysis);
  console.log('  ✓ Evidence, missing/unsupported author output, isolated staging and editable motion');
  const invisible=layer();
  invisible.scenes[0].layers[0].opacity=0;
  setModel(p,invisible);
  await assert.rejects(finishReconstruction({prepared:p}),/flat frames/);
  assert.deepEqual(fs.readdirSync(root),[]);
  console.log('  ✓ Invisible geometry fails the pixel check and leaves the library empty');
  const wrong=layer('#ffffff');
  wrong.scenes[0].background='#f5f5f5';
  setModel(p,wrong);
  let originalScore;
  const result=await finishReconstruction({prepared:p,improve:async({report,feedbackSheets})=>{
    assert.ok(feedbackSheets.every(f=>fs.existsSync(f)));
    originalScore=report.visualScore;
    setModel(p,layer());
    return {summary:'Corrected blue background and yellow rectangle.'};
  }});
  const {dir,report}=result;
  assert.ok(report.visualScore>originalScore+.1);
  assert.ok(report.visualScore>.95,String(report.visualScore));
  assert.equal(report.layerCount,1);
  assert.equal(report.sceneCount,1);
  assert.equal(report.attempts.length,2);
  assert.equal(report.verifiedFormat.frames,15);
  assert.equal(report.sourceSha256,analysis.sha256);
  assert.ok(fs.existsSync(path.join(dir,report.comparisonImage)));
  assert.deepEqual(fs.readdirSync(path.join(dir,'public')),['audio']);
  assert.deepEqual(fs.readdirSync(path.join(dir,'public','audio')),['master.wav']);
  const audioStream=JSON.parse(cmd('ffprobe',['-v','error','-show_streams','-of','json',path.join(dir,'public','audio','master.wav')])).streams;
  assert.deepEqual(audioStream.map(s=>s.codec_type),['audio']);
  assert.deepEqual(fs.readdirSync(root),[path.basename(dir)]);
  const descriptor=readCoulisses(result.file);
  assert.deepEqual(descriptor.errors,[]);
  const tl=await loadTimeline(descriptor.remotion);
  assert.deepEqual(tl.problems,[]);
  assert.deepEqual(tl.tracks.map(t=>t.id),['scenes','layer-square','audio']);
  assert.equal(tl.frames,15);
  discardReconstruction(p);
  assert.ok(!fs.existsSync(p.workspace));
  console.log('  ✓ Full Remotion exports and measured correction with source MP4 removed; editable timeline and audio-only media');
  fs.writeFileSync(path.join(dir,'src','layers.json'),JSON.stringify(layer('#ff0000')));
  cmd(process.execPath,['scripts/coulisses-rendu.mjs','--composition','Reconstruction','--dossier','edited','--qualite','test'],dir);
  const file=path.join(dir,'edited',fs.readdirSync(path.join(dir,'edited')).find(f=>f.endsWith('.mp4')));
  const pixels=ff(['-i',file,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
  const at=(30*160+55)*3;
  assert.ok(pixels[at]>200 && pixels[at+1]<45 && pixels[at+2]<45);
  console.log('  ✓ Published project rerenders its edited red layer after evidence and original are both removed');
  console.log('4 ok, 0 ko');
} finally {
  discardReconstruction(p);
  for(const d of fs.existsSync(root)?fs.readdirSync(root):[]) {
    const link=path.join(root,d,'node_modules');
    if(fs.lstatSync(link,{throwIfNoEntry:false})?.isSymbolicLink())fs.unlinkSync(link);
  }
  if(path.dirname(temp)===os.tmpdir() && path.basename(temp).startsWith('mstudio-reconstruction-test-'))
    fs.rmSync(temp,{recursive:true,force:true,maxRetries:4,retryDelay:150});
}

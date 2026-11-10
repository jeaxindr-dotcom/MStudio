import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
import {createReconstructionJobs} from '../lib/reconstruct-jobs.mjs';

const until=async fn=>{for(let i=0;i<150;i++){const v=fn();if(v)return v;await wait(5);}throw Error('Timed out');};
test('A lost POST acknowledgement creates only one agent task; paid retry is explicit; publication requires verification',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mstudio-jobs-test-')),input=path.join(dir,'input.mp4');
 fs.writeFileSync(input,'fixture');fs.mkdirSync(path.join(dir,'src'));
 let calls=0,checks=0,registered=0,discarded=0;
 const jobs=createReconstructionJobs({root:()=>dir,modules:()=>dir,french:()=>false,register:()=>{registered++;return 'P12345678';},
   analyze:async()=>({frames:10}),prepare:async()=>({projectDir:dir,briefPath:path.join(dir,'brief.md')}),
   author:async()=>{calls++;throw Error('Codex authentication failed');},
   finish:async({agentReport})=>{checks++;assert.equal(agentReport.provider,'external-agent');return {file:path.join(dir,'proof.coulisses'),dir,report:{layerCount:3}};},
   discard:async()=>{discarded++;}});
 try{
   const request={path:input,name:'Proof',requestId:randomUUID()}, j=jobs.start(request);
   assert.equal(jobs.start(request).job,j.job);
   assert.throws(()=>jobs.start({...request,name:'Other'}),/already used/);
   await until(()=>jobs.status(j.job).state==='awaiting-agent');
   assert.equal(calls,1);assert.equal(registered,0);assert.match(jobs.status(j.job).error,/authentication/);
   assert.throws(()=>jobs.resume(j.job,'verify'),/save the layers/);
   fs.writeFileSync(path.join(dir,'src','layers.json'),'{}');
   jobs.resume(j.job,'verify');await until(()=>jobs.status(j.job).state==='done');
   assert.equal(jobs.status(j.job).report.layerCount,3);assert.equal(checks,1);assert.equal(calls,1);assert.equal(registered,1);assert.equal(discarded,1);
   assert.equal(jobs.start(request).state,'done');
 }finally{await jobs.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('Cancel aborts the running agent, publishes nothing and releases its staging directory',async()=>{
 const input=new URL(import.meta.url),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mstudio-jobs-abort-')),file=path.join(dir,'sample.mp4');fs.writeFileSync(file,input.href);
 let aborted=false,clean=0;
 const jobs=createReconstructionJobs({root:()=>dir,modules:()=>dir,french:()=>false,register:()=>assert.fail('registered'),analyze:async()=>({}),
   prepare:async()=>({projectDir:dir}),author:async({signal})=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(Error('cancelled'));},{once:true});}),
   finish:async()=>assert.fail('rendered'),discard:()=>{clean++;}});
 try{const j=jobs.start({path:file});await until(()=>jobs.status(j.job).state==='authoring');assert.equal((await jobs.cancel(j.job)).state,'cancelled');assert(aborted);assert.equal(clean,1);}
 finally{await jobs.close();fs.rmSync(dir,{recursive:true,force:true});}
});

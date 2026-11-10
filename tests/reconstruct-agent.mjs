import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, test} from 'node:test';
import {runReconstructionAgent} from '../lib/reconstruct-agent.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(),'MStudio, author & test-'));
const fake = path.join(temp,'stand-in.mjs');
const original = process.env.COULISSES_CODEX;
const scene = {version:1,limitations:[],scenes:[{id:'one',label:'Title',from:0,to:12,background:'#222222',
  layers:[{id:'title',type:'text',label:'Title',text:'TEST',x:10,y:10,fill:'#eeeeee'}]}]};
fs.writeFileSync(fake,`
  import fs from 'node:fs'; import path from 'node:path';
  const args=process.argv.slice(2), opt=k=>args[args.indexOf(k)+1], mode=opt('-m');
  let prompt=''; for await (const chunk of process.stdin) prompt+=chunk;
  const log=path.resolve('..','calls.jsonl'), previous=fs.existsSync(log);
  const images=args.flatMap((v,i)=>v==='-i'?[args[i+1]]:[]);
  fs.appendFileSync(log,JSON.stringify({args,prompt,images:images.map(f=>fs.readFileSync(f,'utf8')),sourceSession:!!process.env.CODEX_THREAD_ID})+'\\n');
  function event(e){console.log(JSON.stringify(e));}
  event({type:'thread.started',thread_id:'test-thread'});
  event({type:'turn.started'});
  if(mode==='timeout') await new Promise(r=>setTimeout(r,30000));
  const document=${JSON.stringify(scene)};
  if(mode==='bad'||mode==='repair'&&!previous) document.scenes[0].layers[0].type='video';
  const result={layersJson:JSON.stringify(document),summary:'Editable title',rebuilt:['Title'],approximations:[],missing:[]};
  if(mode!=='empty') fs.writeFileSync(opt('-o'),JSON.stringify(result));
  if(mode==='fail') event({type:'turn.failed',error:{message:'Account limit reached'}});
  else event({type:'turn.completed',usage:{input_tokens:10,output_tokens:6}});
`);
process.env.COULISSES_CODEX = fake;
after(() => {
  if (original === undefined) delete process.env.COULISSES_CODEX;
  else process.env.COULISSES_CODEX = original;
  fs.rmSync(temp,{recursive:true,force:true,maxRetries:4});
});

function job(model='good') {
  const workspaceDir = fs.mkdtempSync(path.join(temp,'job-'));
  const projectDir = path.join(workspaceDir,'project'), evidenceDir = path.join(workspaceDir,'evidence');
  fs.mkdirSync(path.join(projectDir,'src'),{recursive:true}); fs.mkdirSync(evidenceDir);
  const contactSheets = ['second named.jpg','first named.jpg'].map((name,i)=>{
    const file = path.join(evidenceDir,name); fs.writeFileSync(file,'frame '+i); return file;
  });
  fs.writeFileSync(path.join(evidenceDir,'brief.md'),'Use native text and geometry.');
  const analysis={width:64,height:36,frames:12,fpsNumerator:12,fpsDenominator:1};
  fs.writeFileSync(path.join(evidenceDir,'index.json'),JSON.stringify({format:analysis,contactSheets:contactSheets.map(f=>path.basename(f))}));
  return {workspaceDir,projectDir,evidenceDir,contactSheets,analysis,model,language:'en'};
}
const calls = j => fs.readFileSync(path.join(j.workspaceDir,'calls.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));
const file = j => path.join(j.projectDir,'src','layers.json');

test('Standalone CLI receives ordered images, a read-only task and no source path or chat bridge', async()=>{
  const j=job(), steps=[];
  j.analysis.sourcePath='private-full-name.mp4';
  const report=await runReconstructionAgent({...j,onProgress:(n,message)=>steps.push([n,message])});
  assert.equal(report.threadId,'test-thread');
  assert.equal(report.provider,'Codex CLI'); assert.equal(report.attempts,1); assert.equal(report.usage.output_tokens,6);
  assert.deepEqual(JSON.parse(fs.readFileSync(file(j))),scene);
  assert.equal(steps.at(-1)[0],100);
  const [call]=calls(j);
  assert.deepEqual(call.images,['frame 0','frame 1']); assert.equal(call.sourceSession,false);
  assert.ok(call.args.includes('read-only')&&call.args.includes('--output-schema')&&call.args.includes('--ignore-user-config'));
  assert.ok(call.prompt.includes('layersJson')&&!call.prompt.includes('private-full-name'));
  assert.deepEqual(fs.readdirSync(j.workspaceDir).sort(),['calls.jsonl','evidence','project']);
});

test('Invalid agent output gets one correction; two invalid answers leave no layers',async()=>{
  const j=job('repair');
  const repaired=await runReconstructionAgent(j);
  assert.equal(repaired.attempts,2);assert.equal(repaired.usage.output_tokens,12);
  assert.match(calls(j)[1].prompt,/invalid type/);
  assert.match(calls(j)[1].prompt,/Previous model to correct/);
  for(const mode of ['bad','empty']){
    const other=job(mode);await assert.rejects(runReconstructionAgent(other));
    assert.equal(calls(other).length,2); assert.equal(fs.existsSync(file(other)),false);
  }
});

test('Terminal CLI failure wins over a plausible output file and is never retried',async()=>{
  const j=job('fail');
  await assert.rejects(runReconstructionAgent(j),/Account limit/);
  assert.equal(calls(j).length,1); assert.equal(fs.existsSync(file(j)),false);
});

test('A timed-out or cancelled CLI cannot publish',async()=>{
  const j=job('timeout');
  await assert.rejects(runReconstructionAgent({...j,timeoutMs:300}),/timed out/);
  assert.equal(fs.existsSync(file(j)),false);
  const other=job('timeout'),c=new AbortController();
  await assert.rejects(runReconstructionAgent({...other,signal:c.signal,onProgress:n=>{if(n===28)c.abort();}}),{name:'AbortError'});
  assert.equal(fs.existsSync(file(other)),false);
});

test('Comparison pass sees previous layers and the measured feedback sheet after the reference',async()=>{
  const j=job(); await runReconstructionAgent(j);
  await assert.rejects(runReconstructionAgent(j),/already contains/);
  const compare=path.join(j.evidenceDir,'compare.jpg');fs.writeFileSync(compare,'reference and render');
  await runReconstructionAgent({...j,feedback:'Title offset in frame 4',feedbackSheets:[compare]});
  const second=calls(j)[1];
  assert.match(second.prompt,/Title offset in frame 4/);assert.match(second.prompt,/Previous model to correct/);
  assert.deepEqual(second.images,['frame 0','frame 1','reference and render']);
});

test('A file outside the evidence packet cannot become an attachment',async()=>{
  const j=job();j.contactSheets=[fake];
  await assert.rejects(runReconstructionAgent(j),/outside/);
  assert.equal(fs.existsSync(path.join(j.workspaceDir,'calls.jsonl')),false);
});

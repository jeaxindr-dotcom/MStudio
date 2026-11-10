import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {analyzeVideo} from './reverse-analysis.mjs';
import {prepareReconstruction, finishReconstruction, discardReconstruction} from './reconstruct-project.mjs';
import {runReconstructionAgent} from './reconstruct-agent.mjs';

const problem = (status,message) => Object.assign(new Error(message),{status});
const working = j => ['analyzing','preparing','authoring','checking'].includes(j.state);
const validVideo = /\.(mp4|mov|m4v|mkv|webm|avi|mts|m2ts)$/i;
export function createReconstructionJobs({root,modules,register,french,analyze=analyzeVideo,prepare=prepareReconstruction,
  author=runReconstructionAgent,finish=finishReconstruction,discard=discardReconstruction}) {
  const jobs=new Map(), say=(fr,en)=>french()?fr:en;
  const snap=j=>({ok:true,job:j.id,state:j.state,name:j.name,progress:j.progress,message:j.message,error:j.error,
    project:j.project,report:j.report,agent:j.agent,
    handoff:j.state==='awaiting-agent'&&j.prepared ? {brief:j.prepared.briefPath,layers:path.join(j.prepared.projectDir,'src','layers.json')} : undefined});
  const find=id=>{const j=jobs.get(id);if(!j)throw problem(404,say('Session expirée. Lance une nouvelle reconstruction.','Session expired. Start a new reconstruction.'));return j;};
  async function clean(j) {if(j.prepared){const owned=j.prepared;j.prepared=null;await discard(owned);}}
  function mark(j,state,progress,message) {j.state=state;j.progress=progress;j.message=message;}
  function run(j,task) {
    j.task=Promise.resolve().then(task).catch(async e=>{
      if(j.controller.signal.aborted){await clean(j);mark(j,'cancelled',0,'');}
      else {j.error=e.message||String(e);mark(j,j.prepared&&!j.published?'awaiting-agent':'error',j.progress,'');}
    }).finally(()=>{j.used=Date.now();});
  }
  async function publish(j) {
    const signal=j.controller.signal; signal.throwIfAborted();
    mark(j,'checking',80,say('Rendu et comparaison avec la référence','Rendering and comparing with the reference'));
    const improve=j.agent?.provider==='external-agent'?undefined:async ({report,feedbackSheets,feedback})=>{
      mark(j,'checking',89,say('L’agent corrige les écarts du premier rendu','The agent is correcting differences in the first render'));
      return author({...j.prepared,language:french()?'fr':'en',signal,feedbackSheets,feedback,previousReport:report});
    };
    const made=await finish({prepared:j.prepared,agentReport:j.agent,signal,improve,onProgress:p=>{if(Number.isFinite(p)) j.progress=Math.max(j.progress,80+Math.round(p*.19));}});
    j.published=true;
    j.project={dir:made.dir,file:made.file,title:j.name};
    j.report=made.report;
    try{j.project.id=register(made.file);}catch(e){throw Error(say('Projet rendu sur disque : ','Rendered project on disk: ')+made.file+' — '+e.message);}
    await clean(j);
    mark(j,'done',100,'');
  }
  async function generate(j) {
    const signal=j.controller.signal; signal.throwIfAborted();
    mark(j,'authoring',24,say('L’agent observe les images et construit les calques','The agent is studying frames and building layers'));
    const feedback=fs.existsSync(path.join(j.prepared.projectDir,'src','layers.json')) ?
      say('Vérifie et corrige le modèle précédent à partir des images de référence.','Check and correct the previous model using the reference frames.') : undefined;
    j.agent=await author({...j.prepared,language:french()?'fr':'en',signal,feedback,onProgress:(p,msg)=>{
      if(Number.isFinite(p)) j.progress=24+Math.round(Math.max(0,Math.min(100,p))*.54);
      if(typeof msg==='string'&&msg) j.message=msg;
    }});
    await publish(j);
  }
  function room() {
    if([...jobs.values()].filter(working).length>=2) throw problem(429,say('Deux reconstructions sont déjà en cours.','Two reconstructions are already running.'));
  }
  function start(b) {
    if(b.requestId!==undefined && (typeof b.requestId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(b.requestId)))
      throw problem(400,'Invalid reconstruction request id');
    const input=typeof b.path==='string' ? b.path.trim().replace(/^"(.*)"$/,'$1') : '';
    if(b.requestId){
      const prev=[...jobs.values()].find(j=>j.requestId===b.requestId);
      if(prev){if(prev.requestInput!==input||prev.agentMode!==(b.agent||'cli')||prev.requestName!==(b.name||''))throw problem(409,'Request id already used');return snap(prev);}
    }
    if (!path.isAbsolute(input)||!validVideo.test(input)||!fs.statSync(input,{throwIfNoEntry:false})?.isFile()) throw problem(400,say('Choisis un fichier vidéo local existant.','Choose an existing local video.'));
    const sourcePath=fs.realpathSync(input),name=(String(b.name||'').trim()||path.basename(sourcePath,path.extname(sourcePath))).slice(0,120);
    if(b.agent!==undefined&&!['cli','handoff'].includes(b.agent)) throw problem(400,'Unknown agent mode');
    const deps=modules(); if(!deps) throw problem(409,say('Le moteur Remotion est introuvable.','The Remotion engine was not found.'));
    room();
    for(const [id,k] of jobs) if(!working(k)&&k.used<Date.now()-86400000){jobs.delete(id);void clean(k).catch(()=>{});}
    if(jobs.size>=32){const expired=[...jobs.values()].find(k=>!working(k)&&!k.prepared);if(expired) jobs.delete(expired.id);else throw problem(429,say('Termine ou annule une session en attente.','Finish or cancel a pending session.'));}
    const j={id:randomUUID(),requestId:b.requestId,requestInput:input,requestName:b.name||'',agentMode:b.agent||'cli',name,controller:new AbortController(),used:Date.now()};
    jobs.set(j.id,j);mark(j,'analyzing',1,say('Analyse de la vidéo','Analyzing the video'));
    run(j,async()=>{
      const signal=j.controller.signal;
      const analysis=await analyze(sourcePath,{signal,onProgress:p=>{if(Number.isFinite(p))j.progress=Math.round(p*.12);}});
      signal.throwIfAborted();mark(j,'preparing',12,say('Préparation des images de référence','Preparing reference images'));
      j.prepared=await prepare({name,sourcePath,analysis,root:root(),modules:deps,signal,onProgress:p=>{if(Number.isFinite(p))j.progress=12+Math.round(p*.11);}});
      signal.throwIfAborted();
      if(b.agent==='handoff') mark(j,'awaiting-agent',24,''); else await generate(j);
    });return snap(j);
  }
  function resume(id,action){
    const j=find(id);if(j.state!=='awaiting-agent')throw problem(409,say('Aucune reprise en attente.','No pending handoff.'));
    room();j.error=undefined;
    if(action==='verify'){
      const file=path.join(j.prepared.projectDir,'src','layers.json');
      if(!fs.statSync(file,{throwIfNoEntry:false})?.isFile()) throw problem(409,say('L’agent doit d’abord enregistrer les calques indiqués dans le brief.','The agent must first save the layers named in the brief.'));
      j.agent={provider:'external-agent',summary:say('Calques fournis par votre agent.','Layers supplied by your agent.')};
      mark(j,'checking',80,'');run(j,()=>publish(j));
    }else{mark(j,'authoring',24,'');run(j,()=>generate(j));}
    return snap(j);
  }
  async function cancel(id) {
    const j=find(id);if(j.state==='done'||j.published)return snap(j);
    j.controller.abort();await j.task;await clean(j);mark(j,'cancelled',0,'');return snap(j);
  }
  async function close(){
    for(const j of jobs.values()) j.controller.abort();
    await Promise.allSettled([...jobs.values()].map(async j=>{await j.task;await clean(j);}));
  }
  return {start,resume,cancel,close,status:id=>snap(find(id))};
}

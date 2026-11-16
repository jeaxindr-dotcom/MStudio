// A click in MStudio starts the native episode pipeline, without an agent lot.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {renderFiles, renderAlive, PHASES, claimNativeRender, isNativeRenderProject} from './render.mjs';
import {readJson, updateJson, writeJson, nowIso} from './episode.mjs';
import {MSTUDIO, processIdentity, assertReviewAvailable} from './app-profile.mjs';
import {gpuEncoder} from './gpu.mjs';
import {speedOf} from './speed.mjs';

const WORKER = fileURLToPath(new URL('./render-run.mjs', import.meta.url));
const LAUNCHER = `const fs=require('node:fs'),{spawn}=require('node:child_process');
const [log,cwd,worker,request]=process.argv.slice(1),fd=fs.openSync(log,'w');
const child=spawn(process.execPath,[worker,request],{cwd,detached:true,windowsHide:true,stdio:['ignore',fd,fd]});
child.on('error',error=>{process.stderr.write(error.message);process.exitCode=1;});
child.on('spawn',()=>{child.unref();process.stdout.write(String(child.pid));fs.closeSync(fd);});`;

function retireRenderRequests(p, runId) {
  const ids = fs.existsSync(p.LOTS) ? fs.readdirSync(p.LOTS).filter(name => /^\d+\.json$/.test(name))
    .map(name => readJson(path.join(p.LOTS,name),null)).filter(lot => lot?.kind === 'render').map(lot => lot.lot) : [];
  if (!ids.length) return;
  updateJson(p.REPLIES,{notes:{},lots:{}},replies => {
    replies.lots ??= {};
    for (const id of ids) {
      const old = replies.lots[id];
      if (!old || ['open','taken'].includes(old.status)) replies.lots[id] = {...old,status:'superseded',managedBy:'studio-render',runId,at:nowIso()};
    }
    return replies;
  });
}

export function startRender(p, {qualite = '1080p', vitesse = 1, log = () => {}} = {}) {
  assertReviewAvailable(p.REVUE);
  if (p.kind !== 'brambleshire') throw new Error('Ce projet utilise son propre exporteur.');
  if (!['1080p','4k'].includes(qualite)) throw new Error('Qualité de rendu inconnue.');
  vitesse = speedOf(vitesse);
  if (vitesse === null) throw new Error('Vitesse de rendu invalide.');
  // Preserve the CLI sandbox boundary: only a normal native theatre is allowed
  // to replace its delivered video. Isolated tests supply their own recipe.
  if (!process.env.STUDIO_RENDER_RECIPE && !isNativeRenderProject(p))
    throw new Error('Le rendu complet nécessite le dossier natif de ce projet.');
  if (!fs.statSync(p.remotionDir).isDirectory()) throw new Error('Dossier Remotion introuvable.');
  const F=renderFiles(p), runId=randomUUID(), request=path.join(p.REVUE,`render-launch-${runId}.json`);
  fs.mkdirSync(p.REVUE,{recursive:true});
  const gpu=gpuEncoder();
  const result=updateJson(F.STATE,{},previous => {
    if (previous.state === 'running' && renderAlive(previous.pid)) throw new Error('Un rendu est déjà en cours dans ce projet.');
    for (const file of [path.join(p.REVUE,'export.json')]) {
      const other=readJson(file,null);
      if (other?.state === 'running' && renderAlive(other.pid)) throw new Error('Un export est déjà en cours dans ce projet.');
    }
    return claimNativeRender(p,()=>{
    retireRenderRequests(p,runId);
    fs.rmSync(F.STOP,{force:true});
    writeJson(request,{p,options:{runId,qualite,vitesse}});
    const bootLog=path.join(p.REVUE,'render-start.log');
    const env={...process.env,COULISSES_GPU:gpu.mode,BRAMBLES_MSTUDIO_EXPORT:'1'}; delete env.DRY;
    const launched=spawnSync(process.execPath,['-e',LAUNCHER,bootLog,p.remotionDir,WORKER,request],{encoding:'utf8',windowsHide:true,timeout:20000,env});
    const pid=Number.parseInt(launched.stdout,10);
    if (!pid || launched.status !== 0) { fs.rmSync(request,{force:true}); throw new Error(`Impossible de démarrer le rendu : ${(launched.stderr || launched.error?.message || 'processus indisponible').trim()}`); }
    return {runId,producer:'studio-render',state:'running',pid,...(MSTUDIO?processIdentity(pid):{}),episode:p.ep,lot:null,
      phase:'checks',only:PHASES,startedAt:nowIso(),updatedAt:nowIso(),qualite,vitesse,gpu:gpu.mode,
      checks:[],render:{stage:'wait',pct:0,frame:0,total:0},finish:{steps:[],loudness:{},duration:null},error:null,tail:[]};
    });
  });
  log(`Rendu ${qualite} démarré par MStudio (PID ${result.pid}).`);
  return result;
}

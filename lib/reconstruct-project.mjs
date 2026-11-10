import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DEPS,exportScript,projectsRoot,slugOf} from './new-project.mjs';
import {createCoulisses} from './coulisses-file.mjs';
import {lang} from './i18n.mjs';
import {analyzeVideo} from './reverse-analysis.mjs';
import {validateReconstructionLayers} from './reconstruct-layers.mjs';
import {run,extractSamples,extractSound,makeSheet,measureSamples,comparisonSheet,probeExport,sampleFrames} from './reconstruct-media.mjs';

const template=fileURLToPath(new URL('./reconstruct-template/',import.meta.url));
const jobs=new WeakMap();
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
async function hashFile(file,signal) {
  const hash=createHash('sha256');
  for await(const chunk of fs.createReadStream(file,{signal}))hash.update(chunk);
  return hash.digest('hex');
}
function dependencies(modules) {
  return Object.fromEntries(Object.keys(DEPS).map(name=>{
    try {return [name,JSON.parse(fs.readFileSync(path.join(modules,name,'package.json'),'utf8')).version];}
    catch {throw Error('Le moteur Remotion est incomplet : '+name);}
  }));
}
function removeOwned(dir,parent,prefix) {
  if(path.dirname(dir)!==parent || !path.basename(dir).startsWith(prefix))throw Error('Dossier temporaire inattendu.');
  const link=path.join(dir,'node_modules');
  if(fs.lstatSync(link,{throwIfNoEntry:false})?.isSymbolicLink())fs.unlinkSync(link);
  fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:180});
}

export async function prepareReconstruction({name,sourcePath,analysis,root=projectsRoot(),modules,signal,onProgress=()=>{}}) {
  if(typeof name!=='string' || !name.trim() || name.length>120)throw Error('Nom de projet requis (120 caractères maximum).');
  const source=path.resolve(sourcePath ?? analysis?.sourcePath);
  const a=analysis ?? await analyzeVideo(source,{signal});
  if(!['width','height','frames','fpsNumerator','fpsDenominator'].every(k=>Number.isSafeInteger(a[k]) && a[k]>0)
    || !Array.isArray(a.cuts) || typeof a.hasAudio!=='boolean' || !Number.isFinite(a.durationSeconds))throw Error('Analyse vidéo incomplète.');
  const format={width:a.width,height:a.height,fpsNumerator:a.fpsNumerator,fpsDenominator:a.fpsDenominator,frames:a.frames,hasAudio:a.hasAudio};
  const authorFormat={...format,cuts:a.cuts,durationSeconds:a.durationSeconds};
  const target=path.resolve(root);
  const engine=fs.realpathSync(modules ?? path.join(target,'node_modules'));
  const deps=dependencies(engine);
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'mstudio-reconstruction-'));
  try {
    const workspace=path.join(scratch,'author'),projectDir=path.join(workspace,'project'),evidenceDir=path.join(workspace,'evidence');
    const briefPath=path.join(evidenceDir,'brief.md'),indexPath=path.join(evidenceDir,'index.json');
    const references=path.join(scratch,'reference-samples');
    fs.mkdirSync(path.join(projectDir,'src'),{recursive:true});
    fs.mkdirSync(evidenceDir,{recursive:true});
    const original=fs.statSync(source,{bigint:true});
    if(await hashFile(source,signal)!==a.sha256)throw Error('La vidéo sélectionnée a changé depuis son analyse.');
    onProgress(5);
    const frames=sampleFrames(a), samples=frames.map((frame,index)=>({index,frame,seconds:frame*a.fpsDenominator/a.fpsNumerator,
      image:'frames/sample-'+String(index+1).padStart(4,'0')+'.jpg',sheet:Math.floor(index/9)+1,cell:index%9+1}));
    await extractSamples(source,a,frames,references,signal);
    fs.cpSync(references,path.join(evidenceDir,'frames'),{recursive:true});
    onProgress(55);
    const sound=path.join(scratch,'master.wav');
    if(a.hasAudio)await extractSound(source,a,sound,signal);
    const current=fs.statSync(source,{bigint:true});
    if(['size','ctimeNs','mtimeNs','ino','dev'].some(k=>current[k]!==original[k]))throw Error('La vidéo a changé pendant l’extraction.');
    const contactSheets=[];
    for(let start=0;start<samples.length;start+=9) {
      const dest=path.join(evidenceDir,'sheet-'+(contactSheets.length+1)+'.jpg');
      await makeSheet(references,samples.slice(start,start+9),dest,signal);
      contactSheets.push(dest);
      onProgress(65+Math.round(30*Math.min(start+9,samples.length)/samples.length));
    }
    fs.copyFileSync(path.join(template,'brief.md'),briefPath);
    write(indexPath,{version:1,format,cuts:a.cuts,samples,contactSheets:contactSheets.map(p=>path.basename(p))});
    const prepared={workspace,workspaceDir:workspace,projectDir,evidenceDir,briefPath,indexPath,contactSheets,analysis:authorFormat};
    jobs.set(prepared,{scratch,format,references,samples,sound,deps,engine,target,title:name.trim(),sourceHash:a.sha256});
    onProgress(100);
    return prepared;
  } catch(error) {removeOwned(scratch,os.tmpdir(),'mstudio-reconstruction-');throw error;}
}

export function discardReconstruction(prepared) {
  const job=jobs.get(prepared);
  if(!job)return;
  removeOwned(job.scratch,os.tmpdir(),'mstudio-reconstruction-');
  jobs.delete(prepared);
}
function readModel(prepared,format) {
  const src=path.join(prepared.projectDir,'src','layers.json');
  if(!fs.existsSync(src))throw Error('Le fichier agent project/src/layers.json est manquant.');
  for (const part of [prepared.workspace,prepared.projectDir,path.dirname(src),src]) {
    if(fs.lstatSync(part).isSymbolicLink())throw Error('Lien interdit dans la sortie de reconstruction.');
  }
  const size=fs.statSync(src);
  if(!size.isFile() || size.size>16*1024*1024)throw Error('layers.json doit être un document JSON de 16 Mo maximum.');
  return validateReconstructionLayers(JSON.parse(fs.readFileSync(src,'utf8').replace(/^\uFEFF/,'')),format);
}
const guide = `# Reconstruction Remotion

Le rendu vient de **src/layers.json** et de **src/Scene.tsx**. Chaque scène a des bornes en images, un fond et des calques nommés. Pour modifier un objet, ajuste sa géométrie, son texte ou ses images clés dans layers.json. Les pistes de src/coulisses-timeline.ts suivent ces mêmes données. Les coordonnées sont exprimées en pixels du projet. La convention complète figure dans LAYERS.md. Quand la référence contient du son, la piste audio seule se trouve dans public/audio/master.wav.

Ouvre le fichier .coulisses dans MStudio. Depuis ce dossier, npm run studio ouvre Remotion Studio et npm run render exporte le film dans out/. Pour installer le projet sur un autre poste, copie les sources et le dossier public, puis lance npm install.

**reconstruction.json** contient la provenance, la mesure sur des instants échantillonnés, les approximations et le chemin du rendu testé. La planche dans review/ compare les instants les moins proches. Elle sert à l’inspection visuelle. Les formes et le texte restent modifiables indépendamment après l’export.
`;
function writeProject(stage,job,model,slug) {
  const src=path.join(stage,'src');
  fs.mkdirSync(src);
  for(const file of ['Scene.tsx','Root.tsx','index.ts','coulisses.ts','coulisses-timeline.ts'])fs.copyFileSync(path.join(template,file),path.join(src,file));
  write(path.join(src,'format.json'),job.format);
  write(path.join(src,'layers.json'),model);
  const pub=path.join(stage,'public');
  fs.mkdirSync(pub);
  if(job.format.hasAudio) {
    fs.mkdirSync(path.join(pub,'audio'));
    fs.copyFileSync(job.sound,path.join(pub,'audio','master.wav'));
  }
  fs.symlinkSync(job.engine,path.join(stage,'node_modules'),'junction');
  write(path.join(stage,'package.json'),{name:'mstudio-reconstruction',private:true,version:'1.0.0',scripts:{
    studio:'remotion studio src/index.ts',render:'node scripts/coulisses-rendu.mjs --composition Reconstruction --dossier out --qualite final'
  },dependencies:job.deps});
  fs.mkdirSync(path.join(stage,'scripts'));
  fs.writeFileSync(path.join(stage,'scripts','coulisses-rendu.mjs'),exportScript(slug,lang()));
  fs.writeFileSync(path.join(stage,'README.md'),guide);
  fs.copyFileSync(path.join(template,'brief.md'),path.join(stage,'LAYERS.md'));
}
function publish(staging,target,slug) {
  for(let n=1;;n++) {
    const dir=path.join(target,n===1?slug:slug+'-'+n);
    if(fs.lstatSync(dir,{throwIfNoEntry:false}))continue;
    try {fs.renameSync(staging,dir);return dir;}
    catch(error) {if(!fs.lstatSync(dir,{throwIfNoEntry:false}))throw error;}
  }
}

export async function finishReconstruction({prepared,agentReport,improve,signal,onProgress=()=>{}}) {
  const job=jobs.get(prepared);
  if(!job)throw Error('Préparation de reconstruction expirée.');
  if(job.busy)throw Error('Validation de cette reconstruction déjà en cours.');
  job.busy=true;
  const {target,format}=job,slug='reconstruction-'+slugOf(job.title);
  const stages=new Set();
  async function render(attempt,agent) {
    signal?.throwIfAborted();
    const model=readModel(prepared,format);
    fs.mkdirSync(target,{recursive:true});
    const stage=fs.mkdtempSync(path.join(target,'.reconstruction-stage-'));
    stages.add(stage);
    writeProject(stage,job,model,slug);
    const out=path.join(stage,'out');
    await run(process.execPath,['scripts/coulisses-rendu.mjs','--composition','Reconstruction','--dossier',out,'--qualite','final'],{
      cwd:stage,signal,onLine:line=>{
        const m=/^COULISSES PROGRES (\d+)/.exec(line);
        if(m)onProgress((attempt===1?1:51)+Math.round(.42*Number(m[1])));
      },
    });
    const files=fs.readdirSync(out).filter(n=>n.endsWith('.mp4') && !n.endsWith('.tmp.mp4'));
    if(files.length!==1)throw Error('L’export Remotion indépendant n’a pas livré un MP4 unique.');
    const output=path.join(out,files[0]),actual=await probeExport(output,signal);
    if(['width','height','frames','hasAudio'].some(k=>actual[k]!==format[k]) ||
      Math.abs(actual.fpsNumerator/actual.fpsDenominator-format.fpsNumerator/format.fpsDenominator)>.00001)
      throw Error('Le rendu ne respecte pas le format, la durée, la cadence ou les pistes du film.');
    const cache=fs.mkdtempSync(path.join(job.scratch,'metrics-'));
    await extractSamples(output,actual,job.samples.map(s=>s.frame),cache,signal);
    const visual=await measureSamples(job.references,cache,job.samples,model.scenes,signal);
    const sheet=await comparisonSheet(job.references,cache,path.join(cache,'pairs'),visual,signal);
    const feedback=path.join(prepared.evidenceDir,'comparison-'+attempt+'.jpg');
    fs.copyFileSync(sheet,feedback);
    fs.mkdirSync(path.join(stage,'review'));
    fs.copyFileSync(sheet,path.join(stage,'review','comparison.jpg'));
    const needsCorrection=visual.meanSsim<.94 || visual.meanRgbMae>8 || visual.frames.some(f=>f.score<.83);
    const flat=visual.frames.some(f=>f.sourceEdgeRms>3) && visual.frames.every(f=>f.renderEdgeRms<.35);
    const approximations=[...new Set([...model.limitations,...(agent?.approximations??[]),...(agent?.missing??[])])];
    const approximate=flat || needsCorrection || approximations.length>0;
    const report={kind:'mstudio-reconstruction',version:1,sourceSha256:job.sourceHash,format,
      visualMethod:'Independent editable SVG, React and Remotion layers. No source video or visual reference assets are used for rendering.',
      render:'out/'+files[0],exportSha256:await hashFile(output,signal),verifiedFormat:actual,
      comparisonImage:'review/comparison.jpg',sceneCount:model.scenes.length,layerCount:model.scenes.reduce((n,s)=>n+s.layers.length,0),
      samples:visual.samples,visualScore:visual.score,approximate,approximations,visual,
      audio:format.hasAudio?'Original mixed soundtrack decoded to synchronized 48 kHz PCM; individual stems unavailable.':'No audio in reference.',
      measurementLimits:'Temporal samples at reduced resolution; the score cannot establish exact typography, semantics, hidden content or between-sample motion.',
      ...(agent?{agentReport:agent}:{})};
    return {stage,report,feedback,needsCorrection:needsCorrection || flat,flat};
  }
  try {
    let best=await render(1,agentReport);
    const attempts=[{attempt:1,score:best.report.visualScore}];
    if(improve && best.needsCorrection) {
      onProgress(50);
      try {
        const measured=best.report.visual;
        const worst=[...measured.frames].sort((a,b)=>a.score-b.score).slice(0,4);
        const corrected=await improve({report:best.report,feedbackSheets:[best.feedback],
          feedback:'Compare reference (left) and reconstruction (right). Mean local SSIM '+measured.meanSsim.toFixed(3)+
            ', mean RGB error '+measured.meanRgbMae.toFixed(1)+'/255. Lowest scores: '+
            worst.map(f=>'F'+f.frame+' '+f.score.toFixed(3)).join(', ')+
            '. Correct specific proportions, colors, typography and timing. Return the complete revised layers document.'});
        const candidate=await render(2,corrected?.agentReport ?? corrected);
        attempts.push({attempt:2,score:candidate.report.visualScore});
        if(!candidate.flat && (best.flat || candidate.report.visualScore>best.report.visualScore))best=candidate;
      } catch(error) {
        signal?.throwIfAborted();
        attempts.push({attempt:2,error:String(error.message).slice(0,1500)});
      }
    }
    signal?.throwIfAborted();
    if(best.flat)throw Error('Le rendu montre uniquement des aplats là où la référence contient des objets. Corrige les calques visibles. / The layers render as flat frames where the reference shows visible objects.');
    const {stage,report}=best;
    report.attempts=attempts;
    write(path.join(stage,'reconstruction.json'),report);
    const file=createCoulisses({dossier:stage,nom:slug,titre:job.title,projet:stage,composition:'Reconstruction',
      format:format.width+'×'+format.height,exportDossier:'out',exportMotif:'\\.mp4$'});
    write(file,{...JSON.parse(fs.readFileSync(file,'utf8')),origine:'coulisses',reconstruction:1});
    const dir=publish(stage,target,slug);
    stages.delete(stage);
    onProgress(100);
    return {dir,file:path.join(dir,path.basename(file)),report};
  } finally {
    job.busy=false;
    for(const stage of stages)removeOwned(stage,target,'.reconstruction-stage-');
  }
}

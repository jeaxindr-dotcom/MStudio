import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {analyzeVideo, previewFrame} from './reverse-analysis.mjs';
import {createReverseProject, readReverseProject, updateReverseProject, validateReverseShots} from './reverse-project.mjs';
import {recognizeReverseText} from './reverse-text.mjs';

const problem = (status, message) => Object.assign(new Error(message), {status});
const working = j => ['analyzing','creating'].includes(j.state);
const fileTypes = /\.(?:mp4|mov|m4v|mkv|webm|avi|mts|m2ts)$/i;

export function createReverseJobs({root, modules, register, locate, french}) {
  const say = (fr,en) => french() ? fr : en;
  const jobs = new Map(), cachedFrames = new Map();
  let activeReads = 0;
  const waitingReads = [], pendingReads = new Set();
  function snapshot(j) {
    const a = j.analysis;
    return {ok:true, job:j.id, state:j.state, progress:j.progress, name:j.name, existing:!!j.existing,
      analysis:a && {width:a.width,height:a.height,fpsNumerator:a.fpsNumerator,fpsDenominator:a.fpsDenominator,
        frames:a.frames,hasAudio:a.hasAudio,cuts:a.cuts,sha256:a.sha256,needsNormalization:a.needsNormalization},
      shots:j.shots, revision:j.revision, project:j.project, error:j.error};
  }
  function allocate(name, sourcePath, state) {
    const now = Date.now();
    for (const [id,j] of jobs) if (!working(j) && now - j.used > 24 * 3600 * 1000) jobs.delete(id);
    if (jobs.size >= 32) {
      const victim = [...jobs.values()].filter(j => j.state === 'done' || j.state === 'cancelled' || j.state === 'error').sort((a,b) => a.used-b.used)[0];
      if (victim) jobs.delete(victim.id);
      else throw problem(429,say('Ferme une reconstruction en attente pour en ouvrir une autre.','Close a pending reconstruction to open another.'));
    }
    if (state === 'analyzing') capacity();
    const j = {id:randomUUID(), name, sourcePath, state, progress:0, used:now, controller:new AbortController()};
    jobs.set(j.id,j);
    return j;
  }
  function capacity() {
    if ([...jobs.values()].filter(working).length >= 2) throw problem(429,say('Deux reconstructions sont en cours. Réessaie après leur analyse.','Two reconstructions are running. Try again when one finishes.'));
  }
  function find(id) {
    const j = jobs.get(id);
    if (!j) throw problem(404,say('Cette session Reverse a expiré. Rouvre le projet ou sélectionne la vidéo.','This Reverse session expired. Reopen the project or select the video.'));
    j.used = Date.now();
    return j;
  }
  function run(j, task, failureState) {
    const signal = j.controller.signal;
    j.task = Promise.resolve().then(() => task(signal, pct => {
      if (!signal.aborted && Number.isFinite(pct)) j.progress = Math.max(0, Math.min(100, Math.round(pct)));
    })).catch(error => {
      j.state = signal.aborted ? 'cancelled' : failureState;
      if (!signal.aborted) j.error = error.message;
    }).finally(() => { j.used = Date.now(); });
  }
  function analyze(body) {
    if (typeof body.path !== 'string') throw problem(400,say('Sélectionne un fichier vidéo.','Select a video file.'));
    const input = body.path.trim().replace(/^"(.*)"$/, '$1');
    if (!path.isAbsolute(input) || !fileTypes.test(input) || !fs.statSync(input,{throwIfNoEntry:false})?.isFile()) {
      throw problem(400,say('La vidéo doit être un fichier local existant.','Select an existing local video file.'));
    }
    const file = fs.realpathSync(input);
    const name = (typeof body.name === 'string' && body.name.trim() || path.basename(file,path.extname(file))).slice(0,120);
    const j = allocate(name,file,'analyzing');
    run(j,async (signal,onProgress) => {
      const a = await analyzeVideo(file,{signal,onProgress});
      signal.throwIfAborted();
      const bounds = [0,...a.cuts,a.frames];
      j.shots = bounds.slice(0,-1).map((from,index) => ({id:'shot-'+(index+1),label:say('Plan ','Shot ')+(index+1),
        sourceIn:from,sourceOut:bounds[index+1],zoom:1,x:0,y:0,title:''}));
      j.analysis = a; j.progress = 100; j.state = 'review';
    },'error');
    return snapshot(j);
  }
  function edit(projectId) {
    const project = locate(projectId);
    if (!project) throw problem(404,say('Projet Reverse introuvable dans la bibliothèque.','Reverse project not found in the library.'));
    const data = readReverseProject(project.dir);
    const j = allocate(data.name,data.sourcePath,'review');
    Object.assign(j,{existing:true,analysis:data.analysis,shots:data.shots,revision:data.revision,project,progress:100});
    return snapshot(j);
  }
  function create(id,body) {
    const j = find(id);
    // If the response was lost, a repeated submission observes the original job.
    if (j.state === 'creating' || j.state === 'done') return snapshot(j);
    if (j.state !== 'review') throw problem(409,say('Attends la fin de l’analyse.','Wait until analysis finishes.'));
    if (!Array.isArray(body.shots) || !body.shots.length) throw problem(400,say('Le montage doit contenir au moins un plan.','Keep at least one shot.'));
    const shots = validateReverseShots(body.shots,j.analysis);
    const name = j.existing ? j.name : String(body.name ?? j.name).trim();
    if (!name || name.length > 120) throw problem(400,say('Donne un nom de 1 à 120 caractères au projet.','Use a project name between 1 and 120 characters.'));
    if (j.published && name !== j.name) throw problem(409,say('Le dossier a déjà été créé sous ce nom : ','The project was already created under this name: ') + j.name);
    let nodeModules;
    if (!j.existing && !j.published) {
      nodeModules = modules();
      if (!nodeModules) throw Object.assign(problem(409,say('Installe le moteur Remotion de Coulisses pour créer le projet.','Install Coulisses’ Remotion engine to create the project.')),{needInstall:true});
    }
    if (j.existing && body.revision !== j.revision) throw problem(409,say('Le projet a changé. Rouvre son montage.','The project changed. Reopen the edit.'));
    capacity();
    j.name = name; j.progress = 0; j.error = undefined; j.state = 'creating'; j.shots = shots;
    run(j,async (signal,onProgress) => {
      signal.throwIfAborted();
      if (j.existing) {
        const next = await updateReverseProject(j.project.dir,{shots,revision:j.revision});
        j.revision = next.revision;
      } else {
        if (j.published) {
          const next = await updateReverseProject(j.published.dir,{shots,revision:j.published.revision});
          j.published.revision = next.revision;
        } else {
          j.published = await createReverseProject({name,sourcePath:j.sourcePath,analysis:j.analysis,shots,
            root:root(),modules:nodeModules,signal,onProgress});
          j.published.revision = readReverseProject(j.published.dir).revision;
        }
        const {dir,file} = j.published;
        try { j.project = {dir,file,id:register(file)}; }
        catch (e) { throw new Error(say('Projet enregistré sur disque : ','Project saved to disk: ') + file +
          say('. Ajout à la bibliothèque impossible : ','. Could not add to library: ') + e.message); }
      }
      j.progress = 100; j.state = 'done';
    },'review');
    return snapshot(j);
  }
  function cancel(id) {
    const j = find(id);
    if (j.state !== 'done') {
      j.controller.abort();
      if (!working(j)) j.state = 'cancelled';
    }
    return snapshot(j);
  }
  async function image(id,frame,signal,ocr=false,view=false) {
    const j = find(id);
    if (!j.analysis || j.state === 'cancelled') throw problem(409,say('Aucune image disponible.','No frame available.'));
    if (!Number.isSafeInteger(frame) || frame < 0 || frame >= j.analysis.frames) throw problem(400,say('Image hors de la vidéo.','Frame outside the video.'));
    const key = [j.id,frame,ocr?'ocr':view?'monitor':'thumb'].join('/');
    if (cachedFrames.has(key)) return cachedFrames.get(key);
    const cancel = AbortSignal.any([signal,j.controller.signal]);
    cancel.throwIfAborted();
    if (activeReads >= 3) {
      if (waitingReads.length >= 128) throw problem(429,say('Chargement de la pellicule en cours.','The filmstrip is loading.'));
      await new Promise((resolve,reject) => {
        const release = () => { cancel.removeEventListener('abort',leave); resolve(); };
        const leave = () => { const n=waitingReads.indexOf(release); if(n>=0) waitingReads.splice(n,1); reject(cancel.reason); };
        waitingReads.push(release); cancel.addEventListener('abort',leave,{once:true});
      });
    } else activeReads++;
    try {
      cancel.throwIfAborted();
      if (cachedFrames.has(key)) return cachedFrames.get(key);
      const ocrWidth = Math.max(1,Math.min(1600,Math.floor(3000 * j.analysis.width / j.analysis.height)));
      const jpeg = await previewFrame(j.sourcePath,j.analysis,frame,{signal:cancel,maxWidth:ocr?ocrWidth:view?960:360});
      const value = ocr ? await recognizeReverseText(jpeg,j.analysis,cancel) : jpeg;
      cachedFrames.set(key,value);
      if (cachedFrames.size > 128) cachedFrames.delete(cachedFrames.keys().next().value);
      return value;
    } finally {
      const next = waitingReads.shift();
      if (next) next(); else activeReads--;
    }
  }
  async function close() {
    for (const j of jobs.values()) j.controller.abort();
    await Promise.allSettled([...jobs.values()].map(j=>j.task).concat([...pendingReads]));
  }
  function trackedImage(...args) {
    const read = image(...args);
    pendingReads.add(read);
    read.then(() => pendingReads.delete(read),() => pendingReads.delete(read));
    return read;
  }
  const hasActiveWork = () => [...jobs.values()].some(working) || pendingReads.size > 0;
  return {analyze,edit,create,cancel,image:trackedImage,close,hasActiveWork,status:id=>snapshot(find(id))};
}

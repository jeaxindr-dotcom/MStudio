// Detached owner of a render launched by the user. Never needs an agent session.
import fs from 'node:fs';
import {runRender,renderFiles,releaseNativeRender} from './render.mjs';
import {readJson,updateJson,nowIso} from './episode.mjs';
const file=process.argv[2];
let request;
try {
  request=readJson(file,null);
  if (!request?.p || !request.options?.runId) throw new Error('Demande de rendu introuvable.');
  const result=await runRender(request.p,{...request.options,log:console.log});
  process.exitCode=['rendered','checked','rendered-raw'].includes(result.state)?0:1;
} catch(error) {
  console.error(error.stack || error.message);
  if (request) updateJson(renderFiles(request.p).STATE,{},state => state.runId===request.options.runId
    ? {...state,state:'failed',error:error.message,endedAt:nowIso()} : state);
  process.exitCode=1;
} finally {
  if(request) releaseNativeRender(request.p,request.options.runId);
  if(file) fs.rmSync(file,{force:true});
}

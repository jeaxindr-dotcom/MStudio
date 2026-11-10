// An export at another speed (user request, 14/10/2026: « exporter à une autre vitesse, vidéo et audio synchro avec la
// vitesse » — « une molette allant de 0,5 à 2,0, chaque cran de 0,1 »). lib/export.mjs starts THIS, detached, instead of
// the export itself: it runs the export (the project's script, or lib/hf-render-run.mjs) and passes its words on to the
// log (COULISSES PROGRES / REMPLACE / FIN, the contract of docs\FICHE-COULISSES-REMOTION.md); at ×1 that is all.
// At any other speed (×0,5 to ×2,0), once the export is done, every video it wrote (the main file — « COULISSES FIN » —
// and the others it made in the same folder meanwhile, as the 1080p drawn from a 4K) gets its copy next to it,
// « <nom>-x1.3.mp4 », picture and sound together (lib/speed.mjs). The export itself stays as it is (×1): it is the video
// the studio reviews, frame for frame with the code and the notes.
// The progress of the export is told as 0–90 %, the copies 90–100 %; « COULISSES FIN » names the copy of the main file.
// usage: node lib/export-run.mjs <vitesse 0.5…2> <cwd> <node> <script> <args…>
import fs from 'node:fs';
import { MSTUDIO, processIdentity, assertReviewAvailable } from './app-profile.mjs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {updateJson, nowIso} from './episode.mjs';
import {directExportProject, exportContract, flag, exportEntryCheck} from './export-context.mjs';
import {exportOptions, exportOptionsReady} from './export.mjs';
import {lang} from './i18n.mjs';
import { speedUp, speedOf, spedName, speedWords, SPED } from './speed.mjs';

const args=process.argv.slice(2);
const explicitFile=args[0]==='--project' ? args.splice(0,2)[1] : null;
const [speedArg, cwd, exe, ...childArgs] = args;
let argv=childArgs, childEnv={...process.env};
delete childEnv.COULISSES_EXPORT_RUN_ID;
delete childEnv.COULISSES_EXPORT_REVUE;
delete childEnv.COULISSES_EXPORT_LABEL;
const SPEED = speedOf(speedArg);
if (SPEED === null || !exe || !argv.length) { console.error('usage: export-run.mjs <vitesse 0.5…2> <cwd> <node> <script> <args…>'); process.exit(2); }
const FAST = SPEED !== 1, started = Date.now();
const managed=process.env.COULISSES_EXPORT_RUN_ID;
let review=managed ? process.env.COULISSES_EXPORT_REVUE : null, ownLog=null;
let progressLabel=managed ? process.env.COULISSES_EXPORT_LABEL : '';
const runId=managed || randomUUID();
if (!managed) {
  const c=directExportProject(cwd,argv,explicitFile || process.env.COULISSES_PROJECT_FILE);
  if (c) {
    const script=path.resolve(cwd,argv[0]), check=exportEntryCheck(c.remotion,script,lang());
    if(check.error) throw new Error(check.error);
    const scriptText=fs.readFileSync(script,'utf8');
    const contract=exportContract(c.remotion,argv,scriptText);
    argv=contract.argv; Object.assign(childEnv,contract.env);
    const q=flag(argv,'--qualite'), range=flag(argv,'--images');
    let variant=null;
    if (scriptText.includes('--options')) {
      const project={kind:'remotion',remotion:c.remotion};
      await exportOptionsReady(project);
      const options=exportOptions(project);
      variant=q ? options.find(o=>o.id===q) : options[0];
    }
    let label=variant?.label || q;
    if (range) label=(lang()==='fr'?'Extrait':'Excerpt')+' '+range+(variant?.resolution?' · '+variant.resolution:'');
    if (variant?.scriptLabel || range) progressLabel=label;
    review=c.revue; assertReviewAvailable(review); fs.mkdirSync(review,{recursive:true});
    updateJson(path.join(review,'export.json'),{},previous=>{
      if(previous.state==='running' && Number.isInteger(previous.pid)) {
        let alive=true; try { process.kill(previous.pid,0); } catch(e) {alive=e.code==='EPERM';}
        if(alive)throw new Error('Un export est déjà en cours dans cette revue.');
      }
      const logPath=path.join(review,'export.log');
      const sameAsStdout = fs.existsSync(logPath) && [1,2].some(fd=>{
        const a=fs.fstatSync(fd),b=fs.statSync(logPath); return a.isFile() && a.ino===b.ino && a.dev===b.dev;
      });
      if(!sameAsStdout)ownLog=fs.openSync(logPath,'w');
      return {state:'running',producer:'export-run',runId,pid:process.pid,...(MSTUDIO ? processIdentity() : {}),started:nowIso(),composition:c.remotion.composition,
        entree:c.remotion.entree,module:c.remotion.module,timeline:c.remotion.timeline||c.remotion.module,dossier:path.resolve(cwd,flag(argv,'--dossier')),
        script,qualite:q || variant?.id || null,label,scriptLabel:variant?.scriptLabel,vitesse:SPEED,gpu:process.env.COULISSES_GPU || null};
    });
  }
}
function emit(stream,text) { if(ownLog!==null) fs.writeSync(ownLog,text); stream.write(text); }
function finish(code,error) {
  if(review) {
    if(!code && (!fin || !fs.existsSync(fin))) {code=1;error='Le script a terminé sans fichier vidéo confirmé par COULISSES FIN.';}
    updateJson(path.join(review,'export.json'),{},s=>s.runId===runId && s.state==='running'
      ? {...s,state:code===130?'stopped':code?'failed':'done',ended:nowIso(),...(code?{error:error || 'Code '+code}:{file:fin})} : s);
  }
  if(error) emit(process.stderr,error+'\n');
  if(ownLog!==null) fs.closeSync(ownLog);
  process.exit(code);
}
if (FAST) console.log(`vitesse : ${speedWords(SPEED)} — l'export à ×1, puis sa copie à cette vitesse (image et son ensemble)${SPEED < 1 ? ', les images répétées' : ''}`);

let fin = null, child = null;
const take = (out) => {
  let buf = '';
  return (chunk) => {
    buf += String(chunk);
    const lines = buf.split(/\r?\n/); buf = lines.pop();
    for (const l of lines) {
      const t = l.trim();
      let m = /^COULISSES PROGRES\s+(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(t);
      if (m && (FAST || progressLabel)) {
        const phase = progressLabel ? m[2].replace(/^rendu (test|final)\b/i,'rendu '+progressLabel) : m[2];
        emit(out,`COULISSES PROGRES ${FAST ? Math.floor(+m[1].replace(',', '.') * 0.9) : m[1]} ${phase}\n`); continue;
      }
      m = /^COULISSES FIN\s+"?(.+?)"?\s*$/.exec(t);
      if (m) { fin = path.resolve(cwd,m[1]); if (FAST) continue; }
      emit(out,l + '\n');
    }
  };
};
child = spawn(exe, argv, { cwd, windowsHide: true, env: childEnv });
const stdout=take(process.stdout);
child.stdout.setEncoding('utf8'); child.stdout.on('data', stdout); child.stdout.on('end',()=>stdout('\n'));
child.stderr.setEncoding('utf8'); child.stderr.on('data', d=>emit(process.stderr,d));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => { try { child?.kill(); } catch { /* gone */ } finish(130); });
child.on('error', (e) => finish(1,e.message));
child.on('close', async (code) => {
  child = null;
  if (code !== 0) return finish(code ?? 1);
  if (!FAST) return finish(0);
  if (!fin || !fs.existsSync(fin)) return finish(1,'Le script n’a pas confirmé le fichier final (COULISSES FIN).');
  // the videos of this export: its main file, and the others it wrote in the same folder since it started (a 1080p drawn
  // from the 4K…) — one copy per video: a file of the same size as one already taken is that video again (code review
  // 18/10/2026: a final-v1.mp4 kept as final.mp4 too gave a second 4K copy of ≈ 4.3 GB)
  const dir = path.dirname(fin), files = [fin], sizes = new Set([fs.statSync(fin).size]);
  for (const n of fs.readdirSync(dir)) {
    const f = path.join(dir, n);
    if (f === fin || !/\.mp4$/i.test(n) || /\.tmp\.mp4$/i.test(n) || SPED.test(n)) continue;
    try { const st = fs.statSync(f); if (st.mtimeMs >= started - 2000 && !sizes.has(st.size)) { files.push(f); sizes.add(st.size); } } catch { /* gone */ }
  }
  try {
    for (const [k, f] of files.entries()) {
      const out = await speedUp(f, SPEED, { log: (l) => console.log(l), onChild: (c) => { child = c; },
        onProgress: (x) => emit(process.stdout,`COULISSES PROGRES ${Math.floor(90 + 10 * (k + x) / files.length)} vitesse ${speedWords(SPEED)}\n`) });
      console.log(`→ ${out}`);
    }
  } catch (e) { return finish(1,`vitesse ${speedWords(SPEED)} : ${e.message} (l'export à ×1 est là : ${fin})`); }
  fin=spedName(fin,SPEED);
  emit(process.stdout,`COULISSES PROGRES 100 fin\nCOULISSES FIN "${fin}"\n`);
  finish(0);
});

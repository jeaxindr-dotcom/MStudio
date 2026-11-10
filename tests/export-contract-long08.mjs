import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {createCoulisses,readCoulisses} from '../lib/coulisses-file.mjs';
import {exportAvailable,exportOptionsReady,exportState,startExport,downloadableExport} from '../lib/export.mjs';
import {exportEntryCheck,exportContract,exportVariant} from '../lib/export-context.mjs';
const exec=promisify(execFile);
process.env.COULISSES_LANG='fr';
const root=fileURLToPath(new URL('../',import.meta.url)), cache=path.join(root,'.cache','test-export-contract');
fs.mkdirSync(cache,{recursive:true});

test('Un profil hérité distingue durée déclarée, portée connue et durée inconnue',()=>{
  const raw={id:'test',label:'Rendu test (1080p)'};
  assert.deepEqual(exportVariant(raw,false,'fr'),{id:'test',label:'1080p · durée définie par le script',resolution:'1080p',scriptLabel:raw.label});
  assert.match(exportVariant(raw,false,'en').label,/duration set by the script/);
  assert.equal(exportVariant({...raw,label:'Rendu test (1080p, 2 s)'},false,'fr').label,'Rendu test (1080p, 2 s)');
  assert.equal(exportVariant({...raw,scope:'full'},false,'fr').label,'Film complet · 1080p');
  assert.equal(exportVariant({...raw,scope:'excerpt'},true,'fr').scope,'excerpt');
});

test('Entrée dédiée, export direct visible, concurrence interprocessus et fichier final vérifié',{timeout:30000},async t=>{
  const tmp=fs.mkdtempSync(path.join(cache,'run-')), engine=path.join(tmp,'engine'), film=path.join(tmp,'film'), dest=path.join(film,'livrables');
  t.after(()=>{if(path.dirname(tmp)===cache) fs.rmSync(tmp,{recursive:true,force:true,maxRetries:4,retryDelay:250});});
  for(const d of [path.join(engine,'src','long08'),path.join(engine,'scripts'),path.join(engine,'node_modules','remotion'),dest]) fs.mkdirSync(d,{recursive:true});
  for(const file of ['index.ts','coulisses.ts','timeline.ts'])fs.writeFileSync(path.join(engine,'src/long08',file),'export {};');
  fs.writeFileSync(path.join(engine,'package.json'),'{}');
  const script=path.join(engine,'scripts','coulisses-rendu.mjs');
  const fake=`
    import fs from 'node:fs';import path from 'node:path';
    const args=process.argv.slice(2),opt=k=>args[args.indexOf(k)+1];
    if(args.includes('--options')) {console.log(JSON.stringify([{id:'full',label:'1080p',scope:'full'}]));process.exit(0);}
    const dir=opt('--dossier');
    fs.writeFileSync(path.join(dir,'argv.json'),JSON.stringify({entry:opt('--entree'),module:opt('--module'),timeline:opt('--timeline'),composition:opt('--composition'),env:process.env.COULISSES_ENTREE}));
    console.log('COULISSES PROGRES 32 rendu'); console.log('COULISSES IMAGES 6 18');
    await new Promise(r=>setTimeout(r,850)); const out=path.join(dir,'film.mp4');
    fs.writeFileSync(out,'film');process.stdout.write('COULISSES FIN "'+out+'"');
    if(args.includes('--fail-after-fin'))process.exitCode=3;
  `;
  fs.writeFileSync(script,fake);
  const descriptor=createCoulisses({dossier:film,titre:'Long test',projet:engine,composition:'Special',entree:'src/long08/index.ts',module:'src/long08/coulisses.ts',timeline:'src/long08/timeline.ts',exportDossier:'livrables'});
  const c=readCoulisses(descriptor);
  assert.equal(c.errors.length,0,c.errors.join(', '));
  const project={kind:'remotion',REVUE:c.revue,remotion:c.remotion,exportRule:c.export,title:c.title};
  assert.ok(exportAvailable(project).ok);
  const wrapper=path.join(root,'lib','export-run.mjs'), args=[wrapper,'1',engine,process.execPath,script,'--composition','Special','--dossier',dest,'--qualite','full'];
  const job=exec(process.execPath,args,{encoding:'utf8',windowsHide:true});
  let state;
  for(let i=0;i<60;i++){state=exportState(project);if(state?.pct===32)break;await sleep(40);}
  assert.equal(state?.state,'running');assert.deepEqual(state.frames,{done:6,total:18});assert.equal(state.entree,c.remotion.entree);
  await assert.rejects(exec(process.execPath,args,{windowsHide:true}),/déjà en cours/);
  assert.throws(()=>startExport(project),/déjà|already/i);
  await job;
  state=exportState(project);assert.equal(state.state,'done');assert.ok(state.downloadable);
  assert.equal(state.file,path.join(dest,'film.mp4'));
  const declared=JSON.parse(fs.readFileSync(path.join(dest,'argv.json')));
  assert.deepEqual(declared,{entry:c.remotion.entree,module:c.remotion.module,timeline:c.remotion.timeline,composition:'Special',env:c.remotion.entree});
  assert.equal(downloadableExport(project,{state:'done',file:script}),null);
  await assert.rejects(exec(process.execPath,[...args,'--fail-after-fin'],{windowsHide:true}));
  assert.equal(exportState(project).state,'failed');assert.equal(exportState(project).file,null);
  await exportOptionsReady(project); const ui=startExport(project,{qualite:'full'});assert.ok(ui.pid);
  for(let i=0;i<100 && exportState(project).state==='running';i++)await sleep(60);
  const done=exportState(project);assert.equal(done.state,'done');assert.equal(done.runId,ui.runId);assert.equal(done.file,path.join(dest,'film.mp4'));assert.equal(done.label,'Film complet · 1080p');
  assert.equal((fs.readFileSync(path.join(c.revue,'export.log'),'utf8').match(/COULISSES PROGRES 32/g)||[]).length,1);
  fs.writeFileSync(script,"const u=bundle({entryPoint:path.resolve('src/index.ts')});");
  assert.match(exportEntryCheck(c.remotion,script,'fr').error,/en dur/);
  assert.throws(()=>startExport(project),/en dur/);
  fs.writeFileSync(script,'const u=bundle({entryPoint:dynamicResolver()});');
  assert.ok(exportEntryCheck(c.remotion,script,'en').warning);
  const legacy=exportContract(c.remotion,['--composition','Special'],'throw new Error("strict CLI")');
  assert.deepEqual(legacy.argv,['--composition','Special']);assert.equal(legacy.env.COULISSES_TIMELINE,c.remotion.timeline);
});

// Run the production handoff with a fixture desktop worker, and the real native
// validation/installation logic with a simulated Setup. No installed app is opened.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync, spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {cancelScheduledUpdate, installationStatus, scheduleAppUpdate} from '../lib/app-update-install.mjs';

if (process.platform !== 'win32') {console.log('Windows only (sauté)\n0 ok, 0 ko');process.exit(0);}
const root = fileURLToPath(new URL('../', import.meta.url));
const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mstudio-update-test-')), appDir = path.join(dir,'program'), dataDir = path.join(dir,'data');
const updates = path.join(dataDir, 'updates'), marker = path.join(appDir,'mstudio.json'), state = path.join(updates,'install-state.json');
const installerPath = path.join(updates, 'MStudio-Setup-2.3.4-win-x64.exe');
fs.mkdirSync(appDir); fs.mkdirSync(updates, {recursive: true}); fs.writeFileSync(installerPath,'test installer, never started');
fs.writeFileSync(marker, '{"name":"MStudio","version":"1.0.0"}');
const sha256 = createHash('sha256').update(fs.readFileSync(installerPath)).digest('hex');
const request = {installerPath, version:'2.3.4', sha256, appDir, dataDir, projectId:'Paaaa0000', language:'fr'};
let ok = 0;
try {
  const fixture = path.join(root,'tests/fixtures/MStudioUpdateTests.cs'), fake = path.join(appDir,'MStudio.Update.exe');
  const native = path.join(root,'app/MStudio.Update.cs');
  const compile = (main, output, source=native) => execFileSync(compiler,['/nologo','/target:winexe','/platform:x64','/codepage:65001','/r:System.Web.Extensions.dll',
    '/r:System.Windows.Forms.dll','/main:'+main,'/out:'+output,fixture,source],{windowsHide:true});
  compile('HandoffFixture', fake); compile('NativeUpdateTests', path.join(dir,'native-tests.exe'));
  const ticket = 'dc5158e6-9c8f-47d8-8d15-85e8c63da52d', config = path.join(updates, 'request-'+ticket+'.json');
  fs.writeFileSync(config,JSON.stringify({...request,ticket,hubPid:process.pid}));
  execFileSync(path.join(dir,'native-tests.exe'),[config],{windowsHide:true});
  console.log('✓ Contrôle natif de la cible, de son empreinte et de la version obtenue. Annulation, intégrité et absence de rétrogradation.');ok++;
  assert.equal(installationStatus(dataDir),null);
  await assert.rejects(scheduleAppUpdate({...request, installerPath:marker}), /fichier/);
  await assert.rejects(scheduleAppUpdate({...request, projectId:'--file'}), /Projet/);
  console.log('✓ Une demande invalide ne lance aucun assistant.');ok++;
  assert.deepEqual(await scheduleAppUpdate({...request,mode:'defer'}),{status:'scheduled',version:request.version});
  const deferred = JSON.parse(fs.readFileSync(state));
  const persistent = path.join(updates,'request-'+deferred.ticket+'.json');
  assert.equal(deferred.pid,0); assert.equal(JSON.parse(fs.readFileSync(persistent)).mode,'defer');
  assert.equal(fs.existsSync(path.join(updates,'worker')),false);
  cancelScheduledUpdate(dataDir);
  assert.equal(installationStatus(dataDir),null);
  assert.equal(fs.existsSync(persistent),false); assert.equal(fs.existsSync(installerPath),true);
  console.log('✓ Report sans processus ; annulation conservant le téléchargement vérifié.'); ok++;
  assert.deepEqual(await scheduleAppUpdate(request),{status:'installing',version:request.version});
  const received = JSON.parse(fs.readFileSync(state));
  assert.ok(received.pid > 0 && received.pid !== process.pid);
  let worker;
  for (let i=0;i<50 && !worker;i++) {if(fs.existsSync(path.join(updates,'worker'))) worker = fs.readFileSync(path.join(updates,'worker'),'utf8');else await delay(30);}
  assert.ok(worker.startsWith(path.join(updates,'assistant')+path.sep));
  assert.equal(fs.readFileSync(path.join(updates,'shell-visible'),'utf8'),'yes');
  assert.deepEqual(await scheduleAppUpdate(request),installationStatus(dataDir));
  assert.equal(JSON.parse(fs.readFileSync(state)).ticket, received.ticket);
  console.log('✓ Assistant détaché hors du programme, confirmation du démarrage et clics dédupliqués.');ok++;
  fs.writeFileSync(path.join(updates,'finish'),'1');
  for (let i=0;i<80 && installationStatus(dataDir);i++) await delay(50);
  assert.equal(installationStatus(dataDir),null);
  fs.writeFileSync(state,JSON.stringify({status:'installing',pid:0,startedAt:1,version:'2.3.4'}));
  assert.equal(installationStatus(dataDir).status,'error');
  fs.writeFileSync(state,JSON.stringify({status:'error',version:'2.3.4',errorCode:'update-install',error:'annulée'}));
  assert.equal(installationStatus(dataDir).error,'annulée');
  console.log('✓ Fin normale, interruption et erreur conservées entre les ouvertures.');ok++;
  // Run the real native coordination and Windows shell launch against a tiny
  // fixture installer. Use a separate named-object namespace for this run.
  const testSource = path.join(dir,'IsolatedUpdate.cs');
  fs.writeFileSync(testSource,fs.readFileSync(native,'utf8').replaceAll('Local\\MStudio.', 'Local\\MStudio-Test-'+randomUUID()+'.'));
  const binaries = path.join(dir,'binaries'); fs.mkdirSync(binaries);
  for (const [file,main] of [['MStudio.exe','LifecycleFixture'],['MStudio.Update.exe','LifecycleWorker'],['Setup.exe','LifecycleInstaller']])
    compile(main,path.join(binaries,file),testSource);

  for (const scenario of ['defer','install','home']) {
    const mode=scenario==='home'?'defer':scenario, resume=scenario==='home'?'--home':'Pbbbb0002';
    const testRoot=path.join(dir,scenario), program=path.join(testRoot,'program'), data=path.join(testRoot,'data'), cache=path.join(data,'updates');
    fs.mkdirSync(program,{recursive:true}); fs.mkdirSync(cache,{recursive:true});
    const setup=path.join(cache,'MStudio-Setup-2.3.4-win-x64.exe');
    for (const file of ['MStudio.exe','MStudio.Update.exe']) fs.copyFileSync(path.join(binaries,file),path.join(program,file));
    fs.copyFileSync(path.join(binaries,'Setup.exe'),setup);
    fs.writeFileSync(path.join(program,'mstudio.json'),JSON.stringify({name:'MStudio',version:'1.0.0'}));
    const env={...process.env,MSTUDIO_TEST_LIFECYCLE:testRoot};
    const opts={env,windowsHide:true,stdio:'ignore'};
    const run=(...args)=>spawn(path.join(program,'MStudio.exe'),args,opts);
    const exit=async child=>{ if(child.exitCode===null) await once(child,'exit'); assert.equal(child.exitCode,0); };
    const waitFile=async file=>{
      for(let attempt=0;attempt<350;attempt++) { if(fs.existsSync(path.join(testRoot,file))) return; await delay(30); }
      throw new Error('Fixture did not reach '+file+' in '+mode);
    };
    const host=run('--hold');
    try {
      await waitFile('host-ready');
      const req={...request,mode,installerPath:setup,dataDir:data,appDir:program,sha256:createHash('sha256').update(fs.readFileSync(setup)).digest('hex')};
      const hubModule=new URL('../lib/app-update-install.mjs',import.meta.url).href;
      const hubScript='import {scheduleAppUpdate} from '+JSON.stringify(hubModule)+'; await scheduleAppUpdate(JSON.parse(process.env.MSTUDIO_TEST_REQUEST));';
      execFileSync(process.execPath,['--input-type=module','-e',hubScript],{...opts,env:{...env,MSTUDIO_TEST_REQUEST:JSON.stringify(req)},timeout:15000});
      if(mode==='defer') {
        assert.equal(installationStatus(data).status,'scheduled');
        assert.equal(fs.existsSync(path.join(testRoot,'setup-count')),false);
        await exit(run('Paaaa0001')); // An already-open desktop does not consume the scheduled action.
        assert.equal(installationStatus(data).status,'scheduled');
        fs.writeFileSync(path.join(testRoot,'close-host'),'1'); await exit(host);
        await Promise.all([exit(run(resume)),exit(run(resume))]);
      }
      await waitFile('setup-count');
      await Promise.all([exit(run()),exit(run())]); // Including relaunches during Setup.
      assert.equal(fs.readFileSync(path.join(testRoot,'setup-count'),'utf8').trim(),'setup');
      if(mode==='install') assert.equal(fs.readFileSync(path.join(testRoot,'saved.txt'),'utf8').trim(),'2 saved and closed');
      fs.writeFileSync(path.join(testRoot,'allow-setup'),'1');
      const expected=mode==='defer' ? 'Paaaa0001\n'+resume : 'Paaaa0000';
      const opened=path.join(testRoot,'opened.txt');
      for(let i=0;i<350 && !(fs.existsSync(opened) && fs.readFileSync(opened,'utf8').replaceAll('\r','').trim()===expected);i++) await delay(30);
      assert.equal(fs.readFileSync(opened,'utf8').replaceAll('\r','').trim(),expected);
      assert.equal(JSON.parse(fs.readFileSync(path.join(program,'mstudio.json'))).version,'2.3.4');
      assert.equal(installationStatus(data),null);
      console.log(scenario==='home'?'✓ Après une mise à jour différée, --home rouvre la bibliothèque demandée.':mode==='defer'?'✓ Deux lancements après report déclenchent une seule installation ; le projet demandé rouvre.':'✓ Redémarrage immédiat après deux sauvegardes, l’installeur est unique durant les réouvertures.'); ok++;
    } finally {
      fs.writeFileSync(path.join(testRoot,'close-host'),'1');
      fs.writeFileSync(path.join(testRoot,'allow-setup'),'1');
      if(host.exitCode===null) await exit(host);
    }
  }
  console.log(ok+' ok, 0 ko');
} finally {
  if (fs.existsSync(updates)) fs.writeFileSync(path.join(updates,'finish'),'1');
  if (path.dirname(dir) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('mstudio-update-test-')) {
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:200});
  }
}

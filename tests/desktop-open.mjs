import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {resolveOpenTarget,desktopExecutable,openDesktop} from '../lib/desktop-open.mjs';

const studio=fileURLToPath(new URL('../',import.meta.url)), cache=path.join(studio,'.cache','desktop-open');
fs.mkdirSync(cache,{recursive:true});
const temporary=t=>{const root=fs.mkdtempSync(path.join(cache,'test-'));t.after(()=>{assert.equal(path.dirname(root),cache);fs.rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:100});});return root;};
const write=(file,data)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data));};
function nativeFixture(root) {
  const theatre=path.join(root,"Théâtre d'essai 宇宙"), dir=path.join(theatre,'07_Episodes','E19 - Lumière');
  const file=path.join(dir,'Lumière.coulisses'), engine=path.join(theatre,'06_Remotion');
  const data={coulisses:1,moteur:'brambleshire',episode:'E19',titre:'Lumière',remotion:{projet:'../../06_Remotion'},revue:'revue'};
  write(file,data);write(path.join(dir,'Autre composition.coulisses'),{coulisses:1,titre:'Generic',remotion:{projet:'../../06_Remotion'}});
  return{theatre,dir,file,engine,data};
}

test('Résolution des chemins, identifiants et accueil sans lancer de serveur',t=>{
  const root=temporary(t), project=path.join(root,"Projet d'été [1] 宇宙");fs.mkdirSync(project);
  assert.equal(resolveOpenTarget('"'+project+'"'),project);
  assert.equal(resolveOpenTarget(path.basename(project),{cwd:root}),project);
  assert.equal(resolveOpenTarget('e19'),'E19');assert.equal(resolveOpenTarget('pABCDEF12'),'Pabcdef12');
  assert.equal(resolveOpenTarget(undefined,{home:true}),'--home');
  assert.throws(()=>resolveOpenTarget(project,{home:true}));assert.throws(()=>resolveOpenTarget());
  assert.throws(()=>resolveOpenTarget('https://example.com'));
  assert.throws(()=>resolveOpenTarget(path.join(root,'absent')));
});

test('Un théâtre explicite choisit son épisode natif sans confondre la composition générique',t=>{
  const root=temporary(t), f=nativeFixture(root), before=fs.readFileSync(f.file,'utf8');
  assert.equal(resolveOpenTarget('E19',{theatre:f.theatre}),f.file);
  assert.equal(resolveOpenTarget('E19',{episodes:path.dirname(f.dir),remotion:f.engine}),f.file);
  assert.equal(resolveOpenTarget('E19',{episodesDir:path.dirname(f.dir),remotionDir:f.engine}),f.file);
  assert.equal(resolveOpenTarget(f.file,{remotion:f.engine}),f.file);
  assert.throws(()=>resolveOpenTarget('E19',{theatre:f.theatre,remotion:path.join(root,'wrong-engine')}),/--remotion/);
  assert.throws(()=>resolveOpenTarget('E20',{theatre:f.theatre}));
  assert.equal(fs.readFileSync(f.file,'utf8'),before);
  write(path.join(f.dir,'Doublon.coulisses'),f.data);
  assert.throws(()=>resolveOpenTarget('E19',{theatre:f.theatre}),/unique|one native/);
});

test('Recherche de MStudio.exe isolée et override manquant sans repli silencieux',t=>{
  const root=temporary(t), appDir=path.join(root,'app'), local=path.join(root,'local');fs.mkdirSync(appDir);
  const installed=path.join(local,'Programs','MStudio','MStudio.exe');write(installed,{});
  const env={LOCALAPPDATA:local};
  assert.equal(desktopExecutable({appDir,env}),installed);
  const adjacent=path.join(appDir,'MStudio.exe');write(adjacent,{});
  assert.equal(desktopExecutable({appDir,env}),adjacent);
  assert.throws(()=>desktopExecutable({appDir,env:{...env,MSTUDIO_EXE:path.join(root,'missing.exe')}}));
  const picker=path.join(root,'picker','MStudio.exe');write(picker,{});
  assert.equal(desktopExecutable({appDir,env:{...env,MSTUDIO_PICKER_EXE:picker}}),picker);
  assert.equal(desktopExecutable({appDir,env:{...env,MSTUDIO_PICKER_EXE:path.join(root,'Coulisses.exe')}}),adjacent);
});

test('Dispatch natif détaché sans shell, navigateur, lock ni processus serveur',async t=>{
  const root=temporary(t), target=path.join(root,"Film ' 3D");fs.mkdirSync(target);
  const executable=path.join(root,'MStudio.exe');write(executable,{});
  let captured,unref=false;
  const launch=(command,args,options)=>{captured={command,args,options};const child=new EventEmitter();child.pid=123;child.unref=()=>{unref=true;};queueMicrotask(()=>child.emit('spawn'));return child;};
  const opened=await openDesktop(target,{executable,spawn:launch,platform:'win32',env:{TEST:'isolated'}});
  assert.equal(opened.pid,123);assert.equal(captured.command,executable);assert.deepEqual(captured.args,[target]);
  assert.equal(captured.options.shell,false);assert.equal(captured.options.detached,true);assert.equal(captured.options.stdio,'ignore');assert.equal(captured.options.windowsHide,false);assert.equal(unref,true);
  assert.deepEqual(fs.readdirSync(target),[]);
  await assert.rejects(openDesktop(target,{executable,platform:'linux',spawn:()=>assert.fail('No fallback')}));
  await assert.rejects(openDesktop(target,{executable,platform:'win32',spawn:()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('error',new Error('spawn failed')));return child;}}),/spawn failed/);
});

const compiler=process.env.WINDIR&&path.join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
test('CLI open passe les arguments exacts à un exécutable de test sans ouvrir MStudio',{skip:process.platform!=='win32'||!compiler||!fs.existsSync(compiler)},async t=>{
  const root=temporary(t), fixture=nativeFixture(root), executable=path.join(root,'MStudio.exe'), source=path.join(root,'Stub.cs');
  fs.writeFileSync(source,`using System;using System.IO;using System.Text;using System.Web.Script.Serialization;
    class Stub{static void Main(string[] args){File.WriteAllText(Environment.GetEnvironmentVariable("MSTUDIO_TEST_ARGS"),new JavaScriptSerializer().Serialize(args),new UTF8Encoding(false));}}`);
  execFileSync(compiler,['/nologo','/target:winexe','/r:System.Web.Extensions.dll','/out:'+executable,source],{windowsHide:true,stdio:'pipe'});
  const destination=path.join(root,'args.json'), data=path.join(root,'app-data');
  const env={...process.env,MSTUDIO_APP:'1',MSTUDIO_DATA_DIR:data,MSTUDIO_EXE:executable,MSTUDIO_TEST_ARGS:destination,COULISSES_SETTINGS:path.join(root,'settings.json'),COULISSES_LANG:'fr'};
  const run=async args=>{
    fs.rmSync(destination,{force:true});
    const result=spawnSync(process.execPath,[path.join(studio,'studio-cli.mjs'),...args],{cwd:studio,env,encoding:'utf8',windowsHide:true,timeout:15000});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/ouverture demandée/);
    for(let i=0;i<60&&!fs.existsSync(destination);i++)await delay(25);
    return JSON.parse(fs.readFileSync(destination,'utf8'));
  };
  assert.deepEqual(await run(['open',fixture.file]),[fixture.file]);
  assert.deepEqual(await run(['open','e19','--theatre',fixture.theatre,'--remotion',fixture.engine]),[fixture.file]);
  assert.deepEqual(await run(['open','--home']),['--home']);
  fs.rmSync(destination,{force:true});
  for(const args of [['open',fixture.file,'--home'],['open','E19','--theatre'],['open',fixture.file,'--port','1234']]){
    const result=spawnSync(process.execPath,[path.join(studio,'studio-cli.mjs'),...args],{cwd:studio,env,encoding:'utf8',windowsHide:true,timeout:15000});
    assert.equal(result.status,1);assert.equal(fs.existsSync(destination),false);
  }
  assert.equal(fs.existsSync(path.join(data,'projets.json')),false);
  assert.equal(fs.existsSync(path.join(fixture.dir,'revue')),false);
});

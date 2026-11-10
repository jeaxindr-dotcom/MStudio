// Two real local servers with throwaway libraries and a project lock held by a simulated legacy Coulisses.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {freePort} from './where.mjs';

const studio = fileURLToPath(new URL('../', import.meta.url));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'mstudio-side-by-side-'));
const profile = path.join(fixture,'MStudio');
const legacy = path.join(fixture,'Coulisses');
fs.mkdirSync(legacy);
const protectedFiles = ['projets.json','settings.json'];
for (const name of protectedFiles) fs.writeFileSync(path.join(legacy,name),'{"sentinel":true}');
const review = path.join(fixture,'projet','revue');
fs.mkdirSync(review,{recursive:true});
const projectFile = path.join(review,'projet.json');
const projectText = JSON.stringify({studio:'Coulisses',kind:'video',title:'Film',root:'..',video:{file:'film.mp4'}});
fs.writeFileSync(projectFile,projectText);
const history = [];
const other = http.createServer((req,res) => {
  history.push(req.method + ' ' + req.url);
  res.end(JSON.stringify({studio:true,pid:process.pid,notesFile:path.join(review,'notes.json')}));
});
await new Promise(r => other.listen(0,'127.0.0.1',r));
const legacyLock = path.join(review,'studio.lock.json');
const owner = JSON.stringify({pid:process.pid,port:other.address().port,url:'http://127.0.0.1:'+other.address().port+'/'});
fs.writeFileSync(legacyLock,owner);
const env = {...process.env,MSTUDIO_APP:'1',MSTUDIO_DATA_DIR:profile,MSTUDIO_PROJECTS_ROOT:path.join(profile,'projects'),
  MSTUDIO_MEDIAS_ROOT:path.join(profile,'media'),COULISSES_LANG:'fr',LOCALAPPDATA:path.join(fixture,'local'),
  COULISSES_SETTINGS:path.join(legacy,'settings.json'),STUDIO_PROJECTS:path.join(legacy,'projets.json'),
  COULISSES_PROJECTS_ROOT:legacy,COULISSES_MEDIAS:legacy,TEMP:legacy,TMP:legacy};
let hub, url;
try {
  const hubPort = await freePort(4700), studioPort=await freePort(hubPort+1);
  url = 'http://127.0.0.1:'+hubPort;
  hub = spawn(process.execPath,['hub-server.mjs','--port',String(hubPort),'--studio-port',String(studioPort)],
    {cwd:studio,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let log='';hub.stdout.on('data',b=>{log+=b;});hub.stderr.on('data',b=>{log+=b;});
  for(let i=0;i<150&&!log.includes('HUB_READY')&&hub.exitCode===null;i++) await delay(50);
  assert.ok(log.includes('HUB_READY'),log);
  const get=async route=>(await fetch(url+route)).json();
  const post=async(route,body={})=>(await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
  const ping=await get('/api/ping');
  assert.equal(ping.app,'MStudio');assert.equal(ping.pid,hub.pid);assert.equal(ping.dataDir,profile);
  assert.equal((await get('/api/about')).name,'MStudio');
  assert.ok(ping.episodesDir.startsWith(profile+path.sep));
  assert.deepEqual((await get('/api/episodes')).projects,[]);
  const blocked=await post('/api/import',{path:review});
  assert.equal(blocked.ok,false);assert.match(blocked.why,/autre instance/);assert.equal(fs.readFileSync(legacyLock,'utf8'),owner);
  assert.equal(fs.readFileSync(projectFile,'utf8'),projectText);
  assert.deepEqual((await get('/api/episodes')).projects,[]);

  fs.unlinkSync(legacyLock);  // only the simulated owner releases its lock
  const imported=await post('/api/import',{path:review});
  assert.equal(imported.ok,true,JSON.stringify(imported));
  const opened=await post('/api/open?ep='+imported.project.id);
  assert.equal(opened.ok,true,JSON.stringify(opened));
  const child=await (await fetch(opened.url+'api/ping')).json();
  assert.equal(child.app,'MStudio');assert.notEqual(child.pid,process.pid);
  assert.equal(JSON.parse(fs.readFileSync(legacyLock)).pid,child.pid);
  await post('/api/lang',{lang:'en'});
  assert.ok(fs.existsSync(path.join(profile,'settings.json')));
  assert.ok(fs.existsSync(path.join(profile,'projets.json')));
  const cliCheck=execFileSync(process.execPath,['--input-type=module','-e',
    "import {project} from './lib/projects.mjs';import {APP_NAME} from './lib/app-profile.mjs';import {settingsFile} from './lib/i18n.mjs';console.log(JSON.stringify([APP_NAME,settingsFile(),project(process.argv[1]).title]));",review],
    {cwd:studio,env,encoding:'utf8',windowsHide:true});
  assert.deepEqual(JSON.parse(cliCheck),['MStudio',path.join(profile,'settings.json'),'Film']);
  assert.ok(execFileSync(process.execPath,['studio-cli.mjs','status',review],
    {cwd:studio,env,encoding:'utf8',windowsHide:true}).includes(imported.project.id));

  await post('/api/quit');
  for(let i=0;i<160&&hub.exitCode===null;i++)await delay(100);
  assert.equal(hub.exitCode,0);
  assert.deepEqual(history,[]);
  for (const name of protectedFiles) assert.equal(fs.readFileSync(path.join(legacy,name),'utf8'),'{"sentinel":true}');
  assert.equal(other.listening,true);
  assert.deepEqual(fs.readdirSync(legacy).sort(),protectedFiles.sort());
  console.log('4 ok, 0 ko : profils indépendants, verrou Coulisses respecté, studio MStudio propriétaire, arrêt ciblé.');
} finally {
  if (hub && hub.exitCode===null) {
    try {
      const owner = await (await fetch(url+'/api/ping')).json();
      if (owner.pid === hub.pid && owner.dataDir === profile) await fetch(url+'/api/quit',{method:'POST'});
    } catch { /* failed before listening */ }
    for (let i=0;i<100 && hub.exitCode===null;i++) await delay(50);
    if (hub.exitCode===null) hub.kill();
  }
  await new Promise(resolve=>other.close(resolve));
  fs.rmSync(fixture,{recursive:true,force:true,maxRetries:4,retryDelay:250});
}

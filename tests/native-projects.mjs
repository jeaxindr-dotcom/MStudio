// Native episodes imported in an isolated profile: no real project, UI or render.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const script = fileURLToPath(import.meta.url), studio = path.resolve(path.dirname(script), '..');
const mode = process.argv[2];
if (mode === 'read') {
  const {project, folderOf} = await import('../lib/projects.mjs');
  const p = project(process.argv[3]);
  console.log(JSON.stringify({...p, folderName:folderOf(p.id, p.channel)}));
} else if (mode === 'owner') {
  const {processIdentity} = await import('../lib/app-profile.mjs');
  const review = process.argv[3], old = process.argv[4] === 'old';
  let notesFile = path.join(review, 'notes.json');
  const server = http.createServer(async (req, res) => {
    const json = value => {res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value));};
    if (req.url === '/api/ping') return json({studio:true, notesFile, ...processIdentity()});
    if (req.url === '/api/about') return json({folder:studio});
    if (req.url === '/api/app-update/activity') return json({busy:false});
    if (req.url === '/test/mismatch') {notesFile = path.join(review, 'other.json'); return json({ok:true});}
    if (req.url === '/test/restore') {notesFile = path.join(review, 'notes.json'); return json({ok:true});}
    if (req.url === '/api/desktop-hub' && !old) {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); fs.writeFileSync(path.join(review, 'attached.json'), raw);
      return json({ok:true, ...body});
    }
    res.writeHead(404); res.end();
  });
  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    fs.writeFileSync(path.join(review, 'studio.lock.json'), JSON.stringify({...processIdentity(),url}));
    console.log('OWNER_READY ' + url);
  });
} else {
  const cache = path.join(studio, '.cache'); fs.mkdirSync(cache, {recursive:true});
  const fix = fs.mkdtempSync(path.join(cache, 'native-projects-'));
  process.env.MSTUDIO_APP = '1'; process.env.MSTUDIO_DATA_DIR = path.join(fix, 'profile'); process.env.COULISSES_LANG = 'fr';
  const lib = await import('../lib/projects.mjs');
  const {readCoulisses} = await import('../lib/coulisses-file.mjs');
  const {flagsOf} = await import('../lib/episode.mjs');
  const children = [];
  const write = (f, v) => {fs.mkdirSync(path.dirname(f), {recursive:true}); fs.writeFileSync(f, JSON.stringify(v));};
  const fixture = (name, custom = false) => {
    const theatre = path.join(fix, name), episodes = path.join(theatre, custom ? 'Mes épisodes' : '07_Episodes');
    const dir = path.join(episodes, 'E19 - Lumière 宇宙'), review = path.join(dir, 'revue'), file = path.join(dir, 'Lumière.coulisses');
    const engine = path.join(theatre, custom ? 'moteur personnalisé' : '06_Remotion');
    const data = {coulisses:1,moteur:'brambleshire',episode:'E19',titre:name,chaine:'Chaîne été',revue:'revue',format:'16:9',remotion:{projet:path.relative(dir,engine)}};
    write(file, data); write(path.join(review,'notes.json'), {notes:[{id:'preserve',text:'À garder'}]});
    write(path.join(engine,'package.json'), {name:'fixture'}); write(path.join(engine,'src','index.ts'), 'fixture');
    return {theatre,episodes,dir,review,file,engine,data};
  };
  const start = async (args, marker) => {
    const child = spawn(process.execPath, args, {cwd:studio,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    children.push(child); let output = ''; child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
    for (let n = 0; n < 120; n++) {
      const match = output.match(new RegExp(marker + ' (http://[^\\s]+)'));
      if (match) return {child,url:match[1]};
      assert.equal(child.exitCode, null, output); await delay(100);
    }
    throw new Error('No readiness: ' + output);
  };
  const post = async (base, route, body = {}) => {
    const response = await fetch(new URL(route, base), {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    return {status:response.status,body:await response.json()};
  };
  const stop = async child => {if(child.exitCode === null) {child.kill(); for(let i=0; i<50 && child.exitCode === null; i++) await delay(50);}};
  const freePort = () => new Promise((resolve, reject) => {
    const server = http.createServer();server.on('error',reject);
    server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(String(port)));});
  });
  let checks = 0;
  const pass = label => console.log(`ok ${++checks} - ${label}`);
  try {
    const a = fixture('Théâtre A'), b = fixture('Théâtre B', true);
    const before = fs.readFileSync(path.join(a.review,'notes.json'));
    const ca = readCoulisses(a.file); assert.deepEqual(ca.errors, []);
    assert.deepEqual(ca.native, {theatre:a.theatre,episodesDir:a.episodes,remotionDir:a.engine}); assert.equal(ca.remotion, null);
    const ia = lib.importProject(a.file), ib = lib.importProject(b.file);
    assert.match(ia.id,/^P[0-9a-f]{8}$/); assert.notEqual(ia.id,ib.id);
    assert.equal(lib.registry().projects.length,2);
    assert.equal(fs.existsSync(path.join(a.review,'projet.json')),false);
    assert.deepEqual(fs.readFileSync(path.join(a.review,'notes.json')),before);
    pass('deux théâtres E19 gardent leurs identités et leurs données natives');

    const p = lib.project(b.review);
    assert.equal(p.ep,'E19'); assert.equal(p.id,ib.id); assert.equal(p.kind,'brambleshire'); assert.equal(p.project,undefined);
    assert.equal(p.remotion,undefined); assert.equal(p.remotionDir,b.engine); assert.equal(p.EP,b.dir);
    assert.equal(p.summary.channel,'Chaîne été'); assert.equal(p.summary.format,'16:9');
    assert.ok(flagsOf(p).includes('--theatre')); assert.ok(flagsOf(p).includes('--episodes')); assert.ok(flagsOf(p).includes('--remotion'));
    assert.ok(p.target.startsWith('E19 --theatre'));
    pass('le moteur, les commandes agent et les options natives sont conservés');

    lib.setFolder([ib.id],'Films en cours'); assert.equal(lib.importProject(b.review).id,ib.id);
    assert.equal(lib.importProject(b.dir).id,ib.id);
    const read = spawnSync(process.execPath,[script,'read',b.review],{env:process.env,encoding:'utf8',windowsHide:true});
    assert.equal(read.status,0,read.stderr); const restarted=JSON.parse(read.stdout);
    assert.equal(restarted.id,ib.id);assert.equal(restarted.ep,'E19');assert.equal(restarted.folderName,'Films en cours');
    assert.equal(restarted.remotionDir,b.engine);assert.equal(lib.registry().projects.length,2);
    pass('les imports répétés et un nouveau processus gardent identité et dossier');

    const primary = lib.importProject(a.file,{episodesDir:a.episodes});
    assert.equal(primary.id,'E19');assert.equal(primary.episode,true);assert.equal(lib.registry().projects.length,2);
    assert.equal(lib.importProject(a.dir,{episodesDir:a.episodes,remotionDir:a.engine}).id,'E19');
    assert.equal(lib.importProject(b.dir,{episodesDir:b.episodes,remotionDir:a.engine}).id,ib.id);
    assert.equal(lib.importProject(b.file,{episodesDir:b.episodes,remotionDir:b.engine}).id,'E19');
    assert.equal(lib.project(b.review).remotionDir,b.engine);
    const wrong = fixture('Mauvais épisode'); write(wrong.file,{...wrong.data,episode:'E20'});
    assert.throws(()=>lib.importProject(wrong.file),/dossier/i);
    write(wrong.file,{...wrong.data,revue:'../ailleurs'});assert.throws(()=>lib.importProject(wrong.file),/revue/i);
    write(wrong.file,wrong.data);
    write(path.join(wrong.review,'projet.json'),{kind:'video',root:'..'});
    assert.throws(()=>lib.importProject(wrong.file),/autre projet/);
    fs.unlinkSync(path.join(wrong.review,'projet.json'));
    fs.mkdirSync(path.join(wrong.episodes,'E19 - Autre épisode'));
    assert.throws(()=>lib.importProject(wrong.file),/ambigu/);
    pass('les épisodes par défaut restent compatibles et les descripteurs incohérents sont refusés');

    const empty = path.join(fix,'default','07_Episodes');fs.mkdirSync(empty,{recursive:true});
    const hub = await start([path.join(studio,'hub-server.mjs'),'--port',await freePort(),'--episodes',empty,'--lock',path.join(process.env.MSTUDIO_DATA_DIR,'hub.json')],'HUB_READY');
    let list = await (await fetch(new URL('/api/episodes',hub.url))).json();
    assert.equal(list.projects.length,2);const row=list.projects.find(x=>x.id===ib.id);
    assert.equal(row.kind,'brambleshire');assert.equal(row.engine,'remotion');assert.equal(row.thumb,true);assert.equal(row.missing,undefined);
    const imported = await fetch(new URL('/import?path='+encodeURIComponent(b.file),hub.url),{redirect:'manual'});
    assert.equal(imported.status,302);assert.equal(imported.headers.get('location'),'/go/'+ib.id);
    pass('la bibliothèque peut ouvrir les épisodes natifs sans MP4 et proposer leurs vignettes Remotion');

    const owner = await start([script,'owner',a.review],'OWNER_READY');
    const opened = await post(hub.url,'/api/open?ep='+ia.id);
    assert.equal(opened.status,200,JSON.stringify(opened));assert.equal(opened.body.url,owner.url);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(a.review,'attached.json'),'utf8')),{hub:hub.url,projectId:ia.id});
    await delay(200);
    const reopened=await post(hub.url,'/api/open?ep='+ia.id);assert.equal(reopened.body.url,owner.url);
    list=await (await fetch(new URL('/api/episodes',hub.url))).json();assert.equal(list.projects.find(x=>x.id===ia.id).studio.url,owner.url);
    pass('le hub adopte le vrai serveur et le conserve après la fin du processus de relais');

    const oldOwner=await start([script,'owner',b.review,'old'],'OWNER_READY');
    const rejected=await post(hub.url,'/api/open?ep='+ib.id);
    assert.equal(rejected.status,500);assert.match(rejected.body.why,/ancien studio/);assert.equal(oldOwner.child.exitCode,null);
    pass('un ancien serveur sans rattachement affiche une erreur claire et reste intact');

    await post(owner.url,'/test/mismatch');await post(hub.url,'/api/pause?ep='+ia.id);
    assert.equal(owner.child.exitCode,null);
    await post(owner.url,'/test/restore');await post(hub.url,'/api/pause?ep='+ia.id);
    for(let i=0;i<40&&owner.child.exitCode===null;i++)await delay(50);
    assert.notEqual(owner.child.exitCode,null);
    pass('la fermeture vérifie à nouveau le propriétaire et ne tue pas un autre projet');

    await post(hub.url,'/api/quit');await stop(oldOwner.child);
    for(let i=0;i<50&&hub.child.exitCode===null;i++)await delay(50);
    assert.notEqual(hub.child.exitCode,null);
    const hub2=await start([path.join(studio,'hub-server.mjs'),'--port',await freePort(),'--episodes',empty],'HUB_READY');
    list=await (await fetch(new URL('/api/episodes',hub2.url))).json();
    assert.equal(list.projects.find(x=>x.id===ib.id).folder,'Films en cours');assert.equal(list.projects.length,2);
    fs.unlinkSync(b.file);await delay(1450);list=await (await fetch(new URL('/api/episodes',hub2.url))).json();
    const missing=list.projects.find(x=>x.id===ib.id);assert.equal(missing.missing,true);assert.equal(missing.folder,'Films en cours');
    assert.equal(fs.existsSync(b.file),false);assert.equal(fs.existsSync(path.join(b.review,'projet.json')),false);
    pass('redémarrage et fichier manquant conservent le classement sans restaurer le projet');
    await post(hub2.url,'/api/quit');
    console.log(`${checks} ok, 0 ko`);
  } finally {
    for(const child of children)await stop(child);
    assert.equal(path.dirname(fix),cache);fs.rmSync(fix,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
}

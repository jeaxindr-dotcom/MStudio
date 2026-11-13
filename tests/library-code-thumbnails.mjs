import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {libraryCodeThumbnails,librarySources,coverFrames} from '../lib/library-code-thumbnails.mjs';
import {remotionModules,freePort} from './where.mjs';

const studio = fileURLToPath(new URL('../',import.meta.url));
const base = path.join(studio,'.cache','test-library-thumbnails');
fs.mkdirSync(base,{recursive:true});
const temporary = t => { const dir=fs.mkdtempSync(path.join(base,'case-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100}));return dir; };
const write = (file,value) => fs.writeFileSync(file,JSON.stringify(value));

test('La couverture évite les transitions et reste dans les bornes de la composition',()=>{
  const frames=coverFrames({tracks:[{type:'video',clips:[{t0:0,t1:2,label:'Opening'},{t0:2,t1:5,label:'Scène'}]}]},{fps:30,durationInFrames:150});
  assert.equal(frames[0],105);
  assert.deepEqual(coverFrames(null,{fps:30,durationInFrames:1}),[0]);
});

test('Captures dédupliquées, file unique, cache persistant et invalidation de version',async t=>{
  const dir=temporary(t), a={EP:'a',remotionDir:'a'}, b={EP:'b',remotionDir:'b'};
  let version='one',renders=0,active=0,max=0,clock=1;
  const service=libraryCodeThumbnails({dir,now:()=>clock,refreshMs:15000,fingerprint:async()=>version,render:async(_,out)=>{
    renders++;active++;max=Math.max(max,active);await delay(20);fs.writeFileSync(out,'jpeg');active--;
  }});
  const info=service.describe(a);assert.equal(info.thumb,true);assert.equal(renders,0);
  const [one,same]=await Promise.all([service.get(a),service.get(a),service.get(b)]);
  assert.equal(one,same);assert.equal(renders,2);assert.equal(max,1);
  assert.equal(await service.get(a),one);assert.equal(renders,2);
  const restart=libraryCodeThumbnails({dir,fingerprint:async()=>version,render:async()=>assert.fail('Cache perdu')});
  assert.equal(await restart.get(a),one);
  const before=service.describe(a).thumbVersion; version='two';clock=20000;
  service.describe(a);await delay(0);
  assert.notEqual(service.describe(a).thumbVersion,before);
  assert.notEqual(await service.get(a),one);assert.equal(renders,3);
});

test('Une ressource absente ne bloque pas les projets suivants et une réparation est réessayée',async t=>{
  const dir=temporary(t);let version='broken',clock=1;
  const p={EP:'a',remotionDir:'a'},q={EP:'b',remotionDir:'b'};
  const service=libraryCodeThumbnails({dir,now:()=>clock,refreshMs:15000,fingerprint:async()=>version,render:async(p,out)=>{
    if(p.EP==='a'&&version==='broken') throw new Error('Média absent');fs.writeFileSync(out,'ok');
  }});
  await assert.rejects(service.get(p),/Média absent/);
  assert.ok(await service.get(q));
  version='repaired';clock=20000;
  assert.ok(await service.get(p));
  assert.equal(fs.readdirSync(dir).filter(f=>f.includes('.tmp.')).length,0);
});

test('Deux projets partageant un moteur gardent leurs props et leurs couvertures',async t=>{
  const dir=temporary(t), shared={EP:'same',remotionDir:'same'};
  const a={...shared,id:'A',remotion:{composition:'Film',props:{color:'red'}}};
  const b={...shared,id:'B',remotion:{composition:'Film',props:{color:'blue'}}};
  const service=libraryCodeThumbnails({dir,fingerprint:async p=>JSON.stringify(p.remotion.props),render:async(p,out)=>fs.writeFileSync(out,p.remotion.props.color)});
  const [red,blue]=await Promise.all([service.get(a),service.get(b)]);
  assert.notEqual(red,blue);assert.equal(fs.readFileSync(red,'utf8'),'red');assert.equal(fs.readFileSync(blue,'utf8'),'blue');
});

test('La fermeture annule le travail actif et vide la file sans démarrer un autre rendu',async t=>{
  const dir=temporary(t);let started, renders=0;
  const ready=new Promise(resolve=>{started=resolve;});
  const service=libraryCodeThumbnails({dir,fingerprint:async p=>p.EP,render:async(_,__,___,{signal})=>{
    renders++;started();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  }});
  const one=service.get({EP:'a',remotionDir:'a'}),two=service.get({EP:'b',remotionDir:'b'});
  const failures=Promise.all([assert.rejects(one,/ferme/),assert.rejects(two,/ferme/)]);
  await ready;await service.close();await failures;assert.equal(renders,1);
  await assert.rejects(service.get({EP:'c',remotionDir:'c'}),/ferme/);
});

test('Le hub produit un vrai JPEG Remotion sans MP4 et invalide code, props et média',{timeout:130000,skip:!remotionModules()},async t=>{
  const root=temporary(t),engine=path.join(root,'engine'),src=path.join(engine,'src'),review=path.join(root,'film','revue');
  for(const d of [src,review,path.join(engine,'public')])fs.mkdirSync(d,{recursive:true});
  const modules=path.join(engine,'node_modules');fs.symlinkSync(remotionModules(),modules,'junction');
  t.after(()=>{if(fs.existsSync(modules))fs.unlinkSync(modules);});
  write(path.join(engine,'package.json'),{name:'library-thumbnail-test',private:true});
  fs.writeFileSync(path.join(src,'coulisses.tsx'),`import React from 'react';import {AbsoluteFill,useCurrentFrame} from 'remotion';
    export const Film=({color='#ff0000'})=><AbsoluteFill style={{backgroundColor:useCurrentFrame()<36?'black':color}}/>;
    export const timeline=()=>({fps:30,durationInFrames:90,pistes:[{id:'V',nom:'Scènes',type:'video',clips:[{de:0,a:36,label:'Opening'},{de:36,a:90,label:'Scène rouge'}]}]});`);
  fs.writeFileSync(path.join(src,'index.tsx'),`import React from 'react';import {Composition,registerRoot} from 'remotion';import {Film} from './coulisses';registerRoot(()=> <Composition id="Cover" component={Film} width={240} height={360} fps={30} durationInFrames={90}/>);`);
  const descriptor=path.join(root,'film','test.coulisses');
  const remotion={projet:engine,entree:path.join(src,'index.tsx'),module:path.join(src,'coulisses.tsx'),composition:'Cover',props:{color:'#ff0000'}};
  write(descriptor,{coulisses:1,titre:'Code sans MP4',revue:'revue',remotion});
  write(path.join(review,'projet.json'),{kind:'remotion',title:'Code sans MP4',root:'..',coulisses:'../test.coulisses'});
  const registry=path.join(root,'projects.json');write(registry,{projects:[{id:'P11111111',revue:review}]});
  const port=await freePort(4470),url='http://127.0.0.1:'+port;
  const server=spawn(process.execPath,['hub-server.mjs','--port',String(port),'--episodes',path.join(root,'episodes'),'--theatre',root],{
    cwd:studio,windowsHide:true,env:{...process.env,STUDIO_PROJECTS:registry,COULISSES_SETTINGS:path.join(root,'settings.json')},stdio:['ignore','pipe','pipe']});
  let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
  t.after(()=>{if(server.exitCode===null)try{execFileSync('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}});
  for(let i=0;i<100;i++){if(await fetch(url+'/api/ping').then(r=>r.ok).catch(()=>false))break;await delay(100);}
  const catalog=await fetch(url+'/api/episodes').then(r=>r.json()),item=catalog.projects[0];
  assert.equal(item.thumb,true);assert.equal(item.video,null);
  const response=await fetch(url+'/thumb/'+item.id);assert.equal(response.status,200,logs);
  const jpeg=Buffer.from(await response.arrayBuffer());assert.ok(jpeg.length>200);
  const file=path.join(root,'cover.jpg');fs.writeFileSync(file,jpeg);
  const dimensions=execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0',file],{windowsHide:true,encoding:'utf8'}).trim();
  assert.equal(dimensions,'240,360');
  const pixel=execFileSync('ffmpeg',['-v','error','-i',file,'-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{windowsHide:true});
  assert.ok(pixel[0]>180&&pixel[1]<40&&pixel[2]<40,'La couverture doit être la scène rouge, pas l’ouverture noire.');
  assert.deepEqual(Buffer.from(await (await fetch(url+'/thumb/'+item.id)).arrayBuffer()),jpeg);
  const p={remotionDir:engine,EP:path.dirname(review),SNAP:path.join(review,'timeline.json'),remotion};
  const before=await librarySources(p);fs.appendFileSync(remotion.module,'\n// changed code');
  const code=await librarySources(p);assert.notEqual(code,before);
  p.remotion={...remotion,props:{color:'#0000ff'}};const props=await librarySources(p);assert.notEqual(props,code);
  fs.writeFileSync(path.join(engine,'public','asset.svg'),'<svg/>');assert.notEqual(await librarySources(p),props);
  assert.equal(fs.existsSync(path.join(review,'timeline.json')),false,'Aucune écriture dans la revue utilisateur.');
});

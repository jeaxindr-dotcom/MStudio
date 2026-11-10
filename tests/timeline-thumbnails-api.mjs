import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { freePort } from './where.mjs';
import { createTimelineThumbnails } from '../lib/timeline-thumbnails.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = path.join(root, '.cache', 'timeline-thumb-tests');
fs.mkdirSync(scratch, {recursive:true});
const dir = fs.mkdtempSync(path.join(scratch, 'run-'));
const project = path.join(dir, 'project'), revue = path.join(project, 'revue');
const renders = path.join(project, '07-renders');
for (const d of [revue, renders]) fs.mkdirSync(d, {recursive:true});
function ff(args, input) {
  return execFileSync('ffmpeg', ['-hide_banner','-v','error', ...args], {input, windowsHide:true, maxBuffer:2000000});
}
const red = [242, 9, 14], blue = [11, 26, 239], green = [19, 223, 12], gold = [234, 217, 18];
function movie(out, colors) {
  const frames = colors.map(rgb => Buffer.alloc(64 * 36 * 3, Buffer.from(rgb)));
  ff(['-y','-f','rawvideo','-pixel_format','rgb24','-video_size','64x36','-framerate','5','-i','pipe:0',
    '-c:v','libx264','-preset','ultrafast','-g','3','-pix_fmt','yuv420p',out], Buffer.concat(frames));
}
function still(out, rgb) {
  ff(['-y','-f','rawvideo','-pixel_format','rgb24','-video_size','24x64','-i','pipe:0','-frames:v','1',out],
    Buffer.alloc(24 * 64 * 3, Buffer.from(rgb)));
}
function readSheet(jpg, n) {
  const bytes = ff(['-i','pipe:0','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],jpg);
  assert.equal(bytes.length, n*128*72*3);
  return (i, x=64, y=36) => [...bytes.subarray((y * 128*n + i*128 + x)*3, (y * 128*n + i*128 + x)*3+3)];
}
const closeColor = (actual, expected) => assert.ok(actual.every((x,i) => Math.abs(x - expected[i]) <= 12), actual + ' vs ' + expected);
let child, passed = 0;
const pass = msg => { passed++; console.log('✓ ' + msg); };
try {
  const original = path.join(renders, 'master.mp4'), clip = path.join(project,'color.mp4'), portrait = path.join(project,'portrait.png');
  movie(original, [red,green,blue,gold]); movie(clip, [blue,gold,red,green]); still(portrait,green);
  still(path.join(dir,'outside.png'), red);
  fs.symlinkSync(dir,path.join(project,'outside-dir'),'junction');
  fs.writeFileSync(path.join(revue, 'projet.json'), JSON.stringify({studio:'Coulisses',kind:'aitelier',title:'Pellicule',root:'..',video:{auto:'aitelier'},plan:'montage.json'}));
  const clipSpec = filename => ({de:1, a:4, label:'clip', fichier:filename, debut:1});
  fs.writeFileSync(path.join(project,'montage.json'),JSON.stringify({fps:5,durationInFrames:4,pistes:[
    {id:'V1',nom:'Clips',type:'video',clips:[clipSpec('color.mp4'),clipSpec('portrait.png'),clipSpec('../outside.png'),clipSpec('outside-dir/outside.png')]},
    {id:'A1',nom:'Son',type:'audio',clips:[clipSpec('color.mp4')]}]}));
  const port = await freePort(4870), base = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, ['studio-server.mjs','--project',revue,'--no-open','--port',String(port)], {
    cwd:root, windowsHide:true, stdio:['ignore','pipe','pipe'], env:{...process.env,COULISSES_LANG:'fr',COULISSES_SETTINGS:path.join(dir,'settings.json'),COULISSES_MEDIAS:path.join(dir,'media'),COULISSES_HISTORY_DIR:path.join(dir,'history')}
  });
  let log = ''; child.stdout.on('data', d=>log+=d); child.stderr.on('data',d=>log+=d);
  for (let i=0;i<120&&!log.includes('Ouvre : http')&&child.exitCode===null;i++) await sleep(100);
  assert.ok(log.includes(base),log);
  const req = query => fetch(base + '/api/timeline-thumbnails?' + query);
  async function pixels(query,count) {
    const r = await req(query);
    assert.equal(r.status,200, r.ok ? '' : await r.text());
    assert.equal(r.headers.get('content-type'),'image/jpeg');
    return readSheet(Buffer.from(await r.arrayBuffer()),count);
  }
  let px = await pixels('frames=3,0,2,1,0&fps=5',5);
  [gold,red,blue,green,red].forEach((c,i)=>closeColor(px(i),c));
  pass('Le JPEG du rendu contient les images exactes dans l’ordre demandé, y compris les doublons');
  px = await pixels('track=V1&clip=0&frames=1,2,3',3);
  [gold,red,green].forEach((c,i)=>closeColor(px(i),c));
  pass('Le clip vidéo superposé utilise ses propres pixels et son entrée source');
  px = await pixels('track=V1&clip=0&frames=5,6,9,10&fps=25',4);
  [gold,gold,gold,red].forEach((c,i)=>closeColor(px(i),c));
  pass('Un montage à 25 i/s conserve la bonne image source tenue à 5 i/s');
  px = await pixels('track=V1&clip=1&frames=1,2,3',3);
  for (let i=0;i<3;i++) {closeColor(px(i),green); closeColor(px(i,20),[0,0,0]);}
  pass('Le deuxième clip superposé répète l’image fixe en respectant son cadrage portrait');
  for (const [q, status] of [
    ['frames=',400], ['frames=-1',400],['frames=1.5',400],['frames=0,1,2,3,4,5,6,7,8,9,10',400],['frames=0&fps=NaN',400],
    ['track=V1&frames=1',400],['track=V1&clip=0&frames=0',400],['track=V1&clip=0&frames=4',400],
    ['track=V1&clip=2&frames=1',404],['track=V1&clip=3&frames=1',404],['track=absent&clip=0&frames=1',404],['track=A1&clip=0&frames=1',404],
  ]) { const r=await req(q); assert.equal(r.status,status,q + ' ' + await r.text()); }
  pass('Requêtes invalides, limites de clip, piste audio, chemins externes et jonctions sont refusés');
  const service=createTimelineThumbnails(), spec={file:clip,fps:5,frames:[0,1,2]};
  const first=service.sheet(spec); assert.equal(service.sheet(spec),first); const cached=await first;
  assert.equal((await service.sheet(spec)),cached);
  await assert.rejects(service.sheet({...spec,frames:[9999]}),e=>e.status===422);
  assert.equal((await service.sheet(spec)),cached);
  const queued = service.sheet({...spec,frames:[2,3]}); const failure=assert.rejects(queued,e=>e.status===503); await service.interrupt(); await failure;
  assert.ok((await service.sheet({...spec,frames:[2,3]})).length);
  pass('Déduplication, cache, interruption et reprise du décodeur');

  // Suspend a group of seeks until its decoder actually releases the media.
  const decodes = [];
  const controlled = createTimelineThumbnails({decodeFrames: (_file,_fps,frames,signal) => new Promise(resolve => {
    decodes.push({frames,signal,finish:() => resolve(frames.map(() => Buffer.alloc(128*72*3)))});
  })});
  const requestFrames = (frames, controller) => controlled.sheet({...spec,frames}, controller?.signal);
  const aborted = err => err.name === 'AbortError', interrupted = err => err.status === 503;
  const a = new AbortController(), b = new AbortController();
  const gone = assert.rejects(requestFrames([42],a),aborted), remaining = requestFrames([42],b);
  a.abort(); await gone;
  assert.equal(decodes.length,1); assert.equal(decodes[0].signal.aborted,false);
  decodes[0].finish();
  const shared = await remaining;
  assert.equal(await requestFrames([42]),shared); assert.equal(decodes.length,1);
  pass('Deux fenêtres partagent un décodage et la seconde reçoit le JPEG lorsque la première quitte');

  const strip = [0,1,2,3,4,5,6,7], c = new AbortController(), d = new AbortController();
  const left = assert.rejects(requestFrames(strip,c),aborted), last = assert.rejects(requestFrames(strip,d),aborted);
  const old = decodes.at(-1);
  c.abort(); await left; assert.equal(old.signal.aborted,false);
  d.abort(); await last; assert.equal(old.signal.aborted,true);
  assert.deepEqual(old.frames,[0,1,2]);
  const retry = requestFrames(strip);
  assert.equal(decodes.length,2);
  old.finish(); await sleep(0);
  for (const group of [[0,1,2],[3,4,5],[6,7]]) {
    const call = decodes.at(-1); assert.notEqual(call,old);
    assert.deepEqual(call.frames,group); assert.equal(call.signal.aborted,false);
    call.finish(); await sleep(0);
  }
  assert.ok((await retry).length); assert.equal(decodes.length,5);
  pass('Le dernier départ interrompt le groupe actif. Une reprise de la même planche attend sa fermeture et redécode les images abandonnées');

  const busy = assert.rejects(requestFrames([100]),interrupted), decoder = decodes.at(-1);
  const queuedClient = new AbortController();
  const dropped = assert.rejects(requestFrames([101],queuedClient),aborted);
  const pending = Array.from({length:10},(_,i) => assert.rejects(requestFrames([102+i]),interrupted));
  assert.throws(() => requestFrames([112]),e => e.status === 429);
  queuedClient.abort(); await dropped;
  pending.push(assert.rejects(requestFrames([112]),interrupted));
  let released = false;
  const holdDecoders = controlled.interrupt().then(() => { released = true; });
  await Promise.all(pending);
  assert.equal(decoder.signal.aborted,true); assert.equal(released,false);
  decoder.finish(); await Promise.all([holdDecoders,busy]);
  assert.equal(decodes.length,6);
  assert.throws(() => requestFrames([150],queuedClient),aborted);
  assert.equal(decodes.length,6);
  pass('La file bornée libère immédiatement les places abandonnées. Un remplacement attend le dernier décodeur et vide les requêtes en attente');

  const replacement=path.join(project,'change.mp4'); movie(replacement,[green,blue,gold,red]); fs.renameSync(replacement,clip);
  px=await pixels('track=V1&clip=0&frames=1,2,3',3); [blue,gold,red].forEach((c,i)=>closeColor(px(i),c));
  pass('Le remplacement d’une vidéo invalide immédiatement ses tuiles');
  const hold=await fetch(base+'/api/hold',{method:'POST'}); assert.ok(hold.ok);
  assert.equal((await req('frames=0')).status,503);
  fs.renameSync(original,path.join(project,'previous.mp4'));
  await fetch(base+'/api/unhold',{method:'POST'});
  assert.equal((await req('frames=0')).status,404);
  px=await pixels('track=V1&clip=1&frames=2',1); closeColor(px(0),green);
  pass('Un export manquant laisse les sources des calques disponibles et un remplacement libère le MP4');
  console.log(passed + ' ok, 0 ko');
} finally {
  if (child && child.exitCode === null) { const stopped=once(child,'exit'); child.kill(); await stopped; }
  const junction=path.join(project,'outside-dir');
  if (fs.existsSync(junction)) fs.unlinkSync(junction);
  if (path.dirname(dir) === scratch) fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {launch, requireSandbox} from './cdp.mjs';
import {freePort} from './where.mjs';

const studio = fileURLToPath(new URL('../', import.meta.url));
const cache = path.join(studio, '.cache', 'navigation-v2');
fs.mkdirSync(cache, {recursive:true});
const scratch = fs.mkdtempSync(path.join(cache, 'essai-'));
const episodes = path.join(scratch, 'episodes');
const env = {...process.env, STUDIO_PROJECTS:path.join(scratch,'projects.json'), COULISSES_LANG:'fr',
  COULISSES_SETTINGS:path.join(scratch,'settings.json'), COULISSES_MEDIAS:path.join(scratch,'medias')};
const children = [];
let p, ok = 0;
function pass(label) { console.log('✓ ' + label); ok++; }
async function server(script, args, from) {
  const port = await freePort(from);
  const child = spawn(process.execPath, [script, ...args, '--port', String(port)], {cwd:studio, env, windowsHide:true, stdio:'ignore'});
  children.push(child);
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(script + ' exited ' + child.exitCode);
    if (await fetch(base+'/api/ping').then(r=>r.ok).catch(()=>false)) return base;
    await delay(150);
  }
  throw new Error('Server did not start: ' + script);
}
const read = expr => p.eval('return ' + expr);
const click = selector => p.eval('document.querySelector(' + JSON.stringify(selector) + ').click()');
async function query(text) {
  await p.key('k','KeyK',undefined,2);
  await p.until("document.querySelector('#commandPalette').open");
  await p.type(text);
}
try {
  const first = 'E03 - Roseraie', second = 'E04 - Canal';
  for (const name of [first,second]) fs.mkdirSync(path.join(episodes,name,'revue'), {recursive:true});
  const ep = path.join(episodes,first);
  const video = path.join(ep,first+'.mp4');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=s=320x180:r=25:d=4','-c:v','libx264','-pix_fmt','yuv420p',video], {windowsHide:true});
  fs.writeFileSync(path.join(ep,'revue','timeline.json'), JSON.stringify({fps:25, frames:100, sets:[
    {id:'jardin', name:'Rosée', inT:0, outT:2},{id:'canal', name:'Écluse', inT:2, outT:null}], says:[], curtain:[], cutaways:[]}));
  fs.writeFileSync(path.join(ep,'revue','notes.json'),JSON.stringify({notes:[{id:'rose',frame:12,end:null,text:'Éclaircir la rose',status:'open',draft:true,created:'2026-01-01T00:00:00Z'}]}));
  const hub = await server('hub-server.mjs',['--theatre',scratch,'--episodes',episodes],4360);
  const base = await server('studio-server.mjs',['E03','--theatre',scratch,'--episodes',episodes,'--no-open'],4362);
  await requireSandbox(base,scratch);
  p = await launch({port:await freePort(9520)});
  await p.goto(hub);
  await p.until("document.querySelectorAll('#folders .card').length === 2");
  await p.eval("document.querySelector('#projectSearch').focus()"); await p.type('rose');
  assert.deepEqual(await read("Array.from(document.querySelectorAll('#folders .card'),e=>e.dataset.id)"),['E03']);
  await click('.lib-pin'); await click('#favOnly'); await click('#libraryList');
  await p.goto(hub);
  await p.until("document.querySelector('#folders.lib-list .lib-pin[aria-pressed=true]')");
  assert.equal(await read("document.querySelectorAll('#folders .card').length"),1);
  await click('#favOnly'); await click('#openNotesOnly');
  assert.equal(await read("document.querySelector('#folders .card').dataset.id"),'E03');
  pass('Accueil : recherche, projets favoris et vue liste persistante, filtre des notes ouvertes');
  await p.goto(base); await p.until("window.__studio && document.querySelector('#v').readyState >= 2");
  await click('#trackVisibility');
  await p.until("document.querySelectorAll('#trackPicker .track-choices input').length >= 2");
  await click('#trackPicker .track-choices button');
  assert.equal(await read("document.querySelectorAll('#trackPicker .track-choices input:checked').length"),1);
  await click('#trackPicker footer button'); await p.key('Escape','Escape');
  await p.until("!document.querySelector('#trackPicker').open");
  pass('Affichage des pistes : isoler une piste, rétablir toutes les pistes');
  await query('#37'); assert.equal(await read("document.querySelector('#commandList [role=option]').textContent.includes('37')"),true);
  await p.key('Enter','Enter'); await p.until('__studio.state().frame === 37');
  await query('0:02.000'); await p.key('Enter','Enter'); await p.until('__studio.state().frame === 50');
  await query('#100'); assert.equal(await read("document.querySelectorAll('#commandList [role=option]').length"),0);
  await p.key('Escape','Escape'); pass('Palette : image exacte et temps à 25 i/s, hors limites, fermeture au clavier');
  await query('eclaircir'); await p.key('Enter','Enter'); await p.until("__studio.state().tabL === 'queue' && __studio.state().frame === 12");
  pass('Recherche sans accents : ouvre la note sélectionnée et recale le lecteur');
  await query('tiers'); await p.key('Enter','Enter'); assert.equal(await read("document.querySelector('#guideThirds').getAttribute('aria-pressed')"),'true');
  await click('#storyboardButton'); await p.until("document.querySelectorAll('#storyGrid img').length === 2 && [...document.querySelectorAll('#storyGrid img')].every(i=>i.naturalWidth)");
  assert.match(await read("document.querySelector('.story-scene').innerText"),/1 note/);
  await p.eval("document.querySelectorAll('.story-scene')[1].click()"); await p.until("__studio.state().frame === 50 && !document.querySelector('#storyboard').open");
  pass('Storyboard : deux vignettes du MP4, compteur de notes, navigation à la première image de scène');
  await p.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:scratch});
  await query('JPEG'); await p.key('Enter','Enter');
  const jpeg = path.join(scratch,'Roseraie-video-50.jpg');
  for (let i=0;i<60&&!fs.existsSync(jpeg);i++) await delay(100);
  assert.ok(fs.readFileSync(jpeg).subarray(0,2).equals(Buffer.from([255,216])));
  pass('Export de l’image affichée : véritable fichier JPEG téléchargé');
  assert.deepEqual(p.logs.filter(l=>l.startsWith('[exception]')),[]);
  pass('Aucune exception de la page pendant le parcours');
  console.log(ok + ' ok, 0 ko');
} catch (error) {
  console.error(error, p?.logs.slice(-8)); console.log(ok + ' ok, 1 ko'); process.exitCode = 1;
} finally {
  await p?.close();
  for (const child of children.reverse()) if (child.exitCode === null) {
    try {execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});} catch { /* already stopped */ }
  }
  if (path.dirname(scratch) === cache) fs.rmSync(scratch,{recursive:true,force:true,maxRetries:4,retryDelay:250});
}

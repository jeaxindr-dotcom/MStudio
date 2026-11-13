import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {launch} from './cdp.mjs';
import {freePort} from './where.mjs';

const studio = fileURLToPath(new URL('../',import.meta.url)), cache = path.join(studio,'.cache','hub-library');
fs.mkdirSync(cache,{recursive:true});
const root = fs.mkdtempSync(path.join(cache,'library-')), episodes = path.join(root,'episodes');
const write = (file,data) => fs.writeFileSync(file,JSON.stringify(data));
const settings = path.join(root,'settings.json'), registry = path.join(root,'projects.json');
write(settings,{lang:'fr'});
const env = {...process.env,COULISSES_LANG:'',COULISSES_SETTINGS:settings,STUDIO_PROJECTS:registry,COULISSES_MEDIAS:path.join(root,'medias')};
const port = await freePort(4418), base = 'http://127.0.0.1:' + port, ids = {};
let server, page, passed = 0;
const pass = t => {console.log('✓ '+t); passed++;};
function episode(id,title) {
  const dir = path.join(episodes,id+' - '+title), review = path.join(dir,'revue');
  fs.mkdirSync(review,{recursive:true}); return {dir,review};
}
async function stop() {
  if (server && server.exitCode === null) try {execFileSync('taskkill',['/PID',String(server.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});} catch {}
  if (server && server.exitCode === null) await new Promise(resolve=>server.once('exit',resolve));
}
async function start() {
  server = spawn(process.execPath,['hub-server.mjs','--port',String(port),'--episodes',episodes,'--theatre',root,'--studio-port',String(await freePort(4438))],{cwd:studio,env,stdio:'ignore',windowsHide:true});
  for (let i=0; i<100; i++) {if(await fetch(base+'/api/ping').then(r=>r.ok).catch(()=>false)) return; await delay(100);}
  throw new Error('Le hub isolé ne répond pas.');
}
const click = selector => page.eval('document.querySelector('+JSON.stringify(selector)+').click()');
const read = expression => page.eval('return '+expression);
try {
  const e03 = episode('E03','Le jardin');
  write(path.join(e03.review,'timeline.json'),{fps:25, frames:75});
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=s=320x180:r=25:d=3','-c:v','libx264','-pix_fmt','yuv420p',path.join(e03.dir,'E03 - Le jardin.mp4')],{windowsHide:true});
  await start();
  const response = await fetch(base+'/api/episodes'), tag = response.headers.get('etag');
  assert.ok(tag); assert.equal((await response.json()).episodes.length,1);
  const unchanged = await fetch(base+'/api/episodes',{headers:{'if-none-match':tag}});
  assert.equal(unchanged.status,304); assert.equal(await unchanged.text(),'');
  page = await launch({port:await freePort(9572)});
  await page.goto(base);
  await page.until("document.getElementById('featureImage').naturalWidth > 0");
  assert.equal(await read("document.getElementById('featureTitle').textContent"),'Le jardin');
  assert.equal(await read("document.querySelectorAll('#folders .card').length"),1);
  pass('Une bibliothèque à un projet utilise une vraie image du film ; le catalogue inchangé répond 304.');

  for (let i=10; i<130; i++) { const id='E'+i; ids[id]=i<110?'Cinéma':'Musique'; episode(id,'Projet '+i); }
  ids.E03='Cinéma';
  write(registry,{projects:[],folders:ids});
  await page.until("document.getElementById('nproj').textContent === '121'",15000);
  assert.equal(await read("document.querySelectorAll('#folderLinks button').length"),2);
  const firstCount = await read("document.querySelectorAll('#folders .card').length");
  assert.ok(firstCount<100);
  await click('#folders [data-folder="Cinéma"] .loading-more');
  assert.ok(await read("document.querySelectorAll('#folders .card').length")>firstCount);
  await click('#folderLinks [data-folder="Musique"]');
  assert.equal(await read("document.querySelectorAll('#folders .card').length"),20);
  await click('.card[data-id="E110"] .lib-preview');
  assert.equal(await read("document.querySelector('#featureTitle').textContent"),'Projet 110');
  pass('121 projets : affichage progressif, navigation par dossier et sélection d’une autre fiche.');

  await click('#allProjects');
  await page.eval("window.sameCard=document.querySelector('.card[data-id=E10]'); sameCard.querySelector('.lib-pin').focus();");
  write(path.join(e03.review,'notes.json'),{notes:[{id:'n1',text:'Raccourcir',status:'open',created:'2026-01-01T10:00:00Z'}]});
  await page.until("document.querySelector('#openNotesOnly .nav-count').textContent === '1'",15000);
  assert.ok(await read("window.sameCard === document.querySelector('.card[data-id=E10]') && document.activeElement === sameCard.querySelector('.lib-pin')"));
  await click('#openNotesOnly'); assert.equal(await read("document.querySelector('#folders .card').dataset.id"),'E03');
  await click('#allProjects'); await page.key('k','KeyK',undefined,2); await page.type('projet 129');
  assert.equal(await read("document.querySelector('#folders .card').dataset.id"),'E129');
  pass('L’actualisation des notes garde la carte et le focus clavier, les filtres restent combinables.');

  const videoDir=path.join(root,'imports'); fs.mkdirSync(videoDir);
  const imported=path.join(videoDir,'ZZZ Montage.mp4');
  fs.copyFileSync(path.join(e03.dir,'E03 - Le jardin.mp4'),imported);
  await click('#folderLinks [data-folder="Musique"]'); await click('#favOnly'); await click('#impPaste');
  const importPath=async () => page.eval("document.querySelector('#impPath').value="+JSON.stringify(imported)+";document.querySelector('#impGo').click()");
  await importPath();
  await page.until("document.querySelector('#featureTitle').textContent === 'ZZZ Montage' && document.activeElement.id === 'featureOpen'");
  assert.equal(await read("document.querySelector('#folders .card .title').textContent"),'ZZZ Montage');
  const importedId=await read("document.querySelector('#folders .card').dataset.id");
  const moved=await fetch(base+'/api/folder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[importedId],folder:'Cinéma'})});
  assert.ok((await moved.json()).ok);
  await click('#allProjects'); await page.goto(base);
  await page.until("document.querySelector('#folders [data-folder=\"Cinéma\"] .loading-more:not([hidden])')");
  assert.equal(await read("document.querySelector('.card[data-id="+importedId+"]')"),null);
  await importPath(); await page.until("document.activeElement.id==='featureOpen' && document.querySelector('.card[data-id="+importedId+"]')");
  pass('Un import rejoint sa fiche et sa carte malgré dossier, favoris, recherche ou pagination.');

  await page.size(390,844);
  assert.ok(await read('document.documentElement.scrollWidth<=innerWidth+1'));
  assert.ok(await read("document.querySelector('.feature-info').getBoundingClientRect().width >= 150 && document.querySelector('.feature-art').getBoundingClientRect().width >= 130"));
  await click('#libraryNavToggle'); assert.ok(await read("document.querySelector('#impFolder').getClientRects().length>0"));
  await click('#impPaste'); assert.equal(await read('document.activeElement.id'),'impPath');
  await click('#allProjects'); await click('#libraryNavToggle');
  await click('#newBtn'); await page.until("document.querySelector('.mb-dlg #npName')");
  await page.key('Escape','Escape');
  assert.ok(await read('document.documentElement.scrollWidth<=innerWidth+1'));
  pass('À 390 px les dossiers et l’import au clavier sont utilisables, le formulaire de création s’ouvre.');

  await click('#langs [data-l=en]');
  await page.until("document.documentElement.lang === 'en' && document.querySelector('#featureImage').naturalWidth>0");
  assert.equal(await read("document.querySelector('.library-heading h1').textContent"),'Library');
  assert.equal(await read("document.getElementById('libraryNavToggle').textContent"),'Browse');
  assert.deepEqual(page.logs.filter(l=>l.startsWith('[exception]')),[]);
  pass('Le changement de langue recharge la bibliothèque en anglais.');

  // A source can disappear between two launches (offline drive, moved files).
  // Its saved title/channel and the user's folder still belong to its library row.
  await page.size(1280,900);
  await click('#langs [data-l=fr]');
  await page.until("document.documentElement.lang === 'fr'");
  const source=path.join(videoDir,'memoire.coulisses');
  write(source,{coulisses:1,moteur:'video',titre:'Un titre mémorisé',chaine:'Chaîne mémoire',revue:'revue-memoire',export:{dossier:'.'}});
  const registration=await fetch(base+'/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:source})}).then(r=>r.json());
  assert.equal(registration.ok,true);
  const remembered=registration.project, folder='Travaux conservés';
  assert.equal((await fetch(base+'/api/folder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[remembered.id],folder})}).then(r=>r.json())).ok,true);
  await page.until("document.querySelector('#folderLinks [data-folder=\"Travaux conservés\"]')",15000);
  await click('#folderLinks [data-folder="Travaux conservés"]');
  const cardSelector='.card[data-id="'+remembered.id+'"]';
  await page.until("document.querySelector("+JSON.stringify(cardSelector)+")?.querySelector('.open').disabled === false");
  fs.unlinkSync(source);
  fs.unlinkSync(path.join(remembered.revue,'projet.json'));
  const missingInPage="document.querySelector("+JSON.stringify(cardSelector)+")?.querySelector('.open').disabled === true";
  await page.until(missingInPage,15000);
  const assertRememberedMissing=async()=>{
    await page.until(missingInPage,15000);
    assert.match(await read("document.querySelector("+JSON.stringify(cardSelector)+").querySelector('.thumb .id').textContent"),/introuvable/i);
    assert.equal(await read("document.querySelector("+JSON.stringify(cardSelector)+").querySelector('.title').textContent"),'Un titre mémorisé');
    assert.equal(await read("document.querySelector("+JSON.stringify(cardSelector)+").closest('[data-folder]').dataset.folder"),folder);
    assert.equal(await read("document.querySelector('#featureTitle').textContent"),'Un titre mémorisé');
    assert.equal(await read("document.querySelector('#featureOpen').disabled"),true);
    assert.match(await read("document.querySelector('#featureMeta').textContent"),/Chaîne mémoire/);
    const catalog=await fetch(base+'/api/episodes').then(r=>r.json());
    const row=catalog.projects.find(p=>p.id===remembered.id);
    assert.equal(row.missing,true); assert.ok(!row.archived);
    assert.equal(row.title,'Un titre mémorisé'); assert.equal(row.channel,'Chaîne mémoire'); assert.equal(row.folder,folder);
  };
  await page.goto(base);
  await assertRememberedMissing();
  pass('Une source devenue introuvable conserve titre, chaîne et dossier après rechargement, avec ouverture désactivée.');
  await page.goto('about:blank');
  await stop(); await start();
  await page.goto(base);
  await assertRememberedMissing();
  assert.deepEqual(page.logs.filter(l=>l.startsWith('[exception]')),[]);
  pass('Après arrêt et redémarrage du hub, le projet reste classé avec son identité et son état introuvable.');
  console.log(passed+' ok, 0 ko');
} catch(error) {
  console.error(error, page?.logs.filter(l=>l.startsWith('[exception]')).slice(-4)); console.log(passed+' ok, 1 ko'); process.exitCode=1;
} finally {
  await page?.close(); await stop();
  if(path.dirname(root)===cache) fs.rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:250});
}

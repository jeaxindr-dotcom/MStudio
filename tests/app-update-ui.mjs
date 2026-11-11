// Browser exercise of the two shipped toolbar buttons against a local, simulated update service.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {launch} from './cdp.mjs';
import {freePort} from './where.mjs';
import {renderPage} from '../lib/i18n.mjs';
import {projectUpdateDrafts} from '../lib/app-update-drafts.mjs';
import {updateRequestStatus} from '../lib/app-update-api.mjs';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const routes = {'/app-update-ui.js':read('page/app-update-ui.js'), '/app-update.css':read('page/app-update.css')};
const notes = read('page/studio/02-notes.js');
const draftHooks = notes.slice(notes.indexOf('  const draftKey ='), notes.indexOf('  // a reload asked by'));
let state = {status:'idle', currentVersion:'1.0.0', latestVersion:null, totalBytes:0, downloadedBytes:0};
let installed = 0, checked = 0, downloaded = 0, scheduled = 0, canceled = 0, refused = true, available = true;
function projectServer(drafts) { return http.createServer(async (req,res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (body, status=200) => {res.writeHead(status,{'content-type':'application/json'}); res.end(JSON.stringify(body));};
  if (url.pathname === '/api/app-update-draft') {
    const read = req.method === 'GET', code = updateRequestStatus(req, read ? 'state' : 'write');
    if (code !== 200) return json({},code);
    if (read) return json(drafts.read());
    let body=''; for await (const chunk of req) body += chunk;
    try { return json(drafts.change(JSON.parse(body))); } catch (error) { return json({},error.status || 500); }
  }
  if (url.pathname.startsWith('/api/app-update')) {
    if (!available) return json({},404);
    const op = url.pathname.split('/')[3];
    if (op) {
      let body=''; for await (const chunk of req) body += chunk;
      if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json' || body !== '{}') return json({error:'Bad action'},400);
      if (op === 'check') {checked++; state = {...state,latestVersion:'1.1.0',status:'available'};}
      if (op === 'download') {downloaded++; state = {...state,totalBytes:4000000,downloadedBytes:1000000,status:'downloading'};}
      if (op === 'defer') {scheduled++; state.status='scheduled';}
      if (op === 'cancel') {canceled++; state.status='ready';}
      if (op === 'install') {if (refused) return json({error:'Rendering'},409); installed++; state.status='installing';}
    }
    return json(state);
  }
  if (routes[url.pathname]) {
    res.writeHead(200,{'content-type':url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css'}); return res.end(routes[url.pathname]);
  }
  const studio = url.pathname === '/studio', template = read(studio ? 'studio.html' : 'hub.html');
  const button = template.match(/<button type="button" id="appUpdateButton".*?<\/button>/)[0];
  const script = template.match(/<script src="\/app-update-ui\.js"><\/script>/)[0];
  const lang = url.searchParams.get('lang') || 'fr';
  const draftFixture = `<textarea id="agentText"></textarea><textarea id="qwords"></textarea><div id="pop" hidden>Annotation</div><span id="save"></span><script>
    let dirty=true,saving=false,META={notesFile:'test-project',hasUpdateDraft:${drafts.exists()}},pending={},canSave=false;
    const $=s=>document.querySelector(s), byId=()=>true, flushNow=async()=>canSave, setSave=text=>$('#save').textContent=text;
    window.allowSaving = () => {canSave=true}; ${draftHooks};
    window.draftsRestored = false; restoreDrafts().then(()=>window.draftsRestored=true);
  </script>`;
  const product = url.searchParams.get('other') ? 'Coulisses' : 'MStudio';
  const html = `<html lang="fr"><head><!--I18N--><link rel="stylesheet" href="/app-update.css"></head><body data-product="${product}">${button}${studio ? draftFixture : ''}${script}</body></html>`;
  res.writeHead(200,{'content-type':'text/html;charset=utf-8'}); res.end(renderPage(html, {prefixes:['common.','menu.','st.save.'],l:lang}));
}); }
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(),'mstudio-update-draft-test-'));
const notesFile = path.join(dataDir,'project-A','notes.json');
const before = projectUpdateDrafts(dataDir, notesFile, '1.0.0'), after = projectUpdateDrafts(dataDir, notesFile, '1.1.0');
const other = projectUpdateDrafts(dataDir, path.join(dataDir,'project-B','notes.json'), '1.1.0');
const servers = [before,after,other].map(projectServer);
const [base, reopened, separate] = await Promise.all(servers.map(async server => {
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  return 'http://127.0.0.1:' + server.address().port;
}));
let page;
try {
  page = await launch({port:await freePort(9660)});
  const click = async id => {
    await page.until(`!document.getElementById('${id}').hidden && !document.getElementById('${id}').disabled`);
    await page.eval(`document.getElementById('${id}').click()`);
  };
  const readUI = expr => page.eval('return ' + expr);
  const match = (id, value) => page.until(`document.getElementById('${id}').textContent.includes(${JSON.stringify(value)})`);
  await page.goto(base+'/hub');
  await page.until("!appUpdateButton.hidden"); assert.equal(checked,0);
  await click('appUpdateButton'); await match('appUpdateAction','Télécharger');
  assert.equal(checked,1); assert.equal(downloaded,0);
  await click('appUpdateAction'); await page.until("!appUpdateProgress.hidden && appUpdateProgress.querySelector('progress').value===25");
  assert.equal(downloaded,1);
  await click('appUpdateClose'); state.status = 'ready';
  await click('appUpdateButton'); await match('appUpdateAction','Redémarrer pour installer maintenant');
  await page.size(320,640);
  const readyButtons = await readUI(`[...appUpdateDialog.querySelectorAll('button')].filter(b=>!b.hidden).map(b=>{
    const r=b.getBoundingClientRect(), box=appUpdateDialog.getBoundingClientRect();
    return {label:b.textContent, inside:r.width>0 && r.left>=box.left && r.right<=box.right && r.bottom<=box.bottom};
  })`);
  assert.deepEqual(readyButtons.map(b=>b.label),['Annuler','Installer à la prochaine ouverture','Redémarrer pour installer maintenant']);
  assert.ok(readyButtons.every(b=>b.inside)); await page.size(1600,1000);
  await click('appUpdateClose'); assert.equal(await readUI('appUpdateDialog.open'),false);
  assert.equal(installed,0); assert.equal(scheduled,0); assert.equal(canceled,0);
  await click('appUpdateButton'); await click('appUpdateLater'); await match('appUpdateStatus','à la prochaine ouverture');
  assert.equal(installed,0); assert.equal(scheduled,1);
  await click('appUpdateClose');
  await click('appUpdateButton'); await match('appUpdateLater','Annuler la programmation');
  await click('appUpdateLater'); await page.until('!appUpdateDialog.open');
  assert.equal(canceled,1); assert.equal(downloaded,1); assert.equal(state.status,'ready');
  console.log('✓ Vérification à la demande, téléchargement avec progression et réouverture à la version prête.');
  console.log('✓ Trois actions accessibles sur écran étroit. Reporter puis annuler conserve le fichier et la fenêtre du logiciel.');

  await page.goto(base+'/studio?lang=en');
  await page.until("!appUpdateButton.hidden"); await click('appUpdateButton');
  await match('appUpdateAction','Restart and install now');
  await match('appUpdateLater','Install next time MStudio opens'); await match('appUpdateClose','Cancel');
  await click('appUpdateAction'); await page.until("appUpdateError.textContent.length>0");
  assert.equal(installed,0);
  await page.eval("allowSaving(); agentText.value='A draft'; qwords.value='My notes'");
  await click('appUpdateAction'); await match('appUpdateError','Rendering');
  assert.equal(installed,0); assert.equal(before.exists(),false);
  await page.eval("document.getElementById('pop').hidden=false");
  await click('appUpdateLater'); await match('appUpdateStatus','the next time you open MStudio');
  assert.equal(scheduled,2); assert.equal(installed,0);
  const draftId = before.read().id;
  await click('appUpdateAction'); await match('appUpdateError','Choose Add or Cancel');
  assert.equal(state.status,'scheduled'); assert.equal(await readUI('document.getElementById("pop").hidden'),false);
  assert.match(await readUI('document.getElementById("save").textContent'),/Choose Add or Cancel/);
  await page.eval("document.getElementById('pop').hidden=true");
  await click('appUpdateAction'); await match('appUpdateError','Rendering');
  assert.equal(before.read().id,draftId); assert.equal(state.status,'scheduled'); refused=false;
  await click('appUpdateAction'); await match('appUpdateStatus','MStudio is restarting');
  assert.equal(installed,1);
  assert.equal(before.read().draft.agent,'A draft'); assert.equal(before.read().id,draftId);
  await page.eval("await Promise.all([window.MStudioBeforeUpdate(),window.MStudioBeforeUpdate()])");
  assert.equal(before.read().id,draftId);
  await page.eval("agentText.value='Changed after scheduling'; pending.n1={text:'Reply',images:[{file:'image.png',at:'now'}]}");
  await page.goto(separate+'/studio'); await page.until('window.draftsRestored');
  assert.equal(await readUI('agentText.value'),''); assert.equal(other.exists(),false);
  assert.notEqual(base,reopened);
  await page.goto(reopened+'/studio?lang=en'); await page.until('window.draftsRestored');
  assert.equal(await readUI('agentText.value'),'Changed after scheduling'); assert.equal(await readUI('qwords.value'),'My notes');
  assert.equal(await readUI('pending.n1.images[0].file'),'image.png'); assert.equal(after.exists(),false);
  console.log('✓ Le projet rouvre sur un autre port avec sa demande, ses notes et sa réponse. Les autres projets restent indépendants.');
  console.log('✓ Une annotation ouverte reste éditable lors du report et bénéficie d’un message avant tout redémarrage.');

  const saved = other.change({action:'begin', draft:null});
  const finalDraft = {agent:'Newest',words:'',pending:{}};
  assert.equal(other.change({...saved,action:'save',seq:2,draft:finalDraft}).applied,true);
  assert.equal(other.change({...saved,action:'save',seq:1,draft:null}).applied,false);
  assert.equal(other.change({...saved,action:'clear'}).applied,false);
  assert.deepEqual(other.read().draft,finalDraft);
  assert.equal(other.change({...saved,action:'clear',seq:2}).applied,true);
  console.log('✓ Une requête de fermeture en retard ne peut pas écraser un brouillon plus récent.');

  available=false; await page.goto(base+'/hub'); assert.equal(await readUI('appUpdateButton.hidden'),true);
  available=true; await page.goto(base+'/hub?other=1'); assert.equal(await readUI('appUpdateButton.hidden'),true);
  console.log('✓ Aucune entrée dans Coulisses ni sur un serveur sans mise à jour de bureau.');
  console.log('6 ok, 0 ko');
} finally {
  await page?.close();
  for (const server of servers) { server.close(); server.closeAllConnections(); }
  if (path.dirname(dataDir) === path.resolve(os.tmpdir())) fs.rmSync(dataDir,{recursive:true,force:true});
}

// Exercise the shipped navigation and update UI when a library joins an
// already-open standalone project. No user profile, project or desktop window.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {once} from 'node:events';
import {launch} from './cdp.mjs';
import {freePort} from './where.mjs';
import {renderPage} from '../lib/i18n.mjs';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url),'utf8');
const menus = read('page/studio/09-keys-menus.js');
const navigation = menus.slice(menus.indexOf('  function syncHubNavigation('),menus.indexOf('  function leave('));
const template = read('studio.html');
const button = template.match(/<button type="button" id="appUpdateButton".*?<\/button>/)[0];
let available = false, requests = 0;
const server = http.createServer((req,res) => {
  const reply = (body,type='text/html',status=200) => {res.writeHead(status,{'content-type':type+';charset=utf-8'});res.end(body);};
  if(req.url.startsWith('/api/app-update')) {
    requests++;
    return reply(JSON.stringify(available ? {status:'idle',currentVersion:'test'} : {}),'application/json',available ? 200 : 404);
  }
  if(req.url==='/app-update-ui.js') return reply(read('page/app-update-ui.js'),'text/javascript');
  if(req.url.startsWith('/library')) return reply('<p>Library fixture</p>');
  reply(renderPage(`<html lang="fr"><head><!--I18N--></head><body data-product="MStudio">
    <a id="logo"></a><a id="crumb"></a><button id="bHome"><span class="why"></span></button>
    <button id="reverseOpenEdit"></button><textarea id="draft">Ma note non envoyée</textarea>${button}
    <script>const $=s=>document.querySelector(s); let META={hub:null,reverse:true};
      let paused=0,flushed=0; const M={pause:()=>paused++},SP=null,flushNow=async()=>{flushed++;};
      ${navigation}
      syncHubNavigation(null);
      window.attach=(hub,updates)=>syncHubNavigation(hub,updates);
      window.openHome=()=>toHub();
      window.check=()=>({hub:META.hub,paused,flushed});
    </script><script src="/app-update-ui.js"></script></body></html>`,{prefixes:['common.','menu.','st.start.'],l:'fr'}));
});
server.listen(0,'127.0.0.1'); await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port;
let page;
try {
  page=await launch({port:await freePort(9800)});
  const value=expr=>page.eval('return '+expr);
  await page.goto(base);
  await page.until("document.body.classList.contains('nohub') && appUpdateButton.hidden");
  assert.equal(await value("bHome.classList.contains('off')"),true);
  assert.equal(await value('reverseOpenEdit.hidden'),true);
  await page.eval(`attach(${JSON.stringify(base+'/library')},false)`);
  assert.equal(await value("document.body.classList.contains('nohub')"),false);
  assert.equal(await value("bHome.classList.contains('off')"),false);
  assert.equal(await value('logo.href'),base+'/library');
  assert.equal(await value('reverseOpenEdit.hidden'),false);
  available=true;
  await page.eval(`attach(${JSON.stringify(base+'/library')},true)`);
  await page.until('!appUpdateButton.hidden');
  await page.eval('openHome()');
  await page.until("document.querySelector('#hubOv.on')");
  assert.equal(await value("document.querySelector('#hubOv').src"),base+'/library');
  assert.deepEqual(await value('check()'),{hub:base+'/library',paused:1,flushed:1});
  assert.equal(await value('draft.value'),'Ma note non envoyée');
  console.log('✓ Un projet ouvert retrouve Accueil et Mise à jour quand sa bibliothèque arrive, sans perdre le brouillon.');

  const count=requests;
  await page.eval(`attach(${JSON.stringify(base+'/library')})`);
  assert.equal(requests,count,'unchanged polling must not probe again');
  await page.eval(`attach(${JSON.stringify(base+'/library?second=1')}); openHome()`);
  assert.equal(await value("document.querySelector('#hubOv').src"),base+'/library?second=1');
  console.log('✓ Un changement de bibliothèque invalide seulement son ancienne iframe.');

  available=false; await page.eval('attach(null)');
  await page.until('appUpdateButton.hidden');
  assert.equal(await value("document.querySelector('#hubOv')"),null);
  assert.equal(await value("logo.hasAttribute('href')"),false);
  assert.equal(await value("bHome.classList.contains('off')"),true);
  assert.deepEqual(page.logs.filter(line=>line.startsWith('[exception]')),[]);
  console.log('✓ Une bibliothèque arrêtée est signalée, sans lien périmé ni erreur JavaScript.');
  console.log('3 ok, 0 ko');
} catch(error) {console.error(error,page?.logs);console.log('0 ok, 1 ko');process.exitCode=1;}
finally {await page?.close();await new Promise(resolve=>server.close(resolve));}

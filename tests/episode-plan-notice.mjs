// The real monitor markup/styles keep the viewer still when a plan notice opens.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {once} from 'node:events';
import {launch} from './cdp.mjs';
import {freePort} from './where.mjs';
import {renderPage} from '../lib/i18n.mjs';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const html = read('studio.html');
const toolbar = html.slice(html.indexOf('<section id="viewer"'), html.indexOf('<div id="warn">'));
const css = read('page/studio.css') + read('page/studio-tools.css');
const helper = read('page/studio/10-plan-context.js');
const server = http.createServer((req, res) => {
  const lang = req.url === '/en' ? 'en' : 'fr';
  res.writeHead(200, {'content-type': 'text/html;charset=utf-8'});
  res.end(renderPage(`<!doctype html><html lang="fr"><head><style>${css}
    body{display:block} #viewer{height:440px} #stage{width:75%;height:75%}</style></head><body>
    ${toolbar}<div id="warn"></div><div id="stagewrap"><div id="stage"></div></div></section><script>
    const $=s=>document.querySelector(s), FR=document.documentElement.lang==='fr';
    let META={render:{size:10},features:{code:true},snapshotMatches:false}, SNAP=null, LIVE=null, PROJ=false;
    let mode='code', codeVer=1, liveVer=-1, STATUS={code:{status:'ready',version:1},timeline:{status:'building',version:0},plans:{}};
    async function loadLive(){} async function loadCode(){} function onStatus(){} async function setMode(m){mode=m;}
    ${helper}
    window.sample=async state=>{
      LIVE=state==='ready'?{sets:[],says:[]}:null; liveVer=1;
      STATUS.timeline={status:state==='loading'?'building':state==='ready'?'ready':'error',version:1};
      await loadLive();
    };
    window.geometry=()=>['#viewer','#viewbar','#stagewrap','#stage'].map(s=>$(s).getBoundingClientRect().toJSON());
    $('.dock-heading').textContent=FR?'Moniteur':'Monitor';
    $('#codeStatus').textContent='Code v12 · 12:42';
    document.querySelectorAll('i[data-ic]').forEach(i=>i.outerHTML='<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"></svg>');
    $('#playbackResolutionControl').hidden=false;
    </script></body></html>`, {l:lang}));
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
let page, checks = 0;
try {
  page = await launch({port: await freePort(9700)});
  for (const lang of ['fr', 'en']) {
    await page.goto('http://127.0.0.1:' + server.address().port + '/' + lang);
    for (const width of [1100, 660, 570, 400, 320]) {
      await page.eval(`$('#viewer').style.width=${width}+'px'; await sample('ready');`);
      const normal = await page.eval('return geometry()');
      await page.eval("await sample('loading')");
      assert.equal(await page.eval('return episodePlanNotice.hidden'), true);
      await page.eval("await sample('error')");
      assert.deepEqual(await page.eval('return geometry()'), normal);
      assert.equal(await page.eval('return episodePlanNotice.hidden'), false);
      const label = await page.eval('return episodePlanHeading.textContent');
      assert.equal(label, lang === 'fr' ? 'Plan indisponible' : 'Plan unavailable');
      await page.eval('episodePlanSummary.click(); episodePlanSummary.focus()');
      assert.deepEqual(await page.eval('return geometry()'), normal);
      const popup = await page.eval("return episodePlanNotice.querySelector('.readiness-detail').getBoundingClientRect().toJSON()");
      assert.ok(popup.left >= 0 && popup.right <= width + 1, JSON.stringify({width, popup}));
      await page.key('Escape', 'Escape');
      assert.equal(await page.eval('return !episodePlanNotice.open && document.activeElement===episodePlanSummary'), true);
      await page.eval("$('#previewReadiness').hidden=false; $('#previewReadiness summary span').textContent='Image non confirmée';");
      assert.deepEqual(await page.eval('return geometry()'), normal);
      await page.eval("$('#previewReadiness').hidden=true; await sample('ready')");
      assert.deepEqual(await page.eval('return geometry()'), normal);
      assert.equal(await page.eval("return episodePlanNotice.hidden && $('#warn').textContent===''"), true);
      checks++;
    }
  }
  assert.equal(page.logs.filter(line => line.includes('[exception]')).length, 0, page.logs.join('\n'));
  console.log(checks + ' ok, 0 ko');
} finally {
  await page?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

// Run the shipped monitor bar and its notification on synthetic readiness samples.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {once} from 'node:events';
import {launch} from './cdp.mjs';
import {freePort} from './where.mjs';
import {renderPage} from '../lib/i18n.mjs';

const read = file => fs.readFileSync(new URL('../'+file, import.meta.url), 'utf8');
const html = read('studio.html'), preview = read('page/studio/01-preview.js');
const toolbar = html.slice(html.indexOf('<section id="viewer"'), html.indexOf('<div id="warn">'));
const presentation = preview.slice(preview.indexOf('  const readinessNotice ='), preview.indexOf('  window.CoulissesReadiness ='));
const css = read('page/studio.css') + read('page/studio-tools.css');
const server = http.createServer((req,res) => {
  const lang = req.url === '/en' ? 'en' : 'fr';
  const fixture = `<!doctype html><html lang="fr"><head><style>${css}
    body {display:block;} #viewer {height:440px;} #stage {width:75%;height:75%;}</style></head>
    <body>${toolbar}<div id="stagewrap"><div id="stage"></div></div></section><script>
      const $ = selector => document.querySelector(selector);
      const FR = document.documentElement.lang === 'fr', SP = {isPlaying:()=>false}, META = {};
      let mode = 'code', codeVer = 1, frame = 60, info = null, crash = null;
      const curFrame = () => frame, previewNoteReadiness = () => info, hardReload = f => window.reloaded = f;
      ${presentation}
      window.sample = (state,reason,f=60) => { frame=f; info = state ? {state,reason,frame} : null; updateReadinessNotice(); };
      window.tick = updateReadinessNotice;
      window.geometry = () => ['#viewer','#viewbar','#stagewrap','#stage','#srcCode','#guideSafe','#playbackResolution'].map(s=>$(s).getBoundingClientRect().toJSON());
      $('.dock-heading').textContent = FR ? 'Moniteur' : 'Monitor';
      $('#codeStatus').textContent = 'Code v12 · 12:42';
      document.querySelectorAll('i[data-ic]').forEach(i => i.outerHTML='<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"></svg>');
      $('#open3d').style.display=''; $('#open3d span').textContent='Ouvrir le plan 3D · Table holographique';
      $('#proxy').textContent='Proxy en cours de préparation';
      $('#playbackResolutionControl').hidden = false;
    </script></body></html>`;
  res.writeHead(200,{'content-type':'text/html;charset=utf-8'});
  res.end(renderPage(fixture,{l:lang}));
});
server.listen(0,'127.0.0.1'); await once(server,'listening');
let page, count=0;
try {
  page = await launch({port:await freePort(9660)});
  for (const lang of ['fr','en']) {
    await page.goto('http://127.0.0.1:'+server.address().port+'/'+lang);
    for (const width of [1100,660,570,400,320]) {
      await page.eval(`$('#viewer').style.width=${width}+'px'; sample(null);`);
      const normal = await page.eval('return geometry()');
      await page.eval("sample('loading','player-starting'); sample('loading','frame-not-confirmed',61)");
      assert.equal(await page.eval('return readinessNotice.hidden'), true);
      await page.eval("sample('expired','frame-preparation-failed',61)");
      assert.deepEqual(await page.eval('return geometry()'),normal,'showing the notice moves the monitor at '+width);
      assert.equal(await page.eval('return readinessNotice.hidden || readinessRetry.hidden'),false);
      await page.eval('readinessSummary.focus()'); await page.key('Enter','Enter','\r');
      assert.equal(await page.eval('return readinessNotice.open'),true);
      assert.deepEqual(await page.eval('return geometry()'),normal,'opening the details moves the monitor at '+width);
      const fits = await page.eval(`
        const bar = $('#viewbar').getBoundingClientRect(), detail = $('.readiness-detail').getBoundingClientRect();
        const summary = readinessSummary.getBoundingClientRect(), retry = readinessRetry.getBoundingClientRect();
        const hit = document.elementFromPoint(retry.x+retry.width/2,retry.y+retry.height/2);
        return {popup:detail.left>=bar.left && detail.right<=bar.right, summary:summary.left>=bar.left && summary.right<=bar.right,
          controls:$('#guideSafe').getBoundingClientRect().right<=bar.right, retry:hit===readinessRetry};`);
      assert.deepEqual(fits,{popup:true,summary:true,controls:true,retry:true},lang+' '+width);
      await page.key('Escape','Escape');
      assert.equal(await page.eval('return !readinessNotice.open && document.activeElement===readinessSummary'),true);
      await page.key(' ','Space',' ');
      assert.equal(await page.eval('return readinessNotice.open'),true);
      await page.eval('readinessRetry.click()');
      assert.equal(await page.eval('return !readinessNotice.open && reloaded'),61);
      await page.eval('sample(null)');
      assert.equal(await page.eval("return readinessNotice.hidden && readinessAnnouncement.textContent === ''"),true);
      count++;
    }
    await page.eval("sample('loading','player-starting')");
    await page.until('(tick(), !readinessNotice.hidden)',4000);
    const loading = await page.eval('return [readinessHeading.textContent,readinessText.textContent,readinessRetry.hidden]');
    assert.equal(loading[0],lang==='fr' ? 'Chargement de l’image' : 'Frame loading');
    assert.ok(loading[1].includes(lang==='fr' ? 'démarrage du lecteur' : 'starting the player'));
    assert.equal(loading[2],true);
    await page.eval("sample('loading','frame-not-confirmed',70)");
    assert.equal(await page.eval('return readinessNotice.hidden'),true);
    await page.eval("sample('error','transport'); readinessNotice.open=true");
    await page.mouse('mousePressed',20,370); await page.mouse('mouseReleased',20,370);
    assert.equal(await page.eval('return readinessNotice.open'),false);
    await page.eval("mode='video'; tick()");
    assert.equal(await page.eval('return readinessNotice.hidden'),true);
    count++;
  }
  console.log(count+' ok, 0 ko');
} finally {
  await page?.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}

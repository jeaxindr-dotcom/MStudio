// Exercise the shipped popover, its placement and its real translations on synthetic marks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {once} from 'node:events';
import {launch} from './cdp.mjs';
import {freePort} from './where.mjs';
import {renderPage} from '../lib/i18n.mjs';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const studio = read('studio.html'), script = read('page/studio/03-gestures.js');
const markup = studio.slice(studio.indexOf('<div id="pop">'), studio.indexOf('\n        </div>\n        <div id="shuttle">'));
const placement = script.slice(script.indexOf('  function positionPop()'), script.indexOf('  function closePop()'));
const css = read('page/studio.css');
const server = http.createServer((req, res) => {
  const lang = req.url === '/en' ? 'en' : 'fr';
  const page = `<!doctype html><html lang="fr"><head><!--I18N--><style>${css}</style></head>
    <body><div id="stage"><div id="media" style="width:100%;height:100%">${markup}</div></div>
    <script>
    const $ = selector => document.querySelector(selector);
    let popFor = null, mode = 'code';
    const VZ = {k:1}, visBox = () => ({x0:0,y0:0,x1:$('#stage').clientWidth,y1:$('#stage').clientHeight});
    const toPx = ([x,y]) => [x/1920 * $('#stage').clientWidth * VZ.k,y/1080 * $('#stage').clientHeight * VZ.k];
    const contextAt = () => ({scene:'Scene 1'}), esc = value => value, previewNoteReadiness = () => null;
    const drawOv = () => {}, identify = () => { $('#popTg').innerHTML = ''; };
    ${placement}
    window.showMark = (width, height, zoom, pin) => {
      const stage = $('#stage'), media = $('#media');
      Object.assign(stage.style,{width:width+'px',height:height+'px'});
      VZ.k=zoom; media.style.transform='scale('+zoom+')'; media.style.setProperty('--iz',1/zoom);
      const point=[1700/zoom,980/zoom];
      openPop(pin ? {kind:'pin',points:[point]} : {kind:'circle',strokes:[[point]]},120);
    };
    window.identifyObjects = () => {
      $('#popTg').innerHTML = '<span class="dot"></span>' + 'A'.repeat(78) + ' <span class="k">Foreground</span><span class="k"> / </span>Label <span class="k">Background</span>';
    };
    </script></body></html>`;
  res.writeHead(200,{'content-type':'text/html;charset=utf-8'}); res.end(renderPage(page,{l:lang,prefixes:['st.pop.']}));
});
server.listen(0,'127.0.0.1'); await once(server,'listening');
let browser, count=0;
try {
  browser=await launch({port:await freePort(9682)});
  for (const lang of ['fr','en']) {
    await browser.goto('http://127.0.0.1:'+server.address().port+'/'+lang);
    for (const [width,height,zoom] of [[1280,720,1],[480,270,2],[315,178,1],[260,147,1]]) {
      for (const pin of [false,true]) {
        await browser.eval(`showMark(${width},${height},${zoom},${pin}); identifyObjects();`);
        const actual = await browser.eval(`
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const rect = el => {
            const {left,top,right,bottom,width,height} = el.getBoundingClientRect();
            return {left,top,right,bottom,width,height};
          };
          const buttons=[...document.querySelectorAll('#pop .b button')].filter(b=>b.offsetWidth);
          const textFit=buttons.every(b=>b.scrollWidth<=b.clientWidth+1);
          const focus=document.activeElement.id;
          return {stage:rect($('#stage')), pop:rect($('#pop')), buttons:buttons.map(rect), ids:buttons.map(b=>b.id), textFit, focus,
                  rowCount:new Set(buttons.map(b=>b.getBoundingClientRect().top)).size,
                  fitsFields:$('#pop .pop-fields').scrollWidth <= $('#pop .pop-fields').clientWidth+1};
        `);
        const inside=(item,box,gap) => item.left>=box.left+gap-0.5 && item.top>=box.top+gap-0.5 &&
          item.right<=box.right-gap+0.5 && item.bottom<=box.bottom-gap+0.5;
        assert.deepEqual(actual.ids, pin ? ['popCancel','popOk'] : ['popClear','popCancel','popOk']);
        assert.ok(inside(actual.pop,actual.stage,5), 'popover remains inside the monitor');
        assert.ok(actual.buttons.every(b=>inside(b,actual.pop,14)),'every action stays inside the popover padding');
        for (const [i,a] of actual.buttons.entries()) for (const b of actual.buttons.slice(i+1)) {
          assert.ok(a.right+5<=b.left || a.bottom+5<=b.top,'buttons have a visible gap in reading order');
        }
        assert.ok(actual.textFit && actual.fitsFields,'button labels and identified targets fit');
        assert.equal(actual.focus,'popTx');
        if (!pin && width===1280) assert.equal(actual.rowCount,1);
        if (!pin) console.log(`${lang} · monitor ${width}×${height}, ${zoom}× · popover ${Math.round(actual.pop.width)}×${Math.round(actual.pop.height)} · action rows ${actual.rowCount}`);
        count++;
      }
    }
  }
  console.log(`${count} ok, 0 ko`);
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }

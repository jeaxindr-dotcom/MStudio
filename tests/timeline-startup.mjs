// Real studio page with a deliberately unavailable preview: the timeline must
// remain usable without waiting for the composition's first decoded image.
// All HTTP requests terminate in this fixture; no project or user data is read.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {launch} from './cdp.mjs';
import {freePort} from './where.mjs';

process.env.COULISSES_LANG = 'fr';
const {renderPage} = await import('../lib/i18n.mjs');
const root = new URL('../', import.meta.url);
const baseline = process.argv.includes('--baseline');
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const changed = new Set(['01-preview.js', '02-notes.js', '07-timeline-filmstrip.js', '10-start.js']);
const parts = fs.readdirSync(new URL('page/studio/', root)).filter(f => /^\d\d-[\w-]+\.js$/.test(f)).sort();
const script = '(()=>{\n' + parts.map(f => baseline && changed.has(f)
  ? execFileSync('git', ['show', 'HEAD:page/studio/' + f], {cwd:root, encoding:'utf8'})
  : read('page/studio/' + f)).join('\n') +
  '\nwindow.__startupProbe=()=>({frames:FRAMES,fps:FPS,duration:DUR,player:!!SP,live:!!LIVE,codeVersion:codeVer});window.__startupSeek=seekFrame;})();';
const notes = Array.from({length:15}, (_,i) => ({id:'n' + i, frame:(i+1)*2000, end:null, text:'Note ' + (i+1),
  kind:'point', source:'code', status:'open', images:[], thread:[{text:'Agent reply'}],
  at:{frame:(i+1)*2000,end:null,plan:'fixture-plan'}, plan:'fixture-plan', followVersion:2}));
const data = {frames:41956,fps:30,tracks:[{id:'scenes',name:'Scènes prêtes',type:'band',clips:[
  {t0:0,t1:500,label:'Début'}, {t0:500,t1:1000,label:'Milieu'}, {t0:1000,t1:41956/30,label:'Fin'},
]}]};
const requests = [];
let opened = 0, page;
const server = http.createServer((req,res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  requests.push({path:pathname,method:req.method,at:Date.now()});
  const send = (value,type='application/json') => {res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(type === 'application/json' ? JSON.stringify(value) : value);};
  const ready = Date.now() - opened >= 450;
  const code = {status:ready?'ready':'building',version:ready?1:0,hash:'fixture'};
  const timeline = {status:ready?'ready':'building',version:ready?1:0,error:null};
  const plans = {code:ready?'fixture-plan':null,mappingVersion:2};
  if(pathname==='/') {opened=Date.now();return send(renderPage(read('studio.html'),{prefixes:['st.','common.','menu.']})
    .replace(/<link[^>]+https:\/\/fonts\.[^>]+>/g,''),'text/html');}
  if(pathname==='/studio.js') return send(script,'text/javascript');
  if(pathname==='/studio.css') return send(read('page/studio.css'),'text/css');
  if(pathname==='/studio-tools.css') return send(['composition.css','timeline-workrange.css','studio-tools.css','project-output.css'].map(f=>read('page/'+f)).join('\n'),'text/css');
  if(['/menubar.js','/shortcuts.js','/medias.js'].includes(pathname)) return send(read(pathname.slice(1)),'text/javascript');
  if(pathname==='/app-update-ui.js') return send(read('page/app-update-ui.js'),'text/javascript');
  if(pathname==='/app-update.css') return send(read('page/app-update.css'),'text/css');
  if(pathname==='/api/meta') return send({kind:'remotion',title:'Isolated startup',episode:'fixture',notesFile:'/fixture/notes.json',
    features:{code:true,plan:ready},engine:'remotion',render:null,snapshot:null,size:[1920,1080],fps:30,code,plans,agent:{},proxy:'none'});
  if(pathname==='/api/timeline') return send({...timeline,data:ready?data:null});
  if(pathname==='/api/status') return send({code,timeline,plans,lots:[],agent:{},held:false,reviewSound:{state:'missing'}});
  if(pathname==='/api/notes' && req.method==='GET') return send({notes,rev:'fixture'});
  if(pathname==='/api/replies') return send({notes:{}});
  if(pathname.startsWith('/code') || pathname.startsWith('/player')) return send('<p>Preview intentionally blocked before hello</p>','text/html');
  if(pathname.endsWith('.png')) {res.writeHead(404);return res.end();}
  return send({});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  page=await launch({port:await freePort(9625)});
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.until('window.__startupProbe && __startupProbe().live',6000);
  const ms=Date.now()-opened, state=await page.eval('return {probe:__startupProbe(),ui:__studio.state()}');
  assert.equal(state.probe.player,false,'The preview is deliberately blocked.');
  assert.equal(state.probe.live,true);
  if(baseline) {
    assert.equal(state.probe.frames,0);
    console.log(`Baseline reproduced: timeline data ready after ${ms} ms, but 0 drawable frames while preview waits.`);
  } else {
    assert.equal(state.probe.frames,41956);assert.equal(state.probe.fps,30);
    assert.equal(state.ui.view.b,41956/30);assert.equal(state.ui.tl.length,15);
    assert.ok(state.ui.lanes.includes('Scènes prêtes'));
    assert.ok(ms<2500, 'Startup polling should catch the first ready timeline promptly.');
    assert.equal(requests.filter(r=>r.path.includes('thumbnail')).length,0,'Do not compete with preview startup.');
    assert.equal(requests.filter(r=>r.method!=='GET' && /^\/api\/(notes|replies|remap)(\/|$)/.test(r.path)).length,0,'No notes or replies are mutated.');
    console.log(`Timeline visible with 15 note markers after ${ms} ms while preview remains unavailable.`);
    await page.eval('document.querySelector("#bZoomIn").click()');
    const zoomed=await page.eval('return __studio.state().view');
    assert.ok(zoomed.b-zoomed.a<41956/30,'The early timeline can already zoom.');
    await page.eval('__startupSeek(9000)');
    assert.equal(await page.eval('return __studio.state().frame'),9000,'A position can be chosen before preview readiness.');
    assert.ok(!page.logs.some(s=>s.includes('[exception]')), page.logs.join('\n'));
  }
} finally {
  await page?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}

if(!baseline) {
  const source=read('page/studio/01-preview.js');
  const helpers=source.slice(source.indexOf('  let timelineSeededDuration'),source.indexOf('  function humanTarget'));
  function fixture(extra={}) {
    const c=vm.createContext({META:{features:{code:true}},FRAMES:0,FPS:30,DUR:0,view:{a:0,b:0},CW:1920,CH:1080,
      fitMedia(){},resize(){},renderAll(){},updateHud(){},hashFrame:()=>null,seekFrame(){},
      clampView(){const span=c.view.b-c.view.a;if(c.view.b>c.DUR)c.view={a:Math.max(0,c.DUR-span),b:c.DUR};},...extra});
    vm.runInContext(helpers,c);return c;
  }
  for(const bad of [{frames:0,fps:30},{frames:300,fps:0},{frames:NaN,fps:30},{duration:5,fps:Infinity}]) {
    const c=fixture();assert.equal(c.adoptTimelineDuration(bad),false);assert.equal(c.FRAMES,0);
  }
  const mp4=fixture({META:{features:{code:true},render:{size:1}}});
  assert.equal(mp4.adoptTimelineDuration(data),false,'MP4 metadata owns its playback clock.');
  const active=fixture({FRAMES:300,DUR:10,view:{a:2,b:5}});
  assert.equal(active.adoptTimelineDuration(data),false);assert.equal(active.view.a,2);
  const c=fixture();assert.equal(c.adoptTimelineDuration({duration:10,fps:25}),true);
  assert.equal(c.FRAMES,250);c.view={a:2,b:5};
  c.adoptCode({durationInFrames:450,fps:30});
  assert.equal(c.FRAMES,450);assert.equal(c.FPS,30);assert.equal(c.view.a,2);assert.equal(c.view.b,5);
  const fitted=fixture();fitted.adoptTimelineDuration({frames:250,fps:25});
  fitted.adoptCode({durationInFrames:450,fps:30});assert.equal(fitted.view.b,15);
  console.log('Duration validation, MP4 clock, active view and Player adoption passed.');
}
console.log(baseline ? '1 ok, 0 ko' : '2 ok, 0 ko');

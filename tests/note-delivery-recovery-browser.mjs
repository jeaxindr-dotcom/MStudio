// Real studio page, isolated in-memory API. A published batch can outlive its
// HTTP response; the next status poll must move its unchanged notes to Notes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {launch} from './cdp.mjs';
import {freePort} from './where.mjs';

process.env.COULISSES_LANG = 'fr';
const {renderPage} = await import('../lib/i18n.mjs');
const root = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const parts = fs.readdirSync(new URL('page/studio/', root)).filter(f => /^\d\d-[\w-]+\.js$/.test(f)).sort();
const script = '(()=>{\n' + parts.map(f => read('page/studio/' + f)).join('\n') +
  '\nwindow.__deliveryProbe=()=>({notes:structuredClone(notes),states:Object.fromEntries(notes.map(n=>[n.id,stateOf(n)]))});})();';
const time = offset => new Date(Date.UTC(2026, 0, 1) + offset * 1000).toISOString();
const makeNote = (id, extra = {}) => ({id, frame:120, end:null, text:'Correction ' + id,
  source:'code', status:'open', images:[], thread:[], draft:true, created:time(0), updated:time(1),
  plan:'plan', at:{frame:120,end:null,plan:'plan'}, followVersion:2, ...extra});
const original = [
  makeNote('lost', {mark:{kind:'pin',points:[[200,100]]}, images:[{file:'images/kept.jpg',label:'Reference'}],
    thread:[{id:'user-reply',text:'Conserver ce détail',at:time(2)}]}),
  makeNote('unsent', {status:'done'}),
  makeNote('requeued', {lot:1,sentAt:time(10),updated:time(20),draftQueuedAt:time(20),statusAt:time(20)}),
];
let stored = structuredClone(original), revision = 1, published = false, republished = false, page;
const replyText = 'Animation corrigée, réponse de l’agent conservée.';
const replies = {notes:{
  lost:{status:'done',statusAt:time(15),messages:[{by:'Claude Code',at:time(15),text:replyText,images:[]}]},
  requeued:{status:'done',statusAt:time(15),messages:[{by:'Claude Code',at:time(15),text:'Ancienne correction',images:[]}]},
}};
const requests = [], writes = [];
const code = {status:'building',version:0};
const timeline = {status:'idle',version:0,error:null};
const plans = {code:'plan',mappingVersion:2};
const server = http.createServer(async (req,res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  requests.push({path:pathname,method:req.method});
  const send = (value,type='application/json',status=200) => {
    res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});
    res.end(type === 'application/json' ? JSON.stringify(value) : value);
  };
  if(pathname==='/') return send(renderPage(read('studio.html'),{prefixes:['st.','common.','menu.']})
    .replace(/<link[^>]+https:\/\/fonts\.[^>]+>/g,''),'text/html');
  if(pathname==='/studio.js') return send(script,'text/javascript');
  if(pathname==='/studio.css') return send(read('page/studio.css'),'text/css');
  if(pathname==='/studio-tools.css') return send(['composition.css','timeline-workrange.css','studio-tools.css','project-output.css'].map(f=>read('page/'+f)).join('\n'),'text/css');
  if(['/menubar.js','/shortcuts.js','/medias.js'].includes(pathname)) return send(read(pathname.slice(1)),'text/javascript');
  if(pathname==='/app-update-ui.js') return send(read('page/app-update-ui.js'),'text/javascript');
  if(pathname==='/app-update.css') return send(read('page/app-update.css'),'text/css');
  if(pathname==='/api/meta') return send({kind:'remotion',title:'Isolated delivery recovery',episode:'fixture',notesFile:'/fixture/notes.json',
    features:{code:true,plan:true},engine:'remotion',render:null,snapshot:{frames:3600},size:[1920,1080],fps:30,code,plans,agent:{},proxy:'none'});
  if(pathname==='/api/status') return send({code,timeline,plans,agent:{},held:false,reviewSound:{state:'missing'},
    lots:[...(published?[{lot:1,kind:'remotion',sentAt:time(10),ids:['lost','requeued','deleted'],claude:{status:'done'}}]:[]),
      ...(republished?[{lot:2,kind:'remotion',sentAt:time(30),ids:['requeued'],claude:{status:'taken'}}]:[])]});
  if(pathname==='/api/timeline') return send({...timeline,data:null});
  if(pathname==='/api/replies') return send(replies);
  if(pathname==='/api/notes' && req.method==='GET') return send({notes:stored,rev:String(revision)});
  if(pathname==='/api/notes' && req.method==='PUT') {
    let body=''; for await(const part of req) body+=part;
    const data=JSON.parse(body);
    if(data.rev!==String(revision)) return send({conflict:true,current:{notes:stored,rev:String(revision)}},'application/json',409);
    stored=structuredClone(data.notes);writes.push(structuredClone(stored));revision++;
    return send({ok:true,rev:String(revision)});
  }
  if(pathname.startsWith('/images/') || pathname.endsWith('.png')) return send({},'application/json',404);
  return send({});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let passed=0;
const check = name => {passed++;console.log('✓ ' + name);};
try {
  page=await launch({port:await freePort(9660)});
  const base='http://127.0.0.1:' + server.address().port;
  await page.goto(base);
  await page.until('window.__deliveryProbe && document.querySelectorAll("#draftList .card").length===3',6000);
  assert.equal(await page.eval('return document.querySelectorAll("#list .card").length'),0);
  const before=await page.eval('return __deliveryProbe()');
  assert.equal(before.states.lost,'fixed');
  assert.equal(before.states.unsent,'fixed');
  assert.equal(before.states.requeued,'todo');
  check('A correction reply or checked fixed box alone never moves an unpublished draft');

  published=true;
  await page.until('document.querySelector("#list .card[data-id=lost]") && !document.querySelector("#draftList .card[data-id=lost]")',8000);
  await page.until('document.querySelector("#list .card[data-id=lost] .msg.claude")',3000);
  const recovered=await page.eval('return __deliveryProbe()');
  const actual=recovered.notes.find(n=>n.id==='lost');
  const expected={...original[0],draft:false,lot:1,sentAt:time(10)};
  assert.deepEqual(actual,expected);
  assert.equal(recovered.states.lost,'fixed');
  assert.ok((await page.eval('return document.querySelector("#list .card[data-id=lost] .msg.claude").textContent')).includes(replyText));
  assert.equal(await page.eval('return document.querySelectorAll(".card[data-id=lost]").length'),1);
  assert.equal(recovered.notes.length,3,'A deleted note mentioned in an old lot is never restored.');
  check('A published lot found by polling restores the sent card on the right with its reply and exact content');

  assert.equal(await page.eval('return !!document.querySelector("#draftList .card[data-id=requeued]")'),true);
  assert.equal(await page.eval('return !!document.querySelector("#draftList .card[data-id=unsent]")'),true);
  assert.equal(recovered.notes.find(n=>n.id==='requeued').draftQueuedAt,time(20));
  check('An explicit requeue after the old lot remains pending on the left');

  republished=true;
  await page.until('document.querySelector("#list .card[data-id=requeued]") && !document.querySelector("#draftList .card[data-id=requeued]")',8000);
  const second=await page.eval('return __deliveryProbe()');
  const redelivered=second.notes.find(n=>n.id==='requeued');
  assert.equal(redelivered.lot,2);assert.equal(redelivered.sentAt,time(30));assert.equal(redelivered.draft,false);
  assert.equal(redelivered.draftQueuedAt,undefined);
  assert.equal(second.states.requeued,'todo','A new delivery does not validate an old correction.');
  assert.deepEqual(second.notes.find(n=>n.id==='unsent'),original[1]);
  await page.until('document.querySelector("#save").textContent && !document.querySelector("#save").classList.contains("err")',3000);
  for(let n=0;n<30 && !stored.some(n=>n.id==='requeued' && n.lot===2);n++) await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(stored.find(n=>n.id==='lost').lot,1);
  assert.equal(stored.find(n=>n.id==='requeued').lot,2);
  assert.equal(requests.filter(r=>r.path==='/api/send').length,0,'Recovery must not publish or resend a batch.');
  assert.ok(writes.length>=2);
  assert.ok(!page.logs.some(s=>s.includes('[exception]')),page.logs.join('\n'));
  check('Only a newer published lot acknowledges the requeue; both recoveries persist without resending');
} finally {
  await page?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
console.log(`${passed} ok, 0 ko`);

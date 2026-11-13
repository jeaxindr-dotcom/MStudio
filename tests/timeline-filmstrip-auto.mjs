// The real frontend scheduler, with decoded sprites and requests stubbed so its
// budget, visibility and cancellation are testable without rendering a film.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';

const source=fs.readFileSync(new URL('../page/studio/07-timeline-filmstrip.js',import.meta.url),'utf8');
const until=async predicate=>{for(let i=0;i<80;i++){if(predicate())return;await delay(25);}assert.fail('scheduler timeout');};
function setup(t, respond) {
  const buttons=[],events={},mediaEvents={},calls=[],errors=[],drawn=[];
  const node=()=>({classList:{toggle(){}},attrs:{},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];}});
  const g=new Proxy({}, {get:(_,key)=> key==='drawImage'?(tile,...args)=>drawn.push({frame:tile.frame,x:args[4]}):key==='measureText'?()=>({width:10}):()=>{},set:()=>true});
  let rendering=false,active=0,maxActive=0,disposed=false;
  const context=vm.createContext({FR:true,ic:()=>'',store:{get:(_,fallback)=>fallback,set(){}},
    document:{hidden:false,createElement:node,addEventListener:(key,fn)=>events[key]=fn},
    window:{addEventListener:(key,fn)=>events[key]=fn},$(){return{prepend:(...items)=>buttons.push(...items)};},
    META:{notesFile:'/isolated/revue/notes.json',engine:'remotion'},STATUS:{code:{version:1,hash:'one',status:'ready'},timeline:{version:1}},
    FPS:30,FRAMES:3000,mode:'code',LIVE:{},view:{a:0,b:100},W:8000,FONT:'sans-serif',ranges:[{start:0,end:100}],
    M:{paused:true,on:(key,fn)=>mediaEvents[key]=fn},AbortController,URLSearchParams,setTimeout,clearTimeout,
    rr(){},setSave:message=>errors.push(message),resize:()=>render(),
    tx:time=>(time-context.view.a)/(context.view.b-context.view.a)*context.W,
    scheduleDraw(){if(!rendering&&!disposed){rendering=true;setTimeout(()=>{rendering=false;if(!disposed)render();},0);}},
    async createImageBitmap(image,...crop){return{width:crop.length?128:image.frames.length*128,height:72,frames:image.frames,frame:crop.length?image.frames[crop[0]/128]:null,close(){}};},
    async fetch(url,{signal}) {
      const params=new URLSearchParams(url.split('?')[1]);
      const call={url,frames:params.get('frames').split(',').map(Number),version:params.get('version'),signal};calls.push(call);
      active++;maxActive=Math.max(maxActive,active);
      try{return await (respond?.(call,calls.length)??Promise.resolve({ok:true,blob:async()=>({frames:call.frames})}));}
      finally{active--;}
    },
  });
  vm.runInContext(source,context);
  function render(){vm.runInContext('filmstrip.begin();for(const range of ranges)filmstrip.paint(g,{...range,y:0,height:48,title:"Scène 3D",color:"red"});filmstrip.end();',context);}
  context.g=g;
  t.after(()=>{disposed=true;events.pagehide();});
  return {context,calls,errors,drawn,buttons,mediaEvents,events,render,get maxActive(){return maxActive;}};
}

test('Les scènes sans média lancent une préparation automatique bornée et progressive',async t=>{
  const s=setup(t);s.render();
  await until(()=>s.calls.reduce((n,c)=>n+c.frames.length,0)===32);
  await delay(250);
  assert.equal(s.calls.length,5);assert.equal(s.maxActive,1);
  assert.ok(s.calls.every(c=>c.frames.length<=8&&c.version==='1'));
  assert.ok(s.calls[1].frames[0]<500&&s.calls[1].frames.at(-1)>2500,'Les détails couvrent aussi la fin de la vue.');
  s.render();await delay(250);assert.equal(s.calls.length,5,'Redessiner ne renouvelle pas le budget.');
  s.context.view={a:20,b:40};s.render();
  await until(()=>s.calls.length>5);
  assert.ok(s.calls[5].frames.every(f=>f>=600&&f<1200),'Seules les cellules visibles sont calculées.');
});

test('La couverture priorise chaque clip et remplit ses cases sans franchir une coupe',async t=>{
  const s=setup(t);s.context.ranges=[{start:0,end:30},{start:30,end:70},{start:70,end:100}];s.render();
  await until(()=>s.drawn.length>10);
  assert.equal(s.calls[0].frames.length,3);
  assert.ok(s.calls[0].frames[0]<900&&s.calls[0].frames[1]>=900&&s.calls[0].frames[1]<2100&&s.calls[0].frames[2]>=2100);
  for(const d of s.drawn){
    const at=d.x/8000*3000;
    if(at<900)assert.ok(d.frame<900);
    else if(at<2100)assert.ok(d.frame>=900&&d.frame<2100);
    else assert.ok(d.frame>=2100);
  }
  assert.ok(s.drawn.length>s.calls[0].frames.length,'Une image remplit plusieurs cases du même clip.');
});

test('La lecture annule la capture en cours et la pause reprend sans clic',async t=>{
  const s=setup(t,(call,n)=>n===1?new Promise((_,reject)=>call.signal.addEventListener('abort',()=>reject(call.signal.reason),{once:true})):undefined);
  s.render();await until(()=>s.calls.length===1);
  s.context.M.paused=false;s.mediaEvents.play();
  assert.equal(s.calls[0].signal.aborted,true);
  s.render();await delay(300);assert.equal(s.calls.length,1);
  s.context.M.paused=true;s.mediaEvents.pause();
  await until(()=>s.calls.length>1);
  assert.equal(s.errors.length,0,'Une annulation de lecture ne devient pas une erreur.');
});

test('Une nouvelle génération abandonne les anciennes images et change la version demandée',async t=>{
  const s=setup(t,(call,n)=>n===1?new Promise((_,reject)=>call.signal.addEventListener('abort',()=>reject(call.signal.reason),{once:true})):undefined);
  s.render();await until(()=>s.calls.length===1);
  s.context.STATUS.code={version:2,hash:'two',status:'ready'};s.render();
  assert.equal(s.calls[0].signal.aborted,true);
  await until(()=>s.calls.length>1);
  assert.equal(s.calls[1].version,'2');assert.equal(s.errors.length,0);
});

test('Une erreur arrête la préparation automatique et laisse un vrai bouton de reprise',async t=>{
  const s=setup(t,(_,n)=>n===1?Promise.resolve({ok:false,status:500}):undefined);
  s.render();await until(()=>s.errors.length===1);await delay(250);
  assert.equal(s.calls.length,1);assert.equal(s.buttons[1].disabled,false);
  s.buttons[1].onclick();await until(()=>s.calls.length>1);
  assert.ok(s.calls[1].frames.length<=8);
});

test('Un slot de rendu encore occupé est réessayé sans intervention',async t=>{
  const s=setup(t,(_,n)=>n===1?Promise.resolve({ok:false,status:429}):undefined);
  s.render();await until(()=>s.calls.length===1);await delay(400);
  assert.equal(s.calls.length,1,'Le backoff évite de saturer le rendu.');
  await until(()=>s.calls.length>1);assert.equal(s.errors.length,0);
});

test('Un onglet masqué suspend les calculs puis reprend à son retour',async t=>{
  const s=setup(t);s.context.document.hidden=true;s.render();await delay(250);
  assert.equal(s.calls.length,0);
  s.context.document.hidden=false;s.events.visibilitychange();
  await until(()=>s.calls.length>0);
});

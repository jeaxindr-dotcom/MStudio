// Scene → parallax tested against disposable projects and the actual mailbox CLI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {launch, requireSandbox} from './cdp.mjs';
import {freePort,remotionModules} from './where.mjs';

const studio = fileURLToPath(new URL('../',import.meta.url)), cache = path.join(studio,'.cache','parallax-test');
fs.mkdirSync(cache,{recursive:true});
const root = fs.mkdtempSync(path.join(cache,'run-')), engine = path.join(root,'engine'), links = path.join(engine,'node_modules');
Object.assign(process.env,{STUDIO_PROJECTS:path.join(root,'projects.json'),COULISSES_SETTINGS:path.join(root,'settings.json'),
  COULISSES_MEDIAS:path.join(root,'medias'),COULISSES_HISTORY_DIR:path.join(root,'history'),COULISSES_LANG:'fr'});
const {importProject}=await import('../lib/projects.mjs'), {createCoulisses}=await import('../lib/coulisses-file.mjs');
let page, server, base, ok=0;
const pass=label=>{ok++;console.log('✓ '+label);};
async function stop() {
  if (server && server.exitCode===null && !server.signalCode) {const end=once(server,'exit'); server.kill(); await end;}
}
async function open(revue,ready,lang='fr') {
  await stop();
  const port=await freePort(4885);base='http://127.0.0.1:'+port;
  server=spawn(process.execPath,['studio-server.mjs','--no-open','--port',String(port),'--project',revue],
    {cwd:studio,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,COULISSES_LANG:lang}});
  let log='';server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
  for(let i=0;i<160&&!log.includes(base)&&server.exitCode===null;i++) await sleep(100);
  assert.ok(log.includes(base),log);
  await requireSandbox(base,root);
  await page.goto(base);
  await page.until(ready,90000);
}
const click=selector=>page.eval('document.querySelector('+JSON.stringify(selector)+').click()');
const val=selector=>page.eval('return document.querySelector('+JSON.stringify(selector)+').value');
const lots=revue=>fs.readdirSync(path.join(revue,'lots')).filter(n=>/^\d+\.json$/.test(n));
function luminance(color) {
  assert.match(color, /^rgb\(/, 'The native popup needs opaque text and background');
  const channels = color.match(/\d+/g).map(value => Number(value) / 255);
  const [r, g, b] = channels.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
async function checkScope(label) {
  await page.until("document.querySelector('#sc-scope')");
  const options = await page.eval(`
    const select = document.querySelector('#sc-scope');
    select.focus();
    return {
      label: select.labels[0]?.textContent,
      rows: [...select.options].map(option => {
        const style = getComputedStyle(option);
        return {value: option.value, color: style.color, background: style.backgroundColor};
      })
    };`);
  assert.equal(options.label, label);
  assert.deepEqual(options.rows.map(o => o.value), ['scene', 'here', 'all', 'range']);
  for (const option of options.rows) {
    const bg = luminance(option.background), fg = luminance(option.color);
    assert.ok((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) >= 4.5, option.value);
  }
  await page.key('End', 'End');
  await page.until("document.activeElement.id === 'sc-scope' && document.activeElement.value === 'range' && document.querySelector('#sc-from').offsetWidth > 0");
  const from = Number(await val('#sc-from')), to = Number(await val('#sc-to'));
  const stage = await page.eval("return __preview.stage.info(__studio.state().stage)");
  assert.deepEqual([stage.from, stage.to], [from, to]);
  await page.key('Home', 'Home');
  await page.until("document.activeElement.value === 'scene' && !document.querySelector('#sc-from').offsetWidth");
}
try {
  page=await launch({port:await freePort(9541)});
  const file=path.join(root,'clip.mp4');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=s=320x180:r=24:d=3','-c:v','libx264','-pix_fmt','yuv420p',file],{windowsHide:true});
  const video=importProject(file);
  await open(video.revue,"window.__studio && document.querySelector('#v').readyState>=2");
  await click('[data-tab="scene"]');
  await page.until("document.querySelector('#sceneRequestSend') && /vidéo est un rendu/.test(document.querySelector('#scene').innerText)");
  await click('#sceneRequestKeep');
  assert.ok(!await page.eval("return !!document.querySelector('#sceneRequestSend')"));
  assert.deepEqual((await (await fetch(base+'/api/status')).json()).lots,[]);
  pass('Un MP4 propose la création à partir des sources. Rester en 2D ne publie aucun lot');
  await click('#sceneParallaxReopen');
  await page.eval("document.querySelector('#agentText').value='Brouillon personnel'; document.querySelector('#agentText').dispatchEvent(new Event('input'))");
  await click('#bNote');
  await page.until("document.querySelector('#draftList textarea.main')");
  await page.eval("const x=document.querySelector('#draftList textarea.main'); x.value='Annotation à conserver'; x.dispatchEvent(new Event('input',{bubbles:true})); x.blur()");
  // Lose only the HTTP response: the server really publishes the request.
  await page.eval(`window.sendCount=0; const real=window.fetch; window.fetch=async (...args)=>{
    const response=await real(...args);
    if(args[0]==='/api/send' && ++window.sendCount===1) throw Error('test : réponse perdue');
    return response;
  };`);
  await page.eval("const b=document.querySelector('#sceneRequestSend'); b.click(); b.click()");
  await page.until("window.sendCount===1",30000);
  await page.goto(base);
  await page.until("document.querySelector('#scene').textContent.includes('en attente de prise en charge') && __studio.state().tabR==='scene'",30000);
  assert.ok(!await page.eval("return !!document.querySelector('#sceneRequestSend')"));
  assert.equal(lots(video.revue).length,1);
  const lot=JSON.parse(fs.readFileSync(path.join(video.revue,'lots','001.json'),'utf8'));
  assert.deepEqual(lot.edits.map(e=>e.id),['scene-parallax-v1']);
  assert.match(lot.edits[0].text,/clip\.mp4/);assert.match(lot.edits[0].text,/premier plan/);
  assert.equal(await val('#agentText'),'Brouillon personnel');
  assert.ok((await (await fetch(base+'/api/notes')).json()).notes.some(n=>n.text==='Annotation à conserver'&&n.draft));
  pass('Le vrai lot ne contient que la demande de parallaxe. Double clic, réponse perdue et F5 conservent un seul envoi et les brouillons');
  const retry=await fetch(base+'/api/send',{method:'POST',body:JSON.stringify({ids:['scene-parallax-v1'],fps:24,size:[320,180]})});
  assert.equal((await retry.json()).lot,1);assert.equal(lots(video.revue).length,1);
  await click('#sceneRequestAgent');
  await page.until("document.querySelector('#agentList').innerText.includes('Demande de mise en scène 3D')");
  await click('[data-tab="lots"]');
  await page.until("document.querySelector('#lots [data-lot=\"1\"]')");
  await click('#sceneRequestConnect');
  await page.until("document.querySelector('#modal').style.display==='flex'");await click('#mClose');
  execFileSync(process.execPath,['studio-cli.mjs','take',video.revue,'1','--agent','codex'],{cwd:studio,windowsHide:true,stdio:'ignore'});
  await page.until("document.querySelector('#scene').textContent.includes('prise en charge par l’agent')",12000);
  assert.equal((await (await fetch(base+'/api/replies')).json()).lots['1'].status,'taken');
  pass('Agent et Envois affichent la demande hors ligne. Le contrôle de connexion est utilisable et la CLI confirme sa prise en charge');
  const modules=remotionModules();
  if (!modules) throw Error('Le projet Remotion de test nécessite un SDK existant');
  fs.mkdirSync(path.join(engine,'src'),{recursive:true});fs.mkdirSync(path.join(engine,'public'));fs.symlinkSync(modules,links,'junction');
  fs.writeFileSync(path.join(engine,'package.json'),'{"name":"parallax-test","private":true}');
  fs.writeFileSync(path.join(engine,'src','coulisses.tsx'),`import React from 'react';
    import { Canvas } from '@react-three/fiber';
    const Flat=()=> <div data-coulisses="title">Titre</div>;
    const Deep=()=> <Canvas frameloop="demand" style={{width:320,height:180}} gl={{preserveDrawingBuffer:true}}>
      <mesh name="Décor"><boxGeometry/><meshBasicMaterial color="red"/></mesh>
      <group name="Héroïne" position={[0,0,-2]}><mesh><boxGeometry/><meshBasicMaterial color="blue"/></mesh></group>
      <group name="editor-aids" visible={false}><gridHelper/><mesh name="editor-origin"><sphereGeometry/></mesh></group>
    </Canvas>;
    export const compositions=[{id:'Flat',component:Flat},{id:'Deep',component:Deep}].map(c=>({...c,fps:24,width:320,height:180,durationInFrames:72}));`);
  fs.writeFileSync(path.join(engine,'src','coulisses.ts'),"export {compositions} from './coulisses.tsx';");
  fs.writeFileSync(path.join(engine,'src','coulisses-timeline.ts'),'export const timeline=()=>({fps:24,durationInFrames:72,pistes:[]});');
  fs.writeFileSync(path.join(engine,'src','index.ts'),"import {registerRoot,Composition} from 'remotion'; import React from 'react'; import {compositions} from './coulisses'; registerRoot(()=>React.createElement(React.Fragment,null,...compositions.map(c=>React.createElement(Composition,c))));");
  const project=id=>importProject(createCoulisses({dossier:path.join(root,id),titre:id,projet:engine,composition:id})).revue;
  await open(project('Flat'),"window.__preview?.frameReady() && __studio.state().mode==='code'",'en');
  await page.key('m','KeyM','m');
  await page.until("document.querySelector('#sceneRequestSend')?.textContent.includes('Yes, ask')");
  await click('#sceneRequestKeep');await page.until("__studio.state().staging && __preview.stage.kind==='2d'");
  pass('Sur un vrai Player 2D, M propose le parallaxe en anglais puis ouvre la scène 2D au refus');
  await page.until("document.querySelector('[data-sc-object]')?.textContent.trim()==='title'");
  await click('[data-sc-object]');
  await page.until("document.querySelector('[data-sc-object][aria-pressed=true]')?.textContent.trim()==='title'");
  assert.equal(await page.eval("return __preview.stage.list().length"), 0);
  pass('La liste 2D sélectionne le bloc data-coulisses sans créer de décalage');
  await click('#sc-cam');
  await checkScope('Scope');
  pass('Portée présente quatre options contrastées et conserve le focus en ouvrant et fermant les champs de plage au clavier');
  await open(project('Deep'),"window.__preview?.frameReady() && __preview.stage.scene3d");
  await click('[data-tab="scene"]');
  assert.equal(await page.eval("return !!document.querySelector('#sceneRequestSend')"),false);
  await click('#bStage');await page.until("__studio.state().staging && __preview.stage.kind==='3d'");
  pass('Une composition Remotion générique avec Canvas 3D ouvre sa scène native sans proposition');
  await page.until("document.querySelectorAll('[data-sc-object]').length===2");
  assert.deepEqual(await page.eval("return [...document.querySelectorAll('[data-sc-object]')].map(b=>b.textContent.trim())"), ['Décor', 'Héroïne']);
  await page.eval("document.querySelector('#sc-object-search').focus()"); await page.type('heroine');
  await page.until("document.querySelectorAll('[data-sc-object]').length===1");
  await click('[data-sc-object]');
  await page.until("document.querySelector('[data-sc-object][aria-pressed=true]')?.textContent.trim()==='Héroïne' && document.querySelector('#scene .ttl').textContent.includes('Héroïne')");
  assert.equal(await page.eval("return __preview.stage.list().length"), 0);
  assert.ok(await page.eval("return !!__preview.stage.info(__preview.stage.selected).base"));
  await page.eval("const s=document.querySelector('#sc-object-search');s.value='';s.dispatchEvent(new Event('input',{bubbles:true}))");
  pass('La recherche sélectionne un groupe 3D sans clé derrière le décor et exclut la grille et l’origine des options');
  await page.eval(`
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    c.getContext('2d').fillRect(0, 0, 8, 8);
    const item = await __preview.stage.addCutout({id:'@media:test', name:'Accessoire', url:c.toDataURL(),
      base:{p:[0,-2,0],r:[0,0,0],h:4}});
    __preview.stage.select(item.id);`);
  await checkScope('Portée');
  pass('Les mêmes options et bornes sont utilisables au clavier avec un accessoire sélectionné en 3D');
  await page.eval("document.activeElement.blur()");
  await click('#sc-cam');
  await page.until("document.querySelector('#stage').classList.contains('freecam')");
  const camera = () => page.eval("return __preview.cameraPos()");
  const picture = () => page.frameEval('player.html', "return document.querySelector('canvas').toDataURL()");
  const initial = await camera(), initialPose = await page.eval("return __preview.stage.freePose()");
  const visibleCompass=()=>page.frameEval('player.html', "const s=document.querySelector('[data-mstudio-guide=compass]');return !!s && getComputedStyle(s).display!=='none' && s.textContent.includes('XYZ')");
  assert.equal(await visibleCompass(),true);
  const cleanShot=()=>page.eval("return __preview.stage.snapshot()");
  const withGrid=await cleanShot(); assert.ok(withGrid.startsWith('data:image/jpeg') && withGrid.length>1000);
  await click('#stGrid'); await page.until("document.querySelector('#sc-grid').getAttribute('aria-pressed')==='false'");
  assert.equal(await visibleCompass(),false);assert.deepEqual(await camera(),initial);
  assert.equal(await cleanShot(),withGrid,'Les repères ne doivent pas apparaître dans la capture du plan');
  pass('La grille 3D se masque sans changer le point de vue et la capture du plan reste identique');
  const offset = () => page.eval("return __preview.stage.info('@media:test').delta");
  const initialOffset = await offset();
  const [x, y] = await page.eval(`
    const r = document.querySelector('#code').getBoundingClientRect();
    return [r.left + r.width * 0.6, r.top + r.height * 0.55];`);
  const original = await picture();
  async function drag(button, dx, dy) {
    await page.mouse('mousePressed', x, y, button);
    await page.mouse('mouseMoved', x+dx/2, y+dy/2, button);
    await page.mouse('mouseMoved', x+dx, y+dy, button);
    await page.mouse('mouseReleased', x+dx, y+dy, button);
    await sleep(150);
  }
  await drag('left',60,18);
  assert.deepEqual(await page.eval("return __preview.stage.freePose()"), initialPose);
  assert.deepEqual(await offset(), initialOffset);
  await drag('middle',45,0);
  const horizontal = await camera();
  assert.notDeepEqual(horizontal, initial);
  await drag('middle',0,24);
  assert.notDeepEqual(await camera(), horizontal);
  const afterOrbit = await page.eval("return __preview.stage.freePose()");
  await drag('right',24,12);
  const afterPan = await page.eval("return __preview.stage.freePose()");
  assert.notDeepEqual(afterPan.p, afterOrbit.p);
  assert.ok(afterPan.q.every((q,i) => Math.abs(q-afterOrbit.q[i])<1e-6), 'Pan preserves camera orientation');
  assert.deepEqual(await offset(), initialOffset);
  const orbited = await picture();
  assert.ok(orbited !== original, 'An orbit must repaint a paused demand-rendered canvas');
  await click('#sc-cam0');
  await sleep(150);
  assert.deepEqual(await camera(), initial);
  assert.deepEqual(await page.eval("return __preview.stage.freePose()"), initialPose);
  assert.ok(await picture() !== orbited, 'Reset must repaint the paused canvas');
  await page.wheel(x, y, -120);
  await sleep(150);
  assert.notDeepEqual(await camera(), initial);
  await click('#sc-off');
  await page.until("!__studio.state().staging");
  await sleep(150);
  assert.deepEqual(await camera(), initial);
  pass('Caméra libre en pause : glisser à gauche est neutre, glisser molette enfoncée tourne sur les deux axes, le bouton droit translate et la molette zoome');
  console.log(ok+' ok, 0 ko');
} catch(e) {console.error(e,page?.logs.slice(-4));console.log(ok+' ok, 1 ko');process.exitCode=1;}
finally {
  await page?.close();await stop();
  if(fs.lstatSync(links,{throwIfNoEntry:false})?.isSymbolicLink())fs.unlinkSync(links);
  if(path.dirname(root)===cache)fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:250});
}

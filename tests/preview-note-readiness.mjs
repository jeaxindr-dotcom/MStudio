import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {launch, requireSandbox} from './cdp.mjs';
import {freePort,remotionModules,skip} from './where.mjs';
import {createCoulisses} from '../lib/coulisses-file.mjs';

const modules = remotionModules();
if (!modules) skip('SDK Remotion','COULISSES_TEST_REMOTION');
const root = fileURLToPath(new URL('../',import.meta.url)), parent = path.join(root,'.cache','preview-note-readiness');
fs.mkdirSync(parent,{recursive:true});
const dir = fs.mkdtempSync(path.join(parent,'case-')), project = path.join(dir,'engine'), src = path.join(project,'src'), link = path.join(project,'node_modules');
process.env.STUDIO_PROJECTS=path.join(dir,'projects.json'); process.env.COULISSES_SETTINGS=path.join(dir,'settings.json');
process.env.COULISSES_MEDIAS=path.join(dir,'medias'); process.env.COULISSES_HISTORY_DIR=path.join(dir,'history'); process.env.COULISSES_LANG='fr';
const {importProject} = await import('../lib/projects.mjs');
let server,page,n=0;
const pass = s => {console.log('✓ '+s); n++;};
const click = s => page.eval('document.querySelector('+JSON.stringify(s)+').click()');
async function wait(check,ms=12000) {
  const start=Date.now();
  while (!(await check())) { if(Date.now()-start>ms) throw new Error('Timeout: '+check); await delay(100); }
}
try {
  fs.mkdirSync(src,{recursive:true}); fs.mkdirSync(path.join(project,'public')); fs.symlinkSync(modules,link,'junction');
  fs.writeFileSync(path.join(project,'package.json'),JSON.stringify({name:'preview-readiness-fixture',private:true}));
  fs.writeFileSync(path.join(src,'coulisses.ts'),[
    "import {createElement} from 'react'; import {useCurrentFrame} from 'remotion';",
    "const Frame=()=>createElement('div',{style:{color:'white'}},String(useCurrentFrame()));",
    "export const compositions=[{id:'Readiness',component:Frame,fps:30,durationInFrames:300,width:320,height:180}];",
  ].join('\n'));
  fs.writeFileSync(path.join(src,'coulisses-timeline.ts'), 'export const timeline=()=>({fps:30,durationInFrames:300,pistes:[]});');
  fs.writeFileSync(path.join(src,'index.ts'),"import {createElement} from 'react'; import {registerRoot,Composition} from 'remotion'; import {compositions} from './coulisses'; registerRoot(()=>createElement(Composition,compositions[0]));");
  const file = createCoulisses({dossier:path.join(dir,'film'),titre:'Readiness',projet:project,composition:'Readiness'});
  const revue = importProject(file).revue, port = await freePort(4460), base='http://127.0.0.1:'+port;
  server=spawn(process.execPath,['studio-server.mjs','--project',revue,'--port',String(port),'--no-open'],{cwd:root,env:process.env,windowsHide:true,stdio:'ignore'});
  await wait(()=>fetch(base+'/api/ping').then(r=>r.ok).catch(()=>false)); await requireSandbox(base,dir);
  page=await launch({port:await freePort(9564)}); await page.goto(base+'/#f=60');
  await page.until("window.__preview && __preview.frameReadiness()?.verified && __preview.frame()===60 && document.querySelector('#previewReadiness').hidden",90000);
  const iframe=code=>page.frameEval('player.html',code);
  const notes=()=>fetch(base+'/api/notes').then(r=>r.json()).then(x=>x.notes);
  await page.eval('window.firstPlayer=__preview');
  await iframe("window.remotion_delayRenderHandles ??= []; window.remotion_delayRenderHandles.push(919100); window.dispatchEvent(new Event('coulisses-readiness')); return true");
  await page.until("!document.querySelector('#previewReadiness').hidden && __preview.frameReadiness()?.reason==='unowned-render-handles'");
  await page.until("__preview.frameReady() && __preview.frameReadiness()?.reason==='stale-unowned-render-handles' && !document.querySelector('#codeWait').classList.contains('on')",15000);
  assert.ok(await page.eval("return !document.querySelector('#previewReadiness').hidden && !__preview.frameReadiness().verified && !__preview.crashed()"));
  pass('Une poignée orpheline libère le voile et conserve un avertissement sur le véritable Player.');
  await click('button[data-tool=comment]');
  const point=await page.eval("const b=document.getElementById('ov').getBoundingClientRect();return [b.x+b.width*.5,b.y+b.height*.5]");
  await page.mouse('mousePressed',...point); await page.mouse('mouseReleased',...point);
  await page.until("document.getElementById('pop').style.display==='block'");
  await iframe("window.remotion_delayRenderHandles=window.remotion_delayRenderHandles.filter(x=>x!==919100); window.dispatchEvent(new Event('coulisses-readiness'));return true");
  await page.until("document.getElementById('previewReadiness').hidden && __preview.frameReadiness().verified");
  await page.eval("document.getElementById('popTx').value='Hologramme vide';document.getElementById('popOk').click()");
  await wait(async()=> (await notes()).some(x=>x.text==='Hologramme vide'));
  const note = (await notes()).find(x=>x.text==='Hologramme vide'), evidence = note.previewReadiness;
  assert.equal(evidence.frame,60); assert.equal(evidence.state,'unverified'); assert.equal(evidence.reason,'stale-unowned-render-handles'); assert.ok(evidence.hash && evidence.version!=null);
  await click('#qsend'); const lotPath=path.join(revue,'lots','001.json'), mdPath=path.join(revue,'lots','001.md');
  await wait(()=>fs.existsSync(lotPath)&&fs.existsSync(mdPath));
  assert.deepEqual(JSON.parse(fs.readFileSync(lotPath,'utf8')).edits[0].previewReadiness,evidence);
  const markdown=fs.readFileSync(mdPath,'utf8'); assert.match(markdown,/Image de l’aperçu non confirmée/); assert.ok(markdown.includes(evidence.hash));
  await click('#mClose'); pass('La note conserve la preuve au moment du geste, puis le JSON et le Markdown du lot la transmettent.');
  await iframe("window.realSnapshot=window.__coulissesReadiness.snapshot; window.__coulissesReadiness.snapshot=()=>({...window.realSnapshot(),activePending:1});window.dispatchEvent(new Event('coulisses-readiness'));return true");
  await page.until("document.getElementById('previewReadiness').innerText.includes('Préparation expirée')",55000);
  assert.ok(await page.eval("return __preview===firstPlayer && !document.getElementById('codeWait').classList.contains('on') && !document.getElementById('codeCrash').classList.contains('on')"));
  await click('#bNote');
  await wait(async()=> (await notes()).some(x=>x.previewReadiness?.state==='expired' && x.previewReadiness.frame===60));
  pass('Une véritable échéance marque les notes et laisse l’aperçu en place.');
  await click('#previewReadiness button');
  await page.until("window.__preview && __preview!==firstPlayer && __preview.frameReadiness()?.verified && document.getElementById('previewReadiness').hidden",90000);
  pass('Le rechargement manuel reconstruit une seule vue, sur une image confirmée.');
  await iframe("const c=document.createElement('canvas');document.body.append(c);c.dispatchEvent(new Event('webglcontextlost',{bubbles:true}));c.remove();return true");
  await page.until("document.getElementById('codeCrash').classList.contains('on')");
  await click('#ceNote');
  await wait(async()=> (await notes()).some(x=>x.previewReadiness?.state==='error' && x.previewReadiness.reason==='webgl'));
  pass('La note de plantage WebGL reste disponible avec le numéro de l’image.');
  console.log(n+' ok, 0 ko');
} catch(error) {console.error(error,page?.logs.slice(-5));console.log(n+' ok, 1 ko');process.exitCode=1;}
finally {
  await page?.close();
  if (server?.exitCode === null) try {execFileSync('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});} catch {}
  if(fs.existsSync(link)) fs.rmSync(link);
  if(path.dirname(dir)===parent) fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:250});
}

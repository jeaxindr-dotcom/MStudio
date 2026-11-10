// An explicitly re-signalled batch remains the same batch and is delivered before older
// unclaimed work. Only an actual CLI acknowledgement changes its visible state.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {launch, requireSandbox} from './cdp.mjs';
import {freePort} from './where.mjs';

const studio=fileURLToPath(new URL('../',import.meta.url)), cache=path.join(studio,'.cache','receipt-v2');
fs.mkdirSync(cache,{recursive:true});const root=fs.mkdtempSync(path.join(cache,'test-'));
Object.assign(process.env,{STUDIO_PROJECTS:path.join(root,'projects.json'), COULISSES_LANG:'fr',
  COULISSES_SETTINGS:path.join(root,'settings.json'),COULISSES_MEDIAS:path.join(root,'medias'),COULISSES_HISTORY_DIR:path.join(root,'history')});
const {importProject}=await import('../lib/projects.mjs');
let p, server, ok=0;
const pass=t=>{ok++;console.log('✓ '+t);};
try {
  const mp4=path.join(root,'test.mp4');execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=s=320x180:r=24:d=2','-c:v','libx264','-pix_fmt','yuv420p',mp4],{windowsHide:true});
  const {revue}=importProject(mp4), port=await freePort(4887), base='http://127.0.0.1:'+port;
  const cli=(...a)=>execFileSync(process.execPath,['studio-cli.mjs',a[0],revue,...a.slice(1)],{cwd:studio,windowsHide:true,encoding:'utf8'});
  // An active but idle watcher, deliberately without a single take.
  fs.writeFileSync(path.join(revue,'studio-agent.json'),JSON.stringify({since:new Date().toISOString(),beat:new Date().toISOString(),waiting:true,agent:{id:'codex',name:'Codex'}}));
  server=spawn(process.execPath,['studio-server.mjs','--project',revue,'--port',String(port),'--no-open'],{cwd:studio,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
  for(let i=0;i<120&&!log.includes(base)&&server.exitCode===null;i++)await sleep(100);assert.ok(log.includes(base),log);
  p=await launch({port:await freePort(9543)});await requireSandbox(base,root);await p.goto(base);
  await p.until("window.__studio && document.querySelector('#agent').textContent.includes('Codex')");
  for(const text of ['Ancienne priorité','Dernière priorité']){
    await p.eval("document.querySelector('#ltabs [data-tab=agent]').click(); document.querySelector('#agentText').value="+JSON.stringify(text)+"; document.querySelector('#agentSend').click()");
    await p.until('document.querySelector("#agentSend").disabled===false && document.querySelector("#agentList").innerText.includes('+JSON.stringify(text)+')');
  }
  assert.match(await p.eval("return document.querySelector('#agentList').innerText"),/en attente de prise en charge/);
  await p.eval("document.querySelector('#ltabs [data-tab=lots]').click()");
  await p.until("document.querySelector('#lots [data-lot=\"2\"] .lot-resignal')");
  assert.equal((await(await fetch(base+'/api/status')).json()).lots.length,2);
  pass('Un heartbeat et deux demandes envoyées laissent deux lots en attente');
  const original=JSON.parse(fs.readFileSync(path.join(revue,'lots','002.json'),'utf8'));
  await p.eval("document.querySelector('#lots [data-lot=\"2\"] .lot-resignal').click()");
  await p.until("document.querySelector('#lots [data-lot=\"2\"]').textContent.includes('Lot resignalé')");
  assert.match(cli('wait','--timeout','2','--agent','codex'),/LOT 2 REÇU/);
  const again=JSON.parse(fs.readFileSync(path.join(revue,'lots','002.json'),'utf8'));
  assert.deepEqual(again.edits.map(x=>x.id),original.edits.map(x=>x.id));
  assert.equal(again.captureState.id,original.captureState.id);assert.equal((await(await fetch(base+'/api/status')).json()).lots.length,2);
  assert.ok(!(await(await fetch(base+'/api/status')).json()).lots[1].claude);
  pass('Resignaler priorise le lot 2 pour wait en conservant son identifiant et ses captures. Lire la sortie ne vaut pas take');
  cli('take','2','--agent','codex');
  await p.until("document.querySelector('#agentWho').textContent.includes('Lot 2 pris en charge par Codex') && document.querySelector('#agent').textContent.includes('Lot 2 pris en charge par Codex') && !document.querySelector('#agentConnect')",15000);
  await p.until("document.querySelector('#lots [data-lot=\"2\"] .st.taken') && !document.querySelector('#lots [data-lot=\"2\"] .lot-resignal')");
  assert.equal((await fetch(base+'/api/lots/resignal',{method:'POST',body:'{"lot":2}'})).status,409);
  assert.match(cli('wait','--timeout','2'),/LOT 1 REÇU/);
  pass('L’accusé take est visible, coupe les relances du lot pris et rend la priorité à l’autre lot');
  await p.key('n','KeyN','n');await p.until("document.activeElement?.matches('#draftList textarea.main')");
  await p.type('Nouvelle annotation');await p.eval("document.activeElement.blur(); document.querySelector('#qsend').click()");
  await p.until("document.querySelector('#modal').style.display==='flex'");
  assert.match(await p.eval("return document.querySelector('#mP1').textContent"),/en attente de prise en charge/);
  assert.equal(await p.eval("return document.querySelector('#modal').classList.contains('received')"),false);
  cli('take','3');await p.until("document.querySelector('#modal').classList.contains('received')",15000);
  pass('Le dialogue des annotations passe de « en attente » à « pris » uniquement après take');
  console.log(ok+' ok, 0 ko');
} catch(e){console.error(e,p?.logs.slice(-4));console.log(ok+' ok, 1 ko');process.exitCode=1;}
finally {await p?.close();if(server&&server.exitCode===null&&!server.signalCode){const done=once(server,'exit');server.kill();await done;}
  if(path.dirname(root)===cache)fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}

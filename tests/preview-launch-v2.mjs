// A V2 hub opening a review already in use. The owner is a simulated server, so
// accepting, rejecting or querying it can never affect an installed studio.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {freePort} from './where.mjs';
import {projectId} from '../lib/projects.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'coulisses-v2-owner-'));
const eps = path.join(temp, 'episodes'), review = path.join(temp, 'Projet importé', 'revue');
fs.mkdirSync(eps);
fs.mkdirSync(review, {recursive: true});
fs.writeFileSync(path.join(review, 'projet.json'), JSON.stringify({studio:'Coulisses', kind:'video', title:'Clip', root:'..', video:{file:'clip.mp4'}}));
const id = projectId(review), registry = path.join(temp, 'registry.json');
fs.writeFileSync(registry, JSON.stringify({projects:[{id, revue:review}]}));
const lock = path.join(review, 'studio.lock.json'), notes = path.join(review, 'notes.json');
const requests = [];
let otherFolder = path.join(temp, 'foreign'), aboutStatus = 200, child, checks = 0;
const fixture = http.createServer((req, res) => {
  requests.push([req.method, req.url]);
  res.writeHead(req.url === '/api/about' ? aboutStatus : 200, {'Content-Type':'application/json'});
  res.end(JSON.stringify(req.url === '/api/ping' ? {studio:true, pid:process.pid, notesFile:notes} : {folder:otherFolder}));
});
const pass = text => { checks++; console.log('✓ ' + text); };
try {
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const target = 'http://127.0.0.1:' + fixture.address().port + '/';
  const initial = JSON.stringify({pid:process.pid, port:fixture.address().port, url:target});
  fs.writeFileSync(lock, initial);
  const port = await freePort(4481), hub = 'http://127.0.0.1:' + port;
  const env = {...process.env, COULISSES_V2_OWN_STUDIOS:'1',
    COULISSES_SETTINGS:path.join(temp,'settings.json'), STUDIO_PROJECTS:registry,
    COULISSES_MEDIAS:path.join(temp, 'medias'), TMP:temp, TEMP:temp};
  delete env.COULISSES_LANG;
  fs.writeFileSync(env.COULISSES_SETTINGS, JSON.stringify({lang:'fr'}));
  child = spawn(process.execPath, ['hub-server.mjs','--port',String(port),'--studio-port','4400','--episodes',eps,'--theatre',temp],
    {cwd:root,env,windowsHide:true,stdio:'ignore'});
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    ready = await fetch(hub + '/api/ping').then(r => r.ok).catch(() => false);
    if (!ready) await delay(80);
  }
  assert.ok(ready, 'temporary hub ready');
  const open = async () => (await fetch(hub + '/api/open?ep=' + id, {method:'POST'})).json();
  let r = await open();
  assert.equal(r.ok, false); assert.match(r.why, /Fermez le studio/); assert.equal(r.url, undefined);
  assert.deepEqual(fs.readdirSync(review).sort(), ['projet.json','studio.lock.json']); assert.equal(fs.readFileSync(lock, 'utf8'), initial);
  pass('La V2 refuse un studio étranger avec un message français, avant toute écriture dans la revue');
  aboutStatus = 503;
  r = await open();
  assert.equal(r.ok, false); assert.match(r.why, /Fermez le studio/);
  pass('Un propriétaire actif dont l’identité est indisponible garde son verrou');
  fs.writeFileSync(env.COULISSES_SETTINGS, JSON.stringify({lang:'en'}));
  r = await open();
  assert.equal(r.ok, false); assert.match(r.why, /Close the studio/);
  pass('Le refus suit la langue anglaise du studio');
  otherFolder = root; aboutStatus = 200;
  r = await open();
  assert.deepEqual(r, {ok:true, url:target});
  assert.equal(fs.readFileSync(lock, 'utf8'), initial);
  pass('Le même worktree reprend le studio propriétaire existant');
  assert.deepEqual([...new Set(requests.map(([m,p]) => m + ' ' + p))].sort(), ['GET /api/about','GET /api/ping']);
  pass('Le propriétaire reçoit uniquement les deux requêtes de lecture');
  await fetch(hub + '/api/quit', {method:'POST'});
  for (let i = 0; i < 40 && child.exitCode === null; i++) await delay(50);
  assert.ok(fixture.listening);
  console.log(`${checks} ok, 0 ko`);
} finally {
  if (child && child.exitCode === null) {
    try { execFileSync('taskkill', ['/PID',String(child.pid),'/T','/F'], {stdio:'ignore',windowsHide:true}); } catch { /* already closed */ }
  }
  fixture.closeAllConnections();
  await new Promise(resolve => fixture.close(resolve));
  fs.rmSync(temp, {recursive:true, force:true, maxRetries:3, retryDelay:200});
}

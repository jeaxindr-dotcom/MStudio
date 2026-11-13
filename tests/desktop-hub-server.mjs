// Run the real studio server with an empty video fixture. No renderer or GUI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {freePort} from './where.mjs';

const studio = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const cache = path.join(studio, '.cache', 'desktop-hub-server');

async function fixture(t, withHub = false) {
  fs.mkdirSync(cache, {recursive: true});
  const root = fs.mkdtempSync(path.join(cache, 'test-'));
  const dataDir = path.join(root, 'profile'), review = path.join(root, 'project', 'revue');
  fs.mkdirSync(dataDir); fs.mkdirSync(review, {recursive: true});
  const projectFile = path.join(review, 'projet.json');
  const projectText = JSON.stringify({studio: 'Coulisses', kind: 'video', title: 'Fixture without media', root: '..', video: {file: 'absent.mp4'}});
  fs.writeFileSync(projectFile, projectText);
  const f = {root, dataDir, review, requests: 0, child: null, output: ''};
  f.ping = {hub: true, app: 'MStudio', pid: process.pid, studioDir: studio, dataDir};
  const hub = http.createServer((req, res) => {
    f.requests++; assert.equal(req.url, '/api/ping');
    res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(f.ping));
  });
  hub.listen(0, '127.0.0.1'); await once(hub, 'listening');
  f.hubUrl = 'http://127.0.0.1:' + hub.address().port + '/';
  f.writeHub = () => fs.writeFileSync(path.join(dataDir, 'hub.json'), JSON.stringify({pid: process.pid, studio, port: hub.address().port, url: f.hubUrl}));
  if (withHub) f.writeHub();
  t.after(async () => {
    if (f.child?.exitCode === null) {
      const exited = once(f.child, 'exit'); f.child.kill(); await exited;
    }
    hub.closeAllConnections(); await new Promise(resolve => hub.close(resolve));
    assert.equal(fs.readFileSync(projectFile, 'utf8'), projectText, 'discovery must not rewrite the project');
    assert.equal(fs.existsSync(path.join(review, 'timeline.json')), false, 'no rendered snapshot is created');
    assert.equal(path.dirname(root), cache);
    fs.rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  });
  const port = await freePort(4740); f.base = 'http://127.0.0.1:' + port;
  f.child = spawn(process.execPath, ['studio-server.mjs', '--project', review, '--port', String(port), '--no-open'], {
    cwd: studio, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, MSTUDIO_APP: '1', MSTUDIO_DATA_DIR: dataDir, COULISSES_LANG: 'fr',
      COULISSES_SETTINGS: path.join(dataDir, 'settings.json'), STUDIO_PROJECTS: path.join(dataDir, 'projets.json'),
      COULISSES_MEDIAS: path.join(root, 'medias'), COULISSES_HISTORY_DIR: path.join(root, 'history')},
  });
  f.child.stdout.on('data', chunk => {f.output += chunk;}); f.child.stderr.on('data', chunk => {f.output += chunk;});
  f.get = async route => (await fetch(f.base + route)).json();
  f.post = (body, headers = {}) => fetch(f.base + '/api/desktop-hub', {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body)});
  for (let i = 0; i < 100; i++) {
    assert.equal(f.child.exitCode, null, f.output);
    const ping = await f.get('/api/ping').catch(() => null);
    if (ping?.pid === f.child.pid && ping.dataDir === dataDir) return f;
    await delay(50);
  }
  throw new Error('Isolated studio did not start: ' + f.output);
}

test('A standalone studio discovers its own native library without --hub', async t => {
  const f = await fixture(t, true);
  const meta = await f.get('/api/meta'), status = await f.get('/api/status');
  assert.equal(meta.hub, f.hubUrl); assert.equal(status.hub, f.hubUrl);
  assert.match(meta.libraryProjectId, /^P[0-9a-f]{8}$/); assert.equal(meta.render, null);
  assert.ok(f.requests >= 1);
});

test('A library appearing later becomes visible to the existing studio', async t => {
  const f = await fixture(t);
  assert.equal((await f.get('/api/meta')).hub, null); assert.equal(f.requests, 0);
  f.writeHub();
  let status;
  for (let i = 0; i < 45; i++) {
    status = await f.get('/api/status'); if (status.hub) break;
    await delay(100);
  }
  assert.equal(status.hub, f.hubUrl, f.output);
  assert.equal((await f.get('/api/meta')).hub, f.hubUrl);
});

test('Attachment requires the exact project ID, verified library and same-origin request', async t => {
  const f = await fixture(t); const id = (await f.get('/api/meta')).libraryProjectId;
  f.writeHub();
  for (const body of [
    {hub: f.hubUrl, projectId: id === 'Pffffffff' ? 'P00000000' : 'Pffffffff'},
    {hub: f.hubUrl, projectId: id.toLowerCase()},
    {hub: 'https://example.com/', projectId: id},
    {hub: f.hubUrl}, {},
  ]) assert.equal((await f.post(body)).status, 409);
  assert.equal((await f.post({hub: f.hubUrl, projectId: id}, {origin: 'https://example.com'})).status, 403);
  assert.equal((await f.post({hub: f.hubUrl, projectId: id}, {'content-type': 'text/plain'})).status, 415);
  const attached = await f.post({hub: f.hubUrl, projectId: id});
  assert.equal(attached.status, 200); assert.deepEqual(await attached.json(), {ok: true, hub: f.hubUrl, projectId: id});
  assert.equal((await f.get('/api/status')).hub, f.hubUrl);
  f.ping.dataDir = path.join(f.root, 'different-profile');
  assert.equal((await f.post({hub: f.hubUrl, projectId: id})).status, 409);
  assert.equal((await f.get('/api/meta')).hub, null, 'a library from another profile must not remain attached');
});

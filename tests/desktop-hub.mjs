import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createDesktopHubResolver} from '../lib/desktop-hub.mjs';

const cache = path.resolve(fileURLToPath(new URL('../.cache/desktop-hub-tests/', import.meta.url)));

async function fixture(t) {
  fs.mkdirSync(cache, {recursive: true});
  const root = fs.mkdtempSync(path.join(cache, 'test-'));
  const appDir = path.join(root, 'App'), dataDir = path.join(root, 'Data');
  fs.mkdirSync(appDir); fs.mkdirSync(dataDir);
  const f = {root, appDir, dataDir, calls: 0, now: 0, status: 200, body: null, redirect: null};
  f.ping = {hub: true, app: 'MStudio', pid: process.pid, studioDir: appDir, dataDir};
  const server = http.createServer((req, res) => {
    f.calls++; assert.equal(req.url, '/api/ping'); assert.equal(req.method, 'GET');
    res.writeHead(f.redirect ? 302 : f.status, f.redirect ? {location: f.redirect} : {'content-type': 'application/json'});
    res.end(f.body ?? JSON.stringify(f.ping));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  f.port = server.address().port; f.url = 'http://127.0.0.1:' + f.port + '/';
  f.record = {pid: process.pid, studio: appDir, port: f.port, url: f.url};
  f.write = overrides => fs.writeFileSync(path.join(dataDir, 'hub.json'), JSON.stringify({...f.record, ...overrides}));
  f.resolver = options => createDesktopHubResolver({appDir, dataDir, now: () => f.now, retryMs: 3000, ...options});
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(root), cache);
    fs.rmSync(root, {recursive: true, force: true, maxRetries: 3});
  });
  return f;
}

test('A real local hub must match the lock PID, installation and profile', async t => {
  const f = await fixture(t); f.write();
  assert.equal(await f.resolver().find(), f.url); assert.equal(f.calls, 1);
  if (process.platform === 'win32') {
    f.write({studio: f.appDir.toUpperCase() + path.sep});
    f.ping.studioDir = f.appDir.toLowerCase() + path.sep; f.ping.dataDir = f.dataDir.toUpperCase();
    assert.equal(await f.resolver().find(), f.url);
  }
});

test('A service with a different identity is never adopted as the library', async t => {
  const f = await fixture(t); f.write(); const original = {...f.ping};
  for (const wrong of [{hub: false}, {hub: 1}, {app: 'Coulisses'}, {pid: process.pid + 1}, {pid: String(process.pid)},
    {studioDir: path.join(f.root, 'AnotherApp')}, {dataDir: path.join(f.root, 'AnotherProfile')}, {studioDir: null}, {dataDir: null}]) {
    f.ping = {...original, ...wrong}; assert.equal(await f.resolver().find(), null, JSON.stringify(wrong));
  }
  f.ping = original; assert.equal(await f.resolver().find(), f.url);
});

test('Invalid lock fields and non-local or decorated URLs are rejected before network access', async t => {
  const f = await fixture(t); let calls = 0;
  const fetchImpl = async () => {calls++; return {ok: true, json: async () => f.ping};};
  for (const invalid of [
    {pid: 0}, {pid: -1}, {pid: '123'}, {pid: 1.5}, {pid: Number.MAX_SAFE_INTEGER + 1},
    {studio: path.join(f.root, 'other')}, {studio: null},
    {url: 'https://127.0.0.1:' + f.port + '/'}, {url: 'http://example.com:' + f.port + '/'},
    {url: 'http://localhost:' + f.port + '/'}, {url: 'http://127.0.0.1.example.com:' + f.port + '/'},
    {url: 'http://user:password@127.0.0.1:' + f.port + '/'},
    {url: f.url + 'elsewhere'}, {url: f.url + '?project=x'}, {url: f.url + '#frame=2'},
    {url: 'not a URL'}, {port: f.port + 1}, {port: String(f.port)},
    {url: 'http://127.0.0.1/', port: 0}, {port: -1}, {port: 70000},
  ]) {
    f.write(invalid); assert.equal(await f.resolver({fetchImpl}).find(), null, JSON.stringify(invalid));
  }
  assert.equal(calls, 0, 'an invalid record must not contact a service');
});

test('Successful discoveries are cached, then revalidated or explicitly refreshed', async t => {
  const f = await fixture(t); f.write(); const resolver = f.resolver();
  assert.equal(await resolver.find(), f.url); assert.equal(f.calls, 1);
  f.status = 503; f.now = 2999;
  assert.equal(await resolver.find(), f.url); assert.equal(f.calls, 1);
  f.now = 3000; assert.equal(await resolver.find(), null); assert.equal(f.calls, 2);
  f.status = 200; assert.equal(await resolver.find(), null); assert.equal(f.calls, 2);
  assert.equal(await resolver.find(true), f.url); assert.equal(f.calls, 3);
});

test('A library started after the standalone studio appears at the next retry', async t => {
  const f = await fixture(t); const resolver = f.resolver();
  assert.equal(await resolver.find(), null); assert.equal(f.calls, 0);
  f.write(); f.now = 2999; assert.equal(await resolver.find(), null); assert.equal(f.calls, 0);
  f.now = 3000; assert.equal(await resolver.find(), f.url); assert.equal(f.calls, 1);
});

test('Malformed lock JSON recovers after correction without recreating the resolver', async t => {
  const f = await fixture(t); const resolver = f.resolver();
  fs.writeFileSync(path.join(f.dataDir, 'hub.json'), '{broken');
  assert.equal(await resolver.find(), null);
  f.write(); assert.equal(await resolver.find(true), f.url);
});

test('Concurrent discoveries share one pending request, including forced refreshes', async t => {
  const f = await fixture(t); f.write(); let calls = 0, release;
  const gate = new Promise(resolve => {release = resolve;});
  const resolver = f.resolver({fetchImpl: async (_url, options) => {
    calls++; assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
    await gate; return {ok: true, json: async () => f.ping};
  }});
  const results = [resolver.find(), resolver.find(), resolver.find(true)];
  release(); assert.deepEqual(await Promise.all(results), [f.url, f.url, f.url]); assert.equal(calls, 1);
});

test('HTTP errors, invalid JSON and redirects do not establish a hub', async t => {
  const f = await fixture(t); f.write(); const resolver = f.resolver();
  f.status = 500; assert.equal(await resolver.find(), null);
  f.status = 200; f.body = 'not json'; assert.equal(await resolver.find(true), null);
  f.body = null; f.redirect = 'http://example.com/'; assert.equal(await resolver.find(true), null);
  f.redirect = null; assert.equal(await resolver.find(true), f.url); assert.equal(f.calls, 4);
});

test('A failed or aborted connection is retried and does not leave a pending promise', async t => {
  const f = await fixture(t); f.write(); let calls = 0;
  const resolver = f.resolver({fetchImpl: async () => {
    if (++calls === 1) throw new DOMException('timed out', 'TimeoutError');
    return {ok: true, json: async () => f.ping};
  }});
  assert.equal(await resolver.find(), null); assert.equal(calls, 1);
  f.now = 3000; assert.equal(await resolver.find(), f.url); assert.equal(calls, 2);
});

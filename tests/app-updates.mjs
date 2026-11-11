import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, readdir, rm, utimes, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createAppUpdates} from '../lib/app-updates.mjs';

const website = 'https://github.com/jeaxindr-dotcom/MStudio/releases';
const api = 'https://api.github.com/repos/jeaxindr-dotcom/MStudio/releases/latest';
const cdn = 'https://release-assets.githubusercontent.com/github-production-release-asset/example';
const payload = Buffer.from('MStudio update fixture');
const sha256 = createHash('sha256').update(payload).digest('hex');

function metadata(version = '0.2.10') {
  const tag = 'mstudio-v' + version, name = `MStudio-Setup-${version}-win-x64.exe`;
  return {tag_name: tag, draft: false, prerelease: false, assets: [{
    name, state: 'uploaded', browser_download_url: `${website}/download/${tag}/${name}`, digest: 'sha256:' + sha256, size: payload.length,
  }]};
}
async function directory(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mstudio-update-test-'));
  t.after(() => rm(dir, {recursive: true, force: true, maxRetries: 4, retryDelay: 50}));
  return dir;
}
function mockFetch(data, body = () => new Response(payload)) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    if (url === api) {
      assert.equal(options.redirect, 'error');
      return Response.json(data);
    }
    assert.equal(options.redirect, 'manual');
    if (url === data.assets[0].browser_download_url) return Response.redirect(cdn, 302);
    assert.equal(url, cdn);
    return body();
  };
  return {fetchImpl, calls};
}
async function settled(updater) {
  for (let n = 0; n < 500 && updater.state().status === 'downloading'; n++) await delay(10);
  assert.notEqual(updater.state().status, 'downloading');
  return updater.state();
}

test('Only a newer stable desktop version is offered, with numeric comparison', async t => {
  const dir = await directory(t);
  for (const version of ['0.2.10', '0.2.11', '0.10.0', '1.0.0']) {
    const updates = createAppUpdates({version, dir, ...mockFetch(metadata())});
    assert.equal((await updates.check()).status, 'current');
    assert.throws(() => updates.download());
    await assert.rejects(updates.verifiedInstaller());
  }
  const updates = createAppUpdates({version: '0.2.9', dir, ...mockFetch(metadata())});
  const result = await updates.check();
  assert.equal(result.status, 'available');
  assert.equal(result.currentVersion, '0.2.9'); assert.equal(result.latestVersion, '0.2.10');
  assert.equal(result.releaseUrl, website + '/tag/mstudio-v0.2.10');
});

test('Metadata and availability come from the stable release and its exact public Windows asset', async t => {
  const dir = await directory(t);
  const rejected = [
    data => {data.draft = true;}, data => {data.prerelease = true;},
    data => {data.tag_name = 'v0.2.10';}, data => {data.tag_name = 'mstudio-v0.2.10-rc1';},
    data => {data.assets = [];}, data => {data.assets.push(data.assets[0]);},
    data => {data.assets[0].name = '../MStudio.exe';},
    data => {data.assets[0].browser_download_url = 'https://example.org/MStudio.exe';},
    data => {data.assets[0].size = -1;}, data => {delete data.assets[0].digest;},
    data => {data.assets[0].digest = 'sha256:1234';}, data => {data.assets[0].state = 'new';},
  ];
  for (const change of rejected) {
    const data = metadata(); change(data);
    const updates = createAppUpdates({version: '0.2.9', dir, ...mockFetch(data)});
    assert.equal((await updates.check()).status, 'error');
    assert.equal(updates.state().latestVersion, null);
    assert.throws(() => updates.download());
  }
});

test('One streaming download serves concurrent clicks; only verified bytes are published', async t => {
  const dir = await directory(t), data = metadata();
  let writer;
  const network = mockFetch(data, () => new Response(new ReadableStream({start(controller) { writer = controller; controller.enqueue(payload.subarray(0, 3)); }})));
  const updates = createAppUpdates({version: '0.2.9', dir, ...network});
  await Promise.all([updates.check(), updates.check()]);
  assert.equal(network.calls.filter(url => url === api).length, 1);
  assert.equal(updates.download().status, 'downloading'); updates.download();
  for (let n = 0; n < 100 && updates.state().downloadedBytes < 3; n++) await delay(10);
  assert.equal(updates.state().downloadedBytes, 3);
  assert.equal((await updates.check()).status, 'downloading');
  assert.equal(network.calls.filter(url => url === cdn).length, 1);
  assert.ok(!(await readdir(dir)).includes(data.assets[0].name));
  await assert.rejects(updates.verifiedInstaller());
  writer.enqueue(payload.subarray(3)); writer.close();
  const result = await settled(updates);
  assert.equal(result.status, 'ready'); assert.equal(result.totalBytes, payload.length);
  const item = await updates.verifiedInstaller();
  assert.deepEqual(item, {version: '0.2.10', sha256, path: path.join(dir, data.assets[0].name)});
  assert.deepEqual(await readFile(item.path), payload);
  if (process.platform === 'win32') assert.match(await readFile(item.path + ':Zone.Identifier', 'utf8'), /ZoneId=3/);
  assert.equal(updates.download().status, 'ready');
  const another = createAppUpdates({version: '0.2.9', dir, ...network});
  assert.equal((await another.check()).status, 'ready');
  assert.equal(network.calls.filter(url => url === cdn).length, 1);
  await writeFile(item.path, Buffer.alloc(payload.length));
  await assert.rejects(another.verifiedInstaller());
  assert.equal(another.state().errorCode, 'integrity');
});

test('Damaged or interrupted downloads are discarded and retry succeeds', async t => {
  const dir = await directory(t), data = metadata();
  const failures = [
    () => new Response(payload.subarray(2)),
    () => new Response(Buffer.alloc(payload.length)),
    () => new Response(Buffer.concat([payload, Buffer.from('extra')])),
    () => {throw new Error('network unavailable');},
  ];
  const updates = createAppUpdates({version: '0.2.9', dir, ...mockFetch(data, () => failures.length ? failures.shift()() : new Response(payload))});
  await updates.check();
  for (let n = 0; n < 4; n++) {
    updates.download();
    assert.equal((await settled(updates)).status, 'error');
    assert.ok(!(await readdir(dir)).includes(data.assets[0].name));
    await assert.rejects(updates.verifiedInstaller());
  }
  updates.download();
  assert.equal((await settled(updates)).status, 'ready');
  assert.deepEqual(await readFile((await updates.verifiedInstaller()).path), payload);
});

test('An asset redirect cannot move the download outside GitHub release storage', async t => {
  const dir = await directory(t), data = metadata();
  for (const target of ['http://release-assets.githubusercontent.com/file', 'https://github.com/a/b', 'https://release-assets.githubusercontent.com.example.org/file', 'https://u:p@objects.githubusercontent.com/file']) {
    const visited = [];
    const fetchImpl = async url => {
      visited.push(url);
      return url === api ? Response.json(data) : Response.redirect(target, 302);
    };
    const updates = createAppUpdates({version: '0.2.9', dir, fetchImpl});
    await updates.check(); updates.download();
    assert.equal((await settled(updates)).errorCode, 'redirect');
    assert.deepEqual(visited, [api, data.assets[0].browser_download_url]);
  }
});

test('A failed refresh clears previously offered release metadata', async t => {
  const dir = await directory(t), data = metadata();
  let offline = false;
  const fetchImpl = async () => offline ? new Response('', {status: 503}) : Response.json(data);
  const updates = createAppUpdates({version: '0.2.9', dir, fetchImpl});
  await updates.check(); offline = true;
  assert.equal((await updates.check()).errorCode, 'http');
  assert.equal(updates.state().releaseUrl, null); assert.throws(() => updates.download());
});

test('A new download reclaims past updates while preserving installation state', async t => {
  const dir = await directory(t), data = metadata(), previous = 'MStudio-Setup-0.2.9-win-x64.exe';
  const abandoned = previous + '.b4d3f04b-6794-4040-94c1-d5575ac21270.part';
  const receipt = 'install-state.json', evidence = '{"status":"done"}';
  await writeFile(path.join(dir, receipt), evidence);
  await writeFile(path.join(dir, previous), 'earlier version'); await writeFile(path.join(dir, abandoned), 'incomplete');
  await utimes(path.join(dir, abandoned), new Date(0), new Date(0));
  const updates = createAppUpdates({version:'0.2.9', dir, ...mockFetch(data)});
  await updates.check(); updates.download(); assert.equal((await settled(updates)).status,'ready');
  assert.deepEqual((await readdir(dir)).sort(), [data.assets[0].name,receipt].sort());
  assert.equal(await readFile(path.join(dir,receipt),'utf8'),evidence);
});

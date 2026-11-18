// Run with node tests/page-refresh.mjs. Both servers and the browser use a private project/profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {once} from 'node:events';
import {execFileSync, spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {freePort} from './where.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'mstudio-refresh-'));
Object.assign(process.env, {
  MSTUDIO_APP:'1', MSTUDIO_DATA_DIR:path.join(fixture, 'profile'),
  COULISSES_SETTINGS:path.join(fixture, 'settings.json'), COULISSES_LANG:'fr',
  STUDIO_PROJECTS:path.join(fixture, 'projects.json'),
});
const children = [];
let page;

async function startServer(filename, args, ready, port) {
  const child = spawn(process.execPath, [path.join(repo, filename), '--port', String(port), ...args],
    {cwd:repo, windowsHide:true, stdio:['ignore','pipe','pipe']});
  children.push(child);
  let log = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log += chunk; });
  for (let i = 0; i < 300 && child.exitCode === null; i++) {
    if (ready.test(log)) return `http://127.0.0.1:${port}`;
    await delay(100);
  }
  throw new Error(`${filename} did not start: ${log}`);
}

async function selectFileItem(id = 'reload') {
  for (const selector of ['#menubar > button', `.mb-item[data-id="${id}"]`]) {
    const [x, y] = await page.eval(`const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2];`);
    await page.mouse('mousePressed', x, y);
    await page.mouse('mouseReleased', x, y);
  }
}

async function embeddedLibrary(hub, projectId) {
  const {frameTree} = await page.send('Page.getFrameTree');
  const frame = frameTree.childFrames?.find(child => child.frame.url.startsWith(hub + '/'))?.frame;
  if (!frame) return null;
  const {executionContextId} = await page.send('Page.createIsolatedWorld', {frameId:frame.id, worldName:'refresh-test'});
  const selector = `.card[data-id="${projectId}"]`;
  const {result} = await page.send('Runtime.evaluate', {contextId:executionContextId, returnByValue:true,
    expression:`document.querySelector(${JSON.stringify(selector)}) ? performance.timeOrigin : null`});
  return result.value;
}

async function pressF5() {
  const key = {key:'F5', code:'F5', windowsVirtualKeyCode:116, nativeVirtualKeyCode:116};
  await page.send('Input.dispatchKeyEvent', {type:'rawKeyDown', ...key});
  await page.send('Input.dispatchKeyEvent', {type:'keyUp', ...key});
}

async function checkRefresh(label, action, ready) {
  const before = await page.eval('return performance.timeOrigin');
  await action();
  for (let i = 0; i < 100; i++) {
    // Navigation can destroy the old JavaScript context in the middle of a poll.
    if (await page.eval(`return performance.timeOrigin > ${before} && (${ready})`).catch(() => false)) return;
    await delay(100);
  }
  assert.fail(`${label} did not reload the page and restore its state`);
}

try {
  const {importProject} = await import('../lib/projects.mjs');
  const {launch} = await import('./cdp.mjs');
  const video = path.join(fixture, 'refresh.mp4');
  execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','color=s=128x72:r=30:d=4','-pix_fmt','yuv420p','-c:v','libx264', video], {windowsHide:true});
  const project = importProject(video);
  const hub = await startServer('hub-server.mjs', [], /HUB_READY/, await freePort(4780));
  const studio = await startServer('studio-server.mjs', ['--project', project.revue, '--hub', hub, '--no-open'], /Ouvre : http/, await freePort(4800));
  // Only this local fixture is exercised. Software compositing keeps this UI test off the production renderer's GPU.
  page = await launch({port:await freePort(9680), args:['--disable-gpu'], renderActivityPorts:[Number(new URL(studio).port)]});
  await page.goto(studio);
  await page.until('window.__studio && document.querySelector("#v").readyState >= 2');
  for (const [label, action, frame] of [['File menu', selectFileItem, 37], ['F5', pressF5, 84]]) {
    const draft = `Unsent message (${label})`;
    await page.eval(`document.querySelector('#v').currentTime = (${frame}+0.5)/30;
      const field = document.querySelector('#agentText'); field.value = ${JSON.stringify(draft)}; field.focus(); field.dispatchEvent(new Event('input',{bubbles:true}));`);
    await page.until(`__studio.state().frame === ${frame}`);
    await checkRefresh(`Studio ${label}`, action,
      `window.__studio && __studio.state().frame === ${frame} && document.querySelector('#agentText').value === ${JSON.stringify(draft)}`);
    console.log(`Studio ${label}: page reloaded, frame ${frame} and unsent message restored`);
  }
  await selectFileItem('home');
  await page.until('document.querySelector("#hubOv.on")');
  const projectTime = await page.eval('return performance.timeOrigin');
  let hubTime = null;
  for (let i = 0; !hubTime && i < 100; i++) { hubTime = await embeddedLibrary(hub, project.id); await delay(100); }
  assert.ok(hubTime, 'The fixture project appears in the embedded library');
  // WebView2 dispatches F5 to the top-level command even when the embedded library has focus.
  await page.eval('window.MStudioRefreshPage()');
  let reloaded = false;
  for (let i = 0; !reloaded && i < 100; i++) {
    reloaded = await embeddedLibrary(hub, project.id).catch(() => null) > hubTime;
    if (!reloaded) await delay(100);
  }
  assert.ok(reloaded, 'The embedded library actually reloads and repopulates its projects');
  assert.equal(await page.eval('return performance.timeOrigin'), projectTime, 'Refreshing the visible library preserves the open project');
  assert.equal(await page.eval('return __studio.state().frame'), 84);
  console.log('Embedded library: desktop refresh repopulates it and preserves the open project');
  await page.goto(hub);
  const hubReady = `document.querySelector('#menubar > button')?.textContent === 'Fichier'`;
  await page.until(hubReady);
  for (const [label, action] of [['File menu', selectFileItem], ['F5', pressF5]]) {
    await checkRefresh(`Hub ${label}`, action, hubReady);
    console.log(`Hub ${label}: library reloaded`);
  }
} finally {
  await page?.close();
  for (const child of children.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const ended = once(child, 'exit'); child.kill(); await ended;
  }
  fs.rmSync(fixture, {recursive:true, force:true, maxRetries:4, retryDelay:150});
}

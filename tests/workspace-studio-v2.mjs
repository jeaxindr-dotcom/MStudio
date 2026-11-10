// Real studio entry point, a test-owned MP4, an isolated Chrome profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {freePort} from './where.mjs';
import {launch, requireSandbox} from './cdp.mjs';

const studio = fileURLToPath(new URL('../', import.meta.url));
const parent = path.join(studio, '.cache', 'workspace-v2');
fs.mkdirSync(parent, {recursive: true});
const run = fs.mkdtempSync(path.join(parent, 'run-'));
const language = process.env.WORKSPACE_TEST_LANG || 'fr';
Object.assign(process.env, {
  COULISSES_LANG: language,
  COULISSES_SETTINGS: path.join(run, 'settings.json'),
  COULISSES_MEDIAS: path.join(run, 'medias'),
  COULISSES_HISTORY_DIR: path.join(run, 'history'),
  STUDIO_PROJECTS: path.join(run, 'projects.json'),
});
const {importProject} = await import('../lib/projects.mjs');
const movie = path.join(run, 'Studio.mp4');
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', movie], {windowsHide: true});
const port = await freePort(4341), url = 'http://127.0.0.1:' + port;
const server = spawn(process.execPath, ['studio-server.mjs', '--project', importProject(movie).revue, '--port', String(port), '--no-open'],
  {cwd: studio, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
let output = '', page, passes = 0;
server.stdout.on('data', chunk => output += chunk);
server.stderr.on('data', chunk => output += chunk);
const test = async (label, action) => { await action(); passes++; console.log('✓ ' + label); };
try {
  for (let i = 0; i < 150 && !output.includes(url); i++) await delay(100);
  assert.match(output, new RegExp('127\\.0\\.0\\.1:' + port));
  await requireSandbox(url, run);
  page = await launch({port: await freePort(9451)});
  const read = expression => page.eval('return ' + expression);
  const click = selector => page.eval('document.querySelector(' + JSON.stringify(selector) + ').click()');
  const visible = id => read('document.getElementById(' + JSON.stringify(id) + ').getBoundingClientRect().width > 0');
  const width = id => read('document.getElementById(' + JSON.stringify(id) + ').getBoundingClientRect().width');
  const ready = async () => {
    await page.goto(url);
    await page.until('window.CoulissesWorkspace && document.querySelector("#v").readyState >= 2');
  };
  await page.size(1280, 800); await ready();
  await test('Review shows both docks and a monitor of at least 540 px at 1280 × 800', async () => {
    assert.equal(await read('document.body.dataset.workspace'), 'review');
    for (const id of ['lside', 'side', 'tlpanel', 'studioCommands']) assert.ok(await visible(id), id);
    assert.ok(await width('viewer') >= 540);
    await click('#tabs [data-tab="notes"]');
  });
  const initialWidth = await width('viewer');
  await test('The workspace chooser opens from the header and controls the actual editing surface', async () => {
    await click('#workspaceButton');
    assert.ok(await read('document.querySelector("#workspaceDialog").matches(":modal")'));
    await click('[name="workspace-mode"][value="edit"]');
    assert.equal(await visible('lside'), false); assert.ok(await visible('side'));
    assert.equal(await read('__studio.state().tabR'), 'composition');
    assert.ok(await width('viewer') > initialWidth + 200);
    await click('[data-panel="timeline"]'); assert.equal(await visible('tlpanel'), false);
    await page.key('Escape', 'Escape');
    assert.equal(await read('document.querySelector("#workspaceDialog").open'), false);
    await page.until('document.activeElement.id === "workspaceButton"', 1500);
  });
  await test('Guides are drawn inside the media and let gestures pass through', async () => {
    await click('#guideSafe'); await click('#guideThirds');
    const result = await read(`(() => {
      const e = document.getElementById('frameGuides'), p = e.parentElement.getBoundingClientRect(), inner = e.querySelector('.inner').getBoundingClientRect();
      return [e.classList.contains('thirds'), getComputedStyle(e).pointerEvents, (inner.left - p.left) / p.width, inner.width / p.width];
    })()`);
    assert.equal(result[0], true); assert.equal(result[1], 'none');
    assert.ok(Math.abs(result[2] - .1) < .002); assert.ok(Math.abs(result[3] - .8) < .002);
  });
  await test('Each layout and the guide toggles survive a reload', async () => {
    await ready();
    assert.equal(await read('document.body.dataset.workspace'), 'edit');
    assert.equal(await visible('lside'), false); assert.equal(await visible('tlpanel'), false);
    assert.equal(await read('document.getElementById("guideSafe").getAttribute("aria-pressed")'), 'true');
    await read("CoulissesWorkspace.setMode('review')");
    assert.ok(await visible('lside')); assert.ok(await visible('tlpanel'));
    assert.equal(await read('__studio.state().tabR'), 'notes');
  });
  await test('Projection releases the full area and grading remains reachable', async () => {
    await read("CoulissesWorkspace.setMode('screen')");
    for (const id of ['lside', 'side', 'tlpanel', 'rail']) assert.equal(await visible(id), false, id);
    assert.ok(await width('viewer') > 1250);
    await click('[data-page="grade"]');
    assert.ok(await visible('cgLooks')); assert.ok(await visible('cgScenes')); assert.ok(await visible('studioCommands'));
    await read("CoulissesWorkspace.showPanel('right')");
    assert.equal(await read('document.body.classList.contains("cg")'), false);
    assert.ok(await visible('side'));
  });
  await test('Portrait and touch landscape keep image and controls in the viewport', async () => {
    await page.send('Emulation.setTouchEmulationEnabled', {enabled:true, maxTouchPoints:5});
    for (const [w, h] of [[820,1180], [1180,820]]) {
      await page.size(w, h);
      await page.until('document.getElementById("media").getBoundingClientRect().width > 490');
      assert.ok(await read('document.documentElement.scrollWidth <= innerWidth + 1'));
      assert.ok(await visible('workspaceButton')); assert.ok(await visible('studioCommands')); assert.ok(await visible('tlpanel'));
    }
  });
  await test('Narrow header actions have visible accessible names in the selected language', async () => {
    await page.size(390, 844);
    const button = await read('document.getElementById("studioCommands").getBoundingClientRect().toJSON()');
    assert.ok(button.left >= 0 && button.right <= 390);
    assert.ok(await read('document.getElementById("studioCommands").getAttribute("aria-label")'));
    assert.match(await read('document.getElementById("workspaceButton").getAttribute("aria-label")'), language === 'en' ? /Workspaces/i : /Espaces de travail/i);
    assert.equal(await read('document.documentElement.scrollWidth <= innerWidth + 1'), true);
  });
  await test('A new note reveals its editor from a hidden dock', async () => {
    await page.size(1280, 800);
    await read("CoulissesWorkspace.setMode('screen')");
    assert.equal(await visible('lside'), false);
    await page.key('n','KeyN','n');
    await page.until("document.querySelector('#draftList textarea.main') === document.activeElement");
    assert.ok(await visible('lside')); assert.equal(await read('__studio.state().tabL'), 'queue');
  });
  console.log(passes + ' ok, 0 ko');
} finally {
  if (page) await page.close();
  if (server.exitCode === null) {
    try { execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], {windowsHide: true, stdio:'ignore'}); } catch {}
  }
}

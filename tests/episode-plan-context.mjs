// Exercise the shipped source selector, note context and notice without a render.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const helper = read('page/studio/10-plan-context.js');
const preview = read('page/studio/01-preview.js');
const contextSource = preview.slice(preview.indexOf('  function contextAt('), preview.indexOf('  // ---------- the 3D object'));
const plan = name => ({frames: 300, fps: 30, sets: [{name, inT: 0, inDur: 0, outT: null, outDur: 0}],
  curtain: [{t: 0, open: true}], cutaways: [], says: [{id: name, actor: 'narrator', text: name + ' dialogue', t: 0, dur: 10}]});
function fixture(early = false) {
  const span = {textContent: ''}, paragraph = {textContent: ''};
  const summary = {title: '', querySelector: () => span, focus() {}};
  const notice = {hidden: true, open: false, querySelector: selector => selector === 'summary' ? summary : paragraph,
    contains: () => false, addEventListener() {}};
  const announcement = {textContent: ''}, warning = {textContent: 'Notes unreadable', style: {display: 'block'}};
  const nodes = {'#episodePlanNotice': notice, '#episodePlanAnnouncement': announcement, '#warn': warning,
    '#srcCode': {focus() {}}, '#srcVideo': {focus() {}}};
  const c = vm.createContext({META: {features: {code: true}, snapshotMatches: false}, SNAP: null, LIVE: null,
    mode: 'code', codeVer: 1, STATUS: {code: {status: 'ready', version: 1}, timeline: {status: 'building', version: 0}, plans: {}}, PROJ: false, FPS: 30, FR: true, liveVer: -1,
    document: {addEventListener() {}, activeElement: null}, $: key => nodes[key],
    loadLive: async () => {}, loadCode: async () => {}, onStatus() {}, setMode: async mode => {c.mode = mode;},
    who: value => value, T: (key, values) => values?.text || values?.name || key,
    clipsAt: () => [{tr: {type: 'band'}, c: {label: 'Project scene'}}]});
  vm.runInContext((early ? 'globalThis.earlyContext = contextAt(30);\n' : '') + helper + '\n' + contextSource, c);
  return {c, notice, warning, paragraph, announcement};
}

test('The initial animation tick may call note context before the helper initializes', () => {
  const {c} = fixture(true);
  assert.equal(c.earlyContext.scene, '');
  c.META = null;
  Object.defineProperty(c, 'STATUS', {get() {throw new Error('STATUS is not initialized');}});
  assert.equal(c.selectEpisodeContextPlan(), null);
});

test('Opening a code-only episode waits for its timeline, with no export warning', async () => {
  const {c, notice} = fixture();
  c.updateEpisodePlanNotice(); assert.equal(notice.hidden, true);
  await c.loadLive(); assert.equal(notice.hidden, true, 'building is not a missing plan');
  c.LIVE = plan('Current scene'); c.liveVer = 1; c.STATUS.timeline = {status: 'ready', version: 1};
  await c.loadLive(); assert.equal(notice.hidden, true);
  assert.equal(c.contextAt(30).scene, 'Current scene');
  assert.equal(c.contextAt(30).lines[0], 'Current scene dialogue');
  assert.equal(c.SNAP, null, 'a code timeline must not become an export snapshot');
});

test('Code uses its current timeline even when a stale export snapshot exists', async () => {
  const {c, notice} = fixture(); c.SNAP = plan('Old export'); c.LIVE = plan('Current code');
  c.META.render = {size: 10}; c.STATUS.timeline = {status: 'ready', version: 1}; c.liveVer = 1;
  await c.loadLive(); assert.equal(notice.hidden, true); assert.equal(c.contextAt(30).scene, 'Current code');
  await c.setMode('video'); assert.equal(notice.hidden, false); assert.equal(c.contextAt(30).scene, '');
  await c.setMode('code'); assert.equal(notice.hidden, true); assert.equal(c.contextAt(30).scene, 'Current code');
});

test('An MP4 retains the matching export context instead of current code', async () => {
  const {c, notice} = fixture(); c.META.render = {size: 10}; c.META.snapshotMatches = true;
  c.SNAP = plan('Rendered scene'); c.LIVE = plan('Edited scene'); c.STATUS.timeline.status = 'ready';
  await c.loadLive(); await c.setMode('video');
  assert.equal(notice.hidden, true); assert.equal(c.contextAt(30).scene, 'Rendered scene');
});

test('An MP4 without snapshot may use live context only with matching plan identity and version', async () => {
  const {c, notice} = fixture(); c.META.render = {size: 10}; c.LIVE = plan('Same plan');
  c.STATUS = {code: {status: 'ready', version: 1}, timeline: {status: 'ready', version: 4}, plans: {code: 'same', video: 'same'}}; c.liveVer = 4;
  await c.loadLive(); await c.setMode('video');
  assert.equal(notice.hidden, true); assert.equal(c.contextAt(30).scene, 'Same plan');
  c.STATUS.plans.video = 'different'; c.onStatus();
  assert.equal(notice.hidden, false); assert.equal(c.contextAt(30).scene, '');
  c.STATUS.plans.video = 'same'; c.STATUS.timeline.version = 5; c.onStatus();
  assert.equal(notice.hidden, false); assert.equal(c.contextAt(30).scene, '', 'do not use an older loaded timeline');
  c.liveVer = 5; await c.loadLive(); assert.equal(notice.hidden, true);
});

test('A plan load failure is shown, then removed when a later timeline arrives', async () => {
  const {c, notice, paragraph} = fixture(); c.STATUS.timeline.status = 'error';
  await c.loadLive(); assert.equal(notice.hidden, false); assert.match(paragraph.textContent, /plan du code/);
  c.LIVE = plan('Recovered'); c.STATUS.timeline = {status: 'ready', version: 1}; c.liveVer = 1;
  await c.loadLive(); assert.equal(notice.hidden, true);
});

test('Plan refresh never hides or overwrites an unreadable-notes warning', async () => {
  const {c, warning} = fixture(); c.STATUS.timeline.status = 'error'; await c.loadLive();
  c.LIVE = plan('Ready'); c.STATUS.timeline.status = 'ready'; c.onStatus();
  assert.deepEqual(warning, {textContent: 'Notes unreadable', style: {display: 'block'}});
});

test('Generic project context remains based on its montage tracks', async () => {
  const {c, notice} = fixture(); c.PROJ = true; c.STATUS.timeline.status = 'error'; await c.loadLive();
  assert.equal(notice.hidden, true); assert.equal(c.contextAt(30).scene, 'Project scene');
});

test('Empty optional episode tracks do not throw or invent dialogue', () => {
  const {c} = fixture(); c.LIVE = {frames: 300, fps: 30};
  c.STATUS.timeline = {status: 'ready', version: 1}; c.liveVer = 1;
  assert.equal(c.contextAt(30).scene, ''); assert.equal(c.contextAt(30).lines.length, 0);
});

test('Code context never reuses an older or failed timeline during a rebuild', async () => {
  const {c, notice} = fixture(); c.LIVE = plan('Old'); c.liveVer = 1;
  c.STATUS.timeline = {status: 'ready', version: 1}; await c.loadLive();
  assert.equal(c.contextAt(30).scene, 'Old');
  c.STATUS.timeline = {status: 'building', version: 1}; c.onStatus();
  assert.equal(c.contextAt(30).scene, ''); assert.equal(notice.hidden, true);
  c.STATUS.timeline = {status: 'error', version: 1}; c.onStatus();
  assert.equal(c.contextAt(30).scene, ''); assert.equal(notice.hidden, false);
  c.STATUS.timeline = {status: 'ready', version: 2};
  const loading = c.loadLive();
  assert.equal(c.contextAt(30).scene, ''); assert.equal(notice.hidden, true, 'wait for the current timeline fetch');
  c.LIVE = plan('New'); c.liveVer = 2; await loading;
  assert.equal(c.contextAt(30).scene, 'New'); assert.equal(notice.hidden, true);
});

test('A newer timeline cannot label the old player kept on screen during playback', async () => {
  const {c, notice} = fixture(); c.LIVE = plan('New scene'); c.liveVer = 2;
  c.STATUS.timeline = {status: 'ready', version: 2}; c.STATUS.code = {status: 'ready', version: 2};
  await c.loadLive(); assert.equal(c.contextAt(30).scene, ''); assert.equal(notice.hidden, true);
  c.codeVer = 2; await c.loadCode();
  assert.equal(c.contextAt(30).scene, 'New scene'); assert.equal(notice.hidden, true);
  c.STATUS.code.status = 'error'; c.onStatus(); assert.equal(c.contextAt(30).scene, '');
});

test('Native cutaways retain their identifier when no display name is supplied', () => {
  const {c} = fixture(); c.LIVE = {...plan('Scene'), cutaways: [{id: 'shot-01', t: 0, dur: 2}]};
  c.STATUS.timeline = {status: 'ready', version: 1}; c.liveVer = 1;
  assert.equal(c.contextAt(30).scene, 'shot-01');
});

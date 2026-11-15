// Exercise the shipped remapping API and client without opening a real project.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import { anchorsOf, assessFrameMapping, mapFrames, NOTE_MAPPING_VERSION } from '../lib/plans.mjs';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const client = read('page/studio/02-notes.js');
const following = client.slice(client.indexOf('  const viewPlan ='));
const server = read('studio-server.mjs');
const route = server.slice(server.indexOf("    if (pn === '/api/remap'"), server.indexOf('    // the dictation:'));
const clone = value => JSON.parse(JSON.stringify(value));
const note = (id = 'a') => ({id, frame: 900, end: null, plan: 'new', source: 'code',
  at: {frame: 100, end: null, plan: 'old'}, text: 'Please correct this moment',
  thread: [{id: 'reply', text: 'This has been fixed', at: '2026-01-02T00:00:00Z'}],
  images: [{file: 'images/mark.png'}], lot: 3, status: 'done'});

function fixture(input = [note()]) {
  const calls = [], saved = [], notices = [];
  const c = vm.createContext({notes: clone(input), NOTES_OK: true, repliesTxt: '{}', HIST: {back: [], fwd: []}, mode: 'code',
    META: {plans: {mappingVersion: NOTE_MAPPING_VERSION}, render: null},
    STATUS: {plans: {code: 'new', video: 'video', mappingVersion: NOTE_MAPPING_VERSION},
      code: {status: 'ready', version: 1}, timeline: {status: 'ready', version: 1}},
    LIVE: {scene: 'Current scene'}, codeVer: 1, REPLIES: {notes: {}},
    byId: id => c.notes.find(n => n.id === id),
    postJson: async (url, body) => {
      calls.push({url, body});
      return c.respond ? c.respond(body) : {ok: true, to: body.to, mappingVersion: NOTE_MAPPING_VERSION,
        notes: body.notes.map(n => ({id: n.id, frame: n.frame + 12, end: n.end == null ? null : n.end + 12}))};
    },
    persist: () => saved.push(clone(c.notes)), renderAll() {},
    contextAt: frame => ({scene: c.LIVE ? `${c.LIVE.scene} at ${frame}` : ''}),
    fetch: async () => ({json: async () => c.nextTimeline}), adoptTimelineDuration: () => false, buildLanes() {}, draw() {}, renderInspector() {}, showShot() {},
    setTimeout: callback => callback(), setSave: (message, state) => notices.push({message, state}),
    TN: key => key});
  vm.runInContext(following, c);
  vm.runInContext('liveVer = 1', c);
  return {c, calls, saved, notices};
}

test('Migrates an old automatic position once, preserving replies, marks and original anchor', async () => {
  const {c, calls, saved} = fixture();
  const original = clone(c.notes[0]);
  await c.followPlans();
  assert.equal(c.notes[0].frame, 112);
  assert.equal(c.notes[0].followVersion, NOTE_MAPPING_VERSION);
  for (const field of ['id', 'text', 'at', 'thread', 'images', 'lot', 'status']) assert.deepEqual(clone(c.notes[0][field]), original[field]);
  assert.equal(c.notes[0].before[0].frame, 900);
  await c.followPlans();
  assert.equal(calls.length, 1); assert.equal(saved.length, 1);
});

test('Recalage waits for the current timeline and resumes when it is loaded', async () => {
  for (const stale of [false, true]) {
    const {c, calls, saved} = fixture();
    c.notes[0].context = {scene: 'Original context'};
    if (stale) c.STATUS.timeline.version = 2; else c.LIVE = null;
    await c.followPlans();
    assert.equal(calls.length, 0); assert.equal(saved.length, 0);
    assert.equal(c.notes[0].context.scene, 'Original context');
    c.nextTimeline = {status: 'ready', version: c.STATUS.timeline.version, data: {scene: 'Correct scene'}};
    await c.loadLive();
    await c.followPlans();
    assert.equal(c.notes[0].frame, 112);
    assert.equal(c.notes[0].context.scene, 'Correct scene at 112');
  }
});

test('Recalage also waits for the player version used by note context', async () => {
  const {c, calls} = fixture(); c.notes[0].context = {scene: 'Original context'};
  c.codeVer = 0;
  await c.followPlans(); assert.equal(calls.length, 0);
  assert.equal(c.notes[0].context.scene, 'Original context');
  c.codeVer = 1;
  await c.followPlans(); assert.equal(c.notes[0].frame, 112);
  assert.equal(c.notes[0].context.scene, 'Current scene at 112');
});

test('An unchanged status still retries remapping after initial player loading', async () => {
  const {c, calls} = fixture(); c.codeVer = 0;
  const poll = client.slice(client.indexOf("  let repliesTxt = ''"), client.indexOf('  function applyRemaps()'));
  const status = JSON.stringify(c.STATUS);
  c.fetch = async url => ({ok: true, text: async () => url === '/api/status' ? status : '{"notes":{}}'});
  c.onStatus = () => {}; c.applyRemaps = () => {}; c.setTimeout = () => 1;
  vm.runInContext(poll, c);
  await c.pollReplies(); assert.equal(calls.length, 0);
  c.codeVer = 1;
  await c.pollReplies();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(c.notes[0].frame, 112);
  assert.equal(c.notes[0].context.scene, 'Current scene at 112');
});

test('A timeline changing during remap keeps the original context until the new plan loads', async () => {
  const {c, saved} = fixture(); c.notes[0].context = {scene: 'Original context'}; let finish;
  c.respond = () => new Promise(resolve => {finish = resolve;});
  const pending = c.followPlans(); c.STATUS.timeline.version = 2;
  finish({ok: true, mappingVersion: NOTE_MAPPING_VERSION, notes: [{id: 'a', frame: 112}]});
  await pending;
  assert.equal(saved.length, 0); assert.equal(c.notes[0].context.scene, 'Original context');
});

test('A manual position on the current plan is not migrated', async () => {
  const n = note(); n.at = {frame: n.frame, end: null, plan: 'new'};
  const {c, calls, saved} = fixture([n]);
  await c.followPlans(); assert.equal(calls.length, 0); assert.equal(saved.length, 0);
  c.notes[0].frame = 120; c.anchorNote(c.notes[0]);
  assert.deepEqual(clone(c.notes[0].at), {frame: 120, end: null, plan: 'new'});
  assert.equal(c.notes[0].followVersion, NOTE_MAPPING_VERSION);
});

test('Missing and ambiguous plans preserve every note field and do not loop', async () => {
  const {c, calls, saved, notices} = fixture([note('missing'), note('ambiguous')]);
  const before = clone(c.notes);
  c.respond = async () => ({ok: true, mappingVersion: NOTE_MAPPING_VERSION, notes: [], unknown: ['missing'],
    refused: [{id: 'ambiguous', reason: 'conflicting-anchors'}]});
  await c.followPlans(); await c.followPlans();
  assert.deepEqual(clone(c.notes), before); assert.equal(saved.length, 0); assert.equal(calls.length, 1);
  assert.equal(notices[0].message, 'st.follow.uncertain');
  c.notes[0].at.frame = 200;
  await c.followPlans(); assert.equal(calls.length, 2, 'a changed anchor may try again');
});

test('A manual move during an outstanding remap cannot be overwritten', async () => {
  const {c, saved} = fixture(); let finish;
  c.respond = () => new Promise(resolve => {finish = resolve;});
  const pending = c.followPlans();
  c.notes[0].frame = 600; c.anchorNote(c.notes[0]);
  finish({ok: true, mappingVersion: NOTE_MAPPING_VERSION, notes: [{id: 'a', frame: 112}]});
  await pending;
  assert.equal(c.notes[0].frame, 600); assert.equal(saved.length, 0);
});

test('Late replies cannot recreate a deleted note or change a different preview mode', async () => {
  for (const action of ['delete', 'mode', 'version']) {
    const {c, saved} = fixture(); let finish;
    c.respond = () => new Promise(resolve => {finish = resolve;});
    const pending = c.followPlans();
    if (action === 'delete') c.notes = [];
    if (action === 'mode') c.mode = 'video';
    if (action === 'version') c.STATUS.plans.mappingVersion++;
    finish({ok: true, mappingVersion: NOTE_MAPPING_VERSION, notes: [{id: 'a', frame: 112}]});
    await pending; assert.equal(saved.length, 0);
    if (action === 'delete') assert.equal(c.notes.length, 0); else assert.equal(c.notes[0].frame, 900);
  }
});

test('An explicit agent remap takes precedence, including one arriving during the request', async () => {
  for (const late of [false, true]) {
    const {c, saved, calls} = fixture(); c.META.render = {size: 100, mtime: 2}; let finish;
    const remap = {frame: 300, render: clone(c.META.render)};
    if (!late) c.REPLIES.notes.a = {remap};
    c.respond = () => new Promise(resolve => {finish = resolve;});
    const pending = c.followPlans();
    if (late) {c.REPLIES.notes.a = {remap}; finish({ok: true, mappingVersion: NOTE_MAPPING_VERSION, notes: [{id: 'a', frame: 112}]});}
    await pending; assert.equal(saved.length, 0); assert.equal(c.notes[0].frame, 900);
    assert.equal(calls.length, late ? 1 : 0);
  }
});

test('Successful remapping preserves text or replies edited while it was in flight', async () => {
  const {c} = fixture(); let finish;
  c.respond = () => new Promise(resolve => {finish = resolve;});
  const pending = c.followPlans();
  c.notes[0].text = 'Revised request'; c.notes[0].thread.push({text: 'Additional reply'});
  finish({ok: true, mappingVersion: NOTE_MAPPING_VERSION, notes: [{id: 'a', frame: 112}]});
  await pending; assert.equal(c.notes[0].frame, 112); assert.equal(c.notes[0].text, 'Revised request');
  assert.equal(c.notes[0].thread.length, 2);
});

test('Old server responses do not falsely acknowledge the new matching algorithm', async () => {
  const {c, saved} = fixture();
  c.respond = async () => ({ok: true, notes: [{id: 'a', frame: 112}]});
  await c.followPlans(); assert.equal(c.notes[0].frame, 900); assert.equal(saved.length, 0);
});

test('Undo snapshots retain the repaired positions without losing text edits or manual anchors', async () => {
  const {c} = fixture();
  const wordsBefore = note(); wordsBefore.text = 'Earlier words';
  const previousPlacement = note(); previousPlacement.frame = 400; previousPlacement.at.frame = 400;
  c.HIST.back = [{type: 'notes', state: JSON.stringify([wordsBefore])}, {type: 'notes', state: JSON.stringify([previousPlacement])}];
  c.HIST.fwd = [{type: 'notes', state: JSON.stringify([wordsBefore])}];
  await c.followPlans();
  assert.equal(JSON.parse(c.HIST.back[0].state)[0].frame, 112);
  assert.equal(JSON.parse(c.HIST.back[0].state)[0].text, 'Earlier words');
  assert.equal(JSON.parse(c.HIST.fwd[0].state)[0].frame, 112);
  assert.equal(JSON.parse(c.HIST.back[1].state)[0].frame, 400, 'the prior manual placement remains undoable');
});

test('A stale tab merges corrected positions with newer text and all replies, without winning over a manual anchor', () => {
  const source = client.slice(client.indexOf('  function mergeNotes('), client.indexOf('  let NOTES_LAST_SAVE ='));
  const c = vm.createContext({NOTES_LAST_SAVE: 0, NOTES_KNOWN: new Set(['a']), userReplyParts: m => [m.text]});
  vm.runInContext(source, c);
  const corrected = note(); corrected.frame = 112; corrected.followVersion = NOTE_MAPPING_VERSION;
  corrected.updated = '2026-01-01T00:00:00Z';
  const stale = note(); stale.text = 'More recent user edit'; stale.updated = '2026-01-02T00:00:00Z';
  stale.thread.push({id: 'another', text: 'Reply in stale tab'});
  const merged = c.mergeNotes([stale], [corrected])[0];
  assert.equal(merged.frame, 112); assert.equal(merged.followVersion, NOTE_MAPPING_VERSION);
  assert.equal(merged.text, stale.text); assert.equal(merged.thread.length, 2);
  stale.at = {plan: 'new', frame: 333, end: null}; stale.frame = 333;
  assert.equal(c.mergeNotes([stale], [corrected])[0].frame, 333, 'a later manual placement wins');
});

function plan(offset = 0, prefix = '') {
  return anchorsOf({fps: 30, duration: 20 + offset,
    says: [{id: prefix + 'one', t: 1, dur: 2}, {id: prefix + 'two', t: 5 + offset, dur: 3}, {id: prefix + 'three', t: 12 + offset, dur: 3}]});
}
async function api(data, plans) {
  const c = vm.createContext({pn: '/api/remap', req: {method: 'POST'}, res: {},
    PLANS: {load: sig => plans[sig]}, body: async () => Buffer.from(JSON.stringify(data)),
    json: (_res, result) => result, mapFrames, assessFrameMapping, NOTE_MAPPING_VERSION});
  return clone(await vm.runInContext('(async () => {' + route + '})()', c));
}

test('API returns safe matches, refuses unrelated plans and retains unknown IDs separately', async () => {
  const r = await api({to: 'new', notes: [
    {id: 'safe', plan: 'old', frame: 180, end: 210}, {id: 'uncertain', plan: 'unrelated', frame: 180},
    {id: 'unknown', plan: 'absent', frame: 180}, {id: 'invalid', plan: 'old', frame: 180, end: 'bad'}]},
    {old: plan(), new: plan(2), unrelated: plan(0, 'unrelated-')});
  assert.equal(r.mappingVersion, NOTE_MAPPING_VERSION);
  assert.deepEqual(r.notes, [{id: 'safe', frame: 240, end: 270}]);
  assert.deepEqual(r.unknown, ['unknown', 'invalid']);
  assert.equal(r.refused.length, 1); assert.equal(r.refused[0].id, 'uncertain');
});

test('The first migrated save keeps a full independent backup; later saves do not duplicate it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mstudio-remap-'));
  try {
    const filename = path.join(dir, 'notes.json'), prior = {notes: [note()], rev: '1'};
    fs.writeFileSync(filename, JSON.stringify(prior));
    const source = server.slice(server.indexOf('function writeNotes('), server.indexOf("// the studio page's script:"));
    const c = vm.createContext({fs, path, crypto, REVUE: dir, NOTES: filename, P: {}, NOTE_MAPPING_VERSION,
      syncUserReplies() {}, stampNow: () => 'test', writeJson: (file, data) => fs.writeFileSync(file, JSON.stringify(data))});
    vm.runInContext(source, c);
    const repaired = clone(prior); repaired.notes[0].frame = 112; repaired.notes[0].followVersion = NOTE_MAPPING_VERSION;
    c.writeNotes(repaired, prior);
    const backups = fs.readdirSync(path.join(dir, 'sauvegardes'));
    assert.equal(backups.length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'sauvegardes', backups[0]), 'utf8')), prior);
    c.writeNotes(repaired, repaired);
    assert.equal(fs.readdirSync(path.join(dir, 'sauvegardes')).length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(filename, 'utf8')).notes[0].thread, prior.notes[0].thread);
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});

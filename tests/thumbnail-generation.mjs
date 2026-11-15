import assert from 'node:assert/strict';
import {test} from 'node:test';
import {thumbnailGeneration} from '../lib/thumbnail-generation.mjs';

function fixture() {
  const state = {source:'one', version:2, hash:'bundle', ready:true, coherent:true, scans:0, builds:0, duringBuild:null, duringScan:null};
  const get = thumbnailGeneration({
    current: (version, hash) => state.ready && state.version === version && (!hash || (state.hash === hash && state.coherent)),
    fingerprint: async () => { state.scans++; state.duringScan?.(); return state.source; },
    build: async (version, signal, fingerprint) => {
      state.builds++;
      const before = await fingerprint();
      state.duringBuild?.();
      const after = await fingerprint();
      if (before !== after) throw new Error('Sources changed during construction');
      return {version, hash:state.hash, mediaSignature:after, durationInFrames:300};
    },
  });
  return {state, get};
}

test('Unchanged sheets reuse the validated generation after one fresh scan', async () => {
  const {state, get} = fixture();
  const first = await get(2);
  assert.equal(state.scans, 2);
  assert.equal(state.builds, 1);
  assert.equal(await get(2), first);
  assert.equal(state.scans, 3);
  assert.equal(state.builds, 1);
});

test('Media changes and preview changes each require a newly validated generation', async () => {
  const {state, get} = fixture();
  const first = await get(2);
  state.source = 'new-media';
  const second = await get(2);
  assert.notEqual(second, first);
  assert.equal(second.mediaSignature, 'new-media');
  assert.equal(state.builds, 2);
  state.hash = 'new-bundle';
  state.version = 3;
  await assert.rejects(get(2), error => error.status === 409);
  assert.equal((await get(3)).hash, 'new-bundle');
  assert.equal(state.builds, 3);
});

test('A source change during construction never becomes reusable', async () => {
  const {state, get} = fixture();
  state.duringBuild = () => {state.source = 'changed';};
  await assert.rejects(get(2), /Sources changed/);
  state.duringBuild = null;
  assert.equal((await get(2)).mediaSignature, 'changed');
  assert.equal(state.builds, 2);
});

test('A pending timeline requires validation rather than reusing the old generation', async () => {
  const {state, get} = fixture();
  const first = await get(2);
  state.coherent = false;
  state.duringBuild = () => {state.coherent = true;};
  assert.notEqual(await get(2), first);
  assert.equal(state.builds, 2);
});

test('A preview change during a fresh scan prevents reuse of the old generation', async () => {
  const {state, get} = fixture();
  await get(2);
  state.duringScan = () => {state.version = 3;};
  await assert.rejects(get(2), error => error.status === 409);
});

test('Cancellation during a scan never returns a cached generation', async () => {
  const {state, get} = fixture();
  await get(2);
  const controller = new AbortController();
  state.duringScan = () => controller.abort();
  await assert.rejects(get(2, controller.signal), error => error.name === 'AbortError');
  assert.equal(state.builds, 1);
});

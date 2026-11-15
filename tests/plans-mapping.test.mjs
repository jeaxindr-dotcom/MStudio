import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorsOf, mapper, mapFrames, assessFrameMapping, planSig } from '../lib/plans.mjs';

const episode = (shift = 0) => anchorsOf({ duration: 20 + shift, fps: 30, says: [
  { id: 'first', t: 1, dur: 2 }, { id: 'second', t: 5 + shift, dur: 2 }, { id: 'third', t: 12 + shift, dur: 3 },
] });
const montage = (first = 4) => anchorsOf({ fps: 30, duration: first + 8, tracks: [{ id: 'pictures', type: 'video', clips: [
  { t0: 0, t1: first, ref: 'one' }, { t0: first, t1: first + 4, ref: 'two' }, { t0: first + 4, t1: first + 8, ref: 'three' },
] }] });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('spoken lines and range notes follow an inserted interval, without drift', () => {
  const a = episode(), b = episode(2), m = mapper(a, b);
  close(m.map(2), 2); close(m.map(6), 8); close(m.map(13), 15);
  assert.deepEqual(mapFrames(a, b, 180, 195), { frame: 240, end: 255 });
  assert.deepEqual(mapFrames(b, a, 240, 255), { frame: 180, end: 195 });
  assert.equal(assessFrameMapping(a, b, 180, 195).safe, true);
});

test('a lengthened shot stretches its interior and shifts later shots', () => {
  const a = montage(), b = montage(6), m = mapper(a, b);
  close(m.map(2), 3); close(m.map(5), 7); close(m.map(9.5), 11.5);
  assert.deepEqual(mapFrames(a, b, 150, 165), { frame: 210, end: 225 });
});

test('source anchors retain the same footage after a head trim', () => {
  const video = (from) => anchorsOf({ fps: 30, duration: 20, tracks: [{ id: 'pictures', type: 'video', clips: [
    { t0: 0, t1: 10 - from / 30, file: 'rush.mp4', from },
    { t0: 10 - from / 30, t1: 20 - from / 30, file: 'other.mp4', from: 0 },
  ] }] });
  const m = mapper(video(0), video(60)); close(m.map(5), 3); close(m.map(15), 13);
});

test('a reused early reference cannot pull a long timeline to its end', () => {
  const plan = (changed) => ({ duration: 1400 + (changed ? 12 : 0), fps: 30, keys: [
    ['ref:board:list#1:a', 32 + (changed ? 1320 : 0), 0],
    ['ref:board:list#1:b', 40 + (changed ? 1320 : 0), 0],
    ...Array.from({ length: 700 }, (_, i) => [`ref:content:item${i}:a`, i * 2 + (changed && i > 100 ? 12 : 0), 0]),
  ] });
  const a = plan(false), b = plan(true), m = mapper(a, b);
  for (const t of [46, 150, 400, 650, 930, 1200, 1324]) {
    close(m.map(t), t + (t > 202 ? 12 : 0));
    assert.equal(assessFrameMapping(a, b, Math.round(t * 30)).safe, true);
  }
  assert.ok(m.agreed >= 700);
});

test('consensus uses votes at equal old times instead of whichever track comes first', () => {
  const a = { duration: 100, fps: 30, keys: [['bad', 10, 0], ['good', 10, 0], ['same', 10, 0], ['later', 20, 0]] };
  const b = { duration: 100, fps: 30, keys: [['bad', 80, 0], ['good', 12, 0], ['same', 12, 0], ['later', 22, 0]] };
  close(mapper(a, b).map(10), 12); close(mapper(a, b).map(15), 17);
});

test('a lower-priority chapter or music bed cannot pin the inside of a moved shot', () => {
  const a = { duration: 30, fps: 30, keys: [['ref:shot:a', 5, 0], ['ref:shot:b', 15, 0], ['label:chapter:a', 7, 2], ['label:chapter:b', 12, 2]] };
  const b = { duration: 30, fps: 30, keys: [['ref:shot:a', 10, 0], ['ref:shot:b', 20, 0], ['label:chapter:a', 7, 2], ['label:chapter:b', 12, 2]] };
  close(mapper(a, b).map(8), 13); assert.equal(assessFrameMapping(a, b, 240).safe, true);
});

test('stable dialogue IDs beat a stretched repeated decoration', () => {
  const a = { duration: 60, fps: 30, keys: [
    ['ref:board:grid#1:a', 2, 0], ['ref:board:grid#1:b', 4, 0],
    ['ref:board:grid#2:a', 10, 0], ['ref:board:grid#2:b', 40, 0],
    ['ref:dialogue:sentence#1:a', 20, 2], ['ref:dialogue:sentence#1:b', 30, 2],
  ] };
  const b = { ...a, keys: a.keys.map(([k, t, p]) => [k, k === 'ref:board:grid#2:b' ? 41 : t, p]) };
  assert.deepEqual(mapFrames(a, b, 750), { frame: 750, end: null });
});

test('a repeated occurrence removed in one version is still treated as ambiguous', () => {
  const a = { duration: 60, fps: 30, keys: [
    ['ref:board:grid#1:a', 5, 0], ['ref:board:grid#1:b', 10, 0],
    ['ref:board:grid#2:a', 40, 0], ['ref:board:grid#2:b', 50, 0],
    ['ref:dialogue:sentence#1:a', 5, 2], ['ref:dialogue:sentence#1:b', 10, 2],
  ] };
  const b = { ...a, keys: [
    ['ref:board:grid#1:a', 40, 0], ['ref:board:grid#1:b', 50, 0],
    ['ref:dialogue:sentence#1:a', 5, 2], ['ref:dialogue:sentence#1:b', 10, 2],
  ] };
  close(mapper(a, b).map(7), 7);
});

test('adding an intro or outro does not pin a real content anchor to film boundaries', () => {
  const a = { duration: 10, fps: 30, keys: [['shot:a', 0, 0], ['shot:b', 10, 0]] };
  const intro = { duration: 12, fps: 30, keys: [['shot:a', 2, 0], ['shot:b', 12, 0]] };
  assert.deepEqual(mapFrames(a, intro, 0, 15), { frame: 60, end: 75 });
  const outro = { duration: 15, fps: 30, keys: a.keys };
  assert.deepEqual(mapFrames(a, outro, 299), { frame: 299, end: null });
});

test('missing correspondences and mostly reversed identities are unsafe', () => {
  const a = { duration: 100, fps: 30, keys: Array.from({ length: 8 }, (_, i) => [`k${i}`, 10 + i * 10, 0]) };
  const unrelated = { ...a, keys: [['unrelated:a', 10, 0], ['unrelated:b', 20, 0]] };
  assert.equal(assessFrameMapping(a, unrelated, 900).safe, false);
  const reversed = { ...a, keys: a.keys.map(([k, t, p]) => [k, 100 - t, p]) };
  assert.equal(assessFrameMapping(a, reversed, 900).safe, false);
});

test('a deleted interval needs review, while surrounding content still follows', () => {
  const a = { duration: 30, fps: 30, keys: [['one:a', 0, 0], ['one:b', 10, 0], ['two:a', 20, 0], ['two:b', 30, 0]] };
  const b = { duration: 20, fps: 30, keys: [['one:a', 0, 0], ['one:b', 10, 0], ['two:a', 10, 0], ['two:b', 20, 0]] };
  assert.equal(assessFrameMapping(a, b, 450).safe, false);
  assert.equal(assessFrameMapping(a, b, 750).safe, true);
  close(mapper(a, b).map(25), 15);
});

test('near-zero local compression is refused even with many anchors elsewhere', () => {
  const a = { duration: 200, fps: 30, keys: Array.from({ length: 11 }, (_, i) => [`k${i}`, i * 20, 0]) };
  const b = { ...a, duration: 120.1, keys: a.keys.map(([k, t, p]) => [k, t <= 100 ? t : t <= 180 ? 100 + (t - 100) / 800 : t - 79.9, p]) };
  assert.equal(assessFrameMapping(a, b, 150 * 30).reason, 'compressed-interval');
  assert.equal(assessFrameMapping(a, b, 50 * 30).safe, true);
});

test('ranges never acquire an end beyond the last frame and frame rates convert', () => {
  const a = montage(), b = { ...a, fps: 60 };
  assert.notEqual(planSig(a), planSig(b), 'a frame-rate edit must create a new plan even at identical seconds');
  assert.deepEqual(mapFrames(a, b, 150, 165), { frame: 301, end: 331 });
  assert.deepEqual(mapFrames(a, a, 359, 400), { frame: 359, end: null });
});

test('the same immutable plan pair reuses its mapping', () => {
  const a = montage(), b = montage(6);
  assert.equal(mapper(a, b), mapper(a, b));
});

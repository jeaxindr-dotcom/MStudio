import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {reviewFrameCache} from '../lib/frame-cache.mjs';

test('Two theatres with the same episode and source timestamps keep separate frame caches', () => {
  const root = path.resolve('.cache');
  const first = reviewFrameCache(root, 'C:\\Films\\Theatre A\\E19 - Sunrise\\revue', 'win32');
  const second = reviewFrameCache(root, 'C:\\Films\\Theatre B\\E19 - Sunrise\\revue', 'win32');
  assert.notEqual(first, second);
  // A kept filename may be identical (same frame/source signature); its parent
  // still isolates the image. No Remotion rendering is needed for this check.
  assert.notEqual(path.join(first, 'kept', 'same-signature.jpg'), path.join(second, 'kept', 'same-signature.jpg'));
  assert.equal(path.dirname(first), path.join(root, 'frames'));
});

test('Windows spelling and a normalized review path keep the same cache', () => {
  const root = path.resolve('.cache');
  const original = reviewFrameCache(root, 'C:\\Films\\Théâtre 宇宙\\E19 - Sunrise\\revue', 'win32');
  assert.equal(original, reviewFrameCache(root, 'c:/films/théâtre 宇宙/E19 - Sunrise/revue/', 'win32'));
  assert.equal(original, reviewFrameCache(root, 'C:\\Films\\Théâtre 宇宙\\E19 - Sunrise\\revue\\..\\revue', 'win32'));
});

test('A review opened standalone or imported keeps its cache independently of its display ID', () => {
  const root = path.resolve('.cache');
  const standalone = {ep:'E19', REVUE:path.resolve('fixtures', 'theatre', 'E19 - Sunrise', 'revue')};
  const imported = {...standalone, id:'P1234abcd'};
  assert.equal(reviewFrameCache(root, standalone.REVUE), reviewFrameCache(root, imported.REVUE));
});

test('Case-sensitive filesystems do not merge distinct review directories', () => {
  const root = path.resolve('.cache');
  assert.notEqual(reviewFrameCache(root, '/films/Theatre/E19/revue', 'linux'), reviewFrameCache(root, '/films/theatre/E19/revue', 'linux'));
});

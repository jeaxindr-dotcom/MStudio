// Exercise the actual quality selector with legacy and explicit export profiles.
// No server, project, or render is started by this test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {exportVariant} from '../lib/export-context.mjs';

const source = fs.readFileSync(new URL('../page/studio/06-render.js', import.meta.url), 'utf8');
const start = source.indexOf('  const QKEY = ');
const end = source.indexOf('  // the four numbered steps', start);
assert.ok(start >= 0 && end > start, 'Quality selector must be found in the production source');
function selector(options, {saved = null, language = 'fr', available = true, project = true} = {}) {
  const requests = [], store = new Map(saved ? [['quality', saved]] : []);
  const context = {
    META: {features: {export: available}, exportOptions: options.map(o => exportVariant(o, false, language))},
    PROJ: project, CH: 1080, CW: 1920, rcKey: '',
    localStorage: {getItem: () => store.get('quality') ?? null, setItem: (_k, value) => store.set('quality', value)},
    T: key => key, TN: key => key, esc: text => String(text ?? '').replaceAll('"', '&quot;'),
    renderRender() {}, markGo() {}, launchRender() {requests.push({episode: true});},
    startExportUI: (id, label) => requests.push({id, label}),
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + '\nglobalThis.api = {qualities, quality, qualityHtml, setQuality, goRender};', context);
  return {api: context.api, requests};
}

test('Legacy test-only 1080p is selectable once, with its honest duration label and original command', () => {
  const {api, requests} = selector([{id:'final', label:'Exporter (4K final)'}, {id:'test', label:'Rendu test (1080p)'}]);
  const choices = api.qualities();
  assert.equal(choices.length, 2);
  assert.equal(choices[0].id, '1080p');
  assert.equal(choices[0].send, 'test');
  assert.equal(choices[0].why, null);
  assert.equal(choices[0].label, '1080p · durée définie par le script');
  assert.equal(choices[1].send, 'final');
  api.setQuality('1080p'); api.goRender();
  assert.deepEqual(requests, [{id:'test', label:'1080p · durée définie par le script'}]);
  const html = api.qualityHtml(false);
  assert.match(html, /data-q="1080p" class="on"\s+title=/);
  assert.doesNotMatch(html, /disabled|data-q="x:test"|Film complet/);
});

test('A saved 4K choice remains selected while the 1080p preset becomes usable', () => {
  const {api} = selector([{id:'final', label:'4K'}, {id:'test', label:'1080p'}], {saved:'4k'});
  assert.equal(api.quality().send, 'final');
  api.setQuality('1080p'); assert.equal(api.quality().send, 'test');
});

test('An explicitly declared excerpt stays a separate preset, never a full-film choice', () => {
  const {api} = selector([{id:'final', label:'4K', scope:'full'}, {id:'test', label:'1080p · 2 s', scope:'excerpt'}]);
  const choices = api.qualities();
  assert.ok(choices[0].why);
  assert.equal(choices[0].send, null);
  assert.equal(choices[2].id, 'x:test');
  assert.equal(choices[2].label, '1080p · 2 s');
  assert.equal(choices[2].why, null);
});

test('Legacy test duration is kept instead of relabelled as a full film', () => {
  const {api} = selector([{id:'test', label:'Rendu test (1080p, 2 s)'}]);
  assert.equal(api.qualities()[0].label, 'Rendu test (1080p, 2 s)');
  assert.equal(api.quality().send, 'test');
  assert.doesNotMatch(api.qualityHtml(false), /Film complet/);
});

test('A declared full-film preset wins over tests and unknown-duration profiles, in either order', () => {
  for (const options of [
    [{id:'test', label:'1080p'}, {id:'1080p', label:'1080p'}, {id:'film', label:'1080p', scope:'full'}],
    [{id:'film', label:'1080p', scope:'full'}, {id:'test', label:'1080p'}, {id:'1080p', label:'1080p'}],
  ]) {
    const {api} = selector(options);
    assert.equal(api.qualities()[0].send, 'film');
    assert.equal(api.qualities()[0].label, 'Film complet · 1080p');
    assert.equal(api.qualities().filter(x => x.send === 'film').length, 1);
  }
});

test('A regular 1080p preset wins over a legacy test when no scope is declared', () => {
  const {api} = selector([{id:'test', label:'1080p'}, {id:'normal', label:'1080p'}]);
  assert.equal(api.qualities()[0].send, 'normal');
  assert.equal(api.qualities().find(x => x.send === 'test').id, 'x:test');
});

test('Unknown duration is also preserved in English and unavailable exports remain disabled', () => {
  const {api} = selector([{id:'test', label:'Test render (1080p)'}], {language:'en'});
  assert.equal(api.qualities()[0].label, '1080p · duration set by the script');
  const disabled = selector([{id:'test', label:'1080p'}], {available:false}).api;
  assert.ok(disabled.qualities().every(x => x.why));
  assert.match(disabled.qualityHtml(false), /disabled/);
});

test('Native episode options and render dispatch stay unchanged', () => {
  const {api, requests} = selector([], {project:false});
  assert.equal(api.qualities()[0].send, '1080p');
  assert.equal(api.qualities()[1].send, '4k');
  api.goRender(); assert.deepEqual(requests, [{episode:true}]);
});

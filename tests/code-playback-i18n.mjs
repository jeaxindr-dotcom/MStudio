// Régression ciblée du vrai module : traductions au démarrage et pendant la lecture.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const root = new URL('../', import.meta.url);
const source = process.argv.includes('--baseline')
  ? execFileSync('git', ['show', 'f273f8e:page/studio/18-code-playback.js'], {cwd: root, encoding: 'utf8'})
  : fs.readFileSync(new URL('page/studio/18-code-playback.js', root), 'utf8');
// Réutiliser le simulateur de transport existant, sans rejouer ses tests.
const harness = fs.readFileSync(new URL('./code-playback-ui.mjs', import.meta.url), 'utf8');
const fixtureSource = harness.slice(harness.indexOf('function fixture('), harness.indexOf('\nconst cases ='));
function fixture(fr = false) {
  const languageVM = Object.create(vm);
  languageVM.runInContext = (code, context) => {context.FR = fr; return vm.runInContext(code, context);};
  return vm.runInNewContext(`(${fixtureSource})()`, {source, vm: languageVM});
}
const cases = [
  ['En anglais, le bouton, son aide et le retour sont traduits', () => {
    const f = fixture();
    assert.equal(f.el('prepareCodeRange').textContent, 'Prepare 30 s');
    assert.match(f.el('prepareCodeRange').title, /^Prepare a range/);
    assert.equal(f.el('returnLiveCode').textContent, 'Return to live code');
  }],
  ['En anglais, l’attente de préparation reste compréhensible', async () => {
    const f = fixture(); await f.click();
    assert.equal(f.el('codeRangeTools').children.at(-1).textContent, 'Preparing the current code…');
    f.c.M.play();
    assert.equal(f.el('codeRangeTools').children.at(-1).textContent, 'The range is still being prepared.');
  }],
  ['En anglais, la plage prête et le son rechargé sont traduits', async () => {
    const f = fixture(); await f.ready();
    assert.equal(f.el('codeRangeTools').children.at(-1).textContent, 'Code v1 · range 10–40 s · Click Play to start');
    await f.c.restoreSound();
    assert.match(f.el('codeRangeTools').children.at(-1).textContent, /^Range sound reloaded/);
  }],
  ['En anglais, l’erreur média et le retour au direct sont traduits', async () => {
    const f = fixture(); await f.ready(); f.el('codeRangeVideo').emit('error');
    assert.equal(f.el('codeRangeTools').children.at(-1).textContent, 'Stopping preparation, then returning to live code…');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.el('codeRangeTools').children.at(-1).textContent, 'The prepared range cannot be played.');
    assert.equal(f.c.preparedCode.active(), false);
  }],
  ['Le français conserve ses textes de préparation et de lecture', async () => {
    const f = fixture(true); assert.equal(f.el('prepareCodeRange').textContent, 'Préparer 30 s');
    await f.ready(); assert.match(f.el('codeRangeTools').children.at(-1).textContent, /Lecture pour démarrer$/);
  }],
];
let ok = 0, ko = 0;
for (const [name, fn] of cases) {try {await fn(); ok++; console.log(`✓ ${name}`);} catch (e) {ko++; console.log(`✗ ${name} : ${e.message}`);}}
console.log(`${ok} ok, ${ko} ko`); process.exitCode = ko ? 1 : 0;

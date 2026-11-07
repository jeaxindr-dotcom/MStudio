// Les fonctions réellement servies par /studio.js, avec leur dictionnaire français.
// Le serveur, le navigateur et les moteurs de rendu ne sont pas nécessaires ici.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { tr } from '../lib/i18n.mjs';

const script = fs.readFileSync(new URL('../page/studio/05-agent.js', import.meta.url), 'utf8');
function fixture() {
  const elements = new Map();
  function element() {
    return {
      classList: { toggle() {} }, addEventListener() {}, children: [], dataset: {},
      querySelector: element, appendChild(child) { this.children.push(child); },
    };
  }
  const $ = (s) => {
    if (!elements.has(s)) elements.set(s, element());
    return elements.get(s);
  };
  const context = {
    $, document: { createElement: element }, T: tr('fr'), ic: () => '',
    esc: (s) => String(s).replaceAll('<', '&lt;').replaceAll('>', '&gt;'), hhmm: () => '',
    MAXQ: 0, drafts: () => [{ id: 'lumiere', text: 'La lumière' }], STATUS: { lots: [], agent: {} },
    renderRender() {}, onTab: () => true, setSave() {}, renderAll() {},
  };
  vm.runInNewContext(script, context);
  return { $, context };
}

test('Le bouton annonce l’envoi pendant la sauvegarde des notes', async () => {
  const { $, context } = fixture();
  let release;
  context.flushNow = () => new Promise((resolve) => { release = resolve; });
  const sending = $('#qsend').onclick();
  try {
    assert.equal($('#qsend').disabled, true);
    assert.match($('#qsend').innerHTML, /Envoi des notes/);
  } finally {
    release(false);
    await sending;
  }
});

test('La carte présente les captures et la prise en charge de l’agent séparément', () => {
  const { $, context } = fixture();
  const lot = { lot: 1, ids: ['lumiere', 'rideau'], claude: { status: 'taken' } };
  context.STATUS.lots = [lot];
  function render(captureState) {
    lot.captureState = captureState;
    context.renderLots();
    return $('#lots').children.at(-1).innerHTML;
  }
  const pending = render({ status: 'pending', done: 1, total: 2 });
  assert.match(pending, /Captures en cours.*1 ?\/ ?2/);
  assert.ok(pending.includes(context.T('st.lot.taken')));
  const ready = render({ status: 'ready', done: 2, total: 2 });
  assert.match(ready, /Captures prêtes/);
  const failed = render({ status: 'error', done: 2, total: 2, error: 'Image <introuvable>' });
  assert.match(failed, /Captures incomplètes/);
  assert.ok(failed.includes('&lt;introuvable&gt;'));
  assert.ok(failed.includes(context.T('st.lot.taken')));
  assert.doesNotMatch(render(undefined), /data-capture-status/);
});

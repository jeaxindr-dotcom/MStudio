// La vraie route d’envoi et la vraie modale. Le contrôle externe reste suspendu
// jusqu’au signal du test : aucune requête réseau, aucun moteur ni navigateur.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (file) => process.argv.includes('--baseline')
  ? execFileSync('git', ['show', '935ce39:' + file], {cwd: root, encoding: 'utf8'})
  : fs.readFileSync(new URL(file, root), 'utf8');
const studio = read('studio-server.mjs');
const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
const helpers = between(studio, '// the agent the batch goes to:', "process.on('unhandledRejection'").replaceAll('import.meta.url', JSON.stringify(new URL('studio-server.mjs', root).href));
const route = between(studio, '// ---- the pending edits ->', "if (pn === '/api/updates')");
const tick = () => new Promise((r) => setImmediate(r));
const receipt = { skills: { checked: 2 }, agent: { name: 'Claude Code' } };
function fixture(lots = new Map()) {
  const workers = [], saved = [];
  const agent = { id: 'claude', name: 'Claude Code', skills: 'dossier-du-test' };
  class Worker extends EventEmitter {
    constructor(_url, {workerData}) { super(); this.args = workerData; workers.push(this); }
  }
  const ctx = {
    URL, Worker, process: {env: {}}, P: {kind: 'remotion'}, lang: () => 'fr', t: (k) => k,
    updatesLine: (u) => u ? 'Contrôle terminé' : '', updatesOk: (u) => !!u,
    body: async (req) => Buffer.from(JSON.stringify(req.data)), meta: () => ({fps: 30, size: [640, 360]}),
    agentState: () => ({watching: true, agent}), agentById: (id) => id === 'claude' ? agent : {id, name: id},
    setTimeout() {}, log() {}, oneLotAtATime: (f) => f(),
    checkUpdates: () => new Promise(() => {}),  // le contrôle à froid sur 935ce39
    json: (res, data) => { res.body = data; },
    createLot: (_p, _b, opts) => {
      const n = lots.size + 1;
      lots.set(n, {lot: n, agent: opts.agent, language: 'fr', captureState: {id: 'g' + n}, updatesPending: opts.updatesPending});
      return {lot: n};
    },
    readLot: (_p, n) => lots.get(n), lotNumbers: () => [...lots.keys()],
    saveLotUpdates: (_p, n, id, u) => { saved.push({n, id, u}); lots.get(n).updatesPending = false; },
  };
  vm.runInNewContext(helpers + '\nasync function send(req, res) {const pn = "/api/send";\n' + route + '\n}', ctx);
  return { ctx, workers, saved, lots };
}

test('Deux envois à froid sont publiés pendant le contrôle et reçoivent leur verdict', async () => {
  const {ctx, workers, saved, lots} = fixture();
  const first = {}, second = {};
  const req = {method: 'POST', data: {agent: 'codex', fps: 30, size: [640, 360]}};
  ctx.send(req, first); ctx.send(req, second);
  await tick();
  assert.equal(first.body?.ok, true, 'La première réponse HTTP attend le contrôle de mises à jour');
  assert.equal(second.body?.pendingUpdatesId, 'g2');
  assert.equal(first.body.pendingUpdatesId, 'g1');
  assert.equal(lots.get(1).updatesPending, true);
  assert.equal(workers.length, 1);
  assert.equal(workers[0].args.agent.id, 'claude');
  workers[0].emit('message', receipt);
  await tick();
  assert.deepEqual(saved, [{n: 1, id: 'g1', u: receipt}, {n: 2, id: 'g2', u: receipt}]);
});

test('Après redémarrage, l’agent désigné lors de l’envoi reçoit le résultat du contrôle', async () => {
  const {ctx, workers, saved} = fixture(new Map([[9, {lot: 9, agent: {id: 'codex'}, captureState: {id: 'g9'}, updatesPending: true}]]));
  ctx.resumeLotUpdates();
  await tick();
  assert.equal(workers[0].args.agent.id, 'codex');
  workers[0].emit('message', receipt); await tick();
  assert.deepEqual(saved, [{n: 9, id: 'g9', u: receipt}]);
});

test('La modale en cours reçoit uniquement le verdict de sa génération', () => {
  const source = read('page/studio/07-cards.js');
  const fields = new Map();
  const $ = (k) => {
    if (!fields.has(k)) fields.set(k, {style: {}, classList: {toggle() {}}, focus() {}});
    return fields.get(k);
  };
  const ctx = {$, STATUS: {lots: []}, markPick() {}};
  vm.runInNewContext(between(source, 'let modalLine =', "$('#mShowLine').onclick"), ctx);
  const modal = () => ctx.showModal('', '', '', '', {updates: 'En cours', pendingUpdatesId: 'actuelle', updatesOk: true});
  modal();
  ctx.STATUS.lots = [{captureState: {id: 'ancienne'}, updatesLine: 'Ancien résultat'}]; ctx.syncModalUpdates();
  assert.equal($('#mUpd').textContent, 'En cours');
  ctx.STATUS.lots = [{captureState: {id: 'actuelle'}, updatesLine: 'Remotion est à jour', updatesOk: true}]; ctx.syncModalUpdates();
  assert.equal($('#mUpd').textContent, 'Remotion est à jour');
  assert.equal($('#mUpd').className, 'upd on');
  modal(); ctx.showModal('Connexion', '', '', '');
  ctx.syncModalUpdates(); assert.equal($('#mUpd').textContent, '');
});

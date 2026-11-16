// Exécute les véritables fonctions de la page dans une interface minimale.
// Aucun navigateur, serveur, rendu ni projet réel. --baseline rejoue f273f8e.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncUserReplies, userReplyReceipts, acknowledgeUserReplies } from '../lib/reply-delivery.mjs';

const root = new URL('../', import.meta.url), baseline = process.argv.includes('--baseline');
const read = (file) => baseline ? execFileSync('git', ['show', `f273f8e:${file}`], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(new URL(file, root), 'utf8');
const notesSource = read('page/studio/02-notes.js'), cardsSource = read('page/studio/07-cards.js');
const between = (source, a, b) => {
  const start = source.indexOf(a), end = source.indexOf(b, start);
  assert.ok(start >= 0 && end > start, `Fonctions de page introuvables : ${a}`);
  return source.slice(start, end);
};
const source = [
  between(notesSource, '  const NEWT =', '  function stamp('),
  between(notesSource, '  function mergeNotes(', '  let NOTES_LAST_SAVE ='),
  between(cardsSource, '  function cardEl(', '  function renderList('),
  between(notesSource, "  let repliesTxt = ''", '  function applyRemaps('),
  'globalThis.api = {cardEl, threadOf, mergeNotes, pollReplies};',
].join('\n');
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
function element() {
  const children = new Map();
  return { dataset: {}, innerHTML: '', classList: { add() {}, toggle() {} }, listeners: {},
    addEventListener(event, fn) { this.listeners[event] = fn; },
    querySelectorAll() { return []; },
    querySelector(key) { if (!children.has(key)) children.set(key, element()); return children.get(key); },
  };
}
function setup({ watching = false, statusFails = false, saved = true, flush = null, reply = 'Toujours pas, avec une image.', images = [{ file: 'images/capture.png' }], receipts = null, receiptsStatus = 200 } = {}) {
  const events = [], modals = [], statuses = [], n = { id: 'note27', frame: 0, end: null, text: 'Corriger les dakuten', images: [], thread: [], status: 'done', draft: false, lot: 4 };
  const c = {
    FR: true, T: (key) => key, esc, META: { connectLine: 'Coulisses : connecter cette session', render: null }, STATUS: { agent: { watching: true } }, REPLIES: { notes: { note27: { messages: [{ text: 'Corrigé', at: '2026-10-25T13:49:00Z' }] } }, userReplies: {} },
    pending: { note27: { text: reply, images } }, now: () => '2026-10-26T02:44:00Z', uid: () => 'message-neuf', fixedOf: (note) => note.status === 'done', byId: () => n,
    save: () => events.push('save'), renderAll: () => events.push('render'), reconcilePublishedNotes: () => false, flushNow: async () => { events.push('flush'); return flush ? flush() : saved; },
    fetch: async (url, options) => {
      assert.equal(options.cache, 'no-store'); assert.ok(!options.method || options.method === 'GET');
      if (url === '/api/replies') { events.push('replies'); return { ok: receiptsStatus === 200, status: receiptsStatus, json: async () => receipts ? receipts(n, c.REPLIES) : c.REPLIES }; }
      events.push('status'); assert.equal(url, '/api/status'); if (statusFails) throw new Error('statut inaccessible'); return { ok: true, json: async () => ({ agent: { watching } }) };
    },
    setSave: (...args) => statuses.push(args), showModal: (...args) => modals.push(args), AbortSignal,
    document: { createElement: element }, statusOf: (note) => note.status, stateOf: () => 'fixed', sel: '', loopId: null, pendingSelection: null,
    fmt: (x) => String(x), tOf: (x) => x, ic: () => '', hhmm: (x) => x, gestureHtml: () => '', thumbHtml: () => '', FRAMES: 300, FPS: 30, PROJ: false, dropZone() {},
    NOTES_LAST_SAVE: 0, NOTES_KNOWN: new Set(['note27']), Date, Map, Set, setTimeout() {}, onStatus() {}, applyRemaps() {},
  };
  c.reply = (note) => c.REPLIES.notes?.[note.id];
  vm.runInNewContext(source, c);
  const card = c.api.cardEl(n, 26), send = () => card.querySelector('.repbox').querySelector('.send').listeners.click();
  return { c, n, card, send, events, modals, statuses };
}
const tests = [
  ['Sans surveillance, sauvegarde immédiate puis avertissement et ligne à copier', async () => {
    const f = setup(); await f.send();
    assert.equal(f.n.thread[0]?.id, 'message-neuf', 'La réponse doit posséder un identifiant durable');
    assert.deepEqual(f.n.thread[0].images, [{ file: 'images/capture.png' }]);
    assert.equal(f.n.status, 'open'); assert.equal(f.c.pending.note27, undefined);
    assert.ok(f.events.indexOf('flush') >= 0 && f.events.indexOf('flush') < f.events.indexOf('status'));
    assert.equal(f.modals.length, 1);
    assert.match(f.modals[0][1], /Aucun agent ne surveille Coulisses.*reconnexion/);
    assert.equal(f.modals[0][2], f.c.META.connectLine);
    assert.match(f.modals[0][3], /non vues.*premier/);
  }],
  ['Le statut frais remplace un ancien voyant connecté', async () => {
    const f = setup({ watching: false }); assert.equal(f.c.STATUS.agent.watching, true); await f.send();
    assert.equal(f.c.STATUS.agent.watching, false); assert.equal(f.modals.length, 1);
  }],
  ['Statut inaccessible : la page ne promet pas qu’un agent écoute', async () => {
    const f = setup({ statusFails: true }); await f.send();
    assert.equal(f.modals.length, 1); assert.match(f.modals[0][1], /n’a pas pu être vérifiée/);
    assert.equal(f.n.thread.length, 1);
  }],
  ['Surveillance active : réponse en attente, aucune fausse confirmation de lecture', async () => {
    const f = setup({ watching: true }); await f.send();
    assert.equal(f.modals.length, 0); assert.ok(f.statuses.some(([s]) => /en attente de remise/.test(s)));
    assert.ok(!f.statuses.some(([s]) => /Vue par/.test(s)));
  }],
  ['L’agent accuse réception puis quitte avant le contrôle du statut : aucune fausse attente de reconnexion', async () => {
    const f = setup({ watching: false, receipts: (n, previous) => ({ ...previous, userReplies: { note27: { 'message-neuf': { seenAt: '2026-10-26T02:44:01Z', message: n.thread[0] } } } }) });
    await f.send();
    assert.ok(f.events.indexOf('flush') < f.events.indexOf('status') && f.events.indexOf('status') < f.events.indexOf('replies'));
    assert.equal(f.modals.length, 0); assert.ok(f.statuses.some(([s]) => s === 'Réponse remise à l’agent.'));
    assert.match(f.c.api.cardEl(f.n, 26).innerHTML, /reply-delivery seen/);
  }],
  ['Statut inaccessible mais remise confirmée : aucune fausse attente de reconnexion', async () => {
    const f = setup({ statusFails: true, receipts: (n, previous) => ({ ...previous, userReplies: { note27: { 'message-neuf': { seenAt: '2026-10-26T02:44:01Z', message: n.thread[0] } } } }) });
    await f.send(); assert.equal(f.modals.length, 0); assert.ok(f.statuses.some(([s]) => s === 'Réponse remise à l’agent.'));
  }],
  ['Le contrôle après envoi n’accepte pas l’accusé d’un autre contenu portant le même identifiant', async () => {
    const f = setup({ receipts: (n, previous) => ({ ...previous, userReplies: { note27: { 'message-neuf': { seenAt: '2026-10-26T02:44:01Z', message: { ...n.thread[0], text: 'Une autre version' } } } } }) });
    await f.send(); assert.equal(f.modals.length, 1); assert.ok(!f.statuses.some(([s]) => s === 'Réponse remise à l’agent.'));
  }],
  ['Une erreur 503 du contrôle après envoi conserve les accusés déjà connus', async () => {
    const f = setup({ receiptsStatus: 503 }), previous = f.c.REPLIES;
    await f.send(); assert.equal(f.c.REPLIES, previous); assert.equal(f.modals.length, 1);
  }],
  ['Échec de sauvegarde : aucun succès ni contrôle distant, réponse conservée', async () => {
    const f = setup({ saved: false }); await f.send();
    assert.equal(f.modals.length, 0); assert.ok(!f.events.includes('status'));
    assert.equal(f.n.thread.length, 1); assert.ok(f.statuses.some(([s, kind]) => /pas encore enregistrée/.test(s) && kind === 'err'));
  }],
  ['Double clic pendant la sauvegarde : une seule réponse et une seule livraison', async () => {
    let resolve; const saved = new Promise((r) => { resolve = r; });
    const f = setup({ flush: () => saved }); const first = f.send(), second = f.send();
    assert.equal(f.n.thread.length, 1); resolve(true); await Promise.all([first, second]);
    assert.equal(f.events.filter((x) => x === 'flush').length, 1); assert.equal(f.modals.length, 1);
  }],
  ['Une réponse contenant seulement une image est enregistrée et signalée', async () => {
    const f = setup({ reply: '  ' }); await f.send();
    assert.equal(f.n.thread.length, 1); assert.equal(f.n.thread[0].text, ''); assert.equal(f.modals.length, 1);
  }],
  ['Une réponse vide n’est pas envoyée', async () => {
    const f = setup({ reply: '  ', images: [] }); await f.send();
    assert.equal(f.n.thread.length, 0); assert.equal(f.events.length, 0); assert.equal(f.modals.length, 0);
  }],
  ['Chaque réponse affiche son propre accusé, sans déduire une lecture d’une réponse de l’agent', () => {
    const f = setup(); f.n.thread = [{ id: 'a', text: 'Ancienne', at: '2026-10-26T00:00:00Z' }, { id: 'b', text: 'Nouvelle', at: '2026-10-26T01:00:00Z' }];
    f.c.REPLIES.userReplies.note27 = { a: { seenAt: '2026-10-26T02:00:00Z', agent: { name: 'Claude Code' }, message: f.n.thread[0] }, b: { seenAt: null, message: f.n.thread[1] } };
    const html = f.c.api.cardEl(f.n, 26).innerHTML;
    assert.equal((html.match(/class="reply-delivery seen"/g) ?? []).length, 1);
    assert.equal((html.match(/class="reply-delivery unseen"/g) ?? []).length, 1);
    assert.match(html, /Vue par l’agent/); assert.match(html, /Non vue par l’agent/);
    assert.match(html, /a confirmé avoir reçu cette réponse/); assert.match(html, /ne signifie pas que la correction est faite/);
  }],
  ['Anciennes réponses sans identifiant : les doublons gardent des accusés distincts', () => {
    const f = setup(); const m = { text: 'Toujours pas', at: '2026-10-26T02:44:00Z', images: [{ file: 'images/27.png' }] };
    f.n.thread = [{ ...m }, { ...m }];
    const key = 'legacy:' + JSON.stringify([m.at, m.text, ['images/27.png'], 1]);
    f.c.REPLIES.userReplies.note27 = { [key]: { seenAt: '2026-10-26T03:00:00Z', message: m } };
    const users = f.c.api.threadOf(f.n).filter((x) => x.from === 'user');
    assert.equal(users[0].delivery, null); assert.equal(users[1].delivery?.seenAt, '2026-10-26T03:00:00Z');
  }],
  ['Accusés injectés dans le texte de l’utilisateur : jamais interprétés comme état serveur', () => {
    const f = setup(); f.n.thread = [{ id: 'a', text: '<img onerror="1">', at: '2026-10-26T02:44:00Z', delivery: { seenAt: 'faux' } }];
    const html = f.c.api.cardEl(f.n, 26).innerHTML;
    assert.match(html, /&lt;img onerror=&quot;1&quot;&gt;/); assert.match(html, /reply-delivery unseen/); assert.doesNotMatch(html, /reply-delivery seen"/);
  }],
  ['Deux onglets sur la même note : la fusion conserve les deux réponses', () => {
    const f = setup(), a = { ...f.n, updated: '2026-10-26T01:00:00Z', thread: [{ id: 'a', text: 'Premier onglet', at: '2026-10-26T01:00:00Z' }] }, b = { ...f.n, text: 'Autre champ plus récent', updated: '2026-10-26T02:00:00Z', thread: [{ id: 'b', text: 'Second onglet', at: '2026-10-26T02:00:00Z' }] };
    const merged = f.c.api.mergeNotes([a], [b]);
    assert.equal(merged[0].text, b.text); assert.equal(merged[0].thread.length, 2); assert.deepEqual(Array.from(merged[0].thread, (m) => m.id), ['a', 'b']);
  }],
  ['La fusion ne duplique pas les mêmes réponses nouvelles ou anciennes', () => {
    const f = setup(), thread = [{ id: 'a', text: 'Déjà reçue', at: '2026-10-26T01:00:00Z' }, { text: 'Ancienne', at: '2026-10-26T00:00:00Z', images: [] }];
    const a = { ...f.n, thread }, b = { ...f.n, thread: JSON.parse(JSON.stringify(thread)) };
    const merged = f.c.api.mergeNotes([a], [b]); assert.equal(merged[0].thread.length, 2);
  }],
  ['Un message avec identifiant ne décale pas les occurrences des anciennes réponses', () => {
    const f = setup(), m = { text: 'Même contenu', at: '2026-10-26T02:44:00Z', images: [] };
    f.n.thread = [{ ...m, id: 'nouveau' }, { ...m }];
    const key = 'legacy:' + JSON.stringify([m.at, m.text, [], 0]);
    f.c.REPLIES.userReplies.note27 = { [key]: { seenAt: '2026-10-26T03:00:00Z', message: m } };
    const users = f.c.api.threadOf(f.n).filter((x) => x.from === 'user');
    assert.equal(users[0].delivery, null); assert.equal(users[1].delivery?.seenAt, '2026-10-26T03:00:00Z');
  }],
  ['Un accusé portant sur une ancienne version du message ne marque pas la nouvelle comme vue', () => {
    const f = setup(), m = { id: 'a', text: 'Avant', at: '2026-10-26T02:44:00Z', images: [] };
    f.n.thread = [{ ...m, text: 'Après' }];
    f.c.REPLIES.userReplies.note27 = { a: { seenAt: '2026-10-26T03:00:00Z', message: m } };
    assert.equal(f.c.api.threadOf(f.n).find((x) => x.from === 'user').delivery, null);
    assert.match(f.c.api.cardEl(f.n, 26).innerHTML, /reply-delivery unseen/);
  }],
  ['Les messages système n’ont pas de badge et ne décalent pas les anciens accusés', () => {
    const f = setup(), m = { text: 'Correction rétablie', at: '2026-10-26T02:44:00Z', images: [] };
    f.n.thread = [{ ...m, kind: 'system' }, { ...m }];
    const key = 'legacy:' + JSON.stringify([m.at, m.text, [], 0]);
    f.c.REPLIES.userReplies.note27 = { [key]: { seenAt: '2026-10-26T03:00:00Z', message: m } };
    const messages = f.c.api.threadOf(f.n);
    assert.equal(messages.find((x) => x.kind === 'system').delivery, null);
    assert.equal(messages.find((x) => x.from === 'user' && !x.kind).delivery?.seenAt, '2026-10-26T03:00:00Z');
    const html = f.c.api.cardEl(f.n, 26).innerHTML;
    assert.equal((html.match(/reply-delivery seen/g) ?? []).length, 1);
    assert.equal((html.match(/reply-delivery unseen/g) ?? []).length, 0);
  }],
  ['Contrat réel serveur et page : deux identifiants, deux anciennes réponses identiques et un message système', () => {
    const f = setup(), m = { text: 'Toujours pas, même capture.', at: '2026-10-26T02:44:00Z', images: [{ file: 'images/capture.png' }] };
    f.n.thread = [{ ...m, id: 'moderne-a' }, { ...m }, { ...m, kind: 'system' }, { ...m, id: 'moderne-b' }, { ...m }];
    const parent = path.join(fileURLToPath(root), '.cache', 'reply-delivery-ui');
    fs.mkdirSync(parent, { recursive: true });
    const dir = fs.mkdtempSync(path.join(parent, 'contrat-')), p = { REVUE: dir, NOTES: path.join(dir, 'notes.json') };
    const save = () => fs.writeFileSync(p.NOTES, JSON.stringify({ notes: [f.n] }), 'utf8');
    save();
    const ledger = syncUserReplies(p, { notes: [f.n] });
    assert.equal(ledger.entries.length, 4, 'Le serveur archive quatre réponses, aucun message système');
    acknowledgeUserReplies(p, [ledger.entries[0], ledger.entries[1]], { id: 'codex', name: 'Codex' });
    f.c.REPLIES.userReplies = userReplyReceipts(p);
    let messages = f.c.api.threadOf(f.n).filter((x) => x.from === 'user' && x.kind !== 'system');
    assert.equal(messages.length, 4);
    assert.ok(messages[0].delivery?.seenAt, 'L’identifiant moderne accusé est vu');
    assert.ok(messages[1].delivery?.seenAt, 'La première ancienne réponse accusée est vue');
    assert.equal(messages[2].delivery?.seenAt, null, 'L’autre identifiant reste non vu');
    assert.equal(messages[3].delivery?.seenAt, null, 'La seconde ancienne réponse reste non vue');
    let html = f.c.api.cardEl(f.n, 26).innerHTML;
    assert.equal((html.match(/reply-delivery seen/g) ?? []).length, 2);
    assert.equal((html.match(/reply-delivery unseen/g) ?? []).length, 2);
    // Déplacer les messages modernes et système n’altère jamais les clés des deux anciens messages.
    const before = { ...f.n, thread: [...f.n.thread] };
    f.n.thread = [f.n.thread[1], f.n.thread[4], f.n.thread[3], f.n.thread[2], f.n.thread[0]];
    const merged = f.c.api.mergeNotes([before], [f.n]);
    assert.equal(merged[0].thread.length, 5, 'La fusion ne duplique pas les réponses quand les messages identifiés sont déplacés');
    f.n.thread = merged[0].thread;
    save();
    assert.equal(syncUserReplies(p, { notes: [f.n] }).entries.length, 4);
    acknowledgeUserReplies(p, ledger.entries, { id: 'codex', name: 'Codex' });
    f.c.REPLIES.userReplies = userReplyReceipts(p);
    messages = f.c.api.threadOf(f.n).filter((x) => x.from === 'user' && x.kind !== 'system');
    assert.ok(messages.every((x) => x.delivery?.seenAt), 'Les quatre accusés réels restent attribués après réordonnancement');
    html = f.c.api.cardEl(f.n, 26).innerHTML;
    assert.equal((html.match(/reply-delivery seen/g) ?? []).length, 4);
    assert.equal((html.match(/reply-delivery unseen/g) ?? []).length, 0);
  }],
  ['Deux réponses anciennes identiques restent deux réponses après fusion', () => {
    const f = setup(), m = { text: 'Ancienne', at: '2026-10-26T00:00:00Z', images: [] };
    const a = { ...f.n, thread: [{ ...m }, { ...m }] }, b = { ...f.n, thread: [{ ...m }] };
    const merged = f.c.api.mergeNotes([a], [b]); assert.equal(merged[0].thread.length, 2);
  }],
  ['Une erreur HTTP 503 ne remplace pas les accusés connus par un faux état non vu', async () => {
    const f = setup(), previous = f.c.REPLIES;
    f.c.fetch = async (url) => ({ ok: !url.includes('replies'), status: url.includes('replies') ? 503 : 200, text: async () => url.includes('replies') ? '{"error":"unreadable"}' : '{"agent":{"watching":false}}' });
    await f.c.api.pollReplies();
    assert.equal(f.c.REPLIES, previous); assert.ok(f.statuses.some(([s, kind]) => s === 'st.save.paused' && kind === 'err'));
  }],
];
let ok = 0, ko = 0;
for (const [label, run] of tests) { try { await run(); console.log(`✓ ${label}`); ok++; } catch (error) { console.error(`✗ ${label}\n  ${error.message}`); ko++; } }
console.log(`${ok} ok, ${ko} ko`); process.exitCode = ko ? 1 : 0;

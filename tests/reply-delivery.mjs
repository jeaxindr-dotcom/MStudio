// Réponses envoyées sans agent, puis reconnexion : test du vrai CLI sans serveur
// ni navigateur. --baseline <révision> exécute le CLI de cette révision.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { Writable } from 'node:stream';
import { readJson, writeJson } from '../lib/episode.mjs';
import { waitForRenderIdle } from '../lib/render-activity.mjs';
import { syncUserReplies, userReplyReceipts, pendingUserReplies, acknowledgeUserReplies, prepareUserReplyDelivery, acknowledgeUserReplyDelivery, userReplyKey, userRepliesFile, writeDelivered } from '../lib/reply-delivery.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bi = process.argv.indexOf('--baseline'), baseline = bi >= 0 ? process.argv[bi + 1] : null;
const source = baseline ? execFileSync('git', ['show', `${baseline}:studio-cli.mjs`], { cwd: ROOT, encoding: 'utf8' }) : null;
const CACHE = path.join(ROOT, '.cache', 'reply-delivery'); fs.mkdirSync(CACHE, { recursive: true });
const DIR = fs.mkdtempSync(path.join(CACHE, baseline ? 'avant-' : 'apres-'));
const env = { ...process.env, COULISSES_LANG: 'fr', COULISSES_SETTINGS: path.join(DIR, 'settings.json'), STUDIO_PROJECTS: path.join(DIR, 'projets.json'), COULISSES_MEDIAS: path.join(DIR, 'medias') };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, ko = 0;
const checks = [];
function check(condition, name) { condition ? ok++ : ko++; checks.push({ name, ok: !!condition }); console.log(`  ${condition ? '✓' : '✗'} ${name}`); }
function fixture(name) {
  const REVUE = path.join(DIR, name, 'revue'); fs.mkdirSync(path.join(REVUE, 'lots'), { recursive: true });
  writeJson(path.join(REVUE, 'projet.json'), { kind: 'folder', title: name, root: '..' });
  const p = { REVUE, NOTES: path.join(REVUE, 'notes.json'), REPLIES: path.join(REVUE, 'replies.json'), LOTS: path.join(REVUE, 'lots'), AGENT: path.join(REVUE, 'studio-agent.json') };
  writeJson(p.NOTES, { notes: [] }); writeJson(p.REPLIES, { notes: {}, lots: {} }); return p;
}
const note = (thread) => ({ id: 'note-27', text: 'Corriger les signes visibles.', frame: 270, end: 300, lot: 4, draft: false, source: 'code', thread });
const message = (id, text = 'Toujours pas : les signes sont encore visibles.') => ({ ...(id ? { id } : {}), at: '2026-10-26T02:44:00.000Z', text, images: [{ file: 'images/preuve.png' }] });
function run(args) {
  const child = spawn(process.execPath, source ? ['--input-type=module', '-', ...args] : [path.join(ROOT, 'studio-cli.mjs'), ...args], { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', (b) => { stdout += b; }); child.stderr.on('data', (b) => { stderr += b; });
  if (source) child.stdin.end(source); else child.stdin.end();
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code) => resolve({ code, stdout, stderr })); });
  return { child, done };
}
const wait = (p, timeout = 2) => run(['wait', p.REVUE, '--agent', 'codex', '--timeout', String(timeout)]);
const deliveryId = (stdout) => /LIVRAISON RÉPONSES ([a-f0-9-]+)/.exec(stdout)?.[1];
const ack = (p, output) => run(['ack-replies', p.REVUE, deliveryId(output) ?? 'inconnue', '--agent', 'codex']).done;
await waitForRenderIdle();
try {
  const p = fixture('absence-puis-reconnexion'), m = message('reponse-27');
  writeJson(p.NOTES, { notes: [note([m])] });
  writeJson(p.REPLIES, { notes: { 'note-27': { messages: [{ at: '2026-10-25T13:49:00Z', text: 'Corrigé.' }] } }, lots: { 4: { status: 'done' } } });
  writeJson(p.AGENT, { waiting: false, beat: '2026-10-26T02:45:03Z', lastLot: 5 });
  const first = await wait(p, 1).done;
  check(first.code === 0 && first.stdout.includes('RÉPONSES UTILISATEUR REÇUES'), 'la reconnexion reçoit une réponse envoyée sans agent, après un lot terminé');
  check(first.stdout.includes(m.text) && first.stdout.includes(path.join(p.REVUE, 'images', 'preuve.png')), 'le texte et le chemin absolu de sa preuve sont livrés');
  check(first.stdout.includes('note-27') && first.stdout.includes('lot 4') && first.stdout.includes('270'), 'la note, le lot et le moment sont identifiés');
  check(!userReplyReceipts(p)['note-27']?.[m.id]?.seenAt, 'la sortie de wait ne vaut pas accusé de lecture');
  const again = await wait(p, 0.2).done;
  check(again.stdout.includes(m.text), 'sans accusé explicite la reconnexion remet la réponse non vue');
  const acknowledgement = await ack(p, first.stdout), seen = userReplyReceipts(p)['note-27']?.[m.id];
  check(acknowledgement.code === 0 && !!seen?.seenAt && seen.agent?.id === 'codex', 'ack-replies enregistre la lecture déclarée et son destinataire');
  const second = await wait(p, 0.2).done;
  check(!!seen?.seenAt && !second.stdout.includes(m.text), 'une réponse déjà livrée ne réveille pas la connexion suivante');

  const live = fixture('attente-active'), running = wait(live, 5);
  for (let i = 0; i < 50 && !readJson(live.AGENT, {})?.waiting; i++) await sleep(50);
  const started = Date.now(); writeJson(live.NOTES, { notes: [note([message('nouvelle', 'Nouvelle réponse pendant l’attente.')])] });
  const arrival = await running.done;
  check(arrival.code === 0 && arrival.stdout.includes('Nouvelle réponse pendant l’attente.') && Date.now() - started < 4000, 'une réponse nouvelle réveille wait sans créer de lot');

  const expired = fixture('attente-expiree'), timeout = await wait(expired, 0.2).done;
  check(timeout.code === 0 && readJson(expired.AGENT, {})?.waiting === false, 'une attente expirée sans réponse termine avec waiting:false');
  const late = message('après-expiration', 'Réponse envoyée après la fin de l’attente.');
  writeJson(expired.NOTES, { notes: [note([late])] });
  const reconnect = await wait(expired, 0.2).done;
  check(reconnect.stdout.includes(late.text) && !userReplyReceipts(expired)['note-27']?.[late.id]?.seenAt, 'après expiration, la prochaine connexion livre la réponse et la conserve non vue jusqu’à son accusé');

  const priority = fixture('priorite'); writeJson(priority.NOTES, { notes: [note([message('prioritaire')])] });
  writeJson(path.join(priority.LOTS, '005.json'), { lot: 5, edits: [], sentAt: new Date().toISOString() }); fs.writeFileSync(path.join(priority.LOTS, '005.md'), 'NOUVEAU LOT À TRAITER');
  const output = await wait(priority, 1).done;
  check(output.stdout.indexOf('RÉPONSES UTILISATEUR REÇUES') >= 0 && output.stdout.indexOf('RÉPONSES UTILISATEUR REÇUES') < output.stdout.indexOf('LOT 5 REÇU'), 'les réponses précèdent le nouveau lot dans la même livraison');

  if (!baseline) {
    check(first.stdout.includes('Corrigé.') && first.stdout.includes(path.join(p.LOTS, '004.md')), 'la livraison donne la réponse précédente de l’agent et la demande du lot à relire');
    const archive = fixture('archive'), original = { notes: [note([message('archivée')])] };
    syncUserReplies(archive, original); writeJson(archive.NOTES, { notes: [] });
    const archived = await wait(archive, 1).done;
    await ack(archive, archived.stdout);
    check(archived.stdout.includes('Toujours pas') && !!userReplyReceipts(archive)['note-27']?.['archivée']?.seenAt, 'retirer une carte ne perd pas sa réponse archivée non vue');

    const legacy = fixture('legacy'), old = message(null), doc = { notes: [note([old, structuredClone(old)])] };
    writeJson(legacy.NOTES, doc); const bytes = fs.readFileSync(legacy.NOTES);
    syncUserReplies(legacy, doc); syncUserReplies(legacy, doc);
    check(pendingUserReplies(legacy).length === 2, 'les réponses anciennes sans identifiant sont distinctes et leur migration est idempotente');
    check(bytes.equals(fs.readFileSync(legacy.NOTES)), 'la migration CLI ne réécrit jamais notes.json');
    const pending = pendingUserReplies(legacy); acknowledgeUserReplies(legacy, [pending[0]], { id: 'codex', name: 'Codex' });
    check(userReplyReceipts(legacy)['note-27'][userReplyKey(old, 0)].seenAt && !userReplyReceipts(legacy)['note-27'][userReplyKey(old, 1)].seenAt, 'chaque réponse ancienne possède son propre accusé');
    const mixed = fixture('legacy-et-id'), mixedDoc = { notes: [note([{ ...old, id: 'moderne' }, old, old])] };
    writeJson(mixed.NOTES, mixedDoc); syncUserReplies(mixed, mixedDoc);
    const mixedKeys = Object.keys(userReplyReceipts(mixed)['note-27']);
    check(mixedKeys.includes('moderne') && mixedKeys.includes(userReplyKey(old, 0)) && mixedKeys.includes(userReplyKey(old, 1)), 'un message moderne identique ne décale pas les identifiants des anciennes réponses');

    const changed = fixture('contenu-change'), a = message('stable'); writeJson(changed.NOTES, { notes: [note([a])] }); syncUserReplies(changed, { notes: [note([a])] });
    acknowledgeUserReplies(changed, pendingUserReplies(changed), { id: 'codex', name: 'Codex' });
    const b = { ...a, text: 'Correction du texte envoyé.' }; writeJson(changed.NOTES, { notes: [note([b])] }); syncUserReplies(changed, { notes: [note([b])] });
    check(!userReplyReceipts(changed)['note-27'].stable.seenAt && pendingUserReplies(changed).length === 1, 'modifier le texte avec le même identifiant invalide son accusé');
    const snapshot = pendingUserReplies(changed), c = message('arrivée-après-sortie'); syncUserReplies(changed, { notes: [note([b, c])] });
    acknowledgeUserReplies(changed, snapshot, null);
    check(pendingUserReplies(changed).length === 1 && pendingUserReplies(changed)[0].key === c.id, 'une réponse arrivée pendant la sortie ne reçoit pas l’accusé d’une autre');

    let failed = false;
    const broken = new Writable({ write(_chunk, _enc, callback) { callback(Object.assign(new Error('EPIPE'), { code: 'EPIPE' })); } });
    try { await writeDelivered(broken, 'non remis'); acknowledgeUserReplies(changed, pendingUserReplies(changed), null); } catch { failed = true; }
    await sleep(0);
    check(failed && pendingUserReplies(changed).length === 1, 'une sortie fermée refuse l’accusé et conserve la réponse en attente');

    const pipe = fixture('sortie-cli-fermee'), big = message('sortie-perdue', 'Réponse longue '.repeat(300000) + ' FIN DE LA RÉPONSE');
    writeJson(pipe.NOTES, { notes: [note([big])] });
    const pipeWait = wait(pipe, 2); pipeWait.child.stdout.once('data', () => pipeWait.child.stdout.destroy());
    const pipeResult = await pipeWait.done;
    check(!userReplyReceipts(pipe)['note-27']['sortie-perdue'].seenAt && pendingUserReplies(pipe).length === 1, 'fermer le vrai tube stdout du CLI ne marque pas la réponse comme vue');
    const complete = fs.readdirSync(path.join(pipe.REVUE, 'user-reply-deliveries')).find((f) => f.endsWith('.md'));
    check(pipeResult.stdout.length <= 12000 && fs.readFileSync(path.join(pipe.REVUE, 'user-reply-deliveries', complete), 'utf8').includes('FIN DE LA RÉPONSE'), 'la sortie est bornée mais la livraison durable conserve le texte complet');
    const many = fixture('livraison-bornee'), manyDoc = { notes: [note(Array.from({ length: 21 }, (_, i) => message(`m-${i}`, `Réponse ${i}`)))] };
    writeJson(many.NOTES, manyDoc); syncUserReplies(many, manyDoc);
    const delivery = prepareUserReplyDelivery({ ...many, target: `"${many.REVUE}"` }, pendingUserReplies(many));
    acknowledgeUserReplyDelivery(many, delivery.id, null);
    check(delivery.entries.length === 20 && pendingUserReplies(many).length === 1 && pendingUserReplies(many)[0].key === 'm-20', 'un accusé est borné aux vingt réponses de sa livraison et ne touche pas la suivante');
    const parallel = fixture('accuses-simultanes'), pa = message('première'), pb = message('deuxième'), pc = message('nouvelle-arrivée');
    const firstDoc = { notes: [note([pa, pb])] }; writeJson(parallel.NOTES, firstDoc); syncUserReplies(parallel, firstDoc);
    const previous = pendingUserReplies(parallel), target = { ...parallel, target: `"${parallel.REVUE}"` };
    const da = prepareUserReplyDelivery(target, [previous[0]]), db = prepareUserReplyDelivery(target, [previous[1]]);
    const nextDoc = { notes: [note([pa, pb, pc])] }; writeJson(parallel.NOTES, nextDoc);
    const lock = `${userRepliesFile(parallel)}.lock`; fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
    let parallelResults;
    try {
      const acknowledgements = [da, db].map((d) => run(['ack-replies', parallel.REVUE, d.id, '--agent', 'codex']).done);
      const script = "import {syncUserReplies} from './lib/reply-delivery.mjs'; const {p,doc}=JSON.parse(process.argv[1]); syncUserReplies(p,doc);";
      const syncChild = spawn(process.execPath, ['--input-type=module', '-e', script, JSON.stringify({ p: parallel, doc: nextDoc })], { cwd: ROOT, env, stdio: ['ignore','ignore','pipe'] });
      let syncError = ''; syncChild.stderr.on('data', b => syncError += b);
      const synced = new Promise((resolve, reject) => { syncChild.once('error', reject); syncChild.once('close', (code) => resolve({ code, stderr:syncError })); });
      await sleep(500); fs.rmSync(lock);
      parallelResults = await Promise.all([...acknowledgements, synced]);
    } finally { fs.rmSync(lock, { force: true }); }
    const parallelReceipts = userReplyReceipts(parallel)['note-27'], remaining = pendingUserReplies(parallel);
    for (const result of parallelResults) if (result.code !== 0) console.error(result.stderr);
    check(parallelResults.every((r) => r.code === 0) && !!parallelReceipts[pa.id].seenAt && !!parallelReceipts[pb.id].seenAt && !parallelReceipts[pc.id].seenAt && remaining.length === 1 && remaining[0].key === pc.id,
      'deux accusés simultanés et l’archivage concurrent d’une réponse conservent les trois messages sans accuser le nouveau');
    let refusedId = false; try { acknowledgeUserReplyDelivery(many, '../inconnue', null); } catch { refusedId = true; }
    check(refusedId && pendingUserReplies(many).length === 1, 'un identifiant de livraison invalide ne peut accuser une réponse');
    const damaged = prepareUserReplyDelivery({ ...many, target: `"${many.REVUE}"` }, pendingUserReplies(many));
    fs.writeFileSync(damaged.file, 'Fichier tronqué.'); let refusedFile = false;
    try { acknowledgeUserReplyDelivery(many, damaged.id, null); } catch { refusedFile = true; }
    check(refusedFile && pendingUserReplies(many).length === 1, 'une livraison durable tronquée ne peut pas être accusée comme lue');
    const technical = fixture('message-technique'), technicalDoc = { notes: [note([{ ...message('annulation'), kind: 'system' }, message('humaine')])] };
    writeJson(technical.NOTES, technicalDoc); syncUserReplies(technical, technicalDoc);
    check(pendingUserReplies(technical).length === 1 && !userReplyReceipts(technical)['note-27'].annulation, 'les messages techniques ne sont pas livrés ni présentés comme réponses utilisateur');

    const corrupt = fixture('archive-illisible'); fs.writeFileSync(userRepliesFile(corrupt), '{"version":1,');
    let refus = 0;
    for (const op of [() => syncUserReplies(corrupt, original), () => userReplyReceipts(corrupt), () => pendingUserReplies(corrupt)]) try { op(); } catch { refus++; }
    check(refus === 3 && fs.readFileSync(userRepliesFile(corrupt), 'utf8') === '{"version":1,', 'une archive illisible est signalée et jamais remplacée par une file vide');
    const beatOnly = fixture('battement'), msg = message('pas-vue'); writeJson(beatOnly.NOTES, { notes: [note([msg])] }); syncUserReplies(beatOnly, { notes: [note([msg])] });
    writeJson(beatOnly.AGENT, { waiting: true, beat: new Date().toISOString() });
    check(!userReplyReceipts(beatOnly)['note-27']['pas-vue'].seenAt, 'un battement récent ne marque aucune réponse comme vue');
  }
} catch (e) { check(false, `Erreur : ${e.stack}`); }
writeJson(path.join(DIR, 'resultat.json'), { baseline, ok, ko, checks });
console.log(`\n${ok} ok, ${ko} ko\nPreuves : ${DIR}`);
process.exitCode = ko ? 1 : 0;

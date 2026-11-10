// File durable des réponses de l'utilisateur. Les notes restent la propriété de
// la page ; wait archive les anciennes réponses sans réécrire notes.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { APP_NAME } from './app-profile.mjs';
import { cliCommand, cliTarget } from './cli-command.mjs';
import { readJsonStrict, updateJson, writeJson, nowIso } from './episode.mjs';

export const userRepliesFile = (p) => path.join(p.REVUE, 'user-replies.json');
const digest = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const tuple = (m) => [m.at ?? '', m.text ?? '', (m.images ?? []).map((i) => i?.file ?? i)];
export const userReplyKey = (m, occurrence = 0) => typeof m.id === 'string' && m.id ? m.id : `legacy:${JSON.stringify([...tuple(m), occurrence])}`;
const versionOf = (noteId, key, message) => digest([noteId, key, tuple(message)]);
const empty = () => ({ version: 1, entries: [] });
function valid(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.entries)) throw new Error('File des réponses utilisateur illisible : aucune réponse ni aucun accusé ne sera écrasé.');
  return data;
}
const ledger = (p) => valid(readJsonStrict(userRepliesFile(p), empty()));

function records(notesDocument) {
  const out = [];
  for (const n of notesDocument?.notes ?? []) {
    if (typeof n?.id !== 'string') continue;
    const occurrences = new Map();
    for (const m of n.thread ?? []) {
      if (!m || m.kind === 'system' || (!String(m.text ?? '').trim() && !(m.images ?? []).length)) continue;
      const canonical = JSON.stringify(tuple(m)), occurrence = occurrences.get(canonical) ?? 0;
      if (!(typeof m.id === 'string' && m.id)) occurrences.set(canonical, occurrence + 1);
      const key = userReplyKey(m, occurrence), version = versionOf(n.id, key, m);
      out.push({ version, noteId: n.id, key, message: structuredClone(m),
        note: { text: n.text ?? '', frame: n.frame ?? null, end: n.end ?? null, lot: n.lot ?? null, source: n.source ?? null, at: n.at ?? null, context: n.context ?? null, images: n.images ?? [], mark: n.mark ?? null } });
    }
  }
  return out;
}

// Appelé avant d'accuser la sauvegarde HTTP. Ancien et nouveau document sont
// archivés par le serveur : un retrait de carte ne retire pas sa réponse en attente.
export function syncUserReplies(p, notesDocument) {
  const candidates = records(notesDocument), previous = ledger(p), existing = new Set(previous.entries.map((e) => e.version));
  if (!candidates.some((r) => !existing.has(r.version))) return previous;
  fs.mkdirSync(p.REVUE, { recursive: true });
  return updateJson(userRepliesFile(p), empty(), (data) => {
    valid(data);
    const known = new Set(data.entries.map((e) => e.version));
    for (const record of candidates) if (!known.has(record.version)) {
      data.entries.push({ ...record, queuedAt: nowIso(), seenAt: null, agent: null }); known.add(record.version);
    }
  });
}

// Aucune déduction à partir d'un battement, d'un take/done ou d'une date de réponse.
export function userReplyReceipts(p) {
  const data = ledger(p), projected = Object.create(null);
  const set = (e) => {
    const byNote = projected[e.noteId] ??= Object.create(null);
    byNote[e.key] = { seenAt: e.seenAt ?? null, agent: e.agent ?? null, message: e.message };
  };
  for (const e of data.entries) if (e.message.kind !== 'system') set(e);
  // Un identifiant réutilisé avec un texte différent n'hérite jamais de l'accusé.
  // La projection suit le document effectivement sauvegardé, même si une autre
  // version vient d'être archivée juste avant son écriture atomique.
  const byVersion = new Map(data.entries.map((e) => [e.version, e]));
  for (const r of records(readJsonStrict(p.NOTES, { notes: [] }))) set(byVersion.get(r.version) ?? r);
  return projected;
}

export function pendingUserReplies(p) {
  return ledger(p).entries.filter((e) => !e.seenAt && e.message.kind !== 'system').sort((a, b) => (Date.parse(a.message.at) || 0) - (Date.parse(b.message.at) || 0));
}

// Seul l'accusé explicite d'une livraison peut appeler ceci : la sortie d'un
// outil peut être tronquée, même lorsque stdout a réussi côté système.
export function acknowledgeUserReplies(p, delivered, agent) {
  const versions = new Set(delivered.map((e) => e.version));
  if (!versions.size) return;
  updateJson(userRepliesFile(p), empty(), (data) => {
    valid(data);
    for (const e of data.entries) if (versions.has(e.version) && !e.seenAt) {
      e.seenAt = nowIso(); e.agent = agent ? { id: agent.id, name: agent.name } : null;
    }
  });
}

export function userRepliesMarkdown(p, entries, { cli = 'studio-cli.mjs' } = {}) {
  const answers = readJsonStrict(p.REPLIES, { notes: {} });
  const lines = [`RÉPONSES UTILISATEUR REÇUES (${entries.length})`, '',
    'Ces réponses étaient en attente. Lire ce fichier complet avant les nouveaux lots, puis accuser explicitement sa lecture. La correction reste à faire.',
    'Migration : une ancienne réponse sans accusé est remise par prudence, même si elle semble déjà traitée. Vérifier la discussion avant de refaire une correction.',
    `Projet : ${p.title ?? p.ep}`, `Dossier de revue : ${p.REVUE}`, ''];
  for (const e of entries) {
    lines.push(`## Note ${e.noteId}${e.note.lot != null ? ` · lot ${e.note.lot}` : ''} · réponse du ${e.message.at ?? 'date inconnue'}`,
      `Image : ${e.note.frame ?? '?'}${e.note.end != null ? ` à ${e.note.end}` : ''}${e.note.source ? ` · source ${e.note.source}` : ''}`,
      `Note initiale : ${e.note.text}`, '', String(e.message.text ?? ''));
    for (const im of e.message.images ?? []) {
      const file = typeof im === 'string' ? im : im?.file;
      if (file) lines.push(`Image jointe à regarder : ${path.resolve(p.REVUE, file)}`);
    }
    if (e.note.lot != null) lines.push(`Demande du lot à relire : ${path.join(p.LOTS ?? path.join(p.REVUE, 'lots'), `${String(e.note.lot).padStart(3, '0')}.md`)}`);
    const history = answers?.notes?.[e.noteId]?.messages ?? [];
    for (const m of history.slice(-3)) lines.push(`Réponse précédente de l'agent (${m.at ?? 'date inconnue'}) : ${m.text ?? ''}`);
    if (e.note.context) lines.push(`Contexte enregistré : ${JSON.stringify(e.note.context)}`);
    lines.push(`Répondre dans ${APP_NAME} : ${cliCommand(cli)} reply ${cliTarget(p)} "${e.noteId}" "<réponse>" --status done`, '');
  }
  lines.push('Si la note a été retirée entre-temps, ne pas la recréer ni corriger aveuglément : signaler son retrait. Conserver les instantanés et vérifications du protocole habituel.', '');
  return lines.join('\n');
}

export const MAX_DELIVERY_REPLIES = 20;
export function prepareUserReplyDelivery(p, pending, { cli = 'studio-cli.mjs' } = {}) {
  const entries = pending.slice(0, MAX_DELIVERY_REPLIES), id = crypto.randomUUID();
  if (!entries.length) throw new Error('Aucune réponse à livrer.');
  const dir = path.join(p.REVUE, 'user-reply-deliveries'), file = path.join(dir, `${id}.md`);
  const command = `${cliCommand(cli)} ack-replies ${cliTarget(p)} ${id}`;
  const markdown = userRepliesMarkdown(p, entries, { cli });
  fs.mkdirSync(dir, { recursive: true });
  const document = `${markdown}\nAprès lecture complète de cette livraison, accuser sa lecture :\n${command}\n`;
  fs.writeFileSync(file, document, 'utf8');
  writeJson(path.join(dir, `${id}.json`), { version: 1, id, at: nowIso(), versions: entries.map((e) => e.version), markdownSha256: digest(document) });
  const head = [`RÉPONSES UTILISATEUR REÇUES (${entries.length} sur ${pending.length} en attente)`,
    `LIVRAISON RÉPONSES ${id}`, `Lire le fichier complet : ${file}`,
    `Après lecture complète seulement : ${command}`,
    'Sans cet accusé explicite, les réponses restent non vues et seront remises à la prochaine connexion.', ''];
  const available = Math.max(0, 8500 - head.join('\n').length);
  const excerpt = markdown.length > available ? `${markdown.slice(0, available)}\n[Extrait abrégé : la livraison complète se trouve dans le fichier indiqué ci-dessus.]` : markdown;
  return { id, file, entries, output: head.join('\n') + excerpt };
}

export function acknowledgeUserReplyDelivery(p, id, agent) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error('Identifiant de livraison invalide.');
  const dir = path.join(p.REVUE, 'user-reply-deliveries'), manifest = readJsonStrict(path.join(dir, `${id}.json`), null);
  if (!manifest || manifest.version !== 1 || manifest.id !== id || !Array.isArray(manifest.versions) || !manifest.versions.length || manifest.versions.length > MAX_DELIVERY_REPLIES || !fs.existsSync(path.join(dir, `${id}.md`))) throw new Error('Livraison absente ou invalide : aucun accusé enregistré.');
  if (manifest.markdownSha256 !== digest(fs.readFileSync(path.join(dir, `${id}.md`), 'utf8'))) throw new Error('Livraison modifiée ou incomplète : aucun accusé enregistré.');
  const byVersion = new Map(ledger(p).entries.map((e) => [e.version, e]));
  const entries = manifest.versions.map((v) => byVersion.get(v));
  if (entries.some((e) => !e)) throw new Error('Livraison inconnue de la file : aucun accusé enregistré.');
  acknowledgeUserReplies(p, entries, agent);
  return entries.length;
}

export function writeDelivered(stream, text) {
  return new Promise((resolve, reject) => {
    const fail = (error) => { stream.removeListener('error', fail); reject(error); };
    stream.once('error', fail);
    stream.write(text, (error) => {
      if (error) { reject(error); return; } // l'événement error suit le callback ; son écouteur reste jusqu'alors.
      stream.removeListener('error', fail); resolve();
    });
  });
}

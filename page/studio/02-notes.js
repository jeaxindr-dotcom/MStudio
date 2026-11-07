// The studio's page (studio.html), part 02: the notes, their images, an image of the library placed on the picture, saving, Ctrl+Z / Ctrl+Y.
// The parts of page/studio/ are one script: studio-server.mjs joins them in their order inside one function (/studio.js),
// so they share their names as the one inline script did; hence the two-space indent.
  // ---------- notes ----------
  const sorted = () => [...notes].sort((a, b) => a.frame - b.frame || (a.end ?? a.frame) - (b.end ?? b.frame));
  // the notes of the review, numbered alike everywhere (cards, timeline, pins, the marks sent, the inspector, « Comparer »):
  // without the requests of the Agent tab (they shifted the numbers outside the cards, and could be moved or deleted in the
  // Notes band)
  const reviewed = () => sorted().filter((n) => n.kind !== 'prompt');
  // a time of the plan (rounded to the ms) to its frame: the frame it starts (k/30 s read as 3.333 s was frame 99, not 100)
  const frameOfT = (t) => Math.round(t * FPS);
  const byId = (id) => notes.find((n) => n.id === id);
  const drafts = () => sorted().filter((n) => n.draft && n.kind !== 'prompt');
  const reply = (n) => REPLIES.notes?.[n.id] ?? null;
  function statusOf(n) {
    const r = reply(n), ut = Date.parse(n.statusAt || 0) || 0, ct = Date.parse(r?.statusAt || 0) || 0;
    return r?.status && ct > ut ? r.status : (n.status || 'open');
  }
  // the colour of a note (user request, 18/10/2026: « rouge = je place une note, bleu = il l'a corrigée, verte = je l'ai
  // validée »): 'todo' red (waiting to be sent, sent, the agent on it), 'fixed' blue (the agent says it fixed it — or the
  // « corrigé » ticked), 'ok' green (the user checked the fix: « Valider »; only the user gives it, never the agent)
  const stateOf = (n) => { const s = statusOf(n); return s === 'verified' ? 'ok' : s === 'done' ? 'fixed' : 'todo'; };
  const fixedOf = (n) => stateOf(n) !== 'todo';   // fixed, validated or not
  const stateColor = (n) => C[{ todo: 'ntodo', fixed: 'nfixed', ok: 'nok' }[stateOf(n)]];
  // « Toutes les notes » or one batch's (user request, 18/10/2026): the Notes tab, the timeline and the marks on the
  // picture show that batch's notes only. The notes not sent yet always show (they are in no batch yet: the one just
  // placed never vanishes). 'none': the notes sent without a batch (before batches were made). Kept for this video.
  let LOTF = 'all';
  const lotfKey = () => `lotf:${META?.notesFile ?? META?.episode ?? location.port}`;
  const inLotF = (n) => LOTF === 'all' || n.draft || (LOTF === 'none' ? !n.lot : String(n.lot) === String(LOTF));
  const shownNotes = () => reviewed().filter(inLotF);
  function setLotF(v, draw0 = true) {
    LOTF = v === 'all' || v === 'none' ? v : +v || 'all'; store.set(lotfKey(), LOTF);
    if (draw0) { if (sel && !inLotF(byId(sel) ?? {})) sel = null; renderAll(); }
  }
  // the texts added with the colours and the batch filter, for a studio started before them (its dictionary is the one
  // it read when it started; the page itself is read again at each load): the key itself never shows
  const NEWT = {
    fr: { 'st.reply.unseen': 'Non vue par l’agent', 'st.reply.seen': 'Vue par l’agent', 'st.reply.seenTitle': 'L’agent a confirmé avoir reçu cette réponse le {at}. Cela ne signifie pas que la correction est faite.',
      'st.reply.unseenTitle': 'Cette réponse attend sa remise à un agent connecté.', 'st.reply.saved': 'Réponse enregistrée', 'st.reply.waiting': 'Réponse enregistrée, en attente de remise à l’agent.', 'st.reply.delivered': 'Réponse remise à l’agent.',
      'st.reply.offline': 'Aucun agent ne surveille Coulisses : ta réponse attendra sa reconnexion.', 'st.reply.unknown': 'La surveillance de l’agent n’a pas pu être vérifiée : ta réponse est enregistrée et attendra sa reconnexion si nécessaire.',
      'st.reply.connect': 'Copie cette ligne dans la session de l’agent pour le reconnecter. Les réponses non vues lui seront remises en premier.', 'st.reply.failed': 'La réponse n’est pas encore enregistrée. Coulisses réessaie ; garde cette page ouverte.',
      'st.card.verify': 'Valider', 'st.card.verifiedBtn': 'Validée', 'st.card.verified': 'validée', 'st.card.verifyTitle': 'Tu as vérifié la correction : la note passe au vert. Clique encore pour revenir à « corrigée ».',
      'st.list.verified': ' · {n} validée{n||s}', 'st.list.allHidden': 'Rien à afficher : les notes d’ici sont toutes validées (décoche « masquer les validées »).', 'st.notes.hideOk': 'masquer les validées',
      'st.notes.lotAll': 'Toutes les notes ({n})', 'st.notes.lotOne': 'Lot {lot} · {n} note{n||s}', 'st.notes.lotNone': 'Hors lot · {n} note{n||s}', 'st.notes.lotTitle': 'Toutes les notes, ou celles d’un seul lot : dans cette liste, sur la timeline et sur l’image',
      'st.notes.okAll': 'Tout valider ({n})', 'st.notes.okAllTitle': 'Les notes corrigées de ce lot passent au vert (Ctrl+Z pour revenir)', 'st.notes.okAllDone': '{n} note{n||s} validée{n||s} · Ctrl+Z pour revenir', 'st.insp.stVerified': 'validée',
      'st.sound.btn': "Rétablir le son (s'il a disparu après un ralentissement du PC)", 'st.sound.lost': "Le son de l'aperçu s'est coupé (PC ralenti) : remise en route…", 'st.sound.back': "Son de l'aperçu rétabli", 'st.sound.restored': "Son remis en route",
      'st.rail.mic': "Dicter une note ({key} maintenu, ou un clic)", 'st.dic.listen': "Je t’écoute…", 'st.dic.wait': "Micro…", 'st.dic.work': "Transcription…", 'st.dic.at': "note à {t}", 'st.dic.into': "dans le champ", 'st.dic.keyHeld': "relâche {key} pour finir · Échap : annuler", 'st.dic.keyTap': "{key} pour finir · Échap : annuler", 'st.dic.click': "clique le micro pour finir · Échap : annuler", 'st.dic.denied': "Micro refusé : autorise-le pour Coulisses (l’icône du site, en haut de la fenêtre), puis réessaie", 'st.dic.noMic': "Aucun micro trouvé", 'st.dic.cancelled': "Dictée annulée", 'st.dic.nothing': "Dictée : rien entendu", 'st.dic.failed': "Dictée : {why}", 'st.dic.lost': "Le champ a disparu : le texte dicté est copié (Ctrl+V)", 'st.dic.done': "Dictée : {n} mot{n||s}", 'st.follow.moved': "{n} note{n||s} suivent la vidéo modifiée : recalée{n||s} sur le même moment, pas la même image",
      'st.sound.reload': "Le son de l'aperçu ne revenait pas : l'aperçu est relancé (comme F5, tes notes restent)…", 'st.sound.reloading': "Aperçu relancé pour retrouver le son…", 'st.sound.preparing': "Aperçu relancé pour retrouver le son…", 'st.sound.reloaded': "Son rétabli : aperçu relancé", 'st.sound.gone': "Toujours pas de son : vérifie la sortie son de Windows, puis clique le haut-parleur sous l'image", 
      'st.rs.ready': "Son de relecture prêt : il ne se coupe plus, l'image le suit", 'st.rs.reloaded': "Son de relecture rechargé", 
      'st.code.preparingOld': "Correction en préparation (la version d'avant reste affichée)…", 
      'st.q.no1080': "Le script d'export de ce projet ne fait pas de 1080p", 'st.ex.confirmGpu': "\n\nEncodage : GPU ({name}).", 'st.ex.confirmCpu': "\n\nEncodage : processeur — la case « Encoder avec le GPU » est décochée (plus lent).", 
      'st.q.title': "Qualité", 'st.q.no4k': "Le script d'export de ce projet ne fait pas la 4K", 'st.rc.liveCode': "Pas encore de vidéo : tu relis le code en direct ({comp}, {w}×{h} à {fps} i/s).", 'st.rc.goQ': "Lancer le rendu en {q}", 'st.launch.q': "Qualité : {q}.", 'st.top.goQTitle': "Lancer le rendu en {q} avec le script d'export du projet (suivi dans « Envois »)",
      'st.steps.prep': "Préparation", 'st.steps.prepWhat': "le projet empaqueté, les scènes 3D refaites en 4K s’il le faut", 'st.steps.finishX': "assemblage des morceaux, son, volume, copies", 'st.steps.reviewX': "Relecture", 'st.steps.reviewXWhat': "Coulisses charge la nouvelle vidéo : tu la relis, et tu compares les notes corrigées", 'st.steps.goesOn': "Tu peux fermer Coulisses : le rendu continue." },
    en: { 'st.reply.unseen': 'Not seen by the agent', 'st.reply.seen': 'Seen by the agent', 'st.reply.seenTitle': 'The agent confirmed receiving this reply on {at}. This does not mean the fix is done.',
      'st.reply.unseenTitle': 'This reply is waiting to be delivered to a connected agent.', 'st.reply.saved': 'Reply saved', 'st.reply.waiting': 'Reply saved, waiting to be delivered to the agent.', 'st.reply.delivered': 'Reply delivered to the agent.',
      'st.reply.offline': 'No agent is watching Coulisses: your reply will wait until it reconnects.', 'st.reply.unknown': 'Agent monitoring could not be checked: your reply is saved and will wait for reconnection if needed.',
      'st.reply.connect': 'Copy this line into the agent’s session to reconnect it. Unseen replies will be delivered first.', 'st.reply.failed': 'Your reply has not been saved yet. Coulisses is retrying; keep this page open.',
      'st.card.verify': 'Validate', 'st.card.verifiedBtn': 'Validated', 'st.card.verified': 'validated', 'st.card.verifyTitle': 'You checked the fix: the note turns green. Click again to go back to "fixed".',
      'st.list.verified': ' · {n} validated', 'st.list.allHidden': 'Nothing to show: the notes here are all validated (untick "hide the validated ones").', 'st.notes.hideOk': 'hide the validated ones',
      'st.notes.lotAll': 'All notes ({n})', 'st.notes.lotOne': 'Batch {lot} · {n} note{n||s}', 'st.notes.lotNone': 'No batch · {n} note{n||s}', 'st.notes.lotTitle': 'All the notes, or one batch’s only: in this list, on the timeline and on the picture',
      'st.notes.okAll': 'Validate all ({n})', 'st.notes.okAllTitle': 'The fixed notes of this batch turn green (Ctrl+Z to undo)', 'st.notes.okAllDone': '{n} note{n||s} validated · Ctrl+Z to undo', 'st.insp.stVerified': 'validated',
      'st.sound.btn': "Restore the sound (if it went after the PC slowed down)", 'st.sound.lost': "The preview’s sound cut out (the PC slowed down): starting it again…", 'st.sound.back': "The preview’s sound is back", 'st.sound.restored': "Sound restarted",
      'st.rail.mic': "Dictate a note ({key} held, or a click)", 'st.dic.listen': "Listening…", 'st.dic.wait': "Microphone…", 'st.dic.work': "Transcribing…", 'st.dic.at': "note at {t}", 'st.dic.into': "into the field", 'st.dic.keyHeld': "release {key} to finish · Esc: cancel", 'st.dic.keyTap': "{key} to finish · Esc: cancel", 'st.dic.click': "click the microphone to finish · Esc: cancel", 'st.dic.denied': "Microphone refused: allow it for Coulisses (the site icon at the top of the window), then try again", 'st.dic.noMic': "No microphone found", 'st.dic.cancelled': "Dictation cancelled", 'st.dic.nothing': "Dictation: nothing heard", 'st.dic.failed': "Dictation: {why}", 'st.dic.lost': "The field went away: the dictated text is copied (Ctrl+V)", 'st.dic.done': "Dictation: {n} word{n||s}", 'st.follow.moved': "{n} note{n||s} followed the changed video: on the same moment, not the same frame",
      'st.sound.reload': "The preview's sound did not come back: the preview is started again (like F5, your notes stay)…", 'st.sound.reloading': "Preview started again to get its sound back…", 'st.sound.preparing': "Preview started again to get its sound back…", 'st.sound.reloaded': "Sound back: preview started again", 'st.sound.gone': "Still no sound: check Windows' sound output, then click the speaker under the picture", 
      'st.rs.ready': "Review sound ready: it no longer cuts out, the picture follows it", 'st.rs.reloaded': "Review sound loaded again", 
      'st.code.preparingOld': "Correction being prepared (the version before stays on screen)…", 
      'st.q.no1080': "This project's export script does not make 1080p", 'st.ex.confirmGpu': "\n\nEncoding: GPU ({name}).", 'st.ex.confirmCpu': "\n\nEncoding: processor — the box 'Encode with the GPU' is unticked (slower).", 
      'st.q.title': "Quality", 'st.q.no4k': "This project's export script does not make 4K", 'st.rc.liveCode': "No video yet: you review the live code ({comp}, {w}×{h} at {fps} fps).", 'st.rc.goQ': "Start the render in {q}", 'st.launch.q': "Quality: {q}.", 'st.top.goQTitle': "Start the render in {q} with the project's export script (followed in \"Batches\")",
      'st.steps.prep': "Preparing", 'st.steps.prepWhat': "the project bundled, the 3D scenes made again in 4K if needed", 'st.steps.finishX': "joining the parts, sound, loudness, copies", 'st.steps.reviewX': "Review", 'st.steps.reviewXWhat': "Coulisses loads the new video: you review it, and compare the fixed notes", 'st.steps.goesOn': "You can close Coulisses: the render goes on." },
  };
  const TN = (k, v) => {
    const s = T(k, v); if (s !== k) return s;
    const f = NEWT[FR ? 'fr' : 'en'][k]; if (f === undefined) return k;
    return f.replace(/\{(\w+)(?:\|([^{}|]*)\|([^{}]*))?\}/g, (m, x, one, other) => one === undefined ? String(v?.[x] ?? '') : ((FR ? Math.abs(v?.[x]) > 1 : Math.abs(v?.[x]) !== 1) ? other : one));
  };
  const userReplyParts = (m) => [m.at ?? '', m.text ?? '', (m.images ?? []).map((im) => im?.file ?? im)];
  function threadOf(n) {
    const counts = new Map();
    const msgs = (n.thread || []).map((m) => {
      if (m.kind === 'system') return { ...m, from: 'user', delivery: null };
      const parts = userReplyParts(m), signature = JSON.stringify(parts);
      const occurrence = counts.get(signature) ?? 0;
      const identified = typeof m.id === 'string' && m.id;
      if (!identified && (String(m.text ?? '').trim() || m.images?.length)) counts.set(signature, occurrence + 1);
      const key = identified ? m.id : `legacy:${JSON.stringify([...parts, occurrence])}`;
      const receipt = REPLIES.userReplies?.[n.id]?.[key];
      const delivery = receipt?.message && JSON.stringify(userReplyParts(receipt.message)) === signature ? receipt : null;
      return { ...m, from: 'user', delivery };
    });
    for (const m of reply(n)?.messages || []) msgs.push({ ...m, from: 'claude' });
    if (n.reply) msgs.push({ from: 'claude', text: n.reply, images: [], at: n.updated });
    return msgs.sort((a, b) => (Date.parse(a.at || 0) || 0) - (Date.parse(b.at || 0) || 0));
  }
  function replyDeliveryHtml(m) {
    if (m.from !== 'user' || m.kind === 'system') return '';
    const seen = !!m.delivery?.seenAt;
    return `<span class="reply-delivery ${seen ? 'seen' : 'unseen'}" title="${esc(TN(seen ? 'st.reply.seenTitle' : 'st.reply.unseenTitle', { at: m.delivery?.seenAt ?? '' }))}">${esc(TN(seen ? 'st.reply.seen' : 'st.reply.unseen'))}</span>`;
  }
  const replySending = new Set();
  async function sendNoteReply(n) {
    const p = pending[n.id];
    if (replySending.has(n.id) || !p || (!p.text.trim() && !p.images.length)) return;
    replySending.add(n.id);
    const message = { id: uid(), text: p.text.trim(), images: p.images, at: now() };
    (n.thread ??= []).push(message);
    delete pending[n.id]; n.updated = now();
    if (fixedOf(n)) { n.status = 'open'; n.statusAt = now(); }
    save(); renderAll();
    try {
      if (!(await flushNow())) { setSave(TN('st.reply.failed'), 'err'); return; }
      let watching = null;
      try {
        const r = await fetch('/api/status', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (r.ok) { const fresh = await r.json(); watching = fresh.agent?.watching === true; STATUS.agent = fresh.agent; }
      } catch { /* A saved reply remains pending even when the status request fails. */ }
      if (watching !== true) {
        // L'agent peut avoir accusé réception puis quitté son attente avant ce
        // contrôle : son accusé explicite décide, pas le dernier battement.
        try {
          const r = await fetch('/api/replies', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
          if (r.ok) {
            const fresh = await r.json();
            if (fresh?.notes && typeof fresh.notes === 'object' && !Array.isArray(fresh.notes)) REPLIES = fresh;
          }
        } catch { /* Preserve the last known receipts if this read fails. */ }
        const receipt = REPLIES.userReplies?.[n.id]?.[message.id];
        const delivered = receipt?.seenAt && receipt.message && JSON.stringify(userReplyParts(receipt.message)) === JSON.stringify(userReplyParts(message));
        if (delivered) setSave(TN('st.reply.delivered'), 'ok');
        else showModal(TN('st.reply.saved'), TN(watching === false ? 'st.reply.offline' : 'st.reply.unknown'), META.connectLine, TN('st.reply.connect'));
      } else setSave(TN('st.reply.waiting'), 'ok');
    } catch { setSave(TN('st.reply.failed'), 'err'); }
    finally { replySending.delete(n.id); renderAll(); }
  }
  function stamp(n) { n.updated = now(); n.context = contextAt(n.frame, n.end ?? n.frame); }
  function queueFull() {
    if (!MAXQ || drafts().length < MAXQ) return false;
    setSave(T('st.queue.full', { max: MAXQ }), 'err');
    setTab('queue'); $('#qcnt').animate([{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], 400);
    return true;
  }
  function addNote(frame, end = null, focus = true, extra = {}) {
    if (queueFull()) return null;
    if (end !== null && end < frame) [frame, end] = [end, frame];
    if (end !== null && end === frame) end = null;
    const n = { id: uid(), frame, end, text: '', images: [], thread: [], status: 'open', created: now(), render: META.render, draft: true, source: mode, ...extra };
    stamp(n); anchorNote(n); notes.push(n); sel = n.id; save(); setTab('queue'); renderAll();
    if (focus) requestAnimationFrame(() => { const ta = document.querySelector(`.card[data-id="${n.id}"] textarea.main`); if (ta) { ta.focus(); ta.scrollIntoView({ block: 'nearest' }); } });
    return n;
  }
  function delNote(id) { notes = notes.filter((n) => n.id !== id); if (sel === id) sel = null; if (loopId === id) loopId = null; delete pending[id]; save(); renderAll(); }
  function setFrames(n, frame, end) {
    frame = Math.max(0, Math.min(FRAMES - 1, Math.round(frame)));
    if (end !== null && end !== undefined) { end = Math.max(0, Math.min(FRAMES - 1, Math.round(end))); if (end < frame) [frame, end] = [end, frame]; if (end === frame) end = null; }
    n.frame = frame; n.end = end ?? null; stamp(n); anchorNote(n);   // (moved by the user: where it is now is where it belongs)
  }
  function showCard(id) {
    const n = byId(id); if (!n) return;
    if (n.draft) setTab('queue'); else if (!onTab('insp')) setTab('notes');   // the queue on the left, the notes on the right (unless the inspector is shown)
    requestAnimationFrame(() => document.querySelector(`.card[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  // ---------- images ----------
  const imagesOf = (e) => {
    const dt = e.clipboardData || e.dataTransfer; if (!dt) return [];
    const fromFiles = [...(dt.files || [])].filter((f) => f.type.startsWith('image/'));
    if (fromFiles.length) return fromFiles;
    return [...(dt.items || [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
  };
  async function upload(file, noteId) {
    const r = await fetch('/api/image', { method: 'POST', headers: { 'Content-Type': file.type || 'image/png', 'X-Note': noteId }, body: file });
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()).file;
  }
  async function attach(files, target) {
    files = [...files].filter((f) => f && f.type.startsWith('image/'));
    if (!files.length) return;
    let n = target.kind === 'new' ? null : byId(target.id);
    if (!n) { M.pause(); n = addNote(curFrame(), null, false); if (!n) return; target = { kind: 'note', id: n.id }; }
    setSave(files.length > 1 ? T('st.img.uploadMany', { n: files.length }) : T('st.img.uploadOne'));
    try {
      for (const f of files) {
        const file = await upload(f, n.id);
        if (target.kind === 'reply') (pending[n.id] ??= { text: '', images: [] }).images.push({ file, at: now() });
        else (n.images ??= []).push({ file, at: now() });
      }
      sel = n.id;
      if (target.kind !== 'reply') { n.updated = now(); save(); } else setSave(T('st.img.ready'), 'ok');
      renderAll();
    } catch (e) { setSave(T('st.img.failed'), 'err'); }
  }
  const thumbHtml = (img, removable) => `<span class="thumb"><img src="/${esc(img.file)}" data-full="/${esc(img.file)}" alt="">${removable ? `<button class="x" title="${esc(T('st.img.remove'))}">${ic('x')}</button>` : ''}</span>`;
  function openLightbox(src) { const lb = $('#lb'); lb.querySelector('img').src = src; lb.style.display = 'flex'; }
  $('#lb').addEventListener('click', () => { $('#lb').style.display = 'none'; });
  let pickTarget = null;
  $('#filePick').addEventListener('change', (e) => { const t = pickTarget; pickTarget = null; if (t) attach(e.target.files, t); e.target.value = ''; });
  const pick = (target) => { pickTarget = target; $('#filePick').click(); };
  document.addEventListener('paste', (e) => {
    const files = imagesOf(e); if (!files.length) return;
    e.preventDefault();
    const a = document.activeElement, card = a && a.closest ? a.closest('.card') : null;
    if (card) attach(files, { kind: a.classList.contains('rep') ? 'reply' : 'note', id: card.dataset.id });
    else if (sel) attach(files, { kind: 'note', id: sel });
    else attach(files, { kind: 'new' });
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  const dropZone = (el, target) => {
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('drop'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.remove('drop'); attach(imagesOf(e), target()); });
  };
  dropZone($('#viewer'), () => ({ kind: 'new' }));

  // ---------- an image of the library (« Médias » tab, medias.js) placed on the picture ----------
  // A pinned edit for the agent, at the frame shown, with the image attached (a copy in revue/images) and what the
  // library knows of it (note.media): the agent copies it into the project and writes it in the code (lib/lots.mjs).
  // Nothing changes in the project here (user's choice, 08/10/2026: « L'agent » writes the placement).
  async function placeMedia(id, pt, frame = curFrame()) {
    if (queueFull()) return null;
    M.pause();
    const r = await postJson('/api/medias/place', { id, frame });
    if (!r?.ok) { setSave(T('st.md.placeFailed', { why: r?.why ?? '' }), 'err'); return null; }
    return placeNote(r, pt, frame);
  }
  // « Médias » dropped on a live preview (user request, 08/10/2026: « quand je place l'image créée dans le décor, elle se
  // met automatiquement en carton 3D comme Brambleshire »): in a 3D scene the image becomes a cardboard cutout right where
  // it falls (player/stage.ts), in a 2D picture the image itself (player/stage2d.ts); the staging opens on it to place it,
  // and « Ajouter à la file » asks the agent to add it to the project there. Without a live preview of the code (a video
  // only), or if the preview cannot take it: the pinned note, as before. Ctrl+Z takes the drop back.
  const cutMedia = new Map();   // a cutout's id → the media of the library (and its copy in revue/images)
  async function dropMedia(id, pt, frame = curFrame()) {
    if (!META.features?.code || stageWhy()) return placeMedia(id, pt, frame);
    if (queueFull()) return null;
    M.pause();
    const r = await postJson('/api/medias/place', { id, frame });
    if (!r?.ok) { setSave(T('st.md.placeFailed', { why: r?.why ?? '' }), 'err'); return null; }
    if (!staging) await setStaging(true);
    if (!staging || !SP?.stage?.addCutout) return placeNote(r, pt, frame);
    setSave(T('st.md.cutMaking', { name: r.media.nom }));
    const c = await SP.stage.addCutout({ url: '/medias/file/' + encodeURIComponent(id), name: r.media.nom, category: r.media.categorie, at: pt ?? null });
    if (!c?.cutout) return placeNote(r, pt, frame);
    cutMedia.set(c.id, r.media);
    HIST.back.push({ type: 'cutout', id: c.id, spec: cutSpec(c), media: r.media, label: T('st.undo.cutout', { name: r.media.nom }) }); HIST.fwd = [];
    SP.stage.select(c.id);
    setSave(T(D2() ? 'st.md.cut2dPlaced' : 'st.md.cutPlaced', { name: r.media.nom }), 'ok');
    return c;
  }
  // what lays a cutout again at its place (a page reloaded, Ctrl+Y): its image, its name, its place before any offset
  const cutSpec = (i) => ({ id: i.id, url: i.cutout.url, name: i.cutout.name, category: i.cutout.category, ...(i.cutout.box ? { box: i.cutout.box } : { base: i.cutout.base }) });
  function placeNote(r, pt, frame) {
    const at = pt ?? [Math.floor(CW / 2), Math.floor(CH / 2)];
    const n = addNote(frame, null, false, { text: T(pt ? 'st.md.placeText' : 'st.md.placeTextCenter', { name: r.media.nom }), mark: { kind: 'pin', points: [at] },
      images: [{ file: r.file, at: now(), label: r.media.nom }], media: r.media });
    if (n) { setSave(T('st.md.placed', { name: r.media.nom }), 'ok'); showCard(n.id); }
    return n;
  }
  $('#viewer').addEventListener('drop', (e) => {
    const id = e.dataTransfer?.getData('application/x-coulisses-media');
    window.Studio.mediaDragging(false);
    if (id) dropMedia(id, toComp(e), curFrame());
  });
  window.Studio = {
    esc: (x) => esc(x), ic: (n, c) => ic(n, c), setSave: (a, b) => setSave(a, b), placeMedia: (id, pt) => dropMedia(id, pt), dropMedia: (id, pt) => dropMedia(id, pt),
    setTabCount: (t, txt) => { const e = $('#n' + t.charAt(0).toUpperCase() + t.slice(1)); if (e) e.textContent = txt; },
    mediaDragging: (on) => {
      const vw = $('#viewer'); vw.classList.toggle('mdrag', !!on); document.querySelector('#mdDropHint')?.remove();
      if (!on) return;
      const r = vw.getBoundingClientRect(), h = document.createElement('div');
      h.id = 'mdDropHint'; h.textContent = T('st.md.dropHint'); h.style.left = (r.left + r.width / 2) + 'px'; h.style.top = (r.top + 18) + 'px';
      document.body.appendChild(h);
    },
  };

  // ---------- saving ----------
  let saveT = null, saving = false, dirty = false;
  const setSave = (txt, cls) => { const s = $('#save'); s.textContent = txt; s.className = cls || ''; };
  // the notes file as the server last gave or took it (studio-server.mjs readNotes): its revision goes with each save, a
  // save on an older one (another tab saved since) comes back 409 with the notes as they are now — merged (mergeNotes),
  // saved again. NOTES_OK: the notes were read at the start; until then nothing is saved (code review 18/10/2026: a failed
  // read showed 0 notes and the first save wrote them over)
  let NOTES_OK = false, NOTES_REV, NOTES_KNOWN = new Set();
  const notesLoaded = (data) => { NOTES_OK = true; NOTES_REV = data?.rev; NOTES_KNOWN = new Set(notes.map((n) => n.id)); NOTES_LAST_SAVE = Date.now(); };
  const payload = () => JSON.stringify({ episode: META.episode, title: META.title, fps: FPS, render: META.render, updated: now(), notes: sorted(), ...(NOTES_REV !== undefined ? { rev: NOTES_REV } : {}) });
  // two copies of the notes, this page's and the file's: a note only one of them has is new there (kept) unless it was
  // known at the last save (it was deleted on the other side, and not changed since here: dropped); one both have: the
  // newer change wins
  function mergeNotes(mine, theirs) {
    const t = (n) => Date.parse(n?.updated ?? n?.created ?? 0) || 0, saved = NOTES_LAST_SAVE;
    const A = new Map(mine.map((n) => [n.id, n])), B = new Map(theirs.map((n) => [n.id, n])), out = [];
    for (const [id, a] of A) {
      const b = B.get(id);
      if (b) {
        const newest = t(b) > t(a) ? b : a, messages = new Map();
        // A conflict between tabs may choose newer note fields, but never discard a reply from the other tab.
        for (const side of newest === a ? [a, b] : [b, a]) {
          const counts = new Map();
          for (const m of side.thread ?? []) {
            const signature = JSON.stringify(userReplyParts(m)), kind = m.kind === 'system' ? 'system' : 'legacy';
            const occurrenceKey = `${kind}:${signature}`, occurrence = counts.get(occurrenceKey) ?? 0, identified = typeof m.id === 'string' && m.id;
            if (!identified) counts.set(occurrenceKey, occurrence + 1);
            const key = identified ? `id:${m.id}` : `${occurrenceKey}:${occurrence}`;
            if (!messages.has(key)) messages.set(key, m);
          }
        }
        out.push({ ...newest, thread: [...messages.values()].sort((x, y) => (Date.parse(x.at) || 0) - (Date.parse(y.at) || 0)) });
      } else if (!NOTES_KNOWN.has(id) || t(a) > saved) out.push(a);
    }
    for (const [id, b] of B) if (!A.has(id) && (!NOTES_KNOWN.has(id) || t(b) > saved)) out.push(b);
    return out.map((n) => ({ status: 'open', end: null, images: [], thread: [], ...n }));
  }
  let NOTES_LAST_SAVE = Date.now();
  // Ctrl+Z / Ctrl+Y (user request, 08/10/2026: « les raccourcis habituels »): the user's own actions in the page — a note
  // added, deleted, moved or written, a mark, an edit in the queue, a staging offset — 60 steps back, kept in memory. The
  // words typed in a field keep the browser's own undo while it has the focus, and typing in a note makes one step per
  // burst. Sending the queue starts a new history (a batch sent is not taken back here: « Annuler la correction du lot »).
  // The agent's fixes have their own undo (Édition › Annuler la correction du lot N).
  const HIST = { back: [], fwd: [], last: null, lastAt: 0, max: 60 };
  const noText = (j) => { try { return JSON.stringify(JSON.parse(j).map(({ text, updated, context, ...r }) => r)); } catch { return j; } };
  function stepLabel(before, after) {
    let a = [], b = []; try { a = JSON.parse(before); b = JSON.parse(after); } catch { /* */ }
    if (b.length > a.length) return T('st.undo.add');
    if (b.length < a.length) return T('st.undo.del');
    return T('st.undo.edit');
  }
  function remember() {   // called by save(): the state before this change becomes one step back
    const cur = JSON.stringify(notes);
    if (HIST.last === null) { HIST.last = cur; return; }
    if (cur === HIST.last) return;
    const now = Date.now(), top = HIST.back.at(-1);
    // one step per burst: still typing in a note (1.5 s), or dragging a note along the timeline (0.4 s)
    const ids = (j) => { try { return JSON.parse(j).map((n) => n.id).join(); } catch { return j; } };
    const typingOn = noText(cur) === noText(HIST.last);
    const burst = top?.type === 'notes' && ids(cur) === ids(HIST.last) && now - HIST.lastAt < (typingOn && top.text ? 1500 : 400);
    if (!burst) { HIST.back.push({ type: 'notes', state: HIST.last, label: stepLabel(HIST.last, cur), text: noText(cur) === noText(HIST.last) }); if (HIST.back.length > HIST.max) HIST.back.shift(); }
    HIST.fwd = []; HIST.last = cur; HIST.lastAt = now;
  }
  function persist() { dirty = true; setSave(T('st.save.saving')); clearTimeout(saveT); saveT = setTimeout(flush, 400); }
  function save() { remember(); persist(); }
  let stQuiet = false; const stPrev = new Map(), stAt = new Map();
  function rememberStage(ev) {   // a staging offset: one step per gesture (a drag, a burst of arrows or of the wheel)
    if (stQuiet) return;
    const now = Date.now(), prev = stPrev.get(ev.id) ?? { delta: { p: [0, 0, 0], r: [0, 0, 0], s: 1 }, from: ev.from, to: ev.to };
    if (now - (stAt.get(ev.id) ?? 0) > 700) { HIST.back.push({ type: 'stage', id: ev.id, ...prev, label: T('st.undo.stage', { name: stageName(ev.id, ev).name }) }); if (HIST.back.length > HIST.max) HIST.back.shift(); HIST.fwd = []; }
    stAt.set(ev.id, now); stPrev.set(ev.id, { delta: JSON.parse(JSON.stringify(ev.delta)), from: ev.from, to: ev.to });
  }
  function undoStep(dir) {   // 'undo' | 'redo'
    const from = dir === 'undo' ? HIST.back : HIST.fwd, to = dir === 'undo' ? HIST.fwd : HIST.back;
    let step = from.pop();
    while (step && step.type === 'notes' && step.state === HIST.last) step = from.pop();   // a step that changes nothing
    if (!step) { setSave(T(dir === 'undo' ? 'st.undo.none' : 'st.redo.none'), ''); return; }
    if (step.type === 'cutout') {   // the drop of an image: undo takes it away, redo lays it again at its place
      if (!SP?.stage) { setSave(T(dir === 'undo' ? 'st.undo.none' : 'st.redo.none'), ''); return; }
      if (dir === 'undo') { if (SP.stage.has(step.id)) SP.stage.reset(step.id); if (stSel?.id === step.id) stSel = null; renderScene(); }
      else if (!SP.stage.has(step.id)) SP.stage.addCutout(step.spec).then((c) => { if (c) { cutMedia.set(step.id, step.media); if (staging) SP.stage.select(step.id); } renderScene(); });
      to.push(step);
    } else if (step.type === 'stage') {
      if (!SP?.stage) { setSave(T(dir === 'undo' ? 'st.undo.none' : 'st.redo.none'), ''); return; }
      const cur = SP.stage.info(step.id);
      to.push({ type: 'stage', id: step.id, delta: cur.delta, from: cur.from, to: cur.to, label: step.label });
      stQuiet = true; SP.stage.setDelta(step.id, step.delta, step.from, step.to, { quiet: true }); stQuiet = false;   // (its « change », from the preview's process, says quiet)
      stPrev.set(step.id, { delta: step.delta, from: step.from, to: step.to }); stAt.set(step.id, 0);
      if (stSel?.id === step.id) stSel = plain({ ...stSel, ...SP.stage.info(step.id) });
      renderScene.force = true; renderScene(); renderScene.force = false;
    } else {
      to.push({ type: 'notes', state: HIST.last, label: step.label });
      const had = new Set(notes.map((n) => n.id));
      notes = JSON.parse(step.state); HIST.last = step.state; HIST.lastAt = 0;
      const back = notes.find((n) => !had.has(n.id));   // a note that comes back is the one selected
      if (back) sel = back.id; else if (sel && !byId(sel)) sel = null;
      if (loopId && !byId(loopId)) loopId = null;
      persist(); renderAll(); syncStage();
    }
    setSave(T(dir === 'undo' ? 'st.undo.done' : 'st.redo.done', { what: step.label, key: window.Shortcuts?.show(dir === 'undo' ? 'redo' : 'undo') ?? '' }), 'ok');
  }
  window.__undo = { state: () => ({ back: HIST.back.length, fwd: HIST.fwd.length, top: HIST.back.at(-1)?.label ?? null }) };   // for tests
  async function flush() {
    if (saving) { saveT = setTimeout(flush, 300); return; }
    if (!NOTES_OK) { setSave(T('st.save.notLoaded') === 'st.save.notLoaded' ? (FR ? 'Notes non lues : rien n’est enregistré (Fichier › Actualiser)' : 'Notes not read: nothing is saved (File › Reload)') : T('st.save.notLoaded'), 'err'); return; }
    saving = true; dirty = false;
    try {
      for (let tries = 0; ; tries++) {
        const r = await fetch('/api/notes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: payload() });
        if (r.status === 409 && tries < 3) {   // another tab saved since: its notes and these, merged, then saved again
          const cur = (await r.json()).current;
          notes = mergeNotes(notes, cur?.notes ?? []); NOTES_REV = cur?.rev; HIST.last = JSON.stringify(notes); renderAll();
          continue;
        }
        if (!r.ok) throw new Error(await r.text());
        const res = await r.json().catch(() => ({}));
        if (res.rev !== undefined) NOTES_REV = res.rev;
        NOTES_KNOWN = new Set(notes.map((n) => n.id)); NOTES_LAST_SAVE = Date.now();
        break;
      }
      setSave(T('st.save.saved', { t: hm5(new Date()) }), 'ok');
    } catch (e) { dirty = true; setSave(T('st.save.failed'), 'err'); clearTimeout(saveT); saveT = setTimeout(flush, 3000); }   // (tried again, not only at the next change)
    saving = false;
  }
  // what is typed but lives only in this page (an answer being written under a note, the request to the agent, the words
  // under the queue): kept for this tab when the page goes (a reload by the agent — new video, first export —, Fichier ›
  // Actualiser, F5), given back at the start (code review 18/10/2026: lost at each automatic reload)
  const draftKey = () => `coulisses-drafts:${META?.notesFile ?? location.port}`;
  function keepDrafts() {
    try {
      const d = { pending: {}, agent: $('#agentText')?.value ?? '', words: $('#qwords')?.value ?? '' };
      for (const [id, p] of Object.entries(pending)) if (p?.text?.trim() || p?.images?.length) d.pending[id] = p;
      if (Object.keys(d.pending).length || d.agent.trim() || d.words.trim()) sessionStorage.setItem(draftKey(), JSON.stringify(d)); else sessionStorage.removeItem(draftKey());
    } catch { /* private window: as before */ }
  }
  function restoreDrafts() {
    try {
      const d = JSON.parse(sessionStorage.getItem(draftKey()) ?? 'null'); sessionStorage.removeItem(draftKey());
      if (!d) return;
      for (const [id, p] of Object.entries(d.pending ?? {})) if (byId(id) && !pending[id]) pending[id] = p;
      if (d.agent && !$('#agentText').value) $('#agentText').value = d.agent;
      if (d.words && !$('#qwords').value) $('#qwords').value = d.words;
    } catch { /* */ }
  }
  window.addEventListener('pagehide', keepDrafts);
  // a reload asked by the page itself (a new video, the first export, the language, Fichier › Actualiser): only once the
  // notes are saved — never over changes the server did not take (they would be lost); false: not reloaded, said
  async function reloadSafely(f = curFrame()) {
    if (NOTES_OK && !(await flushNow())) { setSave(T('st.save.failed'), 'err'); return false; }   // (notes never read: nothing of them to lose — Actualiser is the way out)
    keepDrafts(); location.hash = `f=${f}`; location.reload(); return true;
  }
  async function flushNow() { clearTimeout(saveT); while (saving) await new Promise((r) => setTimeout(r, 50)); if (dirty) await flush(); return !dirty && NOTES_OK; }
  // leaving with changes not saved yet: sent on the way out when small enough (the browser refuses a keepalive body over
  // 64 KB — a page with drawn or graded notes is larger), else the browser asks to stay while the save runs
  window.addEventListener('beforeunload', (e) => {
    if (!dirty || !NOTES_OK) return;
    const body = payload();
    if (body.length < 60000) { fetch('/api/notes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }); return; }
    flush(); e.preventDefault(); e.returnValue = '';
  });
  let AGENT_PICK = store.get('agent', 'claude');   // chosen in « Connecter à l'agent »; the agent watching the tool wins
  const AGENT_LABELS = { claude: 'Claude Code', codex: 'Codex' };
  const agentName = () => (STATUS.agent?.watching && STATUS.agent?.agent?.name) || AGENT_LABELS[AGENT_PICK] || T('st.agent.yours');
  let repliesTxt = '', statusTxt = '', statusKey = '', offline = false;
  async function pollReplies() {
    try {
      const response = await fetch('/api/replies', { cache: 'no-store' });
      if (!response.ok) throw new Error('Lecture des réponses indisponible.');
      const statusResponse = await fetch('/api/status', { cache: 'no-store' });
      if (!statusResponse.ok) throw new Error('Lecture du statut indisponible.');
      const t = await response.text(), s = await statusResponse.text();
      let changed = false;
      if (t !== repliesTxt) { repliesTxt = t; REPLIES = JSON.parse(t); if (!REPLIES.notes) REPLIES.notes = {}; applyRemaps(); changed = true; }
      // (the agent's heartbeat changes every 5 s while it watches: taken, but the cards are not built again for it —
      // code review 18/10/2026: a field being typed in lost its input, its selection, its own undo every 5 s)
      if (s !== statusTxt) { const key = s.replace(/"beat":"[^"]*"/, ''); if (key !== statusKey) { statusKey = key; changed = true; } statusTxt = s; STATUS = JSON.parse(s); onStatus(); }
      if (changed) renderAll();
    } catch (e) {
      if (!offline) { offline = true; setSave(T('st.save.paused'), 'err'); }
      setTimeout(pollReplies, 3000); return;
    }
    if (offline) {
      offline = false;
      try {
        const m = await (await fetch('/api/meta', { cache: 'no-store' })).json();
        if (m.render && META.render && (m.render.size !== META.render.size || m.render.mtime !== META.render.mtime)) { setSave(T('st.save.newVideo'), 'ok'); if (await reloadSafely()) return; }
        setSave(T('st.save.back'), 'ok');
      } catch { /* next round */ }
    }
    setTimeout(pollReplies, 3000);
  }
  function applyRemaps() {
    if (!META?.render) return;
    let changed = false;
    for (const n of notes) {
      const m = REPLIES.notes?.[n.id]?.remap;
      // (the agent's recalage after a full render — remap-notes.mjs, from the plans of both renders — comes first, as
      // before; the note then belongs there: its new place, on the plan of this video)
      if (!m || !m.render || m.render.size !== META.render.size || (n.render && n.render.size === META.render.size)) continue;
      (n.before ??= []).push({ frame: n.frame, end: n.end, render: n.render });
      n.frame = m.frame; n.end = m.end ?? null; n.render = META.render; stamp(n); changed = true;
      const vp = STATUS.plans?.video ?? META.plans?.video ?? null;
      if (vp) { n.plan = vp; n.at = { frame: n.frame, end: n.end, plan: vp }; } else { delete n.at; delete n.plan; }
    }
    if (changed) { persist(); HIST.last = JSON.stringify(notes); setSave(T('st.save.remapped'), 'ok'); }   // (not a step of the user's undo: Ctrl+Z would put the notes back on the old frames)
  }
  function onStatus() {
    rsStatus();   // (the review sound: 01-preview.js)
    followPlans();   // (a new version of the code or of the video: the notes on their moments)
    const a = STATUS.agent ?? {}, b = $('#agent');
    b.classList.toggle('on', !!a.watching);
    b.querySelector('.t').textContent = a.watching ? T('st.agent.on', { name: a.agent?.name ? ' · ' + a.agent.name : '' }) : T('st.agent.connect');
    b.title = a.watching ? T('st.agent.watchTitle', { name: a.agent?.name ?? T('st.agent.Yours'), since: hhmm(a.since) }) : T('st.agent.clickTitle');
    const ver = STATUS.code?.version ?? 0;
    if (modeWant === 'code' && mode !== 'code' && STATUS.code?.status === 'ready' && codeFailedVer !== ver && codeLoad?.ver !== ver) setMode('code');
    if (mode === 'code' && STATUS.code?.status === 'ready' && codeFailedVer !== ver) {
      if (SP && ver !== codeVer) {
        if (SP.isPlaying()) showCodeNote(`Version ${ver} disponible à la prochaine pause`);
        else if (codeLoad?.ver !== ver) loadCode();
      } else if (!SP && codeLoad?.ver !== ver) loadCode();
    }
    if ((STATUS.timeline?.version ?? 0) !== liveVer) loadLive();
    showCodeStatus();
    renderPill(); onHeld(); markGo();
  }
  // ---------- notes that follow the video (lib/plans.mjs; user request, 19/10/2026: « quand l'agent rallonge la vidéo, la
  // note doit rester collée à la même partie de la vidéo, pas à la même frame ») ----------
  // A note keeps where the user put it — n.at: its frames and the plan of the version shown then — and n.plan, the plan its
  // frames are on now. When the version shown changes (the agent changed the code: a new plan; a new video; « Code actuel »
  // ↔ « MP4 rendu » when the code changed since the video), its notes are placed on it from where the user put them
  // (never from a place already moved: nothing drifts), by the moments both versions share (POST /api/remap): the same
  // spoken line, the same shot, the same second of a source. Not a step of Ctrl+Z. A version whose plan is not known (a
  // video made outside Coulisses, without a plan): its notes stay on their frames, as before.
  const viewPlan = () => (mode === 'code' ? STATUS.plans?.code : STATUS.plans?.video) ?? null;
  function anchorNote(n) {
    const p = viewPlan();
    if (p) { n.plan = p; n.at = { frame: n.frame, end: n.end ?? null, plan: p }; } else { delete n.at; delete n.plan; }
  }
  let following = false;
  const followTried = new Set();   // (a note whose plan the studio does not know: not asked again)
  async function followPlans() {
    const to = viewPlan();
    if (!to || !NOTES_OK || following || !repliesTxt) return;   // (the agent's answers read first: its recalage comes first)
    // a new video there and this page about to load it (06-render.js onHeld), or the video being replaced: not now — the
    // page of the new video does it, with that video
    const vid = STATUS.video ?? null;
    if (STATUS.held || (vid && META.render && (vid.size !== META.render.size || vid.mtime !== META.render.mtime))) return;
    const remapped = (n) => { const m = REPLIES.notes?.[n.id]?.remap; return !!(m?.render && META.render && m.render.size === META.render.size && n.render?.size !== META.render.size); };
    const todo = notes.filter((n) => n.at?.plan && n.plan !== to && !remapped(n) && !followTried.has(`${n.id}>${n.at.plan}>${to}`));
    if (!todo.length) return;
    following = true;
    try {
      const r = await postJson('/api/remap', { to, notes: todo.map((n) => ({ id: n.id, frame: n.at.frame, end: n.at.end ?? null, plan: n.at.plan })) });
      if (!r?.ok || viewPlan() !== to) return;
      // (the version it was placed on not known here any more: it does not follow — the recalage of before, after a render,
      // remap-notes.mjs, takes it again)
      for (const id of r.unknown ?? []) { const n = byId(id); if (n?.at) { followTried.add(`${id}>${n.at.plan}>${to}`); delete n.at; delete n.plan; } }
      if (r.unknown?.length) applyRemaps();
      let moved = 0;
      for (const m of r.notes ?? []) {
        const n = byId(m.id); if (!n || n.plan === to || !n.at) continue;
        if (n.frame !== m.frame || (n.end ?? null) !== (m.end ?? null)) {
          // (where it was on the version of before, shown on its card: « avant : image … »; the last move only)
          n.before = [...(n.before ?? []).filter((b) => !b.plan), { frame: n.frame, end: n.end ?? null, render: n.render ?? null, plan: n.plan ?? null }];
          n.frame = m.frame; n.end = m.end ?? null; n.context = contextAt(n.frame, n.end ?? n.frame); moved++;
        }
        n.plan = to; n.source = mode; if (META.render) n.render = META.render;   // (its image, for the agent, taken from the version shown)
      }
      persist(); HIST.last = JSON.stringify(notes); renderAll();
      if (moved) setTimeout(() => setSave(TN('st.follow.moved', { n: moved }), 'ok'), 900);   // (once saved: « Enregistré » would cover it)
    } catch { /* again at the next status */ } finally { following = false; }
    if (viewPlan() !== to) followPlans();   // (the version changed again meanwhile)
  }
  // a frame of one version on another one (the playhead, « Code actuel » ↔ « MP4 rendu »: the same moment)
  async function frameOn(f, from, to) {
    if (!from || !to || from === to) return f;
    const r = await postJson('/api/remap', { to, notes: [{ id: '@', frame: f, end: null, plan: from }] });
    return r?.ok && r.notes?.[0] ? r.notes[0].frame : f;
  }
  let liveVer = -1;
  async function loadLive() {
    try {
      const r = await (await fetch('/api/timeline', { cache: 'no-store' })).json();
      if (r.status === 'ready' && r.data) { LIVE = r.data; liveVer = r.version; buildLanes(); draw(); renderInspector(); }
    } catch { /* retried with the next status */ }
  }


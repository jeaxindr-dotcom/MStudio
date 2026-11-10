// The studio's page (studio.html), part 05: the queue sent to the agent, the Agent tab, the batches sent.
// The parts of page/studio/ are one script: studio-server.mjs joins them in their order inside one function (/studio.js),
// so they share their names as the one inline script did; hence the two-space indent.
  // ---------- pending edits -> Claude ----------
  let sending = false;
  function renderQueue() {
    const d = drafts();
    $('#qcnt').textContent = MAXQ ? `${d.length} / ${MAXQ}` : String(d.length); $('#qcnt').classList.toggle('full', !!MAXQ && d.length >= MAXQ);
    const nq = $('#nQueue'); nq.textContent = d.length; nq.classList.toggle('hot', d.length > 0); nq.classList.toggle('zero', !d.length);
    const empty = d.filter((n) => !n.text.trim() && !n.mark && !n.images?.length).length;
    $('#qsend').disabled = !d.length || !!empty || sending;
    $('#qsend').innerHTML = sending ? T('st.send.sending') : `${ic('send')}${d.length > 1 ? T('st.send.many', { n: d.length }) : d.length ? T('st.send.one') : T('st.send.zero')}`;
    $('#qhint').textContent = empty ? T('st.send.empty', { n: empty }) : (STATUS.agent?.watching && d.length ? T('st.send.watching', { name: agentName() }) : '');
  }
  async function sendQueue() {
    const d = drafts(); if (!d.length || sending) return;
    sending = true; renderQueue();
    try {
      if (!(await flushNow())) throw new Error(T('st.send.notSaved'));
      const marks = {}, cnv = document.createElement('canvas'); cnv.width = CW; cnv.height = CH;
      const num = new Map(reviewed().map((n, i) => [n.id, i + 1]));
      for (const n of d) if (n.mark) { const g = cnv.getContext('2d'); g.clearRect(0, 0, CW, CH); paintMark(g, n.mark, String(num.get(n.id)), 1, '#b49cff'); marks[n.id] = cnv.toDataURL('image/png'); }
      const r = await fetch('/api/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: d.map((n) => n.id), words: $('#qwords').value, marks, agent: AGENT_PICK, fps: FPS, size: [CW, CH] }) });
      const res = r.ok ? await r.json() : null;
      if (!res?.ok) throw new Error(r.ok ? T('st.send.emptyAnswer') : await r.text());
      for (const n0 of d) { const n = byId(n0.id) ?? n0; n.draft = false; n.lot = res.lot; n.sentAt = now(); }
      // the send before had failed on the way: that batch, its images made again; already handled by the agent: said, no window
      if (res.again === 'done') { HIST.back = []; HIST.fwd = []; HIST.last = null; $('#qwords').value = ''; save(); setTab('lots'); setSave(T('st.send.againDone', { lot: res.lot }), 'ok'); sending = false; renderAll(); return; }
      if (res.again) setTimeout(() => setSave(T('st.send.again', { lot: res.lot }), 'ok'), 1800);
      HIST.back = []; HIST.fwd = []; HIST.last = null;   // a batch sent is not taken back with Ctrl+Z
      if (d.some((n) => n.stage)) setTimeout(() => setSave(T('st.send.offsets'), 'ok'), 1600);
      $('#qwords').value = ''; save();
      showDeliveryModal(res.lot, T('st.send.title', { lot: res.lot, n: res.count }),
        res.line, T('st.send.saved', { md: res.md }), { updates: res.updates, updatesOk: res.updatesOk, pendingUpdatesId: res.pendingUpdatesId });
      setTab('lots');
    } catch (e) { setSave(T('st.send.failed', { msg: e.message }), 'err'); }
    sending = false; renderAll();
  }
  $('#qsend').onclick = sendQueue;

  // ---------- the Agent tab: a request written to the connected agent, sent at once as a batch (a note of kind « prompt »,
  // at the frame shown), its answers read from revue/replies.json like any note's (user's choice, 08/10/2026: « l'agent
  // connecté »: Coulisses starts nothing itself). A project made with « Nouveau projet » opens on this tab.
  const prompts = () => notes.filter((n) => n.kind === 'prompt').sort((a, b) => (a.created ?? '').localeCompare(b.created ?? ''));
  const parallaxId = 'scene-parallax-v1';
  async function sendPrompt(options = {}) {
    const parallax = options.request === parallaxId, ta = $('#agentText');
    let n = parallax ? byId(parallaxId) : options.retry ? byId(options.retry) : null;
    const text = parallax ? options.text : n ? n.text : ta.value.trim();
    if (!n && !parallax) n = prompts().find(item => item.draft && item.text === text);
    if (!text || sending || !NOTES_OK) return false;
    if (n?.lot && !n.draft) return true;
    if (!n) {
      n = { id: parallax ? parallaxId : uid(), kind: 'prompt', frame: curFrame(), end: null, text, images: [], thread: [], status: 'open', created: now(), render: META.render, draft: true, source: mode };
      stamp(n); notes.push(n);
    }
    sending = true; $('#agentSend').disabled = true;
    if (!parallax && !options.retry) ta.value = '';
    persist(); renderAgent();
    try {
      if (!(await flushNow())) throw new Error(T('st.send.notSaved'));
      const r = await fetch('/api/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [n.id], words: '', marks: {}, agent: AGENT_PICK, fps: FPS, size: [CW, CH] }) });
      const res = r.ok ? await r.json() : null;
      if (!res?.ok) throw new Error(r.ok ? T('st.send.emptyAnswer') : await r.text());
      n = byId(n.id) ?? n; n.draft = false; n.lot = res.lot; n.sentAt = now(); HIST.back = []; HIST.fwd = []; HIST.last = null; persist();
      if (parallax) setSave((FR ? 'Demande enregistrée · lot ' : 'Request saved · batch ') + res.lot, 'ok');
      else if (!res.agent?.watching) showDeliveryModal(res.lot, T('st.ag.sentTitle', { lot: res.lot }), res.line, T('st.send.saved', { md: res.md }), { updates: res.updates, updatesOk: res.updatesOk, pendingUpdatesId: res.pendingUpdatesId });
      else setSave(T('st.ag.waiting') + ' · ' + T('st.rc.lot',{lot:res.lot}), 'ok');
    } catch (e) {
      // Keep this note and its immutable ID until status or a retry confirms it.
      // The composer may already contain the user's next message.
      setSave(T('st.send.failed', { msg: e.message }), 'err');
    }
    sending = false; $('#agentSend').disabled = false; renderAll(); return !n.draft;
  }
  let agentSig = '';
  function renderAgent() {
    const box = $('#agentList'); if (!box) return;
    for (const request of prompts().filter(n => n.draft)) {
      const published = STATUS.lots?.find(L => L.ids?.includes(request.id));
      if (published) { request.draft = false; request.lot = published.lot; request.sentAt = published.sentAt; persist(); }
    }
    const a = STATUS.agent ?? {}, who = $('#agentWho');
    const presence=agentPresence(STATUS);
    who.classList.toggle('on', !!a.watching);
    who.querySelector('.t').innerHTML = a.watching ? esc(T('st.ag.connected', { name: presence.name })) : presence.kind==='claimed' ? esc(presence.text) : `${esc(T('st.ag.notConnected'))} <button class="soft" id="agentConnect">${T('st.agent.connect')}</button>`;
    $('#agentConnect')?.addEventListener('click', openConnect);
    const list = prompts(), lots = Object.fromEntries((STATUS.lots ?? []).map((L) => [L.lot, L]));
    const busy = list.filter((n) => !n.draft && !fixedOf(n)).length;
    $('#nAgent').textContent = busy; $('#nAgent').classList.toggle('zero', !busy); $('#nAgent').classList.toggle('hot', busy > 0);
    $('#agentHint').textContent = T(a.watching ? 'st.ag.hintOn' : presence.kind==='claimed' ? 'st.ag.claimedHint' : 'st.ag.hintOff');
    const sig = JSON.stringify([list.map((n) => [n.id, n.draft, n.lot, statusOf(n), threadOf(n).length, lots[n.lot]?.claude?.status]), a.watching, sending]);
    if (sig === agentSig) return; agentSig = sig;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    if (!list.length) {
      box.innerHTML = `<div class="ag-intro">${T(META.newProject ? 'st.ag.introNew' : 'st.ag.intro')}</div>`;
      return;
    }
    box.innerHTML = list.map((n) => {
      const st = statusOf(n), L = lots[n.lot];
      const chip = n.draft ? `<span class="st wait">${sending ? T('st.ag.sending') : (FR ? 'Envoi non confirmé' : 'Delivery not confirmed')}</span>`
        : fixedOf(n) ? `<span class="st ok">${ic('check')}${T('st.ag.done')}</span>`
        : st === 'working' || L?.claude?.status === 'taken' ? `<span class="st work">${T('st.ag.working')}</span>`
        : `<span class="st wait">${FR ? 'Envoyée · en attente de prise en charge' : 'Sent · awaiting pickup'}</span>`;
      const answers = threadOf(n).filter((m) => m.from === 'claude').map((m) => `<div class="it">${esc(m.text)}${m.images?.length ? `<div class="thumbs">${m.images.map((im) => `<img src="/${esc(im.file ?? im)}" data-full="/${esc(im.file ?? im)}" alt="">`).join('')}</div>` : ''}</div>`).join('');
      const retry = n.draft && !sending ? `<button type="button" class="soft" data-retry="${esc(n.id)}">${FR ? 'Réessayer' : 'Retry'}</button>` : '';
      return `<div class="ag" data-id="${esc(n.id)}"><div class="me">${esc(n.text)}</div><div class="meta">${n.lot ? T('st.rc.lot', { lot: n.lot }) + ' · ' : ''}${hhmm(n.created)} ${chip} ${retry}</div>${answers}</div>`;
    }).join('');
    box.querySelectorAll('.thumbs img').forEach((im) => im.onclick = () => openLightbox(im.dataset.full));
    box.querySelectorAll('[data-retry]').forEach(b => b.onclick = () => sendPrompt({retry:b.dataset.retry}));
    if (atBottom) box.scrollTop = box.scrollHeight;
  }
  $('#agentSend').onclick = sendPrompt;
  $('#agentText').addEventListener('keydown', (e) => {   // Entrée sends, Maj+Entrée goes to the line
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); sendPrompt(); }
    e.stopPropagation();
  });

  // ---------- batches sent ----------
  const lotState = (L) => {
    if (L.run?.state === 'undone') return ['undone', T('st.lot.undone')];
    const c = L.claude?.status;
    if (c === 'done') return ['done', T('st.lot.done')];
    if (c === 'declined') return ['done', T('st.lot.declined')];
    if (c === 'taken') return ['taken', T('st.lot.taken')];
    return ['', T('st.lot.waiting')];
  };
  function captureStatusHtml(c) {
    if (!c || !['pending', 'ready', 'error'].includes(c.status)) return '';
    const label = esc(T(`st.lot.captures.${c.status}`, { done: c.done, total: c.total }));
    if (c.status === 'error' && c.error) {
      return `<details class="msg2" data-capture-status="error"><summary>${label}</summary>${esc(c.error)}</details>`;
    }
    return `<div class="msg2" data-capture-status="${c.status}">${label}</div>`;
  }
  // « Annuler cette correction » / « Rétablir » of a batch (the card's buttons, and Edit › Undo / Redo of the menu bar)
  async function stepLot(L, verb, resEl) {
    if (verb === 'undo' && !confirm(T('st.lot.undoConfirm', { lot: L.lot }))) return null;
    const r = await (await fetch('/api/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lot: L.lot, verb }) })).json();
    const msg = r.ok ? T(verb === 'undo' ? 'st.lot.undoneRes' : 'st.lot.redoneRes', { files: r.files.join(', ') }) : r.why;
    if (resEl) resEl.textContent = msg; else setSave(msg, r.ok ? 'ok' : 'err');
    if (r.ok) {
      for (const id of L.ids) { const n = byId(id); if (!n) continue; (n.thread ??= []).push({ kind: 'system', text: T(verb === 'undo' ? 'st.lot.undoneThread' : 'st.lot.redoneThread', { lot: L.lot }), images: [], at: now() }); n.status = verb === 'undo' ? 'open' : 'done'; n.statusAt = now(); }
      save(); setTimeout(() => { statusTxt = ''; }, 0);
    }
    return r;
  }
  let signalClock = null;
  function deliveryControls(L, el) {
    if (L.claude && L.claude.status !== 'open') return;
    const area = el.querySelector('.acts'), status = document.createElement('div');
    status.className = 'msg2'; status.dataset.delivery = 'waiting';
    const time = Date.parse(L.signaledAt || L.sentAt);
    const age = Date.now() - time;
    status.textContent = L.signaledAt ? (FR ? 'Lot resignalé à ' : 'Batch flagged again at ') + hm5(new Date(L.signaledAt))
      : FR ? 'En attente de prise en charge.' : 'Awaiting pickup.';
    if (age >= 30000) status.textContent += FR ? ' Aucun accusé depuis 30 s ou plus.' : ' No acknowledgement for at least 30 s.';
    else if (Number.isFinite(age) && !signalClock) signalClock = setTimeout(renderLots, Math.max(250, 30100 - age));
    area.before(status);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'soft lot-resignal';
    b.textContent = FR ? 'Resignaler ce lot' : 'Flag this batch again';
    b.title = FR ? 'Prioriser ce même lot au prochain appel de studio-cli wait' : 'Prioritize this batch on the next studio-cli wait';
    area.append(b);
    b.onclick = async () => {
      b.disabled = true;
      try {
        const response = await fetch('/api/lots/resignal', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lot:L.lot})});
        if (response.status === 409) { status.textContent = FR ? 'Ce lot a déjà été pris en charge.' : 'This batch has already been picked up.'; return; }
        if (!response.ok) throw new Error(String(response.status));
        L.signaledAt = (await response.json()).at;
        renderLots();
      } catch (e) { status.textContent = (FR ? 'Échec du signalement · ' : 'Could not flag batch · ') + e.message; b.disabled = false; }
    };
  }
  function renderLots() {
    if (signalClock) { clearTimeout(signalClock); signalClock = null; }
    const box = $('#lots'), lots = [...(STATUS.lots ?? [])].reverse();
    $('#nLots').textContent = lots.length; $('#nLots').classList.toggle('zero', !lots.length);
    $('#nLots').classList.toggle('hot', lots.some((L) => L.claude?.status === 'taken'));
    if (!onTab('lots')) { rcKey = ''; return; }
    renderRender();
    if (!lots.length) { box.innerHTML = `<div class="empty">${T('st.lot.none')}</div>`; return; }
    box.innerHTML = '';
    for (const L of lots) {
      if (L.kind === 'render') {   // a render request: no edits, no undo
        const el = document.createElement('div'); el.className = 'lot req';
        const R = STATUS.render, mine = R?.lot === L.lot;
        const [cls, key] = L.claude?.status === 'done' ? ['done', 'reviewed'] : !L.claude ? ['', 'waiting']
          : !mine ? (R && Date.parse(R.startedAt) > Date.parse(L.sentAt) ? ['undone', 'replaced'] : ['taken', 'preparing'])
          : ({ running: ['taken', 'running'], blocked: ['undone', 'blocked'], failed: ['undone', 'failed'], interrupted: ['undone', 'interrupted'],
            cancelled: ['undone', 'cancelled'], rendered: ['taken', 'watching'], reviewed: ['done', 'reviewed'] }[R.state] ?? ['taken', 'preparing']);
        const txt = key === 'waiting' ? T('st.lot.waiting') : T(`st.req.${key}`);
        el.innerHTML = `<div class="lh"><b>${T('st.rc.render')}</b><span class="muted" style="font-size:12px">${T('st.lot.reqSub', { lot: L.lot, at: esc(hhmm(L.sentAt)) })}</span><span class="st ${cls}"><span class="dot"></span>${txt}</span></div>
          ${L.claude?.message ? `<div class="msg2">${esc(L.claude.message)}</div>` : ''}<div class="acts"><button class="soft cp">${ic('copy')}${T('st.lot.copy')}</button></div>`;
        el.querySelector('.cp').onclick = () => copy(L.line);
        deliveryControls(L,el); box.appendChild(el); continue;
      }
      const [cls, txt] = lotState(L), el = document.createElement('div'); el.className = 'lot'; el.dataset.lot = L.lot;
      const canUndo = L.run?.finished && L.run.state !== 'undone', canRedo = L.run?.state === 'undone';
      el.innerHTML = `<div class="lh"><b>${T('st.lot.title', { lot: L.lot })}</b><span class="muted" style="font-size:12px">${T('st.lot.sub', { n: L.ids.length, at: esc(hhmm(L.sentAt)) })}</span><span class="st ${cls}"><span class="dot"></span>${txt}</span></div>
        ${captureStatusHtml(L.captureState)}
        ${L.claude?.message ? `<div class="msg2">${esc(L.claude.message)}</div>` : ''}
        ${L.run?.files?.length ? `<div class="msg2">${T('st.lot.files', { files: esc(L.run.files.join(', ')) })}</div>` : ''}
        <div class="msg2 res"></div>
        <div class="acts"><button class="soft cp">${ic('copy')}${T('st.lot.copy')}</button><button class="soft go">${T('st.lot.notes')}</button>
        ${canUndo ? `<button class="soft danger un">${ic('undo')}${T('st.lot.undo')}</button>` : ''}${canRedo ? `<button class="soft re">${ic('redo')}${T('st.lot.redo')}</button>` : ''}</div>`;
      el.querySelector('.cp').onclick = () => copy(L.line);
      // « Voir les notes »: this batch's only, in the Notes tab and on the timeline (the menu « Lot N » of the Notes tab)
      el.querySelector('.go').onclick = () => { const n = byId(L.ids[0]); if (n) { setLotF(L.lot, false); sel = n.id; M.pause(); seekFrame(n.frame); renderAll(); showCard(n.id); } };
      el.querySelector('.un')?.addEventListener('click', () => stepLot(L, 'undo', el.querySelector('.res')));
      el.querySelector('.re')?.addEventListener('click', () => stepLot(L, 'redo', el.querySelector('.res')));
      deliveryControls(L,el); box.appendChild(el);
    }
  }


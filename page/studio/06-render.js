// The studio's page (studio.html), part 06: the full render (asked here, run by the agent), the before / after wipe.
// The parts of page/studio/ are one script: studio-server.mjs joins them in their order inside one function (/studio.js),
// so they share their names as the one inline script did; hence the two-space indent.
  // ---------- the full re-render: asked here, run by Claude (studio-cli.mjs render), progress in STATUS.render ----------
  const dayTime = (iso) => (iso ? (FR ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(' ', ' à ')
    : `${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`) : '?');
  const frDur = (s) => (FR ? String(s ?? '').replace(/(\d+)h/, '$1 h').replace(/(\d+)m(?!s)/, '$1 min').replace(/(\d+)s/, '$1 s') : String(s ?? ''));
  const mmss = (sec) => `${Math.floor(sec / 60)} min ${String(Math.round(sec % 60)).padStart(2, '0')} s`;
  const dB = (x) => (x == null ? '?' : dec((+x).toFixed(1)).replace('-', '−'));
  const finLabel = (l) => (/final mix/.test(l) ? T('st.fin.mix') : /review tool/.test(l) ? T('st.fin.plan') : /chapters/i.test(l) ? T('st.fin.chapters')
    : /paused/.test(l) ? T('st.fin.paused') : /is back/.test(l) ? T('st.fin.back') : l);
  const BAD = ['blocked', 'failed', 'interrupted', 'cancelled'];
  function renderView() {
    const lots = STATUS.lots ?? [], R = STATUS.render ?? null, cur = STATUS.video ?? META?.render ?? null;
    const req = [...lots].reverse().find((L) => L.kind === 'render') ?? null;
    const after = (a, b) => a && b && Date.parse(a) >= Date.parse(b);
    let st = 'idle';
    if (req && !req.claude) st = 'requested';
    else if (req?.claude?.status === 'taken') st = R && after(R.startedAt, req.sentAt) && !['checked', 'rendered-raw'].includes(R.state) ? R.state : 'preparing';
    else if (R?.state === 'running') st = 'running';
    else if (R?.state === 'rendered' && R.video && cur && R.video.size === cur.size) st = 'rendered';
    const since = lots.filter((L) => L.kind !== 'render' && cur && L.render?.size === cur.size);
    return { st, R, req, cur, since };
  }
  function renderPill() {
    const p = $('#renderPill');
    if (PROJ) {   // a project: its export, as « Rendu 36 % »
      const X = STATUS.export, run = X?.state === 'running', pc = X?.frames?.total ? (X.frames.done / X.frames.total) * 100 : X?.pct ?? 0;
      p.className = run ? 'show' : ''; p.querySelector('.t').textContent = run ? T('st.pill.pct', { pct: Math.floor(pc) }) : ''; p.querySelector('.mini i').style.width = `${run ? pc : 0}%`;
      return;
    }
    const { st, R } = renderView(), pct = R?.render?.pct ?? 0;
    let t = '', cls = '';
    if (st === 'running') t = R.phase === 'checks' ? T('st.pill.checks') : R.phase === 'finish' ? T('st.pill.finish') : R.render?.stage === 'frames' ? T('st.pill.pct', { pct: Math.floor(pct) }) : R.render?.stage === 'encode' ? T('st.pill.encode') : T('st.pill.preparing');
    else if (st === 'requested' || st === 'preparing') t = T('st.pill.requested');
    else if (st === 'blocked' || st === 'failed' || st === 'interrupted') { t = st === 'blocked' ? T('st.pill.blocked') : T('st.pill.failed'); cls = 'fail'; }
    else if (st === 'rendered') { t = T('st.pill.ready'); cls = 'ready'; }
    p.className = t ? `show ${cls}` : '';
    p.querySelector('.t').textContent = t;
    p.querySelector('.mini i').style.width = `${st === 'running' ? (R.phase === 'render' ? pct : R.phase === 'finish' ? 100 : 2) : 0}%`;
  }
  $('#renderPill').onclick = () => setTab('lots');
  let rcKey = '';
  // ---------- « Rendu »: one card in every project (user request, 19/10/2026: « je voulais exactement la même interface pour
  // tous les projets : option 1080p, option 4K et un compteur de combien d'images sur combien sont déjà rendues ») ----------
  // An episode of the Theatre: the render asked here, run by the agent (studio-cli.mjs render: STATUS.render); a project:
  // its export script, run by the studio (lib/export.mjs: STATUS.export). The same card for both, in this order: what it
  // is, the quality (1080p | 4K, then a project's own variants), « Lancer le rendu », then « image 12 345 / 34 019 », the
  // time left and the step; the video made, its folder, the comparison. What does not apply is greyed, with the reason.
  const QKEY = () => `coulisses.quality.${META?.coulisses ?? META?.root ?? META?.episode ?? ''}`;
  function qualities() {
    if (!PROJ) return [{ id: '1080p', label: '1080p', send: '1080p' }, { id: '4k', label: '4K', send: '4k' }];
    const why = META.features?.export ? null : T('st.ex.unavailable', { why: META.exportWhy ?? T('st.ex.unavailableWhy') });
    const opts = META.exportOptions?.length ? META.exportOptions : [{ id: null, label: T('common.exportVideo') }];
    // a script's variants: « 1080p » / « 4k » by their id, else by their words (宇宙ちゃん: « final » = « Exporter (4K final) »,
    // « test » = « Rendu test (1080p) », a whole video in 1080p); a test or a replacement only when nothing else is that size
    const words = (o) => `${o.id ?? ''} ${o.label ?? ''} ${o.resolution ?? ''}`, side = (o) => o.scope!=='full' && (o.scope==='excerpt' || /\b(test|essai|remplac\w*|replace)\b/i.test(words(o)));
    const is4k = (o) => /\b(4k|2160p?|uhd)\b/i.test(words(o)), is1080 = (o) => /\b1080p?\b/i.test(words(o));
    const o4 = opts.find((o) => o.id === '4k') ?? opts.find((o) => is4k(o) && !side(o)) ?? null;
    const o1 = opts.find((o) => o.id === '1080p' && !side(o)) ?? opts.find((o) => o !== o4 && is1080(o) && !side(o));
    return [{ id: '1080p', label: o1?.scope ? o1.label : '1080p', send: o1?.id ?? null, why: why ?? (o1 ? null : TN('st.q.no1080')) },
      { id: '4k', label: o4?.scope ? o4.label : '4K', send: o4?.id ?? null, why: why ?? (o4 ? null : TN('st.q.no4k')) },
      ...opts.filter((o) => o !== o1 && o !== o4).map((o) => ({ id: `x:${o.id}`, label: o.label, send: o.id, why }))];
  }
  function quality() {
    const qs = qualities(); let want = null; try { want = localStorage.getItem(QKEY()); } catch { /* private window */ }
    return qs.find((x) => x.id === want && !x.why) ?? qs.find((x) => !x.why) ?? qs[0];
  }
  function setQuality(id) { try { localStorage.setItem(QKEY(), id); } catch { /* private window */ } rcKey = ''; renderRender(); markGo(); }
  // « Lancer le rendu » in the quality chosen: an episode's render (asked to the agent), a project's export
  const goRender = () => { const x = quality(); if (PROJ) startExportUI(x.send, x.label); else launchRender(); };
  const qLabel = (send) => (send === '4k' ? '4K' : send === '1080p' ? '1080p' : (qualities().find((x) => x.send === send)?.label ?? '1080p'));
  function qualityHtml(locked, running = null) {   // (running: the quality sent of the render going on — the one lit)
    const cur = running ? (qualities().find((x) => x.send === running) ?? quality()) : quality(), px = (id) => (id === '4k' ? (CH > CW ? '2160×3840' : '3840×2160') : id === '1080p' ? (CH > CW ? '1080×1920' : '1920×1080') : '');
    return `<div class="qline"><span class="sub2">${TN('st.q.title')}</span><span class="seg" id="rcQ">${qualities().map((x) => `<button data-q="${esc(x.id)}" class="${x.id === cur.id ? 'on' : ''}" ${locked || x.why ? 'disabled' : ''} title="${esc(x.why ?? px(x.id))}">${esc(x.label)}</button>`).join('')}</span></div>`;
  }
  // the four numbered steps of a render, the same in every project (user request, 19/10/2026, the Theatre's card in a
  // screenshot: « je veux que ce soit comme ça pour tous les projets »): its number, ✓ once done, a spinner while it runs,
  // ✗ when it failed; the second one with its bar, « image 12 345 / 34 019 » and the time left
  function renderSteps(rows) {
    const ix = (st, n) => (st === 'ok' ? ic('check') : st === 'fail' ? ic('x') : st === 'run' ? '<span class="spin"></span>' : n);
    return `<div class="steps">${rows.map((r) => `<div class="stp ${r.s}"><span class="ix">${ix(r.s, r.n)}</span><div><div class="t">${r.t}</div>${r.body}</div></div>`).join('')}</div>`;
  }
  const barBody = () => `<div class="rbar"><i id="rcBar"></i></div><div class="num2"><span id="rcNum">${T('st.steps.waiting')}</span><span class="muted" id="rcEta"></span></div>`;
  // the moving parts (every status, without drawing the card again): the bar, « image … / … », the time left
  const nf = (x) => (+x || 0).toLocaleString(FR ? 'fr-FR' : 'en-US');
  function setProgress({ done = null, total = null, pct = null, eta = '', num = null }) {
    const bar = $('#rcBar'); if (!bar) return;
    const p = total ? Math.min(100, (done / total) * 100) : pct;
    bar.style.width = `${Math.max(0, Math.min(100, p ?? 0))}%`;
    $('#rcNum').textContent = num ?? (total ? T('st.num.frames', { f: nf(done), total: nf(total), pct: dec((Math.floor((p ?? 0) * 10) / 10).toFixed(1)) }) : p != null ? T('st.ex.pct', { pct: Math.round(p) }) : T('st.steps.waiting'));
    $('#rcEta').textContent = eta;
  }
  // an export's time left, from its own pace (the last minute and a half of its frames)
  let paceOf = null;
  function exportEta(X) {
    // (its frames, or without them its percentage: the pace of either)
    const f = X.frames?.total ? X.frames : Number.isFinite(X.pct) ? { done: X.pct, total: 100 } : null;
    if (!f?.total || f.done >= f.total) return '';
    if (paceOf?.started !== X.started) paceOf = { started: X.started, pts: [] };
    const now = Date.now(), pts = paceOf.pts;
    if (!pts.length || pts.at(-1)[1] !== f.done) pts.push([now, f.done]);
    while (pts.length > 2 && now - pts[0][0] > 90000) pts.shift();
    if (pts.length < 2) return '';
    const [t0, d0] = pts[0], [t1, d1] = pts.at(-1), rate = (d1 - d0) / ((t1 - t0) / 1000);
    if (!(rate > 0)) return '';
    const s = (f.total - f.done) / rate;
    return T('st.num.left', { t: s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s` });
  }
  // an export's step, in words (the script says its own: paquet, 3D-4K, rendu…)
  const STEPS = { paquet: ['préparation', 'preparing'], '3D-4K': ['scènes 3D en 4K', '3D scenes in 4K'], rendu: ['rendu des images', 'rendering the frames'], assemblage: ['assemblage des morceaux', 'joining the parts'],
    son: ['mixage du son', 'mixing the sound'], volume: ['volume', 'loudness'], '1080p': ['1080p tirée de la 4K', '1080p from the 4K'], HyperFrames: ['rendu HyperFrames', 'HyperFrames render'], fin: ['fin', 'end'], fini: ['fin', 'end'] };
  const stepWords = (s) => { if (!s) return ''; const w = STEPS[s] ?? (/^vitesse/.test(s) ? [`copie à la vitesse (${s.replace(/^vitesse\s*/, '')})`, `copy at speed (${s.replace(/^vitesse\s*/, '')})`] : [s, s]); return w[FR ? 0 : 1]; };
  // an export's four steps (its script's steps: paquet, 3D-4K → the preparation; rendu → the frames; the rest → the finish)
  const phaseOf = (e) => (!e || /^(paquet|3D-4K|synchro|prépar|bundle)/i.test(e) ? 0 : /^(rendu|hyperframes|render)/i.test(e) ? 1 : /^(fin|fini|done)$/i.test(e) ? 3 : 2);
  function exportSteps(X) {
    const cur = X.state === 'done' ? 4 : phaseOf(X.etape), bad = X.state === 'failed' || X.state === 'stopped';
    const st = (i) => (i < cur ? 'ok' : i > cur ? 'wait' : bad ? 'fail' : X.state === 'running' ? 'run' : 'ok');
    return renderSteps([
      { n: 1, t: TN('st.steps.prep'), body: `<div class="d">${cur === 0 && X.etape && X.etape !== 'paquet' ? esc(stepWords(X.etape)) : TN('st.steps.prepWhat')}</div>`, s: st(0) },
      { n: 2, t: T('st.steps.render'), body: barBody(), s: st(1) },
      { n: 3, t: T('st.steps.finish'), body: `<div class="d">${cur === 2 ? esc(stepWords(X.etape)) : TN('st.steps.finishX')}</div>`, s: st(2) },
      { n: 4, t: TN('st.steps.reviewX'), body: `<div class="d">${TN('st.steps.reviewXWhat')}</div>`, s: st(3) },
    ]);
  }
  // an episode's four steps (the agent's: lib/render.mjs), as they were
  function episodeSteps(R) {
    const order = ['checks', 'render', 'finish', 'review'], only = R?.only ?? ['checks', 'render', 'finish'];
    const cur = R ? order.indexOf(R.phase === 'done' ? 'review' : R.phase) : -1;
    const stOf = (k) => {
      if (k !== 'review' && R && !only.includes(k)) return 'skip';
      if (!R) return 'wait';
      const i = order.indexOf(k);
      if (i < cur) return 'ok';
      if (i > cur) return 'wait';
      if (R.state === 'running') return 'run';
      if (BAD.includes(R.state)) return 'fail';
      if (k === 'review') return R.state === 'reviewed' ? 'ok' : 'run';
      return 'ok';
    };
    const chk = R?.checks ?? [], judge = chk.find((c) => c.toJudge)?.toJudge;
    const chip = (c) => `<span class="chip ${c.status === 'wait' ? '' : c.status}" title="${esc(c.detail)}">${c.status === 'ok' ? ic('check') : c.status === 'fail' ? ic('x') : c.status === 'run' ? '<span class="spin"></span>' : ''}${esc(c.label)}</span>`;
    const checksBody = chk.length ? `<div class="chips">${chk.map(chip).join('')}</div>${judge ? `<div class="d">${T('st.steps.judge', { n: judge })}</div>` : ''}` : `<div class="d">${T('st.steps.checksList')}</div>`;
    const fin = R?.finish?.steps ?? [];
    return renderSteps([
      { n: 1, k: 'checks', t: T('st.steps.checks'), body: checksBody },
      { n: 2, k: 'render', t: T('st.steps.render'), body: barBody() },
      { n: 3, k: 'finish', t: T('st.steps.finish'), body: `<div class="d" id="rcFin">${fin.length && stOf('finish') === 'run' ? esc(finLabel(fin.at(-1).label)) : T('st.steps.finishList')}</div>` },
      { n: 4, k: 'review', t: T('st.steps.review'), body: `<div class="d">${T('st.steps.reviewWhat')}</div>` },
    ].map((r) => ({ ...r, s: stOf(r.k) })).filter((r) => r.s !== 'skip'));
  }
  function renderRender() {
    const box = $('#renderCard'); if (!box || !META) return;
    queueMicrotask(speedJob);   // the copy at another speed: its own part of the card, updated in place
    return PROJ ? exportCard(box) : episodeCard(box);
  }
  function wireCard() {
    for (const b of document.querySelectorAll('#rcQ button')) b.addEventListener('click', () => setQuality(b.dataset.q));
    $('#rcLog')?.addEventListener('click', PROJ ? showExportLog : showRenderLog);
    $('#rcCmp')?.addEventListener('click', () => openCompare());
    $('#exGpu')?.addEventListener('change', async (e) => {
      const r = await postJson('/api/gpu', { on: e.target.checked });
      if (r?.ok) { META.gpu = r.gpu; rcKey = null; renderRender(); setSave(r.gpu.off ? T('st.ex.gpuNowOff') : T('st.ex.gpuNowOn'), 'ok'); } else setSave(T('st.noAnswer'), 'err');
    });
    wireSpeed();
  }
  // ---- an episode of the Theatre: the render, asked here and run by the agent ----
  function episodeCard(box) {
    const { st, R, req, cur, since } = renderView(), q = quality();
    const key = JSON.stringify([st, R?.phase, R?.state, R?.startedAt, R?.checks?.map((c) => c.status), R?.finish?.steps?.length, req?.lot, req?.claude?.status,
      STATUS.compare?.length, since.map((L) => [L.lot, L.claude?.status]), R?.message, STATUS.agent?.watching, cur?.size, q.id]);
    if (key === rcKey) { episodeNums(R); return; }
    rcKey = key;
    const done = since.filter((L) => L.claude?.status === 'done').length, open = since.filter((L) => !L.claude || L.claude.status === 'taken').length;
    const right = st === 'idle' || st === 'requested' ? (cur ? T('st.rc.videoOf', { date: dayTime(cur.mtime) }) : T('st.ex.noVideo')) : st === 'preparing' ? T('st.rc.lot', { lot: req?.lot ?? '' }) : R?.startedAt ? T('st.rc.started', { date: dayTime(R.startedAt) }) : '';
    let h = `<div class="rh">${ic('film')}<b>${T('st.rc.render')}</b><span class="muted">${esc(right)}</span></div>
      <div class="sub2">${since.length ? T('st.rc.since', { n: done, open: open ? T('st.rc.sinceOpen', { k: open }) : '' }) : T('st.rc.sinceNone')}</div>`;
    const busy = st !== 'idle' && !['failed', 'interrupted', 'cancelled', 'rendered'].includes(st);
    h += qualityHtml(busy, busy ? (R?.qualite ?? req?.qualite ?? '1080p') : null);
    const B = {
      go: `<button class="primary" id="rcGo">${ic('play')}${T(['failed', 'interrupted', 'cancelled'].includes(st) ? 'st.rc.again' : 'st.rc.go')}</button>`,
      cmp: STATUS.compare?.length ? `<button class="soft" id="rcCmp">${ic('image')}${T('st.rc.compare', { n: STATUS.compare.length })}</button>` : '',
      reveal: cur ? `<button class="soft" id="rcReveal" title="${esc(T('st.rc.revealTitle', { name: cur.name }))}">${ic('folder')}${T('st.rc.reveal')}</button>` : '',
      log: R ? `<button class="soft" id="rcLog">${T('st.rc.log')}</button>` : '',
      copy: req ? `<button class="soft" id="rcCopy">${ic('copy')}${T('st.lot.copy')}</button>` : '',
      stop: R?.state === 'running' && R.phase !== 'finish' ? `<button class="soft danger" id="rcStop">${ic('x')}${T('st.rc.stop')}</button>` : '',
    };
    if (st === 'idle') {
      if (R?.state === 'reviewed' && R.video?.size === cur?.size) h += `<div class="ok2">${T('st.rc.lastChecked', { msg: R.message ? T('st.rc.lastMsg', { msg: esc(R.message) }) : '' })}</div>`;
      else if (R && BAD.includes(R.state)) h += `<div class="sub2 muted">${T('st.rc.lastTry', { state: T(R.state === 'cancelled' ? 'st.rc.stoppedWord' : 'st.rc.interruptedWord'), date: dayTime(R.endedAt ?? R.updatedAt) })}</div>`;
      h += `<div class="acts">${B.go}${B.cmp}${B.reveal}${B.log}</div>`;
    } else if (st === 'requested') {
      h += `<div class="sub2"><b>${T('st.rc.render')} ${esc(qLabel(req?.qualite ?? '1080p'))}</b> · ${esc(T('st.rc.requested', { date: dayTime(req.sentAt) }))}</div>
        <div class="sub2">${STATUS.agent?.watching ? T('st.rc.watching', { name: agentName() }) : T('st.rc.paste', { name: agentName() })}</div>`
        + `<div class="acts">${B.copy.replace('soft', 'primary')}<button class="soft danger" id="rcWithdraw">${T('st.rc.withdraw')}</button></div>`;
    } else {
      h += episodeSteps(st === 'preparing' ? null : R);
      if (st === 'preparing') h += `<div class="sub2">${T('st.rc.preparing')}</div>`;
      if (st === 'blocked') h += `<div class="err">${esc(R.error ?? T('st.rc.checkFailed'))}${T('st.rc.agentFixes')}</div>`;
      if (st === 'failed') h += `<div class="err">${esc(R.error ?? T('st.rc.failed'))}</div>`;
      if (st === 'interrupted') h += `<div class="err">${T('st.rc.interrupted')}</div>`;
      if (st === 'cancelled') h += `<div class="sub2">${T('st.rc.cancelled', { date: dayTime(R.endedAt) })}</div>`;
      if (st === 'rendered') {
        const F = R.finish ?? {}, dur = F.duration ? mmss(F.duration).replace(/ 0?(\d+) s$/, ' $1 s') : '';
        h += `<div class="ok2">${T('st.rc.ready', { dur: dur ? ` · ${dur}` : '', lufs: F.loudness?.I != null ? ` · ${dB(F.loudness.I)} LUFS` : '', peak: F.loudness?.peak != null ? T('st.rc.peak', { v: dB(F.loudness.peak) }) : '', remapped: F.remapped != null ? T('st.rc.remapped', { n: F.remapped }) : '' })}</div>`;
      }
      const again = ['failed', 'interrupted', 'cancelled'].includes(st) ? B.go : '';
      h += `<div class="acts">${again}${B.stop}${st === 'rendered' ? B.cmp + B.reveal : ''}${st === 'preparing' ? B.copy : ''}${B.log}</div>`;
    }
    box.innerHTML = `<div class="rc">${h}${gpuLine()}${speedBlock()}</div>`;
    wireCard();
    $('#rcGo')?.addEventListener('click', launchRender);
    $('#rcReveal')?.addEventListener('click', () => revealMenu('video'));
    $('#rcCopy')?.addEventListener('click', () => copy(req.line));
    $('#rcStop')?.addEventListener('click', stopRender);
    $('#rcWithdraw')?.addEventListener('click', async () => {
      const r = await postJson('/api/render/withdraw', { lot: req.lot });
      setSave(r?.ok ? T('st.rc.withdrawn') : T('st.cannot', { why: r?.why ?? T('st.noAnswer') }), r?.ok ? 'ok' : 'err'); statusTxt = '';
    });
    episodeNums(R);
  }
  function episodeNums(R) {   // the parts of an episode's render that move every few seconds, as before
    const r = R?.render; if (!$('#rcBar') || !r) return;
    if (r.stage === 'frames') setProgress({ done: r.frame, total: r.total, eta: r.remaining ? T('st.num.left', { t: frDur(r.remaining) }) : '' });
    else if (r.stage === 'bundle') setProgress({ pct: 0, num: T('st.num.bundle', { pct: r.pct }) });
    else if (r.stage === 'copy') setProgress({ pct: 0, num: T('st.num.copy', { size: r.copied ?? '' }) });
    else if (r.stage === 'compose') setProgress({ pct: 0, num: T('st.num.compose') });
    else if (r.stage === 'encode') setProgress({ pct: 100, num: T('st.num.encode', { pct: r.total ? Math.round((r.encoded / r.total) * 100) : 0 }) });
    else if (r.stage === 'done') setProgress({ pct: 100, num: T('st.num.done', { n: nf(r.total) }), eta: r.startedAt && r.endedAt ? T('st.num.in', { t: mmss((Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 1000) }) : '' });
    const fEl = $('#rcFin'), fs2 = R.finish?.steps ?? []; if (fEl && fs2.length && R.phase === 'finish' && R.state === 'running') fEl.textContent = finLabel(fs2.at(-1).label);
  }
  // ---- a project: its export script, run by the studio ----
  function exportCard(box) {
    const cur = STATUS.video ?? META.render, X = STATUS.export, S2 = STATUS.shot, run = X?.state === 'running', q = quality();
    const key = JSON.stringify(['export', cur?.size, cur?.mtime, STATUS.compare?.length, X?.state, X?.started, X?.etape, META.gpu?.mode, META.gpu?.off, q.id, CW, CH, FPS,
      S2?.state, S2?.pct, S2?.etape, S2?.ended, (STATUS.shotTargets ?? META.shotTargets ?? []).map((u) => [u.exists, u.previous])]);
    if (key === rcKey) { exportNums(X); return; }
    rcKey = key;
    // (what it is, and where the video comes from: the title's tip)
    const where = LIVEP() ? (META.exportDir ? T('st.ex.willLoad', { dir: META.exportDir }) : T('st.ex.noDir'))
      : META.kind === 'run' ? T('st.ex.whereRun', { dir: META.exportDir ? T('st.ex.inDir', { dir: META.exportDir }) : '' }) : META.kind === 'aitelier' ? T('st.ex.whereAit') : META.kind === 'video' ? T('st.ex.whereVideo') : T('st.ex.whereFolder');
    const right = run ? T('st.rc.started', { date: dayTime(X.started) }) : cur ? T('st.rc.videoOf', { date: dayTime(cur.mtime) }) : kindLabel();
    let h = `<div class="rh" title="${esc(where.replace(/<[^>]+>/g, ''))}">${ic('film')}<b>${T('st.rc.render')}</b><span class="muted">${esc(right)}</span></div>
      <div class="sub2">${cur ? T('st.ex.file', { name: esc(cur.name), date: dayTime(cur.mtime), w: CW, h: CH, fps: dec(FPS) }) : LIVEP() ? TN('st.rc.liveCode', { comp: esc(META.composition ?? ''), w: CW, h: CH, fps: dec(FPS) }) : T('st.ex.noVideo')}</div>`;
    h += shotBlock() + qualityHtml(run, run ? (X.qualite ?? qualities()[0].send) : null);
    const can = !qualities().every((x) => x.why), why = META.exportWhy || qualities()[0].why;
    const reveal = X?.state === 'done' && X.file ? `<button class="soft" id="rcReveal" title="${esc(X.file)}">${ic('folder')}${T('st.rc.reveal')}</button>`
      : cur ? `<button class="soft" id="rcReveal" title="${esc(T('st.rc.revealTitle', { name: cur.name }))}">${ic('folder')}${T('st.rc.reveal')}</button>` : '';
    const cmp = STATUS.compare?.length ? `<button class="soft" id="rcCmp">${ic('image')}${T('st.rc.compare', { n: STATUS.compare.length })}</button>` : '';
    const log = X ? `<button class="soft" id="rcLog">${T('st.rc.log')}</button>` : '';
    if (run) {
      h += exportSteps(X) + `<div class="sub2 muted">${TN('st.steps.goesOn')}</div>`;
      h += `<div class="acts"><button class="soft danger" id="rcStop">${ic('x')}${T('st.rc.stop')}</button>${log}</div>`;
    } else {
      if (X?.state === 'done') h += `<div class="ok2">${T('st.ex.done', { date: dayTime(X.ended), file: esc(X.file ?? '') })}</div>`;
      else if (X?.state === 'failed') h += `<div class="err">${T('st.ex.failed', { err: X.error ? T('st.ex.failedWhy', { why: esc(X.error) }) : '' })}</div>`;
      else if (X?.state === 'stopped') h += `<div class="sub2 muted">${T('st.ex.stopped', { date: dayTime(X.ended) })}</div>`;
      if (!can) h += `<div class="sub2 muted">${esc(why ?? '')}</div>`;
      h += `<div class="acts"><button class="primary" id="rcGo" ${can ? '' : `disabled title="${esc(why ?? '')}"`}>${ic('play')}${T(X && X.state !== 'done' ? 'st.rc.again' : 'st.rc.go')}</button>${cmp}${reveal}${log}</div>`;
    }
    if (META.features?.export) h += gpuLine();
    box.innerHTML = `<div class="rc">${h}${speedBlock()}</div>`;
    wireCard(); wireShot();
    $('#rcGo')?.addEventListener('click', () => { const x = quality(); startExportUI(x.send, x.label); });
    $('#rcStop')?.addEventListener('click', stopExportUI);
    $('#rcReveal')?.addEventListener('click', () => revealMenu(X?.state === 'done' && X.file ? 'export' : 'video'));
    exportNums(X);
  }
  function exportNums(X) {
    if (X?.state !== 'running') return;
    const f = X.frames;
    // (a script that says no frames — only « COULISSES PROGRES <pct> »: its own percentage, never a 0 % that does not move;
    // user report 25/10/2026: « j'ai plus de pourcentage qui monte quand j'exporte »)
    setProgress({ done: f?.total ? f.done : 0, total: f?.total ?? null, pct: f?.total ? null : phaseOf(X.etape) > 1 ? 100 : Math.max(0, Math.min(100, X.pct ?? 0)), eta: phaseOf(X.etape) === 1 ? exportEta(X) : '' });
  }
  // « Rendre ce plan » (user request, 09/10/2026): a 3D shot shown in a Short as a clip (its .coulisses « utilise »): its
  // video made again from the current code and put back in the Short, without the agent (lib/shot-render.mjs). The old
  // clip is kept: « Remettre la version d'avant ».
  function shotBlock() {
    const uses = STATUS.shotTargets ?? META.shotTargets ?? []; if (!uses.length) return '';
    const S = STATUS.shot, run = S?.state === 'running';
    return uses.map((u) => {
      const mine = S && S.use === u.i;
      let body = `<div class="sub2">${T('st.shot.what', { title: esc(u.title), file: esc(u.fichier.split('/').pop()) })}</div>`;
      if (!u.target) body += `<div class="err">${T('st.shot.noHost', { file: esc(u.coulisses) })}</div>`;
      else if (mine && run) body += `<div class="rbar"><i style="width:${Math.round(S.pct ?? 0)}%"></i></div>
        <div class="num2"><span>${S.pct != null ? T('st.ex.pct', { pct: Math.round(S.pct) }) : T('st.ex.preparing')}</span><span class="muted">${esc(S.etape ?? '')}</span></div>`;
      else if (mine && S.state === 'done') body += `<div class="ok2">${T('st.shot.done', { date: dayTime(S.ended), title: esc(u.title) })}</div>`;
      else if (mine && S.state === 'undone') body += `<div class="sub2">${T('st.shot.undone', { date: dayTime(S.ended) })}</div>`;
      else if (mine && S.state === 'failed') body += `<div class="err">${T('st.shot.failed', { why: esc(S.error ?? '') })}</div>`;
      else if (mine && S.state === 'stopped') body += `<div class="sub2 muted">${T('st.shot.stopped', { date: dayTime(S.ended) })}</div>`;
      else body += `<div class="sub2 muted">${T('st.shot.how')}</div>`;
      const btns = !u.target ? '' : mine && run
        ? `<button class="soft danger" id="shStop">${ic('x')}${T('st.shot.stop')}</button><button class="soft shLog">${T('st.rc.log')}</button>`
        : `<button class="primary shGo" data-use="${u.i}" ${run ? 'disabled' : ''}>${ic('film')}${T(mine && ['failed', 'stopped'].includes(S.state) ? 'st.shot.again' : 'st.shot.go')}</button>`
          + (u.exists ? `<button class="soft shReveal" data-use="${u.i}" title="${esc(u.target)}">${ic('folder')}${T('st.rc.reveal')}</button>` : '')
          + (u.previous ? `<button class="soft shUndo" data-use="${u.i}">${ic('undo')}${T('st.shot.undo')}</button>` : '')
          + (S ? `<button class="soft shLog">${T('st.rc.log')}</button>` : '');
      return `<div class="shot" data-use="${u.i}"><div class="rh" style="margin-top:12px">${ic('film')}<b>${T('st.shot.title')}</b><span class="muted">${esc(u.title)}</span></div>${body}<div class="acts">${btns}</div></div>`;
    }).join('');
  }
  function wireShot() {
    const uses = STATUS.shotTargets ?? META.shotTargets ?? [];
    for (const b of document.querySelectorAll('#renderCard .shGo')) b.addEventListener('click', async () => {
      const u = uses.find((x) => String(x.i) === b.dataset.use); if (!u) return;
      if (!confirm(T('st.shot.confirm', { title: u.title, file: u.target, comp: META.composition ?? '' }))) return;
      const r = await postJson('/api/shot/render', { use: u.i });
      setSave(r?.ok ? T('st.shot.started') : T('st.ex.cannot', { why: r?.why ?? T('st.noAnswer') }), r?.ok ? 'ok' : 'err');
    });
    $('#shStop')?.addEventListener('click', async () => { if (!confirm(T('st.shot.stopConfirm'))) return; const r = await postJson('/api/shot/stop'); setSave(r?.ok ? T('st.shot.stoppedNow') : T('st.cannotStop', { why: r?.why ?? T('st.noAnswer') }), r?.ok ? 'ok' : 'err'); });
    for (const b of document.querySelectorAll('#renderCard .shUndo')) b.addEventListener('click', async () => {
      if (!confirm(T('st.shot.undoConfirm'))) return;
      const r = await postJson('/api/shot/undo', { use: +b.dataset.use });
      setSave(r?.ok ? T('st.shot.undoneNow') : T('st.cannot', { why: r?.why ?? T('st.noAnswer') }), r?.ok ? 'ok' : 'err');
    });
    for (const b of document.querySelectorAll('#renderCard .shReveal')) b.addEventListener('click', async () => { const r = await postJson('/api/shot/reveal', { use: +b.dataset.use }); if (!r?.ok) setSave(T('menu.reveal.failed', { why: r?.why ?? T('st.noAnswer') }), 'err'); });
    for (const b of document.querySelectorAll('#renderCard .shLog')) b.addEventListener('click', async () => {
      let t = ''; try { t = await (await fetch('/api/shot/log', { cache: 'no-store' })).text(); } catch { /* */ }
      showModal(T('st.shot.logTitle'), T('st.shot.logWhat'), t || T('st.empty'), T('st.shot.logFile'));
    });
  }
  // the speed of the export (user request 14/10/2026: « une molette allant de 0,5 à 2,0, chaque cran de 0,1 »): picture and
  // sound together (lib/export-run.mjs). The wheel of the mouse moves it a notch, a double click puts it back to ×1; the
  // choice is kept for this project (this browser). Turning it changes the card in place, never draws it again.
  const SPEED_MIN = 0.5, SPEED_MAX = 2, speedKey = () => `coulisses.exportSpeed.${META.coulisses ?? META.root ?? META.title ?? ''}`;
  const notch = (v) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(+v * 10) / 10));
  const speedLabel = (s) => `×${(Number.isInteger(s) ? String(s) : s.toFixed(1)).replace('.', T('st.ex.decimal'))}`;
  function exportSpeed() { try { const v = localStorage.getItem(speedKey()); return v === null ? 1 : notch(v); } catch { return 1; } }
  // what the speed does here: the next export (Remotion, HyperFrames) or render (the Theatre) makes its copy too; any
  // video can get one now (« Créer la copie »); the reviewed video stays the ×1 one
  const speedWhat = (v) => {
    if (v === 1) return T('st.ex.speedOne');
    const next = PROJ ? (META.features?.export ? T('st.sp.export', { s: speedLabel(v), n: String(v) }) : '') : T('st.sp.render', { s: speedLabel(v), n: String(v) });
    return [next, T('st.ex.speedWhat'), v < 1 ? T('st.ex.speedSlow') : ''].filter(Boolean).join(' ');
  };
  function speedBlock() {
    const cur = exportSpeed(), ticks = Array.from({ length: 16 }, (_, i) => (SPEED_MIN + i / 10).toFixed(1));
    spKey = '';
    return `<div class="spBlock"><div class="speedLine" title="${esc(T('st.ex.speedTitle'))}"><span class="sub2">${T('st.ex.speed')}</span>
      <span class="dial"><input type="range" id="exSpeed" min="${SPEED_MIN}" max="${SPEED_MAX}" step="0.1" value="${cur}" list="exSpeedTicks" aria-label="${esc(T('st.ex.speed'))}"><i class="ticks"></i><i class="one" title="×1"></i></span>
      <datalist id="exSpeedTicks">${ticks.map((t) => `<option value="${t}"></option>`).join('')}</datalist>
      <b id="exSpeedVal" class="${cur === 1 ? '' : 'on'}">${speedLabel(cur)}</b></div>
      <div class="sub2 muted" id="exSpeedWhat">${speedWhat(cur)}</div><div id="spJob"></div></div>`;
  }
  function setSpeed(v) {
    v = notch(v);
    try { localStorage.setItem(speedKey(), String(v)); } catch { /* private window */ }
    const r = $('#exSpeed'), val = $('#exSpeedVal'), what = $('#exSpeedWhat');
    if (r && +r.value !== v) r.value = String(v);
    if (val) { val.textContent = speedLabel(v); val.classList.toggle('on', v !== 1); }
    if (what) what.textContent = speedWhat(v);
    speedJob();
  }
  // « Créer la copie ×1,3 » of the current video, and the copy being made (STATUS.speed: lib/speed-copy.mjs)
  let spKey = '';
  function speedJob() {
    const box = $('#spJob'); if (!box) return;
    const v = exportSpeed(), J = STATUS.speed, video = STATUS.video ?? META.render, run = J?.state === 'running';
    const key = JSON.stringify([v, J?.state, J?.pct, J?.file, J?.ended, video?.name, video?.size]);
    if (key === spKey) return; spKey = key;
    const js = J ? speedLabel(J.vitesse) : '';
    let h = '';
    if (run) h = `<div class="sub2">${T('st.sp.running', { s: js, name: esc(J.video) })}</div><div class="rbar"><i style="width:${Math.round(J.pct ?? 0)}%"></i></div>
      <div class="num2"><span>${J.pct != null ? T('st.ex.pct', { pct: Math.round(J.pct) }) : T('st.ex.preparing')}</span></div><div class="acts"><button class="soft danger" id="spStop">${ic('x')}${T('st.sp.stop')}</button><button class="soft" id="spLog">${T('st.rc.log')}</button></div>`;
    else {
      if (J?.state === 'done') h += `<div class="ok2">${T('st.sp.done', { s: js, name: esc((J.file ?? '').split(/[\\/]/).pop()) })}</div>`;
      else if (J?.state === 'failed') h += `<div class="err">${T('st.sp.failed', { s: js, why: esc(J.error ?? '') })}</div>`;
      else if (J?.state === 'stopped') h += `<div class="sub2 muted">${T('st.sp.stopped', { s: js })}</div>`;
      const go = v !== 1 && video ? `<button class="soft" id="spGo" title="${esc(T('st.sp.goTitle', { name: video.name, target: video.name.replace(/\.mp4$/i, `-x${v}.mp4`) }))}">${ic('film')}${T('st.sp.go', { s: speedLabel(v) })}</button>` : '';
      const more = J?.state === 'done' ? `<button class="soft" id="spReveal">${ic('folder')}${T('st.rc.reveal')}</button>` : '';
      if (go || more || J) h += `<div class="acts">${go}${more}${J ? `<button class="soft" id="spLog">${T('st.rc.log')}</button>` : ''}</div>`;
    }
    box.innerHTML = h;
    $('#spGo')?.addEventListener('click', async () => {
      const s = exportSpeed(), cur = STATUS.video ?? META.render; if (!cur || s === 1) return;
      if (!confirm(T('st.sp.confirm', { s: speedLabel(s), name: cur.name, target: cur.name.replace(/\.mp4$/i, `-x${s}.mp4`) }))) return;
      const r = await postJson('/api/speed/copy', { vitesse: s });
      setSave(r?.ok ? T('st.sp.started', { s: speedLabel(s) }) : T('st.ex.cannot', { why: r?.why ?? T('st.noAnswer') }), r?.ok ? 'ok' : 'err');
      if (r?.ok) { STATUS.speed = { ...r, pct: 0 }; spKey = ''; speedJob(); }
    });
    $('#spStop')?.addEventListener('click', async () => { const r = await postJson('/api/speed/stop'); setSave(r?.ok ? T('st.sp.stoppedNow') : T('st.cannotStop', { why: r?.why ?? T('st.noAnswer') }), r?.ok ? 'ok' : 'err'); });
    $('#spLog')?.addEventListener('click', async () => { let t = ''; try { t = await (await fetch('/api/speed/log', { cache: 'no-store' })).text(); } catch { /* */ } showModal(T('st.sp.logTitle'), T('st.sp.logWhat'), t || T('st.empty'), ''); });
    $('#spReveal')?.addEventListener('click', () => revealMenu('speed'));
  }
  function wireSpeed() {
    const dial = $('#exSpeed');
    if (dial) {
      dial.addEventListener('input', () => setSpeed(dial.value));
      dial.addEventListener('dblclick', () => setSpeed(1));
      dial.addEventListener('wheel', (e) => { e.preventDefault(); setSpeed(exportSpeed() + (e.deltaY < 0 ? 0.1 : -0.1)); }, { passive: false });
    }
    $('#exSpeedVal')?.addEventListener('dblclick', () => setSpeed(1));
    speedJob();
  }
  // the encoder of the exports (lib/gpu.mjs): the GPU by default, a box to go back to the CPU
  function gpuLine() {
    const g = META.gpu; if (!g) return '';
    if (!g.off && g.mode === 'cpu') return `<div class="sub2 muted gpuLine">${T('st.ex.gpuNone')}</div>`;
    return `<label class="gpuLine" title="${esc(T('st.ex.gpuTitle'))}"><input type="checkbox" id="exGpu" ${g.off ? '' : 'checked'}> ${g.off ? T('st.ex.gpuAsk') : T('st.ex.gpu', { name: esc(g.name ?? 'GPU') })}</label>`;
  }
  async function startExportUI(qualite, label) {
    const vitesse = exportSpeed();
    // (the encoder said too: the box is for every project, unticked once it stays so — user report 22/10/2026, an export on
    // the processor while the card said the GPU: unticked by a click 3 s before)
    const g = META.gpu, enc = !g ? '' : g.off ? TN('st.ex.confirmCpu') : g.mode !== 'cpu' ? TN('st.ex.confirmGpu', { name: g.name ?? 'GPU' }) : '';
    if (!confirm(T('st.ex.confirm', { label: TN('st.rc.goQ', { q: label || '1080p' }), title: META.title, dir: META.exportDir ? T('st.ex.confirmDir', { dir: META.exportDir }) : '' }) + enc + (vitesse !== 1 ? T('st.ex.confirmSpeed', { s: speedLabel(vitesse) }) : ''))) return;
    const r = await postJson('/api/export', { qualite, vitesse });
    setSave(r?.ok ? T('st.ex.started') : T('st.ex.cannot', { why: r?.why ?? T('st.noAnswer') }), r?.ok ? 'ok' : 'err');
  }
  async function stopExportUI() {
    if (!confirm(T('st.ex.stopConfirm'))) return;
    const r = await postJson('/api/export/stop');
    setSave(r?.ok ? T('st.ex.stoppedNow') : T('st.cannotStop', { why: r?.why ?? T('st.noAnswer') }), r?.ok ? 'ok' : 'err');
  }
  async function showExportLog() {
    let t = ''; try { t = await (await fetch('/api/export/log', { cache: 'no-store' })).text(); } catch { /* */ }
    showModal(T('st.ex.logTitle'), T('st.ex.logWhat'), t || T('st.empty'), T('st.ex.logFile'));
  }
  const kindLabel = () => (META.kind === 'run' ? T('st.kind.run', { c: META.channel || 'Run' }) : META.kind === 'remotion' ? `${META.channel || T('st.kind.remotion')}${META.features?.video ? '' : T('st.kind.liveCode')}` : META.kind === 'hyperframes' ? `${META.channel ? META.channel + ' · ' : ''}HyperFrames${META.features?.video ? '' : T('st.kind.liveCode')}` : META.kind === 'aitelier' ? `L'AItelier${META.format ? ' · ' + (META.format === 'short' ? 'Short' : T('st.kind.long')) : ''}` : META.kind === 'video' ? T('st.kind.video') : T('st.kind.folder'));
  const postJson = (url, data) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data ?? {}) }).then((r) => r.json()).catch(() => null);
  async function launchRender() {
    const d = drafts().length;
    const open = (STATUS.lots ?? []).filter((L) => L.kind !== 'render' && (!L.claude || L.claude.status === 'taken')).map((L) => L.lot);
    const msg = [T('st.launch.ask', { ep: META.episode }), '', T('st.launch.what')];
    if (d) msg.push('', T('st.launch.drafts', { n: d }));
    if (open.length) msg.push('', T('st.launch.open', { n: open.length, list: open.join(', ') }));
    const vitesse = exportSpeed(), q = quality();
    msg.push('', TN('st.launch.q', { q: q.label }));
    if (vitesse !== 1) msg.push('', T('st.launch.speed', { s: speedLabel(vitesse) }));
    if (!confirm(msg.join('\n'))) return;
    const r = await postJson('/api/render', { agent: AGENT_PICK, vitesse, qualite: q.send });
    if (!r?.ok) { setSave(T('st.launch.failed', { why: r?.why ?? T('st.launch.noStudio') }), 'err'); return; }
    statusTxt = ''; rcKey = '';
    showDeliveryModal(r.lot, T('st.launch.title', { lot: r.lot }),
      r.line, T('st.launch.progress'), { updates: r.updates, updatesOk: r.updatesOk });
    setTab('lots');
  }
  async function stopRender() {
    if (!confirm(T('st.stop.confirm'))) return;
    const r = await postJson('/api/render/stop');
    setSave(r?.ok ? T('st.stop.asked') : T('st.cannotStop', { why: r?.why ?? T('st.noAnswer') }), r?.ok ? 'ok' : 'err');
  }
  async function showRenderLog() {
    let t = ''; try { t = await (await fetch('/api/render/log', { cache: 'no-store' })).text(); } catch { /* */ }
    showModal(T('st.rlog.title'), T('st.rlog.what'), t || T('st.empty'), T('st.rlog.file'));
  }
  // the video is being replaced (hold): let go of it, then reload once the new one is there
  let wasHeld = false, heldFrame = 0, reloading = false;
  function onHeld() {
    if (!META) return;
    if (!META.render) { if (STATUS.video && !reloading) { reloading = true; setSave(T('st.save.firstExport'), 'ok'); reloadSafely(curFrame()).then((ok) => { if (!ok) reloading = false; }); } return; }   // (not saved: tried again at the next status)
    if (!STATUS.video) return;
    const fresh = STATUS.video.size !== META.render.size || STATUS.video.mtime !== META.render.mtime;
    if (STATUS.held && !wasHeld) {
      wasHeld = true; heldFrame = curFrame(); if (shuttle) stopShuttle(); M.pause();
      if (staging) setStaging(false);
      $('#stage').classList.add('held');
      try { v.removeAttribute('src'); v.load(); } catch { /* */ }
    }
    if (!STATUS.held && fresh && !reloading) {
      reloading = true; setSave(T('st.save.newVideo'), 'ok');
      const f = wasHeld ? heldFrame : curFrame();
      reloadSafely(f).then((ok) => { if (!ok) reloading = false; });   // (not saved: tried again at the next status)
      return;
    }
    if (!STATUS.held && wasHeld && !fresh) {   // the replacement did not happen: back to the same video
      wasHeld = false; $('#stage').classList.remove('held');
      v.addEventListener('loadedmetadata', () => seekFrame(heldFrame), { once: true });
      v.src = META.proxy === 'ready' ? '/video/revue' : '/video/original';
    }
  }

  // ---------- before / after of the corrected notes (wipe) ----------
  let CMP = [], cmpI = 0, cmpX = 50;
  async function openCompare(id) {
    let r = null; try { r = await (await fetch('/api/compare', { cache: 'no-store' })).json(); } catch { /* */ }
    CMP = r?.items ?? [];
    if (!CMP.length) { setSave(T('st.cmp.nothing'), 'err'); return; }
    cmpI = Math.max(0, CMP.findIndex((x) => x.id === id)); cmpX = 50;
    if (shuttle) stopShuttle(); M.pause();
    $('#cmpW').style.aspectRatio = `${CW} / ${CH}`; $('#cmpW').style.width = `min(100%, calc(72vh * ${CW} / ${CH}))`;
    $('#cmp').classList.add('open'); showCmp();
  }
  function showCmp() {
    const it = CMP[cmpI], num = reviewed().findIndex((n) => n.id === it.id) + 1;
    $('#cmpT').textContent = T('st.cmp.head', { num: num || '?', lot: it.lot });
    $('#cmpN').textContent = `${cmpI + 1} / ${CMP.length}`;
    $('#cmpLA').textContent = T('st.cmp.labelBefore', { what: it.beforeSource === 'code' ? T('st.cmp.codePreview') : T(PROJ ? 'st.cmp.exportOf' : 'st.cmp.renderOf', { date: dayTime(it.beforeRender?.mtime) }), f: it.beforeFrame });
    $('#cmpLB').textContent = T('st.cmp.labelAfter', { what: T(PROJ ? 'st.cmp.newExport' : 'st.cmp.newRender'), f: it.frame });
    $('#cmpTx').innerHTML = `<b>${esc(it.text || T('st.cmp.noText'))}</b>${it.reply ? T('st.cmp.agentSays', { reply: esc(it.reply) }) : ''}`;
    const A = $('#cmpA'), Bi = $('#cmpB'), w = $('#cmpWait'); let n = 0;
    w.textContent = T('st.cmp.loading');
    const ok = () => { if (++n >= 2) w.textContent = ''; };
    A.onload = ok; Bi.onload = ok; A.onerror = Bi.onerror = () => { w.textContent = T('st.cmp.unavailable'); };
    A.src = it.before; Bi.src = `/api/frame?f=${it.frame}&source=video&w=1600`;
    $('#cmpPrev').disabled = cmpI === 0; $('#cmpNext').disabled = cmpI === CMP.length - 1;
    setWipe(cmpX);
  }
  function setWipe(x) { cmpX = Math.max(0, Math.min(100, x)); $('#cmpW .after').style.clipPath = `inset(0 0 0 ${cmpX}%)`; $('#cmpW .handle').style.left = `${cmpX}%`; }
  const cmpOpen = () => $('#cmp').classList.contains('open');
  const cmpClose = () => $('#cmp').classList.remove('open');
  const cmpStep = (d) => { const j = cmpI + d; if (j >= 0 && j < CMP.length) { cmpI = j; showCmp(); } };
  {
    const w = $('#cmpW'); let drag = false;
    const at = (e) => { const r = w.getBoundingClientRect(); setWipe(((e.clientX - r.left) / r.width) * 100); };
    w.addEventListener('pointerdown', (e) => { drag = true; w.setPointerCapture(e.pointerId); at(e); });
    w.addEventListener('pointermove', (e) => { if (drag) at(e); });
    w.addEventListener('pointerup', () => { drag = false; }); w.addEventListener('pointercancel', () => { drag = false; });
  }
  $('#cmpPrev').onclick = () => cmpStep(-1); $('#cmpNext').onclick = () => cmpStep(1);
  $('#cmpFlip').onclick = () => setWipe(cmpX > 50 ? 0 : 100);
  $('#cmpX').onclick = cmpClose;
  $('#cmp').addEventListener('click', (e) => { if (e.target.id === 'cmp') cmpClose(); });
  $('#cmpGo').onclick = () => {
    const it = CMP[cmpI]; cmpClose();
    const n = byId(it.id); if (!n) return;
    if (staging) setStaging(false);
    if (mode !== 'video') setMode('video');
    sel = n.id; seekFrame(n.frame); setTab('notes'); renderAll(); showCard(n.id);
  };


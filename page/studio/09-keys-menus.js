// The studio's page (studio.html), part 09: the keyboard (shortcuts.js), the menu bar (menubar.js).
// The parts of page/studio/ are one script: studio-server.mjs joins them in their order inside one function (/studio.js),
// so they share their names as the one inline script did; hence the two-space indent.
  // ---------- keyboard: the keys of shortcuts.js (Aide › Raccourcis clavier: the defaults, or the user's own) ----------
  const SC = window.Shortcuts ?? { is: () => false, show: () => '', open: () => null };
  // a text field remembers how it was when it got the focus, and whether it was typed in since (Ctrl+Z / Ctrl+Y below)
  document.addEventListener('focusin', (e) => { const f = e.target; if (f && /^(TEXTAREA|INPUT)$/.test(f.tagName)) { f.__v0 = f.value; f.__typed = false; } });
  document.addEventListener('input', (e) => { if (e.target) e.target.__typed = true; }, true);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') { e.preventDefault(); return; }   // Alt+wheel zooms: Alt alone must not open the browser's menu
    const on = (id) => SC.is(e, id);
    // the menu bar's shortcuts: F1 = Aide › Raccourcis clavier, Ctrl+O = Fichier › Ouvrir un projet…
    if (on('help')) { e.preventDefault(); SC.open(); return; }
    if (on('open')) { e.preventDefault(); toHub('?menu=open'); return; }
    if (on('newProject')) { e.preventDefault(); toHub('?menu=new'); return; }
    if (cmpOpen()) {   // the before / after viewer has the keyboard
      const k0 = e.key.toLowerCase();
      if (e.key === 'Escape') cmpClose(); else if (e.key === 'ArrowLeft') cmpStep(-1); else if (e.key === 'ArrowRight') cmpStep(1); else if (k0 === 'b' || e.key === ' ') setWipe(cmpX > 50 ? 0 : 100); else return;
      e.preventDefault(); return;
    }
    if (e.key === 'Escape' && menu.classList.contains('open')) { closeMenu(); return; }
    if (hubOpen()) { if (e.key === 'Escape') hubClose(); return; }   // the home screen over the studio has the keyboard
    if (e.key === 'Escape' && $('#lb').style.display === 'flex') { $('#lb').style.display = 'none'; return; }
    if (e.key === 'Escape' && $('#modal').style.display === 'flex') { $('#modal').style.display = 'none'; return; }
    const typing = /^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName) && e.target.type !== 'checkbox' && e.target.type !== 'range';
    // the usual shortcuts: Ctrl+S saves now (never the browser's « save the page »), Ctrl+Entrée sends the queue
    if (on('save')) { e.preventDefault(); flushNow().then((ok) => setSave(ok ? T('st.key.saved', { t: hm5(new Date()) }) : T('st.save.failed'), ok ? 'ok' : 'err')); return; }
    if (on('send') && (!typing || e.target.id === 'qwords')) { e.preventDefault(); if (drafts().length) sendQueue(); else setSave(T('menu.why.noDraft'), ''); return; }
    // Ctrl+Z in a text field (user request, 08/10/2026: « Ctrl+Z revient un step en arrière, Ctrl+Y un step en avant »,
    // for a note made by mistake): the field's own undo while it holds words typed since it got the focus; once it is as
    // it was (a note just made with N, still empty), it is the studio's step back, and the note goes. The « what should
    // change here? » box, as it was, closes. Ctrl+Y: the studio's step forward when nothing was typed in the field.
    if (typing && (on('undo') || on('redo'))) {
      const f = e.target, asIs = f.value === (f.__v0 ?? f.value);
      if (on('undo') && asIs) {
        if (f.id === 'popTx') { e.preventDefault(); closePop(); return; }
        if (HIST.back.length) { e.preventDefault(); f.blur(); undoStep('undo'); return; }
      }
      if (on('redo') && !f.__typed && HIST.fwd.length) { e.preventDefault(); f.blur(); undoStep('redo'); return; }
    }
    if (typing) { if (e.key === 'Escape') e.target.blur(); return; }   // in a field: the browser's own Ctrl+Z, Ctrl+C, Ctrl+V…
    if (on('undo')) { e.preventDefault(); undoStep('undo'); return; }
    if (on('redo')) { e.preventDefault(); undoStep('redo'); return; }
    // staging, focus outside the preview (panel, list…): the same keys as inside it
    if (staging && SP?.stage) {
      if (on('freeCam')) { e.preventDefault(); toggleFreeCam(); return; }   // C: the free camera (a run's 2D: « Cadrer l'image »)
      const MODE = on('modeMove') ? 'translate' : on('modeRotate') ? 'rotate' : on('modeScale') ? 'scale' : null;
      if (MODE) { e.preventDefault(); SP.stage.setMode(MODE); return; }
      if (!e.ctrlKey && !e.metaKey) {
        const NUDGE = { ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0], ArrowUp: [0, 1, 0], ArrowDown: [0, -1, 0], PageUp: [0, 0, -1], PageDown: [0, 0, 1] }[e.key];
        if (NUDGE && stSel && D2()) {   // 2D: pixels of the frame, y downwards (as inside the preview)
          e.preventDefault();
          const n2 = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!n2) return;
          const st2 = e.shiftKey ? 10 : 1, dd = SP.stage.info(stSel.id).delta;
          SP.stage.setDelta(stSel.id, { ...dd, p: [dd.p[0] + n2[0] * st2, dd.p[1] + n2[1] * st2, 0] }); return;
        }
        if (NUDGE && stSel) {
          e.preventDefault();
          const st = e.shiftKey ? 0.25 : e.altKey ? 0.01 : 0.05, dd = SP.stage.info(stSel.id).delta;
          SP.stage.setDelta(stSel.id, { ...dd, p: dd.p.map((x, i) => x + NUDGE[i] * st) }); return;
        }
        if (e.key === 'Escape' && stSel) { SP.stage.select(null); return; }
      }
    }
    if (on('viewReset')) { e.preventDefault(); resetView(); return; }   // Maj+Z: the whole image again (its zoom)
    if (on('play')) { e.preventDefault(); if (shuttle) stopShuttle(); play(); }
    else if (on('frameBack') || on('frameFwd')) {   // one frame; held: the shuttle (×2)
      e.preventDefault();
      if (e.repeat || holdKey) return;
      const dir = on('frameFwd') ? 1 : -1;
      M.pause(); keyStep = true; seekFrame(curFrame() + dir); keyStep = false;   // (its veil waits past the hold: codeStep)
      holdKey = e.key; holdCode = e.code || null; holdT = setTimeout(() => { if (holdKey === e.key) startShuttle(dir); }, HOLD_MS);
    }
    else if (on('editPrev')) { e.preventDefault(); toEdit(-1); }   // ↑: the previous edit point (a cut), as DaVinci
    else if (on('editNext')) { e.preventDefault(); toEdit(1); }    // ↓: the next one
    else if (on('secBack')) { e.preventDefault(); M.pause(); seekFrame(curFrame() - FPS); }
    else if (on('secFwd')) { e.preventDefault(); M.pause(); seekFrame(curFrame() + FPS); }
    else if (on('toStart')) { e.preventDefault(); seekFrame(0); }
    else if (on('toEnd')) { e.preventDefault(); seekFrame(FRAMES - 1); }
    else if (on('toolSelect')) setTool('select');
    else if (on('toolDraw')) setTool('draw');
    else if (on('toolComment')) setTool('comment');
    else if (on('ask')) { e.preventDefault(); if (pickPt) promptAtPick(); else setSave(T('st.key.pointFirst'), ''); }
    else if (on('source')) { if (!META.features?.code || !META.render) return; if (staging) setStaging(false); setMode(mode === 'video' ? 'code' : 'video'); }
    else if (on('staging')) { e.preventDefault(); window.CoulissesScene.open(true); }
    else if (on('gradePage')) { e.preventDefault(); setPage(CG.on ? 'review' : 'grade'); }   // G: the « Étalonnage » page (part 11)
    else if (on('gradeBypass') && CG.on) { e.preventDefault(); cgSetBypass(!CG.bypass); }    // B: the image without its grade
    else if (on('note')) { e.preventDefault(); M.pause(); addNote(curFrame()); }
    else if (on('range')) { e.preventDefault(); markRange(); }
    else if (e.key === 'Escape') { closePop(); rangeStart = null; $('#bRange').classList.remove('on'); loopId = null; renderAll(); }
    else if (on('setIn') && sel) { const n = byId(sel); setFrames(n, curFrame(), n.end); save(); renderAll(); }
    else if (on('setOut') && sel) { const n = byId(sel); setFrames(n, n.frame, curFrame()); save(); renderAll(); }
    else if (on('loop') && sel) { const n = byId(sel); if (n.end !== null) { loopId = loopId === n.id ? null : n.id; if (loopId) { seekFrame(n.frame); M.play(); } renderAll(); } }
    else if (on('deleteNote') && sel) { e.preventDefault(); delNote(sel); setSave(T('st.key.deleted'), 'ok'); }   // no question (README: Ctrl+Z brings it back)
    else if (on('zoomIn')) zoomBy(1 / 1.5);
    else if (on('zoomOut')) zoomBy(1.5);
  });

  // ---------- the menu bar (menubar.js): « Fichier · Édition · Outils · Aide », every item calls what the page already does ----------
  const dlg = (o) => window.MenuBar?.dialog({ buttons: [{ label: T('menu.dlg.close'), primary: true }], ...o });
  // (user report 17/10/2026, from an iPad: « ça lag vachement » — the click said nothing while the heavy page went: now a
  // veil at once, then the home screen; the notes not saved yet are sent first, as on any leaving)
  // « Accueil » (user report 17/10/2026, from an iPad: « ça lag vachement, il faudrait que ce soit quasi instantané »): the
  // home screen over the studio, in a frame of its own loaded beforehand (hubFrame), shown at once; the studio stays
  // where it is behind it. The project open here, chosen there (or « Revenir au studio », Échap): the studio again, at
  // once; another one: the whole window goes to it (a veil first: the studio takes a moment to go)
  function hubFrame(q = '') {
    let f = $('#hubOv');
    if (f && q) { f.remove(); f = null; }   // a menu of the home screen asked from here (« Ouvrir un projet… »): that page
    if (!f) { f = document.createElement('iframe'); f.id = 'hubOv'; f.title = T('common.productName'); f.src = META.hub + q; document.body.appendChild(f); }
    return f;
  }
  function toHub(q = '') {
    if (!META?.hub) return;
    try { SP?.pause(); M.pause(); } catch { /* */ }
    flushNow().catch(() => {});
    const f = hubFrame(q); f.classList.add('on'); f.focus();
    try { f.contentWindow?.postMessage({ coulisses: 'shown' }, '*'); } catch { /* */ }
  }
  const hubOpen = () => !!$('#hubOv')?.classList.contains('on');
  function hubClose() { const f = $('#hubOv'); f?.classList.remove('on'); try { f?.contentWindow?.postMessage({ coulisses: 'hidden' }, '*'); } catch { /* */ } window.focus(); }
  function leave(url) {
    if (!$('#leaving')) { const d = document.createElement('div'); d.id = 'leaving'; d.innerHTML = `<span class="sp"></span>${esc(T('st.leaving') !== 'st.leaving' ? T('st.leaving') : FR ? 'Retour à l’accueil…' : 'Back to the home screen…')}`; document.body.appendChild(d); }
    requestAnimationFrame(() => setTimeout(() => { location.href = url; }, 0));
  }
  window.addEventListener('message', (e) => {
    if (!META?.hub || e.origin !== new URL(META.hub).origin) return;
    const d = e.data ?? {};
    if (d.coulisses === 'close') hubClose();
    else if (d.coulisses === 'open' && typeof d.url === 'string') { const u = new URL(d.url, META.hub); if (u.origin === location.origin) hubClose(); else leave(u.href); }
  });
  // loaded beforehand, once the studio is settled (a few seconds after it opened): the first « Accueil » is instant too
  setTimeout(function pre() { if (!META) return setTimeout(pre, 2000); if (META.hub && !$('#hubOv')) hubFrame(); }, 8000);
  const noHub = () => (META?.hub ? false : T('menu.why.noHub'));
  const editLots = () => (STATUS.lots ?? []).filter((L) => L.kind !== 'render');
  const lastUndo = () => [...editLots()].reverse().find((L) => L.run?.finished && L.run.state !== 'undone');
  const lastRedo = () => [...editLots()].reverse().find((L) => L.run?.state === 'undone');
  const lastLot = () => (STATUS.lots ?? []).at(-1);
  async function revealMenu(what) {
    const r = await postJson('/api/reveal', { what });
    if (!r?.ok) setSave(T('menu.reveal.failed', { why: r?.why ?? T('st.noAnswer') }), 'err'); else if (what === 'online') setSave(T('menu.online.opened'), 'ok');
  }
  async function showDoc(name, title) {
    const r = await fetch('/api/doc?name=' + name, { cache: 'no-store' }).catch(() => null);
    if (!r?.ok) { setSave(T('menu.doc.failed', { name }), 'err'); return; }
    const text = await r.text();
    dlg({ title, text, pre: true, buttons: [{ label: T('menu.dlg.copy'), run: () => { copy(text); return false; } }, { label: T('menu.dlg.close'), primary: true }] });
  }
  async function showServerLog() {
    const t = await (await fetch('/api/log', { cache: 'no-store' })).text().catch(() => '');
    dlg({ title: T('menu.logStudio'), text: t || T('menu.empty'), pre: true });
  }
  async function showAbout() {
    const a = await (await fetch('/api/about', { cache: 'no-store' })).json().catch(() => null) ?? {};
    const row = (k, v) => (v ? `<div class="row"><span class="lbl">${esc(k)}</span><span>${v}</span></div>` : '');
    const d = dlg({ title: T('menu.about'), html: `<p><b>${esc(a.name)}</b> ${esc(a.version ?? '')}</p><p>${esc(T('menu.about.what'))}</p>`
      + row(T('menu.about.version'), esc(a.version)) + row(T('menu.about.installed'), a.installed ? esc(hhmm(a.installed)) : '') + row(T('menu.about.commit'), a.commit ? esc(`${a.commit}${a.branch ? ` (${a.branch})` : ''}`) : '')
      + row(T('menu.about.folder'), `${esc(a.folder ?? '')}${a.place === 'workshop' ? ` · ${esc(T('menu.about.workshop'))}` : ''}`)
      + row(T('menu.about.license'), esc(a.license)) + row(T('menu.about.source'), `<a href="#" id="mbRepo">${esc(String(a.url ?? '').replace(/^https:\/\//, ''))}</a>`) });
    d?.querySelector('#mbRepo')?.addEventListener('click', (e) => { e.preventDefault(); revealMenu('online'); });
  }
  function showPrefs() {
    const btn = (attr, v, label, on) => `<button ${attr}="${v}" class="${on ? 'on' : ''}">${esc(label)}</button>`;
    const env = I18N.source === 'env';
    const d = dlg({ title: T('menu.prefs.title'), html: `<div class="row"><span class="lbl">${esc(T('menu.prefs.lang'))}</span>${(I18N.langs ?? ['fr', 'en']).map((l) => btn('data-l', l, I18N.names?.[l] ?? l, l === LANG)).join('')}</div>
      <p>${esc(env ? T('menu.prefs.envNote') : T('menu.prefs.langNote'))}</p>
      <div class="row"><span class="lbl">${esc(T('menu.prefs.agent'))}</span>${Object.entries({ claude: 'Claude Code', codex: 'Codex (GPT)' }).map(([k, v]) => btn('data-a', k, v, k === AGENT_PICK)).join('')}</div>
      <p>${esc(T('menu.prefs.agentNote'))}</p>` });
    d?.querySelectorAll('[data-l]').forEach((b) => { b.disabled = env; b.onclick = () => setLanguage(b.dataset.l); });
    d?.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => { AGENT_PICK = b.dataset.a; store.set('agent', AGENT_PICK); markPick(); d.querySelectorAll('[data-a]').forEach((x) => x.classList.toggle('on', x === b)); });
  }
  async function checkUpdatesMenu() {
    const d = dlg({ title: T('menu.updates'), text: T('menu.updates.checking'), pre: true });
    const r = await fetch(`/api/updates?fresh&agent=${encodeURIComponent(AGENT_PICK)}`, { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
    const b = d?.querySelector('.body'); if (b) b.textContent = r ? `${r.line}\n\n${r.md ?? ''}`.trim() : T('st.noAnswer');
  }
  async function verifyMenu() {
    const d = dlg({ title: T('menu.verify'), text: T('menu.verify.running'), pre: true });
    const r = await postJson('/api/verify');
    const b = d?.querySelector('.body'); if (b) b.textContent = r ? `${r.file ?? ''}\n\n${r.out ?? r.why ?? ''}`.trim() : T('st.noAnswer');
  }
  const renderBusy = () => { const s = renderView().st; return !['idle', 'failed', 'interrupted', 'cancelled'].includes(s); };
  const sendWhy = () => (sending ? T('menu.why.sending') : !drafts().length ? T('menu.why.noDraft') : $('#qsend').disabled ? T('menu.why.emptyDraft') : false);
  function mountMenus() {
    if (!window.MenuBar) return;
    window.MenuBar.mount($('#menubar'), [
      { id: 'file', label: T('menu.file'), items: [
        { id: 'home', label: T('menu.home'), disabled: noHub, run: () => toHub() },
        // (user request 17/10/2026: from an iPad through a remote desktop, no F5): the page read again, its notes saved first
        { id: 'reload', label: T('menu.reload'), run: () => reloadSafely() },
        { id: 'newProject', label: T('menu.newProject'), key: () => SC.show('newProject'), disabled: noHub, run: () => toHub('?menu=new') },
        { id: 'open', label: T('menu.open'), key: () => SC.show('open'), disabled: noHub, run: () => toHub('?menu=open') },
        { id: 'importFolder', label: T('menu.importFolder'), disabled: noHub, run: () => toHub('?menu=folder') },
        { id: 'importVideo', label: T('menu.importVideo'), disabled: noHub, run: () => toHub('?menu=video') },
        { id: 'scan', label: T('menu.scan'), disabled: noHub, run: () => toHub('?menu=scan') },
        { id: 'exportVideo', label: T('common.exportVideo'), run: () => window.CoulissesOutput.open() },
        '-',
        { id: 'revealFolder', label: T('menu.revealFolder'), run: () => revealMenu('folder') },
        { id: 'revealVideo', label: T('menu.revealVideo'), disabled: () => (META?.videoPath ? false : T('menu.why.noVideo')), run: () => revealMenu('video') },
        { id: 'revealCoulisses', label: T('menu.revealCoulisses'), disabled: () => (META?.coulissesFile ? false : T('menu.why.noCoulisses')), run: () => revealMenu('coulisses') },
        '-',
        { id: 'close', label: T('menu.closeStudio'), disabled: noHub, run: () => toHub() },
      ] },
      { id: 'edit', label: T('menu.edit'), items: [
        { id: 'undo', label: () => (HIST.back.length ? T('menu.undoStep', { what: HIST.back.at(-1).label }) : T('menu.undoAction')), key: () => SC.show('undo'), disabled: () => (HIST.back.length ? false : T('menu.why.noStep')), run: () => undoStep('undo') },
        { id: 'redo', label: () => (HIST.fwd.length ? T('menu.redoStep', { what: HIST.fwd.at(-1).label }) : T('menu.redoAction')), key: () => SC.show('redo'), disabled: () => (HIST.fwd.length ? false : T('menu.why.noStepRedo')), run: () => undoStep('redo') },
        '-',
        { id: 'undoLot', label: () => (lastUndo() ? T('menu.undoLot', { lot: lastUndo().lot }) : T('menu.undo')), disabled: () => (lastUndo() ? false : T('menu.why.noUndo')), run: () => stepLot(lastUndo(), 'undo') },
        { id: 'redoLot', label: () => (lastRedo() ? T('menu.redoLot', { lot: lastRedo().lot }) : T('menu.redo')), disabled: () => (lastRedo() ? false : T('menu.why.noRedo')), run: () => stepLot(lastRedo(), 'redo') },
        '-',
        { id: 'copyLine', label: T('menu.copyLine'), disabled: () => (lastLot() ? false : T('menu.why.noLot')), run: () => copy(lastLot().line) },
        { id: 'copyConnect', label: T('menu.copyConnect'), run: () => copy(META.connectLine) },
        '-',
        { id: 'prefs', label: T('menu.prefs'), run: showPrefs },
      ] },
      { id: 'tools', label: T('menu.tools'), items: [
        { id: 'commands', label: FR ? 'Rechercher dans le studio' : 'Search the studio', key: 'Ctrl+K', run: () => $('#studioCommands').click() },
        { id: 'storyboard', label: 'Storyboard', run: () => window.CoulissesStoryboard.open() },
        { id: 'exportFrame', label: FR ? 'Exporter l’image affichée (JPEG)…' : 'Export current frame (JPEG)…', run: () => window.CoulissesStoryboard.saveFrame() },
        '-',
        { id: 'connect', label: T('menu.connect'), run: openConnect },
        { id: 'send', label: T('menu.send'), key: () => SC.show('send'), disabled: sendWhy, run: sendQueue },
        '-',
        { id: 'staging', label: T('menu.staging'), key: () => SC.show('staging'), run: () => window.CoulissesScene.open(true) },
        { id: 'freeCam', label: () => T(staging && D2() ? 'st.bar.cam2d' : 'st.bar.cam'), key: () => SC.show('freeCam'), disabled: () => (stageWhy() ?? (staging ? false : T('menu.why.notStaging'))), run: toggleFreeCam },
        { id: 'source', label: T('menu.source'), key: () => SC.show('source'), disabled: () => srcWhy() ?? false, run: () => { if (staging) setStaging(false); setMode(mode === 'video' ? 'code' : 'video'); } },
        { id: 'grade', label: () => T(CG.on ? 'menu.gradeOff' : 'menu.grade'), key: () => SC.show('gradePage'), run: () => setPage(CG.on ? 'review' : 'grade') },
        // « Exporter ▸ »: a run's export script (its variants), an episode's full render (asked to the agent), else nothing
        { id: 'export', label: T('menu.export'), disabled: () => (LIVEP() ? (!META.features?.export ? (META.exportWhy ?? T('menu.why.notRemotion')) : STATUS.export?.state === 'running' ? T('menu.why.exportRunning') : false)
          : !PROJ ? (renderBusy() ? T('menu.why.renderBusy') : false) : T('menu.why.noExport')),
          // (the same in every project: « Lancer le rendu en 1080p », « … en 4K », then a project's own variants)
          items: () => qualities().map((x) => ({ id: `render-${x.id}`, label: ['1080p','4K'].includes(x.label) ? TN('st.rc.goQ', { q: x.label }) : x.label, disabled: () => x.why || false, run: () => { setQuality(x.id); goRender(); } })) },
        { id: 'stopExport', label: T('menu.stopExport'), disabled: () => (PROJ ? (STATUS.export?.state === 'running' ? false : T('menu.why.noExportRunning'))
          : (STATUS.render?.state === 'running' && STATUS.render.phase !== 'finish' ? false : T('menu.why.noRenderRunning'))), run: () => (PROJ ? stopExportUI() : stopRender()) },
        { id: 'compare', label: T('menu.compare'), disabled: () => (STATUS.compare?.length ? false : T('menu.why.noCompare')), run: () => openCompare() },
        '-',
        { id: 'updates', label: T('menu.updates'), run: checkUpdatesMenu },
        { id: 'verify', label: T('menu.verify'), disabled: () => (META?.coulissesFile ? false : T('menu.why.noCoulisses')), run: verifyMenu },
        { id: 'log', label: T('menu.log'), items: () => [
          { id: 'logStudio', label: T('menu.logStudio'), run: showServerLog },
          { id: 'logExport', label: T('menu.logExport'), disabled: () => (PROJ && !LIVEP() ? T('menu.why.noExport') : false), run: () => (PROJ ? showExportLog() : showRenderLog()) },
        ] },
      ] },
      { id: 'help', label: T('menu.help'), items: [
        { id: 'shortcuts', label: T('menu.shortcuts'), key: () => SC.show('help'), run: () => SC.open() },
        '-',
        { id: 'agentDoc', label: T('menu.agentDoc'), run: () => showDoc('agent', T('menu.agentDoc')) },
        { id: 'contract', label: T('menu.contract'), run: () => showDoc('contract', T('menu.contract')) },
        { id: 'online', label: T('menu.online'), run: () => revealMenu('online') },
        '-',
        { id: 'about', label: T('menu.about'), run: showAbout },
      ] },
    ]);
  }
  mountMenus();
  // the far-left rail: « Accueil » (the home screen: every episode and project) at the top, « Préférences » at the bottom
  $('#bHome').onclick = () => { const why = noHub(); if (why) return setSave(why, 'err'); toHub(); };
  $('#bPrefs').onclick = showPrefs;
  $('#crumb').onclick = (e) => { e.preventDefault(); toHub(); };
  for (const [b, key] of [[$('#bZoomIn'), 'zoomIn'], [$('#bZoomOut'), 'zoomOut']]) { const k = SC.show(key); if (k) b.title += ` (${k})`; }
  // Same two entry points in every project. Rendering uses the project's existing
  // backend. Export also offers the original file when it is already on disk.
  const goKind = () => (!META ? null : !PROJ ? 'render' : LIVEP() && META.features?.export ? 'export' : null);
  const goBusy = () => (goKind() === 'render' ? (renderBusy() ? T('menu.why.renderBusy') : null) : STATUS.export?.state === 'running' ? T('menu.why.exportRunning') : null);
  function markGo() {
    window.CoulissesOutput?.refresh();
  }
  $('#hdrGo').onclick = () => window.CoulissesOutput?.render();
  $('#hdrExport').onclick = () => window.CoulissesOutput?.open();

  const hashFrame = () => { const m = /f=(\d+)/.exec(location.hash); return m ? +m[1] : null; };


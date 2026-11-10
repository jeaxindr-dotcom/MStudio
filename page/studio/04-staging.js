// The studio's page (studio.html), part 04: « Mise en scène »: the Scène panel, the offsets, the notes they make.
// The parts of page/studio/ are one script: studio-server.mjs joins them in their order inside one function (/studio.js),
// so they share their names as the one inline script did; hence the two-space indent.
  // ---------- « Mise en scène » (player/stage.ts does the 3D; this is the panel and the notes) ----------
  // An offset is a PROPOSAL: shown in the live preview on top of the engine, then sent to Claude as an exact edit
  // (object, Δ position / rotation / scale, scope), who writes it in the code. Draft notes keep their offset visible.
  let staging = false, stSel = null, stMode = 'translate', freeCamOn = false, stageSynced = new Set(), stScope = 'scene', stFrom = 0, stTo = 0;
  const deg = (r) => r * 180 / Math.PI, rad = (d) => d * Math.PI / 180;
  const sgn = (v, n = 2) => (v >= 0 ? '+' : '−') + dec(Math.abs(v).toFixed(n));
  const sceneAt = (f) => {   // the set on stage at frame f (from the plan of the MP4, else the code's); a run: its band (chapter, beat)
    if (PROJ) {
      const t = (f + 0.5) / FPS, band = clipsAt(t).find((x) => x.tr.type === 'band');
      return band ? { name: band.c.label, from: frameOfT(band.c.t0), to: Math.min(FRAMES - 1, frameOfT(band.c.t1) - 1) } : { name: T('st.scope.all'), from: 0, to: FRAMES - 1 };
    }
    const sets = SNAP?.sets ?? LIVE?.sets ?? [], t = (f + 0.5) / FPS;
    const w = sets.filter((x) => x.inT <= t && t < (x.outT ?? 1e9) + (x.outDur ?? 0)).sort((a, b) => b.inT - a.inT)[0];
    return w ? { name: w.name, from: frameOfT(w.inT), to: Math.min(FRAMES - 1, frameOfT((w.outT ?? DUR) + (w.outT !== null && w.outT !== undefined ? w.outDur ?? 0 : 0)) - 1) } : { name: T('st.scope.all'), from: 0, to: FRAMES - 1 };
  };
  function scopeOf(kind = stScope) {
    const f = curFrame(), sc = sceneAt(f);
    if (kind === 'all') return { kind, from: 0, to: FRAMES - 1, label: T('st.scope.all') };
    if (kind === 'here') return { kind, from: f, to: sc.to, label: T('st.scope.here', { name: sc.name }) };
    if (kind === 'range') return { kind, from: Math.min(stFrom, stTo), to: Math.max(stFrom, stTo), label: T('st.scope.range') };
    return { kind: 'scene', from: sc.from, to: sc.to, label: T('st.scope.scene', { name: sc.name }) };
  }
  const D2 = () => SP?.stage?.kind === '2d';   // a run's 2D staging (player/stage2d.ts), else the Theatre's 3D one
  const K2 = { image: 'image', dessin: 'drawing', 'vidéo': 'video', canvas: 'canvas', texte: 'text', 'élément': 'element', cadre: 'frame' };
  function stageName(id, ev = null) {   // { name, kind } of a staged object, for the panel, the badge and the note
    const i0 = ev?.cutout ? ev : (String(id).startsWith('@media:') ? SP?.stage?.info?.(id) : null);
    if (i0?.cutout) return { name: i0.cutout.name, kind: T(i0.dim === '2d' ? 'st.kind.cutout2d' : 'st.kind.cutout') };
    if (D2() || ev?.dim === '2d') {
      if (id === '@camera') return { name: T('st.s2.camera'), kind: T('st.k2.frame') };
      const i = ev ?? SP.stage.info(id);
      return { name: i.name ?? id, kind: T('st.k2.' + (K2[i.kind] ?? 'element')) };
    }
    return humanTarget({ names: [id] });
  }
  async function setStaging(on) {
    if (on === staging) return;
    if (on) {
      if (window.__cgReady && CG.on) setPage('review');   // the staging is on the review's page (the grading's is part 11)
      if (mode !== 'code') await setMode('code');
      if (!SP) { setSave(T('st.code.unavailable'), 'err'); return; }
      M.pause();
      if (!SP.stage) { setSave(T('st.stage.notReady'), 'err'); return; }
      // the 3D scene mounts once the episode's textures are loaded (a few seconds after the preview itself)
      let ready = await SP.stage.enable(true).catch(() => false);
      for (let i = 0; !ready && i < 160; i++) { if (i === 0) setSave(T('st.stage.loading'), ''); await new Promise((r) => setTimeout(r, 250)); ready = await SP.stage.enable(true).catch(() => false); }
      if (!ready) { setSave(T('st.stage.notReady'), 'err'); return; }
      setSave(T('st.stage.ready'), 'ok');
      stUnsub?.(); stUnsub = SP.stage.on(onStageEvent); SP.stage.setMode(stMode);
      try { codeEl.contentWindow.focus(); } catch { /* */ }
    } else {
      Promise.resolve(SP?.stage?.enable(false)).catch(() => {}); freeCamOn = false; stSel = null;
      // the keyboard back to the studio (it was the preview's while staging): N, Espace, the arrows work again at once
      try { codeEl.blur(); window.focus(); } catch { /* */ }
    }
    staging = on;
    media.classList.toggle('staging', on); $('#stage').classList.toggle('staging', on); $('#bStage').classList.toggle('on', on); $('#viewer').classList.toggle('staging', on);
    if (on) setTab('scene');
    renderScene();
  }
  let stUnsub = null;
  function onStageEvent(ev) {
    ev = plain(ev);   // (kept as the chosen object, in the notes: this page's own copy)
    const quiet = !!ev.quiet; delete ev.quiet;   // an undo or a redo putting its offset back (page/studio/00-remote.js)
    if (ev.type === 'change' && ev.id !== stSel?.id) return;   // an offset of the queue being re-applied
    if (ev.type === 'select' && !stPrev.has(ev.id)) stPrev.set(ev.id, { delta: JSON.parse(JSON.stringify(ev.delta)), from: ev.from, to: ev.to });
    if (ev.type === 'change' && !quiet) rememberStage(ev);
    if (ev.type === 'select' || ev.type === 'change') { stSel = ev; const t = stageName(ev.id, ev); $('#stageBadgeK').textContent = `${t.name} · ${t.kind}`; }
    if (ev.type === 'deselect') { stSel = null; $('#stageBadgeK').textContent = T('st.stage.clickObj'); }
    if (ev.type === 'mode') stMode = ev.mode;
    renderScene();
  }
  // the offsets of the pending edits (draft notes) stay visible in the preview; sent or deleted ones are dropped
  const cutLaying = new Set();
  function syncStage() {
    if (!SP?.stage) return;
    const want = new Map(drafts().filter((n) => n.stage).map((n) => [n.stage.id, n.stage]));
    for (const id of stageSynced) if (!want.has(id) && id !== stSel?.id) SP.stage.reset(id);
    for (const [id, st] of want) {   // only what changed (setDelta re-applies from the base)
      if (st.cutout && !SP.stage.has?.(id)) {   // an image dropped from « Médias », not in this preview yet
        if (!cutLaying.has(id) && SP.stage.addCutout) {
          cutLaying.add(id);
          SP.stage.addCutout({ ...cutSpec({ id, cutout: st.cutout }) }).then(() => { cutLaying.delete(id); SP.stage.setDelta(id, st.delta, st.scope.from, st.scope.to); });
        }
        continue;
      }
      const cur = SP.stage.info(id);
      if (JSON.stringify([cur.delta, cur.from, cur.to]) !== JSON.stringify([st.delta, st.scope.from, st.scope.to])) SP.stage.setDelta(id, st.delta, st.scope.from, st.scope.to);
    }
    stageSynced = new Set(want.keys());
  }
  function readFields() {
    const v = (k) => +($('#sc-' + k)?.value || 0);
    return { p: [v('x'), v('y'), v('z')], r: [rad(v('rx')), rad(v('ry')), rad(v('rz'))], s: (v('s') || 100) / 100 };
  }
  const deltaWords = (d) => {
    const parts = [];
    const p = d.p.map((x, i) => (Math.abs(x) > 1e-4 ? `${'xyz'[i]} ${sgn(x)}` : '')).filter(Boolean); if (p.length) parts.push(T('st.delta.move', { list: p.join(', ') }));
    const r = d.r.map((x, i) => (Math.abs(x) > 1e-5 ? `${'xyz'[i]} ${sgn(deg(x), 1)}°` : '')).filter(Boolean); if (r.length) parts.push(T('st.delta.turn', { list: r.join(', ') }));
    if (Math.abs(d.s - 1) > 1e-4) parts.push(T('st.delta.scale', { s: dec(d.s.toFixed(2)) }));
    return parts.join(FR ? ' ; ' : '; ') || T('st.delta.none');
  };
  const deltaWords2d = (d, cam = false) => {
    const parts = [];
    const p = [d.p[0], d.p[1]].map((x, i) => (Math.abs(x) >= 0.5 ? `${'xy'[i]} ${sgn(x, 0)} px` : '')).filter(Boolean); if (p.length) parts.push(T(cam ? 'st.s2.wPan' : 'st.delta.move', { list: p.join(', ') }));
    if (Math.abs(d.r[2]) > 1e-4) parts.push(T('st.delta.turn', { list: `${sgn(deg(d.r[2]), 1)}°` }));
    if (Math.abs(d.s - 1) > 1e-4) parts.push(T(cam ? 'st.s2.wZoom' : 'st.delta.scale', { s: dec(d.s.toFixed(2)) }));
    return parts.join(FR ? ' ; ' : '; ') || T('st.delta.none');
  };
  // the panel (user request, 09/10/2026: « améliorer comment les choses sont présentées »): the gestures as rows
  // « gesture → what it does », the steps numbered, the camera in a card of its own; « Quitter » in the panel's bar
  const howRows = (rows) => `<div class="how">${rows.map(([g, t]) => `<span class="g">${T(g)}</span><span>${T(t)}</span>`).join('')}</div>`;
  const stepsHtml = (keys) => `<ol class="steps">${keys.map((k) => `<li><span>${T(k, { key: esc(SC.show('freeCam')) })}</span></li>`).join('')}</ol>`;
  function markSceneBar() {
    const ss = $('#sceneState'); if (!ss || ss.dataset.on === String(staging)) return;
    ss.dataset.on = String(staging);
    ss.innerHTML = staging ? `<span class="on">${T('st.scene.on')}</span><button class="soft" id="sc-off">${T('st.scene.exit')}</button>` : esc(T('st.scene.off'));
    $('#sc-off')?.addEventListener('click', () => setStaging(false));
  }
  // the tools under the image while staging (user request, 09/10/2026: « le mode caméra libre moins perdu dans les
  // menus »): the handles' mode, the free camera (a run's 2D: « Cadrer l'image »), back to the shot's camera
  function markStageBar() {
    const two = D2(), cam = two ? stSel?.id === '@camera' : freeCamOn, k = SC.show('freeCam');
    const tips = { translate: two && cam ? 'st.s2.pan' : 'st.scene.move', rotate: 'st.scene.rotate', scale: two && cam ? 'st.s2.zoom' : 'st.scene.size' };
    document.querySelectorAll('#ctlbar [data-sm]').forEach((b) => { b.classList.toggle('on', b.dataset.sm === stMode); b.querySelector('.tipr').innerHTML = T(tips[b.dataset.sm]); });
    const c = $('#stCam');
    c.classList.toggle('on', staging && cam);
    c.querySelector('.t').textContent = T(two ? 'st.bar.cam2d' : 'st.bar.cam');
    c.querySelector('.tipr').innerHTML = T(two ? 'st.bar.cam2dTip' : cam ? 'st.bar.camOffTip' : 'st.bar.camTip') + (k ? `<kbd>${esc(k)}</kbd>` : '');
    $('#stCam0 .tipr').textContent = T(two ? 'st.s2.camResetTitle' : 'st.bar.cam0Tip');
    $('#stage').classList.toggle('freecam', staging && !two && freeCamOn);
  }
  async function toggleFreeCam() {
    if (!staging || !SP?.stage) return;
    if (D2()) await SP.stage.freeCamera(stSel?.id !== '@camera');
    else freeCamOn = !!(await SP.stage.freeCamera(!freeCamOn));
    renderScene();
  }
  async function resetCam() {
    if (!staging || !SP?.stage) return;
    await SP.stage.resetCamera?.();
    if (D2()) stSel = SP.stage.selected ? stSel : null;
    setSave(T('st.scene.camResetDone'), 'ok'); renderScene(); if (D2()) syncStage();
  }
  document.querySelectorAll('#ctlbar [data-sm]').forEach((b) => b.onclick = () => { if (!staging || !SP?.stage) return; stMode = b.dataset.sm; SP.stage.setMode(stMode); renderScene(); });
  $('#stCam').onclick = toggleFreeCam;
  $('#stCam0').onclick = resetCam;
  function renderScene() {
    markSceneBar(); if (staging) markStageBar(); else $('#stage').classList.remove('freecam');
    const box = $('#scene'); if (!box) return;
    const a = document.activeElement; if (a && box.contains(a) && /^(INPUT|SELECT)$/.test(a.tagName) && !renderScene.force) return;   // never under the user's typing
    if (window.CoulissesScene?.render(box)) return;
    if (stageWhy()) { box.innerHTML = `<div class="box"><div class="ttl">${T('st.scene.introTitle')}</div><p class="muted">${esc(stageWhy())}</p></div>`; return; }
    const two = staging ? D2() : PROJ && !SP?.stage?.scene3d;   // a run's HTML preview: 2D; an episode, a 3D shot: the Theatre's 3D
    if (!staging) {
      box.innerHTML = `<div class="box"><div class="ttl">${T('st.scene.introTitle')}</div>${stepsHtml(['st.scene.step1', two ? 'st.scene.step2run' : 'st.scene.step2', 'st.scene.step3'])}
        <div class="row"><button class="primary" id="sc-on">${ic('move')}${T('st.scene.enable')}</button></div></div>` + listHtml();
      $('#sc-on').onclick = () => window.CoulissesScene.open(true); bindList(); return;
    }
    if (D2()) return renderScene2d(box);
    const sel = stSel, t = sel ? stageName(sel.id, sel) : null, d = sel?.delta ?? { p: [0, 0, 0], r: [0, 0, 0], s: 1 }, sc = scopeOf();
    const num = (k, val, step) => `<input type="number" id="sc-${k}" step="${step}" value="${val}">`;
    box.innerHTML = `<div class="box">
      ${sel ? `<div class="ttl">${esc(t.name)}<span class="k">${esc(t.kind)}</span></div>${sel.cutout ? `<p class="muted" style="margin:2px 0 8px">${T('st.scene.cutHint')}</p>` : ''}
        <div class="modes"><button data-m="translate" class="${stMode === 'translate' ? 'on' : ''}">${T('st.scene.move')}</button><button data-m="rotate" class="${stMode === 'rotate' ? 'on' : ''}">${T('st.scene.rotate')}</button><button data-m="scale" class="${stMode === 'scale' ? 'on' : ''}">${T('st.scene.size')}</button></div>
        <div class="grid3"><span></span><span class="axis">${T('st.scene.axisX')}</span><span class="axis">${T('st.scene.axisY')}</span><span class="axis">${T('st.scene.axisZ')}</span>
          <span class="lbl">${T('st.scene.offset')}</span>${num('x', d.p[0].toFixed(3), 0.05)}${num('y', d.p[1].toFixed(3), 0.05)}${num('z', d.p[2].toFixed(3), 0.05)}
          <span class="lbl">${T('st.scene.rotation')}</span>${num('rx', deg(d.r[0]).toFixed(1), 1)}${num('ry', deg(d.r[1]).toFixed(1), 1)}${num('rz', deg(d.r[2]).toFixed(1), 1)}
          <span class="lbl">${T('st.scene.sizePct')}</span>${num('s', (d.s * 100).toFixed(1), 1)}<span></span><span></span></div>
        <p class="note2">${T(PROJ ? 'st.scene.unitsRun' : 'st.scene.units')}</p>
        <div class="grid3" style="grid-template-columns:74px 1fr;margin-top:12px"><span class="lbl">${T('st.scene.scope')}</span><select id="sc-scope">
          <option value="scene" ${stScope === 'scene' ? 'selected' : ''}>${T('st.scene.thisScene', { name: esc(sceneAt(curFrame()).name) })}</option>
          <option value="here" ${stScope === 'here' ? 'selected' : ''}>${T('st.scene.fromHere')}</option>
          <option value="all" ${stScope === 'all' ? 'selected' : ''}>${T('st.scene.all')}</option>
          <option value="range" ${stScope === 'range' ? 'selected' : ''}>${T('st.scene.range')}</option></select></div>
        <div class="range ${stScope === 'range' ? 'on' : ''}">${T('st.scene.frames')} <input type="number" id="sc-from" value="${stFrom}"> → <input type="number" id="sc-to" value="${stTo}"><button class="soft" id="sc-here">${T('st.scene.current')}</button></div>
        <div class="row"><button class="soft danger" id="sc-reset">${ic(sel.cutout ? 'trash' : 'undo')}${T(sel.cutout ? 'st.scene.cutRemove' : 'st.scene.reset')}</button><span class="grow"></span><button class="primary" id="sc-add">${ic('plus')}${T('st.scene.add')}</button></div>`
      : `<div class="ttl">${T('st.scene.pickTitle')}</div>${howRows([['st.how.click', 'st.how.clickT'], ['st.how.drag', 'st.how.dragT'], ['st.how.shift', 'st.how.shiftT'], ['st.how.handles', 'st.how.handlesT'],
        ...(freeCamOn ? [['st.bar.cam', 'st.how.freeT']] : []), ['st.how.esc', 'st.how.escT']])}`}
    </div>
    <h3 class="sh">${ic('camera')}${T('st.scene.camTitle')}</h3>
    <div class="box">
      <div class="camst"><span class="dot ${freeCamOn ? 'free' : ''}"></span><span>${T(freeCamOn ? 'st.scene.camFree' : 'st.scene.camShot')}</span></div>
      <div class="row"><button class="soft ${freeCamOn ? 'on' : ''}" id="sc-cam">${ic('camera')}${freeCamOn ? T('st.scene.camOn') : T('st.scene.cam')}</button>
        <button class="soft" id="sc-cam0" title="${esc(T('st.scene.camResetTitle'))}">${ic('undo')}${T('st.scene.camReset')}</button></div>
      ${freeCamOn ? howRows([['st.how.drag', 'st.cam.dragT'], ['st.cam.right', 'st.cam.rightT'], ['st.cam.wheel', 'st.cam.wheelT']]) + `<p class="note2">${T('st.scene.camNote')}</p>`
        : `<p class="note2">${T('st.scene.camWhy', { key: esc(SC.show('freeCam')) })}</p>`}
    </div>` + listHtml();
    box.querySelectorAll('.modes button').forEach((b) => b.onclick = () => { stMode = b.dataset.m; SP.stage.setMode(stMode); renderScene(); });
    for (const k of ['x', 'y', 'z', 'rx', 'ry', 'rz', 's']) $('#sc-' + k)?.addEventListener('change', () => { const sc2 = scopeOf(); SP.stage.setDelta(stSel.id, readFields(), sc2.from, sc2.to); });
    $('#sc-scope')?.addEventListener('change', (e) => { stScope = e.target.value; if (stScope === 'range' && !stTo) { stFrom = curFrame(); stTo = Math.min(FRAMES - 1, curFrame() + 3 * FPS); } const sc2 = scopeOf(); if (stSel) SP.stage.setDelta(stSel.id, stSel.delta, sc2.from, sc2.to); renderScene(); });
    for (const k of ['from', 'to']) $('#sc-' + k)?.addEventListener('change', (e) => { if (k === 'from') stFrom = +e.target.value; else stTo = +e.target.value; const sc2 = scopeOf(); if (stSel) SP.stage.setDelta(stSel.id, stSel.delta, sc2.from, sc2.to); });
    $('#sc-here')?.addEventListener('click', () => { stTo = curFrame(); if (!stFrom) stFrom = curFrame(); renderScene(); });
    $('#sc-reset')?.addEventListener('click', () => { const id = stSel.id; SP.stage.reset(id); stSel = null; renderScene(); syncStage(); });
    $('#sc-add')?.addEventListener('click', addStageNote);
    $('#sc-cam').onclick = toggleFreeCam;
    $('#sc-cam0').onclick = resetCam;
    bindList();
  }
  // the 2D panel (a run): x / y in pixels of the frame, one turn, the size; « Caméra » = the whole frame
  function renderScene2d(box) {
    const sel = stSel, t = sel ? stageName(sel.id, sel) : null, d = sel?.delta ?? { p: [0, 0, 0], r: [0, 0, 0], s: 1 }, cam = sel?.id === '@camera';
    const num = (k, val, step) => `<input type="number" id="sc-${k}" step="${step}" value="${val}">`;
    box.innerHTML = `<div class="box">
      ${sel ? `<div class="ttl">${esc(t.name)}<span class="k">${esc(t.kind)}</span></div>${sel.cutout ? `<p class="muted" style="margin:2px 0 8px">${T('st.scene.cutHint2d')}</p>` : ''}
        <div class="modes"><button data-m="translate" class="${stMode === 'translate' ? 'on' : ''}">${T(cam ? 'st.s2.pan' : 'st.scene.move')}</button><button data-m="rotate" class="${stMode === 'rotate' ? 'on' : ''}">${T('st.scene.rotate')}</button><button data-m="scale" class="${stMode === 'scale' ? 'on' : ''}">${T(cam ? 'st.s2.zoom' : 'st.scene.size')}</button></div>
        <div class="grid3"><span></span><span class="axis">${T('st.s2.axisX')}</span><span class="axis">${T('st.s2.axisY')}</span><span class="axis">${T('st.s2.turn')}</span>
          <span class="lbl">${T('st.scene.offset')}</span>${num('x', d.p[0].toFixed(0), 1)}${num('y', d.p[1].toFixed(0), 1)}${num('rz', deg(d.r[2]).toFixed(1), 1)}
          <span class="lbl">${T(cam ? 'st.s2.zoomPct' : 'st.scene.sizePct')}</span>${num('s', (d.s * 100).toFixed(1), 1)}<span></span><span></span></div>
        <p class="note2">${T(cam ? 'st.s2.camUnits' : 'st.s2.units', { w: CW, h: CH })}</p>
        <div class="grid3" style="grid-template-columns:74px 1fr;margin-top:12px"><span class="lbl">${T('st.scene.scope')}</span><select id="sc-scope">
          <option value="scene" ${stScope === 'scene' ? 'selected' : ''}>${T('st.scene.thisScene', { name: esc(sceneAt(curFrame()).name) })}</option>
          <option value="here" ${stScope === 'here' ? 'selected' : ''}>${T('st.scene.fromHere')}</option>
          <option value="all" ${stScope === 'all' ? 'selected' : ''}>${T('st.scene.all')}</option>
          <option value="range" ${stScope === 'range' ? 'selected' : ''}>${T('st.scene.range')}</option></select></div>
        <div class="range ${stScope === 'range' ? 'on' : ''}">${T('st.scene.frames')} <input type="number" id="sc-from" value="${stFrom}"> → <input type="number" id="sc-to" value="${stTo}"><button class="soft" id="sc-here">${T('st.scene.current')}</button></div>
        <div class="row"><button class="soft danger" id="sc-reset">${ic(sel.cutout ? 'trash' : 'undo')}${T(sel.cutout ? 'st.scene.cutRemove' : 'st.scene.reset')}</button>${cam || sel.cutout ? '' : `<button class="soft" id="sc-parent" title="${esc(T('st.s2.parentTitle'))}">${T('st.s2.parent')}</button>`}<span class="grow"></span><button class="primary" id="sc-add">${ic('plus')}${T('st.scene.add')}</button></div>`
      : `<div class="ttl">${T('st.scene.pickTitle')}</div>${howRows([['st.how.click', 'st.s2.clickT'], ['st.how.drag', 'st.s2.dragT'], ['st.s2.wheel', 'st.s2.wheelT'], ['st.s2.shiftWheel', 'st.s2.shiftWheelT'], ['st.how.esc', 'st.how.escT']])}`}
    </div>
    <h3 class="sh">${ic('camera')}${T('st.s2.camTitle')}</h3>
    <div class="box">
      <div class="camst"><span class="dot ${cam ? 'free' : ''}"></span><span>${T(cam ? 'st.s2.camChosen' : 'st.s2.camCode')}</span></div>
      <div class="row"><button class="soft ${cam ? 'on' : ''}" id="sc-cam">${ic('camera')}${T(cam ? 'st.s2.camOn' : 'st.s2.cam')}</button><button class="soft" id="sc-cam0" title="${esc(T('st.s2.camResetTitle'))}">${ic('undo')}${T('st.scene.camReset')}</button></div>
    </div>` + listHtml();
    const fields = () => { const v = (k) => +($('#sc-' + k)?.value || 0); return { p: [v('x'), v('y'), 0], r: [0, 0, rad(v('rz'))], s: (v('s') || 100) / 100 }; };
    box.querySelectorAll('.modes button').forEach((b) => b.onclick = () => { stMode = b.dataset.m; SP.stage.setMode(stMode); renderScene(); });
    for (const k of ['x', 'y', 'rz', 's']) $('#sc-' + k)?.addEventListener('change', () => { const sc2 = scopeOf(); SP.stage.setDelta(stSel.id, fields(), sc2.from, sc2.to); });
    $('#sc-scope')?.addEventListener('change', (e) => { stScope = e.target.value; if (stScope === 'range' && !stTo) { stFrom = curFrame(); stTo = Math.min(FRAMES - 1, curFrame() + 3 * FPS); } const sc2 = scopeOf(); if (stSel) SP.stage.setDelta(stSel.id, stSel.delta, sc2.from, sc2.to); renderScene(); });
    for (const k of ['from', 'to']) $('#sc-' + k)?.addEventListener('change', (e) => { if (k === 'from') stFrom = +e.target.value; else stTo = +e.target.value; const sc2 = scopeOf(); if (stSel) SP.stage.setDelta(stSel.id, stSel.delta, sc2.from, sc2.to); });
    $('#sc-here')?.addEventListener('click', () => { stTo = curFrame(); if (!stFrom) stFrom = curFrame(); renderScene(); });
    $('#sc-reset')?.addEventListener('click', () => { const id = stSel.id; SP.stage.reset(id); stSel = null; renderScene(); syncStage(); });
    $('#sc-add')?.addEventListener('click', addStageNote);
    $('#sc-cam').onclick = toggleFreeCam;
    $('#sc-cam0').onclick = resetCam;
    $('#sc-parent')?.addEventListener('click', async () => { if (!(await SP.stage.selectParent())) setSave(T('st.s2.noParent'), 'err'); });
    bindList();
  }
  // the objects moved and not yet in the queue, and the offsets waiting in the queue
  function listHtml() {
    const live = SP?.stage ? SP.stage.list() : [], queued = drafts().filter((n) => n.stage);
    if (!live.length && !queued.length) return '';
    const rows = [
      ...queued.map((n) => `<div class="item" data-note="${n.id}">${ic('send')}<span>${esc(n.stage.name ?? humanTarget({ names: [n.stage.id] }).name)}</span><span class="d">${T('st.scene.queued')}</span></div>`),
      ...live.filter((x) => !queued.some((n) => n.stage.id === x.id)).map((x) => `<div class="item" data-id="${esc(x.id)}">${ic('move')}<span>${esc(stageName(x.id, x).name)}</span><span class="d">${esc(x.cutout ? T('st.scene.cutNew') : x.dim === '2d' ? deltaWords2d(x.delta, x.id === '@camera') : deltaWords(x.delta))}</span></div>`),
    ];
    return `<h3 style="margin:14px 6px 4px;font:600 11px var(--font-d);text-transform:uppercase;letter-spacing:.1em;color:var(--s9)">${T('st.scene.offsets')}</h3>${rows.join('')}`;
  }
  function bindList() {
    document.querySelectorAll('#scene .item[data-id]').forEach((el) => el.onclick = () => { if (staging) SP.stage.select(el.dataset.id); });
    document.querySelectorAll('#scene .item[data-note]').forEach((el) => el.onclick = () => showCard(el.dataset.note));
  }
  async function addStageNote() {
    if (!stSel) return;
    const two = D2(), id = stSel.id, d = two ? stSel.delta : readFields(), sc = scopeOf(), t = stageName(id, two ? stSel : null), f = curFrame();
    SP.stage.setDelta(id, d, sc.from, sc.to);
    const freeWas = freeCamOn;
    let shot = '';
    if (two) {   // the « after » image of a run: the server photographs the preview with the offset (lib/stage-shot.mjs)
      setSave(T('st.s2.shooting'));
      try {
        const r = await fetch('/api/stage-shot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frame: f, w: CW, h: CH, edits: (await SP.stage.edits()).filter((e) => e.id === id || drafts().some((n) => n.stage?.id === e.id)) }) });
        if (r.ok) shot = URL.createObjectURL(await r.blob());
      } catch { /* the edit stays without its image */ }
    } else shot = await SP.stage.snapshot();   // the shot's camera, with the offset, no gizmo
    const pin = await SP.stage.screenPos(id), info = (await SP.stage.infoNow?.(id)) ?? SP.stage.info(id), cut = info.cutout ?? null;   // (asked to the preview: its own process)
    const extra = {
      text: cut ? T(two ? 'st.stage.noteCut2d' : 'st.stage.noteCut', { name: t.name, scope: sc.label, from: sc.from, to: sc.to })
        : T(two ? 'st.s2.note' : 'st.stage.note', { name: t.name, kind: t.kind, delta: two ? deltaWords2d(d, id === '@camera') : deltaWords(d), scope: sc.label, from: sc.from, to: sc.to }),
      stage: { id, name: t.name, kind: t.kind, delta: d, base: info.base, scope: sc, frame: f, ...(two ? { dim: '2d', size: [CW, CH] } : {}), ...(cut ? { cutout: cut } : {}) },
      ...(cut ? { media: cutMedia.get(id) ?? null } : { target: { frame: f, hits: [{ names: [id], textures: [], type: info.kind }] } }),
      ...(pin && pin[0] >= 0 && pin[0] < CW && pin[1] >= 0 && pin[1] < CH ? { mark: { kind: 'pin', points: [pin] } } : {}),
    };
    const n = addNote(f, null, false, extra);
    if (!n) return;
    if (shot) {
      if (shot.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(shot), 60000);   // (read just below; let go after)
      try { const blob = await (await fetch(shot)).blob(); const file = await upload(new File([blob], 'apres.jpg', { type: 'image/jpeg' }), n.id); (n.images ??= []).push({ file, at: now(), label: T('st.stage.afterLabel') }); save(); }
      catch { /* the edit stays without its image */ }
    }
    stageSynced.add(id); SP.stage.select(null); stSel = null;
    if (freeWas && !two) { freeCamOn = !!(await SP.stage.freeCamera(true)); }
    setSave(T('st.stage.added'), 'ok'); setTab('scene'); renderAll(); renderScene();
  }
  $('#bStage').onclick = () => window.CoulissesScene.open(true);


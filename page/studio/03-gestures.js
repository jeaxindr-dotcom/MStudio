// The studio's page (studio.html), part 03: the overlay on the image (pins, drawings, the hover), the « what should change here? » box.
// The parts of page/studio/ are one script: studio-server.mjs joins them in their order inside one function (/studio.js),
// so they share their names as the one inline script did; hence the two-space indent.
  // ---------- overlay on the image ----------
  let tool = 'select', pickPt = null, drawing = null, stroke = null, popFor = null;
  const ovRect = () => ov.getBoundingClientRect();
  // composition pixel under the pointer (0…1919, 0…1079): the pixel the user sees under the cursor tip
  const toComp = (e) => { const r = ovRect(); return [Math.min(CW - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * CW))), Math.min(CH - 1, Math.max(0, Math.floor((e.clientY - r.top) / r.height * CH)))]; };
  const toPx = ([x, y]) => { const r = ovRect(); return [(x + 0.5) / CW * r.width, (y + 0.5) / CH * r.height]; };
  function setTool(t) {
    tool = t; ov.className = t;
    document.querySelectorAll('button[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    if (t !== 'draw' && drawing && !popFor) drawing = null;
    if (t !== 'select') { pickPt = null; $('#pickBtn').style.display = 'none'; hideHover(); }
    drawOv();
  }
  document.querySelectorAll('button[data-tool]').forEach((b) => b.onclick = () => setTool(b.dataset.tool));
  const thin = (pts, n) => pts.length <= n ? pts : Array.from({ length: n }, (_, i) => pts[Math.round(i * (pts.length - 1) / (n - 1))]);
  const visibleNotes = () => { const f = curFrame(); return notes.filter((n) => n.mark && inLotF(n) && f >= n.frame && f <= (n.end ?? n.frame)); };   // (only the batch chosen, 02-notes.js)
  // a mark on the image (also drawn at full size, k = 1, into the PNG sent with a batch)
  // (picked: a white halo instead of the dark one — the colour stays the note's own, red, blue or green)
  function paintMark(g, mark, label, k, color, faded, bw = CW * k, picked = false) {
    g.save(); g.globalAlpha = faded ? 0.5 : 1;
    g.lineJoin = g.lineCap = 'round';
    const halo = (fn, w) => { g.strokeStyle = picked ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.45)'; g.lineWidth = w + 3 * Math.max(1, k * 2); fn(); g.strokeStyle = color; g.lineWidth = w; fn(); };
    let lx, ly;
    if (mark.kind === 'pin') {
      const [x, y] = [(mark.points[0][0] + 0.5) * k, (mark.points[0][1] + 0.5) * k], R = Math.max(7, 14 * k);
      halo(() => { g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.stroke(); }, Math.max(1.5, 3 * k));
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(x, y, Math.max(2.4, 4 * k), 0, Math.PI * 2); g.fill();
      g.fillStyle = color; g.beginPath(); g.arc(x, y, Math.max(1.6, 2.6 * k), 0, Math.PI * 2); g.fill();   // the exact pixel
      lx = x + R + 4; ly = y - R;
    } else {
      for (const s of mark.strokes ?? [mark.points]) halo(() => { g.beginPath(); s.forEach(([x, y], i) => (i ? g.lineTo((x + 0.5) * k, (y + 0.5) * k) : g.moveTo((x + 0.5) * k, (y + 0.5) * k))); g.stroke(); }, Math.max(1.8, 4 * k));
      const xs = (mark.strokes ?? [mark.points]).flat().map((p) => p[0]), ys = (mark.strokes ?? [mark.points]).flat().map((p) => p[1]);
      lx = Math.max(...xs) * k + 6; ly = Math.min(...ys) * k;
    }
    if (label) {
      const fs = Math.max(10.5, 22 * k); g.font = `600 ${fs}px "Segoe UI Variable Text", "Segoe UI", sans-serif`;
      const w = g.measureText(label).width + fs * 0.9, hh = fs * 1.45;
      if (lx + w > bw - 4) lx = Math.max(4, (mark.kind === 'pin' ? (mark.points[0][0] + 0.5) * k - Math.max(7, 14 * k) - 4 : Math.min(...(mark.strokes ?? [mark.points]).flat().map((p) => p[0])) * k - 6) - w);   // flip left at the right edge
      ly = Math.max(hh / 2 + 2, ly);
      g.fillStyle = color; g.beginPath(); g.roundRect(lx, ly - hh / 2, w, hh, hh / 2); g.fill();
      g.fillStyle = '#1d160b'; g.textBaseline = 'middle'; g.fillText(label, lx + fs * 0.45, ly + 0.5);
    }
    g.restore();
  }
  let overlayHadMarks = true;
  function drawOv() {
    // drawn in the image's own size (it zooms with it), sharp up to ×3 of zoom
    const lw = ov.clientWidth, lh = ov.clientHeight, q = (window.devicePixelRatio || 1) * Math.min(3, VZ.k);
    if (!lw) return;
    if (ov.width !== Math.round(lw * q) || ov.height !== Math.round(lh * q)) { ov.width = Math.round(lw * q); ov.height = Math.round(lh * q); }
    const marks = visibleNotes();
    const hasMarks = !!(marks.length || drawing || stroke || pickPt);
    if (!hasMarks && !overlayHadMarks) return;
    overlayHadMarks = hasMarks;
    const g = ov.getContext('2d'); g.setTransform(q, 0, 0, q, 0, 0); g.clearRect(0, 0, lw, lh);
    const k = lw / CW, num = new Map(reviewed().map((n, i) => [n.id, i + 1]));
    for (const n of marks) {   // the colour of its state (02-notes.js stateOf), a validated one faded
      const isSel = n.id === sel;
      paintMark(g, n.mark, String(num.get(n.id)), k, stateColor(n), stateOf(n) === 'ok' && !isSel, CW * k, isSel);
    }
    if (drawing) paintMark(g, { kind: 'circle', strokes: [...drawing.strokes, ...(stroke ? [stroke] : [])] }, '', k, C.acc);
    else if (stroke) paintMark(g, { kind: 'circle', strokes: [stroke] }, '', k, C.acc);
    if (pickPt && !drawing) paintMark(g, { kind: 'pin', points: [pickPt.pt] }, '', k, C.acc);
  }
  function markHit(pt) {
    for (const n of visibleNotes()) {
      const pts = n.mark.kind === 'pin' ? n.mark.points : (n.mark.strokes ?? [n.mark.points]).flat();
      if (pts.some(([x, y]) => Math.hypot(x - pt[0], y - pt[1]) < 26)) return n;
    }
    return null;
  }
  // hover (select tool): the object that a click will target, named next to the cursor — pixel-exact ray cast in the
  // live preview of the code, at the frame shown (loaded hidden on first use)
  let hoverT = 0, hoverPending = false;
  const hideHover = () => { $('#hoverTag').style.display = 'none'; };
  // the part of the image on screen (zoomed in, only part of it shows), in screen pixels from the image's corner
  const visBox = () => { const r = ovRect(), s = $('#stage').getBoundingClientRect(); return { x0: Math.max(0, s.left - r.left), y0: Math.max(0, s.top - r.top), x1: Math.min(r.width, s.right - r.left), y1: Math.min(r.height, s.bottom - r.top) }; };
  // a label next to the cursor: on its right, or on its left when it would leave the image; kept inside vertically
  // (placed in the image's own pixels: zoomed, they are the screen's divided by the zoom)
  function placeBeside(el, pt) {
    const [px, py] = toPx(pt), v = visBox(), w = el.offsetWidth, h = el.offsetHeight;
    el.classList.toggle('left', px + 16 + w > v.x1 - 6 && px - 16 - w >= v.x0 + 6);
    el.style.left = px / VZ.k + 'px';
    el.style.top = Math.max(v.y0 + h / 2 + 6, Math.min(v.y1 - h / 2 - 6, py)) / VZ.k + 'px';
  }
  let recoverF = null, recoverAt = 0, recoverN = 0;
  async function hoverAt(e) {
    if (tool !== 'select' || popFor || stroke || !M.paused) { hideHover(); return; }
    const t = performance.now(); if (t - hoverT < 70 || hoverPending) return;
    hoverT = t; hoverPending = true;
    try {
      const sp = SP ?? (await loadCode()); if (!sp) return;
      const f = curFrame();
      // the preview stopped by an error (E11, 17/10/2026: behind the MP4, nothing said it, and nothing was named any more):
      // mounted again here; the next move names it
      if (crash) {
        // (stopped again at the same frame: mounted again after 4 s, then 8 s… — not at every move of the pointer)
        const same = recoverF === f; if (same && performance.now() - recoverAt < 4000 * recoverN) { hideHover(); return; }
        recoverN = same ? recoverN + 1 : 1; recoverF = f; recoverAt = performance.now();
        const at = crash.at ?? f; codeRecover(f); if (mode !== 'code') setSave(T('st.code.recovered', { f: at }), ''); return;
      }
      if (sp.frame() !== f) { sp.pause(); sp.seek(f); return; }   // the next move names it
      const pt = toComp(e), h = await sp.hover(f, pt[0], pt[1]), tag = $('#hoverTag');   // (the preview's own process answers)
      if (h === undefined || popFor || stroke || !M.paused) return;
      const tt = humanTarget(h);
      if (!tt || markHit(pt)) { hideHover(); return; }
      tag.innerHTML = `${esc(tt.name)}<span class="k">${esc(tt.kind)}</span>`; tag.style.display = 'block'; placeBeside(tag, pt);
    } finally { hoverPending = false; }
  }
  ov.addEventListener('pointerleave', hideHover);
  ov.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const pt = toComp(e); hideHover();
    if (popFor && tool !== 'draw') { closePop(); return; }
    if (tool === 'select') {
      const n = markHit(pt);
      if (n) { sel = n.id; pickPt = null; $('#pickBtn').style.display = 'none'; renderAll(); showCard(n.id); return; }
      const frame = curFrame(), evidence = previewNoteReadiness(frame);
      M.pause(); pickPt = { pt, frame, evidence, source:mode };
      const b = $('#pickBtn'); b.style.display = 'inline-flex'; placeBeside(b, pt);
      drawOv(); return;
    }
    if (tool === 'comment') { M.pause(); openPop({ kind: 'pin', points: [pt] }, curFrame()); return; }
    if (tool === 'draw') {
      if (queueFull()) return;
      M.pause(); ov.setPointerCapture(e.pointerId);
      if (drawing && drawing.frame !== curFrame()) { drawing = null; closePop(); }
      stroke = [pt]; stroke.evidence = previewNoteReadiness(curFrame()); stroke.source = mode; drawOv();
    }
  });
  ov.addEventListener('pointermove', (e) => {
    if (!stroke) { ov.title = markHit(toComp(e)) ? T('st.ov.pickNote') : ''; hoverAt(e); return; }
    const pt = toComp(e), last = stroke[stroke.length - 1];
    if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= 4) { stroke.push(pt); drawOv(); }
  });
  ov.addEventListener('pointerup', () => {
    if (!stroke) return;
    const s = stroke; stroke = null;
    if (s.length < 4) { drawOv(); return; }
    drawing ??= { frame: curFrame(), strokes: [], evidence:s.evidence, source:s.source };
    if (drawing.strokes.length < 200) drawing.strokes.push(thin(s, 32));
    drawing.evidence ||= s.evidence;
    openPop({ kind: 'circle', strokes: drawing.strokes }, drawing.frame, drawing.evidence, drawing.source);
  });
  // (a touch taken back by the system — a palm on the iPad, a gesture of iPadOS: not a stroke)
  ov.addEventListener('pointercancel', () => { if (stroke) { stroke = null; drawOv(); } });
  $('#pickBtn').onclick = () => promptAtPick();
  window.__studio = { state: () => ({ staging, stage: stSel?.id ?? null, tool, mode, tab, tabL, tabR, vzoom, vz: { ...VZ }, drawing, popFor: popFor && { frame: popFor.frame, kind: popFor.mark.kind }, stroke: stroke?.length ?? null, drafts: drafts().length, frame: curFrame(), lanes: lanes.map((l) => l.name), view: { ...view }, vscroll,
    video: META?.render?.size ?? null, held: wasHeld, proj: PROJ, size: [CW, CH], cmp: cmpOpen() ? { i: cmpI, n: CMP.length, x: cmpX } : null, renderView: STATUS.lots ? renderView().st : null,
    plans: { ...(STATUS.plans ?? {}) }, lotf: LOTF, tl: shapes.map((s) => s.id), tlX: Object.fromEntries(shapes.map((s) => [s.id, s.kind === 'point' ? s.x : (s.x0 + s.x1) / 2])) }) };   // for tests (the batch shown, the notes on the timeline)
  function promptAtPick() { if (!pickPt) return; $('#pickBtn').style.display = 'none'; openPop({ kind: 'pin', points: [pickPt.pt] }, pickPt.frame, pickPt.evidence, pickPt.source); }

  // ---------- the « what should change here? » box ----------
  let pickJob = 0;
  function openPop(mark, frame, evidence = null, source = mode) {
    const keep = popFor ? $('#popTx').value : '';
    popFor = { mark, frame, target: popFor?.frame === frame ? popFor.target : null, source,
      evidence:evidence || (popFor?.frame === frame && popFor.evidence) || previewNoteReadiness(frame) };
    const pop = $('#pop'), all = mark.kind === 'pin' ? mark.points : mark.strokes.flat(), v = visBox();   // the part of the image on screen
    const [x0, y0] = toPx([Math.min(...all.map((p) => p[0])) - 30, Math.min(...all.map((p) => p[1])) - 30]);
    const [x1, y1] = toPx([Math.max(...all.map((p) => p[0])) + 30, Math.max(...all.map((p) => p[1])) + 30]);
    pop.style.display = 'block';
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left, top = Math.max(v.y0 + 6, Math.min(v.y1 - ph - 6, y0));
    if (x1 + 10 + pw <= v.x1) left = x1 + 10;
    else if (x0 - 10 - pw >= v.x0) left = x0 - 10 - pw;
    else { left = Math.max(v.x0 + 6, Math.min(v.x1 - pw - 6, x0)); top = y1 + 10 + ph <= v.y1 ? y1 + 10 : Math.max(v.y0 + 6, y0 - 10 - ph); }
    pop.style.left = left / VZ.k + 'px'; pop.style.top = top / VZ.k + 'px';   // in the image's own pixels (zoomed: /k)
    const c = contextAt(frame);
    $('#popT').innerHTML = T('st.pop.head', { what: mark.kind === 'pin' ? T('st.pop.pin') : T('st.pop.draw', { n: mark.strokes.length }), f: frame, scene: c.scene ? ' · ' + esc(c.scene) : '', code: mode === 'code' ? T('st.pop.code') : '' });
    $('#popClear').style.display = mark.kind === 'pin' ? 'none' : '';
    $('#popTx').value = keep;
    $('#popTx').focus();
    drawOv();
    identify(mark, frame);
  }
  function closePop() { $('#popTx').blur(); $('#pop').style.display = 'none'; popFor = null; drawing = null; pickPt = null; $('#pickBtn').style.display = 'none'; drawOv(); }
  function setTg(state, html) { const tg = $('#popTg'); tg.dataset.state = state; tg.innerHTML = html; }
  async function identify(mark, frame) {
    const job = ++pickJob;
    setTg('busy', `<span class="dot"></span><span class="k">${T('st.pop.searching')}</span>`);
    let pts;
    if (mark.kind === 'pin') pts = mark.points;
    else {   // a grid inside the drawing's box, kept when inside the drawn outline (as HyperFrames' 8×8 sampling)
      const all = mark.strokes.flat(), xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
      const [l, t, r, b] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const poly = all, inPoly = (x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
      pts = [];
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { const x = l + (i + 0.5) * (r - l) / 8, y = t + (j + 0.5) * (b - t) / 8; if (inPoly(x, y)) pts.push([x, y]); }
      if (!pts.length) pts = [[(l + r) / 2, (t + b) / 2]];
    }
    try {
      const sp = await loadCode();
      if (!sp || job !== pickJob) { if (job === pickJob) setTg('done', ''); return; }
      if (crash) { codeRecover(frame); await Promise.race([sp.whenFrameReady?.(), new Promise((r) => setTimeout(r, 15000))]); if (job !== pickJob) return; }   // (stopped by an error: mounted again first)
      const hits = plain((await sp.pickMany(frame, pts)).slice(0, 4).map((h) => ({ textures: h.textures, names: h.names, type: h.type, count: h.count, distance: h.distance })));   // (kept in the note: this page's own copy)
      if (job !== pickJob || !popFor) return;
      popFor.target = hits.length ? { frame, hits } : null;
      setTg('done', hits.length
        ? `<span class="dot"></span>${hits.slice(0, 2).map((h) => { const t = humanTarget(h); return `${esc(t.name)} <span class="k">${esc(t.kind)}</span>`; }).join(`<span class="k">${T('st.pop.then')}</span>`)}`
        : `<span class="k">${T('st.pop.none')}</span>`);
      if (mode === 'code') seekFrame(frame);
    } catch (e) { if (job === pickJob) setTg('done', ''); }
  }
  function commitPop() {
    if (!popFor) return;
    const { mark, frame, target } = popFor, text = $('#popTx').value.trim();
    const stored = mark.kind === 'pin' ? { kind: 'pin', points: [mark.points[0]] }
      : { kind: 'circle', points: thin(mark.strokes.flat(), 64), strokes: mark.strokes };
    const n = addNote(frame, null, false, { text, mark: stored, target, source:popFor.source, ...(popFor.evidence ? {previewReadiness:popFor.evidence} : {}) });
    closePop();
    if (n) { setSave(T('st.pop.added'), 'ok'); showCard(n.id); }
  }
  $('#popOk').onclick = commitPop;
  $('#popCancel').onclick = closePop;
  $('#popClear').onclick = () => { drawing = null; closePop(); };
  $('#popTx').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitPop(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePop(); }
    e.stopPropagation();
  });


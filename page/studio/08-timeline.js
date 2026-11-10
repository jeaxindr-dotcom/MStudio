// The studio's page (studio.html), part 08: the multi-track timeline, its mouse, the transport (play, frames, the shuttle).
// The parts of page/studio/ are one script: studio-server.mjs joins them in their order inside one function (/studio.js),
// so they share their names as the one inline script did; hence the two-space indent.
  // ---------- multi-track timeline ----------
  // Points de montage inclusifs, indépendants des notes et des lots de l’agent.
  const workArea = (() => {
    const tr = (fr, en) => FR ? fr : en;
    const bar = document.createElement('div');
    bar.id = 'workRangeBar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', tr('Plage de travail', 'Work area'));
    $('#tlbar .zoom').before(bar);
    const more = document.createElement('div');
    more.id = 'workRangeActions';
    more.setAttribute('popover', 'auto');
    more.setAttribute('role', 'group');
    more.setAttribute('aria-label', bar.getAttribute('aria-label'));
    bar.append(more);

    let key = null, saved = null, confirmed = null, looping = false, controlsStamp = null;
    let writes = Promise.resolve(), revision = 0;
    function state() {
      const id = META?.notesFile;
      if (id !== key) {
        key = id; saved = confirmed = META?.workArea ?? null;
        looping = false; controlsStamp = null;
      }
      const valid = Boolean(key && FRAMES > 0 && Number.isFinite(FPS) && FPS > 0);
      const frame = (edge) => {
        if (!valid || !Number.isSafeInteger(saved?.[edge]) || saved[edge] < 0 || !(Number.isFinite(saved.fps) && saved.fps > 0)) return null;
        // Préserver le temps couvert si le projet change de cadence. La sortie
        // désigne la dernière image incluse, la fin de l'intervalle est sa suivante.
        const ratio = FPS / saved.fps;
        const converted = edge === 'end' ? Math.round((saved.end + 1) * ratio) - 1 : Math.round(saved.start * ratio);
        return Math.max(0, Math.min(FRAMES - 1, converted));
      };
      const start = frame('start'), out = frame('end');
      const end = start === null || out === null ? out : Math.max(start, out);
      if (start === null || end === null || start === end || loopId || stopAt !== null || preparedCode?.active()) looping = false;
      return { start, end, valid };
    }

    function write(edge, start, end) {
      const serial = ++revision, target = key;
      saved = start === null && end === null ? null : { start, end, fps: FPS };
      const payload = JSON.stringify({ edge, frame: edge === 'start' ? start : end, fps: FPS });
      refresh(); draw();
      // Clics rapides : enregistrer dans l'ordre, sans remettre sur l'écran la
      // réponse d'un geste déjà dépassé. Le serveur fusionne les deux bornes.
      writes = writes.then(async () => {
        try {
          const r = await fetch('/api/work-area', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true });
          if (!r.ok) throw new Error(String(r.status));
          const result = await r.json(); if (target !== key) return;
          confirmed = result;
        } catch {
          if (target !== key) return;
          setSave(tr('Impossible d’enregistrer la plage de travail.', 'Could not save the work area.'), 'err');
        }
        if (serial === revision) { saved = confirmed; refresh(); draw(); }
      });
    }
    function mark(edge, frame = curFrame()) {
      const { start, end, valid } = state(); if (!valid) return;
      const f = Math.max(0, Math.min(FRAMES - 1, Math.round(frame)));
      if (edge === 'start') write(edge, f, end !== null && end < f ? null : end);
      else write(edge, start !== null && start > f ? null : start, f);
    }
    function go(edge) {
      const f = state()[edge];
      if (f !== null) { M.pause(); seekFrame(f); }
    }
    function toggleLoop() {
      const { start, end } = state();
      if (start === null || end === null || start === end || preparedCode?.active()) return;
      looping = !looping;
      if (looping) {
        loopId = null; stopAt = null; seekFrame(start); M.play();
        renderAll();   // actualise aussi le bouton de la note si sa boucle était active
      }
      refresh();
    }
    function fit() {
      const { start, end } = state(); if (start === null || end === null) return;
      view = { a: start / FPS, b: (end + 1) / FPS }; draw();
    }
    function note() {
      const { start, end } = state(); if (start === null || end === null) return;
      M.pause(); seekFrame(start);
      const existing = notes.find((n) => n.kind !== 'prompt' && n.frame === start && (n.end ?? n.frame) === end && (!n.source || n.source === mode));
      if (existing) {
        if (!inLotF(existing)) setLotF('all', false);
        if (!existing.draft && stateOf(existing) === 'ok') $('#hideDone').checked = false;
        sel = existing.id; setTab(existing.draft ? 'queue' : 'notes'); renderAll(); showCard(sel);
      }
      else addNote(start, end);
    }

    function button(parent, id, label, face, run) {
      const b = document.createElement('button'); b.type = 'button'; b.id = id;
      b.setAttribute('aria-label', label); b.title = label; b.innerHTML = face;
      if (run) b.onclick = () => {
        if (parent === more) more.hidePopover();
        run();
      };
      parent.append(b); return b;
    }
    const inLabel = tr('Poser l’entrée sur cette image', 'Mark in at playhead'), outLabel = tr('Poser la sortie sur cette image', 'Mark out at playhead');
    const markIn = button(bar, 'workIn', inLabel, tr('Entrée', 'In'), () => mark('start'));
    const markOut = button(bar, 'workOut', outLabel, tr('Sortie', 'Out'), () => mark('end'));
    const loop = button(bar, 'workLoop', tr('Lire la plage en boucle', 'Loop work area'), ic('repeat'), toggleLoop);
    const options = button(bar, 'workOptions', tr('Actions sur la plage de travail', 'Work area actions'), ic('more'));
    options.setAttribute('popovertarget', more.id);
    more.addEventListener('beforetoggle', (event) => {
      if (event.newState !== 'open') return;
      const r = options.getBoundingClientRect();
      more.style.left = Math.max(8, Math.min(r.right - 224, window.innerWidth - 232)) + 'px';
      more.style.top = r.top >= 226 ? 'auto' : (r.bottom + 4) + 'px';
      more.style.bottom = r.top >= 226 ? (window.innerHeight - r.top + 4) + 'px' : 'auto';
    });
    function action(id, label, icon, run) { return button(more, id, label, ic(icon) + esc(label), run); }
    const goIn = action('workGoIn', tr('Aller à l’entrée', 'Go to in point'), 'start', () => go('start'));
    const goOut = action('workGoOut', tr('Aller à la sortie', 'Go to out point'), 'end', () => go('end'));
    const fitButton = action('workFit', tr('Cadrer la plage', 'Fit work area'), 'fit', fit);
    const noteButton = action('workNote', tr('Annoter la plage', 'Annotate work area'), 'comment', note);
    const clear = action('workClear', tr('Effacer les bornes', 'Clear in and out'), 'x', () => write('clear', null, null));
    const summary = document.createElement('output'); summary.id = 'workRangeSummary'; options.before(summary);
    function refresh() {
      const { start, end, valid } = state(), complete = start !== null && end !== null;
      const canLoop = complete && end > start && !preparedCode?.active();
      const stamp = [start, end, valid, FPS, looping, canLoop].join('|'); if (stamp === controlsStamp) return;
      controlsStamp = stamp;
      markIn.disabled = markOut.disabled = !valid;
      goIn.disabled = start === null; goOut.disabled = end === null;
      clear.disabled = start === null && end === null;
      noteButton.disabled = fitButton.disabled = !complete; loop.disabled = !canLoop;
      loop.setAttribute('aria-pressed', String(looping));
      markIn.dataset.marked = String(start !== null); markOut.dataset.marked = String(end !== null);
      const label = tr('image', 'frame');
      markIn.title = inLabel + (start === null ? '' : ' · ' + label + ' ' + start);
      markOut.title = outLabel + (end === null ? '' : ' · ' + label + ' ' + end);
      summary.hidden = clear.disabled;
      summary.textContent = clear.disabled ? '' : (start ?? '…') + ' – ' + (end ?? '…');
      summary.title = complete ? (end - start + 1) + tr(' images · ', ' frames · ') + fmt((end - start + 1) / FPS) : '';
    }
    function overlay(g) {
      const { start, end } = state(); if (start === null && end === null) return;
      const left = start === null ? null : tx(start / FPS), right = end === null ? null : tx((end + 1) / FPS);
      g.save(); g.beginPath(); g.rect(0, 0, W, H); g.clip();
      if (left !== null && right !== null) {
        g.globalAlpha = 0.16; g.fillStyle = C.acc; g.fillRect(left, 0, right - left, Y.ruler[1]);
        g.globalAlpha = 0.85; g.fillRect(left, 19, right - left, 2);
      }
      for (const [x, dir] of [[left, 1], [right, -1]]) {
        if (x === null || x < -1 || x > W + 1) continue;
        g.fillStyle = C.acc; g.globalAlpha = 0.35; g.fillRect(Math.max(0, Math.min(W - 1, x)), 21, 1, H - 21);
        g.globalAlpha = 1; g.beginPath(); g.moveTo(x, 12); g.lineTo(x + dir * 7, 19); g.lineTo(x, 21); g.fill();
      }
      g.restore();
    }
    function advance(f, ended = false) {
      if (!looping) return;
      const { start, end } = state();
      if (looping && (ended || f < start || f > end)) {
        seekFrame(start);
        if (ended) M.play();
      }
    }
    refresh();
    return { refresh, overlay, advance };
  })();
  M.on('ended', () => workArea.advance(curFrame(), true));
  const HX = 118;
  const visibleTimelineSource = () => mode === 'code' ? LIVE ?? SNAP : SNAP ?? LIVE;
  // Hit rectangles are populated in paint order, using the actual source objects.
  // Reuse their storage during playback and discard stale references after drawing.
  const layerAreas = [];
  let layerAreaCount = 0;
  function rememberLayer(track, source, x, y, width, height, diamond = false) {
    const area = layerAreas[layerAreaCount] ?? (layerAreas[layerAreaCount] = {});
    layerAreaCount++;
    area.track = track; area.source = source; area.x = x; area.y = y;
    area.width = width; area.height = height; area.diamond = diamond;
  }
  function paintedLayerAt(x, y) {
    if (x < 0 || x >= W || y < Y.top || y >= H) return null;
    for (let i = layerAreaCount - 1; i >= 0; i--) {
      const a = layerAreas[i], dx = x - a.x, dy = y - a.y;
      if (dx < 0 || dy < 0 || dx >= a.width || dy >= a.height) continue;
      if (a.diamond && Math.abs(dx - 4) + Math.abs(dy - 4) > 4) continue;
      return a.source ? a : null;
    }
    return null;
  }
  let W = 0, H = 0, dpr = 1, vscroll = 0, vzoom = store.get('vzoom', 1), lanes = [], shapes = [], Y = { ruler: [0, 22], notes: [22, 56], top: 57, rows: new Map(), nrows: 1, maxScroll: 0, total: 0 };
  const tx = (t) => (t - view.a) / (view.b - view.a) * W;
  const xt = (x) => view.a + x / W * (view.b - view.a);
  const fx = (x) => Math.max(0, Math.min(FRAMES - 1, Math.floor(xt(x) * FPS)));
  const hue = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  // soft pastel colours (one per character, in order of appearance), as hsl so they can be faded
  const PAL = [[78, 82, 68], [256, 95, 80], [205, 96, 76], [330, 85, 80], [162, 72, 66], [40, 98, 74], [8, 96, 76], [235, 88, 82], [185, 75, 62], [290, 80, 80], [120, 60, 68], [20, 90, 72], [50, 90, 70], [215, 70, 70]];
  const actorHsl = new Map();
  const tone = (hsl, a) => `hsla(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%, ${a})`;
  const TRACK = { scenes: [260, 70, 76], camera: [205, 96, 76], light: [40, 98, 74], music: [162, 72, 66], amb: [78, 82, 68], sfx: [8, 96, 76], mix: [240, 40, 86] };
  const TRK = { chap: [260, 70, 76], V1: [205, 96, 76], V2: [330, 85, 80], V3: [256, 95, 80], A1: [78, 82, 68], A2: [162, 72, 66], A3: [8, 96, 76] };
  const laneTone = (l) => l.id === 'trk' ? (TRK[l.tr.id] ?? [hue(l.tr.id), 70, 74]) : l.id === 'actor' ? (actorHsl.get(l.actor) ?? [40, 20, 70]) : TRACK[l.id] ?? [40, 10, 70];
  function resize() { dpr = window.devicePixelRatio || 1; W = Math.max(50, cv.clientWidth - HX); H = cv.clientHeight; cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(H * dpr); draw(); }
  new ResizeObserver(resize).observe($('#tlwrap'));
  let availableLanes = [];
  const laneId = l => l.id === 'trk' ? 'track:' + l.tr.id : l.id === 'actor' ? 'actor:' + l.actor : l.id;
  const trackVisibilityKey = () => 'hiddenLanes.' + (META?.notesFile || META?.title || '');
  const trackPicker = document.createElement('dialog');
  trackPicker.id = 'trackPicker'; trackPicker.setAttribute('aria-labelledby','trackPickerTitle');
  trackPicker.innerHTML = `<header><h2 id="trackPickerTitle">${FR ? 'Pistes visibles' : 'Visible tracks'}</h2>
    <button class="soft" aria-label="${FR ? 'Fermer' : 'Close'}">${ic('x')}</button></header>
    <div class="track-choices"></div><footer><button class="soft">${FR ? 'Tout afficher' : 'Show all'}</button></footer>`;
  document.body.append(trackPicker);
  const trackButton = document.createElement('button');
  trackButton.id = 'trackVisibility'; trackButton.className = 'icon'; trackButton.innerHTML = ic('sliders');
  trackButton.title = FR ? 'Choisir les pistes visibles' : 'Choose visible tracks';
  trackButton.setAttribute('aria-label',trackButton.title); trackButton.setAttribute('aria-haspopup','dialog');
  $('#tlbar .zoom').prepend(trackButton);
  function hiddenLanes() {
    const saved = store.get(trackVisibilityKey(), []);
    return new Set(Array.isArray(saved) ? saved : []);
  }
  function showLanes(hidden) {
    lanes = availableLanes.filter(l => !hidden.has(laneId(l)));
    trackButton.classList.toggle('on', lanes.length !== availableLanes.length);
    if (trackPicker.open) renderTrackChoices(hidden);
  }
  function chooseLanes(hidden) {
    store.set(trackVisibilityKey(), [...hidden]); showLanes(hidden); resize();
  }
  function renderTrackChoices(hidden) {
    const root = trackPicker.querySelector('.track-choices'), focused = document.activeElement;
    const previous = focused?.dataset.track, wasSolo = focused?.tagName === 'BUTTON';
    root.replaceChildren();
    for (const l of availableLanes) {
      const id = laneId(l), row = document.createElement('div'), label = document.createElement('label');
      const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.track = id; check.checked = !hidden.has(id);
      const dot = document.createElement('i'); dot.style.background = tone(laneTone(l), 1);
      const name = document.createElement('span'); name.textContent = l.name; label.append(check, dot, name);
      const solo = document.createElement('button'); solo.className = 'soft'; solo.dataset.track = id; solo.textContent = FR ? 'Isoler' : 'Isolate'; solo.setAttribute('aria-label', solo.textContent + ' · ' + l.name);
      check.onchange = () => { const next = hiddenLanes(); if (check.checked) next.delete(id); else next.add(id); chooseLanes(next); };
      solo.onclick = () => chooseLanes(new Set(availableLanes.map(laneId).filter(key => key !== id)));
      row.append(label,solo); root.append(row);
      if (previous === id) (wasSolo ? solo : check).focus({preventScroll:true});
    }
  }
  trackButton.onclick = () => { trackPicker.showModal(); renderTrackChoices(hiddenLanes()); };
  trackPicker.querySelector('header button').onclick = () => trackPicker.close();
  trackPicker.querySelector('footer button').onclick = () => chooseLanes(new Set());
  trackPicker.addEventListener('keydown', e => e.stopPropagation());
  trackPicker.addEventListener('click', e => { if (e.target === trackPicker) trackPicker.close(); });
  function buildLanes() {
    if (PROJ) {   // the montage plan's tracks, then the sound of the video
      const tracks = LIVE?.tracks ?? [];
      const hasVideoTrack = tracks.some(tr => tr.type === 'video' && tr.clips?.length);
      availableLanes = tracks.map(tr => ({id:'trk', tr, name:tr.name, bh:tr.type === 'audio' ? 30 : tr.type === 'band' ? 22 : 24,
        pictures: tr.type === 'video' || (!hasVideoTrack && tr.type === 'band')}));
      if (!availableLanes.some(l => l.pictures && l.tr.clips?.length) && (META?.render || META?.features?.code)) {
        availableLanes.unshift({id:'film', name:FR ? 'Montage' : 'Edit', bh:24, pictures:true});
      }
      if (META?.render) availableLanes.push({id:'mix', name:T('st.lane.sound'), bh:34});
      showLanes(hiddenLanes());
      return;
    }
    const L = LIVE, out = [{ id: 'scenes', name: T('st.lane.sets'), bh: 22, pictures:true }];
    if (L?.camera?.length) out.push({ id: 'camera', name: T('st.insp.camera'), bh: 18 });
    if (L?.light?.length) out.push({ id: 'light', name: T('st.insp.light'), bh: 14 });
    const says = visibleTimelineSource()?.says ?? [], first = new Map();
    for (const s of says) if (!first.has(s.actor)) first.set(s.actor, s.t);
    for (const [a, evs] of Object.entries(L?.moves ?? {})) if (!first.has(a) && evs.length) first.set(a, evs[0].t + 1e4);
    const actors = [...first.keys()].sort((a, b) => (a === 'narrator' ? -1 : b === 'narrator' ? 1 : first.get(a) - first.get(b)));
    actors.forEach((a, i) => actorHsl.set(a, a === 'narrator' ? [230, 25, 80] : PAL[(i - (actors[0] === 'narrator' ? 1 : 0)) % PAL.length]));
    for (const a of actors) out.push({ id: 'actor', actor: a, name: who(a), bh: 26 });
    if (L?.music?.some((m) => m.channel === 'music')) out.push({ id: 'music', name: T('st.insp.music'), bh: 30 });
    if (L?.music?.some((m) => m.channel !== 'music')) out.push({ id: 'amb', name: T('st.lane.amb'), bh: 22 });
    if (L?.sfx?.length) out.push({ id: 'sfx', name: T('st.lane.sfx'), bh: 24 });
    out.push({ id: 'mix', name: 'Mix', bh: 32 });
    availableLanes = out; showLanes(hiddenLanes());
  }
  const PEAKS = new Map();
  function peaks(src) {
    if (!src) return null;
    const p = PEAKS.get(src);
    if (p) return p.data;
    const entry = { data: null }; PEAKS.set(src, entry);
    fetch('/api/peaks?src=' + encodeURIComponent(src)).then((r) => (r.ok ? r.json() : null)).then((d) => { entry.data = d; scheduleDraw(); }).catch(() => {});
    return null;
  }
  let drawQueued = false;
  const scheduleDraw = () => { if (!drawQueued) { drawQueued = true; requestAnimationFrame(() => { drawQueued = false; draw(); }); } };
  function wave(g, pk, t0, a, b, y, h, color, gain = 1, loop = false) {
    if (!pk?.peaks?.length) return;
    const x0 = Math.max(0, tx(a)), x1 = Math.min(W, tx(b)); if (x1 - x0 < 1) return;
    const spp = (view.b - view.a) / W, n = pk.peaks.length, mid = y + h / 2;
    g.fillStyle = color;
    for (let x = Math.floor(x0); x < x1; x += 2) {
      let ta = xt(x) - t0, tb = ta + spp * 2;
      if (loop && pk.dur > 0) { ta %= pk.dur; tb = ta + spp * 2; } else if (ta > pk.dur) break;
      let i0 = Math.max(0, Math.floor(ta * pk.rate)), i1 = Math.min(n - 1, Math.ceil(tb * pk.rate)), m = 0;
      for (let i = i0; i <= i1; i++) if (pk.peaks[i] > m) m = pk.peaks[i];
      const hh = Math.min(h / 2 - 1.5, Math.sqrt(m / 255) * (h / 2) * gain);
      if (hh > 0.4) g.fillRect(x, mid - hh, 1.2, hh * 2);
    }
  }
  // (a block narrower than a pixel — a zoom, the edge of the view — gave a negative radius: Chrome throws on it, the drawing
  // stopped half way, its clip left on the context — the top of the timeline (ruler, notes) gone until the next resize;
  // user report 25/10/2026: « le haut de la timeline disparaît parfois »)
  const rr = (g, x, y, w, h, r) => { const ww = Math.max(0.5, w), hh = Math.max(0.5, h); g.beginPath(); g.roundRect(x, y, ww, hh, Math.max(0, Math.min(r, ww / 2, hh / 2))); };
  function rangeRows(ranges) {
    const rows = []; const out = new Map();
    for (const n of ranges) { let r = rows.findIndex((end) => end < n.frame); if (r < 0) { r = rows.length; rows.push(0); } rows[r] = n.end; out.set(n.id, r); }
    return [out, Math.max(1, rows.length)];
  }
  function laneLayout() {
    const ranges = shownNotes().filter((n) => n.end !== null), [rows, nrows] = rangeRows(ranges);   // (the batch chosen only)
    const notesH = Math.max(36, Math.min(92, 24 + nrows * 15));
    Y = { ruler: [0, 22], notes: [22, 22 + notesH], rows, nrows, top: 22 + notesH + 1 };
    for (const l of lanes) l.h = Math.max(10, Math.round((l.pictures && filmstrip.enabled ? 53 : l.bh) * vzoom));
    let y = Y.top - vscroll;
    for (const l of lanes) { l.y = y; y += l.h; }
    Y.total = y + vscroll - Y.top;
    const maxScroll = Math.max(0, Y.total - (H - Y.top));
    if (vscroll > maxScroll) { vscroll = maxScroll; return laneLayout(); }
    Y.maxScroll = maxScroll;
  }
  const FONT = '"Segoe UI Variable Text", "Segoe UI", sans-serif';
  const playhead = document.createElement('div');
  playhead.id = 'timelinePlayhead'; playhead.hidden = true; playhead.setAttribute('aria-hidden','true');
  cv.after(playhead);
  function movePlayhead() {
    const px = tx(curFrame() / FPS);
    playhead.hidden = !W || !H || !FRAMES || !Number.isFinite(px) || px < 0 || px > W;
    if (!playhead.hidden) playhead.style.transform = 'translateX(' + (HX + px) + 'px)';
  }
  function draw() {
    workArea.refresh();
    movePlayhead();
    filmstrip.begin();
    layerAreaCount = 0;
    if (!W || !H || !FRAMES) { layerAreas.length = 0; filmstrip.end(); return; }
    // (each drawing from a clean context: a drawing that failed half way never leaves its clip or transform to the next)
    const g = cv.getContext('2d'); g.reset?.(); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cv.clientWidth, H);
    laneLayout();
    g.textBaseline = 'middle'; g.font = `11px ${FONT}`;
    const span = view.b - view.a, pps = W / span, L = LIVE;
    showZoom(span);
    // ---- tracks ----
    g.save(); g.beginPath(); g.rect(0, Y.top, cv.clientWidth, H - Y.top); g.clip();
    g.translate(HX, 0);
    const vis = (a, b) => b >= view.a && a <= view.b;
    for (const l of lanes) {
      if (l.y + l.h < Y.top || l.y > H) continue;
      g.fillStyle = 'rgba(255,255,255,0.035)'; g.fillRect(0, l.y + l.h - 1, W, 1);
      const y = l.y + 2, h = l.h - 5, TL = laneTone(l);
      if (h < 4) continue;
      const label = (txt, x0, w) => { if (w < 46 || h < 11) return; g.fillStyle = tone(TL, 0.95); g.save(); g.beginPath(); g.rect(x0, y, w - 4, h); g.clip(); g.font = `500 10.5px ${FONT}`; g.fillText(txt, x0 + 6, y + Math.min(h / 2, 8)); g.restore(); };
      const pictures = l.pictures && filmstrip.enabled && h >= 17;
      if (l.id === 'film') {
        const title = META.render?.name || META.title;
        rememberLayer('export',META.render || META,0,y,W,h);
        if (pictures) filmstrip.paint(g, {start:0, end:DUR, y, height:h, title, color:tone(TL,.85)});
        else { g.fillStyle = tone(TL,.18); g.fillRect(0,y,W,h); label(title,0,W); }
      } else if (l.id === 'scenes') {
        const source = visibleTimelineSource(), sets = source?.sets ?? [], cuts = source?.cutaways ?? [], curtain = source?.curtain ?? [];
        if (pictures && !sets.length && !cuts.length) filmstrip.paint(g, {start:0,end:DUR,y,height:h,title:META.title,color:tone(TL,.85)});
        for (const w of sets) {
          const a = w.inT, b = w.outT == null ? DUR : w.outT + (w.outDur || 0); if (!vis(a, b)) continue;
          const x0 = Math.max(0, tx(a)), x1 = Math.min(W, tx(b)), S = [hue(w.id), 75, 74];
          rememberLayer('sets', w, x0, y, Math.max(.5, x1 - x0 - 1), h);
          if (pictures) { filmstrip.paint(g, {start:a,end:b,y,height:h,title:w.name,color:tone(S,.85)}); continue; }
          g.fillStyle = tone(S, 0.16); rr(g, x0, y, x1 - x0 - 1, h, 4); g.fill();
          g.fillStyle = tone(S, 0.6); g.fillRect(x0, y + h - 2, Math.max(1, x1 - x0 - 1), 2);
          if (x1 - x0 > 50) { g.fillStyle = tone(S, 0.95); g.save(); g.beginPath(); g.rect(x0, y, x1 - x0 - 4, h); g.clip(); g.font = `500 10.5px ${FONT}`; g.fillText(w.name, x0 + 7, y + h / 2 - 1); g.restore(); }
        }
        for (const c of cuts) {
          if (!vis(c.t, c.t + c.dur)) continue;
          const x0 = Math.max(0, tx(c.t)), x1 = Math.min(W, tx(c.t + c.dur)), S = [270, 40, 74];
          rememberLayer('shots', c, x0, y, Math.max(.5, x1 - x0), h);
          if (pictures) { filmstrip.paint(g, {start:c.t,end:c.t+c.dur,y,height:h,title:c.name ?? T('st.lane.shot3d'),color:tone(S,.85)}); continue; }
          g.fillStyle = tone(S, 0.22); rr(g, x0, y, x1 - x0, h, 4); g.fill();
          if (x1 - x0 > 46) { g.fillStyle = tone(S, 0.95); g.font = `500 10.5px ${FONT}`; g.fillText(c.name ?? T('st.lane.shot3d'), x0 + 6, y + h / 2 - 1); }
        }
        g.fillStyle = 'rgba(0,0,0,0.35)';
        for (let i = 0; i < curtain.length; i++) { const c = curtain[i]; if (c.open) continue; const e = curtain[i + 1]?.t ?? DUR; if (vis(c.t, e)) g.fillRect(Math.max(0, tx(c.t)), y, Math.min(W, tx(e)) - Math.max(0, tx(c.t)), h); }
      } else if (l.id === 'camera' && L) {
        for (const c of L.camera) {
          if (!vis(c.t, c.t + c.dur + 0.01)) continue;
          const x0 = tx(c.t), x1 = tx(c.t + c.dur), my = y + h / 2;
          if (c.dur > 0) rememberLayer('camera', c, x0, y + 2, x1 - x0, h - 4);
          rememberLayer('camera', c, x0 - 4, my - 4, 8, 8, true);
          if (c.dur > 0) rememberLayer('camera', c, x1 - 4, my - 4, 8, 8, true);
          if (c.dur > 0) { g.fillStyle = tone(TL, 0.18); rr(g, x0, y + 2, x1 - x0, h - 4, 3); g.fill(); }
          for (const xd of c.dur > 0 ? [x0, x1] : [x0]) { g.fillStyle = tone(TL, 0.9); g.beginPath(); g.moveTo(xd, my - 4); g.lineTo(xd + 4, my); g.lineTo(xd, my + 4); g.lineTo(xd - 4, my); g.closePath(); g.fill(); }
          const lab = `dist ${c.v.dist} · fov ${c.v.fov}`;
          if (x1 - x0 > g.measureText(lab).width + 20) { g.fillStyle = tone(TL, 0.85); g.font = `10.5px ${FONT}`; g.fillText(lab, x0 + 10, my); }
        }
      } else if (l.id === 'light' && L) {
        L.light.forEach((c, i) => {
          const e = L.light[i + 1]?.t ?? DUR; if (!vis(c.t, e)) return;
          const x0 = Math.max(0, tx(c.t)), x1 = Math.min(W, tx(e)), S = [hue(String(c.v)), 85, 72];
          rememberLayer('light', c, x0, y, Math.max(.5, x1 - x0 - 2), h);
          g.fillStyle = tone(S, 0.2); rr(g, x0, y, x1 - x0 - 2, h, 3); g.fill();
          label(String(c.v), x0, x1 - x0);
        });
      } else if (l.id === 'actor') {
        const says = (visibleTimelineSource()?.says ?? []).filter((s) => s.actor === l.actor);
        for (const ev of L?.moves?.[l.actor] ?? []) {
          if (ev.kind !== 'walk' || !vis(ev.t, ev.t + ev.dur)) continue;
          g.fillStyle = tone(TL, 0.28); g.fillRect(tx(ev.t), y + h - 1, Math.max(1, tx(ev.t + ev.dur) - tx(ev.t)), 2);
        }
        for (const s of says) {
          if (!vis(s.t, s.t + s.dur)) continue;
          const x0 = tx(s.t), x1 = tx(s.t + s.dur), w = Math.max(2, x1 - x0 - 1);
          rememberLayer('actor:' + l.actor, s, x0, y, w, h - 2);
          g.fillStyle = tone(TL, 0.17); rr(g, x0, y, w, h - 2, 4); g.fill();
          if (w > 8) wave(g, peaks(s.audio), s.t, s.t, s.t + s.dur, y, h - 2, tone(TL, 0.85), Math.min(1, s.gain ?? 1));
          else { g.fillStyle = tone(TL, 0.8); g.fillRect(x0, y, w, h - 2); }
          if (w > 60 && h > 16) { g.fillStyle = 'rgba(17,17,16,0.55)'; const tw = Math.min(w - 8, g.measureText(s.id).width + 10); rr(g, x0 + 3, y + 3, tw, 13, 4); g.fill(); g.fillStyle = tone(TL, 1); g.font = `600 10px ${FONT}`; g.fillText(s.id, x0 + 8, y + 9.5); }
        }
        for (const e of (L?.emotes ?? []).filter((e) => e.actor === l.actor)) {
          if (!vis(e.t, e.t)) continue;
          rememberLayer(null, null, tx(e.t) - 4, y, 8, 8);
          g.fillStyle = 'rgba(9,11,18,0.9)'; g.beginPath(); g.arc(tx(e.t), y + 4, 3.8, 0, Math.PI * 2); g.fill();
          g.fillStyle = tone([44, 80, 74], 1); g.beginPath(); g.arc(tx(e.t), y + 4, 2.4, 0, Math.PI * 2); g.fill();
        }
      } else if ((l.id === 'music' || l.id === 'amb') && L) {
        for (const m of L.music) {
          if ((m.channel === 'music') !== (l.id === 'music')) continue;
          if (m.volume <= 0 || !vis(m.t, m.until)) continue;
          const x0 = tx(m.t), x1 = tx(m.until);
          rememberLayer(l.id, m, x0, y, Math.max(.5, x1 - x0 - 2), h);
          g.fillStyle = tone(TL, 0.14); rr(g, x0, y, x1 - x0 - 2, h, 4); g.fill();
          wave(g, peaks(m.src), m.t, Math.max(m.t, view.a), Math.min(m.until, view.b), y, h, tone(TL, 0.75), Math.min(1, 0.45 + m.volume * 1.4), true);
          label(m.name.replace(/^music_/, ''), Math.max(0, x0), x1 - Math.max(0, x0));
        }
      } else if (l.id === 'sfx' && L) {
        for (const s of L.sfx) {
          if (!vis(s.t, s.t + 9.5)) continue;   // (out of view: its waveform not even asked for)
          const pk = peaks(s.src), d = Math.min(9.5, pk?.dur ?? 0.6);
          if (!vis(s.t, s.t + d)) continue;
          const x0 = tx(s.t), x1 = tx(s.t + d);
          rememberLayer('sfx', s, x0, y, Math.max(.5, x1 - x0), h);
          g.fillStyle = tone(TL, 0.12); rr(g, x0, y, x1 - x0, h, 3); g.fill();
          if (pk) wave(g, pk, s.t, s.t, s.t + d, y, h, tone(TL, 0.8), Math.min(1, 0.45 + s.volume));
          if (x1 - x0 > 70) label(s.name, x0, x1 - x0);
        }
      } else if (l.id === 'mix') {
        wave(g, peaks('@mix'), 0, view.a, view.b, y, h, tone(TL, 0.55), 1);
      } else if (l.id === 'trk') {
        const tr = l.tr;
        for (const [index,c] of tr.clips.entries()) {
          if (!vis(c.t0, c.t1)) continue;
          const x0 = Math.max(0, tx(c.t0)), x1 = Math.min(W, tx(c.t1)), w0 = Math.max(1, x1 - x0 - 1);
          rememberLayer(tr.id, c, x0, y, w0, h);
          if (pictures) {
            const asset = tr.type === 'video' && filmstrip.isAsset(c.file) ? filmstrip.assetTag(tr.id,index) : null;
            filmstrip.paint(g, {start:c.t0,end:c.t1,y,height:h,title:c.label,color:tone(TL,.85),asset,inactive:c.off});
            continue;
          }
          g.fillStyle = tone(TL, c.off ? 0.05 : tr.type === 'audio' ? 0.1 : 0.18); rr(g, x0, y, w0, h, 4); g.fill();
          if (tr.type !== 'audio') { g.fillStyle = tone(TL, c.off ? 0.2 : 0.6); g.fillRect(x0, y + h - 2, w0, 2); }
          if (tr.type === 'audio' && (c.src || c.file)) { const pk = peaks(c.src || c.file); if (pk) wave(g, pk, c.t0 - c.from / FPS, Math.max(view.a, c.t0), Math.min(view.b, c.t1), y, h, tone(TL, 0.75), 1); }
          if (c.off) { g.strokeStyle = tone(TL, 0.25); g.setLineDash([3, 3]); rr(g, x0 + 0.5, y + 0.5, w0 - 1, h - 1, 4); g.stroke(); g.setLineDash([]); }
          if (x1 - x0 > 46) label(c.label, x0, x1 - x0);
        }
      }
    }
    layerAreas.length = layerAreaCount;
    filmstrip.end();
    for (const n of shownNotes()) {   // (the selected one in white: the colours say the notes' states)
      const x = tx(n.frame / FPS); if (x < -2 || x > W + 2) continue;
      g.fillStyle = n.id === sel ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)';
      if (n.end !== null) g.fillRect(tx(n.frame / FPS), Y.top, Math.max(1, tx((n.end + 1) / FPS) - tx(n.frame / FPS)), H - Y.top);
      else { g.fillStyle = n.id === sel ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.07)'; g.fillRect(x - 0.5, Y.top, 1, H - Y.top); }
    }
    g.restore();
    // ---- ruler + notes band ----
    g.save(); g.translate(HX, 0);
    g.fillStyle = 'rgba(255,255,255,0.025)'; g.fillRect(0, 0, W, Y.ruler[1]);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, Y.notes[0], W, Y.notes[1] - Y.notes[0]);
    const steps = [1 / FPS, 2 / FPS, 5 / FPS, 10 / FPS, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    const step = steps.find((s) => s * pps >= 80) ?? 120;
    g.font = `500 10.5px ${FONT}`; g.fillStyle = C.s9;
    for (let t = Math.ceil(view.a / step) * step; t <= view.b; t += step) {
      const x = Math.round(tx(t)) + 0.5;
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x - 0.5, 14, 1, 8);
      g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(x - 0.5, Y.notes[0], 1, Y.notes[1] - Y.notes[0]);
      g.fillStyle = C.s9; g.fillText(step < 1 ? `${fmtS(t)}+${Math.round((t % 1) * FPS)}` : fmtS(t), x + 4, 9);
    }
    const sub = step / 5;
    if (sub * pps >= 8) { g.fillStyle = 'rgba(255,255,255,0.06)'; for (let t = Math.ceil(view.a / sub) * sub; t <= view.b; t += sub) g.fillRect(Math.round(tx(t)), 18, 1, 4); }
    shapes = [];
    const n0 = Y.notes[0], n1 = Y.notes[1];
    const shown = shownNotes(), ranges = shown.filter((n) => n.end !== null), points = shown.filter((n) => n.end === null);   // (the batch chosen only)
    const rTop = n0 + 22, rH = Math.max(8, Math.min(12, (n1 - rTop - 3) / Y.nrows - 3));
    const numOf = new Map(reviewed().map((n, i) => [n.id, i + 1]));   // (the numbers of all the notes, as everywhere)
    // the colour of the note's state (02-notes.js stateOf: red to fix, blue fixed, green validated); the one selected
    // ringed in white
    for (const n of ranges) {
      const x0 = tx(n.frame / FPS), x1 = tx((n.end + 1) / FPS), y = rTop + Y.rows.get(n.id) * (rH + 3);
      if (x1 < -10 || x0 > W + 10) continue;
      const isSel = n.id === sel, col = stateColor(n);
      g.globalAlpha = isSel ? 0.45 : 0.22; g.fillStyle = col; rr(g, x0, y, Math.max(4, x1 - x0), rH, rH / 2); g.fill();
      g.globalAlpha = 1; g.strokeStyle = isSel ? '#ffffff' : col; g.lineWidth = isSel ? 1.5 : 1; rr(g, x0 + 0.5, y + 0.5, Math.max(4, x1 - x0) - 1, rH - 1, rH / 2); g.stroke();
      if (x1 - x0 > 24) { g.fillStyle = isSel ? '#ffffff' : col; g.font = `600 9.5px ${FONT}`; g.fillText(String(numOf.get(n.id)) + (x1 - x0 > 90 && n.text ? '  ' + n.text.slice(0, Math.floor((x1 - x0) / 6.5)) : ''), x0 + 7, y + rH / 2 + 0.5); }
      shapes.push({ kind: 'range', id: n.id, x0, x1, y0: y, y1: y + rH });
    }
    for (const n of points) {
      const x = tx(n.frame / FPS); if (x < -10 || x > W + 10) continue;
      const isSel = n.id === sel, col = stateColor(n);
      g.fillStyle = col; g.globalAlpha = isSel ? 1 : 0.55; g.fillRect(x - 0.5, n0 + 17, 1, n1 - n0 - 17); g.globalAlpha = 1;
      if (isSel) { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, n0 + 10, 10, 0, Math.PI * 2); g.fill(); g.fillStyle = col; }
      g.beginPath(); g.arc(x, n0 + 10, 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1d160b'; g.textAlign = 'center'; g.font = `600 9.5px ${FONT}`; g.fillText(String(numOf.get(n.id)), x, n0 + 10.5); g.textAlign = 'left';
      shapes.push({ kind: 'point', id: n.id, x, y0: n0, y1: n1 });
    }
    const pendingR = drag && drag.mode === 'create' ? [drag.f0, drag.f1] : (rangeStart !== null ? [rangeStart, curFrame()] : null);
    if (pendingR) {
      const a = Math.min(...pendingR), b = Math.max(...pendingR);
      g.fillStyle = 'rgba(201,242,107,0.14)'; g.fillRect(tx(a / FPS), n0, tx((b + 1) / FPS) - tx(a / FPS), H - n0);
      g.fillStyle = C.acc; g.fillRect(tx(a / FPS), n0, 1, H - n0);
    }
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, n1, W, 1);
    // the playhead at the START of its frame, where a clip that begins on it begins (as DaVinci; 10/10/2026: drawn at the
    // frame's middle, it stood half a frame beside every cut, and never on it)
    workArea.overlay(g);
    g.restore();
    // ---- track names ----
    g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(0, 0, HX, H);
    g.save(); g.beginPath(); g.rect(0, Y.top, HX, H - Y.top); g.clip();
    for (const l of lanes) {
      if (l.y + l.h < Y.top || l.y > H) continue;
      const TL = laneTone(l);
      g.fillStyle = tone(TL, 0.85); rr(g, 10, l.y + l.h / 2 - Math.min(6, l.h / 2 - 2), 3, Math.min(12, l.h - 4), 2); g.fill();
      if (l.h >= 12) { g.fillStyle = C.s11; g.font = `500 11.5px ${FONT}`; g.fillText(l.name, 22, l.y + l.h / 2); }
      g.fillStyle = 'rgba(255,255,255,0.035)'; g.fillRect(0, l.y + l.h - 1, HX, 1);
    }
    g.restore();
    g.font = `500 10.5px ${FONT}`; g.fillStyle = C.s9; g.fillText(fmtS(view.a) + ' – ' + fmtS(view.b), 12, 11);
    g.fillStyle = C.s11; g.font = `500 11.5px ${FONT}`; g.fillText('Notes', 22, (Y.notes[0] + Y.notes[1]) / 2);
    g.fillStyle = C.lime; rr(g, 10, (Y.notes[0] + Y.notes[1]) / 2 - 6, 3, 12, 2); g.fill();
    if (Y.maxScroll > 0) {
      const ah = H - Y.top, bh = Math.max(24, ah * ah / (Y.total || 1)), by = Y.top + (ah - bh) * (vscroll / Y.maxScroll);
      g.fillStyle = 'rgba(255,255,255,0.12)'; rr(g, HX - 5, by + 2, 3, bh - 4, 2); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(HX - 1, 0, 1, H);
  }
  function trackHit(x, y) {
    const l = lanes.find((l) => y >= l.y && y < l.y + l.h); if (!l) return null;
    const t = xt(x), L = LIVE, near = (tt) => Math.abs(tx(tt) - x) <= 5;
    if (l.id === 'actor') {
      const s = (visibleTimelineSource()?.says ?? []).findLast((s) => s.actor === l.actor && s.t <= t && t < s.t + s.dur);
      const e = (L?.emotes ?? []).find((e) => e.actor === l.actor && near(e.t));
      if (e) return { lane: l, text: T('st.tip.emote', { who: who(e.actor), name: e.name, t: fmt(e.t) }) };
      if (s) return { lane: l, item: s, span: [s.t, s.t + s.dur], text: T('st.tip.line', { id: s.id, who: who(s.actor), text: s.text, a: fmt(s.t), b: fmt(s.t + s.dur) }) };
      const w = (L?.moves?.[l.actor] ?? []).find((m) => m.kind === 'walk' && m.t <= t && t <= m.t + m.dur);
      if (w) return { lane: l, text: T('st.tip.walk', { who: who(l.actor), a: fmt(w.t), b: fmt(w.t + w.dur) }) };
    }
    if (l.id === 'camera') { const c = L?.camera.find((c) => near(c.t) || (c.t <= t && t <= c.t + c.dur)); if (c) return { lane: l, span: [c.t, c.t + c.dur], text: `${T('st.insp.camera')} ${fmt(c.t)}${c.dur ? ' → ' + fmt(c.t + c.dur) : ''} · ${Object.entries(c.v).map(([k, v]) => `${k} ${v}`).join(' · ')}` }; }
    if (l.id === 'light') { const i = (L?.light ?? []).findIndex((c, k) => c.t <= t && t < (L.light[k + 1]?.t ?? 1e9)); if (i >= 0) return { lane: l, text: T('st.tip.light', { v: L.light[i].v, t: fmt(L.light[i].t) }) }; }
    if (l.id === 'music' || l.id === 'amb') { const m = L?.music.find((m) => (m.channel === 'music') === (l.id === 'music') && m.t <= t && t < m.until && m.volume > 0); if (m) return { lane: l, span: [m.t, m.until], text: `${l.id === 'music' ? T('st.insp.music') : T('st.lane.amb')} ${m.name} · vol ${m.volume} · ${fmt(m.t)} → ${fmt(m.until)}` }; }
    if (l.id === 'sfx') { const s = [...(L?.sfx ?? [])].reverse().find((s) => s.t <= t && t <= s.t + Math.min(9.5, PEAKS.get(s.src)?.data?.dur ?? 0.6)); if (s) return { lane: l, text: T('st.tip.sfx', { name: s.name, v: s.volume, t: fmt(s.t) }) }; }
    if (l.id === 'scenes') return { lane: l, text: contextAt(Math.floor(t * FPS)).scene };
    if (l.id === 'mix') return { lane: l, text: PROJ ? T('st.tip.soundVideo') : T('st.tip.soundMp4') };
    if (l.id === 'trk') {
      const c = l.tr.clips.findLast((c) => c.t0 <= t && t < c.t1);
      if (c) return { lane: l, item: c, span: [c.t0, c.t1], text: T('st.tip.clip', { track: l.tr.name, label: c.label, file: c.file ? ' · ' + c.file : '', a: fmt(c.t0), b: fmt(c.t1), off: c.off ? T('st.tip.off') : '' }) };
    }
    return { lane: l, text: l.name };
  }

  // ---------- timeline mouse ----------
  let drag = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left - HX, y: e.clientY - r.top }; };
  const inNotes = (y) => y >= Y.notes[0] && y <= Y.notes[1];
  function hit(x, y) {
    if (!inNotes(y)) return null;
    for (const s of shapes) if (s.kind === 'point' && Math.abs(x - s.x) <= 8) return { s, part: 'body' };
    for (const s of [...shapes].reverse()) if (s.kind === 'range' && y >= s.y0 - 3 && y <= s.y1 + 3 && x >= s.x0 - 5 && x <= s.x1 + 5) {
      if (Math.abs(x - s.x0) <= 6) return { s, part: 'start' };
      if (Math.abs(x - s.x1) <= 6) return { s, part: 'end' };
      return { s, part: 'body' };
    }
    return null;
  }
  cv.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const { x, y } = pos(e); if (x < 0) return;
    const f = fx(x); const h = hit(x, y);
    if (h) {
      const n = byId(h.s.id); sel = n.id;
      drag = { mode: h.s.kind === 'point' ? 'move' : (h.part === 'body' ? 'move' : h.part), id: n.id, x0: x, f: f, n0: { frame: n.frame, end: n.end }, moved: false };
      renderAll();
    } else if (inNotes(y)) drag = { mode: 'maybe', x0: x, f0: f, f1: f };
    else { drag = { mode: 'scrub' }; M.pause(); seekFrame(f); }
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    const { x, y } = pos(e);
    if (!drag) {
      if (e.target !== cv) { tip.style.display = 'none'; return; }
      if (x < 0) { tip.style.display = 'none'; cv.style.cursor = 'default'; return; }
      const h = hit(x, y);
      cv.style.cursor = h ? (h.part === 'start' || h.part === 'end' ? 'ew-resize' : 'grab') : (inNotes(y) ? 'crosshair' : 'default');
      const f = fx(x); let txt = T('st.tip.at', { t: fmt(f / FPS), f });
      if (y >= Y.top) {
        const th = trackHit(x, y); if (th?.text) txt = th.text;
        if (paintedLayerAt(x, y)) txt += FR ? ' · Clic droit → Calques' : ' · Right-click → Layers';
      }
      if (h) { const n = byId(h.s.id); txt = (n.end !== null ? T('st.insp.frames', { a: n.frame, b: n.end }) : T('st.insp.frameAt', { a: n.frame })) + (n.text ? ' · ' + n.text.slice(0, 80) : ''); }
      tip.textContent = txt; tip.style.display = 'block';
      tip.style.left = Math.min(x + HX + 14, cv.clientWidth - tip.offsetWidth - 6) + 'px'; tip.style.top = Math.max(2, y - 34) + 'px';
      return;
    }
    const f = fx(x);
    if (drag.mode === 'scrub') { seekFrame(f); return; }
    if (drag.mode === 'maybe' && Math.abs(x - drag.x0) > 4) drag.mode = 'create';
    if (drag.mode === 'create') { drag.f1 = f; draw(); return; }
    if (drag.mode === 'maybe') return;
    const n = byId(drag.id); if (!n) return;
    const d = f - drag.f; if (d !== 0) drag.moved = true;
    if (drag.mode === 'move') {
      const len = n.end !== null ? drag.n0.end - drag.n0.frame : 0;
      const a = Math.max(0, Math.min(FRAMES - 1 - len, drag.n0.frame + d));
      n.frame = a; n.end = drag.n0.end !== null ? a + len : null;
    } else if (drag.mode === 'start') n.frame = Math.min(drag.n0.end, Math.max(0, drag.n0.frame + d));
    else if (drag.mode === 'end') n.end = Math.max(drag.n0.frame, Math.min(FRAMES - 1, drag.n0.end + d));
    if (drag.mode !== 'move' || d !== 0) { M.pause(); seekFrame(drag.mode === 'end' ? n.end : n.frame); }
    draw();
  });
  window.addEventListener('mouseup', () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.mode === 'maybe') { M.pause(); seekFrame(d.f0); }
    else if (d.mode === 'create') addNote(Math.min(d.f0, d.f1), Math.max(d.f0, d.f1));
    else if (d.mode !== 'scrub') {
      const n = byId(d.id);
      if (n) {
        if (d.moved) { setFrames(n, n.frame, n.end); save(); }
        else { M.pause(); seekFrame(n.frame); }
        renderAll(); showCard(n.id);
      }
    }
    draw();
  });
  cv.addEventListener('mouseleave', () => { if (!drag) tip.style.display = 'none'; });
  cv.addEventListener('contextmenu', e => {
    const {x, y} = pos(e), layer = paintedLayerAt(x, y);
    if (layer && window.CoulissesLayers?.inspect(layer.track, layer.source)) {
      e.preventDefault(); tip.style.display = 'none';
    }
  });
  cv.addEventListener('dblclick', (e) => {
    const { x, y } = pos(e); if (x < 0) return;
    if (inNotes(y) && !hit(x, y)) { addNote(fx(x)); return; }
    const th = y >= Y.top ? trackHit(x, y) : null;
    if (th?.lane.id === 'trk' && th.item) {
      const c = th.item, n = addNote(frameOfT(c.t0), Math.max(frameOfT(c.t0) + 1, frameOfT(c.t1) - 1));
      if (n) setSave(T('st.note.onClip', { label: c.label }), 'ok');
      return;
    }
    if (th?.lane.id === 'actor' && th.item) {
      const s = th.item, n = addNote(frameOfT(s.t), Math.max(frameOfT(s.t) + 1, frameOfT(s.t + s.dur) - 1));
      if (n) setSave(T('st.note.onLine', { id: s.id }), 'ok');
    }
  });
  // DaVinci Resolve style: wheel = tracks up / down · Ctrl+wheel = move in time · Alt+wheel = horizontal zoom ·
  // Shift+wheel = track height. (With Shift, Chrome on Windows reports the wheel as deltaX: both are read.)
  cv.addEventListener('wheel', (e) => {
    e.preventDefault(); tip.style.display = 'none';
    const { x } = pos(e), d = e.deltaY || e.deltaX, span = view.b - view.a;
    if (e.altKey) {
      const at = x >= 0 ? xt(x) : (curFrame() + 0.5) / FPS;
      const k = Math.exp(d * 0.0015), ns = Math.max(40 / FPS, Math.min(DUR, span * k));
      view.a = at - (at - view.a) * ns / span; view.b = view.a + ns; clampView(); draw();
    } else if (e.ctrlKey || (!e.shiftKey && Math.abs(e.deltaX) > Math.abs(e.deltaY))) pan(d / W * span);
    else if (e.shiftKey) { vzoom = Math.max(0.5, Math.min(3, vzoom * Math.exp(-d * 0.0015))); store.set('vzoom', vzoom); draw(); }
    else { vscroll = Math.max(0, Math.min(Y.maxScroll ?? 0, vscroll + d * 0.6)); draw(); }
  }, { passive: false });
  function clampView() { const s = view.b - view.a; if (view.a < 0) { view.a = 0; view.b = s; } if (view.b > DUR) { view.b = DUR; view.a = Math.max(0, DUR - s); } }
  function pan(d) { view.a += d; view.b += d; clampView(); draw(); }

  // ---------- transport ----------
  const play = () => { if (M.paused) M.play(); else M.pause(); };
  $('#bPlay').onclick = play;
  // the edit points (as DaVinci's ↑ / ↓): every clip's start and end, a set's arrival and leaving, a 3D shot's ends
  function editPoints() {
    const s = new Set([0, Math.max(0, FRAMES - 1)]);
    const add = (t) => { if (Number.isFinite(t)) s.add(Math.max(0, Math.min(FRAMES - 1, Math.round(t * FPS)))); };
    for (const tr of LIVE?.tracks ?? []) for (const c of tr.clips ?? []) { add(c.t0); add(c.t1); }
    for (const w of SNAP?.sets ?? LIVE?.sets ?? []) { add(w.inT); add(w.inT + (w.inDur ?? 0)); if (w.outT !== null && w.outT !== undefined) { add(w.outT); add(w.outT + (w.outDur ?? 0)); } }
    for (const c of SNAP?.cutaways ?? LIVE?.cutaways ?? []) { add(c.t); add(c.t + c.dur); }
    return [...s].sort((a, b) => a - b);
  }
  function toEdit(dir) {
    const f = curFrame(), pts = editPoints();
    const t = dir > 0 ? pts.find((x) => x > f) : [...pts].reverse().find((x) => x < f);
    if (t !== undefined) { M.pause(); seekFrame(t); }
  }
  $('#bPrev').onclick = () => { M.pause(); seekFrame(curFrame() - 1); };
  $('#bNext').onclick = () => { M.pause(); seekFrame(curFrame() + 1); };
  $('#bNote').onclick = () => { M.pause(); addNote(curFrame()); };
  $('#bRange').onclick = () => markRange();
  $('#bFit').onclick = () => { view = { a: 0, b: DUR }; draw(); };
  // the zoom (the keys + / - and the buttons over the timeline): around the middle of what is shown
  // zoom around the playhead when it is in view (it keeps its place, as DaVinci), else around the middle of the view
  function zoomBy(k) {
    if (!DUR) return;
    const s = Math.max(40 / FPS, Math.min(DUR, (view.b - view.a) * k)), t = curFrame() / FPS;
    if (t >= view.a && t <= view.b) { const u = (t - view.a) / (view.b - view.a); view.a = t - u * s; view.b = view.a + s; }
    else { const c = (view.a + view.b) / 2; view.a = c - s / 2; view.b = c + s / 2; }
    clampView(); draw();
  }
  $('#bZoomIn').onclick = () => zoomBy(1 / 1.5);
  $('#bZoomOut').onclick = () => zoomBy(1.5);
  function showZoom(span) { const el = $('#zoomPct'), z = `${Math.round((DUR / span) * 100)}${FR ? ' %' : '%'}`; if (el && el.textContent !== z) el.textContent = z; }
  $('#vol').oninput = (e) => { M.volume = +e.target.value; };
  document.querySelectorAll('.spd').forEach((b) => b.onclick = () => { M.playbackRate = +b.dataset.s; document.querySelectorAll('.spd').forEach((x) => x.classList.toggle('on', x === b)); });
  $('#hideDone').onchange = renderList;
  function markRange() {
    if (rangeStart === null) { rangeStart = curFrame(); $('#bRange').classList.add('on'); setSave(T('st.note.rangeStart'), ''); }
    else { const a = rangeStart; rangeStart = null; $('#bRange').classList.remove('on'); M.pause(); addNote(a, curFrame()); }
    draw();
  }
  const SHUTTLE_SPEED = 2, HOLD_MS = 280;
  let shuttle = null, holdT = null, holdKey = null, holdCode = null;
  const shuttleEl = $('#shuttle');
  function startShuttle(dir) {
    stopAt = null; loopId = null;
    shuttle = { dir, rate: M.playbackRate, t0: M.currentTime, r0: performance.now() };
    if (dir > 0) { M.playbackRate = SHUTTLE_SPEED; M.play(); } else M.pause();
    shuttleEl.innerHTML = `×2 <small>${T(dir > 0 ? 'st.shuttle.fwd' : 'st.shuttle.back')}</small>`;
    shuttleEl.classList.add('on');
  }
  function stopShuttle() {
    clearTimeout(holdT); holdT = null; holdKey = null;
    if (!shuttle) return;
    const s = shuttle; shuttle = null;
    if (s.dir > 0) { M.pause(); M.playbackRate = s.rate; }
    shuttleEl.classList.remove('on');
    seekFrame(curFrame());
  }
  function shuttleBackStep() {
    if (!shuttle || shuttle.dir > 0) return;
    const target = shuttle.t0 - SHUTTLE_SPEED * (performance.now() - shuttle.r0) / 1000;
    if (target <= 0) { M.currentTime = 0; stopShuttle(); return; }
    if (!M.seeking) M.currentTime = target;
  }
  window.addEventListener('keyup', (e) => {
    if (holdKey && (e.key === holdKey || (holdCode && e.code === holdCode))) { if (!shuttle) keyReleased(); stopShuttle(); }
    if (e.key === 'Alt') e.preventDefault();
  });
  window.addEventListener('blur', stopShuttle);

  let playing = null, previousScene, previousLines;
  function updateHud() {
    const f = curFrame();
    $('#tc').textContent = fmt(f / FPS); $('#fr').textContent = T('st.hud.frame', { f, max: FRAMES - 1 });
    if (playing !== !M.paused) { playing = !M.paused; $('#bPlay').innerHTML = ic(playing ? 'pause' : 'play', 'fill'); }
    const c = contextAt(f); const el = $('#context');
    const lines = c.lines.join('   '), scene = c.scene || '—';
    if (scene !== previousScene || lines !== previousLines) {
      const b = document.createElement('b'); b.textContent = scene;
      el.replaceChildren(b, document.createTextNode(lines ? '   ' + lines : ''));
      previousScene = scene; previousLines = lines;
    }
    renderInspector();
  }
  M.on('play', updateHud); M.on('pause', updateHud); M.on('seeked', () => { updateHud(); draw(); drawOv(); });
  let lastF = -1, lastView = '';
  (function tick() {
    // Une erreur ponctuelle de dessin ne doit pas interrompre le transport.
    requestAnimationFrame(tick);
    shuttleBackStep();
    if (!M.paused || shuttle) {
      const f = curFrame();
      if (!shuttle) workArea.advance(f);
      if (!shuttle && loopId) { const n = byId(loopId); if (n && n.end !== null && (f > n.end || f < n.frame)) seekFrame(n.frame); }
      if (!shuttle && stopAt !== null && f >= stopAt) { M.pause(); stopAt = null; }
      const t = M.currentTime, span = view.b - view.a;
      if (t > view.b - span * 0.04) { view.a = Math.max(0, t - span * 0.1); view.b = view.a + span; clampView(); }
      else if (t < view.a + span * 0.04) { view.b = Math.min(DUR, t + span * 0.1); view.a = view.b - span; clampView(); }
    }
    const f = curFrame();
    // drawn again when the frame or the view changed (user report 18/10/2026, « la lecture est lente et laggy »: while playing,
    // the timeline was drawn at every animation frame, 60 a second for a 30 i/s video, on the same thread as the preview)
    const vk = `${view.a}|${view.b}`;
    if (f !== lastF || vk !== lastView) {
      if (f !== lastF) { if (pickPt && pickPt.frame !== f) { pickPt = null; $('#pickBtn').style.display = 'none'; } hideHover(); }
      // a jump out of the view (↑ / ↓ to a cut, a frame step at its edge, a note chosen): the view follows the playhead
      if (f !== lastF && M.paused && !drag && DUR) { const t = f / FPS, span = view.b - view.a; if (t < view.a || t >= view.b) { view.a = t - span / 2; view.b = view.a + span; clampView(); } }
      updateHud();
      // Track geometry and thumbnail pixels stay valid between cuts. Direct
      // edits, loads, zooms and resize invalidate through draw()/scheduleDraw().
      if (lastView !== `${view.a}|${view.b}` || rangeStart !== null) draw();
      else movePlayhead();
      drawOv(); showShot();
      // Valider seulement un dessin complet : une image arrêtée est aussi retentée.
      lastF = f; lastView = vk;
    }
    if (window.__cgReady) cgTick();   // the grade of the scene shown (part 11, evaluated after this first tick)
  })();


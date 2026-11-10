// The composition browser uses the timeline already loaded by the studio. Its ranges
// are inclusive Remotion frames; tracks from the timeline API have exclusive ends.
  (() => {
    const tx = (fr, en) => FR ? fr : en;
    const name = tx('Calques', 'Layers');
    const tabButton = document.createElement('button');
    tabButton.id = 'compositionTab';
    tabButton.dataset.tab = 'composition';
    tabButton.innerHTML = `${ic('box')}<span>${name}</span>`;
    tabButton.setAttribute('aria-controls', 'tab-composition');
    $('#tabs').prepend(tabButton);
    for (const button of $('#tabs').querySelectorAll('button')) {
      const label = button.cloneNode(true);
      label.querySelector('.n')?.remove();
      const text = label.textContent.trim();
      button.setAttribute('aria-label', text);
      button.title ||= text;
    }
    const panel = document.createElement('section');
    panel.className = 'tab';
    panel.id = 'tab-composition';
    panel.setAttribute('aria-labelledby', tabButton.id);
    const searchLabel = tx('Rechercher un calque', 'Search layers');
    const atFrame = tx('Afficher les éléments à la tête de lecture', 'Show items at the playhead');
    panel.innerHTML = `<div class="cx-tools">
      <label class="cx-search"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
      <input type="search" id="cx-search" aria-label="${searchLabel}" placeholder="${searchLabel}" spellcheck="false"></label>
      <button type="button" class="cx-at" title="${atFrame}" aria-label="${atFrame}" aria-pressed="false">${ic('goto')}</button>
      <label class="cx-scenes"><span>${tx('Scène', 'Scene')}</span><select aria-label="${tx('Filtrer par scène', 'Filter by scene')}"></select></label>
    </div><div class="cx-tree"></div><section class="cx-inspector" hidden></section>`;
    $('#side').append(panel);
    const tree = panel.querySelector('.cx-tree'), inspector = panel.querySelector('.cx-inspector');
    const search = panel.querySelector('input'), scenePicker = panel.querySelector('select'), at = panel.querySelector('.cx-at');
    const allScenes = tx('Toute la composition', 'Entire composition');
    const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
    const openGroups = new Set(), closedGroups = new Set();
    let groups = [], scenes = [], entries = new Map(), selected = null;
    let previous = [], boundaries = [], frameBand = [0, 0], frameFilter = false, timer = 0;

    function build() {
      const duration = DUR || LIVE?.duration || (LIVE?.frames || SNAP?.frames || 0) / FPS;
      const limit = FRAMES || Math.round(duration * FPS);
      const tracks = [], sceneList = [];
      const keys = new Map();
      function track(id, title, kind) {
        const group = { id, title, kind, clips: [] };
        tracks.push(group);
        return group;
      }
      function clip(group, start, end, title, meta = {}) {
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
        const from = Math.max(0, Math.round(start * FPS));
        if (limit && from >= limit) return null;
        const to = Math.min(limit ? limit - 1 : Infinity, Math.max(from, Math.round(end * FPS) - 1));
        if (to < from) return null;
        const stem = JSON.stringify([group.id, meta.ref || title, from]);
        const ordinal = keys.get(stem) ?? 0;
        keys.set(stem, ordinal + 1);
        const id = stem + ordinal;
        const item = { ...meta, id, title: String(title), from, to, group };
        item.search = normalize([group.title, title, meta.ref, meta.file, meta.text].join(' '));
        group.clips.push(item);
        return item;
      }
      if (PROJ) {
        const sceneTrack = LIVE?.tracks?.find(t => t.type === 'band' && t.clips?.length);
        for (const tr of LIVE?.tracks ?? []) {
          const group = track(tr.id, tr.name, tr.type);
          for (const c of tr.clips ?? []) {
            const item = clip(group, c.t0, c.t1, c.label, { sourceItem: c, ref: c.ref, file: c.file || c.src, off: c.off });
            if (item && tr === sceneTrack) sceneList.push(item);
          }
        }
        if (!tracks.some(g => (g.kind === 'video' || g.kind === 'band') && g.clips.length) && (META?.render || META?.features?.code) && duration > 0) {
          clip(track('export', tx('Montage', 'Edit'), 'video'), 0, duration, META.render?.name || META.title, {sourceItem:META.render || META});
        }
      } else {
        const source = visibleTimelineSource();
        const sets = track('sets', tx('Décors', 'Sets'), 'band');
        for (const set of source?.sets ?? []) {
          const item = clip(sets, set.inT, set.outT == null ? duration : set.outT + (set.outDur || 0),
            set.name ?? set.id, { sourceItem: set, ref: set.id });
          if (item) sceneList.push(item);
        }
        const shots = track('shots', T('st.lane.shot3d'), 'video');
        for (const c of source?.cutaways ?? []) clip(shots, c.t, c.t + c.dur, c.name ?? c.id, { sourceItem: c, ref: c.id });
        const actors = new Map();
        function actor(id) {
          if (!actors.has(id)) actors.set(id, track('actor:' + id, who(id), 'voice'));
          return actors.get(id);
        }
        for (const s of source?.says ?? []) {
          clip(actor(s.actor), s.t, s.t + s.dur, s.text || s.id, { sourceItem: s, ref: s.id, file: s.audio });
        }
        const camera = track('camera', T('st.insp.camera'), 'camera');
        for (const c of LIVE?.camera ?? []) {
          const title = c.v?.fov == null ? camera.title : `${camera.title} · ${c.v.fov}°`;
          clip(camera, c.t, c.t + (c.dur || 0), title, { sourceItem: c });
        }
        const light = track('light', T('st.insp.light'), 'light');
        for (const [i, c] of (LIVE?.light ?? []).entries()) {
          clip(light, c.t, LIVE.light[i + 1]?.t ?? duration, String(c.v), { sourceItem: c });
        }
        const music = track('music', T('st.insp.music'), 'audio'), ambience = track('amb', T('st.lane.amb'), 'audio');
        for (const m of LIVE?.music ?? []) clip(m.channel === 'music' ? music : ambience, m.t, m.until, m.name, { sourceItem: m, file: m.src, off: m.volume <= 0 });
        const sound = track('sfx', T('st.lane.sfx'), 'audio');
        for (const s of LIVE?.sfx ?? []) clip(sound, s.t, s.t, s.name, { sourceItem: s, file: s.src, marker: true });
      }
      for (const t of tracks) t.clips.sort((a, b) => a.from - b.from || a.to - b.to);
      groups = tracks.filter(t => t.clips.length);
      scenes = sceneList;
      entries = new Map(groups.flatMap(g => g.clips.map(c => [c.id, c])));
      boundaries = [...new Set([0, ...groups.flatMap(g => g.clips.flatMap(c => [c.from, c.to + 1]))])].sort((a, b) => a - b);
      const scope = scenePicker.value;
      scenePicker.replaceChildren(new Option(allScenes, ''), ...scenes.map(c => new Option(c.title, c.id)));
      scenePicker.value = entries.has(scope) ? scope : '';
      scenePicker.closest('label').hidden = !scenes.length;
      if (!entries.has(selected)) selected = null;
      drawDetail();
    }

    const frameText = f => tx('Image ', 'Frame ') + f;
    function drawDetail() {
      const c = entries.get(selected);
      inspector.hidden = !c;
      inspector.replaceChildren();
      if (!c) return;
      function detail(key, value) { return `<div><dt>${key}</dt><dd>${esc(value)}</dd></div>`; }
      const length = c.to - c.from + 1;
      inspector.innerHTML = `<div class="cx-detail-head"><span class="cx-kind" data-kind="${esc(c.group.kind)}"></span>
        <small>${esc(c.group.title)}</small><button type="button" class="cx-close" aria-label="${tx('Fermer les détails', 'Close details')}">${ic('x')}</button></div>
        <b class="cx-title">${esc(c.title)}</b><dl>
        ${detail(tx('Durée', 'Duration'), c.marker ? tx('Déclenchement', 'Trigger') : length + ' ' + tx(length === 1 ? 'image' : 'images', length === 1 ? 'frame' : 'frames') + ' · ' + fmt(length / FPS))}
        ${c.ref ? detail(tx('Référence', 'Reference'), c.ref) : ''}
        ${c.file ? detail(tx('Source', 'Source'), c.file) : ''}
        ${c.off ? detail(tx('État', 'State'), tx('Désactivé', 'Disabled')) : ''}
        </dl><div class="cx-ends"><button type="button" data-edge="from">${ic('start')}${frameText(c.from)}</button>
        ${c.to > c.from ? `<button type="button" data-edge="to">${ic('end')}${frameText(c.to)}</button>` : ''}</div>
        <div class="cx-edit-actions">
          ${length > 1 ? `<button type="button" data-timing="trim" aria-expanded="false" aria-controls="cxTimingForm">${tx('Proposer une coupe', 'Propose a trim')}</button>` : ''}
          <button type="button" data-timing="move" aria-expanded="false" aria-controls="cxTimingForm">${tx('Proposer un déplacement', 'Propose a move')}</button>
        </div><form id="cxTimingForm" class="cx-timing" hidden></form>`;
    }

    function openTiming(c, operation) {
      const form = inspector.querySelector('.cx-timing');
      const closing = !form.hidden && form.dataset.operation === operation;
      for (const button of inspector.querySelectorAll('[data-timing]')) {
        button.setAttribute('aria-expanded', String(!closing && button.dataset.timing === operation));
      }
      form.hidden = closing;
      if (closing) return;
      const moving = operation === 'move';
      const number = (name, label, value, min, max) => `<label>${label}<input name="${name}" type="number" step="1" required min="${min}" max="${max}" value="${value}"></label>`;
      form.dataset.operation = operation;
      form.innerHTML = `<div class="cx-timing-fields">${moving
        ? number('offset', tx('Décalage en images', 'Offset in frames'), 0, -c.from, FRAMES - 1 - c.to)
        : number('start', tx('Première image', 'First frame'), c.from, c.from, c.to)
          + number('end', tx('Dernière incluse', 'Last, inclusive'), c.to, c.from, c.to)}</div>
        <output aria-live="polite"></output>
        <button type="submit" class="primary" disabled>${tx('Ajouter à la file', 'Add to queue')}</button>`;
      const readRange = () => moving
        ? {from: c.from + form.elements.offset.valueAsNumber, to: c.to + form.elements.offset.valueAsNumber}
        : {from: form.elements.start.valueAsNumber, to: form.elements.end.valueAsNumber};
      const submit = form.querySelector('[type="submit"]');
      function validate() {
        const {from, to} = readRange();
        const inside = Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && to < FRAMES && from <= to;
        const valid = inside && (moving || (from >= c.from && to <= c.to));
        const changed = from !== c.from || to !== c.to;
        const boundsText = moving
          ? tx('Décalage autorisé', 'Allowed offset') + ' ' + (-c.from) + '…' + (FRAMES - 1 - c.to)
          : tx('Coupe possible entre les images', 'Trim within frames') + ' ' + c.from + '…' + c.to;
        form.querySelector('output').textContent = valid
          ? `${tx('Images', 'Frames')} ${from}–${to} · ${to - from + 1} ${tx('images de durée', 'frames long')}`
          : boundsText + ' · ' + tx('images entières', 'whole frames');
        submit.disabled = !valid || !changed || !NOTES_OK;
        return !submit.disabled;
      }
      form.oninput = validate;
      form.onsubmit = event => {
        event.preventDefault();
        // A new timeline can arrive while this inspector is open. Require a fresh
        // choice if it rebuilt the detail or changed the available frame range.
        refresh();
        if (!form.isConnected || form.hidden || submit.disabled || !validate()) return;
        submit.disabled = true;
        const proposed = readRange(), original = {from: c.from, to: c.to};
        const timing = {schemaVersion: 1, operation, frameConvention: 'zero-based-inclusive',
          compositionFrames: FRAMES, fps: FPS, trackId: c.group.id, trackName: c.group.title,
          clipId: c.id, clipTitle: c.title, ref: c.ref ?? null, file: c.file ?? null,
          original, proposed, offsetFrames: moving ? proposed.from - c.from : null};
        const describe = r => r.from + '–' + r.to;
        const text = [
          moving ? tx('Proposer un déplacement', 'Propose a move') : tx('Proposer une coupe', 'Propose a trim'),
          tx('Clip', 'Clip') + ' « ' + c.title + ' » · ' + tx('piste', 'track') + ' ' + c.group.id + ' (' + c.group.title + ').',
          tx('Images de composition, numérotées de 0, bornes incluses', 'Composition frames, zero-based, inclusive endpoints') + ' · ' + FPS + ' fps.',
          tx('Origine', 'Original') + ' ' + describe(original) + ' → ' + tx('proposition', 'proposed') + ' ' + describe(proposed) + '.',
          moving ? tx('Décalage', 'Offset') + ' ' + timing.offsetFrames + ' · ' + tx('durée conservée', 'duration preserved') + '.' : '',
          c.ref ? tx('Référence', 'Reference') + ' ' + c.ref + '.' : '',
          c.file ? tx('Source', 'Source') + ' ' + c.file : '',
        ].filter(Boolean).join('\n');
        window.CoulissesWorkspace?.showPanel('left');
        const note = addNote(c.from, c.to, true, {text, timing});
        if (note) {
          form.hidden = true;
          inspector.querySelectorAll('[data-timing]').forEach(b => b.setAttribute('aria-expanded', 'false'));
        } else validate();
      };
      validate();
      form.querySelector('input').focus();
    }
    function jump(f) {
      if (FRAMES <= 0) return;
      M.pause();
      seekFrame(f);
    }
    inspector.addEventListener('click', e => {
      const c = entries.get(selected);
      if (!c) return;
      if (e.target.closest('.cx-close')) {
        const key = selected; selected = null; drawDetail();
        const former = [...tree.querySelectorAll('[data-clip]')].find(b => b.dataset.clip === key);
        former?.removeAttribute('aria-current'); (former ?? search).focus();
      } else if (e.target.closest('[data-timing]')) {
        openTiming(c, e.target.closest('[data-timing]').dataset.timing);
      } else {
        const b = e.target.closest('[data-edge]');
        if (b) jump(c[b.dataset.edge]);
      }
    });
    inspector.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key !== 'Escape') return;
      const form = inspector.querySelector('.cx-timing');
      if (form && !form.hidden) {
        e.preventDefault();
        const button = inspector.querySelector('[data-timing="' + form.dataset.operation + '"]');
        button.click(); button.focus();
      }
    });
    inspector.addEventListener('keyup', e => e.stopPropagation());

    function renderTree() {
      const words = normalize(search.value).trim().split(/\s+/).filter(Boolean);
      const scope = entries.get(scenePicker.value), f = curFrame();
      if (frameFilter) {
        const end = boundaries.findIndex(b => b > f);
        frameBand = [end < 0 ? boundaries.at(-1) : boundaries[end - 1], end < 0 ? Infinity : boundaries[end]];
      }
      const focusKey = tree.contains(document.activeElement) ? document.activeElement.dataset.clip ?? document.activeElement.dataset.track : null;
      const frag = document.createDocumentFragment();
      for (const group of groups) {
        const matches = group.clips.filter(c => (!scope || (c.from <= scope.to && c.to >= scope.from))
          && (!frameFilter || (c.from <= f && c.to >= f)) && words.every(word => c.search.includes(word)));
        if (!matches.length) continue;
        const groupEl = document.createElement('details');
        const filtered = words.length || frameFilter || scope;
        groupEl.open = filtered ? !closedGroups.has(group.id) : openGroups.has(group.id) || (!closedGroups.has(group.id) && group === groups[0]);
        const head = document.createElement('summary');
        head.dataset.track = group.id;
        head.innerHTML = `${ic('right')}<span class="cx-kind" data-kind="${esc(group.kind)}"></span><span>${esc(group.title)}</span><small>${matches.length}</small>`;
        groupEl.append(head);
        const populate = () => {
          if (groupEl.childElementCount > 1) return;
          const rows = document.createDocumentFragment();
          for (const c of matches) {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'cx-clip'; b.dataset.clip = c.id;
            b.title = `${c.title} · ${frameText(c.from)}`;
            if (c.id === selected) b.setAttribute('aria-current', 'true');
            if (c.off) b.classList.add('cx-off');
            b.innerHTML = `<span>${esc(c.title)}</span><time>${fmtS(c.from / FPS)}</time>`;
            rows.append(b);
          }
          groupEl.append(rows);
        };
        if (groupEl.open) populate();
        groupEl.addEventListener('toggle', () => {
          if (!groupEl.isConnected || !groupEl.open) return;
          populate();
        });
        head.addEventListener('click', () => {
          if (groupEl.open) { openGroups.delete(group.id); closedGroups.add(group.id); }
          else { openGroups.add(group.id); closedGroups.delete(group.id); }
        });
        frag.append(groupEl);
      }
      if (!frag.childNodes.length) {
        const msg = document.createElement('p');
        msg.className = 'cx-empty';
        msg.textContent = groups.length ? tx('Aucun élément pour ce filtre.', 'No items match this filter.')
          : tx('Aucune piste disponible pour cette composition.', 'No tracks available for this composition.');
        frag.append(msg);
      }
      const scroll = tree.scrollTop;
      tree.replaceChildren(frag);
      tree.scrollTop = scroll;
      if (focusKey != null) {
        const target = [...tree.querySelectorAll('button, summary')].find(el => (el.dataset.clip ?? el.dataset.track) === focusKey);
        (target ?? search).focus({ preventScroll: true });
      }
    }
    function refreshModel() {
      const next = [META, SNAP, LIVE, FRAMES, FPS, DUR, mode];
      if (next.every((v, i) => v === previous[i])) return false;
      previous = next; build(); return true;
    }
    function refresh(force = false) {
      if (!panel.classList.contains('on') || !panel.getClientRects().length) return;
      if (refreshModel() || force || (frameFilter && (curFrame() < frameBand[0] || curFrame() >= frameBand[1]))) renderTree();
    }
    window.CoulissesLayers = {
      inspect(trackId, source) {
        refreshModel();
        // If the data was republished after the canvas painted, refuse its stale
        // hit; two same-named clips may occupy exactly the same track and frames.
        const c = groups.find(g => g.id === trackId)?.clips.find(item => item.sourceItem === source);
        if (!c) return false;
        const scope = entries.get(scenePicker.value);
        if (scope && (c.to < scope.from || c.from > scope.to)) scenePicker.value = '';
        if (normalize(search.value).trim().split(/\s+/).some(word => !c.search.includes(word))) search.value = '';
        if (frameFilter && (curFrame() < c.from || curFrame() > c.to)) {
          frameFilter = false; at.setAttribute('aria-pressed', 'false');
        }
        selected = c.id; closedGroups.delete(trackId); openGroups.add(trackId);
        window.CoulissesWorkspace?.showPanel('right'); setTab('composition');
        renderTree(); drawDetail();
        const row = tree.querySelector('[aria-current="true"]');
        row?.scrollIntoView({block:'nearest'}); row?.focus({preventScroll:true});
        return true;
      },
    };
    tree.addEventListener('click', event => {
      const row = event.target.closest('[data-clip]');
      const c = entries.get(row?.dataset.clip);
      if (!c) return;
      selected = c.id;
      tree.querySelector('[aria-current]')?.removeAttribute('aria-current');
      row.setAttribute('aria-current', 'true');
      drawDetail();
      jump(Math.max(c.from, entries.get(scenePicker.value)?.from ?? 0));
    });
    tree.addEventListener('keydown', event => {
      const target = event.target.closest('button,summary');
      if (!target) return;
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) target.click();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const list = [...tree.querySelectorAll('summary,details[open] > button')];
      const i = list.indexOf(target), group = target.closest('details'), head = group.querySelector('summary');
      if (event.key === 'ArrowLeft') { if (target === head && group.open) head.click(); else head.focus(); }
      else if (event.key === 'ArrowRight') { if (!group.open) head.click(); else group.querySelector('button')?.focus(); }
      else list[event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : Math.max(0, Math.min(i + (event.key === 'ArrowDown' ? 1 : -1), list.length - 1))]?.focus();
    });
    search.addEventListener('input', () => { closedGroups.clear(); renderTree(); });
    scenePicker.addEventListener('change', () => {
      const c = entries.get(scenePicker.value);
      if (c) jump(c.from);
      closedGroups.clear(); renderTree();
    });
    at.addEventListener('click', () => {
      frameFilter = !frameFilter;
      at.setAttribute('aria-pressed', String(frameFilter));
      closedGroups.clear(); renderTree();
    });
    tabButton.addEventListener('click', () => setTab('composition'));
    new MutationObserver(() => {
      clearInterval(timer);
      if (panel.classList.contains('on')) {
        refresh(true);
        timer = setInterval(() => refresh(), 400);
      }
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  })();

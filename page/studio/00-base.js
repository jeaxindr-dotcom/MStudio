// The studio's page (studio.html), part 00: the page's helpers and texts, the line icons, the panels (sizes, the image fitted in its area).
// The parts of page/studio/ are one script: studio-server.mjs joins them in their order inside one function (/studio.js),
// so they share their names as the one inline script did; hence the two-space indent.
  const $ = (s) => document.querySelector(s);
  // the texts of the page, in the user's language: window.T(key, values), given by studio-server.mjs (lib/i18n.mjs, « st.* »)
  const I18N = window.__I18N ?? { lang: 'fr', dict: {} }, LANG = I18N.lang, FR = LANG === 'fr', T = window.T ?? ((k) => k);
  // numbers and dates: French keeps the formats it always had (decimal comma, the browser's own date formats)
  const dec = (x) => (FR ? String(x).replace('.', ',') : String(x));
  const hm5 = (d) => (FR ? d.toLocaleTimeString() : d.toLocaleTimeString('en-GB')).slice(0, 5);
  const v = $('#v'), cv = $('#tl'), tip = $('#tip'), ov = $('#ov'), media = $('#media');
  let codeEl = $('#code');   // the live preview's frame (a new version of the code comes in a new one, then takes its place)
  let META = null, SNAP = null, LIVE = null, FPS = 30, FRAMES = 0, DUR = 0, MAXQ = 0;   // the most pending edits: 0 = no limit
  let CW = 1920, CH = 1080;                    // the frame's pixels (1920×1080 for an episode; a project: its video's): every mark is stored in these
  let PROJ = false;                            // an imported project (AItelier run, any video), not a Brambleshire episode
  // a project whose code is played live and exported from the studio: a Remotion run, or a HyperFrames project (09/10/2026)
  const LIVEP = () => META?.kind === 'remotion' || META?.kind === 'hyperframes';
  let notes = [], sel = null, loopId = null, stopAt = null, rangeStart = null;
  let REPLIES = { notes: {} };
  let STATUS = { lots: [], agent: {}, code: {}, timeline: {} };
  const pending = {};
  let view = { a: 0, b: 1 };
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const C = {};
  const uid = () => Math.random().toString(36).slice(2, 10);
  const now = () => new Date().toISOString();
  // a value of the live preview's frame made this page's own (a JSON copy): nothing of a preview's world may stay referenced
  // from here once it is replaced, or every version of the code stays in memory (user bug 17/10/2026, E11: 7,8 Go after an
  // evening of edits by the agent, the studio slower and slower, « Accueil » long to come)
  const plain = (x) => (x === null || x === undefined ? x : JSON.parse(JSON.stringify(x)));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = sharedAppearance;

  // ---------- line icons (after Lucide, ISC licence) ----------
  const ICONS = {
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    pointer: '<path d="M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.43 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z"/>',
    pen: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
    comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    range: '<path d="M8 4H5v16h3"/><path d="M16 4h3v16h-3"/><path d="M9 12h6"/>',
    code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
    film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 12h18M3 7.5h4M3 16.5h4M17 7.5h4M17 16.5h4"/>',
    play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
    fit: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    volume: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.59A1.4 1.4 0 0 1 5.42 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.42a1.4 1.4 0 0 1 1 .41l3.38 3.39a.7.7 0 0 0 1.2-.5z"/><path d="M16 9a5 5 0 0 1 0 6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
    send: '<path d="M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.63l-19 6.5a.5.5 0 0 0-.02.93l7.93 3.18a2 2 0 0 1 1.11 1.11z"/><path d="m21.85 2.15-10.94 10.94"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    goto: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    question: '<path d="M8.6 8.6a3.5 3.5 0 0 1 6.8 1.2c0 2.3-3.4 3.2-3.4 3.2"/><path d="M12 17.5h.01"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    pin: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.6"/>',
    stroke: '<path d="M4 17c3-6 7 2 10-3s4-6 6-4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    start: '<path d="M6 4v16"/><path d="M18 12H10m4-4-4 4 4 4"/>', end: '<path d="M18 4v16"/><path d="M6 12h8m-4-4 4 4-4 4"/>',
    point: '<path d="M12 4v16"/><circle cx="12" cy="12" r="3"/>',
    move: '<path d="M12 2v20M2 12h20"/><path d="m15 19-3 3-3-3M19 9l3 3-3 3M5 9l-3 3 3 3M9 5l3-3 3 3"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    sparkle: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    minus: '<path d="M5 12h14"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
    rotate: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    scale: '<path d="M21 3 9 15"/><path d="M12 3H3v18h18v-9"/><path d="M16 3h5v5"/><path d="M14 15H9v-5"/>',
  };
  const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
  document.querySelectorAll('i[data-ic]').forEach((el) => { el.outerHTML = ic(el.dataset.ic); });

  // ---------- panels: sizes (dragged splitters, remembered), image fitted in its area ----------
  // three columns: the agent's (--lside, on the left), the image, the media and notes (--side, on the right); the image
  // keeps at least IMG_MIN px: on a narrow window the two panels give way, in proportion (what was dragged is kept)
  const root = document.documentElement;
  const L_MIN = 280, S_MIN = 300, IMG_MIN = 420, CHROME = 6 * 2 + 46 + 6 * 2;   // #app's padding, the rail, the two splitters
  function applySizes() {
    let l = store.get('lside', 300), s = store.get('side', 340);
    const room = window.innerWidth - CHROME - IMG_MIN;
    if (l + s > room) { const k = Math.max(0, room - L_MIN - S_MIN) / Math.max(1, l - L_MIN + s - S_MIN); l = L_MIN + (l - L_MIN) * Math.min(1, k); s = S_MIN + (s - S_MIN) * Math.min(1, k); }
    root.style.setProperty('--lside', Math.round(l) + 'px'); root.style.setProperty('--side', Math.round(s) + 'px');
    root.style.setProperty('--tlh', Math.round(Math.max(150, Math.min(window.innerHeight - 340, store.get('tlh', Math.min(300, window.innerHeight * 0.32))))) + 'px');
  }
  applySizes();
  function splitter(el, axis) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('drag');
      const room = window.innerWidth - CHROME - IMG_MIN;
      const move = (ev) => {
        if (axis === 'l') store.set('lside', Math.round(Math.max(L_MIN, Math.min(room - parseFloat(css('--side')), ev.clientX - $('#lside').getBoundingClientRect().left))));
        else if (axis === 'x') store.set('side', Math.round(Math.max(S_MIN, Math.min(room - parseFloat(css('--lside')), window.innerWidth - 6 - ev.clientX))));
        else store.set('tlh', Math.round(Math.max(150, Math.min(window.innerHeight - 300, window.innerHeight - ev.clientY))));
        applySizes(); fitMedia(); resize();
      };
      const up = () => { el.classList.remove('drag'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  }
  splitter($('#splitL'), 'l'); splitter($('#splitV'), 'x'); splitter($('#splitH'), 'y');
  function fitMedia() {
    const box = $('#stagewrap').getBoundingClientRect(), w = Math.max(160, box.width - 32), h = Math.max(90, box.height - 28);
    const R = CW / CH, W0 = Math.floor(Math.min(w, h * R)), H0 = Math.floor(W0 / R);
    v.style.width = W0 + 'px'; v.style.height = H0 + 'px';
    applyView();
  }
  // ---------- the image's zoom (user request, 09/10/2026): the wheel zooms in / out where the mouse is, the middle
  // button drags the image, Maj+Z (or the « 200 % » label) puts it back whole. The whole image zooms (the MP4, the live
  // code, the marks); the pins' labels and the « what should change here? » box keep their size (--iz) ----------
  const VZ = { k: 1, x: 0, y: 0 };   // the zoom, and where the zoomed image's corner is in the frame of the image (px)
  function applyView() {
    const st = $('#stage'), W = st.clientWidth, H = st.clientHeight;
    VZ.k = Math.max(1, Math.min(8, VZ.k || 1));
    if (VZ.k < 1.005) { VZ.k = 1; VZ.x = 0; VZ.y = 0; }
    VZ.x = Math.min(0, Math.max(W - W * VZ.k, VZ.x)); VZ.y = Math.min(0, Math.max(H - H * VZ.k, VZ.y));   // the image always fills its frame
    media.style.transform = VZ.k === 1 ? '' : `translate(${VZ.x}px, ${VZ.y}px) scale(${VZ.k})`;
    media.style.setProperty('--iz', String(1 / VZ.k));
    const b = $('#zoomBadge');
    if (b) { b.style.display = VZ.k > 1 ? '' : 'none'; b.querySelector('.t').textContent = `${Math.round(VZ.k * 100)}${FR ? ' %' : '%'}`; b.querySelector('kbd').textContent = window.Shortcuts?.show?.('viewReset') || ''; }
    if (typeof drawOv === 'function') drawOv();
  }
  function zoomViewAt(cx, cy, f) {   // the point under (cx, cy) stays under it
    const s = $('#stage').getBoundingClientRect(), ux = (cx - s.left - VZ.x) / VZ.k, uy = (cy - s.top - VZ.y) / VZ.k;
    const k = Math.max(1, Math.min(8, VZ.k * f));
    VZ.x = cx - s.left - k * ux; VZ.y = cy - s.top - k * uy; VZ.k = k; applyView();
  }
  const resetView = () => { VZ.k = 1; applyView(); };
  {
    const wrap = $('#stagewrap');
    wrap.addEventListener('wheel', (e) => {
      if (e.target.closest?.('#pop, #pickBtn, #zoomBadge')) return;   // the box's text scrolls as usual
      e.preventDefault();
      const d = e.deltaY || e.deltaX; if (d) zoomViewAt(e.clientX, e.clientY, Math.exp(-d * 0.0015));
    }, { passive: false });
    let pan = null;
    wrap.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });   // not the browser's autoscroll
    wrap.addEventListener('pointerdown', (e) => {
      if (e.button !== 1 || VZ.k === 1) return;
      e.preventDefault(); pan = { x: e.clientX, y: e.clientY, x0: VZ.x, y0: VZ.y }; wrap.setPointerCapture(e.pointerId); wrap.classList.add('panning');
    });
    wrap.addEventListener('pointermove', (e) => { if (!pan) return; VZ.x = pan.x0 + e.clientX - pan.x; VZ.y = pan.y0 + e.clientY - pan.y; applyView(); });
    const end = () => { if (!pan) return; pan = null; wrap.classList.remove('panning'); };
    wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end);
    $('#zoomBadge').onclick = resetView;
  }
  new ResizeObserver(() => { fitMedia(); }).observe($('#stagewrap'));
  // two groups of tabs, each with its own one shown: the agent's column (Agent · Modifs · Envois) and the right panel
  // (Médias · Notes · Scène · Inspecteur); `tab` is the last one chosen, onTab(t) says whether t is shown
  const LEFT = new Set(['agent', 'queue', 'lots']);
  const tab0 = store.get('tab', null);   // the one tab of the earlier layout: kept in its group
  let tabL = store.get('tabL', LEFT.has(tab0) ? tab0 : 'agent'), tabR = store.get('tabR', tab0 && !LEFT.has(tab0) ? tab0 : 'composition');
  let tab = tabL;
  const onTab = (t) => (LEFT.has(t) ? tabL : tabR) === t;
  function setTab(t, reveal = true) {
    const left = LEFT.has(t), bar = left ? '#ltabs' : '#tabs';
    if (!document.querySelector(`${bar} button[data-tab="${t}"]`)) return;
    const side = left ? 'left' : 'right';
    if (reveal && !document.body.classList.contains('cg') && document.body.classList.contains('ws-hide-' + side)) {
      window.CoulissesWorkspace?.showPanel(side);
    }
    tab = t;
    if (left) { tabL = t; store.set('tabL', t); } else { tabR = t; store.set('tabR', t); }
    document.querySelectorAll(`${bar} button`).forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelector(`${bar} button[data-tab="${t}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    document.querySelectorAll(`${left ? '#lside' : '#side'} > .tab`).forEach((x) => x.classList.toggle('on', x.id === 'tab-' + t));
    if (t === 'insp') renderInspector(true);
    if (t === 'lots') renderLots();
    if (t === 'scene') renderScene();
    if (!left) { if (t === 'medias') window.CoulissesMedias?.show(); else window.CoulissesMedias?.hide(); }
  }
  document.querySelectorAll('.tabbar button[data-tab]').forEach((b) => b.onclick = () => b.dataset.tab === 'scene' ? window.CoulissesScene.open() : setTab(b.dataset.tab));
  $('#helpBtn').onclick = () => window.Shortcuts?.open();   // Aide › Raccourcis clavier (shortcuts.js)
  // « Langue · Language » (Édition › Préférences): the user's choice for the whole app (settings.json, via
  // the server); the notes are saved first, and the page comes back in the new language on the same frame
  async function setLanguage(l) {
    if (l === LANG) return true;
    await flushNow();
    const r = await fetch('/api/lang', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: l }) }).then((x) => x.json()).catch(() => null);
    if (!r?.ok) return false;
    return reloadSafely();
  }
  // the « … » menu of a card
  const menu = $('#menu');
  function openMenu(anchor, items) {
    menu.innerHTML = '';
    for (const it of items) {
      if (it === '-') { menu.appendChild(document.createElement('hr')); continue; }
      const b = document.createElement('button'); b.innerHTML = `${ic(it.icon)}${esc(it.label)}`; if (it.danger) b.classList.add('danger');
      b.onclick = () => { closeMenu(); it.run(); }; menu.appendChild(b);
    }
    menu.classList.add('open');
    const r = anchor.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw)) + 'px';
    menu.style.top = (r.bottom + mh + 6 > window.innerHeight ? r.top - mh - 6 : r.bottom + 6) + 'px';
  }
  const closeMenu = () => menu.classList.remove('open');
  document.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target) && !e.target.closest('.more')) closeMenu(); });


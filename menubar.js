// The menu bar of Coulisses (« Fichier · Édition · Outils · Aide »), at the top of the home screen and of the studio: the
// app's window is Chrome in --app mode (app\Launcher.cs), so the bar is HTML that behaves like a native one. Served by
// hub-server.mjs and studio-server.mjs at /menubar.js; each page gives its own menus, and every item calls a feature
// that already exists in the page. Labels come from the page (window.T, lib/i18n.mjs « menu.* »).
//   MenuBar.mount(nav, [{ label, items: [item | '-'] }])
//     item = { id, label: string | () => string, key?: 'Ctrl+O', run?: () => …, disabled?: () => false | 'why',
//              hidden?: () => bool, items?: () => [item | '-'] (a submenu) }
//   MenuBar.dialog({ title, text | html, pre, buttons: [{ label, primary, run }] })   a small window of the app
// Mouse: a click opens a menu, hovering moves between the open menus, a click outside closes. Keyboard: Alt (alone) or
// F10 focuses the bar, ←/→ between menus, ↓/Enter opens, ↑/↓ in a menu, → opens a submenu, Enter runs, Escape closes.
(() => {
  const css = `
  #menubar { position: relative; z-index: 90; display: flex; align-items: center; gap: 1px; height: 28px; padding: 0 6px; flex: none;
    background: rgba(7, 8, 13, 0.94); border-bottom: 1px solid rgba(255, 255, 255, 0.07); color: #aeb2c4;
    font: 500 12.5px "Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; user-select: none; -webkit-user-select: none; }
  #menubar > button { all: unset; height: 22px; padding: 0 9px; border-radius: 6px; line-height: 22px; cursor: default; color: inherit; }
  #menubar > button:hover, #menubar > button.open, #menubar.focus > button.cur { background: rgba(255, 255, 255, 0.09); color: #f4f5fa; }
  #menubar > button.open { background: rgba(201, 242, 107, 0.16); color: #f4f5fa; }
  .mb-menu { position: fixed; z-index: 95; min-width: 250px; max-width: 460px; padding: 5px; border-radius: 10px; background: rgba(20, 22, 33, 0.98);
    border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55); color: #f4f5fa;
    font: 500 12.5px "Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; user-select: none; -webkit-user-select: none; }
  .mb-item { display: flex; align-items: center; gap: 22px; height: 28px; padding: 0 10px 0 12px; border-radius: 6px; white-space: nowrap; cursor: default; }
  .mb-item .l { overflow: hidden; text-overflow: ellipsis; }
  .mb-item .k { margin-left: auto; color: #8a8fa6; font-size: 11.5px; }
  .mb-item .s { margin-left: auto; color: #8a8fa6; }
  .mb-item.cur { background: rgba(201, 242, 107, 0.16); }
  .mb-item.off { color: #5f647a; } .mb-item.off .k { color: #4c5064; }
  .mb-sep { height: 1px; margin: 4px 8px; background: rgba(255, 255, 255, 0.1); }
  .mb-dlg { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: rgba(5, 6, 10, 0.55); backdrop-filter: blur(8px); }
  .mb-dlg .box { width: min(760px, 92vw); max-height: 86vh; display: flex; flex-direction: column; gap: 10px; padding: 20px 22px; border-radius: 22px;
    background: rgba(22, 24, 36, 0.96); border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 40px 100px rgba(0, 0, 0, 0.6); color: #f4f5fa;
    font: 13px/1.55 "Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }
  .mb-dlg h2 { margin: 0; font: 600 19px "Outfit", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif; }
  .mb-dlg .body { overflow: auto; min-height: 0; color: #aeb2c4; }
  .mb-dlg .body.pre { white-space: pre-wrap; font: 12px/1.6 "JetBrains Mono", "Cascadia Mono", Consolas, monospace; color: #f4f5fa; background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.075); border-radius: 14px; padding: 12px 14px; user-select: text; -webkit-user-select: text; }
  .mb-dlg .body b { color: #f4f5fa; } .mb-dlg .body a { color: #c9f26b; }
  .mb-dlg .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 6px 0; }
  .mb-dlg .row .lbl { min-width: 120px; color: #aeb2c4; }
  .mb-dlg .b { display: flex; gap: 8px; justify-content: flex-end; }
  .mb-dlg button { display: inline-flex; align-items: center; height: 34px; padding: 0 16px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.14); background: rgba(255, 255, 255, 0.06); color: #f4f5fa;
    font: 500 12.5px "Outfit", "Segoe UI", system-ui, sans-serif; cursor: pointer; box-shadow: none; filter: none; }
  .mb-dlg button.on { background: #f4f5fa; color: #11131c; border-color: transparent; }
  .mb-dlg button.primary { background: linear-gradient(135deg, #dcf77a 0%, #9dee9a 48%, #6fe2c9 100%); color: #10140a; border: 0; font-weight: 600; }
  .mb-dlg button:disabled { opacity: .45; cursor: default; }`;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const val = (x) => (typeof x === 'function' ? x() : x);

  let bar = null, MENUS = [], openI = -1, stack = [], barFocus = false, altAlone = false;
  // stack: the open menus, [{ el, items, cur, parentRow }]: stack[0] is the top menu, the others its submenus
  function closeAll() {
    for (const m of stack) m.el.remove();
    stack = []; openI = -1;
    bar?.querySelectorAll(':scope > button').forEach((b) => b.classList.remove('open'));
  }
  function leaveBar() { closeAll(); barFocus = false; bar?.classList.remove('focus'); bar?.querySelectorAll(':scope > button').forEach((b) => b.classList.remove('cur')); }
  function focusBar(i = 0) { closeAll(); barFocus = true; bar.classList.add('focus'); setBarCur(i); }
  function setBarCur(i) { bar.querySelectorAll(':scope > button').forEach((b, k) => b.classList.toggle('cur', k === i)); bar.dataset.cur = i; }
  const visible = (items) => (items ?? []).filter((it) => it === '-' || !val(it.hidden));
  // a menu: its rows, placed under its button (or beside its parent row), kept on screen
  function buildMenu(items, anchor, side) {
    const el = document.createElement('div'); el.className = 'mb-menu'; el.setAttribute('role', 'menu');
    const list = visible(items).filter((it, k, a) => !(it === '-' && (k === 0 || a[k - 1] === '-' || k === a.length - 1)));
    const rows = [];
    for (const it of list) {
      if (it === '-') { const s = document.createElement('div'); s.className = 'mb-sep'; el.appendChild(s); continue; }
      const why = val(it.disabled), sub = !!it.items, r = document.createElement('div');
      r.className = 'mb-item' + (why ? ' off' : ''); r.setAttribute('role', 'menuitem'); if (it.id) r.dataset.id = it.id;
      if (why) { r.title = why; r.setAttribute('aria-disabled', 'true'); }
      r.innerHTML = `<span class="l">${esc(val(it.label))}</span>${it.key ? `<span class="k">${esc(val(it.key))}</span>` : ''}${sub ? '<span class="s">›</span>' : ''}`;
      r.__item = it; r.__off = !!why; rows.push(r); el.appendChild(r);
    }
    document.body.appendChild(el);
    const a = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    let x = side ? a.right + 2 : a.left, y = side ? a.top - 5 : a.bottom + 2;
    if (side && x + w > innerWidth - 6) x = a.left - w - 2;
    x = Math.max(6, Math.min(innerWidth - w - 6, x)); y = Math.max(6, Math.min(innerHeight - h - 6, y));
    el.style.left = x + 'px'; el.style.top = y + 'px';
    const level = { el, rows, cur: -1 };
    rows.forEach((r, k) => {
      r.addEventListener('mouseenter', () => { setCur(level, k); if (r.__item.items && !r.__off) openSub(level, k); else closeSubs(level); });
      r.addEventListener('click', (e) => { e.stopPropagation(); activate(level, k); });
    });
    return level;
  }
  function setCur(level, k) { level.cur = k; level.rows.forEach((r, j) => r.classList.toggle('cur', j === k)); }
  function closeSubs(level) { const i = stack.indexOf(level); for (const m of stack.splice(i + 1)) m.el.remove(); }
  function openSub(level, k) {
    closeSubs(level);
    const r = level.rows[k], items = val(r.__item.items);
    const sub = buildMenu(items, r, true); stack.push(sub); return sub;
  }
  function openMenu(i, { keyboard = false } = {}) {
    closeAll(); openI = i; barFocus = true; bar.classList.add('focus'); setBarCur(i);
    const btn = bar.querySelectorAll(':scope > button')[i]; btn.classList.add('open');
    const level = buildMenu(MENUS[i].items, btn, false); stack.push(level);
    if (keyboard) step(level, 1);
  }
  function step(level, d) {
    const n = level.rows.length; if (!n) return;
    let k = level.cur;
    for (let t = 0; t < n; t++) { k = (k + d + n) % n; if (!level.rows[k].__off) break; }
    setCur(level, k);
  }
  async function activate(level, k) {
    const r = level.rows[k]; if (!r || r.__off) return;
    const it = r.__item;
    if (it.items) { const sub = openSub(level, k); step(sub, 1); return; }
    leaveBar();
    try { await it.run?.(); } catch (e) { console.error(e); }
  }
  function mount(nav, menus) {
    bar = nav; MENUS = menus; bar.id = 'menubar'; bar.setAttribute('role', 'menubar'); bar.innerHTML = '';
    menus.forEach((m, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = val(m.label); b.dataset.menu = m.id ?? String(i);
      b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); if (openI === i) leaveBar(); else openMenu(i); });
      b.addEventListener('mouseenter', () => { if (openI >= 0 && openI !== i) openMenu(i); });
      bar.appendChild(b);
    });
  }
  // WebView2 also calls this when keyboard focus is inside the preview.
  window.MStudioRefreshPage = () => {
    leaveBar();
    const reload = MENUS.find(menu => menu.id === 'file')?.items.find(item => item.id === 'reload');
    if (reload) return reload.run();
    location.reload(); // The page may still be starting, or may have failed to mount.
  };
  // a click anywhere else closes the menus
  document.addEventListener('mousedown', (e) => { altAlone = false; if (!bar) return; if (!e.target.closest?.('.mb-menu') && !e.target.closest?.('#menubar')) leaveBar(); }, true);
  window.addEventListener('wheel', () => { altAlone = false; }, { capture: true, passive: true });   // Alt+wheel zooms the timeline
  window.addEventListener('blur', () => { altAlone = false; leaveBar(); });
  window.addEventListener('resize', () => closeAll());
  // the keyboard: captured before the page's own shortcuts while the bar has it
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) window.MStudioRefreshPage();
      return;
    }
    if (!bar) return;
    const dl = document.querySelector('.mb-dlg');
    if (dl) {   // a dialog of the bar has the keyboard: Escape closes it, the page's shortcuts wait
      if (dl.__onKey?.(e)) { e.stopPropagation(); return; }   // the dialog's own use of the keys first (Aide › Raccourcis clavier: the key being set)
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); dl.__close(); return; }
      // typing in one of the dialog's own fields: its keys reach it (Entrée in « Nouveau projet » did nothing)
      if (dl.contains(e.target) && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      e.stopPropagation();
      return;
    }
    if (e.key === 'Alt') { altAlone = !e.repeat; return; }
    altAlone = false;
    if (e.key === 'F10' && !e.ctrlKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); if (barFocus) leaveBar(); else focusBar(0); return; }
    if (!barFocus) return;
    const n = MENUS.length, cur = +(bar.dataset.cur ?? 0), top = stack.at(-1);
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'Escape') { stop(); if (stack.length > 1) { const m = stack.pop(); m.el.remove(); } else if (stack.length) { closeAll(); setBarCur(cur); } else leaveBar(); return; }
    if (!stack.length) {   // the bar has the focus, no menu open
      if (e.key === 'ArrowLeft') { stop(); setBarCur((cur - 1 + n) % n); }
      else if (e.key === 'ArrowRight') { stop(); setBarCur((cur + 1) % n); }
      else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { stop(); openMenu(cur, { keyboard: true }); }
      else leaveBar();   // any other key: the bar lets go, and the key does what it does in the page
      return;
    }
    if (e.key === 'ArrowDown') { stop(); step(top, 1); }
    else if (e.key === 'ArrowUp') { stop(); step(top, -1); }
    else if (e.key === 'ArrowRight') { stop(); const r = top.rows[top.cur]; if (r?.__item.items && !r.__off) { const sub = openSub(top, top.cur); step(sub, 1); } else openMenu((cur + 1) % n, { keyboard: true }); }
    else if (e.key === 'ArrowLeft') { stop(); if (stack.length > 1) { const m = stack.pop(); m.el.remove(); } else openMenu((cur - 1 + n) % n, { keyboard: true }); }
    else if (e.key === 'Enter' || e.key === ' ') { stop(); if (top.cur >= 0) activate(top, top.cur); }
    else if (e.key === 'Home') { stop(); top.cur = -1; step(top, 1); }
    else if (e.key === 'End') { stop(); top.cur = 0; step(top, -1); }
    else stop();
  }, true);
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt' && altAlone && bar && !document.querySelector('.mb-dlg')) { e.preventDefault(); altAlone = false; if (barFocus) leaveBar(); else focusBar(0); }
  }, true);

  // a small window of the app (About, Preferences, a document, a check's result)
  function dialog({ title, text, html, pre = false, buttons = [], onClose } = {}) {
    document.querySelector('.mb-dlg')?.__close();
    const d = document.createElement('div'); d.className = 'mb-dlg';
    d.innerHTML = `<div class="box" role="dialog" aria-label="${esc(title)}"><h2>${esc(title)}</h2><div class="body${pre ? ' pre' : ''}"></div><div class="b"></div></div>`;
    const body = d.querySelector('.body');
    if (html !== undefined) body.innerHTML = html; else body.textContent = text ?? '';
    const close = () => { d.remove(); onClose?.(); };
    d.__close = close;
    for (const b of buttons) {
      const el = document.createElement('button'); el.textContent = b.label; if (b.primary) el.className = 'primary';
      el.onclick = async () => { if ((await b.run?.(d)) !== false) close(); };
      d.querySelector('.b').appendChild(el);
    }
    d.addEventListener('mousedown', (e) => { if (e.target === d) close(); });
    document.body.appendChild(d);
    (d.querySelector('.b button.primary') ?? d.querySelector('.b button'))?.focus();
    return d;
  }
  window.MenuBar = { mount, dialog, close: leaveBar, state: () => ({ focus: barFocus, open: openI, depth: stack.length, cur: +(bar?.dataset.cur ?? -1) }) };
})();

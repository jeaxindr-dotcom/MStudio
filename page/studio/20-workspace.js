// Workspaces only affect the local editing surface. The same player, canvas and
// note editors stay mounted when a dock is hidden or the layout changes.
(() => {
  const words = FR ? {
    workspaces: 'Espaces de travail', layout: 'Disposition', review: 'Revue', edit: 'Montage', screen: 'Projection',
    panels: 'Panneaux visibles', left: 'Agent et envois', right: 'Explorateur et notes', timeline: 'Timeline',
    reset: 'Rétablir la disposition', close: 'Fermer', monitor: 'Moniteur', commands: 'Rechercher une commande',
    thirds: 'Grille des tiers', safe: 'Marges de sécurité à 5 % et 10 %', fps: 'i/s',
  } : {
    workspaces: 'Workspaces', layout: 'Layout', review: 'Review', edit: 'Editing', screen: 'Theater',
    panels: 'Visible panels', left: 'Agent and batches', right: 'Explorer and notes', timeline: 'Timeline',
    reset: 'Reset this layout', close: 'Close', monitor: 'Monitor', commands: 'Find a command',
    thirds: 'Rule of thirds', safe: '5% and 10% safe margins', fps: 'fps',
  };
  const defaults = {
    review: {left: true, right: true, timeline: true},
    edit: {left: false, right: true, timeline: true},
    screen: {left: false, right: false, timeline: false},
  };
  const saved = store.get('workspaceV2', null);
  const validMode = value => Object.hasOwn(defaults, value);
  const state = {
    mode: validMode(saved?.mode) ? saved.mode : 'review',
    layouts: {}, tabs: {},
    guides: {thirds: saved?.guides?.thirds === true, safe: saved?.guides?.safe === true},
  };
  for (const [name, panels] of Object.entries(defaults)) {
    const layout = {...panels};
    for (const key of Object.keys(panels)) {
      if (typeof saved?.layouts?.[name]?.[key] === 'boolean') layout[key] = saved.layouts[name][key];
    }
    state.layouts[name] = layout;
    if (saved?.tabs?.[name]) {
      state.tabs[name] = {left:saved.tabs[name].left, right:saved.tabs[name].right};
    }
  }
  const dialog = $('#workspaceDialog'), button = $('#workspaceButton');
  const controls = Array.from(dialog.querySelectorAll('[data-panel]'));
  const radios = Array.from(dialog.querySelectorAll('[name="workspace-mode"]'));
  document.querySelectorAll('[data-workspace-label]').forEach(el => { el.textContent = words[el.dataset.workspaceLabel]; });
  function nameControl(el, label) {
    el.title = label; el.setAttribute('aria-label', label);
  }
  nameControl($('#studioCommands'), words.commands + ' (Ctrl+K)');
  nameControl($('#workspaceClose'), words.close);
  nameControl($('#guideSafe'), words.safe);
  nameControl($('#guideThirds'), words.thirds);
  const persist = () => store.set('workspaceV2', state);

  function apply() {
    const layout = state.layouts[state.mode], body = document.body;
    body.dataset.workspace = state.mode;
    for (const input of controls) {
      const panel = input.dataset.panel;
      body.classList.toggle('ws-hide-' + panel, !layout[panel]);
      input.checked = layout[panel];
    }
    for (const input of radios) input.checked = input.value === state.mode;
    $('#workspaceButtonName').textContent = state.mode === 'review' ? words.layout : words[state.mode];
    nameControl(button, words.workspaces + ' · ' + words[state.mode]);
    for (const [key, toggle] of [['thirds', $('#guideThirds')], ['safe', $('#guideSafe')]]) {
      $('#frameGuides').classList.toggle(key, state.guides[key]);
      toggle.setAttribute('aria-pressed', String(state.guides[key]));
    }
  }
  function switchMode(name) {
    if (!validMode(name)) return;
    if (document.body.classList.contains('cg')) setPage('review');
    const changed = state.mode !== name;
    if (changed) state.tabs[state.mode] = {left:tabL, right:tabR};
    state.mode = name;
    apply();
    if (changed) {
      const previous = state.tabs[name];
      for (const [side, id, group] of [['left', previous?.left, '#ltabs'], ['right', previous?.right ?? (name === 'edit' ? 'composition' : null), '#tabs']]) {
        const exists = Array.from(document.querySelectorAll(group + ' [data-tab]')).some(button => button.dataset.tab === id);
        if (state.layouts[name][side] && exists) setTab(id, false);
      }
    }
    persist();
  }
  function setPanel(name, visible) {
    const layout = state.layouts[state.mode];
    if (!Object.hasOwn(layout, name)) return;
    if (document.body.classList.contains('cg')) setPage('review');
    layout[name] = visible;
    apply(); persist();
  }
  radios.forEach(input => input.addEventListener('change', () => switchMode(input.value)));
  controls.forEach(input => input.addEventListener('change', () => setPanel(input.dataset.panel, input.checked)));
  $('#workspaceReset').onclick = () => {
    state.layouts[state.mode] = {...defaults[state.mode]};
    switchMode(state.mode);
  };
  for (const [key, id] of [['safe', 'guideSafe'], ['thirds', 'guideThirds']]) {
    $('#' + id).onclick = () => { state.guides[key] = !state.guides[key]; apply(); persist(); };
  }

  function openPicker() {
    if (dialog.open) return;
    const rect = button.getBoundingClientRect();
    dialog.style.top = Math.min(rect.bottom + 6, Math.max(4, innerHeight - 308)) + 'px';
    dialog.style.left = Math.max(6, Math.min(rect.right - 305, innerWidth - 311)) + 'px';
    dialog.showModal(); button.setAttribute('aria-expanded', 'true');
    radios.find(input => input.checked)?.focus({preventScroll: true});
  }
  button.setAttribute('aria-expanded', 'false');
  button.onclick = openPicker;
  $('#workspaceClose').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { button.setAttribute('aria-expanded', 'false'); button.focus({preventScroll: true}); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
  // Other studio keyboard shortcuts should not move the playhead while the user
  // is choosing a radio option or toggling a panel with the space bar.
  dialog.addEventListener('keydown', event => event.stopPropagation());

  function monitorFormat() {
    if (!META) return;
    const {videoWidth, videoHeight} = v;
    const width = mode === 'video' && videoWidth ? videoWidth : CW;
    const height = mode === 'video' && videoHeight ? videoHeight : CH;
    $('#monitorSpec').textContent = width + ' × ' + height + '  ·  ' +
      new Intl.NumberFormat(LANG, {maximumFractionDigits: 3}).format(FPS) + ' ' + words.fps;
    $('#render').title = $('#render').textContent;
  }
  const formatObserver = new MutationObserver(monitorFormat);
  formatObserver.observe($('#title'), {childList: true});
  formatObserver.observe($('#codeStatus'), {childList: true});
  formatObserver.observe(media, {attributes: true, attributeFilter: ['class']});
  v.addEventListener('loadedmetadata', monitorFormat);
  apply(); monitorFormat();
  window.CoulissesWorkspace = {
    open: openPicker, setMode: switchMode,
    showPanel: name => {
      if (!Object.hasOwn(defaults.review, name)) return;
      if (state.mode === 'screen' && !state.layouts.screen[name]) switchMode('review');
      setPanel(name, true);
    },
    togglePanel: name => setPanel(name, !state.layouts[state.mode][name]),
  };
})();

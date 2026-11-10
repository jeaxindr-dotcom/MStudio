// Command search operates on the current composition and uses the same actions as the studio.
{
  const tr = (fr, en) => FR ? fr : en;
  const button = $('#studioCommands');
  const dialog = document.createElement('dialog');
  dialog.id = 'commandPalette';
  dialog.setAttribute('aria-labelledby', 'commandTitle');
  dialog.innerHTML = `<h2 id="commandTitle">${tr('Rechercher dans le studio', 'Search the studio')}</h2>
    <div class="command-query">${ic('goto')}<input id="commandQuery" type="text" autocomplete="off" spellcheck="false"
      role="combobox" aria-labelledby="commandTitle" aria-expanded="true" aria-controls="commandList"
      placeholder="${tr('Commande, note, scène, #image ou 1:23.500', 'Command, note, scene, #frame or 1:23.500')}">
      <button type="button" class="soft" id="commandClose" aria-label="${tr('Fermer', 'Close')}">Esc</button></div>
    <div id="commandList" role="listbox" aria-labelledby="commandTitle"></div>
    <div class="command-hint"><span>↑ ↓ &nbsp;${tr('Parcourir', 'Navigate')}</span><span>↵ &nbsp;${tr('Choisir', 'Select')}</span></div>`;
  document.body.append(dialog);
  const input = dialog.querySelector('input'), results = dialog.querySelector('[role=listbox]');
  let selection = 0, choices = [];
  const normal = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
  const review = () => { if (CG.on) setPage('review'); };
  const panel = (tabName) => {
    review();
    window.CoulissesWorkspace?.showPanel(LEFT.has(tabName) ? 'left' : 'right');
    setTab(tabName);
  };
  const jump = (f) => { M.pause(); seekFrame(f); };
  function openAgent() {
    panel('agent');
    requestAnimationFrame(() => $('#agentText').focus());
  }
  $('#bChatAgent').onclick = openAgent;
  const groups = {
    studio: tr('Commandes', 'Commands'), scene: tr('Scènes', 'Scenes'), note: tr('Notes', 'Notes'), time: tr('Position', 'Position'),
  };
  function entries(query) {
    const all = [];
    const add = (group, title, icon, run, hint = '', keywords = '', reason = '') => all.push({group, title, icon, run, hint, keywords, reason});
    const command = (title, icon, run, hint, keywords, reason) => add('studio', title, icon, run, hint, keywords, reason);
    const click = (id, title, icon, area, why) => {
      const target = document.getElementById(id);
      if (!target) return;
      const disabled = target.disabled || target.getAttribute('aria-disabled') === 'true' || target.classList.contains('off');
      const reason = disabled ? why || tr('Choisir d’abord une plage valide','Select a valid work range first') : '';
      command(title, icon, () => {
        if (area) { review(); window.CoulissesWorkspace?.showPanel(area); }
        target.click();
      }, '', '', reason);
    };
    if (META && FRAMES > 0) {
      const frameMatch = /^#\s*(\d+)$/.exec(query);
      const timeMatch = /^(?:(\d+):)?(\d+):([0-5]\d)(?:[.,](\d{1,3}))?$/.exec(query);
      let frame = null;
      if (frameMatch) frame = Number(frameMatch[1]);
      if (timeMatch && (!timeMatch[1] || Number(timeMatch[2]) < 60)) {
        const seconds = Number(timeMatch[1] || 0) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3]) + Number((timeMatch[4] || '').padEnd(3, '0')) / 1000;
        frame = Math.round(seconds * FPS);
      }
      if (frame !== null && Number.isSafeInteger(frame) && frame >= 0 && frame < FRAMES)
        add('time', tr('Aller à l’image ', 'Go to frame ') + frame, 'goto', () => jump(frame), fmt(frame / FPS), query);
    }
    if (META) {
      command(T('st.chat.open'), 'sparkle', openAgent);
      command(tr('Ouvrir la scène','Open scene'), 'box', () => window.CoulissesScene.open());
      command(tr('Afficher les médias','Show media'), 'image', () => panel('medias'));
      command(tr('Ouvrir l’inspecteur','Open inspector'), 'sliders', () => panel('insp'));
      command(tr('Ouvrir les options de rendu','Open render options'), 'film', () => window.CoulissesOutput.open('render'));
      command(tr('Exporter la vidéo','Export video'), 'film', () => window.CoulissesOutput.open());
      command(tr('Ouvrir le storyboard', 'Open storyboard'), 'film', () => window.CoulissesStoryboard.open());
      command(tr('Exporter l’image affichée (JPEG)', 'Export current frame (JPEG)'), 'image', () => window.CoulissesStoryboard.saveFrame(), '', '', FRAMES ? '' : tr('Image en attente','Waiting for a frame'));
      command(tr('Explorer les calques', 'Explore layers'), 'box', () => panel('composition'));
      command(tr('Afficher les notes', 'Show notes'), 'comment', () => panel('notes'));
      command(tr('Afficher les modifications en attente', 'Show pending edits'), 'list', () => panel('queue'));
      command(tr('Afficher les envois à l’agent', 'Show agent batches'), 'send', () => panel('lots'));
      command(tr('Étalonner la composition', 'Grade composition'), 'sliders', () => setPage('grade'));
      for (const [key, label] of [['review', tr('Espace Revue', 'Review workspace')], ['edit', tr('Espace Montage', 'Editing workspace')], ['screen', tr('Espace Projection', 'Screening workspace')]]) {
        command(label, 'fit', () => { review(); window.CoulissesWorkspace.setMode(key); });
      }
      for (const [id,label,icon] of [
        ['workIn',tr('Poser le point d’entrée','Mark work range in'),'start'], ['workOut',tr('Poser le point de sortie','Mark work range out'),'end'],
        ['workGoIn',tr('Aller au point d’entrée','Go to work range in'),'left'], ['workGoOut',tr('Aller au point de sortie','Go to work range out'),'right'],
        ['workLoop',tr('Basculer la boucle de plage','Toggle work range loop'),'repeat'], ['workFit',tr('Cadrer la plage de travail','Fit work range'),'fit'],
        ['workNote',tr('Annoter la plage de travail','Annotate work range'),'comment'], ['workClear',tr('Effacer la plage de travail','Clear work range'),'x'],
      ]) click(id, label, icon, 'timeline');
      click('guideThirds',tr('Basculer la grille des tiers','Toggle rule of thirds'),'sliders');
      click('trackVisibility',tr('Choisir les pistes visibles','Choose visible tracks'),'sliders','timeline');
      click('guideSafe',tr('Basculer les marges de sécurité','Toggle safe areas'),'fit');
      click('timelineThumbnails', tr('Afficher ou masquer les vignettes des clips','Toggle clip thumbnails'),'film','timeline');
      click('srcCode',tr('Afficher le code actuel','Show live code'),'code',null,tr('Ce projet ne fournit pas de code de composition','This project has no composition source'));
      click('srcVideo',tr('Afficher le rendu vidéo','Show rendered video'),'film',null,tr('Aucun film exporté','No exported video'));
      for (const s of window.CoulissesStoryboard.scenes()) add('scene', s.name, 'film', () => jump(s.from), '#' + s.from);
      for (const n of notes.filter(n => n.kind !== 'prompt')) {
        const title = n.text?.trim() || tr('Note sans texte', 'Untitled note');
        add('note', title, 'comment', () => {
          panel(n.draft ? 'queue' : 'notes');
          if (!n.draft && !inLotF(n)) setLotF('all');
          if (!n.draft && stateOf(n) === 'ok') $('#hideDone').checked = false;
          sel = n.id; jump(n.frame); renderAll();
          const list = $(n.draft ? '#draftList' : '#list');
          [...list.querySelectorAll('.card')].find(el => el.dataset.id === n.id)?.scrollIntoView({block:'nearest'});
        }, '#' + n.frame, n.id);
      }
    }
    return all;
  }
  function highlight(scroll = false) {
    for (const [i, row] of [...results.querySelectorAll('[role=option]')].entries()) row.setAttribute('aria-selected', String(selection === i));
    const selected = results.querySelector('[aria-selected=true]');
    if (selected) {
      input.setAttribute('aria-activedescendant', selected.id);
      if (scroll) selected.scrollIntoView({block:'nearest'});
    } else input.removeAttribute('aria-activedescendant');
  }
  function choose(i) {
    const item = choices[i];
    if (!item) return;
    if (item.reason) { setSave(item.reason,''); return; }
    dialog.close();
    item.run();
  }
  function render() {
    const query = input.value.trim(), terms = normal(query).split(/\s+/).filter(Boolean);
    choices = entries(query).filter(item => {
      const hay = normal([groups[item.group],item.title,item.hint,item.keywords].join(' '));
      return terms.every(term => hay.includes(term));
    }).slice(0, 80);
    results.replaceChildren(); selection = 0;
    let prev = '';
    for (const [i, item] of choices.entries()) {
      if (item.group !== prev) {
        const heading = document.createElement('div'); heading.className = 'command-group'; heading.textContent = groups[item.group]; heading.setAttribute('role','presentation'); results.append(heading); prev = item.group;
      }
      const row = document.createElement('div'); row.className = 'command-option'; row.id = 'command-option-' + i; row.setAttribute('role','option');
      row.innerHTML = ic(item.icon);
      if (item.reason) { row.setAttribute('aria-disabled','true'); row.title = item.reason; }
      const name = document.createElement('span'); name.textContent = item.title;
      const hint = document.createElement('small'); hint.textContent = item.reason || item.hint;
      row.append(name, hint); row.addEventListener('click', () => choose(i)); results.append(row);
    }
    if (!choices.length) {
      const text = document.createElement('p'); text.textContent = tr('Aucun résultat', 'No matches'); results.append(text);
    }
    results.scrollTop = 0; highlight();
  }
  function open() {
    if (dialog.open) return;
    if (document.querySelector('dialog[open]') || cmpOpen() || hubOpen() || $('#modal').style.display === 'flex') return;
    input.value = ''; render(); dialog.showModal(); input.focus();
  }
  button.title = tr('Rechercher dans le studio (Ctrl+K)', 'Search the studio (Ctrl+K)');
  button.setAttribute('aria-label', button.title);
  button.onclick = open;
  input.oninput = render;
  dialog.querySelector('#commandClose').onclick = () => dialog.close();
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  window.addEventListener('keydown', (e) => {
    const shortcut = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k';
    if (shortcut) { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) { if (dialog.open) dialog.close(); else open(); } return; }
    if (!dialog.open) return;
    if (!e.isComposing && ['ArrowUp','ArrowDown','Enter','Escape'].includes(e.key)) {
      e.preventDefault();
      if (e.key === 'Escape') dialog.close();
      else if (e.key === 'Enter') choose(selection);
      else if (choices.length) { selection = (selection + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length; highlight(true); }
    }
    // The studio has shortcuts for timeline, notes and transport behind the modal.
    e.stopImmediatePropagation();
  }, true);
}

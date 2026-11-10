  // Kept across inspector renders so typing a filter or scrolling a long list
  // never modifies the scene. IDs come from the same picker used by the canvas.
  const sceneElements = (() => {
    let section = null, search, rows, items = [], player = null, frame = -1, request = 0, focusId = null;
    const fold = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
    function label(item) {
      if (item.name) return item.name;
      return stageName(item.id, item).name;
    }
    function draw() {
      if (!section?.isConnected) return;
      const filter = fold(search.value.trim()), selected = SP?.stage?.selected;
      const visible = items.filter(item => fold(label(item)).includes(filter));
      rows.innerHTML = visible.map(item => `<button type="button" class="scene-object" data-sc-object="${esc(item.id)}" aria-pressed="${item.id === selected}">${ic('box')}<span>${esc(label(item))}</span></button>`).join('') ||
        `<span class="muted">${T(filter ? 'st.scene.noMatch' : 'st.scene.noElements')}</span>`;
      if (focusId && focusId === selected) {
        Array.from(rows.children).find(el => el.dataset.scObject === focusId)?.focus({preventScroll:true});
        focusId = null;
      }
    }
    async function refresh(force = false) {
      if (!section?.isConnected || !staging || !SP?.stage?.elements) return;
      const current = SP, at = curFrame();
      if (!force && player === current && frame === at) return;
      if (player !== current) { items = []; draw(); }
      player = current; frame = at;
      const ticket = ++request;
      try {
        const next = await current.stage.elements();
        if (ticket !== request || SP !== current || !staging) return;
        items = next ?? []; draw();
      } catch {
        if (ticket === request) frame = -1;
      }
    }
    function bind() {
      const slot = document.querySelector('#scene [data-sc-elements-slot]');
      if (!slot) { player = null; frame = -1; request++; return; }
      if (!section) {
        section = document.createElement('section');
        section.className = 'scene-elements';
        section.innerHTML = `<h3 class="sh">${ic('box')}<label for="sc-object-search">${T('st.scene.elements')}</label></h3>
          <input type="search" id="sc-object-search" placeholder="${esc(T('st.scene.filterElements'))}">
          <div class="scene-objects" role="group" aria-label="${esc(T('st.scene.elements'))}"></div>`;
        search = section.querySelector('input'); rows = section.querySelector('.scene-objects');
        search.oninput = draw;
        rows.onclick = event => {
          const button = event.target.closest('button[data-sc-object]');
          if (!button || !staging) return;
          button.focus({preventScroll:true});
          focusId = button.dataset.scObject;
          SP.stage.select(focusId);
        };
      }
      slot.replaceWith(section); draw(); refresh();
    }
    return {bind, refresh};
  })();
  M.on('seeked', () => sceneElements.refresh());
  M.on('pause', () => sceneElements.refresh());

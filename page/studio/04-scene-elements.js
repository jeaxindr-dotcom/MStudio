  // Kept across inspector renders so typing a filter or scrolling a long list
  // never modifies the scene. IDs come from the same picker used by the canvas.
  const sceneElements = (() => {
    let section = null, search, rows, items = [], player = null, frame = -1, request = 0;
    let markup = null, anchor = null, focusRequest = 0;
    const fold = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
    function label(item) {
      if (item.name) return item.name;
      return stageName(item.id, item).name;
    }
    function draw() {
      if (!section?.isConnected) return;
      const filter = fold(search.value.trim()), selected = SP?.stage?.selected;
      const visible = items.filter(item => fold(label(item)).includes(filter));
      const next = visible.map(item => `<button type="button" class="scene-object" data-sc-object="${esc(item.id)}">${ic('box')}<span>${esc(label(item))}</span></button>`).join('') ||
        `<span class="muted">${T(filter ? 'st.scene.noMatch' : 'st.scene.noElements')}</span>`;
      if (next !== markup) { rows.innerHTML=next; markup=next; }
      for (const el of rows.querySelectorAll('[data-sc-object]')) el.setAttribute('aria-pressed',String(el.dataset.scObject===selected));
      // The first click expands the inspector above this list. Keep the clicked row under
      // the pointer so Windows can deliver the second click to the very same button.
      if (anchor && anchor.el.dataset.scObject===selected && anchor.el.isConnected) {
        const pane=section.closest('#scene');
        pane.scrollTop+=anchor.el.getBoundingClientRect().top-anchor.top;
        anchor=null;
      }
    }
    async function frameObject(button) {
      const current=SP, ticket=++focusRequest;
      if (!button || !staging || current?.stage?.kind!=='3d') return;
      const id=button.dataset.scObject;
      let ok=false;
      try {ok=await current.stage.focusObject(id);} catch { /* the player may have been replaced */ }
      if (ticket!==focusRequest || !staging || current!==SP || current.stage.selected!==id) return;
      if (!ok) {setSave(T('st.scene.focusUnavailable'),'err');return;}
      freeCamOn=true;
      if (button.isConnected) anchor={el:button,top:button.getBoundingClientRect().top};
      renderScene();
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
      if (!slot) { player = null; frame = -1; request++; focusRequest++;anchor=null;return; }
      if (!section) {
        section = document.createElement('section');
        section.className = 'scene-elements';
        section.innerHTML = `<h3 class="sh">${ic('box')}<label for="sc-object-search">${T('st.scene.elements')}</label></h3>
          <input type="search" id="sc-object-search" placeholder="${esc(T('st.scene.filterElements'))}">
          <p class="note2" id="sc-object-hint" hidden>${T('st.scene.focusHint')}</p>
          <div class="scene-objects" role="group" aria-label="${esc(T('st.scene.elements'))}"></div>`;
        search = section.querySelector('input'); rows = section.querySelector('.scene-objects');
        search.oninput = draw;
        rows.onclick = event => {
          const button = event.target.closest('button[data-sc-object]');
          if (!button || !staging) return;
          button.focus({preventScroll:true});
          if(SP.stage.selected!==button.dataset.scObject) {
            anchor={el:button,top:button.getBoundingClientRect().top};
            SP.stage.select(button.dataset.scObject);
          }
        };
        rows.ondblclick=event=>{if(event.button===0)void frameObject(event.target.closest('button[data-sc-object]'));};
        rows.onkeydown=event=>{
          if(event.altKey && event.key==='Enter' && SP?.stage?.kind==='3d'){
            const button=event.target.closest('button[data-sc-object]');
            if(button){event.preventDefault();event.stopPropagation();void frameObject(button);}
          }
        };
      }
      if (section.parentElement!==slot) slot.replaceChildren(section);
      const hint=section.querySelector('#sc-object-hint');hint.hidden=SP?.stage?.kind!=='3d';
      if(hint.hidden)rows.removeAttribute('aria-describedby');else rows.setAttribute('aria-describedby',hint.id);
      draw(); refresh();
    }
    return {bind, refresh};
  })();
  M.on('seeked', () => sceneElements.refresh());
  M.on('pause', () => sceneElements.refresh());

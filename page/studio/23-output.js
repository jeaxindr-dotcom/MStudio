// Render and export share project capabilities; the two buttons stay in place for every source.
(() => {
  const tr = (fr, en) => FR ? fr : en;
  const dialog = document.createElement('dialog');
  dialog.id = 'outputDialog'; dialog.setAttribute('aria-labelledby','outputTitle');
  dialog.innerHTML = `<div class="out-heading"><h2 id="outputTitle"></h2>
    <button type="button" class="soft" id="outputClose" aria-label="${tr('Fermer','Close')}">${ic('x')}</button></div>
    <section><h3>${tr('Fichier vidéo','Video file')}</h3><p id="outputFile"></p>
    <a id="outputDownload" download>${tr('Télécharger la vidéo','Download video')}</a></section>
    <section><h3>${tr('Rendu depuis le projet','Render from project')}</h3><p id="outputWhy"></p><dl id="outputPaths"></dl>
    <div class="out-actions"><label id="outputQualityLabel">${tr('Qualité','Quality')} <select id="outputQuality"></select></label>
    <button type="button" class="primary" id="outputRender"></button></div></section>`;
  document.body.append(dialog);
  const byId = id => document.getElementById(id);
  const download = byId('outputDownload'), selector = byId('outputQuality'), render = byId('outputRender');
  let qualityStamp = '';
  const extension = file => file?.name?.split('.').pop()?.toUpperCase();
  function currentFile() {
    return Object.hasOwn(STATUS,'video') ? STATUS.video : META?.render;
  }
  function renderInfo(kind) {
    if (kind === 'render') return tr('Le rendu de cet épisode est confié à l’agent.','The agent runs this episode’s render.');
    if (kind === 'export') return META.kind === 'hyperframes'
      ? tr('HyperFrames calcule la vidéo de cette composition.','HyperFrames renders this composition to video.')
      : tr('Le script d’export du projet calcule la vidéo de cette composition Remotion.','The project export script renders this Remotion composition to video.');
    if (META?.features?.code) return META.exportWhy || tr('Configure le script d’export de ce projet pour calculer sa vidéo.','Configure the project export script to render the video.');
    return tr('Cette revue utilise un fichier vidéo. Pour rendre la composition, ouvre son projet .coulisses.','This review uses a video file. Open its .coulisses project to render the composition.');
  }
  function refresh() {
    const headerRender = byId('hdrGo'), headerExport = byId('hdrExport');
    const kind = goKind(), busy = kind && goBusy(), why = renderInfo(kind);
    headerRender.querySelector('.t').textContent = T('st.rc.render');
    headerRender.title = busy || (kind ? T('menu.render') : why);
    headerRender.classList.toggle('off', !kind);
    headerRender.setAttribute('aria-label', T('st.rc.render') + ' · ' + headerRender.title);
    headerExport.querySelector('.t').textContent = tr('Exporter', 'Export');
    headerExport.setAttribute('aria-label', T('common.exportVideo'));
    if (!dialog.open) return;
    const delivery = STATUS.export?.state==='done' && STATUS.export?.downloadable ? STATUS.export.file : null;
    const video = delivery ? {name:delivery.split(/[\\/]/).pop()} : currentFile(), held = STATUS.held ?? META?.held;
    byId('outputFile').textContent = held ? tr('Le fichier est en cours de remplacement.','The video is being replaced.')
      : video ? video.name : tr('Aucune vidéo rendue dans ce projet.','This project has no rendered video yet.');
    if (video && !held) {
      download.setAttribute('href',delivery ? '/video/download?export=1' : '/video/download'); download.download = video.name;
      download.textContent = tr('Télécharger','Download') + ' · ' + extension(video);
      download.removeAttribute('aria-disabled'); download.removeAttribute('tabindex');
    } else {
      download.removeAttribute('href'); download.setAttribute('aria-disabled','true'); download.setAttribute('tabindex','-1');
      download.textContent = tr('Télécharger la vidéo','Download video');
    }
    byId('outputWhy').textContent = busy || why;
    const sources = [[tr('Composition','Composition'), META?.composition || (META?.kind==='brambleshire'?META?.episode:null)],
      [tr('Entrée','Entry'),META?.exportEntry],[tr('Dossier de sortie','Output folder'),META?.exportDir || (META?.kind==='brambleshire' ? META?.root:null)]];
    const profile = kind && META.exportOptions?.find(o=>o.id===quality().send);
    if (profile?.scriptLabel) sources.push([tr('Profil du script','Script preset'), profile.id+' · '+profile.scriptLabel]);
    const paths=byId('outputPaths'); paths.replaceChildren();
    for (const [label, value] of sources) if (value) {
      const dt=document.createElement('dt'),dd=document.createElement('dd'); dt.textContent=label; dd.textContent=value; paths.append(dt,dd);
    }
    const choices = kind ? qualities() : [];
    const signature = JSON.stringify(choices);
    if (signature !== qualityStamp) {
      selector.replaceChildren();
      for (const q of choices) {
        const o = new Option(q.label,q.id); o.disabled = !!q.why; if (q.why) o.title = q.why; selector.add(o);
      }
      qualityStamp = signature;
    }
    if (kind) selector.value = quality().id;
    selector.disabled = !kind || !!busy;
    byId('outputQualityLabel').hidden = !kind;
    render.disabled = !kind;
    render.textContent = busy ? tr('Suivre le rendu','View render progress') : T('menu.render');
    render.title = !kind ? why : '';
  }
  function open(intent = 'export') {
    if (!META || dialog.open) return;
    byId('outputTitle').textContent = intent === 'render' ? T('st.rc.render') : T('common.exportVideo');
    dialog.showModal(); refresh(); byId('outputClose').focus({preventScroll:true});
  }
  function run() {
    if (!META) return;
    if (!goKind()) { open('render'); return; }
    if (dialog.open) dialog.close();
    if (goBusy()) {
      if (document.body.classList.contains('cg')) setPage('review');
      setTab('lots'); return;
    }
    goRender();
  }
  selector.onchange = () => setQuality(selector.value); render.onclick = run;
  byId('outputClose').onclick = () => dialog.close();
  dialog.addEventListener('keydown', e => e.stopPropagation());
  dialog.addEventListener('click', e => { if(e.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dialog.close();
  }});
  window.CoulissesOutput = {open, render:run, refresh};
  refresh();
})();

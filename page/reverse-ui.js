/* The project library owns navigation. This dialog keeps source-frame edits local
   until the user explicitly creates or updates the Remotion project. */
window.createReverseEditor = ({language, reveal, openProject}) => {
  const tr = (fr, en) => language === 'fr' ? fr : en;
  const label = tr('Découper en plans', 'Split into shots');
  const editLabel = tr('Modifier le montage Reverse', 'Edit Reverse cuts');
  const dialog = document.createElement('dialog');
  dialog.id = 'reverseDialog';
  dialog.setAttribute('aria-labelledby', 'rvTitle');
  dialog.innerHTML = `<div class="rv-shell">
    <div class="rv-header"><h2 id="rvTitle"></h2><button type="button" id="rvClose" class="soft"></button></div>
    <div class="rv-body"></div><p class="rv-error" role="alert" hidden></p><div class="rv-footer"></div>
  </div>`;
  document.body.append(dialog);
  const $ = s => dialog.querySelector(s);
  const body = $('.rv-body'), footer = $('.rv-footer');
  $('#rvClose').textContent = tr('Fermer', 'Close');
  $('#rvClose').onclick = () => dialog.close();
  const storage = 'hub.reverseSession.v1';
  let session = {}, generation = 0, timer, previewTimer, saveTimer, stageObserver;
  let selected = 0, frame = 0, limit = 36, choosingArea = false;
  try { session = JSON.parse(sessionStorage.getItem(storage)) || {}; } catch {}
  let dirty = !!session.dirty;
  const jobUrl = () => '/api/reverse/jobs/' + encodeURIComponent(session.job);
  function writeSession() {
    clearTimeout(saveTimer);
    session.dirty = dirty;
    try {
      if (session.job) sessionStorage.setItem(storage, JSON.stringify(session));
      else sessionStorage.removeItem(storage);
    } catch { /* The editing session stays available in this tab. */ }
  }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeSession,100);
  }
  window.addEventListener('pagehide',writeSession);
  dialog.addEventListener('close', () => { if (session.finished) reset(); });
  async function api(url, data) {
    const options = data === undefined ? {cache:'no-store'} : {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
    };
    const response = await fetch(url, options);
    const result = await response.json();
    if (!response.ok || !result.ok) throw Object.assign(new Error(result.why || result.error || ('HTTP ' + response.status)), {needInstall:result.needInstall,status:response.status});
    return result;
  }
  function reset() {
    clearTimeout(timer); clearTimeout(previewTimer); stageObserver?.disconnect();
    generation++; session = {}; dirty = false; selected = 0; limit = 36; writeSession();
  }
  function panel(title, html = '') {
    stageObserver?.disconnect(); clearTimeout(previewTimer);
    $('#rvTitle').textContent = title;
    body.innerHTML = html; footer.replaceChildren(); error('');
  }
  function error(message) {
    const el = $('.rv-error');
    el.textContent = message || ''; el.hidden = !message;
  }
  function button(parent, id, text, run, primary = false) {
    const el = document.createElement('button');
    el.type = 'button'; el.id = id; el.className = primary ? 'rv-primary' : 'soft';
    el.textContent = text; el.onclick = run; parent.append(el);
    return el;
  }
  function sourcePanel() {
    panel(label, `<div class="rv-intake">
      <p>${tr('Choisis une vidéo pour retrouver ses coupes et créer des plans éditables dans Remotion.', 'Choose a video to find its cuts and create editable shots in Remotion.')}</p>
      <label for="rvPath">${tr('Vidéo source', 'Source video')}</label>
      <div class="rv-file"><input id="rvPath" type="text" spellcheck="false" autocomplete="off"><button id="rvBrowse" type="button" class="soft">${tr('Parcourir…', 'Browse…')}</button></div>
      <label for="rvName">${tr('Nom du projet', 'Project name')}</label><input id="rvName" maxlength="120" type="text">
    </div>`);
    $('#rvPath').placeholder = tr('Chemin du fichier vidéo', 'Path to the video file');
    $('#rvName').placeholder = tr('Nom de la vidéo', 'Video name');
    const path = $('#rvPath'), name = $('#rvName');
    path.value = session.path || ''; name.value = session.name || '';
    const submit = button(footer,'rvAnalyze',tr('Analyser la vidéo', 'Analyze video'),async () => {
      if (!path.value.trim()) { path.focus(); return; }
      const request = {path:path.value.trim().replace(/^"(.*)"$/, '$1'), name:name.value.trim()};
      const current = generation;
      submit.disabled = true; $('#rvBrowse').disabled = true; error('');
      try {
        const data = await api('/api/reverse/analyze',request);
        if (generation !== current) return;
        session = {...request,job:data.job}; persist(); await poll(current);
      } catch (e) { if (generation === current) error(e.message); }
      finally { submit.disabled = false; if ($('#rvBrowse')) $('#rvBrowse').disabled = false; }
    },true);
    $('#rvBrowse').onclick = async ev => {
      const b = ev.currentTarget; b.disabled = true; error('');
      try {
        const r = await fetch('/api/import/pick',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({what:'video'})}).then(x => x.json());
        if (r.ok) { path.value = r.path; submit.focus(); }
        else if (!r.cancelled) error(r.why || tr('Sélecteur indisponible. Colle le chemin du fichier.', 'Picker unavailable. Paste the file path.'));
      } catch (e) { error(e.message); } finally { b.disabled = false; }
    };
    path.onkeydown = name.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); submit.click(); } };
    path.focus();
  }
  function progressPanel(state, pct) {
    if (!$('#rvProgress') || body.dataset.phase !== state) {
      panel(state === 'creating' ? tr('Préparation du projet Remotion', 'Preparing the Remotion project') : tr('Recherche des coupes', 'Finding cuts'),
        '<div class="rv-progress"><p id="rvWorking"></p><progress id="rvProgress" max="100"></progress><span id="rvPct"></span></div>');
      body.dataset.phase = state;
      $('#rvWorking').textContent = session.name || session.path || '';
      button(footer,'rvCancel',tr('Annuler', 'Cancel'), async ev => {
        ev.currentTarget.disabled = true;
        try { await api(jobUrl()+'/cancel',{}); await poll(generation); } catch(e) { error(e.message); }
      });
    }
    if (Number.isFinite(pct)) {
      $('#rvProgress').value = Math.max(0,Math.min(100,pct)); $('#rvPct').textContent = Math.round($('#rvProgress').value)+' %';
    }
  }
  async function poll(current) {
    clearTimeout(timer);
    if (generation !== current || !session.job) return;
    try {
      const data = await api(jobUrl());
      if (generation !== current) return;
      if (data.state === 'review') {
        // A submitted edit already lives on the server if the page was reloaded
        // during creation. Retain unsaved local choices on a review or error.
        session.analysis = data.analysis; session.existing = !!data.existing;
        session.shots ??= data.shots; session.name ||= data.name; session.revision ??= data.revision;
        session.projectId ||= data.project?.id; persist();
        reviewPanel(); if (data.error) error(data.error);
      } else if (data.state === 'done') {
        const project = {...data.project,title:data.project.title || session.name};
        dirty = false; session.finished = true; writeSession();
        panel(tr('Le projet Remotion est prêt', 'Your Remotion project is ready'), '<div class="rv-complete"><h3></h3><p></p></div>');
        $('.rv-complete h3').textContent = project.title;
        $('.rv-complete p').textContent = project.dir || project.file;
        button(footer,'rvReveal',tr('Voir dans la bibliothèque', 'Show in library'), async () => { reset(); dialog.close(); await reveal(project); });
        button(footer,'rvOpenStudio',tr('Ouvrir le studio', 'Open the studio'), async () => { reset(); dialog.close(); await openProject(project); },true);
        if (dialog.open) await reveal(project);
        if (dialog.open) $('#rvOpenStudio')?.focus();
      } else if (data.state === 'error' || data.state === 'cancelled') {
        const message = data.error || tr('Opération annulée.', 'Operation cancelled.');
        const {path,name,projectId} = session;
        reset(); session = {path,name}; sourcePanel(); error(message);
        if (projectId) button(footer,'rvReopen',editLabel,() => open(projectId));
      } else {
        progressPanel(data.state,data.progress);
        timer = setTimeout(() => poll(current),850);
      }
    } catch(e) {
      if (generation !== current) return;
      panel(label); error(e.message);
      button(footer,'rvReset',tr('Choisir une vidéo', 'Choose a video'),() => {reset();sourcePanel();});
      button(footer,'rvReconnect',tr('Réessayer', 'Retry'),() => poll(current),true);
    }
  }
  const fps = () => session.analysis.fpsNumerator/session.analysis.fpsDenominator;
  function stamp(n) {
    const sec = Math.floor(n/fps());
    return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');
  }
  const shot = () => session.shots[selected];
  const src = n => jobUrl()+'/frame?frame='+n;
  function reviewPanel() {
    selected = session.selection ?? selected;
    selected = Math.max(0,Math.min(selected,session.shots.length-1));
    panel(session.existing ? editLabel : tr('Ajuster le découpage','Adjust shot boundaries'), `
      <div class="rv-summary"><label for="rvProjectName">${tr('Projet','Project')}</label><input id="rvProjectName" maxlength="120"><span id="rvFormat"></span></div>
      <div class="rv-editor">
        <section class="rv-bins"><div class="rv-list-head"><h3>${tr('Plans','Shots')}</h3><span id="rvCount"></span></div><div id="rvShots"></div></section>
        <section class="rv-inspector" aria-label="${tr('Plan sélectionné','Selected shot')}">
          <div class="rv-monitor"><div id="rvViewport"><div id="rvCanvas"><div id="rvBase"><img id="rvImage" alt="${tr('Image du plan','Shot frame')}"><div id="rvMask" hidden></div></div><div id="rvInsetBox" hidden><img id="rvInsetImage" alt=""></div><div id="rvLayer"></div><div id="rvMarquee" hidden></div></div></div><span id="rvImageState" role="status"></span></div>
          <div class="rv-scrub"><input type="range" id="rvScrub" aria-label="${tr('Parcourir les images du plan','Browse shot frames')}"><label for="rvFrame">${tr('Image source','Source frame')}</label><input id="rvFrame" type="number" step="1"></div>
          <div id="rvShotCommands" class="rv-buttons"></div>
          <div class="rv-fields" id="rvEdit"></div>
        </section>
      </div>`);
    const a = session.analysis;
    $('#rvProjectName').value = session.name || '';
    $('#rvProjectName').disabled = !!session.existing;
    $('#rvProjectName').oninput = e => {session.name = e.target.value; dirty = true; persist();};
    $('#rvFormat').textContent = a.width+' × '+a.height+' · '+Number(fps().toFixed(3))+' '+tr('i/s','fps');
    const view = $('#rvViewport'), canvas = $('#rvCanvas');
    view.style.setProperty('--rv-ratio',a.width/a.height); view.style.aspectRatio = a.width+' / '+a.height;
    canvas.style.width = a.width+'px'; canvas.style.height = a.height+'px';
    const fit = () => { canvas.style.transform = 'scale('+view.clientWidth/a.width+')'; };
    stageObserver = new ResizeObserver(fit); stageObserver.observe(view); fit();
    attachAreaPicker(view);
    $('#rvScrub').oninput = e => setFrame(Number(e.target.value));
    $('#rvFrame').onchange = e => setFrame(Number(e.target.value));
    const tools = $('#rvShotCommands');
    button(tools,'rvSplit',tr('Scinder ici','Split here'),() => {
      if (frame <= shot().sourceIn || frame >= shot().sourceOut) return;
      const right = {...shot(),id:'plan-'+crypto.randomUUID(),sourceIn:frame}; shot().sourceOut = frame;
      session.shots.splice(selected+1,0,right); selected++; changeShots();
    });
    button(tools,'rvMerge',tr('Fusionner avec le suivant','Merge with next'),() => {
      const next = session.shots[selected+1];
      if (!next || shot().sourceOut !== next.sourceIn) return;
      if (!confirm(tr('Garder le titre et le cadrage du premier plan pour toute la fusion ?', 'Keep the first shot’s title and framing across the merged shot?'))) return;
      shot().sourceOut = next.sourceOut; session.shots.splice(selected+1,1); changeShots();
    });
    button(tools,'rvEarlier',tr('Avancer le plan','Move earlier'),() => moveShot(-1));
    button(tools,'rvLater',tr('Reculer le plan','Move later'),() => moveShot(1));
    button(tools,'rvDrop',tr('Retirer le plan','Remove shot'),() => {
      if (session.shots.length < 2) return;
      session.shots.splice(selected,1); selected = Math.min(selected,session.shots.length-1); changeShots();
    });
    const total = document.createElement('span'); total.id = 'rvTotal'; footer.append(total);
    button(footer,'rvLeave',tr('Quitter ce montage','Leave this edit'),async () => {
      if (dirty && !confirm(tr('Quitter et abandonner ces modifications ?', 'Leave and discard these changes?'))) return;
      try { await api(jobUrl()+'/cancel',{}); reset(); sourcePanel(); } catch(e) {error(e.message);}
    });
    button(footer,'rvCreate',session.existing ? tr('Enregistrer le montage','Save edit') : tr('Créer le projet Remotion','Create Remotion project'),save,true);
    list(); selectShot(selected,session.frame);
  }
  function list() {
    const group = $('#rvShots');
    group.replaceChildren();
    const shots = session.shots;
    $('#rvCount').textContent = shots.length;
    limit = Math.max(limit,selected+1);
    shots.slice(0,limit).forEach((s,i) => {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'rv-shot'; el.dataset.shot = i;
      el.setAttribute('aria-pressed',String(i===selected));
      const image = document.createElement('img');
      image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.src = src(Math.floor((s.sourceIn+s.sourceOut-1)/2));
      const words = document.createElement('span'), title = document.createElement('strong'), tc = document.createElement('small');
      title.textContent = s.label; tc.textContent = clipTime(s);
      words.append(title,tc);el.append(image,words);
      el.onclick = () => selectShot(i); group.append(el);
    });
    if (shots.length>limit) button(group,'rvMore',tr('Afficher plus de plans','Show more shots'),() => { limit += 36; list(); });
    updateTotal();
  }
  function clipTime(s) {
    return stamp(s.sourceIn)+' – '+stamp(s.sourceOut)+' · '+(s.sourceOut-s.sourceIn)+' '+tr('img','fr');
  }
  function updateTotal() {
    const frames = session.shots.reduce((n,s) => n+s.sourceOut-s.sourceIn,0);
    $('#rvTotal').textContent = tr('Montage','Edit')+' · '+stamp(frames)+' · '+frames+' '+tr('images','frames');
  }
  function moveShot(delta) {
    const dest = selected+delta;
    if (!session.shots[dest]) return;
    const [s] = session.shots.splice(selected,1); session.shots.splice(dest,0,s); selected=dest; changeShots();
  }
  function changeShots() { dirty = true; persist(); list(); selectShot(selected); }
  function field(parent,key,label,type='number',opts={}) {
    const wrapper = document.createElement('label'); wrapper.textContent = label;
    const tag = type==='select' || type==='textarea' ? type : 'input';
    const el = document.createElement(tag);
    el.id='rv-'+key; el.dataset.field = key;
    if (tag==='input') el.type=type;
    if (type==='select') for(const [value,text] of opts.choices) el.add(new Option(text,value));
    if (type==='number') { el.step=opts.step || '1'; if(opts.min!=null) el.min=opts.min; if(opts.max!=null) el.max=opts.max; }
    if (opts.maxLength) el.maxLength=opts.maxLength;
    el.value=shot()[key] ?? opts.fallback ?? '';
    const apply = () => {
      const s=shot(), v=type==='number'?el.valueAsNumber:el.value;
      if (!el.checkValidity() || (type==='number' && !Number.isFinite(v))) return;
      if (key==='sourceIn' && v>=s.sourceOut || key==='sourceOut' && v<=s.sourceIn) return;
      if (s[key]===v) return;
      s[key]=v; dirty=true; persist();
      if (key==='sourceIn' || key==='sourceOut') {
        $('#rv-sourceIn').max=s.sourceOut-1; $('#rv-sourceOut').min=s.sourceIn+1;
        const card=$('#rvShots [aria-pressed="true"]');
        card.querySelector('small').textContent=clipTime(s);
        card.querySelector('img').src=src(Math.floor((s.sourceIn+s.sourceOut-1)/2));
        updateTotal(); setFrame(frame); updateCommands();
      } else if(key==='label') $('#rvShots [aria-pressed="true"] strong').textContent = s.label;
      paint();
    };
    el.oninput=apply;
    el.onchange=() => {
      apply();
      if (type==='number' && (!el.checkValidity() || !Number.isFinite(el.valueAsNumber))) el.reportValidity();
    };
    wrapper.append(el);parent.append(wrapper);
    return el;
  }
  function details(parent,label) {
    const d = document.createElement('details'), summary = document.createElement('summary'), fields=document.createElement('div');
    summary.textContent=label;fields.className='rv-grid'; d.append(summary,fields); parent.append(d); return fields;
  }
  function selectShot(i,initialFrame) {
    selected=i; session.selection=i; choosingArea=false; $('#rvViewport').classList.remove('rv-choosing'); const s=shot(), a=session.analysis;
    for (const b of $('#rvShots').querySelectorAll('[data-shot]')) b.setAttribute('aria-pressed',String(Number(b.dataset.shot)===i));
    const edit=$('#rvEdit'); edit.replaceChildren();
    const timing=document.createElement('div');timing.className='rv-grid rv-timing';edit.append(timing);
    field(timing,'label',tr('Nom du plan','Shot name'),'text',{maxLength:160});
    field(timing,'sourceIn',tr('Première image','First frame'),'number',{min:0,max:s.sourceOut-1});
    field(timing,'sourceOut',tr('Fin (exclue)','End (exclusive)'),'number',{min:s.sourceIn+1,max:a.frames});
    const crop=details(edit,tr('Cadrage','Framing'));
    field(crop,'zoom','Zoom','number',{min:.1,max:10,step:.01,fallback:1});
    field(crop,'x',tr('Décalage X (px)','Offset X (px)'),'number',{min:-4*a.width,max:4*a.width,fallback:0});
    field(crop,'y',tr('Décalage Y (px)','Offset Y (px)'),'number',{min:-4*a.height,max:4*a.height,fallback:0});
    const text=details(edit,tr('Titre et cartouche','Title and background'));
    field(text,'title',tr('Texte du titre','Title text'),'textarea',{maxLength:2000});
    field(text,'titleAlign',tr('Alignement','Alignment'),'select',{fallback:'left',choices:[
      ['left',tr('Gauche','Left')],['center',tr('Centré','Center')],['right',tr('Droite','Right')]
    ]});
    field(text,'titleFont',tr('Police','Font'),'select',{fallback:'sans',choices:[
      ['sans',tr('Sans empattement','Sans serif')],['serif',tr('Avec empattements','Serif')]
    ]});
    field(text,'titleX','X (px)','number',{min:-4*a.width,max:4*a.width,fallback:Math.round(a.width*.06)});
    field(text,'titleY','Y (px)','number',{min:-4*a.height,max:4*a.height,fallback:Math.round(a.height*.75)});
    field(text,'titleSize',tr('Taille (px)','Size (px)'),'number',{min:1,max:Math.max(a.width,a.height)*2,fallback:Math.max(12,Math.round(a.height*.065))});
    field(text,'titleWidth',tr('Largeur (px)','Width (px)'),'number',{min:1,max:a.width*4,fallback:Math.round(a.width*.88)});
    field(text,'titleColor',tr('Couleur du texte','Text color'),'color',{fallback:'#ffffff'});
    const bg=document.createElement('label'), toggle=document.createElement('input'), colour=document.createElement('input');
    toggle.type='checkbox';toggle.id='rvBackgroundOn'; toggle.checked=!!(s.titleBackground && s.titleBackground!=='transparent');
    bg.className='rv-check';bg.append(toggle,document.createTextNode(tr('Cartouche opaque','Opaque background')));
    const colorLabel=document.createElement('label');colorLabel.textContent=tr('Couleur du cartouche','Background color');
    colour.id='rvBackground';colour.type='color';colour.value=toggle.checked?s.titleBackground:'#151a20';colour.disabled=!toggle.checked;
    colorLabel.append(colour);text.append(bg,colorLabel);
    const applyBackground=() => {s.titleBackground=toggle.checked?colour.value:'transparent';colour.disabled=!toggle.checked;dirty=true;persist();paint();};
    toggle.onchange=colour.oninput=applyBackground;
    const ocr=document.createElement('div');ocr.id='rvOcr';text.append(ocr);
    button(ocr,'rvReadText',tr('Lire le texte de cette image','Read text in this frame'),readText);
    const results=document.createElement('div');results.id='rvLines';results.setAttribute('aria-live','polite');ocr.append(results);
    const inset=details(edit,tr('Isoler un élément de l’image','Isolate part of the image')); inset.id='rvInsetControls'; insetControls(inset);
    setFrame(initialFrame ?? Math.floor((s.sourceIn+s.sourceOut-1)/2)); updateCommands();paint();
  }
  function updateCommands() {
    const s=shot(), next=session.shots[selected+1];
    $('#rvEarlier').disabled=selected===0; $('#rvLater').disabled=!next;
    $('#rvDrop').disabled=session.shots.length===1;
    $('#rvSplit').disabled=frame<=s.sourceIn || frame>=s.sourceOut;
    $('#rvMerge').disabled=!next || s.sourceOut!==next.sourceIn;
  }
  function setFrame(n) {
    if (!Number.isFinite(n)) n=shot().sourceIn;
    frame=Math.max(shot().sourceIn,Math.min(shot().sourceOut-1,Math.round(n)));
    session.frame=frame; persist();
    for(const el of [$('#rvScrub'),$('#rvFrame')]) {el.min=shot().sourceIn;el.max=shot().sourceOut-1;el.value=frame;}
    $('#rvLines')?.replaceChildren(); updateCommands(); clearTimeout(previewTimer);
    const img=$('#rvImage'), url=src(frame)+'&view=1', state=$('#rvImageState');
    state.textContent=tr('Chargement de l’image…','Loading frame…');
    img.onload=() => {if(img.getAttribute('src')===url) {state.textContent='';img.hidden=false;paint();}};
    img.onerror=() => {if(img.getAttribute('src')===url) {state.textContent=tr('Image indisponible','Frame unavailable');img.hidden=true;}};
    if(img.getAttribute('src')===url && img.complete && img.naturalWidth) {state.textContent='';img.hidden=false;}
    else { img.hidden=true; previewTimer=setTimeout(() => {img.src=url;},90); }
  }
  function paint() {
    const s=shot(), a=session.analysis, layer=$('#rvLayer');
    $('#rvBase').style.transform=choosingArea ? '' : 'translate('+(s.x||0)+'px,'+(s.y||0)+'px) scale('+(s.zoom||1)+')';
    const inset = s.inset, crop=$('#rvInsetBox'), mask=$('#rvMask');
    crop.hidden=!inset || choosingArea || $('#rvImage').hidden;
    mask.hidden=!inset || choosingArea || inset.mask==='transparent';
    if(inset) {
      Object.assign(mask.style,{left:inset.sourceX+'px',top:inset.sourceY+'px',width:inset.width+'px',height:inset.height+'px',backgroundColor:inset.mask});
      Object.assign(crop.style,{left:inset.x+'px',top:inset.y+'px',width:inset.width+'px',height:inset.height+'px',transform:'scale('+inset.scale+')'});
      const fragment=$('#rvInsetImage'), currentImage=$('#rvImage').getAttribute('src');
      if(!crop.hidden && currentImage && fragment.getAttribute('src')!==currentImage) fragment.src=currentImage;
      Object.assign(fragment.style,{width:a.width+'px',height:a.height+'px',left:-inset.sourceX+'px',top:-inset.sourceY+'px'});
    }
    layer.textContent=s.title || '';layer.hidden=!s.title || choosingArea;
    const size=s.titleSize??Math.max(12,Math.round(a.height*.065)), bg=s.titleBackground || 'transparent';
    Object.assign(layer.style,{left:(s.titleX??Math.round(a.width*.06))+'px',top:(s.titleY??Math.round(a.height*.75))+'px',
      width:(s.titleWidth??Math.round(a.width*.88))+'px',fontSize:size+'px',color:s.titleColor||'#ffffff',backgroundColor:bg,
      textAlign:s.titleAlign || 'left',fontFamily:s.titleFont==='serif' ? 'Georgia, "Times New Roman", serif' : 'Arial, sans-serif',
      padding:bg==='transparent'?'0':Math.round(size*.20)+'px '+Math.round(size*.32)+'px'});
  }
  function insetControls(container) {
    const a=session.analysis, s=shot();
    container.replaceChildren();
    const choose=button(container,'rvSelectArea',tr('Tracer une zone sur l’image','Draw a region on the frame'),() => {
      choosingArea=!choosingArea;
      $('#rvViewport').classList.toggle('rv-choosing',choosingArea);
      choose.textContent=choosingArea?tr('Annuler le tracé','Cancel selection'):tr('Tracer une zone sur l’image','Draw a region on the frame');
      paint();
      if(choosingArea) $('#rvViewport').scrollIntoView({block:'nearest'});
    });
    if (!s.inset) {
      button(container,'rvSetArea',tr('Saisir les coordonnées','Enter coordinates'),() => {
        s.inset={sourceX:0,sourceY:0,width:Math.max(1,Math.round(a.width/4)),height:Math.max(1,Math.round(a.height/4)),x:0,y:0,scale:1,mask:'transparent'};
        dirty=true;persist();insetControls(container);paint();
      });
      return;
    }
    button(container,'rvRemoveArea',tr('Retirer cet élément','Remove this layer'),() => {
      delete s.inset;dirty=true;persist();choosingArea=false;$('#rvViewport').classList.remove('rv-choosing');insetControls(container);paint();
    });
    const region=s.inset;
    const input=(key,text,min,max,step=1) => {
      const label=document.createElement('label'), el=document.createElement('input');
      label.textContent=text; el.type='number';el.id='rv-inset-'+key;el.min=min;el.max=max;el.step=step;el.value=region[key];
      el.oninput=() => {
        if(!el.checkValidity() || !Number.isFinite(el.valueAsNumber)) return;
        region[key]=el.valueAsNumber;
        $('#rv-inset-sourceX').max=a.width-region.width;$('#rv-inset-width').max=a.width-region.sourceX;
        $('#rv-inset-sourceY').max=a.height-region.height;$('#rv-inset-height').max=a.height-region.sourceY;
        dirty=true;persist();paint();
      };
      label.append(el);container.append(label);
    };
    input('sourceX',tr('Source X (px)','Source X (px)'),0,a.width-region.width);
    input('sourceY',tr('Source Y (px)','Source Y (px)'),0,a.height-region.height);
    input('width',tr('Largeur (px)','Width (px)'),1,a.width-region.sourceX);
    input('height',tr('Hauteur (px)','Height (px)'),1,a.height-region.sourceY);
    input('x',tr('Position X (px)','Position X (px)'),-4*a.width,4*a.width);
    input('y',tr('Position Y (px)','Position Y (px)'),-4*a.height,4*a.height);
    input('scale',tr('Échelle','Scale'),.1,10,.01);
    const toggle=document.createElement('input'), mask=document.createElement('input'), check=document.createElement('label'), name=document.createElement('label');
    toggle.type='checkbox';toggle.checked=region.mask!=='transparent';check.className='rv-check';
    check.append(toggle,document.createTextNode(tr('Masquer la zone d’origine','Cover original region')));
    name.textContent=tr('Fond à l’origine','Cover color');mask.type='color';mask.value=toggle.checked?region.mask:'#171a1e';mask.disabled=!toggle.checked;
    toggle.onchange=mask.oninput=() => {mask.disabled=!toggle.checked;region.mask=toggle.checked?mask.value:'transparent';dirty=true;persist();paint();};
    name.append(mask);container.append(check,name);
  }
  function attachAreaPicker(view) {
    const a=session.analysis, marquee=$('#rvMarquee');
    let start=null;
    function point(event) {
      const r=view.getBoundingClientRect();
      return {x:Math.round(Math.max(0,Math.min(1,(event.clientX-r.left)/r.width))*a.width),
        y:Math.round(Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))*a.height)};
    }
    function rect(end) {
      return {sourceX:Math.min(start.x,end.x),sourceY:Math.min(start.y,end.y),width:Math.abs(start.x-end.x),height:Math.abs(start.y-end.y)};
    }
    view.onpointerdown=event => {
      if(!choosingArea || event.button!==0) return;
      event.preventDefault();start=point(event);view.setPointerCapture(event.pointerId);
    };
    view.onpointermove=event => {
      if(!start) return;
      const r=rect(point(event));marquee.hidden=false;
      Object.assign(marquee.style,{left:r.sourceX+'px',top:r.sourceY+'px',width:r.width+'px',height:r.height+'px'});
    };
    view.onpointercancel=() => {start=null;marquee.hidden=true;};
    view.onpointerup=event => {
      if(!start) return;
      const r=rect(point(event));start=null;marquee.hidden=true;
      if(!r.width || !r.height) return;
      shot().inset={...r,x:r.sourceX,y:r.sourceY,scale:1,mask:'transparent'};
      choosingArea=false; view.classList.remove('rv-choosing');dirty=true;persist();
      insetControls($('#rvInsetControls'));paint();
    };
  }
  async function readText() {
    const box=$('#rvLines'), control=$('#rvReadText'), s=shot(), f=frame;
    box.textContent=tr('Lecture en cours…','Reading…');control.disabled=true;
    try {
      const {lines} = await api(jobUrl()+'/text?frame='+f);
      if(!box.isConnected || f!==frame) return;
      box.textContent=lines.length?tr('Choisis une ligne pour en faire un titre éditable.','Choose a line to make it an editable title.'):tr('Aucun texte détecté sur cette image.','No text detected in this frame.');
      lines.forEach((line,n) => button(box,'rvLine'+n,line.text,() => {
        const a=session.analysis,z=s.zoom||1;
        Object.assign(s,{title:line.text,titleX:Math.round((line.x-a.width/2)*z+a.width/2+(s.x||0)),
          titleY:Math.round((line.y-a.height/2)*z+a.height/2+(s.y||0)),titleSize:Math.max(1,Math.round(line.height*z)),
          titleWidth:Math.max(1,Math.round(line.width*z*1.12))});
        for(const key of ['title','titleX','titleY','titleSize','titleWidth']) $('#rv-'+key).value=s[key];
        dirty=true; persist();paint(); box.textContent=tr('Titre ajouté. Active le cartouche pour couvrir le texte incrusté.','Title added. Enable its background to cover baked-in text.');
      }));
    } catch(e) { if(box.isConnected && f===frame) box.textContent=tr('Lecture du texte indisponible. ','Text recognition unavailable. ')+e.message; }
    finally {control.disabled=false;}
  }
  async function save() {
    const invalid=[...body.querySelectorAll('input,textarea')].find(el=>!el.checkValidity() || el.type==='number' && el.value==='');
    if (invalid) { if(invalid.closest('details')) invalid.closest('details').open=true; invalid.focus(); invalid.reportValidity(); return; }
    const name=session.name?.trim(); if(!name) {$('#rvProjectName').focus();return;}
    const editing=$('#rvCreate'); editing.disabled=true; error(''); const current=generation;
    try {
      await api(jobUrl()+'/create',{name,shots:session.shots,revision:session.revision});
      if(generation===current) {progressPanel('creating',0);await poll(current);}
    } catch(e) {
      if(generation===current) {
        error(e.message);
        if(e.needInstall && !$('#rvInstall')) button(footer,'rvInstall',tr('Installer Remotion puis créer','Install Remotion and create'),install);
      }
      editing.disabled=false;
    }
  }
  async function install(ev) {
    const b=ev.currentTarget, current=generation;
    b.disabled=true; $('#rvCreate').disabled=true;
    try {
      await api('/api/new/install',{});
      error(tr('Installation de Remotion en cours…','Installing Remotion…'));
      for (;;) {
        const st=await fetch('/api/new/install',{cache:'no-store'}).then(r=>r.json());
        if(generation!==current) return;
        if(st.state==='done') {b.remove();await save();return;}
        if(st.state!=='running') throw new Error(st.error || tr('Installation interrompue.','Installation interrupted.'));
        await new Promise(resolve=>setTimeout(resolve,1200));
      }
    } catch(e) {if(generation===current) error(e.message);}
    finally {b.disabled=false; if($('#rvCreate')) $('#rvCreate').disabled=false;}
  }
  async function open(projectId) {
    if (dialog.open) return;
    if (projectId && session.job && session.projectId!==projectId) {
      if (dirty && !confirm(tr('Quitter le montage en cours pour ouvrir ce projet ?', 'Leave the current edit and open this project?'))) return;
      try { await api(jobUrl()+'/cancel',{}); } catch { /* Expired session. */ }
      reset();
    }
    dialog.showModal();
    if(projectId && !session.job) {
      const current=++generation; panel(editLabel); body.textContent=tr('Ouverture du montage…','Opening edit…');
      try {
        const r=await api('/api/reverse/edit',{id:projectId}); if(generation!==current) return;
        session={job:r.job,projectId};persist();await poll(current);
      } catch(e) {if(generation===current) error(e.message);}
    } else if(session.job) { await poll(++generation); } else sourcePanel();
  }
  return {label,editLabel,open,pending:()=>!!session.job};
};

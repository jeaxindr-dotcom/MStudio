// A scene contact sheet. MP4 thumbnails are read serially. An image from code is
// an actual Remotion still render, requested individually by the reviewer.
{
  const tr = (fr, en) => FR ? fr : en;
  const boardButton = document.createElement('button');
  boardButton.id = 'storyboardButton';
  boardButton.title = tr('Storyboard des scènes', 'Scene storyboard');
  boardButton.setAttribute('aria-label', boardButton.title);
  boardButton.innerHTML = ic('film');
  $('#bSrc').after(boardButton);
  const board = document.createElement('dialog'); board.id = 'storyboard';
  board.setAttribute('aria-labelledby', 'storyboardTitle');
  board.innerHTML = `<header class="story-head"><div><h2 id="storyboardTitle">Storyboard</h2><p id="storyProject"></p></div>
    <button id="storyClose" class="soft" aria-label="${tr('Fermer','Close')}">${ic('x')}</button></header>
    <div id="storyGrid"></div><footer class="story-foot"><span id="storyCount" aria-live="polite"></span>
    <button id="storyPrev" class="soft" aria-label="${tr('Page précédente','Previous page')}">${ic('left')}</button>
    <button id="storyNext" class="soft" aria-label="${tr('Page suivante','Next page')}">${ic('right')}</button></footer>`;
  document.body.append(board);
  const grid = board.querySelector('#storyGrid');
  const perPage = 12;
  let sheet = [], page = 0, generation = 0, activeController = null;
  let queue = Promise.resolve();
  const urls = new Set();
  function release() {
    generation++;
    activeController?.abort();
    activeController = null;
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
  }
  function scenes() {
    if (PROJ && !LIVE?.tracks?.some(t => t.type === 'band' && t.clips?.length)) {
      const video = LIVE?.tracks?.find(t => t.type === 'video' && t.clips?.length);
      if (video) return video.clips.filter(c => !c.off).map(c => ({
        name: c.label, from: Math.max(0, frameOfT(c.t0)),
        to: Math.min(FRAMES - 1, frameOfT(c.t1) - 1),
      })).filter(s => s.to >= s.from).sort((a,b) => a.from - b.from);
    }
    return cgScenes();
  }
  function loadThumb(cell, scene, source, ticket) {
    const button = cell.querySelector('.story-capture'), box = cell.querySelector('.story-image');
    button.disabled = true; button.textContent = tr('Chargement…','Loading…');
    const frame = Math.max(scene.from, Math.min(scene.to, Math.round((scene.from + scene.to) / 2)));
    queue = queue.then(async () => {
      if (ticket !== generation) return;
      activeController = new AbortController();
      try {
        const res = await fetch('/api/frame?' + new URLSearchParams({f: frame, source, w: 384}), {signal:activeController.signal});
        if (!res.ok || !res.headers.get('Content-Type')?.includes('image/')) throw new Error('image');
        const blob = await res.blob();
        if (ticket !== generation) return;
        const url = URL.createObjectURL(blob); urls.add(url);
        const image = new Image(); image.alt = ''; image.src = url; box.prepend(image);
        button.hidden = true;
      } catch {
        if (ticket === generation) { button.disabled = false; button.textContent = tr('Réessayer la vignette','Retry thumbnail'); }
      } finally { if (ticket === generation) activeController = null; }
    });
  }
  function showPage(next) {
    release(); const ticket = generation;
    page = Math.max(0, Math.min(Math.ceil(sheet.length / perPage) - 1, next));
    const items = sheet.slice(page * perPage, (page + 1) * perPage);
    grid.replaceChildren(); grid.scrollTop = 0;
    const source = mode === 'video' && META?.render ? 'video' : 'code';
    items.forEach((s,i) => {
      const cell = document.createElement('article');
      const select = document.createElement('button'); select.className = 'story-scene';
      const time = fmt(s.from / FPS), count = notes.filter(n => n.kind !== 'prompt' && n.frame <= s.to && (n.end ?? n.frame) >= s.from).length;
      select.innerHTML = `<span class="story-image"><span class="story-index">${String(page * perPage + i + 1).padStart(2,'0')}</span>
        <time>${time}</time></span><strong></strong><small></small>`;
      select.querySelector('strong').textContent = s.name;
      select.querySelector('small').textContent = '#' + s.from + ' – #' + s.to + (count ? '  ·  ' + count + (count === 1 ? ' note' : ' notes') : '');
      if (curFrame() >= s.from && curFrame() <= s.to) select.setAttribute('aria-current','true');
      select.onclick = () => { board.close(); M.pause(); seekFrame(s.from); };
      const capture = document.createElement('button'); capture.className = 'story-capture';
      capture.textContent = tr('Rendre la vignette','Render thumbnail');
      capture.title = tr('Calculer cette image depuis la composition','Render this frame from the composition');
      cell.append(select, capture); grid.append(cell);
      capture.onclick = () => loadThumb(cell, s, source, ticket);
      if (source === 'video') capture.click();
    });
    $('#storyCount').textContent = sheet.length ? (page * perPage + 1) + '–' + (page * perPage + items.length) + ' / ' + sheet.length : tr('La timeline est en cours de chargement.','The timeline is loading.');
    $('#storyPrev').disabled = page === 0; $('#storyNext').disabled = (page + 1) * perPage >= sheet.length;
  }
  function open() {
    if (!META || board.open || document.querySelector('dialog[open]')) return;
    sheet = scenes(); $('#storyProject').textContent = META.title;
    const index = sheet.findIndex(s => curFrame() >= s.from && curFrame() <= s.to);
    board.showModal(); showPage(Math.floor(Math.max(0,index) / perPage)); $('#storyClose').focus();
  }
  boardButton.onclick = open;
  $('#storyPrev').onclick = () => showPage(page - 1); $('#storyNext').onclick = () => showPage(page + 1);
  $('#storyClose').onclick = () => board.close();
  board.addEventListener('close', release);
  board.addEventListener('click', e => { if (e.target === board) board.close(); });
  board.addEventListener('keydown', e => e.stopPropagation());
  let savingFrame = false;
  async function saveFrame() {
    if (!META || !FRAMES || savingFrame) return;
    savingFrame = true;
    const f = curFrame(), src = mode === 'code' ? 'code' : 'video';
    setSave(tr('Préparation du JPEG…','Preparing JPEG…'));
    try {
      const response = await fetch('/api/frame?' + new URLSearchParams({f, source:src}));
      if (!response.ok || !response.headers.get('Content-Type')?.includes('image/jpeg')) throw new Error(String(response.status));
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = url;
      const file = (META.title || 'Coulisses').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 90);
      link.download = file + '-' + src + '-' + f + '.jpg';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      setSave(tr('Image exportée','Frame exported') + ' · #' + f, 'ok');
    } catch (error) { setSave(tr('Échec de l’export JPEG','JPEG export failed') + ' · ' + error.message, 'err'); }
    finally { savingFrame = false; }
  }
  window.CoulissesStoryboard = {open, scenes, saveFrame};
}

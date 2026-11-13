// Filmstrip cells are anchored to clip frames. Panning only reveals new cells;
// repainting the playhead uses decoded thumbnails without seeking the player.
const filmstrip = (() => {
  const text = (fr, en) => FR ? fr : en;
  const toggle = document.createElement('button');
  toggle.id = 'timelineThumbnails'; toggle.className = 'icon';
  toggle.innerHTML = ic('film'); toggle.title = text('Vignettes des clips', 'Clip thumbnails');
  toggle.setAttribute('aria-label', toggle.title);
  const generate = document.createElement('button');
  generate.id = 'renderTimelineThumbnails'; generate.className = 'icon'; generate.innerHTML = ic('image');
  generate.title = text('Calculer les vignettes visibles depuis le code actuel', 'Render visible thumbnails from current code');
  generate.setAttribute('aria-label', generate.title); generate.hidden = true;
  $('#tlbar .zoom').prepend(toggle, generate);
  let enabled = store.get('timelineThumbnails', true) !== false;
  const bitmapCache = new Map(), unavailable = new Set(), failures = new Map();
  const requestedCode = new Set(), cells = new Map();
  const autoAttempts = new Set();
  const tilesPerBatch = 8, automaticLimit = 32, cacheCapacity = 384;
  let signature = '', plan = null, epoch = 0, timer, busy = false, controller = null;
  let viewport = '', autoBlocked = false, activeBatch = null;
  let codeTiles = [], retryTimer = null, retryCells = [], retryCount = 0;
  toggle.setAttribute('aria-pressed', String(enabled));
  toggle.classList.toggle('on', enabled);
  toggle.onclick = () => {
    enabled = !enabled; store.set('timelineThumbnails', enabled);
    toggle.setAttribute('aria-pressed', String(enabled)); toggle.classList.toggle('on', enabled);
    if (!enabled) suspend();
    resize();
  };
  const assetTag = (id, index) => new URLSearchParams({track:id, clip:index}).toString();
  const isAsset = file => /\.(?:mp4|mov|m4v|mkv|webm|avi|png|apng|jpg|jpeg|webp|gif|bmp|avif)$/i.test(file || '');
  function begin() {
    const render = STATUS.video || META?.render;
    const next = [META?.notesFile, FPS, mode, render?.name, render?.mtime, render?.size,
      STATUS.timeline?.version, STATUS.code?.version, STATUS.code?.hash, STATUS.held].join('|');
    if (next !== signature || plan !== LIVE) {
      signature = next; plan = LIVE; epoch++;
      for (const tile of bitmapCache.values()) tile.close();
      bitmapCache.clear(); requestedCode.clear(); unavailable.clear(); failures.clear(); controller?.abort();
      clearCodeRetry(); retryCount = 0;
      autoAttempts.clear(); viewport = ''; autoBlocked = false;
    }
    codeTiles = [...bitmapCache].filter(([key]) => key.startsWith('code|')).map(([key,tile]) => ({tile,frame:Number(key.slice(5))}));
    cells.clear();
  }
  function baseSource() {
    if (mode === 'video' && META?.render && !STATUS.held) return 'video';
    return mode === 'code' && META?.engine === 'remotion' ? 'code' : null;
  }
  function paint(g, {start, end, y, height, title, color, asset, inactive = false}) {
    const first = Math.max(0, Math.round(start * FPS));
    const last = Math.min(FRAMES, Math.round(end * FPS));
    const left = Math.max(0, tx(start)), right = Math.min(W, tx(end)) - 1;
    if (last <= first || right - left < 2 || height < 17) return;
    const cap = Math.min(14, Math.floor(height * .45));
    const stripY = y + cap, stripH = height - cap;
    const pixelsPerFrame = W / ((view.b - view.a) * FPS);
    if (!(pixelsPerFrame > 0)) return;
    const step = Math.max(1, Math.round(stripH * 16 / 9 / pixelsPerFrame));
    const source = asset && !unavailable.has(asset) ? asset : baseSource();
    const nearby = source === 'code' ? codeTiles.filter(c => c.frame >= first && c.frame < last) : [];
    g.save();
    rr(g, left, y, right - left, height, 3); g.clip();
    g.fillStyle = '#151b20'; g.fillRect(left, y, right - left, height);
    g.fillStyle = color; g.fillRect(left, y, right - left, 2);
    g.globalAlpha = inactive ? .36 : 1;
    const startCell = Math.max(0, Math.floor((view.a * FPS - first) / step));
    const endCell = Math.min(Math.ceil((last - first) / step), Math.ceil((view.b * FPS - first) / step));
    for (let i = startCell; i < endCell; i++) {
      const a = first + i * step, b = Math.min(last, a + step);
      const x = tx(a / FPS), width = Math.max(.5, (b - a) * pixelsPerFrame);
      if (x + width <= left || x >= right) continue;
      const frame = a + Math.floor((b - a - 1) / 2);
      let tile;
      if (source && right - left >= 5 && stripH >= 8) {
        const key = source + '|' + frame;
        if (cells.size < 256 || cells.has(key)) cells.set(key, {key, source, frame, first, last});
        tile = bitmapCache.get(key);
        // A first image covers its own clip immediately. Refine the strip with
        // more samples later; never borrow an image across a cut.
        if (!tile && nearby.length) tile = nearby.reduce((a,b) => Math.abs(a.frame-frame) <= Math.abs(b.frame-frame) ? a : b).tile;
      }
      if (tile) {
        // Crop the tile symmetrically at the clip edge, retaining its aspect ratio.
        const scale = Math.max(width / tile.width, stripH / tile.height);
        const sw = width / scale, sh = stripH / scale;
        g.drawImage(tile, (tile.width-sw)/2, (tile.height-sh)/2, sw, sh, x, stripY, width, stripH);
      } else {
        g.fillStyle = '#242f35'; g.fillRect(x, stripY, width, stripH);
      }
      g.fillStyle = 'rgba(7,12,15,.55)'; g.fillRect(x, stripY, Math.min(1,width), stripH);
    }
    if (right - left >= 19) {
      g.fillStyle = '#e8edef'; g.font = '600 10px ' + FONT;
      g.fillText(title || '', left + 4, y + cap / 2 + 1);
    }
    g.restore();
  }
  function possible(c) {
    return !bitmapCache.has(c.key) && !failures.has(c.key) && (c.source !== 'code' || requestedCode.has(c.key));
  }
  function requestAutomatic() {
    if (!enabled || !M.paused || document.hidden || STATUS.code?.status !== 'ready' || autoBlocked || requestedCode.size) return;
    const candidates = [...cells.values()].filter(c => c.source === 'code' && !bitmapCache.has(c.key) && !failures.has(c.key) && !autoAttempts.has(c.key));
    const cachedFrames = codeTiles.map(c => c.frame);
    const uncovered = new Map();
    for (const c of candidates) if (!cachedFrames.some(frame => frame >= c.first && frame < c.last)) {
      const key = c.first + ':' + c.last;
      if (!uncovered.has(key)) uncovered.set(key,[]);
      uncovered.get(key).push(c);
    }
    // One sample per visible clip takes priority over details. A dense view can
    // have more than 32 clips, but never queues more than eight images at once.
    const coverage = [...uncovered.values()].map(group => group[Math.floor(group.length/2)]);
    const choices = coverage.length ? coverage : candidates;
    const count = Math.max(0,Math.min(tilesPerBatch, coverage.length ? coverage.length : automaticLimit - autoAttempts.size, choices.length));
    for (let i = 0; i < count; i++) {
      const c = choices[Math.floor((i + .5) * choices.length / count)];
      autoAttempts.add(c.key); requestedCode.add(c.key);
    }
  }
  function controls() {
    const code = [...cells.values()].filter(c => c.source === 'code' && !bitmapCache.has(c.key));
    generate.hidden = !enabled || !code.length;
    generate.disabled = code.length === 0 || !M.paused || STATUS.code?.status !== 'ready' || requestedCode.size > 0;
    generate.title = !M.paused ? text('Mettre en pause pour calculer les vignettes','Pause to render thumbnails')
      : requestedCode.size ? text('Préparation des vignettes visibles…','Preparing visible thumbnails…')
      : text('Compléter ou réessayer les vignettes visibles', 'Complete or retry visible thumbnails');
    generate.setAttribute('aria-busy', String(requestedCode.size > 0));
  }
  function schedule() {
    if (M.paused && !busy && !timer && enabled && [...cells.values()].some(possible)) timer = setTimeout(pump, 130);
  }
  function clearCodeRetry() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer); retryTimer = null; autoBlocked = false;
      for (const c of retryCells) { failures.delete(c.key); autoAttempts.delete(c.key); }
    }
    retryCells = [];
  }
  function end() {
    const nextViewport = [...cells.keys()].join(';');
    if (nextViewport !== viewport) {
      viewport = nextViewport; autoAttempts.clear(); autoBlocked = false;
      clearCodeRetry(); retryCount = 0;
      // Debounce pan/zoom. Cancel a capture that no longer belongs to the view.
      clearTimeout(timer); timer = null;
      if (activeBatch?.some(c => !cells.has(c.key))) controller?.abort();
    }
    for (const key of requestedCode) if (!cells.has(key)) requestedCode.delete(key);
    requestAutomatic();
    controls(); schedule();
  }
  generate.onclick = () => {
    if (generate.disabled) return;
    clearCodeRetry(); retryCount = 0; autoBlocked = false;
    for (const c of cells.values()) {
      if (c.source === 'code' && !bitmapCache.has(c.key)) {
        failures.delete(c.key); requestedCode.add(c.key);
        if (requestedCode.size === 32) break;
      }
    }
    controls(); schedule();
  };
  async function pump() {
    timer = null;
    if (busy || !enabled || document.hidden || !M.paused) return;
    const missing = [...cells.values()].filter(possible);
    const source = missing.find(c => c.source === 'code')?.source || missing[0]?.source;
    if (!source) return;
    const batch = missing.filter(c => c.source === source).slice(0, tilesPerBatch);
    const params = source === 'video' || source === 'code' ? new URLSearchParams() : new URLSearchParams(source);
    params.set('frames', batch.map(c => c.frame).join(',')); params.set('fps', FPS);
    if (source === 'code') params.set('version', STATUS.code.version);
    const route = source === 'code' ? '/api/timeline-code-thumbnails?' : '/api/timeline-thumbnails?';
    const ticket = epoch, signal = (controller = new AbortController()).signal;
    busy = true; activeBatch = batch;
    try {
      const r = await fetch(route + params, {signal, cache:'no-store'});
      if (!r.ok) throw Object.assign(new Error(String(r.status)), {status:r.status});
      const sheet = await createImageBitmap(await r.blob());
      try {
        if (sheet.width !== batch.length * 128 || sheet.height !== 72) throw new Error('Invalid thumbnail sheet');
        for (const [i,c] of batch.entries()) {
          if (ticket !== epoch || signal.aborted) break;
          const tile = await createImageBitmap(sheet, i * 128, 0, 128, 72);
          if (ticket !== epoch || signal.aborted) { tile.close(); break; }
          bitmapCache.set(c.key, tile);
          if (bitmapCache.size > cacheCapacity) {
            const oldest = [...bitmapCache.keys()].find(k => !cells.has(k));
            if (oldest) { bitmapCache.get(oldest).close(); bitmapCache.delete(oldest); }
          }
        }
      } finally { sheet.close(); }
      if (source === 'code') retryCount = 0;
    } catch (error) {
      if (ticket === epoch && !signal.aborted) {
        if (source !== 'video' && source !== 'code' && [404,415,422].includes(error.status)) unavailable.add(source);
        else {
          for (const c of batch) failures.set(c.key, true);
          if (source === 'code') {
            requestedCode.clear(); autoBlocked = true;
            if ([429,503].includes(error.status) && retryCount < 4) {
              // The cancelled renderer may still be releasing its slot. Wait
              // rather than leaving the final panned view permanently empty.
              const retryView = viewport, delay = [1000,2000,4000,6000][retryCount++];
              retryCells = batch;
              retryTimer = setTimeout(() => {
                if (ticket === epoch && retryView === viewport) { clearCodeRetry(); scheduleDraw(); }
              }, delay);
            } else setSave(text('Vignettes du code indisponibles','Code thumbnails unavailable') + ' · ' + error.message, 'err');
          } else if ([429,503].includes(error.status)) {
            setTimeout(() => { if (ticket === epoch) { for (const c of batch) failures.delete(c.key); scheduleDraw(); } }, 5000);
          }
        }
      }
    } finally {
      if (signal.aborted) for (const c of batch) autoAttempts.delete(c.key);
      if (ticket === epoch) for (const c of batch) requestedCode.delete(c.key);
      busy = false; controller = null; activeBatch = null; scheduleDraw();
    }
  }
  function suspend() {
    clearTimeout(timer); timer = null;
    clearCodeRetry();
    for (const key of requestedCode) autoAttempts.delete(key);
    requestedCode.clear(); controller?.abort();
    controls();
  }
  window.addEventListener('pagehide', suspend);
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); else scheduleDraw(); });
  M.on('pause', () => { controls(); scheduleDraw(); });
  M.on('play', suspend);
  return {get enabled(){return enabled;}, assetTag, isAsset, begin, paint, end};
})();

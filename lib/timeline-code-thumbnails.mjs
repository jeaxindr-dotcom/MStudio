import {spawn} from 'node:child_process';
import {codeFrameList} from './frames.mjs';

const WIDTH = 128, HEIGHT = 72, MAX_TILES = 8;
const failure = (status, message) => Object.assign(new Error(message), {status});

function compose(images, signal) {
  return new Promise((resolve, reject) => {
    const filter = `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,tile=${images.length}x1`;
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-threads', '1', '-i', 'pipe:0',
      '-filter_threads', '1', '-vf', filter, '-frames:v', '1', '-c:v', 'mjpeg', '-threads', '1', '-q:v', '4', '-f', 'image2pipe', 'pipe:1'],
      {signal, windowsHide:true, stdio:['pipe','pipe','pipe']});
    const parts = []; let error = '';
    child.stdout.on('data', chunk => parts.push(chunk));
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-1000); });
    child.stdin.on('error', err => { if (err.code !== 'EPIPE') reject(err); });
    child.on('error', reject);
    child.on('close', code => code === 0 && parts.length ? resolve(Buffer.concat(parts)) : reject(new Error(error || 'FFmpeg : image vide.')));
    child.stdin.end(Buffer.concat(images));
  });
}

export function timelineCodeThumbnails({project, generation, current, fingerprint, render = codeFrameList, timeout = 90000}) {
  // One composition per server. Remember compressed tiles, so neighboring pages
  // and zoom levels share exact frames, including repeated frames in short clips.
  const tiles = new Map();
  let active = null, generationKey = null, bytes = 0;
  function put(frame, tile) {
    if (tiles.has(frame)) { bytes -= tiles.get(frame).length; tiles.delete(frame); }
    tiles.set(frame, tile); bytes += tile.length;
    while (tiles.size > 256 || bytes > 4 * 1024 * 1024) {
      const oldest = tiles.keys().next().value; bytes -= tiles.get(oldest).length; tiles.delete(oldest);
    }
  }
  async function build(version, frames, signal) {
    if (!current(version)) throw failure(409, 'La version de l’aperçu a changé.');
    const g = await generation(version,signal);
    signal.throwIfAborted();
    if (!current(version, g.hash)) throw failure(409, 'La version de l’aperçu a changé.');
    if (frames.some(f => f >= g.durationInFrames)) throw failure(400, 'Image hors composition.');
    const key = g.hash + ':' + g.mediaSignature;
    if (generationKey !== key) { tiles.clear(); bytes = 0; generationKey = key; }
    const selected = new Map(), missing = [];
    for (const f of new Set(frames)) {
      if (!tiles.has(f)) { missing.push(f); continue; }
      const data = tiles.get(f); put(f, data); selected.set(f, data);
    }
    if (missing.length) {
      await render(project, missing, {cacheKey:key, fitTo:{width:WIDTH,height:HEIGHT}, signal, onFrame:(f, data, actual) => {
        if (f !== actual) throw failure(409,'Le nombre d’images de la composition a changé.');
        selected.set(f, data);
      }});
      signal.throwIfAborted();
      if (await fingerprint(signal) !== g.mediaSignature) throw failure(409, 'Les médias de la composition ont changé.');
    }
    if (!current(version, g.hash)) throw failure(409, 'La version de l’aperçu a changé.');
    const sheet = await compose(frames.map(f => selected.get(f)), signal);
    if (!current(version, g.hash)) throw failure(409, 'La version de l’aperçu a changé.');
    for (const f of missing) put(f, selected.get(f));
    return sheet;
  }
  // A browser may abandon a sheet on Play or while another window still needs
  // it. Abort the shared render only after the last interested client leaves.
  function subscribe(job, signal) {
    if (!signal) { job.uninterruptible = true; return job.result; }
    signal.throwIfAborted();
    return new Promise((resolve,reject) => {
      const subscriber = () => {
        job.subscribers.delete(subscriber);
        reject(signal.reason);
        if (!job.uninterruptible && !job.subscribers.size) job.controller.abort(signal.reason);
      };
      job.subscribers.add(subscriber);
      signal.addEventListener('abort', subscriber, {once:true});
      job.result.then(resolve,reject).finally(() => {
        signal.removeEventListener('abort',subscriber);
        job.subscribers.delete(subscriber);
      });
    });
  }
  return function get(params, signal) {
    signal?.throwIfAborted();
    const list = params.get('frames') || '', rawVersion = params.get('version') || '';
    if (!/^\d{1,10}$/.test(rawVersion) || !/^\d{1,10}(,\d{1,10}){0,7}$/.test(list))
      throw failure(400, 'Version et liste de 1 à ' + MAX_TILES + ' images requises.');
    const version = Number(rawVersion), frames = list.split(',').map(Number);
    if (!current(version)) throw failure(409, 'La version de l’aperçu a changé.');
    const id = version + '/' + frames.join(',');
    if (active) {
      if (active.id === id && !active.controller.signal.aborted) return subscribe(active,signal);
      throw failure(429, 'Une planche de vignettes est déjà en cours.');
    }
    const controller = new AbortController();
    // An abandoned build may still be winding down in the Remotion queue. Keep
    // its slot until it settles; reject the HTTP request on time regardless.
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = failure(504, 'Le calcul des vignettes a dépassé le délai.');
        controller.abort(err); reject(err);
      }, timeout);
      timer.unref();
    });
    const job = build(version, frames, controller.signal).finally(() => { clearTimeout(timer); active = null; });
    const result = Promise.race([job, deadline]);
    active = {id, result, controller, uninterruptible:false, subscribers:new Set()};
    return subscribe(active,signal);
  };
}

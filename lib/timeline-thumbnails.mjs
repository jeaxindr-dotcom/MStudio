import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const width = 128, height = 72, rowBytes = width * 3, tileBytes = rowBytes * height;
const image = /\.(?:png|jpe?g|webp|bmp|gif|tiff?)$/i;
const movie = /\.(?:mp4|m4v|mov|mkv|webm|avi|mpe?g|mts|ts)$/i;
const error = (status, message) => Object.assign(new Error(message), {status});

export function parseThumbnailRequest(params) {
  const raw = params.get('frames') || '';
  if (!/^\d{1,10}(,\d{1,10}){0,9}$/.test(raw)) throw error(400, 'invalid-frames');
  const frames = raw.split(',').map(Number);
  const track = params.get('track'), rawClip = params.get('clip');
  if ((track === null) !== (rawClip === null) || (track !== null && (!track || !/^\d{1,8}$/.test(rawClip)))) {
    throw error(400, 'invalid-clip');
  }
  const fps = params.has('fps') ? Number(params.get('fps')) : null;
  if (fps !== null && (!Number.isFinite(fps) || fps <= 0 || fps > 1000)) throw error(400, 'invalid-fps');
  return {frames, track, clip: rawClip === null ? null : Number(rawClip), fps};
}

const below = (root, file) => {
  const relative = path.relative(root, file);
  return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
function clipFile(project, file) {
  if (typeof file !== 'string' || (!image.test(file) && !movie.test(file))) return null;
  const roots = [project.EP, project.remotionDir, project.hf?.projet].filter(Boolean);
  const bases = [...roots, ...(project.remotionDir ? [path.join(project.remotionDir, 'public')] : [])];
  const allowed = roots.flatMap(root => {
    try { return [fs.realpathSync.native(root)]; } catch { return []; }
  });
  for (const base of bases) {
    const candidate = path.resolve(base, file);
    if (!roots.some(root => below(root, candidate))) continue;
    try {
      const real = fs.realpathSync.native(candidate);
      if (allowed.some(root => below(root, real)) && fs.statSync(real).isFile()) return real;
    } catch { /* Try the run, engine and its public assets. */ }
  }
  return null;
}

export function thumbnailSource(project, request, timeline, video, displayFps) {
  const fps = request.fps ?? displayFps;
  if (!Number.isFinite(fps) || fps <= 0) throw error(400, 'invalid-fps');
  if (request.track === null) {
    if (!video) throw error(404, 'no-video');
    return {file: video, fps, frames: request.frames};
  }
  const track = timeline?.tracks?.find(t => t.id === request.track && t.type === 'video');
  const clip = track?.clips?.[request.clip];
  const file = clipFile(project, clip?.file);
  if (!file) throw error(404, 'no-clip-media');
  const start = Math.round(clip.t0 * fps), end = Math.round(clip.t1 * fps);
  if (request.frames.some(f => f < start || f >= end)) throw error(400, 'frame-outside-clip');
  const offset = Number(clip.from ?? 0) * fps / (timeline.fps || fps);
  if (!Number.isFinite(offset) || offset < 0) throw error(422, 'invalid-clip-offset');
  return {file, fps, frames: request.frames.map(f => image.test(file) ? 0 : f - start + offset)};
}

// A short seek for each sample. At most three single-threaded decoders are alive
// in one process; all images are reduced before stacking, including portrait media.
function ffmpeg(args, signal, input) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-v', 'error', ...args], {windowsHide: true, stdio: ['pipe','pipe','pipe']});
    const chunks = []; let stderr = '', launchError = null;
    const kill = () => child.kill();
    const timer = setTimeout(kill, 20000);
    signal.addEventListener('abort', kill, {once:true});
    child.on('error', e => { launchError = e; });
    child.stdout.on('data', b => chunks.push(b));
    child.stderr.on('data', b => { stderr = (stderr + b).slice(-1200); });
    child.stdin.on('error', () => { /* closed by an aborted decode */ });
    child.stdin.end(input);
    child.on('close', code => {
      clearTimeout(timer); signal.removeEventListener('abort', kill);
      if (signal.aborted) reject(error(503, 'thumbnail-interrupted'));
      else if (launchError || code !== 0) reject(error(422, launchError?.message || stderr.trim() || 'thumbnail-decode-failed'));
      else resolve(Buffer.concat(chunks));
    });
  });
}

async function decode(file, fps, frames, signal) {
  const args = ['-copyts','-start_at_zero'], filters = [], still = image.test(file);
  for (const [i, f] of frames.entries()) {
    // Select the source picture actually held at the centre of the composition
    // frame, also when its cadence differs. Keep the preceding keyframe's PTS.
    // fps rounds each source timestamp up to a microsecond and emits just the
    // first sample at "at"; trim ends its output immediately.
    const at = Math.max(0, (f + 0.5) / fps).toFixed(6);
    args.push('-threads', '1', ...(still ? [] : ['-noaccurate_seek','-ss',at]), '-protocol_whitelist', 'file,pipe',
      '-format_whitelist', 'mov,matroska,webm,avi,mpegts,mpeg,image2,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,tiff_pipe,gif,mjpeg', '-i', file);
    const sample = still ? '' : `fps=fps=1000000:start_time=${at}:round=up,`;
    filters.push(`[${i}:v:0]${sample}trim=end_frame=1,setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=area:reset_sar=1,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=rgb24[t${i}]`);
  }
  const tags = frames.map((_, i) => `[t${i}]`).join('');
  filters.push(tags + (frames.length > 1 ? 'vstack=inputs=' + frames.length + ':shortest=1' : 'null') + '[out]');
  const bytes = await ffmpeg([...args, '-filter_complex_threads', '1', '-filter_complex', filters.join(';'), '-map', '[out]',
    '-frames:v', '1', '-threads', '1', '-pix_fmt', 'rgb24', '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'], signal);
  if (bytes.length !== frames.length * tileBytes) throw error(422, 'thumbnail-frame-unavailable');
  return frames.map((_, i) => bytes.subarray(i * tileBytes, (i + 1) * tileBytes));
}

function jpeg(tiles, signal) {
  const stride = rowBytes * tiles.length, sheet = Buffer.allocUnsafe(stride * height);
  for (const [i, tile] of tiles.entries()) {
    for (let y = 0; y < height; y++) tile.copy(sheet, y * stride + i * rowBytes, y * rowBytes, (y+1) * rowBytes);
  }
  return ffmpeg(['-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${tiles.length*width}x${height}`,
    '-i', 'pipe:0', '-frames:v', '1', '-threads', '1', '-q:v', '4', '-c:v', 'mjpeg', '-f', 'image2pipe', 'pipe:1'], signal, sheet);
}

function remember(map, key, data, max) {
  map.delete(key); map.set(key, data);
  if (map.size > max) map.delete(map.keys().next().value);
  return data;
}
const version = (file) => {
  const s = fs.statSync(file, {bigint:true});
  return [file, s.ino, s.size, s.mtimeNs, s.ctimeNs].join('|');
};

export function createTimelineThumbnails({decodeFrames = decode} = {}) {
  const tiles = new Map(), sheets = new Map(), waiting = new Map();
  let active = null;

  async function build({file, fps, frames, prefix, key, identity, controller}) {
    const signal = controller.signal;
    const missing = [...new Set(frames)].filter(f => !tiles.has(prefix + f));
    // Pin hits for this sheet: publishing fresh tiles may evict an older one.
    const selected = new Map(frames.filter(f => tiles.has(prefix + f)).map(f => [f, remember(tiles, prefix + f, tiles.get(prefix + f), 384)]));
    for (let i = 0; i < missing.length; i += 3) {
      const group = missing.slice(i, i+3), raw = await decodeFrames(file, fps, group, signal);
      signal.throwIfAborted();
      for (const [k, frame] of group.entries()) {
        selected.set(frame, raw[k]);
        remember(tiles, prefix + frame, raw[k], 384);
      }
    }
    const bytes = await jpeg(frames.map(f => selected.get(f)), signal);
    signal.throwIfAborted();
    if (version(file) !== identity) throw error(503, 'video-changed');
    return remember(sheets, key, bytes, 96);
  }

  async function next() {
    if (active || !waiting.size) return;
    const job = waiting.values().next().value;
    waiting.delete(job.key);
    active = job;
    try { job.resolve(await build(job)); }
    catch (err) { job.reject(err); }
    finally { active = null; next(); }
  }

  function cancel(job) {
    const reason = error(503, 'thumbnail-interrupted');
    // Running FFmpeg keeps its slot until its process closes; a waiting sheet
    // can release its slot immediately, including when another window retries it.
    if (active === job) job.controller.abort(reason);
    else if (waiting.get(job.key) === job) {
      waiting.delete(job.key);
      job.reject(reason);
    }
  }

  function subscribe(job, client) {
    job.clients++;
    if (!client) return job.result;
    return new Promise((resolve, reject) => {
      const leave = () => {
        reject(client.reason);
        if (--job.clients === 0) cancel(job);
      };
      client.addEventListener('abort', leave, {once:true});
      job.result.then(resolve, reject).finally(() => client.removeEventListener('abort', leave));
    });
  }

  function sheet({file, fps, frames}, client) {
    client?.throwIfAborted();
    let identity;
    try { identity = version(file); } catch { throw error(404, 'no-video'); }
    const prefix = identity + '|' + fps + '|', key = prefix + frames.join(',');
    if (sheets.has(key)) return Promise.resolve(remember(sheets, key, sheets.get(key), 96));
    if (active?.key === key && !active.controller.signal.aborted) return subscribe(active, client);
    if (waiting.has(key)) return subscribe(waiting.get(key), client);
    if (waiting.size + (active ? 1 : 0) >= 12) throw error(429, 'thumbnail-queue-full');
    const job = {file, fps, frames, prefix, key, identity, controller:new AbortController(), clients:0};
    job.result = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    waiting.set(key, job);
    const result = subscribe(job, client);
    next();
    return result;
  }
  function interrupt() {
    const jobs = [...waiting.values()];
    if (active) jobs.push(active);
    for (const job of jobs) cancel(job);
    return Promise.allSettled(jobs.map(job => job.result)).then(() => {});
  }
  return {sheet, interrupt};
}

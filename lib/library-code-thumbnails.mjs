import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fsp from 'node:fs/promises';

const hash = value => createHash('sha256').update(value).digest('hex');
const keyOf = p => JSON.stringify([p.remotionDir, p.EP, p.id ?? p.ep ?? p.SNAP, p.remotion?.composition, p.remotion?.props]);
const inputsOf = p => JSON.stringify([p.remotion, p.SNAP]);

// A cover is not a certified playback range: huge episode datasets need only
// their size/date, not hundreds of MB read into RAM. Small source files also get
// a content hash. Follow asset junctions once, with a strict file-count ceiling.
export async function librarySources(p) {
  const digest=createHash('sha256'),visited=new Set();let count=0,contentBytes=0;
  digest.update(JSON.stringify([p.remotion,p.ep]));
  const ignored=/^(node_modules|revue|\.git|\.cache|renders?|exports?|out|07-renders)$/i;
  async function walk(file) {
    if(!file)return;
    if(++count>50000)throw new Error('Trop de fichiers pour calculer la vignette.');
    let real,stat;
    try{real=await fsp.realpath(file);stat=await fsp.stat(real);}
    catch(e){if(e.code==='ENOENT'){digest.update('absent:'+file);return;}throw e;}
    digest.update(JSON.stringify([file,real]));
    const canonical=process.platform==='win32'?real.toLowerCase():real;
    if(visited.has(canonical))return;visited.add(canonical);
    if(stat.isDirectory()) {
      for(const name of (await fsp.readdir(real)).sort())if(!ignored.test(name))await walk(path.join(file,name));
    } else if(stat.isFile()) {
      digest.update(`${stat.size}:${stat.mtimeMs}`);
      if(/\.(json|tsx?|jsx?|mjs|cjs|css|html?|glsl|vert|frag|wgsl|svg)$/i.test(real)
        && stat.size<=128*1024 && contentBytes+stat.size<=8*1024*1024) {
        contentBytes+=stat.size;digest.update(await fsp.readFile(real));
      }
    }
  }
  for(const file of [p.remotion?.entree,p.remotion?.module,p.remotion?.timeline,p.SNAP,path.join(p.remotionDir,'src'),
    path.join(p.remotionDir,'public'),path.join(p.remotionDir,'package.json'),p.EP])await walk(file);
  return digest.digest('hex');
}

function renderWorker(p, output, signature, {signal, timeout = 90000} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./library-thumbnail-worker.mjs', import.meta.url))],
      {windowsHide:true, stdio:['pipe','ignore','pipe']});
    let error = '', timedOut = false;
    const stop = () => {
      // Stop Chromium too. A bad composition must not occupy the library queue.
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true,stdio:'ignore'});
        killer.on('error', () => child.kill());
      } else child.kill('SIGKILL');
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    timer.unref();
    signal?.addEventListener('abort', stop, {once:true});
    if (signal?.aborted) stop();
    child.stderr.on('data', data => { error = (error + data).slice(-3000); });
    child.stdin.on('error', () => {});
    child.on('error', e => { clearTimeout(timer); signal?.removeEventListener('abort',stop); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort',stop);
      if (signal?.aborted) reject(signal.reason);
      else if (!timedOut && code === 0 && fs.statSync(output,{throwIfNoEntry:false})?.size) resolve(output);
      else reject(new Error(timedOut ? 'Le calcul de la vignette Remotion a dépassé 90 secondes.' : error || 'Vignette Remotion indisponible.'));
    });
    child.stdin.end(JSON.stringify({project:{kind:p.kind,ep:p.ep,EP:p.EP,SNAP:p.SNAP,remotionDir:p.remotionDir,remotion:p.remotion},output,signature}));
  });
}

export function libraryCodeThumbnails({dir, fingerprint = librarySources, render = renderWorker, now = Date.now, refreshMs = 60000} = {}) {
  const states = new Map(), jobs = new Map();
  const controllers = new Set();
  let queue = Promise.resolve(), probes = Promise.resolve(), closed = false;
  function state(p) {
    const key = keyOf(p);
    if (!states.has(key)) states.set(key, {key,signature:null,checked:0,requested:false,retry:0});
    const s = states.get(key), inputs = inputsOf(p);
    if (s.inputs !== inputs) { s.inputs = inputs; s.checked = 0; }
    return s;
  }
  function refresh(p, s) {
    if (s.probe) return s.probe;
    if (s.probeError && s.checked && now() - s.checked < refreshMs) return Promise.reject(s.probeError);
    if (s.checked && s.signature && now() - s.checked < refreshMs) return Promise.resolve(s.signature);
    const inputs = s.inputs;
    const job = probes.then(async () => {
      const signature = await fingerprint(p);
      s.probeError = null;
      if (signature !== s.signature) { s.signature = signature; s.error = null; }
      else if (s.error && now() >= s.retryAt) { s.error = null; s.retry++; }
      s.checked = inputs === s.inputs ? now() : 0;
      return signature;
    }).catch(error => {
      s.probeError = error; s.checked = now();
      if (!s.probeRetryAt) s.probeRetryAt = now() + 30000;
      if (now() >= s.probeRetryAt) { s.retry++; s.probeRetryAt = now() + 30000; }
      throw error;
    });
    probes = job.catch(() => {});
    s.probe = job.finally(() => { s.probe = null; });
    return s.probe;
  }
  return {
    describe(p) {
      const s = state(p);
      // Do not scan code/media for covers nobody has requested.
      if (!closed && s.requested && (!s.checked || now() - s.checked >= refreshMs)) refresh(p,s).catch(() => {});
      return {thumb:true, thumbVersion:'code-' + (s.signature ?? hash(s.key + s.inputs)) + '-' + s.retry};
    },
    async get(p) {
      if (closed) throw new Error('La bibliothèque se ferme.');
      const s = state(p); s.requested = true;
      const signature = await refresh(p,s);
      const out = path.join(dir, 'code-' + hash(s.key + signature) + '.jpg');
      if (fs.statSync(out,{throwIfNoEntry:false})?.size) return out;
      if (s.error && now() < s.retryAt) throw s.error;
      if (!jobs.has(out)) {
        const job = queue.then(async () => {
          if (closed) throw new Error('La bibliothèque se ferme.');
          const controller = new AbortController(); controllers.add(controller);
          fs.mkdirSync(dir,{recursive:true});
          const temp = out + '.' + process.pid + '.tmp.jpg';
          try {
            await render(p,temp,signature,{signal:controller.signal});
            controller.signal.throwIfAborted();
            if (await fingerprint(p) !== signature) { s.checked = 0; throw new Error('Les sources ont changé pendant la capture.'); }
            fs.renameSync(temp,out);
            return out;
          } catch (e) { s.error = e; s.retryAt = now() + 30000; throw e; }
          finally { controllers.delete(controller); fs.rmSync(temp,{force:true}); }
        });
        queue = job.catch(() => {});
        jobs.set(out,job.finally(() => jobs.delete(out)));
      }
      return jobs.get(out);
    },
    async close() {
      closed = true;
      for (const controller of controllers) controller.abort(new Error('La bibliothèque se ferme.'));
      await Promise.allSettled([...jobs.values()]);
    },
  };
}

// Prefer a scene's interior over its opening transition. Two alternate frames
// also allow the worker to skip a black leader or fade. Times are in seconds.
export function coverFrames(timeline, {fps, durationInFrames}) {
  const end = Math.max(0,durationInFrames - 1), target = Math.min(end, Math.round(Math.min(20, durationInFrames / fps * .2) * fps));
  const clips = (timeline?.tracks ?? []).filter(t => t.type !== 'audio').flatMap(t => t.clips ?? [])
    .filter(c => !c.off && Number.isFinite(c.t0) && Number.isFinite(c.t1) && c.t1 > c.t0 && !/intro|opening|générique|credits|outro/i.test(c.label ?? ''))
    .sort((a,b) => a.t0 - b.t0);
  const scene = clips.find(c => c.t0 * fps <= target && c.t1 * fps > target) ?? clips[0];
  const preferred = scene ? Math.round((scene.t0 + Math.min(2,(scene.t1-scene.t0)*.5)) * fps) : target;
  return [...new Set([preferred, Math.round(end*.5), Math.round(end*.8)].map(f => Math.max(0,Math.min(end,f))))];
}

import fs from 'node:fs';
import path from 'node:path';
import { captureWorkspace, createCaptureWorkspace, releaseCaptureWorkspace } from './lot-capture-workspace.mjs';
import { pad3, readJsonStrict, writeJson } from './episode.mjs';
import { codeFrameList, videoFrame, cropAround, ffmpeg, probeVideo } from './frames.mjs';
import { freezeLotSources, captureProject, checkLotSources } from './lot-sources.mjs';
import { t } from './i18n.mjs';

// Le JSON du lot est le marqueur de publication. Les entrées de travail restent
// privées, y compris les calques PNG nécessaires après la fermeture du studio.
export async function prepareCaptures(p, data, marks) {
  const dir = createCaptureWorkspace(p, data);
  try {
    for (const e of data.edits) {
      const png = marks?.[e.id];
      if (e.mark && typeof png === 'string' && png.startsWith('data:image/png;base64,')) {
        fs.writeFileSync(path.join(dir, e.k + '-marks.png'), Buffer.from(png.slice(22), 'base64'));
      }
    }
    const sources = {errors: {}};
    for (const source of new Set(data.edits.map(e => e.source))) {
      try { Object.assign(sources, await freezeLotSources(p, {dir, [source]: true})); }
      catch (err) { sources.errors[source] = err.message; }
    }
    writeJson(path.join(dir, 'sources.json'), sources);
  } catch (error) {
    releaseCaptureWorkspace(p, data.captureState.id);
    throw error;
  }
}

async function drawMark(image, png, mark, size, pixels, dir, k) {
  const [iw, ih] = pixels;
  const marque = path.join(dir, k + '-marque.jpg');
  await ffmpeg(['-i', image, '-i', png, '-filter_complex', `[1:v]scale=${iw}:${ih}[m];[0:v][m]overlay=0:0`, '-frames:v', '1', '-q:v', '2', marque]);
  const pts = mark.strokes?.flat().length ? mark.strokes.flat() : mark.points;
  const crop = cropAround(pts, ...size);
  if (!crop) return {marque};
  const sx = iw / size[0], sy = ih / size[1], ev = v => Math.max(2, Math.floor(v / 2) * 2);
  const x = Math.min(ev(crop.x * sx), iw - 2), y = Math.min(ev(crop.y * sy), ih - 2);
  const w = Math.min(ev(crop.width * sx), Math.floor((iw - x) / 2) * 2);
  const h = Math.min(ev(crop.height * sy), Math.floor((ih - y) / 2) * 2);
  const zoom = path.join(dir, k + '-zoom.jpg');
  try {
    await ffmpeg(['-i', marque, '-vf', `crop=${w}:${h}:${x}:${y}`, '-frames:v', '1', '-q:v', '2', zoom]);
    return {marque, zoom, zoomRect: crop};
  } catch (error) { return {marque, error: error.message}; }
}

// Exécute le travail à partir des seules données persistées. Les chemins JPEG
// deviennent visibles ensemble, une fois les fichiers écrits et contrôlés.
export async function captureLot(p, data, publish, log, isCurrent) {
  const state = data.captureState, work = captureWorkspace(state.id);
  const dir = path.join(p.LOTS, pad3(data.lot), data.resent ? state.id : '');
  const sizes = {};
  const errorOf = e => t('lot.err.capture', {msg: e.message}, data.language);
  function finish(last = false) {
    state.done = data.edits.filter(e => e.captures.error || (e.captures.image && (e.end === null || e.captures.fin))).length;
    if (last || (state.done === state.total && data.edits.every(e => !e.captures.error))) {
      state.error = data.edits.find(e => e.captures.error)?.captures.error;
      state.status = state.error ? 'error' : 'ready';
    }
    publish();
  }
  try {
    const sources = readJsonStrict(path.join(work, 'sources.json'));
    if (!sources) throw new Error('Les sources de capture de cet envoi sont introuvables.');
    fs.mkdirSync(dir, {recursive: true});
    const deliverFile = (from, to) => {
      if (!isCurrent()) throw new Error('Envoi remplacé pendant la capture.');
      const tmp = to + '.' + state.id + '.tmp';
      fs.copyFileSync(from, tmp);
      fs.renameSync(tmp, to);
    };
    for (const source of ['video', 'code']) {
      const edits = data.edits.filter(e => e.source === source);
      if (!edits.length) continue;
      const byFrame = new Map();
      for (const e of edits) {
        for (const [key, frame] of [['image', e.frame], ['fin', e.end]]) {
          if (frame === null || e.captures[key]) continue;
          if (!byFrame.has(frame)) byFrame.set(frame, []);
          byFrame.get(frame).push({e, key});
        }
      }
      const frames = [...byFrame.keys()].sort((a,b) => a - b);
      const accept = async (frame, raw) => {
        for (const {e, key} of byFrame.get(frame)) {
          const target = path.join(dir, e.k + '-' + key + '.jpg');
          deliverFile(raw, target);
          e.captures[key] = target;
          const png = path.join(work, e.k + '-marks.png');
          if (key === 'image' && fs.existsSync(png)) {
            try {
              const drawn = await drawMark(raw, png, e.mark, data.size, sizes[source] ??= probeVideo(raw)?.size ?? data.size, work, e.k);
              for (const field of ['marque', 'zoom']) if (drawn[field]) {
                const dest = path.join(dir, path.basename(drawn[field]));
                deliverFile(drawn[field], dest);
                e.captures[field] = dest;
              }
              if (drawn.zoomRect) e.captures.zoomRect = drawn.zoomRect;
              if (drawn.error) throw new Error(drawn.error);
            } catch (err) { e.captures.error = errorOf(err); }
          }
        }
        byFrame.delete(frame);
        finish();
      };
      const fail = (frame, err) => {
        for (const {e} of byFrame.get(frame) ?? []) {
          e.captures.error = errorOf(err);
          log(t('lot.log.capture', {lot: data.lot, k: e.k, err: e.captures.error}));
        }
        byFrame.delete(frame);
      };
      try {
        if (sources.errors?.[source]) throw new Error(sources.errors[source]);
        await checkLotSources(sources, source);
        if (source === 'video') {
          for (const frame of frames) {
            const raw = path.join(work, 'video.jpg');
            try {
              // ffmpeg peut réussir sans image si la demande dépasse la vidéo.
              fs.rmSync(raw, {force: true});
              await videoFrame(sources.video, frame, data.fps, raw);
              if (!fs.existsSync(raw) || !fs.statSync(raw).size) throw new Error('Aucune image vidéo à cette position.');
              await checkLotSources(sources, 'video');
              await accept(frame, raw);
            }
            catch (err) { fail(frame, err); }
          }
        } else if (frames.length) {
          const project = {...captureProject(p, sources), lotBundleRoot: work};
          let serial = 0;
          const render = async list => {
            const pending = [];
            let consumer = null, failure = null;
            // Le contrôle porte sur des pixels déjà écrits. Pendant son inventaire
            // et l'application des calques, Remotion peut préparer l'image suivante.
            const drain = async () => {
              while (pending.length) {
                const batch = pending.splice(0);
                await checkLotSources(sources, 'code');
                for (const {frame, file} of batch) {
                  await accept(frame, file);
                  fs.rmSync(file);
                }
              }
            };
            const onFrame = async (frame, buffer) => {
              if (failure) throw failure;
              const file = path.join(work, 'frame-' + (++serial) + '.jpg');
              fs.writeFileSync(file, buffer);
              pending.push({frame, file});
              consumer ??= drain().catch(err => { failure = err; }).finally(() => { consumer = null; });
              if (pending.length >= 16) await consumer;
            };
            try { await codeFrameList(project, list, {log, onFrame, cacheKey: state.id}); }
            finally {
              await consumer;
              if (!failure && pending.length) await drain();
            }
            if (failure) throw failure;
          };
          try { await render(frames); }
          catch (error) {
            // Un plan illisible ne prive pas les autres notes de leur image.
            if (!isCurrent()) throw error;
            await checkLotSources(sources, source);
            if (frames.length === 1) throw error;
            for (const frame of [...byFrame.keys()]) {
              try { await render([frame]); } catch (err) { fail(frame, err); }
            }
          }
        }
        if (byFrame.size) throw new Error('Capture demandée absente du résultat.');
      } catch (err) { for (const frame of [...byFrame.keys()]) fail(frame, err); }
    }
    finish(true);
  } catch (err) {
    state.status = 'error'; state.error = errorOf(err);
    publish();
  }
}

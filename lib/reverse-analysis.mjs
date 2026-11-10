import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const inputOptions = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi,mpegts,mpeg,flv,asf,nut,ogg'];
const ff = ['-hide_banner','-nostdin','-nostats'];
const sampleWidth = 64, sampleHeight = 36, sampleBytes = sampleWidth * sampleHeight * 3;
const invalid = message => Object.assign(new Error(message), {status: 400});

function processMedia(command, args, {signal, onBytes, onLine, limit = 2_000_000} = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {windowsHide: true, stdio: ['ignore','pipe','pipe']});
    let failure, tail = '', pending = '', bytes = 0;
    const chunks = [];
    const abort = () => { failure = signal.reason; child.kill(); };
    signal?.addEventListener('abort', abort, {once:true});
    child.stdout.on('data', chunk => {
      if (failure) return;
      try {
        if (onBytes) onBytes(chunk);
        else {
          bytes += chunk.length;
          if (bytes > limit) throw new Error('La réponse du décodeur dépasse la taille prévue.');
          chunks.push(chunk);
        }
      } catch (e) { failure = e; child.kill(); }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', text => {
      tail = (tail + text).slice(-3200);
      if (onLine) {
        const lines = (pending + text).split(/[\r\n]/);
        pending = lines.pop().slice(-3200);
        for (const line of lines) onLine(line);
      }
    });
    child.on('error', error => { failure = error; });
    child.on('close', code => {
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(invalid(tail.trim() || command + ' a échoué.'));
      else resolve(Buffer.concat(chunks));
    });
  });
}

const probe = async (file, signal) => JSON.parse(await processMedia('ffprobe',
  ['-v','error',...inputOptions,'-show_streams','-show_format','-of','json',file], {signal}));

function fraction(value) {
  const m = /^(\d+)[/:](\d+)$/.exec(String(value));
  if (!m || !Number(m[1]) || !Number(m[2])) return null;
  let a = Number(m[1]), b = Number(m[2]);
  while (b) [a,b] = [b,a % b];
  return {num:Number(m[1])/a, den:Number(m[2])/a, value:Number(m[1])/Number(m[2])};
}

function videoGeometry(track) {
  const sar = fraction(track.sample_aspect_ratio)?.value || 1;
  const side = track.side_data_list?.find(s => s.rotation != null);
  const rotation = ((Number(side?.rotation ?? track.tags?.rotate ?? 0) % 360) + 360) % 360;
  if (![0,90,180,270].includes(rotation)) throw invalid('L’angle de rotation de cette vidéo doit être un multiple de 90 degrés.');
  const w = Math.round(track.width * sar), h = track.height;
  if (!(w > 0 && h > 0)) throw invalid('Dimensions de la vidéo illisibles.');
  return {width:rotation % 180 ? h : w, height:rotation % 180 ? w : h, rotation, sampleAspectRatio:track.sample_aspect_ratio || '1:1'};
}

function videoRate(track) {
  const nominal = fraction(track.r_frame_rate), mean = fraction(track.avg_frame_rate);
  // Some VFR demuxers advertise their timestamp tick (e.g. 90 kHz) as fps.
  if (nominal && nominal.value <= 240 && (!mean || nominal.value <= mean.value * 3)) return nominal;
  if (mean && mean.value > 0 && mean.value <= 240) return mean;
  throw invalid('La cadence de ce média est inconnue ou dépasse 240 images par seconde.');
}

const trackOf = (streams, type) => {
  const eligible = streams.filter(s => s.codec_type === type && !s.disposition?.attached_pic);
  return eligible.find(s => s.disposition?.default) || eligible[0];
};

async function identity(file) {
  const s = await fs.promises.stat(file, {bigint:true});
  if (!s.isFile()) throw invalid('Choisis un fichier vidéo.');
  return [s.dev,s.ino,s.size,s.ctimeNs,s.mtimeNs].join(':');
}

function reporter(onProgress) {
  let last = -1;
  return n => {
    const pct = Math.max(0, Math.min(100,Math.floor(n)));
    if (pct > last) { last = pct; onProgress?.(pct); }
  };
}

async function hashFile(file, signal, onBytes) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file,{signal})) { hash.update(chunk); onBytes?.(chunk.length); }
  return hash.digest('hex');
}

function chooseBoundaries(motion, fps) {
  const hard = new Set();
  const ramps = [];
  let ramp = null;
  function finish() {
    if (!ramp) return;
    if (ramp.end-ramp.start >= 3 && ramp.end-ramp.start <= Math.max(6,3*fps)
      && ramp.total >= 36 && (ramp.hist >= .40 || Math.abs(motion[ramp.end].light-motion[ramp.start].light) >= 30)) {
      ramps.push(ramp);
    }
    ramp = null;
  }
  for (let f=1; f<motion.length; f++) {
    const m=motion[f], prev=motion[f-1];
    if ((m.rgb >= 16 && m.hist >= .50) || (m.rgb >= 32 && m.hist >= .24) || m.rgb >= 66) hard.add(f);
    // Successive differences pointing the same way across the image are the
    // signature of a dissolve. A flash changes direction abruptly at its apex.
    const continuous = f>=2 && m.rgb>=1 && prev.rgb>=1 && m.direction>=.76
      && Math.max(m.rgb,prev.rgb) < 7*Math.min(m.rgb,prev.rgb);
    if (!continuous) { finish(); continue; }
    if (!ramp) ramp = {start:f-2,end:f-1,total:prev.rgb,hist:prev.hist,peak:f-1};
    ramp.end=f; ramp.total+=m.rgb; ramp.hist+=m.hist;
    if (m.rgb>motion[ramp.peak].rgb) ramp.peak=f;
  }
  finish();
  for (let i=0; i<ramps.length; i++) {
    const first=ramps[i], next=ramps[i+1];
    let at=first.peak, end=first.end;
    if (next && next.start-first.end <= Math.max(2,Math.round(.4*fps))) {
      // A dip to white or black separates the shots at the neutral frame,
      // even when each half changes too slowly to trigger a hard cut.
      const up=motion[first.end].light-motion[first.start].light;
      const down=motion[next.end].light-motion[next.start].light;
      const plateau = Math.floor((first.end+next.start)/2);
      if (up*down<0 && Math.min(Math.abs(up),Math.abs(down))>=25
        && (motion[plateau].light>=225 || motion[plateau].light<=25) && motion[plateau].spread<=12) {
        at=plateau;
        for (let f=first.end; f<=next.start; f++) {
          if (motion[f].spread < motion[at].spread) at=f;
        }
        end=next.end; i++;
      }
    }
    for (let f=first.start+1; f<=end; f++) hard.delete(f);
    hard.add(at);
  }
  return [...hard].sort((a,b)=>a-b);
}

function sceneSamples() {
  let previous, lastHistogram;
  const motion = [], previousDifference = new Int16Array(sampleBytes);
  const input = Buffer.alloc(sampleBytes);
  let offset = 0;
  function consume() {
    const histogram = new Uint16Array(48);
    let difference = 0, squared = 0, dot = 0, brightness = 0, squares = 0;
    for (let i=0; i<sampleBytes; i+=3) {
      const luma=.2126*input[i]+.7152*input[i+1]+.0722*input[i+2];
      brightness+=luma; squares+=luma*luma;
      for (let channel=0; channel<3; channel++) {
        const v = input[i+channel];
        histogram[channel*16+(v >> 4)]++;
        if (previous) {
          const d=v-previous[i+channel];
          difference+=Math.abs(d); squared+=d*d; dot+=d*previousDifference[i+channel];
          previousDifference[i+channel]=d;
        }
      }
    }
    let change = 0;
    if (lastHistogram) for (let i=0;i<histogram.length;i++) change += Math.abs(histogram[i]-lastHistogram[i]);
    const light=brightness/(sampleWidth*sampleHeight), norm=Math.sqrt(squared*(motion.at(-1)?.squared || 0));
    motion.push({rgb:difference/sampleBytes, hist:change/(2*sampleBytes), light,
      spread:Math.sqrt(Math.max(0,squares/(sampleWidth*sampleHeight)-light*light)), squared, direction:norm ? dot/norm : 0});
    previous ??= Buffer.alloc(sampleBytes);
    input.copy(previous); lastHistogram = histogram;
  }
  return {
    get count() { return motion.length; },
    cuts: fps => chooseBoundaries(motion,fps),
    write(chunk) {
      for (let i=0; i<chunk.length;) {
        const n = Math.min(chunk.length-i, sampleBytes-offset);
        chunk.copy(input,offset,i,i+n); i += n; offset += n;
        if (offset === sampleBytes) { consume(); offset = 0; }
      }
    },
  };
}

export async function analyzeVideo(file, {signal,onProgress} = {}) {
  signal?.throwIfAborted();
  file = path.resolve(file);
  const start = await identity(file), report = reporter(onProgress);
  report(0);
  const {streams,format} = await probe(file, signal);
  const video = trackOf(streams,'video'), audio = trackOf(streams,'audio');
  if (!video) throw invalid('Ce fichier ne contient aucune piste vidéo.');
  const geometry = videoGeometry(video), rate = videoRate(video);
  const estimatedDuration = Number(video.duration) || Number(format.duration) || 0;
  let read = 0;
  const sha256 = await hashFile(file,signal,n => { read += n; report(12*read/(Number(format.size) || read)); });
  const ticks = [], samples = sceneSamples();
  let timeBase = fraction(video.time_base);
  const grid = 'fps=' + rate.num + '/' + rate.den + ':round=near';
  await processMedia('ffmpeg',[...ff,'-loglevel','info','-copyts',...inputOptions,'-threads','3','-i',file,
    '-map','0:'+video.index,'-an','-sn','-dn','-filter_threads','1',
    '-vf','scale='+sampleWidth+':'+sampleHeight+':flags=area,format=rgb24,showinfo=checksum=0,setpts=PTS-STARTPTS,'+grid,
    '-fps_mode','passthrough','-threads','1','-c:v','rawvideo','-pix_fmt','rgb24','-f','rawvideo','pipe:1'], {
    signal,
    onLine(line) {
      if (!line.includes('showinfo')) return;
      const time = /\bn:\s*\d+\s+pts:\s*(-?\d+)\s/.exec(line);
      if (time) ticks.push(Number(time[1]));
      else {
        const tb = /config in time_base:\s*(\d+\/\d+)/.exec(line);
        if (tb) timeBase = fraction(tb[1]);
      }
    },
    onBytes(chunk) {
      samples.write(chunk);
      if (estimatedDuration) report(Math.min(99,12+87*samples.count/(estimatedDuration*rate.value)));
    },
  });
  if (!ticks.length || !samples.count || !timeBase) throw invalid('Aucune image horodatée n’a pu être décodée.');
  if (start !== await identity(file)) throw invalid('La vidéo a changé pendant son analyse. Relance le mode Reverse.');
  const videoStartSeconds = ticks[0]*timeBase.value;
  // A constant cadence can alternate by one container tick, e.g. 29.97 fps stored as milliseconds.
  const variable = ticks.some((t,i) => Math.abs((t-ticks[0])*timeBase.value-i/rate.value) > timeBase.value*.55 + .000001);
  const needsNormalization = variable || ticks.length !== samples.count || video.codec_name !== 'h264'
    || !['yuv420p','yuvj420p'].includes(video.pix_fmt) || !['avc1','avc3'].includes(video.codec_tag_string)
    || !format.format_name.split(',').includes('mov') || /^qt/i.test(format.tags?.major_brand || '')
    || streams.filter(s => ['video','audio'].includes(s.codec_type)).length !== 1+Number(!!audio)
    || geometry.rotation !== 0 || geometry.width !== video.width || Math.abs(videoStartSeconds) > .000001
    || (audio && (audio.codec_name !== 'aac' || Math.abs(Number(audio.start_time) || 0) > .001));
  report(100);
  return {
    sourcePath:file, sha256, ...geometry, fpsNumerator:rate.num, fpsDenominator:rate.den,
    frames:samples.count, durationSeconds:samples.count/rate.value, hasAudio:!!audio, cuts:samples.cuts(rate.value),
    videoIndex:video.index, audioIndex:audio?.index ?? null, videoStartSeconds,
    audioStartSeconds:audio ? Number(audio.start_time) || 0 : null,
    videoCodec:video.codec_name, audioCodec:audio?.codec_name ?? null,
    needsNormalization:!!needsNormalization,
    timing:{variable, sourceFrames:ticks.length, timeBase:timeBase.num+'/'+timeBase.den, firstPts:ticks[0], ...(variable ? {sourcePts:ticks} : {})},
  };
}

const rateOf = a => a.fpsNumerator + '/' + a.fpsDenominator;
const gridFilter = (a, origin) => 'setpts=PTS-('+origin+')/TB,fps='+rateOf(a)+':round=near';

export async function previewFrame(file, analysis, frame, {signal,maxWidth=360,prepared=false} = {}) {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= analysis.frames) throw invalid('Image hors de la vidéo.');
  if (!Number.isFinite(maxWidth) || maxWidth < 1 || maxWidth > 4096) throw invalid('Largeur de vignette incorrecte.');
  const origin = prepared ? 0 : analysis.videoStartSeconds;
  const target = frame * analysis.fpsDenominator / analysis.fpsNumerator + origin;
  const width = Math.min(analysis.width,Math.floor(maxWidth));
  const height = Math.max(1,Math.round(width*analysis.height/analysis.width));
  const graph = gridFilter(analysis,origin)+',trim=start_pts='+frame+',scale='+width+':'+height+':flags=area,setsar=1';
  async function read(seek) {
    return processMedia('ffmpeg',[...ff,'-v','error','-copyts',...inputOptions,
      ...(seek ? ['-noaccurate_seek','-seek_timestamp','1','-ss',String(seek)] : []),
      '-threads','3','-i',path.resolve(file),'-map',prepared ? '0:v:0' : '0:'+analysis.videoIndex,
      '-an','-sn','-dn','-filter_threads','1','-vf',graph,'-frames:v','1','-fps_mode','passthrough',
      '-threads','1','-c:v','mjpeg','-q:v','3','-f','image2pipe','pipe:1'],{signal,limit:32*1024*1024});
  }
  const seek = Math.max(0,target-1);
  let bytes = await read(seek);
  if (!bytes.length && seek) bytes = await read(0);
  if (!bytes.length) throw invalid('Le décodeur n’a pas produit la vignette demandée.');
  return bytes;
}

// The owner creates the project's staging folder. Publish atomically and refuse
// to replace another file even if two generators receive the same destination.
export async function prepareReverseMedia(file, analysis, destinationMp4, {signal,onProgress} = {}) {
  signal?.throwIfAborted();
  const source = path.resolve(file), dest = path.resolve(destinationMp4), initial = await identity(source);
  const changed = () => invalid('La vidéo source a changé depuis l’analyse. Relance le mode Reverse.');
  const temp = path.join(path.dirname(dest), '.reverse-'+randomUUID()+'.mp4');
  const report = reporter(onProgress);
  try {
    report(0);
    if (!analysis.needsNormalization) {
      const hash = createHash('sha256'), size = (await fs.promises.stat(source)).size;
      let bytes = 0;
      const count = new Transform({transform(chunk, encoding, done) {
        hash.update(chunk); bytes += chunk.length; report(98*bytes/size); done(null,chunk);
      }});
      await pipeline(fs.createReadStream(source),count,fs.createWriteStream(temp,{flags:'wx'}),{signal});
      if (hash.digest('hex') !== analysis.sha256) throw changed();
    } else {
      if (await hashFile(source,signal) !== analysis.sha256) throw changed();
      const even = n => Math.max(2,Math.round(n/2)*2);
      const graph = gridFilter(analysis,analysis.videoStartSeconds)+',scale='+even(analysis.width)+':'+even(analysis.height)+':flags=lanczos,setsar=1';
      // -copyts + first_pts=0 keeps a delayed audio stream delayed and trims any
      // audio pre-roll relative to the first displayed video frame.
      const duration = analysis.durationSeconds.toFixed(9);
      await processMedia('ffmpeg',[...ff,'-v','error','-copyts',...inputOptions,'-threads','3','-i',source,
        '-map','0:'+analysis.videoIndex,'-filter_threads','2','-vf',graph,
        '-fps_mode','passthrough','-c:v','libx264','-preset','veryfast','-crf','16','-pix_fmt','yuv420p','-threads','3',
        ...(analysis.hasAudio ? ['-map','0:'+analysis.audioIndex,'-af',
          'asetpts=PTS-('+analysis.videoStartSeconds+')/TB,aresample=48000:async=1:first_pts=0,apad,atrim=duration='+duration,
          '-c:a','aac','-b:a','256k'] : ['-an']),
        '-sn','-dn','-map_metadata','-1','-movflags','+faststart','-progress','pipe:2','-n',temp], {
        signal, onLine(line) { const m = /^frame=(\d+)/.exec(line); if (m) report(Math.min(98,100*Number(m[1])/analysis.frames)); },
      });
      const encoded = await probe(temp,signal);
      const v = trackOf(encoded.streams,'video');
      if (Number(v?.nb_frames) !== analysis.frames || !!trackOf(encoded.streams,'audio') !== analysis.hasAudio) {
        throw new Error('La durée ou les pistes du média préparé diffèrent de l’analyse.');
      }
    }
    signal?.throwIfAborted();
    if (await identity(source) !== initial) throw changed();
    await fs.promises.link(temp,dest);
    report(100);
    return dest;
  } finally { await fs.promises.rm(temp,{force:true}); }
}

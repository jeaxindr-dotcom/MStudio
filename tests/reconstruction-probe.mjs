/* Local measurement experiment using synthetic footage only. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const parent = path.join(root, '.cache', 'reconstruction-probe');
fs.mkdirSync(parent, {recursive: true});
const dir = fs.mkdtempSync(path.join(parent, 'essai-'));
const width = 320;
const height = 180;
const stride = width * height;
const overlay = {x: 12, y: 132, w: 90, h: 24};

function run(program, args) {
  return execFileSync(program, args, {windowsHide: true, maxBuffer: 16 * 1024 * 1024});
}

function generate(name, firstCut) {
  const file = path.join(dir, name + '.nut');
  const graph = [
    `nullsrc=s=${width}x${height}:r=30000/1001`,
    `geq=lum='if(gte(N,60),83,if(gte(N,${firstCut}),178,27))':cb=128:cr=128`,
    `drawbox=x=${overlay.x}:y=${overlay.y}:w=${overlay.w}:h=${overlay.h}:color=white:t=fill:enable='between(n,42,52)'`,
    'trim=end_frame=90',
  ].join(',');
  run('ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', graph, '-f', 'lavfi', '-i',
    'sine=frequency=440:sample_rate=48000:duration=3.003', '-c:v', 'ffv1', '-c:a', 'pcm_s16le', '-f', 'nut', file,
  ]);
  return file;
}

function gray(file) {
  return run('ffmpeg', [
    '-v', 'error', '-i', file, '-map', '0:v:0', '-pix_fmt', 'gray', '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1',
  ]);
}

function audio(file) {
  const pcm = run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 's16le', 'pipe:1']);
  return {samples: pcm.length / 2, hash: createHash('sha256').update(pcm).digest('hex')};
}

function meanDifference(a, frameA, b, frameB, region = {x: 0, y: 0, w: width, h: height}) {
  let total = 0;
  for (let row = region.y; row < region.y + region.h; row++) {
    const offset = row * width + region.x;
    for (let col = 0; col < region.w; col++) {
      total += Math.abs(a[frameA * stride + offset + col] - b[frameB * stride + offset + col]);
    }
  }
  return total / (region.w * region.h);
}

const reference = generate('reference', 30);
const candidate = generate('coupe-decalee', 31);
const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', reference]));
const a = gray(reference);
const b = gray(candidate);
const frames = a.length / stride;
assert.equal(b.length, a.length);
const cuts = [];
const overlayChanges = [];
const differences = [];
for (let frame = 0; frame < frames; frame++) {
  const error = meanDifference(a, frame, b, frame);
  if (error > 0) differences.push({frame, meanLumaDifference: error});
  if (frame === 0) continue;
  if (meanDifference(a, frame - 1, a, frame) > 25) cuts.push(frame);
  else if (meanDifference(a, frame - 1, a, frame, overlay) > 25) overlayChanges.push(frame);
}

const video = probe.streams.find(stream => stream.codec_type === 'video');
const sound = probe.streams.find(stream => stream.codec_type === 'audio');
const referenceAudio = audio(reference);
const candidateAudio = audio(candidate);
const measures = {
  width: video.width,
  height: video.height,
  rate: video.r_frame_rate,
  decodedFrames: frames,
  firstVideoPtsSeconds: Number(video.start_time),
  firstAudioPtsSeconds: Number(sound.start_time),
  pcmSampleRate: Number(sound.sample_rate),
  pcmSamples: referenceAudio.samples,
  audioIdentical: referenceAudio.hash === candidateAudio.hash,
  cuts,
  overlayChanges,
  differences,
};

assert.equal(frames, 90);
assert.equal(video.r_frame_rate, '30000/1001');
assert.equal(Number(video.nb_read_frames), frames);
assert.deepEqual(cuts, [30, 60]);
assert.deepEqual(overlayChanges, [42, 53]);
assert.deepEqual(differences.map(diff => diff.frame), [30]);
assert.equal(measures.firstVideoPtsSeconds, 0);
assert.equal(measures.firstAudioPtsSeconds, 0);
assert.equal(measures.pcmSamples, 144144);
assert.equal(measures.pcmSampleRate, 48000);
assert.ok(measures.audioIdentical);
fs.writeFileSync(path.join(dir, 'mesures.json'), JSON.stringify(measures, null, 2));
console.log(JSON.stringify(measures, null, 2));
console.log(dir);

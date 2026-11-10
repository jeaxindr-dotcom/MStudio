// Opt-in comparison of a reference and a Remotion export.
// node tests/reverse-compare.mjs reference.mp4 render.mp4 [--out report.json]
// node tests/reverse-compare.mjs --self-test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
import {analyzeVideo} from '../lib/reverse-analysis.mjs';

const sampleRate = 8000;
const localInput = ['-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm,avi,mpegts,mpeg,flv,asf,nut,ogg','-threads','3','-i'];
async function ffmpeg(args, onLine) {
  const child = spawn('ffmpeg',['-nostdin','-hide_banner','-nostats','-v','error',...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let errors = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data',chunk => { errors = (errors+chunk).slice(-2500); });
  if (onLine) createInterface({input:child.stdout,crlfDelay:Infinity}).on('line',onLine);
  else child.stdout.resume();
  const [code] = await once(child,'close');
  if (code !== 0) throw new Error(errors || 'FFmpeg a échoué.');
}

const rateOf = a => a.fpsNumerator+'/'+a.fpsDenominator;
const nominal = a => a.fpsNumerator/a.fpsDenominator;
const describe = a => ({file:a.sourcePath,width:a.width,height:a.height,rate:rateOf(a),
  frames:a.frames,seconds:a.durationSeconds,hasAudio:a.hasAudio,sourceVariableRate:a.timing.variable,sha256:a.sha256});

async function comparePictures(ref, rendered) {
  // Align each first displayed picture and apply the same orientation, square pixels,
  // cadence and color pixel format before matching. Each SSIM line covers one image.
  const prepare = (input, a) => '['+input+':'+a.videoIndex+']setpts=PTS-STARTPTS,fps='+rateOf(ref)+':round=near,scale='
    +ref.width+':'+ref.height+':flags=lanczos,setsar=1,format=yuv420p['+input+'v]';
  const filter = [prepare(0,ref),prepare(1,rendered),'[0v][1v]ssim=stats_file=-:shortest=1'].join(';');
  let framesCompared=0, sum=0, minimum=Infinity, worstFrame=null, below098=0;
  await ffmpeg([...localInput,ref.sourcePath,...localInput,rendered.sourcePath,'-an','-sn','-dn','-filter_complex_threads','2',
    '-filter_complex',filter,'-f','null','-'],line => {
    const m = /^n:(\d+).*\bAll:(-?[\d.]+)/.exec(line);
    if (!m) return;
    const value = Number(m[2]);
    if (value < minimum) { minimum=value; worstFrame=Number(m[1])-1; }
    if (value < .98) below098++;
    framesCompared++; sum+=value;
  });
  if (!framesCompared) throw new Error('Aucune image comparée.');
  return {framesCompared,meanSsim:sum/framesCompared,minSsim:minimum,worstFrame,framesBelow098:below098};
}

async function unpackAudio(a, dest) {
  const filter = 'asetpts=PTS-('+a.videoStartSeconds+')/TB,aresample='+sampleRate+':async=1:first_pts=0,atrim=duration='+a.durationSeconds.toFixed(9);
  await ffmpeg(['-copyts',...localInput,a.sourcePath,'-map','0:'+a.audioIndex,'-vn','-af',filter,'-ac','1',
    '-ar',String(sampleRate),'-f','s16le','-n',dest]);
}
function readSamples(fd, first, count) {
  const data = Buffer.alloc(count*2);
  const size = fs.readSync(fd,data,0,data.length,first*2);
  return new Int16Array(data.buffer,data.byteOffset,Math.floor(size/2));
}

function correlate(refPath, outputPath, rate) {
  const a=fs.openSync(refPath,'r');
  let b;
  try {
    b=fs.openSync(outputPath,'r');
    const referenceSamples=Math.floor(fs.fstatSync(a).size/2), renderedSamples=Math.floor(fs.fstatSync(b).size/2);
    const common=Math.min(referenceSamples,renderedSamples);
    const maxLag=Math.min(Math.ceil(3*sampleRate/rate),Math.floor(common/6));
    const length=Math.min(2048,common-2*maxLag);
    const base={sampleRate,referenceSamples,renderedSamples,searchMs:1000*maxLag/sampleRate,
      durationDeltaMs:(renderedSamples-referenceSamples)*1000/sampleRate};
    if (length < 64) return {...base,status:'too-short',lagMs:null};
    // Select a loud window from each fifth of the film. The waveform is held on
    // disk, so a feature-length comparison uses the same working memory as a short.
    const selected=new Map();
    for (let start=maxLag; start+length+maxLag<=common; start+=length) {
      const samples=readSamples(a,start,length);
      let sum=0, square=0;
      for (const s of samples) { sum+=s; square+=s*s; }
      const energy=square-sum*sum/length;
      const part=Math.floor(5*start/common);
      if (Math.sqrt(energy/length)>24 && energy>(selected.get(part)?.energy ?? 0)) {
        selected.set(part,{start,samples,energy,mean:sum/length});
      }
    }
    if (!selected.size) return {...base,status:'silent-or-constant',lagMs:null};
    const scores = new Float64Array(2*maxLag+1);
    for (const window of selected.values()) {
      const rendered=readSamples(b,window.start-maxLag,length+2*maxLag);
      let sum=0, square=0;
      for (let i=0;i<length;i++) { sum+=rendered[i]; square+=rendered[i]*rendered[i]; }
      for (let k=0;k<scores.length;k++) {
        let product=0;
        for (let i=0;i<length;i++) product+=(window.samples[i]-window.mean)*rendered[k+i];
        const denom=Math.sqrt(Math.max(0,square-sum*sum/length)*window.energy);
        scores[k]+=denom ? product/denom : 0;
        if (k+length < rendered.length) {
          const leave=rendered[k], enter=rendered[k+length];
          sum+=enter-leave; square+=enter*enter-leave*leave;
        }
      }
    }
    let peak=maxLag;
    for (let k=0;k<scores.length;k++) {
      scores[k]/=selected.size;
    }
    for (let k=0;k<scores.length;k++) {
      if (scores[k]>scores[peak]+.000001 || (Math.abs(scores[k]-scores[peak])<.000001 && Math.abs(k-maxLag)<Math.abs(peak-maxLag))) peak=k;
    }
    let other=-1;
    for (let k=0;k<scores.length;k++) if (Math.abs(k-peak) >= .010*sampleRate) other=Math.max(other,scores[k]);
    const reliable = scores[peak]>=.55 && scores[peak]-other>=.015;
    return {...base,status:reliable ? 'measured' : 'uncertain',windows:selected.size,correlationAtZero:scores[maxLag],
      peakCorrelation:scores[peak],alternativePeak:other,lagMs:(peak-maxLag)*1000/sampleRate,
      lagFrames:(peak-maxLag)*rate/sampleRate,positiveLagMeans:'rendered audio plays later'};
  } finally { fs.closeSync(a); if (b!==undefined) fs.closeSync(b); }
}

export async function compareReverse(source, candidate) {
  const [ref,rendered]=await Promise.all([analyzeVideo(source),analyzeVideo(candidate)]);
  const result={reference:describe(ref),render:describe(rendered),
    sameDimensions:ref.width===rendered.width && ref.height===rendered.height,
    sameRate:Math.abs(nominal(ref)-nominal(rendered))<.000001, sameFrameCount:ref.frames===rendered.frames,
    sameDuration:Math.abs(ref.durationSeconds-rendered.durationSeconds)<.000001,
    sameAudioPresence:ref.hasAudio===rendered.hasAudio};
  result.video=await comparePictures(ref,rendered);
  if (ref.hasAudio && rendered.hasAudio) {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coulisses-reverse-comparison-'));
    try {
      const a=path.join(dir,'reference.pcm'),b=path.join(dir,'render.pcm');
      // Await both subprocesses before removing the directory after a failure.
      const done=await Promise.allSettled([unpackAudio(ref,a),unpackAudio(rendered,b)]);
      for (const job of done) if (job.status==='rejected') throw job.reason;
      result.audio=correlate(a,b,nominal(ref));
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
  } else result.audio={status:ref.hasAudio===rendered.hasAudio ? 'no-audio' : 'different-tracks'};
  result.complete = result.sameDimensions && result.sameRate && result.sameFrameCount && result.sameDuration && result.sameAudioPresence && result.video.framesCompared===ref.frames;
  return result;
}

async function selfTest() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coulisses-reverse-comparison-selftest-'));
  try {
    const a=path.join(dir,'reference.mkv'),b=path.join(dir,'shifted.mkv');
    await ffmpeg(['-f','lavfi','-i','testsrc2=s=128x96:r=25:d=2','-f','lavfi','-i',
      'anoisesrc=color=pink:seed=1976:sample_rate=48000:duration=2','-c:v','ffv1','-c:a','pcm_s16le',a]);
    await ffmpeg([...localInput,a,'-vf',"drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='eq(n,18)'",
      '-af','adelay=80:all=1,atrim=duration=2','-c:v','ffv1','-c:a','pcm_s16le',b]);
    const r=await compareReverse(a,b);
    assert.equal(r.complete,true);
    assert.equal(r.video.framesCompared,50); assert.equal(r.video.worstFrame,18); assert.equal(r.video.framesBelow098,1);
    assert.equal(r.audio.status,'measured');
    assert.ok(Math.abs(r.audio.lagMs-80)<=1,JSON.stringify(r.audio));
    return {frames:r.video.framesCompared,deliberatelyChangedFrame:r.video.worstFrame,measuredDelayMs:r.audio.lagMs,correlation:r.audio.peakCorrelation};
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}

if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [ref,candidate,outFlag,output]=process.argv.slice(2);
    if (ref==='--self-test') console.log(JSON.stringify(await selfTest(),null,2));
    else {
      if (!ref || !candidate || (outFlag && (outFlag!=='--out' || !output))) throw new Error('node tests/reverse-compare.mjs reference.mp4 rendu.mp4 [--out rapport.json]');
      const result=await compareReverse(ref,candidate);
      const json=JSON.stringify(result,null,2)+'\n';
      if (output) await fs.promises.writeFile(output,json);
      process.stdout.write(json);
      if (!result.complete) process.exitCode=2;
    }
  } catch (e) { console.error(e.message); process.exitCode=1; }
}

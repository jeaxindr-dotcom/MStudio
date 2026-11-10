import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

export function run(command,args,{cwd,signal,onLine,maxBytes=0}={}) {
  signal?.throwIfAborted();
  return new Promise((resolve,reject) => {
    const child=spawn(command,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stderr='',stdoutTail='',size=0,error;
    const chunks=[];
    function stop() {
      if (process.platform==='win32' && child.pid) {
        const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
        killer.on('error',()=>child.kill());
      } else child.kill();
    }
    const abort=()=>{error=signal.reason;stop();};
    signal?.addEventListener('abort',abort,{once:true});
    child.on('error',e=>{error=e;});
    child.stderr.setEncoding('utf8').on('data',chunk=>{stderr=(stderr+chunk).slice(-3500);});
    if(onLine) createInterface({input:child.stdout,crlfDelay:Infinity}).on('line',line=>{
      stdoutTail=(stdoutTail+'\n'+line).slice(-2000);
      onLine(line);
    });
    else child.stdout.on('data',chunk=>{
      if (!maxBytes || error) return;
      size+=chunk.length;
      if(size<=maxBytes) chunks.push(chunk);
      else {error=Error('Décodage supérieur à la taille attendue.');stop();}
    });
    child.on('close',code=>{
      signal?.removeEventListener('abort',abort);
      if(error) reject(error);
      else if(code!==0) reject(Error((stderr || stdoutTail).trim() || command+' a échoué ('+code+').'));
      else resolve(Buffer.concat(chunks));
    });
  });
}

const even = n=>Math.max(2,2*Math.round(n/2));
const ff=(args,opts)=>run('ffmpeg',['-nostdin','-hide_banner','-loglevel','error',...args],opts);
const rateOf = a=>a.fpsNumerator+'/'+a.fpsDenominator;
const input = ['-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm,avi,mpegts,mpeg,flv,asf,nut,ogg','-threads','3','-i'];
const name=i=>'sample-'+String(i+1).padStart(4,'0')+'.jpg';
function spaced(values,n) {
  if(values.length<=n)return values;
  return Array.from({length:n},(_,i)=>values[Math.round(i*(values.length-1)/(n-1))]);
}
export function sampleFrames(a) {
  const times=new Set([0,a.frames-1]);
  // Reserve room both for cuts and for movement within a long static-camera shot.
  const bounds=[0,...a.cuts,a.frames], cuts=[];
  for(let i=1;i<bounds.length;i++) {
    cuts.push(bounds[i-1],Math.floor((bounds[i-1]+bounds[i]-1)/2),bounds[i]-1);
  }
  for(const f of spaced([...new Set(cuts)],42))times.add(f);
  const grid=Math.min(72,Math.max(2,Math.ceil(a.durationSeconds*4)));
  for(let i=0;i<grid;i++)times.add(Math.round(i*(a.frames-1)/(grid-1)));
  return spaced([...times].sort((l,r)=>l-r),72);
}
export async function extractSamples(file,a,frames,dir,signal) {
  fs.mkdirSync(dir,{recursive:true});
  const fit=Math.min(1,1280/a.width,1280/a.height);
  const filter='setpts=PTS-STARTPTS,fps='+rateOf(a)+":round=near,select='"+frames.map(f=>'eq(n,'+f+')').join('+')
    +"',scale="+even(a.width*fit)+':'+even(a.height*fit)+':flags=area,setsar=1';
  await ff([...input,file,'-map','0:'+a.videoIndex,'-an','-sn','-dn','-filter_threads','2','-vf',filter,
    '-fps_mode','passthrough','-threads','2','-q:v','2','-frames:v',String(frames.length),'-n',path.join(dir,'sample-%04d.jpg')],{signal});
  for(let i=0;i<frames.length;i++)if(!fs.existsSync(path.join(dir,name(i))))throw Error('Image de référence manquante : '+frames[i]);
}
export async function extractSound(file,a,dest,signal) {
  await ff(['-copyts',...input,file,'-map','0:'+a.audioIndex,'-vn','-sn','-dn','-map_metadata','-1',
    '-af','asetpts=PTS-('+a.videoStartSeconds+')/TB,aresample=48000:async=1:first_pts=0,apad,atrim=duration='+a.durationSeconds.toFixed(9),
    '-c:a','pcm_s16le','-rf64','auto','-n',dest],{signal});
}
function label(text,enable) {
  return "drawtext=font='Arial':text='"+text+"':fontcolor=white:fontsize=19:x=10:y=h-24"+(enable?":enable='eq(n,"+enable+")'":'');
}
export async function makeSheet(dir,entries,dest,signal) {
  const start=entries[0].index+1, count=entries.length;
  const filters=['scale=480:286:force_original_aspect_ratio=decrease','pad=480:316:(ow-iw)/2:(286-ih)/2:color=black'];
  for(let i=0;i<count;i++)filters.push(label('F'+entries[i].frame+'   '+entries[i].seconds.toFixed(3)+' s',String(i)));
  filters.push('tile='+Math.min(count,3)+'x'+Math.ceil(count/3)+':nb_frames='+count+':padding=3:color=0x555555');
  await ff(['-start_number',String(start),'-i',path.join(dir,'sample-%04d.jpg'),'-filter_threads','2',
    '-vf',filters.join(','),'-frames:v','1','-q:v','2','-threads','1','-y',dest],{signal});
}
export async function probeExport(file,signal) {
  const bytes=await run('ffprobe',['-v','error','-count_frames','-show_streams','-of','json',file],{signal,maxBytes:256000});
  const {streams}=JSON.parse(bytes);
  const v=streams.find(s=>s.codec_type==='video');
  if(!v)throw Error('Aucune piste vidéo dans le rendu Remotion.');
  const [fpsNumerator,fpsDenominator]=v.avg_frame_rate.split('/').map(Number);
  return {width:v.width,height:v.height,fpsNumerator,fpsDenominator,frames:Number(v.nb_read_frames),videoIndex:v.index,
    hasAudio:streams.some(s=>s.codec_type==='audio')};
}

const W=128,H=72,bytesPer=W*H*3;
async function smallRgb(dir,count,signal) {
  const result=await ff(['-threads','2','-i',path.join(dir,'sample-%04d.jpg'),'-frames:v',String(count),
    '-filter_threads','1','-vf','scale='+W+':'+H+':flags=area','-threads','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],
    {signal,maxBytes:count*bytesPer});
  if(result.length!==count*bytesPer)throw Error('Décodage de comparaison incomplet.');
  return result;
}
function frameMetrics(a,b) {
  // SSIM over 8×8 luma windows; RGB MAE also responds to color shifts at fixed luma.
  let error=0, sum=0, windows=0;
  let sourceEdgeEnergy=0,renderEdgeEnergy=0;
  for(let y=0;y<H;y+=8)for(let x=0;x<W;x+=8) {
    let ax=0,bx=0,aa=0,bb=0,ab=0;
    for(let row=y;row<y+8;row++)for(let col=x;col<x+8;col++) {
      const off=(row*W+col)*3;
      const l=.2126*a[off]+.7152*a[off+1]+.0722*a[off+2], r=.2126*b[off]+.7152*b[off+1]+.0722*b[off+2];
      ax+=l;bx+=r;aa+=l*l;bb+=r*r;ab+=l*r;
      for(let k=off;k<off+3;k++)error+=Math.abs(a[k]-b[k]);
      // Include chroma edges. Two colors of similar luma can still form a visible object.
      if(col)for(let k=off;k<off+3;k++) {
        sourceEdgeEnergy+=(a[k]-a[k-3])**2;
        renderEdgeEnergy+=(b[k]-b[k-3])**2;
      }
      if(row)for(let k=off;k<off+3;k++) {
        sourceEdgeEnergy+=(a[k]-a[k-W*3])**2;
        renderEdgeEnergy+=(b[k]-b[k-W*3])**2;
      }
    }
    ax/=64;bx/=64;
    const cov=ab/64-ax*bx,variance=aa/64-ax*ax+bb/64-bx*bx;
    sum+=((2*ax*bx+6.5025)*(2*cov+58.5225))/((ax*ax+bx*bx+6.5025)*(variance+58.5225));
    windows++;
  }
  const ssim=Math.max(-1,Math.min(1,sum/windows)),rgbMae=error/bytesPer;
  const pairs=((W-1)*H+(H-1)*W)*3;
  return {ssim,rgbMae,score:(Math.max(0,ssim)+(1-rgbMae/255))/2,
    sourceEdgeRms:Math.sqrt(sourceEdgeEnergy/pairs),renderEdgeRms:Math.sqrt(renderEdgeEnergy/pairs)};
}
export async function measureSamples(refDir,renderDir,samples,scenes,signal) {
  const count=samples.length;
  const ref=await smallRgb(refDir,count,signal),render=await smallRgb(renderDir,count,signal);
  const frames=samples.map(({frame},i)=>{
    const from=i*bytesPer, to=from+bytesPer;
    return {frame,...frameMetrics(ref.subarray(from,to),render.subarray(from,to))};
  });
  const mean=(list,k)=>list.reduce((sum,v)=>sum+v[k],0)/list.length;
  const summarise=list=>list.length ? {samples:list.length,score:mean(list,'score'),meanSsim:mean(list,'ssim'),meanRgbMae:mean(list,'rgbMae')} : {samples:0};
  return {method:'Matched temporal samples, 128×72 RGB. Score = (max(0, local luma SSIM) + 1 − RGB MAE/255) / 2.',
    ...summarise(frames),worstFrame:frames.reduce((a,b)=>a.score<b.score?a:b).frame,frames,
    scenes:scenes.map(s=>({id:s.id,...summarise(frames.filter(f=>f.frame>=s.from && f.frame<s.to))}))};
}
export async function comparisonSheet(refDir,renderDir,dir,measure,signal) {
  const entries=measure.frames.map((f,i)=>({...f,i})).sort((a,b)=>a.score-b.score).slice(0,4).sort((a,b)=>a.frame-b.frame);
  fs.mkdirSync(dir,{recursive:true});
  for(const [n,entry] of entries.entries()) {
    const common='scale=420:240:force_original_aspect_ratio=decrease,pad=420:270:(ow-iw)/2:(240-ih)/2';
    const graph='[0:v]'+common+','+label('Reference  F'+entry.frame)+'[a];[1:v]'+common+','+label('Remotion  F'+entry.frame)+'[b];[a][b]hstack';
    await ff(['-i',path.join(refDir,name(entry.i)),'-i',path.join(renderDir,name(entry.i)),'-filter_complex_threads','2',
      '-filter_complex',graph,'-frames:v','1','-threads','1','-q:v','2','-y',path.join(dir,name(n))],{signal});
  }
  const dest=path.join(dir,'comparison.jpg');
  await ff(['-i',path.join(dir,'sample-%04d.jpg'),'-filter_threads','1','-vf','tile=1x'+entries.length+':padding=2:color=gray',
    '-frames:v','1','-threads','1','-q:v','2','-y',dest],{signal});
  return dest;
}

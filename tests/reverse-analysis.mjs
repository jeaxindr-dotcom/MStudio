import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, test} from 'node:test';
import {analyzeVideo, prepareReverseMedia, previewFrame} from '../lib/reverse-analysis.mjs';

const folder = fs.mkdtempSync(path.join(os.tmpdir(),'coulisses-reverse-analysis-'));
const file = name => path.join(folder, name);
const command = (program, args, input) => execFileSync(program,args,{input,windowsHide:true,maxBuffer:8*1024*1024});
const ffmpeg = args => command('ffmpeg',['-v','error','-nostdin',...args]);
const streams = name => JSON.parse(command('ffprobe',['-v','error','-show_streams','-of','json',name])).streams;
after(() => { fs.rmSync(folder,{recursive:true,force:true}); });

test('Un master AVC à 30000/1001 garde ses 90 images et ses octets. Une source remplacée ne publie aucun fichier.', async () => {
  const source = file('fraction.mp4'), copy = file('master.mp4');
  ffmpeg(['-f','lavfi','-i','testsrc2=s=128x96:r=30000/1001','-frames:v','90','-c:v','libx264',source]);
  const a = await analyzeVideo(source);
  assert.deepEqual([a.fpsNumerator,a.fpsDenominator,a.frames],[30000,1001,90]);
  assert.equal(a.hasAudio,false);
  assert.equal(a.needsNormalization,false);
  await prepareReverseMedia(source,a,copy);
  assert.deepEqual(fs.readFileSync(copy), fs.readFileSync(source));
  fs.appendFileSync(source,'nouvelle version');
  const destination = file('should-not-exist.mp4');
  await assert.rejects(prepareReverseMedia(source,a,destination), /changé/);
  assert.equal(fs.existsSync(destination),false);
});

test('Le VFR normalisé conserve les deux coupes et les 200 ms de retard audio. Les vignettes suivent aussi les coupes.', async () => {
  const source = file('variable.mkv'), dest = file('normal.mp4');
  const src = "nullsrc=s=144x96:r=30,geq=lum='if(lt(N,30),30,if(lt(N,60),170,80))':cb=128:cr=128,select='not(eq(n,8)+eq(n,9)+eq(n,70))'";
  ffmpeg(['-f','lavfi','-i',src,'-itsoffset','0.2','-f','lavfi','-i','sine=frequency=520:sample_rate=48000:duration=2.5',
    '-map','0:v','-map','1:a','-frames:v','87','-c:v','ffv1','-c:a','pcm_s16le','-fps_mode','passthrough',source]);
  const a = await analyzeVideo(source);
  assert.equal(a.frames,90); assert.equal(a.durationSeconds,3);
  assert.equal(a.hasAudio,true); assert.equal(a.needsNormalization,true);
  assert.equal(a.timing.variable,true); assert.equal(a.timing.sourcePts.length,87);
  assert.deepEqual(a.cuts,[30,60]);
  await prepareReverseMedia(source,a,dest);
  const output = streams(dest);
  assert.equal(Number(output.find(s => s.codec_type === 'video').nb_frames),90);
  const audio = ffmpeg(['-i',dest,'-map','0:a','-ac','1','-ar','48000','-f','s16le','pipe:1']);
  const rms = t => {
    let sum = 0;
    const count = 480;
    for (let i=0;i<count;i++) sum += audio.readInt16LE(2*(Math.round(t*48000)+i))**2;
    return Math.sqrt(sum/count);
  };
  assert.ok(rms(.1) < 10); assert.ok(rms(.22) > 1500); assert.ok(rms(2.95) < 10);
  for (const [frame,low,high] of [[29,10,30],[30,165,190],[59,165,190],[60,65,90],[89,65,90]]) {
    for (const [media,prepared] of [[source,false],[dest,true]]) {
      const jpg = await previewFrame(media,a,frame,{prepared});
      const rgb = command('ffmpeg',['-v','error','-i','pipe:0','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],jpg);
      assert.ok(rgb[0] > low && rgb[0] < high, 'Couleur à l’image '+frame+' dans '+media+' : '+rgb[0]);
    }
  }
});

test('La rotation et les pixels anamorphiques sont appliqués aux aperçus et au master préparé.', async () => {
  const original = file('anamorphique.mp4'), oriented = file('rotation.mp4'), dest = file('portrait.mp4');
  ffmpeg(['-f','lavfi','-i','testsrc2=s=144x96:r=25:d=0.4,setsar=4/3','-c:v','libx264',original]);
  ffmpeg(['-display_rotation:v','90','-i',original,'-c','copy',oriented]);
  const a = await analyzeVideo(oriented);
  assert.deepEqual([a.width,a.height],[96,192]);
  const jpg = file('portrait.jpg');
  fs.writeFileSync(jpg,await previewFrame(oriented,a,0,{maxWidth:64}));
  assert.deepEqual(streams(jpg).map(s => [s.width,s.height]), [[64,128]]);
  await prepareReverseMedia(oriented,a,dest);
  assert.deepEqual(streams(dest).map(s => [s.width,s.height,s.sample_aspect_ratio]), [[96,192,'1:1']]);
  await assert.rejects(previewFrame(oriented,a,a.frames), /hors/);
});

test('Un fondu au blanc représente une seule coupe et un flash isolé garde ses deux bords.', async () => {
  const source=file('fondus.mkv');
  const light='if(lt(N,8),30,if(lt(N,16),30+(N-7)*25,if(lt(N,18),230,if(lt(N,28),230-(N-17)*14,if(eq(N,42),230,if(eq(N,55),180,if(eq(N,56),30,if(gte(N,57),140,90))))))))';
  ffmpeg(['-f','lavfi','-i',"nullsrc=s=128x96:r=30,geq=lum='"+light+"':cb=128:cr=128",
    '-frames:v','70','-c:v','ffv1',source]);
  const a=await analyzeVideo(source);
  assert.ok(a.cuts[0]>=15 && a.cuts[0]<=17,JSON.stringify(a.cuts));
  assert.deepEqual(a.cuts.slice(1),[42,43,55,56,57]);
});

test('Annuler le décodage interrompt le processus et une nouvelle analyse peut lire le fichier.', async () => {
  const source = file('cancel.mp4');
  ffmpeg(['-f','lavfi','-i','testsrc2=s=160x120:r=30:d=3','-c:v','libx264',source]);
  const ctrl = new AbortController();
  await assert.rejects(analyzeVideo(source,{signal:ctrl.signal,onProgress:pct => {
    if (pct >= 20) ctrl.abort();
  }}), {name:'AbortError'});
  const a = await analyzeVideo(source);
  assert.equal(a.frames,90);
});

import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {codeFrameList,compositionOf,closeCode} from './frames.mjs';
import {loadTimeline} from './remotion-module.mjs';
import {readJson} from './episode.mjs';
import {coverFrames} from './library-code-thumbnails.mjs';

// This process owns its browser and is killed as a tree if user code gets stuck.
try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const {project:p,output,signature} = JSON.parse(input);
  const comp = await compositionOf(p,()=>{}, {cacheKey:signature});
  let timeline = readJson(p.SNAP,null);
  if (p.remotion) try { timeline = await loadTimeline(p.remotion); } catch { /* optional timeline */ }
  const frames = coverFrames(timeline,comp), images = new Map();
  await codeFrameList(p,frames,{cacheKey:signature,fitTo:{width:720,height:405},onFrame:(requested,buffer) => images.set(requested,buffer)});
  let best = images.get(frames[0]);
  for (const frame of frames) {
    const candidate = images.get(frame);
    const pixels = execFileSync('ffmpeg',['-v','error','-i','pipe:0','-vf','scale=32:18','-pix_fmt','gray','-frames:v','1','-f','rawvideo','pipe:1'],{input:candidate,windowsHide:true,timeout:10000});
    if (pixels.some(v => v > 24)) { best = candidate; break; }
  }
  fs.writeFileSync(output,best);
} catch (error) { process.stderr.write(String(error.stack || error)); process.exitCode = 1; }
finally { await closeCode(); }

// Real canvas pixels from a twelve-second, three-colour film. No production project,
// installed studio or live Player is needed to exercise the thumbnail timeline.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {launch, requireSandbox} from './cdp.mjs';
import {freePort} from './where.mjs';

const studio = fileURLToPath(new URL('../', import.meta.url));
const cache = path.join(studio, '.cache', 'timeline-filmstrip');
fs.mkdirSync(cache, {recursive:true});
const run = fs.mkdtempSync(path.join(cache, 'test-'));
process.env.STUDIO_PROJECTS = path.join(run, 'projects.json');
process.env.COULISSES_MEDIAS = path.join(run, 'media-library');
process.env.COULISSES_SETTINGS = path.join(run, 'settings.json');
process.env.COULISSES_HISTORY_DIR = path.join(run, 'history');
process.env.COULISSES_LANG = 'fr';
const {importProject} = await import('../lib/projects.mjs');
const episodeName = 'E03 - Trois couleurs';
const episodes = path.join(run, 'episodes'), episode = path.join(episodes, episodeName);
const project = path.join(run, 'montage'), renders = path.join(project, '07-renders');
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data));
let page, server, port, passed = 0;
function pass(label) { passed++; console.log('✓ ' + label); }

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  try { execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], {stdio:'ignore', windowsHide:true}); }
  catch { /* server already stopped */ }
  server = null;
}
async function open(args) {
  await stopServer();
  const url = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, ['studio-server.mjs', ...args, '--port', String(port), '--no-open'],
    {cwd:studio, env:process.env, windowsHide:true, stdio:'ignore'});
  let ready = false;
  for (let i = 0; i < 150 && !ready; i++) {
    if (server.exitCode !== null) throw new Error('Le serveur de test a quitté : ' + server.exitCode);
    ready = await fetch(url + '/api/ping').then(r => r.ok).catch(() => false);
    if (!ready) await delay(100);
  }
  assert.ok(ready);
  await requireSandbox(url, run);
  await page.goto(url);
  await page.until('window.__studio && document.querySelector("#v").readyState >= 2 && document.querySelector("#timelineThumbnails")');
}
const click = selector => page.eval('document.querySelector(' + JSON.stringify(selector) + ').click()');

// Measure a 13 CSS pixel stripe at the requested composition time. A photographic
// cell fills many contiguous rows. Coloured track borders and text occupy only a few.
function hasColour(seconds, channel) {
  const [a,b,c] = {red:[0,1,2], green:[1,0,2], blue:[2,0,1]}[channel];
  return `(() => {
    const t = ${seconds}, cv = document.getElementById('tl'), {a,b} = __studio.state().view;
    if (t < a || t >= b) return false;
    const d = cv.width / cv.clientWidth;
    const x = Math.round((118 + (t - a) / (b - a) * (cv.clientWidth - 118)) * d);
    const y = Math.round(62 * d), width = Math.round(13 * d);
    const height = cv.height - y;
    if (height < 1) return false;
    const pixels = cv.getContext('2d').getImageData(x - Math.floor(width/2), y, width, height).data;
    let rows = 0;
    for (let row = 0; row < height; row++) {
      let count = 0;
      for (let col = 0; col < width; col++) {
        const j = (row * width + col) * 4, main = pixels[j + ${a}];
        if (pixels[j+3] >= 140 && main > 90 && main > pixels[j+${b}] * 2 && main > pixels[j+${c}] * 2) count++;
      }
      rows = count >= width * .6 ? rows+1 : 0;
      if (rows >= 9 * d) return true;
    }
    return false;
  })()`;
}
async function colours(samples) {
  const probes = samples.map(([t,c]) => hasColour(t,c));
  try { await page.until(probes.join(' && '), 45000); }
  catch {
    const observed = await page.eval('return [' + probes.join(',') + ']');
    const missing = samples.filter((_,i) => !observed[i]);
    const state = await page.eval('return {view:__studio.state().view,lanes:__studio.state().lanes}');
    assert.fail('Couleurs de pellicule absentes : ' + JSON.stringify({missing, state}));
  }
}

try {
  fs.mkdirSync(path.join(episode, 'revue'), {recursive:true});
  fs.mkdirSync(renders, {recursive:true});
  fs.mkdirSync(path.join(project, '08-montage'));
  const plain = path.join(run, 'Film.mp4');
  const inputs = ['red','lime','blue'].flatMap(color => ['-f','lavfi','-i','color=c=' + color + ':s=320x180:r=30:d=4']);
  execFileSync('ffmpeg', ['-v','error','-y',...inputs,'-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
    '-map','[v]','-c:v','libx264','-pix_fmt','yuv420p','-g','30',plain], {windowsHide:true});
  fs.copyFileSync(plain, path.join(episode, episodeName + '.mp4'));
  write(path.join(episode, 'revue', 'timeline.json'), {fps:30, frames:360, says:[], curtain:[],
    sets:[{id:'debut',name:'Début',inT:0,outT:8}, {id:'fin',name:'Fin',inT:8,outT:null}],
    cutaways:[{id:'insert',name:'Insert vert',t:5,dur:1}]});
  fs.copyFileSync(plain, path.join(renders, 'master.mp4'));
  fs.copyFileSync(plain, path.join(project, 'source.mp4'));
  write(path.join(project, 'run.json'), {slug:'filmstrip-test'});
  write(path.join(project, '08-montage', 'plan-montage.json'), {fps:30,total_images:360,V1:[
    {fichier:'source.mp4',record:0,images:240,debut_media:0,role:'Plan long'},
    {fichier:'source.mp4',record:240,images:120,debut_media:120,role:'Reprise verte'}]});

  port = await freePort(4368);
  page = await launch({port:await freePort(9581)});
  await open(['E03','--theatre',run,'--episodes',episodes]);
  assert.equal(await page.eval('return document.querySelector("#timelineThumbnails").getAttribute("aria-pressed")'), 'true');
  await colours([[1.5,'red'],[6.5,'green'],[7.7,'green'],[8.3,'blue']]);
  pass('E03 : la pellicule est active par défaut, évolue dans le plan long et respecte la coupe à 8 s.');

  await click('#bZoomIn');
  const bounds = await page.eval('return __studio.state().view');
  assert.ok(bounds.b - bounds.a < 11);
  const rect = await page.eval('return document.querySelector("#tl").getBoundingClientRect().toJSON()');
  await page.wheel(rect.left + rect.width / 2, rect.top + 36, rect.width / 2, 2);
  await page.until('__studio.state().view.a > 2 && __studio.state().view.b > 9');
  await colours([[6.5,'green'],[7.7,'green'],[8.3,'blue']]);
  pass('Le zoom et le déplacement de la vue conservent les couleurs au bon temps.');

  await click('#timelineThumbnails');
  await page.until('document.querySelector("#timelineThumbnails").getAttribute("aria-pressed") === "false" && !' + hasColour(6.5,'green'));
  await page.goto('http://127.0.0.1:' + port + '/');
  await page.until('window.__studio && document.querySelector("#v").readyState >= 2');
  assert.equal(await page.eval('return document.querySelector("#timelineThumbnails").getAttribute("aria-pressed")'), 'false');
  await click('#timelineThumbnails');
  await colours([[1.5,'red'],[9,'blue']]);
  pass('Le bouton masque les images, mémorise le choix et les restaure.');

  await click('#trackVisibility');
  await page.until('document.querySelector("#trackPicker button[data-track=mix]")');
  await click('#trackPicker button[data-track=mix]');
  await page.key('Escape','Escape');
  await page.until('__studio.state().lanes.length === 1 && !' + hasColour(1.5,'red'));
  pass('Isoler le mix laisse uniquement la piste sonore.');

  await open(['--project',importProject(project).revue]);
  await page.until('__studio.state().lanes.length >= 2');
  await colours([[2,'red'],[6,'green'],[10,'green']]);
  pass('Montage : les clips vidéo suivent leur média et leur entrée source, distincts du master bleu à 10 s.');

  await open(['--project',importProject(plain).revue]);
  await colours([[2,'red'],[6,'green'],[10,'blue']]);
  pass('Un MP4 seul possède sa pellicule en l’absence de plan de montage.');
  console.log(passed + ' ok, 0 ko');
} catch (error) {
  console.error(error, page?.logs.filter(text => text.includes('exception')).slice(-4));
  console.log(passed + ' ok, 1 ko'); process.exitCode = 1;
} finally {
  await page?.close();
  await stopServer();
  if (path.dirname(run) === cache) fs.rmSync(run, {recursive:true, force:true, maxRetries:4, retryDelay:250});
}

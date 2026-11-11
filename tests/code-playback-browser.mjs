// Intégration réelle de la relecture calculée : deux rendus de 30 images, studio et Chrome propres.
// --review décrit les opérations sans créer de fixture, démarrer de processus ni faire de requête.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, requireSandbox } from './cdp.mjs';
import { remotionModules, skip } from './where.mjs';
import { waitForRenderIdle } from '../lib/render-activity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.includes('--review')) {
  console.log(JSON.stringify({ dossier: path.join(ROOT, '.cache', 'code-playback-browser'), portsStudio: [4188, 4192], portChrome: 9385,
    composition: '300 images, 640×360, 30 i/s, WAV synthétique', rendus: 'Deux plages de 30 images, plus un accès réutilisé par l’interface',
    controles: ['absence de rendu/export sur 4170–4199', 'requireSandbox', 'Chrome muet', 'arrêt des seuls processus créés'],
    mesures: ['temps de préparation et de réutilisation', 'taille, cadence et son du fichier', 'pixels avant/après correction à date constante', 'horloge UI et vidéo', 'mémoire JS et démontage du Player dans l’iframe conservée'],
  }, null, 2));
  process.exit(0);
}
const MODULES = remotionModules(); if (!MODULES) skip('dépendances Remotion absentes', 'COULISSES_TEST_REMOTION');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const free = (port) => new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(true))); });
const parent = path.join(ROOT, '.cache', 'code-playback-browser');
fs.mkdirSync(parent, { recursive: true });
const SCR = fs.mkdtempSync(path.join(parent, 'essai-')), PROJECT = path.join(SCR, 'projet'), RUN = path.join(SCR, 'run');
const records = { dossier: SCR, controles: [], demandes: [], mesures: {}, assertions: [] };
const owners = new Set();
let ok = 0, ko = 0, server = null, serverClosed = false, page = null, base = null, serverLog = '', confirmedSandbox = false;
const check = (value, name, detail = null) => { value ? ok++ : ko++; records.assertions.push({ reussi: !!value, nom: name, detail }); console.log(`  ${value ? '✓' : '✗'} ${name}`); };
const ensure = (value, message) => { if (!value) throw new Error(message); };
const guard = async (label) => { await waitForRenderIdle(); records.controles.push({ etape: label, date: new Date().toISOString(), libre: true }); };
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
function fixture() {
  fs.mkdirSync(PROJECT, { recursive: true });
  fs.symlinkSync(MODULES, path.join(PROJECT, 'node_modules'), 'junction');
  const version = JSON.parse(fs.readFileSync(path.join(MODULES, 'remotion', 'package.json'), 'utf8')).version;
  write(path.join(PROJECT, 'package.json'), JSON.stringify({ name: 'coulisses-test-plage', private: true, dependencies: { remotion: version, '@remotion/cli': version, '@remotion/player': version, react: '19.2.3', 'react-dom': '19.2.3' } }));
  write(path.join(PROJECT, 'src', 'Video.tsx'), `import React from 'react';
import {AbsoluteFill, Audio, staticFile, useCurrentFrame} from 'remotion';
export const Video = () => { const frame = useCurrentFrame(); return <AbsoluteFill style={{background:'#d02020',color:'white',fontFamily:'sans-serif'}}>
  <div data-coulisses="compteur" style={{position:'absolute',left:100+frame%100,top:140,fontSize:50}}>{frame}</div>
  <Audio src={staticFile('voix.wav')}/>
</AbsoluteFill>; };
`);
  write(path.join(PROJECT, 'src', 'coulisses.ts'), `import {Video} from './Video';
export const compositions=[{id:'PLAGE-ESSAI',component:Video,width:640,height:360,fps:30,durationInFrames:300,defaultProps:{}}];\n`);
  write(path.join(PROJECT, 'src', 'index.tsx'), `import React from 'react'; import {registerRoot,Composition} from 'remotion'; import {Video} from './Video';
registerRoot(()=> <Composition id="PLAGE-ESSAI" component={Video} width={640} height={360} fps={30} durationInFrames={300}/>);\n`);
  write(path.join(PROJECT, 'src', 'coulisses-timeline.ts'), `export const timeline=()=>({fps:30,durationInFrames:300,pistes:[
{id:'V1',nom:'Image',type:'video',clips:[{de:0,a:300,label:'Couleur et compteur',fichier:'src/Video.tsx',ref:'plan'}]},
{id:'A1',nom:'Son',type:'audio',clips:[{de:0,a:300,label:'Son de contrôle',fichier:'public/voix.wav',son:'voix.wav'}]}]});\n`);
  const sampleRate = 16000, samples = sampleRate * 10, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 330 * i / sampleRate) * 4000), 44 + i * 2);
  write(path.join(PROJECT, 'public', 'voix.wav'), wav);
  write(path.join(RUN, 'essai.coulisses'), JSON.stringify({ coulisses: 1, titre: 'Essai lecture calculée', chaine: 'Bac à sable', format: '16:9',
    remotion: { projet: '../projet', entree: 'src/index.tsx', module: 'src/coulisses.ts', timeline: 'src/coulisses-timeline.ts', composition: 'PLAGE-ESSAI', props: {} }, revue: 'revue' }));
  // Descripteur propre, même forme que importProject ; aucun registre partagé n’est modifié.
  write(path.join(RUN, 'revue', 'projet.json'), JSON.stringify({ studio: 'Coulisses', kind: 'remotion', title: 'Essai lecture calculée', root: '..', coulisses: '../essai.coulisses', format: '16:9' }));
  write(path.join(SCR, 'settings.json'), JSON.stringify({ lang: 'fr', exportGpu: false }));
}
async function json(endpoint, body) {
  if (body !== undefined) ensure(confirmedSandbox, 'Mutation refusée avant requireSandbox');
  const response = await fetch(new URL(endpoint, base), { ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(65000) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${response.status} : ${value.error ?? JSON.stringify(value)}`);
  return value;
}
async function until(fn, label, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const result = await fn(); if (result) return result; await sleep(250); }
  throw new Error(`Délai dépassé : ${label}`);
}
async function codeReady(version = -1) {
  return until(async () => { const s = await json('/api/status'), timeline = await json('/api/timeline'); return s.code?.status === 'ready' && s.code.version > version && timeline.status === 'ready' ? s.code : null; }, 'code compilé et frise prête');
}
async function requestRange(version) {
  await guard('demande de 30 images');
  const owner = crypto.randomUUID(); owners.add(owner);
  const begin = Date.now();
  const initial = await json('/api/code-playback', { owner, from: 270, to: 300, version, width: 640, height: 360 });
  ensure(initial.id, 'La demande ne renvoie aucun identifiant');
  const states = [initial.status];
  const result = await until(async () => {
    const s = await json(`/api/code-playback?id=${encodeURIComponent(initial.id)}`);
    if (states.at(-1) !== s.status) states.push(s.status);
    if (s.status === 'error' || s.status === 'cancelled') throw new Error(`Préparation ${s.status} : ${s.reason}`);
    return s.status === 'ready' ? s : null;
  }, 'plage prête', 240000);
  records.demandes.push({ owner, id: result.id, key: result.key, etats: states, ms: Date.now() - begin });
  return result;
}
async function media(job, name) {
  await guard('vérification du fichier calculé');
  const response = await fetch(new URL(`/api/code-playback/${job.id}.mp4`, base)); ensure(response.ok, `Vidéo inaccessible : ${response.status}`);
  const file = path.join(SCR, name + '.mp4'); fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  ensure(probe.status === 0, probe.stderr || 'ffprobe a échoué');
  const data = JSON.parse(probe.stdout), video = data.streams.find((s) => s.codec_type === 'video'), audio = data.streams.find((s) => s.codec_type === 'audio');
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'crop=2:2:0:0', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { windowsHide: true, timeout: 20000 });
  ensure(decoded.status === 0 && decoded.stdout.length >= 3, 'Décodage de la couleur témoin impossible');
  const result = { bytes: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), duration: Number(data.format.duration),
    fps: video?.r_frame_rate, width: video?.width, height: video?.height, audio: !!audio, pixel: [...decoded.stdout.subarray(0, 3)] };
  records.mesures[name] = result; return result;
}
async function click(selector) {
  const point = await page.eval(`const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw new Error('Bouton absent'); const r=e.getBoundingClientRect(); return [r.left+r.width/2,r.top+r.height/2]`);
  await page.mouse('mouseMoved', ...point); await page.mouse('mousePressed', ...point); await page.mouse('mouseReleased', ...point);
}
async function stopOwnServer() {
  if (!server || serverClosed) return;
  const ended = new Promise((resolve) => server.once('close', resolve));
  server.kill();
  if (await Promise.race([ended.then(() => true), sleep(10000).then(() => false)])) return;
  // La cible est exclusivement le processus que ce test vient de créer.
  if (Number.isInteger(server.pid) && server.pid > 0) {
    const kill = spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await new Promise((resolve) => { kill.once('close', resolve); kill.once('error', resolve); });
    await Promise.race([ended, sleep(10000)]);
  }
}

try {
  await guard('création du bac et démarrage du studio');
  const port = await free(4188) ? 4188 : await free(4192) ? 4192 : null;
  ensure(port, 'Les deux ports de test autorisés sont occupés'); ensure(await free(9385), 'Le port du Chrome de test 9385 est occupé');
  fixture();
  const env = { ...process.env, COULISSES_LANG: 'fr', COULISSES_GPU: 'cpu', COULISSES_PREMOUNT: '0',
    COULISSES_SETTINGS: path.join(SCR, 'settings.json'), STUDIO_PROJECTS: path.join(SCR, 'projets.json'), COULISSES_MEDIAS: path.join(SCR, 'medias'), COULISSES_HISTORY_DIR: path.join(SCR, 'historique') };
  server = spawn(process.execPath, [path.join(ROOT, 'studio-server.mjs'), '--project', path.join(RUN, 'revue'), '--no-open', '--port', String(port)], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  server.once('close', () => { serverClosed = true; });
  const log = (x) => { serverLog = (serverLog + x).slice(-2 * 1024 * 1024); }; server.stdout.on('data', log); server.stderr.on('data', log);
  await until(async () => { if (server.exitCode !== null) throw new Error(serverLog); return /Ouvre : http/.test(serverLog); }, 'démarrage du studio');
  const actual = /Ouvre : (http:\/\/127\.0\.0\.1:(\d+))/.exec(serverLog);
  ensure(Number(actual?.[2]) === port, 'Le studio a changé de port : test arrêté avant toute mutation'); base = actual[1] + '/';
  await requireSandbox(base, RUN); confirmedSandbox = true;
  const initialCode = await codeReady();
  const first = await requestRange(initialCode.version), a = await media(first, 'avant');
  check(a.audio && a.fps === '30/1' && Math.abs(a.duration - 1) < 0.15 && a.width === 640 && a.height === 360, 'La plage contient 1 s à 30 i/s, une image 640×360 et du son', a);
  check(a.pixel[0] > a.pixel[1] * 2, 'Le premier calcul contient le fond rouge attendu', a.pixel);
  const cached = await requestRange(initialCode.version);
  check(cached.key === first.key && cached.id === first.id && records.demandes.at(-1).etats.every((s) => s === 'ready'), 'La même plage est réutilisée sans relancer de calcul', records.demandes.at(-1));

  await guard('navigation et lecture dans Chrome muet');
  page = await launch({ port: 9385, autoplay: 'tab' });
  await page.goto(base + '#f=270');
  await page.until(`window.__studio?.state().mode==='code' && window.__preview?.durationInFrames===300`, 120000);
  await page.eval('await window.__preview.seek(270); await window.__preview.whenReady(); return 1');
  records.mesures.memoireAvant = { page: await page.send('Runtime.getHeapUsage'), iframe: await page.frameSend('player.html', 'Runtime.getHeapUsage') };
  const uiStart = Date.now(); await click('#prepareCodeRange');
  await page.until(`document.querySelector('#codeRangeVideo')?.readyState>=2 && getComputedStyle(document.querySelector('#codeRangeVideo')).display!=='none'`, 60000);
  records.mesures.reutilisationInterfaceMs = Date.now() - uiStart;
  check(await page.eval(`const v=document.querySelector('#codeRangeVideo'); return __studio.state().mode==='code' && v.currentSrc.includes(${JSON.stringify(first.id)}) && Math.abs(v.duration-1)<0.15`), 'La plage calculée est affichée dans le mode code');
  const display = await page.eval(`const v=document.querySelector('#codeRangeVideo'),m=document.querySelector('#media'); const r=m.getBoundingClientRect(),vr=v.getBoundingClientRect();
    return {visibility:getComputedStyle(v).visibility,width:vr.width,mediaWidth:r.width,overlay:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.id}`);
  check(display.visibility === 'visible' && Math.abs(display.width - display.mediaWidth) < 2 && display.overlay === 'ov',
    'La vidéo reste visible à la taille de l’aperçu et les annotations restent accessibles', display);
  const unloaded = await page.frameEval('player.html', `return {children:document.querySelector('#root')?.children.length,ready:window.StudioPlayer?.frameReady(),playing:window.StudioPlayer?.isPlaying()}`);
  check(unloaded?.children === 0 && unloaded.ready === false && unloaded.playing === false,
    'Le Player est démonté pendant la lecture calculée, ses modules restent dans l’iframe', unloaded);
  await page.eval(`window.__mesureCode={images:[],horloge:[]}; const v=document.querySelector('#codeRangeVideo');
    const frame=(t,m)=>{__mesureCode.images.push({t,media:m.mediaTime}); window.__mesureFrame=v.requestVideoFrameCallback(frame)};
    window.__mesureFrame=v.requestVideoFrameCallback(frame);
    window.__mesureTimer=setInterval(()=>__mesureCode.horloge.push({t:performance.now(),frame:__studio.state().frame,media:v.currentTime,paused:v.paused}),16); return 1`);
  await click('#bPlay'); await sleep(800);
  const measured = await page.eval(`const v=document.querySelector('#codeRangeVideo'); v.pause(); clearInterval(window.__mesureTimer); v.cancelVideoFrameCallback(window.__mesureFrame); return __mesureCode`);
  const frames = measured.images, samples = measured.horloge.filter((s) => !s.paused);
  const span = frames.length > 1 ? (frames.at(-1).t - frames[0].t) / 1000 : 0;
  const fps = span ? (frames.at(-1).media - frames[0].media) * 30 / span : 0;
  records.mesures.lecture = { fps, imagesPresentees: frames.length, echantillons: measured };
  check(frames.length >= 12 && fps >= 24 && fps <= 36, `La lecture calculée avance régulièrement (${fps.toFixed(1)} i/s, ${frames.length} images observées)`);
  check(samples.length >= 10 && samples.every((s) => Math.abs(s.frame - (270 + Math.floor(s.media * 30))) <= 1), 'La frise et la vidéo utilisent la même horloge', samples);
  records.mesures.memoireCalculee = { page: await page.send('Runtime.getHeapUsage'), iframe: await page.frameSend('player.html', 'Runtime.getHeapUsage') };
  await page.shot(path.join(SCR, 'lecture-calculee.png'));
  const pausedFrame = await page.eval('return __studio.state().frame');
  await click('#returnLiveCode');
  await until(async () => {
    const live = await page.frameEval('player.html', `return !!document.querySelector('#root')?.children.length && window.StudioPlayer?.frameReady()`);
    return live && await page.eval(`return document.querySelector('#codeRangeVideo').hidden && !document.querySelector('iframe.code-next')`);
  }, 'retour au Player monté et à son image prête');
  check(await page.eval(`return __studio.state().mode==='code' && Math.abs(__studio.state().frame-${pausedFrame})<=1`), 'Le retour au code vivant conserve l’image de relecture');
  // Le rechargement de l'aperçu peut aussi être demandé pendant que la plage possède le Player.
  await page.eval('await __preview.seek(270); await __preview.whenReady(); window.previousPlayer=__preview; return true');
  await page.until("!document.querySelector('#prepareCodeRange').disabled");
  await click('#prepareCodeRange');
  await page.until("!document.querySelector('#codeRangeVideo').hidden && document.querySelector('#codeRangeVideo').readyState>=2");
  await page.eval("document.querySelector('#previewReadiness button').click()");
  await page.until("window.__preview && __preview !== previousPlayer && __preview.frameReadiness()?.verified && !document.querySelector('#prepareCodeRange').disabled", 90000);
  check(await page.eval("return __preview.frame()===270 && document.querySelector('#returnLiveCode').hidden && document.querySelector('#codeRangeVideo').hidden"),
    'Un rechargement pendant la plage retrouve le direct à la même image et permet une nouvelle préparation');
  await page.goto('about:blank'); await page.close(); page = null;

  // Réactiver l’entrée cache si le retour au direct l’a libérée, puis modifier exactement un fichier
  // en conservant taille et date : l’ancienne signature « date max + compte » manquerait ce changement.
  const beforeEdit = await requestRange(initialCode.version);
  await guard('modification isolée et seconde préparation');
  const source = path.join(PROJECT, 'src', 'Video.tsx'), st = fs.statSync(source), text = fs.readFileSync(source, 'utf8');
  fs.writeFileSync(source, text.replace('#d02020', '#20b040')); fs.utimesSync(source, st.atime, st.mtime);
  check(fs.statSync(source).size === st.size && Math.abs(fs.statSync(source).mtimeMs - st.mtimeMs) < 1, 'La correction conserve taille et date du fichier pour éprouver la clé de cache');
  const nextCode = await codeReady(initialCode.version);
  const expired = await fetch(new URL(`/api/code-playback/${beforeEdit.id}.mp4`, base));
  check(expired.status === 410, 'Une ancienne plage ne peut pas être servie comme la nouvelle version');
  const staleRequest = await fetch(new URL('/api/code-playback', base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: crypto.randomUUID(), from: 270, to: 300, version: initialCode.version, width: 640, height: 360 }) });
  check(staleRequest.status === 409, 'Une demande portant l’ancienne version est refusée');
  const changed = await requestRange(nextCode.version), b = await media(changed, 'apres');
  check(changed.key !== first.key && changed.hash !== first.hash && b.sha256 !== a.sha256 && b.pixel[1] > b.pixel[0] * 2,
    'Le second rendu montre réellement le code corrigé malgré la date inchangée', { hashAvant: first.hash, hashApres: changed.hash, pixel: b.pixel });
} catch (error) { check(false, 'Intégration complète', String(error?.stack ?? error)); }
finally {
  if (page) {
    records.journalNavigateur = [...page.logs];
    try { records.etatInterfaceFinal = await page.eval(`return {studio:window.__studio?.state(),statut:document.querySelector('#codeStatus')?.textContent,preparation:document.querySelector('#codeRangeTools')?.textContent}`); } catch { /* page fermée */ }
  }
  if (confirmedSandbox && base) for (const owner of owners) {
    try { await json('/api/code-playback/cancel', { owner }); } catch (e) { records.controles.push({ nettoyage: 'annulation', erreur: e.message }); }
  }
  try { await page?.close(); } catch { /* navigateur propre déjà arrêté */ }
  await stopOwnServer();
  // On retire uniquement la jonction créée par ce test, après la fermeture de ses processus.
  const junction = path.resolve(PROJECT, 'node_modules');
  if (junction.startsWith(path.resolve(SCR) + path.sep) && (!server || serverClosed)) {
    try { if (fs.lstatSync(junction).isSymbolicLink()) fs.rmSync(junction); } catch { /* absence ou encore détenue */ }
  }
  records.ok = ok; records.ko = ko;
  fs.writeFileSync(path.join(SCR, 'serveur.log'), serverLog);
  fs.writeFileSync(path.join(SCR, 'resultat.json'), JSON.stringify(records, null, 2));
  fs.writeFileSync(path.join(parent, 'dernier.json'), JSON.stringify({ dossier: SCR, ok, ko }, null, 2));
}
console.log(`  Preuves : ${SCR}\n${ok} ok, ${ko} ko`); process.exitCode = ko ? 1 : 0;

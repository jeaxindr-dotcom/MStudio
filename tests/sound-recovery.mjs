// Scénario E03, navigateur muet. Les événements viennent du vrai Player et
// les mesures du contexte lié et des balises viennent de l’iframe affichée.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as dormir} from 'node:timers/promises';
import {launch, requireFrench, requireSandbox} from './cdp.mjs';
import {freePort} from './where.mjs';
import {sonDuBac} from './sound-probe.mjs';

const studio = fileURLToPath(new URL('../', import.meta.url));
const bac = process.env.STUDIO_SANDBOX ?? path.join(studio, 'sandbox', '07_Episodes');
const url = 'http://127.0.0.1:' + (process.env.STUDIO_PORT ?? 4174) + '/';
await requireFrench(url); await requireSandbox(url, bac);
const p = await launch({port: await freePort(9333)});
const {adresse, clic, dans, arret, preuve, attendreSon, attendreDans, message} = sonDuBac(p);
let ok = 0;
const passe = (titre) => { ok++; console.log('  ✓ ' + titre); };
try {
  await p.goto(url + '#f=900'); await p.until('window.__studio && document.querySelector("#v").readyState >= 2', 120000);
  await clic('srcCode'); await p.until('__studio.state().mode === "code" && window.__preview?.frameReady()', 120000);
  await arret(900); const origine = await adresse();
  await clic('bPlay'); await preuve(); passe('Lecture initiale avec une piste E03 active');

  // Un échec de reprise du périphérique fait réellement muter Remotion.
  await clic('bPlay'); await attendreDans('!StudioPlayer.isPlaying() && __coulissesAudio[0].state === "suspended"');
  await dans(`const c = __coulissesAudio[0]; window.pannes = 0;
    c.resume = async () => { pannes++; throw new DOMException('périphérique', 'InvalidStateError'); }`);
  await clic('bPlay'); await attendreDans('StudioPlayer.isMuted() && pannes >= 1');
  await p.until('/coupé/.test(document.querySelector("#save").textContent)');
  passe('Le Player se met en sourdine et la coupure est annoncée');
  await dans('delete __coulissesAudio[0].resume');
  await attendreSon(); assert.equal(await adresse(), origine);
  passe('La reprise automatique vérifiée conserve le contexte et le document');
  await clic('bPlay'); await attendreDans('!StudioPlayer.isPlaying()'); await clic('bPlay'); await preuve();
  passe('Pause puis Lecture conservent le son');

  // Figer uniquement le fil de l’iframe, sans boucle qui charge un cœur du PC.
  await dans(`const c = __coulissesAudio[0]; window.initial = c; c.resume = async () => { throw new Error('périphérique indisponible'); }; await c.suspend()`);
  await p.frameSend(origine, 'Debugger.enable');
  await p.frameSend(origine, 'Debugger.pause'); await dormir(1500);
  await p.frameSend(origine, 'Debugger.resume'); await p.frameSend(origine, 'Debugger.disable');
  assert.ok(await dans('return StudioPlayer.isPlaying() && initial.state === "suspended"'));
  // Une balise de la scène s’est aussi arrêtée. Son redémarrage doit respecter
  // les séquences que Remotion garde prémontées ou déjà terminées.
  await dans(`window.piste = [...document.querySelectorAll('audio')].find(a => a.currentSrc && !a.currentSrc.startsWith('data:') && !a.muted && !a.paused);
    if (!piste) throw new Error('piste E03 absente'); piste.pause(); delete initial.resume`);
  let t = Date.now(); await clic('bSound'); await attendreSon();
  assert.ok(await dans('return __coulissesAudio[0] === initial && !piste.paused'));
  assert.equal(await adresse(), origine); passe('Après gel et perte audio, son sur place en lecture (' + (Date.now() - t) + ' ms avec contre-mesure)');

  await arret(900);
  await dans('StudioPlayer.mute()'); await attendreDans('StudioPlayer.isMuted()');
  await clic('bSound'); await p.until('/lecture/i.test(document.querySelector("#save").textContent)');
  assert.doesNotMatch(await message(), /rétabli/i);
  assert.equal(await dans('return StudioPlayer.frame()'), 900); assert.equal(await dans('return StudioPlayer.isPlaying()'), false);
  assert.equal(await adresse(), origine); passe('À l’arrêt, même image et aucune annonce de succès anticipée');
  t = Date.now(); await clic('bPlay'); await attendreSon();
  assert.equal(await adresse(), origine); passe('Lecture confirme le son sur place (' + (Date.now() - t) + ' ms avec contre-mesure)');

  await dans('StudioPlayer.mute()'); await attendreDans('StudioPlayer.isMuted()');
  await p.eval('const r = document.querySelector("#vol"); r.value = "0.6"; r.dispatchEvent(new Event("input"))');
  await attendreDans('!StudioPlayer.isMuted()'); passe('Le curseur de volume réactive le son');
  await arret(940); await clic('srcVideo'); await p.until('__studio.state().mode === "video"');
  await clic('bPlay'); await p.until('!document.querySelector("#v").paused');
  const avant = await p.eval('const v = document.querySelector("#v"); v.muted = true; v.volume = 0.1; return v.currentTime');
  await clic('bSound');
  await p.until('!document.querySelector("#v").paused && !document.querySelector("#v").muted && document.querySelector("#v").volume === 0.6');
  const bytes = await p.eval('return document.querySelector("#v").webkitAudioDecodedByteCount');
  await p.until('document.querySelector("#v").webkitAudioDecodedByteCount > ' + bytes);
  const temps = await p.eval('return document.querySelector("#v").currentTime');
  assert.ok(temps >= avant && temps - avant < 6, JSON.stringify({avant, temps}));
  passe('Le MP4 reprend à sa position et décode du son au volume du curseur');
} catch (e) { console.error('  ✗', e.stack); process.exitCode = 1; }
finally { await p.close(); }
console.log('\n' + ok + ' ok, ' + (process.exitCode || 0) + ' ko');

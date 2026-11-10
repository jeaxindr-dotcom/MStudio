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
const {adresse, clic, dans, arret, preuve, attendreSon, attendreDans, message, mesurerClic} = sonDuBac(p);
let ok = 0;
const passe = (titre) => { ok++; console.log('  ✓ ' + titre); };
try {
  await p.goto(url + '#f=900'); await p.until('window.__studio && document.querySelector("#v").readyState >= 2', 120000);
  await clic('srcCode'); await p.until('__studio.state().mode === "code" && window.__preview?.frameReady()', 120000);
  await arret(900); const origine = await adresse();
  await clic('bPlay'); await preuve(); passe('Lecture initiale avec une piste E03 active');

  // Un périphérique refuse la reprise après sa tentative d’ouverture. Le SDK
  // 4.0.541 efface la promesse après son règlement : un rejet immédiat peut
  // précéder l’abonnement de sa boucle de lecture et ne teste alors pas son mute.
  await clic('bPlay'); await attendreDans('!StudioPlayer.isPlaying() && __coulissesAudio[0].state === "suspended"');
  await dans(`const c = __coulissesAudio[0]; window.refus = [];
    c.resume = async () => {
      refus.push(performance.now());
      await new Promise(resolve => setTimeout(resolve, 240));
      throw new DOMException('périphérique', 'InvalidStateError');
    }`);
  await clic('bPlay'); await attendreDans('StudioPlayer.isMuted() && refus.at(-1) - refus[0] >= 900');
  await p.until('/coupé/.test(document.querySelector("#save").textContent)');
  passe('Le Player se met en sourdine et la coupure est annoncée');
  await dans('delete __coulissesAudio[0].resume');
  await attendreSon(); assert.equal(await adresse(), origine);
  passe('La reprise automatique vérifiée conserve le contexte et le document');
  await clic('bPlay'); await attendreDans('!StudioPlayer.isPlaying()'); await clic('bPlay'); await preuve();
  passe('Pause puis Lecture conservent le son');

  // Figer uniquement le fil de l’iframe, sans boucle qui charge un cœur du PC.
  await arret(900); await clic('bPlay'); await preuve();
  await dans(`const c = __coulissesAudio[0]; window.initial = c;
    const pistes = [...document.querySelectorAll('audio')].filter(a => a.currentSrc && !a.currentSrc.startsWith('data:') && !a.muted && !a.paused);
    window.piste = pistes.sort((a,b) => (b.duration - b.currentTime) - (a.duration - a.currentTime))[0];
    if (!piste) throw new Error('piste E03 absente');
    c.resume = async () => { throw new Error('périphérique indisponible'); }; await c.suspend()`);
  await p.frameSend(origine, 'Debugger.enable');
  await p.frameSend(origine, 'Debugger.pause'); await dormir(1500);
  await p.frameSend(origine, 'Debugger.resume'); await p.frameSend(origine, 'Debugger.disable');
  await attendreDans('StudioPlayer.isPlaying() && initial.state === "suspended"');
  // Une balise de la scène s’est aussi arrêtée. Son redémarrage doit respecter
  // les séquences que Remotion garde prémontées ou déjà terminées.
  await dans('piste.pause(); delete initial.resume');
  const enLecture = await mesurerClic('bSound');
  assert.ok(await dans('return __coulissesAudio[0] === initial && !piste.paused'));
  assert.equal(await adresse(), origine); passe('Après gel et perte audio, son sur place en lecture (' + enLecture + ' ms)');

  await arret(900);
  await dans('StudioPlayer.mute()'); await attendreDans('StudioPlayer.isMuted()');
  await clic('bSound'); await p.until('/lecture/i.test(document.querySelector("#save").textContent)');
  assert.doesNotMatch(await message(), /rétabli/i);
  assert.equal(await dans('return StudioPlayer.frame()'), 900); assert.equal(await dans('return StudioPlayer.isPlaying()'), false);
  assert.equal(await adresse(), origine); passe('À l’arrêt, même image et aucune annonce de succès anticipée');
  const aLaReprise = await mesurerClic('bPlay');
  assert.equal(await adresse(), origine); passe('Lecture confirme le son sur place (' + aLaReprise + ' ms)');

  await dans('StudioPlayer.mute()'); await attendreDans('StudioPlayer.isMuted()');
  await p.eval('const r = document.querySelector("#vol"); r.value = "0.6"; r.dispatchEvent(new Event("input"))');
  await attendreDans('!StudioPlayer.isMuted()'); passe('Le curseur de volume réactive le son');

  // Repli sur la scène 3D réelle du bac, qui met nettement plus longtemps à
  // se charger que le projet synthétique. Un seul clic Lecture pendant ce temps.
  await arret(900); await dans('await initial.close()');
  const debut = Date.now(); await clic('bSound');
  await p.until('document.querySelector("iframe.code-next")');
  await clic('bPlay');
  await p.until('!document.querySelector("iframe.code-next")', 120000);
  assert.notEqual(await adresse(), origine, 'la candidate E03 a été abandonnée');
  const adoption = Date.now() - debut;
  await attendreSon();
  passe('Reconstruction E03 à 900, Lecture conservée (adoption en ' + adoption + ' ms, contre-mesure terminée en ' + (Date.now() - debut) + ' ms)');

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

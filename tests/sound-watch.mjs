// Pannes injectées dans le seul Player du bac synthétique. Une promesse retenue
// dans le navigateur permet de cliquer pendant la préparation à chaque passage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as dormir} from 'node:timers/promises';
import {launch, requireSandbox} from './cdp.mjs';
import {makeFixture, RUN} from './coulisses-fixture.mjs';
import {freePort} from './where.mjs';
import {sonDuBac} from './sound-probe.mjs';

const studio = fileURLToPath(new URL('../', import.meta.url)), cache = path.join(studio, '.cache', 'sound-watch');
fs.mkdirSync(cache, {recursive: true});
process.env.STUDIO_PROJECTS = path.join(cache, 'projets.json');
process.env.COULISSES_SETTINGS = path.join(cache, 'settings.json');
fs.writeFileSync(process.env.COULISSES_SETTINGS, '{"lang":"fr"}');
process.env.COULISSES_LANG = 'fr'; process.env.COULISSES_REVIEW_SOUND = '0';
makeFixture({slowScene: 800, seconds: 30});
const {importProject} = await import('../lib/projects.mjs');
const port = await freePort(4260), url = 'http://127.0.0.1:' + port + '/';
const st = spawn(process.execPath, ['studio-server.mjs', '--project', importProject(RUN).revue, '--no-open', '--port', String(port)],
  {cwd: studio, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
let journal = '', p, ok = 0;
st.stdout.on('data', d => journal += d); st.stderr.on('data', d => journal += d);
const passe = (titre) => { ok++; console.log('  ✓ ' + titre); };
try {
  for (let i = 0; i < 160 && !journal.includes('Ouvre : http'); i++) await dormir(250);
  assert.ok(journal.includes('Ouvre : ' + url.slice(0, -1)), journal);
  await requireSandbox(url, RUN);
  p = await launch({port: await freePort(9363)});
  const {adresse, clic, dans, arret, preuve, attendreSon, attendreDans, message} = sonDuBac(p);
  // Installer la barrière AVANT le pont de la page, y compris sur les Chromium
  // qui livrent message à la fenêtre dans l'ordre d'inscription.
  await p.send('Page.addScriptToEvaluateOnNewDocument', {source: `
    window.suiviSon = [];
    window.addEventListener('message', e => {
      const d = e.data;
      if (d?.coulissesPreview && (d.ev && ['sound','play','pause','waiting','resume','ended'].includes(d.ev.type) || d.hello)) {
        suiviSon.push({t: Math.round(performance.now()), ev: d.ev ?? 'hello', candidate: e.source === document.querySelector('.code-next')?.contentWindow});
        if (suiviSon.length > 32) suiviSon.shift();
      }
      if (!window.retenirCandidate || e.source !== document.querySelector('.code-next')?.contentWindow) return;
      if (e.data?.value?.ready !== true) return;
      e.stopImmediatePropagation();
      window.liberer = () => { window.retenirCandidate = false; window.dispatchEvent(new MessageEvent('message', {origin:e.origin, source:e.source, data:e.data})); };
    });`});
  await p.goto(url); await p.until('window.__studio?.state().mode === "code" && window.__preview?.frameReady()', 120000);
  await p.eval('document.querySelector(\'.spd[data-s="0.5"]\').click()');
  await arret(60); const depart = await adresse();
  await dans(`const P = StudioPlayer, c = __coulissesAudio[0];
    window.tampon = {};
    P.on(e => {
      if (e.type === 'waiting') tampon.attente = true;
      if (e.type === 'resume' && tampon.attente && !tampon.fin) {
        tampon.fin = true;
        // Une suspension native tardive, une fois le SDK déjà reparti.
        setTimeout(() => c.suspend().then(() => { tampon.suspendu = performance.now(); }), 180);
      }
    });
    c.addEventListener('statechange', () => {
      if (tampon.suspendu && c.state === 'running') tampon.delai = performance.now() - tampon.suspendu;
    })`);
  await clic('bPlay'); await attendreDans('tampon.suspendu > 0');
  await attendreDans('tampon.delai >= 0', 2000);
  await preuve(); assert.equal(await adresse(), depart);
  passe('Après un vrai tampon et une suspension tardive, reprise dans la même iframe en ' + Math.round(await dans('return tampon.delai')) + ' ms');

  const panne = async (injection, titre) => {
    await arret(5); await clic('bPlay'); await preuve();
    const ancien = await adresse();
    await dans('const c = __coulissesAudio[0]; ' + injection);
    await p.until('/Toujours pas de son/.test(document.querySelector("#save").textContent)', 15000);
    assert.equal(await adresse(), ancien);
    passe(titre + ' annoncé pendant la lecture, même iframe');
    return ancien;
  };
  let ancien = await panne("c.dispatchEvent(new Event('error'))", 'Incident de périphérique');
  let t = Date.now(); await clic('bSound'); await attendreSon();
  assert.equal(await adresse(), ancien); passe('Le périphérique répond au clic, lecture audible sur place (' + (Date.now() - t) + ' ms avec contre-mesure)');

  // Rendre toute reprise impossible dans l'ancien document seulement.
  ancien = await panne("c.resume = () => Promise.reject(new DOMException('périphérique', 'InvalidStateError')); await c.suspend()", 'Refus persistant');
  await clic('bSound'); await p.until('document.querySelector("#code").src !== ' + JSON.stringify(ancien), 30000);
  await attendreSon(); passe('Le refus persistant exige une nouvelle iframe et la lecture reprend seule');

  ancien = await panne("const t = c.currentTime; Object.defineProperty(c, 'currentTime', {get: () => t})", 'Arrêt de l’horloge');
  await clic('bSound'); await p.until('document.querySelector("#code").src !== ' + JSON.stringify(ancien), 30000);
  await attendreSon(); passe('Une horloge figée malgré running exige une nouvelle iframe, vérifiée en lecture');

  ancien = await panne('await c.close()', 'Fermeture du contexte');
  await arret(32);
  // Retenir la réponse à prepare dans la page. La candidate a déjà préparé
  // l'image 32 quand la cible devient 52. Le pont doit valider la dernière cible.
  await p.eval('window.retenirCandidate = true');
  await clic('bSound'); await p.until('window.liberer');
  assert.doesNotMatch(await message(), /rétabli/i);
  await p.eval('location.hash = "f=52"'); await p.until('__preview.frame() === 52');
  await clic('bPlay'); await clic('bSound');
  assert.equal(await adresse(), ancien);
  assert.ok(await p.eval('return !__preview.isPlaying() && document.querySelector("#v").paused && !!document.querySelector(".code-next")'));
  passe('Déplacement et clics Lecture puis Rétablir pendant la préparation, ancien lecteur arrêté');
  const cible = await p.eval('return document.querySelector(".code-next").src');
  await p.eval(`window.preparations = []; window.departs = []; const candidate = document.querySelector('.code-next').contentWindow;
    window.addEventListener('message', e => {
      if (e.source !== candidate) return;
      if (e.data.value?.ready === true) preparations.push(e.data.value.frame);
      if (e.data.ev?.type === 'play') departs.push(e.data.ev.frame);
    });
    liberer()`);
  await p.until('document.querySelector("#code").src !== ' + JSON.stringify(ancien), 30000);
  await attendreSon();
  assert.equal(await adresse(), cible);
  assert.equal(await p.eval('return preparations.at(-1)'), 52);
  assert.equal(await p.eval('return departs[0]'), 52);
  assert.equal(await p.eval('return document.querySelectorAll(\'iframe[src*="player.html"]\').length'), 1);
  passe('Adoption à l’image 52 et son vérifié sur la Lecture mise en attente');
  await arret(40);

  // Si la sortie reste morte dans l'aperçu neuf, aucun « rétabli », ni
  // nouvelle boucle de reconstructions. Une Pause annule la Lecture en attente.
  await dans('await __coulissesAudio[0].close()');
  await p.eval(`delete window.liberer; window.retenirCandidate = true; window.annonces = [];
    new MutationObserver(() => annonces.push(document.querySelector('#save').textContent))
      .observe(document.querySelector('#save'), {childList:true, subtree:true})`);
  await clic('bSound'); await p.until('window.liberer');
  const candidate = await p.eval('return document.querySelector(".code-next").src');
  await p.frameEval(candidate, 'await __coulissesAudio[0].close()');
  await clic('bPlay'); await clic('bPlay');
  await p.eval('liberer()');
  await p.until('document.querySelector("#code").src === ' + JSON.stringify(candidate) + ' && /Toujours pas de son/.test(document.querySelector("#save").textContent)');
  assert.ok(await p.eval('return !__preview.isPlaying() && !annonces.some(t => /rétabli/i.test(t)) && !document.querySelector(".code-next")'));
  passe('Panne persistante dans la nouvelle iframe annoncée, Pause respectée et aucun faux succès');
} catch (e) {
  console.error('  ✗', e.stack, journal.slice(-600));
  if (p) {
    console.error('Événements du pont', JSON.stringify(await p.eval('return window.suiviSon')));
    const {dans, adresse} = sonDuBac(p);
    console.error('Aperçu affiché', await adresse(), await dans(`return {
      image: StudioPlayer.frame(), lecture: StudioPlayer.isPlaying(), muet: StudioPlayer.isMuted(), perte: StudioPlayer.soundLost?.(),
      horloges: __coulissesAudio.map(c => [c.state,c.currentTime]), pistes: [...document.querySelectorAll('audio')].filter(a => a.src && !a.src.startsWith('data:')).map(a => [a.currentTime,a.paused,a.muted,a.readyState])}`));
  }
  process.exitCode = 1;
}
finally { await p?.close(); st.kill(); }
console.log('\n' + ok + ' ok, ' + (process.exitCode || 0) + ' ko');

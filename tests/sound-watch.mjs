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
makeFixture({slowScene: 800});
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
  // Retenir le vrai hello de la candidate dans la page. Les boutons, prepare,
  // messages du Player, adoption et reprise passent par le chemin livré.
  await p.eval(`window.addEventListener('message', function retenir(e) {
    if (!e.data?.hello || e.source !== document.querySelector('.code-next')?.contentWindow) return;
    e.stopImmediatePropagation(); window.removeEventListener('message', retenir, true);
    window.liberer = () => window.dispatchEvent(new MessageEvent('message', {origin:e.origin, source:e.source, data:e.data}));
  }, true)`);
  await clic('bSound'); await p.until('window.liberer');
  assert.doesNotMatch(await message(), /rétabli/i);
  await p.eval('location.hash = "f=52"'); await p.until('__preview.frame() === 52');
  await clic('bPlay'); await clic('bSound');
  assert.equal(await adresse(), ancien);
  assert.ok(await p.eval('return !__preview.isPlaying() && document.querySelector("#v").paused && !!document.querySelector(".code-next")'));
  passe('Déplacement et clics Lecture puis Rétablir pendant la préparation, ancien lecteur arrêté');
  await p.eval(`window.imagesAdoptees = []; const ancien = window.__preview;
    window.addEventListener('message', (e) => { if (!imagesAdoptees.length && window.__preview !== ancien) imagesAdoptees.push(__preview.frame()); }, false);
    liberer()`);
  await p.until('document.querySelector("#code").src !== ' + JSON.stringify(ancien), 30000);
  await attendreSon();
  assert.equal(await p.eval('return imagesAdoptees[0]'), 52);
  assert.equal(await p.eval('return document.querySelectorAll(\'iframe[src*="player.html"]\').length'), 1);
  passe('Adoption à l’image 52 et son vérifié sur la Lecture mise en attente');
  await arret(40);
} catch (e) { console.error('  ✗', e.stack, journal.slice(-600)); process.exitCode = 1; }
finally { await p?.close(); st.kill(); }
console.log('\n' + ok + ' ok, ' + (process.exitCode || 0) + ' ko');

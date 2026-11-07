// Mesures indépendantes de la surveillance de production, dans l'iframe affichée.
import assert from 'node:assert/strict';
import {setTimeout as dormir} from 'node:timers/promises';

export function sonDuBac(p) {
  const adresse = () => p.eval('return document.querySelector("#code").src');
  const dans = async (js) => p.frameEval(await adresse(), js);
  const message = () => p.eval('return document.querySelector("#save").textContent');
  async function clic(id) {
    const xy = await p.eval(`const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]`);
    await p.mouse('mouseMoved', ...xy); await p.mouse('mousePressed', ...xy); await p.mouse('mouseReleased', ...xy);
  }
  async function arret(image) {
    if (await p.eval('return __preview.isPlaying()')) await clic('bPlay');
    await p.eval(`await __preview.prepare(${image})`);
    assert.equal(await dans('return StudioPlayer.isPlaying()'), false);
    assert.equal(await dans('return StudioPlayer.frame()'), image);
  }
  async function preuve() {
    const etat = await dans(`const P = StudioPlayer, c = window.__coulissesAudio[0], t = c.currentTime, w = performance.now();
      const au = [...document.querySelectorAll('audio')].filter(a => a.currentSrc && !a.currentSrc.startsWith('data:'));
      const debut = au.map(a => [a.currentSrc, a.currentTime]);
      let pistes;
      do {
        await new Promise(r => setTimeout(r, 100));
        pistes = au.filter((a, i) => a.currentSrc === debut[i][0] && !a.paused && !a.muted && a.volume > 0 && !a.seeking && a.currentTime > debut[i][1] + 0.025).length;
      } while (performance.now() - w < 2500 && (performance.now() - w < 300 || !pistes));
      return {lecture: P.isPlaying(), muet: P.isMuted(), contexte: c.state, horloge: (c.currentTime - t) * 1000 / (performance.now() - w), pistes}`);
    assert.ok(etat?.lecture && !etat.muet && etat.contexte === 'running' && etat.horloge > 0.5 && etat.pistes > 0, JSON.stringify(etat));
    return etat;
  }
  async function attendreSon(ms = 12000) {
    try { await p.until('/rétabli/i.test(document.querySelector("#save").textContent)', ms); }
    catch (e) { throw new Error('Confirmation sonore absente. Message affiché : ' + await message(), {cause: e}); }
    return preuve();
  }
  async function mesurerClic(id) {
    // Chronométrer du geste reçu à la confirmation affichée ; la lecture des
    // balises par le test est une contre-mesure, extérieure à ce temps.
    await p.eval(`document.getElementById(${JSON.stringify(id)}).addEventListener('click', () => {
      const debut = performance.now(), save = document.querySelector('#save'); window.delaiSon = null;
      const obs = new MutationObserver(() => {
        if (/rétabli/i.test(save.textContent)) { window.delaiSon = Math.round(performance.now() - debut); obs.disconnect(); }
      });
      obs.observe(save, {childList:true, subtree:true});
    }, {once:true, capture:true})`);
    await clic(id); await attendreSon();
    const ms = await p.eval('return window.delaiSon'); assert.ok(Number.isFinite(ms)); return ms;
  }
  async function attendreDans(js, ms = 8000) {
    const fin = Date.now() + ms;
    do { if (await dans('return (' + js + ')')) return; await dormir(80); } while (Date.now() < fin);
    assert.fail('État absent dans l’aperçu : ' + js);
  }
  return {adresse, dans, message, clic, arret, preuve, attendreSon, attendreDans, mesurerClic};
}

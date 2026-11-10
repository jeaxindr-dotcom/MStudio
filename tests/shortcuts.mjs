// The usual shortcuts of the studio (user request, 08/10/2026: « ajouter les raccourcis habituels, ctrl + z etc »), on the
// sample project of tests/coulisses-fixture.mjs (nothing real is touched):
//   Ctrl+Z / Ctrl+Y / Ctrl+Maj+Z on the user's own actions (a note added, written, deleted; a staging offset), one step per
//   burst of typing; Suppr without a question (Ctrl+Z brings the note back); Ctrl+S; Ctrl+Entrée sends the queue, and a
//   batch sent is not taken back; the Édition menu shows the step and its key; the home screen's label.
//   In the text of a note just made with N (still empty), Ctrl+Z is the step back: the note goes, Ctrl+Y brings it back
//   (user request, 08/10/2026); with words typed in the field, Ctrl+Z is the field's own. Aide › Raccourcis clavier (F1):
//   every action and its keys, a key changed (then the studio follows it, the old one does nothing), a key taken from
//   another action, a reserved key refused, everything reset — kept in settings.json for the whole app.
// usage: node tests/shortcuts.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, requireSandbox } from './cdp.mjs';
import { freePort } from './where.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCR = path.join(STUDIO, '.cache', 'shortcuts-test');
fs.rmSync(SCR, { recursive: true, force: true }); fs.mkdirSync(SCR, { recursive: true });
process.env.COULISSES_LANG = 'fr';
process.env.STUDIO_PROJECTS = path.join(SCR, 'projets.json');
process.env.COULISSES_SETTINGS = path.join(SCR, 'settings.json');
process.env.COULISSES_MEDIAS = path.join(SCR, 'medias');
const { makeFixture } = await import('./coulisses-fixture.mjs');
const { importProject } = await import('../lib/projects.mjs');
const I = await import('../lib/i18n.mjs');
const PORT = await freePort(4240);
let U = `http://127.0.0.1:${PORT}`;   // Le port effectivement annoncé est vérifié avant toute interaction.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));   // COULISSES_TEST_SLOW=2: a slower PC
let ok = 0, ko = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };
let st = null, p = null;
const key = (k, mods = {}) => p.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, ctrlKey: ${!!mods.ctrl}, shiftKey: ${!!mods.shift}, bubbles: true, cancelable: true })); return 1`);
// the state, as soon as it is what is expected (at most 6 s × COULISSES_TEST_SLOW): never a bet on a fixed wait
const soon = async (f, ms = 6000) => { const t0 = Date.now(), lim = ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1); for (;;) { const v = await f(); if (v || Date.now() - t0 > lim) return v; await new Promise((r) => setTimeout(r, 80)); } };
const S = () => p.eval(`return { ...__studio.state(), undo: __undo.state(), save: document.querySelector('#save').textContent, n: document.querySelectorAll('#draftList .card').length }`);
try {
  const file = makeFixture(), imp = importProject(file);
  st = spawn(process.execPath, [path.join(STUDIO, 'studio-server.mjs'), '--project', imp.revue, '--no-open', '--port', String(PORT)], { cwd: STUDIO, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; st.stdout.on('data', (d) => { out += d; }); st.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 160 && !/Ouvre : http/.test(out); i++) await sleep(250);
  U = /Ouvre : (http:\/\/127\.0\.0\.1:[0-9]+)/.exec(out)?.[1] ?? U;
  await requireSandbox(U + '/', path.join(STUDIO, '.cache'));
  p = await launch({ port: await freePort(9376) });
  await p.goto(U + '/');
  await p.until(`window.__preview?.durationInFrames`, 60000); await sleep(1200);

  // a note added, then undone, then redone
  await key('n'); await soon(async () => (await S()).drafts === 1); await p.eval(`document.activeElement?.blur?.(); return 1`);
  let s = await S();
  check(s.drafts === 1 && s.undo.back === 1, `N adds a note: one step back (« ${s.undo.top} »)`);
  await key('z', { ctrl: true }); s = await soon(async () => { const x = await S(); return x.drafts === 0 && x; }) || await S();
  check(s.drafts === 0 && s.undo.fwd === 1, 'Ctrl+Z: the note is gone');
  await key('y', { ctrl: true }); s = await soon(async () => { const x = await S(); return x.drafts === 1 && x; }) || await S();
  check(s.drafts === 1 && s.undo.back === 1 && s.undo.fwd === 0 && !!(await p.eval('return document.querySelector("#draftList .card.sel") ? 1 : 0')), 'Ctrl+Y: it is back, selected');
  // typing in the note: one step for the burst
  await p.eval(`const ta = document.querySelector('#draftList .card textarea.main'); ta.focus(); for (const t of ['L', 'Le', 'Le t', 'Le titre', 'Le titre plus haut']) { ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true })); } ta.blur(); return 1`);
  s = await soon(async () => { const x = await S(); return x.undo.back === 2 && x; }, 2500) || await S();
  check(s.undo.back === 2, `typing in the note: one step for the whole burst (${s.undo.back - 1})`);
  await key('z', { ctrl: true, shift: false });
  const mainText = () => p.eval(`return document.querySelector('#draftList .card textarea.main')?.value ?? null`);
  const txt = await soon(async () => ((await mainText()) === '' ? '' : null)) ?? await mainText();
  check(txt === '', `Ctrl+Z takes the words back in one step (« ${txt} »)`);
  await key('z', { ctrl: true, shift: true });
  check(await soon(async () => (await mainText()) === 'Le titre plus haut'), 'Ctrl+Maj+Z puts them back');
  // Suppr: no question, Ctrl+Z brings the note back
  let asked = false;
  await p.eval(`window.__asked = false; window.confirm = () => { window.__asked = true; return true; }; return 1`);
  await key('Delete'); s = await soon(async () => { const x = await S(); return x.drafts === 0 && x; }) || await S();
  asked = await p.eval(`return window.__asked`);
  check(s.drafts === 0 && !asked, 'Suppr deletes the note without a question');
  await key('z', { ctrl: true }); s = await soon(async () => { const x = await S(); return x.drafts === 1 && x; }) || await S();
  check(s.drafts === 1 && await p.eval(`return document.querySelector('#draftList .card textarea.main').value`) === 'Le titre plus haut', 'Ctrl+Z: the note is back, with its words');
  // a note just made with N by mistake: Ctrl+Z in its (still empty) text takes it away, Ctrl+Y brings it back
  await key('n'); await soon(async () => (await S()).drafts === 2 && (await p.eval(`return document.activeElement?.classList?.contains('main') ? 1 : 0`)) === 1);
  const before = (await S()).drafts;
  const inMain = await p.eval(`const ta = document.activeElement; const ok = ta?.classList?.contains('main') ? 1 : 0; ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })); return ok`);
  check(inMain === 1 && before === 2 && await soon(async () => (await S()).drafts === 1), 'a note just made with N, its text still empty: Ctrl+Z (the cursor in its text) takes it away');
  await key('y', { ctrl: true });
  check(await soon(async () => (await S()).drafts === 2), '… and Ctrl+Y brings it back');
  await key('z', { ctrl: true });
  check(await soon(async () => (await S()).drafts === 1), '… and Ctrl+Z again takes it away');
  // the same with the real keys, as the user presses them (N, then Ctrl+Z with the cursor in the new note, then Ctrl+Y)
  await p.eval(`document.activeElement?.blur?.(); return 1`);
  const r0 = (await S()).drafts;
  await p.key('n', 'KeyN', 'n'); await soon(async () => (await S()).drafts === r0 + 1 && (await p.eval(`return document.activeElement?.classList?.contains('main') ? 1 : 0`)) === 1);
  const r1 = (await S()).drafts, focusIn = await p.eval(`return document.activeElement?.classList?.contains('main') && document.activeElement.value === '' ? 1 : 0`);
  await p.key('z', 'KeyZ', undefined, 2); await soon(async () => (await S()).drafts === r0);
  const r2 = (await S()).drafts;
  await p.key('y', 'KeyY', undefined, 2); await soon(async () => (await S()).drafts === r0 + 1);
  const r3 = (await S()).drafts;
  await p.key('z', 'KeyZ', undefined, 2);
  check(r1 === r0 + 1 && focusIn === 1 && r2 === r0 && r3 === r0 + 1 && await soon(async () => (await S()).drafts === r0), `real keys: N (the cursor in the new note), Ctrl+Z takes it away, Ctrl+Y brings it back (${r0} → ${r1} → ${r2} → ${r3})`);
  // Ctrl+X is the usual « cut » again (08/10/2026: « je me suis trompé, Ctrl+Z je voulais dire »): it deletes nothing
  await p.eval(`document.querySelector('#draftList .card').click(); return 1`); await sleep(200);
  await key('x', { ctrl: true }); await sleep(400);
  check((await S()).drafts === 1, 'Ctrl+X deletes no note');
  // in a text field with words typed since it got the focus, Ctrl+Z is the field's own
  await p.eval(`const ta = document.querySelector('#draftList .card textarea.main'); ta.focus(); ta.value = ta.value + ' !'; ta.dispatchEvent(new Event('input', { bubbles: true })); return 1`); await sleep(300);
  const u0 = (await S()).undo;
  const left = await p.eval(`const ta = document.activeElement; const ev = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }); ta.dispatchEvent(ev); return !ev.defaultPrevented && ta === document.activeElement && ta.value.endsWith(' !')`); await sleep(300);
  const u1 = (await S()).undo;
  check(left && (await S()).drafts === 1 && u1.back === u0.back && u1.fwd === u0.fwd, 'with words typed in the field, Ctrl+Z is left to the field');
  await p.eval(`const ta = document.querySelector('#draftList .card textarea.main'); ta.value = 'Le titre plus haut'; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.blur(); return 1`); await sleep(300);
  // Ctrl+S
  await key('s', { ctrl: true }); s = await soon(async () => { const x = await S(); return /^Enregistré \d/.test(x.save) && x; }) || await S();
  const saved = JSON.parse(fs.readFileSync(path.join(imp.revue, 'notes.json'), 'utf8')).notes;
  check(/^Enregistré \d/.test(s.save) && saved.some((n) => n.text === 'Le titre plus haut'), `Ctrl+S saves now (« ${s.save} »)`);
  // in a note, Entrée confirms it and Maj+Entrée starts a new line (user request, 09/10/2026), with the real keys
  { const ta0 = await p.eval(`const ta = document.querySelector('#draftList .card textarea.main'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); return ta.value`);
    await p.key('Enter', 'Enter', '\r', 8); await sleep(200);
    const nl = await p.eval(`const ta = document.activeElement; return ta?.classList?.contains('main') ? ta.value : null`);
    await p.key('Enter', 'Enter', '\r'); await sleep(400);
    const after = await p.eval(`const ta = document.querySelector('#draftList .card textarea.main'); return { v: ta.value, focused: document.activeElement === ta }`);
    check(nl === ta0 + '\n' && after.v === ta0 + '\n' && !after.focused, `in a note, Maj+Entrée starts a new line, Entrée confirms it: the field lets go, no new line (${JSON.stringify(nl)} → ${JSON.stringify(after.v)})`);
    await p.eval(`const ta = document.querySelector('#draftList .card textarea.main'); ta.value = ta.value.replace(/\\n$/, ''); ta.dispatchEvent(new Event('input', { bubbles: true })); ta.blur(); return 1`); await sleep(300); }   // as it was
  // the image's zoom (user request, 09/10/2026): the wheel zooms where the mouse is (the pixel under it stays there),
  // Maj+Z puts the whole image back
  { const at = await p.eval(`const r = document.querySelector('#ov').getBoundingClientRect(); return [r.left + r.width * 0.7, r.top + r.height * 0.4]`);
    const comp = () => p.eval(`const r = document.querySelector('#ov').getBoundingClientRect(), [w, h] = __studio.state().size; return [(${at[0]} - r.left) / r.width * w, (${at[1]} - r.top) / r.height * h]`);
    const c0 = await comp();
    await p.wheel(at[0], at[1], -300); await sleep(300);
    const z = (await S()).vz, c1 = await comp();
    check(z.k > 1.3 && Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) < 1, `the wheel on the image zooms in where the mouse is (×${z.k.toFixed(2)}; the pixel under it: ${c0.map(Math.round)} → ${c1.map(Math.round)})`);
    await p.key('Z', 'KeyZ', 'Z', 8); await sleep(300);
    check((await S()).vz.k === 1 && await p.eval(`return document.querySelector('#media').style.transform === ''`), 'Maj+Z: the whole image again'); }
  // the Édition menu
  const [mx, my] = await p.eval(`const r = document.querySelector('#menubar > button[data-menu=edit]').getBoundingClientRect(); return [r.left + 10, r.top + 8]`);
  await p.mouse('mousePressed', mx, my); await p.mouse('mouseReleased', mx, my); await sleep(300);
  const rows = await p.eval(`return [...document.querySelectorAll('.mb-menu .mb-item')].map((r) => ({ id: r.dataset.id, l: r.querySelector('.l').textContent, k: r.querySelector('.k')?.textContent ?? '', off: r.classList.contains('off') }))`);
  await p.key('Escape', 'Escape'); await sleep(100);
  const u = rows.find((r) => r.id === 'undo'), lot = rows.find((r) => r.id === 'undoLot');
  check(u && !u.off && u.k === 'Ctrl+Z' && /^Annuler /.test(u.l) && lot?.off && rows.some((r) => r.id === 'redo' && r.k === 'Ctrl+Y'), `Édition: « ${u?.l} » ${u?.k}, « Rétablir » Ctrl+Y, then the agent's fixes (« ${lot?.l} »)`);
  // a staging offset: undone, redone
  await p.eval(`window.__preview.seek(45); return 1`); await sleep(800);
  await key('m'); await p.until("document.querySelector('#sceneRequestKeep')", 20000);
  await p.eval("document.querySelector('#sceneRequestKeep').click()");
  await p.until(`__studio.state().staging`, 20000); await sleep(400);
  await p.eval(`window.__preview.stage.select('[data-coulisses="titre s01"]'); return 1`); await sleep(300);
  for (let i = 0; i < 3; i++) { await p.frameEval('player.html', `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); return 1`); await sleep(50); }
  const dx = () => p.eval(`return window.__preview.stage.info('[data-coulisses="titre s01"]').delta.p[0]`);
  const d1 = await soon(async () => ((await dx()) === 3 ? 3 : null)) ?? await dx();
  await sleep(800);   // the three arrows make one step only if Ctrl+Z comes after the burst (0.7 s)
  await key('z', { ctrl: true });
  const d0 = await soon(async () => ((await dx()) === 0 ? 0 : null)) ?? await dx();
  await key('y', { ctrl: true });
  check(d1 === 3 && d0 === 0 && await soon(async () => (await dx()) === 3), `staging: 3 arrows = one step, Ctrl+Z puts the title back (Δx ${d1} → ${d0}), Ctrl+Y moves it again`);
  // inside the preview too, the mode keys are the user's: « Poignées : tourner » set to T (E then does nothing)
  await fetch(U + '/api/shortcuts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shortcuts: { modeRotate: ['T'] } }) });
  await p.eval(`await window.Shortcuts.reload(); return 1`);
  // (the preview, in its own process, has its own copy of the keys: told by the page, it reads them again in a moment)
  for (let i = 0; i < 50 && !(await p.frameEval('player.html', `return window.Shortcuts.keys('modeRotate').includes('T')`)); i++) await sleep(100);
  const inFrame =(k) => p.frameEval('player.html', `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true })); return 1`);
  const rotOn = () => p.eval(`return !!document.querySelector('#scene [data-m=rotate].on')`);
  await inFrame('e'); await sleep(250); const eRot = await rotOn();
  await inFrame('t'); await sleep(250); const tRot = await rotOn();
  await inFrame('w'); await sleep(250);
  check(!eRot && tRot && !(await rotOn()), 'in the preview, the staging keys follow the user\'s: T turns (E no longer), W moves');
  await fetch(U + '/api/shortcuts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shortcuts: {} }) });
  await p.eval(`await window.Shortcuts.reload(); return 1`);
  await key('m'); await sleep(400);
  // Aide › Raccourcis clavier (F1): the list; « Nouvelle note » set to J
  const SET = process.env.COULISSES_SETTINGS;
  const kept = () => { try { return JSON.parse(fs.readFileSync(SET, 'utf8')).shortcuts ?? {}; } catch { return {}; } };
  await key('F1'); await sleep(300);
  fs.mkdirSync(path.join(STUDIO, '.cache', 'shots'), { recursive: true }); await p.shot(path.join(STUDIO, '.cache', 'shots', 'shortcuts-window.png'));
  const rowsOf = () => p.eval(`return [...document.querySelectorAll('.sc-dlg .sc-row')].map((r) => ({ id: r.dataset.id, l: r.querySelector('.sc-l').textContent, k: [...r.querySelectorAll('.sc-key')].map((b) => b.firstChild.textContent) }))`);
  let rows0 = await rowsOf();
  const row = (id) => rows0.find((r) => r.id === id);
  check(rows0.length > 25 && row('undo')?.k.join() === 'Ctrl+Z' && row('redo')?.k.join() === 'Ctrl+Y,Ctrl+Maj+Z' && row('note')?.k.join() === 'N' && row('play')?.k.join() === 'Espace' && row('deleteNote')?.k.join() === 'Suppr,Retour arrière',
    `F1: « Raccourcis clavier », every action and its keys (${rows0.length} actions: Annuler Ctrl+Z, Rétablir Ctrl+Y · Ctrl+Maj+Z, Nouvelle note N…)`);
  await p.eval(`document.querySelector('.sc-row[data-id=note] .sc-key').click(); return 1`); await sleep(100);
  await p.shot(path.join(STUDIO, '.cache', 'shots', 'shortcuts-press.png'));
  check(/Appuie sur la touche pour « Nouvelle note sur l'image »/.test(await p.eval(`return document.querySelector('.sc-msg').textContent`)), 'a click on its key: « Appuie sur la touche… »');
  await key('j'); await soon(async () => JSON.stringify(kept().note) === '["J"]');
  rows0 = await rowsOf();
  check(row('note')?.k.join() === 'J' && JSON.stringify(kept().note) === '["J"]', `J pressed: « Nouvelle note » = J, kept in settings.json (${JSON.stringify(kept())})`);
  // a key of another action: taken from it, said so
  await p.eval(`document.querySelector('.sc-row[data-id=toolComment] .sc-add').click(); return 1`); await sleep(100);
  await key('j'); await soon(async () => /servait à/.test(await p.eval(`return document.querySelector('.sc-msg').textContent`)));
  rows0 = await rowsOf();
  const msg = await p.eval(`return document.querySelector('.sc-msg').textContent`);
  check(row('toolComment')?.k.join() === 'C,J' && row('note')?.k.length === 0 && /servait à « Nouvelle note sur l'image »/.test(msg), `J added to « Commentaire »: taken from « Nouvelle note » (« ${msg} »)`);
  await p.eval(`document.querySelector('.sc-row[data-id=note] .sc-add').click(); return 1`); await sleep(100);
  await key('Escape'); await sleep(200);
  check(await p.eval(`return !!document.querySelector('.sc-dlg')`) && /Rien de changé/.test(await p.eval(`return document.querySelector('.sc-msg').textContent`)), 'Échap while a key is awaited: nothing changes, the window stays');
  await p.eval(`document.querySelector('.sc-row[data-id=note] .sc-add').click(); return 1`); await sleep(100);
  await key('x', { ctrl: true }); await sleep(200);
  check(/Ctrl\+X reste à Coulisses ou au navigateur/.test(await p.eval(`return document.querySelector('.sc-msg').textContent`)), 'Ctrl+X (cut) is refused: it stays with the browser');
  await key('k'); await soon(async () => JSON.stringify(kept().note) === '["K"]');
  await p.eval(`document.querySelector('.sc-row[data-id=toolComment] .sc-reset').click(); return 1`); await soon(async () => JSON.stringify(kept()) === '{"note":["K"]}');
  rows0 = await rowsOf();
  check(row('note')?.k.join() === 'K' && row('toolComment')?.k.join() === 'C' && JSON.stringify(kept()) === '{"note":["K"]}', `↺ puts « Commentaire » back to C; « Nouvelle note » = K (${JSON.stringify(kept())})`);
  await key('Escape'); await sleep(200);
  // the studio follows: K makes a note, N no longer
  const n0 = (await S()).drafts;
  await key('n'); await sleep(400);   // N does nothing now: a short wait, then the count
  const n1 = (await S()).drafts;
  await p.eval(`document.activeElement?.blur?.(); return 1`);
  await key('k'); await soon(async () => (await S()).drafts === n0 + 1); await p.eval(`document.activeElement?.blur?.(); return 1`);
  check(n1 === n0 && (await S()).drafts === n0 + 1, 'the studio follows at once: K makes a note, N does nothing');
  await key('z', { ctrl: true }); await sleep(400);
  // the home screen reads the same keys (one settings.json for the whole app)
  const hubKeys = await (await fetch(U + '/api/shortcuts')).json();
  check(JSON.stringify(hubKeys.shortcuts) === '{"note":["K"]}', 'GET /api/shortcuts: the same keys for the whole app');
  // everything back
  await key('F1'); await sleep(300);
  await p.eval(`[...document.querySelectorAll('.sc-dlg .b button')].find((b) => /Tout remettre/.test(b.textContent)).click(); return 1`); await soon(async () => JSON.stringify(kept()) === '{}');
  rows0 = await rowsOf();
  check(row('note')?.k.join() === 'N' && JSON.stringify(kept()) === '{}', '« Tout remettre par défaut »: N again, settings.json empty of shortcuts');
  await key('Escape'); await sleep(200);
  // Ctrl+Entrée sends the queue; the batch is not taken back
  await key('Enter', { ctrl: true });
  await p.until(`(__studio.state().drafts === 0)`, 120000); await sleep(800); s = await S();
  check(s.drafts === 0 && s.undo.back === 0 && fs.existsSync(path.join(imp.revue, 'lots', '001.md')), 'Ctrl+Entrée sends the queue (lot 001); Ctrl+Z cannot take a batch back');
  // the home screen: one Coulisses for every project
  check(I.t('hub.wherePipeline', {}, 'fr') === 'Version installée · tous tes projets' && !/Brambleshire/.test(I.t('hub.wherePipeline', {}, 'en')), `the home screen's label: « ${I.t('hub.wherePipeline', {}, 'fr')} »`);
} catch (e) {
  check(false, `erreur : ${e.stack ?? e.message}`);
} finally {
  if (p) await p.close();
  if (st) { try { execFileSync('taskkill', ['/PID', String(st.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
}
console.log(`\n${ok} ok, ${ko} ko`);
process.exit(ko ? 1 : 0);

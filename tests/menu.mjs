// The menu bar (menubar.js) of the home screen and of the studio, in French, on the sample project of
// tests/coulisses-fixture.mjs (nothing real is touched): « Fichier · Édition · Outils · Aide », each menu opens with its
// items, greyed items say why, the mouse (click, hover between open menus, click outside) and the keyboard (Alt, F10,
// arrows, Enter, Escape) work, and actions really run: Édition › Préférences… switches the language (kept in a test
// settings file, never the user's), Aide › Raccourcis clavier, Outils › Exporter ▸ lists the export script's variants,
// Outils › Vérifier le projet, Aide › Protocole de l'agent, Outils › Journal, Fichier › Accueil. No Windows dialog is opened.
// usage: node tests/menu.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCR = path.join(STUDIO, '.cache', 'menu-test');
fs.rmSync(SCR, { recursive: true, force: true }); fs.mkdirSync(SCR, { recursive: true });
process.env.COULISSES_LANG = 'fr';   // the fixture and the CLI; the home screen below runs on the test settings file instead
process.env.STUDIO_PROJECTS = path.join(SCR, 'projets.json');
const SETTINGS = path.join(SCR, 'settings.json');
fs.writeFileSync(SETTINGS, JSON.stringify({ lang: 'fr' }));
const { makeFixture } = await import('./coulisses-fixture.mjs');
const { importProject } = await import('../lib/projects.mjs');
const HUB_PORT = 4184, shots = path.join(STUDIO, '.cache', 'shots');
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));   // COULISSES_TEST_SLOW=2: a slower PC
let ok = 0, ko = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };

const imp = importProject(makeFixture());
const hub = spawn(process.execPath, [path.join(STUDIO, 'hub-server.mjs'), '--port', String(HUB_PORT)], { cwd: STUDIO, env: { ...process.env, COULISSES_LANG: '', COULISSES_SETTINGS: SETTINGS }, stdio: ['ignore', 'pipe', 'pipe'] });
let hubOut = ''; hub.stdout.on('data', (d) => { hubOut += d; }); hub.stderr.on('data', (d) => { hubOut += d; });
for (let i = 0; i < 60 && !/HUB_READY/.test(hubOut); i++) await sleep(250);
const H = `http://127.0.0.1:${HUB_PORT}`;
const p = await launch({ port: 9382 });
const until = async (expr, ms = 30000) => { const t0 = Date.now(); for (;;) { try { if (await p.eval(`return !!(${expr})`)) return true; } catch { /* navigating */ } if (Date.now() - t0 > ms) throw new Error(`timeout: ${expr}`); await sleep(150); } };
const ev = (e) => p.eval(e).catch(() => null);
const bar = () => ev(`return [...document.querySelectorAll('#menubar > button')].map((b) => b.textContent).join(' · ')`);
const state = () => ev(`return MenuBar.state()`);
const btnAt = (menu) => ev(`const r = document.querySelector('#menubar > button[data-menu=${menu}]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]`);
const click = async ([x, y]) => { await p.mouse('mousePressed', x, y); await p.mouse('mouseReleased', x, y); await sleep(150); };
// the rows of the open menus: { id, label, key, off, why, sub }
const rows = (level = 0) => ev(`const m = document.querySelectorAll('.mb-menu')[${level}]; return m ? [...m.querySelectorAll('.mb-item')].map((r) => ({ id: r.dataset.id, label: r.querySelector('.l').textContent, key: r.querySelector('.k')?.textContent ?? '', off: r.classList.contains('off'), why: r.title, sub: !!r.querySelector('.s') })) : null`);
const open = async (menu) => { await click(await btnAt(menu)); return rows(); };
const run = async (menu, id) => { await open(menu); await p.eval(`document.querySelector('.mb-item[data-id="${id}"]').click(); return 1`); await sleep(400); };
const escape = async (n = 1) => { for (let i = 0; i < n; i++) { await p.key('Escape', 'Escape'); await sleep(60); } };
const has = (list, id, test = () => true) => { const r = list?.find((x) => x.id === id); return !!r && test(r); };
try {
  // ---------- the home screen ----------
  await p.goto(H + '/');
  await until(`document.querySelector('#menubar > button') && document.querySelectorAll('.card[data-id]').length >= 2`, 20000);
  check((await bar()) === 'Fichier · Édition · Outils · Aide', `home screen: the menu bar « ${await bar()} », above the header`);
  check(await ev(`const m = document.querySelector('#menubar').getBoundingClientRect(), h = document.querySelector('header').getBoundingClientRect(); return m.top === 0 && m.height >= 26 && m.height <= 30 && h.top >= m.bottom`), 'the bar is at the very top, about 28 px high');
  const f = await open('file');
  check(has(f, 'home', (r) => r.off && /déjà sur l'accueil/.test(r.why)) && has(f, 'open', (r) => !r.off && r.label === 'Ouvrir un projet…' && r.key === 'Ctrl+O') && has(f, 'importFolder') && has(f, 'importVideo', (r) => r.label === 'Importer une vidéo…') && has(f, 'pastePath')
    && has(f, 'revealFolder', (r) => r.off && /Dans un studio seulement/.test(r.why)), 'Fichier: Ouvrir un projet… (Ctrl+O), Importer…, the studio-only items greyed with why');
  // hovering moves between the open menus
  await p.mouse('mouseMoved', ...(await btnAt('edit'))); await sleep(150);
  const e = await rows();
  check((await state()).open === 1 && has(e, 'prefs', (r) => !r.off && r.label === 'Préférences…') && has(e, 'undo', (r) => r.off), 'hover: « Édition » opens in place of « Fichier » (Préférences…, Annuler greyed)');
  await p.mouse('mouseMoved', ...(await btnAt('tools'))); await sleep(150);
  const t = await rows();
  check(has(t, 'log', (r) => r.sub && !r.off) && ['staging', 'source', 'export', 'stopExport'].every((id) => has(t, id, (r) => r.off)) && !has(t, 'render'), 'Outils: Journal ▸, the studio tools greyed (the same entries as in the studio)');
  await p.mouse('mouseMoved', ...(await btnAt('help'))); await sleep(150);
  const h = await rows();
  check(has(h, 'shortcuts', (r) => r.key === 'F1') && has(h, 'agentDoc', (r) => r.label === 'Protocole de l\'agent') && has(h, 'contract', (r) => r.label === 'Contrat des pipelines') && has(h, 'online') && has(h, 'about', (r) => r.label === 'À propos de Coulisses'), 'Aide: Raccourcis clavier (F1), Protocole de l\'agent, Contrat des pipelines, Documentation en ligne, À propos');
  await p.mouse('mousePressed', 800, 600); await p.mouse('mouseReleased', 800, 600); await sleep(150);
  check(!(await ev(`return document.querySelector('.mb-menu')`)) && (await state()).open === -1, 'a click outside closes the menu');
  // the keyboard: Alt alone, F10, arrows, Enter, Escape
  await p.eval(`document.activeElement?.blur?.(); return 1`);
  await p.key('Alt', 'AltLeft'); await sleep(100);
  check((await state()).focus && (await state()).cur === 0, 'Alt alone: the bar takes the focus (« Fichier »)');
  await p.key('ArrowRight', 'ArrowRight'); await p.key('ArrowDown', 'ArrowDown'); await sleep(120);
  const cur1 = await ev(`return document.querySelector('.mb-menu .mb-item.cur')?.dataset.id`);
  check((await state()).open === 1 && cur1 === 'prefs', `→ then ↓: « Édition » opens on its first item that can be used (${cur1})`);
  await escape(); check((await state()).focus && (await state()).open === -1, 'Escape: the menu closes, the bar keeps the focus');
  await escape(); check(!(await state()).focus, 'Escape again: the bar lets go');
  await p.key('F10', 'F10'); await p.key('ArrowLeft', 'ArrowLeft'); await sleep(80);
  check((await state()).focus && (await state()).cur === 3, 'F10 then ←: the bar, on « Aide »');
  // ↓ opens « Aide » on its first item: Raccourcis clavier, here too (the keys are the same for the whole app)
  await p.key('ArrowDown', 'ArrowDown'); await sleep(80); await p.key('Enter', 'Enter'); await sleep(600);
  check(await ev(`const d = document.querySelector('.mb-dlg.sc-dlg'); return !!d && d.querySelectorAll('.sc-row').length > 20`), '↓ Enter: Aide › Raccourcis clavier, on the home screen too');
  await escape(); await p.key('F10', 'F10'); await p.key('ArrowLeft', 'ArrowLeft'); await sleep(80);
  await p.key('ArrowDown', 'ArrowDown'); await sleep(80); await p.key('ArrowDown', 'ArrowDown'); await sleep(80); await p.key('Enter', 'Enter'); await sleep(600);
  check(/# MStudio : protocole de l'agent/.test(await ev(`return document.querySelector('.mb-dlg .body')?.textContent ?? ''`)), '↓ ↓ Enter: Aide › Protocole de l\'agent (the separator skipped), in French (AGENT.md)');
  await escape(); check(!(await ev(`return document.querySelector('.mb-dlg')`)), 'Escape closes the window');
  await run('tools', 'log'); await sleep(150);
  check((await rows(1))?.[0]?.label === 'Journal de l\'accueil', 'Outils › Journal ▸ « Journal de l\'accueil »');
  await p.eval(`document.querySelectorAll('.mb-menu')[1].querySelector('.mb-item').click(); return 1`); await sleep(500);
  check(/accueil prêt/.test(await ev(`return document.querySelector('.mb-dlg .body')?.textContent ?? ''`)), '… shows the home screen\'s log');
  await escape();
  await run('file', 'pastePath');
  check(await ev(`return document.querySelector('.imp').classList.contains('pasting') && document.activeElement?.id === 'impPath'`), 'Fichier › Coller un chemin…: the path field, focused');
  await run('help', 'about');
  check(/MIT/.test(await ev(`return document.querySelector('.mb-dlg').innerText`)) && /github\.com\/jeaxindr-dotcom\/MStudio/.test(await ev(`return document.querySelector('.mb-dlg').innerText`)), 'Aide › À propos de Coulisses: the version, MIT, the GitHub link');
  await p.shot(path.join(shots, 'menu-1-about.png'));
  await escape();
  // Édition › Préférences… : the language, kept in the (test) settings file
  await run('edit', 'prefs');
  check(/Langue · Language/.test(await ev(`return document.querySelector('.mb-dlg').innerText`)) && (await ev(`return document.querySelector('.mb-dlg [data-l=fr]').classList.contains('on')`)), 'Édition › Préférences…: « Langue · Language », Français chosen');
  await p.eval(`document.querySelector('.mb-dlg [data-l=en]').click(); return 1`);
  await until(`document.documentElement.lang === 'en' && document.querySelector('#menubar > button')`, 15000).catch(() => {});
  check((await bar()) === 'File · Edit · Tools · Help' && JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).lang === 'en', 'English chosen: the page comes back in English (« File · Edit · Tools · Help »), kept in settings.json');
  await run('edit', 'prefs');
  await p.eval(`document.querySelector('.mb-dlg [data-l=fr]').click(); return 1`);
  await until(`document.documentElement.lang === 'fr' && document.querySelector('#menubar > button')`, 15000).catch(() => {});
  check((await bar()) === 'Fichier · Édition · Outils · Aide' && JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).lang === 'fr', '… and back to French');

  // ---------- the studio of a Remotion run ----------
  await p.goto(`${H}/go/${imp.id}`);
  await until(`location.port !== '${HUB_PORT}' && window.__studio && __studio.state().mode === 'code' && document.querySelector('#menubar > button')`, 120000);
  await sleep(800);
  check((await bar()) === 'Fichier · Édition · Outils · Aide' && await ev(`return document.querySelector('#menubar').getBoundingClientRect().bottom <= document.querySelector('header').getBoundingClientRect().top + 1`), 'studio: the same bar, above the header');
  const sf = await open('file');
  check(has(sf, 'revealVideo', (r) => r.off && /Pas encore de vidéo/.test(r.why)), 'Fichier › Afficher la vidéo dans l\'Explorateur: greyed while the run has no video yet (« Pas encore de vidéo… »)');
  check(has(sf, 'home', (r) => !r.off) && has(sf, 'revealFolder', (r) => !r.off) && has(sf, 'revealCoulisses', (r) => !r.off) && has(sf, 'close', (r) => !r.off), 'Fichier: Accueil, Ouvrir le dossier du projet, Afficher le fichier .coulisses, Fermer le studio — all usable here');
  await p.mouse('mouseMoved', ...(await btnAt('edit'))); await sleep(150);
  const se = await rows();
  check(has(se, 'undo', (r) => r.off && /Rien à annuler/.test(r.why) && r.key === 'Ctrl+Z') && has(se, 'undoLot', (r) => r.off && /Aucune correction à annuler/.test(r.why)) && has(se, 'copyLine', (r) => r.off && /Aucun lot/.test(r.why)) && has(se, 'copyConnect', (r) => !r.off), 'Édition: Annuler greyed (« Aucune correction à annuler… »), Copier la ligne greyed (no batch yet), Copier la ligne de connexion');
  await p.mouse('mouseMoved', ...(await btnAt('tools'))); await sleep(150);
  const st = await rows();
  check(has(st, 'connect') && has(st, 'send', (r) => r.off && /Aucune modif en attente/.test(r.why)) && has(st, 'staging', (r) => !r.off) && !has(st, 'render') && has(st, 'source', (r) => r.off) && has(st, 'export', (r) => r.sub && !r.off) && has(st, 'stopExport', (r) => r.off && /Aucun export en cours/.test(r.why)),
    'Outils (a Remotion run): Envoyer greyed, Mise en scène, Exporter ▸, Arrêter l\'export greyed');
  const ex = await ev(`const r = document.querySelector('.mb-item[data-id=export]').getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2]`);
  await p.mouse('mouseMoved', ex[0], ex[1]); await sleep(250);
  const variants = (await rows(1))?.map((r) => r.label);
  check(variants?.join(' | ') === 'Lancer le rendu en 1080p | Lancer le rendu en 4K | Rendu test (30 images) | Remplacer (même nom)', `Outils › Rendu ▸: 1080p, 4K (the same in every project), then the script's own variants (${variants?.join(', ')})`);
  await p.shot(path.join(shots, 'menu-2-export.png'));
  await escape(3);
  await run('help', 'shortcuts');
  check(await ev(`const d = document.querySelector('.mb-dlg.sc-dlg'); return !!d && /Raccourcis clavier/.test(d.querySelector('h2').textContent) && d.querySelectorAll('.sc-row').length > 20`), 'Aide › Raccourcis clavier opens the window of the shortcuts');
  await escape();
  await p.key('F1', 'F1'); await sleep(150);
  check(await ev(`return !!document.querySelector('.mb-dlg.sc-dlg')`), 'F1 opens it too');
  await escape();
  await run('edit', 'copyConnect'); await sleep(300);
  check(/^Copié/.test(await ev(`return document.querySelector('#save').textContent`)), 'Édition › Copier la ligne de connexion: « Copié »');
  await run('tools', 'verify');
  await until(`/PROJET CONFORME/.test(document.querySelector('.mb-dlg .body')?.textContent ?? '')`, 90000).catch(() => {});
  check(/PROJET CONFORME : Coulisses peut l'ouvrir/.test(await ev(`return document.querySelector('.mb-dlg .body').textContent`)), 'Outils › Vérifier le projet: « PROJET CONFORME : Coulisses peut l\'ouvrir… »');
  await escape();
  await run('help', 'contract');
  check(/# Intégrer un projet Remotion dans MStudio/.test(await ev(`return document.querySelector('.mb-dlg .body')?.textContent ?? ''`)), 'Aide › Contrat des pipelines : le guide MStudio en français');
  await escape();
  // the page's own shortcuts wait while the bar has the keyboard
  const f0 = await ev(`return __studio.state().frame`);
  await p.key('F10', 'F10'); await p.key('ArrowDown', 'ArrowDown'); await p.key('ArrowDown', 'ArrowDown'); await sleep(100);
  check((await ev(`return __studio.state().frame`)) === f0 && (await state()).depth === 1, 'while a menu has the keyboard, ↓ moves in it and not in the video');
  await escape(2);
  // « Accueil » (user report 17/10/2026: « il faudrait que ce soit quasi instantané »): the home screen over the studio, at
  // once (loaded beforehand, in a frame of its own: another origin, reached here by the mouse only); the project open here,
  // chosen there: the studio again, at once; « Revenir au studio » and Échap too
  const studioPort = await ev(`return location.port`);
  // where the home screen puts its buttons, at this window's size: the same page in a tab of its own
  const q = await launch({ port: 9383 });
  let at = null;
  try {
    await q.goto(`${H}/`); await q.until(`document.querySelector('.card[data-id="${imp.id}"] button.open')`, 20000);
    at = await q.eval(`document.querySelector('#backStudio').hidden = false; const c = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
      return { back: c('#backStudio'), title: c('header h1'), open: c('.card[data-id="${imp.id}"] button.open') }`);
  } finally { await q.close(); }
  const click = async ([x, y]) => { await p.mouse('mousePressed', x, y); await p.mouse('mouseReleased', x, y); };
  await until(`document.querySelector('#hubOv')`, 20000).catch(() => {});   // (loaded beforehand, 8 s after the studio opened)
  const t0 = Date.now();
  await run('file', 'home');
  const shownMs = Date.now() - t0;
  const ov = await ev(`const f = document.querySelector('#hubOv.on'); return f ? { port: new URL(f.src).port, w: f.getBoundingClientRect().width } : null`);
  check(ov?.port === String(HUB_PORT) && ov.w > 500 && (await ev(`return location.port`)) === studioPort, `Fichier › Accueil: the home screen over the studio, at once (${shownMs} ms, the studio behind it)`);
  await sleep(800);
  await click(at.back); await sleep(500);
  check(!(await ev(`return !!document.querySelector('#hubOv.on')`)) && (await ev(`return location.port`)) === studioPort, '« Revenir au studio »: the studio again, as it was');
  await run('file', 'home'); await sleep(800);
  await click(at.title); await sleep(200);   // (the keyboard to the home screen)
  await p.key('Escape', 'Escape'); await sleep(500);
  check(!(await ev(`return !!document.querySelector('#hubOv.on')`)), 'Échap in the home screen: back to the studio');
  await run('file', 'home'); await sleep(800);
  await click(at.open);
  await until(`!document.querySelector('#hubOv.on')`, 15000).catch(() => {});
  check(!(await ev(`return !!document.querySelector('#hubOv.on')`)) && (await ev(`return location.port`)) === studioPort, 'the project open here, chosen on the home screen: the studio again, at once (not opened again)');
} catch (e) { ko++; console.log('  ✗ ERREUR', e.stack); } finally {
  const errs = p.logs.filter((l) => /exception|\[error\]/.test(l) && !/WebGL|X4000|503|404|Failed to load resource/.test(l));
  if (errs.length) console.log('page errors:\n' + errs.slice(0, 6).join('\n'));
  await p.close();
  await fetch(H + '/api/quit', { method: 'POST' }).catch(() => {}); await sleep(600);
  try { execFileSync('taskkill', ['/PID', String(hub.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
  console.log(`\n${ok} ok, ${ko} échec(s)`);
  process.exit(ko ? 1 : 0);
}

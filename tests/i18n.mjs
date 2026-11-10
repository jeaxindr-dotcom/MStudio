// Coulisses in English (lib/i18n.mjs), end to end, on the sample project of tests/coulisses-fixture.mjs and the sandbox E03
// (nothing real is touched, and the user's own settings.json is never read nor written: COULISSES_LANG / COULISSES_SETTINGS):
//   1. the dictionaries: the same keys in French and English, the same values, no French left in the English texts;
//   2. how the language is chosen: COULISSES_LANG, then settings.json, then Windows (the servers and Coulisses.exe);
//   3. a batch's request (.md) and the lines to paste, in English, for every kind of project;
//   4. the command line in English (projet verifier, take / reply / done / status), its machine markers unchanged;
//   5. the home screen and the studio in English: key texts, the menu bar, and no visible French text on the main screens
//      (every tab, the help, the menus, the dialogs) — the user's own data (notes, replies) excepted;
//   6. the language switch of the home screen, kept in the settings file.
// usage: node tests/i18n.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, requireSandbox } from './cdp.mjs';
import { engineCopyFlags, freePort } from './where.mjs';
import { waitForRenderIdle } from '../lib/render-activity.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX = path.resolve(process.env.STUDIO_SANDBOX ?? path.join(STUDIO, 'sandbox', '07_Episodes'));
const SCR = path.join(STUDIO, '.cache', 'i18n-test');
fs.rmSync(SCR, { recursive: true, force: true }); fs.mkdirSync(SCR, { recursive: true });
process.env.COULISSES_LANG = 'en';
process.env.STUDIO_PROJECTS = path.join(SCR, 'projets.json');   // the test's own list of imported projects
process.env.COULISSES_SETTINGS = path.join(SCR, 'settings.json');   // never the user's file
const { makeFixture, RUN } = await import('./coulisses-fixture.mjs');
const I = await import('../lib/i18n.mjs');
const { lotMarkdown, renderMarkdown, pasteLine, renderLine, connectLine } = await import('../lib/lots.mjs');
const { importProject } = await import('../lib/projects.mjs');
const FR = I.DICTS.fr, EN = I.DICTS.en;
// Ports propres au test, hors des ports réservés ; le port réellement pris est
// toujours relu dans « HUB_READY http://127.0.0.1:<port>/ ».
let HUB_PORT = await freePort(4240);
const episodeFlags = ['--episodes', SANDBOX, ...engineCopyFlags()];
const hubPort = (out) => +(/HUB_READY http:\/\/127\.0\.0\.1:(\d+)/.exec(out)?.[1] ?? HUB_PORT);
const CLI = path.join(STUDIO, 'studio-cli.mjs'), ST_PORT = await freePort(HUB_PORT + 2), shots = path.join(STUDIO, '.cache', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (+(process.env.COULISSES_TEST_SLOW ?? 1) || 1)));   // COULISSES_TEST_SLOW=2: a slower PC
let ok = 0, ko = 0, skipped = 0;
const check = (c, w) => { c ? ok++ : ko++; console.log(`  ${c ? '✓' : '✗'} ${w}`); };
const cli = (...a) => { const r = spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8', env: process.env }); return { code: r.status, out: (r.stdout + r.stderr).trim() }; };
fs.mkdirSync(shots, { recursive: true });

// what looks French in a text: accents, or French words. Names and the machine markers are allowed.
const ALLOWED = [/Vidéo du monde/g, /L'AItelier/g, /Théatre/g, /Langue · Language/g, /Français/g, /宇宙ちゃん/g, /PROJET (NON )?CONFORME/g, /LOT \d+ REÇU/g, /DEMANDE DE RENDU \(lot \d+\) REÇUE/g,
  /RENDU (TERMINÉ|ARRÊTÉ|NON LANCÉ|EN ÉCHEC|FAIT \(sans finition\))/g, /CONTRÔLES PASSÉS/g, /Récap IA de la semaine/g, /Présentateur/g, /présentateur/g, /\bdossier\b|\btitre\b|\bchaine\b|\bprojet\b|\bmoteur\b|\bpistes?\b|\bnom\b|\bfichier\b|\bdebut\b|--depuis|--rapide|--qualite|creer|verifier/g,
  /revue\\?/g, /avant|apres/g, /coulisses-rendu|coulisses-verification/g];
const FRENCH = /[éèêàùçôîâûœ«»]|\b(le|la|les|des|une|du|et|pour|dans|sur|pas|avec|depuis|aucun|aucune|est|sont|ou|toi|ton|tes|mise|rendu|lot|modifs?|envoyer|corrige[rz]?|vidéo|chargement|préparation|en cours|à)\b/i;
const frenchIn = (s) => { let x = String(s).replace(/\{\w+(?:\|[^{}|]*\|[^{}]*)?\}/g, ''); for (const a of ALLOWED) x = x.replace(a, ''); const m = FRENCH.exec(x); return m ? x.slice(Math.max(0, m.index - 30), m.index + 40) : null; };

let hub = null, st = null, fixtureStudio = null, p = null;
const kill = (c) => { if (c) try { execFileSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
await waitForRenderIdle();
try {
  // ---------- 1. the dictionaries ----------
  console.log('dictionaries');
  const keysOf = (f) => [...fs.readFileSync(path.join(STUDIO, 'lib', f), 'utf8').matchAll(/^\s*'([\w.-]+)':/gm)].map((m) => m[1]);
  const kf = keysOf('i18n-fr.mjs'), ke = keysOf('i18n-en.mjs'), dup = (k) => k.filter((x, i) => k.indexOf(x) !== i);
  check(!dup(kf).length && !dup(ke).length, `no key twice (${kf.length} French, ${ke.length} English)`);
  check(kf.every((k) => k in EN) && ke.every((k) => k in FR), 'the same keys in both languages');
  const names = (s) => [...new Set([...String(s).matchAll(/\{(\w+)(?:\|[^{}|]*\|[^{}]*)?\}/g)].map((m) => m[1]))].sort().join(',');
  const diff = kf.filter((k) => names(FR[k]) !== names(EN[k]).split(',').filter((n) => n !== 'gloss').join(','));
  check(!diff.length, `the same values in every text${diff.length ? ` (differ: ${diff.slice(0, 5).join(', ')})` : ''}`);
  const fr = ke.map((k) => [k, frenchIn(EN[k])]).filter(([, x]) => x);
  check(!fr.length, `no French left in the English texts${fr.length ? `: ${fr.slice(0, 6).map(([k, x]) => `${k} «${x}»`).join(' · ')}` : ''}`);
  check(I.t('lot.paste', { who: 'Coulisses · E03', lot: 3, n: 4, md: 'x.md', doc: 'A.md' }, 'en') === 'Coulisses · E03 · batch 3 (4 edits) → read "x.md" and fix (protocol: "A.md")'
    && I.t('lot.paste', { who: 'Coulisses · E03', lot: 3, n: 1, md: 'x.md', doc: 'A.md' }, 'en').includes('(1 edit)') && I.t('lot.paste', { who: 'w', lot: 1, n: 0, md: 'm', doc: 'd' }, 'fr').includes('(0 modif)')
    && I.t('lot.paste', { who: 'w', lot: 1, n: 2, md: 'm', doc: 'd' }, 'fr').includes('(2 modifs)'), 'values and plurals: « 1 edit » / « 4 edits », « 0 modif » / « 2 modifs »');

  // ---------- 2. how the language is chosen ----------
  console.log('choosing the language');
  const SET = path.join(SCR, 'choice.json');
  const langWith = (env) => spawnSync(process.execPath, ['--input-type=module', '-e', `import { lang, langSource } from ${JSON.stringify(pathToFileURL(path.join(STUDIO, 'lib', 'i18n.mjs')).href)}; console.log(lang() + ' ' + langSource());`],
    { encoding: 'utf8', env: { ...process.env, COULISSES_LANG: '', COULISSES_SETTINGS: SET, ...env } }).stdout.trim();
  fs.rmSync(SET, { force: true });
  const sys = langWith({});
  check(/^(fr|en) system$/.test(sys), `with no choice: the Windows display language (${sys})`);
  fs.writeFileSync(SET, JSON.stringify({ lang: 'en' }));
  check(langWith({}) === 'en settings', 'the choice kept in settings.json wins over Windows');
  check(langWith({ COULISSES_LANG: 'fr' }) === 'fr env', 'COULISSES_LANG wins over the settings file');
  const exe = path.join(STUDIO, 'Coulisses.exe'), out = path.join(SCR, 'lang.txt');
  const exeLang = (env) => { fs.rmSync(out, { force: true }); spawnSync(exe, ['--lang', out], { env: { ...process.env, COULISSES_LANG: '', COULISSES_SETTINGS: SET, ...env }, timeout: 20000 }); return fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '?'; };
  if (fs.existsSync(exe)) {
    check(exeLang({}) === 'en' && exeLang({ COULISSES_LANG: 'fr' }) === 'fr', 'Coulisses.exe (its dialogs, and the installer\'s) follows the same choice');
    fs.rmSync(SET, { force: true });
    check(exeLang({}) === sys.split(' ')[0], `… and the same Windows language when nothing is chosen (${exeLang({})})`);
  } else {
    skipped += 2;
    console.log('  (sautés : 2 contrôles de Coulisses.exe ; binaire absent de ce worktree, aucune installation utilisée)');
  }

  // ---------- 3. a batch and the lines to paste ----------
  console.log('the batch and the lines to paste');
  const edits = [{ k: 1, id: 'n1', frame: 120, end: null, time: 4, endTime: null, text: 'The title comes in too fast', thread: [{ text: 'and the bar too' }], context: { scene: 'Hanging Gardens (arriving)', lines: ['L1 Hazel: Hi'], clips: ['V1 shots: plan s01 · f.mp4, frame 62 of the clip'] },
    mark: { kind: 'pin', points: [[560, 620]] }, target: { frame: 120, hits: [{ names: ['Stage › Actor[key="hazel"]'], textures: ['characters/hazel/a.png'], type: 'Mesh', count: 3 }] }, source: 'code', staleRender: true,
    images: [{ file: 'C:\\r\\images\\a.png', label: 'after the move' }], captures: { image: 'C:\\l\\1-image.jpg', marque: 'C:\\l\\1-marque.jpg', zoom: 'C:\\l\\1-zoom.jpg', zoomRect: { x: 1, y: 2, width: 3, height: 4 }, fin: 'C:\\l\\1-fin.jpg' },
    stage: { id: 'Stage › Piece[key="lib-4-set_ladder"]', name: 'ladder', kind: 'set', delta: { p: [0.2, 0, 0], r: [0, 0.1, 0], s: 1.2 }, base: { p: [1, 2, 3], r: [0, 0, 0], s: 1 }, scope: { label: 'the scene "library"', from: 1, to: 9 }, frame: 120 } },
  { k: 2, id: 'n2', frame: 300, end: 360, time: 10, endTime: 12, text: '', thread: [], context: null, mark: { kind: 'circle', points: [[10, 10], [900, 700]], strokes: [[[10, 10]], [[900, 700]]] }, target: null, source: 'video', staleRender: false, images: [], captures: { error: 'capture failed: x' }, stage: null }];
  const upd = { at: 'x', agent: { id: 'codex', name: 'Codex', skills: 'C:\\c' }, errors: ['npm: down'], remotion: { installed: '4.0.1', latest: '4.0.9', outdated: true }, skills: { checked: 3, updates: [{ name: 'hf', repo: 'h/f', why: 'new' }], unknown: ['u'], stale: ['s'] },
    projectSkill: { name: 'brambleshire-theatre', present: false, reference: 'C:\\ref' }, remotionSkills: { installed: false, available: ['remotion-upgrade'] }, todo: true };
  const L = { lot: 3, sentAt: '2026-10-08T10:11:12Z', words: 'thanks', fps: 30, size: [1920, 1080], render: { name: 'E03.mp4', size: 1, mtime: '2026-10-07T09:00:00Z' }, updates: upd, edits };
  const P = (kind) => ({ kind, ep: kind === 'brambleshire' ? 'E03' : 'P1234abcd', title: 'The Secret Garden', target: 'E03', EP: 'C:\\ep', REVUE: 'C:\\ep\\revue', LOTS: 'C:\\ep\\revue\\lots', remotionDir: 'C:\\rem', remotion: { composition: 'C-1' }, coulisses: 'C:\\x.coulisses', pickVideo: () => 'C:\\ep\\E03.mp4' });
  let mdFrench = [];
  for (const kind of ['brambleshire', 'remotion', 'aitelier', 'video']) {
    const md = lotMarkdown(P(kind), L, 'en'), bad = md.split('\n').map((l) => frenchIn(l)).filter(Boolean);
    if (bad.length) mdFrench.push(`${kind}: «${bad[0]}»`);
    if (kind === 'brambleshire') check(/^# Coulisses · E03 "The Secret Garden" · batch 3 · 2 edit\(s\)$/m.test(md) && /## To do \(in this order\)/.test(md) && /## Edit 1 · note `n1` · frame 120/.test(md)
      && /- Gesture: the user pointed at \(560, 620\)/.test(md) && /\*\*Staging proposed by the user\*\*/.test(md) && /Δx 0\.200/.test(md) && /AGENT\.en\.md/.test(md) && /## Updates \(checked when sent\)/.test(md), 'the batch request (.md) of an episode, in English');
  }
  check(!mdFrench.length, `no French in the batch requests (episode, Remotion run, AItelier run, video)${mdFrench.length ? `: ${mdFrench.join(' · ')}` : ''}`);
  const rmd = renderMarkdown(P('brambleshire'), { lot: 4, sentAt: L.sentAt, words: '', render: L.render, updates: null, engine: [], since: [{ lot: 1, edits: 1, status: 'done', message: '', files: [] }, { lot: 2, edits: 2, status: 'taken', message: '', files: [] }] }, 'en');
  check(/full RENDER request/.test(rmd) && /- Batch 1 \(1 edit\): fixed/.test(rmd) && /- Batch 2 \(2 edits\): \*\*still in progress/.test(rmd) && !rmd.split('\n').some((l) => frenchIn(l)), 'the render request (.md), in English');
  const ep = P('brambleshire');
  check(/^Coulisses · E03 · batch 3 \(4 edits\) → read ".*003\.md" and fix \(protocol: ".*AGENT\.en\.md"\)$/.test(pasteLine(ep, 3, 4, 'en'))
    && /^Coulisses · E03 · render \(batch 5\) → read ".*005\.md" and run the full render \(protocol: ".*AGENT\.en\.md"\)$/.test(renderLine(ep, 5, 'en'))
    && /^Coulisses · E03 · connect → read ".*AGENT\.en\.md" then watch what I send: node ".*studio-cli\.mjs" wait E03 \(in the background\)$/.test(connectLine(ep, 'en')), 'the lines to paste keep their structure: « Coulisses · E03 · batch 3 (4 edits) → read "…" and fix »');
  check(/^Coulisses · E03 · lot 3 \(4 modifs\) → lis ".*003\.md" et corrige \(protocole : ".*AGENT\.md"\)$/.test(pasteLine(ep, 3, 4, 'fr')), '… and stay as they were in French (AGENT.md)');
  check(fs.existsSync(path.join(STUDIO, 'AGENT.en.md')) && fs.existsSync(path.join(STUDIO, 'docs', 'COULISSES-REMOTION-CONTRACT.md')), 'the English protocol and contract exist (AGENT.en.md, docs\\COULISSES-REMOTION-CONTRACT.md)');

  // ---------- 4. the command line ----------
  console.log('the command line');
  const FILE = makeFixture(), REVUE = path.join(RUN, 'revue');
  const v = cli('projet', 'verifier', FILE, '--rapide');
  check(v.code === 0 && /PROJET CONFORME \(compliant\): Coulisses can open it/.test(v.out) && /timeline: 3 track\(s\), 6 clip\(s\)/.test(v.out) && /^\s+ok\s+composition: 1920×1080, 30 fps/m.test(v.out), 'projet verifier: English, the « PROJET CONFORME » marker unchanged');
  const vf = v.out.split('\n').filter((l) => !/^…/.test(l)).map((l) => frenchIn(l.replace(/«[^»]*»|"[^"]*"/g, ''))).filter(Boolean);
  check(!vf.length, `… with no French text${vf.length ? ` («${vf[0]}»)` : ''}`);
  const bad = cli('projet', 'verifier', path.join(SCR, 'nope.coulisses'), '--rapide');
  check(bad.code === 1 && /FAIL unreadable \(JSON expected\)/.test(bad.out) && /PROJET NON CONFORME \(not compliant\): 1 problem\(s\) to fix/.test(bad.out), 'a failing check: « FAIL … », « PROJET NON CONFORME (not compliant) »');
  const imp = importProject(FILE);
  check(imp.kind === 'remotion', `the sample run is imported (${imp.revue})`);

  // Le hub retrouve ce studio par son verrou : il ne cherche aucun port réservé.
  const fixturePort = await freePort(ST_PORT + 2);
  fixtureStudio = spawn(process.execPath, [path.join(STUDIO, 'studio-server.mjs'), '--project', imp.revue, '--no-open', '--port', String(fixturePort)], {cwd: STUDIO, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  let fixtureOut = ''; fixtureStudio.stdout.on('data', (d) => {fixtureOut += d;}); fixtureStudio.stderr.on('data', (d) => {fixtureOut += d;});
  for (let i = 0; i < 240 && !/Open: http/.test(fixtureOut); i++) await sleep(250);
  const fixtureUrl = /Open: (http:\/\/(?:localhost|127\.0\.0\.1):\d+\/)/.exec(fixtureOut)?.[1];
  if (!fixtureUrl) throw new Error(`Le studio d’essai ne démarre pas : ${fixtureOut.slice(-1500)}`);
  await requireSandbox(fixtureUrl, RUN);

  // ---------- 5. the home screen and the studio ----------
  console.log('the home screen and the studio');
  hub = spawn(process.execPath, [path.join(STUDIO, 'hub-server.mjs'), ...episodeFlags, '--port', String(HUB_PORT)], { cwd: STUDIO, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let hubOut = ''; hub.stdout.on('data', (d) => { hubOut += d; }); hub.stderr.on('data', (d) => { hubOut += d; });
  for (let i = 0; i < 60 && !/HUB_READY/.test(hubOut); i++) await sleep(250);
  HUB_PORT = hubPort(hubOut);
  check(/home screen ready: http/.test(hubOut), 'the home screen\'s log is in English');
  p = await launch({ port: await freePort(9381) });
  const until = async (expr, ms = 30000) => { const t0 = Date.now(); for (;;) { try { if (await p.eval(`return !!(${expr})`)) return true; } catch { /* navigating */ } if (Date.now() - t0 > ms) throw new Error(`timeout: ${expr}`); await sleep(150); } };
  const ev = (e) => p.eval(e).catch(() => null);
  const checkHome = async (lang) => {
    const card = '.card[data-id="' + imp.id + '"]';
    const dict = I.DICTS[lang];
    const fr = lang === 'fr';
    const labels = [
      ['.app-head .sub', fr ? "Revue vidéo · annoter, envoyer à l'agent, corriger" : 'Video review · annotate, send to the agent, fix'],
      ['.library-heading h1', fr ? 'Bibliothèque' : 'Library'],
      ['#addSec h2', fr ? 'Ajouter un projet' : 'Add a project'],
      ['#addSec .imp .t', fr ? 'Importer un projet' : 'Import a project'],
      ['#newBtn', fr ? 'Nouveau projet…' : 'New project…'],
      [card + ' button.open', fr ? 'Ouvrir le studio' : 'Open the studio'],
      ['#impFolder', dict['hub.import.folder']], ['#impVideo', dict['hub.import.video']], ['#impPaste', dict['hub.import.paste']],
    ];
    await until(`document.documentElement.lang === '${lang}' && document.querySelector('#impPaste') && document.querySelector('${card}')`);
    // Headings use uppercase via CSS. Read the visible label's source text, omitting decorative glyphs.
    const actual = await p.eval(`return ${JSON.stringify(labels)}.map(([selector]) => {
      const el = document.querySelector(selector);
      if (!el?.checkVisibility() || el.disabled) return null;
      const copy = el.cloneNode(true);
      copy.querySelectorAll('[aria-hidden="true"]').forEach(child => child.remove());
      return copy.textContent.trim();
    })`);
    const mismatches = labels.flatMap(([selector, expected], i) => actual[i] === expected ? [] : [selector + ' = ' + JSON.stringify(actual[i])]);
    check(!mismatches.length, `home (${lang}): library heading, add/import actions, open studio${mismatches.length ? ' — ' + mismatches.join(', ') : ''}`);
    const status = await p.eval(`const meta = document.querySelector('${card} .meta'); return meta?.checkVisibility() && meta.innerText`);
    const expectedStatus = fr ? 'pas encore exporté · relecture du code' : 'not exported yet · code review';
    check(typeof status === 'string' && status.includes(expectedStatus), `home (${lang}): the sample project's code-review status`);
    await p.eval(`document.querySelector('#impPaste').click(); return true`);
    const paste = await p.eval(`const input = document.querySelector('#impPath'), go = document.querySelector('#impGo');
      return {focused: document.activeElement === input, placeholder: input.placeholder, submit: go.checkVisibility() && go.innerText};`);
    check(paste.focused && paste.placeholder === dict['hub.import.placeholder'] && paste.submit === dict['hub.import.go'],
      `home (${lang}): paste a path opens the localized import field and action`);
  };
  // the visible text of the page: text nodes and the titles / placeholders, minus the user's own data
  const SCAN = `(() => {
    // the user's and the projects' own words: notes, replies, titles, paths, the export script's own labels
    const SKIP = 'textarea, input, .msg, .msg2, .ag .me, .ag .it, .ctx, .hit, #context, .title, #foot, .meta[title], #title, #render, .when, .gest .obj, #mLine, .mb-dlg .body.pre, #langs, #hoverTag, .lot .msg2, #insp dd, .card .gest, .tipr kbd, kbd, svg, #kindTag, .kind, #rcQ button[data-q^="x:"], .mb-item[data-id^="render-x:"]';
    const out = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode());) {
      const el = n.parentElement; if (!el || el.closest(SKIP) || el.closest('script, style')) continue;
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (n.textContent.trim()) out.push(n.textContent.trim());
    }
    for (const el of document.querySelectorAll('[title], [placeholder], [aria-label]')) if (!el.closest(SKIP)) for (const a of ['title', 'placeholder', 'aria-label']) if (el.getAttribute(a)) out.push(el.getAttribute(a));
    return out;
  })()`;
  const scan = async (where) => {
    const texts = (await ev(`return ${SCAN}`)) ?? [];
    const hits = [...new Set(texts.map((x) => [x, frenchIn(x)]).filter(([, f]) => f).map(([x]) => x))];
    check(!hits.length, `${where}: no French text on screen${hits.length ? ` — ${hits.slice(0, 5).map((x) => `«${x.slice(0, 70)}»`).join(' ')}` : ` (${texts.length} texts)`}`);
  };
  const menus = async (where) => {   // open every menu (and every submenu), scan it, close it
    const n = (await ev(`return document.querySelectorAll('#menubar > button').length`)) ?? 0;
    for (let i = 0; i < n; i++) {
      const xy = await ev(`const r = document.querySelectorAll('#menubar > button')[${i}].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]`);
      await p.mouse('mousePressed', xy[0], xy[1]); await p.mouse('mouseReleased', xy[0], xy[1]); await sleep(150);
      await scan(`${where}, menu ${i + 1}`);
      for (const k of (await ev(`return [...document.querySelectorAll('.mb-menu .mb-item')].map((r, j) => r.querySelector('.s') && !r.classList.contains('off') ? j : -1).filter((j) => j >= 0)`)) ?? []) {
        const r = await ev(`const e = document.querySelectorAll('.mb-menu')[0].querySelectorAll('.mb-item')[${k}].getBoundingClientRect(); return [e.left + 20, e.top + e.height / 2]`);
        if (r) { await p.mouse('mouseMoved', r[0], r[1]); await sleep(150); await scan(`${where}, menu ${i + 1}, submenu`); }
      }
      await p.key('Escape', 'Escape'); await p.key('Escape', 'Escape'); await p.key('Escape', 'Escape'); await sleep(80);
    }
  };
  await p.goto(`http://127.0.0.1:${HUB_PORT}/`);
  await until(`document.querySelectorAll('.card[data-id]').length >= 2`, 20000); await sleep(800);
  await checkHome('en');
  check((await ev(`return document.documentElement.lang`)) === 'en' && (await ev(`return [...document.querySelectorAll('#menubar > button')].map((b) => b.textContent).join('|')`)) === 'File|Edit|Tools|Help', 'the page is lang="en", the menu bar « File · Edit · Tools · Help »');
  await scan('home screen');
  await menus('home screen');
  await p.shot(path.join(shots, 'i18n-1-home.png'));
  // the sample run's studio, from the home screen
  await p.eval(`document.querySelector('.card[data-id="${imp.id}"] button.open').click(); return 1`);
  await until(`location.port !== '${HUB_PORT}' && window.__studio && __studio.state().mode === 'code' && window.__preview?.durationInFrames > 1`, 120000);
  await until(`__studio.state().lanes.length >= 3`, 30000).catch(() => {}); await sleep(600);
  const studioUrl = await ev('return location.origin');
  await requireSandbox(studioUrl, RUN);
  const tabNames = await ev(`return [...document.querySelectorAll('.tabbar button[data-tab]')].map(b => { const label = b.cloneNode(true); label.querySelector('.n')?.remove(); return label.textContent.trim(); }).join('|')`);
  check(/live code/.test(await ev(`return document.querySelector('#kindTag').textContent`)) && tabNames === 'Agent|Edits|Batches|Layers|Media|Notes|Scene|Inspector',
    'studio: the layers, media, notes, scene, inspector and agent tabs are named in English');
  // a pin on the title of plan s02 (frame 150), named by data-coulisses, sent as a batch
  await p.eval(`window.__preview.seek(150); return 1`); await sleep(900);
  const r = await ev(`const r = document.querySelector('#media').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]`);
  await p.key('c', 'KeyC', 'c'); await sleep(200);
  await p.mouse('mousePressed', r[0] + r[2] * 0.5, r[1] + r[3] * 0.5); await p.mouse('mouseReleased', r[0] + r[2] * 0.5, r[1] + r[3] * 0.5);
  await until(`document.querySelector('#pop').style.display === 'block'`, 10000); await sleep(1500);
  check(/^Spot · frame 150/.test(await ev(`return document.querySelector('#popT').textContent`)) && (await ev(`return document.querySelector('#popTx').placeholder`)) === 'What should change here?', 'the note box: « Spot · frame 150 », « What should change here? »');
  await p.type('The title comes in too fast'); await p.key('Enter', 'Enter'); await sleep(800);
  for (const tab of ['agent', 'queue', 'notes', 'lots', 'medias', 'insp']) { await p.eval(`document.activeElement?.blur?.(); document.querySelector('button[data-tab=${tab}]').click(); return 1`); await sleep(500); await scan(`studio (Remotion run), tab ${tab}`); }
  check(/frame \d+ · /i.test(await ev(`return document.querySelector('#insp').innerText`)) && /Plans\s+plan s02 · Trois chiffres/.test(await ev(`return document.querySelector('#insp').innerText`)), 'Inspector: « Frame … », the project\'s own track names as they are');
  await p.eval(`document.querySelector('button[data-tab=queue]').click(); return 1`); await sleep(300);
  check(/^Send the edit to the agent$/.test((await ev(`return document.querySelector('#qsend').textContent`)).trim()), 'the send button: « Send the edit to the agent »');
  await p.eval(`document.querySelector('#qsend').click(); return 1`);
  await until(`document.querySelector('#modal').style.display === 'flex'`, 120000);
  const line = await ev(`return document.querySelector('#mLine').textContent`), title = await ev(`return document.querySelector('#mT').textContent`);
  check(/^Coulisses · Essai de Coulisses · batch 1 \(1 edit\) → read ".*001\.md" and fix \(protocol: ".*AGENT\.en\.md"\)$/.test(line) && title === 'Batch 1 sent · 1 edit', `the line to paste, in English (${line.slice(0, 60)}…)`);
  check(/^Updates: /.test(await ev(`return document.querySelector('#mUpd').textContent`)), 'the update line of the send window, in English');
  await scan('studio, the send window');
  const md = fs.readFileSync(path.join(REVUE, 'lots', '001.md'), 'utf8');
  check(/^# Coulisses · "Essai de Coulisses" · batch 1 · 1 edit\(s\)/.test(md) && /The user reviews the CODE live/.test(md) && /- Request: "The title comes in too fast"/.test(md) && /- 3D object under the gesture: |titre s02/.test(md)
    && /- In the edit, under the note:\n  - Plans: plan s02 · Trois chiffres · src\/Video\.tsx, frame 60 of the clip/.test(md), 'the batch (.md) written by the server: English, the clip « frame 60 of the clip »');
  await p.eval(`document.querySelector('#mClose').click(); return 1`);
  // the agent's side in English
  const id = JSON.parse(fs.readFileSync(path.join(REVUE, 'lots', '001.json'), 'utf8')).edits[0].id;
  const tk = cli('take', REVUE, '1'), rp = cli('reply', REVUE, id, 'Slowed the title down', '--status', 'done'), dn = cli('done', REVUE, '1', 'title slowed down'), stt = cli('status', REVUE);
  check(/^batch 1 taken: 1 note\(s\) "The agent is fixing" in the tool$/.test(tk.out) && new RegExp(`^${id}: done, 0 image\\(s\\), 1 message\\(s\\)$`).test(rp.out)
    && /^batch 1 closed \(done\) · no snapshot: cannot be undone$/.test(dn.out) && /session watching: no/.test(stt.out) && /batch 1 · 1 edit\(s\) · .* · agent: done/.test(stt.out), 'take / reply / done / status: in English');
  await p.eval(`document.querySelector('button[data-tab=lots]').click(); return 1`);
  await until(`document.querySelector('#lots [data-lot="1"] .st.done')`);
  const batchText = await ev(`return document.querySelector('#lots [data-lot="1"]').innerText`);
  check(/Batch 1/.test(batchText) && /Fixed by the agent/.test(batchText), '« Batches »: « Batch 1 · Fixed by the agent »');
  await scan('studio, tab Batches after the fix');
  await p.eval(`document.querySelector('#helpBtn').click(); return 1`); await sleep(200);
  check(/ON THE IMAGE/i.test(await ev(`return document.querySelector('.mb-dlg.sc-dlg')?.innerText ?? ''`)) && /Undo: one step back/.test(await ev(`return document.querySelector('.mb-dlg.sc-dlg')?.innerText ?? ''`)), 'the keyboard shortcuts window, in English');
  await scan('studio, the keyboard shortcuts window');
  await p.eval(`document.querySelector('.mb-dlg').__close(); return 1`);
  await p.eval(`document.querySelector('#agent').click(); return 1`); await sleep(300);
  check(/^Coulisses · Essai de Coulisses · connect → read ".*AGENT\.en\.md" then watch what I send: /.test(await ev(`return document.querySelector('#mLine').textContent`)), 'the connect line, in English');
  await scan('studio, the connect window');
  await p.eval(`document.querySelector('#mClose').click(); return 1`);
  await menus('studio (Remotion run)');
  // Help › About, Edit › Preferences, Tools › Check the project: the dialogs
  const item = async (menu, id) => {
    const xy = await ev(`const r = document.querySelector('#menubar > button[data-menu=${menu}]').getBoundingClientRect(); return [r.left + 10, r.top + 10]`);
    await p.mouse('mousePressed', xy[0], xy[1]); await p.mouse('mouseReleased', xy[0], xy[1]); await sleep(150);
    await p.eval(`document.querySelector('.mb-item[data-id="${id}"]').click(); return 1`); await sleep(500);
  };
  await item('help', 'about');
  // La fenêtre est construite après la réponse de /api/about.
  await until(`document.querySelector('.mb-dlg #mbRepo')`);
  const about = await ev(`const dlg = document.querySelector('.mb-dlg'); return {title:dlg.querySelector('h2').textContent, text:dlg.innerText, repo:dlg.querySelector('#mbRepo').textContent}`);
  check(about?.title === 'About Coulisses' && /\d+\.\d+\.\d+/.test(about.text) && /\bMIT\b/.test(about.text) && /^github\.com\//.test(about.repo), 'Help › About Coulisses: version, MIT license, the GitHub link');
  await scan('studio, About'); await p.key('Escape', 'Escape');
  await item('edit', 'prefs');
  check(/Preferences/.test(await ev(`return document.querySelector('.mb-dlg h2').textContent`)) && (await ev(`return document.querySelector('.mb-dlg [data-l=en]').disabled`)), 'Edit › Preferences…: the language (fixed here by COULISSES_LANG), the agent');
  await scan('studio, Preferences'); await p.key('Escape', 'Escape');
  await item('tools', 'verify');
  await until(`/PROJET CONFORME/.test(document.querySelector('.mb-dlg .body')?.textContent ?? '')`, 90000).catch(() => {});
  check(/PROJET CONFORME \(compliant\)/.test(await ev(`return document.querySelector('.mb-dlg .body').textContent`)), 'Tools › Check the project: `projet verifier --rapide`, in English');
  await p.key('Escape', 'Escape');
  await p.shot(path.join(shots, 'i18n-2-studio-run.png'));

  // the sandbox E03 (a Brambleshire episode: the render card, the staging panel, the episode's tracks), read only
  st = spawn(process.execPath, [path.join(STUDIO, 'studio-server.mjs'), 'E03', '--no-open', ...episodeFlags, '--port', String(ST_PORT)], { cwd: STUDIO, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stOut = ''; st.stdout.on('data', (d) => { stOut += d; }); st.stderr.on('data', (d) => { stOut += d; });
  for (let i = 0; i < 120 && !/Open: http/.test(stOut); i++) await sleep(250);
  const stUrl = /Open: (http:\/\/(?:localhost|127\.0\.0\.1):\d+\/)/.exec(stOut)?.[1];
  check(!!stUrl && /review studio for E03/.test(stOut) && /Close this window to stop the tool\./.test(stOut), `the studio's console, in English (« Open: ${stUrl} »)`);
  await requireSandbox(stUrl, SANDBOX);
  await p.goto(stUrl);
  await until(`document.querySelector('#v').readyState >= 2`, 60000); await sleep(2500);
  for (const tab of ['agent', 'queue', 'notes', 'lots', 'insp', 'medias', 'scene']) { await p.eval(`document.querySelector('button[data-tab=${tab}]').click(); return 1`); await sleep(500); await scan(`studio (episode E03), tab ${tab}`); }
  check(/Start the render/.test(await ev(`return document.querySelector('#renderCard').innerText`)) && /Move the objects yourself/.test(await ev(`return document.querySelector('#scene').innerText`)), 'the render card « Start the render », the staging panel « Move the objects yourself »');
  await until(`__studio.state().lanes.includes('Camera')`, 60000).catch(() => {});
  const lanes = await ev(`return __studio.state().lanes`);
  check(['Sets', 'Narrator', 'Mix'].every((x) => lanes.includes(x)) && !lanes.some((x) => ['Décors', 'Narrateur', 'Caméra', 'Lumière', 'Musique', 'Bruitages'].includes(x)), `the timeline's tracks, in English (${lanes.join(', ')})`);
  await menus('studio (episode E03)');
  await p.shot(path.join(shots, 'i18n-3-studio-episode.png'));
  kill(st); st = null;

  // ---------- 6. the language switch of the home screen, kept in the settings file ----------
  console.log('the language switch');
  await p.goto(`http://127.0.0.1:${HUB_PORT}/`); await sleep(300);
  await fetch(`http://127.0.0.1:${HUB_PORT}/api/quit`, { method: 'POST' }).catch(() => {}); await sleep(800); kill(hub);
  fs.writeFileSync(process.env.COULISSES_SETTINGS, JSON.stringify({ lang: 'en', other: 1 }));
  hub = spawn(process.execPath, [path.join(STUDIO, 'hub-server.mjs'), ...episodeFlags, '--port', String(HUB_PORT)], { cwd: STUDIO, env: { ...process.env, COULISSES_LANG: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  hubOut = ''; hub.stdout.on('data', (d) => { hubOut += d; });
  for (let i = 0; i < 60 && !/HUB_READY/.test(hubOut); i++) await sleep(250);
  HUB_PORT = hubPort(hubOut);
  await p.goto(`http://127.0.0.1:${HUB_PORT}/`); await until(`document.querySelector('#langs button.on')`, 10000);
  await checkHome('en');
  check((await ev(`return document.querySelector('#langs button.on').dataset.l`)) === 'en', 'with « en » in the settings file: the English language button is active');
  await p.eval(`document.querySelector('#langs button[data-l=fr]').click(); return 1`);
  await checkHome('fr');
  const saved = JSON.parse(fs.readFileSync(process.env.COULISSES_SETTINGS, 'utf8'));
  check(saved.lang === 'fr' && saved.other === 1 && (await ev(`return document.querySelector('#langs button.on').dataset.l`)) === 'fr', '« FR »: the French language button is active and the choice is saved alongside other settings');
  check((await ev(`return [...document.querySelectorAll('#menubar > button')].map((b) => b.textContent).join('|')`)) === 'Fichier|Édition|Outils|Aide', '… the menu bar too: « Fichier · Édition · Outils · Aide »');
  void studioUrl;
} catch (e) { ko++; console.log('  ✗ ERREUR', e.stack); } finally {
  if (p) {
    const errs = p.logs.filter((l) => /exception|\[error\]/.test(l) && !/WebGL|X4000|503|404|Failed to load resource/.test(l));
    if (errs.length) console.log('page errors:\n' + errs.slice(0, 6).join('\n'));
    await p.close();
  }
  if (hub) { await fetch(`http://127.0.0.1:${HUB_PORT}/api/quit`, { method: 'POST' }).catch(() => {}); await sleep(600); kill(hub); }
  kill(st);
  kill(fixtureStudio);
  if (skipped) console.log(`${skipped} contrôles non exécutés : binaire Coulisses.exe absent du worktree.`);
  console.log(`\n${ok} ok, ${ko} échec(s)`);
  process.exit(ko ? 1 : 0);
}

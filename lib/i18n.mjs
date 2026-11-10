// The language of Coulisses: French or English, for everything the user sees (studio, home screen, the line to paste,
// the batch files the agent reads, the command line's messages). One setting for the whole app:
//   1. COULISSES_LANG=fr|en (environment): wins over everything (the tests set it, so they never depend on the user's
//      choice nor write the user's file);
//   2. the user's choice, made in the home screen or in the studio (« Langue · Language »), kept in
//      %LOCALAPPDATA%\Coulisses\settings.json ({ "lang": "en" }; COULISSES_SETTINGS = another file, for the tests);
//   3. otherwise the Windows display language: French -> fr, anything else -> en.
// The texts are in lib/i18n-fr.mjs and lib/i18n-en.mjs (same keys). A text is a string with {name} for a value and
// {n|one|other} for a plural chosen by the number n (French: 0 and 1 are singular; English: only 1).
// The pages get their texts from the server that serves them (renderPage): {{key}} in the HTML is replaced before it
// is sent, and window.T(key, values) does the same in the page's script.
// Machine markers are NOT texts and never change with the language: COULISSES PROGRES / FIN / REMPLACE (export
// scripts), « PROJET CONFORME » / « PROJET NON CONFORME », « LOT N REÇU », « DEMANDE DE RENDU (lot N) REÇUE » and the
// RENDU … verdicts of studio-cli.mjs, HUB_READY.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import FR from './i18n-fr.mjs';
import EN from './i18n-en.mjs';
import { APP_DATA, APP_NAME, MSTUDIO } from './app-profile.mjs';

export const LANGS = ['fr', 'en'];
export const DICTS = { fr: FR, en: EN };
export const LANG_NAMES = { fr: 'Français', en: 'English' };
// an explicit choice (setting, environment): fr… is French, any other language is English
const pick = (v) => { const s = String(v ?? '').trim().toLowerCase(); return !s ? null : s.startsWith('fr') ? 'fr' : 'en'; };

export const settingsFile = () => MSTUDIO ? path.join(APP_DATA, 'settings.json') : process.env.COULISSES_SETTINGS
  || path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'Coulisses', 'settings.json');
let memo = { at: 0, file: null, mtime: null, data: {} };
// the file as it is: {} only when there is none; null when it is there but cannot be read now (another process writing
// it, an antivirus, a BOM added by another tool is accepted) — code review 18/10/2026: one failed read was kept as {} and
// the next writeSettings({ projectsRoot }) wrote the file back with that key alone (language, shortcuts, folders lost)
function readFile(f) {
  let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? {} : null; }
  try { const d = JSON.parse(txt.replace(/^\uFEFF/, '')); return d && typeof d === 'object' ? d : {}; } catch { return null; }
}
export function readSettings() {
  const f = settingsFile();
  if (memo.file === f && Date.now() - memo.at < 400) return memo.data;
  let mtime = null; try { mtime = fs.statSync(f).mtimeMs; } catch { /* no file yet */ }
  if (memo.file !== f || memo.mtime !== mtime) {
    const data = readFile(f);
    if (data) memo = { at: Date.now(), file: f, mtime, data };
    else if (memo.file !== f) memo = { at: 0, file: f, mtime: null, data: {} };   // (unreadable: read again next time, never kept)
  } else memo.at = Date.now();
  return memo.data;
}
const PAUSE = new Int32Array(new SharedArrayBuffer(4));
export function writeSettings(patch) {
  const f = settingsFile();
  let cur = readFile(f);
  for (let i = 0; !cur && i < 20; i++) { Atomics.wait(PAUSE, 0, 0, 25); cur = readFile(f); }
  if (!cur) throw new Error(`settings.json illisible : rien n'est écrit (${f})`);   // never written back from a failed read
  const data = { ...cur, ...patch };
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  // (Windows refuses the rename while another process reads the file: tried again, as lib/episode.mjs writeJson)
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, f); break; } catch (e) {
      if (i >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { try { fs.rmSync(tmp, { force: true }); } catch { /* */ } throw e; }
      Atomics.wait(PAUSE, 0, 0, 15);
    }
  }
  memo = { at: 0, file: null, mtime: null, data: {} };
  return data;
}

// the Windows display language (the user's, else the machine's), read once: fr-FR -> fr, ja-JP -> en
let sys = null;
export function systemLang() {
  if (sys) return sys;
  let tag = null;
  if (process.platform === 'win32') {
    for (const [key, value] of [['HKCU\\Control Panel\\Desktop', 'PreferredUILanguages'], ['HKCU\\Control Panel\\International\\User Profile', 'Languages'], ['HKCU\\Control Panel\\Desktop\\MuiCached', 'MachinePreferredUILanguages']]) {
      try {
        const r = spawnSync('reg', ['query', key, '/v', value], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
        const m = /REG_(?:MULTI_)?SZ\s+([A-Za-z]{2,3}(?:-[\w-]+)?)/.exec(r.stdout ?? '');
        if (m) { tag = m[1]; break; }
      } catch { /* next */ }
    }
  }
  tag ??= process.env.LANG || process.env.LC_ALL || Intl.DateTimeFormat().resolvedOptions().locale || 'en';
  sys = /^fr/i.test(tag) ? 'fr' : 'en';
  return sys;
}
// where the current language comes from: 'env' | 'settings' | 'system'
export function langSource() {
  if (pick(process.env.COULISSES_LANG)) return 'env';
  if (pick(readSettings().lang)) return 'settings';
  return 'system';
}
export function lang() {
  return pick(process.env.COULISSES_LANG) ?? pick(readSettings().lang) ?? systemLang();
}
// the choice made in the home screen or the studio; returns the language now in force (COULISSES_LANG still wins)
export function setLang(l) {
  if (!LANGS.includes(l)) throw new Error(`fr | en (${l})`);
  writeSettings({ lang: l });
  return lang();
}

// plural: French 0 and 1 are singular (« 0 note », « 1 note », « 2 notes »), English only 1
export function many(n, l) { const x = Math.abs(+n); return l === 'fr' ? x > 1 : x !== 1; }
// {name} -> the value; {n|one|other} -> one or other by the number n; anything else is left as it is
export function fill(s, v, l) {
  return String(s).replace(/\{(\w+)(?:\|([^{}|]*)\|([^{}]*))?\}/g, (m, k, one, other) => {
    if (!v || !Object.prototype.hasOwnProperty.call(v, k)) return m;
    if (one === undefined) return String(v[k] ?? '');
    return many(v[k], l) ? other : one;
  });
}
function localizedTemplate(key, l) {
  const s = DICTS[l]?.[key] ?? DICTS.fr[key];
  // Brand the UI copy before interpolating titles, filenames or paths supplied by the user.
  if (MSTUDIO && s && /^(hub|st|menu|common|np|hubsrv|lot)\./.test(key))
    return s.replace(/\bCoulisses\b/g, APP_NAME);
  return s;
}
export function t(key, v, l = lang()) {
  const s = localizedTemplate(key,l);
  return s === undefined ? key : fill(s, v, l);
}
// a translator bound to one language (the same for a whole message)
export const tr = (l = lang()) => (key, v) => t(key, v, l);
export const locale = (l = lang()) => (l === 'fr' ? 'fr-FR' : 'en-US');
// dates written for the agent and in the logs
export const dateTime = (d, l = lang()) => new Date(d).toLocaleString(locale(l), l === 'fr' ? undefined : { hour12: false });
export const hhmm = (d, l = lang()) => (l === 'fr' ? new Date(d).toLocaleTimeString('fr-FR').slice(0, 5) : new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
// the agent's protocol and the pipelines' contract, in the user's language
export const agentDocName = (l = lang()) => (l === 'fr' ? 'AGENT.md' : 'AGENT.en.md');
export const contractDocName = (l = lang()) => (l === 'fr' ? 'FICHE-COULISSES-REMOTION.md' : 'COULISSES-REMOTION-CONTRACT.md');

// a page served in the current language: {{key}} replaced in the HTML (trusted texts, they may hold markup), the page's
// own texts (keys starting with one of `prefixes`) given to its script as window.__I18N, with window.T(key, values)
export function renderPage(html, { prefixes = [], l = lang() } = {}) {
  const get = (k) => localizedTemplate(k,l) ?? k;
  const out = String(html).replace(/\{\{([\w.-]+)\}\}/g, (m, k) => get(k)).replace(/<html lang="\w+">/, `<html lang="${l}">`);
  const dict = Object.fromEntries(Object.keys(FR).filter((k) => prefixes.some((p) => k.startsWith(p))).map((k) => [k, get(k)]));
  const boot = { lang: l, source: langSource(), langs: LANGS, names: LANG_NAMES, dict };
  const js = `window.__I18N = ${JSON.stringify(boot).replace(/</g, '\\u003c')};\n`
    + `(() => { const many = ${many.toString()}; const fill = ${fill.toString()};\n`
    + '  window.T = (k, v) => { const s = window.__I18N.dict[k]; return s === undefined ? k : fill(s, v, window.__I18N.lang); }; })();';
  return out.replace('<!--I18N-->', () => `<script>\n${js}\n</script>`);
}

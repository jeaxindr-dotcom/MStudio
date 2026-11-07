// Régressions de la revue Astra : cache et contexte du Player. Aucun navigateur ni ffmpeg lancé.
// Même suite avant/après : node tests/audio-regressions.mjs --revision 10633a9 (doit échouer),
// puis node tests/audio-regressions.mjs (doit réussir). Le code de la révision est évalué tel quel.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const revAt = process.argv.indexOf('--revision'), revision = revAt >= 0 ? process.argv[revAt + 1] : null;
const read = (file) => revision ? execFileSync('git', ['show', `${revision}:${file}`], { cwd: STUDIO, encoding: 'utf8' }) : fs.readFileSync(path.join(STUDIO, file), 'utf8');
let ok = 0, ko = 0;
const check = (condition, label) => { condition ? ok++ : ko++; console.log(`  ${condition ? '✓' : '✗'} ${label}`); };

function makeCache(options = {}) {
  const mem = new Map(), jobs = [];
  const pub = path.resolve('C:/coulisses-audio-test/public'), cache = path.resolve('C:/coulisses-audio-test/cache');
  for (const name of ['a.wav', 'b.wav', 'master.wav']) mem.set(path.join(pub, name), { size: 100, mtimeMs: 1 });
  const fakefs = {
    existsSync: (f) => mem.has(f), statSync: (f) => { if (!mem.has(f)) throw new Error('absent'); return mem.get(f); },
    mkdirSync() {}, writeFileSync: (f, text) => mem.set(f, { size: text.length, mtimeMs: 1, text }),
    rmSync: (f) => mem.delete(f), renameSync: (a, b) => { mem.set(b, mem.get(a)); mem.delete(a); },
    readdirSync: () => [], utimesSync() {},
  };
  const spawn = (_command, args) => {
    const p = new EventEmitter(); p.stderr = new EventEmitter(); p.pid = 123;
    p.kill = () => { p.killed = true; }; p.args = args; jobs.push(p); return p;
  };
  const source = read('lib/review-sound.mjs').replace(/^import .*;\r?$/gm, '').replace('export function reviewSound', 'function reviewSound');
  const context = { fs: fakefs, os: { setPriority() {}, constants: { priority: { PRIORITY_BELOW_NORMAL: 0 } } }, path, crypto, spawn, Date };
  vm.createContext(context);
  vm.runInContext(source + `\nglobalThis.api = reviewSound(${JSON.stringify({ cacheDir: cache, publicDir: pub, ...options })});`, context);
  const finish = (p, code = 0) => { if (!code) mem.set(p.args.at(-1), { size: 15, mtimeMs: 2 }); p.emit('close', code); };
  return { api: context.api, jobs, mem, pub, cache, finish };
}
const timeline = (src = 'a.wav') => ({ fps: 30, frames: 300, tracks: [{ type: 'audio', clips: [{ src, t0: 0, t1: 10 }] }] });

{
  const { api, jobs, finish, mem, pub } = makeCache({ masterOnly: false });
  const sigA = api.update(timeline(), 1).sig; finish(jobs[0]);
  api.update(timeline('b.wav'), 2); const jobB = jobs.at(-1);
  api.update(timeline(), 3); finish(jobB);
  check(api.file(sigA)?.endsWith(`revue-son-${sigA}.m4a`), 'retour A→B→A : A reste le fichier servi sous la signature A');
  check(jobB.killed, 'la construction B devenue inutile est annulée');
  const count = jobs.length;
  mem.get(path.join(pub, 'a.wav')).mtimeMs = 999.125;
  api.update(timeline(), 3);
  check(jobs.length === count + 1, 'remplacer seulement le WAV invalide le cache à version de code constante');
  if (jobs.length > count) finish(jobs.at(-1), 1);
  const failed = jobs.length; api.update(timeline(), 3);
  check(jobs.length === failed, 'un échec inchangé ne relance pas une construction à chaque état demandé');
}
{
  const { api, jobs, finish, mem } = makeCache({ masterOnly: false });
  api.update(timeline(), 1); finish(jobs[0]);
  api.update(timeline('b.wav'), 2); const b1 = jobs.at(-1);
  api.update(timeline(), 3);
  api.update(timeline('b.wav'), 4); const b2 = jobs.at(-1);
  const scriptOf = (p) => p.args[p.args.indexOf('-/filter_complex') + 1];
  finish(b1);
  check(b1.args.at(-1) !== b2.args.at(-1) && mem.has(scriptOf(b2)), 'deux travaux de même signature gardent des temporaires distincts');
  check(!mem.has(scriptOf(b1)) && !mem.has(b1.args.at(-1)), 'la fin tardive du travail annulé nettoie ses seuls temporaires');
  finish(b2); check(api.state.state === 'ready', 'le travail remplaçant peut publier son résultat');
}
{
  const { api, jobs, finish } = makeCache({ masterOnly: false });
  const sig = api.update(timeline(), 1).sig; api.stop(); finish(jobs[0]);
  check(api.state.state === 'none' && api.file(sig) === null, 'arrêt : une fin tardive ne republie pas le son annulé');
}
{
  const { api, jobs } = makeCache(); api.update(timeline(), 1);
  check(api.state.state === 'none' && api.state.why === 'no-master' && jobs.length === 0, 'sans source maître déclarée : aucun mix descriptif automatique');
}
{
  const { api, jobs, mem, pub } = makeCache();
  api.update({ ...timeline(), reviewAudio: { src: 'master.wav', offsetFrames: 30, volume: 0.5 } }, 1);
  const p = jobs[0], inputs = p?.args.flatMap((a, i) => a === '-i' ? [p.args[i + 1]] : []) ?? [];
  const script = p && mem.get(p.args[p.args.indexOf('-/filter_complex') + 1])?.text;
  check(inputs.length === 1 && inputs[0] === path.join(pub, 'master.wav'), 'une source maître remplace les pistes descriptives');
  check(script?.includes('atrim=start=1:end=11') && script.includes('volume=0.5') && !script.includes('loudnorm'), 'la source maître respecte seulement son décalage et son volume explicites');
}
{
  const { api, jobs } = makeCache({ masterOnly: false });
  api.update({ ...timeline(), reviewAudio: { src: 'master.wav', volume: NaN } }, 1);
  check(api.state.state === 'none' && jobs.length === 0, 'un master invalide ne retombe pas sur les pistes descriptives');
}
{
  const { api, jobs } = makeCache();
  api.update({ fps: 30, frames: 300, reviewAudio: { src: 'master.wav' } }, 1);
  check(api.state.state === 'building' && jobs.length === 1, 'la déclaration du master suffit sans pistes descriptives');
}

function makeSound() {
  let now = 0, serial = 0, currentShared = null, effectCleanup = null;
  const timers = new Map(), contexts = [], events = [], media = [];
  class AudioContextMock {
    state = 'running'; currentTime = 0; sampleRate = 48000; freeze = false; resumes = 0;
    listeners = new Map();
    constructor() { contexts.push(this); }
    addEventListener(type, fn) { const set = this.listeners.get(type) ?? new Set(); set.add(fn); this.listeners.set(type, set); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    dispatch(type) { for (const fn of this.listeners.get(type) ?? []) fn({ type }); }
    resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  const win = { AudioContext: AudioContextMock };
  const schedule = (fn, ms, repeat) => { const id = ++serial; timers.set(id, { fn, ms, next: now + ms, repeat }); return id; };
  const clock = (ms) => { const end = now + ms; while (true) {
    const pair = [...timers].filter(([, t]) => t.next <= end).sort((a, b) => a[1].next - b[1].next)[0];
    const to = pair ? pair[1].next : end, delta = to - now;
    for (const c of contexts) if (c.state === 'running' && !c.freeze) c.currentTime += delta / 1000;
    for (const el of media) if (!el.paused) el.currentTime += delta / 1000;
    now = to; if (!pair) break;
    const [id, t] = pair; if (t.repeat) t.next += t.ms; else timers.delete(id); t.fn();
  } };
  const source = stripTypeScriptTypes(read('player/sound.ts').replace(/^import .*;\r?$/gm, '').replaceAll('export function ', 'function '), { mode: 'strip' });
  const context = { window: win, document: { hidden: false, querySelectorAll: () => media }, performance: { now: () => now },
    setTimeout: (fn, ms) => schedule(fn, ms, false), clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: (id) => timers.delete(id),
    useContext: () => currentShared, useEffect: (effect) => { effectCleanup = effect(); }, Internals: { SharedAudioContext: {} },
  };
  vm.createContext(context); vm.runInContext(source + '\nglobalThis.make=createSound;', context);
  const sound = context.make((type, detail) => events.push({ type, ...detail }));
  const playerListeners = new Map();
  const player = { playing: true, muted: false, buffering: false,
    isPlaying() { return this.playing; }, isMuted() { return this.muted; }, isBuffering() { return this.buffering; },
    mute() { if (!this.muted) { this.muted = true; playerListeners.get('mutechange')?.({detail: {isMuted: true}}); } },
    unmute() { if (this.muted) { this.muted = false; playerListeners.get('mutechange')?.({detail: {isMuted: false}}); } },
    pause() { this.playing = false; }, setVolume() {},
    addEventListener(type, fn) { playerListeners.set(type, fn); }, removeEventListener(type) { playerListeners.delete(type); },
  };
  const c = new win.AudioContext();
  const bind = (ctx) => sound.bindContext?.(ctx) ?? (() => {});
  bind(c); const detach = sound.attach(player);
  return { sound, player, playerListeners, c, events, media, win, Native: AudioContextMock, bind, clock, detach, context, setShared: (ctx) => { currentShared = ctx; }, cleanupEffect: () => effectCleanup?.() };
}
{
  const s = makeSound();
  check(s.win.AudioContext === s.Native, 'le constructeur global AudioContext reste intact');
  const other = new s.win.AudioContext(); other.state = 'suspended'; other.resume = () => Promise.resolve(); s.clock(12000);
  check(!s.events.some((e) => e.state === 'dead'), 'un contexte tiers suspendu ne condamne pas le Player sain');
  check(s.sound.contexts().length === 1, 'le diagnostic ne conserve que le contexte du Player lié');
}
{
  // 03/11/2026 : « Rétablir le son » puis Lecture, aucun son — Remotion suspend son contexte pendant un tampon et ne le
  // relance pas à la fin (hors _experimentalKeepAudioContextAlive) : Coulisses le relance dès la fin du tampon
  const s = makeSound(); s.clock(3000);
  s.player.buffering = true; s.c.state = 'suspended'; s.c.dispatch?.('statechange');
  s.clock(1000);
  s.player.buffering = false;
  const go = s.playerListeners?.get('resume'); go?.();
  s.clock(400);
  check(!!go && s.c.state === 'running', `la fin d'un tampon relance le contexte que Remotion a suspendu (${s.c.state} après 400 ms)`);
}
{
  const s = makeSound(); s.c.state = 'closed'; s.clock(12000);
  check(s.events.some((e) => e.state === 'dead' && e.why === 'closed'), 'la fermeture du vrai contexte est diagnostiquée');
}
{
  const s = makeSound(); s.player.playing = false; s.c.dispatch('error'); s.clock(12000);
  check(s.events.length === 0, 'un contexte au repos ne déclenche aucune relance automatique');
}
{
  const s = makeSound(); s.player.buffering = true; s.c.state = 'suspended'; s.c.resume = () => Promise.resolve(); s.clock(12000);
  check(s.events.length === 0, 'le tampon réel du Player protège le contexte même si un événement waiting a été manqué');
}
{
  const s = makeSound(), c2 = new s.win.AudioContext();
  const staleRelease = s.bind(s.c); s.bind(c2); staleRelease(); s.c.dispatch('error'); s.clock(5000);
  check(s.events.length === 0 && s.sound.contexts().length === 1, 'le nettoyage tardif d’un ancien lien préserve le lien courant');
  const release = s.bind(c2); release(); c2.dispatch('error'); s.clock(5000);
  check(s.events.length === 0 && s.sound.contexts().length === 0, 'le démontage libère la référence et les écouteurs du contexte');
}
{
  const s = makeSound(); s.c.freeze = true; s.clock(12000);
  check(s.events.some((e) => e.state === 'dead' && e.why === 'stalled'), 'le contexte lié dont l’horloge est arrêtée reste diagnostiqué');
}
{
  const s = makeSound(), exact = new s.win.AudioContext();
  s.setShared({ audioContext: exact });
  const result = s.context.SoundContext?.({ sound: s.sound });
  check(result === null && s.win.__coulissesAudio?.[0] === exact, 'SoundContext lie exactement la valeur du contexte partagé de Remotion');
  s.cleanupEffect();
  check(s.sound.contexts().length === 0 && exact.state === 'running', 'le nettoyage de l’effet détache sans fermer un contexte que React peut réutiliser');
}
{
  const s = makeSound(), other = new s.win.AudioContext();
  await s.sound.dispose?.();
  check(s.c.state === 'closed' && other.state === 'running' && s.sound.contexts().length === 0, 'la destruction définitive ferme seulement le contexte lié au Player');
}
const piste = () => ({ tagName: 'AUDIO', currentSrc: 'voix.wav', volume: 1, currentTime: 0, paused: false, muted: false });
{
  const s = makeSound(); s.media.push(piste()); s.player.playing = false; s.c.state = 'suspended'; s.sound.restore(); s.clock(3600);
  check(s.events.some(e => e.state === 'armed') && !s.events.some(e => e.state === 'back') && s.c.resumes === 0,
    'bouton à l’arrêt : vérification armée, aucun démarrage caché');
  s.player.playing = true; s.playerListeners.get('play')(); s.clock(500);
  check(s.events.some(e => e.state === 'back') && s.c.state === 'running', 'Lecture confirme après progression de la piste et du contexte');
}
{
  const s = makeSound(); s.c.freeze = true; s.media.push(piste()); s.sound.restore(); s.clock(3000);
  check(s.events.some(e => e.state === 'failed') && !s.events.some(e => e.state === 'back'), 'une balise qui avance dans un contexte running figé ne confirme jamais le son');
}
{
  const s = makeSound(); s.media.push({...piste(), paused: true}); s.sound.restore(); s.clock(3000);
  check(s.events.some(e => e.state === 'failed') && !s.events.some(e => e.state === 'back'), 'un contexte qui avance avec la seule piste en panne ne confirme jamais le son');
}
{
  const s = makeSound();
  s.media.push({...piste(), muted: true}, {...piste(), tagName: 'VIDEO'}, {...piste(), currentSrc: 'data:audio/mp3;base64,/+MYxAAJcAV8AAgAABn//////+/gQ5'});
  s.sound.restore(); s.clock(3000);
  check(s.events.some(e => e.state === 'quiet') && !s.events.some(e => ['back', 'failed'].includes(e.state)), 'silence voulu, vidéo sans son et balise de réserve : attente sans succès ni reconstruction');
  s.media.push(piste()); s.clock(1500);
  check(s.events.some(e => e.state === 'back'), 'la première vraie piste audible confirme ensuite la demande');
}
{
  const s = makeSound(); s.sound.mute(); s.c.state = 'suspended'; s.c.dispatch('statechange'); s.playerListeners.get('resume')(); s.clock(12000);
  check(s.c.resumes === 0 && !s.events.length, 'la sourdine du master empêche tout réveil, même après tampon');
}
console.log(`\n${ok} ok, ${ko} ko${revision ? ` (référence ${revision})` : ''}`);
process.exitCode = ko ? 1 : 0;

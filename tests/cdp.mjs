// Minimal Chrome DevTools Protocol driver (no dependency: Node's built-in WebSocket) for the studio's end-to-end test.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waitForRenderIdle } from '../lib/render-activity.mjs';

// The suites check Coulisses' French texts (lib/i18n.mjs): a studio started by hand for them must speak French
// (COULISSES_LANG=fr). Exits with a clear message otherwise.
export async function requireFrench(base) {
  let m = null; try { m = await (await fetch(new URL('api/meta', base))).json(); } catch { return; }   // not started: the test says so
  if (m?.lang && m.lang !== 'fr') { console.error(`Le studio ${base} parle « ${m.lang} » : le relancer avec COULISSES_LANG=fr (les tests vérifient les textes français).`); process.exit(2); }
}

// A suite of the sandbox writes notes and sends batches: the studio it talks to must be the sandbox's, never a real
// episode's (19/10/2026: the user's E12 was open on 4174, the sandbox's studio had moved to 4175, and a suite was sent to
// 4174). The studio's notes file must be inside `sandbox`; otherwise the suite stops at once, nothing touched.
export async function requireSandbox(base, sandbox) {
  let j = null; try { j = await (await fetch(new URL('api/ping', base), { signal: AbortSignal.timeout(4000) })).json(); } catch { return; }   // (not started: the test says so)
  const inside = (f) => path.resolve(String(f ?? '')).toLowerCase().startsWith(path.resolve(sandbox).toLowerCase() + path.sep);
  if (!inside(j?.notesFile)) { console.error(`ARRÊT : le studio ${base} n'est pas celui du bac à sable (${j?.notesFile ?? '?'}) — rien n'a été touché. Le lancer sur ${sandbox}, ou choisir son port (COULISSES_TEST_SANDBOX_PORT).`); process.exit(2); }
}

// the profiles of earlier runs that were stopped by force (a suite killed at its time limit: close() never ran) — only
// ours (studio-cdp-), untouched for 2 hours, and not held by a Chrome still running (it cannot be renamed then)
// (18/10/2026: 35 of them, 2.3 GB in %TEMP%)
function sweepProfiles() {
  const T = os.tmpdir(), old = Date.now() - 2 * 3600e3;
  let names = []; try { names = fs.readdirSync(T).filter((n) => /^studio-cdp-[A-Za-z0-9]{6}(-del)?$/.test(n)); } catch { return; }
  for (const n of names) {
    const d = path.join(T, n);
    try {
      if (n.endsWith('-del')) { fs.rmSync(d, { recursive: true, force: true }); continue; }   // (a sweep cut short)
      if (fs.statSync(d).mtimeMs > old) continue;
      const gone = `${d}-del`; fs.renameSync(d, gone); fs.rmSync(gone, { recursive: true, force: true });
    } catch { /* in use, or already gone */ }
  }
}

// args: more flags for this Chrome (a fake microphone: --use-fake-device-for-media-stream…, tests/dictate.mjs)
// autoplay: 'free' (the Coulisses window: --autoplay-policy=no-user-gesture-required, app/Launcher.cs) or 'tab' (a studio opened
// in a tab of a normal Chrome: sound and play only after a click — user report 24/10/2026, tests/sound-tab.mjs)
export async function launch({ port = 9333, headless = true, args = [], autoplay = 'free' } = {}) {
  await waitForRenderIdle();
  sweepProfiles();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-cdp-'));
  const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, ...(headless ? ['--headless=new'] : []),
    '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', autoplay === 'tab' ? '--autoplay-policy=document-user-activation-required' : '--autoplay-policy=no-user-gesture-required',
    // silent: a suite plays the episodes, never on the user's speakers (user request 19/10/2026: « coupe le son, j'arrive
    // pas à écouter mes autres projets »); the sound still runs inside (decoded, its AudioContext's clock), only not heard
    '--mute-audio',
    '--window-size=1600,1000', '--no-first-run', '--no-default-browser-check', ...args, 'about:blank'], { stdio: 'ignore' });
  let ver;
  for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await new Promise((r) => setTimeout(r, 200)); } }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const wait = new Map(), handlers = [];
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && wait.has(d.id)) { const { res, rej } = wait.get(d.id); wait.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); }
    else for (const h of handlers) h(d);
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; wait.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  const logs = [];
  handlers.push((d) => {
    if (d.sessionId !== sessionId) return;
    if (d.method === 'Runtime.consoleAPICalled') logs.push(`[${d.params.type}] ${d.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    if (d.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`);
  });
  await s('Runtime.enable'); await s('Page.enable');
  // the frames of the page in a process of their own (the studio's live preview, page/studio/00-remote.js): attached, so
  // that a test can evaluate there too (frameEval) and see their errors
  const frames = new Set();   // their sessions, oldest first
  handlers.push((d) => {
    if (d.method === 'Target.attachedToTarget' && d.params.targetInfo.type === 'iframe') {
      const fsid = d.params.sessionId; frames.add(fsid);
      send('Runtime.enable', {}, fsid).catch(() => {});
      send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, fsid).catch(() => {});
    }
    if (d.method === 'Target.detachedFromTarget') frames.delete(d.params.sessionId);
    if (frames.has(d.sessionId)) {
      if (d.method === 'Runtime.consoleAPICalled') logs.push(`[frame ${d.params.type}] ${d.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
      if (d.method === 'Runtime.exceptionThrown') logs.push(`[frame exception] ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`);
    }
  });
  await s('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  // an expression evaluated in such a frame — the newest whose address contains match ('player.html'); no frame: null
  const frameSid = async (match) => {
    for (const sid of [...frames].reverse()) {
      const u = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, sid).catch(() => null);
      const href = String(u?.result?.value ?? '');
      if (/^https?:\/\//.test(match) ? href === match : href.includes(match)) return sid;
    }
    return null;
  };
  const frameEval = async (match, expr) => {
    const sid = await frameSid(match); if (!sid) return null;
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }, sid);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  // a raw DevTools command in such a frame (its profiler, its memory…); no frame: null
  const frameSend = async (match, method, params = {}) => { const sid = await frameSid(match); return sid ? send(method, params, sid) : null; };
  await s('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  const page = {
    logs,
    send: s,   // a raw DevTools command on this page (memory counters, garbage collection…)
    frameEval,   // an expression in a frame of the page that runs in a process of its own (the live preview)
    frameSend,   // a raw DevTools command there
    onEvent: (fn) => handlers.push((d) => { if (d.sessionId === sessionId && d.method) fn(d); }),   // its DevTools events
    // a heap snapshot of the page, written to file (what keeps what alive)
    snapshot: async (file) => { const parts = [], h = (d) => { if (d.sessionId === sessionId && d.method === 'HeapProfiler.addHeapSnapshotChunk') parts.push(d.params.chunk); }; handlers.push(h); await s('HeapProfiler.enable'); await s('HeapProfiler.takeHeapSnapshot', { reportProgress: false }); handlers.splice(handlers.indexOf(h), 1); fs.writeFileSync(file, parts.join('')); },
    goto: async (url) => { await s('Page.navigate', { url }); await new Promise((r) => setTimeout(r, 1500)); },
    eval: async (expr) => {
      const r = await s('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    until: async (expr, ms = 30000) => { const t0 = Date.now(); for (;;) { if (await page.eval(`return !!(${expr})`)) return true; if (Date.now() - t0 > ms) throw new Error(`timeout: ${expr}`); await new Promise((r) => setTimeout(r, 250)); } },
    shot: async (file) => { const { data } = await s('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(data, 'base64')); return file; },
    mouse: (type, x, y) => s('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }),
    // modifiers: Alt 1, Ctrl 2, Meta 4, Shift 8 (a real key press, as the user's: it goes to the focused field first)
    key: (key, code, text, modifiers = 0) => s('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text, modifiers, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : ({ Enter: 13, Escape: 27 }[key] ?? 0) }).then(() => s('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers })),
    type: (text) => s('Input.insertText', { text }),
    wheel: (x, y, deltaY, modifiers = 0) => s('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, modifiers }),
    // the window's size (the layout on a smaller or a larger screen); the page gets its « resize »
    size: (width, height) => s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }),
    // Chrome stopped, then its profile deleted (09/10/2026: 608 profiles of earlier runs had piled up in %TEMP%, 124 GB)
    close: async () => {
      try { ws.close(); } catch { /* */ }
      chrome.kill();
      await new Promise((r) => { if (chrome.exitCode !== null) return r(); chrome.once('exit', r); setTimeout(r, 3000); });
      for (let i = 0; i < 15; i++) { try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 300)); } }
    },
  };
  return page;
}

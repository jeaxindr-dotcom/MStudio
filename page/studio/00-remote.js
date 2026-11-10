// The studio's page (studio.html), part 00-remote: the live preview in a process of its own (user request, 18/10/2026:
// « faire tourner [l'aperçu] dans son propre processus »). The page is 127.0.0.1, the preview is shown from localhost —
// another site for the browser: its own process, its own thread; its 3D, its React never hold the page any more, nor the
// page it. The page cannot touch it directly any more: it speaks with it by messages (player/bridge.js inside it), and
// remotePlayer(frame) is the same StudioPlayer for the rest of the page:
//   - what is read often is read at once, from what the preview last said (its frame, playing or not, its frame complete
//     or not, stopped by an error, its staging's objects and the one chosen); what the page does to it is told to it,
//     and counted as done here at once (a seek, a play, an offset);
//   - what needs its answer is a promise (a pick, a capture, the frame complete, its camera…).
// ?apercu=page in the studio's address: the preview in the page's own process again, as before (to compare).
// The parts of page/studio/ are one script: studio-server.mjs joins them in their order inside one function (/studio.js),
// so they share their names as the one inline script did; hence the two-space indent.
  // (from the iPad, through Tailscale — lib/remote.mjs: the page's own name only; « localhost » would be the iPad itself)
  const PREVIEW_OWN = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && !/[?&]apercu=page\b/.test(location.search);
  const PREVIEW_ORIGIN = !PREVIEW_OWN ? location.origin : `${location.protocol}//${location.hostname === 'localhost' ? '127.0.0.1' : 'localhost'}:${location.port}`;
  // A preview whose process FROZE (an endless loop, a GPU hang) keeps that process for ever: Chrome puts every new frame of
  // the same site in it, frozen too (measured 31/10/2026: still frozen 6 s after the frame was removed). « Réessayer »
  // then loads the new preview from a name of its own (p<n>.localhost: always this machine for Chrome, another site):
  // a new process. Every later version stays on that name.
  let previewOrigin = PREVIEW_ORIGIN;
  const previewOrigins = new Set([PREVIEW_ORIGIN]);
  const freshPreviewOrigin = () => {
    if (!PREVIEW_OWN) return previewOrigin;   // (the iPad: one name only)
    previewOrigin = `${location.protocol}//p${Date.now().toString(36)}.localhost:${location.port}`; previewOrigins.add(previewOrigin);
    return previewOrigin;
  };
  const previewUrl = (q) => `${previewOrigin}/player.html?${q}`;
  const remotes = new Map();   // a preview frame's window -> its remote player
  window.addEventListener('message', (e) => {
    if (!previewOrigins.has(e.origin)) return;
    const d = e.data; if (!d || d.coulissesPreview !== 1) return;
    const r = remotes.get(e.source); if (!r || r.origin !== e.origin) return;
    r.receive(d);
    // a key typed in the preview that is the studio's (player/keys.ts toParent): played here as if typed here
    if (d.key && r) window.dispatchEvent(new KeyboardEvent(d.key.type, { key: d.key.key, code: d.key.code, shiftKey: d.key.shiftKey, ctrlKey: d.key.ctrlKey, altKey: d.key.altKey, metaKey: d.key.metaKey, bubbles: true }));
  });
  // the user's keys changed (Aide › Raccourcis clavier): the previews read them again (their staging keys W / E / R)
  window.Shortcuts?.onChange?.(() => { for (const [w, r] of remotes) try { w.postMessage({ coulissesPreview: 1, shortcuts: 1 }, r.origin); } catch { /* gone */ } });
  const ZERO_D = { p: [0, 0, 0], r: [0, 0, 0], s: 1 };
  const zeroDelta = (d) => !d || ((d.p ?? [0, 0, 0]).every((v) => Math.abs(v) < 1e-9) && (d.r ?? [0, 0, 0]).every((v) => Math.abs(v) < 1e-9) && Math.abs((d.s ?? 1) - 1) < 1e-9);
  // ver: the version this player loads (?v= of its address): a hello from the document that frame is leaving is not its own
  // Calls end: an answer, or after their time (a preview whose process hangs or crashed never answers: the pointer,
  // the staging, the identify kept waiting for ever — code review 18/10/2026), y compris les appels de préparation.
  // The page's own writes (a seek, play / pause, an offset) are numbered: the state
  // the preview sent before it had them (its `seen`) does not take them back.
  const PREPARING = new Set(['whenReady', 'whenFrameReady', 'prepare', 'resume']), WRITE_F = new Set(['seek', 'play', 'pause', 'recover', 'prepare', 'unload', 'resume']), WRITE_S = new Set(['stage.setDelta', 'stage.reset', 'stage.select', 'stage.addCutout']);
  function remotePlayer(win, ver = null, origin = previewOrigin) {
    const M = { hello: null, frame: 0, playing: false, buffering: false, ready: false, loading: false, crashed: false, st: null, infos: new Map() };
    let seq = 0, helloRes = null, wroteF = 0, wroteS = 0, gone = false, lastSeen = performance.now(), silent = false;
    const waits = new Map(), evOn = new Set(), stOn = new Set();
    const hello = new Promise((r) => { helloRes = r; });
    const callWith = (extra, path, ...args) => new Promise((res, rej) => {
      if (gone) { rej(new Error('preview gone')); return; }
      const id = ++seq;
      if (WRITE_F.has(path)) wroteF = id; if (WRITE_S.has(path)) wroteS = id;
      const timeout = PREPARING.has(path) ? 95000 : path === 'stage.snapshot' || path === 'pickMany' || path === 'pick' ? 30000 : 15000;
      const timer = setTimeout(() => { if (waits.delete(id)) rej(new Error(`Aperçu sans réponse (${path})`)); }, timeout);
      waits.set(id, { res, rej, timer });
      try { win.postMessage({ coulissesPreview: 1, call: path, id, args: plain(args), ...extra }, origin); } catch (e) { clearTimeout(timer); waits.delete(id); rej(e); }
    });
    const call = (path, ...args) => callWith(null, path, ...args);
    const send = (path, ...args) => { call(path, ...args).catch(() => {}); };
    const setState = (s) => {
      if (!s) return;
      const freshF = !(s.seen < wroteF), freshS = !(s.seen < wroteS);   // (sent before the preview had the page's last write: not its frame / offsets)
      if (freshF) {
        M.frame = s.frame ?? M.frame; M.playing = !!s.playing;
        M.ready = s.ready === true; M.loading = !!s.loading; M.crashed = !!s.crashed; M.buffering = !!s.buffering;
        if (s.readiness) M.readiness = s.readiness;
      }
      M.scene3d = !!s.scene3d;
      if (s.stage !== undefined && freshS) {
        M.st = s.stage;
        if (s.stage) {   // the objects moved, as the preview says; the one chosen kept (its info from its « select »)
          const keep = s.stage.selected ? M.infos.get(s.stage.selected) : null;
          M.infos = new Map((s.stage.list ?? []).map((x) => [x.id, x]));
          if (keep && !M.infos.has(keep.id)) M.infos.set(keep.id, keep);
        }
      }
    };
    function receive(d) {
      if (gone || (d.v !== undefined && ver !== null && String(d.v) !== String(ver))) return;
      lastSeen = performance.now(); silent = false;
      if (d.hello) { if (ver !== null && d.hello.v !== undefined && String(d.hello.v) !== String(ver)) return; M.hello = d.hello; setState(d.state); helloRes(api); return; }
      if (d.state) setState(d.state);
      if (d.re) {
        const w = waits.get(d.re); if (!w) return;
        clearTimeout(w.timer); waits.delete(d.re);
        if (d.ok) w.res(d.value);
        else { const error = new Error(d.error ?? 'preview'); error.name = d.errorName || 'Error'; w.rej(error); }
        return;
      }
      if (d.ev) {
        const ev = d.ev;
        const freshF = !(ev.seen < wroteF);   // (a frame of before the page's last seek: not taken)
        if (!freshF && ['ready-error','loading','loaded','waiting','resume'].includes(ev.type)) return;
        if (freshF && Number.isFinite(ev.frame)) M.frame = ev.frame;
        if (freshF && ev.type === 'play') M.playing = true;
        else if (freshF && (ev.type === 'pause' || ev.type === 'ended')) M.playing = false;
        else if (freshF && ev.type === 'loading') { M.loading = true; M.ready = false; }
        else if (freshF && ev.type === 'loaded') { M.loading = false; M.ready = true; }
        else if (ev.type === 'error') M.crashed = true;
        if (ev.type === 'waiting') M.buffering = true;
        if (ev.type === 'resume') M.buffering = false;
        for (const f of evOn) f(ev);
      }
      if (d.stageEv) {
        const ev = d.stageEv;
        if (ev.id && (ev.type === 'select' || ev.type === 'change' || ev.type === 'cutout')) { const { type, ...info } = ev; void type; M.infos.set(ev.id, { ...(M.infos.get(ev.id) ?? {}), ...info }); }
        if (M.st) { if (ev.type === 'select') M.st.selected = ev.id; if (ev.type === 'deselect') M.st.selected = null; }
        for (const f of stOn) f(ev);
      }
    }
    const stage = {
      get kind() { return M.st?.kind ?? null; }, get enabled() { return !!M.st?.enabled; }, get selected() { return M.st?.selected ?? null; }, get scene3d() { return !!M.scene3d; },
      hasScene: () => call('stage.scene3d'),   // (asked now: its 3D scene mounted)
      enable: (want) => call('stage.enable', want),   // (a promise: true once the scene is there)
      on: (fn) => { stOn.add(fn); return () => stOn.delete(fn); },
      list: () => [...M.infos.values()].filter((x) => !zeroDelta(x.delta) || x.cutout),
      info: (id) => M.infos.get(id) ?? { id, delta: plain(ZERO_D), from: undefined, to: undefined, base: null },
      infoNow: (id) => call('stage.info', id),
      has: (id) => M.infos.has(id),
      // (its scope kept when none is given, as the stages do; { quiet: true }: an undo or a redo, its « change » said quiet)
      setDelta: (id, d, from, to, opts) => {
        const o = M.infos.get(id) ?? { id }; M.infos.set(id, { ...o, delta: plain(d), from: from ?? o.from, to: to ?? o.to });
        callWith(opts?.quiet ? { quiet: true } : null, 'stage.setDelta', id, d, from, to).catch(() => {});
      },
      reset: (id) => { M.infos.delete(id); if (M.st?.selected === id) M.st.selected = null; send('stage.reset', id); },
      select: (id) => { if (M.st) M.st.selected = id; send('stage.select', id); },
      selectParent: () => call('stage.selectParent'),
      setMode: (m) => send('stage.setMode', m),
      freeCamera: (want, pose) => call('stage.freeCamera', want, pose ?? null),
      freePose: () => call('stage.freePose'),
      resetCamera: () => call('stage.resetCamera'),
      snapshot: () => call('stage.snapshot'),
      screenPos: (id) => call('stage.screenPos', id),
      edits: () => call('stage.edits'),
      applyNow: () => send('stage.applyNow'),
      addCutout: (spec) => call('stage.addCutout', spec).then((c) => { if (c?.id) M.infos.set(c.id, c); return c; }),
    };
    const api = {
      remote: true,
      frameReadiness: () => M.readiness ? {...M.readiness} : null,
      get durationInFrames() { return M.hello?.durationInFrames ?? 0; }, get fps() { return M.hello?.fps; }, get width() { return M.hello?.width; }, get height() { return M.hello?.height; },
      get ok() { return !!M.hello?.ok; }, get generic() { return !!M.hello?.generic; }, get composition() { return M.hello?.composition; }, get episode() { return M.hello?.episode; }, get hyperframes() { return !!M.hello?.hyperframes; },
      get stage() { return M.hello?.stage ? stage : undefined; },
      frame: () => M.frame, isPlaying: () => M.playing, isBuffering: () => M.buffering, frameReady: () => M.ready, frameLoading: () => M.loading, crashed: () => M.crashed,
      seek: (f) => { M.readiness = null; M.frame = Math.max(0, Math.min((M.hello?.durationInFrames ?? 1) - 1, Math.round(f))); send('seek', f); },
      play: () => { M.playing = true; return call('play').catch((error) => { M.playing = false; throw error; }); }, pause: () => {
        // the preview frozen (a heavy scene mounting): the pause is queued behind the freeze; the frame on screen when it was
        // asked is where it stops, not where its clock ran meanwhile (user request 03/11/2026: « je ne peux pas l'interrompre »)
        const f = M.frame, frozen = performance.now() - lastSeen > 250;
        M.playing = false; send('pause'); if (frozen) send('seek', f);
      },
      setRate: (r) => send('setRate', r), setVolume: (v) => send('setVolume', v), mute: () => send('mute'), unmute: () => send('unmute'),
      restoreSound: () => call('restoreSound').catch(() => false),   // accusé de réception ; la preuve arrive par sound/back
      sleep: (on) => send('sleep', on), recover: (f) => { M.crashed = false; send('recover', f); }, __crash: () => send('__crash'),
      unload: () => { M.playing = false; M.ready = false; return call('unload'); },
      resume: (f) => call('resume', f),
      whenReady: () => call('whenReady'), whenFrameReady: () => call('whenFrameReady'),
      prepare: (frame) => call('prepare', frame),
      pick: (f, x, y) => call('pick', f, x, y), hover: (f, x, y) => call('hover', f, x, y), pickMany: (f, pts) => call('pickMany', f, pts),
      objects: () => call('objects'), cameraPos: () => call('cameraPos'),
      on: (fn) => { evOn.add(fn); return () => evOn.delete(fn); },
      // the frame of this player gone: its waiting calls end, its messages are no longer read
      dispose: () => {
        if (!gone) send('dispose');
        gone = true; clearInterval(health); if (remotes.get(win) === entry) remotes.delete(win);
        for (const w of waits.values()) { clearTimeout(w.timer); w.rej(new Error('preview gone')); } waits.clear(); evOn.clear(); stOn.clear(); helloRes(null);
      },
    };
    const entry = { receive, origin };
    // Une absence de message est un diagnostic de transport, pas une preuve de panne GPU.
    // Un onglet caché est ralenti par Chrome : aucune alarme tant qu'il reste caché.
    const health = setInterval(() => {
      const now = performance.now();
      if (document.hidden) { lastSeen = now; return; }
      if (!M.hello || gone || silent || now - lastSeen < 30000) return;
      silent = true; M.playing = false; M.ready = false; M.crashed = true;
      const ev = { type: 'error', frame: M.frame, error: { kind: 'transport', message: 'L’aperçu ne répond plus depuis 30 secondes. Réessayer pour le recharger.', where: 'communication avec l’aperçu', stack: '' } };
      for (const f of evOn) f(ev);
    }, 1000);
    remotes.set(win, entry);
    return { api, hello };
  }

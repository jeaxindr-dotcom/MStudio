// The live preview in a process of its own (user request, 18/10/2026: « faire tourner [l'aperçu] dans son propre
// processus »): the studio page (127.0.0.1) shows the preview from the other name of the machine (localhost), another
// site for the browser, so the preview has its own process and its own thread — its rendering never holds the page (the
// menus, the notes, the timeline), the page never holds it. Being another site, the page cannot touch it any more: this
// script, loaded after the player (player.html, the HyperFrames page), speaks for it by messages (page/studio/00-remote.js
// on the other side):
//   - the page's calls: { call: 'seek' | 'stage.setDelta' | …, id, args } → the player's own function, its answer
//     { re: id, ok, value | error } (a promise is waited for);
//   - the player's events (frame, play, pause, loading, error…) and its staging's (select, change…) as they come;
//   - its state (the frame, playing, the staging's objects) after every call and every staging event: the page reads it
//     at once, without asking;
//   - the keys typed in the preview that are the studio's (keys.ts toParent).
// Nothing happens when the preview is not inside a page (the server's own captures, a test opening player.html alone).
(() => {
  if (window.parent === window) return;
  const parentOrigin = (location.ancestorOrigins && location.ancestorOrigins[0]) || (document.referrer ? new URL(document.referrer).origin : '*');
  // the studio page only: a loopback address on this very port (another local page framing the preview cannot drive it)
  const loop = (o) => { try { const u = new URL(o); return /^(127\.0\.0\.1|localhost|\[::1\])$/i.test(u.hostname) && u.port === location.port; } catch { return false; } };
  const fromParent = (o) => o === location.origin || loop(o);   // (the same address: ?apercu=page, or the iPad through Tailscale)
  const release = window.__COULISSES_PREVIEW_RELEASE__ ?? { version: new URLSearchParams(location.search).get('v') };
  const owner = globalThis.crypto?.randomUUID?.() ?? `apercu-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let leaseLost = false;
  const lease = (drop = false) => {
    if (!release.hash) return;
    fetch('/api/preview-lease', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: release.hash, owner, release: drop }), keepalive: drop }).then(async (response) => {
      const state = await response.json();
      if (!drop && (!response.ok || state.ok === false) && !leaseLost) {
        leaseLost = true;
        post({ ev: { type: 'error', seen, frame: sp()?.frame() ?? 0, error: { kind: 'transport',
          message: 'Les ressources de cette ancienne version ont expiré. Réessayer pour charger une version disponible.', where: 'conservation de la version', stack: '' } } });
      } else if (!drop && response.ok && state.ok) leaseLost = false;
    }).catch(() => {});
  };
  lease();
  let leaseTimer = setInterval(lease, 20000);
  window.addEventListener('pageshow', (event) => {
    lease(); clearInterval(leaseTimer); leaseTimer = setInterval(lease, 20000);
    if (event?.persisted) { clearInterval(health); health = setInterval(beat, 1000); beat(); }
  });
  document.addEventListener?.('visibilitychange', () => { if (!document.hidden) lease(); });
  let seen = 0;   // the last call of the page this preview has done (in every state and event: the page knows what is fresh)
  const plainOf = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const post = (m) => {
    const msg = { coulissesPreview: 1, v: release.version, ...m };
    try { window.parent.postMessage(msg, parentOrigin); return; } catch { /* below */ }
    try { window.parent.postMessage(plainOf(msg), parentOrigin); return; } catch { /* below */ }   // (a value that cannot be copied: as JSON)
    if (m.re) try { window.parent.postMessage({ coulissesPreview: 1, v: release.version, re: m.re, ok: false, error: 'not to be sent' }, parentOrigin); } catch { /* */ }   // (the page's call still ends)
  };
  const sp = () => window.StudioPlayer;
  const stageState = () => {
    const st = sp()?.stage; if (!st) return null;
    let list = []; try { list = st.list(); } catch { /* not mounted yet */ }
    return { kind: st.kind ?? null, enabled: !!st.enabled, selected: st.selected ?? null, scene3d: !!st.scene3d, list };
  };
  const stateOf = (withStage) => {
    const p = sp(); if (!p) return null;
    const frame = p.frame(), status = p.frameReadiness?.();
    const readiness = status && {frame, state:status.state, verified:status.verified === true, reason:status.reason ?? null,
      staleLegacy:status.staleLegacy || 0, version:release.version, hash:release.hash || null};
    const s = { seen, frame, playing: !!p.isPlaying(), buffering: !!p.isBuffering?.(), ready: status ? status.displayable : p.frameReady?.() !== false, readiness, loading: !!p.frameLoading?.(), crashed: !!p.crashed?.(), scene3d: !!p.stage?.scene3d };
    if (withStage) s.stage = stageState();
    return s;
  };
  let stageT = 0, inCall = false;
  const pushStage = () => { if (inCall || stageT) return; stageT = setTimeout(() => { stageT = 0; post({ state: stateOf(true) }); }, 100); };
  // a call the page made « quiet » (an undo, a redo: its own offset put back): the staging events it causes say so, the
  // page does not count them as a new step (they used to come during the call itself, the page then quiet)
  let quiet = false;
  window.addEventListener('message', async (e) => {
    if (e.source !== window.parent || !fromParent(e.origin)) return;
    const d = e.data; if (!d || d.coulissesPreview !== 1) return;
    if (d.shortcuts) { try { await window.Shortcuts?.reload?.(); } catch { /* the defaults */ } return; }   // the user's keys changed (Aide › Raccourcis clavier)
    if (d.probe === true) { post({probe: true}); return; }
    if (typeof d.call !== 'string') return;
    let value, ok = true, error = null, errorName;
    seen = Math.max(seen, d.id || 0); inCall = true;
    try {
      if (d.call === 'prepare') {
        const p = sp();
        if (!p) throw new Error('Lecteur absent');
        const frame = Math.max(0, Math.min(p.durationInFrames - 1, Math.round(Number(d.args?.[0]) || 0)));
        p.pause(); p.seek(frame);
        await p.whenReady();
        if (p !== sp() || p.frame() !== frame || p.frameReady?.() === false || p.isBuffering?.() || p.crashed?.()) throw new Error('L’image demandée n’est pas prête');
        value = { frame, ready: true };
      } else {
      const parts = d.call.split('.'), name = parts.pop();
      let o = sp(); for (const k of parts) o = o?.[k];
      if (!o) throw new Error(`StudioPlayer.${d.call}: absent`);
      let r;
      if (typeof o[name] === 'function') { quiet = !!d.quiet; try { r = o[name](...(d.args ?? [])); } finally { quiet = false; inCall = false; } } else r = o[name];
      value = await r;
      }
    } catch (err) { ok = false; error = String(err?.message ?? err); errorName = err?.name; }
    inCall = false;
    const state = stateOf(d.call.startsWith('stage.') || d.call === 'recover');
    if (d.id) post({ re: d.id, ok, value: ok ? value : undefined, error, errorName, state });
    else post({ state });
  });
  // the player there: what it is, then its events
  (function hello() {
    const p = sp();
    if (!p) { setTimeout(hello, 50); return; }
    post({ hello: { v: release.version, hash: release.hash, durationInFrames: p.durationInFrames, fps: p.fps, width: p.width, height: p.height, ok: p.ok, generic: !!p.generic, composition: p.composition ?? null, episode: p.episode ?? null, stage: !!p.stage, hyperframes: !!p.hyperframes }, state: stateOf(true) });
    p.on((ev) => {
      // The last inspected frame and its quality travel together on seek,
      // load and pause. Playback frameupdate does not scan the entire scene.
      const report = ['seeked','pause','loaded','loading','ready-error','error','waiting','resume'].includes(ev.type);
      post({ ev: { ...ev, seen }, ...(report ? {state:stateOf(false)} : {}) });
    });
    p.stage?.on?.((ev) => { post({ stageEv: quiet ? { ...ev, quiet: true } : ev }); pushStage(); });
  })();
  const beat = () => { if (sp()) post({ heartbeat: true, state: stateOf(false) }); };
  let health = setInterval(beat, 1000);
  window.addEventListener('pagehide', () => { clearInterval(health); clearInterval(leaseTimer); lease(true); });
  window.addEventListener('webglcontextlost', (e) => {
    if (!e.target?.isConnected) return;
    post({ ev: { type: 'error', seen, frame: sp()?.frame() ?? 0,
      error: { kind: 'webgl', message: 'Le contexte graphique de l’aperçu a été perdu.', where: 'canvas WebGL', stack: '' } } });
  }, true);
})();

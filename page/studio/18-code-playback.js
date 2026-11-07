  // Préparation explicite d'une plage du code : une seule session possède le Player
  // suspendu et le travail serveur. Aucun retour au direct avant annulation confirmée.
  {
    const words = (fr, en) => typeof FR !== 'undefined' && !FR ? en : fr;
    const transport = Object.getOwnPropertyDescriptors(M);
    const button = document.createElement('button'), back = document.createElement('button');
    const panel = document.createElement('div'), label = document.createElement('span');
    const film = document.createElement('video');
    button.id = 'prepareCodeRange'; button.textContent = words('Préparer 30 s', 'Prepare 30 s');
    button.title = words('Calculer une plage du code courant ; durée de préparation variable selon la scène', 'Prepare a range of the current code; preparation time depends on the scene');
    back.id = 'returnLiveCode'; back.textContent = words('Revenir au direct', 'Return to live code'); back.hidden = true;
    panel.id = 'codeRangeTools'; panel.hidden = true; panel.append(button, back, label); media.after(panel);
    film.id = 'codeRangeVideo'; film.playsInline = true; film.preload = 'auto'; film.hidden = true; codeEl.after(film);
    let session = null, leaving = null, parked = null, waking = null, pollBusy = false, modeSerial = 0;
    const active = () => !!session;
    const current = (s) => session === s && !s.closing && SP === s.sp && codeVer === s.version &&
      STATUS.code?.status === 'ready' && STATUS.code.version === s.version && (!s.hash || STATUS.code.hash === s.hash);
    const ready = () => !!session && !session.closing && session.job?.status === 'ready' && !film.hidden && film.readyState >= 2;
    const rangeFps = () => session?.job?.fps || FPS;
    const note = (text) => { label.textContent = text; };
    const json = async (url, body) => {
      const r = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error ?? words('Préparation indisponible', 'Preparation unavailable')); return d;
    };
    async function leave(frame, resumeLive = true) {
      const s = session; if (!s) return;
      s.returnToLive = resumeLive;
      if (Number.isFinite(frame)) s.target = Math.max(0, Math.min(s.sp.durationInFrames - 1, Math.round(frame)));
      else if (!s.closing && ready()) s.target = Math.min(s.job.to - 1, Math.floor(s.job.from + film.currentTime * rangeFps()));
      if (leaving) return leaving;
      s.closing = true; film.pause(); film.hidden = true; film.removeAttribute('src'); film.load();
      note(words('Arrêt de la préparation puis retour au direct…', 'Stopping preparation, then returning to live code…'));
      leaving = (async () => {
        // Une réponse de création peut encore arriver. Son propriétaire permet aussi
        // d'annuler si la réponse HTTP a été perdue après démarrage du travail serveur.
        await s.start;
        if (s.requested) await json('/api/code-playback/cancel', { owner: s.owner, id: s.job?.id });
        if (session !== s || SP !== s.sp) throw new Error(words('L’aperçu a changé pendant le retour au direct', 'The preview changed while returning to live code'));
        if (!s.returnToLive) {
          s.sp.seek(s.target); parked = { sp: s.sp, frame: s.target }; session = null;
          codeWait(false); back.hidden = true; note(words('Aperçu en sommeil', 'Preview suspended')); return;
        }
        let restored = s.target;
        await s.sp.resume(restored);
        while (session === s && restored !== s.target) { restored = s.target; await s.sp.prepare(restored); }
        if (session !== s || SP !== s.sp) throw new Error(words('L’aperçu a changé pendant sa reprise', 'The preview changed while resuming'));
        s.sp.setRate(rate); s.sp.setVolume(vol);
        session = null; RS.wait = !!s.sp.isBuffering?.(); rsStatus();
        if ((STATUS.code?.version ?? codeVer) !== codeVer) await loadCode();
        codeWait(false); back.hidden = true; note(words('Code en direct', 'Live code')); fire('pause'); fire('seeked');
      })().catch((e) => {
        note(words(`Retour au direct interrompu : ${e.message}. Réessayer.`, `Return to live code interrupted: ${e.message}. Retry.`)); setSave(e.message, 'err');
        if (session === s) s.closing = false;
        throw e;
      }).finally(() => { leaving = null; });
      return leaving;
    }
    async function wake(frame = curFrame()) {
      if (!parked) return; if (waking) return waking;
      const saved = parked;
      waking = (async () => {
        if (SP !== saved.sp) { parked = null; return; }
        await saved.sp.resume(frame);
        if (SP !== saved.sp) throw new Error(words('L’aperçu a changé pendant sa reprise', 'The preview changed while resuming'));
        saved.sp.setRate(rate); saved.sp.setVolume(vol); parked = null;
        RS.wait = !!saved.sp.isBuffering?.(); rsStatus();
      })().finally(() => { waking = null; });
      return waking;
    }
    const requestLeave = (frame) => { void leave(frame).catch(() => {}); };
    preparedCode = { active, leave, parked: () => !!parked, wake };
    Object.defineProperties(M, {
      currentTime: { configurable: true, get() { return ready() ? (session.job.from / rangeFps() + film.currentTime) : active() ? session.target / FPS : transport.currentTime.get.call(M); },
        set(t) {
          if (!active()) return transport.currentTime.set.call(M, t);
          const f = Math.floor(t * FPS);
          if (ready() && current(session) && f >= session.job.from && f < session.job.to) { film.currentTime = (f - session.job.from) / rangeFps(); fire('seeked'); }
          else requestLeave(f);
        } },
      paused: { configurable: true, get: () => active() ? !ready() || film.paused : transport.paused.get.call(M) },
      seeking: { configurable: true, get: () => active() ? film.seeking : transport.seeking.get.call(M) },
      playbackRate: { configurable: true, get: () => rate, set(r) { film.playbackRate = r; if (active()) { rate = r; v.playbackRate = r; } else transport.playbackRate.set.call(M, r); } },
      volume: { configurable: true, set(x) { film.volume = x; if (active()) { vol = x; v.volume = x; RS.el?.pause(); } else transport.volume.set.call(M, x); } },
    });
    M.play = () => {
      if (!active()) return transport.play.value.call(M);
      if (!current(session)) { requestLeave(); return; }
      if (!ready()) return note(words('La plage est encore en préparation.', 'The range is still being prepared.'));
      film.play().catch((e) => { if (aborted(e)) return; note(words(`Lecture refusée : ${e.message}`, `Playback refused: ${e.message}`)); fire('pause'); });
    };
    M.pause = () => { film.pause(); if (!active()) transport.pause.value.call(M); else fire('pause'); };
    const originalSound = restoreSound;
    restoreSound = async () => {
      if (!active()) return originalSound();
      RS.el?.pause();
      if (!ready() || !current(session)) { note(words('Le son sera disponible après la préparation de la plage.', 'Sound will be available after the range is prepared.')); return; }
      session.restoreTime = film.currentTime;
      session.target = Math.floor(session.job.from + film.currentTime * rangeFps());
      film.pause(); film.muted = false; film.volume = vol; film.hidden = true; codeWait(true);
      film.load(); note(words('Son de la plage rechargé. Cliquer sur Lecture pour reprendre.', 'Range sound reloaded. Click Play to resume.')); fire('pause');
    };
    for (const type of ['play', 'pause', 'seeked', 'ended']) film.addEventListener(type, () => { if (active()) fire(type === 'ended' ? 'pause' : type); });
    film.addEventListener('loadedmetadata', () => {
      if (!session || !current(session) || session.restoreTime === undefined) return;
      film.currentTime = session.restoreTime; delete session.restoreTime; film.pause(); fire('seeked');
    });
    film.addEventListener('loadeddata', () => {
      if (!session || session.job?.status !== 'ready' || !current(session) || film.readyState < 2 ||
          film.getAttribute('src') !== `/api/code-playback/${encodeURIComponent(session.job.id)}.mp4`) return;
      film.hidden = false; codeWait(false); fire('seeked');
    });
    film.addEventListener('error', () => { if (active()) { note(words('La plage préparée ne peut pas être lue. Revenir au direct.', 'The prepared range cannot be played. Return to live code.')); film.pause(); } });
    back.onclick = () => requestLeave();
    button.onclick = async () => {
      if (active() || mode !== 'code' || !SP || staging || codeLoading || STATUS.code?.status !== 'ready' || STATUS.code.version !== codeVer) return;
      const s = { sp: SP, target: curFrame(), version: codeVer, hash: STATUS.code.hash, job: null, requested: false, closing: false,
        owner: globalThis.crypto?.randomUUID?.() ?? `plage-${Date.now()}-${Math.random().toString(36).slice(2)}`, start: null };
      transport.pause.value.call(M); cancelCodePreparation(); session = s; back.hidden = false;
      RS.el?.pause(); note(words('Préparation du code courant…', 'Preparing the current code…')); codeWait(true);
      s.start = (async () => {
        await s.sp.unload();
        if (!current(s)) return;
        s.requested = true;
        const width = Number.isInteger(s.sp.width) && s.sp.width > 0 ? s.sp.width : CW;
        const height = Number.isInteger(s.sp.height) && s.sp.height > 0 ? s.sp.height : CH;
        const state = await json('/api/code-playback', { owner: s.owner, from: s.target, to: Math.min(s.sp.durationInFrames, s.target + Math.round(FPS * 30)), version: s.version, width, height });
        s.job = state; // conservé même si le retour a commencé, pour attendre son annulation
      })().catch((e) => { if (session === s) { note(e.message); codeWait(false); setSave(e.message, 'err'); } });
      await s.start;
    };
    const originalMode = setMode;
    setMode = async (m) => {
      const token = ++modeSerial;
      try { if (active()) await leave(undefined, m === 'code'); if (m === 'code') await wake(); }
      catch (e) { note(e.message); setSave(e.message, 'err'); return; }
      if (token !== modeSerial) return;
      return originalMode(m);
    };
    const originalStaging = setStaging;
    setStaging = async (...args) => { if (active()) { try { await leave(); } catch { return; } } return originalStaging(...args); };
    setInterval(async () => {
      panel.hidden = mode !== 'code' || META?.engine !== 'remotion';
      button.disabled = active() || !!codeLoading || !SP || staging || STATUS.code?.status !== 'ready' || STATUS.code.version !== codeVer;
      const s = session; if (!s || leaving || s.closing) return;
      if (!current(s)) { film.pause(); requestLeave(); return; }
      if (!s.job || pollBusy) return;
      pollBusy = true;
      try {
        const state = await json(`/api/code-playback?id=${encodeURIComponent(s.job.id)}`);
        if (!current(s)) { if (session === s && !s.closing) requestLeave(); return; }
        if (state.id !== s.job.id || state.current === false || (s.hash && state.hash !== s.hash)) throw new Error(words('La plage préparée ne correspond plus au code affiché', 'The prepared range no longer matches the displayed code'));
        s.job = state;
        if (state.status === 'ready') {
          const src = `/api/code-playback/${encodeURIComponent(state.id)}.mp4`;
          if (film.getAttribute('src') !== src) { film.src = src; film.volume = vol; film.playbackRate = rate; }
          note(words(`Code v${s.version} · plage ${Math.floor(state.from / state.fps)}–${Math.ceil(state.to / state.fps)} s · Lecture pour démarrer`, `Code v${s.version} · range ${Math.floor(state.from / state.fps)}–${Math.ceil(state.to / state.fps)} s · Click Play to start`));
        } else if (['error', 'cancelled'].includes(state.status)) {
          film.pause(); film.hidden = true; codeWait(false); note(state.reason ?? state.error ?? words('Plage annulée. Revenir au direct.', 'Range cancelled. Return to live code.'));
        } else note(state.status === 'queued' ? words('En attente : la priorité est au rendu en cours.', 'Waiting: the current render has priority.') : words(`Préparation du code : ${Math.round((state.progress ?? 0) * 100)} %`, `Preparing code: ${Math.round((state.progress ?? 0) * 100)} %`));
      } catch (e) { if (session === s && !s.closing) { film.pause(); film.hidden = true; codeWait(false); note(e.message); } }
      finally { pollBusy = false; }
    }, 1000);
  }

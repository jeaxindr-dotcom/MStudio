// The studio's page (studio.html), part 01: the media: the rendered MP4 or the live preview of the code (its versions), time helpers, a 3D object in words.
// The parts of page/studio/ are one script: studio-server.mjs joins them in their order inside one function (/studio.js),
// so they share their names as the one inline script did; hence the two-space indent.
  // ---------- media: the rendered MP4, or the live preview of the code (Remotion Player in an iframe) ----------
  const aborted = (e) => e?.name === 'AbortError' || /interrupted by a (new load request|call to pause)/i.test(String(e?.message ?? ''));
  let mode = 'video', SP = null, codeVer = -1, codeLoading = null, rate = 1, vol = 1, preparedCode = null;
  let soundRepair = null;
  const bus = new EventTarget();
  const fire = (t) => bus.dispatchEvent(new Event(t));
  const M = {
    get currentTime() { return mode === 'code' && SP ? ((pendF ?? SP.frame()) + 0.5) / FPS : v.currentTime; },
    set currentTime(t) {
      if (mode === 'code' && SP) {
        const f = Math.floor(t * FPS), now = performance.now(), quick = now - lastStep < 250;
        if (f !== SP.frame() && !codeLoad?.repair) cancelCodePreparation();
        if (crash) { codeRecover(f); v.currentTime = t; return; }   // after an error, the next move mounts the Player again there
        lastStep = now;
        // moving (the arrows held, steps in a row, a drag on the timeline): the frames as they come, no veil — the motion is
        // what is judged; the frame where it stops is watched (codeSettle)
        if (soundRepair?.rebuilding || SP.isPlaying() || shuttle || quick || drag?.mode === 'scrub') { pendF = null; cwSeq++; codeWaitEl.classList.remove('pend', 'pend-key', 'on'); SP.seek(f); if (!SP.isPlaying()) codeSettle(); }
        else if (f !== (pendF ?? SP.frame())) codeStep(f);
      }
      v.currentTime = t;
      if (rsOn()) rsAt(t);   // (the review sound there too)
    },
    get paused() {
      if (mode !== 'code') return v.paused;
      if (soundRepair?.rebuilding) return !soundRepair.play;
      return !SP?.isPlaying();
    },
    // (a play() overtaken by a pause() — a click on Lecture then on Pause, a move, a mode change — is the browser's
    // AbortError: the pause won, nothing failed; never said as « Lecture refusée », user report 07/11/2026)
    play() { if (mode === 'code' && soundRepair?.rebuilding) { soundRepair.play = true; fire('play'); return; }
      if (mode === 'code' && !SP) return;   // (the live preview not there yet: the hidden MP4 is never played in its place)
      if (mode === 'code' && SP) { cancelCodePreparation(); v.pause(); cwSeq++; codeWaitEl.classList.remove('pend', 'pend-key', 'on'); const sp = SP; Promise.resolve(sp.play()).then(() => { if (SP === sp && rsOn()) { sp.mute?.(); rsAt(M.currentTime); rsPlay(); } }).catch((e) => { if (SP === sp && !aborted(e)) { RS.el?.pause(); setSave(`Lecture refusée : ${e.message}`, 'err'); fire('pause'); } }); } else { const r = v.play(); r?.catch?.((e) => { if (!aborted(e)) setSave(`Lecture refusée : ${e.message}`, 'err'); }); } },   // playing: no veil
    pause() { if (soundRepair?.rebuilding) { soundRepair.play = false; fire('pause'); }
      if (mode === 'code' && SP) { SP.pause(); v.currentTime = (SP.frame() + 0.5) / FPS; } RS.el?.pause(); v.pause(); },
    get playbackRate() { return rate; },
    set playbackRate(r) { rate = r; v.playbackRate = r; SP?.setRate(r); if (RS.el) RS.el.playbackRate = r; },
    // (the volume moved: the sound is wanted — a mute of the preview's own, after a lag, taken back too: player/sound.ts)
    // (the review sound playing: the preview stays muted — its sound and this one together would be heard twice)
    set volume(x) { vol = x; v.volume = x; v.muted = false; if (RS.el) { RS.el.volume = x; RS.el.muted = false; } SP?.setVolume(x); if (!rsOn()) SP?.unmute?.(); },
    get seeking() { return mode === 'code' ? false : v.seeking; },
    on(t, f) { bus.addEventListener(t, f); },
  };
  ['play', 'pause', 'seeked', 'ended'].forEach((t) => v.addEventListener(t, () => { if (mode === 'video' || !SP) fire(t); }));
  // ---------- the review sound (lib/review-sound.mjs; user reports 24/10/2026: « le son fait que de se couper », « c'est
  // impossible de review la vidéo ») ----------
  // Un master externe explicitement configuré suit le Player. Le Player reste l'unique horloge :
  // aucun seek périodique n'est envoyé à la composition et aucun mix d'une autre version n'est adopté.
  const RS = { el: null, sig: null, version: null, wait: false };
  const rsOn = () => mode === 'code' && !!SP && !!RS.el;
  const rsAt = (t) => { try { RS.el.currentTime = Math.max(0, t); } catch { /* not loaded yet: its play sets it */ } };
  const rsPlay = () => {
    if (!rsOn() || RS.wait || SP.isBuffering?.() || M.paused) return;
    const el = RS.el;
    el.play()?.catch?.((e) => { if (RS.el === el) setSave(`Son de relecture refusé : ${e.message}`, 'err'); });
  };
  window.__rs = () => ({ on: rsOn(), sig: RS.sig, t: RS.el ? +RS.el.currentTime.toFixed(2) : null, paused: RS.el?.paused ?? null, ready: RS.el?.readyState ?? null });   // (the tests: tests/review-sound.mjs)
  function rsStatus() {
    const s = STATUS.reviewSound, ver = STATUS.code?.version ?? META?.code?.version ?? 0;
    const ok = s?.state === 'ready' && !!s.sig && !!SP && ver === codeVer && s.codeVersion === codeVer && STATUS.code?.status === 'ready';
    if (ok && (s.sig !== RS.sig || RS.version !== codeVer)) {
      const el = new Audio(); el.preload = 'auto'; el.src = `/api/review-sound/${s.sig}.m4a`; el.volume = vol; el.playbackRate = rate; el.preservesPitch = true;
      const first = !RS.el; if (RS.el) { RS.el.pause(); RS.el.removeAttribute('src'); RS.el.load(); }
      RS.el = el; RS.sig = s.sig; RS.version = codeVer; RS.wait = !!SP.isBuffering?.();
      if (mode === 'code' && SP) { SP.mute?.(); rsAt(M.currentTime); if (!M.paused) rsPlay(); }
      if (first) setSave(TN('st.rs.ready'), 'ok');
    } else if (!ok && RS.el) {   // its sound changed (mixed again: the preview's own meanwhile), or none any more
      RS.el.pause(); RS.el.removeAttribute('src'); RS.el.load(); RS.el = null; RS.sig = null; RS.version = null; RS.wait = !!SP?.isBuffering?.();
      if (SP) { SP.unmute?.(); SP.setVolume(vol); }
    }
  }
  // Une version candidate est préparée uniquement à l'arrêt. L'échange ne se fait qu'après
  // validation de l'image qui restera affichée, avec ses offsets et sa caméra. Toute attente
  // est suivie d'une vérification de génération ; une erreur conserve la version visible.
  let codeLoad = null, codeFailedVer = null;
  function loadCode({ fresh = false, frame = null, repair = null } = {}) {
    if (preparedCode?.parked?.()) return preparedCode.wake().then(() => loadCode({ fresh, frame, repair }));
    if (preparedCode?.active()) return Promise.resolve(SP);
    if (codeLoad?.repair && !repair) return codeLoad.promise;
    const ver = STATUS.code?.version ?? META?.code?.version ?? 0;
    // La génération zéro n’a aucun bundle publié : le premier statut ready
    // démarrera l’aperçu, sans iframe vouée à attendre son hello en vain.
    if (!ver) return Promise.resolve(SP);
    if (SP && codeVer === ver && !fresh) return Promise.resolve(SP);
    if (SP?.isPlaying()) { showCodeNote(`Version ${ver} disponible à la prochaine pause`); return Promise.resolve(SP); }
    if (codeLoad && codeLoad.ver === ver && !fresh) return codeLoad.promise;
    cancelCodePreparation();
    const old = SP, inPlace = !old, target = frame ?? (old ? old.frame() : (!META.render ? hashFrame() ?? curFrame() : curFrame()));
    const el = inPlace ? codeEl : document.createElement('iframe');
    if (!inPlace) { el.className = 'code-next'; el.title = codeEl.title || ''; for (const k of ['allow', 'allowfullscreen']) if (codeEl.hasAttribute(k)) el.setAttribute(k, codeEl.getAttribute(k)); codeEl.after(el); }
    const job = { ver, frame: el, dropped: false, repair };
    codeLoad = job; codeFailedVer = null;
    const valid = () => !job.dropped && codeLoad === job && SP === old &&
      (STATUS.code?.version ?? META?.code?.version ?? 0) === ver &&
      (!old || (!old.isPlaying() && (repair || old.frame() === target) && (mode === 'code' || modeWant === 'code')));
    const check = () => { if (!valid()) { const e = new Error('Préparation remplacée ou image déplacée'); e.stale = true; throw e; } };
    const deadline = (promise, ms, message) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      Promise.resolve(promise).then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
    if (inPlace) $('#codeStatus').textContent = T('st.code.loading');
    else {
      const base = repair ? TN('st.sound.preparing') : TN('st.code.preparingOld'), t0 = Date.now();
      showCodeNote(base);
      job.tick = setInterval(() => { if (codeLoad !== job) return; if (!valid()) { cancelCodePreparation(); return; } showCodeNote(`${base} ${Math.round((Date.now() - t0) / 1000)} s`); }, 1000);
    }
    const rem = remotePlayer(el.contentWindow, String(ver)); job.remote = rem;
    job.promise = Promise.resolve().then(async () => {
      try {
        const sp = await deadline(rem.hello, 60000, 'L’aperçu ne démarre pas (60 secondes)'); check();
        if (!sp) throw new Error('Aperçu fermé avant sa préparation');
        // Pendant une restauration, l'ancienne image reste déplaçable. La candidate
        // déjà chargée prépare la dernière position demandée avant l'échange.
        const targetFrame = () => Math.max(0, Math.min(sp.durationInFrames - 1, repair ? old.frame() : target));
        let f;
        const stagingBefore = staging, chosen = stSel?.id ?? null;
        const queued = plain(drafts().filter((n) => n.stage).map((n) => n.stage));
        const ids = new Set(queued.map((n) => n.id));
        const carry = plain(old?.stage?.list().filter((x) => !ids.has(x.id)) ?? []);
        const pose = old && stagingBefore && old.stage ? plain(await old.stage.freePose()) : null; check();
        const prepare = async () => {
          do {
            f = targetFrame();
            const proof = await deadline(sp.prepare(f), 95000, 'L’image demandée n’est pas prête (95 secondes)'); check();
            if (proof?.ready !== true || proof.frame !== f || sp.frame() !== f || sp.isBuffering?.() || !sp.frameReady()) throw new Error('L’image demandée n’a pas été validée');
          } while (targetFrame() !== f);
        };
        await prepare(); check();
        // Les modifications de scène sont appliquées à la candidate capturée, jamais à un SP global tardif.
        if (sp.stage) {
          for (const x of [...carry, ...queued.map((x) => ({ ...x, from: x.scope?.from, to: x.scope?.to }))]) {
            if (x.cutout && sp.stage.addCutout) { await sp.stage.addCutout(cutSpec(x)); check(); }
            sp.stage.setDelta(x.id, x.delta, x.from, x.to);
          }
          if (stagingBefore) {
            if (!(await sp.stage.enable(true))) throw new Error('La scène de la nouvelle version n’est pas disponible'); check();
            sp.stage.setMode(stMode);
            if(sp.stage.kind==='3d') {await sp.stage.setGuides?.(gridWanted);check();}
            if (pose && sp.stage.freeCamera) { await sp.stage.freeCamera(true, pose); check(); }
            if (chosen) sp.stage.select(chosen);
          }
          if (carry.length || queued.length || stagingBefore) { await prepare(); check(); }
        } else if (stagingBefore) throw new Error('La nouvelle version ne propose plus de mise en scène');
        if (old && stagingBefore && old.stage) {
          const currentPose = plain(await old.stage.freePose()); check();
          if (JSON.stringify(currentPose) !== JSON.stringify(pose)) {
            const e = new Error('La caméra a changé pendant la préparation'); e.stale = true; throw e;
          }
        }
        if (targetFrame() !== f || staging !== stagingBefore || (stSel?.id ?? null) !== chosen ||
            JSON.stringify(old?.stage?.list().filter((x) => !ids.has(x.id)) ?? []) !== JSON.stringify(carry) ||
            JSON.stringify(drafts().filter((n) => n.stage).map((n) => n.stage)) !== JSON.stringify(queued)) {
          const e = new Error('La mise en scène a changé pendant la préparation'); e.stale = true; throw e;
        }
        check();
        if (old) {
          stUnsub?.(); stUnsub = null; stSel = plain(stSel);
          old.dispose?.(); codeEl.remove(); el.className = ''; el.id = 'code'; codeEl = el;
        }
        // Après ce point, les déplacements déclenchés par adoptCode concernent le
        // Player adopté et ne doivent plus annuler sa transaction de préparation.
        codeLoad = null; codeLoading = null;
        SP = sp; codeVer = ver; window.__preview = sp;
        RS.wait = !!sp.isBuffering?.(); crash = null; codeErrEl.classList.remove('on');
        if (!META.render && sp.durationInFrames) adoptCode(sp);
        sp.setVolume(vol); sp.setRate(rate); watchPlayer(sp); rsStatus();
        codeWait(false); stageSynced = new Set(queued.map((x) => x.id));
        if (stagingBefore && sp.stage) { stUnsub = sp.stage.on(onStageEvent); freeCamOn = !!pose; renderScene(); }
        showCodeNote(sp.durationInFrames !== FRAMES && FRAMES ? T('st.code.length', { a: sp.durationInFrames, b: FRAMES }) : '');
        if (old && mode === 'code' && !repair) setSave(T('st.code.updated'), 'ok');
        showCodeStatus(); return sp;
      } catch (e) {
        if (repair) { repair.retry = !!(e.stale || job.dropped); repair.error = e.message; }
        rem.api.dispose();
        // Une candidate périmée ne peut ni détruire la candidate suivante, ni afficher son erreur à sa place.
        if (el !== codeEl) el.remove();
        else if (!job.dropped && codeLoad === job && !SP) el.src = 'about:blank';
        if (!e.stale && !job.dropped && codeLoad === job) {
          codeFailedVer = ver;
          if (!old) window.CoulissesReadiness?.failed({version:ver, frame:target, message:e.message});
          const message = `Version ${ver} non adoptée : ${e.message}. Cliquer « Code actuel » pour réessayer.`;
          showCodeNote(message); setSave(message, 'err');
        }
        return SP;
      } finally {
        clearInterval(job.tick);
        if (codeLoad === job) { codeLoad = null; codeLoading = null; }
      }
    });
    codeLoading = job.promise;
    el.src = previewUrl(`f=${target}&v=${ver}${fresh ? `&r=${Date.now()}` : ''}`);
    return job.promise;
  }
  function cancelCodePreparation() {
    const job = codeLoad; if (!job) return;
    job.dropped = true; clearInterval(job.tick); job.remote?.api.dispose();
    if (job.frame !== codeEl) job.frame.remove();
    codeLoad = null; codeLoading = null;
  }
  // the preview's events (its own function: its closure holds the player only, never the one it replaced)
  function watchPlayer(sp) {
    sp.on((ev) => {
      if (SP !== sp) return;
      // (while moving, the preview's « loading » is not shown: the end of the move is watched by codeSettle)
      if (ev.type === 'error') { codeCrashed(plain(ev)); return; }
      if (ev.type === 'transport-restored' && crash?.reason === 'heartbeat-timeout') {
        crash = null; codeErrEl.classList.remove('on'); codeWait(false);
        setSave(T('st.code.transportRestored', {f: ev.frame}), 'ok'); fire('pause'); fire('seeked'); return;
      }
      if (ev.type === 'ready-error') {
        recordFrameFault(sp, ev.frame, ev.reason, ev.expired, ev.error?.message);
        return;
      }
      // (playing, the only « loading » is a wait for the scene's assets: player/assets-wait.tsx — said too)
      if (ev.type === 'loading' || ev.type === 'loaded') { codeWait(ev.type === 'loading' && !shuttle && performance.now() - lastStep > 250); return; }
      if (ev.type === 'waiting') { RS.wait = true; RS.el?.pause(); return; }
      if (ev.type === 'resume') { RS.wait = false; if (rsOn() && !M.paused) { rsAt(M.currentTime); rsPlay(); } return; }
      if (mode !== 'code') return;
      // the sound of the preview cut by its Player after a lag of the PC, and given back by the preview (player/sound.ts)
      if (ev.type === 'sound') { onSound(sp, ev); return; }
      if (ev.type === 'play' || ev.type === 'pause' || ev.type === 'seeked') fire(ev.type);
      if (ev.type === 'ended') fire('pause');
      if (RS.el && (ev.type === 'pause' || ev.type === 'ended')) RS.el.pause();
      if (rsOn() && (ev.type === 'play' || ev.type === 'seeked')) { rsAt(M.currentTime); rsPlay(); }
      if (ev.type === 'ended') fire('ended');
    });
    // Une publication de code peut remplacer le Player entre le clic à l'arrêt
    // et Lecture. Le nouveau Player reprend alors la vérification demandée.
    if (soundRepair && !soundRepair.rebuilding && soundRepair.sp !== sp) {
      soundRepair.sp = sp; requestSoundCheck(soundRepair);
    }
  }
  let codeNote = '';
  const showCodeNote = (t) => { codeNote = t; showCodeStatus(); };
  function showCodeStatus() {
    const c = STATUS.code ?? {}, el = $('#codeStatus');
    if (c.status === 'error') el.textContent = T('st.code.error');
    else if (c.status === 'building') el.textContent = T('st.code.building');
    else if (SP) el.textContent = `Code v${codeVer} · ${c.builtAt ? hm5(new Date(c.builtAt)) : ''}${codeNote ? ' · ' + codeNote : ''}`;
    else el.textContent = '';
    const e = $('#codeErr'); e.style.display = c.status === 'error' ? 'block' : 'none'; e.textContent = c.status === 'error' ? T('st.code.errorLong', { err: c.error }) : '';
  }
  // the live preview's frame not complete (player/ready.ts: a video of the frame still loading or seeking): covered and
  // said, so that a loading state is never taken for a defect of the video (fiche du 10/10/2026, long04's junctions)
  const codeWaitEl = $('#codeWait');
  function codeWait(on) { codeWaitEl.classList.toggle('on', !!on && mode === 'code'); }
  // Readiness for reviewing pixels is stricter than readiness for transport. An
  // orphaned handle may release the playback veil without certifying the picture.
  let frameFault = null;
  function recordFrameFault(sp, frame, reason, expired, message) {
    if (SP !== sp || mode !== 'code') return;
    const previous = frameFault;
    frameFault = {player:sp ? new WeakRef(sp) : null, frame, version:codeVer, state:expired ? 'expired' : 'error',
      reason:reason || 'frame-preparation-failed', message:String(message || '').slice(0,500)};
    codeWaitEl.classList.remove('pend','pend-key','on');
    if (previous?.player?.deref() !== sp || previous?.frame !== frame || previous?.reason !== frameFault.reason) {
      postJson('/api/preview-error',{frame,version:codeVer,message:frameFault.message || frameFault.reason,where:'préparation de l’image'}).catch(() => {});
    }
    updateReadinessNotice();
  }
  function previewNoteReadiness(frame, exact = true) {
    if (mode !== 'code') return null;
    if (preparedCode?.active()) {
      const film = $('#codeRangeVideo');
      if (film && !film.hidden && film.readyState >= 2 && !film.seeking && !film.error) return null;
    }
    if (preparedCode?.preparing()) return {state:'loading', reason:'code-range-preparing', frame, observedFrame:null,
      version:codeVer, hash:STATUS.code?.hash ?? null, staleLegacy:0};
    const sp = SP, q = sp?.frameReadiness?.();
    const sameFault = frameFault && (frameFault.player?.deref() ?? null) === sp && (frameFault.frame === frame || !sp);
    if (sameFault && q?.verified && q.frame === frame && !sp?.isBuffering?.()) frameFault = null;
    let state, reason;
    if (crash && sp) {state = 'error'; reason = crash.kind || 'composition-error';}
    else if (sameFault && frameFault) {state = frameFault.state; reason = frameFault.reason;}
    else if (!sp && codeLoad) {state = 'loading'; reason = 'player-starting';}
    else if (!sp || !q) {state = 'unverified'; reason = 'no-frame-confirmation';}
    else if (!q.verified || sp.isBuffering?.()) {state = q.verified ? 'loading' : q.state; reason = q.reason || 'buffering';}
    else if (exact && q.frame !== frame) {state = 'unverified'; reason = 'frame-not-confirmed';}
    else return null;
    return {state,reason,frame,observedFrame:q?.frame ?? null,version:q?.version ?? (codeVer >= 0 ? codeVer : frameFault?.version ?? null),
      hash:q?.hash ?? null,staleLegacy:q?.staleLegacy || 0};
  }
  const readinessNotice = $('#previewReadiness'), readinessSummary = readinessNotice.querySelector('summary');
  const readinessHeading = readinessSummary.querySelector('span'), readinessText = readinessNotice.querySelector('p');
  const readinessRetry = readinessNotice.querySelector('button'), readinessAnnouncement = $('#readinessAnnouncement');
  readinessRetry.textContent = FR ? 'Recharger l’aperçu' : 'Reload preview';
  readinessRetry.onclick = () => {
    readinessNotice.open = false;
    if (!readinessNotice.hidden) readinessSummary.focus({preventScroll:true});
    if (mode === 'code') hardReload(curFrame(),crash?.kind);
  };
  readinessNotice.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.altKey && !e.ctrlKey && !e.metaKey) e.stopPropagation();
    if (e.key === 'Escape' && readinessNotice.open) {
      e.preventDefault(); e.stopPropagation(); readinessNotice.open = false; readinessSummary.focus({preventScroll:true});
    }
  });
  document.addEventListener('pointerdown', e => {
    if (readinessNotice.open && !readinessNotice.contains(e.target)) readinessNotice.open = false;
  });
  function readinessLabel(reason) {
    const messages = {
      'unowned-render-handles':['le lecteur attend la fin d’un chargement','the player is waiting for a resource to load'],
      'stale-unowned-render-handles':['un chargement n’a pas signalé sa fin','a resource has not reported that it finished loading'],
      'resources':['ressources en chargement','assets loading'], 'webgl-context-lost':['contexte WebGL perdu','WebGL context lost'],
      'webgl':['contexte WebGL perdu','WebGL context lost'], 'webgl-first-draw':['premier dessin 3D en attente','waiting for first 3D draw'],
      'buffering':['mise en mémoire tampon','buffering'], 'video':['décodage vidéo','video decoding'],
      'image':['image en chargement','image loading'], 'font':['police en chargement','font loading'],
      'player-starting':['démarrage du lecteur','starting the player'], 'transport':['communication avec le lecteur interrompue','connection to the player lost'],
      'composition-error':['erreur dans la composition','composition error'], 'root':['erreur dans la composition','composition error'],
      'frame-preparation-failed':['échec de la préparation de l’image','frame preparation failed'],
      'no-frame-confirmation':['confirmation du lecteur en attente','waiting for player confirmation'],
      'frame-not-confirmed':['position en attente de confirmation','frame position unconfirmed'],
      'code-range-preparing':['préparation de la plage','preparing the range'],
    };
    return messages[reason]?.[FR ? 0 : 1] || reason;
  }
  let pendingNoticeSince = null, pendingNoticeFrame = null, pendingNoticeVersion = null;
  function updateReadinessNotice() {
    const exact = !SP?.isPlaying?.();
    const info = mode === 'code' && META ? previewNoteReadiness(curFrame(), exact) : null;
    const waiting = info && info.reason !== 'code-range-preparing';
    const definite = info?.state === 'error' || info?.state === 'expired';
    // A first paint or a scrub normally catches up on its own. Keep the
    // evidence in notes immediately, while giving a newly requested frame time.
    const frame = exact ? info?.frame : null;
    if (!waiting || pendingNoticeFrame !== frame || pendingNoticeVersion !== codeVer) pendingNoticeSince = null;
    pendingNoticeFrame = frame;
    pendingNoticeVersion = codeVer;
    if (waiting && pendingNoticeSince === null) pendingNoticeSince = performance.now();
    const hidden = !waiting || (!definite && performance.now() - pendingNoticeSince < 1600);
    if (hidden && readinessNotice.contains(document.activeElement)) $(mode === 'code' ? '#srcCode' : '#srcVideo').focus({preventScroll:true});
    readinessNotice.hidden = hidden;
    if (readinessNotice.hidden) {
      readinessNotice.open = false;
      if (readinessAnnouncement.textContent) readinessAnnouncement.textContent = '';
      return;
    }
    const heading = info.state === 'expired' ? (FR ? 'Préparation expirée' : 'Preparation timed out')
      : info.state === 'loading' ? (FR ? 'Chargement de l’image' : 'Frame loading') : (FR ? 'Image non confirmée' : 'Frame unverified');
    const detail = readinessLabel(info.reason) + (FR ? ' · Les notes sur cette image seront signalées.' : ' · Notes on this frame will be flagged.');
    if (readinessHeading.textContent !== heading) readinessHeading.textContent = heading;
    if (readinessText.textContent !== detail) readinessText.textContent = detail;
    const title = heading + ' · ' + detail;
    if (readinessSummary.title !== title) readinessSummary.title = title;
    if (readinessAnnouncement.textContent !== heading) readinessAnnouncement.textContent = heading;
    readinessRetry.hidden = info.state === 'loading';
  }
  window.CoulissesReadiness = {failed: detail => {
    frameFault = {player:null, frame:detail.frame, version:detail.version, state:/expir|timed? out|secondes/i.test(detail.message) ? 'expired' : 'error',
      reason:/\(([-a-z0-9]+)\)/i.exec(detail.message)?.[1] || 'frame-preparation-failed'};
    updateReadinessNotice();
  }};
  setInterval(() => { if (!document.hidden) updateReadinessNotice(); }, 400);
  // a step of the paused preview (← →, ↑ ↓, a click on the timeline): the veil is asked first — it shows after 90 ms
  // unless the frame is complete by then (the CSS delay runs on the compositor: even while the preview is busy mounting
  // the next chapter's page, 1.3 s for long04, the screen never shows the frame before with the new frame's number) —,
  // the seek one frame later, and the veil goes once the preview says the frame asked is complete (player/ready.ts)
  let pendF = null, cwSeq = 0, lastStep = 0, settleT = null, keyStep = false;
  // the composition failed (player/crash.tsx, user report 16/10/2026: the whole picture black with a « ⚠ » in E10): what
  // happened, where in the code, kept in revue\preview-errors.log; « Réessayer », any move mounts the Player again
  let crash = null;
  const codeErrEl = $('#codeCrash');   // (#codeErr is the build error of the code)
  function codeCrashed(ev) {
    const e = ev.error ?? {}, at = ev.at ?? ev.frame ?? curFrame();
    const failedLink = e.kind === 'transport', lostCanvas = e.kind === 'webgl';
    const title = T(failedLink ? 'st.code.transportTitle' : lostCanvas ? 'st.code.graphicsTitle' : 'st.code.crash', {f: at});
    const message = e.reason === 'heartbeat-timeout' ? T('st.code.transportTimeout') : (e.message ?? '');
    crash = { ...e, at, title, message };
    RS.el?.pause();
    $('#ceTitle').textContent = title; $('#ceMsg').textContent = message;
    $('#ceWhere').textContent = e.where && !failedLink && !lostCanvas ? T('st.code.crashWhere', {w: e.where}) : '';
    $('#ceHelp').textContent = T(failedLink ? 'st.code.transportHelp' : lostCanvas ? 'st.code.graphicsHelp' : 'st.code.crashSub');
    codeErrEl.classList.add('on'); codeWaitEl.classList.remove('pend', 'pend-key', 'on');
    postJson('/api/preview-error', { frame: at, message: e.message, where: e.where, stack: (e.stack ?? '').split('\n').slice(0, 12).join('\n'), version: codeVer }).catch(() => {});
    setSave(title, 'err');
  }
  function codeRecover(f = crash?.at ?? curFrame()) {
    if (!crash || !SP) return;
    if (crash.kind === 'transport' || crash.kind === 'webgl') { hardReload(f, crash.kind); return; }
    crash = null; codeErrEl.classList.remove('on');
    SP.recover?.(f);
    if (mode === 'code') codeWaitEl.classList.add('on');   // the Player mounts again: the frame covered until it is complete (behind the MP4: nothing to cover)
    const sp = SP, my = ++cwSeq; setTimeout(() => Promise.resolve(sp.whenFrameReady?.()).then(() => { if (my === cwSeq && SP === sp) codeWaitEl.classList.remove('on'); }, (e) => { if (my === cwSeq && SP === sp) codeCrashed({ error: { message: e.message, where: 'préparation de l’image' }, frame: f }); }), 400);
  }
  // An aperçu that no longer answers (transport) or lost its GPU (webgl): its frame is DESTROYED first, then a new one is
  // loaded in its place at the same image. Preparing the new one behind the frozen one could never work: both iframes
  // share the renderer process of the preview's origin, frozen with it (user report 31/10/2026: « Réessayer » did nothing).
  function hardReload(f, crash0 = null) {
    if (preparedCode?.active()) return preparedCode.reload(f, crash0);
    soundRepair = null;
    const old = SP, at = Math.max(0, Math.min((old?.durationInFrames ?? FRAMES ?? 1) - 1, f ?? curFrame()));
    cancelCodePreparation();
    stUnsub?.(); stUnsub = null;
    SP = null; codeVer = -1; window.__preview = null;
    try { old?.dispose?.(); } catch { /* gone */ }
    const el = document.createElement('iframe');
    el.title = codeEl.title || ''; for (const k of ['allow', 'allowfullscreen']) if (codeEl.hasAttribute(k)) el.setAttribute(k, codeEl.getAttribute(k));
    el.id = 'code'; codeEl.replaceWith(el); codeEl = el;   // the frozen frame leaves the page: Chrome can end its process
    crash = null; codeErrEl.classList.remove('on');
    if (mode === 'code') codeWaitEl.classList.add('on');
    setSave(TN('st.sound.preparing'), '');
    if (crash0 === 'transport') freshPreviewOrigin();   // (its process frozen: a new one)
    return loadCode({ fresh: true, frame: at }).then((sp) => { if (sp && SP === sp) codeWaitEl.classList.remove('on'); return sp; });
  }
  $('#ceRetry').onclick = () => codeRecover();
  $('#ceCopy').onclick = () => { if (crash) copy(`${crash.title}\n${crash.message}\n${crash.where ?? ''}`); };
  $('#ceNote').onclick = () => {
    if (!crash) return;
    const n = addNote(crash.at, null, false, { source: 'code' });
    if (n) { n.text = crash.kind === 'transport' || crash.kind === 'webgl' ? `${crash.title}. ${crash.message}` : T('st.code.crashNoteText', { msg: crash.message, where: crash.where ? ` (${crash.where})` : '' }); save(); renderAll(); setSave(T('st.code.crashNoted'), 'ok'); }
  };
  // an arrow released before the hold (a tap): its veil at the usual 90 ms from now
  function keyReleased() { if (codeWaitEl.classList.contains('pend-key')) { codeWaitEl.classList.remove('pend-key'); codeWaitEl.classList.add('pend'); } }
  // the end of a move: once nothing has moved for 220 ms, a frame not complete is covered until it is
  function codeSettle() {
    clearTimeout(settleT);
    settleT = setTimeout(() => {
      if (mode !== 'code' || !SP || SP.isPlaying() || shuttle || drag?.mode === 'scrub' || performance.now() - lastStep < 200) { if (shuttle || drag?.mode === 'scrub') codeSettle(); return; }
      // (the preview in its own process answers in a moment: its frame is asked for, the veil shown only if it is not
      // complete 90 ms later)
      const sp = SP, my = ++cwSeq;
      const veil = setTimeout(() => { if (my === cwSeq && mode === 'code') codeWaitEl.classList.add('on'); }, 90);
      const done = () => { clearTimeout(veil); if (my === cwSeq) codeWaitEl.classList.remove('on'); };
      Promise.resolve(sp.whenFrameReady?.()).then(done, e => {
        done(); if (my === cwSeq && SP === sp && !aborted(e)) recordFrameFault(sp,curFrame(),sp.frameReadiness?.()?.reason,/expir|timed? out|sans réponse/i.test(e.message),e.message);
      });
    }, 220);
  }
  function codeStep(f) {
    const sp = SP, my = ++cwSeq; pendF = f;
    // the first step of an arrow may become a hold (the shuttle at 280 ms): its veil waits 330 ms, never a flash at the
    // start of a fast forward / rewind; released at once, keyReleased brings it back to 90 ms
    codeWaitEl.classList.remove('pend', 'pend-key'); codeWaitEl.classList.add(keyStep ? 'pend-key' : 'pend');
    requestAnimationFrame(() => {
      if (my !== cwSeq || SP !== sp) return;
      pendF = null; sp.seek(f);
      const done = () => { if (my === cwSeq) codeWaitEl.classList.remove('pend', 'pend-key'); };
      Promise.resolve(sp.whenFrameReady?.()).then(done, e => {
        done(); if (my === cwSeq && SP === sp && !aborted(e)) recordFrameFault(sp,f,sp.frameReadiness?.()?.reason,/expir|timed? out|sans réponse/i.test(e.message),e.message);
      });
    });
  }
  // « Rétablir le son » (the speaker under the image; user report 19/10/2026: « quand il y a des lags, le son se désactive,
  // et impossible à réactiver sans F5 »): every sound path as at the start — nothing muted, the volume of the slider; the
  // live preview's Player unmuted (its own mute after a failed start of its sound, player/sound.ts); the MP4 loaded again
  // where it is (a new sound output: the one of before may have died with the sound device), playing if it was
  function onSound(sp, ev) {
    if (rsOn() || preparedCode?.active() || soundRepair?.rebuilding) return;
    if (ev.state === 'failed') {
      if (soundRepair?.sp === sp) rebuildForSound(soundRepair);
      return;
    }
    if (ev.state === 'back') {
      if (ev.context !== 'running' || !(ev.clockAdvance > 0 && ev.mediaAdvance > 0)) return;
      soundRepair = null;
    }
    if (['lost', 'dead', 'back', 'armed', 'checking', 'waiting', 'quiet'].includes(ev.state)) {
      setSave(TN('st.sound.' + (ev.state === 'dead' ? 'gone' : ev.state)), ev.state === 'back' ? 'ok' : ['lost', 'dead'].includes(ev.state) ? 'err' : '');
    }
  }
  async function requestSoundCheck(job) {
    const sp = job.sp;
    // La réponse accuse réception. Seul l'événement back porte la preuve.
    const ack = await sp.restoreSound();
    if (ack !== 'checking' && soundRepair === job && job.sp === sp) await rebuildForSound(job);
  }
  async function rebuildForSound(job) {
    if (soundRepair !== job || job.rebuilding) return;
    if (job.rebuilt) { soundRepair = null; setSave(TN('st.sound.gone'), 'err'); return; }
    const old = job.sp, at = curFrame();
    job.play = old.isPlaying(); job.rebuilding = job.rebuilt = true;
    old.pause(); old.seek(at); // la position affichée fait foi, y compris si pause était en file derrière un gel
    setSave(TN('st.sound.preparing'), '');
    let sp;
    do {
      job.retry = false;
      sp = await loadCode({ fresh: true, repair: job });
      if (job !== soundRepair) return;
      if (mode !== 'code' || preparedCode?.active()) { soundRepair = null; return; }
      // Un changement de version ou de mise en scène nécessite une nouvelle
      // candidate. La demande de son et le dernier choix Lecture/Pause persistent.
    } while (job.retry && sp === old && !rsOn());
    job.rebuilding = false;
    if (!sp || sp === old || SP !== sp) {
      soundRepair = null; showCodeNote(''); setSave([TN('st.sound.gone'), job.error].filter(Boolean).join(' · '), 'err'); fire('pause'); return;
    }
    job.sp = sp;
    if (job.play) M.play();
    if (rsOn() || sp.hyperframes) { soundRepair = null; setSave(TN('st.sound.previewReady'), ''); return; }
    await requestSoundCheck(job);
  }
  async function restoreSound() {
    v.muted = false; v.volume = vol;
    if (mode === 'code' && !SP) {
      setSave(TN('st.sound.preparing'), '');
      const sp = await (codeLoading ?? loadCode());
      if (mode !== 'code') return;
      if (!sp || SP !== sp) { setSave(TN('st.sound.gone'), 'err'); return; }
    }
    if (mode === 'code' && SP && RS.el) {
      const src = RS.el.src, t = M.currentTime, playing = !M.paused; RS.el.pause();
      const el = new Audio(); el.preload = 'auto'; el.src = src; el.volume = vol; el.playbackRate = rate; el.preservesPitch = true;
      RS.el.removeAttribute('src'); RS.el.load(); RS.el = el; SP.mute?.(); rsAt(t); if (playing) rsPlay();
      setSave(TN('st.rs.reloaded'), 'ok'); return;
    }
    if (mode === 'code' && SP) {
      if (soundRepair?.rebuilding) return;
      if (!vol) { setSave(TN('st.sound.zero'), ''); return; }
      const job = soundRepair = { sp: SP, rebuilt: false, rebuilding: false };
      SP.setVolume(vol); setSave(TN('st.sound.checking'), '');
      if (SP.hyperframes) { SP.unmute?.(); await rebuildForSound(job); }
      else await requestSoundCheck(job);
      return;
    }
    else if (v.currentSrc && !wasHeld && v.readyState >= 1) {
      const t = v.currentTime, playing = !v.paused, src = v.currentSrc;
      v.addEventListener('loadedmetadata', () => { v.currentTime = t; v.volume = vol; v.muted = false; if (playing) v.play().catch(() => {}); }, { once: true });
      v.src = src;
    }
    setSave(TN('st.sound.restored'), 'ok');
  }
  $('#bSound').onclick = () => restoreSound();
  let modeWant = null, modeRequest = 0, modeWasPlaying = null;
  async function setMode(m) {
    if (m === mode) {
      if (modeWant !== null) { modeWant = null; modeWasPlaying = null; modeRequest++; cancelCodePreparation(); }
      else if (m === 'code' && codeFailedVer !== null) await loadCode({ fresh: true });
      return;
    }
    const request = ++modeRequest;
    if (m !== 'code') { soundRepair = null; cancelCodePreparation(); }
    if (modeWant !== m) modeWasPlaying = null;
    modeWant = m;
    // Le MP4 peut continuer jusqu’à la première publication. onStatus reprendra
    // cette intention avec l’image et l’état de lecture alors courants.
    if (m === 'code' && !(STATUS.code?.version ?? META?.code?.version ?? 0)) return;
    let f = curFrame(); const was = modeWasPlaying ?? !M.paused, planFrom = viewPlan();
    modeWasPlaying = was; M.pause();
    if (m === 'code' && !(await loadCode())) { if (modeWant === m && request === modeRequest) { modeWant = null; modeWasPlaying = null; } return; }
    if (modeWant !== m || request !== modeRequest) return;   // (another choice came while the code loaded: that one)
    modeWant = null; modeWasPlaying = null;
    if (m === mode) return;
    if (m === 'video' && SP) SP.pause();
    mode = m;
    codeWait(m === 'code' && SP?.frameLoading?.()); codeWaitEl.classList.remove('pend', 'pend-key'); pendF = null; cwSeq++;
    codeErrEl.classList.toggle('on', m === 'code' && !!crash);
    SP?.sleep?.(m !== 'code');   // drawn only while it is on screen (Remotion's 3D canvas draws at every frame, even paused)
    media.classList.toggle('code', m === 'code');
    $('#srcVideo').classList.toggle('on', m === 'video'); $('#srcCode').classList.toggle('on', m === 'code'); $('#bSrc').classList.toggle('on', m === 'code');
    f = await frameOn(f, planFrom, viewPlan());   // (the code changed since the video: the same moment, not the same frame)
    if (request !== modeRequest || mode !== m) return;
    seekFrame(f); if (was) M.play();
    followPlans();   // (the notes on this version's frames)
  }
  // a 3D shot of the theatre shown here as a video (a Short's chibi shot): « Ouvrir la scène 3D » opens it in its own
  // studio (the home screen starts it), where the staging is the Theatre's 3D one; the agent then renders it again into
  // this run (the shot's .coulisses « utilise », lib/projects.mjs shotsUsedIn)
  const norm3d = (f) => String(f ?? '').replace(/\\/g, '/').toLowerCase();
  function shotHere() {
    const shots = META?.shots3d ?? []; if (!shots.length || !LIVE?.tracks) return null;
    const t = (curFrame() + 0.5) / FPS;
    for (const { c } of clipsAt(t)) { const s = shots.find((x) => c.file && norm3d(c.file) === norm3d(x.fichier)); if (s) return s; }
    return null;
  }
  let lastShot = undefined;
  function showShot() {
    const s = shotHere(), b = $('#open3d');
    if (s === lastShot) return; lastShot = s;
    b.style.display = s ? '' : 'none';
    if (s) { b.querySelector('span').textContent = T('st.s3.open', { title: s.title }); b.title = META.hub ? T('st.s3.openTitle', { file: s.fichier }) : T('st.s3.noHub'); b.classList.toggle('off', !META.hub); }
  }
  $('#open3d').onclick = async () => {
    const s = shotHere(); if (!s) return;
    if (!META.hub) return setSave(T('st.s3.noHub'), 'err');
    await flushNow(); location.href = `${META.hub.replace(/\/$/, '')}/go/${s.id}`;
  };
  // the same tools in every project: one that does not apply here is greyed, with the reason in its tooltip
  const stageWhy = () => (META?.features?.code ? null : T('st.why.stageNoCode'));
  const srcWhy = () => (!META?.features?.code ? T('st.why.srcNoCode') : !META?.render ? T('menu.why.noVideo') : null);
  function markTools() {
    for (const [b, why] of [[$('#bStage'), null], [$('#bSrc'), srcWhy()]]) {
      b.classList.toggle('off', !!why); b.setAttribute('aria-disabled', why ? 'true' : 'false');
      const w = b.querySelector('.tipr .why'); if (w) w.textContent = why ?? '';
    }
    const file = META?.render?.name, video = $('#srcVideo'), code = $('#srcCode');
    if (file && !/\.mp4$/i.test(file)) video.lastChild.textContent = FR ? 'Vidéo importée' : 'Imported video';
    video.classList.toggle('off', !file); video.setAttribute('aria-disabled', String(!file));
    video.title = file || T('menu.why.noVideo');
    code.classList.toggle('off', !META?.features?.code); code.setAttribute('aria-disabled', String(!META?.features?.code));
    code.title = META?.features?.code ? (META.composition || T('st.src.code')) : T('st.why.srcNoCode');
  }
  $('#srcVideo').onclick = () => { if (!META?.render) return setSave(T('menu.why.noVideo'), 'err'); if (staging) setStaging(false); setMode('video'); };
  $('#srcCode').onclick = () => { if (!META?.features?.code) return setSave(T('st.why.srcNoCode'), 'err'); setMode('code'); };
  $('#bSrc').onclick = () => { const why = srcWhy(); if (why) return setSave(why, 'err'); setMode(mode === 'video' ? 'code' : 'video'); };

  // ---------- time helpers ----------
  const fmt = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, '0')}`; };
  const fmtS = (t) => { const m = Math.floor(t / 60), s = Math.floor(t - m * 60); return `${m}:${String(s).padStart(2, '0')}`; };
  const hhmm = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : FR ? d.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); };
  const curFrame = () => Math.max(0, Math.min(FRAMES - 1, Math.floor(M.currentTime * FPS + 1e-4)));
  const seekFrame = (f) => { f = Math.max(0, Math.min(FRAMES - 1, Math.round(f))); M.currentTime = (f + 0.5) / FPS; draw(); updateHud(); };
  const tOf = (f) => f / FPS;
  const who = (a) => a === 'narrator' ? T('st.narrator') : a.charAt(0).toUpperCase() + a.slice(1);

  // a project's timeline: the tracks of its montage plan (AItelier: chapters, V1 plans, V2 presenter, V3 overlays, A1-A3)
  const clipsAt = (t) => (LIVE?.tracks ?? []).flatMap((tr) => tr.clips.filter((c) => c.t0 <= t && t < c.t1).map((c) => ({ tr, c })));
  const inClip = (tr, c, t) => (tr.type === 'video' ? T('st.ctx.clipFrame', { n: Math.floor(c.from + (t - c.t0) * FPS + 1e-6) }) : T('st.ctx.fileTime', { t: fmt(c.from / FPS + t - c.t0) }));
  function contextAt(f0, f1 = f0) {
    if (PROJ) {
      const t = (f0 + 0.5) / FPS, at = clipsAt(t);
      return { scene: at.find((x) => x.tr.type === 'band')?.c.label ?? '', lines: [],
        clips: at.filter((x) => x.tr.type !== 'band').map(({ tr, c }) => T('st.ctx.clip', { track: tr.name, label: c.label, file: c.file ? ` · ${c.file}, ${inClip(tr, c, t)}` : '', off: c.off ? T('st.ctx.off') : '' })) };
    }
    const plan = selectEpisodeContextPlan();
    if (!plan) return { scene: '', lines: [] };
    const t0 = (f0 + 0.5) / FPS, t1 = (f1 + 0.5) / FPS, t = t0;
    let scene = '';
    const cut = (plan.cutaways ?? []).find((c) => t >= c.t && t < c.t + c.dur);
    if (cut) scene = cut.name ?? cut.id ?? '';
    else {
      const on = (plan.sets ?? []).filter((w) => w.inT <= t && t < (w.outT ?? 1e9) + w.outDur).sort((a, b) => b.inT - a.inT)[0];
      if (on) scene = t < on.inT + on.inDur ? T('st.ctx.arrives', { name: on.name }) : (on.outT !== null && t >= on.outT ? T('st.ctx.leaves', { name: on.name }) : on.name);
      let open = !plan.curtain?.length; for (const c of plan.curtain ?? []) { if (c.t > t) break; open = c.open; }
      if (!open) scene = scene ? `${scene} · ${T('st.ctx.curtain')}` : T('st.ctx.curtain');
    }
    const lines = (plan.says ?? []).filter((s) => s.t <= t1 && s.t + s.dur + 0.4 >= t0).slice(0, 14).map((s) => T('st.ctx.line', { id: s.id, who: who(s.actor), text: s.text }));
    return { scene, lines };
  }

  // ---------- the 3D object under a gesture, in words: « Penelope · personnage », « ladder · décor » ----------
  // a Remotion run reviewed before any export: the composition gives the timeline's length, its fps and its pixels
  function adoptCode(sp) {
    const first = !FRAMES;
    FRAMES = sp.durationInFrames; FPS = sp.fps || FPS; DUR = FRAMES / FPS;
    if (sp.width && sp.height) { CW = sp.width; CH = sp.height; }
    if (first) view = { a: 0, b: DUR };
    fitMedia(); resize(); renderAll(); updateHud();
    if (first) { const f = hashFrame(); if (f !== null) seekFrame(f); }
  }
  function humanTarget(h) {
    if (!h) return null;
    if (h.label) return { name: h.label, kind: h.kind && h.kind !== 'élément' ? h.kind : T('st.kind.element') };   // an element named data-coulisses="…" (a Remotion run)
    const segs = (h.names?.[0] ?? '').split(' › ').filter(Boolean);
    const seg = [...segs].reverse().find((s) => s.includes('[')) ?? segs.at(-1) ?? '';
    const m = /^(\w+)(?:\[(.*)\])?$/.exec(seg) ?? [];
    const comp = m[1] ?? '', at = Object.fromEntries([...(m[2] ?? '').matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    const key = at.actor || at.key || at.id || at.name || '';
    const pretty = (k) => k.replace(/^[a-z0-9]+-\d+-/i, '').replace(/^f-/, '').replace(/^(set|prop|ground|bg|fg|far|near|back|front|flat)_/i, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\s+\d+$/, '').trim();
    if (comp === 'Actor') return { name: who(key), kind: T('st.kind.character') };
    if (comp === 'Piece') {
      if (/^f-/.test(key)) return { name: pretty(key), kind: T('st.kind.prop') };
      if (/^g-/.test(key)) return { name: pretty(key.slice(2)), kind: T('st.kind.ground') };
      // a set's painted layers: <set>-<n>-backdrop | far | middle | near | front
      const lay = /^([a-z0-9]+)-\d+-(backdrop|far|middle|near|front)$/i.exec(key);
      if (lay) return { name: lay[1], kind: T(`st.kind.${lay[2].toLowerCase()}`) };
      if (/backdrop/.test(key)) return { name: key.split('-')[0], kind: T('st.kind.backdrop') };
      if (/ground|-g_/.test(key)) return { name: pretty(key.replace(/-g_/, '-')), kind: T('st.kind.ground') };
      return { name: pretty(key) || T('st.kind.element'), kind: T('st.kind.set') };
    }
    if (comp === 'Stage') return { name: T('st.kind.floor'), kind: T('st.kind.stage') };
    if (comp) return { name: pretty(key) || comp, kind: comp.toLowerCase() };
    const tx = h.textures?.[0]; return tx ? { name: tx.split('/').pop().replace(/\.\w+$/, ''), kind: 'texture' } : { name: h.type ?? '?', kind: '3D' };
  }


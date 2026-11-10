// Disponibilité explicite de l'image de l'aperçu. Une échéance est une erreur,
// jamais une image réputée complète. Les attentes du rendu non attribuées restent
// un diagnostic ; elles ne suspendent pas l'horloge du Player.
export function createReady(opts: {
  root: () => ParentNode | null;
  playing: () => boolean;
  emit: (type: string, extra?: Record<string, unknown>) => void;
  timeoutMs?: number;
  staleMs?: number;
}) {
  let buffering = false, loading = false, raf = 0, timer: any = 0, started = 0, pendingSince = 0, reported = '', disposed = false, asleep = false;
  const timeout = opts.timeoutMs ?? 30000;
  // Une attente globale (delayRender sans propriétaire) jamais rendue par son producteur (ex. Stage.tsx démonté
  // avant la fin de son chargement) ne doit pas masquer l'image pour toujours : au-delà de staleMs elle est tenue
  // pour orpheline et ignorée (demande du 31/10/2026 : voile noir, puis « aperçu planté à l'image 1301 »).
  const stale = opts.staleMs ?? 6000, seen = new Map<number, number>();
  const freshLegacy = (handles: number[]) => {
    const now = performance.now(), live = new Set(handles);
    for (const h of [...seen.keys()]) if (!live.has(h)) seen.delete(h);
    for (const h of handles) if (!seen.has(h)) seen.set(h, now);
    return handles.filter((h) => now - (seen.get(h) ?? now) < stale);
  };
  const shown = (el: Element) => {
    if (!(el as HTMLElement).getClientRects().length) return false;
    for (let e: Element | null = el, i = 0; e && i < 80; e = e.parentElement, i++) {
      const style = getComputedStyle(e);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    return true;
  };
  const status = () => {
    const resources = (window as any).__coulissesReadiness?.snapshot?.() ?? { activePending: 0, legacyPending: [] };
    const legacy: number[] = resources.legacyPending ?? [], fresh = freshLegacy(legacy);
    const extra = { activePending: resources.activePending ?? 0, legacyPending: fresh, staleLegacy: legacy.length - fresh.length };
    const result = (state: string, reason: string | null, displayable = state === 'ready') => ({ state, reason, verified: state === 'ready', displayable, ...extra });
    if (buffering) return result('loading', 'buffering');
    if (extra.activePending) return result('loading', 'resources');
    const root = opts.root(); if (!root) return result('loading', 'root');
    for (const video of Array.from(root.querySelectorAll('video'))) {
      if (!shown(video)) continue;
      if (video.error) return result('error', 'video-error');
      if (video.networkState !== 3 && (video.readyState < 2 || video.seeking)) return result('loading', 'video');
    }
    for (const image of Array.from(root.querySelectorAll('img'))) {
      if (!shown(image)) continue;
      if (!image.complete) return result('loading', 'image');
      if ((image.currentSrc || image.getAttribute('src')) && image.naturalWidth === 0) return result('error', 'image-error');
    }
    if ((document as any).fonts?.status === 'loading') return result('loading', 'font');
    const scene = (window as any).__coulissesSceneReadiness?.();
    if (scene?.lost) return result('error', 'webgl-context-lost');
    if (scene?.pendingDraw) return result('loading', 'webgl-first-draw');
    // Sans propriétaire, impossible de promettre une image complète : un ancien
    // producteur doit migrer vers useDelayRender/useBufferState. Ce signal ne crée
    // aucun delayPlayback et n'empêche donc pas une autre scène de jouer.
    if (extra.legacyPending.length) return result('unverified', 'unowned-render-handles');
    if (extra.staleLegacy) return result('unverified', 'stale-unowned-render-handles', true);
    return result('ready', null);
  };
  const failure = (reason: string | null, expired = false) => new Error(expired
    ? `Préparation de l'image expirée après ${Math.round(timeout / 1000)} secondes (${reason ?? 'inconnu'})`
    : `Image indisponible (${reason ?? 'inconnu'})`);
  const sayError = (reason: string | null, expired = false) => {
    const key = `${expired}:${reason}`; if (reported === key) return;
    reported = key;
    opts.emit('ready-error', { reason, expired, error: { message: failure(reason, expired).message, where: 'préparation de l’image', stack: '' } });
  };
  const tick = () => {
    raf = 0; timer = 0; if (disposed || asleep) return;
    const current = status(), pending = !current.displayable, elapsed = performance.now() - started;
    if (pending && !loading) { pendingSince = performance.now(); loading = true; opts.emit('loading'); }
    if (!pending && loading) { loading = false; reported = ''; opts.emit('loaded'); }
    if (current.state === 'error') sayError(current.reason);
    else if (pending && performance.now() - pendingSince >= timeout) sayError(current.reason, true);
    // Surveillance ralentie après le premier dessin : pas de scan de milliers
    // d'images à 60 Hz durant un chargement long, et aucune fausse notification.
    if (pending) timer = setTimeout(tick, elapsed < 300 ? 50 : 200);
    else if (elapsed < 300) raf = requestAnimationFrame(tick);
  };
  const watch = () => {
    if (disposed) return;
    asleep = false; started = performance.now(); reported = '';
    if (!raf && !timer) raf = requestAnimationFrame(tick);
  };
  const waiters = new Set<{ res: () => void; rej: (e: Error) => void; t: number; armed: boolean }>();
  let pollTimer: any = 0;
  const poll = () => {
    pollTimer = 0; if (disposed) return;
    const current = status(), now = performance.now();
    for (const waiter of [...waiters]) {
      if (!waiter.armed) continue;
      if (current.displayable) { waiters.delete(waiter); waiter.res(); }
      else if (current.state === 'error' || now - waiter.t >= timeout) {
        waiters.delete(waiter); waiter.rej(failure(current.reason, current.state !== 'error'));
      }
    }
    if (waiters.size) pollTimer = setTimeout(poll, 50);
  };
  const onResources = () => { if (!raf && !timer && !disposed && !asleep) raf = requestAnimationFrame(tick); };
  window.addEventListener('coulisses-readiness', onResources);
  return {
    watch,
    // L'aperçu mis en sommeil (unload : « Préparer 30 s ») n'a plus de scène : rien à surveiller, aucune
    // « préparation expirée (root) » au bout de 30 s (03/11/2026, 宇宙ちゃん long07 : deux faux plantages à l'image 0).
    suspend: () => { asleep = true; buffering = false; reported = ''; cancelAnimationFrame(raf); clearTimeout(timer); raf = 0; timer = 0; loading = false; },
    setBuffering: (value: boolean) => { buffering = value; watch(); },
    isLoading: () => loading,
    ready: () => status().displayable,
    why: () => status().reason,
    status,
    when: () => new Promise<void>((res, rej) => {
      if (disposed) { rej(new Error('Aperçu fermé')); return; }
      const waiter = { res, rej, t: performance.now(), armed: false }; waiters.add(waiter);
      requestAnimationFrame(() => requestAnimationFrame(() => { waiter.armed = true; if (!pollTimer) poll(); }));
    }),
    dispose: () => {
      disposed = true; cancelAnimationFrame(raf); clearTimeout(timer); clearTimeout(pollTimer);
      window.removeEventListener('coulisses-readiness', onResources);
      for (const waiter of waiters) waiter.rej(new Error('Aperçu fermé')); waiters.clear();
    },
  };
}

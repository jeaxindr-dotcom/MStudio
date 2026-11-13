  // The export snapshot and the live timeline describe different versions.
  // Never borrow today's scene names for an MP4 unless its recorded plan agrees.
  function episodePlanSource() { return !META?.render && META?.features?.code ? 'code' : mode; }
  function selectEpisodeContextPlan() {
    if (!META) return null;   // the first animation tick can run before the later script parts initialize
    const liveReady = STATUS.timeline?.status === 'ready' && STATUS.timeline.version === liveVer;
    if (episodePlanSource() === 'code') return liveReady && STATUS.code?.status === 'ready' && STATUS.code.version === codeVer ? LIVE : null;
    if (SNAP && META?.snapshotMatches) return SNAP;
    const plans = STATUS.plans ?? META?.plans;
    if (liveReady && LIVE && plans?.video && plans.video === plans.code) return LIVE;
    return null;
  }

  let episodePlanFetched = false, episodePlanLoading = 0;
  const episodePlanNotice = $('#episodePlanNotice');
  const episodePlanSummary = episodePlanNotice.querySelector('summary');
  const episodePlanHeading = episodePlanSummary.querySelector('span');
  const episodePlanDetail = episodePlanNotice.querySelector('p');
  const episodePlanAnnouncement = $('#episodePlanAnnouncement');
  function updateEpisodePlanNotice() {
    const codeWaiting = episodePlanSource() === 'code' && (!STATUS.code?.status || ['idle', 'building'].includes(STATUS.code.status)
      || STATUS.code.status === 'ready' && STATUS.code.version !== codeVer);
    const pending = codeWaiting || episodePlanLoading > 0 || !episodePlanFetched || !STATUS.timeline?.status || ['idle', 'building'].includes(STATUS.timeline.status);
    const missing = META && !PROJ && !selectEpisodeContextPlan() && !pending;
    if (!missing) {
      if (episodePlanNotice.contains(document.activeElement)) $(episodePlanSource() === 'code' ? '#srcCode' : '#srcVideo').focus({preventScroll:true});
      episodePlanNotice.hidden = true; episodePlanNotice.open = false;
      episodePlanAnnouncement.textContent = '';
      return;
    }
    const code = episodePlanSource() === 'code';
    const stale = !code && SNAP && !META.snapshotMatches;
    const label = stale ? (FR ? 'Plan différent' : 'Different plan') : (FR ? 'Plan indisponible' : 'Plan unavailable');
    const detail = code
      ? (FR ? 'Le plan du code n’est pas disponible pour le moment.' : 'The live code timeline is currently unavailable.')
      : stale
        ? (FR ? 'Le plan enregistré ne correspond pas à la vidéo affichée.' : 'The saved timeline does not match the displayed video.')
        : (FR ? 'Le plan de la vidéo affichée n’est pas disponible.' : 'The displayed video’s timeline is unavailable.');
    episodePlanHeading.textContent = label;
    episodePlanDetail.textContent = detail + (FR ? ' Les notes gardent leur numéro d’image, sans nom de scène ni réplique.' : ' Notes keep their frame number, without a scene name or dialogue.');
    episodePlanSummary.title = episodePlanDetail.textContent;
    episodePlanAnnouncement.textContent = label;
    episodePlanNotice.hidden = false;
  }
  episodePlanNotice.addEventListener('keydown', event => {
    if (event.key === 'Escape' && episodePlanNotice.open) {
      event.preventDefault(); event.stopPropagation(); episodePlanNotice.open = false; episodePlanSummary.focus({preventScroll:true});
    }
  });
  document.addEventListener('pointerdown', event => {
    if (episodePlanNotice.open && !episodePlanNotice.contains(event.target)) episodePlanNotice.open = false;
  });
  const loadLiveForEpisodePlan = loadLive;
  loadLive = async function (...args) {
    episodePlanLoading++; updateEpisodePlanNotice();
    try { return await loadLiveForEpisodePlan(...args); }
    finally { episodePlanLoading--; episodePlanFetched = true; updateEpisodePlanNotice(); }
  };
  const onStatusForEpisodePlan = onStatus;
  onStatus = function (...args) {
    const result = onStatusForEpisodePlan(...args); updateEpisodePlanNotice(); return result;
  };
  const setModeForEpisodePlan = setMode;
  setMode = async function (...args) {
    try { return await setModeForEpisodePlan(...args); }
    finally { updateEpisodePlanNotice(); }
  };
  const loadCodeForEpisodePlan = loadCode;
  loadCode = async function (...args) {
    try { return await loadCodeForEpisodePlan(...args); }
    finally { updateEpisodePlanNotice(); }
  };

  // Rebuild the preview at the same composition frame. Some scenes allocate their
  // post-processing buffers once when the canvas mounts.
  const resolutionControl = $('#playbackResolutionControl');
  const resolutionSelect = $('#playbackResolution');
  const scaleValue = () => playbackScale === null ? 'auto' : String(playbackScale);
  resolutionSelect.value = scaleValue();

  function refreshPlaybackResolution() {
    resolutionControl.hidden = mode !== 'code' || META?.engine !== 'remotion';
    resolutionSelect.disabled = resolutionPending || !!codeLoading || !!soundRepair?.rebuilding ||
      !!preparedCode?.active() || !!preparedCode?.preparing() || STATUS.code?.status !== 'ready';
  }

  resolutionSelect.addEventListener('change', async () => {
    refreshPlaybackResolution();
    const next = parsePlaybackScale(resolutionSelect.value);
    if (resolutionControl.hidden || resolutionSelect.disabled || next === playbackScale) {
      resolutionSelect.value = scaleValue();
      return;
    }
    const previous = playbackScale, old = SP, frame = curFrame(), wasPlaying = !M.paused;
    resolutionPending = true;
    refreshPlaybackResolution();
    try {
      if (wasPlaying) { M.pause(); old?.seek(frame); }
      playbackScale = next;
      const player = crash ? await hardReload(frame, crash.kind) : await loadCode({fresh: true, frame});
      if (!player || player === old || SP !== player) throw new Error(T('st.preview.resolutionFailed'));
      try { localStorage.setItem(resolutionKey, scaleValue()); } catch { /* storage unavailable */ }
      if (wasPlaying && mode === 'code' && M.paused && player.frame() === frame) M.play();
    } catch (error) {
      playbackScale = previous;
      if (mode === 'code' && M.paused) setSave(error.message, 'err');
    } finally {
      resolutionPending = false;
      resolutionSelect.value = scaleValue();
      refreshPlaybackResolution();
    }
  });

const changed = () => Object.assign(new Error('La version de l’aperçu a changé.'), {status: 409});

// Decorative filmstrips share a previously certified generation, but only after
// a fresh source fingerprint. No timer or filesystem watcher makes stale sources
// current. A source change still takes the full preview/timeline validation path.
export function thumbnailGeneration({fingerprint, build, current}) {
  let last = null;
  return async (version, signal) => {
    signal?.throwIfAborted();
    if (!current(version)) throw changed();
    const before = await fingerprint(signal);
    signal?.throwIfAborted();
    if (!current(version)) throw changed();
    if (last?.version === version && last.mediaSignature === before && current(version, last.hash)) return last;

    // The builder checks before and after construction. Its first check can use
    // the scan just completed here; every later check must read the sources again.
    let first = true;
    const checkedFingerprint = async () => {
      signal?.throwIfAborted();
      if (first) { first = false; return before; }
      return fingerprint(signal);
    };
    const generation = await build(version, signal, checkedFingerprint);
    signal?.throwIfAborted();
    if (generation.version !== version || generation.mediaSignature !== before || !current(version, generation.hash)) throw changed();
    last = Object.freeze({...generation});
    return last;
  };
}

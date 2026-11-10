// The studio's page (studio.html), part 17: the dictation (user request, 19/10/2026: OpenWhispr « intégré nativement » à
// Coulisses, « un bouton à l'écran ou un raccourci clavier pour lancer la prise de note orale » — F2).
//   - F2 held: listening while it is held; F2 tapped: listening until F2 again; the microphone of the rail the same (held
//     or clicked); Échap: nothing kept. The video pauses while one speaks (its sound would be in the recording).
//   - In a text field (a note, an answer to the agent, the request of the Agent tab, the words of the queue, the « what
//     should change here? » box): the words go there, at the cursor. Elsewhere: a new note at the frame shown when F2 was
//     pressed, its words said (made once the words are there: never an empty note).
//   - Transcribed on this PC by Whisper, OpenWhispr's (lib/dictate.mjs, POST /api/dictate); the names of the episode
//     (its title, its characters) are given to Whisper as a hint. The microphone stays open 30 s after a dictation (the
//     next one starts at once), then closes.
// The parts of page/studio/ are one script: studio-server.mjs joins them in their order inside one function (/studio.js),
// so they share their names as the one inline script did; hence the two-space indent.
  const DIC = { on: false, busy: false, rec: null, stream: null, ctx: null, an: null, chunks: [], target: null, f0: 0, t0: 0, downAt: 0, holding: false, peak: 0, cancel: false, raf: 0, closeT: null };
  const dicEl = $('#dictee');
  const HOLD = 350;   // (held longer: released = the end; shorter: a tap, listening until the next one)
  function dicShow(state, sub = '') {
    dicEl.className = state ? 'on ' + state : '';
    dicEl.querySelector('.t').textContent = state === 'listen' ? TN('st.dic.listen') : state === 'wait' ? TN('st.dic.wait') : state === 'work' ? TN('st.dic.work') : '';
    dicEl.querySelector('.s').textContent = sub;
    $('#bMic').classList.toggle('on', state === 'listen' || state === 'wait');
  }
  const typingField = (a) => a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(text|search)$/.test(a.type))) && !a.readOnly && !a.disabled;
  // where the words will go: the field with the cursor, found again even if its card was drawn again meanwhile
  function targetNow() {
    const a = document.activeElement;
    if (!typingField(a)) return { note: true };
    const card = a.closest?.('.card');
    return { el: a, id: a.id || null, card: card?.dataset.id ?? null, cls: a.classList.contains('rep') ? 'rep' : a.classList.contains('main') ? 'main' : null, start: a.selectionStart ?? a.value.length, end: a.selectionEnd ?? a.value.length };
  }
  function targetEl(t) {
    if (t.el?.isConnected) return t.el;
    if (t.card && t.cls) return document.querySelector(`.card[data-id="${t.card}"] textarea.${t.cls}`);
    return t.id ? document.getElementById(t.id) : null;
  }
  // the names Whisper should know (« Hazel », « Brambleshire »…): the title, the characters of the plan
  function dicPrompt() {
    const names = new Set();
    for (const s of (LIVE?.says ?? SNAP?.says ?? [])) if (s.actor && s.actor !== 'narrator') names.add(who(s.actor));
    return [META?.title, [...names].slice(0, 30).join(', ')].filter(Boolean).join('. ');
  }
  async function micOpen() {
    clearTimeout(DIC.closeT);
    if (DIC.stream?.active) return DIC.stream;
    DIC.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    try { DIC.ctx = new AudioContext(); DIC.an = DIC.ctx.createAnalyser(); DIC.an.fftSize = 1024; DIC.ctx.createMediaStreamSource(DIC.stream).connect(DIC.an); } catch { DIC.an = null; }
    return DIC.stream;
  }
  function micLater() {   // closed 30 s after the last dictation (Chrome's « micro » sign goes with it)
    clearTimeout(DIC.closeT);
    DIC.closeT = setTimeout(() => { if (DIC.on) return; DIC.stream?.getTracks().forEach((t) => t.stop()); DIC.stream = null; DIC.ctx?.close().catch(() => {}); DIC.ctx = null; DIC.an = null; }, 30000);
  }
  function meter() {   // the level of the voice in the pill, and the loudest moment (a silence is not sent)
    if (!DIC.on) return;
    if (DIC.an) {
      const a = new Float32Array(DIC.an.fftSize); DIC.an.getFloatTimeDomainData(a);
      let s = 0; for (const x of a) s += x * x;
      const rms = Math.sqrt(s / a.length); DIC.peak = Math.max(DIC.peak, rms);
      dicEl.querySelector('.lvl i').style.width = Math.min(100, Math.round(rms * 600)) + '%';
    }
    DIC.raf = requestAnimationFrame(meter);
  }
  async function dicStart(how = 'key') {
    if (DIC.on || DIC.busy) return;
    DIC.target = targetNow(); DIC.f0 = curFrame(); DIC.cancel = false; DIC.peak = 0; DIC.chunks = [];
    if (DIC.target.note) { DIC.target.source = mode; DIC.target.evidence = previewNoteReadiness(DIC.f0); }
    if (DIC.target.note && queueFull()) return;
    if (!M.paused) M.pause();
    DIC.on = true; dicShow('wait');
    fetch('/api/dictate/warm', { method: 'POST' }).catch(() => {});   // (the engine ready by the end of the words)
    try { await micOpen(); } catch (e) {
      DIC.on = false; dicShow('');
      setSave(TN(e?.name === 'NotAllowedError' ? 'st.dic.denied' : 'st.dic.noMic'), 'err'); return;
    }
    if (!DIC.on) return;   // (released, or Échap, while the microphone opened: nothing)
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) ?? '';
    DIC.rec = new MediaRecorder(DIC.stream, type ? { mimeType: type } : undefined);
    DIC.rec.ondataavailable = (ev) => { if (ev.data?.size) DIC.chunks.push(ev.data); };
    DIC.rec.onstop = () => dicDone();
    DIC.rec.start(250); DIC.t0 = performance.now();
    dicShow('listen', DIC.target.note ? TN('st.dic.at', { t: fmt(tOf(DIC.f0)) }) : TN('st.dic.into'));
    $('#dictee .k').textContent = how === 'key' ? TN(DIC.holding ? 'st.dic.keyHeld' : 'st.dic.keyTap', { key: window.Shortcuts?.show('dictate') || 'F2' }) : TN('st.dic.click');
    cancelAnimationFrame(DIC.raf); meter();
  }
  function dicStop(cancel = false) {
    if (!DIC.on) return;
    DIC.on = false; DIC.cancel = cancel; cancelAnimationFrame(DIC.raf);
    if (DIC.rec && DIC.rec.state !== 'inactive') DIC.rec.stop(); else { dicShow(''); micLater(); }
  }
  async function dicDone() {
    const secs = (performance.now() - DIC.t0) / 1000, rec = DIC.rec; DIC.rec = null; micLater();
    if (DIC.cancel) { dicShow(''); setSave(TN('st.dic.cancelled'), ''); return; }
    if (secs < 0.4 || DIC.peak < 0.012) { dicShow(''); setSave(TN('st.dic.nothing'), ''); return; }
    const blob = new Blob(DIC.chunks, { type: rec?.mimeType || 'audio/webm' }), target = DIC.target, f0 = DIC.f0;
    DIC.busy = true; dicShow('work');
    let r = null;
    try { r = await (await fetch('/api/dictate', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm', 'X-Prompt': encodeURIComponent(dicPrompt()) }, body: blob })).json(); }
    catch (e) { r = { ok: false, why: e.message }; }
    DIC.busy = false; dicShow('');
    if (!r?.ok) { setSave(TN('st.dic.failed', { why: r?.why ?? '' }), 'err'); return; }
    const text = String(r.text ?? '').trim();
    if (!text) { setSave(TN('st.dic.nothing'), ''); return; }
    if (target.note) {   // a new note at the frame where F2 was pressed, its words in it, ready to be read again
      const n = addNote(f0, null, false, {text,source:target.source,...(target.evidence ? {previewReadiness:target.evidence} : {})}); if (!n) return;
      requestAnimationFrame(() => { const ta = document.querySelector(`.card[data-id="${n.id}"] textarea.main`); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.scrollIntoView({ block: 'nearest' }); } });
    } else {
      const el = targetEl(target);
      if (!el) { setSave(TN('st.dic.lost'), 'err'); copy(text); return; }   // (its field gone meanwhile: the words kept in the clipboard)
      const v = el.value, a = Math.min(target.start, v.length), b = Math.min(target.end, v.length);
      const before = v.slice(0, a), after = v.slice(b);
      const words = (before && !/\s$/.test(before) ? ' ' : '') + text + (after && !/^\s/.test(after) ? ' ' : '');
      el.focus(); el.setRangeText(words, a, b, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));   // (as if typed: the note, the answer, the request take it)
    }
    const nw = text.split(/\s+/).length; setTimeout(() => setSave(TN('st.dic.done', { n: nw }), 'ok'), 900);   // (once the note is saved: « Enregistré » would cover it)
  }
  // F2 (Aide › Raccourcis clavier: « dictate »), before every other key — also in a text field, where the studio's keys rest
  window.addEventListener('keydown', (e) => {
    if (DIC.on && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); dicStop(true); return; }
    if (!window.Shortcuts?.is?.(e, 'dictate')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat) return;
    if (DIC.on) { dicStop(); return; }   // (tapped before: this press ends it)
    DIC.holding = true; DIC.downAt = performance.now(); dicStart('key');
  }, true);
  window.addEventListener('keyup', (e) => {
    if (!DIC.holding || !window.Shortcuts?.is?.(e, 'dictate')) return;
    DIC.holding = false;
    if (DIC.on && performance.now() - DIC.downAt > HOLD) dicStop();   // held: released = the end
    else if (DIC.on) $('#dictee .k').textContent = TN('st.dic.keyTap', { key: window.Shortcuts?.show('dictate') || 'F2' });
  }, true);
  window.addEventListener('blur', () => { if (DIC.on && DIC.holding) { DIC.holding = false; dicStop(); } });   // (released in another window)
  // the microphone of the rail: held = while held, clicked = until clicked again; the field with the cursor keeps it
  {
    const b = $('#bMic'); let down = 0;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();   // (the focus stays in the field: the words go there)
      if (DIC.on) { dicStop(); down = 0; return; }
      down = performance.now(); DIC.holding = false; dicStart('click');
      b.setPointerCapture?.(e.pointerId);
    });
    const up = () => { if (down && DIC.on && performance.now() - down > HOLD) dicStop(); down = 0; };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    b.addEventListener('click', (e) => e.preventDefault());
  }
  $('#dictee .x').addEventListener('pointerdown', (e) => { e.preventDefault(); dicStop(true); });
  window.__dictate = { state: () => ({ on: DIC.on, busy: DIC.busy, target: DIC.target && (DIC.target.note ? 'note' : DIC.target.id ?? DIC.target.cls), f0: DIC.f0, mic: !!DIC.stream?.active }) };   // for tests

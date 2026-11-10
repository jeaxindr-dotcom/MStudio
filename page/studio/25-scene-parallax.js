// Scene is a review surface. The only persistent edit here is an agent request.
{
  const tr = (fr, en) => FR ? fr : en;
  let intent = 0, source = 'unknown', offered = false, checking = false, failed = false, submitting = false;
  let observed3d = null, checkedPlayer = null, errorText = '';
  const choiceKey = () => 'parallaxChoice.' + META?.notesFile;
  const keep2d = () => store.get(choiceKey(), '') === '2d';
  const reopen = document.createElement('button');
  reopen.type = 'button'; reopen.className = 'soft'; reopen.id = 'sceneParallaxReopen';
  reopen.textContent = tr('Parallaxe 3D…', '3D parallax…');
  reopen.style.display = 'none'; $('#tab-scene > .bar').append(reopen);
  const known3d = () => META?.kind === 'brambleshire' || !!SP?.stage?.scene3d || SP?.stage?.kind === '3d'
    || (SP && observed3d === SP);
  function wording() {
    const context = [
      tr('Projet', 'Project') + ' « ' + META.title + ' »',
      META.composition, META.coulissesFile || META.root, META.videoPath,
      tr('Image', 'Frame') + ' ' + curFrame() + ' / ' + Math.max(0, FRAMES-1) + ' · ' + FPS + ' fps · ' + CW + ' × ' + CH,
    ].filter(Boolean).join(' · ');
    const intro = source === '2d' && META.engine === 'hyperframes'
      ? tr('Crée une composition Remotion avec parallaxe à partir des éléments du projet HTML HyperFrames. Conserve le projet HTML original.', 'Create a Remotion parallax composition from the assets of the HyperFrames HTML project. Preserve the original HTML project.')
      : source === 'video'
      ? tr('Crée ou adapte un projet Remotion à partir des sources disponibles pour cette vidéo. Si le montage source ou les plans séparés manquent, dis-moi lesquels sont nécessaires. Conserve le master original.',
        'Create or adapt a Remotion project from the sources available for this video. If the source edit or separated layers are missing, tell me which ones you need. Preserve the original master.')
      : tr('Adapte la composition actuelle en scène 3D avec parallaxe dans Remotion.', 'Adapt the current composition into a 3D parallax scene in Remotion.');
    return [tr('Demande de mise en scène 3D avec parallaxe', '3D parallax scene request'), context, intro,
      tr('Répartis les éléments existants entre premier plan, plan moyen et arrière-plan. Donne à la caméra un mouvement mesuré qui révèle leur profondeur et garde le sujet et le texte lisibles.',
        'Separate the existing elements into foreground, middle ground and background. Give the camera a restrained move that reveals their depth and keeps the subject and text legible.'),
      tr('Conserve le cadrage de référence, la cadence, la durée en images, les coupes, les animations existantes, la synchronisation du son et les notes de revue. Vérifie l’aperçu Remotion et réponds à cette demande avec les changements réalisés.',
        'Preserve the reference framing, frame rate, duration in frames, cuts, existing animations, audio sync and review notes. Verify the Remotion preview and reply to this request with the changes made.'),
    ].join('\n\n');
  }
  function openScene(stage = false, reconsider = false) {
    if (!META) return;
    if (stage && staging) { setStaging(false); return; }
    if (window.__cgReady && CG.on) setPage('review');
    const current = ++intent;
    offered = true; checking = false; failed = false; errorText = '';
    if (reconsider) store.set(choiceKey(), '');
    if (known3d()) source = '3d';
    else if (!META.features?.code) source = 'video';
    else source = 'unknown';
    setTab('scene');
    if (source === '3d') { if (stage) setStaging(true); return; }
    if (source === 'video') return;
    checking = true; renderScene();
    async function detect() {
      // Never classify a pending, crashed or stale Player as a 2D scene.
      let sp = null;
      for (let i = 0; i < 80 && current === intent && onTab('scene'); i++) {
        if (STATUS.code?.status === 'error') break;
        if (STATUS.code?.version && !codeLoad && (!SP || codeVer !== STATUS.code.version)) await loadCode();
        sp = SP;
        if (sp?.stage && sp.frameReady() && !sp.frameLoading?.() && !sp.crashed?.() && codeVer === STATUS.code?.version) {
          const three = await sp.stage.hasScene();
          if (current !== intent || !onTab('scene')) return;
          if (SP === sp && sp.frameReady() && !sp.crashed?.() && (three === true || three === false || sp.hyperframes)) {
            source = three || sp.stage.kind === '3d' ? '3d' : '2d';
            checkedPlayer = sp;
            if (source === '3d') observed3d = sp;
            checking = false; renderScene();
            if (stage && (source === '3d' || keep2d())) await setStaging(true);
            return;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (current === intent && onTab('scene')) { checking = false; failed = true; renderScene(); }
    }
    detect().catch(() => { if (current === intent && onTab('scene')) { checking = false; failed = true; renderScene(); } });
  }
  reopen.onclick = () => openScene(false, true);
  function render(box) {
    if (known3d()) { source = '3d'; observed3d = SP; }
    else if (source === '2d' && checkedPlayer !== SP) source = 'unknown';
    const n = byId(parallaxId);
    const kept = keep2d();
    const eligible = source === 'video' || source === '2d';
    reopen.style.display = offered && eligible && kept && !n ? '' : 'none';
    if (!META || source === '3d' || staging || (!offered && !n) || (kept && !n)) return false;
    const lot = STATUS.lots?.find(l => l.ids?.includes(parallaxId));
    const sent = lot?.lot ?? n?.lot;
    const status = lot?.claude?.status;
    let heading, description, actions = [];
    const action = (id,label,run,primary=false,disabled=false) => actions.push({id,label,run,primary,disabled});
    const stay = () => { store.set(choiceKey(), '2d'); renderScene(); if (source === '2d') setStaging(true); };
    async function accept() {
      if (submitting || sending || !NOTES_OK || known3d()) return;
      submitting = true; errorText = ''; renderScene();
      try {
        if (!await sendPrompt({request:parallaxId, text:wording()})) {
          errorText = tr('Envoi non confirmé. Tu peux réessayer ici.', 'Delivery not confirmed. You can retry here.');
        }
      } finally { submitting = false; renderScene(); }
    }
    if (sent) {
      heading = tr('Demande de parallaxe 3D', '3D parallax request');
      description = tr('Lot ', 'Batch ') + sent + ' · ' + (status === 'taken'
        ? tr('prise en charge par l’agent', 'picked up by the agent') : status === 'done'
          ? tr('traitée par l’agent', 'completed by the agent') : status === 'declined'
            ? tr('refusée par l’agent', 'declined by the agent') : tr('envoyée, en attente de prise en charge', 'sent, awaiting pickup'));
      action('sceneRequestAgent', tr('Voir dans Agent','View in Agent'), () => setTab('agent'));
      if (!STATUS.agent?.watching && !status) action('sceneRequestConnect', T('st.agent.connect'), openConnect);
      if (source === '2d') action('sceneRequestKeep', tr('Ouvrir la scène 2D','Open 2D scene'), stay);
    } else if (n || eligible) {
      heading = tr('Créer une scène 3D avec parallaxe ?', 'Create a 3D parallax scene?');
      description = source === '2d' && META.engine === 'hyperframes'
        ? tr('L’agent peut créer une composition Remotion avec parallaxe à partir de ce projet HTML. Le projet HyperFrames original est conservé.', 'The agent can create a Remotion parallax composition from this HTML project. The original HyperFrames project is preserved.')
        : source === 'video'
        ? tr('Cette vidéo est un rendu. L’agent peut créer ou adapter sa composition Remotion à partir des sources disponibles.',
          'This is a rendered video. The agent can create or adapt its Remotion composition from the available source files.')
        : tr('L’agent peut séparer les plans et animer la caméra en profondeur tout en conservant le montage, le son et les notes.',
          'The agent can separate the layers and animate the camera in depth while preserving the edit, audio and review notes.');
      if (errorText) description += ' ' + errorText;
      action('sceneRequestSend', submitting ? tr('Envoi…','Sending…') : n ? tr('Réessayer l’envoi','Retry sending') : tr('Oui, demander à l’agent','Yes, ask the agent'), accept, true, sending || submitting || !NOTES_OK);
      action('sceneRequestKeep', tr('Rester en 2D','Stay in 2D'), stay, false, submitting);
    } else {
      heading = tr('Détection de la scène','Detecting the scene');
      description = checking ? tr('En attente de l’image du lecteur Remotion…','Waiting for the Remotion player frame…')
        : tr('Le type de scène sera disponible lorsque l’aperçu sera prêt.', 'The scene type will be available once the preview is ready.');
      if (failed || !checking) action('sceneRequestRetry',tr('Vérifier l’aperçu','Check preview'),() => openScene());
    }
    const key = JSON.stringify([heading,description,actions.map(a=>[a.id,a.label,a.disabled])]);
    if (box.firstElementChild?.dataset.parallax === key) return true;
    const part = document.createElement('div'); part.className = 'box'; part.dataset.parallax = key;
    const title = document.createElement('div'); title.className = 'ttl'; title.textContent = heading;
    const text = document.createElement('p'); text.className = 'muted'; text.textContent = description;
    part.append(title,text);
    const row = document.createElement('div'); row.className = 'row'; row.style.flexWrap = 'wrap';
    for (const a of actions) {
      const b = document.createElement('button'); b.type = 'button'; b.className = a.primary ? 'primary' : 'soft';
      b.id = a.id; b.textContent = a.label; b.onclick = a.run; b.disabled = a.disabled; row.append(b);
    }
    part.append(row); box.replaceChildren(part); return true;
  }
  window.CoulissesScene = {open:openScene, render};
}

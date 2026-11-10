/* No media or generated code is executed in the library page. */
window.createReconstructionEditor=({language,reveal,openProject})=>{
  const tr=(fr,en)=>language==='fr'?fr:en;
  const label=tr('Reconstruire en Remotion','Rebuild in Remotion'), key='hub.reconstruction.v1';
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const dlg=el('dialog');dlg.id='reconstructDialog';dlg.setAttribute('aria-labelledby','rcTitle');
  dlg.innerHTML='<div class="rv-shell"><header class="rv-header"><h2 id="rcTitle"></h2><button class="soft" type="button" id="rcClose"></button></header><section class="rv-body rc-content"></section><p class="rv-error" role="alert" hidden></p><footer class="rv-footer"></footer></div>';
  document.body.append(dlg);
  const $=s=>dlg.querySelector(s),body=$('.rv-body'),foot=$('footer'),err=$('.rv-error');
  $('#rcClose').textContent=tr('Fermer','Close');$('#rcClose').onclick=()=>dlg.close();
  let s={},timer=0,epoch=0,phase='',finished=false,sending=null;
  try{
    s=JSON.parse(sessionStorage.getItem(key))||{};
    // A navigating document can observe its fetch being aborted just before reload.
    // The fresh page can safely ask for that same request once.
    if(s.request)delete s.startError;
  }catch{}
  const save=()=>{try{if(s.job||s.request)sessionStorage.setItem(key,JSON.stringify(s));else sessionStorage.removeItem(key);}catch{}};
  const clear=()=>{s={};finished=false;phase='';clearTimeout(timer);epoch++;save();};
  dlg.addEventListener('close',()=>{if(dlg.open)return;clearTimeout(timer);epoch++;if(finished)clear();});
  function error(msg=''){err.textContent=msg;err.hidden=!msg;}
  function panel(title){$('#rcTitle').textContent=title;body.replaceChildren();foot.replaceChildren();error();}
  function button(parent,id,txt,fn,primary=false){const b=el('button',txt);b.type='button';b.id=id;b.className=primary?'rv-primary':'soft';parent.append(b);b.onclick=async()=>{b.disabled=true;error();try{await fn();}catch(e){error(e.message);}finally{b.disabled=false;}};return b;}
  const p=(text,hint=false)=>{const n=el('p',text);if(hint)n.className='rc-hint';body.append(n);return n;};
  async function api(url,data,signal){
    const r=await fetch(url,data===undefined?{cache:'no-store',signal}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal});
    const j=await r.json();if(!r.ok||!j.ok)throw Object.assign(new Error(j.why||j.error||String(r.status)),{status:r.status});return j;
  }
  const url=()=>'/api/reverse/reconstruction/'+encodeURIComponent(s.job);
  function field(text,id){const l=el('label',text),f=el('input');f.id=id;f.type='text';l.htmlFor=id;body.append(l);return [l,f];}
  function intake(){
    phase='form';panel(label);
    p(tr('L’agent observe le mouvement et recrée les textes, formes et trajectoires en calques Remotion. Le MP4 ne sert que de référence.','The agent studies motion and recreates text, shapes and paths as Remotion layers. The MP4 serves only as a reference.'));
    p(tr('Adapté au motion design. Les prises de vues et modèles 3D ne sont pas récupérés. Une piste audio présente est extraite séparément.','Designed for motion graphics. Camera footage and 3D models are not recovered. Existing audio is extracted separately.'),true);
    const [lf,file]=field(tr('Vidéo de référence','Reference video'),'rcPath');file.placeholder=tr('Chemin du fichier vidéo','Path to the video file');file.value=s.path||'';
    const row=el('div');row.className='rv-file';row.append(file);lf.append(row);
    button(row,'rcBrowse',tr('Parcourir…','Browse…'),async()=>{
      const r=await fetch('/api/import/pick',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({what:'video'})}).then(r=>r.json());
      if(r.ok)file.value=r.path;else if(!r.cancelled)throw Error(r.why||tr('Colle le chemin du fichier.','Paste the video path.'));
    });
    const [ln,name]=field(tr('Nom du projet','Project name'),'rcName');name.maxLength=120;name.value=s.name||'';ln.append(name);
    const l=el('label',tr('Agent','Agent')),mode=el('select');mode.id='rcMode';
    for(const [v,t] of [['cli',tr('Codex CLI · automatique','Codex CLI · automatic')],['handoff',tr('Mon agent · lui remettre le dossier','My agent · hand off the brief')]]){const o=el('option',t);o.value=v;mode.append(o);}l.append(mode);body.append(l);
    const hint=p('',true);const explain=()=>hint.textContent=mode.value==='cli'
      ?tr('Utilise une nouvelle session de ton Codex CLI connecté. Des images de référence lui sont transmises.','Uses a new session of your signed-in Codex CLI and sends it reference images.')
      :tr('MStudio prépare les images et les instructions à transmettre au chat de ton choix.','MStudio prepares images and instructions for the chat you choose.');
    mode.value=s.agent==='handoff'?'handoff':'cli';mode.onchange=explain;explain();
    const submit=button(foot,'rcStart',tr('Lancer la reconstruction','Start reconstruction'),async()=>{
      const input=file.value.trim();if(!input){file.focus();return;}
      const request={path:input,name:name.value.trim(),agent:mode.value,requestId:crypto.randomUUID()};
      s={path:request.path,name:request.name,agent:request.agent,request};save();
      await startPending();
    },true);
    file.onkeydown=name.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();submit.click();}};
    file.focus();
  }
  function resetForm(){clear();intake();}
  function startStatus(){
    phase='starting';panel(label);
    const msg=el('output',tr('Démarrage de la reconstruction…','Starting reconstruction…'));
    msg.setAttribute('role','status');body.append(msg);
  }
  function startFailed(){
    phase='start-error';panel(label);error(s.startError);
    p(tr('Vérifie si MStudio a reçu la demande. Si tu la retires de cette fenêtre, un travail déjà démarré peut continuer.',
      'Check whether MStudio received the request. Removing it from this window can leave a started job running.'),true);
    button(foot,'rcForget',tr('Retirer la demande','Remove request'),resetForm);
    button(foot,'rcReconnect',tr('Retrouver la demande','Recover request'),()=>{delete s.startError;save();return startPending();},true);
  }
  const validId=id=>typeof id==='string'&&/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id);
  async function startPending(){
    const request=s.request;
    if(!request||!validId(request.requestId)||typeof request.path!=='string'||!['cli','handoff'].includes(request.agent)){
      panel(label);error(tr('La demande enregistrée est illisible.','The saved request could not be read.'));
      button(foot,'rcForget',tr('Choisir une vidéo','Choose a video'),resetForm,true);return;
    }
    if(s.startError){startFailed();return;}
    startStatus();
    if(sending?.request===request)return sending.promise;
    // Persist the exact POST before issuing it. If its response is lost to a reload,
    // the server recognizes this requestId and returns the previously accepted job.
    const attempt={request};sending=attempt;
    attempt.promise=(async()=>{
      try{
        const j=await api('/api/reverse/reconstruct',request,AbortSignal.timeout(20000));
        if(!validId(j.job))throw Error(tr('Réponse de démarrage illisible.','The start response could not be read.'));
        s={job:j.job,name:j.name,path:request.path};save();await poll(++epoch);
      }catch(e){
        if(Number.isInteger(e.status)&&e.status>=400&&e.status<500&&e.status!==408){
          s={path:request.path,name:request.name,agent:request.agent};save();
          if(dlg.open){intake();error(e.message);}
        }else{
          s.startError=e.message||tr('Accusé de réception indisponible.','No acknowledgment was received.');save();
          if(dlg.open)startFailed();
        }
      }finally{if(sending===attempt)sending=null;}
    })();
    return attempt.promise;
  }
  function cancel(){return api(url()+'/cancel',{}).then(()=>poll(++epoch));}
  function progress(j){
    if(phase!=='working'){
      phase='working';panel(label);p(s.name);const bar=el('progress');bar.id='rcProgress';bar.max=100;bar.setAttribute('aria-label',label);body.append(bar);
      const msg=el('output');msg.id='rcStatus';msg.setAttribute('role','status');body.append(msg);
      p(tr('Tu peux fermer ce panneau et le rouvrir pendant le travail. Laisse MStudio ouvert.','You can close and reopen this panel while the job runs. Keep MStudio open.'),true);
      button(foot,'rcCancel',tr('Annuler','Cancel'),cancel);
    }
    $('#rcProgress').value=j.progress;$('#rcStatus').textContent=j.message||j.state;
  }
  function handoff(j){
    phase='waiting';panel(tr('Reprendre avec un agent','Continue with an agent'));if(j.error)error(j.error);
    p(tr('Transmets cette consigne à ton agent. Une fois les calques enregistrés, vérifie le rendu ici.','Give this instruction to your agent. Once the layers are saved, verify the render here.'));
    const prompt=tr('Lis le brief de reconstruction Remotion et ses planches : ','Read the Remotion reconstruction brief and its contact sheets: ')+j.handoff.brief+'\n'+tr('Enregistre les calques éditables demandés ici : ','Write the requested editable layers here: ')+j.handoff.layers;
    body.append(el('pre',prompt));
    button(body,'rcCopy',tr('Copier la consigne','Copy instruction'),()=>navigator.clipboard.writeText(prompt));
    const resume=action=>async()=>{await api(url()+'/'+action,{});phase='';await poll(++epoch);};
    button(foot,'rcCancel',tr('Annuler','Cancel'),cancel);
    button(foot,'rcRetry',tr('Réessayer avec Codex CLI','Retry with Codex CLI'),resume('retry'));
    button(foot,'rcVerify',tr('Vérifier et rendre','Verify and render'),resume('verify'),true);
  }
  async function poll(ticket){
    clearTimeout(timer);if(!s.job||ticket!==epoch||!dlg.open)return;
    try{
      const j=await api(url());if(ticket!==epoch||!dlg.open)return;
      if(j.state==='done'){
        finished=true;phase='done';panel(tr('Projet reconstruit','Rebuilt project'));p(j.project.title);
        const r=j.report||{};
        if(Number.isInteger(r.layerCount)) p(r.layerCount+tr(' calque(s) éditable(s)',' editable layer(s)')+' · '+r.sceneCount+tr(' scène(s)',' scene(s)'));
        if(Number.isFinite(r.visualScore))p(tr('Ressemblance mesurée sur les images de contrôle : ','Measured similarity on sampled frames: ')+Math.round(r.visualScore*100)+' %'+(r.approximate?tr(' · résultat approximatif',' · approximate result'):''),true);
        for(const note of (r.approximations||[]).slice(0,3))p(note,true);
        p(tr('Le rendu a été vérifié sans le MP4 source. Les écarts visuels sont consignés dans le rapport du projet.','The render was verified without the source MP4. Visual differences are recorded in the project report.'));
        p(j.project.dir,true);
        button(foot,'rcReveal',tr('Voir dans la bibliothèque','Show in library'),async()=>{dlg.close();await reveal(j.project);});
        button(foot,'rcOpenStudio',tr('Ouvrir le studio','Open studio'),async()=>{dlg.close();await openProject(j.project);},true);await reveal(j.project);
      }else if(j.state==='awaiting-agent'){handoff(j);}
      else if(['error','cancelled'].includes(j.state)){finished=true;panel(label);p(j.error||tr('Reconstruction annulée.','Reconstruction cancelled.'));button(foot,'rcRestart',tr('Choisir une vidéo','Choose a video'),resetForm,true);}
      else{progress(j);timer=setTimeout(()=>poll(ticket),1300);}
    }catch(e){if(ticket!==epoch)return;phase='';panel(label);error(e.message);if(e.status!==404)button(foot,'rcReconnect',tr('Se reconnecter','Reconnect'),()=>poll(++epoch));button(foot,'rcRestart',tr('Recommencer','Start over'),resetForm);}
  }
  return {label,pending:()=>!!(s.job||s.request),open:async()=>{if(dlg.open)return;dlg.showModal();phase='';if(s.job)await poll(++epoch);else if(s.request)await startPending();else intake();}};
};

// The hub owns the download. Browsers only poll local state while this dialog is open.
(() => {
  const trigger = document.getElementById('appUpdateButton');
  if (!trigger || document.body.dataset.product !== 'MStudio') return;
  const T = window.T;
  const label = (name, values) => T('common.appUpdate.' + name, values);
  const dialog = document.createElement('dialog');
  dialog.id = 'appUpdateDialog'; dialog.setAttribute('aria-labelledby', 'appUpdateTitle');
  dialog.innerHTML = `<h2 id="appUpdateTitle"></h2>
    <dl><div id="appInstalledVersion"><dt></dt><dd></dd></div><div id="appLatestVersion"><dt></dt><dd></dd></div></dl>
    <p id="appUpdateStatus" role="status"></p>
    <div id="appUpdateProgress" hidden><progress max="100"></progress><span class="update-count"></span></div>
    <p id="appUpdateError" role="alert"></p>
    <div class="update-actions"><button type="button" id="appUpdateClose"></button><button type="button" id="appUpdateAction" class="primary"></button></div>`;
  document.body.append(dialog);
  const find = selector => dialog.querySelector(selector);
  const action = find('#appUpdateAction'), close = find('#appUpdateClose'), status = find('#appUpdateStatus');
  const problem = find('#appUpdateError'), progress = find('#appUpdateProgress'), bar = find('progress');
  find('h2').textContent = label('title');
  find('#appInstalledVersion dt').textContent = label('installed');
  find('#appLatestVersion dt').textContent = label('latest');
  close.textContent = T('menu.dlg.close');
  bar.setAttribute('aria-label', label('downloading'));
  const numbers = new Intl.NumberFormat(document.documentElement.lang, {maximumFractionDigits:1});
  const unit = document.documentElement.lang === 'fr' ? 'Mo' : 'MB';
  let state = {}, timer, busy = '', command = '', failure = '';
  const endpoint = '/api/app-update';
  const humanError = data => {
    if (data.errorCode && document.documentElement.lang === 'en') {
      const key = 'common.appUpdate.error.' + data.errorCode;
      const translated = T(key);
      if (translated !== key) return translated;
    }
    return data.error || label('network');
  };
  async function request(operation) {
    let response;
    try {
      response = await fetch(endpoint + (operation ? '/' + operation : ''), operation ?
        {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}', cache:'no-store'} : {cache:'no-store'});
    } catch {
      throw new Error(label('network'));
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(humanError(data));
      error.status = response.status;
      throw error;
    }
    if (typeof data.status !== 'string') throw new Error(label('network'));
    return data;
  }

  function draw() {
    const phase = busy === 'check' ? 'checking' : state.status || 'idle';
    const installed = find('#appInstalledVersion'), latest = find('#appLatestVersion');
    installed.hidden = !state.currentVersion; installed.querySelector('dd').textContent = state.currentVersion || '';
    latest.hidden = !state.latestVersion; latest.querySelector('dd').textContent = state.latestVersion || '';
    progress.hidden = phase !== 'downloading';
    if (!progress.hidden) {
      const total = Number(state.totalBytes), received = Number(state.downloadedBytes) || 0;
      if (total > 0) bar.value = Math.min(100, received / total * 100); else bar.removeAttribute('value');
      const bytes = numbers.format(received / 1e6) + (total > 0 ? ' / ' + numbers.format(total / 1e6) : '');
      find('.update-count').textContent = bytes + ' ' + unit;
    }
    const description = ['checking','current','available','downloading','ready','installing'].includes(phase) ? phase : null;
    status.textContent = description ? label(description, {v:state.latestVersion}) : '';
    problem.textContent = failure || (phase === 'error' ? humanError(state) : '');
    const failedDownload = phase === 'error' && state.errorStage !== 'install' && !!state.latestVersion && state.latestVersion !== state.currentVersion;
    command = phase === 'ready' ? 'install' : phase === 'available' || failedDownload ? 'download'
      : ['idle','current','error'].includes(phase) ? 'check' : '';
    action.hidden = !command; action.disabled = !!busy;
    if (command) action.textContent = label(command === 'check' && (phase === 'current' || state.errorStage === 'install') ? 'checkAgain'
      : phase === 'error' ? 'retry' : command);
  }

  function schedulePoll() {
    clearTimeout(timer);
    if (dialog.open && !busy && ['downloading','checking','installing'].includes(state.status))
      timer = setTimeout(() => refresh(false), state.status === 'installing' ? 3000 : 850);
  }
  async function refresh(opening) {
    if (busy) return;
    busy = 'read'; draw();
    try {
      state = await request(); failure = '';
    } catch (error) {
      failure = error.message;
    } finally {
      busy = ''; draw();
    }
    if (dialog.open && opening && !failure && ['idle','current','available'].includes(state.status)) return run('check');
    schedulePoll();
  }

  async function run(operation) {
    if (!operation || busy) return;
    clearTimeout(timer);
    busy = operation; failure = ''; draw();
    try {
      if (operation === 'install' && window.MStudioBeforeUpdate) await window.MStudioBeforeUpdate();
      state = await request(operation);
    } catch (error) {
      if (operation === 'install' && error.status === 409 && window.MStudioUpdateRefused) await window.MStudioUpdateRefused();
      failure = error.message || label('network');
    } finally {
      busy = ''; draw(); schedulePoll();
    }
  }
  action.onclick = () => run(command);
  close.onclick = () => dialog.close();
  dialog.addEventListener('close', () => { clearTimeout(timer); trigger.focus({preventScroll:true}); });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('keyup', event => event.stopPropagation());
  trigger.onclick = () => {
    if (document.getElementById('backStudio') && window.parent !== window) {
      const origin = document.referrer ? new URL(document.referrer).origin : '*';
      window.parent.postMessage({coulisses:'app-update'}, origin);
      return;
    }
    if (dialog.open) return;
    draw(); dialog.showModal(); close.focus(); refresh(true);
  };

  request().then(value => {
    state = value; trigger.hidden = false;
  }).catch(error => {
    // A source checkout or a remote review has no desktop update endpoint.
    trigger.hidden = [403,404].includes(error.status);
  });
})();

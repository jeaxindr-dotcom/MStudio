import fs from 'node:fs';
import path from 'node:path';

export function installedUpdateTarget(dir, localData = process.env.LOCALAPPDATA) {
  return process.platform === 'win32' && !!localData &&
    path.resolve(dir).toLowerCase() === path.resolve(localData, 'Programs', 'MStudio').toLowerCase() &&
    fs.existsSync(path.join(dir, 'mstudio.json')) && fs.existsSync(path.join(dir, 'MStudio.exe'));
}

const actions = new Map([
  ['/api/app-update', 'state'], ['/api/app-update/check', 'check'],
  ['/api/app-update/download', 'download'], ['/api/app-update/install', 'install'],
]);
export const updateAction = pathname => actions.get(pathname);

// Project code is displayed in a separate frame and the studio may also be
// reached over a private network. Only the local editor origin can request an update.
export function updateRequestStatus(req, action) {
  const {host, origin} = req.headers;
  if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host || '')) return 403;
  if (origin && origin !== 'http://' + host) return 403;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return 403;
  if (req.method !== (action === 'state' ? 'GET' : 'POST')) return 405;
  if (action !== 'state' && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return 415;
  return 200;
}

export function createUpdateController({updates, installation, schedule, checkIdle}) {
  let scheduling = null, previousError = null;
  function state() {
    const base = updates.state(), handoff = installation();
    if (!handoff || handoff.version === base.currentVersion) return base;
    if (handoff.status === 'installing') return {...base, status:'installing', latestVersion:handoff.version};
    if (handoff.status === 'error' && previousError !== JSON.stringify(handoff)) {
      return {...base, status:'error', errorStage:'install', error:handoff.error, errorCode:handoff.errorCode,
        latestVersion:base.latestVersion ?? handoff.version};
    }
    return base;
  }
  async function run(action, projectId) {
    const current = state();
    if (action === 'state' || current.status === 'installing') return current;
    if (action === 'check' || action === 'download') {
      const last = installation();
      if (last?.status === 'error') previousError = JSON.stringify(last);
      return action === 'check' ? updates.check() : updates.download();
    }
    if (action !== 'install') throw Object.assign(new Error('Unknown update operation'), {status:404});
    if (scheduling) return scheduling;
    scheduling = (async () => {
      const file = await updates.verifiedInstaller();
      await checkIdle();
      await schedule(file, projectId);
      previousError = null;
      return {...updates.state(), status:'installing', latestVersion:file.version};
    })().finally(() => { scheduling = null; });
    return scheduling;
  }
  return {run};
}

export async function relayUpdate(hub, action, projectId) {
  // The launcher's --hub argument owns the upstream, never a URL from the page.
  const target = new URL(hub);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port || target.username || target.password) {
    throw new Error('Invalid local MStudio library');
  }
  target.pathname = action === 'state' ? '/api/app-update' : '/api/app-update/' + action;
  target.search = '';
  if (action === 'install') target.searchParams.set('ep', projectId);
  const res = await fetch(target, {
    method:action === 'state' ? 'GET' : 'POST',
    ...(action === 'state' ? {} : {headers:{'Content-Type':'application/json'}, body:'{}'}),
    redirect:'error', signal:AbortSignal.timeout(90000),
  });
  if (!res.headers.get('content-type')?.includes('application/json')) throw new Error('MStudio library unavailable');
  return {data:await res.json(), status:res.status};
}

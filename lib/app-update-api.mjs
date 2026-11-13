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
  ['/api/app-update/defer', 'defer'], ['/api/app-update/cancel', 'cancel'],
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

export function createUpdateController({updates, installation, schedule, scheduledInstaller, cancel, checkIdle}) {
  let pendingChoice = Promise.resolve(), previousError = null;
  function state() {
    const base = updates.state(), handoff = installation();
    if (!handoff || handoff.version === base.currentVersion) return base;
    if (handoff.status === 'installing' || handoff.status === 'scheduled') {
      return {...base, status:handoff.status, latestVersion:handoff.version};
    }
    if (handoff.status === 'error' && previousError !== JSON.stringify(handoff)) {
      return {...base, status:'error', errorStage:'install', error:handoff.error, errorCode:handoff.errorCode,
        latestVersion:base.latestVersion ?? handoff.version};
    }
    return base;
  }
  async function choose(action, projectId) {
    const current = state();
    if (current.status === 'installing' || (action === 'defer' && current.status === 'scheduled')) return current;
    if (action === 'cancel') {
      if (current.status === 'scheduled') await cancel();
      return state();
    }
    if (action === 'install') await checkIdle();
    const scheduled = current.status === 'scheduled' ? scheduledInstaller?.() : null;
    const download = updates.state();
    const file = scheduled && (download.status !== 'ready' || download.latestVersion !== scheduled.version)
      ? scheduled : await updates.verifiedInstaller();
    const handoff = await schedule(file, projectId || scheduled?.projectId, action);
    previousError = null;
    return {...updates.state(), status:handoff?.status ?? (action === 'defer' ? 'scheduled' : 'installing'), latestVersion:file.version};
  }
  async function run(action, projectId) {
    if (action === 'state') return state();
    if (action === 'check' || action === 'download') {
      const current = state();
      if (current.status === 'installing' || current.status === 'scheduled') return current;
      const last = installation();
      if (last?.status === 'error') previousError = JSON.stringify(last);
      return action === 'check' ? updates.check() : updates.download();
    }
    if (!['install','defer','cancel'].includes(action)) throw Object.assign(new Error('Unknown update operation'), {status:404});
    const result = pendingChoice.then(() => choose(action, projectId));
    pendingChoice = result.catch(() => {});
    return result;
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
  // Every request must confirm that this library still owns the studio. A hub
  // restart must not silently offer updates which forget the project to reopen.
  if (projectId) target.searchParams.set('ep', projectId);
  const res = await fetch(target, {
    method:action === 'state' ? 'GET' : 'POST',
    ...(action === 'state' ? {} : {headers:{'Content-Type':'application/json'}, body:'{}'}),
    redirect:'error', signal:AbortSignal.timeout(90000),
  });
  if (!res.headers.get('content-type')?.includes('application/json')) throw new Error('MStudio library unavailable');
  return {data:await res.json(), status:res.status};
}

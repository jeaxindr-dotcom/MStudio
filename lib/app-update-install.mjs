// The updater runs outside the installation so Windows can replace the launcher
// and its Node runtime after the user closes their last MStudio window.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const statePath = dataDir => path.join(dataDir, 'updates', 'install-state.json');
const requestPath = (dataDir, ticket) => {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ticket || '')) throw new Error('Demande de mise à jour invalide.');
  return path.join(dataDir, 'updates', 'request-' + ticket + '.json');
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const interrupted = {status: 'error', errorCode: 'update-interrupted', error: 'La mise à jour a été interrompue.'};

function writeState(file, value) {
  const tmp = file + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(value), {flag:'wx'}); fs.renameSync(tmp, file); }
  finally { fs.rmSync(tmp, {force:true}); }
}
function readReceipt(dataDir) {
  try { return JSON.parse(fs.readFileSync(statePath(dataDir), 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}
export function installationStatus(dataDir) {
  const receipt = readReceipt(dataDir);
  if (!receipt || receipt.status === 'done') return null;
  const result = {status: receipt.status, version:receipt.version};
  if (receipt.status === 'scheduled') return result;
  if (receipt.status === 'error') return {...result, error:receipt.error, errorCode:receipt.errorCode};
  if (receipt.status !== 'installing') return {...result, ...interrupted};
  if (!receipt.pid) return Date.now() - receipt.startedAt < 30000 ? result : {...result, ...interrupted};
  try { process.kill(receipt.pid, 0); return result; }
  catch (err) { return err.code === 'EPERM' ? result : {...result, ...interrupted}; }
}

export function cancelScheduledUpdate(dataDir) {
  const current = readReceipt(dataDir);
  if (current?.status !== 'scheduled') return false;
  const request = requestPath(dataDir, current.ticket);
  fs.unlinkSync(statePath(dataDir));
  fs.rmSync(request, {force:true});
  return true;
}

// The download state in the hub is in memory. If the hub was restarted, the
// scheduled request still identifies the installer that was already verified.
export function readScheduledInstaller(dataDir) {
  const receipt = readReceipt(dataDir);
  if (receipt?.status !== 'scheduled') return null;
  const job = JSON.parse(fs.readFileSync(requestPath(dataDir, receipt.ticket), 'utf8'));
  if (job.ticket !== receipt.ticket || job.version !== receipt.version || job.mode !== 'defer') {
    throw new Error('La demande de mise à jour programmée est incohérente.');
  }
  return {path:job.installerPath, version:job.version, sha256:job.sha256, projectId:job.projectId};
}

export async function scheduleAppUpdate({installerPath, sha256, version, appDir, dataDir, projectId = '', language = 'fr', mode = 'install'}) {
  if (process.platform !== 'win32') throw new Error('La mise à jour nécessite Windows.');
  if (!['install','defer'].includes(mode)) throw new Error('Mode de mise à jour invalide.');
  if (!versionPattern.test(version) || !/^[0-9a-f]{64}$/i.test(sha256)) throw new Error('Version ou empreinte de la mise à jour invalide.');
  const dir = path.join(dataDir, 'updates');
  fs.mkdirSync(dir, {recursive:true});
  const setup = fs.realpathSync(installerPath), expected = path.join(fs.realpathSync(dir), 'MStudio-Setup-' + version + '-win-x64.exe');
  if (path.relative(expected, setup) !== '') {
    throw new Error('Le fichier ne correspond pas à la mise à jour téléchargée.');
  }
  if (projectId && !/^(?:E\d+|P[0-9a-f]{8})$/i.test(projectId)) throw new Error('Projet de reprise invalide.');
  const current = installationStatus(dataDir);
  if (current?.status === 'installing') return current;
  const previous = readReceipt(dataDir);
  if (mode === 'defer' && previous?.status === 'scheduled' && previous.version === version) return current;
  const source = fs.readFileSync(path.join(appDir, 'MStudio.Update.exe'));
  const helperDigest = digest(source);
  const workerDir = path.join(dir, 'assistant', helperDigest);
  fs.mkdirSync(workerDir, {recursive:true});
  const worker = path.join(workerDir, 'MStudio.Update.exe');
  try { fs.writeFileSync(worker, source, {flag:'wx'}); }
  catch (err) { if (err.code !== 'EEXIST') throw err; }
  if (digest(fs.readFileSync(worker)) !== helperDigest) throw new Error('L’assistant de mise à jour est endommagé.');
  const ticket = randomUUID(), stateFile = statePath(dataDir), startedAt = Date.now();
  const request = requestPath(dataDir, ticket);
  const initial = {status:mode === 'defer' ? 'scheduled' : 'installing', pid:0, ticket, version, startedAt};
  fs.writeFileSync(request, JSON.stringify({installerPath:setup, sha256, version, appDir, dataDir, projectId:projectId || '',
    language:language === 'en' ? 'en' : 'fr', ticket, hubPid:process.pid, desktopPid:process.ppid, mode}), {flag:'wx'});
  try { writeState(stateFile, initial); }
  catch (err) { fs.rmSync(request, {force:true}); throw err; }
  if (previous?.status === 'scheduled') fs.rmSync(requestPath(dataDir, previous.ticket), {force:true});
  if (mode === 'defer') return {status:'scheduled', version};
  try {
    // This is a Windows GUI executable. Hiding its startup window can hide
    // ShellExecute's file-security prompt and leave installation waiting forever.
    const child = spawn(worker, [request], {cwd:workerDir, detached:true, windowsHide:false, stdio:'ignore'});
    await new Promise((resolve,reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    // An acknowledged handoff survives the shutdown of the hub that sent it.
    for (let i = 0; i < 100; i++) {
      const status = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (status.ticket !== ticket) throw new Error('La demande de mise à jour a changé.');
      if (status.status === 'error') throw new Error(status.error);
      if (status.pid === child.pid) return {status:'installing', version};
      if (child.exitCode === 3) throw new Error(language === 'en'
        ? 'Another MStudio update is already in progress.' : 'Une autre mise à jour de MStudio est déjà en cours.');
      if (child.exitCode !== null) break;
      await delay(100);
    }
    throw new Error('L’assistant de mise à jour n’a pas répondu.');
  } catch (err) {
    const latest = readReceipt(dataDir);
    if (latest?.ticket === ticket && latest.status === 'installing') {
      writeState(stateFile, {...initial, status:'error', errorCode:'update-handoff', error:err.message});
    }
    throw err;
  } finally {
    fs.rmSync(request, {force:true});
  }
}

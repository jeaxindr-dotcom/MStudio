// Run the production handoff with a fixture desktop worker, and the real native
// validation/installation logic with a simulated Setup. No installed app is opened.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {installationStatus, scheduleAppUpdate} from '../lib/app-update-install.mjs';

if (process.platform !== 'win32') {console.log('Windows only (sauté)\n0 ok, 0 ko');process.exit(0);}
const root = fileURLToPath(new URL('../', import.meta.url));
const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mstudio-update-test-')), appDir = path.join(dir,'program'), dataDir = path.join(dir,'data');
const updates = path.join(dataDir, 'updates'), marker = path.join(appDir,'mstudio.json'), state = path.join(updates,'install-state.json');
const installerPath = path.join(updates, 'MStudio-Setup-2.3.4-win-x64.exe');
fs.mkdirSync(appDir); fs.mkdirSync(updates, {recursive: true}); fs.writeFileSync(installerPath,'test installer, never started');
fs.writeFileSync(marker, '{"name":"MStudio","version":"1.0.0"}');
const sha256 = createHash('sha256').update(fs.readFileSync(installerPath)).digest('hex');
const request = {installerPath, version:'2.3.4', sha256, appDir, dataDir, projectId:'Paaaa0000', language:'fr'};
let ok = 0;
try {
  const fixture = path.join(root,'tests/fixtures/MStudioUpdateTests.cs'), fake = path.join(appDir,'MStudio.Update.exe');
  const native = path.join(root,'app/MStudio.Update.cs');
  const compile = (main, output) => execFileSync(compiler,['/nologo','/platform:x64','/codepage:65001','/r:System.Web.Extensions.dll',
    '/r:System.Windows.Forms.dll','/main:'+main,'/out:'+output,fixture,native],{windowsHide:true});
  compile('HandoffFixture', fake); compile('NativeUpdateTests', path.join(dir,'native-tests.exe'));
  const ticket = 'dc5158e6-9c8f-47d8-8d15-85e8c63da52d', config = path.join(updates, 'request-'+ticket+'.json');
  fs.writeFileSync(config,JSON.stringify({...request,ticket,hubPid:process.pid}));
  execFileSync(path.join(dir,'native-tests.exe'),[config],{windowsHide:true});
  console.log('✓ Contrôle natif de la cible, de son empreinte et de la version obtenue. Annulation, intégrité et absence de rétrogradation.');ok++;
  assert.equal(installationStatus(dataDir),null);
  await assert.rejects(scheduleAppUpdate({...request, installerPath:marker}), /fichier/);
  await assert.rejects(scheduleAppUpdate({...request, projectId:'--file'}), /Projet/);
  console.log('✓ Une demande invalide ne lance aucun assistant.');ok++;
  assert.deepEqual(await scheduleAppUpdate(request),{status:'installing',version:request.version});
  const received = JSON.parse(fs.readFileSync(state));
  assert.ok(received.pid > 0 && received.pid !== process.pid);
  let worker;
  for (let i=0;i<50 && !worker;i++) {if(fs.existsSync(path.join(updates,'worker'))) worker = fs.readFileSync(path.join(updates,'worker'),'utf8');else await delay(30);}
  assert.ok(worker.startsWith(path.join(updates,'assistant')+path.sep));
  assert.deepEqual(await scheduleAppUpdate(request),installationStatus(dataDir));
  assert.equal(JSON.parse(fs.readFileSync(state)).ticket, received.ticket);
  console.log('✓ Assistant détaché hors du programme, confirmation du démarrage et clics dédupliqués.');ok++;
  fs.writeFileSync(path.join(updates,'finish'),'1');
  for (let i=0;i<80 && installationStatus(dataDir);i++) await delay(50);
  assert.equal(installationStatus(dataDir),null);
  fs.writeFileSync(state,JSON.stringify({status:'installing',pid:0,startedAt:1,version:'2.3.4'}));
  assert.equal(installationStatus(dataDir).status,'error');
  fs.writeFileSync(state,JSON.stringify({status:'error',version:'2.3.4',errorCode:'update-install',error:'annulée'}));
  assert.equal(installationStatus(dataDir).error,'annulée');
  console.log('✓ Fin normale, interruption et erreur conservées entre les ouvertures.');ok++;
  console.log(ok+' ok, 0 ko');
} finally {
  if (fs.existsSync(updates)) fs.writeFileSync(path.join(updates,'finish'),'1');
  if (path.dirname(dir) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('mstudio-update-test-')) {
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:200});
  }
}

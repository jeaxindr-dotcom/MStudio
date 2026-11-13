import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

if (process.platform !== 'win32') {console.log('Windows only (sauté)\n0 ok, 0 ko'); process.exit(0);}
const root = fileURLToPath(new URL('../', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mstudio-launch-arguments-'));
const bundle = path.join(dir, 'bundle'), fixture = path.join(dir, 'requests');
const framework = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319');
try {
  fs.mkdirSync(fixture);
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'app/build-mstudio.ps1'), '-OutputDir', bundle],
    {cwd: root, windowsHide: true, stdio: 'pipe', timeout: 60000});
  assert.ok(fs.statSync(path.join(bundle, 'MStudio.exe')).size > 10000);
  const references = ['System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Management.dll', 'System.Windows.Forms.dll', 'System.Web.Extensions.dll',
    path.join(framework, 'Microsoft.VisualBasic.dll'), path.join(bundle, 'Microsoft.Web.WebView2.Core.dll'), path.join(bundle, 'Microsoft.Web.WebView2.WinForms.dll')];
  const executable = path.join(bundle, 'NativeArgumentsTests.exe');
  execFileSync(path.join(framework, 'csc.exe'), ['/nologo', '/target:exe', '/platform:x64', '/codepage:65001', '/define:MSTUDIO', '/main:MStudioLauncherArguments', '/out:' + executable,
    ...references.map(file => '/r:' + file), ...['app/MStudio.cs', 'app/Launcher.cs', 'app/Lang.cs', 'app/MStudio.Update.cs', 'tests/fixtures/MStudioLauncherArguments.cs'].map(file => path.join(root, file))],
    {cwd: root, windowsHide: true, stdio: 'pipe', timeout: 60000});
  const output = execFileSync(executable, [fixture], {cwd: fixture, windowsHide: true, encoding: 'utf8', timeout: 20000,
    env: {...process.env, COULISSES_LANG: 'fr', MSTUDIO_DATA_DIR: path.join(dir, 'data')}});
  assert.match(output, /21 ok, 0 ko/);
  assert.equal(fs.existsSync(path.join(dir, 'data')), false, 'native parsing must not create an application profile');
  console.log(output.trim());
} finally {
  assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(dir).startsWith('mstudio-launch-arguments-'));
  fs.rmSync(dir, {recursive: true, force: true, maxRetries: 3});
}

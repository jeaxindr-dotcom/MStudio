import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {lang} from './i18n.mjs';

const run = promisify(execFile);
const script = fileURLToPath(new URL('./reverse-ocr.ps1', import.meta.url));
export async function recognizeReverseText(jpeg,analysis,signal) {
  const fr = lang() === 'fr';
  if (process.platform !== 'win32') throw Object.assign(new Error(fr ? 'La lecture de texte utilise la reconnaissance intégrée à Windows.' : 'Text recognition requires the Windows OCR engine.'),{status:501});
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'coulisses-ocr-'));
  try {
    const file = path.join(dir,'image.jpg');
    await fs.writeFile(file,jpeg,{signal});
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const {stdout} = await run(ps,['-NoProfile','-NonInteractive','-File',script,'-ImagePath',file,'-PreferredLanguage',fr?'fr':'en'],
      {windowsHide:true,timeout:35000,signal,encoding:'utf8',maxBuffer:1024*1024});
    const ocr = JSON.parse(stdout.trim());
    const sx = analysis.width / ocr.width, sy = analysis.height / ocr.height;
    return {ok:true,language:ocr.language,lines:ocr.lines.slice(0,200).map(l => ({
      text:l.text,x:Math.round(l.x*sx),y:Math.round(l.y*sy),width:Math.round(l.width*sx),height:Math.round(l.height*sy),
    }))};
  } catch(error) {
    signal.throwIfAborted();
    throw Object.assign(new Error(fr ? 'Reconnaissance Windows indisponible. Vérifie la langue OCR installée ou saisis le titre.' : 'Windows OCR is unavailable. Check the installed OCR language or enter the title.'),{status:503,cause:error});
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
}

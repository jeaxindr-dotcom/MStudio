// End-to-end render coverage uses isolated projects, never the user's episode.
// Backend: detached worker, checks, render/finish, locks, failure and cancellation.
// Frontend: actual studio page, direct click and progress for both project types.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
if (process.argv.includes('--restore')) {
  console.log('Isolated render tests do not replace an episode or require restoration.');
} else {
  for (const name of ['direct-render.mjs','direct-render-ui.mjs','render-compat.mjs']) {
    const code = await new Promise((resolve,reject) => {
      const child=spawn(process.execPath,[fileURLToPath(new URL(name,import.meta.url))],{stdio:'inherit',windowsHide:true});
      child.once('error',reject); child.once('exit',code=>resolve(code ?? 1));
    });
    if (code !== 0) { process.exitCode=code; break; }
  }
}

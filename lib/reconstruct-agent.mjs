import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {codexHome, resolveCodex} from './image-chat.mjs';
import {reconstructionAnswerSchema, reconstructionPrompt} from './reconstruct-instructions.mjs';
import {validateReconstructionLayers} from './reconstruct-layers.mjs';

const LIMIT = 2 * 1024 * 1024;
const completion = 'completion.json';
const textOf = (file, max = LIMIT) => {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > max) throw new Error('Invalid reconstruction file: ' + path.basename(file));
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
};

function inside(parent, file) {
  const real = fs.realpathSync(file);
  const rel = path.relative(parent, real);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))
    throw new Error('Reconstruction path outside its designated folder.');
  return real;
}

function configuredModel() {
  if (process.env.MSTUDIO_RECONSTRUCTION_MODEL) return process.env.MSTUDIO_RECONSTRUCTION_MODEL;
  try {
    // Read only the top-level preference; profiles and provider configuration
    // do not belong to this standalone, tool-free image transcription task.
    const config = textOf(path.join(codexHome(), 'config.toml'));
    const top = config.split(/^\s*\[/m, 1)[0];
    return /^\s*model\s*=\s*["']([a-z\d._:/-]+)["']/im.exec(top)?.[1] || null;
  } catch { return null; }
}

function agentEnvironment() {
  // Installed MStudio can be launched from a Codex chat. Do not inherit that
  // chat's bridge sockets, tokens, instruction overrides or NODE_OPTIONS.
  const keep = /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH|USER(?:NAME|DOMAIN)?|LANG|LC_ALL|CODEX_HOME|OPENAI_API_KEY|CODEX_API_KEY|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|SystemDrive|ProgramFiles(?:\(x86\))?|ProgramData)$/i;
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => keep.test(key)));
}

function stop(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true, stdio:'ignore', timeout:3000});
  else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
  }
  try { child.kill('SIGKILL'); } catch { /* already exited */ }
}

function reason(message) {
  // A provider error can include a nested JSON error, a request id or a URL.
  try {
    const obj = JSON.parse(message);
    message = obj.error?.message || obj.message || 'Codex CLI error';
  } catch { /* plain text */ }
  return String(message).replace(/\b(?:sk-|sess-)[A-Za-z0-9_-]+|Bearer\s+[^\s"']+/gi,'[redacted]')
    .replace(/https?:\/\/\S+/gi,'[URL]').replace(/[\u0000-\u001f]+/g,' ').trim().slice(0, 550);
}

async function askCodex({codex, dir, images, model, prompt, signal, say, progress}) {
  signal.throwIfAborted();
  const args = [...codex.pre, 'exec','--json','--ephemeral','--ignore-user-config','--skip-git-repo-check',
    '--sandbox','read-only','-c','approval_policy="never"','-c','web_search="disabled"','-c','project_doc_max_bytes=0',
    '-c','features.skip_host_skill_discovery=true',
    ...['apps','plugins','shell_tool','image_generation','multi_agent','view_image','skill_search'].flatMap(flag => ['-c','features.' + flag + '=false']),
    ...(model ? ['-m',model] : []), '-C',dir,'--output-schema','schema.json','-o',completion,
    ...images.flatMap(file => ['-i',file])];
  const child = spawn(codex.cmd, args, {cwd:dir, env:agentEnvironment(), windowsHide:true,
    detached:process.platform !== 'win32', shell:false, stdio:['pipe','pipe','pipe']});
  let threadId, usage, turnCompleted = false, turnFailed, lastError, stderr = '', pending = '';
  const abort = () => stop(child);
  signal.addEventListener('abort', abort, {once:true});
  if (signal.aborted) abort();
  child.stdin.on('error', () => {}); // Early exit on missing login, etc.
  child.stdin.end(prompt, 'utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
  child.stdout.setEncoding('utf8');
  function event(line) {
    let e;
    try { e = JSON.parse(line); } catch { return; }
    if (e.type === 'thread.started') threadId = e.thread_id;
    if (e.type === 'turn.started') progress();
    if (e.type === 'turn.failed') turnFailed = e.error?.message || 'turn.failed';
    if (e.type === 'error') lastError = e.message;
    if (e.type === 'turn.completed') { turnCompleted = true; usage = e.usage; }
  }
  // The same, potentially large, answer also appears inside an agent_message.
  // Only short lifecycle events matter here. Read the answer from -o.
  let skipping = false;
  child.stdout.on('data', chunk => {
    const lines = chunk.split('\n');
    for (let i=0; i<lines.length; i++) {
      if (!skipping) {
        if (pending.length + lines[i].length < 16384) pending += lines[i];
        else { pending = ''; skipping = true; }
      }
      if (i < lines.length-1) {
        if (!skipping) event(pending);
        skipping = false; pending = '';
      }
    }
  });
  try {
    const code = await new Promise((resolve,reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    if (pending) event(pending);
    signal.throwIfAborted();
    if (code !== 0 || !threadId || !turnCompleted || turnFailed) {
      const detail = reason(turnFailed || lastError || stderr.split(/\r?\n/).filter(Boolean).at(-1) || 'exit ' + code);
      throw new Error(say('La session Codex a échoué. ', 'The Codex session failed. ') + detail);
    }
    const values = {};
    for (const k of ['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens'])
      if (Number.isSafeInteger(usage?.[k])) values[k] = usage[k];
    return {threadId, usage:values};
  } finally { signal.removeEventListener('abort', abort); }
}

function readAnswer(dir, analysis, invalid) {
  let response, doc;
  try {
    response = JSON.parse(textOf(inside(dir, path.join(dir, completion))));
    doc = JSON.parse(response.layersJson);
  } catch { throw new Error(invalid); }
  if (typeof response.summary !== 'string' || !response.summary.trim() || response.summary.length > 8000 ||
    !['rebuilt','approximations','missing'].every(key => Array.isArray(response[key]) &&
      response[key].length <= 512 && response[key].every(v => typeof v === 'string' && v.trim() && v.length <= 4096)))
    throw new Error(invalid);
  let layers;
  try { layers = validateReconstructionLayers(doc, analysis); }
  catch (error) {
    if (response.layersJson.length < 150000) error.candidate = response.layersJson;
    throw error;
  }
  const {summary, rebuilt, approximations, missing} = response;
  return {layers, report:{summary, rebuilt, approximations, missing}};
}

export async function runReconstructionAgent({workspace, workspaceDir, projectDir, evidenceDir, briefPath, contactSheets,
  analysis, language='fr', signal, onProgress=()=>{}, feedback='', feedbackSheets=[], model=configuredModel(), timeoutMs=20*60000}) {
  const say = (fr,en) => language === 'fr' ? fr : en;
  signal?.throwIfAborted();
  const codex = resolveCodex();
  if (!codex) throw new Error(say('Codex CLI est introuvable. Installe Codex et connecte ton compte avant de relancer la reconstruction.',
    'Codex CLI was not found. Install Codex and sign in before starting the reconstruction again.'));
  const base = fs.realpathSync(workspace || workspaceDir);
  const project = inside(base, projectDir), evidence = inside(base, evidenceDir);
  if (path.dirname(project) !== base || path.dirname(evidence) !== base || project === evidence)
    throw new Error('Expected separate evidence and project directories in the authoring workspace.');
  const src = inside(project, path.join(project, 'src'));
  const brief = textOf(inside(evidence, briefPath || path.join(evidence, 'brief.md')), 120000);
  const index = JSON.parse(textOf(inside(evidence, path.join(evidence, 'index.json')), 600000));
  if (!Array.isArray(contactSheets) || contactSheets.length < 1 || contactSheets.length > 8 ||
    !Array.isArray(feedbackSheets) || feedbackSheets.length > 2 || (feedbackSheets.length && !feedback))
    throw new Error(say('Planches de référence invalides.', 'Invalid reconstruction contact sheets.'));
  const timeout = AbortSignal.timeout(timeoutMs);
  const jobSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const run = fs.mkdtempSync(path.join(base, '.codex-author-'));
  const target = path.join(src, 'layers.json');
  let original, previous;
  try {
    const images = [...contactSheets, ...feedbackSheets].map((sheet, i) => {
      const from = inside(evidence, sheet), ext = path.extname(from).toLowerCase(), stat = fs.statSync(from);
      if (!/^\.(png|jpe?g)$/.test(ext) || !stat.isFile() || stat.size < 1 || stat.size > 16*1024*1024)
        throw new Error(say('Image de référence invalide.', 'Invalid reference image.'));
      // Relative, generated names also work when the user directory contains
      // a comma (the CLI accepts comma-separated -i values).
      const name = 'sheet-' + (i+1) + ext;
      fs.copyFileSync(from, path.join(run,name));
      return name;
    });
    if (fs.existsSync(target)) {
      if (!feedback) throw new Error('The project already contains authored layers.');
      original = previous = textOf(inside(src, target));
    }
    fs.writeFileSync(path.join(run, 'schema.json'), JSON.stringify(reconstructionAnswerSchema));
    const invalid = say('Codex a renvoyé un document ou un rapport non valide.', 'Codex returned an invalid layer document or report.');
    const sessions = [], totalUsage = {};
    let repair;
    for (let attempt=1; attempt<=2; attempt++) {
      jobSignal.throwIfAborted();
      onProgress(attempt === 1 ? 10 : 63, attempt === 1 ? say('Démarrage de Codex', 'Starting Codex') :
        say('Correction du document par Codex', 'Codex is repairing the layer document'));
      fs.rmSync(path.join(run, completion), {force:true});
      const prompt = reconstructionPrompt({brief, index, language, repair, feedback, feedbackCount:feedbackSheets.length,
        previous:previous && previous.length < 150000 ? previous : undefined});
      const session = await askCodex({codex, dir:run, images, model, prompt, signal:jobSignal, say,
        progress:() => onProgress(attempt === 1 ? 28 : 68, say('Codex reconstruit les calques', 'Codex is reconstructing the layers'))});
      sessions.push(session);
      for (const [key,n] of Object.entries(session.usage)) totalUsage[key] = (totalUsage[key] || 0) + n;
      let answer;
      try { answer = readAnswer(run, analysis, invalid); }
      catch (e) {
        if (attempt === 2) throw e;
        repair = reason(e.message);
        previous = e.candidate || previous;
        continue;
      }
      jobSignal.throwIfAborted();
      const tmp = path.join(run,'validated-layers.json');
      fs.writeFileSync(tmp, JSON.stringify(answer.layers,null,2) + '\n', {flag:'wx'});
      if (inside(project,src) !== src) throw new Error('The project directory changed during reconstruction.');
      if (original === undefined) fs.linkSync(tmp,target);
      else {
        if (textOf(inside(src,target)) !== original)
          throw new Error(say('Les calques ont été modifiés pendant la reconstruction.', 'The layers were edited during reconstruction.'));
        fs.renameSync(tmp,target);
      }
      onProgress(100, say('Calques écrits par Codex', 'Codex authored the layers'));
      return {provider:'Codex CLI', model, threadId:session.threadId, sessions, usage:totalUsage,
        attempts:attempt, sheets:contactSheets.length, ...answer.report};
    }
  } catch (e) {
    if (signal?.aborted) throw signal.reason;
    if (timeout.aborted) throw new Error(say('Le délai de reconstruction par Codex est dépassé.', 'The Codex reconstruction timed out.'));
    throw e;
  } finally { fs.rmSync(run, {recursive:true, force:true, maxRetries:4, retryDelay:100}); }
}

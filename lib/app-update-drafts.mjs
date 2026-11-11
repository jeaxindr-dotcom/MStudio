import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {writeJson} from './episode.mjs';

// Each project server has exclusive use of its review. The file survives a port
// or app-directory change, outside both the installation and the user project.
export function projectUpdateDrafts(dataDir, notesFile, version) {
  const projectPath = path.resolve(notesFile);
  const key = createHash('sha256').update(process.platform === 'win32' ? projectPath.toLowerCase() : projectPath).digest('hex');
  const file = path.join(dataDir, 'update-drafts', key + '.json');
  function read() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  const badRequest = () => Object.assign(new Error('Invalid update draft'), {status:400});
  function validate(draft) {
    if (draft === null) return;
    if (typeof draft?.agent !== 'string' || typeof draft.words !== 'string' ||
        !draft.pending || typeof draft.pending !== 'object' || Array.isArray(draft.pending)) throw badRequest();
    for (const [id, value] of Object.entries(draft.pending)) {
      if (Object.hasOwn(Object.prototype, id) || typeof value?.text !== 'string' || !Array.isArray(value.images) ||
          !value.images.every(image => typeof image?.file === 'string' && typeof image.at === 'string')) throw badRequest();
    }
  }
  function change(command) {
    if (command?.action === 'begin') {
      validate(command.draft);
      const id = randomUUID();
      writeJson(file, {id, version, seq:0, draft:command.draft});
      return {id, seq:0};
    }
    if (!['save','clear'].includes(command?.action) || typeof command.id !== 'string' || !Number.isSafeInteger(command.seq) || command.seq < 0) throw badRequest();
    const current = read();
    if (!current || command.id !== current.id) return {applied:false};
    if (command.action === 'clear') {
      if (command.seq !== current.seq) return {applied:false};
      fs.unlinkSync(file);
    } else {
      validate(command.draft);
      if (command.seq <= current.seq) return {applied:false};
      writeJson(file, {...current, seq:command.seq, draft:command.draft});
    }
    return {applied:true};
  }
  return {exists:() => fs.existsSync(file), read:() => {
    const saved = read();
    return saved ? {...saved, sameVersion:saved.version === version} : null;
  }, change};
}

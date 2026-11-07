// Aucun studio ni moteur. Les deux petites instances Node ne font que réclamer
// le même dossier, comme deux studios redémarrés après la fin du propriétaire.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { CACHE } from '../lib/place.mjs';
import { prepareCaptures } from '../lib/lot-captures.mjs';
import { resumeLotCaptures } from '../lib/lots.mjs';
import { captureWorkspace, claimCaptureWorkspace, sweepCaptureWorkspaces } from '../lib/lot-capture-workspace.mjs';

if (process.argv[2] === 'reprendre') {
  const p = {REVUE: process.argv[3]}, lot = {lot: 7, captureState: {id: process.argv[4]}};
  process.send(claimCaptureWorkspace(p, lot));
  process.on('message', () => process.exit());
} else {
  const file = fileURLToPath(import.meta.url);
  function fixture(t) {
    const base = fs.mkdtempSync(path.join(CACHE, 'test-cache-lot-'));
    const p = {REVUE: base, LOTS: path.join(base, 'lots')};
    fs.mkdirSync(p.LOTS);
    const created = [];
    t.after(() => {
      assert.equal(path.dirname(path.resolve(base)), path.resolve(CACHE));
      for (const work of created) {
        assert.equal(path.dirname(path.resolve(work)), path.resolve(CACHE, 'lot-captures'));
        if (fs.lstatSync(work, {throwIfNoEntry: false})?.isSymbolicLink()) fs.unlinkSync(work);
        else fs.rmSync(work, { recursive: true, force: true });
      }
      fs.rmSync(base, { recursive: true, force: true });
    });
    async function make(lot, pid = process.pid) {
      const id = randomUUID(), work = captureWorkspace(id); created.push(work);
      await prepareCaptures(p, {lot, edits: [], captureState: {id}}, {});
      const marker = path.join(work, 'proprietaire.json');
      assert.ok(fs.existsSync(marker), 'Le studio doit identifier le propriétaire dès la préparation du dossier');
      const owner = JSON.parse(fs.readFileSync(marker, 'utf8'));
      assert.equal(owner.pid, process.pid);
      fs.writeFileSync(marker, JSON.stringify({...owner, pid}));
      return {work, id, lot};
    }
    return {p, make, created};
  }
  function deadPid() {
    const child = spawnSync(process.execPath, ['-e', ''], {windowsHide: true});
    assert.equal(child.status, 0); return child.pid;
  }
  test('La réouverture retire les dossiers abandonnés du seul projet, sans suivre leurs jonctions', async (t) => {
    const f = fixture(t), other = fixture(t), pid = deadPid();
    const lost = await f.make(1, pid), terminal = await f.make(2, pid), live = await f.make(3), foreign = await other.make(4, pid);
    fs.writeFileSync(path.join(f.p.LOTS, '002.json'), JSON.stringify({captureState: {id: terminal.id, status: 'ready'}}));
    const target = path.join(other.p.REVUE, 'dessin.png');
    fs.writeFileSync(target, 'dessin');
    fs.symlinkSync(other.p.REVUE, path.join(lost.work, 'public'), 'junction');
    const fake = captureWorkspace(randomUUID()); f.created.push(fake);
    fs.symlinkSync(foreign.work, fake, 'junction');
    resumeLotCaptures(f.p, () => {});
    assert.equal(fs.existsSync(lost.work), false); assert.equal(fs.existsSync(terminal.work), false);
    assert.equal(fs.readFileSync(target, 'utf8'), 'dessin');
    assert.ok(fs.existsSync(live.work) && fs.existsSync(foreign.work) && fs.lstatSync(fake).isSymbolicLink());
  });
  test('Un lot en attente et un JSON illisible restent intacts', async (t) => {
    const f = fixture(t), pid = deadPid(), queued = await f.make(1, pid), unknown = await f.make(2, pid);
    fs.writeFileSync(path.join(f.p.LOTS, '001.json'), JSON.stringify({captureState: {id: queued.id, status: 'pending'}}));
    fs.writeFileSync(path.join(f.p.LOTS, '002.json'), '{"');
    sweepCaptureWorkspaces(f.p, () => {});
    assert.ok(fs.existsSync(queued.work) && fs.existsSync(unknown.work));
  });
  test('Deux studios concurrents reprennent un seul propriétaire décédé', async (t) => {
    const f = fixture(t), item = await f.make(7, deadPid());
    function contender() {
      const proc = fork(file, ['reprendre', f.p.REVUE, item.id], {windowsHide: true, stdio: ['ignore', 'ignore', 'inherit', 'ipc']});
      const closed = new Promise(r => proc.once('close', r));
      t.after(async () => { if (proc.connected) proc.send('fin'); await closed; });
      return new Promise((resolve, reject) => { proc.once('message', resolve); proc.once('error', reject); proc.once('exit', () => reject(new Error('Studio de test interrompu'))); });
    }
    const choices = await Promise.all([contender(), contender()]);
    assert.deepEqual(choices.sort(), [false, true]);
    sweepCaptureWorkspaces(f.p, () => {}); assert.ok(fs.existsSync(item.work));
  });
}

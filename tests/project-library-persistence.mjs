// Isolated library restart/relocation checks. No browser, real project or render.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const studio = path.resolve(path.dirname(script), '..');
const mode = process.argv[2];
if (mode === 'read' || mode === 'writer') {
  const lib = await import('../lib/projects.mjs');
  if (mode === 'read') {
    const p = lib.project(process.argv[3]);
    console.log(JSON.stringify({ id: p.id, revue: p.REVUE, folder: lib.folderOf(p.id, p.channel), entry: lib.registry().projects.find((x) => x.id === p.id) }));
  } else {
    const n = process.argv[3];
    for (let i = 0; i < 12; i++) lib.setFolder([`concurrent-${n}-${i}`], `Dossier ${n}`);
  }
} else {
  const cache = path.join(studio, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  const fix = fs.mkdtempSync(path.join(cache, 'project-library-persistence-'));
  process.env.MSTUDIO_APP = '1';
  process.env.MSTUDIO_DATA_DIR = path.join(fix, 'appdata');
  process.env.COULISSES_LANG = 'fr';
  const lib = await import('../lib/projects.mjs');
  const { writeJson, readJson } = await import('../lib/episode.mjs');
  const { PROJECTS_FILE } = await import('../lib/place.mjs');
  let checks = 0;
  const check = (label, fn) => { fn(); checks++; console.log(`ok ${checks} - ${label}`); };
  const run = (revue) => {
    const p = spawnSync(process.execPath, [script, 'read', revue], { env: process.env, encoding: 'utf8', windowsHide: true });
    assert.equal(p.status, 0, p.stderr); return JSON.parse(p.stdout);
  };
  const make = (name) => {
    const root = path.join(fix, 'projets', name), source = path.join(root, `${name}.coulisses`);
    writeJson(source, { coulisses: 1, moteur: 'video', titre: `Projet ${name}`, chaine: 'Chaîne été 宇宙', revue: 'revue', export: { dossier: 'renders' } });
    return { root, source, imported: lib.importProject(source) };
  };
  const redirect = (fixture, name) => {
    const revue = path.join(fix, 'archive', name, 'revue');
    const d = readJson(path.join(fixture.imported.revue, 'projet.json'), null);
    writeJson(path.join(revue, 'projet.json'), { ...d, root: fixture.root, coulisses: fixture.source });
    const c = readJson(fixture.source, null); c.revue = revue; writeJson(fixture.source, c);
    fs.unlinkSync(path.join(fixture.imported.revue, 'projet.json'));
    return revue;
  };
  try {
    const a = make('été-日本');
    check('import stores source and display metadata outside the project', () => {
      const e = lib.registry().projects[0];
      assert.equal(e.id, a.imported.id); assert.equal(e.title, 'Projet été-日本');
      assert.equal(e.channel, 'Chaîne été 宇宙'); assert.equal(e.coulisses, a.source);
    });
    lib.renameFolder(null, 'Mes films', [{ id: a.imported.id, channel: 'Chaîne été 宇宙' }]);
    check('a new process retains the channel folder alias', () => assert.equal(run(a.imported.revue).folder, 'Mes films'));
    lib.setFolder([a.imported.id], 'À finir');
    const archive = redirect(a, 'été-日本');
    const moved = run(a.imported.revue);
    check('relaunch follows the explicit source redirect with stable identity and folder', () => {
      assert.equal(moved.id, a.imported.id); assert.equal(moved.revue, archive); assert.equal(moved.folder, 'À finir');
      assert.equal(moved.entry.revue, archive); assert.deepEqual(moved.entry.previousRevues, [a.imported.revue]);
    });
    check('opening relocated path or old saved command preserves identity', () => {
      assert.equal(run(archive).id, a.imported.id); assert.equal(run(a.imported.revue).id, a.imported.id);
      assert.equal(lib.revueOf(a.imported.id), archive);
    });
    check('reimport keeps one row, identity, custom folder and extra metadata', () => {
      const r = lib.registry(); r.projects[0].archive = { path: 'kept.zip' }; writeJson(PROJECTS_FILE, r);
      assert.equal(lib.importProject(a.source).id, a.imported.id);
      assert.equal(lib.registry().projects.length, 1); assert.equal(lib.folderOf(a.imported.id, null), 'À finir');
      assert.deepEqual(lib.registry().projects[0].archive, { path: 'kept.zip' });
    });
    const c = readJson(a.source, null); c.titre = 'Nouveau titre'; writeJson(a.source, c);
    check('successful reads refresh metadata without changing folder choices', () => {
      assert.equal(run(archive).entry.title, 'Nouveau titre'); assert.equal(lib.folderOf(a.imported.id, null), 'À finir');
    });
    fs.unlinkSync(path.join(archive, 'projet.json'));
    check('missing review is not reconstructed and remembered grouping remains', () => {
      assert.throws(() => lib.project(archive)); assert.equal(fs.existsSync(path.join(archive, 'projet.json')), false);
      lib.setFolder([a.imported.id], null); assert.equal(lib.folderOf(a.imported.id, null), 'Mes films');
      lib.setFolder([a.imported.id], ''); assert.equal(lib.folderOf(a.imported.id, null), null);
    });
    const legacy = make('ancien');
    const legacyArchive = redirect(legacy, 'ancien');
    let r = lib.registry(); r.projects = r.projects.map((e) => e.id === legacy.imported.id ? { id: e.id, revue: legacy.imported.revue, added: e.added } : e); writeJson(PROJECTS_FILE, r);
    writeJson(path.join(legacy.root, 'episode.coulisses'), { coulisses: 1, moteur: 'brambleshire', episode: 'E01', revue: legacyArchive });
    check('legacy index finds only the coherent generic descriptor in immediate parent', () => {
      const p = run(legacy.imported.revue); assert.equal(p.id, legacy.imported.id); assert.equal(p.revue, legacyArchive);
    });
    const again = make('reimport-ancien');
    redirect(again, 'reimport-ancien');
    r = lib.registry(); r.projects = r.projects.map((e) => e.id === again.imported.id ? { id: e.id, revue: again.imported.revue, added: e.added } : e); writeJson(PROJECTS_FILE, r);
    check('reimport also upgrades a legacy relocated row without duplicating it', () => {
      const n = lib.registry().projects.length;
      assert.equal(lib.importProject(again.source).id, again.imported.id); assert.equal(lib.registry().projects.length, n);
    });
    const bad = make('corrompu'); const badArchive = redirect(bad, 'corrompu');
    fs.writeFileSync(path.join(bad.imported.revue, 'projet.json'), '{ broken');
    check('a corrupt review is not silently replaced by another location', () => {
      assert.throws(() => lib.project(bad.imported.revue));
      assert.equal(lib.registry().projects.find((e) => e.id === bad.imported.id).revue, bad.imported.revue);
    });
    fs.unlinkSync(path.join(bad.imported.revue, 'projet.json'));
    const inconsistent = readJson(path.join(badArchive, 'projet.json'), null); inconsistent.coulisses = legacy.source;
    writeJson(path.join(badArchive, 'projet.json'), inconsistent);
    check('redirect refuses a review owned by a different descriptor', () => assert.throws(() => lib.project(bad.imported.revue)));
    const ambiguous = make('ambigu'); redirect(ambiguous, 'ambigu-a');
    const otherSource = path.join(ambiguous.root, 'other.coulisses'), otherReview = path.join(fix, 'archive', 'ambigu-b', 'revue');
    writeJson(otherSource, { coulisses: 1, moteur: 'video', titre: 'Other', revue: otherReview });
    writeJson(path.join(otherReview, 'projet.json'), { kind: 'run', root: ambiguous.root, coulisses: otherSource });
    r = lib.registry(); r.projects = r.projects.map((e) => e.id === ambiguous.imported.id ? { id: e.id, revue: ambiguous.imported.revue } : e); writeJson(PROJECTS_FILE, r);
    check('ambiguous legacy candidates remain missing', () => assert.throws(() => lib.project(ambiguous.imported.revue)));
    const copied = make('copie');
    const copiedRoot = path.join(fix, 'archive', 'copie'), copiedSource = path.join(copiedRoot, 'copie.coulisses'), copiedReview = path.join(copiedRoot, 'revue');
    writeJson(copiedSource, { ...readJson(copied.source, null), revue: 'revue' });
    writeJson(path.join(copiedReview, 'projet.json'), { kind: 'run', root: '..', coulisses: '../copie.coulisses' });
    fs.unlinkSync(path.join(copied.imported.revue, 'projet.json'));
    writeJson(copied.source, { ...readJson(copied.source, null), revue: copiedReview });
    lib.setFolder([copied.imported.id], 'Copie archivée');
    check('copied descriptors require explicit relink and keep the original library identity', () => {
      assert.throws(() => lib.project(copied.imported.revue));
      const p = lib.project(copiedReview);
      lib.rememberProject({ ...p, id: copied.imported.id });
      const reopened = run(copiedReview);
      assert.equal(reopened.id, copied.imported.id); assert.equal(reopened.folder, 'Copie archivée');
      assert.equal(reopened.entry.coulisses, copiedSource);
    });
    await Promise.all(Array.from({ length: 6 }, (_, n) => new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [script, 'writer', String(n)], { env: process.env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let error = ''; p.stderr.on('data', (chunk) => error += chunk);
      p.on('error', reject); p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(error)));
    })));
    check('concurrent registry updates keep every folder and all projects', () => {
      const data = lib.registry();
      for (let n = 0; n < 6; n++) for (let i = 0; i < 12; i++) assert.equal(data.folders[`concurrent-${n}-${i}`], `Dossier ${n}`);
      assert.equal(data.projects.length, 6);
    });
    check('remove only removes its own entry and preserves source and other folders', () => {
      assert.equal(lib.removeProject(legacy.imported.id), true); assert.equal(fs.existsSync(legacy.source), true);
      assert.equal(lib.folderOf('concurrent-0-0', null), 'Dossier 0');
    });
    console.log(`${checks} ok, 0 ko`);
  } finally {
    // The only recursive delete is the exact fresh mkdtemp fixture beneath .cache.
    assert.ok(path.resolve(fix).startsWith(path.resolve(cache) + path.sep));
    fs.rmSync(fix, { recursive: true, force: true });
  }
}

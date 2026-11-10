// The layer browser on a montage plan and a Brambleshire snapshot, through the real studio.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {launch, requireSandbox} from './cdp.mjs';
import {freePort} from './where.mjs';

const studio = fileURLToPath(new URL('../', import.meta.url));
const sandbox = path.join(studio, '.cache', 'composition-browser');
fs.mkdirSync(sandbox, {recursive: true});
const root = fs.mkdtempSync(path.join(sandbox, 'project-'));
process.env.STUDIO_PROJECTS = path.join(root, 'registry.json');
process.env.COULISSES_MEDIAS = path.join(root, 'medias');
process.env.COULISSES_SETTINGS = path.join(root, 'settings.json');
process.env.COULISSES_HISTORY_DIR = path.join(root, 'history');
process.env.COULISSES_LANG = 'fr';
const {importProject} = await import('../lib/projects.mjs');
const json = (file, data) => fs.writeFileSync(file, JSON.stringify(data));
const run = path.join(root, 'montage');
const renders = path.join(run, '07-renders'), montage = path.join(run, '08-montage');
const episodes = path.join(root, '07_Episodes'), e03 = path.join(episodes, 'E03 - Test');
const revue = path.join(e03, 'revue');
let server, page, checks = 0;
const pass = label => { checks++; console.log('✓ ' + label); };
async function open(args) {
  const port = await freePort(4310), url = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, ['studio-server.mjs', ...args, '--port', String(port), '--no-open'],
    {cwd: studio, env: process.env, windowsHide: true, stdio: 'ignore'});
  let online = false;
  for (let i = 0; i < 100 && !online; i++) {
    if (server.exitCode !== null) throw new Error('Studio exited: ' + server.exitCode);
    online = await fetch(url + '/api/ping').then(r => r.ok).catch(() => false);
    if (!online) await delay(100);
  }
  assert.ok(online, 'test studio started');
  await requireSandbox(url, root);
  await page.goto(url);
  await page.until("document.querySelector('#v').readyState >= 2 && window.__studio");
  await page.eval("document.querySelector('#compositionTab').click()");
  await page.until("document.querySelector('.cx-tree summary')");
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  try { execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], {stdio: 'ignore', windowsHide: true}); }
  catch { /* Already stopped. */ }
  server = null;
}
const filter = text => page.eval(`const input = document.querySelector('#cx-search'); input.value = ${JSON.stringify(text)};
  input.dispatchEvent(new Event('input', {bubbles: true}));`);
const frame = () => page.eval('return __studio.state().frame');
try {
  for (const dir of [renders, montage, revue]) fs.mkdirSync(dir, {recursive: true});
  const video = path.join(renders, 'plan.mp4');
  execFileSync('ffmpeg', ['-v','error','-y','-f','lavfi','-i','color=s=240x136:r=30:d=5','-c:v','libx264','-pix_fmt','yuv420p',video], {windowsHide: true});
  fs.copyFileSync(video, path.join(e03, 'E03 - Test.mp4'));
  json(path.join(run, 'run.json'), {slug: 'v2-test'});
  json(path.join(montage, 'plan-montage.json'), {fps: 30, total_images: 150,
    chapitres: [{chapitre: 'Ouverture', record_debut: 0}, {chapitre: 'Finale', record_debut: 75}],
    V1: [{fichier: 'src/Été.tsx', record: 0, images: 75, role: 'Nénuphars'},
      {fichier: 'src/Canal.tsx', record: 75, images: 75, role: 'Quai'}],
    V2: [{fichier: 'src/under.tsx', record: 15, images: 30, role: 'Insert superposé'},
      {fichier: 'src/top.tsx', record: 15, images: 30, role: 'Insert superposé'}],
    A1: [{fichier: 'music/score.wav', record: 0, images: 150, role: 'Musique'}]});
  json(path.join(revue, 'timeline.json'), {fps: 30, frames: 150, sets: [{id: 'garden', name: 'Garden', inT: 0, outT: null}],
    cutaways: [{t: 0.5, dur: 1, id: 'title', name: 'Title'}], curtain: [],
    says: [{id: 'L017', actor: 'mole', t: 1, dur: 1.5, text: 'The garden opens.'}]});
  page = await launch({port: await freePort(9483)});
  await open(['--project', importProject(run).revue]);
  assert.equal(await page.eval("return __studio.state().tabR"), 'composition');
  assert.equal(await page.eval("return document.querySelectorAll('.cx-scenes option').length"), 3);
  pass('Un onglet actif, deux chapitres du plan de montage');
  assert.ok(await page.eval(`const side = document.querySelector('#side'); side.style.maxWidth = '320px';
    const bar = side.querySelector('#tabs'), box = bar.getBoundingClientRect();
    return box.width <= 320 && [...bar.querySelectorAll('button')].every(b => {
      const r = b.getBoundingClientRect(); return b.getAttribute('aria-label') && r.width >= 28 && r.left >= box.left && r.right <= box.right;
    })`));
  pass('À 320 px, les cinq onglets restent accessibles');
  await filter('ete.tsx');
  assert.deepEqual(await page.eval("return [...document.querySelectorAll('.cx-clip span')].map(s => s.textContent)"), ['Nénuphars']);
  await page.eval("document.querySelector('.cx-clip').click()");
  assert.match(await page.eval("return document.querySelector('.cx-inspector').innerText"), /Été\.tsx/);
  await page.eval("document.querySelector('[data-edge=to]').click()");
  assert.equal(await frame(), 74);
  pass('Recherche de source sans accent, inspection et dernière image incluse');
  const click = selector => page.eval('document.querySelector(' + JSON.stringify(selector) + ').click()');
  const value = (name, value) => page.eval(`const field = document.querySelector('#cxTimingForm [name="${name}"]');
    field.value = ${JSON.stringify(value)}; field.dispatchEvent(new Event('input', {bubbles:true}));`);
  const submitDisabled = () => page.eval("return document.querySelector('#cxTimingForm [type=submit]').disabled");
  await page.eval("CoulissesWorkspace.setMode('edit')");
  await click('[data-timing="trim"]');
  assert.ok(await submitDisabled());
  await value('start', '75'); assert.ok(await submitDisabled());
  await value('start', '12.5'); assert.ok(await submitDisabled());
  await value('start', '12'); await value('end', '63');
  assert.equal(await submitDisabled(), false);
  const before = await frame();
  await page.key('ArrowRight', 'ArrowRight');
  assert.equal(await frame(), before);
  await page.eval("const b = document.querySelector('#cxTimingForm [type=submit]'); b.click(); b.click()");
  await page.until("document.querySelectorAll('#draftList .card').length === 1 && __studio.state().tabL === 'queue'");
  assert.ok(await page.eval("return document.getElementById('lside').getBoundingClientRect().width > 0"));
  const noteText = await page.eval("return document.querySelector('#draftList textarea.main').value");
  assert.match(noteText, /piste V1[\s\S]*bornes incluses[\s\S]*30 fps[\s\S]*0–74[\s\S]*12–63[\s\S]*src\/Été\.tsx/);
  // Add project-specific instructions in the ordinary queue editor.
  await page.eval("const t = document.querySelector('#draftList textarea.main'); t.value += '\\nRespecter le fondu.'; t.dispatchEvent(new Event('input', {bubbles:true}));");
  pass('Coupe validée, file révélée, texte modifiable, double clic dédupliqué');
  await filter('');
  await page.eval("const s = document.querySelector('.cx-scenes select'); s.selectedIndex = 2; s.dispatchEvent(new Event('change'))");
  assert.equal(await frame(), 75);
  assert.deepEqual(await page.eval("return [...document.querySelectorAll('.cx-clip span')].map(s => s.textContent)"), ['Finale', 'Quai', 'Musique']);
  await page.eval("document.querySelector('.cx-clip[title^=Musique]').click()");
  assert.equal(await frame(), 75);
  pass('Un son qui chevauche deux scènes s’ouvre au début de la scène choisie');
  await page.eval("const s = document.querySelector('.cx-scenes select'); s.selectedIndex = 0; s.dispatchEvent(new Event('change')); document.querySelector('.cx-at').click()");
  assert.deepEqual(await page.eval("return [...document.querySelectorAll('.cx-clip span')].map(s => s.textContent)"), ['Finale', 'Quai', 'Musique']);
  pass('Le filtre à la tête de lecture respecte la coupe exacte');
  await click('.cx-clip[title^=Quai]'); await click('[data-timing="move"]');
  assert.ok(await submitDisabled());
  await value('offset', '1'); assert.ok(await submitDisabled());
  await value('offset', '-76'); assert.ok(await submitDisabled());
  await value('offset', '-15'); assert.equal(await submitDisabled(), false);
  await click('#cxTimingForm [type=submit]');
  await page.until("document.querySelectorAll('#draftList .card').length === 2");
  await click('#qsend');
  await page.until("document.querySelector('#modal').style.display === 'flex'");
  const lotFile = path.join(run, 'revue', 'lots', '001.json');
  const lot = JSON.parse(fs.readFileSync(lotFile, 'utf8'));
  assert.equal(lot.edits.length, 2);
  const [cut, moved] = lot.edits;
  assert.equal(cut.timing.operation, 'trim'); assert.equal(cut.timing.trackId, 'V1');
  assert.equal(cut.timing.file, 'src/Été.tsx'); assert.equal(cut.timing.fps, 30); assert.ok(cut.timing.clipId);
  assert.equal(cut.timing.frameConvention, 'zero-based-inclusive');
  assert.deepEqual(cut.timing.original, {from:0, to:74}); assert.deepEqual(cut.timing.proposed, {from:12, to:63});
  assert.match(cut.text, /Respecter le fondu/);
  assert.equal(moved.timing.operation, 'move'); assert.equal(moved.timing.offsetFrames, -15);
  assert.deepEqual(moved.timing.original, {from:75, to:149}); assert.deepEqual(moved.timing.proposed, {from:60, to:134});
  assert.equal(moved.timing.compositionFrames, 150);
  const markdown = fs.readFileSync(lotFile.replace('.json', '.md'), 'utf8');
  assert.ok(markdown.includes('Respecter le fondu') && markdown.includes('60–134') && markdown.includes('piste V1'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(montage,'plan-montage.json'),'utf8')).V1.map(c => [c.record, c.images]), [[0,75],[75,75]]);
  pass('Deux propositions dans le lot lisible et structuré, déplacement à durée constante, source intacte');
  await click('#mClose');
  await filter('filtre sans résultat');
  await click('#tabs [data-tab="notes"]');
  await page.eval("CoulissesWorkspace.togglePanel('right')");
  const coords = await page.eval(`const cv = document.getElementById('tl'), r = cv.getBoundingClientRect();
    const x = r.left + 118 + (r.width - 118) * .2;
    for (let y = r.top + 22; y < r.bottom; y += 2) {
      cv.dispatchEvent(new MouseEvent('mousemove', {bubbles:true, clientX:x, clientY:y}));
      if (document.getElementById('tip').textContent.includes('Insert superposé') && document.getElementById('tip').textContent.includes('Clic droit')) return {x,y};
    } return null;`);
  assert.ok(coords, 'clip under the cursor identified by the timeline');
  const beforeInspect = await frame();
  for (const type of ['mousePressed','mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', {...coords, type, button:'right', buttons:type === 'mousePressed' ? 2 : 0, clickCount:1});
  }
  await page.until("__studio.state().tabR === 'composition' && document.querySelector('.cx-inspector').innerText.includes('src/top.tsx')");
  assert.equal(await frame(), beforeInspect);
  assert.ok(await page.eval("return document.querySelector('.cx-tree [aria-current=true]').textContent.includes('Insert superposé') && !document.querySelector('.cx-inspector').innerText.includes('src/under.tsx')"));
  assert.ok(await page.eval("return !!document.querySelector('[data-timing=trim]') && document.querySelector('#side').getBoundingClientRect().width > 0"));
  pass('Le clic droit ouvre le calque réellement peint au-dessus de son homonyme, retrouve la ligne malgré les filtres et conserve la tête de lecture');
  for (const count of [1,2]) {
    for (const type of ['mousePressed','mouseReleased']) {
      await page.send('Input.dispatchMouseEvent', {...coords, type, button:'left', buttons:type === 'mousePressed' ? 1 : 0, clickCount:count});
    }
    if (count === 1) assert.ok(Math.abs((await frame()) - 30) <= 1);
  }
  await page.until("__studio.state().drafts === 1");
  assert.deepEqual(await page.eval("const c = document.querySelector('#draftList .card'); return [Number(c.querySelector('.f0').value), Number(c.querySelector('.f1').value)]"), [15,44]);
  pass('Clic gauche pour naviguer et double clic pour annoter le clip');
  await stop();
  process.env.COULISSES_LANG = 'en';
  await open(['E03', '--theatre', root, '--episodes', episodes]);
  assert.equal(await page.eval("return document.querySelector('#compositionTab').getAttribute('aria-label')"), 'Layers');
  assert.equal(await page.eval("return document.querySelector('#cx-search').getAttribute('placeholder')"), 'Search layers');
  pass('Le panneau suit la langue anglaise du studio');
  await filter('l017');
  await page.eval("document.querySelector('.cx-clip').click()");
  assert.equal(await frame(), 30);
  assert.match(await page.eval("return document.querySelector('.cx-inspector').innerText"), /Mole[\s\S]*The garden opens\.[\s\S]*L017/);
  assert.equal(await page.eval("return document.querySelector('[data-timing=move]').textContent"), 'Propose a move');
  await page.eval("document.querySelector('[data-edge=to]').click()");
  assert.equal(await frame(), 74);
  pass('Sur l’instantané E03, une réplique conserve son acteur, sa référence et ses bornes');
  await filter('no match');
  assert.ok(await page.eval("return !!document.querySelector('.cx-empty')"));
  await filter('title');
  await page.eval("document.querySelector('summary').focus()");
  await page.key('ArrowDown', 'ArrowDown');
  assert.ok(await page.eval("return document.activeElement.matches('.cx-clip')"));
  await page.key('Enter', 'Enter');
  await page.until("__studio.state().frame === 15");
  pass('Résultat vide et navigation clavier vers un plan 3D');
  await filter('garden'); await click('.cx-clip');
  const cutaway = await page.eval("const r = document.getElementById('tl').getBoundingClientRect(); return {x:r.left + 118 + (r.width-118)*.2, y:r.top + 69}");
  for (const type of ['mousePressed','mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', {...cutaway,type,button:'right',buttons:type === 'mousePressed' ? 2 : 0, clickCount:1});
  }
  await page.until("document.querySelector('.cx-title').textContent === 'Title'");
  assert.equal(await frame(), 0);
  pass('Sur E03 le plan 3D superposé au décor ouvre la référence du plan');
  console.log(`${checks} ok, 0 ko`);
} finally {
  await page?.close(); await stop();
  fs.rmSync(root, {recursive: true, force: true, maxRetries: 3, retryDelay: 200});
}

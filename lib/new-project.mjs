// « Nouveau projet » (user request, 08/10/2026: « créer un projet depuis zéro qu'on crée en temps réel en promptant
// l'agent ; le viewer est une scène 3D : fond noir, quadrillage qui montre le point 0 »). A new Remotion project with an
// empty 3D scene (React Three Fiber: a camera, a light; the grid on the y = 0 plane and the X / Y / Z axes at the origin,
// shown in Coulisses' preview only, never in a render), its .coulisses file, an export script, and a guide for the agent
// who builds it from the « Agent » tab of the studio (each message is a batch for the agent connected to Coulisses).
//
//   <root>\                      Documents\Coulisses\Projets (installed app; settings.json projectsRoot), .cache\projets in
//     package.json, node_modules\   the Dev workshop, COULISSES_PROJECTS_ROOT for the tests — ONE install of Remotion,
//     <project>\                    three and React Three Fiber, shared by every new project (user's choice: « un dossier
//       node_modules -> ..\node_modules (a junction)                                                      partagé »)
//       src\  scripts\  out\  revue\  <Title>.coulisses  CLAUDE.md  AGENTS.md  package.json
// The modules are installed only on the user's order (the home screen asks first: about 350 MB, once).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { CACHE, INSTALLED } from './place.mjs';
import { APP_NAME, MSTUDIO, ENGINE_DIR } from './app-profile.mjs';
import { readSettings, writeSettings, lang, t } from './i18n.mjs';
import { createCoulisses } from './coulisses-file.mjs';
import { hfInit } from './hyperframes.mjs';

// the versions Coulisses is tested with (the same Remotion as the user's pipelines)
export const DEPS = { remotion: '4.0.533', '@remotion/cli': '4.0.533', '@remotion/player': '4.0.533', '@remotion/three': '4.0.533', '@remotion/bundler': '4.0.533',
  '@remotion/renderer': '4.0.533', three: '0.180.0', '@react-three/fiber': '9.3.0', react: '19.2.3', 'react-dom': '19.2.3' };
export const FORMATS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] };
const NEEDED = [...Object.keys(DEPS), 'esbuild'];

function documentsDir() {
  if (process.platform === 'win32') {
    try {
      const r = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders', '/v', 'Personal'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
      const m = /Personal\s+REG_\w+\s+(.+)/.exec(r.stdout ?? ''); if (m && fs.existsSync(m[1].trim())) return m[1].trim();
    } catch { /* below */ }
  }
  return path.join(os.homedir(), 'Documents');
}
export const documentsProjectsRoot = () => path.join(documentsDir(), APP_NAME, lang() === 'fr' ? 'Projets' : 'Projects');
// the folder of the new projects: chosen once (in the user's language at that time), then kept
export function projectsRoot() {
  const override = MSTUDIO ? process.env.MSTUDIO_PROJECTS_ROOT : process.env.COULISSES_PROJECTS_ROOT;
  if (override) return path.resolve(override);
  const s = readSettings().projectsRoot; if (s) return s;
  if (!INSTALLED) return path.join(CACHE, 'projets');
  const root = documentsProjectsRoot();
  try { writeSettings({ projectsRoot: root }); } catch { /* chosen again next time */ }
  return root;
}
const has = (root, p) => fs.existsSync(path.join(root, 'node_modules', ...p.split('/'), 'package.json'));
// { root, ready, missing: [...], install: the install in progress or the last one }
export function workspace(root = projectsRoot()) {
  const missing = NEEDED.filter((p) => !has(root, p));
  if (MSTUDIO && missing.length && path.resolve(root) === path.resolve(projectsRoot()) && NEEDED.every(p => has(ENGINE_DIR, p))) {
    return { root, modulesRoot: ENGINE_DIR, ready: true, missing: [], install: installState() };
  }
  return { root, ready: !missing.length, missing, install: installState() };
}

// ---------- the one install (npm), on the user's order ----------
let job = null;
export const installState = () => (job ? { state: job.state, started: job.started, ended: job.ended ?? null, log: job.log.slice(-12), error: job.error ?? null } : null);
export function startInstall(root = projectsRoot(), { log = () => {} } = {}) {
  if (job?.state === 'running') return installState();
  fs.mkdirSync(root, { recursive: true });
  const pkg = path.join(root, 'package.json');
  fs.writeFileSync(pkg, JSON.stringify({ name: 'coulisses-projets', private: true, description: 'Coulisses: the modules shared by the projects made with « Nouveau projet »', dependencies: DEPS }, null, 2));
  if (!fs.existsSync(path.join(root, 'LISEZMOI.txt')) && !fs.existsSync(path.join(root, 'README.txt')))
    fs.writeFileSync(path.join(root, lang() === 'fr' ? 'LISEZMOI.txt' : 'README.txt'), t('np.readme', { root }).split('\n').join('\r\n'));
  const j = job = { state: 'running', started: new Date().toISOString(), log: [] };
  // COULISSES_NPM: another program (tests); else npm, through cmd on Windows (npm is npm.cmd)
  const alt = process.env.COULISSES_NPM;
  const [cmd, args] = alt ? [process.execPath, [alt, 'install']] : process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', 'npm install --no-audit --no-fund --loglevel=http']] : ['npm', ['install', '--no-audit', '--no-fund']];
  const c = spawn(cmd, args, { cwd: root, windowsHide: true, env: process.env });
  const take = (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) { j.log.push(l.trim().slice(0, 200)); if (j.log.length > 200) j.log.shift(); } };
  c.stdout.on('data', take); c.stderr.on('data', take);
  c.on('error', (e) => { j.state = 'failed'; j.error = e.message; j.ended = new Date().toISOString(); });
  c.on('close', (code) => {
    if (j.state !== 'running') return;
    const ws = workspace(root);
    j.state = code === 0 && ws.ready ? 'done' : 'failed';
    if (j.state === 'failed') j.error = code === 0 ? t('np.err.missing', { list: ws.missing.join(', ') }) : t('np.err.npm', { code });
    j.ended = new Date().toISOString();
    log(t('np.log.installed', { state: j.state, root }));
  });
  log(t('np.log.install', { root }));
  return installState();
}

// ---------- a new project ----------
export const slugOf = (s) => String(s ?? '').normalize('NFD').replace(/([A-Za-z])\p{M}+/gu, '$1').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'projet';
const w = (dir, rel, txt) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, txt); };

// { nom, chaine?, format ('16:9' | '9:16' | '1:1'), duree (seconds), fps, engine ('remotion' | 'hyperframes') } -> { file (.coulisses), dir }
export function createProject({ nom, chaine = null, format = '16:9', duree = 10, fps = 30, engine = 'remotion' }, root = projectsRoot()) {
  nom = String(nom ?? '').trim();
  if (!nom) throw new Error(t('np.err.name'));
  if (engine === 'hyperframes') return createHfProject({ nom, chaine, format, duree }, root);
  const ws = workspace(root);
  if (!ws.ready) throw new Error(t('np.err.notInstalled', { list: ws.missing.join(', ') }));
  const [W, H] = FORMATS[format] ?? FORMATS['16:9'];
  const D = Math.max(1, Math.min(3600, +duree || 10)), F = Math.max(1, Math.min(120, Math.round(+fps || 30)));
  let base = slugOf(nom), dir = path.join(root, base);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(root, `${base}-${i}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(path.join(ws.modulesRoot || root, 'node_modules'), path.join(dir, 'node_modules'), 'junction');   // the shared modules
  const l = lang();
  w(dir, 'package.json', JSON.stringify({ name: path.basename(dir), private: true, description: `Coulisses · ${nom}`, dependencies: DEPS }, null, 2));
  w(dir, 'src/projet.ts', `// ${l === 'fr' ? "Le projet : son titre, son format, sa durée. L'agent peut les changer (Coulisses relit tout à chaque enregistrement)." : 'The project: its title, its format, its length. The agent may change them (Coulisses reads everything again on every save).'}
export const PROJET = { titre: ${JSON.stringify(nom)}, fps: ${F}, width: ${W}, height: ${H}, duree: ${D} };
export const totalFrames = () => Math.round(PROJET.duree * PROJET.fps);
`);
  w(dir, 'src/editor.tsx', `// ${l === 'fr' ? "Les aides de l'éditeur : la grille du sol (le plan y = 0) et les axes X (rouge), Y (vert), Z (bleu) au point 0. Visibles dans l'aperçu de Coulisses seulement, jamais dans un rendu (getRemotionEnvironment().isPlayer)." : "The editor's aids: the floor grid (the y = 0 plane) and the X (red), Y (green), Z (blue) axes at the origin. Shown in Coulisses' preview only, never in a render (getRemotionEnvironment().isPlayer)."}
import React from 'react';
import { getRemotionEnvironment } from 'remotion';
import { useThree } from '@react-three/fiber';

export const isEditor = () => getRemotionEnvironment().isPlayer;
export const EditorAids: React.FC<{ size?: number }> = ({ size = 40 }) => (isEditor() ? (
  <group name="editor-aids">
    <gridHelper args={[size, size, '#8a91b8', '#2c3150']} />
    <axesHelper args={[4]} />
    <mesh name="editor-origin"><sphereGeometry args={[0.06, 16, 12]} /><meshBasicMaterial color="#ffffff" /></mesh>
  </group>
) : null);
// ${l === 'fr' ? 'la caméra du plan, posée à chaque image (rien ne dépend du temps réel : chaque image se calcule seule)' : 'the shot\'s camera, set on every frame (nothing depends on real time: every frame computes on its own)'}
export const ShotCamera: React.FC<{ position: [number, number, number]; target?: [number, number, number]; fov?: number }> = ({ position, target = [0, 0, 0], fov }) => {
  const { camera } = useThree();
  camera.position.set(...position);
  if (fov && 'fov' in camera) { (camera as any).fov = fov; camera.updateProjectionMatrix(); }
  camera.lookAt(...target);
  return null;
};
`);
  w(dir, 'src/Scene.tsx', `// ${l === 'fr' ? "La scène du projet : ce que l'agent construit à ta demande (onglet Agent de Coulisses). Vide au départ." : 'The scene of the project: what the agent builds at your request (the Agent tab of Coulisses). Empty to start with.'}
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import { EditorAids, ShotCamera } from './editor';

export const Scene: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  void frame;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <ThreeCanvas width={width} height={height} camera={{ fov: 45, near: 0.1, far: 500 }}>
        <color attach="background" args={['#000000']} />
        <ShotCamera position={[7, 5, 9]} target={[0, 0.5, 0]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[6, 10, 4]} intensity={1.4} />
        <EditorAids />
        {/* ${l === 'fr' ? 'la scène : vide pour l\'instant' : 'the scene: empty for now'} */}
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
`);
  w(dir, 'src/coulisses.ts', `// The Coulisses contract, part 1: the compositions (browser). The Root builds its <Composition> from this list.
import { Scene } from './Scene';
import { PROJET, totalFrames } from './projet';
export const compositions = [
  { id: 'SCENE', component: Scene, fps: PROJET.fps, width: PROJET.width, height: PROJET.height, durationInFrames: () => totalFrames(), defaultProps: {} },
];
`);
  w(dir, 'src/coulisses-timeline.ts', `// The Coulisses contract, part 2: the timeline (Node, data only: no component imported here). Frames.
import { PROJET, totalFrames } from './projet';
export function timeline(_id: string, _props: unknown) {
  return {
    fps: PROJET.fps, durationInFrames: totalFrames(),
    pistes: [
      { id: 'scene', nom: '${l === 'fr' ? 'Scène' : 'Scene'}', type: 'band', clips: [{ de: 0, a: totalFrames(), label: PROJET.titre }] },
    ],
  };
}
`);
  w(dir, 'src/Root.tsx', `import React from 'react';
import { Composition } from 'remotion';
import { compositions } from './coulisses';
export const Root: React.FC = () => (
  <>{compositions.map((c) => <Composition key={c.id} id={c.id} component={c.component as any} fps={c.fps} width={c.width} height={c.height}
    durationInFrames={typeof c.durationInFrames === 'function' ? c.durationInFrames() : c.durationInFrames} defaultProps={c.defaultProps} />)}</>
);
`);
  w(dir, 'src/index.ts', `import { registerRoot } from 'remotion';\nimport { Root } from './Root';\nregisterRoot(Root);\n`);
  w(dir, 'scripts/coulisses-rendu.mjs', exportScript(slugOf(nom), l));
  w(dir, 'CLAUDE.md', guide(nom, l));
  w(dir, 'AGENTS.md', guide(nom, l));
  fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
  const file = createCoulisses({ dossier: dir, titre: nom, chaine: chaine || null, format, projet: dir, composition: 'SCENE', props: {}, exportDossier: 'out', exportMotif: '\\.mp4$' });
  // the project is its own folder (« . »: it may be moved), and it was made here (the studio opens it on the Agent tab)
  const data = JSON.parse(fs.readFileSync(file, 'utf8')); data.remotion.projet = '.'; data.origine = 'coulisses'; fs.writeFileSync(file, JSON.stringify(data, null, 1));
  return { file, dir };
}

// a HyperFrames project (user request, 09/10/2026: « quand je crée un nouveau projet, le choix entre HyperFrames et
// Remotion »): « hyperframes init » of the user's CLI in <root>\<slug> (no npm install: the composition is HTML, its
// runtime comes with the CLI; the agent's skills are not updated here), its length and title, Coulisses' part of the
// agent's guide at the top of HyperFrames' own CLAUDE.md / AGENTS.md, its .coulisses (moteur hyperframes)
function createHfProject({ nom, chaine, format, duree }, root) {
  const D = Math.max(1, Math.min(3600, +duree || 10));
  let base = slugOf(nom), slug = base;
  for (let i = 2; fs.existsSync(path.join(root, slug)); i++) slug = `${base}-${i}`;
  const { dir } = hfInit(root, slug, { format });
  const idx = path.join(dir, 'index.html');
  let html = fs.readFileSync(idx, 'utf8');
  html = html.split('data-duration="10"').join(`data-duration="${D}"`);
  const safe = nom.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  html = html.split('>Title</h1>').join(`>${safe}</h1>`);
  fs.writeFileSync(idx, html);
  const l = lang();
  for (const g of ['CLAUDE.md', 'AGENTS.md']) {
    const f = path.join(dir, g), own = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    fs.writeFileSync(f, t('np.guideHf', { nom }, l) + (own ? '\n\n---\n\n' + own : '\n'));
  }
  const file = createCoulisses({ dossier: dir, titre: nom, chaine: chaine || null, format, projet: dir, moteur: 'hyperframes' });
  const data = JSON.parse(fs.readFileSync(file, 'utf8')); data.origine = 'coulisses'; fs.writeFileSync(file, JSON.stringify(data, null, 1));
  return { file, dir };
}

// the export Coulisses runs on « Exporter » (contract: « Le script d'export »): out\<name>-<date>.mp4, .tmp first
export function exportScript(name, l) {
  const fr = l === 'fr';
  return [
    `// ${fr ? 'Export du projet : rendu Remotion, fichier .tmp.mp4 puis renommé, avancement pour Coulisses.' : 'Export of the project: a Remotion render, a .tmp.mp4 file then renamed, progress for Coulisses.'}`,
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { bundle } from '@remotion/bundler';",
    "import { selectComposition, renderMedia } from '@remotion/renderer';",
    "const a = process.argv.slice(2), opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };",
    `if (a.includes('--options')) { console.log(JSON.stringify([{ id: 'final', scope: 'full', label: ${JSON.stringify(fr ? 'Film complet' : 'Full film')} }, { id: 'test', scope: 'excerpt', label: ${JSON.stringify(fr ? 'Extrait (2 s)' : 'Excerpt (2 s)')} }])); process.exit(0); }`,
    "const q = opt('--qualite'), id = opt('--composition'), dossier = opt('--dossier');",
    "const props = opt('--props') ? JSON.parse(fs.readFileSync(opt('--props'), 'utf8')) : {};",
    "if (!id || !dossier) { console.error('usage: --composition <id> --dossier <dir> [--props f] [--titre t] [--qualite final|test]'); process.exit(2); }",
    "const browserRoots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);",
    "const browsers = ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'];",
    "const CHROME = [process.env.REMOTION_BROWSER_EXECUTABLE, ...browsers.flatMap(name => browserRoots.map(root => path.join(root, name)))].find(file => file && fs.existsSync(file));",
    "let last = -1; const say = (pct, etape) => { const p = Math.floor(pct); if (p !== last) { last = p; console.log('COULISSES PROGRES ' + p + ' ' + etape); } };",
    "say(0, 'paquet');",
    "const entree = path.resolve(opt('--entree') || process.env.COULISSES_ENTREE || 'src/index.ts');",
    "const serveUrl = await bundle({ entryPoint: entree });",
    "const composition = await selectComposition({ serveUrl, id, inputProps: props, browserExecutable: CHROME, chromiumOptions: { gl: 'angle' } });",
    "const d = new Date(), z = (n) => String(n).padStart(2, '0');",
    `const fin = path.join(dossier, ${JSON.stringify(name)} + (q === 'test' ? '-test' : '') + '-' + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '-' + z(d.getHours()) + z(d.getMinutes()) + '.mp4');`,
    "const tmp = fin.replace(/\\.mp4$/, '.tmp.mp4');",
    "fs.mkdirSync(dossier, { recursive: true });",
    "await renderMedia({ serveUrl, composition, codec: 'h264', outputLocation: tmp, inputProps: props, browserExecutable: CHROME, chromiumOptions: { gl: 'angle' },",
    "  pixelFormat: composition.width % 2 || composition.height % 2 ? 'yuv444p' : 'yuv420p',",
    "  frameRange: q === 'test' ? [0, Math.min(composition.durationInFrames, Math.max(1, Math.round(composition.fps * 2))) - 1] : undefined, onProgress: ({ progress }) => say(5 + progress * 94, 'rendu') });",
    "if (fs.existsSync(fin)) { console.log('COULISSES REMPLACE \"' + fin + '\"'); await new Promise((r) => setTimeout(r, 2500)); }",
    "for (let i = 0; ; i++) { try { fs.renameSync(tmp, fin); break; } catch (e) { if (i >= 60) throw e; await new Promise((r) => setTimeout(r, 1000)); } }",
    "say(100, 'fini');",
    "console.log('COULISSES FIN \"' + fin + '\"');",
    '',
  ].join('\n');
}

// the guide of the agent who builds the project (CLAUDE.md for Claude Code, AGENTS.md for Codex)
function guide(nom, l) {
  return t('np.guide', { nom }, l);
}

// A small but real Remotion project that follows the Coulisses contract (docs\FICHE-COULISSES-REMOTION.md), and a run
// folder with its .coulisses file — generated in .cache\coulisses-test\ for tests/coulisses.mjs (and as a worked example
// of the contract). Its node_modules is a junction to 06_Remotion\node_modules (same Remotion, nothing installed).
// usage: node tests/coulisses-fixture.mjs   -> prints the .coulisses file
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { remotionModules } from './where.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIX = path.join(STUDIO, '.cache', 'coulisses-test');
export const PROJET = path.join(FIX, 'remotion-essai'), RUN = path.join(FIX, 'runs', '2026-10-07_essai');
const MODULES = remotionModules();   // tests/where.mjs: a Remotion project's node_modules on this PC (COULISSES_TEST_REMOTION)
const w = (rel, txt) => { const f = path.join(PROJET, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, txt); };

// slowScene: ms — the scene s02 mounts slowly (delayRender until then, nothing drawn: a Theatre stage loading its
// textures), for tests/preview-wait.mjs
export function makeFixture({ slowScene = 0, premount = 0, forgetCleanup = false, master = false, seconds = 10 } = {}) {
  if (!MODULES) throw new Error("pas de projet Remotion avec ses node_modules sur ce PC (COULISSES_TEST_REMOTION=<son dossier>)");
  // never a recursive delete through the junction: remove it first
  const nm = path.join(PROJET, 'node_modules');
  if (fs.existsSync(nm)) fs.rmSync(nm);   // a junction: unlinks it, never its target
  fs.rmSync(FIX, { recursive: true, force: true });
  fs.mkdirSync(PROJET, { recursive: true });
  fs.symlinkSync(MODULES, nm, 'junction');
  const v = JSON.parse(fs.readFileSync(path.join(MODULES, 'remotion', 'package.json'), 'utf8')).version;
  w('package.json', JSON.stringify({ name: 'coulisses-essai', private: true, dependencies: { remotion: v, '@remotion/cli': v, '@remotion/player': v, react: '19.2.3', 'react-dom': '19.2.3' } }, null, 2));
  w('src/index.ts', `import { registerRoot } from 'remotion';\nimport { Root } from './Root';\nregisterRoot(Root);\n`);
  // the run's data: in the project, imported by the composition (the preview reloads on every save)
  w('src/runs/essai.ts', `// the run « 2026-10-07_essai »: what the composition shows, frame by frame
export const RUN = {
  titre: 'Essai de Coulisses',
  fps: 30,
  plans: [
    { id: 's01', titre: 'Le sujet', de: 0, a: 90, couleur: '#3b2f6b' },
    { id: 's02', titre: 'Trois chiffres', de: 90, a: 210, couleur: '#14532d' },
    { id: 's03', titre: 'La conclusion', de: 210, a: ${seconds * 30}, couleur: '#7c2d12' },
  ],
  voix: 'essai/${master ? 'mix' : 'voix'}.wav',
${slowScene ? `  lent: ${slowScene},
` : ''}};
export const totalFrames = () => Math.max(...RUN.plans.map((p) => p.a));
`);
  w('src/Video.tsx', `import React from 'react';
import { AbsoluteFill, Audio, Sequence, useDelayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { RUN } from './runs/essai';

const Plan: React.FC<{ id: string; titre: string; couleur: string }> = ({ id, titre, couleur }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ background: couleur, justifyContent: 'center', alignItems: 'center' }}>
      {/* the contract: the visible parts are named, so a note pinned on them names them */}
      <div data-coulisses={\`titre \${id}\`} style={{ color: '#fff', fontSize: 120, fontFamily: 'sans-serif', fontWeight: 700, transform: \`scale(\${s})\` }}>{titre}</div>
      <div data-coulisses={\`barre \${id}\`} style={{ position: 'absolute', bottom: 160, left: 160, height: 24, borderRadius: 12, background: '#c9f26b', width: interpolate(f, [0, 60], [0, 1600], { extrapolateRight: 'clamp' }) }} />
    </AbsoluteFill>
  );
};
// a scene slow to mount (RUN.lent ms): its assets loading, nothing drawn until then — as a Theatre stage
const Lent: React.FC<{ ms: number; children: React.ReactNode }> = ({ ms, children }) => {
  const { delayRender, continueRender } = useDelayRender();
  const [h] = React.useState(() => delayRender('scène lente'));
  const [ok, setOk] = React.useState(false);
  React.useEffect(() => { const t = setTimeout(() => { setOk(true); continueRender(h); }, ms); return () => { clearTimeout(t); ${forgetCleanup ? '' : 'continueRender(h);'} }; }, []);
  return ok ? <>{children}</> : null;
};
export const Video: React.FC<{ run: string }> = () => (
  <AbsoluteFill style={{ background: '#000' }}>
    {RUN.plans.map((p) => <Sequence key={p.id} from={p.de} durationInFrames={p.a - p.de} premountFor={${premount}}>{p.id === 's02' && (RUN as any).lent ? <Lent ms={(RUN as any).lent}><Plan id={p.id} titre={p.titre} couleur={p.couleur} /></Lent> : <Plan id={p.id} titre={p.titre} couleur={p.couleur} />}</Sequence>)}
    <Audio src={staticFile(RUN.voix)} />
  </AbsoluteFill>
);
`);
  w('src/coulisses.ts', `// The Coulisses contract, part 1: the compositions (browser). The Root builds its <Composition> from this list.
import { Video } from './Video';
import { RUN, totalFrames } from './runs/essai';
export const compositions = [
  { id: 'ESSAI-2026-10-07', component: Video, fps: RUN.fps, width: 1920, height: 1080, durationInFrames: () => totalFrames(), defaultProps: { run: '2026-10-07_essai' } },
];
`);
  w('src/coulisses-timeline.ts', `// The Coulisses contract, part 2: the timeline (Node, data only: no component imported here). Frames.
import { RUN, totalFrames } from './runs/essai';
export function timeline(_id: string, _props: unknown) {
  return {
    fps: RUN.fps, durationInFrames: totalFrames(),
${master ? `    reviewAudio: { src: RUN.voix, offsetFrames: 0, volume: 1 },\n` : ''}
    pistes: [
      { id: 'chap', nom: 'Chapitres', type: 'band', clips: [{ de: 0, a: 210, label: 'acte 1' }, { de: 210, a: ${seconds * 30}, label: 'acte 2' }] },
      { id: 'V1', nom: 'Plans', type: 'video', clips: RUN.plans.map((p) => ({ de: p.de, a: p.a, label: \`plan \${p.id} · \${p.titre}\`, fichier: 'src/Video.tsx', ref: p.id })) },
      { id: 'A1', nom: 'Voix', type: 'audio', clips: [{ de: 0, a: totalFrames(), label: 'voix du film', fichier: 'public/' + RUN.voix, son: RUN.voix }] },
    ],
  };
}
`);
  w('src/Root.tsx', `import React from 'react';
import { Composition } from 'remotion';
import { compositions } from './coulisses';
export const Root: React.FC = () => (
  <>{compositions.map((c) => <Composition key={c.id} id={c.id} component={c.component as any} fps={c.fps} width={c.width} height={c.height}
    durationInFrames={typeof c.durationInFrames === 'function' ? c.durationInFrames() : c.durationInFrames} defaultProps={c.defaultProps} />)}</>
);
`);
  // the export script Coulisses runs on « Exporter » (contract: docs\FICHE-COULISSES-REMOTION.md « Le script d'export »);
  // --images N renders only the first N frames (tests)
  w('scripts/coulisses-rendu.mjs', [
    "// Export du projet d'essai : rendu Remotion, fichier .tmp.mp4 puis renommé, avancement pour Coulisses.",
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { bundle } from '@remotion/bundler';",
    "import { selectComposition, renderMedia } from '@remotion/renderer';",
    "const a = process.argv.slice(2), opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };",
    "if (a.includes('--options')) { console.log(JSON.stringify([{ id: 'final', label: 'Exporter la vidéo' }, { id: 'test', label: 'Rendu test (30 images)' }, { id: 'remplace', label: 'Remplacer (même nom)' }])); process.exit(0); }",
    "const q = opt('--qualite'), id = opt('--composition'), dossier = opt('--dossier'), images = q === 'test' || q === 'remplace' ? '30' : opt('--images');",
    "const props = opt('--props') ? JSON.parse(fs.readFileSync(opt('--props'), 'utf8')) : {};",
    "if (!id || !dossier) { console.error('usage : --composition <id> --dossier <dossier> [--props f] [--titre t] [--images N]'); process.exit(2); }",
    "const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';",
    "let last = -1; const say = (pct, etape) => { const p = Math.floor(pct); if (p !== last) { last = p; console.log('COULISSES PROGRES ' + p + ' ' + etape); } };",
    "// the encoder Coulisses says (COULISSES_GPU: nvenc | videotoolbox | cpu): the GPU with a bitrate (no crf), else x264",
    "const GPU = !!process.env.COULISSES_GPU && process.env.COULISSES_GPU !== 'cpu';",
    "console.log('encodeur : ' + (process.env.COULISSES_GPU ?? 'absent'));",
    "say(0, 'paquet');",
    "const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts') });",
    "const composition = await selectComposition({ serveUrl, id, inputProps: props, browserExecutable: CHROME, chromiumOptions: { gl: 'angle' } });",
    "const d = new Date(), z = (n) => String(n).padStart(2, '0');",
    "const fin = path.join(dossier, q === 'remplace' ? 'essai-remplace.mp4' : 'essai-' + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '-' + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds()) + '.mp4');",
    "const tmp = fin.replace(/\\.mp4$/, '.tmp.mp4');",
    "fs.mkdirSync(dossier, { recursive: true });",
    "await renderMedia({ serveUrl, composition, codec: 'h264', outputLocation: tmp, inputProps: props, browserExecutable: CHROME, chromiumOptions: { gl: 'angle' }, ...(GPU ? { hardwareAcceleration: 'required', videoBitrate: '8M' } : {}),",
    "  frameRange: images ? [0, Math.min(composition.durationInFrames, +images) - 1] : undefined, onProgress: ({ progress, renderedFrames }) => { say(5 + progress * 94, 'rendu'); console.log('COULISSES IMAGES ' + renderedFrames + ' ' + (images ? Math.min(composition.durationInFrames, +images) : composition.durationInFrames)); } });",
    "if (fs.existsSync(fin)) { console.log('COULISSES REMPLACE \"' + fin + '\"'); await new Promise((r) => setTimeout(r, 2500)); }",
    "for (let i = 0; ; i++) { try { fs.renameSync(tmp, fin); break; } catch (e) { if (i >= 60) throw e; await new Promise((r) => setTimeout(r, 1000)); } }",
    "say(100, 'fini');",
    "console.log('COULISSES FIN \"' + fin + '\"');",
    '',
  ].join('\n'));
  fs.mkdirSync(path.join(PROJET, 'public', 'essai'), { recursive: true });
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`, '-ac', '1', path.join(PROJET, 'public', 'essai', 'voix.wav')]);
  if (r.status) throw new Error('ffmpeg');
  // Même source maître dans la composition et la déclaration : aucune reconstruction
  // des pistes descriptives pour les tests du couplage son/image.
  if (master) fs.copyFileSync(path.join(PROJET, 'public', 'essai', 'voix.wav'), path.join(PROJET, 'public', 'essai', 'mix.wav'));
  // the run folder, and its .coulisses file made like a pipeline would, at the start of the run
  fs.mkdirSync(path.join(RUN, '07-renders'), { recursive: true });
  const spec = path.join(FIX, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ dossier: RUN, titre: 'Essai de Coulisses', chaine: 'Atelier Coulisses', format: '16:9', projet: PROJET, composition: 'ESSAI-2026-10-07', props: { run: '2026-10-07_essai' }, export: '07-renders' }, null, 1));
  return execFileSync(process.execPath, [path.join(STUDIO, 'studio-cli.mjs'), 'projet', 'creer', '--depuis', spec], { encoding: 'utf8' }).trim();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(makeFixture());

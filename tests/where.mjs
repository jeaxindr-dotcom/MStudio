// Where the tests find what is not in the repository (code review, 08/10/2026: the tests named one creator's folders): a
// Remotion project's node_modules (the fixture and the stand-in for npm use its Remotion, React, three, R3F — nothing is
// installed), Uchu-chan's theatre and its Short 12 (the 3D shot test), the real E03 video (the render test's restore).
// Each comes from an environment variable when set, else from the creator's usual folders; a test whose resource is not
// on this PC says so and is skipped (0 ok, 0 ko).
//   COULISSES_TEST_REMOTION   a Remotion project folder with its node_modules (remotion, @remotion/player, react, three…)
//   COULISSES_TEST_UCHU       Uchu-chan's theatre (…\theatre\06_Remotion)
//   COULISSES_TEST_SHORT12    Short 12's .coulisses
//   COULISSES_TEST_E03        the real « E03 - The Secret Garden.mp4 »
import fs from 'node:fs';
import path from 'node:path';

const exists = (p) => { try { return !!p && fs.existsSync(p); } catch { return false; } };
const HOME = process.env.USERPROFILE ?? '';
const YT = path.join(HOME, 'Desktop', 'Youtube');
const BRAMBLE = path.join(YT, 'music', 'Brambleshire', 'Théatre');
const UCHU = path.join(YT, '宇宙', 'relance');

// Le studio et les CLI de ses suites E03 doivent viser le même moteur de test.
export const engineCopyFlags = () => process.env.COULISSES_TEST_ENGINE_COPY
  ? ['--remotion', path.resolve(process.env.COULISSES_TEST_ENGINE_COPY)] : [];

// a Remotion project whose node_modules has everything the fixtures need
const NEEDED = ['remotion', '@remotion/player', '@remotion/cli', 'react', 'react-dom'];
export function remotionModules() {
  const candidates = [process.env.COULISSES_TEST_REMOTION, path.join(BRAMBLE, '06_Remotion'), path.join(UCHU, 'theatre', '06_Remotion')];
  for (const d of candidates.filter(Boolean)) {
    const nm = path.basename(d) === 'node_modules' ? d : path.join(d, 'node_modules');
    if (NEEDED.every((p) => exists(path.join(nm, p, 'package.json')))) return nm;
  }
  return null;
}
export const uchuTheatre = () => [process.env.COULISSES_TEST_UCHU, path.join(UCHU, 'theatre', '06_Remotion')].find((d) => exists(d && path.join(d, 'src', 'coulisses.ts'))) ?? null;
export const short12 = () => [process.env.COULISSES_TEST_SHORT12, path.join(UCHU, 'shorts', 'short12_yottsu_no_chikara', 'short12_yottsu_no_chikara.coulisses')].find(exists) ?? null;
export const realE03 = () => [process.env.COULISSES_TEST_E03, path.join(BRAMBLE, '07_Episodes', 'E03 - The Secret Garden', 'E03 - The Secret Garden.mp4')].find(exists) ?? null;
// the message of a test skipped for want of a resource (its summary line: 0 ok, 0 ko)
export function skip(what, env) {
  console.log(`  (sauté : ${what} n'est pas sur ce PC — ${env} pour l'indiquer)\n\n0 ok, 0 ko`);
  process.exit(0);
}

// a port of 127.0.0.1 nobody listens on, from `from` up (18/10/2026: another project's dev server sat on 4196, the port
// a suite always took — its studio then never answered)
export async function freePort(from) {
  const net = await import('node:net');
  for (let p = from; p < from + 200; p++) {
    const free = await new Promise((r) => { const s = net.createServer(); s.once('error', () => r(false)); s.listen(p, '127.0.0.1', () => s.close(() => r(true))); });
    if (free) return p;
  }
  return from;
}

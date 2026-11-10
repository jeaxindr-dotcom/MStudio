import path from 'node:path';
import { APP_DIR, MSTUDIO } from './app-profile.mjs';

const quotePS = value => "'" + value.replace(/'/g, "''") + "'";
export function cliCommand(script) {
  return MSTUDIO ? '& ' + quotePS(path.join(APP_DIR, 'runtime', 'node.exe')) + ' ' + quotePS(script) : `node "${script}"`;
}
export function cliArgs(args) {
  return args.map(value => MSTUDIO ? quotePS(value) : (/\s/.test(value) ? `"${value}"` : value)).join(' ');
}
// Project targets can be a quoted review directory or an episode with additional folder flags.
export function cliTarget(project) {
  return MSTUDIO ? project.target.replace(/"([^"]*)"/g, (_, value) => quotePS(value)) : project.target;
}

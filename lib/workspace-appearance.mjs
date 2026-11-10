import fs from 'node:fs';
import path from 'node:path';
import {settingsFile} from './i18n.mjs';
import {readJson, updateJson} from './episode.mjs';

// All studios in one installation share these UI preferences. A separate,
// locked file lets two processes change different controls at the same time.
const file = () => settingsFile() + '.workspace.json';
const modes = ['review','edit','screen'];
const tabs = {left:['agent','lots','queue'], right:['composition','medias','notes','scene','insp']};
function valid(key, v) {
  if (['lside','side','tlh'].includes(key)) return Number.isFinite(v) && v >= 80 && v <= 16000;
  if (key === 'vzoom') return Number.isFinite(v) && v >= .5 && v <= 3;
  if (key === 'timelineThumbnails' || /^workspaceV2\.guides\.(safe|thirds)$/.test(key)) return typeof v === 'boolean';
  if (key === 'tabL' || key === 'tabR') return tabs[key === 'tabL' ? 'left' : 'right'].includes(v);
  if (key === 'workspaceV2.mode') return modes.includes(v);
  const [scope,group,mode,side,...extra] = key.split('.');
  if (scope !== 'workspaceV2' || !modes.includes(mode) || extra.length) return false;
  if (group === 'layouts') return ['left','right','timeline'].includes(side) && typeof v === 'boolean';
  return group === 'tabs' && Object.hasOwn(tabs, side) && tabs[side].includes(v);
}
export const appearance = () => Object.fromEntries(Object.entries(readJson(file(), {}) || {}).filter(([k,v]) => valid(k,v)));
export function patchAppearance(delta) {
  if (!delta || Array.isArray(delta) || typeof delta !== 'object' || !Object.entries(delta).every(([k,v]) => valid(k,v))) return false;
  const f = file(); fs.mkdirSync(path.dirname(f), {recursive:true});
  updateJson(f, {}, current => ({...current,...delta}));
  return true;
}

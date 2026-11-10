// This module is also used by the editor before publishing a change.
const invalid = message => Object.assign(new Error(message), {status:400});
function number(value, fallback, min, max, field, integer = false) {
  const n = value ?? fallback;
  if (typeof n !== 'number' || !Number.isFinite(n) || integer && !Number.isInteger(n) || n < min || n > max)
    throw invalid(`Valeur incorrecte pour ${field} (${min}…${max}).`);
  return n;
}
function string(value, fallback, max, field) {
  const s = value ?? fallback;
  if (typeof s !== 'string' || s.length > max) throw invalid('Texte incorrect pour ' + field + '.');
  return s;
}
function color(value, fallback, background = false) {
  const s = value ?? fallback;
  if (typeof s === 'string' && (/^#[\da-f]{6}$/i.test(s) || background && s === 'transparent')) return s;
  throw invalid('Couleur de calque incorrecte.');
}
function choice(value, options, field) {
  if (value === undefined) return options[0];
  if (!options.includes(value)) throw invalid('Valeur incorrecte pour ' + field + '.');
  return value;
}

function insetLayer(inset, width, height) {
  if (inset == null) return undefined;
  if (typeof inset !== 'object' || Array.isArray(inset)) throw invalid('Calque extrait incorrect.');
  const sourceX = number(inset.sourceX, undefined, 0, width-1, 'inset.sourceX', true);
  const sourceY = number(inset.sourceY, undefined, 0, height-1, 'inset.sourceY', true);
  return {sourceX, sourceY,
    width:number(inset.width, undefined, 1, width-sourceX, 'inset.width', true),
    height:number(inset.height, undefined, 1, height-sourceY, 'inset.height', true),
    x:number(inset.x, sourceX, -4 * width, 4 * width, 'inset.x'),
    y:number(inset.y, sourceY, -4 * height, 4 * height, 'inset.y'),
    scale:number(inset.scale, 1, 0.1, 10, 'inset.scale'),
    mask:color(inset.mask, 'transparent', true),
  };
}

export function validateReverseShots(shots, format) {
  if (!Array.isArray(shots) || shots.length < 1 || shots.length > 20000) throw invalid('Le montage doit contenir entre 1 et 20 000 plans.');
  const {width, height, frames} = format;
  const ids = new Set();
  return shots.map((shot, index) => {
    if (!shot || typeof shot !== 'object' || Array.isArray(shot)) throw invalid('Plan incorrect.');
    const id = string(shot.id, 'plan-' + (index + 1), 100, 'id');
    if (!/^[\w-]+$/.test(id) || ids.has(id)) throw invalid('Chaque plan doit avoir un identifiant unique.');
    ids.add(id);
    const label = string(shot.label, 'Plan ' + (index + 1), 250, 'label').trim() || 'Plan ' + (index + 1);
    const sourceIn = number(shot.sourceIn, undefined, 0, frames - 1, 'sourceIn', true);
    const sourceOut = number(shot.sourceOut, undefined, sourceIn + 1, frames, 'sourceOut', true);
    return {
      id, label, sourceIn, sourceOut,
      x:number(shot.x, 0, -4 * width, 4 * width, 'x'),
      y:number(shot.y, 0, -4 * height, 4 * height, 'y'),
      zoom:number(shot.zoom, 1, 0.1, 10, 'zoom'),
      title:string(shot.title, '', 4000, 'title'),
      titleX:number(shot.titleX, Math.round(width * 0.06), -4 * width, 4 * width, 'titleX'),
      titleY:number(shot.titleY, Math.round(height * 0.75), -4 * height, 4 * height, 'titleY'),
      titleWidth:number(shot.titleWidth, Math.max(1, Math.round(width * 0.88)), 1, 4 * width, 'titleWidth'),
      titleSize:number(shot.titleSize, Math.max(12, Math.round(height * 0.065)), 1, Math.max(12, 2 * Math.max(width, height)), 'titleSize'),
      titleAlign:choice(shot.titleAlign, ['left','center','right'], 'titleAlign'),
      titleFont:choice(shot.titleFont, ['sans','serif'], 'titleFont'),
      titleColor:color(shot.titleColor, '#ffffff'),
      titleBackground:color(shot.titleBackground, 'transparent', true),
      inset:insetLayer(shot.inset, width, height),
    };
  });
}

// Keep continuous sound across visual cuts whenever the source samples are contiguous.
export function layoutMontage(data) {
  const shots = validateReverseShots(data.shots, data);
  const sound = [];
  let duration = 0;
  const clips = shots.map(shot => {
    const from = duration;
    duration += shot.sourceOut - shot.sourceIn;
    if (data.hasAudio) {
      const previous = sound.at(-1);
      if (previous && previous.sourceOut === shot.sourceIn) {
        previous.end = duration;
        previous.sourceOut = shot.sourceOut;
      } else {
        sound.push({id:shot.id, from, end:duration, sourceIn:shot.sourceIn, sourceOut:shot.sourceOut});
      }
    }
    return {...shot, from, end:duration};
  });
  return {clips, sound, duration, fps:data.fpsNumerator / data.fpsDenominator};
}

// The author supplies data only. No URLs, markup, executable expressions or bitmap sources.
const fields = (value, allowed, where) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(where+' must be an object.');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw Error(where+' has an unknown field: '+key);
};
const check = (ok, message) => { if (!ok) throw Error('layers.json: '+message); };
const text = (value,max=180) => typeof value === 'string' && !!value.trim() && value.length<=max;
const id = value => typeof value==='string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value);
const color = value => typeof value==='string' && /^(?:#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8}|none|transparent)$/i.test(value);
const scalar = n => Number.isFinite(n) && Math.abs(n)<=1e7;
const unit = n => Number.isFinite(n) && n>=0 && n<=1;
const frame = (n,lo,hi) => Number.isSafeInteger(n) && n>=lo && n<=hi;
const animated = ['x','y','scaleX','scaleY','rotation','opacity','width','height','rx','ry','x2','y2','strokeWidth','strokeDashoffset','fontSize','lineHeight','letterSpacing'];
const nonnegative = ['width','height','rx','ry','strokeWidth','fontSize','lineHeight'];
function checkNumber(key,value,where) {
  check(scalar(value) && (key!=='opacity'||unit(value)) && (!nonnegative.includes(key)||value>=0),where+' invalid '+key);
}
function uniqueId(item,ids,where) {
  check(id(item.id) && !ids.has(item.id),where+' needs a unique ASCII id starting with a letter.');
  ids.add(item.id);
}

export function validateReconstructionLayers(model,format) {
  fields(model,['version','limitations','scenes'],'layers.json');
  check(model.version===1,'expected version 1.');
  check(Array.isArray(model.limitations) && model.limitations.length<=120 && model.limitations.every(s=>text(s,1400)),
    'limitations must list specific approximations (strings).');
  check(Array.isArray(model.scenes) && model.scenes.length>0 && model.scenes.length<=Math.min(format.frames,16384),'invalid scenes.');
  const sceneIds = new Set();
  let end=0, count=0;
  for (const s of model.scenes) {
    fields(s,['id','label','from','to','background','gradients','layers'],'scene');
    uniqueId(s,sceneIds,'scene');
    check(text(s.label) && s.from===end && frame(s.to,end+1,format.frames),s.id+': scenes must be named and contiguous.');
    const length = s.to-s.from;
    end=s.to;
    const gradients=new Set();
    if (s.gradients!==undefined) {
      check(Array.isArray(s.gradients) && s.gradients.length<=256,'invalid gradients.');
      for (const g of s.gradients) {
        fields(g,['id','x1','x2','y1','y2','stops'],'gradient');
        uniqueId(g,gradients,'gradient');
        for (const key of ['x1','x2','y1','y2']) if (key in g) check(scalar(g[key]),'invalid gradient '+key);
        check(Array.isArray(g.stops) && g.stops.length>=2 && g.stops.length<=128,'a gradient needs 2–128 stops.');
        let lastOffset=-1;
        for(const stop of g.stops) {
          fields(stop,['offset','color','opacity'],'gradient stop');
          check(unit(stop.offset) && stop.offset>=lastOffset && color(stop.color) && (!('opacity' in stop)||unit(stop.opacity)),'invalid gradient stop.');
          lastOffset=stop.offset;
        }
      }
    }
    const paint = v => color(v) || (typeof v==='string' && gradients.has(/^url\(#([\w-]+)\)$/.exec(v)?.[1]));
    check(paint(s.background),s.id+': invalid background.');
    check(Array.isArray(s.layers) && s.layers.length<=4096,s.id+': invalid layers.');
    const layerIds=new Set();
    for (const l of s.layers) {
      fields(l,['id','label','type','from','to','originX','originY','fill','stroke','keyframes',...animated,
        'd','text','fontFamily','fontWeight','anchor','clip','pathLength','strokeDasharray'],'layer');
      uniqueId(l,layerIds,s.id+' layer');
      const at=s.id+'/'+l.id, from=l.from??0, to=l.to??length;
      check(text(l.label) && ['rect','ellipse','line','path','text'].includes(l.type),at+': invalid type or label.');
      check(frame(from,0,length-1) && frame(to,from+1,length),at+': invalid local from/to.');
      for(const k of [...animated,'originX','originY']) if(k in l) checkNumber(k,l[k],at);
      for(const k of ['stroke','fill']) if(k in l) check(paint(l[k]),at+': invalid '+k);
      if(l.type==='text') check(text(l.text,20000),at+': text missing.');
      if('fontFamily' in l) check(text(l.fontFamily,200) && !/[;(){}<>\\/]/.test(l.fontFamily),at+': invalid fontFamily.');
      if('fontWeight' in l) check(frame(l.fontWeight,1,1000),at+': invalid fontWeight.');
      if('anchor' in l) check(['start','middle','end'].includes(l.anchor),at+': invalid anchor.');
      if('clip' in l) {
        fields(l.clip,['x','y','width','height'],at+' clip');
        check(['x','y','width','height'].every(k=>scalar(l.clip[k])) && l.clip.width>0 && l.clip.height>0,at+': invalid fixed viewport.');
      }
      if('pathLength' in l) check(l.type==='path' && scalar(l.pathLength) && l.pathLength>0,at+': invalid pathLength.');
      if('strokeDasharray' in l) check(Array.isArray(l.strokeDasharray) && l.strokeDasharray.length>0 && l.strokeDasharray.length<=64
        && l.strokeDasharray.every(n=>scalar(n) && n>=0) && l.strokeDasharray.some(n=>n>0),at+': invalid strokeDasharray.');
      if(l.type==='path') check(typeof l.d==='string' && l.d.length<=240000 && /^\s*[Mm][\d.eE+\-,\sMmLlHhVvCcSsQqTtAaZz]+$/.test(l.d),at+': invalid SVG path d.');
      let last=-1;
      if ('keyframes' in l) {
        check(Array.isArray(l.keyframes) && l.keyframes.length<=Math.min(16384,length+1),at+': invalid keyframes.');
        for (const k of l.keyframes) {
          fields(k,['frame',...animated],at+' keyframe');
          check(frame(k.frame,last+1,length) && Object.keys(k).length>1,at+': keyframes need ascending scene-local frame numbers and numeric values.');
          for(const name of animated) if(name in k) checkNumber(name,k[name],at);
          last=k.frame;
        }
      }
      const required = l.type==='rect'?['width','height']:l.type==='ellipse'?['rx','ry']:[];
      for(const k of required) check(l[k]>0 || l.keyframes?.some(stop=>stop[k]>0),at+': missing positive '+k);
      if(l.type==='line') check(l.stroke && l.stroke!=='none' && [l,...l.keyframes??[]].some(k=>k.x2||k.y2),at+': missing line stroke or endpoint.');
      count++;
    }
  }
  check(end===format.frames,'the last scene must end at frame '+format.frames+'.');
  check(count>0 && count<=30000,'at least one editable visual layer is required; maximum 30000.');
  return model;
}

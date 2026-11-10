import React from 'react';
import {AbsoluteFill, Audio, staticFile, useCurrentFrame} from 'remotion';
import format from './format.json';
import document from './layers.json';

type Keyframe = {frame:number} & Record<string, number>;
type Layer = {
  id:string; label:string; type:string; from?:number; to?:number; keyframes?:Keyframe[];
  x?:number; y?:number; scaleX?:number; scaleY?:number; rotation?:number; opacity?:number;
  width?:number; height?:number; rx?:number; ry?:number; x2?:number; y2?:number;
  originX?:number; originY?:number; fill?:string; stroke?:string; strokeWidth?:number;
  d?:string; text?:string; fontFamily?:string; fontSize?:number; fontWeight?:number;
  letterSpacing?:number; lineHeight?:number; anchor?:'start'|'middle'|'end';
  clip?:{x:number;y:number;width:number;height:number}; pathLength?:number;
  strokeDasharray?:number[]; strokeDashoffset?:number;
};
type Gradient = {id:string; x1?:number; y1?:number; x2?:number; y2?:number;
  stops:{offset:number;color:string;opacity?:number}[]};
type SceneData = {id:string;label:string;from:number;to:number;background:string;gradients?:Gradient[];layers:Layer[]};

// Coordinates are composition pixels. Each animated value has its own stops.
function value(layer:Layer, key:keyof Layer, frame:number, fallback:number) {
  let at = 0, current = typeof layer[key] === 'number' ? Number(layer[key]) : fallback;
  for (const stop of layer.keyframes ?? []) {
    const next = stop[key];
    if (typeof next !== 'number') continue;
    if (frame < stop.frame) return current + (next-current)*(frame-at)/(stop.frame-at);
    at = stop.frame;
    current = next;
  }
  return current;
}

export function VectorLayer({layer, frame}:{layer:Layer; frame:number}) {
  if (frame < (layer.from ?? 0) || frame >= (layer.to ?? Infinity)) return null;
  const n = (key:keyof Layer, fallback=0) => value(layer, key, frame, fallback);
  const ox = layer.originX ?? 0, oy = layer.originY ?? 0;
  const transform = `translate(${n('x')} ${n('y')}) translate(${ox} ${oy}) rotate(${n('rotation')}) scale(${n('scaleX',1)} ${n('scaleY',1)}) translate(${-ox} ${-oy})`;
  let shape;
  switch (layer.type) {
    case 'rect': shape = <rect width={n('width')} height={n('height')} rx={n('rx')}/>; break;
    case 'ellipse': shape = <ellipse rx={n('rx')} ry={n('ry')}/>; break;
    case 'line': shape = <line x2={n('x2')} y2={n('y2')}/>; break;
    case 'path': shape = <path d={layer.d} pathLength={layer.pathLength}/>; break;
    case 'text': shape = <text fontFamily={layer.fontFamily ?? 'Arial, sans-serif'}
      fontWeight={layer.fontWeight ?? 400} fontSize={n('fontSize',32)} letterSpacing={n('letterSpacing')}
      textAnchor={layer.anchor ?? 'start'} xmlSpace="preserve">
      {(layer.text ?? '').split('\n').map((line,i) =>
        <tspan key={i} x={0} dy={i ? n('lineHeight',n('fontSize',32)*1.2) : 0}>{line}</tspan>)}
    </text>; break;
  }
  const painted = <g data-layer={layer.id} aria-label={layer.label} transform={transform} opacity={n('opacity',1)}
    fill={layer.fill ?? '#ffffff'} stroke={layer.stroke ?? 'none'} strokeWidth={n('strokeWidth',1)}
    strokeDasharray={layer.strokeDasharray?.join(' ')} strokeDashoffset={n('strokeDashoffset')}
    strokeLinecap="round" strokeLinejoin="round">{shape}</g>;
  if (!layer.clip) return painted;
  const clipId = 'viewport.'+layer.id;
  return <g><defs><clipPath id={clipId}><rect {...layer.clip}/></clipPath></defs>
    <g clipPath={`url(#${clipId})`}>{painted}</g></g>;
}

export function Scene() {
  const frame = useCurrentFrame();
  const scene = (document.scenes as SceneData[]).find(s => frame >= s.from && frame < s.to);
  return <AbsoluteFill>
    {scene && <svg width={format.width} height={format.height} viewBox={`0 0 ${format.width} ${format.height}`}
      data-scene={scene.id} aria-label={scene.label}>
      <defs>{scene.gradients?.map(g => <linearGradient key={g.id} id={g.id}
        x1={g.x1 ?? 0} y1={g.y1 ?? 0} x2={g.x2 ?? 1} y2={g.y2 ?? 0}>
        {g.stops.map((s,i) => <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity ?? 1}/>)}
      </linearGradient>)}</defs>
      <rect width="100%" height="100%" fill={scene.background}/>
      {scene.layers.map(layer => <VectorLayer key={layer.id} layer={layer} frame={frame-scene.from}/>)}
    </svg>}
    {format.hasAudio && <Audio src={staticFile('audio/master.wav')}/>}
  </AbsoluteFill>;
}

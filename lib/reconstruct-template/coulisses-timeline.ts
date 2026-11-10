import format from './format.json';
import document from './layers.json';

type Clip = {de:number; a:number; label:string; ref:string; son?:string};
type Track = {id:string; nom:string; type:'video'|'band'|'audio'; clips:Clip[]};
export function timeline() {
  const shots:Track = {id:'scenes',nom:'Scènes / Scenes',type:'video',clips:[]};
  const tracks = new Map<string, Track>();
  for (const scene of document.scenes) {
    shots.clips.push({de:scene.from,a:scene.to,label:scene.label,ref:scene.id});
    for (const layer of scene.layers as {id:string;label:string;from?:number;to?:number}[]) {
      let track = tracks.get(layer.id);
      if (!track) {
        track = {id:'layer-'+layer.id, nom:layer.label, type:'band', clips:[]};
        tracks.set(layer.id,track);
      }
      track.clips.push({de:scene.from+(layer.from ?? 0),a:scene.from+(layer.to ?? scene.to-scene.from),
        label:layer.label,ref:scene.id+'/'+layer.id});
    }
  }
  const pistes = [shots,...tracks.values()];
  const src = 'audio/master.wav';
  if (format.hasAudio) pistes.push({id:'audio',nom:'Audio',type:'audio',
    clips:[{de:0,a:format.frames,label:'Audio',ref:'audio',son:src}]});
  return {fps:format.fpsNumerator/format.fpsDenominator,durationInFrames:format.frames,pistes,
    ...(format.hasAudio ? {reviewAudio:{src,offsetFrames:0,volume:1}} : {})};
}

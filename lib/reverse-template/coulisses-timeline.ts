import montage from './montage.json';
import {layoutMontage} from './model.mjs';

export function timeline() {
  const {clips, sound, duration, fps} = layoutMontage(montage);
  const fr = montage.language !== 'en';
  const tracks = [
    {id:'shots', nom:fr ? 'Plans' : 'Shots', type:'video', clips:clips.map(s => ({
      de:s.from, a:s.end, label:s.label, ref:s.id, fichier:'public/' + montage.media, debut:s.sourceIn,
    }))},
    {id:'titles', nom:fr ? 'Titres' : 'Titles', type:'band', clips:clips.filter(s => s.title).map(s => ({
      de:s.from, a:s.end, label:s.title, ref:s.id + '-title',
    }))},
    {id:'elements', nom:fr ? 'Éléments' : 'Elements', type:'band', clips:clips.filter(s => s.inset).map(s => ({
      de:s.from, a:s.end, label:s.label + (fr ? ' · élément' : ' · element'), ref:s.id + '-inset',
    }))},
    {id:'audio', nom:'Audio', type:'audio', clips:sound.map(s => ({
      de:s.from, a:s.end, label:'Audio', ref:s.id + '-audio', son:montage.media, debut:s.sourceIn,
    }))},
  ];
  const master = sound.length === 1 ? {reviewAudio:{src:montage.media, offsetFrames:sound[0].sourceIn, volume:1}} : {};
  return {fps, durationInFrames:duration, pistes:tracks.filter(t => t.clips.length > 0 || t.id === 'titles'), ...master};
}

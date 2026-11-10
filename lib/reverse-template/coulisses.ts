import {Scene} from './Scene';
import montage from './montage.json';
import {layoutMontage} from './model.mjs';

const {duration, fps} = layoutMontage(montage);
export const compositions = [{
  id:'Reverse', component:Scene, fps, width:montage.width, height:montage.height,
  durationInFrames:duration, defaultProps:{},
}];

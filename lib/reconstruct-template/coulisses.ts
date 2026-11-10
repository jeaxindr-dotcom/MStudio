import {Scene} from './Scene';
import format from './format.json';

export const compositions = [{
  id:'Reconstruction', component:Scene, fps:format.fpsNumerator/format.fpsDenominator,
  width:format.width, height:format.height, durationInFrames:format.frames, defaultProps:{},
}];

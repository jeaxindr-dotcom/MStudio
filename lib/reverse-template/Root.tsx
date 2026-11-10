import React from 'react';
import {Composition} from 'remotion';
import {compositions} from './coulisses';

const {component, fps, width, height, durationInFrames} = compositions[0];
export const Root = () => (
  <Composition id="Reverse" component={component} fps={fps} width={width} height={height}
    durationInFrames={durationInFrames} defaultProps={{}} />
);

// Used only by the studio's live bundle. Apply the buffer density at mount so
// post-processing targets created by the composition also see the chosen density.
import React from 'react';
import {Canvas as OriginalCanvas} from '@react-three/fiber';
export * from '@react-three/fiber';

const density = Number(new URLSearchParams(location.search).get('previewScale'));
const explicit = [1, 0.75, 0.5, 0.25].includes(density);
export const Canvas = React.forwardRef<HTMLCanvasElement, React.ComponentPropsWithoutRef<typeof OriginalCanvas>>(
  (props, ref) => <OriginalCanvas {...props} ref={ref} dpr={explicit ? density : props.dpr} />
);
Canvas.displayName = 'Canvas';

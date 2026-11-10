import React from 'react';
import {AbsoluteFill, Html5Audio, OffthreadVideo, Sequence, staticFile} from 'remotion';
import montage from './montage.json';
import {layoutMontage} from './model.mjs';

const {clips, sound} = layoutMontage(montage);
const media = staticFile(montage.media);

export const Scene: React.FC = () => (
  <AbsoluteFill style={{backgroundColor:'#000', overflow:'hidden'}}>
    {clips.map(shot => (
      <Sequence key={shot.id} name={shot.label} from={shot.from} durationInFrames={shot.end - shot.from}>
        <AbsoluteFill data-coulisses={shot.id} style={{transformOrigin:'center', translate:`${shot.x}px ${shot.y}px`, scale:shot.zoom}}>
          <OffthreadVideo src={media} trimBefore={shot.sourceIn} muted pauseWhenBuffering
            style={{width:'100%', height:'100%', objectFit:'fill'}} />
          {shot.inset && shot.inset.mask !== 'transparent' && <div style={{
            position:'absolute', left:shot.inset.sourceX, top:shot.inset.sourceY,
            width:shot.inset.width, height:shot.inset.height, backgroundColor:shot.inset.mask,
          }} />}
        </AbsoluteFill>
        {shot.inset && <div data-coulisses={shot.id + '-inset'} style={{
          position:'absolute', overflow:'hidden', left:shot.inset.x, top:shot.inset.y,
          width:shot.inset.width, height:shot.inset.height, transformOrigin:'top left', scale:shot.inset.scale,
        }}>
          <OffthreadVideo src={media} trimBefore={shot.sourceIn} muted pauseWhenBuffering
            style={{position:'absolute', left:-shot.inset.sourceX, top:-shot.inset.sourceY,
              width:montage.width, height:montage.height, maxWidth:'none', maxHeight:'none', objectFit:'fill'}} />
        </div>}
        {shot.title && <div data-coulisses={shot.id + '-title'} style={{
          position:'absolute', boxSizing:'border-box', left:shot.titleX, top:shot.titleY, width:shot.titleWidth,
          color:shot.titleColor, backgroundColor:shot.titleBackground, textAlign:shot.titleAlign,
          font:shot.titleFont === 'serif'
            ? 'italic 500 ' + shot.titleSize + 'px/1.15 Georgia, "Times New Roman", serif'
            : '700 ' + shot.titleSize + 'px/1.15 Arial, sans-serif',
          padding:shot.titleBackground === 'transparent' ? 0 : `${Math.round(shot.titleSize * .20)}px ${Math.round(shot.titleSize * .32)}px`,
          whiteSpace:'pre-wrap', overflowWrap:'anywhere',
        }}>{shot.title}</div>}
      </Sequence>
    ))}
    {sound.map(clip => (
      <Sequence key={clip.id} name="Audio" from={clip.from} durationInFrames={clip.end - clip.from} layout="none">
        <Html5Audio src={media} trimBefore={clip.sourceIn} pauseWhenBuffering />
      </Sequence>
    ))}
  </AbsoluteFill>
);

import * as THREE from 'three';

// Ground plane and orientation compass owned by the preview, never by the composition.
const hue = ['#ef726d', '#73d89a', '#6aa7ff'];
function lines(points: number[], color: string, opacity: number) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  const material=new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false,toneMapped:false});
  const mesh=new THREE.LineSegments(geometry,material);
  mesh.raycast=()=>{}; // editor guides cannot be selected or intercept a drop
  mesh.renderOrder=-10;
  return mesh;
}
export function createGuides(scene:THREE.Scene, canvas:HTMLCanvasElement) {
  const group=new THREE.Group(), lattice=new THREE.Group(), minor:number[]=[], major:number[]=[];
  group.name='MStudio • editor grid';
  for(let n=-50;n<=50;n++) (n%5===0 ? major : minor).push(-50,0,n,50,0,n, n,0,-50,n,0,50);
  lattice.add(lines(minor,'#91a4b7',.32),lines(major,'#b0c2d2',.6));
  const axes=[lines([-1,0,0,1,0,0],hue[0],.90),lines([0,0,0,0,1,0],hue[1],.90),lines([0,0,-1,0,0,1],hue[2],.90)];
  axes.forEach(a=>a.renderOrder=-9);
  group.add(lattice,...axes);group.visible=false;scene.add(group);
  // New projects already include our older editor-only aids. Preserve their original visibility outside free view.
  const old=scene.getObjectByName('editor-aids');
  const template=old?.children.some(c=>c.type==='GridHelper') && old.getObjectByName('editor-origin') ? old : null;
  const originalVisibility=template?.visible;
  const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 132 110');svg.setAttribute('aria-hidden','true');
  svg.setAttribute('data-mstudio-guide','compass');
  svg.style.cssText='position:absolute;top:16px;right:16px;width:clamp(90px,8%,140px);height:auto;pointer-events:none;z-index:10;display:none;overflow:visible';
  svg.innerHTML='<rect x="1" y="1" width="130" height="108" rx="12" fill="#111923" fill-opacity=".87" stroke="#687989" stroke-opacity=".55"/>'+['X','Y','Z'].map((s,i)=>'<g stroke="'+hue[i]+'"><line x1="66" y1="46" stroke-width="2.8"/><text stroke="none" fill="'+hue[i]+'" font-family="system-ui,sans-serif" font-size="15" font-weight="700" text-anchor="middle" dominant-baseline="central">'+s+'</text></g>').join('')+'<circle cx="66" cy="46" r="3.5" fill="#e6edf3"/><text x="66" y="96" text-anchor="middle" fill="#e5edf5" font-family="system-ui,sans-serif" font-size="13"></text>';
  canvas.parentElement?.append(svg);
  // Remotion scales the composition with CSS; keep axis letters readable on a small preview as well.
  const sizeCompass=()=>{const width=canvas.getBoundingClientRect().width;if(!width||!canvas.clientWidth)return;
    const scale=width/canvas.clientWidth,px=Math.min(112,Math.max(88,width*.085));
    svg.style.width=(px/scale)+'px';svg.style.top=(10/scale)+'px';svg.style.right=(10/scale)+'px';};
  const resize=new ResizeObserver(sizeCompass);resize.observe(canvas);window.addEventListener('resize',sizeCompass);
  const markers=Array.from(svg.querySelectorAll('g')).map(g=>({line:g.querySelector('line')!,text:g.querySelector('text')!}));
  const label=svg.lastElementChild!, inv=new THREE.Quaternion(), prev=new THREE.Quaternion(NaN,0,0,0), v=new THREE.Vector3();
  let lastStep=0;
  function update(cam:THREE.Camera,target:THREE.Vector3|undefined,free:boolean,enabled:boolean,capture:boolean) {
    if(template) template.visible=free||capture ? false : !!originalVisibility;
    const show=free && enabled && !capture && !!target;
    if(group.visible!==show){group.visible=show;svg.style.display=show?'block':'none';if(show)sizeCompass();}
    if(!show||!target)return;
    const c=cam as THREE.PerspectiveCamera & THREE.OrthographicCamera;
    const span=c.isOrthographicCamera ? (c.top-c.bottom)/c.zoom : 2*cam.position.distanceTo(target)*Math.tan(THREE.MathUtils.degToRad(c.fov||45)/2)/(c.zoom||1);
    const rough=Math.max(.000001,span/14), base=10**Math.floor(Math.log10(rough)), ratio=rough/base;
    const step=(ratio<1.5?1:ratio<3.5?2:ratio<7.5?5:10)*base;
    if(step!==lastStep) {lattice.scale.setScalar(step);label.textContent='▦  '+Number(step.toPrecision(2))+' u';lastStep=step;}
    const majorStep=step*5;
    lattice.position.set(Math.round(target.x/majorStep)*majorStep,0,Math.round(target.z/majorStep)*majorStep);
    const extent=50*step+Math.max(Math.abs(target.x),Math.abs(target.z));
    axes[0].scale.x=extent;axes[1].scale.y=step*5;axes[2].scale.z=extent;
    cam.getWorldQuaternion(inv);
    if(!inv.equals(prev)) {
      prev.copy(inv);inv.invert();
      for(let i=0;i<3;i++){
        v.set(i===0?1:0,i===1?1:0,i===2?1:0).applyQuaternion(inv);
        const x=v.x,y=-v.y, g=markers[i],collapsed=Math.hypot(x,y)<.15;
        g.line.setAttribute('x2',String(66+x*25));g.line.setAttribute('y2',String(46+y*25));
        g.text.setAttribute('x',String(collapsed?78:66+x*34));g.text.setAttribute('y',String(collapsed?58:46+y*34));
      }
    }
  }
  return {update,dispose:()=>{
    if(template)template.visible=!!originalVisibility;
    resize.disconnect();window.removeEventListener('resize',sizeCompass);
    group.removeFromParent();svg.remove();
    group.traverse(o=>{if(o instanceof THREE.LineSegments){o.geometry.dispose();o.material.dispose();}});
  }};
}

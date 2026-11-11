import * as THREE from 'three';

type Camera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
type AlphaRect = {left: number; right: number; top: number; bottom: number};

// Sample the texture only on a focus gesture. A rig or prop may occupy just one
// corner of a large transparent card. Use geometry bounds if the source cannot be read.
function alphaRect(texture: THREE.Texture): AlphaRect | null {
  const source = texture.image;
  const width = source?.videoWidth || source?.naturalWidth || source?.width;
  const height = source?.videoHeight || source?.naturalHeight || source?.height;
  if (!width || !height || !texture.repeat.equals(new THREE.Vector2(1, 1)) ||
      texture.offset.lengthSq() || texture.rotation || !texture.matrixAutoUpdate || texture.channel) return null;
  const scale = Math.min(1, 128 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  if (!ctx) return null;
  try {
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, right = -1, top = canvas.height, bottom = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3] < 8) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = y;
      }
    }
    if (right < left) return null;
    return {left: Math.max(0, left - 1) / canvas.width, right: Math.min(canvas.width, right + 2) / canvas.width,
      top: Math.max(0, top - 1) / canvas.height, bottom: Math.min(canvas.height, bottom + 2) / canvas.height};
  } catch { return null; }
}

function cardBounds(mesh: THREE.Mesh, cache: Map<THREE.Texture, AlphaRect | null>): THREE.Box3 | null {
  const geom = mesh.geometry, mat = mesh.material;
  if (geom.type !== 'PlaneGeometry' || geom.attributes.position.count !== 4 || Array.isArray(mat) ||
      !(mat.transparent || mat.alphaTest)) return null;
  const shader = mat as THREE.ShaderMaterial;
  const texture = (mat as THREE.MeshBasicMaterial).map ||
    (shader.isShaderMaterial && /texture2D\s*\(\s*map\s*,\s*vUv\s*\)/.test(shader.fragmentShader)
      && /vUv\s*=\s*uv\s*;/.test(shader.vertexShader) ? shader.uniforms.map?.value : null);
  if (!texture?.isTexture) return null;
  if (!cache.has(texture)) cache.set(texture, alphaRect(texture));
  const rect = cache.get(texture);
  if (!rect) return null;
  const uv = geom.attributes.uv;
  if (!uv || uv.getX(0) !== 0 || uv.getY(0) !== 1 || uv.getX(1) !== 1 || uv.getY(1) !== 1 ||
      uv.getX(2) !== 0 || uv.getY(2) !== 0) return null;
  const points = geom.attributes.position;
  const origin = new THREE.Vector3().fromBufferAttribute(points, 0);
  const right = new THREE.Vector3().fromBufferAttribute(points, 1).sub(origin);
  const down = new THREE.Vector3().fromBufferAttribute(points, 2).sub(origin);
  const bounds = new THREE.Box3();
  for (const x of [rect.left, rect.right]) for (const y of [rect.top, rect.bottom]) {
    const point = origin.clone().addScaledVector(right, x).addScaledVector(down, texture.flipY ? y : 1 - y);
    bounds.expandByPoint(point.applyMatrix4(mesh.matrixWorld));
  }
  return bounds;
}

function worldBounds(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3(), cache = new Map<THREE.Texture, AlphaRect | null>();
  object.traverseVisible(node => {
    const mesh = node as THREE.Mesh & Partial<THREE.InstancedMesh> & Partial<THREE.SkinnedMesh>;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (mesh.isSkinnedMesh || mesh.isInstancedMesh) {
      mesh.computeBoundingBox!();
      if (mesh.boundingBox) bounds.union(mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
      return;
    }
    const card = cardBounds(mesh, cache);
    if (card) { bounds.union(card); return; }
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (g.boundingBox) bounds.union(g.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  });
  // A hidden animated group can still be chosen from the list.
  if (bounds.isEmpty()) bounds.setFromObject(object);
  return bounds;
}

export function fitObject(camera: Camera, object: THREE.Object3D) {
  const bounds = worldBounds(object);
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) return null;
  const target = bounds.getCenter(new THREE.Vector3());
  // The camera can live on a moving or scaled rig. Navigation and clipping
  // use its parent's space, while the inspector and guides use a world pivot.
  camera.updateWorldMatrix(true, false);
  const toParent = new THREE.Matrix4();
  if (camera.parent) {
    if (!camera.parent.matrixWorld.determinant()) return null;
    toParent.copy(camera.parent.matrixWorld).invert();
  }
  const localTarget = target.clone().applyMatrix4(toParent);
  const inverse = camera.quaternion.clone().invert();
  const perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera;
  const o = camera as THREE.OrthographicCamera;
  if (!perspective && !o.isOrthographicCamera) return null;
  const proj = camera.projectionMatrix.elements;
  const horizontal = 1 / Math.abs(proj[0]), vertical = 1 / Math.abs(proj[5]);
  if (![horizontal, vertical].every(v => v > 0 && Number.isFinite(v))) return null;
  const margin = 1.18;
  let distance = 0, halfWidth = 0, halfHeight = 0, radius = 0;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const corner = new THREE.Vector3(x, y, z).applyMatrix4(toParent).sub(localTarget).applyQuaternion(inverse);
    halfWidth = Math.max(halfWidth, Math.abs(corner.x));
    halfHeight = Math.max(halfHeight, Math.abs(corner.y));
    radius = Math.max(radius, corner.length());
    if (perspective) distance = Math.max(distance, corner.z +
      margin * Math.max(Math.abs(corner.x) / horizontal, Math.abs(corner.y) / vertical));
  }
  // Permit orbiting every side, including the end of a long narrow object.
  distance = Math.max(0.001, distance, radius * 1.08);
  if (!perspective) distance = Math.max(distance, camera.position.distanceTo(localTarget));
  let zoom = camera.zoom;
  if (!perspective && radius > 0) {
    const fit = camera.zoom * Math.min(horizontal / (margin * halfWidth), vertical / (margin * halfHeight));
    if (Number.isFinite(fit) && fit > 0) zoom = fit;
  }
  const near = Math.min(camera.near, Math.max(1e-7, (distance - radius) * 0.5));
  const far = Math.max(camera.far, (distance + radius) * 1.2);
  const position = new THREE.Vector3(0, 0, distance).applyQuaternion(camera.quaternion).add(localTarget);
  return {position, target, zoom, near, far};
}

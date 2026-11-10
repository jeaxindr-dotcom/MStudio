import type * as THREE from 'three';

type Object3D = THREE.Object3D;
type Target = { id: string; object: Object3D; name: string };

// A named Three object can be authored without a React key. Sibling ordinals
// distinguish repeated names and survive remounts or unrelated scene additions.
function objectPath(object: Object3D, scene: Object3D) {
  const segments: [string, string, number][] = [];
  for (let node = object; node.parent && node !== scene; node = node.parent) {
    const siblings = node.parent.children.filter(s => s.name === node.name && s.type === node.type);
    segments.unshift([node.type, node.name, siblings.indexOf(node)]);
  }
  return '@three/' + JSON.stringify(segments);
}

export function sceneTargets(scene: Object3D, fiberOf: WeakMap<object, any>,
  reactPath: (mesh: Object3D) => string, keyedOwner: (mesh: Object3D) => Object3D | null) {
  const byId = new Map<string, Target>(), owners = new Map<Object3D, Target>(), byMesh = new WeakMap<Object3D, Target>();
  const excluded = new WeakSet<Object3D>();
  const aids = scene.getObjectByName('editor-aids');
  if (aids?.children.some(child => child.type === 'GridHelper') && aids.getObjectByName('editor-origin')) {
    aids.traverse(object => excluded.add(object));
  }
  scene.traverse(mesh => {
    // Only authored meshes. Editor gizmos, selection boxes and guides have no React host.
    if (!(mesh as THREE.Mesh).isMesh || !fiberOf.has(mesh) || excluded.has(mesh)) return;
    const path = reactPath(mesh), keyed = path.includes('[key=') ? keyedOwner(mesh) : null;
    let object = keyed ?? mesh;
    if (!keyed) {
      // A rig or animated prop often wraps its mesh in a placement group. Keep
      // that group editable together, stopping before an unrelated sibling.
      for (let p = mesh.parent; p && p !== scene && p.children.length === 1; p = p.parent) {
        if (p.name) object = p;
      }
    }
    let entry = owners.get(object);
    if (!entry) {
      const id = keyed && !byId.has(path) ? path : objectPath(object, scene);
      const ordinal = scene === object.parent ? scene.children.indexOf(object) : object.parent?.children.indexOf(object) ?? 0;
      entry = { id, object, name: object.name || mesh.name || (keyed ? '' : `${object.type} ${ordinal + 1}`) };
      owners.set(object, entry);
      byId.set(id, entry);
    }
    byMesh.set(mesh, entry);
  });
  return { byId, byMesh };
}

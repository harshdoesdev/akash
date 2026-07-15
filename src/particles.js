import * as THREE from 'three/webgpu';
import {
  attribute, uniform, texture as textureNode, uv, positionGeometry,
  cameraPosition, vec3, normalize, cross, Fn,
} from 'three/tsl';

// WebGPU renders THREE.Points as 1-pixel dots (point primitives have no
// size there), so every particle system is an instanced billboard-quad
// cloud instead: one draw call, positions streamed from the same Float32
// array the simulation writes. Park a particle at y=-9999 to hide it.
export function createParticleCloud(scene, { count, map, size, color = 0xffffff, colorRef = null, opacity = 1, additive = false }) {
  const positions = new Float32Array(count * 3).fill(-9999);

  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  const posAttr = new THREE.InstancedBufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPos', posAttr);
  geo.instanceCount = count;

  const uOpacity = uniform(opacity);
  // colorRef (e.g. the day/night tint Color) stays live by reference.
  const uColor = uniform(colorRef || new THREE.Color(color));

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: false,
  });
  const aPos = attribute('aPos', 'vec3');
  mat.positionNode = Fn(() => {
    const fwd = normalize(cameraPosition.sub(aPos));
    const right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    const up2 = cross(fwd, right);
    return aPos.add(right.mul(positionGeometry.x).add(up2.mul(positionGeometry.y)).mul(size));
  })();
  const tex = textureNode(map, uv());
  mat.colorNode = tex.rgb.mul(uColor);
  mat.opacityNode = tex.a.mul(uOpacity);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    positions,
    uOpacity,
    commit() { posAttr.needsUpdate = true; },
  };
}

// Soft radial sprite on a canvas — the round particle every system uses.
export function makeDotTexture(stops) {
  const dot = document.createElement('canvas');
  dot.width = dot.height = 48;
  const ctx = dot.getContext('2d');
  const g = ctx.createRadialGradient(24, 24, 0, 24, 24, 24);
  for (const [t, c] of stops) g.addColorStop(t, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 48, 48);
  return new THREE.CanvasTexture(dot);
}

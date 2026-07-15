import * as THREE from 'three/webgpu';
import {
  texture, uv, uniform, positionWorld, positionView,
  vec2, vec3, float, dot, sin, smoothstep, mix, abs, step,
} from 'three/tsl';
import { GLOBAL_TINT } from './dayNight.js';

// The motion layer that makes the meadow alive at EVERY distance: gusts of
// wind sweep across the field as traveling bands of warm light, and huge slow
// cloud shadows drift over the land. Rendered as a transparent overlay on the
// terrain geometry, masked to grass (no shimmer on dirt, sand, or lakes).
export function createWindOverlay(scene, terrainGeometry, colorTexture, fog) {
  const uTime = uniform(0);
  const uTint = uniform(GLOBAL_TINT.value);
  const uFogNear = uniform(fog.near);
  const uFogFar = uniform(fog.far);

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
  });

  const mask = texture(colorTexture, uv()).a;
  const p = positionWorld.xz;

  // Wind gusts: bands of sunlit grass racing across the meadow.
  const w1 = sin(dot(p, vec2(0.045, 0.030)).sub(uTime.mul(1.3)));
  const w2 = sin(dot(p, vec2(-0.023, 0.050)).sub(uTime.mul(0.8)).add(1.7));
  const gust = smoothstep(0.5, 1.4, w1.mul(0.6).add(w2.mul(0.4)));

  // Cloud shadows: 300m+ soft patches drifting slowly (constants must match
  // the grass fragment).
  const c1 = sin(dot(p, vec2(0.0060, 0.0042)).sub(uTime.mul(0.10)));
  const c2 = sin(dot(p, vec2(-0.0035, 0.0065)).sub(uTime.mul(0.07)).add(2.9));
  const cloud = smoothstep(0.35, 1.1, c1.mul(0.7).add(c2.mul(0.5)));

  const net = gust.mul(0.55).sub(cloud.mul(0.8));
  const tint = mix(vec3(0.10, 0.18, 0.26), vec3(1.0, 0.98, 0.72), step(0.0, net));
  // Wind light-bands dim with the day (moonlit gusts are subtle).
  const dayLum = uTint.r.add(uTint.g).add(uTint.b).div(3.0);
  const fogDepth = positionView.z.negate();
  let alpha = abs(net).mul(0.17).mul(mask).mul(float(0.25).add(dayLum.mul(0.75)));
  alpha = alpha.mul(float(1.0).sub(smoothstep(uFogNear, uFogFar, fogDepth)));

  mat.colorNode = tint;
  mat.opacityNode = alpha;

  const mesh = new THREE.Mesh(terrainGeometry, mat);
  mesh.position.y = 0.14; // float just above the ground paint
  scene.add(mesh);

  return {
    update(time) {
      uTime.value = time;
      uFogFar.value = fog.far;
    },
  };
}

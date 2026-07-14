import * as THREE from 'three';
import { GLOBAL_TINT } from './dayNight.js';

// The motion layer that makes the meadow alive at EVERY distance: gusts of
// wind sweep across the field as traveling bands of warm light, and huge slow
// cloud shadows drift over the land. Rendered as a transparent overlay on the
// terrain geometry, masked to grass (no shimmer on dirt, sand, or lakes).
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vFogDepth;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uColorMap;
  uniform float uTime;
  uniform vec3 uTint;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vFogDepth;

  void main() {
    float mask = texture2D(uColorMap, vUv).a;
    vec2 p = vWorld.xz;

    // Wind gusts: bands of sunlit grass racing across the meadow.
    float w1 = sin(dot(p, vec2(0.045, 0.030)) - uTime * 1.3);
    float w2 = sin(dot(p, vec2(-0.023, 0.050)) - uTime * 0.8 + 1.7);
    float gust = smoothstep(0.5, 1.4, w1 * 0.6 + w2 * 0.4);

    // Cloud shadows: 300m+ soft patches drifting slowly.
    float c1 = sin(dot(p, vec2(0.0060, 0.0042)) - uTime * 0.10);
    float c2 = sin(dot(p, vec2(-0.0035, 0.0065)) - uTime * 0.07 + 2.9);
    float cloud = smoothstep(0.35, 1.1, c1 * 0.7 + c2 * 0.5);

    float net = gust * 0.55 - cloud * 0.8;
    vec3 tint = net > 0.0 ? vec3(1.0, 0.98, 0.72) : vec3(0.10, 0.18, 0.26);
    // Wind light-bands dim with the day (moonlit gusts are subtle).
    float dayLum = (uTint.r + uTint.g + uTint.b) / 3.0;
    float alpha = abs(net) * 0.17 * mask * (0.25 + 0.75 * dayLum);
    alpha *= 1.0 - smoothstep(uFogNear, uFogFar, vFogDepth);

    gl_FragColor = vec4(tint, alpha);
    #include <colorspace_fragment>
  }
`;

export function createWindOverlay(scene, terrainGeometry, colorTexture, fog) {
  const uniforms = {
    uColorMap: { value: colorTexture },
    uTime: { value: 0 },
    uTint: GLOBAL_TINT,
    uFogNear: { value: fog.near },
    uFogFar: { value: fog.far },
  };
  const mesh = new THREE.Mesh(
    terrainGeometry,
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      depthWrite: false,
    })
  );
  mesh.position.y = 0.14; // float just above the ground paint
  scene.add(mesh);

  return {
    update(time) {
      uniforms.uTime.value = time;
    },
  };
}

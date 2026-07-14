import * as THREE from 'three';
import { TERRAIN_SIZE } from './terrain.js';
import { makeRand } from './rng.js';

// Instanced grass meadow. Blades live on a fixed world grid inside a square
// "patch"; the vertex shader wraps each blade around the drone (mod trick),
// so the same instances recycle forever — an infinite meadow per draw call.
//
// The Ghibli trick: blades take their ROOT color from the same baked ground
// texture the terrain uses, so near-field blades dissolve seamlessly into the
// painted carpet at distance. Wind is a traveling wave that both bends blades
// AND brightens their tips — you see gusts sweep across the field as light.
const BLADE_COUNT = 110000;
const FLOWER_COUNT = 2600;
const PATCH_SIZE = 150;
const FADE_START = PATCH_SIZE / 2 - 26;
const FADE_END = PATCH_SIZE / 2 - 5;

const common = /* glsl */ `
  uniform sampler2D uHeightMap;
  uniform sampler2D uColorMap;
  uniform vec2 uCenter;   // drone xz — patch center AND downwash source
  uniform float uDroneY;
  uniform float uWash;    // throttle² — how hard the props are working
  uniform float uTime;
  varying float vFogDepth;

  vec2 wrapAround(vec2 offset) {
    float halfPatch = ${(PATCH_SIZE / 2).toFixed(1)};
    return mod(offset - uCenter + halfPatch, ${PATCH_SIZE.toFixed(1)}) - halfPatch + uCenter;
  }

  vec2 groundUv(vec2 world) {
    return (world + ${(TERRAIN_SIZE / 2).toFixed(1)}) / ${TERRAIN_SIZE.toFixed(1)};
  }

  float edgeFade(vec2 wrapped) {
    return 1.0 - smoothstep(${FADE_START.toFixed(1)}, ${FADE_END.toFixed(1)},
      max(abs(wrapped.x - uCenter.x), abs(wrapped.y - uCenter.y)));
  }

  // Two traveling waves — the wind you can SEE crossing the meadow.
  float windAt(vec2 p) {
    float w1 = sin(dot(p, vec2(0.055, 0.038)) - uTime * 1.5);
    float w2 = sin(dot(p, vec2(-0.028, 0.061)) - uTime * 0.9 + 1.7);
    return w1 * 0.6 + w2 * 0.4;
  }
`;

const grassVertex = /* glsl */ `
  attribute vec2 aOffset;
  attribute float aScale;
  attribute float aRot;
  attribute float aTint;
  varying float vHeight;
  varying float vTint;
  varying float vSweep;
  varying vec3 vRoot;
  varying vec2 vWorldXZ;
  ${common}

  void main() {
    vec2 wrapped = wrapAround(aOffset);
    vec4 ground = texture2D(uColorMap, groundUv(wrapped));
    float scale = aScale * edgeFade(wrapped) * ground.a; // a = grass mask (bare on path)

    vHeight = position.y;
    vTint = aTint;
    vRoot = ground.rgb;
    vWorldXZ = wrapped;

    vec3 p = position;
    p.x *= mix(1.0, 0.14, p.y);
    float c = cos(aRot); float s = sin(aRot);
    p = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
    p *= scale;

    float wind = windAt(wrapped);
    vSweep = smoothstep(0.35, 1.15, wind);
    float bend = (0.10 + 0.22 * (wind * 0.5 + 0.5)) * vHeight * vHeight;
    p.x += bend * 0.85;
    p.z += bend * 0.5;

    float h = texture2D(uHeightMap, groundUv(wrapped)).r;

    // Prop downwash: blades blast radially outward under a low drone,
    // fluttering hard, tips catching light (matches the water wash).
    float distD = distance(wrapped, uCenter);
    float agl = uDroneY - h;
    float wash = uWash * clamp(1.0 - (agl - 1.0) / 8.0, 0.0, 1.0) * smoothstep(6.5, 0.9, distD);
    if (wash > 0.005) {
      vec2 dir = distD > 0.25 ? (wrapped - uCenter) / distD : vec2(1.0, 0.0);
      float flutter = 0.7 + 0.3 * sin(uTime * 22.0 + wrapped.x * 3.1 + wrapped.y * 2.7);
      float push = wash * flutter * 1.1 * vHeight * vHeight;
      p.x += dir.x * push;
      p.z += dir.y * push;
      p.y -= wash * vHeight * 0.38; // flattened under the blast
      vSweep = min(1.6, vSweep + wash * 1.2);
    }
    vec3 world = vec3(wrapped.x + p.x, h + p.y, wrapped.y + p.z);

    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const grassFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  varying float vHeight;
  varying float vTint;
  varying float vSweep;
  varying vec3 vRoot;
  varying vec2 vWorldXZ;
  varying float vFogDepth;

  void main() {
    // Root = exact ground color (slightly darkened for depth), tip = brighter
    // and warmer; a passing gust pushes tips toward sunlit chartreuse.
    float tip = vHeight * vHeight;
    vec3 col = vRoot * mix(0.80, 1.38, tip);
    col += vec3(0.055, 0.05, 0.005) * tip;
    col += vRoot * vSweep * tip * 0.45;
    col *= 0.93 + vTint * 0.14;

    // Same cloud shadows as the terrain overlay, so blades don't glow
    // inside a shadow patch (constants must match windOverlay.js).
    float c1 = sin(dot(vWorldXZ, vec2(0.0060, 0.0042)) - uTime * 0.10);
    float c2 = sin(dot(vWorldXZ, vec2(-0.0035, 0.0065)) - uTime * 0.07 + 2.9);
    float cloud = smoothstep(0.35, 1.1, c1 * 0.7 + c2 * 0.5);
    col = mix(col, col * vec3(0.72, 0.80, 0.88), cloud * 0.5);

    float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
    gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
    #include <colorspace_fragment>
  }
`;

const flowerVertex = /* glsl */ `
  attribute vec2 aOffset;
  attribute float aScale;
  attribute float aRot;
  attribute float aKind;
  varying float vKind;
  ${common}

  void main() {
    vec2 wrapped = wrapAround(aOffset);
    vec4 ground = texture2D(uColorMap, groundUv(wrapped));
    // Flowers grow in clumps, not everywhere, and fade out sooner than grass.
    float clump = smoothstep(0.15, 0.55,
      sin(wrapped.x * 0.113 + 3.7) * sin(wrapped.y * 0.087 + 1.3)
      + sin(wrapped.x * 0.041 - wrapped.y * 0.053) * 0.5);
    float fade = edgeFade(wrapped);
    float scale = aScale * fade * fade * ground.a * clump;
    vKind = aKind;

    vec3 p = position;
    float c = cos(aRot); float s = sin(aRot);
    p = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
    p *= scale;

    float wind = windAt(wrapped);
    p.x += wind * 0.06 * position.y;

    float h = texture2D(uHeightMap, groundUv(wrapped)).r;
    vec3 world = vec3(wrapped.x + p.x, h + p.y, wrapped.y + p.z);
    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const flowerFragment = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  varying float vKind;
  varying float vFogDepth;

  void main() {
    vec3 white = vec3(0.93, 0.94, 0.86);
    vec3 yellow = vec3(0.99, 0.80, 0.35);
    vec3 pink = vec3(0.96, 0.63, 0.68);
    vec3 col = vKind < 0.62 ? white : (vKind < 0.85 ? yellow : pink);
    float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
    gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
    #include <colorspace_fragment>
  }
`;

function bladeGeometry() {
  // Tapered AND gently arced — curved silhouettes read as soft meadow grass.
  const geo = new THREE.BufferGeometry();
  const w = 0.095;
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -w, 0, 0,   w, 0, 0,   -w * 0.7, 0.55, 0.05,   w * 0.7, 0.55, 0.05,   0, 1, 0.13,
  ]), 3));
  geo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  return geo;
}

function flowerGeometry() {
  // Two crossed quads — reads as a flower speck from any distance.
  const geo = new THREE.BufferGeometry();
  const w = 0.055;
  const h = 0.26;
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -w, h - 2 * w, 0,   w, h - 2 * w, 0,   -w, h, 0,   w, h, 0,
    0, h - 2 * w, -w,   0, h - 2 * w, w,   0, h, -w,   0, h, w,
  ]), 3));
  geo.setIndex([0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6]);
  return geo;
}

function instancedScatter(blade, count, rand, extra) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = blade.index;
  geo.setAttribute('position', blade.attributes.position);
  geo.instanceCount = count;

  const offsets = new Float32Array(count * 2);
  const scales = new Float32Array(count);
  const rots = new Float32Array(count);
  const extras = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    offsets[i * 2] = rand() * PATCH_SIZE;
    offsets[i * 2 + 1] = rand() * PATCH_SIZE;
    scales[i] = extra.scaleMin + rand() * extra.scaleRange;
    rots[i] = rand() * Math.PI * 2;
    extras[i] = rand();
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 2));
  geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 1));
  geo.setAttribute('aRot', new THREE.InstancedBufferAttribute(rots, 1));
  geo.setAttribute(extra.name, new THREE.InstancedBufferAttribute(extras, 1));
  return geo;
}

export function createGrass(scene, heightTexture, colorTexture, fog, worldSeed) {
  const uniforms = {
    uHeightMap: { value: heightTexture },
    uColorMap: { value: colorTexture },
    uCenter: { value: new THREE.Vector2() },
    uDroneY: { value: 0 },
    uWash: { value: 0 },
    uTime: { value: 0 },
    uFogColor: { value: fog.color },
    uFogNear: { value: fog.near },
    uFogFar: { value: fog.far },
  };

  const rand = makeRand(worldSeed ^ 0x51ab7);
  const grassMesh = new THREE.Mesh(
    instancedScatter(bladeGeometry(), BLADE_COUNT, rand, { name: 'aTint', scaleMin: 0.55, scaleRange: 0.7 }),
    new THREE.ShaderMaterial({
      vertexShader: grassVertex,
      fragmentShader: grassFragment,
      uniforms,
      side: THREE.DoubleSide,
    })
  );
  grassMesh.frustumCulled = false;
  scene.add(grassMesh);

  const flowerMesh = new THREE.Mesh(
    instancedScatter(flowerGeometry(), FLOWER_COUNT, rand, { name: 'aKind', scaleMin: 0.7, scaleRange: 0.6 }),
    new THREE.ShaderMaterial({
      vertexShader: flowerVertex,
      fragmentShader: flowerFragment,
      uniforms,
      side: THREE.DoubleSide,
    })
  );
  flowerMesh.frustumCulled = false;
  scene.add(flowerMesh);

  return {
    update(time, dronePos, throttle = 0) {
      uniforms.uTime.value = time;
      uniforms.uCenter.value.set(dronePos.x, dronePos.z);
      uniforms.uDroneY.value = dronePos.y;
      uniforms.uWash.value = throttle * throttle; // idle props barely stir it
    },
  };
}

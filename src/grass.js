import * as THREE from 'three/webgpu';
import {
  attribute, texture, uniform, varying, positionGeometry, positionView,
  vec2, vec3, float, dot, sin, cos, smoothstep, mix, abs, step, max, min,
  length, distance, clamp, Fn,
} from 'three/tsl';
import { TERRAIN_SIZE } from './terrain.js';
import { makeRand } from './rng.js';
import { GLOBAL_TINT } from './dayNight.js';

// Instanced grass meadow. Blades live on a fixed world grid inside a square
// "patch"; the vertex stage wraps each blade around the drone (mod trick),
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
  const uCenter = uniform(new THREE.Vector2());
  const uDroneY = uniform(0);
  const uWash = uniform(0);
  const uTime = uniform(0);
  const uTint = uniform(GLOBAL_TINT.value);
  const uFogColor = uniform(fog.color);
  const uFogNear = uniform(fog.near);
  const uFogFar = uniform(fog.far);

  const half = PATCH_SIZE / 2;
  const wrapAround = (offset) =>
    offset.sub(uCenter).add(half).mod(PATCH_SIZE).sub(half).add(uCenter);
  const groundUv = (world) => world.add(TERRAIN_SIZE / 2).div(TERRAIN_SIZE);
  const edgeFade = (wrapped) =>
    float(1.0).sub(smoothstep(FADE_START, FADE_END,
      max(abs(wrapped.x.sub(uCenter.x)), abs(wrapped.y.sub(uCenter.y)))));
  // Two traveling waves — the wind you can SEE crossing the meadow.
  const windAt = (p) =>
    sin(dot(p, vec2(0.055, 0.038)).sub(uTime.mul(1.5))).mul(0.6)
      .add(sin(dot(p, vec2(-0.028, 0.061)).sub(uTime.mul(0.9)).add(1.7)).mul(0.4));

  // ---- Grass blades -------------------------------------------------------
  const grassMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
  {
    const aOffset = attribute('aOffset', 'vec2');
    const aScale = attribute('aScale', 'float');
    const aRot = attribute('aRot', 'float');
    const aTint = attribute('aTint', 'float');

    const wrapped = wrapAround(aOffset);
    const ground = texture(colorTexture, groundUv(wrapped));
    const scale = aScale.mul(edgeFade(wrapped)).mul(ground.a); // a = grass mask

    const vHeight = positionGeometry.y;
    const wind = windAt(wrapped);

    grassMat.positionNode = Fn(() => {
      const p = positionGeometry.toVar();
      p.x.mulAssign(mix(1.0, 0.14, p.y));
      const c = cos(aRot);
      const s = sin(aRot);
      p.assign(vec3(p.x.mul(c).sub(p.z.mul(s)), p.y, p.x.mul(s).add(p.z.mul(c))));
      p.mulAssign(scale);

      const bend = wind.mul(0.5).add(0.5).mul(0.22).add(0.10).mul(vHeight).mul(vHeight);
      p.x.addAssign(bend.mul(0.85));
      p.z.addAssign(bend.mul(0.5));

      const h = texture(heightTexture, groundUv(wrapped)).r;

      // Prop downwash: blades blast radially outward under a low drone,
      // fluttering hard, tips catching light (matches the water wash).
      const distD = distance(wrapped, uCenter);
      const agl = uDroneY.sub(h);
      const wash = uWash.mul(clamp(float(1.0).sub(agl.sub(1.0).div(8.0)), 0.0, 1.0))
        .mul(smoothstep(6.5, 0.9, distD));
      const dir = wrapped.sub(uCenter).div(max(distD, 0.25));
      const flutter = sin(uTime.mul(22.0).add(wrapped.x.mul(3.1)).add(wrapped.y.mul(2.7)))
        .mul(0.3).add(0.7);
      const push = wash.mul(flutter).mul(1.1).mul(vHeight).mul(vHeight);
      p.x.addAssign(dir.x.mul(push));
      p.z.addAssign(dir.y.mul(push));
      p.y.subAssign(wash.mul(vHeight).mul(0.38)); // flattened under the blast

      return vec3(wrapped.x.add(p.x), h.add(p.y), wrapped.y.add(p.z));
    })();

    const distD = distance(wrapped, uCenter);
    const h = texture(heightTexture, groundUv(wrapped)).r;
    const wash = uWash.mul(clamp(float(1.0).sub(uDroneY.sub(h).sub(1.0).div(8.0)), 0.0, 1.0))
      .mul(smoothstep(6.5, 0.9, distD));
    const sweep = min(smoothstep(0.35, 1.15, wind).add(wash.mul(1.2)), 1.6);

    const vRoot = varying(ground.rgb);
    const vSweep = varying(sweep);
    const vTint = varying(aTint);
    const vH = varying(vHeight);
    const vWorldXZ = varying(wrapped);

    grassMat.colorNode = Fn(() => {
      // Root = exact ground color (slightly darkened for depth), tip =
      // brighter and warmer; a gust pushes tips toward sunlit chartreuse.
      const tip = vH.mul(vH);
      const col = vRoot.mul(mix(0.80, 1.38, tip)).toVar();
      col.addAssign(vec3(0.055, 0.05, 0.005).mul(tip));
      col.addAssign(vRoot.mul(vSweep).mul(tip).mul(0.45));
      col.mulAssign(vTint.mul(0.14).add(0.93));

      // Same cloud shadows as the terrain overlay, so blades don't glow
      // inside a shadow patch (constants must match windOverlay.js).
      const c1 = sin(dot(vWorldXZ, vec2(0.0060, 0.0042)).sub(uTime.mul(0.10)));
      const c2 = sin(dot(vWorldXZ, vec2(-0.0035, 0.0065)).sub(uTime.mul(0.07)).add(2.9));
      const cloud = smoothstep(0.35, 1.1, c1.mul(0.7).add(c2.mul(0.5)));
      const shaded = mix(col, col.mul(vec3(0.72, 0.80, 0.88)), cloud.mul(0.5)).mul(uTint);

      const fogF = smoothstep(uFogNear, uFogFar, positionView.z.negate());
      return mix(shaded, uFogColor, fogF);
    })();
  }

  const rand = makeRand(worldSeed ^ 0x51ab7);
  const grassMesh = new THREE.Mesh(
    instancedScatter(bladeGeometry(), BLADE_COUNT, rand, { name: 'aTint', scaleMin: 0.55, scaleRange: 0.7 }),
    grassMat
  );
  grassMesh.frustumCulled = false;
  scene.add(grassMesh);

  // ---- Flowers ------------------------------------------------------------
  const flowerMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
  {
    const aOffset = attribute('aOffset', 'vec2');
    const aScale = attribute('aScale', 'float');
    const aRot = attribute('aRot', 'float');
    const aKind = attribute('aKind', 'float');

    const wrapped = wrapAround(aOffset);
    const ground = texture(colorTexture, groundUv(wrapped));
    // Flowers grow in clumps, not everywhere, and fade out sooner than grass.
    const clump = smoothstep(0.15, 0.55,
      sin(wrapped.x.mul(0.113).add(3.7)).mul(sin(wrapped.y.mul(0.087).add(1.3)))
        .add(sin(wrapped.x.mul(0.041).sub(wrapped.y.mul(0.053))).mul(0.5)));
    const fade = edgeFade(wrapped);
    const scale = aScale.mul(fade).mul(fade).mul(ground.a).mul(clump);

    flowerMat.positionNode = Fn(() => {
      const p = positionGeometry.toVar();
      const c = cos(aRot);
      const s = sin(aRot);
      p.assign(vec3(p.x.mul(c).sub(p.z.mul(s)), p.y, p.x.mul(s).add(p.z.mul(c))));
      p.mulAssign(scale);
      p.x.addAssign(windAt(wrapped).mul(0.06).mul(positionGeometry.y));
      const h = texture(heightTexture, groundUv(wrapped)).r;
      return vec3(wrapped.x.add(p.x), h.add(p.y), wrapped.y.add(p.z));
    })();

    const vKind = varying(aKind);
    flowerMat.colorNode = Fn(() => {
      const col = mix(vec3(0.93, 0.94, 0.86), vec3(0.99, 0.80, 0.35), step(0.62, vKind)).toVar();
      col.assign(mix(col, vec3(0.96, 0.63, 0.68), step(0.85, vKind)));
      col.mulAssign(uTint);
      const fogF = smoothstep(uFogNear, uFogFar, positionView.z.negate());
      return mix(col, uFogColor, fogF);
    })();
  }

  const flowerMesh = new THREE.Mesh(
    instancedScatter(flowerGeometry(), FLOWER_COUNT, rand, { name: 'aKind', scaleMin: 0.7, scaleRange: 0.6 }),
    flowerMat
  );
  flowerMesh.frustumCulled = false;
  scene.add(flowerMesh);

  return {
    update(time, dronePos, throttle = 0) {
      uTime.value = time;
      uCenter.value.set(dronePos.x, dronePos.z);
      uDroneY.value = dronePos.y;
      uWash.value = throttle * throttle; // idle props barely stir it
      uFogFar.value = fog.far;
    },
  };
}

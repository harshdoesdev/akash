import * as THREE from 'three';
import { TERRAIN_SIZE, WATER_LEVEL } from './terrain.js';
import { GLOBAL_TINT } from './dayNight.js';

// Ghibli lakes: one still water plane at WATER_LEVEL — wherever the terrain
// dips below it, a lake appears. The shader samples the terrain heightmap to
// paint depth color and a white foam rim along the shoreline.
const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  varying float vFogDepth;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uHeightMap;
  uniform float uTime;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec2 uDroneXZ;
  uniform vec2 uDroneVel; // horizontal velocity — stretches the wash into a wake
  uniform float uWash; // 0..1 prop-wash intensity (low + throttled = strong)
  uniform vec3 uTint;
  varying vec3 vWorld;
  varying float vFogDepth;

  float hash(vec2 p) {
    p = mod(p, 289.0);
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 uv = (vWorld.xz + ${(TERRAIN_SIZE / 2).toFixed(1)}) / ${TERRAIN_SIZE.toFixed(1)};
    float ground = texture2D(uHeightMap, uv).r;
    float depth = ${WATER_LEVEL.toFixed(1)} - ground; // >0 under the lake

    // Deep cerulean → teal shallows.
    vec3 deep = vec3(0.12, 0.34, 0.50);
    vec3 shallow = vec3(0.40, 0.66, 0.66);
    vec3 col = mix(shallow, deep, smoothstep(0.3, 7.0, depth));

    // Slow drifting light bands — SUMS of skewed directional waves (a product
    // of axis-aligned sines makes a checkerboard; never do that).
    float b1 = sin(dot(vWorld.xz, vec2(0.021, 0.013)) + uTime * 0.4);
    float b2 = sin(dot(vWorld.xz, vec2(-0.011, 0.026)) - uTime * 0.3 + 2.1);
    float b3 = sin(dot(vWorld.xz, vec2(0.052, -0.037)) + uTime * 0.6 + 4.0);
    float band = b1 * 0.45 + b2 * 0.35 + b3 * 0.2;
    col += vec3(0.035, 0.05, 0.05) * smoothstep(0.1, 1.0, band);
    col -= vec3(0.03, 0.03, 0.02) * smoothstep(-0.2, -1.0, band);

    // Sparse twinkling glints: hash-scattered, one per ~1.4m cell, only a few
    // percent of cells lit, each with its own flicker phase. Fade with
    // distance so the far lake shimmers via bands instead of dot noise.
    vec2 sp = vWorld.xz * 0.7;
    vec2 cell = floor(sp);
    float rnd = hash(cell);
    vec2 jitter = vec2(hash(cell + 17.0), hash(cell + 43.0)) - 0.5;
    float d = length(fract(sp) - 0.5 + jitter * 0.55);
    float twinkle = 0.5 + 0.5 * sin(uTime * (1.5 + rnd * 3.0) + rnd * 40.0);
    float glint = smoothstep(0.16, 0.03, d) * step(0.94, rnd) * twinkle;
    glint *= 1.0 - smoothstep(60.0, 220.0, vFogDepth);
    col += vec3(0.8, 0.85, 0.8) * glint;

    // The washing shoreline: the waterline BREATHES — a foam edge slides up
    // the sand and retreats — and a fainter trailing line chases it back out.
    float wob = sin(vWorld.x * 0.6 + uTime * 1.1) * 0.1 + sin(vWorld.z * 0.83 - uTime * 0.8) * 0.1;
    float breathe = sin(uTime * 0.75 + wob * 5.0);
    float shoreline = 0.26 + breathe * 0.13;
    float foam = 1.0 - smoothstep(shoreline * 0.35, shoreline, depth + wob * 0.3);
    float lag = 0.6 + sin(uTime * 0.75 - 1.4 + wob * 5.0) * 0.16;
    foam = max(foam, (1.0 - smoothstep(0.03, 0.16, abs(depth - lag))) * 0.35);
    col = mix(col, vec3(0.94, 0.97, 0.95), foam * 0.9);

    // Prop wash: ripple rings under the drone. When moving, the pattern
    // trails behind and stretches along the flight path — a wake, not a ring.
    if (uWash > 0.01) {
      vec2 rel = vWorld.xz - uDroneXZ;
      float vlen = length(uDroneVel);
      float dw;
      if (vlen > 0.8) {
        vec2 dir = uDroneVel / vlen;
        float squeeze = min(vlen / 18.0, 1.2);
        rel += dir * min(vlen * 0.14, 2.8);            // wake center trails behind
        float along = dot(rel, dir);
        float across = dot(rel, vec2(-dir.y, dir.x));
        dw = length(vec2(along / (1.0 + squeeze * 0.9), across)); // elongated
      } else {
        dw = length(rel);
      }
      float rings = sin(dw * 2.6 - uTime * 7.5) * 0.5 + 0.5;
      float ringMask = uWash * smoothstep(7.0, 2.0, dw) * smoothstep(0.2, 1.4, dw);
      col = mix(col, vec3(0.90, 0.96, 0.94), rings * ringMask * 0.5);
      col += vec3(0.08, 0.10, 0.10) * uWash * smoothstep(2.0, 0.2, dw); // churned center
    }

    col *= uTint; // day/night

    // Soft dissolve at zero depth — the fix for the hard cut-out edge where
    // the water plane slices the terrain mesh.
    float alpha = smoothstep(0.0, 0.2, depth + wob * 0.12);

    float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
    gl_FragColor = vec4(mix(col, uFogColor, fog), alpha);
    #include <colorspace_fragment>
  }
`;

export function createWater(scene, heightTexture, fog) {
  const uniforms = {
    uHeightMap: { value: heightTexture },
    uTime: { value: 0 },
    uFogColor: { value: fog.color },
    uFogNear: { value: fog.near },
    uFogFar: { value: fog.far },
    uDroneXZ: { value: new THREE.Vector2() },
    uDroneVel: { value: new THREE.Vector2() },
    uWash: { value: 0 },
    uTint: GLOBAL_TINT,
  };
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(TERRAIN_SIZE / 2, 48),
    new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = WATER_LEVEL;
  scene.add(mesh);

  // Spray: white droplets kicked up when skimming low over the surface.
  const SPRAY = 160;
  const positions = new Float32Array(SPRAY * 3);
  positions.fill(-9999);
  const velocities = new Float32Array(SPRAY * 3);
  const life = new Float32Array(SPRAY);
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // Soft round droplet sprite (default points are hard squares).
  const dotCanvas = document.createElement('canvas');
  dotCanvas.width = dotCanvas.height = 32;
  const dctx = dotCanvas.getContext('2d');
  const dg = dctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  dg.addColorStop(0, 'rgba(255,255,255,1)');
  dg.addColorStop(0.6, 'rgba(255,255,255,0.7)');
  dg.addColorStop(1, 'rgba(255,255,255,0)');
  dctx.fillStyle = dg;
  dctx.fillRect(0, 0, 32, 32);

  const spray = new THREE.Points(
    sprayGeo,
    new THREE.PointsMaterial({
      color: 0xeafaf2,
      size: 0.22,
      map: new THREE.CanvasTexture(dotCanvas),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    })
  );
  spray.frustumCulled = false;
  scene.add(spray);
  let cursor = 0;
  let washSmooth = 0;

  return {
    // droneInfo: {x, z, y, overWater, throttle}
    update(time, dt = 0, droneInfo) {
      uniforms.uTime.value = time;
      if (!droneInfo) return;

      const { x, z, y, vx = 0, vz = 0, overWater, throttle } = droneInfo;
      uniforms.uDroneVel.value.set(vx, vz);
      const aglWater = y - WATER_LEVEL;
      const washTarget = overWater
        ? THREE.MathUtils.clamp(1 - (aglWater - 2) / 9, 0, 1) * (0.35 + 0.65 * throttle)
        : 0;
      washSmooth += (washTarget - washSmooth) * Math.min(1, 6 * dt);
      uniforms.uWash.value = washSmooth;
      uniforms.uDroneXZ.value.set(x, z);

      // Spawn droplets when low and working hard.
      if (overWater && aglWater < 6 && washSmooth > 0.25) {
        const count = Math.round(washSmooth * 130 * dt);
        for (let s = 0; s < count; s++) {
          const i = cursor++ % SPRAY;
          const a = Math.random() * Math.PI * 2;
          const r = 0.4 + Math.random() * 1.1;
          positions[i * 3] = x + Math.cos(a) * r;
          positions[i * 3 + 1] = WATER_LEVEL + 0.05;
          positions[i * 3 + 2] = z + Math.sin(a) * r;
          const out = 1.6 + Math.random() * 2.4;
          // Droplets inherit some drone velocity so spray trails the flight path.
          velocities[i * 3] = Math.cos(a) * out + vx * 0.45;
          velocities[i * 3 + 1] = 1.4 + Math.random() * 2.2;
          velocities[i * 3 + 2] = Math.sin(a) * out + vz * 0.45;
          life[i] = 0.5 + Math.random() * 0.5;
        }
      }

      // Integrate live droplets.
      for (let i = 0; i < SPRAY; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        velocities[i * 3 + 1] -= 7 * dt;
        positions[i * 3] += velocities[i * 3] * dt;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
        if (life[i] <= 0 || positions[i * 3 + 1] < WATER_LEVEL) {
          positions[i * 3 + 1] = -9999;
          life[i] = 0;
        }
      }
      sprayGeo.attributes.position.needsUpdate = true;
    },
  };
}

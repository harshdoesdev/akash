import * as THREE from 'three/webgpu';
import {
  texture, uniform, positionWorld, positionView,
  vec2, vec3, float, dot, sin, smoothstep, mix, abs, step, length,
  fract, floor, min, max, Fn, If,
} from 'three/tsl';
import { TERRAIN_SIZE, WATER_LEVEL } from './terrain.js';
import { GLOBAL_TINT } from './dayNight.js';
import { createParticleCloud, makeDotTexture } from './particles.js';

// Ghibli lakes: one still water plane at WATER_LEVEL — wherever the terrain
// dips below it, a lake appears. The shader samples the terrain heightmap to
// paint depth color and a white foam rim along the shoreline.
export function createWater(scene, heightTexture, fog) {
  const uTime = uniform(0);
  const uDroneXZ = uniform(new THREE.Vector2());
  const uDroneVel = uniform(new THREE.Vector2());
  const uWash = uniform(0);
  const uTint = uniform(GLOBAL_TINT.value);
  const uFogColor = uniform(fog.color);
  const uFogNear = uniform(fog.near);
  const uFogFar = uniform(fog.far);

  const hash = Fn(([p]) => {
    const q = p.mod(289.0);
    return fract(sin(dot(q, vec2(127.1, 311.7))).mul(43758.5453));
  });

  // Shared bits (the node graph dedupes these between color and opacity).
  const fogDepth = positionView.z.negate();
  const uvT = positionWorld.xz.add(TERRAIN_SIZE / 2).div(TERRAIN_SIZE);
  const depth = float(WATER_LEVEL).sub(texture(heightTexture, uvT).r); // >0 under the lake
  const wob = sin(positionWorld.x.mul(0.6).add(uTime.mul(1.1))).mul(0.1)
    .add(sin(positionWorld.z.mul(0.83).sub(uTime.mul(0.8))).mul(0.1));

  const colorNode = Fn(() => {
    const world = positionWorld;

    // Deep cerulean → teal shallows.
    const col = mix(vec3(0.40, 0.66, 0.66), vec3(0.12, 0.34, 0.50),
      smoothstep(0.3, 7.0, depth)).toVar();

    // Slow drifting light bands — SUMS of skewed directional waves (a product
    // of axis-aligned sines makes a checkerboard; never do that).
    const b1 = sin(dot(world.xz, vec2(0.021, 0.013)).add(uTime.mul(0.4)));
    const b2 = sin(dot(world.xz, vec2(-0.011, 0.026)).sub(uTime.mul(0.3)).add(2.1));
    const b3 = sin(dot(world.xz, vec2(0.052, -0.037)).add(uTime.mul(0.6)).add(4.0));
    const band = b1.mul(0.45).add(b2.mul(0.35)).add(b3.mul(0.2));
    col.addAssign(vec3(0.035, 0.05, 0.05).mul(smoothstep(0.1, 1.0, band)));
    col.subAssign(vec3(0.03, 0.03, 0.02).mul(smoothstep(-0.2, -1.0, band)));

    // Sparse twinkling glints: hash-scattered, one per ~1.4m cell, only a few
    // percent of cells lit, each with its own flicker phase. Fade with
    // distance so the far lake shimmers via bands instead of dot noise.
    const sp = world.xz.mul(0.7);
    const cell = floor(sp);
    const rnd = hash(cell);
    const jitter = vec2(hash(cell.add(17.0)), hash(cell.add(43.0))).sub(0.5);
    const d = length(fract(sp).sub(0.5).add(jitter.mul(0.55)));
    const twinkle = sin(uTime.mul(rnd.mul(3.0).add(1.5)).add(rnd.mul(40.0))).mul(0.5).add(0.5);
    const glint = smoothstep(0.16, 0.03, d).mul(step(0.94, rnd)).mul(twinkle)
      .mul(float(1.0).sub(smoothstep(60.0, 220.0, fogDepth)));
    col.addAssign(vec3(0.8, 0.85, 0.8).mul(glint));

    // The washing shoreline: the waterline BREATHES — a foam edge slides up
    // the sand and retreats — and a fainter trailing line chases it back out.
    const breathe = sin(uTime.mul(0.75).add(wob.mul(5.0)));
    const shoreline = breathe.mul(0.13).add(0.26);
    const foamA = float(1.0).sub(smoothstep(shoreline.mul(0.35), shoreline, depth.add(wob.mul(0.3))));
    const lag = sin(uTime.mul(0.75).sub(1.4).add(wob.mul(5.0))).mul(0.16).add(0.6);
    const foamB = float(1.0).sub(smoothstep(0.03, 0.16, abs(depth.sub(lag)))).mul(0.35);
    col.assign(mix(col, vec3(0.94, 0.97, 0.95), max(foamA, foamB).mul(0.9)));

    // Prop wash: ripple rings under the drone. When moving, the pattern
    // trails behind and stretches along the flight path — a wake, not a ring.
    If(uWash.greaterThan(0.01), () => {
      const rel = world.xz.sub(uDroneXZ).toVar();
      const vlen = length(uDroneVel);
      const dw = length(rel).toVar();
      If(vlen.greaterThan(0.8), () => {
        const dir = uDroneVel.div(vlen);
        const squeeze = min(vlen.div(18.0), 1.2);
        rel.addAssign(dir.mul(min(vlen.mul(0.14), 2.8))); // wake center trails behind
        const along = dot(rel, dir);
        const across = dot(rel, vec2(dir.y.negate(), dir.x));
        dw.assign(length(vec2(along.div(squeeze.mul(0.9).add(1.0)), across))); // elongated
      });
      const rings = sin(dw.mul(2.6).sub(uTime.mul(7.5))).mul(0.5).add(0.5);
      const ringMask = uWash.mul(smoothstep(7.0, 2.0, dw)).mul(smoothstep(0.2, 1.4, dw));
      col.assign(mix(col, vec3(0.90, 0.96, 0.94), rings.mul(ringMask).mul(0.5)));
      col.addAssign(vec3(0.08, 0.10, 0.10).mul(uWash).mul(smoothstep(2.0, 0.2, dw))); // churned center
    });

    col.mulAssign(uTint); // day/night
    return mix(col, uFogColor, smoothstep(uFogNear, uFogFar, fogDepth));
  })();

  // Soft dissolve at zero depth — the fix for the hard cut-out edge where
  // the water plane slices the terrain mesh.
  const opacityNode = smoothstep(0.0, 0.2, depth.add(wob.mul(0.12)));

  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, fog: false });
  mat.colorNode = colorNode;
  mat.opacityNode = opacityNode;

  const mesh = new THREE.Mesh(new THREE.CircleGeometry(TERRAIN_SIZE / 2, 48), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = WATER_LEVEL;
  scene.add(mesh);

  // Spray: white droplets kicked up when skimming low over the surface.
  const SPRAY = 160;
  const cloud = createParticleCloud(scene, {
    count: SPRAY,
    map: makeDotTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.6, 'rgba(255,255,255,0.7)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
    size: 0.22,
    color: 0xeafaf2,
    opacity: 0.85,
  });
  const positions = cloud.positions;
  const velocities = new Float32Array(SPRAY * 3);
  const life = new Float32Array(SPRAY);
  let cursor = 0;
  let washSmooth = 0;

  return {
    // droneInfo: {x, z, y, overWater, throttle}
    update(time, dt = 0, droneInfo) {
      uTime.value = time;
      uFogFar.value = fog.far;
      if (!droneInfo) return;

      const { x, z, y, vx = 0, vz = 0, overWater, throttle } = droneInfo;
      uDroneVel.value.set(vx, vz);
      const aglWater = y - WATER_LEVEL;
      const washTarget = overWater
        ? THREE.MathUtils.clamp(1 - (aglWater - 2) / 9, 0, 1) * (0.35 + 0.65 * throttle)
        : 0;
      washSmooth += (washTarget - washSmooth) * Math.min(1, 6 * dt);
      uWash.value = washSmooth;
      uDroneXZ.value.set(x, z);

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
      cloud.commit();
    },
  };
}

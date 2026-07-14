import * as THREE from 'three';
import { distToPath, WATER_LEVEL } from './terrain.js';
import { GLOBAL_TINT } from './dayNight.js';

// Prop-wash dust: tan puffs billow out when the drone hovers low over bare
// ground — beach sand or the dirt path. Heavy drag so the cloud hangs and
// drifts rather than raining down like the water spray.
const COUNT = 120;

export function createDust(scene, heightAt) {
  const dot = document.createElement('canvas');
  dot.width = dot.height = 48;
  const ctx = dot.getContext('2d');
  const g = ctx.createRadialGradient(24, 24, 0, 24, 24, 24);
  g.addColorStop(0, 'rgba(224,204,164,0.55)');
  g.addColorStop(0.6, 'rgba(224,204,164,0.28)');
  g.addColorStop(1, 'rgba(224,204,164,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 48, 48);

  const positions = new Float32Array(COUNT * 3);
  positions.fill(-9999);
  const velocities = new Float32Array(COUNT * 3);
  const life = new Float32Array(COUNT);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.55,
    map: new THREE.CanvasTexture(dot),
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  let cursor = 0;

  return {
    update(dt, { x, z, y, throttle }) {
      // Day/night: dust dims with the world.
      mat.color.copy(GLOBAL_TINT.value);

      const h = heightAt(x, z);
      const beach = h > WATER_LEVEL + 0.05 && h < WATER_LEVEL + 2.4;
      const path = distToPath(x, z) < 2.6 && h > WATER_LEVEL + 0.8;
      const agl = y - h;
      const strength = (beach || path) && agl < 7
        ? THREE.MathUtils.clamp(1 - (agl - 1.5) / 5.5, 0, 1) * throttle * throttle
        : 0;

      if (strength > 0.15) {
        const want = strength * 80 * dt;
        const count = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
        for (let s = 0; s < count; s++) {
          const i = cursor++ % COUNT;
          const a = Math.random() * Math.PI * 2;
          const r = 0.5 + Math.random() * 1.2;
          positions[i * 3] = x + Math.cos(a) * r;
          positions[i * 3 + 1] = h + 0.15;
          positions[i * 3 + 2] = z + Math.sin(a) * r;
          const out = 1.2 + Math.random() * 1.8;
          velocities[i * 3] = Math.cos(a) * out;
          velocities[i * 3 + 1] = 0.4 + Math.random() * 0.8;
          velocities[i * 3 + 2] = Math.sin(a) * out;
          life[i] = 0.7 + Math.random() * 0.7;
        }
      }

      const drag = Math.exp(-1.6 * dt);
      for (let i = 0; i < COUNT; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        velocities[i * 3] *= drag;
        velocities[i * 3 + 1] = velocities[i * 3 + 1] * drag - 0.5 * dt;
        velocities[i * 3 + 2] *= drag;
        positions[i * 3] += velocities[i * 3] * dt;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
        const ground = heightAt(positions[i * 3], positions[i * 3 + 2]) + 0.08;
        if (positions[i * 3 + 1] < ground) positions[i * 3 + 1] = ground; // roll along
        if (life[i] <= 0) positions[i * 3 + 1] = -9999;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

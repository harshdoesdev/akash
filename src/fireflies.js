import { createParticleCloud, makeDotTexture } from './particles.js';

// Fireflies: soft glowing billboards wandering low over the meadow around
// the drone. Only visible at night — the Ghibli reward for the cycle.
const COUNT = 90;

export function createFireflies(scene, heightAt) {
  const cloud = createParticleCloud(scene, {
    count: COUNT,
    map: makeDotTexture([
      [0, 'rgba(255,255,220,1)'],
      [0.4, 'rgba(220,255,160,0.6)'],
      [1, 'rgba(220,255,160,0)'],
    ]),
    size: 0.22,
    color: 0xe8ffb8,
    opacity: 0,
    additive: true,
  });
  const positions = cloud.positions;
  const seeds = [];
  for (let i = 0; i < COUNT; i++) {
    seeds.push({ x: 0, z: 0, phase: Math.random() * 20, drift: Math.random() * Math.PI * 2, placed: false });
  }

  return {
    update(dt, time, dronePos, night) {
      cloud.uOpacity.value = Math.max(0, night - 0.15) * 1.1;
      if (cloud.uOpacity.value <= 0.01) return;

      for (let i = 0; i < COUNT; i++) {
        const s = seeds[i];
        const dx = s.x - dronePos.x;
        const dz = s.z - dronePos.z;
        if (!s.placed || dx * dx + dz * dz > 3600) {
          // (Re)spawn within 60m of the drone.
          const a = Math.random() * Math.PI * 2;
          const r = 8 + Math.random() * 50;
          s.x = dronePos.x + Math.cos(a) * r;
          s.z = dronePos.z + Math.sin(a) * r;
          s.placed = true;
        }
        s.drift += (Math.random() - 0.5) * dt * 2;
        s.x += Math.cos(s.drift) * dt * 0.5;
        s.z += Math.sin(s.drift) * dt * 0.5;
        positions[i * 3] = s.x;
        // Bob and glow; blink by parking below the world.
        const bob = Math.sin(time * 0.9 + s.phase) * 0.35;
        const blink = Math.sin(time * 1.7 + s.phase * 3.1) > -0.6 ? 1 : 0;
        positions[i * 3 + 1] = blink
          ? heightAt(s.x, s.z) + 0.9 + bob
          : -9999;
        positions[i * 3 + 2] = s.z;
      }
      cloud.commit();
    },
  };
}

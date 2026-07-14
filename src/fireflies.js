import * as THREE from 'three';

// Fireflies: soft glowing points wandering low over the meadow around the
// drone. Only visible at night — the Ghibli reward for the day/night cycle.
const COUNT = 90;

export function createFireflies(scene, heightAt) {
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  const ctx = dot.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,220,1)');
  g.addColorStop(0.4, 'rgba(220,255,160,0.6)');
  g.addColorStop(1, 'rgba(220,255,160,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);

  const positions = new Float32Array(COUNT * 3);
  const seeds = [];
  for (let i = 0; i < COUNT; i++) {
    seeds.push({ x: 0, z: 0, phase: Math.random() * 20, drift: Math.random() * Math.PI * 2, placed: false });
    positions[i * 3 + 1] = -9999;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xe8ffb8,
    size: 0.22,
    map: new THREE.CanvasTexture(dot),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  return {
    update(dt, time, dronePos, night) {
      mat.opacity = Math.max(0, night - 0.15) * 1.1;
      if (mat.opacity <= 0.01) return;

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
        // Blink by dropping below ground occasionally? No — bob and glow.
        const bob = Math.sin(time * 0.9 + s.phase) * 0.35;
        const blink = Math.sin(time * 1.7 + s.phase * 3.1) > -0.6 ? 1 : 0;
        positions[i * 3 + 1] = blink
          ? heightAt(s.x, s.z) + 0.9 + bob
          : -9999;
        positions[i * 3 + 2] = s.z;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

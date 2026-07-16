import * as THREE from 'three';
import { buildDroneMesh } from './drone.js';

// Ghost drone: a translucent spirit copy of the player's drone that replays
// a recorded flight. Samples are a flat array [x, y, z, yaw, pitch, roll]
// at GHOST_HZ — the same wire format a future multiplayer peer would feed,
// so remote players later render through this exact component.
export const GHOST_HZ = 10;
export const GHOST_STRIDE = 6;

export function createGhost(scene) {
  const { group, props, discs } = buildDroneMesh();
  // Spirit treatment: translucent, cool-tinted, no shadows, no depth writes.
  const tint = new THREE.Color(0.84, 0.92, 1.0);
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    const m = o.material.clone();
    m.transparent = true;
    m.opacity = 0.3;
    m.depthWrite = false;
    m.color.multiply(tint);
    o.material = m;
  });
  for (const disc of discs) disc.material.opacity = 0.16;
  group.visible = false;
  scene.add(group);

  let data = null;
  let count = 0;

  const api = {
    active: false,

    start(samples) {
      if (!samples || samples.length < GHOST_STRIDE * 2) return;
      data = samples;
      count = Math.floor(samples.length / GHOST_STRIDE);
      group.visible = true;
      api.active = true;
      api.update(0, 0);
    },

    stop() {
      data = null;
      group.visible = false;
      api.active = false;
    },

    update(dt, time) {
      if (!api.active) return;
      const f = time * GHOST_HZ;
      if (f >= count - 1) {
        // The ghost crossed its finish line — it slips away.
        group.visible = false;
        return;
      }
      group.visible = true;
      const i = Math.floor(f);
      const a = f - i;
      const s0 = i * GHOST_STRIDE;
      const s1 = s0 + GHOST_STRIDE;
      group.position.set(
        data[s0] + (data[s1] - data[s0]) * a,
        data[s0 + 1] + (data[s1 + 1] - data[s0 + 1]) * a,
        data[s0 + 2] + (data[s1 + 2] - data[s0 + 2]) * a,
      );
      // Same composition as Drone.update: yaw → pitch → roll. Yaw is recorded
      // unwrapped (it accumulates), so a plain lerp is correct.
      const yaw = data[s0 + 3] + (data[s1 + 3] - data[s0 + 3]) * a;
      const pitch = data[s0 + 4] + (data[s1 + 4] - data[s0 + 4]) * a;
      const roll = data[s0 + 5] + (data[s1 + 5] - data[s0 + 5]) * a;
      group.rotation.set(0, 0, 0);
      group.rotateY(yaw);
      group.rotateX(-pitch);
      group.rotateZ(-roll);
      for (const [k, prop] of props.entries()) {
        prop.rotation.y += (k % 2 ? 1 : -1) * 55 * dt;
      }
    },
  };
  return api;
}

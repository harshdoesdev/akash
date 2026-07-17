import * as THREE from 'three';
import { buildDroneMesh } from './drone.js';

// Ghost drone: a translucent spirit copy of the player's drone. Two riders
// share it: race replays (createGhost) and live multiplayer peers
// (multiplayer.js). Samples are a flat array [x, y, z, yaw, pitch, roll]
// at GHOST_HZ — the replay recording and the multiplayer wire format are
// the same thing, deliberately.
export const GHOST_HZ = 10;
export const GHOST_STRIDE = 6;

// A spirit-treated drone mesh: translucent, cool-tinted, no shadows, no
// depth writes. setFade scales every material's opacity (0..1) so remote
// players can drift in and out without popping.
export function buildSpiritDrone(scene) {
  const { group, props, discs } = buildDroneMesh();
  const tint = new THREE.Color(0.84, 0.92, 1.0);
  const mats = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    const m = o.material.clone();
    m.transparent = true;
    m.opacity = 0.3;
    m.depthWrite = false;
    m.color.multiply(tint);
    o.material = m;
    mats.push(m);
  });
  for (const disc of discs) disc.material.opacity = 0.16;
  const baseOpacity = mats.map((m) => m.opacity);
  group.visible = false;
  scene.add(group);

  return {
    group,
    setFade(f) {
      for (let i = 0; i < mats.length; i++) mats[i].opacity = baseOpacity[i] * f;
    },
    setPose(x, y, z, yaw, pitch, roll) {
      group.position.set(x, y, z);
      // Same composition as Drone.update: yaw → pitch → roll.
      group.rotation.set(0, 0, 0);
      group.rotateY(yaw);
      group.rotateX(-pitch);
      group.rotateZ(-roll);
    },
    spinProps(dt) {
      for (const [k, prop] of props.entries()) {
        prop.rotation.y += (k % 2 ? 1 : -1) * 55 * dt;
      }
    },
    dispose() {
      scene.remove(group);
    },
  };
}

export function createGhost(scene) {
  const spirit = buildSpiritDrone(scene);
  const { group } = spirit;

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
      // Yaw is recorded unwrapped (it accumulates), so a plain lerp is correct.
      spirit.setPose(
        data[s0] + (data[s1] - data[s0]) * a,
        data[s0 + 1] + (data[s1 + 1] - data[s0 + 1]) * a,
        data[s0 + 2] + (data[s1 + 2] - data[s0 + 2]) * a,
        data[s0 + 3] + (data[s1 + 3] - data[s0 + 3]) * a,
        data[s0 + 4] + (data[s1 + 4] - data[s0 + 4]) * a,
        data[s0 + 5] + (data[s1 + 5] - data[s0 + 5]) * a,
      );
      spirit.spinProps(dt);
    },
  };
  return api;
}

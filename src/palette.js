import * as THREE from 'three';

// One place for the film's palette. Sky-at-horizon and fog MUST stay the same
// value — that identity is what dissolves the edge of the world.
export const PALETTE = {
  horizonFog: 0xd8e8d0, // pale warm haze: fog, sky horizon, terrain far-blend
  skyMid: 0x9fd2e8,     // luminous pale cyan band above the horizon (Shinkai)
  zenith: 0x2e6ac8,     // vivid azure overhead
  sunlight: 0xffeec2,
  ridges: [0xa6c193, 0xbfd6b6, 0xd4e4cf], // aerial perspective, near → far
};

export const SUN_DIR = new THREE.Vector3(0.55, 0.75, 0.35).normalize();

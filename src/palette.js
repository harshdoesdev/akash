import * as THREE from 'three';

// One place for the film's palette. Sky-at-horizon and fog MUST stay the same
// value — that identity is what dissolves the edge of the world.
export const PALETTE = {
  // Matches the day sky panorama's horizon color (sampled from the center
  // row of public/sky-day.png — resample if it's regenerated): fog, terrain
  // far-blend, and ground skirt all dissolve into this pale haze.
  horizonFog: 0xd7e7cf,
  sunlight: 0xffeec2,
  ridges: [0xa6c193, 0xbfd6b6, 0xd4e4cf], // aerial perspective, near → far
};

export const SUN_DIR = new THREE.Vector3(0.55, 0.75, 0.35).normalize();

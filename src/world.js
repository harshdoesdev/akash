import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SUN_DIR, PALETTE } from './palette.js';
import { makeRand } from './rng.js';
import { distToPath, WATER_LEVEL } from './terrain.js';
import { createForest } from './trees.js';

// World dressing: lights, the leaf-quad forest (trees.js), and rocks.
// Terrain/grass/sky live in their own modules.

function toonGradient() {
  const tex = new THREE.DataTexture(
    new Uint8Array([150, 200, 245, 255]), 4, 1, THREE.RedFormat
  );
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export function buildWorld(scene, heightAt, worldSeed) {
  const gradient = toonGradient();
  const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: gradient });

  const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x9db86a, 0.85);
  scene.add(hemi);

  const sunDirection = SUN_DIR.clone();
  const sun = new THREE.DirectionalLight(PALETTE.sunlight, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.002;
  scene.add(sun, sun.target);

  const forest = createForest(scene, heightAt, worldSeed);

  // Rocks: all 70 merged into one mesh — one draw call plus one shadow draw.
  const rand = makeRand(worldSeed ^ 0x50c4a7);
  const rockGeos = [];
  for (let i = 0; i < 70; i++) {
    const x = (rand() - 0.5) * 1600;
    const z = (rand() - 0.5) * 1600;
    const r = Math.hypot(x, z);
    const ry = heightAt(x, z);
    if (r < 25 || r > 780 || distToPath(x, z) < 3 || ry < WATER_LEVEL + 0.6) continue;
    const s = 0.5 + rand() * 1.8;
    const geo = new THREE.IcosahedronGeometry(s, 0);
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, ry + s * 0.35, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * Math.PI, rand() * Math.PI, 0)),
      new THREE.Vector3(1, 1, 1)
    ));
    rockGeos.push(geo);
  }
  if (rockGeos.length) {
    const rocks = new THREE.Mesh(mergeGeometries(rockGeos), toon(0x9a958a));
    rocks.castShadow = true;
    scene.add(rocks);
  }

  return {
    sun,
    hemi,
    sunDirection,
    colliders: forest.colliders,
    update(time, dronePos, washPower) {
      forest.update(time, dronePos, washPower);
    },
  };
}

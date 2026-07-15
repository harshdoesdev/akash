import * as THREE from 'three';
import { readInput } from './input.js';
import { Drone } from './drone.js';
import { initWorldGen, buildTerrain, WATER_LEVEL } from './terrain.js';
import { createWater } from './water.js';
import { createWindOverlay } from './windOverlay.js';
import { createAudio } from './audio.js';
import { createPostFX } from './postfx.js';
import { createCritters } from './critters.js';
import { createDayNight } from './dayNight.js';
import { createFireflies } from './fireflies.js';
import { createDust } from './dust.js';
import { hashSeed } from './rng.js';
import { createGrass } from './grass.js';
import { createSky } from './sky.js';
import { buildWorld } from './world.js';
import { ChaseCamera } from './chaseCamera.js';
import { PALETTE } from './palette.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
// 1.75 max: retina 2x costs ~30% more fragments than the painterly style
// can justify; the adaptive stepper below still trades further down.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

// World seed: ?seed=... in the URL. No seed → roll one and pin it in the URL
// so refresh keeps the world and sharing the link shares the world.
const params = new URLSearchParams(location.search);
let seedStr = params.get('seed');
if (!seedStr) {
  seedStr = Math.random().toString(36).slice(2, 8);
  params.set('seed', seedStr);
  history.replaceState(null, '', `?${params}`);
}
const worldSeed = hashSeed(seedStr);
initWorldGen(worldSeed);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PALETTE.horizonFog, 130, 620);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2400);

const terrain = buildTerrain(scene);
const world = buildWorld(scene, terrain.heightAt, worldSeed);
const { sun, sunDirection } = world;
const grass = createGrass(scene, terrain.heightTexture, terrain.colorTexture, scene.fog, worldSeed);
const sky = createSky(scene, sunDirection, worldSeed);
const water = createWater(scene, terrain.heightTexture, scene.fog);
const windOverlay = createWindOverlay(scene, terrain.mesh.geometry, terrain.colorTexture, scene.fog);
const audio = createAudio();

// Drone and camera treat the lake surface as ground — no diving.
const surfaceAt = (x, z) => Math.max(terrain.heightAt(x, z), WATER_LEVEL);
const drone = new Drone(scene, surfaceAt, world.colliders);
const chaseCam = new ChaseCamera(camera, surfaceAt);
const composer = createPostFX(renderer, scene, camera);
const critters = createCritters(scene, terrain.heightAt, world.colliders, worldSeed);
const dayNight = createDayNight({
  fog: scene.fog,
  sun: world.sun,
  hemi: world.hemi,
  skyUniforms: sky.skyUniforms,
  ridges: sky.ridgeMats,
  skirtMat: sky.skirtMat,
  terrainMat: terrain.mesh.material,
});
const fireflies = createFireflies(scene, terrain.heightAt);
const dust = createDust(scene, terrain.heightAt);
window.drone = drone; // dev: live tuning/inspection from the console
window.renderer = renderer;
window.surfaceAt = surfaceAt;
window.critters = critters;
window.sky = sky;

const hud = document.getElementById('hud');
document.getElementById('controls').insertAdjacentText('beforeend', `  ·  world: ${seedStr}`);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
let hudTimer = 0;
let fpsFrames = 0;
let fpsTime = 0;
let fpsValue = 0;

// Adaptive resolution: if the frame rate sags, step the pixel ratio down —
// the painterly style hides the softness far better than it hides stutter.
let pixelScale = Math.min(window.devicePixelRatio, 1.75);
function applyPixelScale(p) {
  pixelScale = p;
  renderer.setPixelRatio(p);
  composer.setPixelRatio(p);
  composer.setSize(window.innerWidth, window.innerHeight);
}
applyPixelScale(pixelScale);

renderer.setAnimationLoop(() => {
  // Clamp dt so a backgrounded tab doesn't launch the drone into orbit.
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const time = clock.elapsedTime;

  const input = readInput();
  drone.update(dt, input);
  chaseCam.update(dt, drone);
  grass.update(time, drone.position, drone.throttleVisual);
  sky.update(dt, drone.position);
  water.update(time, dt, {
    x: drone.position.x,
    z: drone.position.z,
    y: drone.position.y,
    vx: drone.velocity.x,
    vz: drone.velocity.z,
    overWater: terrain.heightAt(drone.position.x, drone.position.z) < WATER_LEVEL,
    throttle: drone.throttleVisual,
  });
  windOverlay.update(time);
  world.update(time);
  dayNight.update(dt);
  fireflies.update(dt, time, drone.position, dayNight.nightFactor);
  dust.update(dt, {
    x: drone.position.x,
    z: drone.position.z,
    y: drone.position.y,
    throttle: drone.throttleVisual,
  });
  critters.update(dt, time, drone.position,
    drone.position.y - surfaceAt(drone.position.x, drone.position.z));
  audio.update(dt, {
    speed: drone.speed,
    throttle: drone.throttleVisual,
    agl: drone.position.y - surfaceAt(drone.position.x, drone.position.z),
  });

  // Shadow camera follows the drone so shadows stay crisp anywhere on the map.
  sun.position.copy(drone.position).addScaledVector(sunDirection, 160);
  sun.target.position.copy(drone.position);

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fpsValue = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
    // Give the page a few seconds to settle, then trade pixels for frames.
    if (clock.elapsedTime > 4 && fpsValue > 0 && fpsValue < 45 && pixelScale > 1.0) {
      applyPixelScale(Math.max(1.0, pixelScale - 0.25));
    }
  }

  hudTimer += dt;
  if (hudTimer > 0.1) {
    hudTimer = 0;
    const kmh = (drone.speed * 3.6).toFixed(0);
    const agl = drone.position.y - surfaceAt(drone.position.x, drone.position.z);
    hud.textContent = `${kmh} km/h  ·  ${agl.toFixed(1)} m  ·  ${fpsValue} fps`;
  }

  composer.render();
});

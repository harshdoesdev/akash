import * as THREE from 'three/webgpu';
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
import { createWindLeaves } from './windLeaves.js';
import { hashSeed } from './rng.js';
import { createGrass } from './grass.js';
import { createSky } from './sky.js';
import { buildWorld } from './world.js';
import { ChaseCamera } from './chaseCamera.js';
import { PALETTE } from './palette.js';
import { loadAssets } from './assets.js';
import { createUI } from './ui.js';

// Boot: every asset loads before the world builds or the loop starts —
// nothing pops in late. The boot screen fades after the first real frame.
const bootEl = document.getElementById('boot');
const bootFill = document.getElementById('boot-fill');
await loadAssets((f) => {
  bootFill.style.transform = `scaleX(${f})`;
});
let bootDismissed = false;

// WebGPU where available; the same renderer transparently falls back to a
// WebGL2 backend on browsers without it. TSL materials compile to both.
const renderer = new THREE.WebGPURenderer({ antialias: false });
// 1.75 max: retina 2x costs ~30% more fragments than the painterly style
// can justify; the adaptive stepper below still trades further down.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
await renderer.init();
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
const windLeaves = createWindLeaves(scene, terrain.heightAt, world.colliders, scene.fog);
const ui = createUI({ audio, seedStr });
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
});

const clock = new THREE.Timer();
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
  renderer.setSize(window.innerWidth, window.innerHeight);
}
applyPixelScale(pixelScale);

// WebGPU never back-pressures the JS loop, so the fps number stays 60 while
// the GPU quietly runs over budget. Probe the truth: time how long queued
// GPU work takes to drain. High latency = GPU-bound = drop resolution.
const gpuProbe = { pending: false, lag: 0, frames: 0 };
function probeGpu() {
  const device = renderer.backend?.device;
  if (!device || gpuProbe.pending) return;
  gpuProbe.pending = true;
  const t0 = performance.now();
  device.queue.onSubmittedWorkDone().then(() => {
    gpuProbe.lag = performance.now() - t0;
    gpuProbe.pending = false;
  });
}

// Main-menu cinematic: a slow drift around the spawn meadow — the live
// world is the menu art.
const ZERO_INPUT = { pitch: 0, roll: 0, yaw: 0, climb: 0, reset: false };
let cineAngle = 0.6;
function cinematicCamera(dt) {
  cineAngle += dt * 0.035;
  const r = 46;
  const cx = Math.cos(cineAngle) * r;
  const cz = Math.sin(cineAngle) * r;
  const y = surfaceAt(cx, cz) + 16 + Math.sin(cineAngle * 2.3) * 2.5;
  camera.position.set(cx, y, cz);
  camera.lookAt(0, surfaceAt(0, 0) + 5, 0);
}

renderer.setAnimationLoop(() => {
  // Clamp dt so a backgrounded tab doesn't launch the drone into orbit.
  clock.update();
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const time = clock.getElapsed();

  // Menus: drone hovers unmanned, camera drifts. Paused keeps the chase cam.
  const playing = ui.state === 'playing';
  const input = playing ? readInput() : ZERO_INPUT;
  drone.update(dt, input);
  if (ui.cameraMode === 'chase') chaseCam.update(dt, drone);
  else cinematicCamera(dt);
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
  world.update(time, drone.position, drone.throttleVisual);
  windLeaves.update(dt, time, drone.position, drone.velocity, drone.throttleVisual);
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
    flying: playing, // menus: motor silent, wind calm
  });

  // Shadow camera follows the drone so shadows stay crisp anywhere on the map.
  sun.position.copy(drone.position).addScaledVector(sunDirection, 160);
  sun.target.position.copy(drone.position);

  fpsFrames++;
  fpsTime += dt;
  gpuProbe.frames++;
  if (gpuProbe.frames >= 20) {
    gpuProbe.frames = 0;
    probeGpu();
  }
  if (fpsTime >= 0.5) {
    fpsValue = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
    // Give the page a few seconds to settle, then trade pixels for frames —
    // triggered by real fps drops OR by GPU queue latency (the honest signal
    // on WebGPU, where rAF keeps ticking 60 while the GPU falls behind).
    if (clock.getElapsed() > 4 && pixelScale > 1.0
      && ((fpsValue > 0 && fpsValue < 45) || gpuProbe.lag > 26)) {
      applyPixelScale(Math.max(1.0, pixelScale - 0.25));
      gpuProbe.lag = 0; // re-measure at the new resolution before stepping again
    }
  }

  hudTimer += dt;
  if (hudTimer > 0.1) {
    hudTimer = 0;
    const kmh = (drone.speed * 3.6).toFixed(0);
    const agl = drone.position.y - surfaceAt(drone.position.x, drone.position.z);
    hud.textContent = `${kmh} km/h  ·  ${agl.toFixed(1)} m  ·  ${fpsValue} fps  ·  gpu ${gpuProbe.lag.toFixed(0)}ms`;
  }

  composer.render();

  if (!bootDismissed) {
    bootDismissed = true;
    bootEl.classList.add('boot-done');
    setTimeout(() => bootEl.remove(), 1000);
  }
});

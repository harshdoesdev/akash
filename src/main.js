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
import { createWindways } from './windways.js';
import { createRace } from './race.js';
import { createMultiplayer } from './multiplayer.js';
import { hashSeed } from './rng.js';
import { createGrass } from './grass.js';
import { createSky } from './sky.js';
import { buildWorld } from './world.js';
import { ChaseCamera } from './chaseCamera.js';
import { PALETTE } from './palette.js';
import { loadAssets } from './assets.js';
import { createUI } from './ui.js';
import { createTouchControls } from './touchControls.js';

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
// 1.75 max: retina 2x costs ~30% more fragments than the painterly style
// can justify; the adaptive stepper below still trades further down.
function makeRenderer(forceWebGL) {
  const r = new THREE.WebGPURenderer({ antialias: false, forceWebGL });
  r.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  r.setSize(window.innerWidth, window.innerHeight);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  return r;
}
let renderer = makeRenderer(false);
try {
  await renderer.init();
} catch {
  // iOS Safari can expose navigator.gpu yet fail adapter/device init —
  // rebuild on the WebGL2 backend instead of dying to a blank page.
  try { renderer.dispose(); } catch { /* half-initialized */ }
  renderer = makeRenderer(true);
  try {
    await renderer.init();
  } catch (err) {
    document.getElementById('boot-sub').textContent =
      'this browser could not start the game';
    throw err;
  }
}
document.getElementById('app').appendChild(renderer.domElement);

// World code: ?seed= in the URL wins, then the last-flown code (itch.io's
// iframe strips query params, so localStorage is what makes codes stick
// there), then a fresh roll. Always pinned back into the URL so refresh
// keeps the world and sharing the link shares the world.
const params = new URLSearchParams(location.search);
let seedStr = params.get('seed') || localStorage.getItem('akash.world.v1');
if (!seedStr) seedStr = Math.random().toString(36).slice(2, 8);
localStorage.setItem('akash.world.v1', seedStr);
params.set('seed', seedStr);
history.replaceState(null, '', `?${params}`);
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
const pilotColor = localStorage.getItem('akash.pilot.color');
const drone = new Drone(scene, surfaceAt, world.colliders, pilotColor);
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
const windways = createWindways(scene, terrain.heightAt, worldSeed);
// Freeroam presence: everyone flying this world code shares a sky.
const multiplayer = createMultiplayer(scene, seedStr, drone, () => ui.state === 'playing', camera);
const ui = createUI({ audio, seedStr, multiplayer, drone });
const race = createRace(scene, windways.list, drone, seedStr);
createTouchControls();
window.drone = drone; // dev: live tuning/inspection from the console
window.renderer = renderer;
window.surfaceAt = surfaceAt;
window.critters = critters;
window.sky = sky;
window.windways = windways;
window.race = race;
window.multiplayer = multiplayer;

const hud = document.getElementById('hud');
const onlineEl = document.getElementById('menu-online');
document.getElementById('controls').insertAdjacentText('beforeend', `  ·  world: ${seedStr}`);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Water proximity: a ring of terrain probes around the drone, refreshed a
// few times a second — drives the shore-lapping ambience.
let waterFrac = 0;
let waterProbeTimer = 0;
function probeWater() {
  const px = drone.position.x;
  const pz = drone.position.z;
  let hits = terrain.heightAt(px, pz) < WATER_LEVEL ? 1 : 0;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    if (terrain.heightAt(px + Math.cos(a) * 30, pz + Math.sin(a) * 30) < WATER_LEVEL) hits++;
  }
  waterFrac = hits / 13;
}

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
  windways.update(dt, time, drone, playing, camera.position);
  race.update(dt, time, playing, camera.position);
  multiplayer.update(dt);
  if (ui.cameraMode === 'chase') chaseCam.update(dt, drone);
  else cinematicCamera(dt);
  grass.update(time, drone.position, drone.throttleVisual);
  sky.update(dt, drone.position);
  const overWater = terrain.heightAt(drone.position.x, drone.position.z) < WATER_LEVEL;
  water.update(time, dt, {
    x: drone.position.x,
    z: drone.position.z,
    y: drone.position.y,
    vx: drone.velocity.x,
    vz: drone.velocity.z,
    overWater,
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
  waterProbeTimer -= dt;
  if (waterProbeTimer <= 0) {
    waterProbeTimer = 0.25;
    probeWater();
  }
  const waterH = drone.position.y - WATER_LEVEL;
  audio.update(dt, {
    speed: drone.speed,
    throttle: drone.throttleVisual,
    agl: drone.position.y - surfaceAt(drone.position.x, drone.position.z),
    flying: playing, // menus: motor silent, wind calm
    camDist: camera.position.distanceTo(drone.position),
    shore: waterFrac * Math.max(0, 1 - waterH / 35),
    overWater,
    waterH,
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
    if (clock.getElapsed() > 4 && pixelScale > 0.85
      && ((fpsValue > 0 && fpsValue < 45) || gpuProbe.lag > 26)) {
      applyPixelScale(Math.max(0.85, pixelScale - 0.25));
      gpuProbe.lag = 0; // re-measure at the new resolution before stepping again
    }
  }

  hudTimer += dt;
  if (hudTimer > 0.1) {
    hudTimer = 0;
    const kmh = (drone.speed * 3.6).toFixed(0);
    const agl = drone.position.y - surfaceAt(drone.position.x, drone.position.z);
    const others = multiplayer.count;
    const pilots = others ? `  ·  ${others} pilot${others > 1 ? 's' : ''}` : '';
    hud.textContent = `${kmh} km/h  ·  ${agl.toFixed(1)} m  ·  ${fpsValue} fps  ·  gpu ${gpuProbe.lag.toFixed(0)}ms${pilots}`;
    if (onlineEl) {
      onlineEl.textContent = others
        ? `${others} pilot${others > 1 ? 's' : ''} flying this sky with you`
        : '';
    }
  }

  composer.render();

  if (!bootDismissed) {
    bootDismissed = true;
    bootEl.classList.add('boot-done');
    setTimeout(() => bootEl.remove(), 1000);
  }
});

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm } from './noise.js';
import { makeRand } from './rng.js';
import { PALETTE } from './palette.js';

// Sky dome, sculptural cumulus clouds, layered haze ridges on the horizon,
// and a fog-colored ground skirt. Everything here follows the drone so the
// horizon is unreachable — the world never ends, it just dissolves.

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform float uNight;
  varying vec3 vDir;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }

  void main() {
    vec3 dir = normalize(vDir);
    float t = clamp(dir.y, 0.0, 1.0);
    // Shinkai three-stop: warm luminous horizon → pale cyan band → deep azure.
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, t));
    col = mix(col, uZenith, smoothstep(0.16, 0.72, t));
    float dayGlow = (1.0 - uNight);
    float sun = pow(max(dot(dir, uSunDir), 0.0), 120.0);
    float halo = pow(max(dot(dir, uSunDir), 0.0), 5.0);
    col += (vec3(1.0, 0.93, 0.72) * sun * 0.85 + vec3(1.0, 0.88, 0.6) * halo * 0.14) * dayGlow;

    if (uNight > 0.01) {
      // Stars: sparse hash grid over view direction, fading near the horizon.
      vec3 cell = floor(dir * 220.0);
      float s = step(0.9975, hash(cell));
      float mag = 0.4 + hash(cell + 7.0) * 0.6;
      col += vec3(0.85, 0.9, 1.0) * s * mag * uNight * smoothstep(0.04, 0.3, dir.y);
      // Moon: bright disc + soft halo.
      float m = max(dot(dir, uMoonDir), 0.0);
      col += (smoothstep(0.9993, 0.9997, m) * 0.9 + pow(m, 60.0) * 0.18) * vec3(0.92, 0.95, 1.0) * uNight;
    }

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

// Towering cumulus: blobs packed inside a tapering envelope with heavy
// vertical overlap — one solid cauliflower column, never a stack of discs.
function buildTower(rand) {
  const parts = [];
  const H = 42 + rand() * 20;
  const baseR = 17 + rand() * 8;
  let y = 0;
  while (y < H) {
    const t = y / H;
    const envR = baseR * (1 - t * 0.62) * (0.85 + rand() * 0.3);
    const n = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const r = envR * (0.5 + rand() * 0.3);
      const a = rand() * Math.PI * 2;
      const d = Math.max(0, envR - r) * rand();
      const blob = new THREE.SphereGeometry(r, 10, 8);
      blob.scale(1, 0.72 + rand() * 0.2, 1);
      blob.translate(Math.cos(a) * d, y + r * 0.25, Math.sin(a) * d);
      parts.push(blob);
    }
    y += envR * 0.45; // overlap strongly — no necking between levels
  }
  const geo = mergeGeometries(parts);
  geo.center();
  return geo;
}

// Cumulus: a cluster of squashed spheres, bottoms roughly aligned, merged
// into one geometry. Toon-shaded with a nearly-white ramp so tops glow and
// undersides go soft blue-gray.
function buildCloud(rand) {
  // One big heart blob with smaller ones packed around it — puffy, not sausage.
  const parts = [];
  const R = 12 + rand() * 6;
  const heart = new THREE.SphereGeometry(R, 10, 8);
  heart.scale(1.15, 0.62, 0.95);
  heart.translate(0, R * 0.3, 0);
  parts.push(heart);
  const blobCount = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < blobCount; i++) {
    const r = R * (0.4 + rand() * 0.45);
    const a = rand() * Math.PI * 2;
    const d = R * (0.7 + rand() * 0.5);
    const blob = new THREE.SphereGeometry(r, 10, 8);
    blob.scale(1, 0.6, 0.9);
    blob.translate(Math.cos(a) * d, r * 0.25 + rand() * R * 0.25, Math.sin(a) * d * 0.6);
    parts.push(blob);
  }
  const geo = mergeGeometries(parts);
  geo.center();
  return geo;
}

export function createSky(scene, sunDirection, worldSeed) {
  const horizon = new THREE.Color(PALETTE.horizonFog);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(880, 32, 16),
    new THREE.ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms: {
        uZenith: { value: new THREE.Color(PALETTE.zenith) },
        uMid: { value: new THREE.Color(PALETTE.skyMid) },
        uHorizon: { value: horizon },
        uSunDir: { value: sunDirection.clone().normalize() },
        uMoonDir: { value: new THREE.Vector3(-0.35, 0.55, 0.45).normalize() },
        uNight: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
    })
  );
  sky.frustumCulled = false;
  sky.renderOrder = -3;
  scene.add(sky);

  // Ground skirt: the world beyond the terrain, pure haze.
  const skirtMat = new THREE.MeshBasicMaterial({ color: horizon, fog: false });
  const skirt = new THREE.Mesh(new THREE.CircleGeometry(5000, 48), skirtMat);
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = -45; // below the deepest lake bed

  skirt.renderOrder = -2;
  scene.add(skirt);

  // Aerial perspective: three rings of hills, each farther, paler, taller.
  const follow = [skirt];
  const ridgeMats = [];
  // Beyond the real terrain (which ends ~1000m out), so they never clip it.
  const RIDGES = [
    { radius: 1150, base: 55, amp: 115, color: PALETTE.ridges[0], freq: 2.4, seed: 0 },
    { radius: 1420, base: 95, amp: 190, color: PALETTE.ridges[1], freq: 1.7, seed: 40 },
    { radius: 1750, base: 155, amp: 300, color: PALETTE.ridges[2], freq: 1.2, seed: 80 },
  ];
  for (const r of RIDGES) {
    const N = 128;
    const verts = new Float32Array((N + 1) * 2 * 3);
    const idx = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      const h = Math.max(r.base * 0.55, r.base + fbm(cx * r.freq + r.seed, cz * r.freq + r.seed, 3) * r.amp);
      verts.set([cx * r.radius, h, cz * r.radius], i * 6);
      verts.set([cx * r.radius, -60, cz * r.radius], i * 6 + 3);
      if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setIndex(idx);
    const ridgeMat = new THREE.MeshBasicMaterial({ color: r.color, fog: false, side: THREE.DoubleSide });
    const ridge = new THREE.Mesh(geo, ridgeMat);
    ridge.frustumCulled = false;
    ridge.renderOrder = -1;
    scene.add(ridge);
    follow.push(ridge);
    ridgeMats.push(ridgeMat);
  }

  // Clouds.
  const cloudRamp = new THREE.DataTexture(new Uint8Array([158, 216, 255]), 3, 1, THREE.RedFormat);
  cloudRamp.magFilter = THREE.NearestFilter;
  cloudRamp.minFilter = THREE.NearestFilter;
  cloudRamp.needsUpdate = true;

  const rand = makeRand(worldSeed ^ 0xc10d5);
  const clouds = [];
  const cloudMat = new THREE.MeshToonMaterial({
    color: 0xffffff,
    gradientMap: cloudRamp,
    fog: false,
    emissive: 0xd6e4f2, // cool fill so shadows go blue, not beige
    emissiveIntensity: 0.38,
  });
  // A band of cumulus on the horizon, a fleet overhead, and a few towering
  // cumulonimbus stacks — the Shinkai skyline.
  for (let i = 0; i < 21; i++) {
    const kind = i < 9 ? 'horizon' : i < 18 ? 'high' : 'tower';
    const geo = kind === 'tower' ? buildTower(rand) : buildCloud(rand);
    const cloud = new THREE.Mesh(geo, cloudMat);
    const s = kind === 'horizon' ? 2.6 + rand() * 2 : kind === 'high' ? 2 + rand() * 2.2 : 1.4 + rand() * 0.6;
    cloud.scale.setScalar(s);
    if (kind === 'high') {
      cloud.position.set((rand() - 0.5) * 1400, 130 + rand() * 120, (rand() - 0.5) * 1400);
    } else {
      const a = rand() * Math.PI * 2;
      const r = 880 + rand() * 320;
      cloud.position.set(Math.cos(a) * r, (kind === 'tower' ? 95 : 75) + rand() * 60, Math.sin(a) * r);
    }
    cloud.userData.speed = 1.5 + rand() * 2;
    scene.add(cloud);
    clouds.push(cloud);
  }

  return {
    skyUniforms: sky.material.uniforms,
    cloudMat,
    ridgeMats,
    skirtMat,
    clouds,
    update(dt, dronePos) {
      sky.position.set(dronePos.x, 0, dronePos.z);
      for (const obj of follow) obj.position.set(dronePos.x, obj.position.y, dronePos.z);
      for (const cloud of clouds) {
        cloud.position.x += cloud.userData.speed * dt;
        if (cloud.position.x - dronePos.x > 850) cloud.position.x -= 1700;
        if (cloud.position.x - dronePos.x < -850) cloud.position.x += 1700;
      }
    },
  };
}

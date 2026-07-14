import * as THREE from 'three';
import { fbm, valueNoise, initNoise } from './noise.js';
import { makeRand } from './rng.js';
import { SUN_DIR, PALETTE } from './palette.js';

export const TERRAIN_SIZE = 2000;
export const WORLD_RADIUS = 800; // soft gameplay boundary; mist beyond
export const WATER_LEVEL = -4.5; // lakes appear wherever terrain dips below
const SEGMENTS = 320;
const HEIGHT_TEX_SIZE = 512; // fine enough for foam to track the true shoreline
const COLOR_TEX_SIZE = 768;

// Rolling meadow hills. Flattened near the origin so the spawn pad /
// motorhome sit on level ground.
export function heightAt(x, z) {
  const rolling = fbm(x / 190, z / 190, 4) * 9;
  const broad = fbm(x / 520 + 40, z / 520 + 40, 2) * 14;
  const h = rolling + broad;
  const r = Math.hypot(x, z);
  const flatten = THREE.MathUtils.smoothstep(r, 16, 70);
  // Sink to zero at the map edge so the silhouette meets the haze skirt.
  const edge = 1 - THREE.MathUtils.smoothstep(r, 840, 990);
  return h * flatten * edge;
}

// ---- The dirt path: a lazy seeded meander from the motorhome outward.
let PATH_POINTS = [];

export function initWorldGen(seed) {
  initNoise(seed);
  const rand = makeRand(seed ^ 0x9e3779b9);
  const ang0 = rand() * Math.PI * 2;
  const turn = 1.7 + rand() * 1.0;
  const wobble = 0.1 + rand() * 0.12;
  PATH_POINTS = [];
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const ang = ang0 + t * turn + Math.sin(t * 9) * wobble;
    const r = 7 + 680 * Math.pow(t, 1.15);
    PATH_POINTS.push([Math.cos(ang) * r, Math.sin(ang) * r]);
  }
}

export function distToPath(x, z) {
  let best = Math.hypot(x, z) - 3.0; // spawn pad counts as "path"
  for (let i = 0; i < PATH_POINTS.length - 1; i++) {
    const [ax, az] = PATH_POINTS[i];
    const [bx, bz] = PATH_POINTS[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best) best = d;
  }
  return best;
}

// ---- Color math in plain sRGB arrays (deliberately NOT THREE.Color: we bake
// display-space bytes into an sRGB texture; Color would convert to linear).
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const GRASS_BASE = hex(0x6ea23e);   // fresh meadow green
const GRASS_LIGHT = hex(0x9cc957);  // sunlit chartreuse
const GRASS_DEEP = hex(0x568c34);   // lush hollows
const GRASS_WARM = hex(0xb0d162);   // sun-dried patches
const DIRT_A = hex(0xdbc89c);
const DIRT_B = hex(0xc7ae7f);
const SAND = hex(0xe6d6a8);
const LAKEBED = hex(0x497054);
const FOG = hex(PALETTE.horizonFog);

const smoothstep = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Ground look at (x, z), given precomputed sun lighting (0..1) and height.
// Returns sRGB color + grass-density mask (0 = bare, keep grass off).
function groundColorAt(x, z, light, h) {
  const m1 = valueNoise(x / 63 + 9, z / 63 + 9);
  const m2 = valueNoise(x / 21 + 99, z / 21 + 99);
  const warm = valueNoise(x / 150 + 55, z / 150 + 55);
  const dapple = valueNoise(x / 8.5 + 31, z / 8.5 + 31); // painterly stipple

  let col = mix(GRASS_BASE, GRASS_LIGHT, m1);
  col = mix(col, GRASS_DEEP, m2 * 0.5);
  col = mix(col, GRASS_WARM, smoothstep(0.5, 0.8, warm) * 0.65);
  // Brush-stroke dapples — the mottling that reads as painted grass from the air.
  col = mix(col, GRASS_LIGHT, smoothstep(0.62, 0.95, dapple) * 0.4);
  col = mix(col, GRASS_DEEP, smoothstep(0.34, 0.05, dapple) * 0.35);

  // Baked soft sunlight — the terrain and grass are otherwise unlit, which is
  // what keeps them perfectly matched in color.
  const shade = 0.62 + 0.46 * light;
  col = [col[0] * shade, col[1] * shade, col[2] * shade];

  // Dirt path + pad, painted into the ground (not under lakes).
  let grassMask = 1;
  if (h > WATER_LEVEL + 0.8) {
    const d = distToPath(x, z);
    grassMask = smoothstep(1.2, 2.6, d);
    const dirt = mix(DIRT_A, DIRT_B, m2);
    const dl = 0.82 + 0.22 * light;
    col = mix([dirt[0] * dl, dirt[1] * dl, dirt[2] * dl], col, grassMask);
  }

  // Lakeshore: sandy beach ring, dark bed below the waterline.
  const beach = 1 - smoothstep(WATER_LEVEL + 0.4, WATER_LEVEL + 2.4, h);
  if (beach > 0) {
    const sandLit = SAND.map((c) => c * (0.8 + 0.24 * light));
    col = mix(col, sandLit, beach);
    col = mix(col, LAKEBED, 1 - smoothstep(WATER_LEVEL - 2.5, WATER_LEVEL - 0.2, h));
  }
  grassMask *= smoothstep(WATER_LEVEL + 0.7, WATER_LEVEL + 2.2, h);

  // Dissolve into fog toward the map edge — no visible end of the world.
  col = mix(col, FOG, smoothstep(800, 980, Math.hypot(x, z)));

  return { col, grassMask };
}

export function buildTerrain(scene) {
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    // One uv convention everywhere: u←x, v←z (grass shader uses the same).
    uv.setXY(i, (x + TERRAIN_SIZE / 2) / TERRAIN_SIZE, (z + TERRAIN_SIZE / 2) / TERRAIN_SIZE);
  }
  geo.computeVertexNormals();

  // Ground paint: one height pass, lighting from grid differences, then
  // color + grass mask. Sampled by the terrain AND the grass shader.
  const S = COLOR_TEX_SIZE;
  const step = TERRAIN_SIZE / (S - 1);
  const bakedH = new Float32Array(S * S);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      bakedH[j * S + i] = heightAt((i / (S - 1) - 0.5) * TERRAIN_SIZE, (j / (S - 1) - 0.5) * TERRAIN_SIZE);
    }
  }
  const texData = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const x = (i / (S - 1) - 0.5) * TERRAIN_SIZE;
      const z = (j / (S - 1) - 0.5) * TERRAIN_SIZE;
      const iw = Math.max(1, Math.min(S - 2, i));
      const jw = Math.max(1, Math.min(S - 2, j));
      const nx = bakedH[jw * S + iw - 1] - bakedH[jw * S + iw + 1];
      const nz = bakedH[(jw - 1) * S + iw] - bakedH[(jw + 1) * S + iw];
      const len = Math.hypot(nx, 2 * step, nz);
      const light = Math.max(
        0,
        (nx / len) * SUN_DIR.x + ((2 * step) / len) * SUN_DIR.y + (nz / len) * SUN_DIR.z
      );
      const { col, grassMask } = groundColorAt(x, z, light, bakedH[j * S + i]);
      const k = (j * S + i) * 4;
      texData[k] = col[0];
      texData[k + 1] = col[1];
      texData[k + 2] = col[2];
      texData[k + 3] = grassMask * 255;
    }
  }
  const colorTexture = new THREE.DataTexture(texData, S, S, THREE.RGBAFormat);
  colorTexture.colorSpace = THREE.SRGBColorSpace;
  colorTexture.magFilter = THREE.LinearFilter;
  colorTexture.minFilter = THREE.LinearFilter;
  colorTexture.needsUpdate = true;

  // Painted, unlit ground — all lighting is baked into the texture.
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: colorTexture }));
  scene.add(mesh);

  // Transparent shadow-catcher on top so trees/drone still ground themselves.
  const shadowCatcher = new THREE.Mesh(
    geo,
    new THREE.ShadowMaterial({ color: 0x274a1c, opacity: 0.3 })
  );
  shadowCatcher.position.y = 0.06;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  // Height texture for the grass shader.
  const heights = new Float32Array(HEIGHT_TEX_SIZE * HEIGHT_TEX_SIZE);
  for (let j = 0; j < HEIGHT_TEX_SIZE; j++) {
    for (let i = 0; i < HEIGHT_TEX_SIZE; i++) {
      const x = (i / (HEIGHT_TEX_SIZE - 1) - 0.5) * TERRAIN_SIZE;
      const z = (j / (HEIGHT_TEX_SIZE - 1) - 0.5) * TERRAIN_SIZE;
      heights[j * HEIGHT_TEX_SIZE + i] = heightAt(x, z);
    }
  }
  const heightTexture = new THREE.DataTexture(
    heights, HEIGHT_TEX_SIZE, HEIGHT_TEX_SIZE, THREE.RedFormat, THREE.FloatType
  );
  heightTexture.magFilter = THREE.LinearFilter;
  heightTexture.minFilter = THREE.LinearFilter;
  heightTexture.needsUpdate = true;

  return { mesh, heightTexture, colorTexture, heightAt };
}

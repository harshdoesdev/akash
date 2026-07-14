import { makeRand } from './rng.js';

// Seeded value noise + FBM. Call initNoise(seed) before sampling — the whole
// terrain (and everything derived from it) changes with the seed.
const perm = new Uint8Array(512);

export function initNoise(seed) {
  const rand = makeRand(seed);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
}

initNoise(1337); // default; main.js re-seeds from the world seed

function hash(ix, iz) {
  return perm[(perm[ix & 255] + iz) & 255] / 255;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

export function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}

// Fractal noise in [-1, 1].
export function fbm(x, z, octaves = 4) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += (valueNoise(x, z) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    x = x * 2 + 31.7;
    z = z * 2 + 17.3;
  }
  return sum / norm;
}

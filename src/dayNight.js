import * as THREE from 'three';

// Day/night cycle. One shared tint uniform multiplies every hand-painted
// (unlit) surface — terrain, grass, water, foliage — while real lights,
// fog, sky gradient, and clouds are keyframed per time-of-day.
// Hold N to fast-forward time.
export const GLOBAL_TINT = { value: new THREE.Color(1, 1, 1) };

const CYCLE_SECONDS = 600; // full day in 10 minutes

const K = (o) => ({
  zenith: new THREE.Color(o.zenith),
  mid: new THREE.Color(o.mid),
  horizon: new THREE.Color(o.horizon),
  fog: new THREE.Color(o.fog),
  sun: new THREE.Color(o.sun),
  sunI: o.sunI,
  hemiSky: new THREE.Color(o.hemiSky),
  hemiGround: new THREE.Color(o.hemiGround),
  hemiI: o.hemiI,
  tint: new THREE.Color(o.tint),
  cloud: new THREE.Color(o.cloud),
  cloudGlow: o.cloudGlow,
  fogFar: o.fogFar,
  night: o.night,
});

const NIGHT = K({
  zenith: 0x0a1226, mid: 0x141f38, horizon: 0x212e4a, fog: 0x212e4a,
  sun: 0xa8bce0, sunI: 0.4, hemiSky: 0x35507c, hemiGround: 0x1c2a3c, hemiI: 0.35,
  tint: 0x54689a, cloud: 0x33425e, cloudGlow: 0.12, fogFar: 460, night: 1,
});
const DAWN = K({
  zenith: 0x2c4a86, mid: 0xcf8a64, horizon: 0xf2bd82, fog: 0xdfb08a,
  sun: 0xffbe78, sunI: 1.0, hemiSky: 0xe8c8a8, hemiGround: 0x8a7a58, hemiI: 0.6,
  tint: 0xcfa88e, cloud: 0xf0c8a8, cloudGlow: 0.3, fogFar: 560, night: 0,
});
const DAY = K({
  zenith: 0x2e6ac8, mid: 0x9fd2e8, horizon: 0xd8e8d0, fog: 0xd8e8d0,
  sun: 0xffeec2, sunI: 1.6, hemiSky: 0xcfe4ff, hemiGround: 0x9db86a, hemiI: 0.85,
  tint: 0xffffff, cloud: 0xffffff, cloudGlow: 0.38, fogFar: 620, night: 0,
});
const DUSK = K({
  zenith: 0x2b3f7e, mid: 0xc87a5e, horizon: 0xe8a878, fog: 0xd09a80,
  sun: 0xffa868, sunI: 0.9, hemiSky: 0xd8b0a0, hemiGround: 0x6a5a4c, hemiI: 0.55,
  tint: 0xb89084, cloud: 0xe0b098, cloudGlow: 0.26, fogFar: 540, night: 0,
});

// tod 0 = midnight, 0.5 = noon.
const STOPS = [
  { t: 0.0, k: NIGHT },
  { t: 0.18, k: NIGHT },
  { t: 0.27, k: DAWN },
  { t: 0.35, k: DAY },
  { t: 0.65, k: DAY },
  { t: 0.75, k: DUSK },
  { t: 0.84, k: NIGHT },
  { t: 1.0, k: NIGHT },
];

const cur = K({
  zenith: 0, mid: 0, horizon: 0, fog: 0, sun: 0, sunI: 0,
  hemiSky: 0, hemiGround: 0, hemiI: 0, tint: 0, cloud: 0,
  cloudGlow: 0, fogFar: 620, night: 0,
});

export function createDayNight(refs) {
  // refs: {fog, sun, hemi, skyUniforms, cloudMat, ridges, skirtMat, terrainMat}
  let tod = 0; // midnight — night is the default for now
  let fast = false;
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyN') fast = true; });
  window.addEventListener('keyup', (e) => { if (e.code === 'KeyN') fast = false; });

  const ridgeBases = refs.ridges.map((m) => m.color.clone());
  const skirtBase = refs.skirtMat.color.clone();

  function sample(t) {
    let a = STOPS[0];
    let b = STOPS[STOPS.length - 1];
    for (let i = 0; i < STOPS.length - 1; i++) {
      if (t >= STOPS[i].t && t <= STOPS[i + 1].t) { a = STOPS[i]; b = STOPS[i + 1]; break; }
    }
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    for (const key of ['zenith', 'mid', 'horizon', 'fog', 'sun', 'hemiSky', 'hemiGround', 'tint', 'cloud']) {
      cur[key].copy(a.k[key]).lerp(b.k[key], f);
    }
    for (const key of ['sunI', 'hemiI', 'cloudGlow', 'fogFar', 'night']) {
      cur[key] = a.k[key] + (b.k[key] - a.k[key]) * f;
    }
  }

  const api = {
    nightFactor: 1,
    timeOfDay: () => tod,
    update(dt) {
      tod = (tod + (dt / CYCLE_SECONDS) * (fast ? 60 : 1)) % 1;
      sample(tod);

      refs.fog.color.copy(cur.fog);
      refs.fog.far = cur.fogFar;
      refs.sun.color.copy(cur.sun);
      refs.sun.intensity = cur.sunI;
      refs.hemi.color.copy(cur.hemiSky);
      refs.hemi.groundColor.copy(cur.hemiGround);
      refs.hemi.intensity = cur.hemiI;
      refs.skyUniforms.uZenith.value.copy(cur.zenith);
      refs.skyUniforms.uMid.value.copy(cur.mid);
      refs.skyUniforms.uHorizon.value.copy(cur.horizon);
      refs.skyUniforms.uNight.value = cur.night;
      refs.cloudMat.color.copy(cur.cloud);
      refs.cloudMat.emissiveIntensity = cur.cloudGlow;
      refs.terrainMat.color.copy(cur.tint);
      refs.skirtMat.color.copy(skirtBase).multiply(cur.tint);
      refs.ridges.forEach((m, i) => m.color.copy(ridgeBases[i]).multiply(cur.tint));
      GLOBAL_TINT.value.copy(cur.tint);
      api.nightFactor = cur.night;
    },
  };
  return api;
}

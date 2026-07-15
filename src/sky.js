import * as THREE from 'three/webgpu';
import {
  texture, uniform, positionLocal,
  vec2, vec3, float, dot, sin, smoothstep, mix, abs, step, length,
  fract, floor, normalize, atan, asin, clamp, Fn, max,
} from 'three/tsl';
import { fbm } from './noise.js';
import { PALETTE } from './palette.js';
import { texture as asset } from './assets.js';

// Sky: our own hand-painted equirect panoramas (Codex-generated to the
// game's palette) on an inverted sphere, crossfaded day / dawn / night by
// the day-night cycle. Clouds are painted INSIDE the same shader — a
// billowed noise field projected on a sky plane, thresholded into flat
// anime clouds — and night gets a procedural field of tiny twinkling stars.
// One draw call for the whole sky. Layered haze ridges and a fog-colored
// ground skirt dissolve the world edge.

export function createSky(scene, sunDirection, worldSeed) {
  const horizon = new THREE.Color(PALETTE.horizonFog);

  const panorama = (name) => {
    const t = asset(name); // preloaded by assets.js
    t.wrapS = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearFilter; // no mips: avoids the equirect seam line
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  const dayTex = panorama('skyDay');
  const dawnTex = panorama('skyDawn');
  const nightTex = panorama('skyNight');

  const uDawnW = uniform(0);
  const uNightW = uniform(0);
  const uCloudTint = uniform(new THREE.Color(1, 1, 1));
  const uCloudShade = uniform(new THREE.Color(0xa9cdf1).convertSRGBToLinear());
  const uTime = uniform(0);

  const chash = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
  const shash = Fn(([p]) => fract(sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453)));

  const cnoise = Fn(([p]) => {
    const i = floor(p);
    const f = fract(p).toVar();
    f.assign(f.mul(f).mul(f.mul(-2.0).add(3.0)));
    return mix(
      mix(chash(i), chash(i.add(vec2(1.0, 0.0))), f.x),
      mix(chash(i.add(vec2(0.0, 1.0))), chash(i.add(vec2(1.0, 1.0))), f.x),
      f.y
    );
  });

  // Billowed fbm: folding the noise makes rounded lobes — cauliflower
  // clumps instead of smoky wisps. Four octaves, unrolled.
  const puff = Fn(([p0]) => {
    const v = float(0).toVar();
    const p = p0.toVar();
    const a = float(0.5).toVar();
    for (let i = 0; i < 4; i++) {
      v.addAssign(a.mul(float(1.0).sub(abs(cnoise(p).mul(2.0).sub(1.0)))));
      p.assign(p.mul(2.17).add(19.19));
      a.mulAssign(0.5);
    }
    return v;
  });

  // One layer of tiny round twinkling stars on a direction grid.
  const starLayer = Fn(([dir, freq, thresh, bright]) => {
    const g = dir.mul(freq);
    const c = floor(g);
    const h = shash(c);
    const d = length(fract(g).sub(0.5));
    const star = smoothstep(0.34, 0.04, d).mul(step(thresh, h));
    const tw = sin(uTime.mul(shash(c.add(7.0)).mul(2.4).add(0.7))
      .add(shash(c.add(13.0)).mul(6.28318))).mul(0.45).add(0.55);
    // Cool blue-white with the occasional warm one.
    const tintS = mix(vec3(0.8, 0.87, 1.0), vec3(1.0, 0.9, 0.75), step(0.92, shash(c.add(21.0))));
    return tintS.mul(star).mul(tw).mul(bright);
  });

  const skyMat = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  skyMat.colorNode = Fn(() => {
    const dir = normalize(positionLocal);
    // Equirectangular lookup.
    const uvE = vec2(
      atan(dir.z, dir.x).mul(0.1591549).add(0.5),
      asin(clamp(dir.y, -1.0, 1.0)).mul(0.3183099).add(0.5)
    );
    const col = texture(dayTex, uvE).rgb.mul(float(1.0).sub(uDawnW).sub(uNightW))
      .add(texture(dawnTex, uvE).rgb.mul(uDawnW))
      .add(texture(nightTex, uvE).rgb.mul(uNightW))
      .toVar();

    // Dither: breaks up 8-bit banding on the smooth painted gradients —
    // two octaves, strong enough to melt the dark-blue night bands.
    col.addAssign(chash(uvE.mul(1024.0)).sub(0.5).mul(0.011)
      .add(chash(uvE.mul(383.0).add(17.0)).sub(0.5).mul(0.005)));

    // Night: a dense field of tiny twinkling stars (two size tiers),
    // fading toward the horizon haze. The panorama itself is starless.
    const horizonFade = smoothstep(0.02, 0.24, dir.y);
    const stars = starLayer(dir, 320.0, 0.9952, 0.5)   // many faint pinpricks
      .add(starLayer(dir, 110.0, 0.9975, 0.95));       // a few bright ones
    col.addAssign(stars.mul(uNightW).mul(horizonFade));

    // Clouds, projected onto a flat layer overhead — perspective for free.
    const sp = dir.xz.div(dir.y.abs().add(0.25)).mul(2.1)
      .add(vec2(uTime.mul(0.009), uTime.mul(0.002)));
    const d = puff(sp);
    const fade = smoothstep(0.04, 0.16, dir.y); // dissolve into the haze
    const cover = smoothstep(0.80, 0.83, d).mul(fade);
    // Flat anime shading: where the field is thicker just beyond, we're
    // under a lobe — fill with the blue shade tone, hard edge.
    const shade = smoothstep(0.84, 0.92, puff(sp.add(vec2(0.05, 0.16))));
    const cloud = mix(vec3(1.0), uCloudShade, shade.mul(0.85)).mul(uCloudTint);
    return mix(col, cloud, cover);
  })();

  const sky = new THREE.Mesh(new THREE.SphereGeometry(880, 48, 24), skyMat);
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

  return {
    // dayNight drives these exactly like the old raw-uniform objects —
    // TSL uniform nodes expose the same .value interface.
    skyUniforms: { uDawnW, uNightW, uCloudTint },
    ridgeMats,
    skirtMat,
    update(dt, dronePos) {
      uTime.value += dt;
      sky.position.set(dronePos.x, 0, dronePos.z);
      for (const obj of follow) obj.position.set(dronePos.x, obj.position.y, dronePos.z);
    },
  };
}

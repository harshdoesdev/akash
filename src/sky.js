import * as THREE from 'three';
import { fbm } from './noise.js';
import { PALETTE } from './palette.js';

// Sky: our own hand-painted equirect panoramas (Codex-generated to the
// game's palette) on an inverted sphere, crossfaded day / dawn / night by
// the day-night cycle. Clouds are painted INSIDE the same shader — a
// billowed noise field projected on a sky plane, thresholded into flat
// anime clouds (white lobed tops, light-blue undersides), drifting with
// time. One draw call for the whole sky, no cloud geometry at all.
// Layered haze ridges and a fog-colored ground skirt dissolve the world edge.

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uDawn;
  uniform sampler2D uNight;
  uniform float uDawnW;
  uniform float uNightW;
  uniform vec3 uCloudTint;
  uniform vec3 uCloudShade;
  uniform float uTime;
  varying vec3 vDir;

  float chash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float cnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(chash(i), chash(i + vec2(1.0, 0.0)), f.x),
      mix(chash(i + vec2(0.0, 1.0)), chash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  // Billowed fbm: folding the noise makes rounded lobes — cauliflower
  // clumps instead of smoky wisps.
  float puff(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * (1.0 - abs(cnoise(p) * 2.0 - 1.0));
      p = p * 2.17 + 19.19;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    // Equirectangular lookup.
    vec2 uv = vec2(
      atan(dir.z, dir.x) * 0.1591549 + 0.5,
      asin(clamp(dir.y, -1.0, 1.0)) * 0.3183099 + 0.5
    );
    vec3 col = texture2D(uDay, uv).rgb * (1.0 - uDawnW - uNightW)
             + texture2D(uDawn, uv).rgb * uDawnW
             + texture2D(uNight, uv).rgb * uNightW;
    // Dither: breaks up 8-bit banding on the smooth painted gradients.
    col += (chash(uv * 1024.0) - 0.5) * 0.008;

    if (dir.y > 0.02) {
      // Project onto a flat cloud layer overhead — perspective for free.
      vec2 sp = dir.xz / (dir.y + 0.25) * 2.1;
      sp.x += uTime * 0.009;
      sp.y += uTime * 0.002;
      float d = puff(sp);
      float fade = smoothstep(0.04, 0.16, dir.y); // dissolve into the haze
      float cover = smoothstep(0.80, 0.83, d) * fade;
      // Flat anime shading: where the field is thicker just beyond, we're
      // under a lobe — fill with the blue shade tone, hard edge.
      float shade = smoothstep(0.84, 0.92, puff(sp + vec2(0.05, 0.16)));
      vec3 cloud = mix(vec3(1.0), uCloudShade, shade * 0.85) * uCloudTint;
      col = mix(col, cloud, cover);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createSky(scene, sunDirection, worldSeed) {
  const horizon = new THREE.Color(PALETTE.horizonFog);

  const loader = new THREE.TextureLoader();
  const panorama = (url) => {
    const t = loader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearFilter; // no mips: avoids the equirect seam line
    t.generateMipmaps = false;
    return t;
  };

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(880, 48, 24),
    new THREE.ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms: {
        uDay: { value: panorama('/sky-day.png') },
        uDawn: { value: panorama('/sky-dawn.png') },
        uNight: { value: panorama('/sky-night.png') },
        uDawnW: { value: 0 },
        uNightW: { value: 0 },
        uCloudTint: { value: new THREE.Color(1, 1, 1) },
        uCloudShade: { value: new THREE.Color(0xa9cdf1).convertSRGBToLinear() },
        uTime: { value: 0 },
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

  return {
    skyUniforms: sky.material.uniforms,
    ridgeMats,
    skirtMat,
    update(dt, dronePos) {
      sky.material.uniforms.uTime.value += dt;
      sky.position.set(dronePos.x, 0, dronePos.z);
      for (const obj of follow) obj.position.set(dronePos.x, obj.position.y, dronePos.z);
    },
  };
}

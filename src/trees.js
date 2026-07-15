import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SUN_DIR } from './palette.js';
import { makeRand } from './rng.js';
import { GLOBAL_TINT } from './dayNight.js';
import { distToPath, WATER_LEVEL } from './terrain.js';
import { texture, ready } from './assets.js';

// Ghibli forest, film-style. The skeleton is a recursive branching grower
// in the spirit of the classic parametric tree models (Weber-Penn / space
// colonization results): a slender trunk that splits repeatedly into many
// fine, CURVED branches (each branch is several short segments that wander
// and reach for light), with radii following da Vinci's pipe model — so
// trunks stay thin and twigs get hair-fine. Some subtrees are "dead": bare
// twigs that poke out of the canopy, exactly like the reference.
//
// Foliage is thousands of hand-painted leaf-spray CARDS (a Codex atlas of
// small leaf clusters, alpha-cut) around the branch-tip puffs. Each card
// is tinted one tone from a banded ramp over its puff-sphere normal — so
// the canopy shades like a volume (sunlit lime rolling into blue-teal)
// while every silhouette is real painted leaves. Interior cards with extra
// occlusion give the canopy its dark body — no solid core meshes.
//
// Perf shape: 4x4 world chunks × (merged wood + one instanced card cloud)
// — the whole forest is ~35 draw calls.

const HALF_WORLD = 800;
const GRID = 8; // finer chunks = tighter frustum culling of leaf clouds
const CHUNK = (HALF_WORLD * 2) / GRID;

const leafVertex = /* glsl */ `
  attribute vec3 aPos;    // leaf center, world space
  attribute vec3 aNormal; // puff-sphere normal — the shading normal
  attribute vec4 aData;   // size, colorJitter, ao, flutterPhase
  attribute vec3 aMisc;   // swayPhase, swayWeight, blossom
  uniform float uTime;
  uniform vec4 uWash; // drone xyz + wash strength
  uniform vec3 uSunDir;
  uniform vec3 uShadow;
  uniform vec3 uMid;
  uniform vec3 uLight;
  uniform vec3 uGlow;
  uniform vec3 uShadowB;
  uniform vec3 uMidB;
  uniform vec3 uLightB;
  uniform vec3 uGlowB;
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vFogDepth;
  varying float vVariant;
  varying float vTone;
  varying float vBlossom;

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    vUv = uv;
    vVariant = floor(hash(dot(aPos, vec3(3.1717, 9.0313, 5.7171))) * 3.999);
    float dist = distance(aPos, cameraPosition);
#ifdef CLUMP
    // Far LOD: camera-facing painted clumps fade in past the leaf range.
    float vis = smoothstep(120.0, 190.0, dist);
    vec3 fwd = normalize(cameraPosition - aPos);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up2 = cross(fwd, right);
#else
    // Near LOD: detailed spray cards shrink away in the crossfade band.
    // Cards almost touching the camera also shrink — kills the worst
    // full-screen overdraw when flying through a canopy.
    float vis = (1.0 - smoothstep(150.0, 220.0, dist)) * smoothstep(1.2, 3.5, dist);
    // Leaves lie roughly tangent to their puff sphere (like sprays hugging
    // the canopy surface), randomly twisted and tilted — full coverage from
    // outside, and the volume look comes from the shared sphere normals.
    float h1 = hash(dot(aPos, vec3(12.9898, 78.233, 37.719)));
    float h2 = hash(dot(aPos, vec3(39.3467, 11.135, 83.155)));
    vec3 t1 = normalize(cross(aNormal, vec3(0.577, 0.577, 0.577)));
    vec3 t2 = cross(aNormal, t1);
    float ang = h1 * 6.28318;
    vec3 right = t1 * cos(ang) + t2 * sin(ang);
    vec3 up2 = normalize(cross(aNormal, right) + aNormal * (h2 - 0.5) * 1.1);
#endif
    vec3 wp = aPos + (right * position.x + up2 * position.y) * aData.x * vis;

    // Wind: whole-canopy lean plus a tiny per-leaf flutter along the normal.
    float sway = sin(uTime * 0.8 + aMisc.x) * aMisc.y;
    wp.x += sway;
    wp.z += sway * 0.6;
    wp += aNormal * (sin(uTime * 2.1 + aData.w) * 0.05);
#ifndef CLUMP
    // Prop wash: leaves near the hovering drone rustle and stir.
    float wash = uWash.w * (1.0 - smoothstep(2.5, 8.0, distance(aPos, uWash.xyz)));
    if (wash > 0.001) {
      wp += aNormal * (sin(uTime * 13.0 + aData.w * 7.0) * 0.13 * wash);
      wp.x += sin(uTime * 10.0 + aData.w * 11.0) * 0.1 * wash;
      wp.z += cos(uTime * 9.0 + aData.w * 5.0) * 0.1 * wash;
    }
#endif

    // One flat tone per leaf: banded ramp over the sphere normal's light,
    // pushed down by ambient occlusion (interior / low canopy) and nudged
    // per leaf so neighbours never share an identical tone.
    float ndl = dot(aNormal, uSunDir) * 0.5 + 0.5;
    float t = clamp(ndl - aData.z * 0.55 + (aData.y - 0.5) * 0.34, 0.0, 1.0);
    vBlossom = aMisc.z;
#ifdef CLUMP
    vTone = t;      // shading finishes in the fragment, across the card
    vColor = vec3(1.0);
#else
    float b1 = smoothstep(0.30, 0.42, t);
    float b2 = smoothstep(0.58, 0.70, t);
    float b3 = smoothstep(0.85, 0.93, t);
    vec3 green = mix(mix(mix(uShadow, uMid, b1), uLight, b2), uGlow, b3);
    vec3 pink = mix(mix(mix(uShadowB, uMidB, b1), uLightB, b2), uGlowB, b3);
    vColor = mix(green, pink, aMisc.z);
    vTone = 0.0;
#endif

    vec4 mv = viewMatrix * vec4(wp, 1.0);
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const leafFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uReady;
  uniform vec3 uTint;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uShadow;
  uniform vec3 uMid;
  uniform vec3 uLight;
  uniform vec3 uGlow;
  uniform vec3 uShadowB;
  uniform vec3 uMidB;
  uniform vec3 uLightB;
  uniform vec3 uGlowB;
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vFogDepth;
  varying float vVariant;
  varying float vTone;
  varying float vBlossom;

  void main() {
    vec3 col;
#ifdef CLUMP
    // One whole shaded puff painted inside the card: lobed silhouette,
    // sunlit top rolling into blue-teal base — no overlapping discs.
    vec2 q = (vUv - 0.5) * 2.0;
    q.y *= 1.3; // wider than tall
    float a = atan(q.y, q.x);
    float wob = sin(a * 5.0 + vVariant * 6.28318) * 0.1
              + sin(a * 9.0 + vVariant * 2.7) * 0.05;
    float r2 = dot(q, q);
    if (r2 > 1.0 - wob) discard;
    float t = clamp(vTone + vUv.y * 0.55 - 0.25 - r2 * 0.12, 0.0, 1.0);
    float b1 = smoothstep(0.30, 0.44, t);
    float b2 = smoothstep(0.58, 0.72, t);
    float b3 = smoothstep(0.85, 0.95, t);
    vec3 green = mix(mix(mix(uShadow, uMid, b1), uLight, b2), uGlow, b3);
    vec3 pink = mix(mix(mix(uShadowB, uMidB, b1), uLightB, b2), uGlowB, b3);
    col = mix(green, pink, vBlossom);
#else
    if (uReady > 0.5) {
      // Hand-painted leaf spray from the 2x2 atlas, tinted by the ramp.
      vec2 cell = vec2(mod(vVariant, 2.0), floor(vVariant * 0.5)) * 0.5;
      vec4 tex = texture2D(uMap, cell + vUv * 0.5);
      if (tex.a < 0.5) discard;
      col = tex.rgb * vColor * 1.25;
    } else {
      // Fallback while the atlas loads: plain oval dab.
      vec2 p = (vUv - 0.5) * 2.0;
      p.y *= 1.12 - 0.18 * p.y;
      if (dot(p, p) > 1.0) discard;
      col = vColor;
    }
#endif
    col *= uTint;
    float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
    gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
    #include <colorspace_fragment>
  }
`;

export function createForest(scene, heightAt, worldSeed) {
  const rand = makeRand(worldSeed ^ 0x7a3e51);
  const fog = scene.fog;

  const chunks = [];
  for (let i = 0; i < GRID * GRID; i++) {
    chunks.push({ wood: [], leaves: [], clumps: [] });
  }
  const chunkAt = (x, z) => {
    const cx = THREE.MathUtils.clamp(Math.floor((x + HALF_WORLD) / CHUNK), 0, GRID - 1);
    const cz = THREE.MathUtils.clamp(Math.floor((z + HALF_WORLD) / CHUNK), 0, GRID - 1);
    return chunks[cz * GRID + cx];
  };

  // Materials --------------------------------------------------------------
  const gradient = new THREE.DataTexture(new Uint8Array([150, 200, 245, 255]), 4, 1, THREE.RedFormat);
  gradient.magFilter = THREE.NearestFilter;
  gradient.minFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  const trunkMat = new THREE.MeshToonMaterial({ color: 0x8a6247, gradientMap: gradient });
  if (ready('bark')) {
    const t = texture('bark');
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 2);
    t.needsUpdate = true;
    trunkMat.map = t;
    trunkMat.color.set(0xffffff);
  }

  const leafUniforms = {
    uTime: { value: 0 },
    uWash: { value: new THREE.Vector4(0, -9999, 0, 0) },
    uMap: { value: null },
    uReady: { value: 0 },
    uSunDir: { value: SUN_DIR.clone() },
    // Reference ramp: blue-teal shadow → forest green → lime → pale sun.
    uShadow: { value: new THREE.Color(0x35597f) },
    uMid: { value: new THREE.Color(0x4a8a50) },
    uLight: { value: new THREE.Color(0x8ec45f) },
    uGlow: { value: new THREE.Color(0xe9f09e) },
    uShadowB: { value: new THREE.Color(0x9c5f74) },
    uMidB: { value: new THREE.Color(0xcf8ba0) },
    uLightB: { value: new THREE.Color(0xefb9c8) },
    uGlowB: { value: new THREE.Color(0xfadbe4) },
    uTint: GLOBAL_TINT,
    uFogColor: { value: fog.color },
    uFogNear: { value: fog.near },
    uFogFar: { value: fog.far },
  };
  const leafMat = new THREE.ShaderMaterial({
    vertexShader: leafVertex,
    fragmentShader: leafFragment,
    uniforms: leafUniforms, // shared with the clump material
    side: THREE.DoubleSide,
  });
  const clumpMat = new THREE.ShaderMaterial({
    vertexShader: leafVertex,
    fragmentShader: leafFragment,
    uniforms: leafUniforms,
    defines: { CLUMP: 1 },
    side: THREE.DoubleSide,
  });
  if (ready('leaves')) {
    const t = texture('leaves');
    t.anisotropy = 4;
    leafUniforms.uMap.value = t;
    leafUniforms.uReady.value = 1;
  }

  // Tree generator ---------------------------------------------------------
  const treeSpots = [];
  const colliders = [];
  const UP = new THREE.Vector3(0, 1, 0);
  const LEAF_K = 60; // spray cards per m² of puff shell (the density dial)

  function addTree(x, z, forcedH) {
    const y = heightAt(x, z);
    if (!forcedH) {
      if (Math.hypot(x, z) > 780 || distToPath(x, z) < 4.5 || y < WATER_LEVEL + 2.5) return;
    }
    for (const [sx, sz] of treeSpots) {
      if ((x - sx) * (x - sx) + (z - sz) * (z - sz) < 49) return;
    }
    treeSpots.push([x, z]);
    const chunk = chunkAt(x, z);
    const origin = new THREE.Vector3(x, y, z);

    // Archetypes: a few dead snags (bare trunks), some gnarled old-growth
    // (crooked, thicker, sparse canopy, many dead limbs), the rest young.
    const roll = forcedH ? 1 : rand();
    const deadTree = roll < 0.035;
    const oldTree = !deadTree && roll < 0.11;
    const gnarl = deadTree ? 1.8 : oldTree ? 1.45 : 1;
    const tall = !forcedH && !deadTree && !oldTree && rand() < 0.25;
    const h = (forcedH || (tall ? 15 + rand() * 8 : 11 + rand() * 7))
      * (oldTree ? 1.2 : deadTree ? 0.8 : 1);
    const spread = tall ? 0.72 : 1;
    const blossom = !forcedH && !deadTree && !oldTree && rand() < 0.07 ? 1 : 0;
    const deadChance = oldTree ? 0.24 : 0.08;
    const leafMul = oldTree ? 0.7 : 1;
    const treeJitter = rand();
    const swayPhase = rand() * Math.PI * 2;
    const MAXD = forcedH ? 5 : 4;

    const limb = (a, b, r0, r1) => {
      const dir = b.clone().sub(a);
      const len = dir.length() * 1.06; // overlap joints so bends don't gap
      const radial = r0 > 0.09 ? 6 : r0 > 0.035 ? 4 : 3;
      const geo = new THREE.CylinderGeometry(r1, r0, len, radial, 1, true);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
      geo.applyMatrix4(new THREE.Matrix4().compose(
        a.clone().addScaledVector(dir, 0.5).add(origin), q, new THREE.Vector3(1, 1, 1)
      ));
      chunk.wood.push(geo);
    };

    // Recursive grower. Each branch = several short segments that wander;
    // LIFT is per-branch tropism — leaders climb hard, side branches stay
    // near-horizontal and only up-turn at the tip, which is what spreads
    // the lobes across heights instead of clumping them at the crown.
    const tips = [];
    const grow = (pos, dir, len, r, depth, dead, lift) => {
      const SEGS = depth === 0 ? 5 : 3;
      const segLen = len / SEGS;
      const rEnd = Math.max(0.012, r * 0.62);
      let p = pos.clone();
      const d = dir.clone();
      for (let s = 0; s < SEGS; s++) {
        d.x += (rand() - 0.5) * (depth === 0 ? 0.16 : 0.34) * gnarl;
        d.z += (rand() - 0.5) * (depth === 0 ? 0.16 : 0.34) * gnarl;
        // Tropism ramps up along the branch: flat run, then tip lift.
        d.y += lift * (0.4 + 1.2 * (s / SEGS));
        d.normalize();
        const f0 = s / SEGS;
        const f1 = (s + 1) / SEGS;
        const np = p.clone().addScaledVector(d, segLen);
        limb(p, np, r + (rEnd - r) * f0, r + (rEnd - r) * f1);

        // Mid-trunk side branches: near-horizontal, each carrying its own
        // lobe well below the crown — the reference profile. They enter the
        // recursion late (MAXD-1) so they stay short: one split, one lobe.
        if (depth === 0 && s >= 2 && s < SEGS - 1 && rand() < 0.7) {
          const az = rand() * Math.PI * 2;
          const el = 0.15 + rand() * 0.3; // barely rising
          const sd = new THREE.Vector3(
            Math.cos(el) * Math.cos(az),
            Math.sin(el),
            Math.cos(el) * Math.sin(az)
          );
          grow(p.clone(), sd, h * (0.2 + rand() * 0.09) * spread,
            Math.max(0.022, rEnd * (0.5 + rand() * 0.14)), MAXD - 1,
            rand() < 0.1, 0.035 + rand() * 0.03);
        }
        p = np;
      }
      if (depth >= MAXD || rEnd <= 0.013) {
        tips.push({ p, dead });
        return;
      }
      const kids = depth === 0
        ? 3 + (rand() < 0.5 ? 1 : 0)
        : 2 + (rand() < 0.3 ? 1 : 0);
      const az0 = rand() * Math.PI * 2;
      // Pipe model (da Vinci): children share the parent's cross-section.
      const rChild = Math.max(0.012, rEnd * Math.pow(1 / kids, 1 / 2.2));
      const perp = new THREE.Vector3().crossVectors(d, UP);
      if (perp.lengthSq() < 1e-4) perp.set(1, 0, 0);
      perp.normalize();
      for (let k = 0; k < kids; k++) {
        // k=0 continues the leader (small angle); others fork WIDE and then
        // keep their line (low lift) so the canopy gains horizontal reach.
        const ang = (k === 0 ? 0.16 : 0.62 + rand() * 0.5) * (tall ? 0.72 : 1);
        const az = az0 + (k / kids) * Math.PI * 2 + (rand() - 0.5) * 0.9;
        const axis = perp.clone().applyAxisAngle(d, az);
        const kd = d.clone().applyAxisAngle(axis, ang).normalize();
        const kLen = len * (0.62 + rand() * 0.16) * (k === 0 ? 1.05 : 0.85);
        const kDead = dead || (depth >= 1 && rand() < deadChance);
        const kLift = k === 0 ? 0.09 : 0.02 + rand() * 0.035;
        grow(p, kd, kLen, rChild * (0.85 + rand() * 0.3), depth + 1, kDead, kLift);
      }
    };

    const trunkDir = new THREE.Vector3(
      (rand() - 0.5) * 0.24 * gnarl, 1, (rand() - 0.5) * 0.24 * gnarl
    ).normalize();
    grow(new THREE.Vector3(0, 0, 0), trunkDir, h * 0.42,
      h * (oldTree || deadTree ? 0.024 : 0.017), 0, deadTree, 0.05);

    // Canopy: cluster the leafy tips into puffs, then dress each puff with
    // a dark core inside and a shell of small leaf sprays.
    const puffs = [];
    const mergeR2 = Math.pow(h * 0.12 * spread, 2);
    for (const tip of tips) {
      if (tip.dead) continue;
      let home = null;
      for (const q of puffs) {
        if (q.c.distanceToSquared(tip.p) < mergeR2) { home = q; break; }
      }
      if (home) home.c.lerp(tip.p, 1 / ++home.n);
      else puffs.push({ c: tip.p.clone(), n: 1 });
    }
    for (const q of puffs) {
      const pr = h * (0.09 + 0.031 * Math.min(4, q.n)) * (0.85 + rand() * 0.3) * spread;
      const c = q.c.clone().add(origin);
      c.y += pr * 0.15; // puffs sit on top of their twigs

      const count = Math.min(400, Math.max(30, Math.round(pr * pr * LEAF_K * leafMul)));
      for (let i = 0; i < count; i++) {
        const az = rand() * Math.PI * 2;
        const el = Math.asin(rand() * 2 - 1) * 0.78 + 0.16; // upward bias
        const n = new THREE.Vector3(
          Math.cos(el) * Math.cos(az),
          Math.sin(el),
          Math.cos(el) * Math.sin(az)
        );
        // 1 in 3 cards fills the interior (deep + occluded); the rest shell.
        const interior = i % 3 === 2;
        const rr = pr * (interior ? 0.3 + rand() * 0.42 : 0.74 + rand() * 0.32);
        const px = c.x + n.x * rr;
        const py = c.y + n.y * rr * 0.85;
        const pz = c.z + n.z * rr;
        const canopyT = THREE.MathUtils.clamp((py - origin.y) / (h * 1.05), 0, 1);
        const ao = THREE.MathUtils.clamp(
          0.5 - canopyT * 0.55 + (n.y < 0 ? 0.12 : 0) + (interior ? 0.3 : 0), 0, 0.9);
        chunk.leaves.push(
          px, py, pz,
          n.x, n.y, n.z,
          0.95 + rand() * 0.45,                         // spray card ≈ 5-9 small leaves
          THREE.MathUtils.clamp(0.5 + (treeJitter - 0.5) * 0.7 + (rand() - 0.5) * 0.62, 0, 1),
          ao,
          rand() * Math.PI * 2,
          swayPhase,
          Math.pow(Math.max(0, py - origin.y) / h, 2) * 0.28,
          blossom
        );
      }

      // Far-LOD clump: ONE billboard per puff — the whole shaded puff is
      // painted in the fragment shader, so nothing overlaps or flickers.
      {
        const az = rand() * Math.PI * 2;
        const el = 0.85;
        const n = new THREE.Vector3(
          Math.cos(el) * Math.cos(az),
          Math.sin(el),
          Math.cos(el) * Math.sin(az)
        );
        chunk.clumps.push(
          c.x, c.y, c.z,
          n.x, n.y, n.z,
          pr * 2.6,
          THREE.MathUtils.clamp(0.5 + (treeJitter - 0.5) * 0.6 + (rand() - 0.5) * 0.24, 0, 1),
          0.5, // centers the card's internal ramp on the mid band
          rand() * Math.PI * 2,
          swayPhase,
          0.1,
          blossom
        );
      }
    }

    // Trunk collider, plus the canopy envelope (for prop-wash leaf checks).
    colliders.push({
      x, z,
      r: Math.max(0.22, h * 0.022),
      top: y + h * 0.42,
      canopyR: deadTree ? 0 : h * 0.32 * spread * leafMul,
      canopyTop: y + h * 1.05,
      blossom, // torn leaves match the tree's color
    });
  }

  // Layout: fewer, richer trees — each one now costs real leaves.
  for (let g = 0; g < 56; g++) {
    const gx = (rand() - 0.5) * 1600;
    const gz = (rand() - 0.5) * 1600;
    const gr = Math.hypot(gx, gz);
    if (gr < 60 || gr > 760) continue;
    const count = 7 + Math.floor(rand() * 12);
    for (let t = 0; t < count; t++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * (16 + count * 2.6);
      addTree(gx + Math.cos(a) * d, gz + Math.sin(a) * d);
    }
  }
  for (let i = 0; i < 150; i++) {
    const x = (rand() - 0.5) * 1600;
    const z = (rand() - 0.5) * 1600;
    const r = Math.hypot(x, z);
    if (r > 30 && r < 780) addTree(x, z);
  }
  let best = { x: 180, z: -160, h: -Infinity };
  for (let a = 0; a < 80; a++) {
    for (let r = 130; r <= 320; r += 24) {
      const x = Math.cos((a / 80) * Math.PI * 2) * r;
      const z = Math.sin((a / 80) * Math.PI * 2) * r;
      const hh = heightAt(x, z);
      if (hh > best.h) best = { x, z, h: hh };
    }
  }
  addTree(best.x, best.z, 26);
  addTree(14, -24);
  addTree(-20, -16);
  addTree(-15, 22);

  // Bake chunks into meshes ------------------------------------------------
  const quad = new THREE.PlaneGeometry(1, 1);
  const STRIDE = 13;
  const bakeCards = (src, mat) => {
    const n = src.length / STRIDE;
    if (!n) return 0;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    const aPos = new Float32Array(n * 3);
    const aNormal = new Float32Array(n * 3);
    const aData = new Float32Array(n * 4);
    const aMisc = new Float32Array(n * 3);
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE;
      aPos[i * 3] = src[o];
      aPos[i * 3 + 1] = src[o + 1];
      aPos[i * 3 + 2] = src[o + 2];
      box.expandByPoint(v.set(src[o], src[o + 1], src[o + 2]));
      aNormal[i * 3] = src[o + 3];
      aNormal[i * 3 + 1] = src[o + 4];
      aNormal[i * 3 + 2] = src[o + 5];
      aData[i * 4] = src[o + 6];
      aData[i * 4 + 1] = src[o + 7];
      aData[i * 4 + 2] = src[o + 8];
      aData[i * 4 + 3] = src[o + 9];
      aMisc[i * 3] = src[o + 10];
      aMisc[i * 3 + 1] = src[o + 11];
      aMisc[i * 3 + 2] = src[o + 12];
    }
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
    geo.setAttribute('aNormal', new THREE.InstancedBufferAttribute(aNormal, 3));
    geo.setAttribute('aData', new THREE.InstancedBufferAttribute(aData, 4));
    geo.setAttribute('aMisc', new THREE.InstancedBufferAttribute(aMisc, 3));
    geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    geo.boundingSphere.radius += 4; // cards poke past their centers
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = true;
    scene.add(mesh);
    src.length = 0;
    return n;
  };

  let leafTotal = 0;
  let clumpTotal = 0;
  for (const chunk of chunks) {
    if (chunk.wood.length) {
      const wood = new THREE.Mesh(mergeGeometries(chunk.wood), trunkMat);
      wood.castShadow = true;
      scene.add(wood);
    }
    leafTotal += bakeCards(chunk.leaves, leafMat);
    clumpTotal += bakeCards(chunk.clumps, clumpMat);
  }
  console.log(`forest: ${treeSpots.length} trees, ${leafTotal} leaves, ${clumpTotal} clumps`);
  if (typeof window !== 'undefined') window.forestStats = { trees: treeSpots.length, leaves: leafTotal, clumps: clumpTotal };

  return {
    colliders,
    update(time, dronePos, washPower) {
      leafUniforms.uTime.value = time;
      leafUniforms.uFogFar.value = fog.far; // day/night pulls fog in
      if (dronePos) {
        leafUniforms.uWash.value.set(
          dronePos.x, dronePos.y, dronePos.z, 0.4 + (washPower || 0) * 0.6
        );
      }
    },
  };
}

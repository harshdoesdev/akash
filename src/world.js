import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SUN_DIR, PALETTE } from './palette.js';
import { makeRand } from './rng.js';
import { valueNoise } from './noise.js';
import { distToPath, WATER_LEVEL } from './terrain.js';
import { makeFoliageMaterial } from './foliageMaterial.js';

// Toon-shaded world dressing: lights, tree groves, rocks, the hero tree and
// the motorhome-garage. Terrain/grass/sky live in their own modules.

function toonGradient() {
  const tex = new THREE.DataTexture(
    new Uint8Array([150, 200, 245, 255]), 4, 1, THREE.RedFormat
  );
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export function buildWorld(scene, heightAt, worldSeed) {
  const gradient = toonGradient();
  const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: gradient });

  const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x9db86a, 0.85);
  scene.add(hemi);

  const sunDirection = SUN_DIR.clone();
  const sun = new THREE.DirectionalLight(PALETTE.sunlight, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.002;
  scene.add(sun, sun.target);

  const rand = makeRand(worldSeed ^ 0x7a3e51);

  // --- Ghibli trees, built on a real branching skeleton ---
  // Recursive branching with the three classic naturalness rules:
  //  - golden-angle azimuth between successive branches (phyllotaxis)
  //  - taper down the hierarchy (da Vinci's rule, approximated)
  //  - upward tropism (branches bias toward the light)
  // Foliage puffs sit at branch TIPS, so the canopy hangs on visible wood.
  // Everything merges into 3 meshes per tree (wood + two foliage tints).
  // Small round leaf-puffs (barely lumpy — the references use near-spheres).
  // The 3D-leaf look comes from MANY of these per branch tip, each catching
  // its own cel-shaded light band.
  const puffGeos = [];
  for (let v = 0; v < 6; v++) {
    const geo = mergeVertices(new THREE.IcosahedronGeometry(1, 1));
    const pos = geo.attributes.position;
    const seed = v * 13.7 + 4.2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const bump = 1 + (valueNoise(x * 2.1 + seed, (y * 1.4 + z) * 2.1 + seed) - 0.5) * 0.42;
      pos.setXYZ(i, x * bump, y * bump * 0.92, z * bump);
    }
    geo.computeVertexNormals();
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp((pos.getY(i) + 0.9) / 1.8, 0, 1);
      const shade = 0.78 + t * 0.4; // per-puff belly shade
      cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    puffGeos.push(geo);
  }


  // Hand-painted band palettes: deep cool shadow → mid → warm light → glow.
  const F = (s, m, l, g) => makeFoliageMaterial(s, m, l, g, scene.fog);
  const greenMats = [
    F(0x2f5c33, 0x4f9247, 0x7fbe58, 0xaed86f),
    F(0x315f2f, 0x579b4a, 0x8ac763, 0xbadf77),
    F(0x2a5731, 0x468c42, 0x74b653, 0xa2d167),
    F(0x33603a, 0x5aa04f, 0x8dc85f, 0xc0e07d),
  ];
  const blossomMats = [
    F(0x9c5f74, 0xcf8ba0, 0xefb9c8, 0xfadbe4),
    F(0x96586d, 0xc78197, 0xe9adc0, 0xf7d3de),
  ];
  const trunkMat = toon(0x8a6247);

  // Hand-painted bark (Codex-generated); flat color is the fallback. Leaves
  // are deliberately untextured — their look comes from puff geometry + cel
  // shading, not a map.
  new THREE.TextureLoader().load('/bark.png', (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 2);
    trunkMat.map = t;
    trunkMat.color.set(0xffffff); // bark texture carries the color
    trunkMat.needsUpdate = true;
  }, undefined, () => {});
  const swayers = [];
  const treeSpots = []; // enforce spacing — canopies must not interpenetrate
  const colliders = []; // trunk cylinders the drone can hit
  const UP = new THREE.Vector3(0, 1, 0);
  const GOLDEN = 2.39996; // golden angle in radians

  function addTree(x, z, forcedH) {
    const y = heightAt(x, z);
    if (!forcedH) {
      // Placement rules: out of the mist, off the path, never in/near water.
      if (Math.hypot(x, z) > 780 || distToPath(x, z) < 4.5 || y < WATER_LEVEL + 2.5) return;
    }
    // Personal space: closer than ~7m and canopies merge into mush.
    for (const [sx, sz] of treeSpots) {
      if ((x - sx) * (x - sx) + (z - sz) * (z - sz) < 49) return;
    }
    treeSpots.push([x, z]);
    // Two archetypes: wide dome oaks and taller, narrower poplar-like trees.
    // No runts — minimum height is a real tree.
    const tall = !forcedH && rand() < 0.3;
    const h = forcedH || (tall ? 16 + rand() * 10 : 12 + rand() * 8);
    const spread = tall ? 0.7 : 1; // tall trees hold their canopy tight
    const blossom = !forcedH && rand() < 0.07;
    const mats = blossom ? blossomMats : greenMats;
    const matA = mats[Math.floor(rand() * mats.length)];
    const matB = mats[Math.floor(rand() * mats.length)];

    const limbParts = [];
    const puffsA = [];
    const puffsB = [];
    const lowA = []; // far-LOD silhouette: one big blob per cluster
    const lowB = [];

    const limb = (start, end, rBase, rTip) => {
      const dir = end.clone().sub(start);
      const len = dir.length();
      const geo = new THREE.CylinderGeometry(rTip, rBase, len, 6, 1, true);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
      geo.applyMatrix4(new THREE.Matrix4().compose(
        start.clone().addScaledVector(dir, 0.5), q, new THREE.Vector3(1, 1, 1)
      ));
      limbParts.push(geo);
    };

    const puff = (center, r, sink = null) => {
      const geo = puffGeos[Math.floor(rand() * puffGeos.length)].clone();
      const q = new THREE.Quaternion().setFromAxisAngle(UP, rand() * Math.PI * 2);
      geo.applyMatrix4(new THREE.Matrix4().compose(center, q, new THREE.Vector3(r, r * 0.9, r)));
      // Canopy depth shading: puffs low in the canopy sink toward deep
      // forest green; the crown top glows (the Ghibli value structure).
      const depth = 0.52 + 0.6 * THREE.MathUtils.clamp(center.y / (h * 0.95), 0, 1);
      const cols = geo.attributes.color;
      for (let i = 0; i < cols.count; i++) {
        cols.setXYZ(i,
          Math.min(1.2, cols.getX(i) * depth),
          Math.min(1.2, cols.getY(i) * depth),
          Math.min(1.2, cols.getZ(i) * depth));
      }
      (sink || (rand() < 0.6 ? puffsA : puffsB)).push(geo);
    };

    // A leaf CLUSTER: many small puffs packed around a branch tip. The far
    // LOD gets one matching big blob instead — same silhouette, ~10× cheaper.
    const cluster = (center, clusterR, big) => {
      const n = big ? 10 + Math.floor(rand() * 4) : 4 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const el = (rand() - 0.32) * 1.3; // bias puffs upward
        const rr = clusterR * (0.15 + 0.75 * Math.cbrt(rand()));
        const c = new THREE.Vector3(
          center.x + Math.cos(a) * Math.cos(el) * rr,
          center.y + Math.sin(el) * rr * 0.85,
          center.z + Math.sin(a) * Math.cos(el) * rr
        );
        puff(c, clusterR * (0.38 + rand() * 0.26));
      }
      puff(center, clusterR * 1.08, rand() < 0.6 ? lowA : lowB);
    };

    // Trunk: leans a little, tapers, splits high (fly under the canopy).
    const trunkDir = new THREE.Vector3((rand() - 0.5) * 0.2, 1, (rand() - 0.5) * 0.2).normalize();
    const trunkLen = h * (tall ? 0.52 : 0.42);
    const top = trunkDir.clone().multiplyScalar(trunkLen);
    limb(new THREE.Vector3(0, 0, 0), top, h * 0.038, h * 0.022);

    // Branches spread DOWN the trunk (no bare pole): lowest are longest and
    // most horizontal, upper ones shorter and steeper — a natural profile
    // with air and visible wood between foliage clusters.
    const mainCount = forcedH ? 7 : 4 + Math.floor(rand() * 2);
    const az0 = rand() * Math.PI * 2;
    for (let i = 0; i < mainCount; i++) {
      const hf = i / Math.max(1, mainCount - 1); // 0 = lowest, 1 = topmost
      const az = az0 + i * GOLDEN + (rand() - 0.5) * 0.6;
      const tilt = (1.05 - hf * 0.55 + (rand() - 0.5) * 0.22) * (tall ? 0.6 : 1);
      const dir = new THREE.Vector3(
        Math.sin(tilt) * Math.cos(az),
        Math.cos(tilt),
        Math.sin(tilt) * Math.sin(az)
      ).addScaledVector(trunkDir, 0.25).normalize();

      const start = trunkDir.clone().multiplyScalar(trunkLen * (0.45 + hf * 0.5 + rand() * 0.06));
      const len = h * (0.26 - hf * 0.09) * (0.85 + rand() * 0.3) * spread;
      const end = start.clone().addScaledVector(dir, len);
      limb(start, end, h * 0.016, h * 0.008);
      // Pull tip clusters toward the canopy axis so lobes mound into a dome.
      cluster(end.clone().addScaledVector(dir, h * 0.03).lerp(top, 0.15), h * (0.17 + rand() * 0.06) * spread, true);

      const twigs = 1 + Math.floor(rand() * 2);
      for (let t = 0; t < twigs; t++) {
        const tdir = dir.clone()
          .add(new THREE.Vector3((rand() - 0.5) * 1.2, rand() * 0.7, (rand() - 0.5) * 1.2))
          .normalize();
        const tstart = start.clone().addScaledVector(dir, len * (0.45 + rand() * 0.35));
        const tend = tstart.clone().addScaledVector(tdir, len * (0.45 + rand() * 0.25));
        limb(tstart, tend, h * 0.007, h * 0.004);
        cluster(tend.clone().addScaledVector(tdir, h * 0.02), h * (0.10 + rand() * 0.04) * spread, false);
      }
    }
    // Leader cluster crowning the trunk, plus an interior fill mass so the
    // canopy reads as one dome with lobes, not satellite pompoms.
    cluster(top.clone().add(new THREE.Vector3(0, h * 0.07, 0)), h * (0.18 + rand() * 0.05) * spread, true);
    cluster(top.clone().add(new THREE.Vector3(0, h * 0.16, 0)), h * (0.2 + rand() * 0.05) * spread, true);
    // Tall trees stack one more cluster up the leader for a pointed crown.
    if (tall) cluster(top.clone().add(new THREE.Vector3(0, h * 0.28, 0)), h * 0.15, true);

    // Two detail levels sharing the wood geometry; puff detail only near by.
    const woodGeo = mergeGeometries(limbParts);
    const full = new THREE.Group();
    const woodHi = new THREE.Mesh(woodGeo, trunkMat);
    woodHi.castShadow = true;
    full.add(woodHi);
    for (const [parts, mat] of [[puffsA, matA], [puffsB, matB]]) {
      if (!parts.length) continue;
      const foliage = new THREE.Mesh(mergeGeometries(parts), mat);
      foliage.castShadow = true;
      full.add(foliage);
    }
    const low = new THREE.Group();
    low.add(new THREE.Mesh(woodGeo, trunkMat)); // no shadows at distance
    for (const [parts, mat] of [[lowA, matA], [lowB, matB]]) {
      if (parts.length) low.add(new THREE.Mesh(mergeGeometries(parts), mat));
    }

    const tree = new THREE.LOD();
    tree.addLevel(full, 0);
    tree.addLevel(low, 170);
    tree.position.set(x, y, z);
    tree.rotation.y = rand() * Math.PI * 2;
    tree.userData.phase = rand() * Math.PI * 2;
    tree.userData.amp = 0.006 + rand() * 0.007;
    swayers.push(tree);
    scene.add(tree);

    // Main trunk collider: vertical cylinder from the ground to the fork.
    colliders.push({ x, z, r: Math.max(0.28, h * 0.042), top: y + trunkLen * 1.08 });
  }

  // Dense forest: big groves, plenty of loners — a real reserve canopy.
  for (let g = 0; g < 62; g++) {
    const gx = (rand() - 0.5) * 1600;
    const gz = (rand() - 0.5) * 1600;
    const gr = Math.hypot(gx, gz);
    if (gr < 60 || gr > 760) continue;
    const count = 9 + Math.floor(rand() * 18);
    for (let t = 0; t < count; t++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * (18 + count * 2.4);
      addTree(gx + Math.cos(a) * d, gz + Math.sin(a) * d);
    }
  }
  for (let i = 0; i < 170; i++) {
    const x = (rand() - 0.5) * 1600;
    const z = (rand() - 0.5) * 1600;
    const r = Math.hypot(x, z);
    if (r > 30 && r < 780) addTree(x, z);
  }


  const rockMat = toon(0x9a958a);
  for (let i = 0; i < 70; i++) {
    const x = (rand() - 0.5) * 1600;
    const z = (rand() - 0.5) * 1600;
    const r = Math.hypot(x, z);
    const ry = heightAt(x, z);
    if (r < 25 || r > 780 || distToPath(x, z) < 3 || ry < WATER_LEVEL + 0.6) continue;
    const s = 0.5 + rand() * 1.8;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
    rock.position.set(x, ry + s * 0.35, z);
    rock.rotation.set(rand() * Math.PI, rand() * Math.PI, 0);
    rock.castShadow = true;
    scene.add(rock);
  }

  // Hero tree — one grand old camphor on the highest hilltop nearby, the
  // Totoro landmark every horizon needs.
  let best = { x: 180, z: -160, h: -Infinity };
  for (let a = 0; a < 80; a++) {
    for (let r = 130; r <= 320; r += 24) {
      const x = Math.cos((a / 80) * Math.PI * 2) * r;
      const z = Math.sin((a / 80) * Math.PI * 2) * r;
      const h = heightAt(x, z);
      if (h > best.h) best = { x, z, h };
    }
  }
  addTree(best.x, best.z, 30);

  // --- Fire lookout tower: home base by the spawn pad ---
  {
    const TX = -11;
    const TZ = -14;
    const baseY = heightAt(TX, TZ);
    const PLAT = 9; // deck height
    const woodMat = toon(0x7a5a40);
    const deckMat = toon(0x8f6d4e);
    const wallMat = toon(0xe8dcc0);
    const roofMat = toon(0x9a4f3a);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd98a }); // warm at night
    const tower = new THREE.Group();

    const beam = (a, b, r0, r1) => {
      const dir = b.clone().sub(a);
      const len = dir.length();
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 6), woodMat);
      mesh.position.copy(a).addScaledVector(dir, 0.5);
      mesh.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
      mesh.castShadow = true;
      tower.add(mesh);
    };
    // Splayed legs: wide at the ground, tucked under the deck.
    const corner = (y, sx, sz) => {
      const half = 2.0 - 0.7 * (y / PLAT);
      return new THREE.Vector3(sx * half, y, sz * half);
    };
    const SIGNS = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
    for (const [sx, sz] of SIGNS) {
      beam(corner(0, sx, sz), corner(PLAT, sx, sz), 0.16, 0.12);
    }
    // X cross-bracing on all four sides, two tiers.
    for (let s = 0; s < 4; s++) {
      const [ax, az] = SIGNS[s];
      const [bx, bz] = SIGNS[(s + 1) % 4];
      for (const [y0, y1] of [[0.4, 4.6], [4.6, 8.8]]) {
        beam(corner(y0, ax, az), corner(y1, bx, bz), 0.05, 0.05);
        beam(corner(y0, bx, bz), corner(y1, ax, az), 0.05, 0.05);
      }
    }
    // Deck, railing, cabin, window band, hip roof, antenna.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.22, 4.9), deckMat);
    deck.position.y = PLAT + 0.11;
    deck.castShadow = true;
    tower.add(deck);
    for (const [sx, sz] of SIGNS) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), woodMat);
      post.position.set(sx * 2.38, PLAT + 0.7, sz * 2.38);
      tower.add(post);
    }
    for (let s = 0; s < 4; s++) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(4.84, 0.07, 0.07), woodMat);
      rail.position.y = PLAT + 1.15;
      rail.rotation.y = (s * Math.PI) / 2;
      rail.position.x = s % 2 === 0 ? 0 : (s === 1 ? 2.38 : -2.38);
      rail.position.z = s % 2 === 0 ? (s === 0 ? 2.38 : -2.38) : 0;
      tower.add(rail);
    }
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.4, 3.5), wallMat);
    cabin.position.y = PLAT + 0.22 + 1.2;
    cabin.castShadow = true;
    tower.add(cabin);
    for (let s = 0; s < 4; s++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.85, 0.06), glowMat);
      win.position.y = PLAT + 1.95;
      win.rotation.y = (s * Math.PI) / 2;
      win.position.x = s % 2 === 0 ? 0 : (s === 1 ? 1.76 : -1.76);
      win.position.z = s % 2 === 0 ? (s === 0 ? 1.76 : -1.76) : 0;
      tower.add(win);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.95, 1.5, 4), roofMat);
    roof.position.y = PLAT + 0.22 + 2.4 + 0.75;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    tower.add(roof);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.4, 6), woodMat);
    mast.position.y = PLAT + 4.9;
    tower.add(mast);

    tower.position.set(TX, baseY, TZ);
    tower.rotation.y = 0.3;
    scene.add(tower);

    // Colliders: four legs (fly between them!) and the cabin block.
    for (const [sx, sz] of SIGNS) {
      const c = corner(PLAT / 2, sx, sz);
      // Legs lean, so approximate each with a slightly fat mid-height post.
      const cos = Math.cos(0.3);
      const sin = Math.sin(0.3);
      colliders.push({
        x: TX + c.x * cos + c.z * sin,
        z: TZ - c.x * sin + c.z * cos,
        r: 0.45,
        top: baseY + PLAT,
      });
    }
    colliders.push({ x: TX, z: TZ, r: 3.1, top: baseY + PLAT + 4.4, base: baseY + PLAT - 0.4 });
  }

  // A couple of framing trees near home base.
  addTree(14, -24);
  addTree(-20, -16);
  addTree(-15, 22);

  return {
    sun,
    hemi,
    sunDirection,
    colliders,
    update(time) {
      for (const tree of swayers) {
        tree.rotation.z = Math.sin(time * 0.7 + tree.userData.phase) * tree.userData.amp;
        tree.rotation.x = Math.cos(time * 0.55 + tree.userData.phase * 1.3) * tree.userData.amp * 0.7;
      }
    },
  };
}

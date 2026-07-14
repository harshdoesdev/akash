import * as THREE from 'three';
import { makeRand } from './rng.js';
import { distToPath, WATER_LEVEL } from './terrain.js';

// Wildlife: rabbits, squirrels, bird flocks. All animation is procedural
// transforms (hop arcs, ear twitches, tail curls, wing flaps) — no rigs.
// Rabbits and squirrels flee when the drone buzzes them.

function toonGradient() {
  const tex = new THREE.DataTexture(new Uint8Array([150, 200, 245, 255]), 4, 1, THREE.RedFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const RABBIT_COUNT = 14;
const SQUIRREL_COUNT = 8;
const FLOCKS = 3;
const SHEEP_HERDS = 2;
const DEER_GROUPS = 2;

export function createCritters(scene, heightAt, colliders, worldSeed) {
  const rand = makeRand(worldSeed ^ 0x0c211e5);
  const gradient = toonGradient();
  const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: gradient });

  const groundOk = (x, z) =>
    Math.hypot(x, z) < 680 && heightAt(x, z) > WATER_LEVEL + 1.5 && distToPath(x, z) > 3;

  // ---------- Rabbits ----------
  const furMats = [toon(0xb99b83), toon(0x9d8873), toon(0xcbb39a)];
  const whiteMat = toon(0xf3efe6);
  const rabbits = [];

  function buildRabbit() {
    const g = new THREE.Group();
    const fur = furMats[Math.floor(rand() * furMats.length)];
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), fur);
    body.scale.set(1, 0.85, 1.25);
    body.position.y = 0.16;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), fur);
    head.position.set(0, 0.28, 0.15);
    g.add(head);
    const ears = [];
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.13, 3, 6), fur);
      ear.position.set(s * 0.05, 0.42, 0.12);
      ear.rotation.x = -0.15;
      ear.rotation.z = s * 0.12;
      g.add(ear);
      ears.push(ear);
    }
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), whiteMat);
    tail.position.set(0, 0.17, -0.2);
    g.add(tail);
    return { g, ears };
  }

  for (let i = 0; i < RABBIT_COUNT; i++) {
    let x, z;
    let tries = 0;
    do {
      x = (rand() - 0.5) * 1100;
      z = (rand() - 0.5) * 1100;
    } while (!groundOk(x, z) && ++tries < 30);
    if (tries >= 30) continue;
    const { g, ears } = buildRabbit();
    g.scale.setScalar(1.6); // storybook-sized so they read above the grass
    g.position.set(x, heightAt(x, z), z);
    g.rotation.y = rand() * Math.PI * 2;
    scene.add(g);
    rabbits.push({
      g, ears,
      mode: 'idle',
      timer: rand() * 3,
      heading: rand() * Math.PI * 2,
      hopsLeft: 0,
      phase: 0,
      twitch: rand() * 10,
    });
  }

  // ---------- Squirrels ----------
  const russet = toon(0xa2593a);
  const russetDark = toon(0x84462e);
  const squirrels = [];

  function buildSquirrel() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), russet);
    body.scale.set(1, 0.9, 1.5);
    body.position.y = 0.09;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), russet);
    head.position.set(0, 0.15, 0.13);
    g.add(head);
    const tailParts = [];
    const tailGeo = [0.05, 0.065, 0.05];
    const tailPos = [[0, 0.1, -0.13], [0, 0.2, -0.17], [0, 0.29, -0.12]];
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(new THREE.SphereGeometry(tailGeo[i], 8, 6), russetDark);
      t.position.set(...tailPos[i]);
      g.add(t);
      tailParts.push(t);
    }
    return { g, tailParts };
  }

  // Squirrels live at tree bases (colliders carry every tree's position).
  for (let i = 0; i < SQUIRREL_COUNT && colliders.length; i++) {
    const home = colliders[Math.floor(rand() * colliders.length)];
    if (!groundOk(home.x, home.z)) continue;
    const { g, tailParts } = buildSquirrel();
    g.scale.setScalar(1.4);
    g.position.set(home.x + 1, heightAt(home.x + 1, home.z), home.z);
    scene.add(g);
    squirrels.push({
      g, tailParts, home,
      mode: 'pause',
      timer: rand() * 2,
      heading: rand() * Math.PI * 2,
      dashLeft: 0,
    });
  }

  // ---------- Sheep ----------
  const woolMat = toon(0xede6d6);
  const sheepDark = toon(0x56493d);
  const sheep = [];

  function buildSheep() {
    const g = new THREE.Group();
    const wool = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), woolMat);
    wool.scale.set(1, 0.9, 1.3);
    wool.position.y = 0.52;
    wool.castShadow = true;
    g.add(wool);
    // Head on a neck pivot so it can graze.
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.62, 0.4);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), sheepDark);
    head.scale.set(0.8, 0.9, 1.1);
    head.position.set(0, 0, 0.12);
    headPivot.add(head);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 0.06), sheepDark);
      ear.position.set(s * 0.12, 0.05, 0.1);
      headPivot.add(ear);
    }
    g.add(headPivot);
    const legs = [];
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.36, 6), sheepDark);
      leg.position.set(sx * 0.16, 0.18, sz * 0.28);
      g.add(leg);
      legs.push(leg);
    }
    return { g, headPivot, legs };
  }

  for (let hIdx = 0; hIdx < SHEEP_HERDS; hIdx++) {
    let ax, az;
    let tries = 0;
    do {
      ax = (rand() - 0.5) * 1000;
      az = (rand() - 0.5) * 1000;
    } while (!groundOk(ax, az) && ++tries < 30);
    if (tries >= 30) continue;
    const count = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      const { g, headPivot, legs } = buildSheep();
      g.scale.setScalar(1.2);
      const x = ax + (rand() - 0.5) * 16;
      const z = az + (rand() - 0.5) * 16;
      if (!groundOk(x, z)) continue;
      g.position.set(x, heightAt(x, z), z);
      g.rotation.y = rand() * Math.PI * 2;
      scene.add(g);
      sheep.push({
        g, headPivot, legs,
        anchor: { x: ax, z: az },
        mode: 'graze',
        timer: rand() * 4,
        heading: rand() * Math.PI * 2,
        legPhase: rand() * 10,
      });
    }
  }

  // ---------- Deer ----------
  const fawnMat = toon(0xb08256);
  const fawnLeg = toon(0x97714d);
  const antlerMat = toon(0x6e5340);
  const deer = [];

  function buildDeer(buck) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), fawnMat);
    body.scale.set(0.85, 0.9, 1.8);
    body.position.y = 0.88;
    body.castShadow = true;
    g.add(body);
    // Neck pivot at the shoulders: down = graze, up = alert.
    const neckPivot = new THREE.Group();
    neckPivot.position.set(0, 1.0, 0.46);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.42, 7), fawnMat);
    neck.position.set(0, 0.18, 0.1);
    neck.rotation.x = 0.45;
    neckPivot.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), fawnMat);
    head.scale.set(0.8, 0.85, 1.3);
    head.position.set(0, 0.38, 0.28);
    neckPivot.add(head);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.03), fawnMat);
      ear.position.set(s * 0.1, 0.5, 0.2);
      ear.rotation.z = s * 0.5;
      neckPivot.add(ear);
      if (buck) {
        const antler = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.3, 5), antlerMat);
        antler.position.set(s * 0.07, 0.62, 0.18);
        antler.rotation.z = s * 0.55;
        neckPivot.add(antler);
        const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.16, 5), antlerMat);
        tine.position.set(s * 0.16, 0.7, 0.2);
        tine.rotation.z = s * 1.15;
        neckPivot.add(tine);
      }
    }
    g.add(neckPivot);
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), whiteMat);
    tail.position.set(0, 0.94, -0.56);
    g.add(tail);
    const legs = [];
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.026, 0.75, 6), fawnLeg);
      leg.position.set(sx * 0.15, 0.38, sz * 0.32);
      g.add(leg);
      legs.push(leg);
    }
    return { g, neckPivot, legs };
  }

  for (let dIdx = 0; dIdx < DEER_GROUPS; dIdx++) {
    let ax, az;
    let tries = 0;
    do {
      ax = (rand() - 0.5) * 1100;
      az = (rand() - 0.5) * 1100;
    } while (!groundOk(ax, az) && ++tries < 30);
    if (tries >= 30) continue;
    const count = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < count; i++) {
      const { g, neckPivot, legs } = buildDeer(i === 0); // one buck per group
      g.scale.setScalar(1.15);
      const x = ax + (rand() - 0.5) * 14;
      const z = az + (rand() - 0.5) * 14;
      if (!groundOk(x, z)) continue;
      g.position.set(x, heightAt(x, z), z);
      g.rotation.y = rand() * Math.PI * 2;
      scene.add(g);
      deer.push({
        g, neckPivot, legs,
        anchor: { x: ax, z: az },
        mode: 'graze',
        timer: rand() * 4,
        heading: rand() * Math.PI * 2,
        legPhase: rand() * 10,
        phase: 0,
      });
    }
  }

  // ---------- Bird flocks ----------
  const birdMat = toon(0x3d434b);
  const flocks = [];

  function buildBird() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 6), birdMat);
    body.rotation.x = Math.PI / 2; // nose forward (+z)
    g.add(body);
    const wings = [];
    for (const s of [-1, 1]) {
      const geo = new THREE.BoxGeometry(0.24, 0.012, 0.09);
      geo.translate(s * 0.12, 0, 0); // hinge at the body
      const wing = new THREE.Mesh(geo, birdMat);
      g.add(wing);
      wings.push(wing);
    }
    return { g, wings };
  }

  for (let f = 0; f < FLOCKS; f++) {
    const birds = [];
    const count = 5 + Math.floor(rand() * 4);
    for (let b = 0; b < count; b++) {
      const bird = buildBird();
      bird.offset = new THREE.Vector3((rand() - 0.5) * 8, (rand() - 0.5) * 3, (rand() - 0.5) * 8);
      bird.flapPhase = rand() * 10;
      bird.flapSpeed = 9 + rand() * 3;
      scene.add(bird.g);
      birds.push(bird);
    }
    flocks.push({
      birds,
      center: new THREE.Vector3((rand() - 0.5) * 800, 0, (rand() - 0.5) * 800),
      angle: rand() * Math.PI * 2,
      radius: 35 + rand() * 40,
      alt: 28 + rand() * 40,
      speed: (0.1 + rand() * 0.06) * (rand() < 0.5 ? 1 : -1),
      drift: rand() * Math.PI * 2,
    });
  }

  // ---------- Behaviors ----------
  const fwd = (heading) => new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));

  function stepGround(c, speed, dt) {
    const dir = fwd(c.heading);
    const nx = c.g.position.x + dir.x * speed * dt;
    const nz = c.g.position.z + dir.z * speed * dt;
    if (!groundOk(nx, nz)) {
      c.heading += Math.PI * (0.6 + rand() * 0.8); // bounce off bad ground
      return;
    }
    c.g.position.x = nx;
    c.g.position.z = nz;
    c.g.rotation.y = c.heading;
  }

  const legSwing = (legs, phase, amp) => {
    // Diagonal pairs swing opposite — a simple trot.
    legs[0].rotation.x = legs[3].rotation.x = Math.sin(phase) * amp;
    legs[1].rotation.x = legs[2].rotation.x = -Math.sin(phase) * amp;
  };

  return {
    debug: { rabbits, squirrels, flocks, sheep, deer },
    update(dt, time, dronePos, droneAgl) {
      const buzzing = droneAgl < 14;

      for (const r of rabbits) {
        const dist = Math.hypot(dronePos.x - r.g.position.x, dronePos.z - r.g.position.z);
        if (buzzing && dist < 9 && r.mode !== 'flee') {
          r.mode = 'flee';
          r.phase = 0;
        }
        r.timer -= dt;

        if (r.mode === 'idle') {
          // Ear twitches while nibbling.
          r.twitch += dt;
          const tw = Math.max(0, Math.sin(r.twitch * 7)) * Math.max(0, Math.sin(r.twitch * 0.9) - 0.7);
          r.ears[0].rotation.x = -0.15 - tw * 1.2;
          if (r.timer <= 0) {
            r.mode = 'hop';
            r.heading += (rand() - 0.5) * 2;
            r.hopsLeft = 1 + Math.floor(rand() * 3);
            r.phase = 0;
          }
        } else {
          const fleeing = r.mode === 'flee';
          if (fleeing) {
            r.heading = Math.atan2(r.g.position.x - dronePos.x, r.g.position.z - dronePos.z);
            r.ears[0].rotation.x = r.ears[1].rotation.x = -0.9; // ears pinned back
          }
          const hopDur = fleeing ? 0.28 : 0.42;
          r.phase += dt / hopDur;
          stepGround(r, fleeing ? 4.2 : 1.4, dt);
          const arc = Math.abs(Math.sin(r.phase * Math.PI));
          r.g.position.y = heightAt(r.g.position.x, r.g.position.z) + arc * (fleeing ? 0.32 : 0.22);
          if (r.phase >= 1) {
            r.phase = 0;
            if (fleeing) {
              if (dist > 20) { r.mode = 'idle'; r.timer = 1 + rand() * 2; r.ears[0].rotation.x = r.ears[1].rotation.x = -0.15; }
            } else if (--r.hopsLeft <= 0) {
              r.mode = 'idle';
              r.timer = 1 + rand() * 3.5;
              r.g.position.y = heightAt(r.g.position.x, r.g.position.z);
            }
          }
        }
      }

      for (const s of squirrels) {
        const dist = Math.hypot(dronePos.x - s.g.position.x, dronePos.z - s.g.position.z);
        const scared = buzzing && dist < 7;
        s.timer -= dt;

        if (s.mode === 'pause') {
          // Sit upright, tail curled, looking around.
          s.g.rotation.x = -0.4;
          s.tailParts[2].position.z = -0.1 + Math.sin(time * 2.2 + s.heading) * 0.03;
          if (s.timer <= 0 || scared) {
            s.mode = 'dash';
            s.g.rotation.x = 0;
            // Head somewhere near home (or straight away from the drone).
            s.heading = scared
              ? Math.atan2(s.g.position.x - dronePos.x, s.g.position.z - dronePos.z)
              : Math.atan2(s.home.x + (rand() - 0.5) * 24 - s.g.position.x, 0) + rand() * Math.PI * 2;
            s.dashLeft = 1.5 + rand() * 2.5;
          }
        } else {
          s.dashLeft -= dt * 3.2;
          stepGround(s, scared ? 4.5 : 3.2, dt);
          s.g.position.y = heightAt(s.g.position.x, s.g.position.z) + Math.abs(Math.sin(time * 18)) * 0.05;
          // Don't stray too far from the home tree.
          if (Math.hypot(s.g.position.x - s.home.x, s.g.position.z - s.home.z) > 20) {
            s.heading = Math.atan2(s.home.x - s.g.position.x, s.home.z - s.g.position.z);
          }
          if (s.dashLeft <= 0 && !scared) {
            s.mode = 'pause';
            s.timer = 0.6 + rand() * 2;
            s.g.position.y = heightAt(s.g.position.x, s.g.position.z);
          }
        }
      }

      for (const s of sheep) {
        const dist = Math.hypot(dronePos.x - s.g.position.x, dronePos.z - s.g.position.z);
        if (buzzing && dist < 11 && s.mode !== 'flee') s.mode = 'flee';
        s.timer -= dt;

        if (s.mode === 'graze') {
          s.headPivot.rotation.x = Math.min(0.95, s.headPivot.rotation.x + dt * 2);
          if (s.timer <= 0) {
            s.mode = rand() < 0.6 ? 'look' : 'amble';
            s.timer = s.mode === 'look' ? 1.5 + rand() * 2 : 2 + rand() * 3;
            s.heading = Math.atan2(
              s.anchor.x + (rand() - 0.5) * 20 - s.g.position.x,
              s.anchor.z + (rand() - 0.5) * 20 - s.g.position.z
            );
          }
        } else if (s.mode === 'look') {
          s.headPivot.rotation.x = Math.max(0, s.headPivot.rotation.x - dt * 3);
          if (s.timer <= 0) { s.mode = 'graze'; s.timer = 2 + rand() * 5; }
        } else {
          const fleeing = s.mode === 'flee';
          if (fleeing) {
            s.heading = Math.atan2(s.g.position.x - dronePos.x, s.g.position.z - dronePos.z);
            s.headPivot.rotation.x = 0;
          } else {
            s.headPivot.rotation.x = Math.max(0, s.headPivot.rotation.x - dt * 3);
          }
          const speed = fleeing ? 3.6 : 1.0;
          s.legPhase += dt * speed * 5;
          legSwing(s.legs, s.legPhase, 0.45);
          stepGround(s, speed, dt);
          s.g.position.y = heightAt(s.g.position.x, s.g.position.z);
          if (fleeing) {
            if (dist > 26) { s.mode = 'graze'; s.timer = 2 + rand() * 3; legSwing(s.legs, 0, 0); }
          } else if (s.timer <= 0) {
            s.mode = 'graze';
            s.timer = 3 + rand() * 5;
            legSwing(s.legs, 0, 0);
          }
        }
      }

      for (const d of deer) {
        const dist = Math.hypot(dronePos.x - d.g.position.x, dronePos.z - d.g.position.z);
        if (buzzing && dist < 13 && d.mode !== 'flee') { d.mode = 'flee'; d.phase = 0; }
        else if (buzzing && dist < 30 && d.mode !== 'flee' && d.mode !== 'alert') {
          d.mode = 'alert';
          d.timer = 0.5;
        }
        d.timer -= dt;

        if (d.mode === 'graze') {
          d.neckPivot.rotation.x = Math.min(1.1, d.neckPivot.rotation.x + dt * 2.5);
          if (d.timer <= 0) {
            d.mode = 'walk';
            d.timer = 2 + rand() * 3;
            d.heading = Math.atan2(
              d.anchor.x + (rand() - 0.5) * 30 - d.g.position.x,
              d.anchor.z + (rand() - 0.5) * 30 - d.g.position.z
            );
          }
        } else if (d.mode === 'alert') {
          // Freeze, head snapped up, facing the threat.
          d.neckPivot.rotation.x = Math.max(0.05, d.neckPivot.rotation.x - dt * 6);
          d.g.rotation.y = Math.atan2(dronePos.x - d.g.position.x, dronePos.z - d.g.position.z);
          if (!buzzing || dist > 34) { d.mode = 'graze'; d.timer = 1 + rand() * 3; }
        } else if (d.mode === 'walk') {
          d.neckPivot.rotation.x = Math.max(0.15, d.neckPivot.rotation.x - dt * 2);
          d.legPhase += dt * 4.5;
          legSwing(d.legs, d.legPhase, 0.4);
          stepGround(d, 1.3, dt);
          d.g.position.y = heightAt(d.g.position.x, d.g.position.z);
          if (d.timer <= 0) { d.mode = 'graze'; d.timer = 3 + rand() * 5; legSwing(d.legs, 0, 0); }
        } else {
          // Flee: long graceful bounds.
          d.heading = Math.atan2(d.g.position.x - dronePos.x, d.g.position.z - dronePos.z);
          d.neckPivot.rotation.x = -0.1;
          d.phase += dt / 0.5; // bound duration
          d.legPhase += dt * 9;
          legSwing(d.legs, d.legPhase, 0.7);
          stepGround(d, 6.5, dt);
          const arc = Math.abs(Math.sin(d.phase * Math.PI));
          d.g.position.y = heightAt(d.g.position.x, d.g.position.z) + arc * 0.55;
          if (d.phase >= 1) {
            d.phase = 0;
            if (dist > 38) {
              d.mode = 'graze';
              d.timer = 2 + rand() * 3;
              d.g.position.y = heightAt(d.g.position.x, d.g.position.z);
              legSwing(d.legs, 0, 0);
            }
          }
        }
      }

      for (const f of flocks) {
        f.angle += f.speed * dt;
        f.drift += dt * 0.02;
        const cx = f.center.x + Math.cos(f.drift) * 60;
        const cz = f.center.z + Math.sin(f.drift * 1.3) * 60;
        for (const b of f.birds) {
          const a = f.angle + b.offset.x * 0.02;
          const px = cx + Math.cos(a) * f.radius + b.offset.x;
          const pz = cz + Math.sin(a) * f.radius + b.offset.z;
          const py = f.alt + b.offset.y + Math.sin(time * 0.7 + b.flapPhase) * 1.5;
          b.g.position.set(px, py, pz);
          // Face along the tangent, bank into the turn.
          b.g.rotation.y = -a - (f.speed > 0 ? 0 : Math.PI);
          b.g.rotation.z = f.speed > 0 ? -0.25 : 0.25;
          // Flap-and-glide cycle.
          const gliding = Math.sin(time * 0.35 + b.flapPhase) > 0.45;
          const flap = gliding ? 0.1 : Math.sin(time * b.flapSpeed + b.flapPhase) * 0.65;
          b.wings[0].rotation.z = flap;
          b.wings[1].rotation.z = -flap;
        }
      }
    },
  };
}

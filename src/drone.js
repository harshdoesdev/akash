import * as THREE from 'three';
import { texture, ready } from './assets.js';

// Arcade "angle mode" flight model (think DJI normal mode):
// - tilt inputs set a target attitude, the drone eases toward it and
//   self-levels when you let go
// - tilt produces horizontal acceleration, drag caps top speed
// - vertical input sets a target climb rate (altitude hold at zero input)
// Tune everything here — these constants ARE the game feel.
const TUNING = {
  maxTilt: THREE.MathUtils.degToRad(32),
  tiltFreq: 8.0,          // attitude spring frequency (rad/s)
  tiltDamping: 0.72,      // <1 = slight overshoot, reads organic not robotic
  yawRate: 2.4,           // rad/s at full input
  yawResponse: 4.5,       // yaw inertia: turns ramp in/out (1/s)
  bankIntoTurn: 0.26,     // coordinated lean while yawing
  tiltAccel: 34.0,        // horizontal accel at full tilt (m/s^2)
  drag: 0.55,             // horizontal drag coefficient (1/s)
  climbRate: 9.0,         // max vertical speed (m/s)
  climbResponse: 4.0,     // how fast vertical speed chases target (1/s)
  ceiling: 35,            // max height above ground — climb fades out approaching it
  groundClearance: 0.14,  // rest on the skids (rail bottoms ≈ -0.137)
};

// "Ghibli machine" drone: real quad anatomy (arms, motor bells, two-blade
// props, gimbal camera, skids, antenna, nav lights) with rounded friendly
// proportions and the world's cream/orange palette.
function toonGradient() {
  const tex = new THREE.DataTexture(new Uint8Array([150, 200, 245, 255]), 4, 1, THREE.RedFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export function buildDroneMesh() {
  const group = new THREE.Group();
  const gradient = toonGradient();
  const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: gradient });

  const cream = toon(0xf2ead8);
  const orange = toon(0xd97b4f);
  const dark = toon(0x2f3439);
  const gray = toon(0x565e66);

  // Hand-painted texture atlas (public/drone-atlas.png), four 512px quadrants:
  // cream TL, orange TR, charcoal BL, gray BR. Preloaded by assets.js;
  // keeps flat colors if the file is missing.
  if (ready('droneAtlas')) {
    const atlas = texture('droneAtlas');
    const apply = (mat, ox, oy) => {
      const t = atlas.clone();
      t.repeat.set(0.5, 0.5);
      t.offset.set(ox, oy);
      t.needsUpdate = true;
      mat.map = t;
      mat.color.set(0xffffff); // the texture carries the color now
    };
    apply(cream, 0, 0.5);
    apply(orange, 0.5, 0.5);
    apply(dark, 0, 0);
    apply(gray, 0.5, 0);
  }

  const shadowed = (mesh) => {
    mesh.castShadow = true;
    return mesh;
  };

  // Hull: main body + raised canopy toward the nose + belly plate.
  const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.11, 0.46), cream));
  group.add(body);
  const canopy = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.26), cream));
  canopy.position.set(0, 0.08, -0.05);
  group.add(canopy);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.045, 0.06), dark);
  visor.position.set(0, 0.085, -0.17);
  group.add(visor);
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.36), gray);
  belly.position.y = -0.065;
  group.add(belly);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.305, 0.028, 0.46), orange);
  stripe.position.y = 0.045;
  group.add(stripe);

  // Camera gimbal under the nose.
  const gimbal = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10), gray);
  gimbal.rotation.x = Math.PI / 2;
  gimbal.position.set(0, -0.06, -0.21);
  group.add(gimbal);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 10), toon(0x141b21));
  lens.position.set(0, -0.06, -0.235);
  group.add(lens);

  // Antenna at the tail.
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 6), dark);
  antenna.position.set(0.08, 0.13, 0.2);
  antenna.rotation.z = -0.25;
  group.add(antenna);
  const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), orange);
  antennaTip.position.set(0.098, 0.2, 0.2);
  group.add(antennaTip);

  // Nav lights (unlit = they glow): red left, green right, aviation-correct.
  const navL = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff4436 }));
  navL.position.set(-0.15, 0.02, 0.2);
  group.add(navL);
  const navR = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), new THREE.MeshBasicMaterial({ color: 0x3dd45f }));
  navR.position.set(0.15, 0.02, 0.2);
  group.add(navR);

  // Landing skids: two rails on struts.
  const railGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6);
  const strutGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.09, 6);
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, gray);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(sx * 0.13, -0.125, 0);
    group.add(rail);
    for (const sz of [-1, 1]) {
      const strut = new THREE.Mesh(strutGeo, gray);
      strut.position.set(sx * 0.13, -0.085, sz * 0.12);
      strut.rotation.z = sx * 0.15;
      group.add(strut);
    }
  }

  // Arms, motor bells, two-blade props with blur discs.
  const props = [];
  const discs = [];
  const armGeo = new THREE.CylinderGeometry(0.021, 0.027, 0.30, 8);
  const bellGeo = new THREE.CylinderGeometry(0.042, 0.048, 0.06, 10);
  const capGeo = new THREE.CylinderGeometry(0.044, 0.044, 0.014, 10);
  const hubGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.035, 8);
  const bladeGeo = new THREE.BoxGeometry(0.152, 0.007, 0.032);

  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const mx = sx * 0.27;
    const mz = sz * 0.27;

    const arm = shadowed(new THREE.Mesh(armGeo, dark));
    arm.position.set(mx * 0.55, 0.01, mz * 0.55);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = -Math.atan2(mz, mx);
    group.add(arm);

    const bell = shadowed(new THREE.Mesh(bellGeo, gray));
    bell.position.set(mx, 0.035, mz);
    group.add(bell);
    const cap = new THREE.Mesh(capGeo, orange);
    cap.position.set(mx, 0.072, mz);
    group.add(cap);

    const prop = new THREE.Group();
    prop.position.set(mx, 0.095, mz);
    const hub = new THREE.Mesh(hubGeo, dark);
    prop.add(hub);
    for (const side of [-1, 1]) {
      const blade = new THREE.Mesh(bladeGeo, dark);
      blade.position.x = side * 0.088;
      blade.rotation.x = side * 0.35; // blade pitch
      prop.add(blade);
    }
    prop.rotation.y = (sx + sz) * 0.7; // don't start all aligned
    group.add(prop);
    props.push(prop);

    // Motion-blur disc fades in as the props spin up.
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.165, 20),
      new THREE.MeshBasicMaterial({
        color: 0x3a4047,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(mx, 0.096, mz);
    group.add(disc);
    discs.push(disc);
  }

  return { group, props, discs };
}

export class Drone {
  constructor(scene, heightAt = () => 0, colliders = []) {
    const { group, props, discs } = buildDroneMesh();
    // Physics owns this.mesh; this.visual carries hover-bob/wobble on top.
    this.visual = group;
    this.mesh = new THREE.Group();
    this.mesh.add(this.visual);
    this.props = props;
    this.discs = discs;
    scene.add(this.mesh);

    this.heightAt = heightAt;
    this.colliders = colliders;
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0; // + = nose down
    this.roll = 0;  // + = bank right
    this.yawVel = 0;
    this.pitchVel = 0;
    this.rollVel = 0;
    this.airFactor = 0;
    this.time = 0;
    this.throttleVisual = 0;
    this.reset();
  }

  reset() {
    this.mesh.position.set(0, this.heightAt(0, 0) + TUNING.groundClearance, 0);
    this.velocity.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.rollVel = 0;
    this.airFactor = 0;
  }

  update(dt, input) {
    if (input.reset) this.reset();
    this.time += dt;

    const ease = (rate) => 1 - Math.exp(-rate * dt);

    // Yaw has inertia: turn rate ramps in and out instead of snapping.
    this.yawVel += (input.yaw * TUNING.yawRate - this.yawVel) * ease(TUNING.yawResponse);
    this.yaw += this.yawVel * dt;

    // Attitude: underdamped springs — a touch of overshoot on stick changes,
    // plus a coordinated bank while yawing. This is what kills the robot feel.
    const targetPitch = input.pitch * TUNING.maxTilt;
    // Negative: positive yawVel = CCW/left turn, which banks LEFT (-roll).
    const targetRoll = input.roll * TUNING.maxTilt - this.yawVel * TUNING.bankIntoTurn;
    const w = TUNING.tiltFreq;
    const zeta = TUNING.tiltDamping;
    this.pitchVel += ((targetPitch - this.pitch) * w * w - 2 * zeta * w * this.pitchVel) * dt;
    this.pitch += this.pitchVel * dt;
    this.rollVel += ((targetRoll - this.roll) * w * w - 2 * zeta * w * this.rollVel) * dt;
    this.roll += this.rollVel * dt;

    // Tilt → horizontal acceleration in the drone's yaw frame.
    const tiltX = Math.sin(this.roll) * TUNING.tiltAccel;   // + = right
    const tiltZ = -Math.sin(this.pitch) * TUNING.tiltAccel; // + pitch = forward (-z local)
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    this.velocity.x += (tiltX * cos + tiltZ * sin) * dt;
    this.velocity.z += (-tiltX * sin + tiltZ * cos) * dt;

    // Horizontal drag caps top speed.
    const dragFactor = Math.exp(-TUNING.drag * dt);
    this.velocity.x *= dragFactor;
    this.velocity.z *= dragFactor;

    // Soft world boundary: past the reserve, a headwind shepherds you home.
    const bx = this.mesh.position.x;
    const bz = this.mesh.position.z;
    const br = Math.hypot(bx, bz);
    if (br > 780) {
      const push = Math.min(1, (br - 780) / 120) * 30;
      this.velocity.x -= (bx / br) * push * dt;
      this.velocity.z -= (bz / br) * push * dt;
    }

    // Vertical: altitude hold, climb input sets target vertical speed.
    const groundY = this.heightAt(this.mesh.position.x, this.mesh.position.z) + TUNING.groundClearance;
    const grounded = this.mesh.position.y <= groundY + 0.001;
    let targetVy = input.climb * TUNING.climbRate;
    // Ceiling is height above ground. Climb authority fades over the last
    // 8m below it; drifting over a cliff edge sinks the drone back down
    // gently instead of teleport-clamping.
    const agl = this.mesh.position.y - groundY + TUNING.groundClearance;
    const ceilT = (agl - (TUNING.ceiling - 8)) / 8;
    if (targetVy > 0 && ceilT > 0) targetVy *= Math.max(0, 1 - ceilT);
    if (agl > TUNING.ceiling) {
      targetVy = Math.min(targetVy, -(agl - TUNING.ceiling) * 1.2);
    }
    this.velocity.y += (targetVy - this.velocity.y) * ease(TUNING.climbResponse);

    this.mesh.position.addScaledVector(this.velocity, dt);

    // Ground: land softly, don't slide while parked.
    const newGroundY = this.heightAt(this.mesh.position.x, this.mesh.position.z) + TUNING.groundClearance;
    if (this.mesh.position.y < newGroundY) {
      this.mesh.position.y = newGroundY;
      this.velocity.y = Math.max(0, this.velocity.y);
      if (grounded && input.climb <= 0) {
        this.velocity.x *= Math.exp(-8 * dt);
        this.velocity.z *= Math.exp(-8 * dt);
      }
    }

    // Tree trunks are solid: push out of the cylinder, bounce a little.
    const bodyR = 0.32;
    for (const c of this.colliders) {
      if (this.mesh.position.y > c.top) continue;
      if (c.base !== undefined && this.mesh.position.y < c.base) continue;
      const dx = this.mesh.position.x - c.x;
      const dz = this.mesh.position.z - c.z;
      const R = c.r + bodyR;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const nz = dz / d;
      this.mesh.position.x = c.x + nx * R;
      this.mesh.position.z = c.z + nz * R;
      const vn = this.velocity.x * nx + this.velocity.z * nz;
      if (vn < 0) {
        this.velocity.x -= nx * vn * 1.5; // soft elastic thunk
        this.velocity.z -= nz * vn * 1.5;
      }
    }

    // Compose orientation: yaw in world, then pitch/roll in the local frame.
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.rotateY(this.yaw);
    this.mesh.rotateX(-this.pitch); // +pitch = nose down = negative X rotation

    this.mesh.rotateZ(-this.roll);

    // Props spin with activity level — pure visual.
    const activity = grounded && input.climb <= 0
      ? 0.15
      : 0.6 + Math.abs(input.climb) * 0.4 + Math.abs(input.pitch) * 0.15;
    this.throttleVisual += (activity - this.throttleVisual) * ease(5);
    for (const [i, prop] of this.props.entries()) {
      prop.rotation.y += (i % 2 ? 1 : -1) * this.throttleVisual * 80 * dt;
    }
    // Blur discs fade in as props spin up; blades stay for silhouette.
    for (const disc of this.discs) {
      disc.material.opacity = Math.max(0, this.throttleVisual - 0.2) * 0.4;
    }

    // Idle hover bob + tiny wobble: airborne drones are never perfectly still.
    this.airFactor += ((grounded ? 0 : 1) - this.airFactor) * ease(3);
    const t = this.time;
    this.visual.position.y =
      (Math.sin(t * 1.9) + Math.sin(t * 2.7 + 1.3) * 0.6) * 0.02 * this.airFactor;
    this.visual.rotation.z = Math.sin(t * 1.4 + 0.5) * 0.013 * this.airFactor;
    this.visual.rotation.x = Math.sin(t * 1.1 + 2.1) * 0.011 * this.airFactor;
  }

  get position() {
    return this.mesh.position;
  }

  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }
}

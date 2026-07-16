import * as THREE from 'three/webgpu';
import { makeRand } from './rng.js';
import { createLeafPool } from './leafBillboards.js';

// Windways: permanent rivers of air looping across the valley — the anime
// "air highway". Each is a closed seeded spline riding over the terrain,
// drawn as a stream of carried leaves swirling along the current (wind made
// visible the Ghibli way — by what it carries). Fly into one and the current
// catches the drone: strong push along the flow, a gentle pull toward the
// lane's center — a racing line made of weather, no rings, no UI.
const WAYS = 1; // one circuit for now — three lanes of leaves cost real frames
// The lane reads as a procession of dense gust-comets, not a uniform
// sprinkle — leaves every few meters vanish; dozens in a 10m trail read.
// Spacing ~40m keeps a comet or two always in sight while riding the lane.
const CLUSTERS_PER = 24;
const LEAVES_PER_CLUSTER = 55;
const TUBE_R = 5;      // how close you must be to get caught
const FLOW_SPEED = 30; // the current's own airspeed (m/s)

export function createWindways(scene, heightAt, worldSeed) {
  const rand = makeRand(worldSeed ^ 0xa17c47);

  // ---- Build closed loops over the landscape.
  const ways = [];
  for (let w = 0; w < WAYS; w++) {
    const cx = (rand() - 0.5) * 500;
    const cz = (rand() - 0.5) * 500;
    const baseR = 130 + rand() * 200;
    const pts = [];
    const N = 10;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = baseR * (0.7 + rand() * 0.6);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r * (0.75 + rand() * 0.5);
      const y = heightAt(x, z) + 13 + rand() * 12;
      pts.push(new THREE.Vector3(x, y, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    // Dense sample table for cheap nearest-point physics + leaf motion.
    // getSpacedPoints on a closed curve repeats the first point at the end —
    // drop it, or the seam tangent is normalize(0) = NaN.
    const samples = curve.getSpacedPoints(600);
    samples.pop();
    // Height is only set at the 10 control points — terrain can rise into
    // the path between them and the lane would slice through hillsides.
    // Clamp every sample to a minimum clearance, then smooth the kinks out.
    const n = samples.length;
    for (const p of samples) p.y = Math.max(p.y, heightAt(p.x, p.z) + 9);
    for (let pass = 0; pass < 2; pass++) {
      const ys = samples.map((p) => p.y);
      for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let k = -6; k <= 6; k++) acc += ys[(i + k + n) % n];
        samples[i].y = acc / 13;
      }
    }
    for (const p of samples) p.y = Math.max(p.y, heightAt(p.x, p.z) + 8);
    const tangents = samples.map((p, i) => {
      const nx = samples[(i + 1) % samples.length];
      return nx.clone().sub(p).normalize();
    });
    const length = curve.getLength();
    ways.push({
      samples, tangents, length,
      nearest: 0, // cached nearest-sample index for local search
      dir: rand() < 0.5 ? 1 : -1,
    });
  }

  // ---- Gust-comets: dense clusters of leaves marching along each loop.
  const clusters = [];
  for (let w = 0; w < WAYS; w++) {
    const way = ways[w];
    for (let c = 0; c < CLUSTERS_PER; c++) {
      clusters.push({
        way,
        s: rand() * 600,                      // head position along the table
        speed: (FLOW_SPEED * (0.8 + rand() * 0.35)) * (600 / way.length),
        trailS: (9 + rand() * 7) * (600 / way.length), // comet length, samples
        // Lifecycle: swell in, ride the current a good while, dissolve,
        // respawn elsewhere — but never blink in and out.
        lifeT: 10 + rand() * 8,
        lifeOff: rand() * 36,
        prevLp: 0,
        env: 0,
      });
    }
  }
  const COUNT = clusters.length * LEAVES_PER_CLUSTER;
  const pool = createLeafPool(scene, COUNT);
  const leaves = [];
  for (let i = 0; i < COUNT; i++) {
    const cluster = clusters[Math.floor(i / LEAVES_PER_CLUSTER)];
    leaves.push({
      cluster,
      trail: rand(),                          // 0 head … 1 tail of the comet
      lane: (rand() - 0.5) * 2,               // offset within the comet
      laneY: (rand() - 0.5) * 1.6,
      // Ω-loops: a cycloid in the along/up plane — in the comet's moving
      // frame each leaf rises up-and-over in little loop-the-loops instead
      // of orbiting like clockwork.
      loopAmp: 0.5 + rand() * 1.3,
      loopW: 1.2 + rand() * 1.4,
      loopP: rand() * Math.PI * 2,
      swirlR: 0.25 + rand() * 0.85,           // loose helix around the current
      swirlW: 0.8 + rand() * 1.2,
      swirlP: rand() * Math.PI * 2,
      spinW: (rand() - 0.5) * 10,             // screen-plane tumble
      spinP: rand() * Math.PI * 2,
      size: 0.15 + rand() * 0.15,             // half-extent of the sprite
    });
    const kindRoll = rand();
    // Mostly sunlit gold (the lane's own color — green leaves vanish over a
    // green meadow), some canopy green, the odd petal pink.
    pool.setStyle(i, rand(), kindRoll < 0.6 ? 0 : kindRoll < 0.85 ? 0.5 : 1);
  }

  const api = {
    riding: 0, // 0..1 — how caught the drone currently is (for audio/FX)
    list: ways,
    _leaves: leaves, // dev: live art tuning from the console
    _clusters: clusters,
    update(dt, time, drone, playing = true, camPos = drone.position) {
      // March the gust-comets along their currents.
      for (const cl of clusters) {
        const M = cl.way.samples.length;
        cl.s = (cl.s + cl.speed * cl.way.dir * dt + M) % M;
        // Lifecycle: swell in, glide, dissolve, respawn somewhere new.
        const lp = ((time + cl.lifeOff) / cl.lifeT) % 1;
        if (lp < cl.prevLp) cl.s = rand() * M;
        cl.prevLp = lp;
        let env = 1;
        if (lp < 0.15) env = lp / 0.15;
        else if (lp > 0.85) env = (1 - lp) / 0.15;
        cl.env = env * env * (3 - 2 * env);
      }

      // Place each comet's leaves along its trail.
      for (let i = 0; i < leaves.length; i++) {
        const lf = leaves[i];
        const cl = lf.cluster;
        const M = cl.way.samples.length;
        // Leaves thin out gently toward the comet's tail.
        const env = cl.env * (1 - lf.trail * 0.35);
        const sp = (cl.s - lf.trail * cl.trailS * cl.way.dir + M * 4) % M;
        const i0 = Math.floor(sp);
        const p0 = cl.way.samples[i0];
        const p1 = cl.way.samples[(i0 + 1) % M];
        const f = sp - i0;
        const tan = cl.way.tangents[i0];
        // Ω-loop (cycloid) + a wobbling helix — never clockwork.
        const th = time * lf.loopW + lf.loopP;
        const along = Math.sin(th) * lf.loopAmp;
        const rise = (1 - Math.cos(th)) * lf.loopAmp * 0.6;
        const ang = time * lf.swirlW + lf.swirlP
          + Math.sin(time * 0.5 + lf.loopP) * 0.9;
        const lat = lf.lane + Math.cos(ang) * lf.swirlR;
        const upo = lf.laneY + Math.sin(ang) * lf.swirlR * 0.4 + rise;
        const ax = tan.x * cl.way.dir * along;
        const az = tan.z * cl.way.dir * along;
        const cx = p0.x + (p1.x - p0.x) * f - tan.z * lat + ax;
        const cy = p0.y + (p1.y - p0.y) * f + upo;
        const cz = p0.z + (p1.z - p0.z) * f + tan.x * lat + az;
        // Shrink to nothing as a leaf whooshes right past the camera.
        const dx = camPos.x - cx;
        const dy = camPos.y - cy;
        const dz = camPos.z - cz;
        const d = Math.hypot(dx, dy, dz);
        const near = Math.min(1, Math.max(0, (d - 1) / 2.5));
        pool.write(i, cx, cy, cz, lf.size * env * near,
          time * lf.spinW + lf.spinP, camPos);
      }
      pool.commit();

      // The current catches the drone: local nearest-point search per way.
      // Menus: leaves still flow, but the unmanned drone is left alone.
      if (!playing) { api.riding = 0; return; }
      let riding = 0;
      for (const way of ways) {
        const M = way.samples.length;
        let bestI = way.nearest;
        let bestD = Infinity;
        for (let k = -40; k <= 40; k += 2) {
          const idx = (way.nearest + k + M * 4) % M;
          const p = way.samples[idx];
          const d = p.distanceToSquared(drone.position);
          if (d < bestD) { bestD = d; bestI = idx; }
        }
        // Periodic global re-scan so a way can be re-entered anywhere.
        if (bestD > 120 * 120) {
          for (let idx = 0; idx < M; idx += 12) {
            const d = way.samples[idx].distanceToSquared(drone.position);
            if (d < bestD) { bestD = d; bestI = idx; }
          }
        }
        way.nearest = bestI;
        const dist = Math.sqrt(bestD);
        if (dist < TUBE_R) {
          const strength = 1 - dist / TUBE_R;
          const tan = way.tangents[bestI];
          const flow = 1 - Math.pow(1 - Math.min(1, 2.2 * dt), 1); // ≈2.2*dt
          // Push along the flow…
          drone.velocity.x += (tan.x * way.dir * FLOW_SPEED - drone.velocity.x) * flow * strength;
          drone.velocity.y += (tan.y * way.dir * FLOW_SPEED * 0.6 - drone.velocity.y) * flow * strength * 0.5;
          drone.velocity.z += (tan.z * way.dir * FLOW_SPEED - drone.velocity.z) * flow * strength;
          // …and a gentle pull toward the lane's spine.
          const cp = way.samples[bestI];
          drone.velocity.x += (cp.x - drone.position.x) * 0.8 * strength * dt * 10;
          drone.velocity.y += (cp.y - drone.position.y) * 0.8 * strength * dt * 10;
          drone.velocity.z += (cp.z - drone.position.z) * 0.8 * strength * dt * 10;
          riding = Math.max(riding, strength);
        }
      }
      api.riding = riding;
    },
  };
  return api;
}

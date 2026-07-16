import * as THREE from 'three/webgpu';
import { createGhost, GHOST_HZ } from './ghost.js';
import { createLeafPool } from './leafBillboards.js';

// Racing: every windway loop is a lap course — the current is the track, the
// boost, and the racing line all at once. A lantern ring marks each way's
// start; fly through it and the clock runs. Progress is position along the
// way's sample table (the physics already tracks it), so there are no
// checkpoints — just a corridor: drift too far off the spine for too long
// and the run is void. Finishing a lap rolls straight into the next one.
// Best time + a 10Hz recording of that run persist per (seed, way); the
// recording plays back as a ghost to chase.
const GATE_R = 5.4;      // ring radius — matches the lane's visual width
const CORRIDOR = 16;     // m off the spine before you're losing the wind
const GRACE = 2.5;       // s allowed outside the corridor
const NAMES = ['I', 'II', 'III', 'IV', 'V'];

function fmt(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

export function createRace(scene, ways, drone, seedStr) {
  const hudEl = document.getElementById('race-hud');
  const msgEl = document.getElementById('race-msg');
  const ghost = createGhost(scene);

  const storeKey = (wIdx) => `akash.race.v1.${seedStr}.${wIdx}`;
  const loadBest = (wIdx) => {
    try { return JSON.parse(localStorage.getItem(storeKey(wIdx))); }
    catch { return null; }
  };
  const saveBest = (wIdx, best) => {
    try { localStorage.setItem(storeKey(wIdx), JSON.stringify(best)); }
    catch { /* storage full/blocked — the run still counts, it just won't keep */ }
  };

  // ---- Start gates: a halo of orbiting leaves around the way's spine.
  // No primitive shapes — the ring IS leaves, the same stuff the wind
  // carries.
  const HALO_N = 56;
  const halo = createLeafPool(scene, ways.length * HALO_N);
  const haloLeaves = [];
  const gates = ways.map((way, wIdx) => {
    const pos = way.samples[0].clone();
    const tan = way.tangents[0].clone().multiplyScalar(way.dir).normalize();
    const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    const up = new THREE.Vector3().crossVectors(tan, side).normalize();

    const gate = { way, wIdx, pos, tan, side, up, prevS: null };
    for (let i = 0; i < HALO_N; i++) {
      const gi = wIdx * HALO_N + i;
      haloLeaves.push({
        gate,
        baseA: (i / HALO_N) * Math.PI * 2,
        // Two counter-rotating rings feel alive; one direction is a gear.
        orbitW: (i % 2 ? 0.35 : -0.28) * (0.8 + Math.random() * 0.4),
        wobP: Math.random() * Math.PI * 2,
        spinW: (Math.random() - 0.5) * 9,
        spinP: Math.random() * Math.PI * 2,
        size: 0.16 + Math.random() * 0.14,
      });
      // Gate halos are gold with a scatter of petals — a warm beacon.
      halo.setStyle(gi, Math.random(), Math.random() < 0.75 ? 0 : 1);
    }
    return gate;
  });

  // ---- Messages: one airy line, center-high. say() holds for a beat; the
  // near-a-gate hint fills the quiet.
  let msgTimer = 0;
  function say(text, hold = 2.8) {
    msgEl.textContent = text;
    msgEl.classList.add('show');
    msgTimer = hold;
  }

  let racing = null;
  let cooldown = 0;
  const prevPos = new THREE.Vector3();
  const rel = new THREE.Vector3();

  function start(gate) {
    const best = loadBest(gate.wIdx);
    racing = {
      gate,
      way: gate.way,
      wIdx: gate.wIdx,
      elapsed: 0,
      progressed: 0,
      lastNearest: gate.way.nearest,
      offTime: 0,
      rec: [],
      recTime: 0,
      best,
    };
    record();
    if (best?.ghost) ghost.start(best.ghost);
    hudEl.classList.add('active');
    say(`windway ${NAMES[racing.wIdx]} — go`);
  }

  function record() {
    const r = racing.rec;
    r.push(
      Math.round(drone.position.x * 100) / 100,
      Math.round(drone.position.y * 100) / 100,
      Math.round(drone.position.z * 100) / 100,
      Math.round(drone.yaw * 1000) / 1000,
      Math.round(drone.pitch * 1000) / 1000,
      Math.round(drone.roll * 1000) / 1000,
    );
  }

  function endRun() {
    ghost.stop();
    hudEl.classList.remove('active');
    racing = null;
    cooldown = 1.5;
  }

  function finish() {
    record(); // final sample so the ghost crosses the line
    const t = racing.elapsed;
    const { best, wIdx, gate } = racing;
    if (!best || t < best.time) {
      saveBest(wIdx, { time: t, hz: GHOST_HZ, ghost: racing.rec });
      say(best ? `new best — ${fmt(t)}` : `lap — ${fmt(t)}`);
    } else {
      say(`${fmt(t)}  ·  best ${fmt(best.time)}`);
    }
    endRun();
    start(gate); // a finished lap rolls straight into the next
  }

  const api = {
    get racing() { return !!racing; },

    update(dt, time, playing, camPos = drone.position) {
      // Gate ambience runs even on the menu — the world is the menu art.
      // The halo: two counter-rotating rings of leaves around each gate,
      // breathing in radius, sprite size compensated with distance so the
      // circle still reads from across the map.
      for (let i = 0; i < haloLeaves.length; i++) {
        const hl = haloLeaves[i];
        const g = hl.gate;
        const active = racing && racing.gate === g ? 1.35 : 1;
        const a = hl.baseA + time * hl.orbitW;
        const r = GATE_R + Math.sin(time * 0.8 + hl.wobP) * 0.4;
        const drift = Math.sin(time * 0.6 + hl.wobP * 1.7) * 0.45;
        const cx = g.pos.x + (g.side.x * Math.cos(a) + g.up.x * Math.sin(a)) * r + g.tan.x * drift;
        const cy = g.pos.y + (g.side.y * Math.cos(a) + g.up.y * Math.sin(a)) * r + g.tan.y * drift;
        const cz = g.pos.z + (g.side.z * Math.cos(a) + g.up.z * Math.sin(a)) * r + g.tan.z * drift;
        const dx = camPos.x - cx;
        const dy = camPos.y - cy;
        const dz = camPos.z - cz;
        const d = Math.hypot(dx, dy, dz);
        const far = Math.min(3.5, Math.max(1, d / 45));
        const near = Math.min(1, Math.max(0, (d - 1.5) / 3));
        halo.write(i, cx, cy, cz, hl.size * far * near * active,
          time * hl.spinW + hl.spinP, camPos);
      }
      halo.commit();

      if (msgTimer > 0) {
        msgTimer -= dt;
        if (msgTimer <= 0) msgEl.classList.remove('show');
      }

      if (!playing) return;
      if (cooldown > 0) cooldown -= dt;

      if (!racing) {
        // Arm on flying through a ring: track which side of the gate plane
        // the drone is on; a -→+ flip while inside the ring's disc starts it.
        let nearGate = false;
        for (const g of gates) {
          rel.subVectors(drone.position, g.pos);
          const d = rel.length();
          if (d < 60) nearGate = true;
          if (d > 14) { g.prevS = null; continue; }
          const s = rel.dot(g.tan);
          const lat = Math.sqrt(Math.max(0, d * d - s * s));
          if (g.prevS !== null && g.prevS < 0 && s >= 0 && lat < GATE_R && cooldown <= 0) {
            g.prevS = null;
            start(g);
            break;
          }
          g.prevS = s;
        }
        if (!racing && nearGate && msgTimer <= 0) {
          msgEl.textContent = 'fly through the ring — race the wind';
          msgEl.classList.add('show');
        } else if (!racing && !nearGate && msgTimer <= 0) {
          msgEl.classList.remove('show');
        }
        prevPos.copy(drone.position);
        return;
      }

      // ---- Mid-run.
      racing.elapsed += dt;
      ghost.update(dt, racing.elapsed);

      // R-reset (or any teleport) voids the run.
      if (drone.position.distanceTo(prevPos) > 60) {
        say('run void — drone reset');
        endRun();
        prevPos.copy(drone.position);
        return;
      }
      prevPos.copy(drone.position);

      // Progress = motion along the sample table, signed by the flow
      // direction. The physics' nearest-point cache does the heavy lifting.
      const M = racing.way.samples.length;
      let step = racing.way.nearest - racing.lastNearest;
      if (step > M / 2) step -= M;
      else if (step < -M / 2) step += M;
      racing.progressed += step * racing.way.dir;
      racing.lastNearest = racing.way.nearest;

      if (racing.progressed < -40) {
        say('wrong way — run void');
        endRun();
        return;
      }

      // Corridor: no gates to clip, just stay with the wind.
      const spine = racing.way.samples[racing.way.nearest];
      const off = drone.position.distanceTo(spine) > CORRIDOR;
      if (off) {
        racing.offTime += dt;
        if (racing.offTime > GRACE) {
          say('lost the wind — run void');
          endRun();
          return;
        }
      } else {
        racing.offTime = Math.max(0, racing.offTime - dt * 2);
      }

      // 10Hz flight recording for the ghost.
      racing.recTime += dt;
      while (racing.recTime >= 1 / GHOST_HZ) {
        racing.recTime -= 1 / GHOST_HZ;
        record();
      }

      hudEl.textContent = `windway ${NAMES[racing.wIdx]}  ·  ${fmt(racing.elapsed)}`
        + (racing.best ? `  ·  best ${fmt(racing.best.time)}` : '')
        + (racing.offTime > 0.5 ? '  ·  find the wind' : '');

      if (racing.progressed >= M) finish();
    },
  };
  return api;
}

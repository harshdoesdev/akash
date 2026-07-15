import * as THREE from 'three/webgpu';
import {
  attribute, texture as textureNode, uniform, uniformArray, varying,
  positionGeometry, positionView, cameraPosition, uv,
  vec2, vec3, float, int, dot, sin, cos, smoothstep, mix, fract, floor,
  normalize, cross, Fn, Discard, mat2,
} from 'three/tsl';
import { GLOBAL_TINT } from './dayNight.js';
import { texture, ready } from './assets.js';

// Ghibli wind gusts: a handful of invisible gust "streams" spawn at tree
// canopies near the drone, drift downwind for a few seconds and die. Each
// stream carries a comet-trail of small leaves that swirl around it in a
// loose helix, tumbling as they go. All motion is in the vertex stage —
// the CPU only moves a few anchor points per frame.
// The LAST stream is the drone's prop wash: hover into a canopy and a
// vortex of torn-off leaves whirls around the drone, scaled by throttle.

const GUSTS = 5;
const STREAMS = GUSTS + 1; // + the prop-wash vortex
const LEAVES_PER = 60;

export function createWindLeaves(scene, heightAt, treeColliders, fog) {
  const uTime = uniform(0);
  const uStreams = uniformArray(
    Array.from({ length: STREAMS }, () => new THREE.Vector4(0, -9999, 0, 0))
  );
  const uStreamDirs = uniformArray(
    Array.from({ length: STREAMS }, () => new THREE.Vector4(1, 0, 0, 0))
  );
  const uTint = uniform(GLOBAL_TINT.value);
  const uFogColor = uniform(fog.color);
  const uFogNear = uniform(fog.near);
  const uFogFar = uniform(fog.far);

  const leavesTex = ready('leaves') ? texture('leaves') : null;

  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });

  const aStream = attribute('aStream', 'float');
  const aData = attribute('aData', 'vec4'); // phase, radius, size, jitter
  const idx = int(aStream.add(0.5));
  const s = uStreams.element(idx);
  const sd = uStreamDirs.element(idx);
  const ph = aData.x;

  mat.positionNode = Fn(() => {
    // Trail back along the travel direction, swirl around the axis.
    const p = s.xyz.sub(sd.xyz.mul(fract(ph.mul(7.31)).mul(11.0))).toVar();
    const rad = aData.y.mul(sin(uTime.mul(0.9).add(ph.mul(5.0))).mul(0.45).add(0.55));
    const ang = uTime.mul(fract(ph.mul(3.3)).mul(1.6).add(2.0)).add(ph.mul(6.28318));
    p.x.addAssign(cos(ang).mul(rad));
    p.z.addAssign(sin(ang).mul(rad));
    p.y.addAssign(sin(ang.mul(0.7).add(ph.mul(9.0))).mul(rad).mul(0.55)
      .add(fract(ph.mul(3.7)).mul(2.4)));

    // Tumbling billboard.
    const fwd = normalize(cameraPosition.sub(p));
    const right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    const up2 = cross(fwd, right);
    const spin = uTime.mul(fract(ph.mul(13.7)).mul(4.0).add(3.0)).add(ph.mul(20.0));
    const cx = positionGeometry.x.mul(cos(spin)).sub(positionGeometry.y.mul(sin(spin)));
    const cy = positionGeometry.x.mul(sin(spin)).add(positionGeometry.y.mul(cos(spin)));
    return p.add(right.mul(cx).add(up2.mul(cy)).mul(aData.z).mul(s.w));
  })();

  const vJitter = varying(aData.w);
  const vBlossom = varying(sd.w);

  mat.colorNode = Fn(() => {
    // Same tones as the canopy ramps, so torn leaves match their tree —
    // greens normally, petal pinks off a blossom tree.
    const green = mix(vec3(0.29, 0.54, 0.31), vec3(0.56, 0.77, 0.37), vJitter);
    const pink = mix(vec3(0.81, 0.55, 0.63), vec3(0.94, 0.73, 0.78), vJitter);
    const base = mix(green, pink, vBlossom);
    const col = vec3(0).toVar();
    if (leavesTex) {
      const variant = floor(vJitter.mul(3.999));
      const cell = vec2(variant.mod(2.0), floor(variant.mul(0.5))).mul(0.5);
      const tex = textureNode(leavesTex, cell.add(uv().mul(0.5)));
      Discard(tex.a.lessThan(0.5));
      col.assign(tex.rgb.mul(base).mul(1.3));
    } else {
      const p = uv().sub(0.5).mul(2.0);
      Discard(dot(p, p).greaterThan(1.0));
      col.assign(base);
    }
    col.mulAssign(uTint);
    const fogF = smoothstep(uFogNear, uFogFar, positionView.z.negate());
    return mix(col, uFogColor, fogF);
  })();

  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  const N = STREAMS * LEAVES_PER;
  const aStreamArr = new Float32Array(N);
  const aDataArr = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    aStreamArr[i] = Math.floor(i / LEAVES_PER);
    aDataArr[i * 4] = Math.random();                // phase
    aDataArr[i * 4 + 1] = 0.8 + Math.random() * 3.4; // swirl radius
    aDataArr[i * 4 + 2] = 0.16 + Math.random() * 0.14; // size
    aDataArr[i * 4 + 3] = Math.random();            // jitter
  }
  geo.setAttribute('aStream', new THREE.InstancedBufferAttribute(aStreamArr, 1));
  geo.setAttribute('aData', new THREE.InstancedBufferAttribute(aDataArr, 4));
  geo.instanceCount = N;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; // streams roam; one small mesh, always cheap
  scene.add(mesh);

  const streams = Array.from({ length: GUSTS }, (_, i) => ({
    src: new THREE.Vector3(),
    dir: new THREE.Vector3(1, 0, 0),
    speed: 8,
    age: -2 - i * 2.5, // stagger the first gusts
    dur: 10,
    blossom: 0,
  }));

  function respawn(st, dronePos) {
    // Blow off a leafy tree canopy near the drone when one is around.
    let sx = dronePos.x + (Math.random() - 0.5) * 220;
    let sz = dronePos.z + (Math.random() - 0.5) * 220;
    let sy = null;
    st.blossom = 0;
    for (let tries = 0; tries < 24; tries++) {
      const c = treeColliders[Math.floor(Math.random() * treeColliders.length)];
      if (!c) break;
      if (c.canopyR && Math.hypot(c.x - dronePos.x, c.z - dronePos.z) < 240) {
        sx = c.x;
        sz = c.z;
        sy = c.top + 1.5; // just above the fork, inside the canopy
        st.blossom = c.blossom || 0;
        break;
      }
    }
    st.src.set(sx, sy ?? heightAt(sx, sz) + 5, sz);
    const a = Math.random() * Math.PI * 2;
    st.dir.set(Math.cos(a), 0, Math.sin(a));
    st.speed = 6 + Math.random() * 5;
    st.dur = 7 + Math.random() * 6;
    st.age = -Math.random() * 3; // pause between gusts
  }

  const anchor = new THREE.Vector3();
  let washStrength = 0;
  let washBlossomHeld = 0; // keeps petal color while the last leaves settle
  return {
    update(dt, time, dronePos, droneVel, throttle) {
      uTime.value = time;
      uFogFar.value = fog.far;
      for (let i = 0; i < GUSTS; i++) {
        const st = streams[i];
        st.age += dt;
        if (st.age > st.dur) respawn(st, dronePos);
        const t = Math.max(0, st.age);
        anchor.copy(st.src).addScaledVector(st.dir, st.speed * t);
        // Sink slowly but never into the ground.
        anchor.y = Math.max(st.src.y - t * 0.45, heightAt(anchor.x, anchor.z) + 1.4);
        const strength = THREE.MathUtils.smoothstep(st.age, 0, 1.6)
          * (1 - THREE.MathUtils.smoothstep(st.age, st.dur - 2, st.dur));
        uStreams.array[i].set(anchor.x, anchor.y, anchor.z, strength);
        uStreamDirs.array[i].set(st.dir.x, st.dir.y, st.dir.z, st.blossom || 0);
      }

      // Prop wash: only INSIDE a leafy canopy envelope (dead snags have
      // canopyR 0 and never trigger).
      let inCanopy = 0;
      let washBlossom = 0;
      for (const c of treeColliders) {
        if (!c.canopyR) continue;
        if (dronePos.y < c.top - 1 || dronePos.y > c.canopyTop) continue;
        const dd = Math.hypot(c.x - dronePos.x, c.z - dronePos.z);
        if (dd < c.canopyR + 0.8) {
          // Hover wash alone tears leaves; throttle whips the vortex bigger.
          inCanopy = Math.min(1.3, 0.5 + throttle * 0.8);
          washBlossom = c.blossom || 0;
          break;
        }
      }
      // Snap on fast, linger a moment as the last leaves settle.
      washStrength += (inCanopy - washStrength) * Math.min(1, dt * (inCanopy > washStrength ? 6 : 1.4));
      if (inCanopy > 0) washBlossomHeld = washBlossom;
      uStreams.array[GUSTS].set(dronePos.x, dronePos.y - 0.9, dronePos.z, washStrength);
      uStreamDirs.array[GUSTS].set(droneVel.x * 0.06, 0, droneVel.z * 0.06, washBlossomHeld);
    },
  };
}

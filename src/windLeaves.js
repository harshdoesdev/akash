import * as THREE from 'three';
import { GLOBAL_TINT } from './dayNight.js';
import { texture, ready } from './assets.js';

// Ghibli wind gusts: a handful of invisible gust "streams" spawn at tree
// canopies near the drone, drift downwind for a few seconds and die. Each
// stream carries a comet-trail of small leaves that swirl around it in a
// loose helix, tumbling as they go. All motion is in the vertex shader —
// the CPU only moves a few anchor points per frame.
// The LAST stream is the drone's prop wash: hover into a canopy and a
// vortex of torn-off leaves whirls around the drone, scaled by throttle.

const GUSTS = 5;
const STREAMS = GUSTS + 1; // + the prop-wash vortex
const LEAVES_PER = 60;

const vertexShader = /* glsl */ `
  attribute float aStream;
  attribute vec4 aData; // phase, radius, size, jitter
  uniform vec4 uStreams[${STREAMS}];    // xyz anchor, w strength
  uniform vec4 uStreamDirs[${STREAMS}]; // xyz travel dir, w blossom
  uniform float uTime;
  varying vec2 vUv;
  varying float vJitter;
  varying float vFogDepth;
  varying float vBlossom;

  void main() {
    vUv = uv;
    vJitter = aData.w;
    vec4 s = uStreams[int(aStream + 0.5)];
    vec4 sd = uStreamDirs[int(aStream + 0.5)];
    vec3 dir = sd.xyz;
    vBlossom = sd.w;
    float ph = aData.x;

    // Trail back along the travel direction, swirl around the axis.
    vec3 p = s.xyz - dir * fract(ph * 7.31) * 11.0;
    float rad = aData.y * (0.55 + 0.45 * sin(uTime * 0.9 + ph * 5.0));
    float ang = uTime * (2.0 + fract(ph * 3.3) * 1.6) + ph * 6.28318;
    p.x += cos(ang) * rad;
    p.z += sin(ang) * rad;
    p.y += sin(ang * 0.7 + ph * 9.0) * rad * 0.55 + fract(ph * 3.7) * 2.4;

    // Tumbling billboard.
    vec3 fwd = normalize(cameraPosition - p);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up2 = cross(fwd, right);
    float spin = uTime * (3.0 + fract(ph * 13.7) * 4.0) + ph * 20.0;
    vec2 c = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * position.xy;
    vec3 wp = p + (right * c.x + up2 * c.y) * aData.z * s.w;

    vec4 mv = viewMatrix * vec4(wp, 1.0);
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uReady;
  uniform vec3 uTint;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec2 vUv;
  varying float vJitter;
  varying float vFogDepth;
  varying float vBlossom;

  void main() {
    // Same tones as the canopy ramps, so torn leaves match their tree —
    // greens normally, petal pinks off a blossom tree.
    vec3 green = mix(vec3(0.29, 0.54, 0.31), vec3(0.56, 0.77, 0.37), vJitter);
    vec3 pink = mix(vec3(0.81, 0.55, 0.63), vec3(0.94, 0.73, 0.78), vJitter);
    vec3 base = mix(green, pink, vBlossom);
    vec3 col;
    if (uReady > 0.5) {
      float variant = floor(vJitter * 3.999);
      vec2 cell = vec2(mod(variant, 2.0), floor(variant * 0.5)) * 0.5;
      vec4 tex = texture2D(uMap, cell + vUv * 0.5);
      if (tex.a < 0.5) discard;
      col = tex.rgb * base * 1.3;
    } else {
      vec2 p = (vUv - 0.5) * 2.0;
      if (dot(p, p) > 1.0) discard;
      col = base;
    }
    col *= uTint;
    float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
    gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
    #include <colorspace_fragment>
  }
`;

export function createWindLeaves(scene, heightAt, treeColliders, fog) {
  const uniforms = {
    uTime: { value: 0 },
    uMap: { value: null },
    uReady: { value: 0 },
    uStreams: { value: Array.from({ length: STREAMS }, () => new THREE.Vector4(0, -9999, 0, 0)) },
    uStreamDirs: { value: Array.from({ length: STREAMS }, () => new THREE.Vector4(1, 0, 0, 0)) },
    uTint: GLOBAL_TINT,
    uFogColor: { value: fog.color },
    uFogNear: { value: fog.near },
    uFogFar: { value: fog.far },
  };
  if (ready('leaves')) {
    uniforms.uMap.value = texture('leaves');
    uniforms.uReady.value = 1;
  }

  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  const N = STREAMS * LEAVES_PER;
  const aStream = new Float32Array(N);
  const aData = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    aStream[i] = Math.floor(i / LEAVES_PER);
    aData[i * 4] = Math.random();               // phase
    aData[i * 4 + 1] = 0.8 + Math.random() * 3.4; // swirl radius
    aData[i * 4 + 2] = 0.16 + Math.random() * 0.14; // size
    aData[i * 4 + 3] = Math.random();           // jitter
  }
  geo.setAttribute('aStream', new THREE.InstancedBufferAttribute(aStream, 1));
  geo.setAttribute('aData', new THREE.InstancedBufferAttribute(aData, 4));
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false; // streams roam; one small mesh, always cheap
  scene.add(mesh);

  const streams = Array.from({ length: GUSTS }, (_, i) => ({
    src: new THREE.Vector3(),
    dir: new THREE.Vector3(1, 0, 0),
    speed: 8,
    age: -2 - i * 2.5, // stagger the first gusts
    dur: 10,
    started: false,
  }));

  function respawn(s, dronePos) {
    // Blow off a leafy tree canopy near the drone when one is around.
    let sx = dronePos.x + (Math.random() - 0.5) * 220;
    let sz = dronePos.z + (Math.random() - 0.5) * 220;
    let sy = null;
    s.blossom = 0;
    for (let tries = 0; tries < 24; tries++) {
      const c = treeColliders[Math.floor(Math.random() * treeColliders.length)];
      if (!c) break;
      if (c.canopyR && Math.hypot(c.x - dronePos.x, c.z - dronePos.z) < 240) {
        sx = c.x;
        sz = c.z;
        sy = c.top + 1.5; // just above the fork, inside the canopy
        s.blossom = c.blossom || 0;
        break;
      }
    }
    s.src.set(sx, sy ?? heightAt(sx, sz) + 5, sz);
    const a = Math.random() * Math.PI * 2;
    s.dir.set(Math.cos(a), 0, Math.sin(a));
    s.speed = 6 + Math.random() * 5;
    s.dur = 7 + Math.random() * 6;
    s.age = -Math.random() * 3; // pause between gusts
  }

  const anchor = new THREE.Vector3();
  let washStrength = 0;
  let washBlossomHeld = 0; // keeps petal color while the last leaves settle
  return {
    update(dt, time, dronePos, droneVel, throttle) {
      uniforms.uTime.value = time;
      uniforms.uFogFar.value = fog.far;
      for (let i = 0; i < GUSTS; i++) {
        const s = streams[i];
        s.age += dt;
        if (s.age > s.dur) respawn(s, dronePos);
        const t = Math.max(0, s.age);
        anchor.copy(s.src).addScaledVector(s.dir, s.speed * t);
        // Sink slowly but never into the ground.
        anchor.y = Math.max(s.src.y - t * 0.45, heightAt(anchor.x, anchor.z) + 1.4);
        const strength = THREE.MathUtils.smoothstep(s.age, 0, 1.6)
          * (1 - THREE.MathUtils.smoothstep(s.age, s.dur - 2, s.dur));
        uniforms.uStreams.value[i].set(anchor.x, anchor.y, anchor.z, strength);
        uniforms.uStreamDirs.value[i].set(s.dir.x, s.dir.y, s.dir.z, s.blossom || 0);
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
      uniforms.uStreams.value[GUSTS].set(dronePos.x, dronePos.y - 0.9, dronePos.z, washStrength);
      uniforms.uStreamDirs.value[GUSTS].set(droneVel.x * 0.06, 0, droneVel.z * 0.06, washBlossomHeld);
    },
  };
}

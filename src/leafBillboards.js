import * as THREE from 'three/webgpu';
import {
  attribute, uniform, varying, positionView,
  uv, vec2, vec3, mix, smoothstep, floor, dot, Fn, Discard,
  texture as textureNode,
} from 'three/tsl';
import { GLOBAL_TINT } from './dayNight.js';
import { texture, ready } from './assets.js';

// Shared pool of CPU-billboarded, tumbling leaf sprites — the game's one
// vocabulary for airborne wind-carried things (windway comets, gate halos).
// Quads are billboarded and spun on the CPU into a plain BufferGeometry;
// r185's WebGPU instanced-attribute path silently binds buffers wrong, so
// no InstancedBufferGeometry here. Opaque + alpha discard: no transparency
// sorting, proper occlusion.
// Leaf kind: 0 = sunlit gold, 0.5 = canopy green, 1 = petal pink.
const CORNERS = [-1, -1, 1, -1, -1, 1, 1, 1];

export function createLeafPool(scene, count) {
  const verts = new Float32Array(count * 4 * 3);
  const uvs = new Float32Array(count * 4 * 2);
  const info = new Float32Array(count * 4 * 2); // jitter, kind
  const index = new Uint32Array(count * 6);
  for (let i = 0; i < count; i++) {
    for (const [c, u, v] of [[0, 0, 0], [1, 1, 0], [2, 0, 1], [3, 1, 1]]) {
      const vi = i * 4 + c;
      uvs[vi * 2] = u;
      uvs[vi * 2 + 1] = v;
    }
    const b = i * 4;
    index.set([b, b + 1, b + 2, b + 2, b + 1, b + 3], i * 6);
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(verts, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aInfo', new THREE.BufferAttribute(info, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));

  const uTint = uniform(GLOBAL_TINT.value);
  const uFogColor = uniform(scene.fog.color);
  const uFogNear = uniform(scene.fog.near);
  const uFogFar = uniform(scene.fog.far);
  const leavesTex = ready('leaves') ? texture('leaves') : null;
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
  {
    // Attributes are vertex-stage only — carry them to the fragment.
    const vInfo = varying(attribute('aInfo', 'vec2'));
    mat.colorNode = Fn(() => {
      // Sunlit golds pop against grass and sky; green/pink ramps match
      // windLeaves.js so it all reads as one flora.
      const gold = mix(vec3(0.86, 0.68, 0.32), vec3(0.98, 0.89, 0.56), vInfo.x);
      const green = mix(vec3(0.38, 0.62, 0.34), vec3(0.62, 0.8, 0.4), vInfo.x);
      const pink = mix(vec3(0.81, 0.55, 0.63), vec3(0.94, 0.73, 0.78), vInfo.x);
      const base = mix(
        mix(gold, green, smoothstep(0.2, 0.5, vInfo.y)),
        pink,
        smoothstep(0.7, 0.9, vInfo.y),
      );
      const col = vec3(0).toVar();
      if (leavesTex) {
        const variant = floor(vInfo.x.mul(3.999));
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
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    // Per-leaf look, set once at creation.
    setStyle(i, jitter, kind) {
      for (let c = 0; c < 4; c++) {
        const vi = i * 4 + c;
        info[vi * 2] = jitter;
        info[vi * 2 + 1] = kind;
      }
    },
    // Place leaf i: center, half-extent, screen-plane spin angle.
    write(i, cx, cy, cz, half, spin, camPos) {
      const b0 = i * 12;
      if (half <= 0.001) {
        for (let k = 0; k < 12; k++) verts[b0 + k] = 0;
        return;
      }
      let fx = camPos.x - cx;
      let fy = camPos.y - cy;
      let fz = camPos.z - cz;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl; fy /= fl; fz /= fl;
      let rx = fz, rz = -fx; // right = up × fwd (horizontal)
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl; rz /= rl;
      const ux = fy * rz;            // up2 = fwd × right
      const uy = fz * rx - fx * rz;
      const uz = -fy * rx;
      const ca = Math.cos(spin) * half;
      const sa = Math.sin(spin) * half;
      for (let c = 0; c < 4; c++) {
        const ex = CORNERS[c * 2];
        const ey = CORNERS[c * 2 + 1];
        const px = ex * ca - ey * sa;
        const py = ex * sa + ey * ca;
        const b = b0 + c * 3;
        verts[b] = cx + rx * px + ux * py;
        verts[b + 1] = cy + uy * py;
        verts[b + 2] = cz + rz * px + uz * py;
      }
    },
    commit() {
      uFogNear.value = scene.fog.near;
      uFogFar.value = scene.fog.far;
      posAttr.needsUpdate = true;
    },
  };
}

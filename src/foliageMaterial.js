import * as THREE from 'three';
import { SUN_DIR } from './palette.js';

// Hand-painted foliage shading. Instead of a smooth toon gradient, light is
// quantized into four hard bands (deep shadow → mid → lit → sunlit dabs)
// whose BOUNDARIES are wobbled by 3D noise — band edges meander like brush
// strokes instead of wrapping the puffs as clean arcs. Vertex colors carry
// the canopy-depth shading and multiply the result.
const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec3 vColor;
  varying float vFogDepth;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vColor = color;
    vec4 mv = viewMatrix * wp;
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uShadow;
  uniform vec3 uMid;
  uniform vec3 uLight;
  uniform vec3 uGlow;
  uniform vec3 uSunDir;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec3 vColor;
  varying float vFogDepth;

  float hash3(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash3(i);
    float n100 = hash3(i + vec3(1, 0, 0));
    float n010 = hash3(i + vec3(0, 1, 0));
    float n110 = hash3(i + vec3(1, 1, 0));
    float n001 = hash3(i + vec3(0, 0, 1));
    float n101 = hash3(i + vec3(1, 0, 1));
    float n011 = hash3(i + vec3(0, 1, 1));
    float n111 = hash3(i + vec3(1, 1, 1));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z
    );
  }

  void main() {
    vec3 n = normalize(vNormal);
    float ndl = dot(n, uSunDir) * 0.5 + 0.5;
    // Brush wobble: two noise octaves shove the band thresholds around.
    float w = vnoise(vWorld * 0.85) * 0.65 + vnoise(vWorld * 2.3) * 0.35;
    float t = clamp(ndl + (w - 0.5) * 0.42, 0.0, 1.0);

    vec3 col = uShadow;
    col = mix(col, uMid, smoothstep(0.40, 0.46, t));
    col = mix(col, uLight, smoothstep(0.68, 0.74, t));
    col = mix(col, uGlow, smoothstep(0.895, 0.925, t)); // sunlit leaf dabs
    col *= vColor; // canopy-depth shading baked per puff

    float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
    gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
    #include <colorspace_fragment>
  }
`;

export function makeFoliageMaterial(shadow, mid, light, glow, fog) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uShadow: { value: new THREE.Color(shadow) },
      uMid: { value: new THREE.Color(mid) },
      uLight: { value: new THREE.Color(light) },
      uGlow: { value: new THREE.Color(glow) },
      uSunDir: { value: SUN_DIR.clone() },
      uFogColor: { value: fog.color },
      uFogNear: { value: fog.near },
      uFogFar: { value: fog.far },
    },
    vertexColors: true,
  });
}

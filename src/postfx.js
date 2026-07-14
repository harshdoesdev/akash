import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Film grade: one fullscreen pass that makes every frame look color-timed —
// saturation lift, gentle S-curve, warm sunlight in the highlights, and a
// soft vignette pulling the eye to center. Runs in linear space; OutputPass
// handles the final sRGB conversion.
const gradeShader = {
  uniforms: {
    tDiffuse: { value: null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.14);                    // saturation
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.12); // gentle S-curve
      col += vec3(0.035, 0.022, 0.0) * smoothstep(0.5, 1.0, l); // warm highlights
      float d = distance(vUv, vec2(0.5));
      col *= 1.0 - smoothstep(0.52, 0.95, d) * 0.22;    // soft vignette
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function createPostFX(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass(gradeShader));
  composer.addPass(new OutputPass());
  return composer;
}

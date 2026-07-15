import * as THREE from 'three/webgpu';
import { pass, mix, vec3, dot, float, smoothstep, distance, vec2, uv } from 'three/tsl';

// Film grade: one fullscreen pass that makes every frame look color-timed —
// saturation lift, gentle S-curve, warm sunlight in the highlights, and a
// soft vignette pulling the eye to center. Runs in linear space; the
// pipeline's output transform handles the final sRGB conversion.
// NOTE: no MSAA and no FXAA, deliberately. MSAA on a million tiny leaf
// cutouts makes every pixel an "edge" (measured ~30x GPU cost), and the
// FXAA node measured ~80ms at 4K-ish. The 1.75 pixel ratio + painterly
// style carry edge quality instead.
export function createPostFX(renderer, scene, camera) {
  const Pipeline = THREE.RenderPipeline || THREE.PostProcessing;
  const post = new Pipeline(renderer);
  const scenePass = pass(scene, camera);

  let col = scenePass.rgb;
  const l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, 1.14); // saturation
  col = mix(col, col.mul(col).mul(vec3(3.0).sub(col.mul(2.0))), 0.12); // gentle S-curve
  col = col.add(vec3(0.035, 0.022, 0.0).mul(smoothstep(0.5, 1.0, l))); // warm highlights
  const d = distance(uv(), vec2(0.5));
  col = col.mul(float(1.0).sub(smoothstep(0.52, 0.95, d).mul(0.22))); // soft vignette

  post.outputNode = col;
  return post;
}

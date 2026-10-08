import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/* Финальный проход: хроматическая аберрация по краям, радиальное смазывание при быстром скролле
   («варп») и цветная вспышка при смене вкуса. Зерно и виньетка — отдельно, в CSS (одинаково на всех устройствах). */
export function createFXPass() {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uWarp: { value: 0 },
      uFlash: { value: 0 },
      uFlashCol: { value: new THREE.Color('#e9c871') },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float uWarp; uniform float uFlash; uniform vec3 uFlashCol;
      varying vec2 vUv;
      void main(){
        vec2 c = vUv - .5;
        float r2 = dot(c, c);
        float ca = .0016 + uWarp*.012;
        vec3 col;
        if (uWarp > .02) {
          float amt = uWarp * .075;
          vec3 acc = vec3(0.);
          for (int i = 0; i < 8; i++) {
            float t = float(i) / 7.;
            vec2 off = c * (t * amt);
            acc.r += texture2D(tDiffuse, vUv - off * (1. + ca*18.)).r;
            acc.g += texture2D(tDiffuse, vUv - off).g;
            acc.b += texture2D(tDiffuse, vUv - off * (1. - ca*18.)).b;
          }
          col = acc / 8.;
        } else {
          float k = ca * (.5 + r2 * 3.);
          col = vec3(texture2D(tDiffuse, vUv - c*k).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + c*k).b);
        }
        col += uFlashCol * uFlash * (1. - smoothstep(0., .62, length(c))) * .22;
        gl_FragColor = vec4(col, 1.);
      }`,
  });
}
